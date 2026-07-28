import type {
  DefinitionType,
  EntryRule,
  EnumDefinition,
  Occurrence,
  SchemaModel,
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
  counters: { literalUnions: number };
}

function valueType(context: RenderContext, value: ValueRule, depth: number): string {
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
          return "number";
        case "percentage":
          return "number | `${number}%`";
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
      return members.map((member) => JSON.stringify(member.replace(/^"|"$/gu, ""))).join(" | ");
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
      return blockType(context, value.entries, depth + 1);
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

function collectProperties(
  context: RenderContext,
  entries: readonly EntryRule[],
  depth: number,
  into: Map<string, PropertyDraft>,
  forceOptional: boolean,
): void {
  for (const entry of entries) {
    if (entry.kind === "variant-rules") {
      // A variant's fields only apply to some definitions of the type, so they
      // are always optional on the shared shape.
      collectProperties(context, entry.entries, depth, into, true);
      continue;
    }

    if (entry.kind !== "field" || typeof entry.key !== "string") {
      continue;
    }

    const draft: PropertyDraft = into.get(entry.key) ?? {
      key: entry.key,
      types: [],
      optional: true,
      repeatable: false,
    };
    const rendered: string = valueType(context, entry.value, depth);

    if (!draft.types.includes(rendered)) {
      draft.types.push(rendered);
    }

    // Duplicate keys are legal in PDX, so the same key can arrive several times
    // with different rules. Required only if some rule requires it and no rule
    // makes it optional.
    if (entry.occurrence.min > 0 && !forceOptional && draft.types.length === 1) {
      draft.optional = false;
    } else if (entry.occurrence.min === 0 || forceOptional) {
      draft.optional = true;
    }

    draft.repeatable = draft.repeatable || repeatable(entry.occurrence);
    into.set(entry.key, draft);
  }
}

/**
 * `"a" | "b" | string` is just `string`, and the linter is right to say so.
 * When one rule for a key widens to `string`, the literals from its siblings
 * carry no information, so drop them.
 */
function splitUnion(type: string): readonly string[] {
  if (!type.includes("|") || type.includes("{") || type.includes("(")) {
    return [type];
  }

  return type
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
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
      const listed: string = draft.repeatable ? `${wrapUnion(union)} | readonly ${wrapUnion(union)}[]` : union;
      // Any field may need a comparison, a repetition, an ordered list or raw
      // script, so every field accepts them.
      return `${indent}readonly ${propertyName(draft.key)}${draft.optional ? "?" : ""}: ${listed} | Authored;`;
    })
    .join("\n");
}

function blockType(context: RenderContext, entries: readonly EntryRule[], depth: number): string {
  const drafts = new Map<string, PropertyDraft>();
  collectProperties(context, entries, depth, drafts, false);

  const hasOpenEntry: boolean = entries.some(
    (entry) =>
      entry.kind === "script-entries" ||
      entry.kind === "rule-set-entries" ||
      (entry.kind === "field" && typeof entry.key !== "string"),
  );
  const ordered: readonly PropertyDraft[] = [...drafts.values()].sort((left, right) =>
    compareOrdinal(left.key, right.key),
  );

  if (ordered.length === 0) {
    // A block the schema says nothing about is not a block that holds nothing.
    // `convert_to` has no declared fields and vanilla fills it with a list of
    // building ids; typing it as an empty object would reject that.
    return "PdxBlock | readonly PdxValue[]";
  }

  const body: string = renderProperties(ordered, "  ");
  return hasOpenEntry ? `{\n${body}\n  readonly [key: string]: PdxValue | undefined;\n}` : `{\n${body}\n}`;
}

export function generateDefinitionTypes(model: SchemaModel): TypeCodegenResult {
  const context: RenderContext = {
    model,
    usedRefs: new Set<string>(),
    usedScript: new Set<string>(),
    counters: { literalUnions: 0 },
  };
  const declarations: string[] = [];
  let propertyCount = 0;

  const ordered: readonly DefinitionType[] = [...model.definitionTypes].sort((left, right) =>
    compareOrdinal(left.id, right.id),
  );

  for (const type of ordered) {
    const drafts = new Map<string, PropertyDraft>();
    collectProperties(context, type.entries, 0, drafts, false);
    propertyCount += drafts.size;

    const hasOpenEntry: boolean = type.entries.some(
      (entry) =>
        entry.kind === "script-entries" ||
        entry.kind === "rule-set-entries" ||
        (entry.kind === "field" && typeof entry.key !== "string"),
    );
    const properties: readonly PropertyDraft[] = [...drafts.values()].sort((left, right) =>
      compareOrdinal(left.key, right.key),
    );
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
  const rendered: string = declarations.join("\n\n");
  const scriptNames: readonly string[] = [
    "Authored",
    "EffectBlock",
    "ModifierBlock",
    "ModifierRuleBlock",
    "PdxBlock",
    "PdxValue",
    "TriggerBlock",
  ].filter((name) => new RegExp(String.raw`\b${name}\b`, "u").test(rendered));
  const scriptImport: string =
    scriptNames.length === 0 ? "" : `import type { ${scriptNames.join(", ")} } from "./script.js";`;
  const refDeclarations: string = refNames
    .map(
      (id) =>
        `/** Any \`${id}\` identifier: the ones vanilla ships, or one this mod defines. */\n` +
        `export type ${pascal(id)}Ref = VanillaId<${JSON.stringify(id)}> | (string & {});`,
    )
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
