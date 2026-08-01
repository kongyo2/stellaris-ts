import { vanillaIdsByType } from "../../src/generated/vanilla/ids.js";
import type {
  DefinitionType,
  EntryRule,
  EnumDefinition,
  RuleSetDefinition,
  Occurrence,
  SchemaModel,
  ScopeChange,
  ValueRule,
} from "../../src/schema/ir.js";

/**
 * Turns the schema IR into TypeScript a mod author writes against.
 *
 * The shape follows PDX one to one, because that is the form the reader already
 * knows: `{ category: "research", potential: { ... } }` is the script with
 * different punctuation. Anything the schema cannot pin down stays open rather
 * than being narrowed to a guess — a wrong type here is worse than a loose one,
 * since it rejects script the game accepts.
 */

const MAX_DEPTH = 6;

/**
 * Types whose identifiers are numbers rather than names.
 *
 * Read off the indexed game rather than listed: `common/technology/tier` names
 * its definitions `0 = { }` … `5 = { }` and is the only one today, but the test
 * is what the game contains, not what was true when this was written.
 */
const numericIdTypes: ReadonlySet<string> = new Set(
  Object.entries(vanillaIdsByType)
    .filter(([, ids]) => ids.length > 0 && ids.every((id) => /^-?\d+(?:\.\d+)?$/u.test(id)))
    .map(([type]) => type),
);

export interface EmittedModule {
  readonly path: string;
  readonly source: string;
}

