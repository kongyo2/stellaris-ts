import {
  NodeKind,
  ScalarKind,
  type Assignment,
  type Block,
  type EntryNode,
  type Scalar,
  type Span,
  type ValueNode,
} from "../../src/syntax/index.js";
import {
  CwtDirectiveName,
  type CwtAnnotatedEntry,
  type CwtAnnotation,
  type CwtCorpus,
  type CwtDirective,
  type CwtReadResult,
} from "./model.js";

export interface ImportedSourceLocation {
  readonly path: string;
  readonly span: Span;
}

export interface ImportedOccurrence {
  readonly min: number;
  readonly max: number | null;
}

export type ImportedSeverity = "error" | "hint" | "information" | "warning";

export interface ImportedKeyFilter {
  readonly mode: "exclude" | "include";
  readonly values: readonly string[];
  readonly source: ImportedSourceLocation;
}

export interface ImportedScopeBinding {
  readonly slot: string;
  readonly scope: string;
}

export interface ImportedEnterScope {
  readonly kind: "enter-scope";
  readonly scope: string;
  readonly source: ImportedSourceLocation;
}

export interface ImportedReplaceScope {
  readonly kind: "replace-scope";
  readonly bindings: readonly ImportedScopeBinding[];
  readonly source: ImportedSourceLocation;
}

export interface ImportedScopeConstraint {
  readonly kind: "scope-constraint";
  readonly selection: string;
  readonly source: ImportedSourceLocation;
}

export type ImportedScopeDirective = ImportedEnterScope | ImportedReplaceScope | ImportedScopeConstraint;

export interface ImportedUnsupportedSemantic {
  readonly code: string;
  readonly description: string;
  readonly source: ImportedSourceLocation;
}

export interface ImportedAnnotations {
  readonly documentation: readonly string[];
  readonly comments: readonly string[];
  readonly cardinalities: readonly ImportedOccurrence[];
  readonly scopes: readonly ImportedScopeDirective[];
  readonly severities: readonly ImportedSeverity[];
  readonly requirements: readonly ("optional" | "required")[];
  readonly primary: boolean;
  readonly displayNames: readonly string[];
  readonly abbreviations: readonly string[];
  readonly keyFilters: readonly ImportedKeyFilter[];
  readonly relatedTypes: readonly string[];
  readonly incomingReferenceLabels: readonly string[];
  readonly unsupported: readonly ImportedUnsupportedSemantic[];
}

export interface ImportedNumericRange {
  readonly min: number | null;
  readonly max: number | null;
}

export type ImportedPrimitiveType =
  "boolean" | "date" | "file" | "icon" | "integer" | "localisation" | "number" | "percentage" | "scalar";

export interface ImportedPrimitiveValue {
  readonly kind: "primitive";
  readonly type: ImportedPrimitiveType;
  readonly range?: ImportedNumericRange;
  readonly path?: string;
}

export interface ImportedLiteralValue {
  readonly kind: "literal";
  readonly value: string | number | boolean;
}

export interface ImportedAnyValue {
  readonly kind: "any-value";
}

export interface ImportedEnumReference {
  readonly kind: "enum-reference";
  readonly enum: string;
}

export interface ImportedChainedEnumReference {
  readonly kind: "chained-enum-reference";
  readonly scope: string;
  readonly enum: string;
}

export interface ImportedTypeReference {
  readonly kind: "type-reference";
  readonly type: string;
  readonly variant?: string;
}

export interface ImportedScopeReference {
  readonly kind: "scope-reference";
  readonly scope: string;
}

export interface ImportedScopeGroupReference {
  readonly kind: "scope-group-reference";
  readonly group: string;
}

export interface ImportedNamedValueReference {
  readonly kind: "named-value-reference";
  readonly set: string;
}

export interface ImportedValueSetReference {
  readonly kind: "value-set-reference";
  readonly set: string;
}

export interface ImportedScriptValue {
  readonly kind: "script-value";
  readonly result: "integer" | "number" | "percentage";
  readonly range?: ImportedNumericRange;
}

export interface ImportedColourValue {
  readonly kind: "colour";
  readonly format: string;
}

export interface ImportedNameFormatValue {
  readonly kind: "name-format";
  readonly format: string;
}

export interface ImportedAliasReference {
  readonly kind: "alias-reference";
  readonly family: string;
  readonly name?: string;
  readonly side: "left" | "right";
  readonly single: boolean;
}

export interface ImportedAliasKeyFieldValue {
  readonly kind: "alias-key-field";
  readonly family: string;
}

export interface ImportedBlockValue {
  readonly kind: "block";
  readonly entries: readonly ImportedEntryRule[];
}

export interface ImportedUnsupportedValue {
  readonly kind: "unsupported-value";
  readonly semantic: ImportedUnsupportedSemantic;
}

export type ImportedValueRule =
  | ImportedAliasKeyFieldValue
  | ImportedAliasReference
  | ImportedAnyValue
  | ImportedBlockValue
  | ImportedChainedEnumReference
  | ImportedColourValue
  | ImportedEnumReference
  | ImportedLiteralValue
  | ImportedNamedValueReference
  | ImportedNameFormatValue
  | ImportedPrimitiveValue
  | ImportedScopeGroupReference
  | ImportedScopeReference
  | ImportedScriptValue
  | ImportedTypeReference
  | ImportedUnsupportedValue
  | ImportedValueSetReference;

export interface ImportedLiteralKey {
  readonly kind: "literal-key";
  readonly value: string;
}

export interface ImportedAnyKey {
  readonly kind: "any-key";
}

export interface ImportedEnumKey {
  readonly kind: "enum-key";
  readonly enum: string;
}

export interface ImportedTypeKey {
  readonly kind: "type-key";
  readonly type: string;
  readonly variant?: string;
}

export interface ImportedScopeKey {
  readonly kind: "scope-key";
  readonly scope: string;
}

export interface ImportedScopeGroupKey {
  readonly kind: "scope-group-key";
  readonly group: string;
}

export interface ImportedNamedValueKey {
  readonly kind: "named-value-key";
  readonly set: string;
}

export interface ImportedValueSetKey {
  readonly kind: "value-set-key";
  readonly set: string;
}

export interface ImportedAliasKey {
  readonly kind: "alias-key";
  readonly family: string;
  readonly name?: string;
  readonly single: boolean;
}

export interface ImportedAliasKeysFieldKey {
  readonly kind: "alias-keys-field-key";
  readonly family: string;
}

export interface ImportedUnsupportedKey {
  readonly kind: "unsupported-key";
  readonly semantic: ImportedUnsupportedSemantic;
}

export type ImportedKeyRule =
  | ImportedAliasKey
  | ImportedAliasKeysFieldKey
  | ImportedAnyKey
  | ImportedEnumKey
  | ImportedLiteralKey
  | ImportedNamedValueKey
  | ImportedScopeGroupKey
  | ImportedScopeKey
  | ImportedTypeKey
  | ImportedUnsupportedKey
  | ImportedValueSetKey;

