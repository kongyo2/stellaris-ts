import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { NodeKind, parse, type Block, type Document, type EntryNode } from "../../src/syntax/index.js";
import { captureFromDocument } from "../../src/schema/extraction.js";
import { gameDeclaredFieldTypes } from "../../src/schema/open-fields.js";
import type { DefinitionType, EnumDefinition, SchemaModel } from "../../src/schema/ir.js";

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

/**
 * Directories the game reads files from that are not script.
 *
 * A mod's `.dds` at a vanilla path replaces the vanilla one — that is how a
 * retexture works — and the filename collision check cannot say so without
 * these names. They are not reachable from the definition types, whose
 * directories are where script lives, so the collision check was structurally
 * unable to fire for the formats an asset is actually in.
 */
const ASSET_DIRECTORIES: readonly string[] = ["flags", "fonts", "gfx", "interface", "music", "sound"];
const READ_CONCURRENCY = 32;

export interface TypeIndex {
  readonly type: string;
  readonly directory: string;
  readonly ids: readonly string[];
  /** For a tagged type, the block keys vanilla writes its definitions under. */
  readonly tags: readonly string[];
}

/** The scripted trigger and effect types whose calls take parameters. */
const CALLABLE_TYPES: readonly string[] = ["scripted_trigger", "scripted_effect"];

export interface EnumIndex {
  readonly id: string;
  readonly members: readonly string[];
}

export interface GameIndex {
  readonly version: string;
  /** What the launcher compares a mod's `supported_version` against. */
  readonly modsCompatibilityVersion: string;
  /** The languages the game ships, from its own `localisation/languages.yml`. */
  readonly languages: readonly string[];
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
  /**
   * The `$NAME$` substitutions each scripted trigger or effect declares, keyed
   * `<type>:<id>`.
   *
   * A call passes them by name — `no_resource_for_component = { RESOURCE = x }`
   * — and a name the callee never mentions is substituted nowhere, so the call
   * silently does something other than what was written. The set is knowable
   * only from the callee's body, which is why it is indexed rather than listed.
   */
  readonly scriptedParameters: Readonly<Record<string, readonly string[]>>;
}

/**
 * Every `$NAME$` a block mentions, at any depth.
 *
 * The marker appears in three places and all three count: as a whole key or
 * value, inside a longer name (`remove_$SCOPE$_flag`), and with a default
 * (`$AMOUNT|1$`). Only the name before the bar is the parameter.
 */
const PARAMETER_PATTERN = /\$([A-Za-z_][A-Za-z0-9_]*)(?:\|[^$]*)?\$/gu;

function collectParametersFrom(text: string, into: Set<string>): void {
  for (const match of text.matchAll(PARAMETER_PATTERN)) {
    const name: string | undefined = match[1];
    if (name !== undefined) {
      into.add(name);
    }
  }
}

