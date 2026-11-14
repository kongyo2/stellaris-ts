import { isScopeKey, isSyntacticKey, scopeEntryNames } from "./script-keys.js";
import type {
  DefinitionType,
  EntryRule,
  KeyRule,
  RuleSetDefinition,
  SchemaModel,
  ScopeChange,
  ScopeFrame,
  ScopeSlot,
  ScriptBlockValue,
  ScriptCommandDefinition,
  ValueRule,
} from "./ir.js";

/**
 * Resolves what a block accepts, at any depth.
 *
 * The schema is a tree of rules, and a definition is a tree of keys; checking
 * only the first level of either says nothing about the rest. Vanilla writes
 * 28,743 nested keys, and the first level is 6 of them — a mistake inside
 * `allow = { ... }` or `planet_modifier = { ... }` is exactly the mistake a mod
 * author makes, and exactly the one the game drops without a word.
 *
 * This walks down with the script. Given the rules that govern a block and one
 * key in it, {@link SchemaResolver.resolve} says whether the key is accepted and
 * which rules govern its value — so the caller can recurse.
 *
 * Nothing here reads the generated index: identifiers, modifier names, enum
 * members and scripted-call parameters are handed in, so `@kongyo2/stellaris-ts/schema`
 * does not pull the whole vanilla index in behind it.
 */

export type ScriptFamily = ScriptBlockValue["family"];

/**
 * A call to a scripted trigger or effect.
 *
 * `no_resource_for_component = { RESOURCE = energy }` is not a trigger block:
 * the keys are the `$RESOURCE$` substitutions the callee declares. Passing a
 * name it does not declare compiles, loads, and does nothing.
 */
export interface ScriptedCallValue {
  readonly kind: "scripted-call";
  readonly family: "effect" | "trigger";
  readonly callee: string;
}

export type ResolvedValue = ScriptedCallValue | ValueRule;

/**
 * A variant a rule was declared under: `whenVariant` includes its rules for
 * the definitions in the variant, `unlessVariant` for the ones outside it.
 */
export interface VariantCondition {
  readonly variant: string;
  readonly mode: "include" | "exclude";
}

export interface ResolverData {
  /** Identifiers per definition type: vanilla's, plus the mod's own when validating. */
  readonly idsByType: Readonly<Record<string, readonly string[]>>;
  /** Every modifier name, already expanded and lowercased. */
  readonly modifierNames: ReadonlySet<string>;
  /** Members of the enums whose values live in the game files. */
  readonly enumMembers: Readonly<Record<string, readonly string[]>>;
  /** The `$PARAM$` names each scripted trigger or effect declares, by id. */
  readonly scriptedParameters?: Readonly<Record<string, readonly string[]>>;
}

interface PatternEntry {
  readonly prefix: string;
  readonly suffix: string;
  readonly value: ValueRule;
  readonly comparable: boolean;
}

interface TypeKeyEntry {
  readonly type: string;
  readonly value: ValueRule;
  readonly comparable: boolean;
}

interface NumericEntry {
  readonly integer: boolean;
  readonly value: ValueRule;
  readonly comparable: boolean;
}

export interface BlockRules {
  /** Scope changes the rules attach to particular keys. */
  readonly scopeChanges: ReadonlyMap<string, ScopeChange>;
  /** Some rule here accepts arbitrary keys, so nothing can be reported unknown. */
  readonly wildcard: boolean;
  /**
   * The variants each value rule was declared under, for a rule declared
   * inside one.
   *
   * Every variant's rules are accepted, because which variant a definition is
   * depends on its body and narrowing would reject script the game loads. What
   * a value *means* can still depend on it: a hidden event's `title` is any
   * word and is never shown, every other event's is the key of the string its
   * window shows, and a check that reads the union reads neither.
   */
  readonly conditions: ReadonlyMap<ResolvedValue, readonly VariantCondition[]>;
  /**
   * Some rule here takes a localisation key as its key: each stage of a
   * situation is written under the key of its own name, and the game looks that
   * key up.
   */
  readonly localisationKeys: boolean;
  /** No rule here describes a block at all: a block written here is a shape error. */
  readonly scalarOnly: boolean;
  readonly scopeKeys: boolean;
  readonly parameters: boolean;
  readonly literals: ReadonlyMap<string, readonly ResolvedValue[]>;
  readonly patterns: readonly PatternEntry[];
  readonly typeKeys: readonly TypeKeyEntry[];
  readonly numerics: readonly NumericEntry[];
  readonly modifierValues: readonly ValueRule[];
  /**
   * What a key holds when the only rule that takes it is one that takes any
   * key: each entry of `common/species_names` is written under a name of the
   * author's choosing, and every one of them is the same block of `name`,
   * `plural` and `name_list`. The key is open; what it holds is not.
   */
  readonly wildcardValues: readonly ValueRule[];
  /**
   * Some rule here takes the block whatever it holds: `x | { any = number }`
   * is satisfied by anything, so what the second arm says a key holds
   * constrains nothing.
   */
  readonly unconstrained: boolean;
  readonly families: ReadonlySet<ScriptFamily>;
  readonly ruleSetFamilies: ReadonlySet<string>;
  readonly items: readonly ValueRule[];
  /**
   * The literal keys some rule here declares with a comparison, lower-cased as
   * well as written.
   *
   * The reader keeps an assignment's operator apart from its value, and a key
   * whose handler never asks for it reads `energy > 500` as `energy = 500`. A
   * rule declared `==` is one whose key the game compares.
   */
  readonly comparisons: ReadonlySet<string>;
  /**
   * Keys every declaration of this block demands, at this depth.
   *
   * Only the ones that are unconditionally part of the block: a field inside a
   * variant or one arm of a choice is not counted, because whether it applies
   * depends on what else the body says. `requiredKeys()` answers the same
   * question for a definition's top level and this answers it everywhere else,
   * which is where a rule demanding a key the game does not need had been
   * invisible.
   */
  readonly required: readonly string[];
}

