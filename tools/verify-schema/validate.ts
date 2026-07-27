import type {
  DefinitionType,
  EntryOptions,
  EntryRule,
  KeyRule,
  LinkDefinition,
  Occurrence,
  SchemaModel,
  ScopeChange,
  ScopeFrame,
  ScopeReference,
  ScopeResult,
  ScopeSelection,
  ScopeSlot,
  ValueRule,
  VariantPredicate,
} from "../../src/schema/ir.js";

export type SchemaValidationDiagnosticCode =
  | "below-structural-minimum"
  | "duplicate-definition-type-id"
  | "duplicate-enum-id"
  | "duplicate-macro-id"
  | "duplicate-named-value-id"
  | "duplicate-scope-group-id"
  | "duplicate-scope-id"
  | "duplicate-value-set-id"
  | "duplicate-variant-id"
  | "invalid-occurrence"
  | "invalid-structural-minimum"
  | "missing-enum-reference"
  | "missing-named-value-reference"
  | "missing-rule-set-reference"
  | "missing-scope-group-reference"
  | "missing-scope-reference"
  | "missing-type-reference"
  | "missing-value-set-reference"
  | "opaque-migration-debt"
  | "unknown-variant-reference"
  | "unsafe-path";

export interface SchemaValidationDiagnostic {
  readonly code: SchemaValidationDiagnosticCode;
  readonly message: string;
  readonly path: string;
  readonly severity: "error";
}

export type SchemaStructuralMetric =
  | "commands"
  | "dataLinks"
  | "definitionTypes"
  | "effectCommands"
  | "enums"
  | "extractedEnums"
  | "links"
  | "macros"
  | "modifierCommands"
  | "modifierRuleCommands"
  | "namedValues"
  | "ruleSets"
  | "scopeLinks"
  | "scopeGroups"
  | "scopes"
  | "staticEnums"
  | "triggerCommands"
  | "valueSets"
  | "variants";

export type SchemaStructuralMinimums = Readonly<Partial<Record<SchemaStructuralMetric, number>>>;

export interface SchemaValidationOptions {
  /**
   * Minimums derived by the caller from a structural import audit. Counts are
   * declaration counts, so legal command and link overloads each contribute.
   */
  readonly minimums?: SchemaStructuralMinimums;
}

interface ValidationContext {
  readonly definitionById: ReadonlyMap<string, DefinitionType>;
  readonly diagnostics: SchemaValidationDiagnostic[];
  readonly enumIds: ReadonlySet<string>;
  readonly namedValueIds: ReadonlySet<string>;
  readonly ruleSetFamilies: ReadonlySet<string>;
  readonly ruleSetIdentities: ReadonlySet<string>;
  readonly scopeGroupIds: ReadonlySet<string>;
  readonly scopeIds: ReadonlySet<string>;
  readonly valueSetIds: ReadonlySet<string>;
}

const structuralMetricOrder: readonly SchemaStructuralMetric[] = [
  "definitionTypes",
  "variants",
  "enums",
  "staticEnums",
  "extractedEnums",
  "scopes",
  "links",
  "scopeLinks",
  "dataLinks",
  "commands",
  "triggerCommands",
  "effectCommands",
  "modifierCommands",
  "modifierRuleCommands",
  "namedValues",
  "valueSets",
  "scopeGroups",
  "ruleSets",
  "macros",
];