export interface ImportedFieldRule {
  readonly kind: "field";
  readonly key: ImportedKeyRule;
  readonly value: ImportedValueRule;
  readonly occurrence: ImportedOccurrence;
  readonly operator: Assignment["operator"];
  readonly annotations: ImportedAnnotations;
  readonly source: ImportedSourceLocation;
}

export interface ImportedItemRule {
  readonly kind: "item";
  readonly value: ImportedValueRule;
  readonly occurrence: ImportedOccurrence;
  readonly annotations: ImportedAnnotations;
  readonly source: ImportedSourceLocation;
}

export interface ImportedAliasExpansionRule {
  readonly kind: "alias-expansion";
  readonly family: string;
  readonly occurrence: ImportedOccurrence;
  readonly annotations: ImportedAnnotations;
  readonly source: ImportedSourceLocation;
}

export interface ImportedVariantRuleGroup {
  readonly kind: "variant-rules";
  readonly mode: "exclude" | "include";
  readonly variant: string;
  readonly entries: readonly ImportedEntryRule[];
  readonly annotations: ImportedAnnotations;
  readonly source: ImportedSourceLocation;
}

export interface ImportedUnsupportedEntryRule {
  readonly kind: "unsupported-entry";
  readonly semantic: ImportedUnsupportedSemantic;
  readonly annotations: ImportedAnnotations;
  readonly source: ImportedSourceLocation;
}

export type ImportedEntryRule =
  | ImportedAliasExpansionRule
  | ImportedFieldRule
  | ImportedItemRule
  | ImportedUnsupportedEntryRule
  | ImportedVariantRuleGroup;

export interface ImportedDefinitionSource {
  readonly kind: "file-root" | "keyed-blocks" | "tagged-blocks";
  readonly directory: string;
  readonly includeSubdirectories: boolean;
  readonly file?: string;
  readonly nameField?: string;
  readonly rootKey?: string;
  readonly severity?: ImportedSeverity;
  readonly keyFilters: readonly ImportedKeyFilter[];
}

export interface ImportedSubtype {
  readonly id: string;
  readonly criteria: readonly ImportedEntryRule[];
  readonly keyFilters: readonly ImportedKeyFilter[];
  readonly entryScopes: readonly string[];
  readonly displayNames: readonly string[];
  readonly abbreviations: readonly string[];
  readonly annotations: ImportedAnnotations;
  readonly source: ImportedSourceLocation;
}

export interface ImportedLocalisationRequirement {
  readonly kind: "localisation";
  readonly role: string;
  readonly template: string;
  readonly requirements: readonly ("optional" | "required")[];
  readonly primary: boolean;
  readonly annotations: ImportedAnnotations;
  readonly source: ImportedSourceLocation;
}

export interface ImportedLocalisationVariantGroup {
  readonly kind: "localisation-variant";
  readonly mode: "exclude" | "include";
  readonly variant: string;
  readonly entries: readonly ImportedLocalisationRule[];
  readonly annotations: ImportedAnnotations;
  readonly source: ImportedSourceLocation;
}

export interface ImportedUnsupportedLocalisation {
  readonly kind: "unsupported-localisation";
  readonly semantic: ImportedUnsupportedSemantic;
  readonly annotations: ImportedAnnotations;
  readonly source: ImportedSourceLocation;
}

export type ImportedLocalisationRule =
  ImportedLocalisationRequirement | ImportedLocalisationVariantGroup | ImportedUnsupportedLocalisation;

export interface ImportedGeneratedModifier {
  readonly kind: "generated-modifier";
  readonly template: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly category: string;
  readonly variant?: string;
  readonly annotations: ImportedAnnotations;
  readonly source: ImportedSourceLocation;
}

export interface ImportedModifierVariantGroup {
  readonly kind: "modifier-variant";
  readonly mode: "exclude" | "include";
  readonly variant: string;
  readonly entries: readonly ImportedModifierRule[];
  readonly annotations: ImportedAnnotations;
  readonly source: ImportedSourceLocation;
}

export interface ImportedUnsupportedModifier {
  readonly kind: "unsupported-modifier";
  readonly semantic: ImportedUnsupportedSemantic;
  readonly annotations: ImportedAnnotations;
  readonly source: ImportedSourceLocation;
}

export type ImportedModifierRule =
  ImportedGeneratedModifier | ImportedModifierVariantGroup | ImportedUnsupportedModifier;

export interface ImportedSchemaBlock {
  readonly entries: readonly ImportedEntryRule[];
  readonly annotations: ImportedAnnotations;
  readonly source: ImportedSourceLocation;
}

export interface ImportedDefinitionType {
  readonly id: string;
  readonly source: ImportedDefinitionSource;
  readonly subtypes: readonly ImportedSubtype[];
  readonly localisation: readonly ImportedLocalisationRule[];
  readonly modifiers: readonly ImportedModifierRule[];
  readonly schemaBlocks: readonly ImportedSchemaBlock[];
  readonly entries: readonly ImportedEntryRule[];
  readonly entryScopes: readonly string[];
  readonly annotations: ImportedAnnotations;
  readonly sourceLocation: ImportedSourceLocation;
}

/**
 * A root-level `alias[family:name] = value` declaration.
 *
 * Triggers and effects are the bulk of the schema and are declared this way, so
 * they are collected separately from the type registry: their value is often a
 * bare scalar rather than a block.
 */
export interface ImportedCommand {
  readonly family: string;
  readonly name: string;
  readonly single: boolean;
  readonly value: ImportedValueRule;
  readonly operator: Assignment["operator"];
  readonly annotations: ImportedAnnotations;
  readonly source: ImportedSourceLocation;
}

export interface CwtSchemaTranslation {
  readonly definitionTypes: readonly ImportedDefinitionType[];
  readonly commands: readonly ImportedCommand[];
  readonly unsupported: readonly ImportedUnsupportedSemantic[];
}

interface ParsedConstruct {
  readonly head: string;
  readonly argument: string;
}

interface TranslationContext {
  readonly file: CwtReadResult;
  readonly annotations: ReadonlyMap<EntryNode, CwtAnnotatedEntry>;
  readonly unsupported: ImportedUnsupportedSemantic[];
}

interface TypeDeclaration {
  readonly context: TranslationContext;
  readonly entry: Assignment;
  readonly block: Block;
  readonly id: string;
}

interface RootSchemaDeclaration {
  readonly context: TranslationContext;
  readonly entry: Assignment;
  readonly block: Block;
  readonly id: string;
}

const DEFAULT_OCCURRENCE: ImportedOccurrence = { min: 1, max: 1 };

function sourceLocation(context: TranslationContext, span: Span): ImportedSourceLocation {
  return { path: context.file.source.path, span };
}

function originalText(context: TranslationContext, node: { readonly span: Span }): string {
  return context.file.source.original.slice(node.span.start.offset, node.span.end.offset);
}

function annotationsFor(context: TranslationContext, entry: EntryNode): readonly CwtAnnotation[] {
  const annotated: CwtAnnotatedEntry | undefined = context.annotations.get(entry);
  if (annotated === undefined) {
    return [];
  }

  return [...annotated.leading, ...annotated.trailing].sort(
    (left, right) => left.span.start.offset - right.span.start.offset,
  );
}

