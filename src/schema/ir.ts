import type { DefinitionTypeId, EnumId, ScopeId } from "./catalog.js";

export interface Occurrence {
  readonly min: number;
  readonly max: number | null;
}

export const occurs: {
  readonly any: Occurrence;
  readonly one: Occurrence;
  readonly oneOrMore: Occurrence;
  readonly optional: Occurrence;
} = {
  any: { min: 0, max: null },
  one: { min: 1, max: 1 },
  oneOrMore: { min: 1, max: null },
  optional: { min: 0, max: 1 },
} as const;

export type DiagnosticSeverity = "error" | "warning" | "information" | "hint";

export interface NumericRange {
  readonly min: number | null;
  readonly max: number | null;
}

export type PrimitiveType =
  | "boolean"
  | "date"
  | "file"
  | "icon"
  | "integer"
  | "localisation"
  | "number"
  | "percentage"
  | "scalar"
  | "script-value";

export interface PrimitiveValue {
  readonly kind: "primitive";
  readonly type: PrimitiveType;
  readonly range?: NumericRange;
  readonly path?: string;
}

export interface LiteralValue {
  readonly kind: "literal";
  readonly value: string | number | boolean;
}

export interface EnumValue {
  readonly kind: "enum";
  readonly enum: EnumId;
}

export interface StaticEnumDefinition {
  readonly kind: "static-enum";
  readonly id: EnumId;
  readonly values: readonly string[];
  readonly documentation?: string;
}

export interface ExtractionFieldStep {
  readonly kind: "field";
  readonly key: string;
}

export interface ExtractionAnyFieldStep {
  readonly kind: "any-field";
}

export interface ExtractionCaptureStep {
  readonly kind: "capture";
  readonly source: "key" | "scalar";
}

export type ExtractionStep = ExtractionAnyFieldStep | ExtractionCaptureStep | ExtractionFieldStep;

export interface EnumExtractionSource {
  readonly directory: string;
  readonly includeSubdirectories: boolean;
  readonly route: readonly ExtractionStep[];
}

export interface ExtractedEnumDefinition {
  readonly kind: "extracted-enum";
  readonly id: EnumId;
  readonly sources: readonly EnumExtractionSource[];
  readonly documentation?: string;
}

export type EnumDefinition = ExtractedEnumDefinition | StaticEnumDefinition;

export interface TypeReferenceValue {
  readonly kind: "type-reference";
  readonly type: string;
  readonly variant?: string;
}

export interface ScopeReferenceValue {
  readonly kind: "scope-reference";
  readonly scope?: ScopeId;
}

export interface ValueSetReference {
  readonly kind: "value-set";
  readonly set: string;
}

export interface ScriptBlockValue {
  readonly kind: "script-block";
  readonly family: "effect" | "modifier" | "modifier-rule" | "trigger";
}

export interface BlockValue {
  readonly kind: "block";
  readonly entries: readonly EntryRule[];
}

export interface ListValue {
  readonly kind: "list";
  readonly item: ValueRule;
  readonly items: Occurrence;
}

export interface ChoiceValue {
  readonly kind: "choice";
  readonly choices: readonly ValueRule[];
}

export interface OpaqueValue {
  readonly kind: "opaque";
  readonly reason: string;
}

export type ValueRule =
  | BlockValue
  | ChoiceValue
  | EnumValue
  | ListValue
  | LiteralValue
  | OpaqueValue
  | PrimitiveValue
  | ScopeReferenceValue
  | ScriptBlockValue
  | TypeReferenceValue
  | ValueSetReference;

export interface AnyKey {
  readonly kind: "any-key";
}

export interface EnumKey {
  readonly kind: "enum-key";
  readonly enum: EnumId;
}

export interface PatternKey {
  readonly kind: "pattern-key";
  readonly prefix: string;
  readonly suffix: string;
}

export interface TypeKey {
  readonly kind: "type-key";
  readonly type: string;
}

export interface ValueSetKey {
  readonly kind: "value-set-key";
  readonly set: string;
}

export type KeyRule = AnyKey | EnumKey | PatternKey | string | TypeKey | ValueSetKey;

export interface ScopeFrame {
  readonly current?: ScopeId;
  readonly root?: ScopeId;
  readonly from?: ScopeId;
  readonly fromFrom?: ScopeId;
}

export interface EnterScope {
  readonly kind: "enter";
  readonly scope: ScopeId;
}

export interface ReplaceScope {
  readonly kind: "replace";
  readonly frame: ScopeFrame;
}

export type ScopeChange = EnterScope | ReplaceScope;

export interface ScopeDefinition {
  readonly id: ScopeId;
  readonly aliases: readonly string[];
  readonly documentation?: string;
}

export interface AnyScopeSelection {
  readonly kind: "any-scope";
}

