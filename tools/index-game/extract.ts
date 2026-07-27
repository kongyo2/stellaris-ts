import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { NodeKind, parse, type Block, type Document, type EntryNode } from "../../src/syntax/index.js";
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
 * bodies stay where they are — see PLAN.md R1.
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

/** Ids a definition type claims from one file, mirroring how the game loads them. */
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

  const ids: string[] = [];

  for (const entry of document.entries) {
    const key: string | undefined = keyOf(entry);
    const block: Block | undefined = blockOf(entry);

    if (key === undefined || block === undefined || !accepted(key)) {
      continue;
    }

    const container = type.source.container;
    const inner: readonly EntryNode[] =
      container !== undefined && (container.kind === "any-container" || container.key === key) ? block.entries : [];

    if (inner.length > 0 || container !== undefined) {
      for (const nested of inner) {
        const nestedKey: string | undefined = keyOf(nested);
        if (nestedKey !== undefined && blockOf(nested) !== undefined) {
          ids.push(nestedKey);
        }
      }
      continue;
    }

    if (type.source.kind === "tagged-blocks") {
      for (const nested of block.entries) {
        if (
          keyOf(nested) === type.source.nameField &&
          nested.kind === NodeKind.Assignment &&
          nested.value.kind === NodeKind.Scalar
        ) {
          ids.push(String(nested.value.value));
        }
      }
      continue;
    }

    ids.push(key);
  }

  // A quoted key keeps its quotes in the raw value; the identifier is the text
  // inside them, which is what every reference elsewhere in script writes.
  return ids.map((id) => id.replace(/^"|"$/gu, "")).filter((id) => id.length > 0);
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
  ): Promise<void> => {
    const files: readonly string[] = await collectFiles(join(gamePath, ...directory.split("/")), recurse);

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

  const types: TypeIndex[] = await mapWithLimit(model.definitionTypes, 2, async (type): Promise<TypeIndex> => {
    const ids = new Set<string>();

    await forEachDocument(type.source.directory, type.source.includeSubdirectories, (fileName, document) => {
      for (const id of definitionIds(type, document, fileName)) {
        ids.add(id);
      }
    });

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

  return {
    version,
    types: types.sort((left, right) => compareOrdinal(left.type, right.type)),
    enums: enums.sort((left, right) => compareOrdinal(left.id, right.id)),
    filesRead,
  };
}
