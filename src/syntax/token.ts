import type { Span } from "./position.js";

export const TokenKind: {
  readonly Whitespace: "Whitespace";
  readonly Newline: "Newline";
  readonly Comment: "Comment";
  readonly OpenBrace: "OpenBrace";
  readonly CloseBrace: "CloseBrace";
  readonly OpenBracket: "OpenBracket";
  readonly CloseBracket: "CloseBracket";
  readonly Equals: "Equals";
  readonly EqualEqual: "EqualEqual";
  readonly NotEqual: "NotEqual";
  readonly GreaterThan: "GreaterThan";
  readonly GreaterThanOrEqual: "GreaterThanOrEqual";
  readonly LessThan: "LessThan";
  readonly LessThanOrEqual: "LessThanOrEqual";
  readonly QuotedString: "QuotedString";
  readonly Atom: "Atom";
  readonly Unknown: "Unknown";
  readonly EndOfFile: "EndOfFile";
} = {
  Whitespace: "Whitespace",
  Newline: "Newline",
  Comment: "Comment",
  OpenBrace: "OpenBrace",
  CloseBrace: "CloseBrace",
  OpenBracket: "OpenBracket",
  CloseBracket: "CloseBracket",
  Equals: "Equals",
  EqualEqual: "EqualEqual",
  NotEqual: "NotEqual",
  GreaterThan: "GreaterThan",
  GreaterThanOrEqual: "GreaterThanOrEqual",
  LessThan: "LessThan",
  LessThanOrEqual: "LessThanOrEqual",
  QuotedString: "QuotedString",
  Atom: "Atom",
  Unknown: "Unknown",
  EndOfFile: "EndOfFile",
} as const;

export type TokenKind = (typeof TokenKind)[keyof typeof TokenKind];

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly span: Span;
}

export function isTriviaToken(token: Token): boolean {
  return token.kind === TokenKind.Whitespace || token.kind === TokenKind.Newline || token.kind === TokenKind.Comment;
}