function unsupported(
  context: TranslationContext,
  code: string,
  description: string,
  span: Span,
): ImportedUnsupportedSemantic {
  const semantic: ImportedUnsupportedSemantic = {
    code,
    description,
    source: sourceLocation(context, span),
  };
  context.unsupported.push(semantic);
  return semantic;
}

function parseBound(value: string): number | null | undefined {
  if (value === "inf" || value === "+inf" || value === "-inf") {
    return null;
  }

  const parsed: number = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRange(value: string): ImportedNumericRange | undefined {
  const match: RegExpExecArray | null = /^(-?(?:\d+(?:\.\d+)?|inf))\.{2,3}(-?(?:\d+(?:\.\d+)?|inf))$/u.exec(
    value.trim(),
  );
  if (match === null) {
    return undefined;
  }

  const rawMin: string | undefined = match[1];
  const rawMax: string | undefined = match[2];
  if (rawMin === undefined || rawMax === undefined) {
    return undefined;
  }

  const min: number | null | undefined = parseBound(rawMin);
  const max: number | null | undefined = parseBound(rawMax);
  return min === undefined || max === undefined ? undefined : { min, max };
}

function parseCardinality(value: string): ImportedOccurrence | undefined {
  const range: ImportedNumericRange | undefined = parseRange(value.replace(/^=\s*/u, ""));
  if (range === undefined || range.min === null) {
    return undefined;
  }

  return { min: range.min, max: range.max };
}

function directiveValues(value: string | null): string[] {
  if (value === null) {
    return [];
  }

  const withoutComment: string = value.split("#", 1)[0]?.trim() ?? "";
  const payload: string =
    withoutComment.startsWith("{") && withoutComment.endsWith("}") ? withoutComment.slice(1, -1) : withoutComment;
  return (
    payload
      .match(/"[^"]*"|[^\s{}]+/gu)
      ?.map((part) => part.replace(/^"|"$/gu, ""))
      .filter((part) => part.length > 0) ?? []
  );
}

function directiveTextValue(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }

  const text: string = value.split("#", 1)[0]?.trim().replace(/^"|"$/gu, "") ?? "";
  return text.length === 0 ? undefined : text;
}

function importedSeverity(value: string | null): ImportedSeverity | undefined {
  switch (value?.trim().toLowerCase()) {
    case "error":
      return "error";
    case "hint":
      return "hint";
    case "info":
    case "information":
      return "information";
    case "warning":
      return "warning";
    default:
      return undefined;
  }
}

function scopeBindings(value: string | null): ImportedScopeBinding[] {
  if (value === null) {
    return [];
  }

  const bindings: ImportedScopeBinding[] = [];
  for (const match of value.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/gu)) {
    const slot: string | undefined = match[1];
    const scope: string | undefined = match[2];
    if (slot !== undefined && scope !== undefined) {
      const normalisedSlot: string =
        {
          this: "current",
          prev: "previous",
          fromfrom: "fromFrom",
          fromfromfrom: "fromFromFrom",
          fromfromfromfrom: "fromFromFromFrom",
        }[slot] ?? slot;
      bindings.push({ slot: normalisedSlot, scope });
    }
  }
  return bindings;
}

function keyFilterFromDirective(context: TranslationContext, directive: CwtDirective): ImportedKeyFilter | undefined {
  const values: readonly string[] = directiveValues(directive.value);
  if (values.length === 0) {
    unsupported(
      context,
      "invalid-type-key-filter",
      "A type-key filter did not contain any selector values.",
      directive.span,
    );
    return undefined;
  }

  return {
    mode: directive.operator === "<>" ? "exclude" : "include",
    values,
    source: sourceLocation(context, directive.span),
  };
}

function translateAnnotations(context: TranslationContext, entry: EntryNode): ImportedAnnotations {
  const documentation: string[] = [];
  const comments: string[] = [];
  const cardinalities: ImportedOccurrence[] = [];
  const scopes: ImportedScopeDirective[] = [];
  const severities: ImportedSeverity[] = [];
  const requirements: ("optional" | "required")[] = [];
  const displayNames: string[] = [];
  const abbreviations: string[] = [];
  const keyFilters: ImportedKeyFilter[] = [];
  const relatedTypes: string[] = [];
  const incomingReferenceLabels: string[] = [];
  const unsupportedSemantics: ImportedUnsupportedSemantic[] = [];
  let primary = false;

  for (const annotation of annotationsFor(context, entry)) {
    if (annotation.kind === "documentation") {
      documentation.push(annotation.text);
      continue;
    }
    if (annotation.kind === "comment") {
      comments.push(annotation.text);
      continue;
    }

    const directive: CwtDirective = annotation;
    switch (directive.name) {
      case CwtDirectiveName.Cardinality: {
        const cardinality: ImportedOccurrence | undefined =
          directive.value === null ? undefined : parseCardinality(directive.value);
        if (cardinality === undefined) {
          unsupportedSemantics.push(
            unsupported(
              context,
              "invalid-cardinality",
              "A cardinality directive did not use a finite minimum and a finite or infinite maximum.",
              directive.span,
            ),
          );
        } else {
          cardinalities.push(cardinality);
        }
        break;
      }
      case CwtDirectiveName.PushScope: {
        const scope: string | undefined = directiveValues(directive.value)[0];
        if (scope === undefined) {
          unsupportedSemantics.push(
            unsupported(context, "invalid-push-scope", "A push-scope directive had no scope.", directive.span),
          );
        } else {
          scopes.push({
            kind: "enter-scope",
            scope,
            source: sourceLocation(context, directive.span),
          });
        }
        break;
      }
      case CwtDirectiveName.ReplaceScope:
      case CwtDirectiveName.ReplaceScopes: {
        const bindings: readonly ImportedScopeBinding[] = scopeBindings(directive.value);
        if (bindings.length === 0) {
          unsupportedSemantics.push(
            unsupported(
              context,
              "invalid-replace-scope",
              "A replace-scope directive had no scope-frame bindings.",
              directive.span,
            ),
          );
        } else {
          scopes.push({
            kind: "replace-scope",
            bindings,
            source: sourceLocation(context, directive.span),
          });
        }
        break;
      }
      case CwtDirectiveName.Scope: {
        const selection: string | undefined = directiveValues(directive.value)[0];
        if (selection === undefined) {
          unsupportedSemantics.push(
            unsupported(context, "invalid-scope-constraint", "A scope directive had no selection.", directive.span),
          );
        } else {
          scopes.push({
            kind: "scope-constraint",
            selection,
            source: sourceLocation(context, directive.span),
          });
        }
        break;
      }
      case CwtDirectiveName.Severity: {
        const severity: ImportedSeverity | undefined = importedSeverity(directive.value);
        if (severity === undefined) {
          unsupportedSemantics.push(
            unsupported(context, "invalid-severity", "A severity directive used an unknown level.", directive.span),
          );
        } else {
          severities.push(severity);
        }
        break;
      }
      case CwtDirectiveName.Optional:
        requirements.push("optional");
        break;
      case CwtDirectiveName.Required:
        requirements.push("required");
        break;
      case CwtDirectiveName.Primary:
        primary = true;
        break;
      case CwtDirectiveName.DisplayName:
        {
          const value: string | undefined = directiveTextValue(directive.value);
          if (value !== undefined) {
            displayNames.push(value);
          }
        }
        break;
      case CwtDirectiveName.Abbreviation:
        {
          const value: string | undefined = directiveTextValue(directive.value);
          if (value !== undefined) {
            abbreviations.push(value);
          }
        }
        break;
      case CwtDirectiveName.TypeKeyFilter: {
        const filter: ImportedKeyFilter | undefined = keyFilterFromDirective(context, directive);
        if (filter !== undefined) {
          keyFilters.push(filter);
        }
        break;
      }
      case CwtDirectiveName.GraphRelatedTypes:
        relatedTypes.push(...directiveValues(directive.value));
        break;
      case CwtDirectiveName.IncomingReferenceLabel:
        {
          const value: string | undefined = directiveTextValue(directive.value);
          if (value !== undefined) {
            incomingReferenceLabels.push(value);
          }
        }
        break;
      default:
        unsupportedSemantics.push(
          unsupported(
            context,
            "unsupported-directive",
            `The directive ${JSON.stringify(directive.name)} has no import semantic.`,
            directive.span,
          ),
        );
        break;
    }
  }

  return {
    documentation,
    comments,
    cardinalities,
    scopes,
    severities,
    requirements,
    primary,
    displayNames,
    abbreviations,
    keyFilters,
    relatedTypes,
    incomingReferenceLabels,
    unsupported: unsupportedSemantics,
  };
}

