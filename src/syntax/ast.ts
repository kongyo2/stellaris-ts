import type { Span } from "./position.js";
import type { Token } from "./token.js";

export const NodeKind: {
  readonly Document: "Document";
  readonly Assignment: "Assignment";
  readonly Block: "Block";
  readonly Scalar: "Scalar";
  readonly PrefixedBlock: "PrefixedBlock";
  readonly InlineMath: "InlineMath";
  readonly OptionalBlock: "OptionalBlock";
  readonly Trivia: "Trivia";
  readonly Error: "Error";
} = {
  Document: "Document",
  Assignment: "Assignment",
  Block: "Block",
  Scalar: "Scalar",
  PrefixedBlock: "PrefixedBlock",
  InlineMath: "InlineMath",
  OptionalBlock: "OptionalBlock",
  Trivia: "Trivia",
  Error: "Error",
} as const;

export type NodeKind = (typeof NodeKind)[keyof typeof NodeKind];

export const ScalarKind: {
  readonly Identifier: "Identifier";
  readonly QuotedString: "QuotedString";
  readonly Boolean: "Boolean";
  readonly Number: "Number";
  readonly Date: "Date";
  readonly ScriptVariable: "ScriptVariable";
  readonly Parameter: "Parameter";
} = {
  Identifier: "Identifier",
  QuotedString: "QuotedString",
  Boolean: "Boolean",
  Number: "Number",
  Date: "Date",
  ScriptVariable: "ScriptVariable",
  Parameter: "Parameter",
} as const;

export type ScalarKind = (typeof ScalarKind)[keyof typeof ScalarKind];

export const AssignmentOperator: {
  readonly Equals: "=";
  readonly EqualEqual: "==";
  readonly NotEqual: "!=";
  readonly GreaterThan: ">";
  readonly GreaterThanOrEqual: ">=";
  readonly LessThan: "<";
  readonly LessThanOrEqual: "<=";
} = {
  Equals: "=",
  EqualEqual: "==",
  NotEqual: "!=",
  GreaterThan: ">",
  GreaterThanOrEqual: ">=",
  LessThan: "<",
  LessThanOrEqual: "<=",
} as const;

export type AssignmentOperator = (typeof AssignmentOperator)[keyof typeof AssignmentOperator];

export interface BaseNode {
  readonly span: Span;
}

export interface Document extends BaseNode {
  readonly kind: typeof NodeKind.Document;
  readonly entries: readonly EntryNode[];
}

export interface Assignment extends BaseNode {
  readonly kind: typeof NodeKind.Assignment;
  readonly key: Scalar;
  readonly operator: AssignmentOperator;
  readonly operatorSpan: Span;
  readonly beforeOperatorTrivia: readonly Token[];
  readonly beforeValueTrivia: readonly Token[];
  readonly value: ValueNode;
}

export interface Block extends BaseNode {
  readonly kind: typeof NodeKind.Block;
  readonly entries: readonly EntryNode[];
  readonly closed: boolean;
}

export interface Scalar extends BaseNode {
  readonly kind: typeof NodeKind.Scalar;
  readonly raw: string;
  readonly value: string | number | boolean;
  readonly scalarKind: ScalarKind;
}

export interface PrefixedBlock extends BaseNode {
  readonly kind: typeof NodeKind.PrefixedBlock;
  readonly prefix: Scalar;
  readonly beforeBlockTrivia: readonly Token[];
  readonly block: Block;
}

export interface InlineMath extends BaseNode {
  readonly kind: typeof NodeKind.InlineMath;
  readonly tokens: readonly Token[];
  readonly escaped: boolean;
  readonly closed: boolean;
}

export interface OptionalBlock extends BaseNode {
  readonly kind: typeof NodeKind.OptionalBlock;
  readonly header: readonly Token[];
  readonly entries: readonly EntryNode[];
  readonly closed: boolean;
}

export interface Trivia extends BaseNode {
  readonly kind: typeof NodeKind.Trivia;
  readonly tokens: readonly Token[];
}

export interface ErrorNode extends BaseNode {
  readonly kind: typeof NodeKind.Error;
  readonly tokens: readonly Token[];
}

export type EntryNode = Assignment | Block | Scalar | PrefixedBlock | InlineMath | OptionalBlock | Trivia | ErrorNode;

export type ValueNode = Block | Scalar | PrefixedBlock | InlineMath | OptionalBlock | ErrorNode;