export interface ListedScopeSelection {
  readonly kind: "listed-scopes";
  readonly scopes: readonly ScopeId[];
}

export type ScopeSelection = AnyScopeSelection | ListedScopeSelection;

export interface FixedScopeResult {
  readonly kind: "fixed-scope";
  readonly scopes: readonly ScopeId[];
}

export interface DynamicScopeResult {
  readonly kind: "dynamic-scope";
}

export type ScopeResult = DynamicScopeResult | FixedScopeResult;

export interface ScopeLinkDefinition {
  readonly id: string;
  readonly input: ScopeSelection;
  readonly output: ScopeResult;
  readonly value?: ValueRule;
  readonly documentation?: string;
}

export interface EntryOptions {
  readonly documentation?: string;
  readonly scope?: ScopeChange;
  readonly severity?: DiagnosticSeverity;
}

export interface FieldRule extends EntryOptions {
  readonly kind: "field";
  readonly key: KeyRule;
  readonly occurrence: Occurrence;
  readonly value: ValueRule;
}

export interface ItemRule extends EntryOptions {
  readonly kind: "item";
  readonly occurrence: Occurrence;
  readonly value: ValueRule;
}

export interface VariantRuleGroup {
  readonly kind: "variant-rules";
  readonly mode: "include" | "exclude";
  readonly variant: string;
  readonly entries: readonly EntryRule[];
}

export interface ScriptEntriesRule extends EntryOptions {
  readonly kind: "script-entries";
  readonly family: ScriptBlockValue["family"];
}

export type EntryRule = FieldRule | ItemRule | ScriptEntriesRule | VariantRuleGroup;

export interface RootKeyPredicate {
  readonly kind: "root-key";
  readonly values: readonly string[];
}

export interface FieldEqualsPredicate {
  readonly kind: "field-equals";
  readonly field: string;
  readonly value: string | number | boolean;
}

export interface FieldPresencePredicate {
  readonly kind: "field-presence";
  readonly field: string;
  readonly present: boolean;
}

export interface AllPredicate {
  readonly kind: "all";
  readonly predicates: readonly VariantPredicate[];
}

export interface AnyPredicate {
  readonly kind: "any";
  readonly predicates: readonly VariantPredicate[];
}

export interface NotPredicate {
  readonly kind: "not";
  readonly predicate: VariantPredicate;
}

export interface AlwaysPredicate {
  readonly kind: "always";
}

export type VariantPredicate =
  | AllPredicate
  | AlwaysPredicate
  | AnyPredicate
  | FieldEqualsPredicate
  | FieldPresencePredicate
  | NotPredicate
  | RootKeyPredicate;

export interface VariantDefinition {
  readonly id: string;
  readonly when: VariantPredicate;
  readonly entryScope?: ScopeId;
  readonly displayName?: string;
  readonly abbreviation?: string;
}

export interface KeyedBlockSource {
  readonly kind: "keyed-blocks";
  readonly directory: string;
  readonly includeSubdirectories: boolean;
}

export interface TaggedBlockSource {
  readonly kind: "tagged-blocks";
  readonly directory: string;
  readonly includeSubdirectories: boolean;
  readonly nameField: string;
  readonly tags: readonly string[];
}

export type DefinitionSource = KeyedBlockSource | TaggedBlockSource;

export interface DefinitionIdLocalisation {
  readonly kind: "definition-id";
  readonly suffix: string;
}

export interface FieldLocalisation {
  readonly kind: "field";
  readonly field: string;
}

export type LocalisationSource = DefinitionIdLocalisation | FieldLocalisation;

export interface LocalisationRequirement {
  readonly role: string;
  readonly source: LocalisationSource;
  readonly required: boolean;
  readonly primary?: boolean;
  readonly variant?: string;
}

export interface GeneratedModifier {
  readonly category: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly variant?: string;
}

export interface DefinitionType {
  readonly id: DefinitionTypeId;
  readonly source: DefinitionSource;
  readonly entryScope?: ScopeId;
  readonly variants: readonly VariantDefinition[];
  readonly localisation: readonly LocalisationRequirement[];
  readonly modifiers: readonly GeneratedModifier[];
  readonly entries: readonly EntryRule[];
  readonly documentation?: string;
}

export interface MacroRule {
  readonly id: "inline-script";
  readonly key: "inline_script";
  readonly appliesTo: "all-blocks";
}

export interface SchemaPolicy {
  readonly macros: readonly MacroRule[];
}

export interface ScriptCommandDefinition extends EntryOptions {
  readonly id: string;
  readonly family: ScriptBlockValue["family"];
  readonly input: ScopeSelection;
  readonly value: ValueRule;
}

export interface NamedValueDefinition {
  readonly id: string;
  readonly value: ValueRule;
  readonly documentation?: string;
}

