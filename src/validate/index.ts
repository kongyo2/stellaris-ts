import {
  extractedEnumMembers,
  vanillaIdsByType,
  vanillaModifierNames,
  vanillaScriptedParameters,
} from "../generated/vanilla/index.js";
import type { Mod } from "../runtime/mod.js";
import { isBare, isCompared, isEntries, isRaw, isRepeated } from "../runtime/values.js";
import { schema } from "../schema/index.js";
import { expandModifierNames, mergeIdsByType } from "../schema/modifier-namespace.js";
import {
  applyScope,
  requiredKeys,
  SchemaResolver,
  type BlockRules,
  type KeyResolution,
  type ResolvedValue,
  type ScopeState,
} from "../schema/resolve.js";
import type { DefinitionType, EnumDefinition, SchemaModel, ValueRule } from "../schema/ir.js";

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
  readonly diagnostics: ValidationDiagnostic[];
}

function enumMembers(model: SchemaModel, id: string): readonly string[] {
  const definition: EnumDefinition | undefined = model.enums.find((candidate) => candidate.id === id);

  if (definition === undefined) {
    return [];
  }

  return definition.kind === "static-enum" ? definition.values : (extractedEnumMembers[id] ?? []);
}

/** The entries a body value holds, as key/value pairs plus bare items. */
function entriesOf(value: unknown): { readonly keyed: readonly (readonly [string, unknown])[]; readonly bare: number } {
  if (isEntries(value)) {
    const keyed: (readonly [string, unknown])[] = [];
    let bare = 0;

    for (const entry of value.entries) {
      if (isBare(entry)) {
        bare += 1;
      } else {
        keyed.push(entry);
      }
    }

    return { keyed, bare };
  }

  if (typeof value !== "object" || value === null || Array.isArray(value) || isRaw(value) || isRepeated(value)) {
    return { keyed: [], bare: 0 };
  }

  return { keyed: Object.entries(value), bare: 0 };
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
      if (typeof candidate !== "string" || isIndirect(candidate)) {
        continue;
      }

      if (!known.includes(candidate) && !walker.declared.has(`${type}:${candidate}`)) {
        walker.diagnostics.push({
          severity: "warning",
          code: "unresolved-reference",
          message: `${key} points at ${type} ${candidate}, which is neither in vanilla nor defined by this mod.`,
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
    const allowed: readonly string[] = enumIds.flatMap((id) => enumMembers(walker.model, id));

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

  for (const command of resolution.commands) {
    if (command.input.kind !== "listed-scopes" || command.input.scopes.length === 0) {
      continue;
    }

    if (!command.input.scopes.some((allowed) => allowed === current)) {
      walker.diagnostics.push({
        severity: "error",
        code: "wrong-scope",
        message: `${key} reads a ${command.input.scopes.join(" or a ")}, and here the scope is ${current}. The game answers it false for ever rather than reporting anything.`,
        definition,
        path,
      });
    }
  }
}

function walkBlock(
  walker: Walker,
  definition: string,
  path: string,
  rules: BlockRules,
  body: unknown,
  scope: ScopeState,
): void {
  const { keyed } = entriesOf(body);

  for (const [key, rawValue] of keyed) {
    if (rawValue === undefined || rawValue === null) {
      continue;
    }

    // `repeated(a, b)` writes the key once per value; each one is checked as if
    // it stood alone, and `gt(1)` compares rather than assigns.
    const occurrences: readonly unknown[] = isRepeated(rawValue) ? rawValue.values : [rawValue];
    const resolution: KeyResolution = walker.resolver.resolve(rules, key);

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

    for (const occurrence of occurrences) {
      if (occurrence === undefined || occurrence === null) {
        continue;
      }

      const value: unknown = isCompared(occurrence) ? occurrence.value : occurrence;
      checkValue(walker, definition, path, key, value, resolution);
      checkScope(walker, definition, path, key, resolution, scope);

      if (!isBlockLike(value) || resolution.values.length === 0) {
        continue;
      }

      const child: BlockRules = walker.resolver.rulesForValues(resolution.values);

      // A rule describing a scalar says nothing about the keys inside a block
      // written there; recursing would report every one of them.
      if (child.scalarOnly) {
        continue;
      }

      const childPath: string = path.length === 0 ? key : `${path}.${key}`;
      const childScope: ScopeState = applyScope(scope, resolution.scope);

      // An array is either the same key written once per block, or a value list
      // whose bare items the block's `item` rules describe.
      if (Array.isArray(value)) {
        for (const element of value) {
          if (isBlockLike(element)) {
            walkBlock(walker, definition, childPath, child, element, childScope);
          } else {
            checkItem(walker, definition, path, key, element, child.items);
          }
        }
        continue;
      }

      walkBlock(walker, definition, childPath, child, value, childScope);
    }
  }
}

export function validate(mod: Mod, options: ValidationOptions = {}): readonly ValidationDiagnostic[] {
  const model: SchemaModel = options.model ?? schema;
  const languages: readonly string[] = options.languages ?? ["l_english"];
  const diagnostics: ValidationDiagnostic[] = [];
  const declared = new Set<string>(mod.definitions.map((definition) => `${definition.type}:${definition.id}`));
  const strings = new Map<string, ReadonlySet<string>>();
  const seen = new Set<string>();

  for (const [language, entries] of mod.localisation) {
    strings.set(language, new Set(entries.map((entry) => entry.key)));
  }

  // A mod's own definitions generate modifiers exactly as vanilla's do: adding a
  // job called `my_job` brings `job_my_job_add` into existence, so the mod has to
  // be part of what the namespace is expanded over.
  const ownIds: Record<string, string[]> = {};
  for (const definition of mod.definitions) {
    (ownIds[definition.type] ??= []).push(definition.id);
  }
  const idsByType: Readonly<Record<string, readonly string[]>> = mergeIdsByType(vanillaIdsByType, ownIds);
  const modifiers: ReadonlySet<string> = expandModifierNames(model.modifiers, idsByType, vanillaModifierNames);

  const walker: Walker = {
    resolver: new SchemaResolver(model, {
      idsByType,
      modifierNames: modifiers,
      enumMembers: extractedEnumMembers,
      scriptedParameters: vanillaScriptedParameters,
    }),
    model,
    modifiers,
    idsByType,
    declared,
    diagnostics,
  };

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

    // Two definitions of the same id: the later one wins and the earlier one
    // silently does nothing.
    const identity: string = `${definition.type}:${definition.id}`;
    if (seen.has(identity)) {
      diagnostics.push({
        severity: "error",
        code: "duplicate-definition",
        message: `${definition.id} is defined more than once as a ${definition.type}; only the last one loads.`,
        definition: definition.id,
        path: "",
      });
    }
    seen.add(identity);

    // Defining an id the base game already uses replaces its definition
    // wholesale. Sometimes that is the point; it is never something to discover
    // afterwards.
    if ((vanillaIdsByType[definition.type] ?? []).includes(definition.id)) {
      diagnostics.push({
        severity: "warning",
        code: "replaces-vanilla-definition",
        message: `${definition.id} is a ${definition.type} the base game defines; this replaces it, and whichever loads last wins.`,
        definition: definition.id,
        path: "",
      });
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

    const entryScope: ScopeState =
      typeof type.entryScope === "string" ? { current: type.entryScope, root: type.entryScope } : {};

    walkBlock(walker, definition.id, "", walker.resolver.rulesForType(type), definition.body, entryScope);

    // A field the game needs and the definition does not have. What counts as
    // needed is checked against vanilla itself — a requirement base-game content
    // violates is not one — so this fires only on a field every definition of
    // the type carries.
    const present = new Set<string>(entriesOf(definition.body).keyed.map(([key]) => key.toLowerCase()));

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

    // A missing string shows in-game as the raw key: easy to ship, easy to miss.
    for (const requirement of type.localisation) {
      if (!requirement.required || requirement.source.kind !== "definition-id") {
        continue;
      }

      const key: string = `${definition.id}${requirement.source.suffix}`;

      for (const language of languages) {
        if (strings.get(language)?.has(key) !== true) {
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
