import type { Span } from "./position.js";

/**
 * The kinds the game's own lexer produces, and its own ids for them.
 *
 * Read out of `stellaris.exe` 4.4.6 rather than inferred. The lexer classifies
 * the first character of a token by `character - '!'` through a 93-entry index
 * table at RVA 0x1d35bd0; the twelve characters that table sends anywhere other
 * than the default are the entire punctuation of the format, and a second table
 * at 0x1d35c38 ends a bare token on exactly the same twelve. Everything else —
 * `[ ] @ $ | : / \ ' + - . % & ^ _ ` ~ ?`, every digit and letter, and every
 * byte above 0x7d — is an ordinary bare-token character. That is why `@[a+2]`,
 * `[[POP_GROUP]` and `mod_job_$_add` all arrive here as a single atom.
 *
 * The ids matter because they are what makes `greater_than` and `>` the same
 * token: a bare word is looked up in the game's dynamic-keyword registry, and
 * `greater_than` is registered there with id 467 — the id the `>` character
 * produces. Six operator words work this way, so a script may write
 * `count greater_than 3` and mean `count > 3`.
 */
export const TokenKind: {
  readonly Whitespace: "Whitespace";
  readonly Newline: "Newline";
  readonly Comment: "Comment";
  readonly OpenBrace: "OpenBrace";
  readonly CloseBrace: "CloseBrace";
  readonly OpenParen: "OpenParen";
  readonly CloseParen: "CloseParen";
  readonly Comma: "Comma";
  readonly Equals: "Equals";
  readonly EqualEqual: "EqualEqual";
  readonly NotEqual: "NotEqual";
  readonly Bang: "Bang";
  readonly GreaterThan: "GreaterThan";
  readonly GreaterThanOrEqual: "GreaterThanOrEqual";
  readonly LessThan: "LessThan";
  readonly LessThanOrEqual: "LessThanOrEqual";
  readonly QuotedString: "QuotedString";
  readonly Atom: "Atom";
  readonly EndOfFile: "EndOfFile";
} = {
  Whitespace: "Whitespace",
  Newline: "Newline",
  Comment: "Comment",
  OpenBrace: "OpenBrace",
  CloseBrace: "CloseBrace",
  OpenParen: "OpenParen",
  CloseParen: "CloseParen",
  Comma: "Comma",
  Equals: "Equals",
  /**
   * `==`, which only the `.cwt` dialect has.
   *
   * The game's lexer folds a trailing `=` after `>`, `<` and `!` and after
   * nothing else, so script never produces this token — `==` there is two `=`
   * and the second lands in value position. cwtools' schema language does use
   * it, 227 times in `triggers.cwt` alone, so the importer asks for it by
   * option rather than the reader inventing an operator the game lacks.
   */
  EqualEqual: "EqualEqual",
  NotEqual: "NotEqual",
  Bang: "Bang",
  GreaterThan: "GreaterThan",
  GreaterThanOrEqual: "GreaterThanOrEqual",
  LessThan: "LessThan",
  LessThanOrEqual: "LessThanOrEqual",
  QuotedString: "QuotedString",
  Atom: "Atom",
  EndOfFile: "EndOfFile",
} as const;

export type TokenKind = (typeof TokenKind)[keyof typeof TokenKind];

/**
 * The game's numeric token id for each kind, where it has one.
 *
 * An atom carries 12 or 15 depending on how it reads as a number, and a
 * comment is consumed rather than returned, so those are not here. Kept so the
 * lexer's behaviour can be checked against the executable it was read from
 * without re-deriving the mapping each time.
 */
export const GAME_TOKEN_IDS: Readonly<Record<string, number>> = {
  Equals: 1,
  QuotedString: 2,
  OpenBrace: 3,
  CloseBrace: 4,
  OpenParen: 5,
  CloseParen: 6,
  Comma: 8,
  Comment: 9,
  EndOfFile: 19,
  GreaterThan: 467,
  LessThan: 468,
  GreaterThanOrEqual: 971,
  LessThanOrEqual: 972,
  Bang: 1062,
  NotEqual: 1063,
};

/**
 * The words the dynamic-keyword registry gives an operator's token id.
 *
 * Six of the 9,892 built-in tokens are registered with the ids the comparison
 * characters produce, so the lexer returns the same token for the word as for
 * the symbol and nothing downstream can tell them apart. Case-insensitive,
 * like every built-in keyword: the registry folds ASCII case on lookup.
 */
export const OPERATOR_WORDS: ReadonlyMap<string, TokenKind> = new Map([
  ["greater_than", TokenKind.GreaterThan],
  ["less_than", TokenKind.LessThan],
  ["greater_eq_than", TokenKind.GreaterThanOrEqual],
  ["less_eq_than", TokenKind.LessThanOrEqual],
  ["not", TokenKind.Bang],
  ["not_eq", TokenKind.NotEqual],
]);

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly span: Span;
}

export function isTriviaToken(token: Token): boolean {
  return token.kind === TokenKind.Whitespace || token.kind === TokenKind.Newline || token.kind === TokenKind.Comment;
}

/**
 * Whether this token is an operator the reader accepts between key and value.
 *
 * The reader's dispatch tests exactly six ids — 1, 467, 468, 971, 972 and 1063.
 * `!` alone is 1062 and is *not* among them, so `key ! value` is not a
 * comparison however much it looks like one, and neither is `==`: the lexer
 * folds a following `=` only after `>`, `<` and `!`, so `==` is two separate
 * `=` tokens and the second one lands in value position.
 */
export function isReaderOperator(kind: TokenKind): boolean {
  return (
    kind === TokenKind.Equals ||
    // Never produced when reading script; see the kind's own note.
    kind === TokenKind.EqualEqual ||
    kind === TokenKind.GreaterThan ||
    kind === TokenKind.LessThan ||
    kind === TokenKind.GreaterThanOrEqual ||
    kind === TokenKind.LessThanOrEqual ||
    kind === TokenKind.NotEqual
  );
}
