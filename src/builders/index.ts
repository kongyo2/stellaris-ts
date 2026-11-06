import { vanillaPlacement, type VanillaPlacement } from "../generated/vanilla/placement.js";
import { vanillaTaggedKeys } from "../generated/vanilla/tagged-keys.js";
import { definitionTypes } from "../schema/definitions/index.js";
import { vanillaDefinitionTypes } from "../schema/vanilla-types.js";
import type { DefinitionType } from "../schema/ir.js";
import type { DefinitionRecord } from "../runtime/mod.js";
import type { DefinitionShapes } from "../generated/types/index.js";

/**
 * Builds one definition of a given type.
 *
 * The body is the PDX script with different punctuation, so a reader who knows
 * the game knows this. The directory comes from the schema rather than the call
 * site: where a type lives is a fact about the game, not a decision.
 */

export interface DefineOptions {
  /**
   * The block key, for a type whose key is a tag rather than its identity.
   *
   * An event is written `country_event = { id = utopia.1 }` — the key says what
   * the event is scoped to and the `id` field says which event it is. 43 types
   * are written that way. When only one tag exists it is used without asking.
   */
  readonly as?: string;
  /** Put the definition in this file rather than the default one. */
  readonly file?: string;
}

const allTypes: readonly DefinitionType[] = [...definitionTypes, ...vanillaDefinitionTypes];

function typeFor(id: string): DefinitionType {
  const found: DefinitionType | undefined = allTypes.find((candidate) => candidate.id === id);

  if (found === undefined) {
    throw new Error(`Unknown definition type: ${id}`);
  }

  return found;
}

/**
 * The block key to write, and the field that carries the identity.
 *
 * Getting this wrong is silent: `utopia.1 = { ... }` in an events file parses,
 * loads, and defines nothing.
 */
function taggedPlacement(type: DefinitionType, options: DefineOptions): { key?: string; nameField?: string } {
  if (type.source.kind !== "tagged-blocks") {
    if (options.as !== undefined) {
      throw new Error(`${type.id} is written under its own identifier, so "as" would have nothing to name.`);
    }
    return {};
  }

  const tags: readonly string[] = vanillaTaggedKeys[type.id] ?? type.source.tags;

  if (options.as !== undefined) {
    if (tags.length > 0 && !tags.includes(options.as)) {
      throw new Error(`${type.id} is not written under ${options.as}. The game writes it under: ${tags.join(", ")}.`);
    }
    return { key: options.as, nameField: type.source.nameField };
  }

  const only: string | undefined = tags.length === 1 ? tags[0] : undefined;

  if (only === undefined) {
    throw new Error(
      `${type.id} is written under a tag rather than its identifier; pass one as \`as\`. The game writes it under: ${tags.join(", ")}.`,
    );
  }

  return { key: only, nameField: type.source.nameField };
}

/**
 * The lines a file needs before any definition.
 *
 * An events file declares the namespace its ids belong to, and every one of
 * vanilla's 9,995 event ids is `namespace.number`. Without the declaration the
 * game has nothing to resolve `country_event = { id = utopia.1 }` against.
 */
function headersFor(type: DefinitionType, id: string): readonly string[] {
  if (type.source.directory !== "events") {
    return [];
  }

  const namespace: string | undefined = id.split(".")[0];

  return namespace === undefined || namespace === id ? [] : [`namespace = ${namespace}`];
}

/**
 * The types the game reads from one file that it opens by name.
 *
 * Read out of the 4.5.2 executable, which passes these paths to its file reader
 * directly — `flags/colors.txt` as `%s/colors.txt` with `flags` — rather than
 * listing a directory. Every other file in `common` or `flags` is never opened
 * for them, so a definition written there is not read at all.
 */
const ONLY_FILES: Readonly<Record<string, string>> = {
  achievement: "common/achievements.txt",
  alert: "common/alerts.txt",
  alert_icon: "common/alerts.txt",
  color_define: "flags/colors.txt",
  randomizable_combo: "flags/colors.txt",
};

/**
 * The block a definition of this type is written inside, if any.
 *
 * The schema names the container where it is one block for every definition.
 * Where it names none in particular, what vanilla writes decides: twelve of the
 * thirteen bitmap fonts are in `bitmapfonts`. A type with no such block is one
 * vanilla only ever writes inside another definition — every `swap_type` is in
 * the civic it swaps — and has no file of its own to be written to.
 */
function containerFor(type: DefinitionType, placement: VanillaPlacement | undefined): string | undefined {
  const container = type.source.container;

  if (container === undefined) {
    return undefined;
  }

  if (container.kind === "named-container") {
    return container.key;
  }

  if (placement?.container !== undefined) {
    return placement.container;
  }

  const key: string = type.source.rootKeyFilter?.values[0] ?? type.id;
  throw new Error(
    `${type.id} is a ${key} block inside another definition, and the game reads it nowhere else: vanilla writes each one in the definition it belongs to. Write it as ${key} in that definition's body.`,
  );
}

/** Which variant a block key selects, when the type has one per key. */
function variantFor(type: DefinitionType, key: string | undefined): string | undefined {
  if (key === undefined) {
    return undefined;
  }

  return type.variants.find(
    (variant) => variant.when.kind === "root-key" && variant.when.values.some((value) => value === key),
  )?.id;
}

export function define<Type extends keyof DefinitionShapes>(
  type: Type,
  id: string,
  body: DefinitionShapes[Type],
  options: DefineOptions = {},
): DefinitionRecord {
  const schemaType: DefinitionType = typeFor(type);
  const placement = taggedPlacement(schemaType, options);
  const headers: readonly string[] = headersFor(schemaType, id);
  const variant: string | undefined = variantFor(schemaType, placement.key);
  const bareValue: boolean = schemaType.source.kind === "bare-values";
  const wholeFile: boolean = schemaType.source.kind === "file-definitions";
  const where: VanillaPlacement | undefined = vanillaPlacement[schemaType.id];
  const container: string | undefined = containerFor(schemaType, where);
  const extension: string | undefined = where?.extension === ".txt" ? undefined : where?.extension;
  const onlyFile: string | undefined = ONLY_FILES[schemaType.id];

  // A job tag is the word and nothing else. A body would have to be written as
  // a block, and a block turns the word into a key the game does not read.
  if (bareValue && Object.keys(body).length > 0) {
    throw new Error(`${type} is written as the identifier alone, so a body would not be read. Pass {}.`);
  }

  return {
    type,
    directory: schemaType.source.directory,
    id,
    body,
    ...(bareValue ? { bareValue } : {}),
    ...(wholeFile ? { wholeFile } : {}),
    ...(placement.key === undefined ? {} : { blockKey: placement.key }),
    ...(placement.nameField === undefined ? {} : { nameField: placement.nameField }),
    ...(container === undefined ? {} : { container }),
    ...(extension === undefined ? {} : { extension }),
    ...(onlyFile === undefined ? {} : { onlyFile }),
    ...(variant === undefined ? {} : { variant }),
    ...(headers.length === 0 ? {} : { headers }),
    ...(options.file === undefined ? {} : { file: options.file }),
  };
}

/** Same as {@link define}, but places the definition in a named file. */
export function defineIn<Type extends keyof DefinitionShapes>(
  type: Type,
  file: string,
  id: string,
  body: DefinitionShapes[Type],
  options: Omit<DefineOptions, "file"> = {},
): DefinitionRecord {
  return define(type, id, body, { ...options, file });
}