function occurrenceFrom(annotations: ImportedAnnotations): ImportedOccurrence {
  return annotations.cardinalities.at(-1) ?? DEFAULT_OCCURRENCE;
}

function parsedConstruct(text: string): ParsedConstruct | undefined {
  const trimmed: string = text.trim();
  const openBracket: number = trimmed.indexOf("[");
  if (openBracket <= 0 || !trimmed.endsWith("]")) {
    return undefined;
  }

  let depth = 0;
  for (let offset = openBracket; offset < trimmed.length; offset += 1) {
    const character: string | undefined = trimmed[offset];
    if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;
      if (depth === 0 && offset !== trimmed.length - 1) {
        return undefined;
      }
    }
  }

  if (depth !== 0) {
    return undefined;
  }

  return {
    head: trimmed.slice(0, openBracket),
    argument: trimmed.slice(openBracket + 1, -1).trim(),
  };
}

function typeReference(target: string): ImportedTypeReference {
  const separator: number = target.indexOf(".");
  if (separator < 0) {
    return { kind: "type-reference", type: target };
  }

  return {
    kind: "type-reference",
    type: target.slice(0, separator),
    variant: target.slice(separator + 1),
  };
}

function semanticFromConstruct(context: TranslationContext, construct: ParsedConstruct, span: Span): ImportedValueRule {
  const argument: string = construct.argument;
  switch (construct.head) {
    case "enum":
    case "complex_enum":
    case ".enum":
      return { kind: "enum-reference", enum: argument };
    case "type":
      return typeReference(argument);
    case "scope":
      return { kind: "scope-reference", scope: argument };
    case "scope_group":
      return { kind: "scope-group-reference", group: argument };
    case "value":
      return { kind: "named-value-reference", set: argument };
    case "value_set":
      return { kind: "value-set-reference", set: argument };
    case "int":
    case "float": {
      const range: ImportedNumericRange | undefined = parseRange(argument);
      if (range === undefined) {
        return {
          kind: "unsupported-value",
          semantic: unsupported(
            context,
            "invalid-numeric-range",
            `${construct.head} used a numeric range that could not be interpreted.`,
            span,
          ),
        };
      }
      return {
        kind: "primitive",
        type: construct.head === "int" ? "integer" : "number",
        range,
      };
    }
    case "int_value_field":
    case "value_field": {
      const range: ImportedNumericRange | undefined = parseRange(argument);
      if (range === undefined) {
        return {
          kind: "unsupported-value",
          semantic: unsupported(
            context,
            "invalid-script-value-range",
            `${construct.head} used a numeric range that could not be interpreted.`,
            span,
          ),
        };
      }
      return {
        kind: "script-value",
        result: construct.head === "int_value_field" ? "integer" : "number",
        range,
      };
    }
    case "filepath":
      return { kind: "primitive", type: "file", path: argument };
    case "icon":
      return { kind: "primitive", type: "icon", path: argument };
    case "colour":
      return { kind: "colour", format: argument };
    case "stellaris_name_format":
      return { kind: "name-format", format: argument };
    case "alias": {
      const separator: number = argument.indexOf(":");
      return {
        kind: "alias-reference",
        family: separator < 0 ? argument : argument.slice(0, separator),
        ...(separator < 0 ? {} : { name: argument.slice(separator + 1) }),
        side: "left",
        single: false,
      };
    }
    case "alias_name":
      return { kind: "alias-reference", family: argument, side: "left", single: false };
    case "alias_match_left":
      return { kind: "alias-reference", family: argument, side: "right", single: false };
    case "single_alias":
      return { kind: "alias-reference", family: argument, side: "left", single: true };
    case "single_alias_right":
      return { kind: "alias-reference", family: argument, side: "right", single: true };
    case "alias_keys_field":
      return { kind: "alias-key-field", family: argument };
    case "subtype":
      return {
        kind: "unsupported-value",
        semantic: unsupported(
          context,
          "subtype-used-as-value",
          "A subtype selector was used where a schema value was expected.",
          span,
        ),
      };
    default:
      return {
        kind: "unsupported-value",
        semantic: unsupported(
          context,
          "unsupported-constructor",
          `The constructor ${JSON.stringify(construct.head)} has no value semantic.`,
          span,
        ),
      };
  }
}

function primitiveFromBareName(value: string): ImportedValueRule | undefined {
  switch (value) {
    case "bool":
      return { kind: "primitive", type: "boolean" };
    case "date":
      return { kind: "primitive", type: "date" };
    case "filepath":
      return { kind: "primitive", type: "file" };
    case "icon":
      return { kind: "primitive", type: "icon" };
    case "int":
      return { kind: "primitive", type: "integer" };
    case "float":
      return { kind: "primitive", type: "number" };
    case "localisation":
      return { kind: "primitive", type: "localisation" };
    case "scalar":
      return { kind: "primitive", type: "scalar" };
    case "int_value_field":
      return { kind: "script-value", result: "integer" };
    case "percentage_field":
      return { kind: "script-value", result: "percentage" };
    case "value_field":
      return { kind: "script-value", result: "number" };
    case "OK":
      return { kind: "any-value" };
    default:
      return undefined;
  }
}