export interface ValueSetDefinition {
  readonly id: string;
  readonly key: KeyRule;
  readonly value: ValueRule;
  readonly documentation?: string;
}

export interface SchemaModel {
  readonly policy: SchemaPolicy;
  readonly definitionTypes: readonly DefinitionType[];
  readonly enums: readonly EnumDefinition[];
  readonly scopes: readonly ScopeDefinition[];
  readonly links: readonly ScopeLinkDefinition[];
  readonly commands: readonly ScriptCommandDefinition[];
  readonly namedValues: readonly NamedValueDefinition[];
  readonly valueSets: readonly ValueSetDefinition[];
}

export const defaultSchemaPolicy: SchemaPolicy = {
  macros: [{ id: "inline-script", key: "inline_script", appliesTo: "all-blocks" }],
};

export function defineType<const Schema extends DefinitionType>(schema: Schema): Schema {
  return schema;
}

export function defineSchema<const Schema extends SchemaModel>(schema: Schema): Schema {
  return schema;
}

export function between(min: number, max: number | null): Occurrence {
  return { min, max };
}

export function staticEnum(id: EnumId, values: readonly string[], documentation?: string): StaticEnumDefinition {
  return {
    kind: "static-enum",
    id,
    values,
    ...(documentation === undefined ? {} : { documentation }),
  };
}

export function extractedEnum(
  id: EnumId,
  sources: readonly EnumExtractionSource[],
  documentation?: string,
): ExtractedEnumDefinition {
  return {
    kind: "extracted-enum",
    id,
    sources,
    ...(documentation === undefined ? {} : { documentation }),
  };
}

export function enumExtraction(
  directory: string,
  route: readonly ExtractionStep[],
  includeSubdirectories = true,
): EnumExtractionSource {
  return { directory, route, includeSubdirectories };
}

export function extractionField(key: string): ExtractionFieldStep {
  return { kind: "field", key };
}

export function extractionAnyField(): ExtractionAnyFieldStep {
  return { kind: "any-field" };
}

export function captureKey(): ExtractionCaptureStep {
  return { kind: "capture", source: "key" };
}

export function captureScalar(): ExtractionCaptureStep {
  return { kind: "capture", source: "scalar" };
}

export function primitive(type: PrimitiveType, range?: NumericRange, path?: string): PrimitiveValue {
  return {
    kind: "primitive",
    type,
    ...(range === undefined ? {} : { range }),
    ...(path === undefined ? {} : { path }),
  };
}

export function literal(value: string | number | boolean): LiteralValue {
  return { kind: "literal", value };
}

export function enumRef(enumId: EnumId): EnumValue {
  return { kind: "enum", enum: enumId };
}

export function typeRef(type: string, variant?: string): TypeReferenceValue {
  return {
    kind: "type-reference",
    type,
    ...(variant === undefined ? {} : { variant }),
  };
}

export function scopeRef(scope?: ScopeId): ScopeReferenceValue {
  return scope === undefined ? { kind: "scope-reference" } : { kind: "scope-reference", scope };
}

export function valueSet(set: string): ValueSetReference {
  return { kind: "value-set", set };
}

export function triggerBlock(): ScriptBlockValue {
  return { kind: "script-block", family: "trigger" };
}

export function effectBlock(): ScriptBlockValue {
  return { kind: "script-block", family: "effect" };
}

export function modifierBlock(): ScriptBlockValue {
  return { kind: "script-block", family: "modifier" };
}

export function modifierRuleBlock(): ScriptBlockValue {
  return { kind: "script-block", family: "modifier-rule" };
}

export function triggerEntries(options: EntryOptions = {}): ScriptEntriesRule {
  return { kind: "script-entries", family: "trigger", ...options };
}

export function effectEntries(options: EntryOptions = {}): ScriptEntriesRule {
  return { kind: "script-entries", family: "effect", ...options };
}

export function modifierEntries(options: EntryOptions = {}): ScriptEntriesRule {
  return { kind: "script-entries", family: "modifier", ...options };
}

export function modifierRuleEntries(options: EntryOptions = {}): ScriptEntriesRule {
  return { kind: "script-entries", family: "modifier-rule", ...options };
}

export function block(entries: readonly EntryRule[]): BlockValue {
  return { kind: "block", entries };
}

export function list(value: ValueRule, items: Occurrence = occurs.oneOrMore): ListValue {
  return { kind: "list", item: value, items };
}

export function oneOf(...choices: readonly ValueRule[]): ChoiceValue {
  return { kind: "choice", choices };
}

export function opaque(reason: string): OpaqueValue {
  return { kind: "opaque", reason };
}

export function anyKey(): AnyKey {
  return { kind: "any-key" };
}

