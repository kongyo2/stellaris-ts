import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { NodeKind, parse, type Block, type Document, type EntryNode } from "../../src/syntax/index.js";
import { gameDeclaredFieldTypes } from "../../src/schema/open-fields.js";
import type { DefinitionType, EnumDefinition, ExtractionStep, SchemaModel } from "../../src/schema/ir.js";

/**
 * Indexes the installed game.
 *
 * Two things only exist once the game is on disk: the identifiers vanilla
 * defines, and the members of an enum whose values are extracted from script
 * rather than listed in the schema. Both are needed before a reference to
 * either can be checked or offered as a type.
 *
 * Only names are collected. Localisation text, numeric balance and script
 * bodies stay where they are: names are what a mod must write to refer to base
 * game content, and nothing else may be redistributed.
 */

const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set(["", ".txt", ".gui", ".gfx", ".asset", ".sound"]);
const READ_CONCURRENCY = 32;

export interface TypeIndex {
  readonly type: string;
  readonly directory: string;
  readonly ids: readonly string[];
}

export interface EnumIndex {
  readonly id: string;
  readonly members: readonly string[];
}

export interface GameIndex {
  readonly version: string;
  readonly types: readonly TypeIndex[];
  readonly enums: readonly EnumIndex[];
  readonly filesRead: number;
  /**
   * Every file vanilla ships, by directory.
   *
   * Stellaris replaces a vanilla file outright when a mod ships one of the same
   * name, silently disabling everything else that file defined. Emitting a mod
   * cannot warn about that without knowing these names.
   */
  readonly vanillaFiles: Readonly<Record<string, readonly string[]>>;
  /**
   * Modifier names the game localises.
   *
   * Every modifier the executable carries has a `mod_<name>` string, so the keys
   * of those strings name modifiers that no rule generates and that a dump older
   * than this build has not heard of. Keys only — the strings themselves stay
   * where they are.
   */
  readonly modifierNames: readonly string[];
  /**
   * Field names the game declares, for the types that declare their own.
   *
   * `common/defines` holds a few thousand engine constants that no ported corpus
   * can stay ahead of. What the game ships is the whole valid set.
   */
  readonly fieldNames: Readonly<Record<string, readonly string[]>>;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function mapWithLimit<Item, Result>(
  items: readonly Item[],
  limit: number,
  handler: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = new Array<Result>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index: number = next;
      next += 1;
      const item: Item | undefined = items[index];

      if (item === undefined) {
        return;
      }

      // oxlint-disable-next-line no-await-in-loop
      results[index] = await handler(item);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function collectFiles(directory: string, recurse: boolean): Promise<string[]> {
  let entries: readonly Dirent[];

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const groups: string[][] = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const path: string = join(directory, entry.name);

      if (entry.isDirectory()) {
        return recurse ? collectFiles(path, recurse) : [];
      }

      const dot: number = entry.name.lastIndexOf(".");
      const extension: string = dot < 0 ? "" : entry.name.slice(dot).toLowerCase();
      return entry.isFile() && SCRIPT_EXTENSIONS.has(extension) ? [path] : [];
    }),
  );

  return groups.flat();
}

function blockOf(entry: EntryNode): Block | undefined {
  return entry.kind === NodeKind.Assignment && entry.value.kind === NodeKind.Block ? entry.value : undefined;
}

function keyOf(entry: EntryNode): string | undefined {
  return entry.kind === NodeKind.Assignment ? String(entry.key.value) : undefined;
}

/**
 * Ids a definition type claims from one file, mirroring how the game loads them.
 *
 * Container and naming compose. A sprite lives at
 * `spriteTypes = { spriteType = { name = "GFX_x" } }`: a container to descend
 * into, and then a name field to read — not the nested key, which is
 * `spriteType` for every one of them.
 */
function definitionIds(type: DefinitionType, document: Document, fileName: string): string[] {
  if (type.source.kind === "file-definitions") {
    return [type.source.stripExtension ? fileName.replace(/\.[^.]+$/u, "") : fileName];
  }

  const filter = type.source.rootKeyFilter;
  const accepted = (key: string): boolean =>
    filter === undefined
      ? true
      : filter.mode === "include"
        ? filter.values.includes(key)
        : !filter.values.includes(key);

  const container = type.source.container;
  const nameField: string | undefined = type.source.kind === "tagged-blocks" ? type.source.nameField : undefined;
  const ids: string[] = [];

  /** Reads one definition block: its key, or the field the type names. */
  const claim = (key: string, body: Block): void => {
    if (nameField === undefined) {
      ids.push(key);
      return;
    }

    for (const field of body.entries) {
      if (keyOf(field) === nameField && field.kind === NodeKind.Assignment && field.value.kind === NodeKind.Scalar) {
        ids.push(String(field.value.value));
      }
    }
  };

  for (const entry of document.entries) {
    const key: string | undefined = keyOf(entry);
    const block: Block | undefined = blockOf(entry);

    if (key === undefined || block === undefined) {
      continue;
    }

    if (container !== undefined) {
      if (container.kind !== "any-container" && container.key !== key) {
        continue;
      }
      for (const nested of block.entries) {
        const nestedKey: string | undefined = keyOf(nested);
        const nestedBlock: Block | undefined = blockOf(nested);
        if (nestedKey !== undefined && nestedBlock !== undefined && accepted(nestedKey)) {
          claim(nestedKey, nestedBlock);
        }
      }
      continue;
    }

    if (accepted(key)) {
      claim(key, block);
    }
  }

  // A quoted key keeps its quotes in the raw value; the identifier is the text
  // inside them, which is what every reference elsewhere in script writes.
  return ids.map((id) => id.replace(/^"|"$/gu, "")).filter((id) => id.length > 0);
}