function scalarValue(context: TranslationContext, scalar: Scalar): ImportedValueRule {
  const raw: string = originalText(context, scalar).trim();
  const chainedEnum: RegExpExecArray | null = /^scope\[([^\]]+)\]\.enum\[([^\]]+)\]$/u.exec(raw);
  if (chainedEnum !== null) {
    const scope: string | undefined = chainedEnum[1];
    const enumName: string | undefined = chainedEnum[2];
    if (scope !== undefined && enumName !== undefined) {
      return { kind: "chained-enum-reference", scope: scope.trim(), enum: enumName.trim() };
    }
  }

  const angleReference: RegExpExecArray | null = /^<([A-Za-z_][A-Za-z0-9_.-]*)>$/u.exec(raw);
  if (angleReference !== null) {
    const target: string | undefined = angleReference[1];
    if (target !== undefined) {
      return typeReference(target);
    }
  }

  const construct: ParsedConstruct | undefined = parsedConstruct(raw);
  if (construct !== undefined) {
    return semanticFromConstruct(context, construct, scalar.span);
  }

  const primitive: ImportedValueRule | undefined = primitiveFromBareName(raw);
  if (primitive !== undefined) {
    return primitive;
  }

  switch (scalar.scalarKind) {
    case ScalarKind.Boolean:
    case ScalarKind.Number:
      return { kind: "literal", value: scalar.value };
    case ScalarKind.Date:
    case ScalarKind.Identifier:
    case ScalarKind.Parameter:
    case ScalarKind.QuotedString:
    case ScalarKind.ScriptVariable:
      return { kind: "literal", value: String(scalar.value) };
    default:
      return {
        kind: "unsupported-value",
        semantic: unsupported(context, "unsupported-scalar", "A scalar value could not be classified.", scalar.span),
      };
  }
}

function unsupportedValue(
  context: TranslationContext,
  value: ValueNode,
  code: string,
  description: string,
): ImportedUnsupportedValue {
  return {
    kind: "unsupported-value",
    semantic: unsupported(context, code, description, value.span),
  };
}

function translateValue(context: TranslationContext, value: ValueNode): ImportedValueRule {
  switch (value.kind) {
    case NodeKind.Block:
      return { kind: "block", entries: translateEntries(context, value.entries) };
    case NodeKind.Scalar:
      return scalarValue(context, value);
    case NodeKind.Error:
      return unsupportedValue(
        context,
        value,
        "l0-error-value",
        "The L0 parser produced an error node for a schema value.",
      );
    case NodeKind.InlineMath:
      return unsupportedValue(
        context,
        value,
        "inline-math-schema-value",
        "Inline mathematics has no schema-value semantic.",
      );
    case NodeKind.OptionalBlock:
      return unsupportedValue(
        context,
        value,
        "parameterised-schema-value",
        "A parameterised optional block has no import semantic.",
      );
    case NodeKind.PrefixedBlock:
      return unsupportedValue(context, value, "prefixed-schema-value", "A prefixed block has no import semantic.");
    default:
      return unsupportedValue(context, value, "unknown-schema-value", "A schema value used an unknown L0 node.");
  }
}

function keyFromConstruct(context: TranslationContext, construct: ParsedConstruct, span: Span): ImportedKeyRule {
  const target: ImportedTypeReference = typeReference(construct.argument);
  switch (construct.head) {
    case "enum":
    case "complex_enum":
      return { kind: "enum-key", enum: construct.argument };
    case "type":
      return {
        kind: "type-key",
        type: target.type,
        ...(target.variant === undefined ? {} : { variant: target.variant }),
      };
    case "scope":
      return { kind: "scope-key", scope: construct.argument };
    case "scope_group":
      return { kind: "scope-group-key", group: construct.argument };
    case "value":
      return { kind: "named-value-key", set: construct.argument };
    case "value_set":
      return { kind: "value-set-key", set: construct.argument };
    case "alias":
    case "alias_name":
    case "single_alias": {
      const separator: number = construct.argument.indexOf(":");
      return {
        kind: "alias-key",
        family: separator < 0 ? construct.argument : construct.argument.slice(0, separator),
        ...(separator < 0 ? {} : { name: construct.argument.slice(separator + 1) }),
        single: construct.head === "single_alias",
      };
    }
    case "alias_keys_field":
      return { kind: "alias-keys-field-key", family: construct.argument };
    default:
      return {
        kind: "unsupported-key",
        semantic: unsupported(
          context,
          "unsupported-key-constructor",
          `The constructor ${JSON.stringify(construct.head)} has no key semantic.`,
          span,
        ),
      };
  }
}

function translateKey(context: TranslationContext, scalar: Scalar): ImportedKeyRule {
  const raw: string = originalText(context, scalar).trim();
  if (raw === "scalar") {
    return { kind: "any-key" };
  }

  const angleReference: RegExpExecArray | null = /^<([A-Za-z_][A-Za-z0-9_.-]*)>$/u.exec(raw);
  if (angleReference !== null) {
    const targetValue: string | undefined = angleReference[1];
    if (targetValue !== undefined) {
      const target: ImportedTypeReference = typeReference(targetValue);
      return {
        kind: "type-key",
        type: target.type,
        ...(target.variant === undefined ? {} : { variant: target.variant }),
      };
    }
  }

  const construct: ParsedConstruct | undefined = parsedConstruct(raw);
  if (construct !== undefined) {
    return keyFromConstruct(context, construct, scalar.span);
  }

  return { kind: "literal-key", value: String(scalar.value) };
}

function aliasExpansion(
  context: TranslationContext,
  entry: Assignment,
  annotations: ImportedAnnotations,
): ImportedAliasExpansionRule | undefined {
  if (entry.value.kind !== NodeKind.Scalar) {
    return undefined;
  }

  const keyConstruct: ParsedConstruct | undefined = parsedConstruct(originalText(context, entry.key));
  const valueConstruct: ParsedConstruct | undefined = parsedConstruct(originalText(context, entry.value));
  if (keyConstruct?.head !== "alias_name" || valueConstruct?.head !== "alias_match_left") {
    return undefined;
  }

  if (keyConstruct.argument !== valueConstruct.argument) {
    unsupported(
      context,
      "alias-family-mismatch",
      "An alias expansion used different alias families on its left and right sides.",
      entry.span,
    );
  }

  return {
    kind: "alias-expansion",
    family: keyConstruct.argument,
    occurrence: occurrenceFrom(annotations),
    annotations,
    source: sourceLocation(context, entry.span),
  };
}

function variantSelector(
  context: TranslationContext,
  entry: Assignment,
  annotations: ImportedAnnotations,
): ImportedVariantRuleGroup | undefined {
  const construct: ParsedConstruct | undefined = parsedConstruct(originalText(context, entry.key));
  if (construct?.head !== "subtype") {
    return undefined;
  }

  if (entry.value.kind !== NodeKind.Block) {
    const semantic: ImportedUnsupportedSemantic = unsupported(
      context,
      "non-block-variant-selector",
      "A schema subtype selector did not contain a block.",
      entry.span,
    );
    return {
      kind: "variant-rules",
      mode: construct.argument.startsWith("!") ? "exclude" : "include",
      variant: construct.argument.replace(/^!/u, ""),
      entries: [
        {
          kind: "unsupported-entry",
          semantic,
          annotations,
          source: sourceLocation(context, entry.span),
        },
      ],
      annotations,
      source: sourceLocation(context, entry.span),
    };
  }

  return {
    kind: "variant-rules",
    mode: construct.argument.startsWith("!") ? "exclude" : "include",
    variant: construct.argument.replace(/^!/u, ""),
    entries: translateEntries(context, entry.value.entries),
    annotations,
    source: sourceLocation(context, entry.span),
  };
}

