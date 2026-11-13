import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, relative } from "node:path";

import {
  extractedEnumMembers,
  vanillaIdsByType,
  vanillaModifierNames,
  vanillaScriptedParameters,
} from "../../src/generated/vanilla/index.js";
import { vanillaLocalisationKeys } from "../../src/generated/vanilla/localisation-keys.js";
import { localisationKey } from "../../src/schema/ir.js";
import {
  engineCommandNames,
  loadBlockOfEntries,
  loadCheckedTypes,
  loadChecks,
  type LoadCheckContext,
} from "../../src/schema/load-checks.js";
import {
  localisationKeyIn,
  namedStrings,
  requirementApplies,
  variantHolds,
  type FieldOccurrence,
  type VariantSubject,
} from "../../src/schema/localisation-references.js";
import { expandModifierNames } from "../../src/schema/modifier-namespace.js";
import { NO_SCOPE, namesScope, scopelessEvents, scopelessOnActions } from "../../src/schema/scopeless-on-actions.js";
import { branchChain, isBranchBody, type BranchChain } from "../../src/schema/script-order.js";
import {
  applyScope,
  comparesIn,
  frameOf,
  requiredKeys,
  SchemaResolver,
  valuesFor,
  type BlockRules,
  type ResolvedValue,
  type ScopeState,
  type ScriptFamily,
} from "../../src/schema/resolve.js";
import {
  NodeKind,
  parse,
  type Block,
  type Document,
  type EntryNode,
  type Scalar,
  type ValueNode,
} from "../../src/syntax/index.js";
import type { DefinitionType, EntryRule, SchemaModel, ScriptCommandDefinition } from "../../src/schema/ir.js";

/**
 * Checks the schema against the installed game rather than against cwt.
 *
 * cwtools-stellaris-config is a porting source, not an oracle. Vanilla is the
 * files the game actually loads. This reports both directions of disagreement —
 *
 *   A. the schema rejects a key vanilla really writes  → a hole in the schema
 *   B. the schema requires a field vanilla never uses  → a phantom rule
 *
 * Direction A is checked **at every depth**. Checking only the top level of a
 * definition asks almost nothing: a body is a handful of keys and the script
 * inside it is thousands, and a mistake inside `allow = { ... }` is the mistake
 * a mod author actually makes. Direction B stays at the top level, where "the
 * schema declares a field" has a clear meaning.
 *
 * A type whose top-level rules accept arbitrary keys cannot produce direction A
 * there, so its verdict is reported as `permissive` rather than silently passing.
 */

/**
 * Definition directories are not all script directories — `flags/` holds `.dds`
 * images, `sound/` holds audio. Allow only what the game parses as script; a
 * denylist would silently start reading binaries the day a type points at one.
 * The empty string covers `common/inline_scripts`, whose files carry no
 * extension because the game references them by bare path.
 */
const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set(["", ".txt", ".gui", ".gfx", ".asset", ".sound"]);

/** Vanilla has thousands of script files; opening them all at once exhausts the fd table. */
const READ_CONCURRENCY = 32;

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

      // Sequential by design: this loop is one of a fixed number of workers, and
      // awaiting here is what bounds concurrency. Parallelising it would restore
      // the unbounded fan-out that exhausts the file-descriptor table.
      // oxlint-disable-next-line no-await-in-loop
      results[index] = await handler(item);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * The kind of block a key was found in.
 *
 * A key in a trigger block that no rule knows is an engine trigger the corpus
 * never declared; a key in an ordinary block is a missing field. They are closed
 * by different means, so the walk records which it was rather than leaving the
 * proposer to guess from the name.
 */
export type FindingContext = "block" | "effect" | "modifier" | "modifier-rule" | "trigger";

/** The narrowest shape covering every value seen under a key. */
export type ValueShape = "block" | "boolean" | "integer" | "list" | "number" | "scalar";

export interface FieldFinding {
  readonly type: string;
  /** Where inside the definition, dotted. Empty at the top level. */
  readonly path: string;
  readonly field: string;
  readonly context: FindingContext;
  readonly shape: ValueShape;
  readonly occurrences: number;
  readonly examples: readonly string[];
}

function shapeOf(value: ValueNode): ValueShape {
  if (value.kind === NodeKind.Block) {
    return value.entries.every((entry) => entry.kind === NodeKind.Scalar) && value.entries.length > 0
      ? "list"
      : "block";
  }

  // Inline maths, a prefixed block, an optional block: all shapes a narrower
  // rule would reject, so they widen to whatever holds text.
  if (value.kind !== NodeKind.Scalar) {
    return "scalar";
  }

  const text: string = String(value.value);

  if (text === "yes" || text === "no") {
    return "boolean";
  }
  if (/^-?\d+$/u.test(text)) {
    return "integer";
  }
  if (/^-?\d*\.\d+$/u.test(text)) {
    return "number";
  }
  return "scalar";
}

/** The one shape that covers both, widening only as far as it has to. */
export function widenShape(left: ValueShape, right: ValueShape): ValueShape {
  if (left === right) {
    return left;
  }
  if ((left === "integer" && right === "number") || (left === "number" && right === "integer")) {
    return "number";
  }
  if (left === "block" || right === "block" || left === "list" || right === "list") {
    return "block";
  }
  return "scalar";
}

/** Which family a block belongs to, when it belongs to one. */
const CONTEXT_PRIORITY: readonly ScriptFamily[] = ["trigger", "effect", "modifier", "modifier-rule"];

function contextOf(rules: BlockRules): FindingContext {
  for (const family of CONTEXT_PRIORITY) {
    if (rules.families.has(family)) {
      return family;
    }
  }
  return "block";
}

export interface ValueFinding {
  readonly path: string;
  readonly field: string;
  /** What the rules said the value had to be. */
  readonly expected: string;
  readonly example: string;
  readonly occurrences: number;
  readonly examples: readonly string[];
}

export interface ScopeFinding {
  readonly command: string;
  /** Where inside the definition, dotted. */
  readonly path: string;
  readonly writtenIn: string;
  readonly accepts: readonly string[];
  readonly occurrences: number;
  readonly examples: readonly string[];
}

export interface RequiredFinding {
  readonly field: string;
  /** How many of this type's definitions leave it out. */
  readonly missingFrom: number;
  readonly examples: readonly string[];
}