export function enumKey(enumId: EnumId): EnumKey {
  return { kind: "enum-key", enum: enumId };
}

export function patternKey(prefix: string, suffix = ""): PatternKey {
  return { kind: "pattern-key", prefix, suffix };
}

export function typeKey(type: string): TypeKey {
  return { kind: "type-key", type };
}

export function valueSetKey(set: string): ValueSetKey {
  return { kind: "value-set-key", set };
}

export function enterScope(scope: ScopeId): EnterScope {
  return { kind: "enter", scope };
}

export function replaceScope(frame: ScopeFrame): ReplaceScope {
  return { kind: "replace", frame };
}

export function anyScope(): AnyScopeSelection {
  return { kind: "any-scope" };
}

export function listedScopes(...scopes: readonly ScopeId[]): ListedScopeSelection {
  return { kind: "listed-scopes", scopes };
}

export function fixedScopes(...scopes: readonly ScopeId[]): FixedScopeResult {
  return { kind: "fixed-scope", scopes };
}

export function dynamicScope(): DynamicScopeResult {
  return { kind: "dynamic-scope" };
}

export function field(key: KeyRule, value: ValueRule, occurrence: Occurrence, options: EntryOptions = {}): FieldRule {
  return { kind: "field", key, value, occurrence, ...options };
}

export function required(key: KeyRule, value: ValueRule, options: EntryOptions = {}): FieldRule {
  return field(key, value, occurs.one, options);
}

export function optional(key: KeyRule, value: ValueRule, options: EntryOptions = {}): FieldRule {
  return field(key, value, occurs.optional, options);
}

export function repeatable(key: KeyRule, value: ValueRule, options: EntryOptions = {}): FieldRule {
  return field(key, value, occurs.any, options);
}

export function oneOrMore(key: KeyRule, value: ValueRule, options: EntryOptions = {}): FieldRule {
  return field(key, value, occurs.oneOrMore, options);
}

export function forbidden(key: KeyRule, value: ValueRule, options: EntryOptions = {}): FieldRule {
  return field(key, value, between(0, 0), options);
}

export function item(value: ValueRule, occurrence: Occurrence = occurs.one, options: EntryOptions = {}): ItemRule {
  return { kind: "item", value, occurrence, ...options };
}

export function whenVariant(variant: string, entries: readonly EntryRule[]): VariantRuleGroup {
  return { kind: "variant-rules", mode: "include", variant, entries };
}

export function unlessVariant(variant: string, entries: readonly EntryRule[]): VariantRuleGroup {
  return { kind: "variant-rules", mode: "exclude", variant, entries };
}

export function always(): AlwaysPredicate {
  return { kind: "always" };
}

export function rootKeyIs(...values: readonly string[]): RootKeyPredicate {
  return { kind: "root-key", values };
}

export function fieldEquals(fieldName: string, value: string | number | boolean): FieldEqualsPredicate {
  return { kind: "field-equals", field: fieldName, value };
}

export function fieldPresent(fieldName: string): FieldPresencePredicate {
  return { kind: "field-presence", field: fieldName, present: true };
}

export function fieldAbsent(fieldName: string): FieldPresencePredicate {
  return { kind: "field-presence", field: fieldName, present: false };
}

export function allOf(...predicates: readonly VariantPredicate[]): AllPredicate {
  return { kind: "all", predicates };
}

export function anyOf(...predicates: readonly VariantPredicate[]): AnyPredicate {
  return { kind: "any", predicates };
}

export function not(predicate: VariantPredicate): NotPredicate {
  return { kind: "not", predicate };
}

export function keyedBlocks(directory: string, includeSubdirectories = true): KeyedBlockSource {
  return { kind: "keyed-blocks", directory, includeSubdirectories };
}

export function taggedBlocks(
  directory: string,
  nameField: string,
  tags: readonly string[],
  includeSubdirectories = true,
): TaggedBlockSource {
  return { kind: "tagged-blocks", directory, nameField, tags, includeSubdirectories };
}

export function definitionLocalisation(
  role: string,
  suffix: string,
  requiredValue: boolean,
  variant?: string,
): LocalisationRequirement {
  return {
    role,
    source: { kind: "definition-id", suffix },
    required: requiredValue,
    ...(variant === undefined ? {} : { variant }),
  };
}

export function fieldLocalisation(
  role: string,
  fieldName: string,
  requiredValue: boolean,
  primary = false,
): LocalisationRequirement {
  return {
    role,
    source: { kind: "field", field: fieldName },
    required: requiredValue,
    ...(primary ? { primary: true } : {}),
  };
}

export function generatedModifier(
  prefix: string,
  suffix: string,
  category: string,
  variant?: string,
): GeneratedModifier {
  return {
    prefix,
    suffix,
    category,
    ...(variant === undefined ? {} : { variant }),
  };
}