function collectParameters(entries: readonly EntryNode[], into: Set<string>): void {
  for (const entry of entries) {
    switch (entry.kind) {
      case NodeKind.Assignment:
        collectParametersFrom(entry.key.raw, into);

        if (entry.value.kind === NodeKind.Scalar) {
          collectParametersFrom(entry.value.raw, into);
        } else if (entry.value.kind === NodeKind.Block) {
          collectParameters(entry.value.entries, into);
        } else if (entry.value.kind === NodeKind.PrefixedBlock) {
          collectParametersFrom(entry.value.prefix.raw, into);
          collectParameters(entry.value.block.entries, into);
        } else if (entry.value.kind === NodeKind.InlineMath) {
          for (const token of entry.value.tokens) {
            collectParametersFrom(token.text, into);
          }
        }
        continue;
      case NodeKind.Scalar:
        collectParametersFrom(entry.raw, into);
        continue;
      case NodeKind.Block:
        collectParameters(entry.entries, into);
        continue;
      case NodeKind.OptionalBlock:
        // `[[POP_GROUP] ... ]` includes its body only when that parameter was
        // passed. The header names the parameter and the body uses it; both are
        // part of what the callee takes, and missing the header is what left 93
        // calls looking like they passed an unknown name.
        for (const token of entry.header) {
          collectParametersFrom(`$${token.text.replace(/^!/u, "")}$`, into);
        }
        collectParameters(entry.entries, into);
        continue;
      case NodeKind.PrefixedBlock:
        collectParametersFrom(entry.prefix.raw, into);
        collectParameters(entry.block.entries, into);
        continue;
      case NodeKind.InlineMath:
        for (const token of entry.tokens) {
          collectParametersFrom(token.text, into);
        }
        continue;
      default:
        continue;
    }
  }
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

async function collectFiles(
  directory: string,
  recurse: boolean,
  // `null` rather than `undefined`: passing `undefined` to a parameter with a
  // default is the default, so the asset pass silently filtered to script.
  extensions: ReadonlySet<string> | null = SCRIPT_EXTENSIONS,
): Promise<string[]> {
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
        return recurse ? collectFiles(path, recurse, extensions) : [];
      }

      if (!entry.isFile()) {
        return [];
      }

      if (extensions === null) {
        return [path];
      }

      const dot: number = entry.name.lastIndexOf(".");
      const extension: string = dot < 0 ? "" : entry.name.slice(dot).toLowerCase();
      return extensions.has(extension) ? [path] : [];
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
/**
 * The block keys a tagged type is written under.
 *
 * `taggedBlocks` means the block key is a tag and the identity is a field
 * inside: an event is `country_event = { id = utopia.1 }`, never
 * `utopia.1 = { ... }`. cwt leaves the tag list empty, so the tags are read off
 * the game — without them a mod cannot write one of these 44 types at all.
 */
function definitionTags(type: DefinitionType, document: Document, into: Set<string>): void {
  if (type.source.kind !== "tagged-blocks") {
    return;
  }

  const filter = type.source.rootKeyFilter;
  const accepted = (key: string): boolean =>
    filter === undefined
      ? true
      : filter.mode === "include"
        ? filter.values.includes(key)
        : !filter.values.includes(key);

  const nameField: string = type.source.nameField;
  const container = type.source.container;

  const claim = (key: string, body: Block): void => {
    // Only a block that carries the name field is a definition of this type;
    // the settings blocks beside them are not.
    if (body.entries.some((field) => keyOf(field) === nameField)) {
      into.add(key.replace(/^"|"$/gu, ""));
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
}

function definitionIds(type: DefinitionType, document: Document, fileName: string): string[] {
  if (type.source.kind === "file-definitions") {
    return [type.source.stripExtension ? fileName.replace(/\.[^.]+$/u, "") : fileName];
  }

  // A tag file has no blocks: every root-level value is one definition, and
  // reading only assignments finds nothing at all.
  if (type.source.kind === "bare-values") {
    return document.entries
      .filter((entry) => entry.kind === NodeKind.Scalar)
      .map((entry) => String(entry.value).replace(/^"|"$/gu, ""))
      .filter((id) => id.length > 0);
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
    const tags = new Set<string>();
    const fields: Set<string> | undefined = gameDeclaredFieldTypes.includes(type.id) ? new Set<string>() : undefined;

    await forEachDocument(
      type.source.directory,
      type.source.includeSubdirectories,
      (fileName, document) => {
        for (const id of definitionIds(type, document, fileName)) {
          ids.add(id);
        }

        definitionTags(type, document, tags);

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
      tags: [...tags].sort(compareOrdinal),
    };
  });

  const extracted: readonly EnumDefinition[] = model.enums.filter((definition) => definition.kind === "extracted-enum");

  const enums: EnumIndex[] = await mapWithLimit(extracted, 4, async (definition): Promise<EnumIndex> => {
    const members = new Set<string>();

    if (definition.kind === "extracted-enum") {
      await Promise.all(
        definition.sources.map(async (source) =>
          forEachDocument(source.directory, source.includeSubdirectories, (_fileName, document) => {
            captureFromDocument(document.entries, source.route, source.startFromRoot, members);
          }),
        ),
      );
    }

    return { id: definition.id, members: [...members].sort(compareOrdinal) };
  });

  const scriptedParameters: Record<string, readonly string[]> = {};

  await Promise.all(
    CALLABLE_TYPES.map(async (typeId): Promise<void> => {
      const type: DefinitionType | undefined = model.definitionTypes.find((candidate) => candidate.id === typeId);

      if (type === undefined) {
        return;
      }

      await forEachDocument(
        type.source.directory,
        type.source.includeSubdirectories,
        (_fileName, document) => {
          for (const entry of document.entries) {
            const body: Block | undefined = blockOf(entry);
            const id: string | undefined = keyOf(entry);

            if (body === undefined || id === undefined || id.startsWith("@")) {
              continue;
            }

            const names = new Set<string>();
            collectParameters(body.entries, names);
            scriptedParameters[`${typeId}:${id}`] = [...names].sort(compareOrdinal);
          }
        },
        type.source.files,
      );
    }),
  );

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

  // Every file, not only the script ones: an icon a mod ships at a vanilla path
  // replaces the vanilla icon, and nothing else would say so.
  const assetListings: readonly (readonly string[])[] = await mapWithLimit(ASSET_DIRECTORIES, 4, async (directory) =>
    collectFiles(join(gamePath, ...directory.split("/")), true, null),
  );

  for (const files of [...listings, ...assetListings]) {
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
    modsCompatibilityVersion: await compatibilityVersion(gamePath),
    languages: await collectLanguages(gamePath),
    types: types.sort((left, right) => compareOrdinal(left.type, right.type)),
    enums: enums.sort((left, right) => compareOrdinal(left.id, right.id)),
    filesRead,
    vanillaFiles,
    modifierNames: await collectModifierNames(gamePath),
    fieldNames,
    scriptedParameters,
  };
}

/**
 * Modifier names taken from the keys of the game's own modifier strings.
 *
 * Case is not meaningful: vanilla writes `MOD_TRADITION_COST_MULT` for the
 * modifier its documentation calls `tradition_cost_mult`, and script uses either
 * spelling. Everything is lowercased so one comparison serves both.
 */
/** The launcher's own idea of which game version a mod must declare support for. */
async function compatibilityVersion(gamePath: string): Promise<string> {
  try {
    const raw: string = await readFile(join(gamePath, "launcher-settings.json"), "utf8");
    return /"modsCompatibilityVersion"\s*:\s*"([^"]+)"/u.exec(raw)?.[1] ?? "";
  } catch {
    return "";
  }
}

/**
 * The languages the game ships.
 *
 * A localisation file named for anything else is not read, and nothing says so:
 * the strings simply never appear. The list is the game's own, taken from the
 * file it keeps them in rather than written out here, so a language added by a
 * patch arrives with the next index.
 */
async function collectLanguages(gamePath: string): Promise<readonly string[]> {
  try {
    const text: string = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      await readFile(join(gamePath, "localisation", "languages.yml")),
    );
    const names = new Set<string>();

    for (const line of text.split(/\r?\n/u)) {
      const match: RegExpExecArray | null = /^(l_[a-z_]+):\s*$/u.exec(line.replace(/^\uFEFF/u, ""));
      if (match?.[1] !== undefined) {
        names.add(match[1]);
      }
    }

    return [...names].sort(compareOrdinal);
  } catch {
    return [];
  }
}

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