/**
 * A block vanilla writes where the rules take none.
 *
 * Under a key every rule reads as one value, the game takes the `{` itself as
 * that value and the block's contents as keys of the block around it; as a bare
 * block in a list, it is an entry no item rule describes. Either way vanilla
 * loading it means the schema is the one that is wrong.
 */
export interface ShapeFinding {
  readonly path: string;
  readonly field: string;
  readonly shape: "block-for-value" | "block-in-list";
  readonly occurrences: number;
  readonly examples: readonly string[];
}

/** A comparison vanilla writes outside a trigger, under a key no rule declares as comparing. */
/**
 * An `else` or an `else_if` vanilla writes with no `if` read just before it.
 *
 * The game logs each one and vanilla loads without the line, so one found
 * here is the check reading a block otherwise than the game does.
 */
export interface BranchFinding {
  readonly path: string;
  readonly field: string;
  readonly occurrences: number;
  readonly examples: readonly string[];
}

export interface ComparisonFinding {
  readonly path: string;
  readonly field: string;
  readonly operator: string;
  readonly occurrences: number;
  readonly examples: readonly string[];
}

/**
 * A string vanilla names that no localisation file of the game defines.
 *
 * The game shows such a key as itself. A rule that reads a value as a string's
 * name is only right if vanilla's own values are names of strings, so every
 * one of them that resolves to nothing is either a mistake in vanilla or a rule
 * that should not be read that way.
 */
export interface LocalisationFinding {
  readonly path: string;
  readonly field: string;
  readonly key: string;
  readonly occurrences: number;
  readonly examples: readonly string[];
}

/** A string a requirement asks every definition for, which vanilla's definitions lack. */
export interface MissingStringFinding {
  readonly pattern: string;
  readonly variant?: string;
  /** How many of the definitions it applies to lack it, of how many. */
  readonly missingFrom: number;
  readonly appliesTo: number;
  readonly keys: readonly string[];
  /** The definitions that lack it. */
  readonly ids: readonly string[];
}

/**
 * Something the game's loader would log about a vanilla definition.
 *
 * The game loads vanilla without one of these lines in `error.log`, so each is
 * a check of {@link loadChecks} that is wrong.
 */
export interface LoadCheckFinding {
  readonly id: string;
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly file: string;
}

export interface TypeReport {
  readonly type: string;
  readonly directory: string;
  readonly sourceKind: string;
  readonly strictness: "permissive" | "strict";
  readonly definitionsSeen: number;
  readonly filesSeen: number;
  readonly keysChecked: number;
  readonly unknownFields: readonly FieldFinding[];
  readonly unusedRules: readonly string[];
  readonly missingRequired: readonly RequiredFinding[];
  readonly scopeViolations: readonly ScopeFinding[];
  readonly valueMismatches: readonly ValueFinding[];
  readonly shapeMismatches: readonly ShapeFinding[];
  readonly comparisonMismatches: readonly ComparisonFinding[];
  readonly branchMismatches: readonly BranchFinding[];
  readonly unresolvedStrings: readonly LocalisationFinding[];
  readonly missingStrings: readonly MissingStringFinding[];
  /** Definitions the game's own load checks were run over. */
  readonly loadChecked: number;
  readonly loadFindings: readonly LoadCheckFinding[];
}

/**
 * Told about every command vanilla writes while the scope is still the one the
 * definition body started in.
 *
 * That is what makes a type's entry scope inferable: the corpus states it for 16
 * of 235 types, and the game documents which scopes each command reads, so the
 * commands written straight into a body pin down what that body is.
 */
export type CommandObserver = (type: string, command: ScriptCommandDefinition, atEntryScope: boolean) => void;

export interface ConformanceOptions {
  readonly observeCommands?: CommandObserver;
}

export interface ConformanceReport {
  readonly types: readonly TypeReport[];
  readonly missingDirectories: readonly string[];
  readonly unknownFieldTotal: number;
  readonly topLevelUnknownTotal: number;
  readonly keysChecked: number;
  readonly unusedRuleTotal: number;
  readonly strictTypeCount: number;
  readonly missingRequiredTotal: number;
  readonly scopeViolationTotal: number;
  readonly valueMismatchTotal: number;
  readonly shapeMismatchTotal: number;
  readonly comparisonMismatchTotal: number;
  readonly branchMismatchTotal: number;
  /** How many `else` and `else_if` were matched to an `if`. */
  readonly branchesChecked: number;
  /** How many values and keys were read as a string's name and looked up. */
  readonly stringsChecked: number;
  /** How many generic events vanilla fires with no scope, and how many of them were walked as such. */
  readonly scopelessEvents: number;
  readonly scopelessEventsWalked: number;
  /** How many scripted effect and trigger calls were read again in a caller's empty scope. */
  readonly callsFollowed: number;
}

/**
 * Whether a scalar could be something other than the literal it looks like.
 *
 * `@cost` is a script variable, `value:x` a script value, `$PARAM$` a
 * substitution and `[...]` inline maths. All four stand for something the file
 * does not say, so nothing here can check what they resolve to.
 */
function isIndirect(text: string): boolean {
  return text.startsWith("@") || text.includes("$") || text.includes(":") || text.includes("[");
}

/**
 * What a value must be, when every rule for the key agrees.
 *
 * One rule that accepts anything is enough to make the value unconstrained: a
 * key is often `integer | scalar`, and reporting the scalar would be wrong.
 */
function expectedValue(
  values: readonly ResolvedValue[],
  enumMembers: (id: string) => readonly string[],
): { readonly label: string; readonly accepts: (text: string) => boolean } | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const kinds = new Set(values.map((value) => value.kind));

  if (kinds.size !== 1) {
    return undefined;
  }

  const first: ResolvedValue | undefined = values[0];

  if (first === undefined) {
    return undefined;
  }

  if (first.kind === "primitive" && (first.type === "boolean" || first.type === "integer" || first.type === "number")) {
    const type = first.type;

    if (!values.every((value) => value.kind === "primitive" && value.type === type)) {
      return undefined;
    }

    if (type === "boolean") {
      // `yes`/`no` is what script is written in and what this library emits, but
      // the engine reads `true`/`false` too: vanilla writes them 162,416 times,
      // mostly in the `.asset` and `.gui` files.
      return {
        label: "boolean",
        accepts: (text) => text === "yes" || text === "no" || text === "true" || text === "false",
      };
    }

    if (type === "integer") {
      return { label: "integer", accepts: (text) => /^-?\d+$/u.test(text) };
    }

    return { label: "number", accepts: (text) => /^-?\d*\.?\d+$/u.test(text) };
  }

  if (first.kind === "enum") {
    const ids: readonly string[] = values.flatMap((value) => (value.kind === "enum" ? [value.enum] : []));
    const allowed = new Set(ids.flatMap((id) => enumMembers(id)).map((member) => member.toLowerCase()));

    if (allowed.size === 0) {
      return undefined;
    }

    return { label: ids.join(" or "), accepts: (text) => allowed.has(text.toLowerCase()) };
  }

  return undefined;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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

