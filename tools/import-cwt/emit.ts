import * as ir from "../../src/schema/ir.js";
import type { ImportedCatalog } from "./catalog.js";
import type {
  ImportedAnnotations,
  ImportedCommand,
  ImportedDefinitionSource,
  ImportedDefinitionType,
  ImportedEntryRule,
  ImportedKeyFilter,
  ImportedKeyRule,
  ImportedLocalisationRule,
  ImportedModifierRule,
  ImportedOccurrence,
  ImportedScopeDirective,
  ImportedSeverity,
  ImportedSubtype,
  ImportedValueRule,
} from "./translate.js";

/**
 * Emits the schema IR as ordinary TypeScript sources.
 *
 * The output is committed and then maintained by hand: this importer runs once
 * per upstream cwt refresh and only ever proposes a diff. Nothing downstream of
 * `src/schema/` may read `.cwt` — see PLAN.md §0.1.
 */

export interface EmittedFile {
  readonly path: string;
  readonly source: string;
}

export interface EmitDiagnostic {
  readonly definition: string;
  readonly code: string;
  readonly detail: string;
}

export interface EmitResult {
  readonly files: readonly EmittedFile[];
  readonly diagnostics: readonly EmitDiagnostic[];
  readonly opaqueCount: number;
}

const SCRIPT_FAMILIES: ReadonlyMap<string, string> = new Map([
  ["trigger", "trigger"],
  ["effect", "effect"],
  ["modifier", "modifier"],
  ["modifier_rule", "modifier-rule"],
]);

const SCRIPT_BLOCK_HELPER: ReadonlyMap<string, string> = new Map([
  ["trigger", "triggerBlock"],
  ["effect", "effectBlock"],
  ["modifier", "modifierBlock"],
  ["modifier_rule", "modifierRuleBlock"],
]);

const SCRIPT_ENTRIES_HELPER: ReadonlyMap<string, string> = new Map([
  ["trigger", "triggerEntries"],
  ["effect", "effectEntries"],
  ["modifier", "modifierEntries"],
  ["modifier_rule", "modifierRuleEntries"],
]);

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function literalExpression(value: string | number | boolean): string {
  return typeof value === "string" ? quote(value) : String(value);
}

/** Mirrors `propertyBase` in catalog.ts so emitted ids resolve against the catalog. */
function propertyBase(value: string): string {
  const parts: readonly string[] = value.split(/[^A-Za-z0-9]+/u).filter((part) => part.length > 0);
  const joined: string = parts
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join("");
  const prefixed: string = /^[A-Za-z_$]/u.test(joined) ? joined : `Value${joined}`;
  return prefixed.length === 0 ? "Value" : prefixed;
}

