import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, relative } from "node:path";

import {
  extractedEnumMembers,
  vanillaIdsByType,
  vanillaModifierNames,
  vanillaScriptedParameters,
} from "../../src/generated/vanilla/index.js";
import { expandModifierNames } from "../../src/schema/modifier-namespace.js";
import {
  applyScope,
  requiredKeys,
  SchemaResolver,
  type BlockRules,
  type ResolvedValue,
  type ScopeState,
  type ScriptFamily,
} from "../../src/schema/resolve.js";
import { NodeKind, parse, type Block, type Document, type ValueNode } from "../../src/syntax/index.js";
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

/** The modifier namespace, expanded once against what vanilla declares. */
let resolvedModifiers: ReadonlySet<string> | undefined;

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
  const missingDirectories: string[] = [];

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
    const seen = new Set<string>();
    let definitionsSeen = 0;
    let keysChecked = 0;

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
    ): void => {
      for (const entry of block.entries) {
        if (entry.kind !== NodeKind.Assignment) {
          continue;
        }

        const key: string = String(entry.key.value);
        keysChecked += 1;

        if (trail.length === 0) {
          seen.add(key);
        }

        const resolution = resolver.resolve(rules, key);

        if (!resolution.accepted) {
          record(trail, key, file, contextOf(rules), shapeOf(entry.value));
          continue;
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
        // and reporting it here would drown the keys that are.
        if (child.scalarOnly) {
          continue;
        }

        walk(
          entry.value,
          child,
          trail.length === 0 ? key : `${trail}.${key}`,
          file,
          applyScope(scope, resolution.scope),
          atEntryScope && resolution.scope === undefined,
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
        const blockScope: ScopeState = variant === undefined ? entryScope : { current: variant, root: variant };
        walk(claimed.block, root, "", display, blockScope, true);

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
  };
}
