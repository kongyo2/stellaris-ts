import {
  extractedEnumMembers,
  vanillaIdsByType,
  vanillaModifierNames,
  vanillaPlacement,
  vanillaScriptedParameters,
} from "../generated/vanilla/index.js";
import { vanillaFiles } from "../generated/vanilla/files.js";
import { vanillaLocalisationKeys } from "../generated/vanilla/localisation-keys.js";
import { definitionFilePath } from "../runtime/emit.js";
import type { DefinitionRecord, Mod, RawFileRecord } from "../runtime/mod.js";
import { isBare, isCompared, isEntries, isRaw, isRepeated } from "../runtime/values.js";
import { definitionIds } from "../schema/definition-ids.js";
import {
  firstDefinitionWins,
  LAST_DEFINITION_LOG,
  precedenceOf,
  readOrder,
  type DefinitionPrecedence,
} from "../schema/definition-precedence.js";
import { captureFromDocument } from "../schema/extraction.js";
import { localisationKey } from "../schema/ir.js";
import {
  localisationKeyIn,
  namedStrings,
  requirementApplies,
  variantHolds,
  type FieldOccurrence,
  type VariantSubject,
} from "../schema/localisation-references.js";
import {
  engineCommandNames,
  loadBlockOfEntries,
  loadCheckedTypes,
  loadChecks,
  type LoadBlock,
  type LoadCheckContext,
  type LoadEntry,
  type LoadValue,
} from "../schema/load-checks.js";
import { engineFixedEnums } from "../schema/merged-types.js";
import { NodeKind, parse, type Document, type EntryNode } from "../syntax/index.js";
import { NO_SCOPE, namesScope, scopelessEvents, scopelessOnActions } from "../schema/scopeless-on-actions.js";
import { schema } from "../schema/index.js";
import { branchChain, isBranchBody, type BranchChain } from "../schema/script-order.js";
import { expandModifierNames, mergeIdsByType } from "../schema/modifier-namespace.js";
import {
  applyScope,
  comparesIn,
  frameOf,
  requiredKeys,
  SchemaResolver,
  valuesFor,
  type BlockRules,
  type KeyResolution,
  type ResolvedValue,
  type ScopeState,
} from "../schema/resolve.js";
import type {
  DefinitionType,
  EnumDefinition,
  ExtractionStep,
  SchemaModel,
  ScriptCommandDefinition,
  ValueRule,
} from "../schema/ir.js";

/**
 * Checks a mod against the schema before it reaches the game.
 *
 * The game reports almost nothing when a mod is wrong: an unknown key is
 * ignored, a missing string shows as the key itself, and a reference to
 * something that does not exist fails at the moment it is used, possibly hours
 * into a session. These are the mistakes that can be caught without launching.
 *
 * Every key is checked, at every depth. A definition body is a handful of keys
 * and the script inside it is hundreds — `allow = { has_country_flagg = yes }`
 * is the mistake that actually gets made, and checking only the outer level
 * would pass it without a word, exactly as the game does.
 */

export interface ValidationDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly definition: string;
  /** Where inside the definition, dotted. Empty for the definition itself. */
  readonly path: string;
}

export interface ValidationOptions {
  /** Languages a definition's required strings must exist in. Defaults to English. */
  readonly languages?: readonly string[];
  readonly model?: SchemaModel;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * What a key points at, when pointing at something is all it can do.
 *
 * Reported only when every rule for the key is a reference. A field is often
 * `<building> | scalar` — `icon` is — and a scalar rule means the value may be
 * anything, so naming one of the alternatives as unresolved would be wrong.
 */
function referenceTypes(values: readonly ResolvedValue[]): readonly string[] {
  const types: string[] = [];
  let onlyReferences = values.length > 0;

  const visit = (value: ResolvedValue): void => {
    if (value.kind === "type-reference") {
      types.push(value.type);
      return;
    }
    if (value.kind === "list") {
      visit(value.item);
      return;
    }
    if (value.kind === "choice") {
      for (const choice of value.choices) {
        visit(choice);
      }
      return;
    }
    // A block rule says nothing about a scalar written under the same key, so it
    // is neither a reference nor a reason to stop reporting one.
    if (value.kind !== "block" && value.kind !== "script-block" && value.kind !== "scripted-call") {
      onlyReferences = false;
    }
  };

  for (const value of values) {
    visit(value);
  }

  return onlyReferences ? types : [];
}

/** The enums a key's value must be a member of, when every rule says so. */
function enumsOf(values: readonly ResolvedValue[]): readonly string[] {
  const ids: string[] = [];

  for (const value of values) {
    if (value.kind === "enum") {
      ids.push(value.enum);
      continue;
    }
    // One rule that is not an enum is enough to make the value unconstrained:
    // a field is often `enum | scalar`, and reporting the scalar would be wrong.
    return [];
  }

  return ids;
}

/**
 * Whether a string could be something other than the literal it looks like.
 *
 * `@cost`, `value:my_script_value`, `$PARAM$` and inline maths all stand in for
 * a value that is only known when the game reads the file, so nothing here can
 * check what they resolve to.
 */
function isIndirect(value: string): boolean {
  return value.startsWith("@") || value.includes("$") || value.includes(":") || value.includes("[");
}

interface Walker {
  readonly resolver: SchemaResolver;
  readonly model: SchemaModel;
  readonly modifiers: ReadonlySet<string>;
  readonly idsByType: Readonly<Record<string, readonly string[]>>;
  readonly declared: ReadonlySet<string>;
  /** Extracted enum members, vanilla’s joined with the ones this mod defines. */
  readonly enumMembers: Readonly<Record<string, readonly string[]>>;
  /** Keys the game injects script through, lower-cased. Just `inline_script`. */
  readonly macroKeys: ReadonlySet<string>;
  /** Whether a string exists in a language: the mod's own, or the base game's. */
  readonly localised: (language: string, key: string) => boolean;
  readonly languages: readonly string[];
  /** Whether the definition being walked is in a variant of its type. */
  inVariant: (variant: string) => boolean;
  /** Why the definition being walked has no scope, when it is known to have none. */
  noScope: string | undefined;
  /** The mod's own scripted effects and triggers, by `family:id`, for reading a call in its caller's scope. */
  readonly scripted: ReadonlyMap<string, DefinitionRecord>;
  /** The ones being read in a caller's scope right now, so that one calling itself is read once. */
  readonly calling: Set<string>;
  /** The strings already reported missing, by definition, language and key. */
  readonly unlocalised: Set<string>;
  readonly diagnostics: ValidationDiagnostic[];
}

/**
 * Whether this is the first time a definition is found to lack a string.
 *
 * One string is often named twice: a special project's `key` is its id, and
 * two options may share a tooltip. Writing the string once mends every one of
 * them, so it is reported once per definition.
 */
function firstMention(seen: Set<string>, definition: string, language: string, key: string): boolean {
  const mention: string = `${definition}\t${language}\t${key}`;

  if (seen.has(mention)) {
    return false;
  }

  seen.add(mention);
  return true;
}

/** The base game's localisation keys, built once: there are 162,858 of them. */
let vanillaKeys: ReadonlySet<string> | undefined;

function vanillaLocalisation(): ReadonlySet<string> {
  vanillaKeys ??= new Set(vanillaLocalisationKeys);
  return vanillaKeys;
}

/**
 * A string a definition names, checked in every language asked for.
 *
 * The game shows a key nothing defines as the key itself, wherever it shows
 * the string: an event titled `sts_demo.1.name` that the mod never wrote reads
 * "sts_demo.1.name". A key the base game defines is as good as one the mod does.
 */
function checkNamedString(walker: Walker, definition: string, path: string, name: string, where: string): void {
  for (const language of walker.languages) {
    if (walker.localised(language, name) || !firstMention(walker.unlocalised, definition, language, name)) {
      continue;
    }

    walker.diagnostics.push({
      severity: "warning",
      code: "missing-localisation",
      message: `No ${language} string for ${name}, which ${where}; the game will show the key itself.`,
      definition,
      path,
    });
  }
}

/**
 * Every string a value names, by its rules' patterns: `$` is the value itself,
 * so a policy option written `name = sts_open` names `sts_open` and
 * `sts_open_desc`, and a policy flag `sts_open_name` alone.
 */
function checkNamedStrings(
  walker: Walker,
  definition: string,
  path: string,
  value: string,
  patterns: readonly string[],
  key: string,
  item: boolean,
): void {
  const named: string | undefined = patterns.length === 0 ? undefined : localisationKeyIn(value);

  if (named === undefined) {
    return;
  }

  const written: string = item ? `${key} = { ${named} }` : `${key} = ${named}`;

  for (const pattern of patterns) {
    checkNamedString(
      walker,
      definition,
      path,
      localisationKey(pattern, named),
      pattern === "$" ? `${written} names` : `${written} asks for`,
    );
  }
}

function enumMembers(walker: Walker, id: string): readonly string[] {
  const definition: EnumDefinition | undefined = walker.model.enums.find((candidate) => candidate.id === id);

  if (definition === undefined) {
    return [];
  }

  return definition.kind === "static-enum" ? definition.values : (walker.enumMembers[id] ?? []);
}

/** One entry of a body, as a route sees it. A value with no key has none. */
type ExtractionEntry = readonly [key: string | undefined, value: unknown];

/**
 * A body's entries, keyed ones and the ones with no key alike.
 *
 * `building_sets = { sts_set }` is a block of values with no keys, and reading
 * only the keyed entries drops every member such a list holds — which is most
 * of what these enums are made of.
 */
function extractionEntries(value: unknown): readonly ExtractionEntry[] {
  if (isEntries(value)) {
    return value.entries.map((entry): ExtractionEntry =>
      isBare(entry) ? [undefined, entry.bare] : [entry[0], entry[1]],
    );
  }

  if (Array.isArray(value)) {
    return (value as readonly unknown[]).map((item): ExtractionEntry => [undefined, item]);
  }

  if (typeof value !== "object" || value === null || isRaw(value) || isRepeated(value) || isCompared(value)) {
    return [];
  }

  return Object.entries(value);
}

/**
 * The occurrences one field stands for.
 *
 * Only `repeated()` writes a key more than once, so only it stands for several
 * occurrences. An array is one value list, and extraction has to read it the
 * same way the emitter writes it or the two disagree about what a mod said.
 */
function occurrencesOf(value: unknown): readonly unknown[] {
  return isRepeated(value) ? value.values : [value];
}

/**
 * Where an extracted enum's members come from in a body this mod wrote.
 *
 * The same route the indexer follows over the game's files, followed over a
 * definition body instead. Without it a mod that defines an event chain and
 * then counts it is told its own counter is not one — the members were read off
 * vanilla once and never joined with what the mod brings into existence, which
 * is exactly what the modifier namespace already does.
 */
function captureFromBody(
  entries: readonly ExtractionEntry[],
  route: readonly ExtractionStep[],
  into: Set<string>,
): void {
  const step: ExtractionStep | undefined = route[0];

  if (step === undefined) {
    return;
  }

  const rest: readonly ExtractionStep[] = route.slice(1);

  if (step.kind === "capture") {
    for (const [key, value] of entries) {
      if (step.source === "key") {
        if (key !== undefined) {
          into.add(key);
        }
        continue;
      }
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        into.add(String(value));
      }
    }
    return;
  }