export interface KeyResolution {
  readonly accepted: boolean;
  /** The rules governing this key's value, for recursing into a block. */
  readonly values: readonly ResolvedValue[];
  /** The commands this key matched, for checking the scope they accept. */
  readonly commands: readonly ScriptCommandDefinition[];
  /** How the block under this key is scoped, when the key says. */
  readonly scope?: ScopeTransition;
  /**
   * The key itself names a string: nothing here matched it but a rule that
   * takes a localisation key where a key belongs.
   */
  readonly localisationKey?: boolean;
  /**
   * Whether some rule this key matched is declared with a comparison, or
   * nothing here is specific enough to say: a key accepted only because the
   * block takes any key could be one that compares.
   */
  readonly comparable: boolean;
}

/**
 * Where the block under a key runs.
 *
 * A trigger reads one kind of object and no other: `has_country_flag` reads a
 * country. Writing it under `owner = { ... }` from a planet is correct and
 * writing it directly is not, and the game answers a wrongly-scoped trigger with
 * `false` for ever rather than with an error.
 */
export type ScopeTransition =
  | { readonly kind: "enter"; readonly scope: string }
  | { readonly kind: "frame"; readonly word: string }
  | { readonly kind: "replace"; readonly frame: ScopeFrame }
  | { readonly kind: "unknown" };

/** What each of the frame words refers to while walking. */
export interface ScopeState {
  readonly current?: string | undefined;
  readonly root?: string | undefined;
  readonly prev?: string | undefined;
  readonly from?: string | undefined;
}

const FRAME_WORDS: ReadonlySet<string> = new Set([
  "this",
  "root",
  "prev",
  "prevprev",
  "prevprevprev",
  "prevprevprevprev",
  "from",
  "fromfrom",
  "fromfromfrom",
  "fromfromfromfrom",
]);

function frameScope(state: ScopeState, word: string): string | undefined {
  switch (word) {
    case "this":
      return state.current;
    case "root":
      return state.root;
    case "prev":
      return state.prev;
    case "from":
      return state.from;
    default:
      // `prevprev` and the deeper `from` words need a stack this does not keep;
      // reporting nothing is right, guessing is not.
      return undefined;
  }
}

/**
 * What a value naming a frame points at: `root`, `this`, `prev` or `from`, alone
 * or at the head of a chain (`root.owner` starts at `root`).
 *
 * `undefined` when the value does not start with one of those, or the scope it
 * names is not known here.
 */
export function frameOf(state: ScopeState, value: string): string | undefined {
  const head: string = (value.split(".")[0] ?? value).toLowerCase();
  return FRAME_WORDS.has(head) ? frameScope(state, head) : undefined;
}

/**
 * The scope a block runs in, given the one around it.
 *
 * Anything the transition does not pin down comes back with no `current`, and a
 * check that does not know the scope reports nothing.
 */
/**
 * The value rules that apply to one definition, given which variants it is in.
 *
 * A rule declared under no variant always applies; one declared under a
 * variant applies when the definition is in it (`include`) or outside it
 * (`exclude`), at every level of nesting it was declared at.
 */
export function valuesFor(
  rules: BlockRules,
  values: readonly ResolvedValue[],
  inVariant: (variant: string) => boolean,
): readonly ResolvedValue[] {
  return values.filter((value) =>
    (rules.conditions.get(value) ?? []).every((condition) =>
      condition.mode === "include" ? inVariant(condition.variant) : !inVariant(condition.variant),
    ),
  );
}