function moduleName(id: string): string {
  return id
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .replace(/[^A-Za-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase();
}

/** Every name `../ir.js` exports, so a definition binding can never shadow a helper. */
const IR_EXPORTS: ReadonlySet<string> = new Set(Object.keys(ir));

function bindingName(id: string): string {
  const base: string = propertyBase(id);
  const camel: string = `${base.slice(0, 1).toLowerCase()}${base.slice(1)}`;
  return IR_EXPORTS.has(camel) ? `${camel}Definition` : camel;
}

/** Collects the `../catalog.js` and `../ir.js` identifiers an emitted module touches. */
class Imports {
  readonly ir = new Set<string>();
  readonly catalog = new Set<string>();

  helper(name: string): string {
    this.ir.add(name);
    return name;
  }

  definitionTypeId(id: string, known: ReadonlySet<string>): string {
    if (!known.has(id)) {
      return quote(id);
    }

    this.catalog.add("DefinitionTypeId");
    return `DefinitionTypeId.${propertyBase(id)}`;
  }

  enumId(id: string, known: ReadonlySet<string>): string | undefined {
    if (!known.has(id)) {
      return undefined;
    }

    this.catalog.add("EnumId");
    return `EnumId.${propertyBase(id)}`;
  }

  scopeId(id: string, known: ReadonlySet<string>): string | undefined {
    if (!known.has(id)) {
      return undefined;
    }

    this.catalog.add("ScopeId");
    return `ScopeId.${propertyBase(id)}`;
  }
}

interface EmitContext {
  readonly imports: Imports;
  readonly catalog: ImportedCatalog;
  readonly typeIds: ReadonlySet<string>;
  readonly enumIds: ReadonlySet<string>;
  readonly scopeIds: ReadonlySet<string>;
  readonly scopeAliases: ReadonlyMap<string, string>;
  readonly diagnostics: EmitDiagnostic[];
  readonly definition: string;
  counters: { opaque: number };
}

function opaque(context: EmitContext, code: string, detail: string): string {
  context.counters.opaque += 1;
  context.diagnostics.push({ definition: context.definition, code, detail });
  return `${context.imports.helper("opaque")}(${quote(`${code}: ${detail}`)})`;
}

/** Resolves a cwt scope token (which may be an alias) to a catalog ScopeId expression. */
function scopeExpression(context: EmitContext, raw: string): string | undefined {
  const normalised: string = raw.trim().toLowerCase();

  if (normalised === "any" || normalised === "all") {
    return `${context.imports.helper("anyScope")}()`;
  }

  if (normalised === "none" || normalised === "no_scope") {
    return `${context.imports.helper("noScope")}()`;
  }

  const canonical: string | undefined = context.scopeAliases.get(normalised);
  return canonical === undefined ? undefined : context.imports.scopeId(canonical, context.scopeIds);
}

/**
 * Same as `scopeExpression` but restricted to a concrete `ScopeId`.
 * `scopeRef` takes `ScopeId | undefined`, so any/none must degrade to an
 * unconstrained reference rather than an `anyScope()` node.
 */
function scopeIdExpression(context: EmitContext, raw: string): string | undefined {
  const normalised: string = raw.trim().toLowerCase();

  if (normalised === "any" || normalised === "all" || normalised === "none" || normalised === "no_scope") {
    return undefined;
  }

  const canonical: string | undefined = context.scopeAliases.get(normalised);
  return canonical === undefined ? undefined : context.imports.scopeId(canonical, context.scopeIds);
}

function occurrenceExpression(context: EmitContext, occurrence: ImportedOccurrence): string {
  const { min, max } = occurrence;

  if (min === 1 && max === 1) {
    return `${context.imports.helper("occurs")}.one`;
  }

  if (min === 0 && max === 1) {
    return `${context.imports.helper("occurs")}.optional`;
  }

  if (min === 0 && max === null) {
    return `${context.imports.helper("occurs")}.any`;
  }

  if (min === 1 && max === null) {
    return `${context.imports.helper("occurs")}.oneOrMore`;
  }

  return `${context.imports.helper("between")}(${String(min)}, ${max === null ? "null" : String(max)})`;
}

function numericRangeExpression(range: { readonly min: number | null; readonly max: number | null }): string {
  return `{ min: ${range.min === null ? "null" : String(range.min)}, max: ${range.max === null ? "null" : String(range.max)} }`;
}

function valueExpression(context: EmitContext, value: ImportedValueRule): string {
  const { imports } = context;

  switch (value.kind) {
    case "primitive": {
      const parts: string[] = [quote(value.type)];
      if (value.range !== undefined || value.path !== undefined) {
        parts.push(value.range === undefined ? "undefined" : numericRangeExpression(value.range));
      }
      if (value.path !== undefined) {
        parts.push(quote(value.path));
      }
      return `${imports.helper("primitive")}(${parts.join(", ")})`;
    }
    case "literal":
      return `${imports.helper("literal")}(${literalExpression(value.value)})`;
    case "any-value":
      return `${imports.helper("anyValue")}()`;
    case "enum-reference": {
      const id: string | undefined = imports.enumId(value.enum, context.enumIds);
      return id === undefined ? opaque(context, "unknown-enum", value.enum) : `${imports.helper("enumRef")}(${id})`;
    }
    case "chained-enum-reference": {
      const id: string | undefined = imports.enumId(value.enum, context.enumIds);
      const scope: string | undefined = scopeExpression(context, value.scope);
      return id === undefined || scope === undefined
        ? opaque(context, "unknown-chained-enum", `${value.scope}.${value.enum}`)
        : `${imports.helper("chainedEnum")}(${scope}, ${id})`;
    }
    case "type-reference": {
      // `<modifier>` is not a declared type: modifiers come from every type's
      // generated templates plus the standalone modifier rules.
      if (value.type === "modifier") {
        return `${imports.helper("modifierRef")}()`;
      }
      if (!context.typeIds.has(value.type)) {
        return opaque(context, "unknown-type-reference", value.type);
      }
      return value.variant === undefined
        ? `${imports.helper("typeRef")}(${quote(value.type)})`
        : `${imports.helper("typeRef")}(${quote(value.type)}, ${quote(value.variant)})`;
    }
    case "scope-reference": {
      const scope: string | undefined = scopeIdExpression(context, value.scope);
      return scope === undefined ? `${imports.helper("scopeRef")}()` : `${imports.helper("scopeRef")}(${scope})`;
    }
    case "scope-group-reference":
      return `${imports.helper("scopeGroup")}(${quote(value.group)})`;
    case "named-value-reference":
      return `${imports.helper("namedValue")}(${quote(value.set)})`;
    case "value-set-reference":
      return `${imports.helper("valueSet")}(${quote(value.set)})`;
    case "script-value":
      return value.range === undefined
        ? `${imports.helper("scriptValue")}(${quote(value.result)})`
        : `${imports.helper("scriptValue")}(${quote(value.result)}, ${numericRangeExpression(value.range)})`;
    case "colour":
      return `${imports.helper("primitive")}(${quote("colour")}, undefined, undefined, ${quote(value.format)})`;
    case "name-format":
      return `${imports.helper("primitive")}(${quote("name-format")}, undefined, undefined, ${quote(value.format)})`;
    case "alias-reference": {
      // Script families live in `commands`, not `ruleSets`, so any reference to
      // one is the corresponding script block rather than a rule-set reference.
      if (SCRIPT_FAMILIES.has(value.family)) {
        const helper: string = SCRIPT_BLOCK_HELPER.get(value.family) ?? "triggerBlock";
        return `${imports.helper(helper)}()`;
      }
      const parts: string[] = [quote(value.family)];
      if (value.name !== undefined) {
        parts.push(quote(value.name));
      }
      if (value.single) {
        if (value.name === undefined) {
          parts.push("undefined");
        }
        parts.push("true");
      }
      return `${imports.helper("ruleSetRef")}(${parts.join(", ")})`;
    }
    case "alias-key-field":
      return `${imports.helper("ruleSetKeyRef")}(${quote(value.family)})`;
    case "block":
      return `${imports.helper("block")}(${entriesExpression(context, value.entries)})`;
    case "unsupported-value":
      return opaque(context, value.semantic.code, value.semantic.description);
    default:
      return opaque(context, "unhandled-value", JSON.stringify(value).slice(0, 120));
  }
}

function keyExpression(context: EmitContext, key: ImportedKeyRule): string {
  const { imports } = context;

  switch (key.kind) {
    case "literal-key":
      return quote(key.value);
    case "any-key":
      return `${imports.helper("anyKey")}()`;
    case "enum-key": {
      const id: string | undefined = imports.enumId(key.enum, context.enumIds);
      return id === undefined ? `${imports.helper("anyKey")}()` : `${imports.helper("enumKey")}(${id})`;
    }
    case "type-key":
      return `${imports.helper("typeKey")}(${quote(key.type)})`;
    case "scope-key": {
      const scope: string | undefined = scopeExpression(context, key.scope);
      return scope === undefined ? `${imports.helper("anyKey")}()` : `${imports.helper("scopeKey")}(${scope})`;
    }
    case "scope-group-key":
      return `${imports.helper("scopeGroupKey")}(${quote(key.group)})`;
    case "named-value-key":
      return `${imports.helper("namedValueKey")}(${quote(key.set)})`;
    case "value-set-key":
      return `${imports.helper("valueSetKey")}(${quote(key.set)})`;
    case "alias-key": {
      const parts: string[] = [quote(key.family)];
      if (key.name !== undefined) {
        parts.push(quote(key.name));
      }
      if (key.single) {
        if (key.name === undefined) {
          parts.push("undefined");
        }
        parts.push("true");
      }
      return `${imports.helper("ruleSetKey")}(${parts.join(", ")})`;
    }
    case "alias-keys-field-key":
      return `${imports.helper("ruleSetKeysFieldKey")}(${quote(key.family)})`;
    case "unsupported-key":
      context.counters.opaque += 1;
      context.diagnostics.push({
        definition: context.definition,
        code: key.semantic.code,
        detail: key.semantic.description,
      });
      return `${imports.helper("anyKey")}()`;
    default:
      return `${imports.helper("anyKey")}()`;
  }
}

function scopeChangeExpression(
  context: EmitContext,
  directives: readonly ImportedScopeDirective[],
): string | undefined {
  const enterDirective = directives.find((directive) => directive.kind === "enter-scope");
  if (enterDirective !== undefined && enterDirective.kind === "enter-scope") {
    const scope: string | undefined = scopeExpression(context, enterDirective.scope);
    if (scope !== undefined) {
      return `${context.imports.helper("enterScope")}(${scope})`;
    }
  }

  const replaceDirective = directives.find((directive) => directive.kind === "replace-scope");
  if (replaceDirective !== undefined && replaceDirective.kind === "replace-scope") {
    const slots: string[] = [];
    for (const binding of replaceDirective.bindings) {
      const scope: string | undefined = scopeExpression(context, binding.scope);
      const slot: string | undefined = SCOPE_SLOTS.get(binding.slot.toLowerCase());
      if (scope !== undefined && slot !== undefined) {
        slots.push(`${slot}: ${scope}`);
      }
    }
    if (slots.length > 0) {
      return `${context.imports.helper("replaceScope")}({ ${slots.join(", ")} })`;
    }
  }

  return undefined;
}

const SCOPE_SLOTS: ReadonlyMap<string, string> = new Map([
  ["this", "current"],
  ["root", "root"],
  ["prev", "previous"],
  ["from", "from"],
  ["fromfrom", "fromFrom"],
  ["fromfromfrom", "fromFromFrom"],
  ["fromfromfromfrom", "fromFromFromFrom"],
]);

function optionsExpression(
  context: EmitContext,
  annotations: {
    readonly documentation: readonly string[];
    readonly scopes: readonly ImportedScopeDirective[];
    readonly severities: readonly ImportedSeverity[];
  },
  extra: readonly string[] = [],
): string | undefined {
  const parts: string[] = [...extra];
  const documentation: string = annotations.documentation.join(" ").trim();

  if (documentation.length > 0) {
    parts.push(`documentation: ${quote(documentation)}`);
  }

  const scope: string | undefined = scopeChangeExpression(context, annotations.scopes);
  if (scope !== undefined) {
    parts.push(`scope: ${scope}`);
  }

  const severity: ImportedSeverity | undefined = annotations.severities[0];
  if (severity !== undefined && severity !== "error") {
    parts.push(`severity: ${quote(severity)}`);
  }

  return parts.length === 0 ? undefined : `{ ${parts.join(", ")} }`;
}

function entryExpression(context: EmitContext, entry: ImportedEntryRule): string | undefined {
  const { imports } = context;

  switch (entry.kind) {
    case "field": {
      // `alias_name[trigger] = alias_match_left[trigger]` is the expand-here form:
      // it is a script-entries rule, not a field keyed by a rule set.
      if (entry.key.kind === "alias-key" && SCRIPT_ENTRIES_HELPER.has(entry.key.family)) {
        const entriesHelper: string = SCRIPT_ENTRIES_HELPER.get(entry.key.family) ?? "triggerEntries";
        const entriesOptions: string | undefined = optionsExpression(context, entry.annotations);
        return `${imports.helper(entriesHelper)}(${entriesOptions ?? ""})`;
      }

      const extra: string[] = entry.operator === "=" ? [] : [`operator: ${quote(entry.operator)}`];
      const options: string | undefined = optionsExpression(context, entry.annotations, extra);
      const parts: string[] = [
        keyExpression(context, entry.key),
        valueExpression(context, entry.value),
        occurrenceExpression(context, entry.occurrence),
      ];
      if (options !== undefined) {
        parts.push(options);
      }
      return `${imports.helper("field")}(${parts.join(", ")})`;
    }
    case "item": {
      const options: string | undefined = optionsExpression(context, entry.annotations);
      const parts: string[] = [valueExpression(context, entry.value), occurrenceExpression(context, entry.occurrence)];
      if (options !== undefined) {
        parts.push(options);
      }
      return `${imports.helper("item")}(${parts.join(", ")})`;
    }
    case "alias-expansion": {
      const helper: string | undefined = SCRIPT_ENTRIES_HELPER.get(entry.family);
      const options: string | undefined = optionsExpression(context, entry.annotations);
      if (helper !== undefined) {
        return `${imports.helper(helper)}(${options ?? ""})`;
      }
      const parts: string[] = [quote(entry.family)];
      if (options !== undefined) {
        parts.push(options);
      }
      return `${imports.helper("ruleSetEntries")}(${parts.join(", ")})`;
    }
    case "variant-rules": {
      const helper: string = entry.mode === "include" ? "whenVariant" : "unlessVariant";
      return `${imports.helper(helper)}(${quote(entry.variant)}, ${entriesExpression(context, entry.entries)})`;
    }
    case "unsupported-entry":
      context.counters.opaque += 1;
      context.diagnostics.push({
        definition: context.definition,
        code: entry.semantic.code,
        detail: entry.semantic.description,
      });
      return undefined;
    default:
      return undefined;
  }
}

function entriesExpression(context: EmitContext, entries: readonly ImportedEntryRule[]): string {
  const rendered: string[] = entries
    .map((entry) => entryExpression(context, entry))
    .filter((value): value is string => value !== undefined);

  return rendered.length === 0 ? "[]" : `[\n${rendered.map((value) => `${value},`).join("\n")}\n]`;
}

function keyFilterExpression(filters: readonly ImportedKeyFilter[]): string | undefined {
  const include: string[] = [];
  const exclude: string[] = [];

  for (const filter of filters) {
    (filter.mode === "include" ? include : exclude).push(...filter.values);
  }

  if (include.length > 0) {
    return `{ mode: "include", values: [${[...new Set(include)].map(quote).join(", ")}] }`;
  }

  if (exclude.length > 0) {
    return `{ mode: "exclude", values: [${[...new Set(exclude)].map(quote).join(", ")}] }`;
  }

  return undefined;
}

function sourceExpression(context: EmitContext, source: ImportedDefinitionSource): string {
  const { imports } = context;
  const options: string[] = [];
  const rootKeyFilter: string | undefined = keyFilterExpression(source.keyFilters);

  if (source.file !== undefined) {
    options.push(`files: [${quote(source.file)}]`);
  }
  if (rootKeyFilter !== undefined) {
    options.push(`rootKeyFilter: ${rootKeyFilter}`);
  }
  if (source.rootKey !== undefined) {
    options.push(
      source.rootKey === "any"
        ? `container: { kind: "any-container" }`
        : `container: { kind: "named-container", key: ${quote(source.rootKey)} }`,
    );
  }

  const optionsExpr: string = options.length === 0 ? "" : `, { ${options.join(", ")} }`;
  const includeSubdirectories: string = source.includeSubdirectories ? "true" : "false";
  const tail: string =
    options.length === 0 && source.includeSubdirectories ? "" : `, ${includeSubdirectories}${optionsExpr}`;

  if (source.kind === "tagged-blocks") {
    const nameField: string = source.nameField ?? "name";
    return `${imports.helper("taggedBlocks")}(${quote(source.directory)}, ${quote(nameField)}, []${tail})`;
  }

  if (source.kind === "file-root") {
    return `${imports.helper("fileDefinitions")}(${quote(source.directory)}${tail})`;
  }

  return `${imports.helper("keyedBlocks")}(${quote(source.directory)}${tail})`;
}

function variantPredicate(context: EmitContext, subtype: ImportedSubtype): string {
  const { imports } = context;
  const predicates: string[] = [];
  const rootKeys: string[] = [];

  for (const filter of subtype.keyFilters) {
    if (filter.mode === "include") {
      rootKeys.push(...filter.values);
    }
  }

  if (rootKeys.length > 0) {
    predicates.push(`${imports.helper("rootKeyIs")}(${[...new Set(rootKeys)].map(quote).join(", ")})`);
  }

  for (const criterion of subtype.criteria) {
    if (criterion.kind !== "field") {
      continue;
    }

    const key: ImportedKeyRule = criterion.key;
    if (key.kind !== "literal-key") {
      continue;
    }

    if (criterion.value.kind === "literal") {
      predicates.push(
        `${imports.helper("fieldEquals")}(${quote(key.value)}, ${literalExpression(criterion.value.value)})`,
      );
      continue;
    }

    predicates.push(`${imports.helper("fieldPresent")}(${quote(key.value)})`);
  }

  if (predicates.length === 0) {
    return `${imports.helper("always")}()`;
  }

  if (predicates.length === 1) {
    return predicates[0] ?? `${imports.helper("always")}()`;
  }

  return `${imports.helper("allOf")}(${predicates.join(", ")})`;
}

function variantsExpression(context: EmitContext, subtypes: readonly ImportedSubtype[]): string {
  if (subtypes.length === 0) {
    return "[]";
  }

  const rendered: string[] = subtypes.map((subtype) => {
    const parts: string[] = [`id: ${quote(subtype.id)}`, `when: ${variantPredicate(context, subtype)}`];
    const entryScopeRaw: string | undefined = subtype.entryScopes[0];
    const entryScope: string | undefined =
      entryScopeRaw === undefined ? undefined : scopeExpression(context, entryScopeRaw);

    if (entryScope !== undefined) {
      parts.push(`entryScope: ${entryScope}`);
    }
    const displayName: string | undefined = subtype.displayNames[0];
    if (displayName !== undefined) {
      parts.push(`displayName: ${quote(displayName)}`);
    }
    const abbreviation: string | undefined = subtype.abbreviations[0];
    if (abbreviation !== undefined) {
      parts.push(`abbreviation: ${quote(abbreviation)}`);
    }

    return `{ ${parts.join(", ")} }`;
  });

  return `[\n${rendered.map((value) => `${value},`).join("\n")}\n]`;
}

/** Flattens localisation variant groups into the IR's flat requirement list. */
function localisationExpression(
  context: EmitContext,
  rules: readonly ImportedLocalisationRule[],
  variant?: string,
): readonly string[] {
  const rendered: string[] = [];

  for (const rule of rules) {
    if (rule.kind === "localisation-variant") {
      if (rule.mode === "include") {
        rendered.push(...localisationExpression(context, rule.entries, rule.variant));
      }
      continue;
    }

    if (rule.kind === "unsupported-localisation") {
      context.counters.opaque += 1;
      context.diagnostics.push({
        definition: context.definition,
        code: rule.semantic.code,
        detail: rule.semantic.description,
      });
      continue;
    }

    const requiredValue: boolean = rule.requirements.includes("required");
    const suffix: string = rule.template.replace(/^\$/u, "");
    const parts: string[] = [quote(rule.role), quote(suffix), requiredValue ? "true" : "false"];
    if (variant !== undefined) {
      parts.push(quote(variant));
    }
    rendered.push(`${context.imports.helper("definitionLocalisation")}(${parts.join(", ")})`);
  }

  return rendered;
}

function modifiersExpression(
  context: EmitContext,
  rules: readonly ImportedModifierRule[],
  variant?: string,
): readonly string[] {
  const rendered: string[] = [];

  for (const rule of rules) {
    if (rule.kind === "modifier-variant") {
      if (rule.mode === "include") {
        rendered.push(...modifiersExpression(context, rule.entries, rule.variant));
      }
      continue;
    }

    if (rule.kind === "unsupported-modifier") {
      context.counters.opaque += 1;
      context.diagnostics.push({
        definition: context.definition,
        code: rule.semantic.code,
        detail: rule.semantic.description,
      });
      continue;
    }

    const effectiveVariant: string | undefined = rule.variant ?? variant;
    const parts: string[] = [quote(rule.prefix), quote(rule.suffix), quote(rule.category)];
    if (effectiveVariant !== undefined) {
      parts.push(quote(effectiveVariant));
    }
    rendered.push(`${context.imports.helper("generatedModifier")}(${parts.join(", ")})`);
  }

  return rendered;
}

function emitDefinition(definition: ImportedDefinitionType, context: EmitContext): string {
  const { imports } = context;
  const parts: string[] = [`id: ${imports.definitionTypeId(definition.id, context.typeIds)}`];

  parts.push(`source: ${sourceExpression(context, definition.source)}`);

  const entryScopeRaw: string | undefined = definition.entryScopes[0];
  const entryScope: string | undefined =
    entryScopeRaw === undefined ? undefined : scopeExpression(context, entryScopeRaw);
  if (entryScope !== undefined) {
    parts.push(`entryScope: ${entryScope}`);
  }

  parts.push(`variants: ${variantsExpression(context, definition.subtypes)}`);

  const localisation: readonly string[] = localisationExpression(context, definition.localisation);
  parts.push(
    localisation.length === 0
      ? "localisation: []"
      : `localisation: [\n${localisation.map((value) => `${value},`).join("\n")}\n]`,
  );

  const modifiers: readonly string[] = modifiersExpression(context, definition.modifiers);
  parts.push(
    modifiers.length === 0 ? "modifiers: []" : `modifiers: [\n${modifiers.map((value) => `${value},`).join("\n")}\n]`,
  );

  // `entries` is already every schema block's entries flattened, so adding the
  // blocks again wrote all 234 types twice over — 9,490 rules where 4,740 exist.
  parts.push(`entries: ${entriesExpression(context, definition.entries)}`);

  const documentation: string = definition.annotations.documentation.join(" ").trim();
  if (documentation.length > 0) {
    parts.push(`documentation: ${quote(documentation)}`);
  }

  const body: string = `${imports.helper("defineType")}({\n${parts.map((value) => `${value},`).join("\n")}\n})`;
  // Registration is eager, so prune ids whose expression the caller discarded —
  // `noUnusedLocals` turns a stale import into a build failure.
  const usedCatalog: readonly string[] = [...imports.catalog]
    .filter((name) => new RegExp(`\\b${name}\\.`, "u").test(body))
    .sort(compareOrdinal);
  const catalogImport: string =
    usedCatalog.length === 0 ? "" : `import { ${usedCatalog.join(", ")} } from "../catalog.js";\n`;
  const irNames: readonly string[] = [...imports.ir].sort(compareOrdinal);
  const irImport: string =
    irNames.length === 0 ? "" : `import {\n${irNames.map((n) => `  ${n},`).join("\n")}\n} from "../ir.js";\n`;

  return [
    "// Generated by `npm run import:cwt` from cwtools-stellaris-config, then maintained by hand.",
    "// Re-running the importer proposes a diff; it never overwrites hand edits automatically.",
    "",
    catalogImport,
    irImport,
    'import type { DefinitionType } from "../ir.js";',
    "",
    `export const ${bindingName(definition.id)}: DefinitionType = ${body};`,
    "",
  ].join("\n");
}

const SCRIPT_FAMILY_IDS: ReadonlyMap<string, string> = new Map([
  ["trigger", "trigger"],
  ["effect", "effect"],
  ["modifier", "modifier"],
  ["modifier_rule", "modifier-rule"],
]);

/** `## scope = x` / `## scopes = { a b }` become the command's accepted input scopes. */
function inputScopeExpression(context: EmitContext, annotations: ImportedAnnotations): string {
  const { imports } = context;
  const selections: string[] = annotations.scopes
    .filter(
      (directive): directive is Extract<ImportedScopeDirective, { kind: "scope-constraint" }> =>
        directive.kind === "scope-constraint",
    )
    .flatMap((directive) => directive.selection.split(/\s+/u))
    .map((selection) => selection.trim())
    .filter((selection) => selection.length > 0);

  if (selections.length === 0) {
    return `${imports.helper("unspecifiedScope")}()`;
  }

  if (selections.some((selection) => ["any", "all"].includes(selection.toLowerCase()))) {
    return `${imports.helper("anyScope")}()`;
  }

  const resolved: string[] = [];
  for (const selection of selections) {
    const scope: string | undefined = scopeIdExpression(context, selection);
    if (scope !== undefined && !resolved.includes(scope)) {
      resolved.push(scope);
    }
  }

  return resolved.length === 0
    ? `${imports.helper("unspecifiedScope")}()`
    : `${imports.helper("listedScopes")}(${resolved.join(", ")})`;
}

function commandExpression(context: EmitContext, command: ImportedCommand): string {
  const family: string | undefined = SCRIPT_FAMILY_IDS.get(command.family);
  const parts: string[] = [];

  if (family === undefined) {
    parts.push(`family: ${quote(command.family)}`);
    if (command.name.length > 0) {
      parts.push(`name: ${quote(command.name)}`);
    }
    parts.push(`single: ${command.single ? "true" : "false"}`);
  } else {
    parts.push(
      `id: ${quote(command.name)}`,
      `family: ${quote(family)}`,
      `input: ${inputScopeExpression(context, command.annotations)}`,
    );
  }

  parts.push(`operator: ${quote(command.operator)}`, `value: ${valueExpression(context, command.value)}`);

  const documentation: string = command.annotations.documentation.join(" ").trim();
  if (documentation.length > 0) {
    parts.push(`documentation: ${quote(documentation)}`);
  }

  const scope: string | undefined = scopeChangeExpression(context, command.annotations.scopes);
  if (scope !== undefined) {
    parts.push(`scope: ${scope}`);
  }

  const severity: ImportedSeverity | undefined = command.annotations.severities[0];
  if (severity !== undefined && severity !== "error") {
    parts.push(`severity: ${quote(severity)}`);
  }

  return `{ ${parts.join(", ")} }`;
}

/**
 * Emits the alias families.
 *
 * Script families (trigger, effect, modifier, modifier rule) become commands
 * carrying their accepted input scopes; every other family becomes a rule set.
 */
export function emitCommandsSource(
  commands: readonly ImportedCommand[],
  catalog: ImportedCatalog,
): { readonly source: string; readonly commandCount: number; readonly ruleSetCount: number } {
  const context: EmitContext = {
    imports: new Imports(),
    catalog,
    typeIds: new Set(catalog.definitionTypeIds),
    enumIds: new Set(catalog.enumIds),
    scopeIds: new Set(catalog.scopes.map((scope) => scope.id)),
    scopeAliases: scopeAliasMap(catalog),
    diagnostics: [],
    definition: "<commands>",
    counters: { opaque: 0 },
  };

  const scriptCommands: string[] = [];
  const ruleSets: string[] = [];

  for (const command of [...commands].sort(
    (left, right) => compareOrdinal(left.family, right.family) || compareOrdinal(left.name, right.name),
  )) {
    const isScript: boolean = SCRIPT_FAMILY_IDS.has(command.family);
    const helper: string = context.imports.helper(isScript ? "scriptCommand" : "ruleSet");
    const rendered: string = commandExpression(context, command);
    (isScript ? scriptCommands : ruleSets).push(`  ${helper}(${rendered}),`);
  }

  const irNames: readonly string[] = [...context.imports.ir].sort(compareOrdinal);
  const catalogNames: readonly string[] = [...context.imports.catalog].sort(compareOrdinal);
  const body: string = [
    "// Generated by `npm run import:cwt` from cwtools-stellaris-config, then maintained by hand.",
    "",
    catalogNames.length === 0 ? "" : `import { ${catalogNames.join(", ")} } from "./catalog.js";`,
    irNames.length === 0 ? "" : `import { ${irNames.join(", ")} } from "./ir.js";`,
    'import type { RuleSetDefinition, ScriptCommandDefinition } from "./ir.js";',
    "",
    "export const commands: readonly ScriptCommandDefinition[] = [",
    scriptCommands.join("\n"),
    "];",
    "",
    "export const ruleSets: readonly RuleSetDefinition[] = [",
    ruleSets.join("\n"),
    "];",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { source: body, commandCount: scriptCommands.length, ruleSetCount: ruleSets.length };
}

function scopeAliasMap(catalog: ImportedCatalog): ReadonlyMap<string, string> {
  const scopeAliases = new Map<string, string>();

  for (const scope of catalog.scopes) {
    scopeAliases.set(scope.id.toLowerCase(), scope.id);
    for (const alias of scope.aliases) {
      scopeAliases.set(alias.toLowerCase(), scope.id);
    }
    scopeAliases.set(scope.displayName.replace(/^"|"$/gu, "").toLowerCase().replace(/\s+/gu, "_"), scope.id);
  }

  return scopeAliases;
}

export function emitSchemaSources(
  definitions: readonly ImportedDefinitionType[],
  catalog: ImportedCatalog,
): EmitResult {
  const typeIds: ReadonlySet<string> = new Set(catalog.definitionTypeIds);
  const enumIds: ReadonlySet<string> = new Set(catalog.enumIds);
  const scopeIds: ReadonlySet<string> = new Set(catalog.scopes.map((scope) => scope.id));
  const scopeAliases: ReadonlyMap<string, string> = scopeAliasMap(catalog);

  const diagnostics: EmitDiagnostic[] = [];
  const counters = { opaque: 0 };
  const files: EmittedFile[] = [];
  const sorted: readonly ImportedDefinitionType[] = [...definitions].sort((left, right) =>
    compareOrdinal(left.id, right.id),
  );

  for (const definition of sorted) {
    const context: EmitContext = {
      imports: new Imports(),
      catalog,
      typeIds,
      enumIds,
      scopeIds,
      scopeAliases,
      diagnostics,
      definition: definition.id,
      counters,
    };

    files.push({
      path: `src/schema/definitions/${moduleName(definition.id)}.ts`,
      source: emitDefinition(definition, context),
    });
  }

  const indexBody: string = sorted
    .map((definition) => `export { ${bindingName(definition.id)} } from "./${moduleName(definition.id)}.js";`)
    .join("\n");
  const registryBody: string = sorted.map((definition) => `  ${bindingName(definition.id)},`).join("\n");
  const registryImports: string = sorted
    .map((definition) => `import { ${bindingName(definition.id)} } from "./${moduleName(definition.id)}.js";`)
    .join("\n");

  files.push({
    path: "src/schema/definitions/index.ts",
    source: [
      "// Generated by `npm run import:cwt`.",
      "",
      registryImports,
      'import type { DefinitionType } from "../ir.js";',
      "",
      indexBody,
      "",
      "export const definitionTypes: readonly DefinitionType[] = [",
      registryBody,
      "];",
      "",
    ].join("\n"),
  });

  return { files, diagnostics, opaqueCount: counters.opaque };
}

/**
 * Scope groups and named values are referenced but never registered in the cwt
 * corpus, so the declaration list is whatever the rules actually mention.
 * Collecting from the translation is exact; a regex over the text is not.
 */
export interface ReferencedNames {
  readonly scopeGroups: readonly string[];
  readonly namedValues: readonly string[];
  readonly valueSets: readonly string[];
}

export function collectReferencedNames(
  definitions: readonly ImportedDefinitionType[],
  commands: readonly ImportedCommand[],
): ReferencedNames {
  const scopeGroups = new Set<string>();
  const namedValues = new Set<string>();
  const valueSets = new Set<string>();

  const visitValue = (value: ImportedValueRule): void => {
    switch (value.kind) {
      case "scope-group-reference":
        scopeGroups.add(value.group);
        return;
      case "named-value-reference":
        namedValues.add(value.set);
        return;
      case "value-set-reference":
        valueSets.add(value.set);
        return;
      case "block":
        for (const entry of value.entries) {
          visitEntry(entry);
        }
        return;
      default:
        return;
    }
  };

  const visitKey = (key: ImportedKeyRule): void => {
    if (key.kind === "scope-group-key") {
      scopeGroups.add(key.group);
    } else if (key.kind === "named-value-key" || key.kind === "value-set-key") {
      (key.kind === "named-value-key" ? namedValues : valueSets).add(key.set);
    }
  };

  const visitEntry = (entry: ImportedEntryRule): void => {
    switch (entry.kind) {
      case "field":
        visitKey(entry.key);
        visitValue(entry.value);
        return;
      case "item":
        visitValue(entry.value);
        return;
      case "variant-rules":
        for (const child of entry.entries) {
          visitEntry(child);
        }
        return;
      default:
        return;
    }
  };

  for (const definition of definitions) {
    for (const entry of definition.entries) {
      visitEntry(entry);
    }
    for (const subtype of definition.subtypes) {
      for (const entry of subtype.criteria) {
        visitEntry(entry);
      }
    }
  }

  for (const command of commands) {
    visitValue(command.value);
  }

  const sorted = (values: Set<string>): readonly string[] =>
    [...values].sort((left, right) => compareOrdinal(left, right));

  return { scopeGroups: sorted(scopeGroups), namedValues: sorted(namedValues), valueSets: sorted(valueSets) };
}

export function emitReferencedNamesSource(names: ReferencedNames, catalog: ImportedCatalog): string {
  const scopeIds: ReadonlySet<string> = new Set(catalog.scopes.map((scope) => scope.id));
  const aliases: ReadonlyMap<string, string> = scopeAliasMap(catalog);
  const groupEntries: string = names.scopeGroups
    .map((id) => {
      // A group's members are unknown from the corpus; the id often names a
      // scope, so seed it with that and let the schema be corrected by hand.
      const seed: string | undefined = aliases.get(id.toLowerCase());
      const scopes: string = seed !== undefined && scopeIds.has(seed) ? `[${JSON.stringify(seed)}]` : "[]";
      return `  { id: ${JSON.stringify(id)}, scopes: ${scopes} },`;
    })
    .join("\n");
  const namedValueEntries: string = names.namedValues
    .map((id) => `  { id: ${JSON.stringify(id)}, value: primitive("number") },`)
    .join("\n");
  const valueSetEntries: string = names.valueSets
    .map((id) => `  { id: ${JSON.stringify(id)}, key: anyKey(), value: primitive("scalar") },`)
    .join("\n");

  return [
    "// Generated by `npm run import:cwt` from cwtools-stellaris-config, then maintained by hand.",
    "// Scope groups, named values and value sets are declared by usage, so this is",
    "// the set of names the imported rules actually reference.",
    "",
    'import { anyKey, primitive } from "./ir.js";',
    'import type { NamedValueDefinition, ScopeGroupDefinition, ValueSetDefinition } from "./ir.js";',
    "",
    "export const scopeGroups: readonly ScopeGroupDefinition[] = [",
    groupEntries,
    "];",
    "",
    "export const namedValues: readonly NamedValueDefinition[] = [",
    namedValueEntries,
    "];",
    "",
    "export const valueSets: readonly ValueSetDefinition[] = [",
    valueSetEntries,
    "];",
    "",
  ].join("\n");
}