  for (const [key, value] of entries) {
    if (step.kind === "field" && key !== step.key) {
      continue;
    }

    for (const occurrence of occurrencesOf(value)) {
      if (isBlockLike(occurrence)) {
        captureFromBody(extractionEntries(occurrence), rest, into);
        continue;
      }

      // `counter = my_counter` with a capture next: the value is the member, and
      // there is no block to descend into.
      if (rest[0]?.kind === "capture") {
        captureFromBody([[key, occurrence]], rest, into);
      }
    }
  }
}

/**
 * Extracted enum members, joined with the ones the mod's own definitions add.
 *
 * A route names the directory it reads, so a definition contributes only where
 * the game would have read it from.
 */
function withOwnEnumMembers(
  model: SchemaModel,
  definitions: readonly DefinitionRecord[],
  parsed: ReadonlyMap<string, Document>,
): Readonly<Record<string, readonly string[]>> {
  const merged: Record<string, readonly string[]> = { ...extractedEnumMembers };

  for (const definition of model.enums) {
    if (definition.kind !== "extracted-enum" || engineFixedEnums[definition.id] !== undefined) {
      continue;
    }

    const found = new Set<string>();

    for (const source of definition.sources) {
      const covers = (directory: string): boolean =>
        source.includeSubdirectories
          ? directory === source.directory || directory.startsWith(`${source.directory}/`)
          : directory === source.directory;

      for (const record of definitions) {
        if (!covers(record.directory)) {
          continue;
        }

        // A route that starts at the file root sees the definition's own key;
        // one that does not starts inside the body, which is where the indexer
        // descends to before following it.
        captureFromBody(
          source.startFromRoot ? [[record.id, record.body]] : extractionEntries(record.body),
          source.route,
          found,
        );
      }

      for (const [path, document] of parsed) {
        // The emitter takes either separator and writes one; reading only `/`
        // here put a file written `common\component_tags\x.txt` in no
        // directory at all, so what it declared was never seen.
        const normalised: string = normalisedPath(path);
        const separator: number = normalised.lastIndexOf("/");
        if (covers(separator < 0 ? "" : normalised.slice(0, separator))) {
          captureFromDocument(document.entries, source.route, source.startFromRoot, found);
        }
      }
    }

    if (found.size > 0) {
      merged[definition.id] = [...new Set([...(merged[definition.id] ?? []), ...found])];
    }
  }

  return merged;
}

/**
 * A raw file's path as the emitter writes it: one separator, no `.` segment.
 *
 * The emitter takes either separator and reads `./common/x.txt` as the
 * `common/x.txt` it writes, so everything that asks which directory a raw
 * file is in has to read the path the same way.
 */
function normalisedPath(written: string): string {
  return written
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/");
}

/**
 * A mod's raw files, parsed once: the ones that parse.
 *
 * A raw file is script the mod wrote for a type this library has no shape
 * for, and `common/component_tags` is exactly that: a list of words with no
 * definition type behind it. Parsed once, because a route per file per enum
 * would parse the same file twenty-seven times.
 */
function parseRawFiles(files: readonly RawFileRecord[]): ReadonlyMap<string, Document> {
  const parsed = new Map<string, Document>();

  for (const record of files) {
    const result = parse(record.contents);
    if (result.errors.length === 0) {
      parsed.set(record.path, result.document);
    }
  }

  return parsed;
}

/**
 * The definitions a mod's raw files declare, by type.
 *
 * `mod.file()` ships what `define()` has no shape for, and a mod's own `.gfx`
 * of sprites, its `.asset` of entities and a `common/scripted_triggers` file
 * written by hand are definitions the game loads like any other. Knowing only
 * `define()`'s, the check reported every call to such a trigger as an unknown
 * key. A file counts for a type when it sits where the type is read from and
 * has the extension the game reads there.
 */