export function applyScope(state: ScopeState, transition: ScopeTransition | undefined): ScopeState {
  if (transition === undefined) {
    return state;
  }

  switch (transition.kind) {
    case "enter":
      return { current: transition.scope, root: state.root, prev: state.current, from: state.from };
    case "frame": {
      const target: string | undefined = frameScope(state, transition.word);
      return target === undefined
        ? { root: state.root, prev: state.current, from: state.from }
        : { current: target, root: state.root, prev: state.current, from: state.from };
    }
    case "replace": {
      const pick = (slot: ScopeSlot | undefined): string | undefined => (typeof slot === "string" ? slot : undefined);
      return {
        current: pick(transition.frame.current),
        root: pick(transition.frame.root),
        prev: pick(transition.frame.previous),
        from: pick(transition.frame.from),
      };
    }
    default:
      return { root: state.root, prev: state.current, from: state.from };
  }
}

interface Draft {
  readonly scopeChanges: Map<string, ScopeChange>;
  readonly conditions: Map<ResolvedValue, readonly VariantCondition[]>;
  wildcard: boolean;
  localisationKeys: boolean;
  scopeKeys: boolean;
  parameters: boolean;
  sawBlockRule: boolean;
  readonly literals: Map<string, ResolvedValue[]>;
  readonly patterns: PatternEntry[];
  readonly typeKeys: TypeKeyEntry[];
  readonly numerics: NumericEntry[];
  readonly modifierValues: ValueRule[];
  readonly wildcardValues: ValueRule[];
  unconstrained: boolean;
  readonly families: Set<ScriptFamily>;
  readonly ruleSetFamilies: Set<string>;
  readonly items: ValueRule[];
  readonly requiredMinimums: Map<string, number>;
  readonly comparisons: Set<string>;
}

const ANY: ValueRule = { kind: "any-value" };
const FORBIDDEN: ValueRule = { kind: "opaque", reason: "forbidden" };
const NUMBER: ValueRule = { kind: "primitive", type: "number" };

function draft(): Draft {
  return {
    requiredMinimums: new Map<string, number>(),
    scopeChanges: new Map<string, ScopeChange>(),
    conditions: new Map<ResolvedValue, readonly VariantCondition[]>(),
    wildcard: false,
    localisationKeys: false,
    scopeKeys: false,
    parameters: false,
    sawBlockRule: false,
    literals: new Map<string, ResolvedValue[]>(),
    patterns: [],
    typeKeys: [],
    numerics: [],
    modifierValues: [],
    wildcardValues: [],
    unconstrained: false,
    families: new Set<ScriptFamily>(),
    ruleSetFamilies: new Set<string>(),
    items: [],
    comparisons: new Set<string>(),
  };
}

function asTransition(change: ScopeChange | undefined): ScopeTransition | undefined {
  if (change === undefined) {
    return undefined;
  }

  if (change.kind === "enter") {
    return typeof change.scope === "string" ? { kind: "enter", scope: change.scope } : { kind: "unknown" };
  }

  return { kind: "replace", frame: change.frame };
}

function addLiteral(into: Draft, key: string, value: ResolvedValue): void {
  const bucket: ResolvedValue[] = into.literals.get(key) ?? [];
  bucket.push(value);
  into.literals.set(key, bucket);
}

/** Whether a value rule can describe the inside of a block. */
function describesBlock(value: ResolvedValue): boolean {
  switch (value.kind) {
    case "block":
    case "choice":
    case "list":
    case "script-block":
    case "rule-set-reference":
    case "any-value":
    case "opaque":
    case "scripted-call":
      return true;
    default:
      return false;
  }
}

/**
 * Whether the game compares what is written in a block of these rules.
 *
 * A trigger compares — `num_owned_planets > 1` is what it is for. An effect
 * does not: the reader keeps an assignment's operator apart from its value, and
 * the handlers behind `add_resource`, `add_modifier`'s `days` and
 * `spawn_system`'s distances take the value and never ask for the operator, so
 * `add_resource = { energy > 500 }` adds 500. A block that is neither — a
 * definition body, a modifier block, a trigger's own argument block such as
 * `check_variable = { value > 2 }` — answers as the block around it does.
 */
export function comparesIn(rules: BlockRules, around: boolean): boolean {
  if (rules.families.has("trigger")) {
    return true;
  }
  return rules.families.has("effect") ? false : around;
}

/**
 * The keys a definition of this type must carry.
 *
 * Only what the type says outside a variant: a rule inside `whenVariant` applies
 * to some definitions and not others, and deciding which needs the body. A key
 * counts as required only when *every* declaration of it demands one — the
 * corpus declares a key several times for its alternative value shapes, and one
 * optional declaration makes the key optional.
 */
