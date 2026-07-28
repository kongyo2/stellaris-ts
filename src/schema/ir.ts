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

export type RuleOperator = "=" | "==" | "!=" | ">" | ">=" | "<" | "<=";

export interface NumericRange {
  readonly min: number | null;
  readonly max: number | null;
}

export type PrimitiveType =
  | "boolean"
  | "colour"
  | "date"
  | "file"
  | "icon"
  | "integer"
  | "localisation"
  | "name-format"
  | "number"
  | "percentage"
  | "scalar"
  | "script-value";

export interface PrimitiveValue {
  readonly kind: "primitive";
  readonly type: PrimitiveType;
  readonly range?: NumericRange;
  readonly path?: string;
  readonly format?: string;
}

export interface AnyValue {
  readonly kind: "any-value";
}

export interface LiteralValue {
  readonly kind: "literal";
  readonly value: string | number | boolean;
}

export interface EnumValue {
  readonly kind: "enum";
  readonly enum: EnumId;
}

export interface ChainedEnumValue {
  readonly kind: "chained-enum";
  readonly scope: ScopeReference;
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
  /**
   * Whether the route starts at the file root instead of inside each definition
   * block. Only one enum in the corpus does; the other 26 describe a path
   * relative to the definition, so the default is what the majority needs.
   */
  readonly startFromRoot: boolean;
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

export interface InterpolatedTypeValue {
  readonly kind: "interpolated-type";
  readonly type: string;
  readonly prefix: string;
  readonly suffix: string;
}

export interface ScopeReferenceValue {
  readonly kind: "scope-reference";
  readonly scope?: ScopeId;
}

export interface ValueSetReference {
  readonly kind: "value-set";
  readonly set: string;
}

export interface NamedValueReference {
  readonly kind: "named-value";
  readonly value: string;
}

export interface ScopeGroupReferenceValue {
  readonly kind: "scope-group-reference";
  readonly group: string;
}

/**
 * A reference to any modifier name.
 *
 * Modifiers are not a definition type: the set is assembled from every type's
 * generated `modifiers` templates plus the standalone modifier rules, so it
 * needs its own reference rather than a `typeRef("modifier")`.
 */
export interface ModifierReferenceValue {
  readonly kind: "modifier-reference";
}

export interface ScriptValueRule {
  readonly kind: "script-value";
  readonly result: "integer" | "number" | "percentage";
  readonly range?: NumericRange;
}

export interface RuleSetReferenceValue {
  readonly kind: "rule-set-reference";
  readonly family: string;
  readonly name?: string;
  readonly single: boolean;
}

export interface RuleSetKeyReferenceValue {
  readonly kind: "rule-set-key-reference";
  readonly family: string;
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
  | AnyValue
  | BlockValue
  | ChainedEnumValue
  | ChoiceValue
  | EnumValue
  | InterpolatedTypeValue
  | ListValue
  | LiteralValue
  | ModifierReferenceValue
  | NamedValueReference
  | OpaqueValue
  | PrimitiveValue
  | RuleSetKeyReferenceValue
  | RuleSetReferenceValue
  | ScopeGroupReferenceValue
  | ScopeReferenceValue
  | ScriptBlockValue
  | ScriptValueRule
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
  readonly type?: string;
}

export interface ParameterKey {
  readonly kind: "parameter-key";
}

/**
 * A key that is a number rather than a name.
 *
 * `random_list = { 10 = { ... } }` weights each branch by its key, and
 * `random_events = { 100 = evt.1 }` does the same for on-actions. cwt spells
 * this `int = ...`, which ports to a field literally named `int` and therefore
 * matches nothing — the construct is a key *type*, so it needs one.
 */
export interface NumericKey {
  readonly kind: "numeric-key";
  readonly integer: boolean;
}

/**
 * A key that is a value of a primitive type rather than a name.
 *
 * cwt writes `filepath = { ... }` for "any file path is a key here" and
 * `localisation = { ... }` for "any localisation key is". Ported as fields named
 * `filepath` and `localisation` they match nothing — vanilla writes neither word
 * as a key anywhere — and 4,700 real keys went unchecked behind them.
 */
export interface PrimitiveKey {
  readonly kind: "primitive-key";
  readonly type: PrimitiveType;
}

/**
 * A key that is any modifier name.
 *
 * The set is generated rather than declared — see {@link ModifierNamespace} —
 * so it cannot be an enum, and a modifier block's keys are exactly it.
 */
export interface ModifierKey {
  readonly kind: "modifier-key";
}

export interface TypeKey {
  readonly kind: "type-key";
  readonly type: string;
}

export interface ValueSetKey {
  readonly kind: "value-set-key";
  readonly set: string;
}

export interface NamedValueKey {
  readonly kind: "named-value-key";
  readonly value: string;
}

export interface ScopeKey {
  readonly kind: "scope-key";
  readonly scope: ScopeReference;
}

export interface ScopeGroupKey {
  readonly kind: "scope-group-key";
  readonly group: string;
}

export interface RuleSetKey {
  readonly kind: "rule-set-key";
  readonly family: string;
  readonly name?: string;
  readonly single: boolean;
}

export interface RuleSetKeysFieldKey {
  readonly kind: "rule-set-keys-field-key";
  readonly family: string;
}

export type KeyRule =
  | AnyKey
  | EnumKey
  | ModifierKey
  | NamedValueKey
  | NumericKey
  | ParameterKey
  | PatternKey
  | PrimitiveKey
  | RuleSetKey
  | RuleSetKeysFieldKey
  | ScopeGroupKey
  | ScopeKey
  | string
  | TypeKey
  | ValueSetKey;

export interface AnyScopeReference {
  readonly kind: "any-scope";
}

export interface NoScopeReference {
  readonly kind: "no-scope";
}

/**
 * `ScopeId` completes; a plain string is still accepted. The game gains scopes —
 * `colony` and `carrier` arrived in 4.4 — and the catalog is generated from a
 * corpus that predates them.
 */
export type ScopeReference = AnyScopeReference | NoScopeReference | ScopeId | (string & {});

export interface ScopeAlternatives {
  readonly kind: "scope-alternatives";
  readonly scopes: readonly ScopeReference[];
}

export type ScopeSlot = ScopeAlternatives | ScopeReference;

export interface ScopeFrame {
  readonly current?: ScopeSlot;
  readonly root?: ScopeSlot;
  readonly previous?: ScopeSlot;
  readonly from?: ScopeSlot;
  readonly fromFrom?: ScopeSlot;
  readonly fromFromFrom?: ScopeSlot;
  readonly fromFromFromFrom?: ScopeSlot;
}

export interface EnterScope {
  readonly kind: "enter";
  readonly scope: ScopeReference;
}

export interface ReplaceScope {
  readonly kind: "replace";
  readonly frame: ScopeFrame;
}

export type ScopeChange = EnterScope | ReplaceScope;

export interface ScopeDefinition {
  /**
   * `ScopeId` completes; a plain string is still accepted, because the game
   * gains scopes — `colony` and `carrier` arrived in 4.4 — and the catalog is a
   * port of a corpus that predates them.
   */
  readonly id: ScopeId | (string & {});
  readonly aliases: readonly string[];
  readonly displayName?: string;
  readonly documentation?: string;
}

export interface ScopeGroupDefinition {
  readonly id: string;
  readonly scopes: readonly ScopeId[];
  readonly documentation?: string;
}

export type AnyScopeSelection = AnyScopeReference;

export interface ListedScopeSelection {
  readonly kind: "listed-scopes";
  readonly scopes: readonly ScopeId[];
}

export interface UnspecifiedScopeSelection {
  readonly kind: "unspecified-scope";
}

export type ScopeSelection = AnyScopeSelection | ListedScopeSelection | UnspecifiedScopeSelection;

export interface FixedScopeResult {
  readonly kind: "fixed-scope";
  readonly scopes: readonly ScopeId[];
}

export interface DynamicScopeResult {
  readonly kind: "dynamic-scope";
}

export type ScopeResult = DynamicScopeResult | FixedScopeResult;

export interface ScopeLinkDefinition {
  readonly kind: "scope-link";
  readonly id: string;
  readonly input: ScopeSelection;
  readonly output: ScopeResult;
  readonly value?: ValueRule;
  readonly documentation?: string;
}

export interface DataLinkDefinition {
  readonly kind: "data-link";
  readonly id: string;
  readonly prefix: string;
  readonly source: ValueRule;
  readonly documentation?: string;
}

export type LinkDefinition = DataLinkDefinition | ScopeLinkDefinition;

export interface EntryOptions {
  readonly documentation?: string;
  readonly scope?: ScopeChange;
  readonly severity?: DiagnosticSeverity;
}

export interface FieldRule extends EntryOptions {
  readonly kind: "field";
  readonly key: KeyRule;
  readonly occurrence: Occurrence;
  readonly operator: RuleOperator;
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

export interface RuleSetEntriesRule extends EntryOptions {
  readonly kind: "rule-set-entries";
  readonly family: string;
}

export type EntryRule = FieldRule | ItemRule | RuleSetEntriesRule | ScriptEntriesRule | VariantRuleGroup;

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
  readonly entryScope?: ScopeReference;
  readonly displayName?: string;
  readonly abbreviation?: string;
}

export interface RootKeyFilter {
  readonly mode: "exclude" | "include";
  readonly values: readonly string[];
}

export interface AnySourceContainer {
  readonly kind: "any-container";
}

export interface NamedSourceContainer {
  readonly kind: "named-container";
  readonly key: string;
}

export type SourceContainer = AnySourceContainer | NamedSourceContainer;

export interface DefinitionSourceBase {
  readonly directory: string;
  readonly includeSubdirectories: boolean;
  readonly files?: readonly string[];
  /**
   * Selects definition keys: file-root keys when there is no container, or
   * direct child keys after the container has been selected.
   */
  readonly rootKeyFilter?: RootKeyFilter;
  readonly container?: SourceContainer;
}

export interface KeyedBlockSource extends DefinitionSourceBase {
  readonly kind: "keyed-blocks";
}

export interface TaggedBlockSource extends DefinitionSourceBase {
  readonly kind: "tagged-blocks";
  readonly nameField: string;
  readonly tags: readonly string[];
}

export interface FileDefinitionSource extends DefinitionSourceBase {
  readonly kind: "file-definitions";
  readonly stripExtension: boolean;
}

export type DefinitionSource = FileDefinitionSource | KeyedBlockSource | TaggedBlockSource;

export interface DefinitionIdLocalisation {
  readonly kind: "definition-id";
  /**
   * The key, with `$` standing for the definition's id.
   *
   * Not a suffix: a job's name is `job_$`, its modifier `mod_job_$_add`. cwt
   * writes the whole key and 48 of the 231 requirements put the id somewhere
   * other than the front, so appending would have asked for `my_jobjob_$`.
   */
  readonly pattern: string;
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

/**
 * One rule the game applies to turn definitions into modifier names.
 *
 * Stellaris generates a modifier for every definition of certain types: a job
 * called `researcher` brings `job_researcher_add` into existence, a ship size
 * called `corvette` brings `shipsize_corvette_hull_add`. The name is
 * `prefix + id + suffix`, so the rule is what has to be stored — expanding it
 * against a mod's own definitions is what makes a mod's generated modifiers
 * known too.
 */
export interface ModifierTemplate {
  readonly type: string;
  readonly prefix: string;
  readonly suffix: string;
}

/**
 * Every name that may appear where a modifier is expected.
 *
 * Two parts, because the game has two kinds. `base` is fixed in the executable
 * and can only be listed. `templates` are generated per definition and have to
 * be expanded, which is why the set cannot be a plain list.
 */
export interface ModifierNamespace {
  readonly base: readonly string[];
  readonly templates: readonly ModifierTemplate[];
  /** The game build the base list and the templates were read from. */
  readonly source: string;
}

export interface DefinitionType {
  /**
   * `DefinitionTypeId` completes; a plain string is still accepted, because the
   * game has directories the ported corpus never named — `mission_categories`
   * arrived with the contracts in 4.4 — and the catalog is generated from that
   * corpus.
   */
  readonly id: DefinitionTypeId | (string & {});
  readonly source: DefinitionSource;
  readonly entryScope?: ScopeReference;
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
  /**
   * What actually matches, when the id is a stand-in rather than a name.
   *
   * cwt names some aliases with a construct — `alias[trigger:<scripted_trigger>]`
   * is "call any scripted trigger", `alias[modifier_rule:enum[simple_maths_enum]]`
   * is "any member of that enum". Ported as an id those match nothing at all,
   * which is how `ai_weight = { weight = 5 }` went unchecked in 4,000 places.
   */
  readonly key?: KeyRule;
  readonly family: ScriptBlockValue["family"];
  readonly input: ScopeSelection;
  readonly operator: RuleOperator;
  readonly value: ValueRule;
}

export interface RuleSetDefinition extends EntryOptions {
  readonly family: string;
  readonly name?: string;
  readonly single: boolean;
  readonly operator: RuleOperator;
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
  readonly modifiers: ModifierNamespace;
  readonly definitionTypes: readonly DefinitionType[];
  readonly enums: readonly EnumDefinition[];
  readonly scopes: readonly ScopeDefinition[];
  readonly scopeGroups: readonly ScopeGroupDefinition[];
  readonly links: readonly LinkDefinition[];
  readonly commands: readonly ScriptCommandDefinition[];
  readonly ruleSets: readonly RuleSetDefinition[];
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
  startFromRoot = false,
): EnumExtractionSource {
  return { directory, route, includeSubdirectories, startFromRoot };
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

export function primitive(type: PrimitiveType, range?: NumericRange, path?: string, format?: string): PrimitiveValue {
  return {
    kind: "primitive",
    type,
    ...(range === undefined ? {} : { range }),
    ...(path === undefined ? {} : { path }),
    ...(format === undefined ? {} : { format }),
  };
}

export function anyValue(): AnyValue {
  return { kind: "any-value" };
}

export function literal(value: string | number | boolean): LiteralValue {
  return { kind: "literal", value };
}

export function enumRef(enumId: EnumId): EnumValue {
  return { kind: "enum", enum: enumId };
}

export function chainedEnum(scope: ScopeReference, enumId: EnumId): ChainedEnumValue {
  return { kind: "chained-enum", scope, enum: enumId };
}

export function typeRef(type: string, variant?: string): TypeReferenceValue {
  return {
    kind: "type-reference",
    type,
    ...(variant === undefined ? {} : { variant }),
  };
}

export function interpolatedType(type: string, prefix: string, suffix: string): InterpolatedTypeValue {
  return { kind: "interpolated-type", type, prefix, suffix };
}

export function scopeRef(scope?: ScopeId): ScopeReferenceValue {
  return scope === undefined ? { kind: "scope-reference" } : { kind: "scope-reference", scope };
}

export function valueSet(set: string): ValueSetReference {
  return { kind: "value-set", set };
}

export function namedValue(value: string): NamedValueReference {
  return { kind: "named-value", value };
}

export function modifierRef(): ModifierReferenceValue {
  return { kind: "modifier-reference" };
}

export function scopeGroup(group: string): ScopeGroupReferenceValue {
  return { kind: "scope-group-reference", group };
}

export function scriptValue(result: ScriptValueRule["result"], range?: NumericRange): ScriptValueRule {
  return { kind: "script-value", result, ...(range === undefined ? {} : { range }) };
}

export function ruleSetRef(family: string, name?: string, single = false): RuleSetReferenceValue {
  return {
    kind: "rule-set-reference",
    family,
    single,
    ...(name === undefined ? {} : { name }),
  };
}

export function ruleSetKeyRef(family: string): RuleSetKeyReferenceValue {
  return { kind: "rule-set-key-reference", family };
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

export function ruleSetEntries(family: string, options: EntryOptions = {}): RuleSetEntriesRule {
  return { kind: "rule-set-entries", family, ...options };
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

export function patternKey(prefix: string, suffix = "", type?: string): PatternKey {
  return {
    kind: "pattern-key",
    prefix,
    suffix,
    ...(type === undefined ? {} : { type }),
  };
}

export function parameterKey(): ParameterKey {
  return { kind: "parameter-key" };
}

export function numericKey(integer = true): NumericKey {
  return { kind: "numeric-key", integer };
}

export function modifierKey(): ModifierKey {
  return { kind: "modifier-key" };
}

export function primitiveKey(type: PrimitiveType): PrimitiveKey {
  return { kind: "primitive-key", type };
}

export function typeKey(type: string): TypeKey {
  return { kind: "type-key", type };
}

export function valueSetKey(set: string): ValueSetKey {
  return { kind: "value-set-key", set };
}

export function namedValueKey(value: string): NamedValueKey {
  return { kind: "named-value-key", value };
}

export function scopeKey(scope: ScopeReference): ScopeKey {
  return { kind: "scope-key", scope };
}

export function scopeGroupKey(group: string): ScopeGroupKey {
  return { kind: "scope-group-key", group };
}

export function ruleSetKey(family: string, name?: string, single = false): RuleSetKey {
  return {
    kind: "rule-set-key",
    family,
    single,
    ...(name === undefined ? {} : { name }),
  };
}

export function ruleSetKeysFieldKey(family: string): RuleSetKeysFieldKey {
  return { kind: "rule-set-keys-field-key", family };
}

export function enterScope(scope: ScopeReference): EnterScope {
  return { kind: "enter", scope };
}

export function replaceScope(frame: ScopeFrame): ReplaceScope {
  return { kind: "replace", frame };
}

export function anyScope(): AnyScopeSelection {
  return { kind: "any-scope" };
}

export function unspecifiedScope(): UnspecifiedScopeSelection {
  return { kind: "unspecified-scope" };
}

export function noScope(): NoScopeReference {
  return { kind: "no-scope" };
}

export function oneOfScopes(...scopes: readonly ScopeReference[]): ScopeAlternatives {
  return { kind: "scope-alternatives", scopes };
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

export interface FieldOptions extends EntryOptions {
  readonly operator?: RuleOperator;
}

export function field(key: KeyRule, value: ValueRule, occurrence: Occurrence, options: FieldOptions = {}): FieldRule {
  const { operator = "=", ...entryOptions } = options;
  return { kind: "field", key, value, occurrence, operator, ...entryOptions };
}

export function required(key: KeyRule, value: ValueRule, options: FieldOptions = {}): FieldRule {
  return field(key, value, occurs.one, options);
}

export function optional(key: KeyRule, value: ValueRule, options: FieldOptions = {}): FieldRule {
  return field(key, value, occurs.optional, options);
}

export function repeatable(key: KeyRule, value: ValueRule, options: FieldOptions = {}): FieldRule {
  return field(key, value, occurs.any, options);
}

export function oneOrMore(key: KeyRule, value: ValueRule, options: FieldOptions = {}): FieldRule {
  return field(key, value, occurs.oneOrMore, options);
}

export function forbidden(key: KeyRule, value: ValueRule, options: FieldOptions = {}): FieldRule {
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

export type DefinitionSourceOptions = Omit<DefinitionSourceBase, "directory" | "includeSubdirectories">;

export function keyedBlocks(
  directory: string,
  includeSubdirectories = true,
  options: DefinitionSourceOptions = {},
): KeyedBlockSource {
  return { kind: "keyed-blocks", directory, includeSubdirectories, ...options };
}

export function taggedBlocks(
  directory: string,
  nameField: string,
  tags: readonly string[],
  includeSubdirectories = true,
  options: DefinitionSourceOptions = {},
): TaggedBlockSource {
  return { kind: "tagged-blocks", directory, nameField, tags, includeSubdirectories, ...options };
}

export function fileDefinitions(
  directory: string,
  includeSubdirectories = true,
  options: DefinitionSourceOptions = {},
): FileDefinitionSource {
  return {
    kind: "file-definitions",
    directory,
    includeSubdirectories,
    stripExtension: true,
    ...options,
  };
}

export function definitionLocalisation(
  role: string,
  pattern: string,
  requiredValue: boolean,
  variant?: string,
): LocalisationRequirement {
  return {
    role,
    source: { kind: "definition-id", pattern },
    required: requiredValue,
    ...(variant === undefined ? {} : { variant }),
  };
}

/** The key one requirement asks for, for a definition of this id. */
export function localisationKey(pattern: string, id: string): string {
  return pattern.replaceAll("$", id);
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

/**
 * Identity constructors for the generated command tables.
 *
 * A few thousand object literals in one array make the compiler build a union
 * of every element type and give up with TS2590. Routing each element through a
 * function with an explicit return type collapses inference per element, so the
 * array stays a plain `ScriptCommandDefinition[]`.
 */
export function scriptCommand(definition: ScriptCommandDefinition): ScriptCommandDefinition {
  return definition;
}

export function ruleSet(definition: RuleSetDefinition): RuleSetDefinition {
  return definition;
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