/**
 * The scope each of a type's variants runs in, by the key that selects it.
 *
 * A type with one entry scope states it once; `event` has nineteen, one per kind
 * of event, and the block key is what says which. Without this the whole of
 * `events/` — a third of the corpus — is read with no scope at all.
 */
function variantScopes(type: DefinitionType): ReadonlyMap<string, string> {
  const scopes = new Map<string, string>();

  for (const variant of type.variants) {
    if (variant.when.kind !== "root-key" || typeof variant.entryScope !== "string") {
      continue;
    }

    for (const key of variant.when.values) {
      scopes.set(key.toLowerCase(), variant.entryScope);
    }
  }

  return scopes;
}

/** The blocks a definition type claims from one parsed file, and the key each was under. */
function definitionBlocks(
  model: SchemaModel,
  type: DefinitionType,
  document: Document,
): { block: Block; key: string }[] {
  const blocks: { block: Block; key: string }[] = [];
  const filter = type.source.rootKeyFilter;
  // `inline_script = { script = x PARAM = y }` at the root injects script; it is
  // not a definition, and counting its parameters as fields of the surrounding
  // type reports holes that do not exist.
  const macroKeys: ReadonlySet<string> = new Set(model.policy.macros.map((macro) => macro.key));

  const accept = (key: string): boolean => {
    if (filter === undefined) {
      return true;
    }
    return filter.mode === "include" ? filter.values.includes(key) : !filter.values.includes(key);
  };

  if (type.source.kind === "file-definitions") {
    const synthetic: Block = { kind: NodeKind.Block, entries: document.entries, closed: true, span: document.span };
    blocks.push({ block: synthetic, key: "" });
    return blocks;
  }

  // A bare-value definition is a word and nothing else, so it has no block and
  // no fields for the gate to have an opinion about.
  if (type.source.kind === "bare-values") {
    return blocks;
  }

  for (const entry of document.entries) {
    if (entry.kind !== NodeKind.Assignment || entry.value.kind !== NodeKind.Block) {
      continue;
    }

    const key: string = String(entry.key.value);
    const container = type.source.container;

    if (container !== undefined) {
      // A type that names a container has its definitions inside it and nowhere
      // else. Falling through to the root when the key is a different one reads
      // whatever else the file holds as definitions — 517 of the findings for
      // `portrait_group` were the settings blocks sitting beside
      // `portrait_groups` in the same file.
      if (container.kind === "any-container" || key === container.key) {
        for (const nested of entry.value.entries) {
          if (nested.kind === NodeKind.Assignment && nested.value.kind === NodeKind.Block) {
            const nestedKey: string = String(nested.key.value);
            if (accept(nestedKey) && !macroKeys.has(nestedKey)) {
              blocks.push({ block: nested.value, key: nestedKey });
            }
          }
        }
      }
      continue;
    }

    if (accept(key) && !macroKeys.has(key)) {
      blocks.push({ block: entry.value, key });
    }
  }

  return blocks;
}

function literalRuleKeys(type: DefinitionType): readonly string[] {
  const keys = new Set<string>();

  const visit = (entries: readonly EntryRule[]): void => {
    for (const entry of entries) {
      if (entry.kind === "field" && typeof entry.key === "string") {
        keys.add(entry.key);
      } else if (entry.kind === "variant-rules") {
        visit(entry.entries);
      }
    }
  };

  visit(type.entries);
  return [...keys].sort(compareOrdinal);
}

function enumMembersOf(model: SchemaModel, id: string): readonly string[] {
  const definition = model.enums.find((candidate) => candidate.id === id);

  if (definition === undefined) {
    return [];
  }

  return definition.kind === "static-enum" ? definition.values : (extractedEnumMembers[id] ?? []);
}

/** The keys of every string vanilla's localisation files define. */
const vanillaStrings: ReadonlySet<string> = new Set(vanillaLocalisationKeys);

/**
 * A scalar as it was written: `NO` rather than the boolean the parser reads it
 * as, and a quoted string without its quotes.
 */
function scalarText(scalar: Scalar): string {
  return typeof scalar.value === "string" ? scalar.value : scalar.raw;
}

/** Whether a block is the trigger `{ always = no }`, which never holds. */
function isNever(value: ValueNode): boolean {
  if (value.kind !== NodeKind.Block) {
    return false;
  }
  const written = value.entries.filter((entry) => entry.kind !== NodeKind.Trivia);
  const only = written[0];
  return (
    written.length === 1 &&
    only?.kind === NodeKind.Assignment &&
    String(only.key.value).toLowerCase() === "always" &&
    only.value.kind === NodeKind.Scalar &&
    scalarText(only.value).toLowerCase() === "no"
  );
}

/** A claimed block's top-level fields, as a variant predicate reads them. */
function subjectOf(block: Block, rootKey: string): VariantSubject {
  const fields = new Map<string, FieldOccurrence[]>();

  for (const entry of block.entries) {
    if (entry.kind !== NodeKind.Assignment) {
      continue;
    }
    const name: string = String(entry.key.value).toLowerCase();
    const bucket: FieldOccurrence[] = fields.get(name) ?? [];
    bucket.push(
      entry.value.kind === NodeKind.Scalar
        ? { kind: "scalar", text: scalarText(entry.value) }
        : { kind: "block", never: isNever(entry.value) },
    );
    fields.set(name, bucket);
  }

  return { rootKey, occurrences: (field: string) => fields.get(field.toLowerCase()) ?? [] };
}

/** The identity of a claimed definition: its key, or the field a tagged type carries it in. */
function identityOf(type: DefinitionType, block: Block, key: string): string | undefined {
  if (type.source.kind !== "tagged-blocks") {
    return key;
  }

  const nameField: string = type.source.nameField;
  const named = block.entries.find(
    (entry) => entry.kind === NodeKind.Assignment && String(entry.key.value) === nameField,
  );

  return named?.kind === NodeKind.Assignment && named.value.kind === NodeKind.Scalar
    ? String(named.value.value)
    : undefined;
}

