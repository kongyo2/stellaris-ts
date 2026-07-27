import { DefinitionTypeId, EnumId, ScopeId } from "../../src/schema/catalog.js";
import type {
  DefinitionType,
  EntryRule,
  KeyRule,
  ScopeChange,
  ScopeReference,
  ScopeSelection,
  ScopeSlot,
  SchemaModel,
  ValueRule,
  VariantDefinition,
} from "../../src/schema/ir.js";

/**
 * Self-consistency of the schema IR.
 *
 * Every enum, scope and definition-type a rule points at must exist, and the
 * corpus must stay as wide as the import measured. Thresholds come from the
 * importer's structural counts, never from prose — see PLAN.md §1.
 */

export interface IntegrityIssue {
  readonly definition: string;
  readonly code: string;
  readonly detail: string;
}

export interface CoverageMetric {
  readonly name: string;
  readonly actual: number;
  readonly minimum: number;
  readonly definition: string;
}

export interface IntegrityReport {
  readonly issues: readonly IntegrityIssue[];
  readonly coverage: readonly CoverageMetric[];
  readonly shortfalls: readonly CoverageMetric[];
}

const KNOWN_ENUMS: ReadonlySet<string> = new Set(Object.values(EnumId));
const KNOWN_SCOPES: ReadonlySet<string> = new Set(Object.values(ScopeId));
const KNOWN_TYPES: ReadonlySet<string> = new Set(Object.values(DefinitionTypeId));

/**
 * Lower bounds, each recorded with how it was counted.
 *
 * Every number here is measured — five are independently derivable from the cwt
 * corpus structure, two are the importer's own measured output and act purely as
 * regression guards. None is an estimate: PLAN.md §1 records what happens when a
 * guessed number gets frozen into a gate.
 */
const COVERAGE_MINIMUMS: readonly { readonly name: string; readonly minimum: number; readonly definition: string }[] = [
  { name: "definitionTypes", minimum: 234, definition: "`type[x] = {` declarations in the cwt corpus" },
  { name: "enums", minimum: 206, definition: "static (179) plus complex (27) enum declarations" },
  { name: "scopes", minimum: 41, definition: "blocks directly inside `scopes = { }`" },
  { name: "links", minimum: 85, definition: "blocks directly inside `links = { }`, deduplicated by name" },
  { name: "variants", minimum: 257, definition: "`subtype[x] = {` declarations, excluding references" },
  {
    name: "localisationRequirements",
    minimum: 231,
    definition: "regression guard: flattened `localisation = { }` requirements as last imported",
  },
  {
    name: "generatedModifiers",
    minimum: 7,
    definition: "regression guard: all 7 templates in the corpus's 4 `modifiers = { }` blocks",
  },
];

function scopeReferenceIssues(definition: string, reference: ScopeReference | undefined): IntegrityIssue[] {
  if (reference === undefined || typeof reference !== "string") {
    return [];
  }

  return KNOWN_SCOPES.has(reference) ? [] : [{ definition, code: "unknown-scope", detail: reference }];
}

function scopeSelectionIssues(definition: string, selection: ScopeSelection): IntegrityIssue[] {
  if (selection.kind !== "listed-scopes") {
    return [];
  }

  return selection.scopes
    .filter((scope) => !KNOWN_SCOPES.has(scope))
    .map((scope) => ({ definition, code: "unknown-scope", detail: scope }));
}

function valueIssues(definition: string, value: ValueRule): IntegrityIssue[] {
  switch (value.kind) {
    case "enum":
      return KNOWN_ENUMS.has(value.enum) ? [] : [{ definition, code: "unknown-enum", detail: value.enum }];
    case "chained-enum":
      return [
        ...(KNOWN_ENUMS.has(value.enum) ? [] : [{ definition, code: "unknown-enum", detail: value.enum }]),
        ...scopeReferenceIssues(definition, value.scope),
      ];
    case "type-reference":
      return KNOWN_TYPES.has(value.type) ? [] : [{ definition, code: "unknown-type", detail: value.type }];
    case "interpolated-type":
      return KNOWN_TYPES.has(value.type) ? [] : [{ definition, code: "unknown-type", detail: value.type }];
    case "scope-reference":
      return scopeReferenceIssues(definition, value.scope);
    case "block":
      return value.entries.flatMap((entry) => entryIssues(definition, entry));
    case "list":
      return valueIssues(definition, value.item);
    case "choice":
      return value.choices.flatMap((choice) => valueIssues(definition, choice));
    case "opaque":
      return [{ definition, code: "opaque-value", detail: value.reason }];
    default:
      return [];
  }
}