function rawFileIds(model: SchemaModel, parsed: ReadonlyMap<string, Document>): Record<string, string[]> {
  const ids: Record<string, string[]> = {};

  for (const [written, document] of parsed) {
    const path: string = normalisedPath(written);
    const slash: number = path.lastIndexOf("/");
    const directory: string = slash < 0 ? "" : path.slice(0, slash);
    const name: string = path.slice(slash + 1);
    const dot: number = name.lastIndexOf(".");
    const extension: string = dot < 0 ? "" : name.slice(dot).toLowerCase();

    for (const type of model.definitionTypes) {
      const source = type.source;
      const covers: boolean = source.includeSubdirectories
        ? directory === source.directory || directory.startsWith(`${source.directory}/`)
        : directory === source.directory;

      if (
        !covers ||
        (source.files !== undefined && !source.files.includes(name)) ||
        extension !== (vanillaPlacement[type.id]?.extension ?? ".txt")
      ) {
        continue;
      }

      for (const claim of definitionIds(type, document, name)) {
        (ids[type.id] ??= []).push(claim.id);
      }
    }
  }

  return ids;
}

/**
 * A body value as the game's own load checks read it.
 *
 * `repeated()` is the key once per value, `gt(1)` its value, and `raw()` the
 * script it holds, parsed. An `inline_script`, or raw text that does not
 * parse, leaves the block open: something is in it that nothing here can see.
 */
function loadValueOf(value: unknown): LoadValue | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return { kind: "scalar", text: value ? "yes" : "no" };
  }
  if (typeof value === "string" || typeof value === "number") {
    return { kind: "scalar", text: String(value) };
  }
  if (isCompared(value)) {
    return loadValueOf(value.value);
  }
  if (isRaw(value)) {
    const result = parse(value.text);
    const written: readonly EntryNode[] = result.document.entries.filter((entry) => entry.kind !== NodeKind.Trivia);
    const only: EntryNode | undefined = written[0];
    if (result.errors.length > 0 || written.length !== 1 || only === undefined) {
      return { kind: "unreadable" };
    }
    if (only.kind === NodeKind.Block) {
      return loadBlockOfEntries(only.entries);
    }
    return only.kind === NodeKind.Scalar
      ? (loadBlockOfEntries([only]).entries[0]?.value ?? { kind: "unreadable" })
      : { kind: "unreadable" };
  }
  return isBlockLike(value) ? loadBlockOf(value) : { kind: "unreadable" };
}

function loadBlockOf(body: unknown): LoadBlock {
  if (isRaw(body)) {
    const read: LoadValue | undefined = loadValueOf(body);
    return read?.kind === "block" ? read : { kind: "block", entries: [], open: true };
  }

  const entries: LoadEntry[] = [];
  let open = false;

  const add = (key: string | undefined, value: unknown): void => {
    for (const occurrence of key === undefined ? [value] : occurrencesOf(value)) {
      const read: LoadValue | undefined = loadValueOf(occurrence);
      if (read === undefined) {
        continue;
      }
      if (key?.toLowerCase() === "inline_script") {
        open = true;
      }
      entries.push({ key, value: read });
    }
  };

  if (isEntries(body)) {
    // An ordered list keeps keyed and bare entries in the order written.
    for (const entry of body.entries) {
      if (isBare(entry)) {
        add(undefined, entry.bare);
      } else {
        add(entry[0], entry[1]);
      }
    }
  } else {
    const { keyed, bare } = entriesOf(body);
    for (const item of bare) {
      add(undefined, item);
    }
    for (const [key, value] of keyed) {
      add(key, value);
    }
  }

  return { kind: "block", entries, open };
}

/**
 * The entries a body value holds: its key/value pairs, and the values with no
 * key — every element of an array, and each `bare()` of an ordered list.
 */
function entriesOf(value: unknown): {
  readonly keyed: readonly (readonly [string, unknown])[];
  readonly bare: readonly unknown[];
} {
  if (isEntries(value)) {
    const keyed: (readonly [string, unknown])[] = [];
    const bare: unknown[] = [];

    for (const entry of value.entries) {
      if (isBare(entry)) {
        bare.push(entry.bare);
      } else {
        keyed.push(entry);
      }
    }

    return { keyed, bare };
  }

  if (Array.isArray(value)) {
    return { keyed: [], bare: value };
  }

  if (typeof value !== "object" || value === null || isRaw(value) || isRepeated(value)) {
    return { keyed: [], bare: [] };
  }

  return { keyed: Object.entries(value), bare: [] };
}