/** The modifier namespace, expanded once against what vanilla declares. */
let resolvedModifiers: ReadonlySet<string> | undefined;
let engineModifiers: ReadonlySet<string> | undefined;

/** The scalars a list of entries holds, at any depth. */
function scalarsOf(entries: readonly EntryNode[], into: (text: string) => void): void {
  for (const entry of entries) {
    if (entry.kind === NodeKind.Scalar) {
      into(scalarText(entry));
    } else if (entry.kind === NodeKind.Block) {
      scalarsOf(entry.entries, into);
    } else if (entry.kind === NodeKind.Assignment) {
      scalarsOf([entry.value], into);
    } else if (entry.kind === NodeKind.OptionalBlock) {
      scalarsOf(entry.entries, into);
    } else if (entry.kind === NodeKind.PrefixedBlock) {
      scalarsOf(entry.block.entries, into);
    }
  }
}

/**
 * Vanilla's events fired with no scope at all, by the on_actions that fire them.
 *
 * Read the way `validate` reads a mod: the events only the on_actions the game
 * fires without a scope list, and that no other line of vanilla names — no
 * `country_event = { id = … }`, no second on_action, no `fire_on_action` of a
 * pulse from inside a scope.
 */
async function vanillaScopelessEvents(
  model: SchemaModel,
  gamePath: string,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const onActions: readonly string[] = await collectFiles(join(gamePath, "common", "on_actions"), false);
  const listings = new Map<string, string[]>();
  const listedFiles = new Set<string>(onActions);

  const onActionTexts: readonly string[] = await Promise.all(
    onActions.map(async (file) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(await readFile(file))),
  );

  for (const text of onActionTexts) {
    const { document } = parse(text);
    for (const entry of document.entries) {
      if (entry.kind !== NodeKind.Assignment || entry.value.kind !== NodeKind.Block) {
        continue;
      }
      const listed: string[] = listings.get(String(entry.key.value)) ?? [];
      for (const field of entry.value.entries) {
        if (field.kind !== NodeKind.Assignment || field.value.kind !== NodeKind.Block) {
          continue;
        }
        const name: string = String(field.key.value);
        for (const item of field.value.entries) {
          if (name === "events" && item.kind === NodeKind.Scalar) {
            listed.push(scalarText(item));
          } else if (
            name === "random_events" &&
            item.kind === NodeKind.Assignment &&
            item.value.kind === NodeKind.Scalar
          ) {
            listed.push(scalarText(item.value));
          }
        }
      }
      listings.set(String(entry.key.value), listed);
    }
  }

  // Only what could matter is counted: the events those on_actions list, and
  // the on_actions themselves.
  const candidates = new Set<string>(scopelessOnActions);
  for (const onAction of scopelessOnActions) {
    for (const event of listings.get(onAction) ?? []) {
      candidates.add(event);
    }
  }

  const mentions = new Map<string, number>();
  const directories = new Map<string, boolean>(
    model.definitionTypes.map((type) => [type.source.directory, type.source.includeSubdirectories]),
  );
  const files = new Set<string>(
    (
      await Promise.all(
        [...directories].map(async ([directory, recurse]) =>
          collectFiles(join(gamePath, ...directory.split("/")), recurse),
        ),
      )
    ).flat(),
  );

  await mapWithLimit([...files], READ_CONCURRENCY, async (file): Promise<void> => {
    const text: string = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await readFile(file));
    if (![...candidates].some((candidate) => text.includes(candidate))) {
      return;
    }
    const { document } = parse(text);
    const count = (value: string): void => {
      if (candidates.has(value)) {
        mentions.set(value, (mentions.get(value) ?? 0) + 1);
      }
    };

    if (!listedFiles.has(file)) {
      // An event's own `id` names the event it is, not one it fires.
      for (const entry of document.entries) {
        if (entry.kind === NodeKind.Assignment && entry.value.kind === NodeKind.Block) {
          scalarsOf(
            entry.value.entries.filter(
              (field) => !(field.kind === NodeKind.Assignment && String(field.key.value) === "id"),
            ),
            count,
          );
          continue;
        }
        scalarsOf([entry], count);
      }
      return;
    }

    // In an on_action file, listing an event is not mentioning it.
    for (const entry of document.entries) {
      if (entry.kind !== NodeKind.Assignment || entry.value.kind !== NodeKind.Block) {
        scalarsOf([entry], count);
        continue;
      }
      for (const field of entry.value.entries) {
        const name: string = field.kind === NodeKind.Assignment ? String(field.key.value) : "";
        if (name !== "events" && name !== "random_events") {
          scalarsOf([field], count);
        }
      }
    }
  });

  return scopelessEvents(listings, mentions);
}

/** Vanilla's scripted effects and triggers, by `family:id`, for reading a call in its caller's scope. */
async function vanillaScriptedBodies(model: SchemaModel, gamePath: string): Promise<ReadonlyMap<string, Block>> {
  const bodies = new Map<string, Block>();

  const sources = await Promise.all(
    (
      [
        ["scripted_effect", "effect"],
        ["scripted_trigger", "trigger"],
      ] as const
    ).map(async ([typeId, family]) => {
      const type: DefinitionType | undefined = model.definitionTypes.find((candidate) => candidate.id === typeId);
      const files: readonly string[] =
        type === undefined
          ? []
          : await collectFiles(join(gamePath, ...type.source.directory.split("/")), type.source.includeSubdirectories);
      const texts: readonly string[] = await Promise.all(
        files.map(async (file) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(await readFile(file))),
      );
      return { family, texts };
    }),
  );

  for (const { family, texts } of sources) {
    for (const text of texts) {
      for (const entry of parse(text).document.entries) {
        if (entry.kind === NodeKind.Assignment && entry.value.kind === NodeKind.Block) {
          bodies.set(`${family}:${String(entry.key.value)}`, entry.value);
        }
      }
    }
  }

  return bodies;
}

/** The modifiers the game defines itself: the ones it prints, with none read off a string's key. */
function engineModifierNames(model: SchemaModel): ReadonlySet<string> {
  engineModifiers ??= expandModifierNames(model.modifiers, vanillaIdsByType);
  return engineModifiers;
}

function modifierNames(model: SchemaModel): ReadonlySet<string> {
  resolvedModifiers ??= expandModifierNames(model.modifiers, vanillaIdsByType, vanillaModifierNames);
  return resolvedModifiers;
}