/**
 * The top-level keys of every block a definition type claims from one file.
 *
 * Where {@link definitionIds} reads what the definitions are called, this reads
 * what they contain — which for a defines block is the whole point, since the
 * engine constants are the fields.
 */
function definitionFieldKeys(type: DefinitionType, document: Document, into: Set<string>): void {
  const filter = type.source.rootKeyFilter;
  const accepted = (key: string): boolean =>
    filter === undefined
      ? true
      : filter.mode === "include"
        ? filter.values.includes(key)
        : !filter.values.includes(key);

  const claim = (body: Block): void => {
    for (const entry of body.entries) {
      const key: string | undefined = keyOf(entry);
      if (key !== undefined) {
        into.add(key);
      }
    }
  };

  if (type.source.kind === "file-definitions") {
    claim({ kind: NodeKind.Block, entries: document.entries, closed: true, span: document.span });
    return;
  }

  const container = type.source.container;

  for (const entry of document.entries) {
    const key: string | undefined = keyOf(entry);
    const block: Block | undefined = blockOf(entry);

    if (key === undefined || block === undefined) {
      continue;
    }

    if (container === undefined) {
      if (accepted(key)) {
        claim(block);
      }
      continue;
    }

    if (container.kind === "any-container" || container.key === key) {
      for (const nested of block.entries) {
        const nestedKey: string | undefined = keyOf(nested);
        const nestedBlock: Block | undefined = blockOf(nested);
        if (nestedKey !== undefined && nestedBlock !== undefined && accepted(nestedKey)) {
          claim(nestedBlock);
        }
      }
    }
  }
}

/** Follows an extraction route from a block, collecting whatever the route captures. */
function captureAlong(entries: readonly EntryNode[], route: readonly ExtractionStep[], into: Set<string>): void {
  const step: ExtractionStep | undefined = route[0];

  if (step === undefined) {
    return;
  }

  const rest: readonly ExtractionStep[] = route.slice(1);

  if (step.kind === "capture") {
    for (const entry of entries) {
      if (step.source === "key") {
        const key: string | undefined = keyOf(entry);
        if (key !== undefined) {
          into.add(key);
        }
      } else if (entry.kind === NodeKind.Scalar) {
        into.add(String(entry.value));
      } else if (entry.kind === NodeKind.Assignment && entry.value.kind === NodeKind.Scalar) {
        into.add(String(entry.value.value));
      }
    }
    return;
  }

  for (const entry of entries) {
    const block: Block | undefined = blockOf(entry);

    if (step.kind === "field") {
      if (keyOf(entry) === step.key) {
        if (block !== undefined) {
          captureAlong(block.entries, rest, into);
        } else if (rest[0]?.kind === "capture" && entry.kind === NodeKind.Assignment) {
          captureAlong([entry], rest, into);
        }
      }
      continue;
    }

    if (block !== undefined) {
      captureAlong(block.entries, rest, into);
    }
  }
}