export interface TypeCodegenResult {
  readonly modules: readonly EmittedModule[];
  readonly definitionCount: number;
  readonly propertyCount: number;
  readonly literalUnionCount: number;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function pascal(value: string): string {
  const parts: readonly string[] = value.split(/[^A-Za-z0-9]+/u).filter((part) => part.length > 0);
  const joined: string = parts
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join("");
  return /^[A-Za-z_$]/u.test(joined) ? joined : `Type${joined}`;
}

/** A key that is not a plain identifier has to be quoted in an interface body. */
function propertyName(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ? key : JSON.stringify(key);
}

function staticEnumMembers(model: SchemaModel, id: string): readonly string[] {
  const definition: EnumDefinition | undefined = model.enums.find((candidate) => candidate.id === id);
  return definition !== undefined && definition.kind === "static-enum" ? definition.values : [];
}

interface RenderContext {
  readonly model: SchemaModel;
  readonly usedRefs: Set<string>;
  readonly usedScript: Set<string>;
  readonly usedScopes: Set<string>;
  readonly scopeNames: ReadonlySet<string>;
  /**
   * One interface per rule-set member, by family, name and scope.
   *
   * A rule-set family describes a shape that holds itself: every `gui`
   * container element contains the `gui` family again. Written inline that is
   * six levels of seventeen members and 8 MB for one definition; written as a
   * name it is one interface that refers to itself, which is what the shape
   * actually is. The name is registered before its body is rendered, so the
   * self-reference resolves rather than recurring.
   */
  readonly ruleSetTypes: Map<string, string>;
  readonly ruleSetDeclarations: Map<string, string>;
  counters: { literalUnions: number };
}

/**
 * Where the block being rendered runs, when the schema says.
 *
 * A trigger block is not one shape: `allow` on a building reads a planet and
 * `potential` on a country type reads a country, and the game's own
 * documentation says which triggers each takes. Carrying the scope through the
 * render is what turns `PdxBlock` into the set that actually belongs there.
 */
function nextScope(scope: string | undefined, change: ScopeChange | undefined): string | undefined {
  if (change === undefined) {
    return scope;
  }

  if (change.kind === "enter") {
    return typeof change.scope === "string" ? change.scope : undefined;
  }

  return typeof change.frame.current === "string" ? change.frame.current : undefined;
}

function valueType(context: RenderContext, value: ValueRule, depth: number, scope?: string): string {
  if (depth > MAX_DEPTH) {
    return "PdxValue";
  }

  switch (value.kind) {
    case "primitive":
      switch (value.type) {
        case "boolean":
          return "boolean";
        case "integer":
        case "number":
          context.usedScript.add("PdxNumber");
          return "PdxNumber";
        case "percentage":
          context.usedScript.add("PdxNumber");
          return "PdxNumber | `${number}%`";
        // A colour is a list of channels, not a string. Vanilla writes
        // `color = { 255 0 255 255 }` in every one of its named colours; the
        // `rgb { … }` and `hsv { … }` spellings are prefixed blocks, which
        // reach here through `rgb()` and `hsv()` as authored values.
        case "colour":
          context.usedScript.add("PdxNumber");
          return "readonly PdxNumber[]";
        // cwt's `scalar` is any single value, and the checker enforces nothing
        // about it — narrowing it to a string here rejected numbers the game
        // and this library's own validator both accept.
        case "scalar":
          context.usedScript.add("PdxNumber");
          return "string | PdxNumber | boolean";
        default:
          return "string";
      }
    case "literal":
      // A quoted scalar keeps its quotes in the raw value, so a naive literal
      // type comes out as `"\"x\""` and matches nothing anyone would write.
      return typeof value.value === "string" ? JSON.stringify(value.value.replace(/^"|"$/gu, "")) : String(value.value);
    case "enum": {
      const members: readonly string[] = staticEnumMembers(context.model, value.enum);
      if (members.length === 0) {
        // An extracted enum's members come from the game, so the schema alone
        // cannot narrow it. Widen rather than reject valid script.
        return "string";
      }
      context.counters.literalUnions += 1;
      // A static enum is a closed set, so the union is not widened. Quotes are
      // stripped defensively: a quoted scalar in the corpus keeps them in its
      // raw value, and a literal type of `"\"x\""` matches nothing real.
      const bare: readonly string[] = members.map((member) => member.replace(/^"|"$/gu, ""));
      // The engine matches an enum member without regard to case and the game
      // relies on it: a `.gui` writes `orientation = center` beside
      // `orientation = CENTER`, and a component writes `size = LARGE` where the
      // schema lists `large`. This library's checker has always compared them
      // case-insensitively; the types now agree. Spelled out rather than
      // `Lowercase<T>` so the result stays a plain union that merges with its
      // siblings.
      const cased: readonly string[] = [
        ...new Set(bare.flatMap((member) => [member, member.toLowerCase(), member.toUpperCase()])),
      ];
      // `true` and `false` are members the game reads as booleans, and this
      // library's own printer writes a boolean for them.
      const booleans: string = bare.some((member) => member === "true" || member === "false") ? " | boolean" : "";
      return `${cased.map((member) => JSON.stringify(member)).join(" | ")}${booleans}`;
    }
    case "chained-enum":
      return "string";
    case "type-reference": {
      const name: string = `${pascal(value.type)}Ref`;
      context.usedRefs.add(value.type);
      return name;
    }
    case "interpolated-type":
      return "string";
    case "script-block": {
      // The scope narrows a trigger or effect block to what that scope accepts.
      if (
        scope !== undefined &&
        context.scopeNames.has(scope) &&
        (value.family === "trigger" || value.family === "effect")
      ) {
        const table: string = value.family === "trigger" ? "TriggersByScope" : "EffectsByScope";
        context.usedScopes.add(table);
        return `${table}[${JSON.stringify(scope)}]`;
      }

      const name: string =
        value.family === "trigger"
          ? "TriggerBlock"
          : value.family === "effect"
            ? "EffectBlock"
            : value.family === "modifier"
              ? "ModifierBlock"
              : "ModifierRuleBlock";
      context.usedScript.add(name);
      return name;
    }
    case "block":
      return blockType(context, value.entries, depth + 1, scope);
    case "list":
      return `readonly ${wrapUnion(valueType(context, value.item, depth + 1))}[]`;
    case "choice": {
      return mergeTypes([...new Set(value.choices.map((choice) => valueType(context, choice, depth + 1)))]);
    }
    case "script-value":
      return "number | string";
    case "modifier-reference":
    case "scope-reference":
    case "scope-group-reference":
    case "value-set":
    case "named-value":
    case "rule-set-reference":
    case "rule-set-key-reference":
      return "string";
    default:
      return "PdxValue";
  }
}

function wrapUnion(type: string): string {
  return /[|&]/u.test(type) && !type.startsWith("(") ? `(${type})` : type;
}

interface PropertyDraft {
  readonly key: string;
  types: string[];
  optional: boolean;
  repeatable: boolean;
}

function repeatable(occurrence: Occurrence): boolean {
  return occurrence.max === null || occurrence.max > 1;
}

/** Folds one key's rule into the draft for that key, merging with any siblings. */
function addProperty(
  context: RenderContext,
  key: string,
  value: ValueRule,
  occurrence: Occurrence,
  depth: number,
  into: Map<string, PropertyDraft>,
  forceOptional: boolean,
  scope?: string,
): void {
  const draft: PropertyDraft = into.get(key) ?? { key, types: [], optional: true, repeatable: false };
  const rendered: string = valueType(context, value, depth, scope);

  if (!draft.types.includes(rendered)) {
    draft.types.push(rendered);
  }

  // Duplicate keys are legal in PDX, so the same key can arrive several times
  // with different rules. Required only if some rule requires it and no rule
  // makes it optional.
  if (occurrence.min > 0 && !forceOptional && draft.types.length === 1) {
    draft.optional = false;
  } else if (occurrence.min === 0 || forceOptional) {
    draft.optional = true;
  }

  draft.repeatable = draft.repeatable || repeatable(occurrence);
  into.set(key, draft);
}

/** What one block's entries came to: the keys it names, and whether it names them all. */
interface Collected {
  readonly drafts: Map<string, PropertyDraft>;
  /**
   * Whether keys reach this block that no property names.
   *
   * A trigger or effect family, a pattern key, a rule set left unexpanded: each
   * means the block accepts more than the properties say, and the interface
   * needs an index signature to stay honest about it.
   */
  open: boolean;
}

/**
 * The interface name for one rule-set member, emitting it the first time.
 *
 * The name is put in the table before the body is rendered: a family that holds
 * itself reaches this function again while it is still inside it, and finding
 * the name there is what turns the recursion into a reference.
 */
function ruleSetType(
  context: RenderContext,
  family: string,
  member: RuleSetDefinition,
  scope: string | undefined,
  alternative: number,
): string {
  // The alternative is part of the identity. A family may name the same key
  // twice with two different shapes — `resources_template_optional.resources` is
  // `{ category ... }` or `{ produces = { ... } }`, and vanilla writes both —
  // and a cache keyed on the name alone hands the first shape out for the
  // second, which rejects six deposits the game ships.
  const key = `${family}::${member.name ?? ""}::${scope ?? ""}::${String(alternative)}`;
  const known: string | undefined = context.ruleSetTypes.get(key);

  if (known !== undefined) {
    return known;
  }

  // Only a block becomes an interface. A member whose value is a scalar has
  // nothing to name, and naming it would read as a shape it does not have.
  if (member.value.kind !== "block") {
    return valueType(context, member.value, 0, scope);
  }

  const suffix: string = alternative <= 1 ? "" : String(alternative);
  const name = `RuleSet${pascal(family)}${pascal(member.name ?? "")}${scope === undefined ? "" : pascal(scope)}${suffix}`;
  context.ruleSetTypes.set(key, name);
  context.ruleSetDeclarations.set(name, "");

  const collected: Collected = { drafts: new Map<string, PropertyDraft>(), open: false };
  collectProperties(context, member.value.entries, 0, collected, false, scope);

  const properties: readonly PropertyDraft[] = [...collected.drafts.values()].sort((left, right) =>
    compareOrdinal(left.key, right.key),
  );
  const index: string = collected.open ? "\n  readonly [key: string]: PdxValue | undefined;" : "";
  const body: string =
    properties.length === 0 && index.length === 0 ? "\n  readonly [key: string]: PdxValue | undefined;" : "";

  context.ruleSetDeclarations.set(
    name,
    `/** \`${member.name ?? ""}\` as ${family} writes it. */\nexport interface ${name} {\n${renderProperties(properties, "  ")}${index}${body}\n}`,
  );

  return name;
}

function collectProperties(
  context: RenderContext,
  entries: readonly EntryRule[],
  depth: number,
  into: Collected,
  forceOptional: boolean,
  scope?: string,
): void {
  // The schema says a macro may be written in every block — `inline_script = {
  // script = shroud/jobs/colonist_add AMOUNT = 200 }` is inside a vanilla
  // building — so no block enumerates all the keys it accepts. Reading only the
  // rules and calling the result closed rejected that in 19 types and 1,279
  // places, and the conformance gate could not see it: it subtracts macro keys
  // before it counts.
  if (context.model.policy.macros.some((macro) => macro.appliesTo === "all-blocks")) {
    into.open = true;
  }

  for (const entry of entries) {
    if (entry.kind === "variant-rules") {
      // A variant's fields only apply to some definitions of the type, so they
      // are always optional on the shared shape.
      collectProperties(context, entry.entries, depth, into, true, scope);
      continue;
    }

    if (entry.kind === "script-entries") {
      into.open = true;
      continue;
    }

    // A rule-set family is a named set of keys the block may also carry, and
    // reading them is what gives `planet = { ... }` on a system initializer a
    // type: without it the key had no rule at all, and the type rejected the
    // one thing a system initializer exists to say.
    if (entry.kind === "rule-set-entries") {
      const members = context.model.ruleSets.filter((member) => member.family === entry.family);
      const inner: string | undefined = nextScope(scope, entry.scope);
      // Which alternative of a key this is. The same name may be declared more
      // than once with different shapes, and each is a form the game accepts.
      const alternatives = new Map<string, number>();

      for (const member of members) {
        // A member with no name is a key computed from a construct, which
        // nothing can enumerate; the block stays open for it.
        if (typeof member.name !== "string" || member.name.length === 0) {
          into.open = true;
          continue;
        }

        const alternative: number = (alternatives.get(member.name) ?? 0) + 1;
        alternatives.set(member.name, alternative);

        const memberScope: string | undefined = nextScope(inner, member.scope);
        const draft: PropertyDraft = into.drafts.get(member.name) ?? {
          key: member.name,
          types: [],
          optional: true,
          repeatable: false,
        };
        const rendered: string = ruleSetType(context, entry.family, member, memberScope, alternative);

        if (!draft.types.includes(rendered)) {
          draft.types.push(rendered);
        }

        draft.repeatable = draft.repeatable || !member.single;
        into.drafts.set(member.name, draft);
      }
      continue;
    }

    if (entry.kind !== "field") {
      continue;
    }

    if (typeof entry.key !== "string") {
      into.open = true;
      continue;
    }

    addProperty(
      context,
      entry.key,
      entry.value,
      entry.occurrence,
      depth,
      into.drafts,
      forceOptional,
      nextScope(scope, entry.scope),
    );
  }
}

/**
 * `"a" | "b" | string` is just `string`, and the linter is right to say so.
 * When one rule for a key widens to `string`, the literals from its siblings
 * carry no information, so drop them.
 */
function splitUnion(type: string): readonly string[] {
  if (!type.includes("|")) {
    return [type];
  }

  // Only the bars between constituents. An object literal and a template
  // literal both hold braces of their own, and the earlier test — give up on
  // anything containing a brace — left `number | number | \`${number}%\`` in the
  // output, because a percentage rule and a plain number rule are two renderings
  // of a key and only one of them looks like a union.
  const parts: string[] = [];
  let depth = 0;
  let inTemplate = false;
  let start = 0;

  for (let index = 0; index < type.length; index += 1) {
    const character: string = type.charAt(index);

    if (character === "`") {
      inTemplate = !inTemplate;
      continue;
    }

    if (inTemplate) {
      continue;
    }

    // `<` and `>` count too, because a generic argument holds bars of its own:
    // splitting `AnyCase<"a" | "b">` on them closed the generic after the first
    // constituent and left the rest of the union outside it, which is not
    // valid TypeScript at all.
    if (character === "{" || character === "(" || character === "[" || character === "<") {
      depth += 1;
    } else if (character === "}" || character === ")" || character === "]" || character === ">") {
      depth -= 1;
    } else if (character === "|" && depth === 0) {
      parts.push(type.slice(start, index).trim());
      start = index + 1;
    }
  }

  parts.push(type.slice(start).trim());
  return parts.filter((part) => part.length > 0);
}

function mergeTypes(types: readonly string[]): string {
  if (types.length === 1) {
    return types[0] ?? "PdxValue";
  }

  const widened: boolean = types.includes("string");
  const kept: readonly string[] = widened ? types.filter((type) => !/^"/u.test(type)) : types;

  // Sibling rules often repeat the same literal, and a union that names a
  // constituent twice is the same type written twice.
  const constituents = new Set<string>();
  for (const type of kept) {
    for (const part of splitUnion(type)) {
      constituents.add(part);
    }
  }

  const unique: readonly string[] = [...constituents];
  return unique.length === 0 ? "string" : unique.length === 1 ? (unique[0] ?? "string") : unique.join(" | ");
}

function renderProperties(drafts: readonly PropertyDraft[], indent: string): string {
  return drafts
    .map((draft) => {
      const union: string = mergeTypes(draft.types);
      // A key the game reads more than once is written with `repeated()`, which
      // `Authored` already admits. Offering an array for it as well said an
      // array meant repetition, and it does not: `in_breach_of = { { key = a }
      // { key = b } }` is one key holding blocks with no key of their own, and
      // that is what an array is. One spelling per shape, or neither is safe.
      return `${indent}readonly ${propertyName(draft.key)}${draft.optional ? "?" : ""}: ${union} | Authored;`;
    })
    .join("\n");
}

function blockType(context: RenderContext, entries: readonly EntryRule[], depth: number, scope?: string): string {
  const collected: Collected = { drafts: new Map<string, PropertyDraft>(), open: false };
  collectProperties(context, entries, depth, collected, false, scope);

  const hasOpenEntry: boolean = collected.open;
  const ordered: readonly PropertyDraft[] = [...collected.drafts.values()].sort((left, right) =>
    compareOrdinal(left.key, right.key),
  );

  // A block whose entries are a trigger or effect family is that family, and
  // the scope says which of it. `allow = { ... }` on a building is every trigger
  // a planet accepts, not every trigger there is.
  const family: "effect" | "trigger" | undefined = entries
    .map((entry) =>
      entry.kind === "script-entries" && (entry.family === "trigger" || entry.family === "effect")
        ? entry.family
        : undefined,
    )
    .find((found): found is "effect" | "trigger" => found !== undefined);

  if (family !== undefined && scope !== undefined && context.scopeNames.has(scope)) {
    const table: string = family === "trigger" ? "TriggersByScope" : "EffectsByScope";
    context.usedScopes.add(table);
    const scoped: string = `${table}[${JSON.stringify(scope)}]`;

    if (ordered.length === 0) {
      return scoped;
    }

    return `${scoped} & {
${renderProperties(ordered, "  ")}
}`;
  }

  if (ordered.length === 0) {
    // A block the schema says nothing about is not a block that holds nothing.
    // `convert_to` has no declared fields and vanilla fills it with a list of
    // building ids; typing it as an empty object would reject that.
    return "PdxBlock | readonly PdxValue[]";
  }

  // A block with bare-item rules is a value list as well as a keyed block —
  // `prerequisites = { tech_a tech_b }` is the ordinary way to write it, and a
  // type that only allowed keys would send everyone to `entries()`.
  // A block with bare-item rules is a value list as well as a keyed block —
  // `prerequisites = { tech_a tech_b }` is the ordinary way to write it, and a
  // type that only allowed keys would send everyone to `entries()`.
  const listable: string = entries.some((entry) => entry.kind === "item") ? " | readonly PdxValue[]" : "";
  const body: string = renderProperties(ordered, "  ");
  const shape: string = hasOpenEntry
    ? `{
${body}
  readonly [key: string]: PdxValue | undefined;
}`
    : `{
${body}
}`;

  return `${shape}${listable}`;
}

export function generateDefinitionTypes(model: SchemaModel): TypeCodegenResult {
  const context: RenderContext = {
    model,
    usedRefs: new Set<string>(),
    usedScript: new Set<string>(),
    usedScopes: new Set<string>(),
    scopeNames: new Set(model.scopes.map((scope) => scope.id)),
    ruleSetTypes: new Map<string, string>(),
    ruleSetDeclarations: new Map<string, string>(),
    counters: { literalUnions: 0 },
  };
  const declarations: string[] = [];
  let propertyCount = 0;

  const ordered: readonly DefinitionType[] = [...model.definitionTypes].sort((left, right) =>
    compareOrdinal(left.id, right.id),
  );

  for (const type of ordered) {
    const collected: Collected = { drafts: new Map<string, PropertyDraft>(), open: false };
    // A definition body runs in the scope its type names, and every trigger or
    // effect block inside inherits it until a rule says otherwise.
    const entryScope: string | undefined = typeof type.entryScope === "string" ? type.entryScope : undefined;
    collectProperties(context, type.entries, 0, collected, false, entryScope);
    propertyCount += collected.drafts.size;

    const hasOpenEntry: boolean = collected.open;
    // A tagged type carries its identity in a field inside the block, and
    // `define(type, id, body)` writes it there. Leaving it in the body type as
    // well invites two different answers to which definition this is.
    const nameField: string | undefined = type.source.kind === "tagged-blocks" ? type.source.nameField : undefined;
    const properties: readonly PropertyDraft[] = [...collected.drafts.values()]
      .filter((draft) => draft.key !== nameField)
      .sort((left, right) => compareOrdinal(left.key, right.key));
    const documentation: string =
      type.documentation === undefined ? "" : `/** ${type.documentation.replaceAll("*/", "*\\/")} */\n`;
    const index: string = hasOpenEntry ? "\n  readonly [key: string]: PdxValue | undefined;" : "";

    declarations.push(
      `${documentation}export interface ${pascal(type.id)}Definition {\n${renderProperties(properties, "  ")}${index}\n}`,
    );
  }

  const refNames: readonly string[] = [...context.usedRefs].sort(compareOrdinal);
  // `noUnusedLocals` makes a speculative import a build failure, so import only
  // the shapes this emission actually referenced.
  const ruleSetDeclarations: readonly string[] = [...context.ruleSetDeclarations]
    .sort(([left], [right]) => compareOrdinal(left, right))
    .map(([, source]) => source);
  const rendered: string = [...ruleSetDeclarations, ...declarations].join("\n\n");
  const scriptNames: readonly string[] = [
    "Authored",
    "EffectBlock",
    "ModifierBlock",
    "ModifierRuleBlock",
    "PdxBlock",
    "PdxNumber",
    "PdxValue",
    "TriggerBlock",
  ].filter((name) => new RegExp(String.raw`\b${name}\b`, "u").test(rendered));
  const scriptImport: string =
    scriptNames.length === 0 ? "" : `import type { ${scriptNames.join(", ")} } from "./script.js";`;
  const scopeNames: readonly string[] = [...context.usedScopes].sort(compareOrdinal);
  const scopeImport: string =
    scopeNames.length === 0 ? "" : `import type { ${scopeNames.join(", ")} } from "./scopes.js";`;
  const refDeclarations: string = refNames
    .map((id) => {
      // A type whose identifiers are numbers is referred to with a number:
      // technology tiers are `0` … `5` and every technology writes `tier = 3`.
      // Without this the only spelling that compiles is `raw("3")`.
      const numeric: boolean = numericIdTypes.has(id);
      const note: string = numeric ? " Its identifiers are numbers, and script writes them as numbers." : "";
      return (
        `/** Any \`${id}\` identifier: the ones vanilla ships, or one this mod defines.${note} */\n` +
        `export type ${pascal(id)}Ref = VanillaId<${JSON.stringify(id)}> | (string & {})${numeric ? " | number" : ""};`
      );
    })
    .join("\n\n");

  const modules: EmittedModule[] = [
    {
      path: "src/generated/types/definitions.ts",
      source: [
        "// Generated by `npm run codegen`. Do not edit — fix the generator.",
        "//",
        "// `Ref` types are deliberately `VanillaX | (string & {})`: the vanilla names",
        "// complete, and a mod's own identifiers stay assignable. Oxlint reads that as",
        "// a redundant union with `string`; here it is the point.",
        "/* oxlint-disable typescript/no-redundant-type-constituents */",
        "",
        scriptImport,
        scopeImport,
        refNames.length === 0 ? "" : 'import type { VanillaId } from "./refs.js";',
        "",
        refDeclarations,
        "",
        rendered,
        "",
        "export interface DefinitionShapes {",
        ...ordered.map((type) => `  readonly ${propertyName(type.id)}: ${pascal(type.id)}Definition;`),
        "}",
        "",
      ].join("\n"),
    },
  ];

  return {
    modules,
    definitionCount: ordered.length,
    propertyCount,
    literalUnionCount: context.counters.literalUnions,
  };
}