export function requiredKeys(type: DefinitionType): readonly string[] {
  const minimums = new Map<string, number>();

  for (const entry of type.entries) {
    if (entry.kind !== "field" || typeof entry.key !== "string") {
      continue;
    }

    const seen: number | undefined = minimums.get(entry.key);
    minimums.set(entry.key, seen === undefined ? entry.occurrence.min : Math.min(seen, entry.occurrence.min));
  }

  return [...minimums]
    .filter(([, min]) => min >= 1)
    .map(([key]) => key)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export class SchemaResolver {
  readonly #model: SchemaModel;
  readonly #data: ResolverData;
  readonly #scopeNames: ReadonlySet<string>;
  readonly #commands = new Map<ScriptFamily, Map<string, ValueRule[]>>();
  readonly #commandDefinitions = new Map<ScriptFamily, Map<string, ScriptCommandDefinition[]>>();
  readonly #keyedCommands = new Map<ScriptFamily, ScriptCommandDefinition[]>();
  readonly #ruleSets = new Map<string, Map<string, ValueRule[]>>();
  /** The rule-set names declared with a comparison, per family, lower-cased. */
  readonly #comparedRuleSets = new Map<string, Set<string>>();
  readonly #openRuleSets = new Set<string>();
  readonly #idSets = new Map<string, ReadonlySet<string>>();
  readonly #entryCache = new WeakMap<readonly EntryRule[], BlockRules>();
  readonly #valueCache = new WeakMap<object, BlockRules>();

  constructor(model: SchemaModel, data: ResolverData) {
    this.#model = model;
    this.#data = data;
    this.#scopeNames = scopeEntryNames(model);

    for (const command of model.commands) {
      if (command.key !== undefined) {
        const keyed: ScriptCommandDefinition[] = this.#keyedCommands.get(command.family) ?? [];
        keyed.push(command);
        this.#keyedCommands.set(command.family, keyed);
        continue;
      }

      let bucket: Map<string, ValueRule[]> | undefined = this.#commands.get(command.family);
      if (bucket === undefined) {
        bucket = new Map<string, ValueRule[]>();
        this.#commands.set(command.family, bucket);
      }
      const name: string = command.id.toLowerCase();
      const values: ValueRule[] = bucket.get(name) ?? [];
      values.push(command.value);
      bucket.set(name, values);

      let definitions: Map<string, ScriptCommandDefinition[]> | undefined = this.#commandDefinitions.get(
        command.family,
      );
      if (definitions === undefined) {
        definitions = new Map<string, ScriptCommandDefinition[]>();
        this.#commandDefinitions.set(command.family, definitions);
      }
      const list: ScriptCommandDefinition[] = definitions.get(name) ?? [];
      list.push(command);
      definitions.set(name, list);
    }

    for (const ruleSet of model.ruleSets) {
      if (ruleSet.name === undefined || ruleSet.name.length === 0) {
        this.#openRuleSets.add(ruleSet.family);
        continue;
      }

      let bucket: Map<string, ValueRule[]> | undefined = this.#ruleSets.get(ruleSet.family);
      if (bucket === undefined) {
        bucket = new Map<string, ValueRule[]>();
        this.#ruleSets.set(ruleSet.family, bucket);
      }
      const name: string = ruleSet.name.toLowerCase();
      const values: ValueRule[] = bucket.get(name) ?? [];
      values.push(ruleSet.value);
      bucket.set(name, values);

      if (ruleSet.operator !== "=") {
        const compared: Set<string> = this.#comparedRuleSets.get(ruleSet.family) ?? new Set<string>();
        compared.add(name);
        this.#comparedRuleSets.set(ruleSet.family, compared);
      }
    }
  }

  /** The rules that govern the body of one definition. */
  rulesForType(type: DefinitionType): BlockRules {
    const cached: BlockRules | undefined = this.#entryCache.get(type.entries);

    if (cached !== undefined) {
      return cached;
    }

    const built: BlockRules = this.#rulesFromEntries(type.entries);
    this.#entryCache.set(type.entries, built);
    return built;
  }

  /** The rules that govern the inside of a block whose value these rules describe. */
  rulesForValues(values: readonly ResolvedValue[]): BlockRules {
    const single: ResolvedValue | undefined = values.length === 1 ? values[0] : undefined;
    const cacheable: boolean = single !== undefined && single.kind !== "scripted-call";

    if (cacheable && single !== undefined) {
      const cached: BlockRules | undefined = this.#valueCache.get(single);
      if (cached !== undefined) {
        return cached;
      }
    }

    const into: Draft = draft();
    // A key with several value rules is satisfied by one of them, so none of
    // their fields is required of the block. `size` is `{ x y }` under one rule
    // and `{ width height }` under another; requiring both sets would report
    // every `size` in the game as incomplete.
    const alternatives: boolean = values.length > 1;
    for (const value of values) {
      this.#collectValue(value, into, alternatives);
    }
    const built: BlockRules = this.#finish(into);

    if (cacheable && single !== undefined) {
      this.#valueCache.set(single, built);
    }

    return built;
  }

  /** Whether one key is accepted here, and what governs its value. */
  resolve(rules: BlockRules, key: string): KeyResolution {
    // `@size` declares a script variable and `$PARAM$` is substituted before the
    // block is read; neither is a field of anything.
    if (isSyntacticKey(key)) {
      return { accepted: true, values: [], commands: [], comparable: true };
    }

    const values: ResolvedValue[] = [];
    const commands: ScriptCommandDefinition[] = [];
    let transition: ScopeTransition | undefined = rules.scopeChanges.has(key)
      ? asTransition(rules.scopeChanges.get(key))
      : undefined;
    let accepted: boolean = rules.wildcard;
    const lowered: string = key.toLowerCase();
    // A block that takes any key cannot say which of them compare, so a key
    // there is given the benefit of the doubt.
    let comparable: boolean = rules.wildcard || rules.comparisons.has(key) || rules.comparisons.has(lowered);

    const direct: readonly ResolvedValue[] | undefined = rules.literals.get(key) ?? rules.literals.get(lowered);
    if (direct !== undefined) {
      accepted = true;
      values.push(...direct);
    }

    for (const family of rules.families) {
      // Command names are matched without regard to case: `OR` is declared and
      // vanilla writes both `OR` and `or`.
      const command: readonly ValueRule[] | undefined = this.#commands.get(family)?.get(lowered);
      if (command !== undefined) {
        accepted = true;
        values.push(...command);

        for (const definition of this.#commandDefinitions.get(family)?.get(lowered) ?? []) {
          commands.push(definition);
          transition ??= asTransition(definition.scope);
          comparable ||= definition.operator !== "=";
        }
      }

      for (const keyed of this.#keyedCommands.get(family) ?? []) {
        if (keyed.key !== undefined && this.#matchesKey(keyed.key, key, lowered)) {
          accepted = true;
          values.push(this.#valueForKey(keyed.key, key, family, keyed.value));
          comparable ||= keyed.operator !== "=";
        }
      }

      // A modifier block is keyed by modifier name, and those are a namespace of
      // their own — generated from definitions rather than declared. The family
      // also has a few declared keys of its own, handled above: a modifier block
      // carries `custom_tooltip` and `show_if_not_potential` beside the numbers.
      if (family === "modifier") {
        if (this.#data.modifierNames.size === 0) {
          accepted = true;
        } else if (this.#data.modifierNames.has(lowered) || this.#isStaticModifier(key)) {
          accepted = true;
          values.push({ kind: "primitive", type: "number" });
        }
        continue;
      }

      // A scope name enters that scope and runs the same kind of block there.
      if ((family === "trigger" || family === "effect") && this.#isScopeEntry(key)) {
        accepted = true;
        values.push({ kind: "script-block", family });
        transition ??= this.#scopeEntryTransition(key);
      }
    }

    for (const family of rules.ruleSetFamilies) {
      if (this.#openRuleSets.has(family)) {
        accepted = true;
        comparable = true;
        continue;
      }
      const found: readonly ValueRule[] | undefined = this.#ruleSets.get(family)?.get(lowered);
      if (found !== undefined) {
        accepted = true;
        values.push(...found);
        comparable ||= this.#comparedRuleSets.get(family)?.has(lowered) === true;
      }
    }

    for (const entry of rules.typeKeys) {
      if (this.#idsOf(entry.type).has(key)) {
        accepted = true;
        values.push(entry.value);
        comparable ||= entry.comparable;
      }
    }

    if (rules.modifierValues.length > 0 && (this.#data.modifierNames.has(lowered) || this.#isStaticModifier(key))) {
      accepted = true;
      values.push(...rules.modifierValues);
    }

    if (rules.numerics.length > 0 && /^-?\d+(?:\.\d+)?$/u.test(key)) {
      const integer: boolean = !key.includes(".");
      for (const entry of rules.numerics) {
        if (integer || !entry.integer) {
          accepted = true;
          values.push(entry.value);
          comparable ||= entry.comparable;
        }
      }
    }

    for (const pattern of rules.patterns) {
      if (
        key.length >= pattern.prefix.length + pattern.suffix.length &&
        key.startsWith(pattern.prefix) &&
        key.endsWith(pattern.suffix)
      ) {
        accepted = true;
        values.push(pattern.value);
        comparable ||= pattern.comparable;
      }
    }

    if (!accepted && rules.scopeKeys && this.#isScopeEntry(key)) {
      accepted = true;
    }

    // Accepted for no reason but that the block takes a localisation key: the
    // key is a string's name, and nothing more specific claimed it.
    const localisationKey: boolean = rules.localisationKeys && values.length === 0 && commands.length === 0;

    // Claimed by nothing but a rule that takes any key: what that rule says a
    // key holds is what this one holds. Dropping it left every block written
    // under a name of the author's choosing unread — nothing inside an entry
    // of `common/species_names` was checked, not even the name list it names.
    // A key a literal rule forbids is claimed, and holds nothing.
    if (
      values.length === 0 &&
      commands.length === 0 &&
      direct === undefined &&
      rules.wildcardValues.length > 0 &&
      !rules.unconstrained
    ) {
      values.push(...rules.wildcardValues);
    }

    return {
      accepted,
      values,
      commands,
      comparable,
      ...(transition === undefined ? {} : { scope: transition }),
      ...(localisationKey ? { localisationKey } : {}),
    };
  }

  /**
   * Where a chained scope key lands.
   *
   * Only a single, unambiguous step is followed: `owner` goes to a country, a
   * chain or a run-time lookup goes nowhere this can name, and a link the
   * documentation leaves open stays open.
   */
  #scopeEntryTransition(key: string): ScopeTransition {
    const withoutOptional: string = key.endsWith("?") ? key.slice(0, -1) : key;
    const lowered: string = withoutOptional.toLowerCase();

    if (lowered.includes(".") || lowered.includes(":")) {
      return { kind: "unknown" };
    }

    if (FRAME_WORDS.has(lowered)) {
      return { kind: "frame", word: lowered };
    }

    for (const link of this.#model.links) {
      if (link.kind === "scope-link" && link.id.toLowerCase() === lowered) {
        return link.output.kind === "fixed-scope" &&
          link.output.scopes.length === 1 &&
          link.output.scopes[0] !== undefined
          ? { kind: "enter", scope: link.output.scopes[0] }
          : { kind: "unknown" };
      }
    }

    for (const scope of this.#model.scopes) {
      if (scope.id.toLowerCase() === lowered || scope.aliases.some((alias) => alias.toLowerCase() === lowered)) {
        return { kind: "enter", scope: scope.id };
      }
    }

    return { kind: "unknown" };
  }

  /** The keys this block would accept as a parameter of a scripted call. */
  parametersOf(family: "effect" | "trigger", callee: string): readonly string[] | undefined {
    const table: Readonly<Record<string, readonly string[]>> | undefined = this.#data.scriptedParameters;

    if (table === undefined) {
      return undefined;
    }

    return table[`${family === "trigger" ? "scripted_trigger" : "scripted_effect"}:${callee}`];
  }

  #isScopeEntry(key: string): boolean {
    return isScopeKey(this.#model, key, this.#scopeNames);
  }

  /**
   * A static modifier is a key in a modifier block as well as a modifier is.
   *
   * The reader of a modifier block (`0x36db20` in the 4.5.2 executable) looks
   * the key up among the static modifiers first and applies the one it finds,
   * scaled by the value; only a key that names none is read as a modifier.
   * The base game writes `artisan_jobs_bonus_workforce_mult = 0.10` in a
   * building's `planet_modifier`, and that name is one of the 24 static
   * modifiers of `24_static_modifiers_jobs.txt`, in no modifier list the game
   * prints.
   */
  #isStaticModifier(key: string): boolean {
    return this.#idsOf("static_modifier").has(key);
  }

  #idsOf(type: string): ReadonlySet<string> {
    let set: ReadonlySet<string> | undefined = this.#idSets.get(type);

    if (set === undefined) {
      set = new Set(this.#data.idsByType[type] ?? []);
      this.#idSets.set(type, set);
    }

    return set;
  }

  #enumMembers(id: string): readonly string[] {
    const definition = this.#model.enums.find((candidate) => candidate.id === id);

    if (definition === undefined) {
      return [];
    }

    return definition.kind === "static-enum" ? definition.values : (this.#data.enumMembers[id] ?? []);
  }

  #matchesKey(key: KeyRule, raw: string, lowered: string): boolean {
    if (typeof key === "string") {
      return key === raw;
    }

    switch (key.kind) {
      case "enum-key":
        return this.#enumMembers(key.enum).some((member) => member.toLowerCase() === lowered);
      case "modifier-key":
        return this.#data.modifierNames.has(lowered) || this.#isStaticModifier(raw);
      case "numeric-key":
        return /^-?\d+(?:\.\d+)?$/u.test(raw) && (!key.integer || !raw.includes("."));
      case "type-key":
        return this.#idsOf(key.type).has(raw);
      case "pattern-key":
        return (
          raw.length >= key.prefix.length + key.suffix.length && raw.startsWith(key.prefix) && raw.endsWith(key.suffix)
        );
      default:
        return false;
    }
  }

  /**
   * A call to a scripted trigger or effect takes parameters, not commands.
   *
   * The rule in the corpus says as much, but only in the abstract. Naming the
   * callee is what lets a wrong parameter be reported: the names come from the
   * `$NAME$` markers in its body.
   */
  #valueForKey(key: KeyRule, raw: string, family: ScriptFamily, fallback: ValueRule): ResolvedValue {
    if (
      typeof key !== "string" &&
      key.kind === "type-key" &&
      (family === "trigger" || family === "effect") &&
      (key.type === "scripted_trigger" || key.type === "scripted_effect")
    ) {
      return { kind: "scripted-call", family, callee: raw };
    }

    return fallback;
  }

  #rulesFromEntries(entries: readonly EntryRule[]): BlockRules {
    const into: Draft = draft();

    for (const entry of entries) {
      this.#collectEntry(entry, into);
    }

    return this.#finish(into);
  }

  #finish(into: Draft): BlockRules {
    // `inline_script = { script = x }` injects script into any block the game
    // parses, so it is a key everywhere.
    for (const macro of this.#model.policy.macros) {
      addLiteral(into, macro.key, ANY);
    }

    // Keys are matched without regard to case, everywhere, because the engine
    // does: vanilla writes `TRIGGER = { ... }` inside an event option, `KEY` in
    // a special project whose rules say `key`, and `texturefile` beside
    // `textureFile` in 6,295 interface files. All of it loads.
    for (const [name, values] of [...into.literals]) {
      const lower: string = name.toLowerCase();
      if (lower !== name && !into.literals.has(lower)) {
        into.literals.set(lower, values);
      }
    }

    for (const name of [...into.comparisons]) {
      into.comparisons.add(name.toLowerCase());
    }

    const hasKeySource: boolean =
      into.wildcard ||
      into.literals.size > this.#model.policy.macros.length ||
      into.patterns.length > 0 ||
      into.typeKeys.length > 0 ||
      into.numerics.length > 0 ||
      into.modifierValues.length > 0 ||
      into.families.size > 0 ||
      into.ruleSetFamilies.size > 0 ||
      into.parameters ||
      into.scopeKeys;

    return {
      wildcard: into.wildcard || into.parameters,
      conditions: into.conditions,
      localisationKeys: into.localisationKeys,
      scopeChanges: into.scopeChanges,
      scalarOnly: !into.sawBlockRule && !hasKeySource && into.items.length === 0,
      scopeKeys: into.scopeKeys,
      parameters: into.parameters,
      literals: into.literals,
      patterns: into.patterns,
      typeKeys: into.typeKeys,
      numerics: into.numerics,
      modifierValues: into.modifierValues,
      wildcardValues: into.wildcardValues,
      unconstrained: into.unconstrained,
      families: into.families,
      ruleSetFamilies: into.ruleSetFamilies,
      items: into.items,
      comparisons: into.comparisons,
      required: [...into.requiredMinimums]
        .filter(([, minimum]) => minimum >= 1)
        .map(([key]) => key)
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    };
  }

  #collectEntry(
    entry: EntryRule,
    into: Draft,
    conditional = false,
    conditions: readonly VariantCondition[] = [],
  ): void {
    switch (entry.kind) {
      case "field":
        if (entry.scope !== undefined && typeof entry.key === "string") {
          into.scopeChanges.set(entry.key, entry.scope);
          into.scopeChanges.set(entry.key.toLowerCase(), entry.scope);
        }

        // A key counts as required only when every declaration of it demands
        // one, matching `requiredKeys`. Conditional declarations are skipped
        // entirely rather than counted as optional, so a variant that needs a
        // key does not make it required for bodies that chose another variant.
        if (!conditional && typeof entry.key === "string") {
          const seen: number | undefined = into.requiredMinimums.get(entry.key);
          into.requiredMinimums.set(
            entry.key,
            seen === undefined ? entry.occurrence.min : Math.min(seen, entry.occurrence.min),
          );
        }
        // A rule that forbids the key describes no value. The key stays
        // accepted, because another variant of the same type may allow it, but
        // its `scalar` stand-in must not join what the value may be: one such
        // rule beside `picture = <sprite>` is enough to stop the reference from
        // being checked at all.
        this.#collectKey(entry.key, entry.occurrence.max === 0 ? undefined : entry.value, into, entry.operator !== "=");
        if (conditions.length > 0) {
          into.conditions.set(entry.value, conditions);
        }
        return;
      case "item":
        into.items.push(entry.value);
        return;
      case "variant-rules":
        // Which variant applies depends on the body, so every variant's rules
        // are accepted. Narrowing would reject script the game loads.
        for (const child of entry.entries) {
          this.#collectEntry(child, into, true, [...conditions, { variant: entry.variant, mode: entry.mode }]);
        }
        return;
      case "script-entries":
        into.families.add(entry.family);
        return;
      case "rule-set-entries":
        into.ruleSetFamilies.add(entry.family);
        return;
      default:
        return;
    }
  }

  #collectKey(key: KeyRule, rule: ValueRule | undefined, into: Draft, comparable = false): void {
    const value: ValueRule = rule ?? FORBIDDEN;

    if (typeof key === "string") {
      if (rule === undefined) {
        // Registered as a key without a value, so it is neither unknown nor a
        // claim about what may be written there.
        if (!into.literals.has(key)) {
          into.literals.set(key, []);
        }
        return;
      }
      addLiteral(into, key, value);
      if (comparable) {
        into.comparisons.add(key);
      }
      return;
    }

    if (rule === undefined) {
      return;
    }

    switch (key.kind) {
      case "enum-key": {
        const members: readonly string[] = this.#enumMembers(key.enum);
        if (members.length === 0) {
          into.wildcard = true;
          into.wildcardValues.push(value);
          return;
        }
        for (const member of members) {
          addLiteral(into, member, value);
          if (comparable) {
            into.comparisons.add(member);
          }
        }
        return;
      }
      case "pattern-key":
        into.patterns.push({ prefix: key.prefix, suffix: key.suffix, value, comparable });
        return;
      case "type-key":
        into.typeKeys.push({ type: key.type, value, comparable });
        return;
      case "numeric-key":
        into.numerics.push({ integer: key.integer, value, comparable });
        return;
      case "modifier-key":
        into.modifierValues.push(value);
        return;
      case "scope-key":
      case "scope-group-key":
        into.scopeKeys = true;
        return;
      case "parameter-key":
        into.parameters = true;
        return;
      case "primitive-key":
        // A file path, a localisation key or a number written where a key
        // belongs: the set is open, so the value rule is what matters.
        into.wildcard = true;
        into.localisationKeys ||= key.type === "localisation";
        into.wildcardValues.push(value);
        return;
      case "rule-set-key":
        into.ruleSetFamilies.add(key.family);
        return;
      default:
        // any-key, value-set-key, named-value-key, rule-set-keys-field-key: all
        // stand for sets no rule enumerates. What a key of the set holds is
        // still what the rule says it holds.
        into.wildcard = true;
        into.wildcardValues.push(value);
    }
  }

  #collectValue(value: ResolvedValue, into: Draft, conditional = false): void {
    if (describesBlock(value)) {
      into.sawBlockRule = true;
    }

    switch (value.kind) {
      case "block":
        for (const entry of value.entries) {
          this.#collectEntry(entry, into, conditional);
        }
        return;
      case "choice":
        // One arm's requirements are not the block's: `x | { a = 1 }` does not
        // make `a` required of everything written under the key.
        for (const choice of value.choices) {
          this.#collectValue(choice, into, true);
        }
        return;
      case "list":
        into.items.push(value.item);
        return;
      case "script-block":
        into.families.add(value.family);
        return;
      case "rule-set-reference":
        if (value.name === undefined) {
          into.ruleSetFamilies.add(value.family);
          return;
        }
        {
          // Several rule sets can share a name — `size` is `{ x y }` in one and
          // `{ width height }` in another — and a body satisfies one of them,
          // not all. Their fields are still all accepted, but none of them is
          // required, or every `size = { width … }` in the game would be
          // reported as missing an `x`.
          const named: readonly RuleSetDefinition[] = this.#namedRuleSets(value.family, value.name);
          for (const rule of named) {
            this.#collectValue(rule.value, into, conditional || named.length > 1);
          }
        }
        return;
      case "scripted-call": {
        const parameters: readonly string[] | undefined = this.parametersOf(value.family, value.callee);
        if (parameters === undefined) {
          into.wildcard = true;
          into.unconstrained = true;
          return;
        }
        for (const parameter of parameters) {
          addLiteral(into, parameter, ANY);
        }
        return;
      }
      case "any-value":
      case "opaque":
        into.wildcard = true;
        into.unconstrained = true;
        return;
      case "primitive":
        // A colour is a block of numbers — `color = { 255 0 255 255 }`, as
        // every one of the 88 in `common/named_colors` is written — as well as
        // `rgb { … }`, so a block is a shape the rule takes.
        if (value.type === "colour") {
          into.sawBlockRule = true;
          into.items.push(NUMBER);
        }
        return;
      default:
        return;
    }
  }

  #namedRuleSets(family: string, name: string): readonly RuleSetDefinition[] {
    return this.#model.ruleSets.filter((rule) => rule.family === family && rule.name === name);
  }
}