export async function indexGame(model: SchemaModel, gamePath: string, version: string): Promise<GameIndex> {
  let filesRead = 0;

  /**
   * Streams one directory's documents past a visitor.
   *
   * Holding every parsed document at once exhausts the heap — 2,200 files with
   * full trivia and source positions is orders of magnitude more than the
   * identifiers being collected from them. Each document is released as soon as
   * it has been visited.
   */
  const forEachDocument = async (
    directory: string,
    recurse: boolean,
    visit: (fileName: string, document: Document) => void,
    only?: readonly string[],
  ): Promise<void> => {
    const all: readonly string[] = await collectFiles(join(gamePath, ...directory.split("/")), recurse);
    // A type that names its files means those files. `alert` reads
    // `common/alerts.txt`, not every file under `common`.
    const files: readonly string[] =
      only === undefined ? all : all.filter((file) => only.includes(file.split(/[\\/]/u).at(-1) ?? ""));

    await mapWithLimit(files, READ_CONCURRENCY, async (file): Promise<void> => {
      const source: string = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await readFile(file));
      const result = parse(source);
      filesRead += 1;

      if (result.diagnostics.length > 0) {
        return;
      }

      visit(file.split(/[\\/]/u).at(-1) ?? "", result.document);
    });
  };

  const fieldNames: Record<string, string[]> = {};

  const types: TypeIndex[] = await mapWithLimit(model.definitionTypes, 2, async (type): Promise<TypeIndex> => {
    const ids = new Set<string>();
    const fields: Set<string> | undefined = gameDeclaredFieldTypes.includes(type.id) ? new Set<string>() : undefined;

    await forEachDocument(
      type.source.directory,
      type.source.includeSubdirectories,
      (fileName, document) => {
        for (const id of definitionIds(type, document, fileName)) {
          ids.add(id);
        }

        if (fields !== undefined) {
          definitionFieldKeys(type, document, fields);
        }
      },
      type.source.files,
    );

    if (fields !== undefined) {
      fieldNames[type.id] = [...fields].sort(compareOrdinal);
    }

    return {
      type: type.id,
      directory: type.source.directory,
      ids: [...ids].sort(compareOrdinal),
    };
  });

  const extracted: readonly EnumDefinition[] = model.enums.filter((definition) => definition.kind === "extracted-enum");

  const enums: EnumIndex[] = await mapWithLimit(extracted, 4, async (definition): Promise<EnumIndex> => {
    const members = new Set<string>();

    if (definition.kind === "extracted-enum") {
      await Promise.all(
        definition.sources.map(async (source) =>
          forEachDocument(source.directory, source.includeSubdirectories, (_fileName, document) => {
            if (source.startFromRoot) {
              captureAlong(document.entries, source.route, members);
              return;
            }

            // The route is relative to each definition, so descend one level
            // before following it. Applying it at the file root instead finds
            // nothing, which is why 26 of the 27 extracted enums came back empty.
            for (const entry of document.entries) {
              const block: Block | undefined = blockOf(entry);
              if (block !== undefined) {
                captureAlong(block.entries, source.route, members);
              }
            }
          }),
        ),
      );
    }

    return { id: definition.id, members: [...members].sort(compareOrdinal) };
  });

  const vanillaFiles: Record<string, string[]> = {};
  const directories: readonly { readonly path: string; readonly recurse: boolean }[] = [
    ...new Map(
      model.definitionTypes.map((type) => [
        type.source.directory,
        { path: type.source.directory, recurse: type.source.includeSubdirectories },
      ]),
    ).values(),
  ];

  const listings: readonly (readonly string[])[] = await mapWithLimit(directories, 8, async (directory) =>
    collectFiles(join(gamePath, ...directory.path.split("/")), directory.recurse),
  );

  for (const files of listings) {
    for (const file of files) {
      const relative: string = file.slice(gamePath.length + 1).replaceAll("\\", "/");
      const separator: number = relative.lastIndexOf("/");
      const directory: string = separator < 0 ? "" : relative.slice(0, separator);
      const name: string = relative.slice(separator + 1);
      const bucket: string[] = vanillaFiles[directory] ?? [];

      if (!bucket.includes(name)) {
        bucket.push(name);
      }
      vanillaFiles[directory] = bucket;
    }
  }

  for (const bucket of Object.values(vanillaFiles)) {
    bucket.sort(compareOrdinal);
  }

  return {
    version,
    types: types.sort((left, right) => compareOrdinal(left.type, right.type)),
    enums: enums.sort((left, right) => compareOrdinal(left.id, right.id)),
    filesRead,
    vanillaFiles,
    modifierNames: await collectModifierNames(gamePath),
    fieldNames,
  };
}

/**
 * Modifier names taken from the keys of the game's own modifier strings.
 *
 * Case is not meaningful: vanilla writes `MOD_TRADITION_COST_MULT` for the
 * modifier its documentation calls `tradition_cost_mult`, and script uses either
 * spelling. Everything is lowercased so one comparison serves both.
 */
async function collectModifierNames(gamePath: string): Promise<readonly string[]> {
  const files: readonly string[] = await collectLocalisationFiles(join(gamePath, "localisation"));
  const names = new Set<string>();

  await mapWithLimit(files, READ_CONCURRENCY, async (file): Promise<void> => {
    const text: string = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await readFile(file));

    for (const line of text.split(/\r?\n/u)) {
      const match: RegExpExecArray | null = /^\s*mod_([A-Za-z0-9_.]+):/iu.exec(line);

      if (match?.[1] !== undefined) {
        names.add(match[1].toLowerCase());
      }
    }
  });

  return [...names].sort(compareOrdinal);
}

async function collectLocalisationFiles(directory: string): Promise<string[]> {
  let entries: readonly Dirent[];

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const groups: string[][] = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const path: string = join(directory, entry.name);

      if (entry.isDirectory()) {
        return collectLocalisationFiles(path);
      }

      return entry.isFile() && entry.name.toLowerCase().endsWith(".yml") ? [path] : [];
    }),
  );

  return groups.flat();
}