function unsupportedEntry(
  context: TranslationContext,
  entry: EntryNode,
  annotations: ImportedAnnotations,
  code: string,
  description: string,
): ImportedUnsupportedEntryRule {
  return {
    kind: "unsupported-entry",
    semantic: unsupported(context, code, description, entry.span),
    annotations,
    source: sourceLocation(context, entry.span),
  };
}

function translateEntry(context: TranslationContext, entry: EntryNode): ImportedEntryRule | undefined {
  if (entry.kind === NodeKind.Trivia) {
    return undefined;
  }

  const annotations: ImportedAnnotations = translateAnnotations(context, entry);
  if (entry.kind === NodeKind.Assignment) {
    const variant: ImportedVariantRuleGroup | undefined = variantSelector(context, entry, annotations);
    if (variant !== undefined) {
      return variant;
    }

    const expansion: ImportedAliasExpansionRule | undefined = aliasExpansion(context, entry, annotations);
    if (expansion !== undefined) {
      return expansion;
    }

    return {
      kind: "field",
      key: translateKey(context, entry.key),
      value: translateValue(context, entry.value),
      occurrence: occurrenceFrom(annotations),
      operator: entry.operator,
      annotations,
      source: sourceLocation(context, entry.span),
    };
  }

  if (entry.kind === NodeKind.Scalar) {
    return {
      kind: "item",
      value: scalarValue(context, entry),
      occurrence: occurrenceFrom(annotations),
      annotations,
      source: sourceLocation(context, entry.span),
    };
  }

  if (entry.kind === NodeKind.Block) {
    return {
      kind: "item",
      value: { kind: "block", entries: translateEntries(context, entry.entries) },
      occurrence: occurrenceFrom(annotations),
      annotations,
      source: sourceLocation(context, entry.span),
    };
  }

  switch (entry.kind) {
    case NodeKind.Error:
      return unsupportedEntry(
        context,
        entry,
        annotations,
        "l0-error-entry",
        "The L0 parser produced an error node for a schema entry.",
      );
    case NodeKind.InlineMath:
      return unsupportedEntry(
        context,
        entry,
        annotations,
        "inline-math-schema-entry",
        "Inline mathematics has no schema-entry semantic.",
      );
    case NodeKind.OptionalBlock:
      return unsupportedEntry(
        context,
        entry,
        annotations,
        "parameterised-schema-entry",
        "A parameterised optional block has no import semantic.",
      );
    case NodeKind.PrefixedBlock:
      return unsupportedEntry(
        context,
        entry,
        annotations,
        "prefixed-schema-entry",
        "A prefixed block has no import semantic.",
      );
    default:
      return unsupportedEntry(
        context,
        entry,
        annotations,
        "unknown-schema-entry",
        "A schema entry used an unknown L0 node.",
      );
  }
}

function translateEntries(context: TranslationContext, entries: readonly EntryNode[]): ImportedEntryRule[] {
  return entries.flatMap((entry): ImportedEntryRule[] => {
    const translated: ImportedEntryRule | undefined = translateEntry(context, entry);
    return translated === undefined ? [] : [translated];
  });
}

function scalarString(value: ValueNode): string | undefined {
  return value.kind === NodeKind.Scalar ? String(value.value) : undefined;
}

function scalarBoolean(context: TranslationContext, value: ValueNode): boolean | undefined {
  if (value.kind !== NodeKind.Scalar) {
    return undefined;
  }

  if (value.scalarKind === ScalarKind.Boolean) {
    return Boolean(value.value);
  }

  const raw: string = originalText(context, value).trim().toLowerCase();
  return raw === "yes" ? true : raw === "no" ? false : undefined;
}

function directAssignments(block: Block): readonly Assignment[] {
  return block.entries.filter((entry): entry is Assignment => entry.kind === NodeKind.Assignment);
}

function assignmentKey(context: TranslationContext, entry: Assignment): string {
  return originalText(context, entry.key).trim();
}

function parsedAssignmentKey(context: TranslationContext, entry: Assignment): ParsedConstruct | undefined {
  return parsedConstruct(assignmentKey(context, entry));
}

function normalisedDirectory(value: string): string {
  const portable: string = value.replaceAll("\\", "/").replace(/^\/+/u, "");
  return portable.startsWith("game/") ? portable.slice("game/".length) : portable;
}

function metadataAssignment(
  context: TranslationContext,
  assignments: readonly Assignment[],
  key: string,
): Assignment | undefined {
  return assignments.find((entry) => assignmentKey(context, entry) === key);
}

function importedSource(
  context: TranslationContext,
  typeEntry: Assignment,
  assignments: readonly Assignment[],
  annotations: ImportedAnnotations,
): ImportedDefinitionSource {
  const pathEntry: Assignment | undefined = metadataAssignment(context, assignments, "path");
  const path: string | undefined = pathEntry === undefined ? undefined : scalarString(pathEntry.value);
  if (path === undefined) {
    unsupported(context, "missing-type-path", "A type declaration did not contain a scalar path.", typeEntry.span);
  }

  const fileEntry: Assignment | undefined = metadataAssignment(context, assignments, "path_file");
  const file: string | undefined = fileEntry === undefined ? undefined : scalarString(fileEntry.value);
  const nameFieldEntry: Assignment | undefined = metadataAssignment(context, assignments, "name_field");
  const nameField: string | undefined = nameFieldEntry === undefined ? undefined : scalarString(nameFieldEntry.value);
  const rootKeyEntry: Assignment | undefined = metadataAssignment(context, assignments, "skip_root_key");
  const rootKey: string | undefined = rootKeyEntry === undefined ? undefined : scalarString(rootKeyEntry.value);
  const strictEntry: Assignment | undefined = metadataAssignment(context, assignments, "path_strict");
  const strict: boolean = strictEntry === undefined ? false : scalarBoolean(context, strictEntry.value) === true;
  const perFileEntry: Assignment | undefined = metadataAssignment(context, assignments, "type_per_file");
  const perFile: boolean = perFileEntry === undefined ? false : scalarBoolean(context, perFileEntry.value) === true;
  const severityEntry: Assignment | undefined = metadataAssignment(context, assignments, "severity");
  const severityValue: string | undefined = severityEntry === undefined ? undefined : scalarString(severityEntry.value);
  const severity: ImportedSeverity | undefined = importedSeverity(severityValue ?? null);
  if (severityEntry !== undefined && severity === undefined) {
    unsupported(
      context,
      "invalid-type-severity",
      "A type declaration used an unknown diagnostic severity.",
      severityEntry.span,
    );
  }

  return {
    kind: perFile ? "file-root" : nameField === undefined ? "keyed-blocks" : "tagged-blocks",
    directory: normalisedDirectory(path ?? ""),
    includeSubdirectories: !strict,
    ...(file === undefined ? {} : { file }),
    ...(nameField === undefined ? {} : { nameField }),
    ...(rootKey === undefined ? {} : { rootKey }),
    ...(severity === undefined ? {} : { severity }),
    keyFilters: annotations.keyFilters,
  };
}

