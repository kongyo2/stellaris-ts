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
  readonly Punctuation: "Punctuation";
} = {
  Identifier: "Identifier",
  QuotedString: "QuotedString",
  Boolean: "Boolean",
  Number: "Number",
  Date: "Date",
  ScriptVariable: "ScriptVariable",
  Parameter: "Parameter",
  /**
   * `(`, `)`, `,` or a lone `!`.
   *
   * The game's lexer gives each of these a token of its own but its reader has
   * no rule for them, so one written between statements is read as a key or a
   * value like any other word. `.asset` files write `intensity = 4, fade` and
   * mean two values; keeping the character as a scalar is what lets that file
   * come back out as it went in.
   */
  Punctuation: "Punctuation",
} as const;

export type ScalarKind = (typeof ScalarKind)[keyof typeof ScalarKind];

/**
 * The operators that can stand between a key and a value.
 *
 * Six of them are the game's: its reader tests exactly token ids 1, 467, 468,
 * 971, 972 and 1063. A lone `!` is 1062 and is not among them, so `key ! value`
 * is not a comparison however much it reads like one.
 *
 * `==` is the seventh and the game has none — its lexer folds a trailing `=`
 * after `>`, `<` and `!` only, which leaves `==` as two `=` tokens with the
 * second standing where the value belongs. It is here for `.cwt`, whose schema
 * language does have the operator, and appears only when the lexer was asked
 * for it. Nothing that writes script may produce one.
 */
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

/**
 * `@[ base * 2 ]`, and `@\[( 72 * $PROGRESS$ )]` inside an inline script.
 *
 * Held as tokens because the game does not lex this as a nested construct:
 * `[` is an ordinary bare-token character, so `@[-effect_mult]` arrives as one
 * atom and `@[ base * 2 ]` as five, and the reader recovers the expression by
 * scanning its own token text for the closing `]`. Re-printing the tokens is
 * the only rendering that is right for both spellings.
 */
export interface InlineMath extends BaseNode {
  readonly kind: typeof NodeKind.InlineMath;
  readonly tokens: readonly Token[];
  readonly escaped: boolean;
  readonly closed: boolean;
}

/**
 * `[[PARAM] … ]`, the block an inline script writes when a parameter is set.
 *
 * `[[POP_GROUP]` is a single atom and `[[!POP_GROUP]` is three — `[[`, the
 * lone `!`, then `POP_GROUP]` — because `!` is one of the twelve characters
 * that end a bare token and `[` is not. The header keeps whichever tokens the
 * spelling produced.
 */
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