function keyIssues(definition: string, key: KeyRule): IntegrityIssue[] {
  if (typeof key === "string") {
    return [];
  }

  switch (key.kind) {
    case "enum-key":
      return KNOWN_ENUMS.has(key.enum) ? [] : [{ definition, code: "unknown-enum", detail: key.enum }];
    case "type-key":
      return KNOWN_TYPES.has(key.type) ? [] : [{ definition, code: "unknown-type", detail: key.type }];
    case "scope-key":
      return scopeReferenceIssues(definition, key.scope);
    case "pattern-key":
      return key.type === undefined || KNOWN_TYPES.has(key.type)
        ? []
        : [{ definition, code: "unknown-type", detail: key.type }];
    default:
      return [];
  }
}

function scopeSlotIssues(definition: string, slot: ScopeSlot | undefined): IntegrityIssue[] {
  if (slot === undefined) {
    return [];
  }

  if (typeof slot === "string") {
    return scopeReferenceIssues(definition, slot);
  }

  return slot.kind === "scope-alternatives"
    ? slot.scopes.flatMap((scope: ScopeReference) => scopeReferenceIssues(definition, scope))
    : [];
}

function scopeChangeIssues(definition: string, change: ScopeChange | undefined): IntegrityIssue[] {
  if (change === undefined) {
    return [];
  }

  if (change.kind === "enter") {
    return scopeReferenceIssues(definition, change.scope);
  }

  const slots: readonly (ScopeSlot | undefined)[] = [
    change.frame.current,
    change.frame.root,
    change.frame.previous,
    change.frame.from,
    change.frame.fromFrom,
    change.frame.fromFromFrom,
    change.frame.fromFromFromFrom,
  ];

  return slots.flatMap((slot) => scopeSlotIssues(definition, slot));
}

function entryIssues(definition: string, entry: EntryRule): IntegrityIssue[] {
  const scoped: IntegrityIssue[] = entry.kind === "variant-rules" ? [] : scopeChangeIssues(definition, entry.scope);

  switch (entry.kind) {
    case "field":
      return [...scoped, ...keyIssues(definition, entry.key), ...valueIssues(definition, entry.value)];
    case "item":
      return [...scoped, ...valueIssues(definition, entry.value)];
    case "variant-rules":
      return entry.entries.flatMap((child) => entryIssues(definition, child));
    default:
      return scoped;
  }
}

function variantIssues(definition: string, variant: VariantDefinition): IntegrityIssue[] {
  return scopeReferenceIssues(definition, variant.entryScope);
}

function definitionIssues(type: DefinitionType): IntegrityIssue[] {
  return [
    ...scopeReferenceIssues(type.id, type.entryScope),
    ...type.variants.flatMap((variant) => variantIssues(type.id, variant)),
    ...type.entries.flatMap((entry) => entryIssues(type.id, entry)),
  ];
}

export function checkSchemaIntegrity(model: SchemaModel): IntegrityReport {
  const issues: IntegrityIssue[] = model.definitionTypes.flatMap(definitionIssues);

  for (const enumDefinition of model.enums) {
    if (!KNOWN_ENUMS.has(enumDefinition.id)) {
      issues.push({ definition: "<enums>", code: "unknown-enum", detail: enumDefinition.id });
    }
  }

  for (const scope of model.scopes) {
    if (!KNOWN_SCOPES.has(scope.id)) {
      issues.push({ definition: "<scopes>", code: "unknown-scope", detail: scope.id });
    }
  }

  for (const link of model.links) {
    if (link.kind !== "scope-link") {
      continue;
    }
    issues.push(...scopeSelectionIssues("<links>", link.input));
    if (link.output.kind === "fixed-scope") {
      issues.push(
        ...link.output.scopes
          .filter((scope) => !KNOWN_SCOPES.has(scope))
          .map((scope) => ({ definition: "<links>", code: "unknown-scope", detail: scope })),
      );
    }
  }

  const actuals: ReadonlyMap<string, number> = new Map([
    ["definitionTypes", model.definitionTypes.length],
    ["enums", model.enums.length],
    ["scopes", model.scopes.length],
    ["links", model.links.length],
    ["variants", model.definitionTypes.reduce((total, type) => total + type.variants.length, 0)],
    ["localisationRequirements", model.definitionTypes.reduce((total, type) => total + type.localisation.length, 0)],
    ["generatedModifiers", model.definitionTypes.reduce((total, type) => total + type.modifiers.length, 0)],
  ]);

  const coverage: CoverageMetric[] = COVERAGE_MINIMUMS.map((entry) => ({
    name: entry.name,
    minimum: entry.minimum,
    definition: entry.definition,
    actual: actuals.get(entry.name) ?? 0,
  }));

  return {
    issues: issues.sort(
      (left, right) =>
        (left.definition < right.definition ? -1 : left.definition > right.definition ? 1 : 0) ||
        (left.code < right.code ? -1 : left.code > right.code ? 1 : 0) ||
        (left.detail < right.detail ? -1 : left.detail > right.detail ? 1 : 0),
    ),
    coverage,
    shortfalls: coverage.filter((metric) => metric.actual < metric.minimum),
  };
}