function subtypeFromAssignment(context: TranslationContext, entry: Assignment): ImportedSubtype | undefined {
  const construct: ParsedConstruct | undefined = parsedAssignmentKey(context, entry);
  if (construct?.head !== "subtype") {
    return undefined;
  }

  const annotations: ImportedAnnotations = translateAnnotations(context, entry);
  const criteria: readonly ImportedEntryRule[] =
    entry.value.kind === NodeKind.Block
      ? translateEntries(context, entry.value.entries)
      : [
          unsupportedEntry(
            context,
            entry,
            annotations,
            "non-block-subtype-declaration",
            "A subtype declaration did not contain a block.",
          ),
        ];

  return {
    id: construct.argument,
    criteria,
    keyFilters: annotations.keyFilters,
    entryScopes: annotations.scopes.flatMap((scope): string[] => (scope.kind === "enter-scope" ? [scope.scope] : [])),
    displayNames: annotations.displayNames,
    abbreviations: annotations.abbreviations,
    annotations,
    source: sourceLocation(context, entry.span),
  };
}

function localisationUnsupported(
  context: TranslationContext,
  entry: EntryNode,
  annotations: ImportedAnnotations,
  code: string,
  description: string,
): ImportedUnsupportedLocalisation {
  return {
    kind: "unsupported-localisation",
    semantic: unsupported(context, code, description, entry.span),
    annotations,
    source: sourceLocation(context, entry.span),
  };
}

function translateLocalisationEntry(
  context: TranslationContext,
  entry: EntryNode,
): ImportedLocalisationRule | undefined {
  if (entry.kind === NodeKind.Trivia) {
    return undefined;
  }

  const annotations: ImportedAnnotations = translateAnnotations(context, entry);
  if (entry.kind !== NodeKind.Assignment) {
    return localisationUnsupported(
      context,
      entry,
      annotations,
      "non-assignment-localisation",
      "A localisation declaration was not an assignment.",
    );
  }

  const construct: ParsedConstruct | undefined = parsedAssignmentKey(context, entry);
  if (construct?.head === "subtype") {
    if (entry.value.kind !== NodeKind.Block) {
      return localisationUnsupported(
        context,
        entry,
        annotations,
        "non-block-localisation-variant",
        "A localisation subtype selector did not contain a block.",
      );
    }

    return {
      kind: "localisation-variant",
      mode: construct.argument.startsWith("!") ? "exclude" : "include",
      variant: construct.argument.replace(/^!/u, ""),
      entries: translateLocalisationEntries(context, entry.value),
      annotations,
      source: sourceLocation(context, entry.span),
    };
  }

  const template: string | undefined = scalarString(entry.value);
  if (template === undefined) {
    return localisationUnsupported(
      context,
      entry,
      annotations,
      "non-scalar-localisation-template",
      "A localisation declaration did not use a scalar template.",
    );
  }

  return {
    kind: "localisation",
    role: String(entry.key.value),
    template,
    requirements: annotations.requirements,
    primary: annotations.primary,
    annotations,
    source: sourceLocation(context, entry.span),
  };
}

function translateLocalisationEntries(context: TranslationContext, block: Block): ImportedLocalisationRule[] {
  const translated: ImportedLocalisationRule[] = [];
  for (let index = 0; index < block.entries.length; index += 1) {
    const entry: EntryNode | undefined = block.entries[index];
    if (entry === undefined || entry.kind === NodeKind.Trivia) {
      continue;
    }

    let nextIndex: number = index + 1;
    while (block.entries[nextIndex]?.kind === NodeKind.Trivia) {
      nextIndex += 1;
    }
    const next: EntryNode | undefined = block.entries[nextIndex];
    if (
      entry.kind === NodeKind.Scalar &&
      next?.kind === NodeKind.Assignment &&
      entry.span.end.line === next.span.start.line
    ) {
      const template: string | undefined = scalarString(next.value);
      const annotations: ImportedAnnotations = translateAnnotations(context, entry);
      if (template !== undefined) {
        translated.push({
          kind: "localisation",
          role: `${String(entry.value)} ${String(next.key.value)}`,
          template,
          requirements: annotations.requirements,
          primary: annotations.primary,
          annotations,
          source: sourceLocation(context, {
            start: entry.span.start,
            end: next.span.end,
          }),
        });
        index = nextIndex;
        continue;
      }
    }

    const rule: ImportedLocalisationRule | undefined = translateLocalisationEntry(context, entry);
    if (rule !== undefined) {
      translated.push(rule);
    }
  }
  return translated;
}

function modifierUnsupported(
  context: TranslationContext,
  entry: EntryNode,
  annotations: ImportedAnnotations,
  code: string,
  description: string,
): ImportedUnsupportedModifier {
  return {
    kind: "unsupported-modifier",
    semantic: unsupported(context, code, description, entry.span),
    annotations,
    source: sourceLocation(context, entry.span),
  };
}

function translateModifierEntry(context: TranslationContext, entry: EntryNode): ImportedModifierRule | undefined {
  if (entry.kind === NodeKind.Trivia) {
    return undefined;
  }

  const annotations: ImportedAnnotations = translateAnnotations(context, entry);
  if (entry.kind !== NodeKind.Assignment) {
    return modifierUnsupported(
      context,
      entry,
      annotations,
      "non-assignment-modifier",
      "A generated modifier declaration was not an assignment.",
    );
  }

  const construct: ParsedConstruct | undefined = parsedAssignmentKey(context, entry);
  if (construct?.head === "subtype") {
    if (entry.value.kind !== NodeKind.Block) {
      return modifierUnsupported(
        context,
        entry,
        annotations,
        "non-block-modifier-variant",
        "A generated-modifier subtype selector did not contain a block.",
      );
    }

    return {
      kind: "modifier-variant",
      mode: construct.argument.startsWith("!") ? "exclude" : "include",
      variant: construct.argument.replace(/^!/u, ""),
      entries: translateModifierEntries(context, entry.value),
      annotations,
      source: sourceLocation(context, entry.span),
    };
  }

  const template: string = String(entry.key.value);
  const category: string | undefined = scalarString(entry.value);
  if (category === undefined) {
    return modifierUnsupported(
      context,
      entry,
      annotations,
      "non-scalar-modifier-category",
      "A generated modifier did not use a scalar category.",
    );
  }

  const placeholder: number = template.indexOf("$");
  if (placeholder < 0) {
    unsupported(
      context,
      "modifier-without-placeholder",
      "A generated modifier template did not contain the definition-id placeholder.",
      entry.span,
    );
  }

  return {
    kind: "generated-modifier",
    template,
    prefix: placeholder < 0 ? template : template.slice(0, placeholder),
    suffix: placeholder < 0 ? "" : template.slice(placeholder + 1),
    category,
    annotations,
    source: sourceLocation(context, entry.span),
  };
}

