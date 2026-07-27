import type { Document, EntryNode, Span } from "../../src/syntax/index.js";
import type { CwtPreparedSource } from "./prepare.js";

export const CwtDirectiveName: {
  readonly Abbreviation: "abbreviation";
  readonly Cardinality: "cardinality";
  readonly DisplayName: "display_name";
  readonly GraphRelatedTypes: "graph_related_types";
  readonly IncomingReferenceLabel: "incomingReferenceLabel";
  readonly Optional: "optional";
  readonly Primary: "primary";
  readonly PushScope: "push_scope";
  readonly ReplaceScope: "replace_scope";
  readonly ReplaceScopes: "replace_scopes";
  readonly Required: "required";
  readonly Scope: "scope";
  readonly Severity: "severity";
  readonly TypeKeyFilter: "type_key_filter";
} = {
  Abbreviation: "abbreviation",
  Cardinality: "cardinality",
  DisplayName: "display_name",
  GraphRelatedTypes: "graph_related_types",
  IncomingReferenceLabel: "incomingReferenceLabel",
  Optional: "optional",
  Primary: "primary",
  PushScope: "push_scope",
  ReplaceScope: "replace_scope",
  ReplaceScopes: "replace_scopes",
  Required: "required",
  Scope: "scope",
  Severity: "severity",
  TypeKeyFilter: "type_key_filter",
} as const;

export type CwtDirectiveName = (typeof CwtDirectiveName)[keyof typeof CwtDirectiveName];

export type CwtDirectiveOperator = "=" | "<>" | "bare" | "legacy-space";

export interface CwtDirective {
  readonly kind: "directive";
  readonly name: CwtDirectiveName;
  readonly operator: CwtDirectiveOperator;
  readonly value: string | null;
  readonly rawText: string;
  readonly span: Span;
}

export interface CwtDocumentation {
  readonly kind: "documentation";
  readonly text: string;
  readonly rawText: string;
  readonly span: Span;
}

export interface CwtPreservedComment {
  readonly kind: "comment";
  readonly text: string;
  readonly rawText: string;
  readonly span: Span;
}

export type CwtAnnotation = CwtDirective | CwtDocumentation | CwtPreservedComment;

export interface CwtAnnotatedEntry {
  readonly syntax: EntryNode;
  readonly originalText: string;
  readonly leading: readonly CwtAnnotation[];
  readonly trailing: readonly CwtAnnotation[];
}

export interface CwtConstruct {
  readonly head: string;
  readonly argument: string;
  readonly rawText: string;
  readonly recovered: boolean;
  readonly span: Span;
}

export type CwtReaderDiagnosticCategory = "l0-diagnostic" | "orphan-annotation" | "recovery" | "unknown-syntax";

export interface CwtReaderDiagnostic {
  readonly category: CwtReaderDiagnosticCategory;
  readonly code: string;
  readonly message: string;
  readonly path: string;
  readonly span: Span;
}

export interface CwtFileMetrics {
  readonly annotationCount: number;
  readonly constructCount: number;
  readonly documentationCount: number;
  readonly lineCount: number;
  readonly l0DiagnosticCount: number;
  readonly orphanAnnotationCount: number;
  readonly recoveryCount: number;
  readonly unknownSyntaxCount: number;
}

export interface CwtReadResult {
  readonly source: CwtPreparedSource;
  readonly document: Document;
  readonly entries: readonly CwtAnnotatedEntry[];
  readonly constructs: readonly CwtConstruct[];
  readonly diagnostics: readonly CwtReaderDiagnostic[];
  readonly metrics: CwtFileMetrics;
}

export interface CwtCorpusMetrics {
  readonly annotationCount: number;
  readonly complexEnumDeclarationCount: number;
  readonly complexEnumNameCount: number;
  readonly declaredEnumNameCount: number;
  readonly documentationCount: number;
  readonly effectAliasDeclarationCount: number;
  readonly effectAliasNameCount: number;
  readonly enumSyntaxNameCount: number;
  readonly enumSyntaxOccurrenceCount: number;
  readonly fileCount: number;
  readonly lineCount: number;
  readonly linkBlockCount: number;
  readonly linkDeclarationCount: number;
  readonly linkNameCount: number;
  readonly l0DiagnosticCount: number;
  readonly orphanAnnotationCount: number;
  readonly primaryEffectAliasDeclarationCount: number;
  readonly primaryTriggerAliasDeclarationCount: number;
  readonly recoveryCount: number;
  readonly scopeCount: number;
  readonly staticEnumDeclarationCount: number;
  readonly staticEnumNameCount: number;
  readonly subtypeConstructCount: number;
  readonly subtypeDefinitionCount: number;
  readonly subtypeDefinitionOwnerCount: number;
  readonly subtypeLocalisationReferenceCount: number;
  readonly subtypeReferenceCount: number;
  readonly subtypeSchemaNestedSelectorCount: number;
  readonly subtypeSchemaRootSelectorCount: number;
  readonly triggerAliasDeclarationCount: number;
  readonly triggerAliasNameCount: number;
  readonly typeDefinitionCount: number;
  readonly typeKeySubtypeDefinitionCount: number;
  readonly typeNameCount: number;
  readonly unknownSyntaxCount: number;
}

export interface CwtCorpus {
  readonly files: readonly CwtReadResult[];
  readonly metrics: CwtCorpusMetrics;
}