export async function checkConformance(
  model: SchemaModel,
  gamePath: string,
  options: ConformanceOptions = {},
): Promise<ConformanceReport> {
  const reports: TypeReport[] = [];
  let stringsChecked = 0;
  let scopelessEventsWalked = 0;
  const firedWithoutScope: ReadonlyMap<string, readonly string[]> = await vanillaScopelessEvents(model, gamePath);
  const scripted: ReadonlyMap<string, Block> = await vanillaScriptedBodies(model, gamePath);
  const scriptedTypes = new Map<string, DefinitionType>(
    model.definitionTypes
      .filter((type) => type.id === "scripted_effect" || type.id === "scripted_trigger")
      .map((type) => [type.id === "scripted_effect" ? "effect" : "trigger", type]),
  );
  let callsFollowed = 0;
  let branchesChecked = 0;
  const missingDirectories: string[] = [];

  const vanillaIdSets = new Map<string, ReadonlySet<string>>();
  const loadContext: LoadCheckContext = {
    defines: (type: string, id: string): boolean => {
      let set: ReadonlySet<string> | undefined = vanillaIdSets.get(type);
      if (set === undefined) {
        set = new Set(vanillaIdsByType[type] ?? []);
        vanillaIdSets.set(type, set);
      }
      return set.has(id);
    },
    ids: (type: string): readonly string[] => vanillaIdsByType[type] ?? [],
    command: (family: "effect" | "trigger", name: string): boolean => engineCommandNames(model, family).has(name),
    modifier: (name: string): boolean => engineModifierNames(model).has(name.toLowerCase()),
  };

  const resolver = new SchemaResolver(model, {
    idsByType: vanillaIdsByType,
    modifierNames: modifierNames(model),
    enumMembers: extractedEnumMembers,
    scriptedParameters: vanillaScriptedParameters,
  });

  await mapWithLimit(model.definitionTypes, 8, async (type): Promise<void> => {
    const directory: string = join(gamePath, ...type.source.directory.split("/"));
    const found: readonly string[] = await collectFiles(directory, type.source.includeSubdirectories);
    // A type that names its files means those files. `alert` reads
    // `common/alerts.txt`; without this it reads every file under `common` and
    // reports each root key it finds there as a field it does not have.
    const only: readonly string[] | undefined = type.source.files;
    const files: readonly string[] =
      only === undefined ? found : found.filter((file) => only.includes(file.split(/[\\/]/u).at(-1) ?? ""));

    if (found.length === 0) {
      missingDirectories.push(type.source.directory);
      return;
    }

    const root: BlockRules = resolver.rulesForType(type);
    // A definition body runs in the scope the type names, when it names one.
    const entryScope: ScopeState =
      typeof type.entryScope === "string" ? { current: type.entryScope, root: type.entryScope } : {};
    const variants: ReadonlyMap<string, string> = variantScopes(type);
    const ruleKeys: readonly string[] = literalRuleKeys(type);
    const required: readonly string[] = requiredKeys(type);
    const missingRequired = new Map<string, { count: number; examples: string[] }>();
    const valueIssues = new Map<
      string,
      { path: string; field: string; expected: string; example: string; count: number; examples: string[] }
    >();
    const scopeIssues = new Map<
      string,
      {
        command: string;
        path: string;
        writtenIn: string;
        accepts: readonly string[];
        count: number;
        examples: string[];
      }
    >();
    const unknown = new Map<
      string,
      { path: string; field: string; context: FindingContext; shape: ValueShape; count: number; examples: string[] }
    >();
    const shapeIssues = new Map<
      string,
      { path: string; field: string; shape: ShapeFinding["shape"]; count: number; examples: string[] }
    >();
    const branchIssues = new Map<string, { path: string; field: string; count: number; examples: string[] }>();
    const comparisonIssues = new Map<
      string,
      { path: string; field: string; operator: string; count: number; examples: string[] }
    >();
    const stringIssues = new Map<
      string,
      { path: string; field: string; key: string; count: number; examples: string[] }
    >();
    const requirements = type.localisation.filter(
      (requirement) => requirement.required && requirement.source.kind === "definition-id",
    );
    const requirementIssues = requirements.map(() => ({ appliesTo: 0, missing: [] as string[], ids: [] as string[] }));
    let inVariant: (variant: string) => boolean = () => false;
    const seen = new Set<string>();
    // The scripted effects and triggers being read in a caller's scope, so that
    // one calling itself is read once.
    const calling = new Set<string>();
    let definitionsSeen = 0;
    let keysChecked = 0;
    let loadChecked = 0;
    const loadFindings: LoadCheckFinding[] = [];
    let scopelessWalked = 0;

    const recordShape = (path: string, field: string, shape: ShapeFinding["shape"], file: string): void => {
      const identity: string = `${path} ${field} ${shape}`;
      const issue = shapeIssues.get(identity) ?? { path, field, shape, count: 0, examples: [] };
      issue.count += 1;
      if (issue.examples.length < 3 && !issue.examples.includes(file)) {
        issue.examples.push(file);
      }
      shapeIssues.set(identity, issue);
    };

    const recordComparison = (path: string, field: string, operator: string, file: string): void => {
      const identity: string = `${path} ${field} ${operator}`;
      const issue = comparisonIssues.get(identity) ?? { path, field, operator, count: 0, examples: [] };
      issue.count += 1;
      if (issue.examples.length < 3 && !issue.examples.includes(file)) {
        issue.examples.push(file);
      }
      comparisonIssues.set(identity, issue);
    };

    const recordString = (path: string, field: string, key: string, file: string): void => {
      const identity: string = `${path} ${field} ${key}`;
      const issue = stringIssues.get(identity) ?? { path, field, key, count: 0, examples: [] };
      issue.count += 1;
      if (issue.examples.length < 3 && !issue.examples.includes(file)) {
        issue.examples.push(file);
      }
      stringIssues.set(identity, issue);
    };

    // Every string a value names, each pattern with `$` standing for the value.
    const checkStrings = (
      path: string,
      field: string,
      text: string,
      patterns: readonly string[],
      file: string,
    ): void => {
      const named: string | undefined = patterns.length === 0 ? undefined : localisationKeyIn(text);
      if (named === undefined) {
        return;
      }
      for (const pattern of patterns) {
        const wanted: string = localisationKey(pattern, named);
        stringsChecked += 1;
        if (!vanillaStrings.has(wanted)) {
          recordString(path, field, wanted, file);
        }
      }
    };

    const record = (path: string, field: string, file: string, context: FindingContext, shape: ValueShape): void => {
      const identity: string = `${path} ${field}`;
      const entry = unknown.get(identity) ?? { path, field, context, shape, count: 0, examples: [] };
      entry.count += 1;
      entry.shape = widenShape(entry.shape, shape);
      if (entry.examples.length < 3 && !entry.examples.includes(file)) {
        entry.examples.push(file);
      }
      unknown.set(identity, entry);
    };

    const walk = (
      block: Block,
      rules: BlockRules,
      trail: string,
      file: string,
      scope: ScopeState,
      atEntryScope: boolean,
      compares: boolean,
      // What a value means here, as `validate` carries it: only the rules that
      // apply to this definition's variants.
      meaning: BlockRules | undefined,
    ): void => {
      // A rule can demand a key at any depth, and until now only the top level
      // of a definition was asked. `modifier = { factor = … }` declared `factor`
      // required in 261 places the game does not need it, and the gate reported
      // phantomRequirements 0 throughout — it was reading depth 1 of a tree it
      // otherwise walks to the bottom.
      if (trail.length > 0 && rules.required.length > 0) {
        const written = new Set<string>();
        for (const entry of block.entries) {
          if (entry.kind === NodeKind.Assignment) {
            written.add(String(entry.key.value).toLowerCase());
          }
        }

        for (const key of rules.required) {
          if (written.has(key.toLowerCase())) {
            continue;
          }
          const label = `${trail}.${key}`;
          const absence = missingRequired.get(label) ?? { count: 0, examples: [] };
          absence.count += 1;
          if (absence.examples.length < 3 && !absence.examples.includes(file)) {
            absence.examples.push(file);
          }
          missingRequired.set(label, absence);
        }
      }

      // A word with no key is an item of a list, and names whatever the item
      // rules that apply here say it names, as a keyed value does.
      const itemNames: readonly string[] = meaning === undefined ? [] : namedStrings(meaning.items);

      // An `else` belongs to the `if` read just before it, as `validate` reads
      // a mod's blocks.
      const branches: BranchChain | undefined =
        (rules.families.has("effect") || rules.families.has("trigger")) && !isBranchBody(trail)
          ? branchChain()
          : undefined;

      for (const entry of block.entries) {
        if (branches !== undefined) {
          if (entry.kind === NodeKind.Assignment) {
            const written: string = String(entry.key.value);
            const lowered: string = written.toLowerCase();
            const field: boolean =
              lowered !== "inline_script" && (rules.literals.has(written) || rules.literals.has(lowered));
            if (!field) {
              if (lowered === "else" || lowered === "else_if") {
                branchesChecked += 1;
              }
              if (!branches.next(written)) {
                const identity: string = `${trail} ${lowered}`;
                const issue = branchIssues.get(identity) ?? { path: trail, field: written, count: 0, examples: [] };
                issue.count += 1;
                if (issue.examples.length < 3 && !issue.examples.includes(file)) {
                  issue.examples.push(file);
                }
                branchIssues.set(identity, issue);
              }
            }
          } else if (
            entry.kind !== NodeKind.Scalar &&
            entry.kind !== NodeKind.Block &&
            entry.kind !== NodeKind.Trivia
          ) {
            // `[[PARAM] … ]` and whatever else is not plain script.
            branches.unknown();
          }
        }

        if (entry.kind === NodeKind.Scalar) {
          checkStrings(trail, "<item>", scalarText(entry), itemNames, file);
          continue;
        }

        // A block with no key is an item of a list, and only an item rule that
        // takes a block can describe it: `ship_designs = { { design = … } }`.
        if (entry.kind === NodeKind.Block) {
          const items: BlockRules | undefined =
            rules.items.length === 0 ? undefined : resolver.rulesForValues(rules.items);

          if (!rules.wildcard && (items === undefined || items.scalarOnly)) {
            recordShape(trail, "{ }", "block-in-list", file);
          } else if (items !== undefined) {
            const itemMeaning: BlockRules | undefined =
              meaning === rules
                ? items
                : meaning === undefined || meaning.items.length === 0
                  ? undefined
                  : resolver.rulesForValues(meaning.items);
            walk(entry, items, trail, file, scope, false, comparesIn(items, compares), itemMeaning);
          }
          continue;
        }

        if (entry.kind !== NodeKind.Assignment) {
          continue;
        }

        const key: string = String(entry.key.value);
        keysChecked += 1;

        if (trail.length === 0) {
          seen.add(key);
        }

        const resolution = resolver.resolve(rules, key);
        const sense =
          meaning === undefined ? undefined : meaning === rules ? resolution : resolver.resolve(meaning, key);
        const applicable: readonly ResolvedValue[] =
          sense === undefined || meaning === undefined ? [] : valuesFor(meaning, sense.values, inVariant);

        if (!resolution.accepted) {
          record(trail, key, file, contextOf(rules), shapeOf(entry.value));
          continue;
        }

        // A scripted effect or trigger called where there is no scope runs its
        // body there too, and what it reads there is read on nothing.
        if (scope.current === NO_SCOPE || scope.root === NO_SCOPE) {
          const followed = new Set<string>();
          for (const value of resolution.values) {
            if (value.kind !== "scripted-call") {
              continue;
            }
            const callee: string = `${value.family}:${value.callee}`;
            const body: Block | undefined = scripted.get(callee);
            const calleeType: DefinitionType | undefined = scriptedTypes.get(value.family);
            // The scalar call and the call with parameters are two rules for one callee.
            if (body === undefined || calleeType === undefined || calling.has(callee) || followed.has(callee)) {
              continue;
            }
            followed.add(callee);
            calling.add(callee);
            callsFollowed += 1;
            const calleeRules: BlockRules = resolver.rulesForType(calleeType);
            walk(
              body,
              calleeRules,
              `${trail.length === 0 ? key : `${trail}.${key}`}>`,
              file,
              scope,
              false,
              comparesIn(calleeRules, value.family === "trigger"),
              calleeRules,
            );
            calling.delete(callee);
          }
        }

        // A key that names a string, as a situation's stages are written.
        if (sense?.localisationKey === true) {
          const named: string | undefined = localisationKeyIn(key);
          stringsChecked += named === undefined ? 0 : 1;
          if (named !== undefined && !vanillaStrings.has(named)) {
            recordString(trail, "<key>", named, file);
          }
        }

        // A tagged type's identity names its own strings, and the requirements
        // below already ask for those.
        const identityField: boolean =
          trail.length === 0 && type.source.kind === "tagged-blocks" && key === type.source.nameField;

        if (!identityField && entry.value.kind === NodeKind.Scalar) {
          checkStrings(trail, key, scalarText(entry.value), namedStrings(applicable), file);
        }

        // Outside a trigger nothing reads the operator, unless the rule for the
        // key says it compares.
        if (entry.operator !== "=" && !compares && !resolution.comparable) {
          recordComparison(trail, key, entry.operator, file);
        }

        for (const command of resolution.commands) {
          options.observeCommands?.(type.id, command, atEntryScope);
        }

        // A command reads one kind of object. Written where the current scope is
        // known and not one of them, the game answers `false` for ever.
        // One name can resolve to several rules, one per value shape. They are
        // alternatives, so the scope is wrong only when none of them accepts it.
        const constrained = resolution.commands.filter(
          (command) => command.input.kind === "listed-scopes" && command.input.scopes.length > 0,
        );
        const here: string | undefined = scope.current;

        if (
          here !== undefined &&
          constrained.length > 0 &&
          !constrained.some(
            (command) => command.input.kind === "listed-scopes" && command.input.scopes.some((one) => one === here),
          )
        ) {
          const first = constrained[0];
          const identity = `${first?.id ?? key} ${here} ${trail}`;
          const issue = scopeIssues.get(identity) ?? {
            command: first?.id ?? key,
            path: trail,
            writtenIn: here,
            accepts: [
              ...new Set(
                constrained.flatMap((command) => (command.input.kind === "listed-scopes" ? command.input.scopes : [])),
              ),
            ],
            count: 0,
            examples: [],
          };
          issue.count += 1;
          if (issue.examples.length < 3 && !issue.examples.includes(file)) {
            issue.examples.push(file);
          }
          scopeIssues.set(identity, issue);
        }

        // A value naming a scope through a frame that holds none: `who = root`
        // in an event the game fires with no scope.
        if (
          entry.value.kind === NodeKind.Scalar &&
          namesScope(applicable) &&
          frameOf(scope, scalarText(entry.value)) === NO_SCOPE
        ) {
          const named: string = `${key} = ${scalarText(entry.value)}`;
          const identity = `${named} ${NO_SCOPE} ${trail}`;
          const issue = scopeIssues.get(identity) ?? {
            command: named,
            path: trail,
            writtenIn: NO_SCOPE,
            accepts: ["a scope"],
            count: 0,
            examples: [],
          };
          issue.count += 1;
          if (issue.examples.length < 3 && !issue.examples.includes(file)) {
            issue.examples.push(file);
          }
          scopeIssues.set(identity, issue);
        }

        // A value outside what the rules accept is dropped as silently as an
        // unknown key.
        if (entry.value.kind === NodeKind.Scalar) {
          const text: string = String(entry.value.value);
          const expected = expectedValue(resolution.values, (id) => enumMembersOf(model, id));

          if (expected !== undefined && !isIndirect(text) && !expected.accepts(text)) {
            const identity = `${trail} ${key} ${expected.label}`;
            const issue = valueIssues.get(identity) ?? {
              path: trail,
              field: key,
              expected: expected.label,
              example: text,
              count: 0,
              examples: [],
            };
            issue.count += 1;
            if (issue.examples.length < 3 && !issue.examples.includes(file)) {
              issue.examples.push(file);
            }
            valueIssues.set(identity, issue);
          }
        }

        if (entry.value.kind !== NodeKind.Block) {
          continue;
        }

        const values: readonly ResolvedValue[] = resolution.values;

        if (values.length === 0) {
          continue;
        }

        const child: BlockRules = resolver.rulesForValues(values);

        // A rule that describes a scalar says nothing about the keys inside a
        // block written there. That is a shape disagreement, not an unknown key,
        // and is counted as one rather than drowning the keys that are.
        if (child.scalarOnly) {
          recordShape(trail, key, "block-for-value", file);
          continue;
        }

        const childMeaning: BlockRules | undefined =
          applicable.length === 0
            ? undefined
            : meaning === rules && applicable.length === resolution.values.length
              ? child
              : resolver.rulesForValues(applicable);

        walk(
          entry.value,
          child,
          trail.length === 0 ? key : `${trail}.${key}`,
          file,
          applyScope(scope, resolution.scope),
          atEntryScope && resolution.scope === undefined,
          comparesIn(child, compares),
          childMeaning,
        );
      }
    };

    await mapWithLimit(files, READ_CONCURRENCY, async (file): Promise<void> => {
      const source: string = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await readFile(file));
      const result = parse(source);

      if (result.errors.length > 0) {
        return;
      }

      const display: string = relative(gamePath, file).replaceAll("\\", "/");

      for (const claimed of definitionBlocks(model, type, result.document)) {
        definitionsSeen += 1;
        const variant: string | undefined = variants.get(claimed.key.toLowerCase());
        // A generic event only the scopeless on_actions fire runs in no scope.
        const scopeless: boolean =
          type.id === "event" &&
          claimed.key === "event" &&
          firedWithoutScope.has(identityOf(type, claimed.block, claimed.key) ?? "");
        const blockScope: ScopeState = scopeless
          ? { current: NO_SCOPE, root: NO_SCOPE, prev: NO_SCOPE, from: NO_SCOPE }
          : variant === undefined
            ? entryScope
            : { current: variant, root: variant };
        if (scopeless) {
          scopelessWalked += 1;
        }
        const subject: VariantSubject = subjectOf(claimed.block, claimed.key);
        inVariant = (id: string): boolean => {
          const declared = type.variants.find((candidate) => candidate.id === id);
          return declared !== undefined && variantHolds(declared.when, subject);
        };
        walk(claimed.block, root, "", display, blockScope, true, comparesIn(root, false), root);

        // Every string a requirement asks of this definition, against the game's
        // own localisation files.
        const identity: string | undefined =
          type.source.kind === "file-definitions"
            ? (display.split("/").at(-1) ?? "").replace(/\.[^.]*$/u, "")
            : identityOf(type, claimed.block, claimed.key);

        // What the game's loader would log about this definition.
        if (identity !== undefined && loadCheckedTypes.has(type.id)) {
          loadChecked += 1;
          for (const finding of loadChecks(
            type.id,
            identity,
            loadBlockOfEntries(claimed.block.entries),
            loadContext,
            claimed.key,
          )) {
            loadFindings.push({ id: identity, ...finding, file: display });
          }
        }

        if (identity !== undefined) {
          requirements.forEach((requirement, index) => {
            const issue = requirementIssues[index];
            if (
              issue === undefined ||
              requirement.source.kind !== "definition-id" ||
              !requirementApplies(type, requirement, subject)
            ) {
              return;
            }
            issue.appliesTo += 1;
            const wanted: string = localisationKey(requirement.source.pattern, identity);
            if (!vanillaStrings.has(wanted)) {
              issue.missing.push(wanted);
              issue.ids.push(identity);
            }
          });
        }

        if (required.length === 0) {
          continue;
        }

        const present = new Set<string>();
        for (const entry of claimed.block.entries) {
          if (entry.kind === NodeKind.Assignment) {
            present.add(String(entry.key.value).toLowerCase());
          }
        }

        for (const key of required) {
          if (present.has(key.toLowerCase())) {
            continue;
          }
          const absence = missingRequired.get(key) ?? { count: 0, examples: [] };
          absence.count += 1;
          if (absence.examples.length < 3 && !absence.examples.includes(display)) {
            absence.examples.push(display);
          }
          missingRequired.set(key, absence);
        }
      }
    });

    scopelessEventsWalked += scopelessWalked;

    reports.push({
      type: type.id,
      directory: type.source.directory,
      sourceKind: type.source.kind,
      strictness: root.wildcard ? "permissive" : "strict",
      definitionsSeen,
      filesSeen: files.length,
      keysChecked,
      unknownFields: [...unknown.values()]
        .map((entry) => ({
          type: type.id,
          path: entry.path,
          field: entry.field,
          context: entry.context,
          shape: entry.shape,
          occurrences: entry.count,
          examples: entry.examples,
        }))
        .sort(
          (left, right) =>
            right.occurrences - left.occurrences ||
            compareOrdinal(left.path, right.path) ||
            compareOrdinal(left.field, right.field),
        ),
      unusedRules: ruleKeys.filter((key) => !seen.has(key)),
      valueMismatches: [...valueIssues.values()]
        .map((issue) => ({
          path: issue.path,
          field: issue.field,
          expected: issue.expected,
          example: issue.example,
          occurrences: issue.count,
          examples: issue.examples,
        }))
        .sort((left, right) => right.occurrences - left.occurrences || compareOrdinal(left.field, right.field)),
      scopeViolations: [...scopeIssues.values()]
        .map((issue) => ({
          command: issue.command,
          path: issue.path,
          writtenIn: issue.writtenIn,
          accepts: issue.accepts,
          occurrences: issue.count,
          examples: issue.examples,
        }))
        .sort((left, right) => right.occurrences - left.occurrences || compareOrdinal(left.command, right.command)),
      missingRequired: [...missingRequired]
        .map(([field, absence]) => ({ field, missingFrom: absence.count, examples: absence.examples }))
        .sort((left, right) => right.missingFrom - left.missingFrom || compareOrdinal(left.field, right.field)),
      shapeMismatches: [...shapeIssues.values()]
        .map((issue) => ({
          path: issue.path,
          field: issue.field,
          shape: issue.shape,
          occurrences: issue.count,
          examples: issue.examples,
        }))
        .sort((left, right) => right.occurrences - left.occurrences || compareOrdinal(left.field, right.field)),
      branchMismatches: [...branchIssues.values()]
        .map((issue) => ({
          path: issue.path,
          field: issue.field,
          occurrences: issue.count,
          examples: issue.examples,
        }))
        .sort((left, right) => compareOrdinal(left.path, right.path) || compareOrdinal(left.field, right.field)),
      comparisonMismatches: [...comparisonIssues.values()]
        .map((issue) => ({
          path: issue.path,
          field: issue.field,
          operator: issue.operator,
          occurrences: issue.count,
          examples: issue.examples,
        }))
        .sort((left, right) => right.occurrences - left.occurrences || compareOrdinal(left.field, right.field)),
      unresolvedStrings: [...stringIssues.values()]
        .map((issue) => ({
          path: issue.path,
          field: issue.field,
          key: issue.key,
          occurrences: issue.count,
          examples: issue.examples,
        }))
        .sort((left, right) => compareOrdinal(left.key, right.key) || compareOrdinal(left.path, right.path)),
      loadChecked,
      loadFindings: [...loadFindings].sort(
        (left, right) => compareOrdinal(left.id, right.id) || compareOrdinal(left.path, right.path),
      ),
      missingStrings: requirements.flatMap((requirement, index) => {
        const issue = requirementIssues[index];
        if (issue === undefined || issue.missing.length === 0 || requirement.source.kind !== "definition-id") {
          return [];
        }
        return [
          {
            pattern: requirement.source.pattern,
            ...(requirement.variant === undefined ? {} : { variant: requirement.variant }),
            missingFrom: issue.missing.length,
            appliesTo: issue.appliesTo,
            keys: [...new Set(issue.missing)].sort(compareOrdinal),
            ids: [...new Set(issue.ids)].sort(compareOrdinal),
          },
        ];
      }),
    });
  });

  reports.sort((left, right) => compareOrdinal(left.type, right.type));

  return {
    types: reports,
    missingDirectories: [...missingDirectories].sort(compareOrdinal),
    unknownFieldTotal: reports.reduce((total, report) => total + report.unknownFields.length, 0),
    topLevelUnknownTotal: reports.reduce(
      (total, report) => total + report.unknownFields.filter((finding) => finding.path.length === 0).length,
      0,
    ),
    keysChecked: reports.reduce((total, report) => total + report.keysChecked, 0),
    unusedRuleTotal: reports.reduce((total, report) => total + report.unusedRules.length, 0),
    strictTypeCount: reports.filter((report) => report.strictness === "strict").length,
    missingRequiredTotal: reports.reduce((total, report) => total + report.missingRequired.length, 0),
    scopeViolationTotal: reports.reduce((total, report) => total + report.scopeViolations.length, 0),
    valueMismatchTotal: reports.reduce((total, report) => total + report.valueMismatches.length, 0),
    shapeMismatchTotal: reports.reduce((total, report) => total + report.shapeMismatches.length, 0),
    comparisonMismatchTotal: reports.reduce((total, report) => total + report.comparisonMismatches.length, 0),
    branchMismatchTotal: reports.reduce((total, report) => total + report.branchMismatches.length, 0),
    branchesChecked,
    stringsChecked,
    scopelessEvents: firedWithoutScope.size,
    scopelessEventsWalked,
    callsFollowed,
  };
}