/** Whether a value is a block rather than a scalar, for deciding to recurse. */
function isBlockLike(value: unknown): boolean {
  if (isEntries(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return true;
  }
  return typeof value === "object" && value !== null && !isRaw(value) && !isRepeated(value) && !isCompared(value);
}

function checkValue(
  walker: Walker,
  definition: string,
  path: string,
  key: string,
  value: unknown,
  resolution: KeyResolution,
): void {
  const values: readonly ResolvedValue[] = resolution.values;

  // A reference to something neither vanilla nor this mod defines fails when the
  // game reaches it, which can be a long way into a session.
  for (const type of referenceTypes(values)) {
    const known: readonly string[] | undefined = walker.idsByType[type];

    if (known === undefined) {
      continue;
    }

    const candidates: readonly unknown[] = Array.isArray(value) ? value : [value];

    for (const candidate of candidates) {
      // A number is a reference too where the identifiers are numbers: a
      // technology tier is `0` … `5` and every technology writes `tier = 3`.
      // Reading only strings meant `tier = 99` pointed at nothing and was told
      // nothing, which is the whole thing this check exists to say.
      const named: string | undefined =
        typeof candidate === "string" ? candidate : typeof candidate === "number" ? String(candidate) : undefined;

      if (named === undefined || isIndirect(named)) {
        continue;
      }

      if (!known.includes(named) && !walker.declared.has(`${type}:${named}`)) {
        walker.diagnostics.push({
          severity: "warning",
          code: "unresolved-reference",
          message: `${key} points at ${type} ${named}, which is neither in vanilla nor defined by this mod.`,
          definition,
          path,
        });
      }
    }
  }

  // A value outside what the rules accept is dropped as silently as an unknown
  // key. Only reported when every rule for the key agrees — a key is often
  // `integer | scalar`, and reporting one of the alternatives would be wrong.
  const enumIds: readonly string[] = enumsOf(values);

  if (enumIds.length > 0 && typeof value === "string" && !isIndirect(value)) {
    const allowed: readonly string[] = enumIds.flatMap((id) => enumMembers(walker, id));

    if (allowed.length > 0 && !allowed.some((member) => member.toLowerCase() === value.toLowerCase())) {
      walker.diagnostics.push({
        severity: "warning",
        code: "unknown-value",
        message: `${key} = ${value} is not one of ${enumIds.join(", ")}.`,
        definition,
        path,
      });
    }
  }

  const numeric: "integer" | "number" | undefined = numericOf(values);

  if (numeric !== undefined && typeof value === "string" && !isIndirect(value)) {
    const looksNumeric: boolean = numeric === "integer" ? /^-?\d+$/u.test(value) : /^-?\d*\.?\d+$/u.test(value);

    if (!looksNumeric) {
      walker.diagnostics.push({
        severity: "warning",
        code: "unknown-value",
        message: `${key} takes a${numeric === "integer" ? "n integer" : " number"}, and ${JSON.stringify(value)} is not one.`,
        definition,
        path,
      });
    }
  }
}

/** The numeric type a key takes, when every rule for it says the same one. */
function numericOf(values: readonly ResolvedValue[]): "integer" | "number" | undefined {
  if (values.length === 0) {
    return undefined;
  }

  let seen: "integer" | "number" | undefined;

  for (const value of values) {
    if (value.kind !== "primitive" || (value.type !== "integer" && value.type !== "number")) {
      return undefined;
    }

    if (seen !== undefined && seen !== value.type) {
      return "number";
    }

    seen = value.type;
  }

  return seen;
}

/**
 * One bare value in a list.
 *
 * `prerequisites = { tech_a tech_b }` is a block of bare items, not a key
 * holding an array, so the item rules are what say what they point at.
 */
function checkItem(
  walker: Walker,
  definition: string,
  path: string,
  key: string,
  value: unknown,
  items: readonly ValueRule[],
): void {
  if (typeof value !== "string" || isIndirect(value)) {
    return;
  }

  for (const type of referenceTypes(items)) {
    const known: readonly string[] | undefined = walker.idsByType[type];

    if (known === undefined || known.includes(value) || walker.declared.has(`${type}:${value}`)) {
      continue;
    }

    walker.diagnostics.push({
      severity: "warning",
      code: "unresolved-reference",
      message: `${key} points at ${type} ${value}, which is neither in vanilla nor defined by this mod.`,
      definition,
      path,
    });
  }
}

/**
 * Whether a command may be written where it was.
 *
 * A trigger reads one kind of object and answers `false` everywhere else, for
 * ever, without a word. The scope is only checked when it is known: a chain, a
 * run-time lookup or an undocumented link leaves it unknown, and an unknown
 * scope reports nothing.
 */
function checkScope(
  walker: Walker,
  definition: string,
  path: string,
  key: string,
  resolution: KeyResolution,
  scope: ScopeState,
): void {
  const current: string | undefined = scope.current;

  if (current === undefined) {
    return;
  }

  // The corpus declares a command once per value shape, so one name can resolve
  // to several rules. They are alternatives: the scope is wrong only when none
  // of them accepts it, and it is one mistake however many rules said so.
  const constrained: readonly ScriptCommandDefinition[] = resolution.commands.filter(
    (command) => command.input.kind === "listed-scopes" && command.input.scopes.length > 0,
  );

  if (constrained.length === 0) {
    return;
  }

  const accepted: boolean = constrained.some(
    (command) => command.input.kind === "listed-scopes" && command.input.scopes.some((allowed) => allowed === current),
  );

  if (accepted) {
    return;
  }

  const allowed: readonly string[] = [
    ...new Set(constrained.flatMap((command) => (command.input.kind === "listed-scopes" ? command.input.scopes : []))),
  ];

  walker.diagnostics.push({
    severity: "error",
    code: "wrong-scope",
    message:
      current === NO_SCOPE
        ? `${key} reads a ${allowed.join(" or a ")}, and here there is no scope at all: ${walker.noScope ?? "nothing hands this block one"}. There is nothing for it to read.`
        : `${key} reads a ${allowed.join(" or a ")}, and here the scope is ${current}. The game answers it false for ever rather than reporting anything.`,
    definition,
    path,
  });
}

/**
 * A value that names a scope through a frame that holds none.
 *
 * `add_trust = { who = root }` inside `every_country` reads each country as
 * `this` and `root` as whoever fired the event. Fired by `on_yearly_pulse`,
 * that is nobody, and the trust is added towards no one.
 */
function checkNamedScope(
  walker: Walker,
  definition: string,
  path: string,
  key: string,
  value: string,
  scope: ScopeState,
): void {
  if (frameOf(scope, value) !== NO_SCOPE) {
    return;
  }

  const head: string = value.split(".")[0] ?? value;

  walker.diagnostics.push({
    severity: "error",
    code: "wrong-scope",
    message: `${key} = ${value} names ${head}, and here ${head} is no scope at all: ${walker.noScope ?? "nothing hands this block one"}. It names nothing.`,
    definition,
    path,
  });
}

/**
 * `inline_script = { … }` has to name the file it pulls in.
 *
 * The block form takes the path under a `script` entry and every other key is a
 * `$PARAM$` substitution. Written without one the game reports `Missing
 * "script" entry in inline script block` to the log and injects nothing — the
 * surrounding definition then loads with a hole in it, which is far harder to
 * notice than a parse failure would have been.
 *
 * The direct form, `inline_script = "economy/cost"`, takes no parameters and is
 * not checked here.
 */
function checkInlineScript(walker: Walker, definition: string, path: string, key: string, value: unknown): void {
  if (!isBlockLike(value) || Array.isArray(value)) {
    return;
  }

  const { keyed } = entriesOf(value);

  if (keyed.some(([name]) => name.toLowerCase() === "script")) {
    return;
  }

  walker.diagnostics.push({
    severity: "error",
    code: "inline-script-missing-script",
    message:
      `${key} written as a block needs a script entry naming the file to inject. ` +
      "Without one the game logs a missing-script error and injects nothing.",
    definition,
    path,
  });
}

/** `gt(500)` as the game would read it: `> 500`. */
function comparisonText(operator: string, value: unknown): string {
  const written: string =
    typeof value === "boolean"
      ? value
        ? "yes"
        : "no"
      : typeof value === "string" || typeof value === "number"
        ? String(value)
        : isRaw(value)
          ? value.text
          : "{ … }";
  return `${operator} ${written}`;
}

/**
 * The values a block holds with no key, against what its items may be.
 *
 * An array is one key holding a list — `prerequisites = { tech_a tech_b }`, or
 * `ship_designs = { { design = … } }` — never the key written once per
 * element; that is what `repeated()` is for. A block with no key, where no
 * item rule takes one, is the mistake of writing `option: [{ … }, { … }]` for
 * two options: the game reads one option holding two blocks with no key, and
 * the event has no options at all.
 */
function checkItems(
  walker: Walker,
  definition: string,
  path: string,
  rules: BlockRules,
  items: readonly unknown[],
  scope: ScopeState,
  compares: boolean,
  meaning: BlockRules | undefined,
): void {
  if (items.length === 0) {
    return;
  }

  // Reported against the key that holds the list, from the block around it; a
  // body that is itself a list is held by the definition.
  const cut: number = path.lastIndexOf(".");
  const key: string = path.length === 0 ? definition : path.slice(cut + 1);
  const around: string = cut < 0 ? "" : path.slice(0, cut);
  const itemRules: BlockRules | undefined =
    rules.items.length === 0 ? undefined : walker.resolver.rulesForValues(rules.items);

  if (items.some((item) => isBlockLike(item)) && !rules.wildcard && (itemRules === undefined || itemRules.scalarOnly)) {
    walker.diagnostics.push({
      severity: "error",
      code: "unexpected-value-list",
      message: `${key} holds blocks with no key of their own — which is what an array writes — and nothing here takes one. To write ${key} once per block, use repeated().`,
      definition,
      path: around,
    });
    return;
  }

  // What an item means, as for a keyed value: only the item rules that apply
  // to this definition. `tags = { … }` names strings in one type and is a list
  // of words in another, and `meaning` is what tells them apart.
  const itemNames: readonly string[] = meaning === undefined ? [] : namedStrings(meaning.items);

  for (const item of items) {
    if (!isBlockLike(item)) {
      checkItem(walker, definition, around, key, item, rules.items);
      if (typeof item === "string") {
        checkNamedStrings(walker, definition, around, item, itemNames, key, true);
      }
    } else if (itemRules !== undefined) {
      const itemMeaning: BlockRules | undefined =
        meaning === rules
          ? itemRules
          : meaning === undefined || meaning.items.length === 0
            ? undefined
            : walker.resolver.rulesForValues(meaning.items);
      walkBlock(walker, definition, path, itemRules, item, scope, comparesIn(itemRules, compares), itemMeaning);
    }
  }
}

/**
 * An `else` or an `else_if` with no `if` read just before it.
 *
 * A field of the block that is not itself an effect — an option's `name`, its
 * `trigger` — is taken by the block's own reader and never joins the list the
 * `else` is matched against, so it does not come between an `if` and its
 * `else`. Every other key does.
 */
function checkBranch(
  walker: Walker,
  definition: string,
  path: string,
  rules: BlockRules,
  key: string,
  occurrences: readonly unknown[],
  branches: BranchChain,
): void {
  const lowered: string = key.toLowerCase();
  const macro: boolean = walker.macroKeys.has(lowered);

  if (!macro && (rules.literals.has(key) || rules.literals.has(lowered))) {
    return;
  }

  for (const occurrence of occurrences) {
    if (occurrence === undefined || occurrence === null) {
      continue;
    }

    if (branches.next(key)) {
      continue;
    }

    walker.diagnostics.push({
      severity: "error",
      code: "else-without-if",
      message: `${key} does not follow an if or an else_if${path.length === 0 ? "" : ` inside ${path}`}. The game matches an ${lowered} to the if read just before it in the same block; this one has none, so the game logs "Else/else if not following an if or else if" and the branch never runs. An object writes its keys in the order they were added, and entries() keeps an order an object cannot.`,
      definition,
      path,
    });
  }
}

/**
 * Walks one block. `rules` say what is accepted here: every variant's, since
 * which variant a definition is depends on its body. `meaning` says what a
 * value is: only the rules that apply to this definition, carried down from
 * the key above, so a hidden event's `desc = { text = … }` is not read as a
 * string's name although another variant's `desc` block declares `text` one.
 * `undefined` when no rule that applies describes this block.
 */
function walkBlock(
  walker: Walker,
  definition: string,
  path: string,
  rules: BlockRules,
  body: unknown,
  scope: ScopeState,
  compares: boolean,
  meaning: BlockRules | undefined,
): void {
  const { keyed, bare } = entriesOf(body);

  checkItems(walker, definition, path, rules, bare, scope, compares, meaning);

  // An effect or a trigger block is read in order, and an `else` belongs to
  // the `if` read just before it.
  const branches: BranchChain | undefined =
    (rules.families.has("effect") || rules.families.has("trigger")) && !isBranchBody(path) ? branchChain() : undefined;

  for (const [key, rawValue] of keyed) {
    if (rawValue === undefined || rawValue === null) {
      continue;
    }

    // `repeated(a, b)` writes the key once per value; each one is checked as if
    // it stood alone, and `gt(1)` compares rather than assigns.
    const occurrences: readonly unknown[] = isRepeated(rawValue) ? rawValue.values : [rawValue];
    const resolution: KeyResolution = walker.resolver.resolve(rules, key);

    if (branches !== undefined) {
      checkBranch(walker, definition, path, rules, key, occurrences, branches);
    }
    const sense: KeyResolution | undefined =
      meaning === undefined ? undefined : meaning === rules ? resolution : walker.resolver.resolve(meaning, key);
    const applicable: readonly ResolvedValue[] =
      sense === undefined || meaning === undefined ? [] : valuesFor(meaning, sense.values, walker.inVariant);

    // A scripted effect or trigger the mod defines, called where there is no
    // scope, runs its body there too: what it reads on `root` is read on
    // nothing. The body is checked on its own as well, where its scope is not
    // known, so only what the empty scope adds is kept.
    if (scope.current === NO_SCOPE || scope.root === NO_SCOPE) {
      followCalls(walker, definition, path.length === 0 ? key : `${path}.${key}`, resolution, scope);
    }

    // A stage of a situation is written under the key of its own name.
    if (sense?.localisationKey === true) {
      const named: string | undefined = localisationKeyIn(key);
      if (named !== undefined) {
        checkNamedString(walker, definition, path, named, "is written as a key here and so names a string");
      }
    }

    if (!resolution.accepted) {
      const where: string = path.length === 0 ? "" : ` inside ${path}`;
      walker.diagnostics.push({
        severity: "error",
        code: rules.families.has("modifier") ? "unknown-modifier" : "unknown-field",
        message: rules.families.has("modifier")
          ? `${key} is not a modifier${where}, so the game would drop it silently.`
          : `${key} is not a key${where}. The game ignores what it does not know, so this would do nothing.`,
        definition,
        path,
      });
      continue;
    }

    // One block where a value belongs is enough to wreck the definition, and
    // saying so once per key is the useful report.
    let reportedBlock = false;

    for (const occurrence of occurrences) {
      if (occurrence === undefined || occurrence === null) {
        continue;
      }

      const value: unknown = isCompared(occurrence) ? occurrence.value : occurrence;

      // Outside a trigger the reader keeps the operator and the handler never
      // looks at it. The few keys vanilla does compare there — a spawned
      // system's distances, the module type a starbase loses, a special
      // project's requirements — are declared as comparing.
      if (isCompared(occurrence) && occurrence.operator !== "=" && !compares && !resolution.comparable) {
        walker.diagnostics.push({
          severity: "error",
          code: "unexpected-comparison",
          message: `${key} ${comparisonText(occurrence.operator, value)} compares, and nothing here reads a comparison: outside a trigger the game takes the value and not the operator, as if it said ${key} = ${comparisonText("", value).trim()}.`,
          definition,
          path,
        });
      }

      checkValue(walker, definition, path, key, value, resolution);
      checkScope(walker, definition, path, key, resolution, scope);

      if (typeof value === "string" && namesScope(applicable)) {
        checkNamedScope(walker, definition, path, key, value, scope);
      }

      if (typeof value === "string") {
        checkNamedStrings(walker, definition, path, value, namedStrings(applicable), key, false);
      }

      if (walker.macroKeys.has(key.toLowerCase())) {
        checkInlineScript(walker, definition, path, key, value);
      }

      if (!isBlockLike(value) || resolution.values.length === 0) {
        continue;
      }

      const child: BlockRules = walker.resolver.rulesForValues(resolution.values);

      // Where every rule takes a single value, the handler reads the token
      // after `=` as that value whatever it is. It takes `{` itself — an event
      // titled with a block shows "{" — and the block's contents are read as if
      // they stood beside the key, until its closing brace ends the block
      // around it early.
      if (child.scalarOnly) {
        if (!reportedBlock) {
          walker.diagnostics.push({
            severity: "error",
            code: "unexpected-block",
            message: `${key} takes a single value, not a block. The game takes the "{" itself as the value (an event title written this way reads "{"), reads what the block holds as keys beside ${key}, and its closing brace closes ${path.length === 0 ? "the definition" : path} early.`,
            definition,
            path,
          });
          reportedBlock = true;
        }
        continue;
      }

      const childMeaning: BlockRules | undefined =
        applicable.length === 0
          ? undefined
          : meaning === rules && applicable.length === resolution.values.length
            ? child
            : walker.resolver.rulesForValues(applicable);

      walkBlock(
        walker,
        definition,
        path.length === 0 ? key : `${path}.${key}`,
        child,
        value,
        applyScope(scope, resolution.scope),
        comparesIn(child, compares),
        childMeaning,
      );
    }
  }
}

/**
 * The scalar values an event list holds: `events = { a b }`, or the weighted
 * `random_events = { 10 = a }`. A list written with `raw()` is the same list
 * once parsed, as the game reads what the emitter writes.
 */
function listedEvents(value: unknown, weighted: boolean): readonly string[] {
  if (isRaw(value)) {
    const read: LoadValue | undefined = loadValueOf(value);
    return read?.kind !== "block"
      ? []
      : read.entries
          .filter((entry) => (entry.key !== undefined) === weighted)
          .flatMap((entry) => (entry.value.kind === "scalar" ? [entry.value.text] : []));
  }

  const { keyed, bare } = entriesOf(value);
  const listed: readonly unknown[] = weighted ? keyed.flatMap(([, item]) => occurrencesOf(item)) : bare;
  return listed.filter((item): item is string => typeof item === "string");
}

/** A raw value this cannot read as a block: what it lists is not known. */
function isUnreadableRaw(value: unknown): boolean {
  return occurrencesOf(value).some((occurrence) => isRaw(occurrence) && loadValueOf(occurrence)?.kind !== "block");
}

/** Which events each of the mod's on_actions lists, the same on_action written twice counted together. */
function onActionListings(definitions: readonly DefinitionRecord[]): ReadonlyMap<string, readonly string[]> {
  const listings = new Map<string, string[]>();

  for (const definition of definitions) {
    if (definition.type !== "on_action") {
      continue;
    }

    const listed: string[] = listings.get(definition.id) ?? [];

    for (const [key, value] of entriesOf(definition.body).keyed) {
      for (const occurrence of occurrencesOf(value)) {
        if (key === "events" || key === "random_events") {
          listed.push(...listedEvents(occurrence, key === "random_events"));
        }
      }
    }

    listings.set(definition.id, listed);
  }

  return listings;
}

/** Counts every scalar a value holds, at any depth. */
function countScalars(value: unknown, into: Map<string, number>): void {
  if (typeof value === "string") {
    into.set(value, (into.get(value) ?? 0) + 1);
    return;
  }

  if (isRepeated(value)) {
    for (const item of value.values) {
      countScalars(item, into);
    }
    return;
  }

  if (isCompared(value)) {
    countScalars(value.value, into);
    return;
  }

  if (isRaw(value)) {
    countDocument(parse(value.text).document.entries, into);
    return;
  }

  if (!isBlockLike(value)) {
    return;
  }

  const { keyed, bare } = entriesOf(value);

  for (const item of bare) {
    countScalars(item, into);
  }

  for (const [, item] of keyed) {
    countScalars(item, into);
  }
}

function countDocument(entries: readonly EntryNode[], into: Map<string, number>): void {
  for (const entry of entries) {
    if (entry.kind === NodeKind.Scalar) {
      into.set(String(entry.value), (into.get(String(entry.value)) ?? 0) + 1);
    } else if (entry.kind === NodeKind.Block) {
      countDocument(entry.entries, into);
    } else if (entry.kind === NodeKind.Assignment) {
      countDocument([entry.value], into);
    } else if (entry.kind === NodeKind.OptionalBlock) {
      // `[[PARAM] … ]` holds script that runs when the parameter is set.
      countDocument(entry.entries, into);
    } else if (entry.kind === NodeKind.PrefixedBlock) {
      countDocument(entry.block.entries, into);
    }
  }
}

/**
 * Every name the mod writes anywhere but in an on_action's event list.
 *
 * An event named here may be fired by a `country_event = { id = … }`, and an
 * on_action named here by a `fire_on_action`, either of them from a scope.
 * The mod's raw files count as well, since nothing here can read what they do.
 */
function mentions(
  definitions: readonly DefinitionRecord[],
  files: readonly RawFileRecord[],
): ReadonlyMap<string, number> {
  const counted = new Map<string, number>();

  for (const definition of definitions) {
    // An on_action written wholly with `raw()` lists what this cannot see, so
    // every name in it counts as a mention.
    if (definition.type !== "on_action" || isRaw(definition.body)) {
      countScalars(definition.body, counted);
      continue;
    }

    // An event list is listing, not firing, unless it cannot be read: then
    // what it lists might be anything, and naming is the safe reading.
    for (const [key, value] of entriesOf(definition.body).keyed) {
      if ((key !== "events" && key !== "random_events") || isUnreadableRaw(value)) {
        countScalars(value, counted);
      }
    }
  }

  for (const file of files) {
    countDocument(parse(file.contents).document.entries, counted);
  }

  // Listed on_actions are names too, but listing is not firing.
  for (const onAction of scopelessOnActions) {
    if (definitions.some((definition) => definition.type === "on_action" && definition.id === onAction)) {
      counted.set(onAction, counted.get(onAction) ?? 0);
    }
  }

  return counted;
}

/** Whether a block is the trigger `{ always = no }`, which never holds. */
function isNever(value: unknown): boolean {
  const { keyed, bare } = entriesOf(value);
  const only = keyed[0];
  return (
    bare.length === 0 &&
    keyed.length === 1 &&
    only !== undefined &&
    only[0].toLowerCase() === "always" &&
    (only[1] === false || (typeof only[1] === "string" && only[1].toLowerCase() === "no"))
  );
}

/** The fields a definition writes at its top level, as a variant predicate reads them. */
function variantSubject(definition: DefinitionRecord): VariantSubject {
  const fields = new Map<string, FieldOccurrence[]>();

  for (const [key, value] of entriesOf(definition.body).keyed) {
    const bucket: FieldOccurrence[] = fields.get(key.toLowerCase()) ?? [];

    for (const occurrence of occurrencesOf(value)) {
      const read: unknown = isCompared(occurrence) ? occurrence.value : occurrence;
      // Left `undefined` or `null` is not written, as the walk reads it.
      if (read === undefined || read === null) {
        continue;
      }
      bucket.push(
        typeof read === "boolean"
          ? { kind: "scalar", text: read ? "yes" : "no" }
          : typeof read === "string" || typeof read === "number"
            ? { kind: "scalar", text: String(read) }
            : { kind: "block", never: isBlockLike(read) && isNever(read) },
      );
    }

    fields.set(key.toLowerCase(), bucket);
  }

  return {
    rootKey: definition.blockKey ?? definition.id,
    occurrences: (field: string) => fields.get(field.toLowerCase()) ?? [],
  };
}

/** Reads each mod-defined scripted effect or trigger a key calls, in the scope it is called in. */
function followCalls(
  walker: Walker,
  definition: string,
  path: string,
  resolution: KeyResolution,
  scope: ScopeState,
): void {
  // The scalar call and the call with parameters are two rules for one callee.
  const followed = new Set<string>();

  for (const value of resolution.values) {
    if (value.kind !== "scripted-call") {
      continue;
    }

    const callee: string = `${value.family}:${value.callee}`;
    if (followed.has(callee)) {
      continue;
    }
    followed.add(callee);
    const record: DefinitionRecord | undefined = walker.scripted.get(callee);
    const type: DefinitionType | undefined = walker.model.definitionTypes.find(
      (candidate) => candidate.id === `scripted_${value.family}`,
    );

    if (record === undefined || type === undefined || walker.calling.has(callee)) {
      continue;
    }

    walker.calling.add(callee);
    const sink: ValidationDiagnostic[] = [];
    const rules: BlockRules = walker.resolver.rulesForType(type);
    walkBlock(
      { ...walker, diagnostics: sink },
      definition,
      `${path}>`,
      rules,
      record.body,
      scope,
      comparesIn(rules, value.family === "trigger"),
      rules,
    );
    walker.calling.delete(callee);

    for (const diagnostic of sink) {
      if (diagnostic.code === "wrong-scope" && !walker.diagnostics.some((seen) => sameDiagnostic(seen, diagnostic))) {
        walker.diagnostics.push(diagnostic);
      }
    }
  }
}

function sameDiagnostic(left: ValidationDiagnostic, right: ValidationDiagnostic): boolean {
  return (
    left.definition === right.definition &&
    left.path === right.path &&
    left.code === right.code &&
    left.message === right.message
  );
}

/** `an event`, `a building`: a type's id with its article. */
function withArticle(type: string): string {
  return `${/^[aeiou]/iu.test(type) ? "an" : "a"} ${type}`;
}

/**
 * A file name that sorts before every one of the others, in the byte order
 * the game reads a directory in: the name itself behind the shortest run of
 * zeros that does, or behind `!` where the base game's own names start lower
 * than any digit.
 */
function nameReadFirst(name: string, others: readonly string[]): string {
  for (const prefix of ["00_", "000_", "0000_", "00000_"]) {
    if (readOrder(`${prefix}${name}`, others) === -1) {
      return `${prefix}${name}`;
    }
  }

  return `!_${name}`;
}

/** The line the game logs for an id, from the format it prints it with. */
function logged(format: string, id: string): string {
  return format.replace(", using the one at %s", "").replace("%s", id);
}

/** What happens to the second definition of an id, by which one the game keeps. */
function duplicateMessage(definition: DefinitionRecord, precedence: DefinitionPrecedence): string {
  const twice: string = `${definition.id} is defined more than once as ${withArticle(definition.type)}`;

  switch (precedence) {
    case "first":
      return `${twice}. The game keeps the first one it reads and drops every later one, logging "${logged(firstDefinitionWins[definition.type] ?? "", definition.id)}".`;
    case "last":
      return `${twice}; only the last one the game reads loads, and it logs "${logged(LAST_DEFINITION_LOG, definition.id)}" for it.`;
    default:
      return `${twice}, and the game keeps one of them.`;
  }
}

/**
 * A definition of an id the base game already uses.
 *
 * Which of the two the game keeps is decided by the order it reads them in,
 * and that by the names of their files: files of a directory are read in the
 * order of their names, the base game's and a mod's alike. Where the game
 * keeps the last definition, the default file — which sorts after every one
 * of the base game's — replaces the base game's; where it keeps the first,
 * the same file is the one place such a definition does nothing.
 */
function vanillaOverride(
  mod: Mod,
  definition: DefinitionRecord,
  precedence: DefinitionPrecedence,
): ValidationDiagnostic {
  const base = { definition: definition.id, path: "" };
  const what: string = `${definition.id} is ${withArticle(definition.type)} the base game defines`;

  if (precedence !== "first" && precedence !== "last") {
    return {
      ...base,
      severity: "warning",
      code: "replaces-vanilla-definition",
      message: `${what} as well, and the game keeps one of the two.`,
    };
  }

  const line: string = logged(
    precedence === "first" ? (firstDefinitionWins[definition.type] ?? "") : LAST_DEFINITION_LOG,
    definition.id,
  );
  const path: string | undefined = definitionFilePath(mod.options, definition);
  const slash: number = path === undefined ? -1 : path.lastIndexOf("/");
  const name: string = path === undefined ? "" : path.slice(slash + 1);
  const directory: string = path === undefined || slash < 0 ? "" : path.slice(0, slash);
  const dot: number = name.lastIndexOf(".");
  const extension: string = dot < 0 ? "" : name.slice(dot).toLowerCase();
  // Only the files the game reads the type from take part in the order.
  const others: readonly string[] = (vanillaFiles[directory] ?? []).filter((other) =>
    other.toLowerCase().endsWith(extension),
  );
  // A file that replaces one of the base game's takes its place in the order,
  // and what that file defined is gone with it: nothing here can say which
  // definition is then read first.
  const order: -1 | 0 | 1 =
    path === undefined || definition.overrides !== undefined || others.includes(name) || others.length === 0
      ? 0
      : readOrder(name, others);
  const kept: string = `the game keeps the ${precedence} ${definition.type} of an id it reads`;
  const where: string = `${path ?? name} is read ${order === -1 ? "before" : "after"} every file of the base game in ${directory}`;

  if (order === 0) {
    return {
      ...base,
      severity: "warning",
      code: "replaces-vanilla-definition",
      message: `${what}, and ${kept}: this one counts only if its file is read ${precedence === "first" ? "before" : "after"} the base game's file that defines ${definition.id}. Files are read in the order of their names.`,
    };
  }

  // Read on the side the game keeps: this one replaces the base game's.
  if ((precedence === "first") === (order === -1)) {
    return {
      ...base,
      severity: "warning",
      code: "replaces-vanilla-definition",
      message: `${what}; this replaces it, since ${where} and ${kept}. It logs "${line}".`,
    };
  }

  return {
    ...base,
    severity: "error",
    code: "ignored-vanilla-override",
    message:
      precedence === "first"
        ? `${what}, and ${kept}. ${where}, so this definition is dropped and the game logs "${line}". To replace the base game's, write it to a file whose name sorts before the base game's, such as defineIn("${definition.type}", "${nameReadFirst(name, others)}", …), or replace the file that defines it.`
        : `${what}, and ${kept}. ${where}, so the base game's definition is read over this one and the game logs "${line}". To replace the base game's, write it to a file whose name sorts after the base game's, as the default file's does.`,
  };
}

export function validate(mod: Mod, options: ValidationOptions = {}): readonly ValidationDiagnostic[] {
  const model: SchemaModel = options.model ?? schema;
  const languages: readonly string[] = options.languages ?? ["l_english"];
  const diagnostics: ValidationDiagnostic[] = [];
  const declared = new Set<string>(mod.definitions.map((definition) => `${definition.type}:${definition.id}`));
  // As the descriptor writes them: one separator, no trailing one.
  const hiddenDirectories: ReadonlySet<string> = new Set(
    (mod.options.replacePaths ?? []).map((path) => normalisedPath(path)),
  );
  const strings = new Map<string, Set<string>>();
  const seen = new Set<string>();

  // A replacement is a string the game reads like any other, only last.
  for (const set of [mod.localisation, mod.localisationReplacements]) {
    for (const [language, entries] of set) {
      const bucket: Set<string> = strings.get(language) ?? new Set<string>();
      for (const entry of entries) {
        bucket.add(entry.key);
      }
      strings.set(language, bucket);
    }
  }

  const localised = (language: string, key: string): boolean =>
    strings.get(language)?.has(key) === true || vanillaLocalisation().has(key);

  // A mod's own definitions generate modifiers exactly as vanilla's do: adding a
  // job called `my_job` brings `job_my_job_add` into existence, so the mod has to
  // be part of what the namespace is expanded over. What its raw files define
  // is its own as well.
  const parsedFiles: ReadonlyMap<string, Document> = parseRawFiles(mod.files);
  const ownIds: Record<string, string[]> = rawFileIds(model, parsedFiles);
  for (const [type, ids] of Object.entries(ownIds)) {
    for (const id of ids) {
      declared.add(`${type}:${id}`);
    }
  }
  for (const definition of mod.definitions) {
    (ownIds[definition.type] ??= []).push(definition.id);
  }
  const idsByType: Readonly<Record<string, readonly string[]>> = mergeIdsByType(vanillaIdsByType, ownIds);
  // An extracted enum is read off the game once; a mod that defines an event
  // chain brings its counters into existence the same way it brings modifiers.
  const ownEnumMembers: Readonly<Record<string, readonly string[]>> = withOwnEnumMembers(
    model,
    mod.definitions,
    parsedFiles,
  );
  const idSets = new Map<string, ReadonlySet<string>>();
  const loadContext: LoadCheckContext = {
    defines: (type: string, id: string): boolean => {
      let set: ReadonlySet<string> | undefined = idSets.get(type);
      if (set === undefined) {
        set = new Set(idsByType[type] ?? []);
        idSets.set(type, set);
      }
      return set.has(id);
    },
    ids: (type: string): readonly string[] => idsByType[type] ?? [],
    command: (family: "effect" | "trigger", name: string): boolean => engineCommandNames(model, family).has(name),
    // The modifiers the game defines itself, without the names read off the
    // keys of its strings: expanded only when a static modifier asks.
    modifier: (name: string): boolean => {
      engineModifiers ??= expandModifierNames(model.modifiers, idsByType);
      return engineModifiers.has(name.toLowerCase());
    },
  };
  let engineModifiers: ReadonlySet<string> | undefined;
  const modifiers: ReadonlySet<string> = expandModifierNames(model.modifiers, idsByType, vanillaModifierNames);

  const walker: Walker = {
    resolver: new SchemaResolver(model, {
      idsByType,
      modifierNames: modifiers,
      enumMembers: ownEnumMembers,
      scriptedParameters: vanillaScriptedParameters,
    }),
    model,
    modifiers,
    idsByType,
    declared,
    enumMembers: ownEnumMembers,
    macroKeys: new Set(model.policy.macros.map((macro) => macro.key.toLowerCase())),
    localised,
    languages,
    inVariant: () => false,
    noScope: undefined,
    scripted: new Map(
      mod.definitions
        .filter((definition) => definition.type === "scripted_effect" || definition.type === "scripted_trigger")
        .map((definition) => [`${definition.type.replace(/^scripted_/u, "")}:${definition.id}`, definition]),
    ),
    calling: new Set<string>(),
    unlocalised: new Set<string>(),
    diagnostics,
  };

  // The events fired with no scope at all: the ones only the on_actions the
  // game fires that way list, and that nothing else names.
  const firedWithoutScope: ReadonlyMap<string, readonly string[]> = scopelessEvents(
    onActionListings(mod.definitions),
    mentions(mod.definitions, mod.files),
  );

  for (const definition of mod.definitions) {
    const type: DefinitionType | undefined = model.definitionTypes.find(
      (candidate) => candidate.id === definition.type,
    );

    if (type === undefined) {
      diagnostics.push({
        severity: "error",
        code: "unknown-definition-type",
        message: `${definition.type} is not a definition type in the schema.`,
        definition: definition.id,
        path: "",
      });
      continue;
    }

    // Two definitions of the same id, of which the game keeps one. Unless it
    // merges them — a mod may well add to `on_game_start` from two places, and
    // every one of them runs.
    const identity: string = `${definition.type}:${definition.id}`;
    const precedence: DefinitionPrecedence = precedenceOf(type);

    if (seen.has(identity) && precedence !== "merged") {
      diagnostics.push({
        severity: "error",
        code: "duplicate-definition",
        message: duplicateMessage(definition, precedence),
        definition: definition.id,
        path: "",
      });
    }
    seen.add(identity);

    // Defining an id the base game already uses replaces its definition
    // wholesale where the game keeps the last one it reads, and does nothing
    // at all where it keeps the first and reads the base game's first.
    // Sometimes replacing is the point; it is never something to discover
    // afterwards. Except where the game merges instead — adding to
    // `on_game_start` is how a mod hooks the start of a game, and every mod
    // that does it correctly was being warned about it.
    // A directory named in `replace_path` is one the game reads no base-game
    // file from, so nothing of the base game's is left there to replace or to
    // be read first; `emit` says what hiding the directory costs.
    if (
      precedence !== "merged" &&
      !hiddenDirectories.has(definition.directory) &&
      (vanillaIdsByType[definition.type] ?? []).includes(definition.id)
    ) {
      diagnostics.push(vanillaOverride(mod, definition, precedence));
    }

    // An event id is `namespace.number`, and the file declares the namespace.
    // All 9,995 of vanilla's are; one without a namespace resolves to nothing.
    if (type.source.directory === "events" && !definition.id.includes(".")) {
      diagnostics.push({
        severity: "error",
        code: "unnamespaced-event",
        message: `${definition.id} needs a namespace: an event id is written \`namespace.number\`, and the file declares that namespace.`,
        definition: definition.id,
        path: "",
      });
    }

    // A country event and a planet event are the same type read on different
    // objects, and the variant is what says which.
    const variantScope = type.variants.find(
      (candidate) => candidate.id === definition.variant && typeof candidate.entryScope === "string",
    )?.entryScope;
    const scopeName: string | undefined =
      typeof variantScope === "string"
        ? variantScope
        : typeof type.entryScope === "string"
          ? type.entryScope
          : undefined;
    const firedBy: readonly string[] | undefined =
      definition.type === "event" && definition.blockKey === "event" ? firedWithoutScope.get(definition.id) : undefined;
    walker.noScope =
      firedBy === undefined
        ? undefined
        : `${definition.id} is fired only by ${firedBy.join(" and ")}, which ${firedBy.length === 1 ? "fires" : "fire"} it with none`;
    const entryScope: ScopeState =
      firedBy !== undefined
        ? { current: NO_SCOPE, root: NO_SCOPE, prev: NO_SCOPE, from: NO_SCOPE }
        : scopeName === undefined
          ? {}
          : { current: scopeName, root: scopeName };

    const root: BlockRules = walker.resolver.rulesForType(type);
    const subject: VariantSubject = variantSubject(definition);
    walker.inVariant = (variant: string): boolean => {
      const found = type.variants.find((candidate) => candidate.id === variant);
      return found !== undefined && variantHolds(found.when, subject);
    };
    walkBlock(walker, definition.id, "", root, definition.body, entryScope, comparesIn(root, false), root);

    // A field the game needs and the definition does not have. What counts as
    // needed is checked against vanilla itself — a requirement base-game content
    // violates is not one — so this fires only on a field every definition of
    // the type carries.
    const present = new Set<string>(entriesOf(definition.body).keyed.map(([key]) => key.toLowerCase()));

    // A tagged type carries its identity in a field the body does not hold:
    // `define` writes it, so the definition has it.
    if (definition.nameField !== undefined) {
      present.add(definition.nameField.toLowerCase());
    }

    for (const key of requiredKeys(type)) {
      if (!present.has(key.toLowerCase())) {
        diagnostics.push({
          severity: "error",
          code: "missing-field",
          message: `${definition.type} needs ${key}, and this definition has none.`,
          definition: definition.id,
          path: "",
        });
      }
    }

    // What the game's loader logs about this definition, and loads it anyway.
    if (loadCheckedTypes.has(definition.type)) {
      for (const finding of loadChecks(
        definition.type,
        definition.id,
        loadBlockOf(definition.body),
        loadContext,
        definition.blockKey ?? definition.id,
      )) {
        diagnostics.push({
          severity: "warning",
          code: finding.code,
          message: finding.message,
          definition: definition.id,
          path: finding.path,
        });
      }
    }

    // A missing string shows in-game as the raw key: easy to ship, easy to miss.
    for (const requirement of type.localisation) {
      if (
        !requirement.required ||
        requirement.source.kind !== "definition-id" ||
        !requirementApplies(type, requirement, subject)
      ) {
        continue;
      }

      const key: string = localisationKey(requirement.source.pattern, definition.id);

      for (const language of languages) {
        if (!localised(language, key) && firstMention(walker.unlocalised, definition.id, language, key)) {
          diagnostics.push({
            severity: "warning",
            code: "missing-localisation",
            message: `No ${language} string for ${key}; the game will show the key itself.`,
            definition: definition.id,
            path: "",
          });
        }
      }
    }
  }

  return diagnostics.sort(
    (left, right) =>
      compareOrdinal(left.definition, right.definition) ||
      compareOrdinal(left.path, right.path) ||
      compareOrdinal(left.code, right.code) ||
      compareOrdinal(left.message, right.message),
  );
}

export type { ValueRule };
