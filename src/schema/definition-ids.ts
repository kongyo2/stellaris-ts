import { NodeKind, type Block, type Document, type EntryNode } from "../syntax/index.js";
import type { DefinitionType } from "./ir.js";

/** One definition a type claims from a file, and the block it was found inside. */
export interface DefinitionClaim {
  readonly id: string;
  /** The root-level key of the block holding it, for a type read from inside one. */
  readonly container?: string;
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
 *
 * The index reads the game's files with this, and `validate` reads a mod's
 * raw files with it, so a sprite a mod ships in its own `.gfx` file is one it
 * defines.
 */
export function definitionIds(type: DefinitionType, document: Document, fileName: string): readonly DefinitionClaim[] {
  if (type.source.kind === "file-definitions") {
    return [{ id: type.source.stripExtension ? fileName.replace(/\.[^.]+$/u, "") : fileName }];
  }

  // A tag file has no blocks: every root-level value is one definition, and
  // reading only assignments finds nothing at all.
  if (type.source.kind === "bare-values") {
    return document.entries
      .filter((entry) => entry.kind === NodeKind.Scalar)
      .map((entry) => String(entry.value).replace(/^"|"$/gu, ""))
      .filter((id) => id.length > 0)
      .map((id) => ({ id }));
  }

  // Keys are read without regard to case: 102 of the base game's progress
  // bars are written `progressbarType`, and each of them is one.
  const filter = type.source.rootKeyFilter;
  const named: readonly string[] = (filter?.values ?? []).map((value) => value.toLowerCase());
  const accepted = (key: string): boolean =>
    filter === undefined
      ? true
      : filter.mode === "include"
        ? named.includes(key.toLowerCase())
        : !named.includes(key.toLowerCase());

  const container = type.source.container;
  const nameField: string | undefined = type.source.kind === "tagged-blocks" ? type.source.nameField : undefined;
  const claims: DefinitionClaim[] = [];

  /** Reads one definition block: its key, or the field the type names. */
  const claim = (key: string, body: Block, holder: string | undefined): void => {
    const found = (id: string): void => {
      claims.push(holder === undefined ? { id } : { id, container: holder });
    };

    if (nameField === undefined) {
      found(key);
      return;
    }

    // The game reads a key without regard to case: 4.5.2 writes `KEY` 45
    // times in `common/special_projects`, and each of those is a project's.
    const wanted: string = nameField.toLowerCase();
    for (const field of body.entries) {
      if (
        keyOf(field)?.toLowerCase() === wanted &&
        field.kind === NodeKind.Assignment &&
        field.value.kind === NodeKind.Scalar
      ) {
        found(String(field.value.value));
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
      if (container.kind !== "any-container" && container.key.toLowerCase() !== key.toLowerCase()) {
        continue;
      }
      for (const nested of block.entries) {
        const nestedKey: string | undefined = keyOf(nested);
        const nestedBlock: Block | undefined = blockOf(nested);
        if (nestedKey !== undefined && nestedBlock !== undefined && accepted(nestedKey)) {
          claim(nestedKey, nestedBlock, key);
          continue;
        }
        // `spriteType { name = … }`, with no `=`: the game reads a block that
        // follows a word as that word's, and `interface/dlc_icons.gfx` defines
        // `GFX_checkmark_icon` that way.
        if (nested.kind === NodeKind.PrefixedBlock && accepted(String(nested.prefix.value))) {
          claim(String(nested.prefix.value), nested.block, key);
        }
      }
      continue;
    }

    if (accepted(key)) {
      claim(key, block, undefined);
    }
  }

  // A quoted key keeps its quotes in the raw value; the identifier is the text
  // inside them, which is what every reference elsewhere in script writes.
  return claims
    .map((found) => ({ ...found, id: found.id.replace(/^"|"$/gu, "") }))
    .filter((found) => found.id.length > 0);
}