function addDiagnostic(
  context: ValidationContext,
  code: SchemaValidationDiagnosticCode,
  path: string,
  message: string,
): void {
  context.diagnostics.push({ code, path, message, severity: "error" });
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function compareDiagnostics(left: SchemaValidationDiagnostic, right: SchemaValidationDiagnostic): number {
  return (
    compareText(left.path, right.path) || compareText(left.code, right.code) || compareText(left.message, right.message)
  );
}

function assertUnreachable(value: never): never {
  throw new Error(`Unhandled schema variant: ${String(value)}`);
}

function collectionPath(collection: string, index: number): string {
  return `${collection}[${index}]`;
}

function checkDuplicateIds<T>(
  context: ValidationContext,
  items: readonly T[],
  collection: string,
  code: SchemaValidationDiagnosticCode,
  getId: (item: T) => string,
): void {
  const firstPathById = new Map<string, string>();
  items.forEach((item, index) => {
    const id = getId(item);
    const path = collectionPath(collection, index);
    const firstPath = firstPathById.get(id);
    if (firstPath === undefined) {
      firstPathById.set(id, path);
      return;
    }
    addDiagnostic(context, code, `${path}.id`, `ID "${id}" duplicates ${firstPath}.id.`);
  });
}

function checkReference(
  context: ValidationContext,
  ids: ReadonlySet<string>,
  id: string,
  path: string,
  code: SchemaValidationDiagnosticCode,
  kind: string,
): void {
  if (!ids.has(id)) {
    addDiagnostic(context, code, path, `${kind} "${id}" is not declared in this schema.`);
  }
}

function checkScopeReference(context: ValidationContext, scope: ScopeReference, path: string): void {
  if (typeof scope === "string") {
    checkReference(context, context.scopeIds, scope, path, "missing-scope-reference", "Scope");
  }
}

function checkScopeSlot(context: ValidationContext, slot: ScopeSlot, path: string): void {
  if (typeof slot !== "string" && slot.kind === "scope-alternatives") {
    slot.scopes.forEach((scope, index) => {
      checkScopeReference(context, scope, `${path}.scopes[${index}]`);
    });
    return;
  }
  checkScopeReference(context, slot, path);
}

function checkEnumReference(context: ValidationContext, enumId: string, path: string): void {
  checkReference(context, context.enumIds, enumId, path, "missing-enum-reference", "Enum");
}

function checkTypeReference(context: ValidationContext, typeId: string, path: string): DefinitionType | undefined {
  const definition = context.definitionById.get(typeId);
  if (definition === undefined) {
    addDiagnostic(
      context,
      "missing-type-reference",
      path,
      `Definition type "${typeId}" is not declared in this schema.`,
    );
  }
  return definition;
}

function checkValueSetReference(context: ValidationContext, setId: string, path: string): void {
  checkReference(context, context.valueSetIds, setId, path, "missing-value-set-reference", "Value set");
}

function checkNamedValueReference(context: ValidationContext, valueId: string, path: string): void {
  checkReference(context, context.namedValueIds, valueId, path, "missing-named-value-reference", "Named value");
}

function checkScopeGroupReference(context: ValidationContext, groupId: string, path: string): void {
  checkReference(context, context.scopeGroupIds, groupId, path, "missing-scope-group-reference", "Scope group");
}

function ruleSetIdentity(family: string, name: string | undefined, single: boolean): string {
  return JSON.stringify([family, name ?? null, single]);
}

function checkRuleSetFamily(context: ValidationContext, family: string, path: string): void {
  checkReference(context, context.ruleSetFamilies, family, path, "missing-rule-set-reference", "Rule-set family");
}

function checkRuleSetReference(
  context: ValidationContext,
  family: string,
  name: string | undefined,
  single: boolean,
  path: string,
): void {
  const identity = ruleSetIdentity(family, name, single);
  if (!context.ruleSetIdentities.has(identity)) {
    const qualifier = name === undefined ? "" : ` named "${name}"`;
    addDiagnostic(
      context,
      "missing-rule-set-reference",
      path,
      `Rule set family "${family}"${qualifier} with single=${single} is not declared in this schema.`,
    );
  }
}

function unsafePathReason(value: string): string | undefined {
  if (value.length === 0) {
    return "the path is empty";
  }
  if (/^[A-Za-z]:/.test(value) || /^(?:\\\\|\/\/|[\\/])/.test(value)) {
    return "absolute paths are not portable";
  }
  const segments = value.replaceAll("\\", "/").split("/");
  if (segments.includes("..")) {
    return "parent-directory traversal is not allowed";
  }
  if (segments.some((segment) => segment.toLowerCase() === "refs")) {
    return "publishable schema must not depend on refs";
  }
  return undefined;
}

function checkPath(context: ValidationContext, value: string, path: string): void {
  const reason = unsafePathReason(value);
  if (reason !== undefined) {
    addDiagnostic(context, "unsafe-path", path, `Unsafe path "${value}": ${reason}.`);
  }
}

function checkOccurrence(context: ValidationContext, occurrence: Occurrence, path: string): void {
  const minIsValid = Number.isInteger(occurrence.min) && occurrence.min >= 0;
  const maxIsValid = occurrence.max === null || (Number.isInteger(occurrence.max) && occurrence.max >= occurrence.min);
  if (!minIsValid || !maxIsValid) {
    addDiagnostic(
      context,
      "invalid-occurrence",
      path,
      `Occurrence must use a non-negative integer min and a null or integer max greater than or equal to min; received ${occurrence.min}..${occurrence.max === null ? "*" : occurrence.max}.`,
    );
  }
}

function checkScopeFrame(context: ValidationContext, frame: ScopeFrame, path: string): void {
  if (frame.current !== undefined) {
    checkScopeSlot(context, frame.current, `${path}.current`);
  }
  if (frame.root !== undefined) {
    checkScopeSlot(context, frame.root, `${path}.root`);
  }
  if (frame.previous !== undefined) {
    checkScopeSlot(context, frame.previous, `${path}.previous`);
  }
  if (frame.from !== undefined) {
    checkScopeSlot(context, frame.from, `${path}.from`);
  }
  if (frame.fromFrom !== undefined) {
    checkScopeSlot(context, frame.fromFrom, `${path}.fromFrom`);
  }
  if (frame.fromFromFrom !== undefined) {
    checkScopeSlot(context, frame.fromFromFrom, `${path}.fromFromFrom`);
  }
  if (frame.fromFromFromFrom !== undefined) {
    checkScopeSlot(context, frame.fromFromFromFrom, `${path}.fromFromFromFrom`);
  }
}

function checkScopeChange(context: ValidationContext, scope: ScopeChange, path: string): void {
  switch (scope.kind) {
    case "enter":
      checkScopeReference(context, scope.scope, `${path}.scope`);
      return;
    case "replace":
      checkScopeFrame(context, scope.frame, `${path}.frame`);
      return;
  }
}

function checkEntryOptions(context: ValidationContext, options: EntryOptions, path: string): void {
  if (options.scope !== undefined) {
    checkScopeChange(context, options.scope, `${path}.scope`);
  }
}

function checkScopeSelection(context: ValidationContext, selection: ScopeSelection, path: string): void {
  switch (selection.kind) {
    case "any-scope":
    case "unspecified-scope":
      return;
    case "listed-scopes":
      selection.scopes.forEach((scope, index) => {
        checkScopeReference(context, scope, `${path}.scopes[${index}]`);
      });
      return;
  }
}

function checkScopeResult(context: ValidationContext, result: ScopeResult, path: string): void {
  switch (result.kind) {
    case "dynamic-scope":
      return;
    case "fixed-scope":
      result.scopes.forEach((scope, index) => {
        checkScopeReference(context, scope, `${path}.scopes[${index}]`);
      });
      return;
  }
}

function checkKey(context: ValidationContext, key: KeyRule, path: string): void {
  if (typeof key === "string") {
    return;
  }
  switch (key.kind) {
    case "any-key":
      return;
    case "enum-key":
      checkEnumReference(context, key.enum, `${path}.enum`);
      return;
    case "named-value-key":
      checkNamedValueReference(context, key.value, `${path}.value`);
      return;
    case "pattern-key":
      if (key.type !== undefined) {
        checkTypeReference(context, key.type, `${path}.type`);
      }
      return;
    case "rule-set-key":
      checkRuleSetReference(context, key.family, key.name, key.single, path);
      return;
    case "rule-set-keys-field-key":
      checkRuleSetFamily(context, key.family, `${path}.family`);
      return;
    case "scope-group-key":
      checkScopeGroupReference(context, key.group, `${path}.group`);
      return;
    case "scope-key":
      checkScopeReference(context, key.scope, `${path}.scope`);
      return;
    case "type-key":
      checkTypeReference(context, key.type, `${path}.type`);
      return;
    case "value-set-key":
      checkValueSetReference(context, key.set, `${path}.set`);
      return;
  }
}

function checkVariantReference(
  context: ValidationContext,
  variantIds: ReadonlySet<string> | undefined,
  variant: string,
  path: string,
): void {
  if (variantIds === undefined || !variantIds.has(variant)) {
    addDiagnostic(
      context,
      "unknown-variant-reference",
      path,
      `Variant "${variant}" is not declared on the containing definition type.`,
    );
  }
}

function checkPredicate(context: ValidationContext, predicate: VariantPredicate, path: string): void {
  switch (predicate.kind) {
    case "all":
    case "any":
      predicate.predicates.forEach((child, index) => {
        checkPredicate(context, child, `${path}.predicates[${index}]`);
      });
      return;
    case "not":
      checkPredicate(context, predicate.predicate, `${path}.predicate`);
      return;
    case "always":
    case "field-equals":
    case "field-presence":
    case "root-key":
      return;
  }
}

function checkValue(
  context: ValidationContext,
  value: ValueRule,
  path: string,
  variantIds?: ReadonlySet<string>,
): void {
  switch (value.kind) {
    case "any-value":
      return;
    case "block":
      checkEntries(context, value.entries, `${path}.entries`, variantIds);
      return;
    case "chained-enum":
      checkScopeReference(context, value.scope, `${path}.scope`);
      checkEnumReference(context, value.enum, `${path}.enum`);
      return;
    case "choice":
      value.choices.forEach((choice, index) => {
        checkValue(context, choice, `${path}.choices[${index}]`, variantIds);
      });
      return;
    case "enum":
      checkEnumReference(context, value.enum, `${path}.enum`);
      return;
    case "interpolated-type":
      checkTypeReference(context, value.type, `${path}.type`);
      return;
    case "list":
      checkOccurrence(context, value.items, `${path}.items`);
      checkValue(context, value.item, `${path}.item`, variantIds);
      return;
    case "literal":
    case "script-block":
    case "script-value":
      return;
    case "named-value":
      checkNamedValueReference(context, value.value, `${path}.value`);
      return;
    case "opaque":
      addDiagnostic(
        context,
        "opaque-migration-debt",
        path,
        `Opaque schema value is unresolved migration debt: ${value.reason}`,
      );
      return;
    case "primitive":
      if (value.path !== undefined) {
        checkPath(context, value.path, `${path}.path`);
      }
      return;
    case "rule-set-key-reference":
      checkRuleSetFamily(context, value.family, `${path}.family`);
      return;
    case "rule-set-reference":
      checkRuleSetReference(context, value.family, value.name, value.single, path);
      return;
    case "scope-group-reference":
      checkScopeGroupReference(context, value.group, `${path}.group`);
      return;
    case "scope-reference":
      if (value.scope !== undefined) {
        checkScopeReference(context, value.scope, `${path}.scope`);
      }
      return;
    case "type-reference": {
      const target = checkTypeReference(context, value.type, `${path}.type`);
      if (target !== undefined && value.variant !== undefined) {
        const targetVariants = new Set(target.variants.map((variant) => variant.id));
        if (!targetVariants.has(value.variant)) {
          addDiagnostic(
            context,
            "unknown-variant-reference",
            `${path}.variant`,
            `Variant "${value.variant}" is not declared on definition type "${value.type}".`,
          );
        }
      }
      return;
    }
    case "value-set":
      checkValueSetReference(context, value.set, `${path}.set`);
      return;
  }
}

function checkEntry(
  context: ValidationContext,
  entry: EntryRule,
  path: string,
  variantIds?: ReadonlySet<string>,
): void {
  switch (entry.kind) {
    case "field":
      checkEntryOptions(context, entry, path);
      checkKey(context, entry.key, `${path}.key`);
      checkOccurrence(context, entry.occurrence, `${path}.occurrence`);
      checkValue(context, entry.value, `${path}.value`, variantIds);
      return;
    case "item":
      checkEntryOptions(context, entry, path);
      checkOccurrence(context, entry.occurrence, `${path}.occurrence`);
      checkValue(context, entry.value, `${path}.value`, variantIds);
      return;
    case "script-entries":
      checkEntryOptions(context, entry, path);
      return;
    case "rule-set-entries":
      checkEntryOptions(context, entry, path);
      checkRuleSetFamily(context, entry.family, `${path}.family`);
      return;
    case "variant-rules":
      checkVariantReference(context, variantIds, entry.variant, `${path}.variant`);
      checkEntries(context, entry.entries, `${path}.entries`, variantIds);
      return;
  }
}

function checkEntries(
  context: ValidationContext,
  entries: readonly EntryRule[],
  path: string,
  variantIds?: ReadonlySet<string>,
): void {
  entries.forEach((entry, index) => {
    checkEntry(context, entry, `${path}[${index}]`, variantIds);
  });
}

function checkDefinition(context: ValidationContext, definition: DefinitionType, index: number): void {
  const path = collectionPath("definitionTypes", index);
  checkPath(context, definition.source.directory, `${path}.source.directory`);
  definition.source.files?.forEach((file, fileIndex) => {
    checkPath(context, file, `${path}.source.files[${fileIndex}]`);
  });
  if (definition.entryScope !== undefined) {
    checkScopeReference(context, definition.entryScope, `${path}.entryScope`);
  }

  checkDuplicateIds(context, definition.variants, `${path}.variants`, "duplicate-variant-id", (variant) => variant.id);
  const variantIds = new Set(definition.variants.map((variant) => variant.id));
  definition.variants.forEach((variant, variantIndex) => {
    const variantPath = `${path}.variants[${variantIndex}]`;
    checkPredicate(context, variant.when, `${variantPath}.when`);
    if (variant.entryScope !== undefined) {
      checkScopeReference(context, variant.entryScope, `${variantPath}.entryScope`);
    }
  });
  definition.localisation.forEach((requirement, requirementIndex) => {
    if (requirement.variant !== undefined) {
      checkVariantReference(
        context,
        variantIds,
        requirement.variant,
        `${path}.localisation[${requirementIndex}].variant`,
      );
    }
  });
  definition.modifiers.forEach((modifier, modifierIndex) => {
    if (modifier.variant !== undefined) {
      checkVariantReference(context, variantIds, modifier.variant, `${path}.modifiers[${modifierIndex}].variant`);
    }
  });
  checkEntries(context, definition.entries, `${path}.entries`, variantIds);
}

function checkLink(context: ValidationContext, link: LinkDefinition, index: number): void {
  const path = collectionPath("links", index);
  switch (link.kind) {
    case "data-link":
      checkValue(context, link.source, `${path}.source`);
      return;
    case "scope-link":
      checkScopeSelection(context, link.input, `${path}.input`);
      checkScopeResult(context, link.output, `${path}.output`);
      if (link.value !== undefined) {
        checkValue(context, link.value, `${path}.value`);
      }
      return;
  }
}

function structuralCount(model: SchemaModel, metric: SchemaStructuralMetric): number {
  switch (metric) {
    case "commands":
      return model.commands.length;
    case "dataLinks":
      return model.links.filter((link) => link.kind === "data-link").length;
    case "definitionTypes":
      return model.definitionTypes.length;
    case "effectCommands":
      return model.commands.filter((command) => command.family === "effect").length;
    case "enums":
      return model.enums.length;
    case "extractedEnums":
      return model.enums.filter((definition) => definition.kind === "extracted-enum").length;
    case "links":
      return model.links.length;
    case "macros":
      return model.policy.macros.length;
    case "modifierCommands":
      return model.commands.filter((command) => command.family === "modifier").length;
    case "modifierRuleCommands":
      return model.commands.filter((command) => command.family === "modifier-rule").length;
    case "namedValues":
      return model.namedValues.length;
    case "ruleSets":
      return model.ruleSets.length;
    case "scopeLinks":
      return model.links.filter((link) => link.kind === "scope-link").length;
    case "scopeGroups":
      return model.scopeGroups.length;
    case "scopes":
      return model.scopes.length;
    case "staticEnums":
      return model.enums.filter((definition) => definition.kind === "static-enum").length;
    case "triggerCommands":
      return model.commands.filter((command) => command.family === "trigger").length;
    case "valueSets":
      return model.valueSets.length;
    case "variants":
      return model.definitionTypes.reduce((count, definition) => count + definition.variants.length, 0);
    default:
      return assertUnreachable(metric);
  }
}

function checkMinimums(
  context: ValidationContext,
  model: SchemaModel,
  minimums: SchemaStructuralMinimums | undefined,
): void {
  if (minimums === undefined) {
    return;
  }
  structuralMetricOrder.forEach((metric) => {
    const minimum = minimums[metric];
    if (minimum === undefined) {
      return;
    }
    const path = `minimums.${metric}`;
    if (!Number.isInteger(minimum) || minimum < 0) {
      addDiagnostic(
        context,
        "invalid-structural-minimum",
        path,
        `Structural minimum must be a non-negative integer; received ${minimum}.`,
      );
      return;
    }
    const actual = structuralCount(model, metric);
    if (actual < minimum) {
      addDiagnostic(
        context,
        "below-structural-minimum",
        path,
        `Schema has ${actual} ${metric} declaration(s), below the caller-provided minimum of ${minimum}.`,
      );
    }
  });
}

/**
 * Validates referential and structural integrity without consulting CWT or
 * installed game data. Ordered field, command, and link overloads are legal.
 */
export function validateSchema(
  model: SchemaModel,
  options: SchemaValidationOptions = {},
): readonly SchemaValidationDiagnostic[] {
  const diagnostics: SchemaValidationDiagnostic[] = [];
  const definitionById = new Map<string, DefinitionType>();
  model.definitionTypes.forEach((definition) => {
    if (!definitionById.has(definition.id)) {
      definitionById.set(definition.id, definition);
    }
  });
  const context: ValidationContext = {
    definitionById,
    diagnostics,
    enumIds: new Set(model.enums.map((definition) => definition.id)),
    namedValueIds: new Set(model.namedValues.map((namedValue) => namedValue.id)),
    ruleSetFamilies: new Set(model.ruleSets.map((ruleSet) => ruleSet.family)),
    ruleSetIdentities: new Set(
      model.ruleSets.map((ruleSet) => ruleSetIdentity(ruleSet.family, ruleSet.name, ruleSet.single)),
    ),
    scopeGroupIds: new Set(model.scopeGroups.map((scopeGroup) => scopeGroup.id)),
    scopeIds: new Set(model.scopes.map((scope) => scope.id)),
    valueSetIds: new Set(model.valueSets.map((valueSetDefinition) => valueSetDefinition.id)),
  };

  checkDuplicateIds(
    context,
    model.definitionTypes,
    "definitionTypes",
    "duplicate-definition-type-id",
    (definition) => definition.id,
  );
  checkDuplicateIds(context, model.enums, "enums", "duplicate-enum-id", (definition) => definition.id);
  checkDuplicateIds(context, model.scopes, "scopes", "duplicate-scope-id", (scope) => scope.id);
  checkDuplicateIds(
    context,
    model.scopeGroups,
    "scopeGroups",
    "duplicate-scope-group-id",
    (scopeGroup) => scopeGroup.id,
  );
  checkDuplicateIds(
    context,
    model.namedValues,
    "namedValues",
    "duplicate-named-value-id",
    (namedValue) => namedValue.id,
  );
  checkDuplicateIds(
    context,
    model.valueSets,
    "valueSets",
    "duplicate-value-set-id",
    (valueSetDefinition) => valueSetDefinition.id,
  );
  checkDuplicateIds(context, model.policy.macros, "policy.macros", "duplicate-macro-id", (macro) => macro.id);

  model.definitionTypes.forEach((definition, index) => {
    checkDefinition(context, definition, index);
  });
  model.enums.forEach((definition, index) => {
    if (definition.kind === "extracted-enum") {
      definition.sources.forEach((source, sourceIndex) => {
        checkPath(context, source.directory, `enums[${index}].sources[${sourceIndex}].directory`);
      });
    }
  });
  model.links.forEach((link, index) => {
    checkLink(context, link, index);
  });
  model.scopeGroups.forEach((scopeGroup, index) => {
    scopeGroup.scopes.forEach((scope, scopeIndex) => {
      checkScopeReference(context, scope, `scopeGroups[${index}].scopes[${scopeIndex}]`);
    });
  });
  model.commands.forEach((command, index) => {
    const path = collectionPath("commands", index);
    checkEntryOptions(context, command, path);
    checkScopeSelection(context, command.input, `${path}.input`);
    checkValue(context, command.value, `${path}.value`);
  });
  model.ruleSets.forEach((ruleSet, index) => {
    const path = collectionPath("ruleSets", index);
    checkEntryOptions(context, ruleSet, path);
    checkValue(context, ruleSet.value, `${path}.value`);
  });
  model.namedValues.forEach((namedValue, index) => {
    checkValue(context, namedValue.value, `namedValues[${index}].value`);
  });
  model.valueSets.forEach((valueSetDefinition, index) => {
    const path = collectionPath("valueSets", index);
    checkKey(context, valueSetDefinition.key, `${path}.key`);
    checkValue(context, valueSetDefinition.value, `${path}.value`);
  });
  checkMinimums(context, model, options.minimums);

  diagnostics.sort(compareDiagnostics);
  return diagnostics;
}