function translateModifierEntries(context: TranslationContext, block: Block): ImportedModifierRule[] {
  return block.entries.flatMap((entry): ImportedModifierRule[] => {
    const translated: ImportedModifierRule | undefined = translateModifierEntry(context, entry);
    return translated === undefined ? [] : [translated];
  });
}

function contextForFile(file: CwtReadResult, issues: ImportedUnsupportedSemantic[]): TranslationContext {
  return {
    file,
    annotations: new Map(file.entries.map((entry) => [entry.syntax, entry])),
    unsupported: issues,
  };
}

function declarations(
  files: readonly CwtReadResult[],
  issues: ImportedUnsupportedSemantic[],
): {
  readonly roots: readonly RootSchemaDeclaration[];
  readonly types: readonly TypeDeclaration[];
  readonly commands: readonly ImportedCommand[];
} {
  const types: TypeDeclaration[] = [];
  const roots: RootSchemaDeclaration[] = [];
  const commands: ImportedCommand[] = [];

  for (const file of files) {
    const context: TranslationContext = contextForFile(file, issues);
    for (const entry of file.document.entries) {
      if (entry.kind !== NodeKind.Assignment) {
        continue;
      }

      const key: string = String(entry.key.value);
      if (key === "types" && entry.value.kind === NodeKind.Block) {
        for (const declaration of directAssignments(entry.value)) {
          const construct: ParsedConstruct | undefined = parsedAssignmentKey(context, declaration);
          if (construct?.head === "type" && declaration.value.kind === NodeKind.Block) {
            types.push({ context, entry: declaration, block: declaration.value, id: construct.argument });
          } else {
            unsupported(
              context,
              "unsupported-types-registry-entry",
              "An entry directly under the types registry was not a block-valued type declaration.",
              declaration.span,
            );
          }
        }
        continue;
      }

      const rootConstruct: ParsedConstruct | undefined = parsedAssignmentKey(context, entry);
      if (rootConstruct?.head === "alias" || rootConstruct?.head === "single_alias") {
        const single: boolean = rootConstruct.head === "single_alias";
        const separator: number = rootConstruct.argument.indexOf(":");
        const family: string = single
          ? rootConstruct.argument
          : separator < 0
            ? rootConstruct.argument
            : rootConstruct.argument.slice(0, separator);
        const name: string = single || separator < 0 ? "" : rootConstruct.argument.slice(separator + 1);

        commands.push({
          family: family.trim(),
          name: name.trim(),
          single,
          value: translateValue(context, entry.value),
          operator: entry.operator,
          annotations: translateAnnotations(context, entry),
          source: sourceLocation(context, entry.span),
        });
        continue;
      }

      if (entry.value.kind === NodeKind.Block) {
        roots.push({ context, entry, block: entry.value, id: key });
      }
    }
  }

  return { types, roots, commands };
}

function schemaBlock(declaration: RootSchemaDeclaration): ImportedSchemaBlock {
  return {
    entries: translateEntries(declaration.context, declaration.block.entries),
    annotations: translateAnnotations(declaration.context, declaration.entry),
    source: sourceLocation(declaration.context, declaration.entry.span),
  };
}

function translateType(declaration: TypeDeclaration, roots: readonly RootSchemaDeclaration[]): ImportedDefinitionType {
  const context: TranslationContext = declaration.context;
  const assignments: readonly Assignment[] = directAssignments(declaration.block);
  const annotations: ImportedAnnotations = translateAnnotations(context, declaration.entry);
  const subtypeEntries: readonly ImportedSubtype[] = assignments.flatMap((entry): ImportedSubtype[] => {
    const subtype: ImportedSubtype | undefined = subtypeFromAssignment(context, entry);
    return subtype === undefined ? [] : [subtype];
  });
  const localisationEntry: Assignment | undefined = metadataAssignment(context, assignments, "localisation");
  const modifiersEntry: Assignment | undefined = metadataAssignment(context, assignments, "modifiers");
  const localisation: readonly ImportedLocalisationRule[] =
    localisationEntry?.value.kind === NodeKind.Block
      ? translateLocalisationEntries(context, localisationEntry.value)
      : [];
  const modifiers: readonly ImportedModifierRule[] =
    modifiersEntry?.value.kind === NodeKind.Block ? translateModifierEntries(context, modifiersEntry.value) : [];
  const matchingRoots: readonly RootSchemaDeclaration[] = roots.filter((root) => root.id === declaration.id);
  const importedSchemaBlocks: readonly ImportedSchemaBlock[] = matchingRoots.map(schemaBlock);
  const entryScopes: readonly string[] = importedSchemaBlocks.flatMap((schema): string[] =>
    schema.annotations.scopes.flatMap((scope): string[] => (scope.kind === "enter-scope" ? [scope.scope] : [])),
  );

  if (localisationEntry !== undefined && localisationEntry.value.kind !== NodeKind.Block) {
    unsupported(
      context,
      "non-block-type-localisation",
      "A type localisation declaration did not contain a block.",
      localisationEntry.span,
    );
  }
  if (modifiersEntry !== undefined && modifiersEntry.value.kind !== NodeKind.Block) {
    unsupported(
      context,
      "non-block-type-modifiers",
      "A type generated-modifiers declaration did not contain a block.",
      modifiersEntry.span,
    );
  }
  if (matchingRoots.length === 0) {
    unsupported(
      context,
      "missing-root-schema",
      `The type ${JSON.stringify(declaration.id)} has no matching root schema block.`,
      declaration.entry.span,
    );
  }

  const recognisedMetadata: ReadonlySet<string> = new Set([
    "localisation",
    "modifiers",
    "name_field",
    "path",
    "path_file",
    "path_strict",
    "severity",
    "skip_root_key",
    "type_per_file",
  ]);
  for (const assignment of assignments) {
    const construct: ParsedConstruct | undefined = parsedAssignmentKey(context, assignment);
    const key: string = assignmentKey(context, assignment);
    if (construct?.head === "subtype" || recognisedMetadata.has(key)) {
      continue;
    }

    unsupported(
      context,
      "unsupported-type-metadata",
      `The type metadata field ${JSON.stringify(key)} has no import semantic.`,
      assignment.span,
    );
  }

  return {
    id: declaration.id,
    source: importedSource(context, declaration.entry, assignments, annotations),
    subtypes: subtypeEntries,
    localisation,
    modifiers,
    schemaBlocks: importedSchemaBlocks,
    entries: importedSchemaBlocks.flatMap((schema) => schema.entries),
    entryScopes,
    annotations,
    sourceLocation: sourceLocation(context, declaration.entry.span),
  };
}

export function translateCwtFiles(files: readonly CwtReadResult[]): CwtSchemaTranslation {
  const issues: ImportedUnsupportedSemantic[] = [];
  const collected = declarations(files, issues);
  const definitionTypes: readonly ImportedDefinitionType[] = collected.types.map((declaration) =>
    translateType(declaration, collected.roots),
  );

  return {
    definitionTypes,
    commands: collected.commands,
    unsupported: issues,
  };
}

export function translateCwtCorpus(corpus: CwtCorpus): CwtSchemaTranslation {
  return translateCwtFiles(corpus.files);
}
