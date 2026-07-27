import { AssignmentOperator, NodeKind, ScalarKind } from "./ast.js";
import type {
  Assignment,
  Block,
  Document,
  EntryNode,
  ErrorNode,
  InlineMath,
  OptionalBlock,
  PrefixedBlock,
  Scalar,
  Trivia,
  ValueNode,
} from "./ast.js";
import { tokenize } from "./lexer.js";
import type { LexResult } from "./lexer.js";
import type { Position, Span } from "./position.js";
import { isTriviaToken, TokenKind } from "./token.js";
import type { Token, TokenKind as TokenKindType } from "./token.js";

export const ParserDiagnosticCode = {
  LexerError: "lexer-error",
  UnexpectedRootValue: "unexpected-root-value",
  UnexpectedToken: "unexpected-token",
  ExpectedValue: "expected-value",
  ExpectedCloseBrace: "expected-close-brace",
  ExpectedCloseBracket: "expected-close-bracket",
  ExpectedOptionalHeader: "expected-optional-header",
  InternalError: "internal-error",
} as const;

export type ParserDiagnosticCode = (typeof ParserDiagnosticCode)[keyof typeof ParserDiagnosticCode];

export interface ParserDiagnostic {
  readonly code: ParserDiagnosticCode;
  readonly message: string;
  readonly span: Span;
}

export interface ParseResult {
  readonly document: Document;
  readonly diagnostics: readonly ParserDiagnostic[];
  readonly hadBom: boolean;
}

interface SignificantToken {
  readonly token: Token;
  readonly index: number;
}

function span(start: Position, end: Position): Span {
  return { start, end };
}

function isScalarToken(token: Token): boolean {
  return token.kind === TokenKind.Atom || token.kind === TokenKind.QuotedString;
}

function isAssignmentOperatorKind(kind: TokenKindType): boolean {
  return (
    kind === TokenKind.Equals ||
    kind === TokenKind.EqualEqual ||
    kind === TokenKind.NotEqual ||
    kind === TokenKind.GreaterThan ||
    kind === TokenKind.GreaterThanOrEqual ||
    kind === TokenKind.LessThan ||
    kind === TokenKind.LessThanOrEqual
  );
}

function assignmentOperator(token: Token): AssignmentOperator {
  switch (token.kind) {
    case TokenKind.Equals:
      return AssignmentOperator.Equals;
    case TokenKind.EqualEqual:
      return AssignmentOperator.EqualEqual;
    case TokenKind.NotEqual:
      return AssignmentOperator.NotEqual;
    case TokenKind.GreaterThan:
      return AssignmentOperator.GreaterThan;
    case TokenKind.GreaterThanOrEqual:
      return AssignmentOperator.GreaterThanOrEqual;
    case TokenKind.LessThan:
      return AssignmentOperator.LessThan;
    case TokenKind.LessThanOrEqual:
      return AssignmentOperator.LessThanOrEqual;
    default:
      throw new Error(`Token ${token.kind} is not an assignment operator.`);
  }
}

function scalarValue(token: Token): Pick<Scalar, "raw" | "scalarKind" | "value"> {
  const raw: string = token.text;

  if (token.kind === TokenKind.QuotedString) {
    const value: string = raw.endsWith('"') && raw.length >= 2 ? raw.slice(1, -1) : raw.slice(1);
    return {
      raw,
      scalarKind: ScalarKind.QuotedString,
      value,
    };
  }

  const lowerRaw: string = raw.toLowerCase();
  if (lowerRaw === "yes" || lowerRaw === "no") {
    return {
      raw,
      scalarKind: ScalarKind.Boolean,
      value: lowerRaw === "yes",
    };
  }

  if (/^\d+\.\d+\.\d+$/u.test(raw)) {
    return {
      raw,
      scalarKind: ScalarKind.Date,
      value: raw,
    };
  }

  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(raw)) {
    const value: number = Number(raw);
    if (Number.isFinite(value)) {
      return {
        raw,
        scalarKind: ScalarKind.Number,
        value,
      };
    }
  }

  if (raw.startsWith("@")) {
    return {
      raw,
      scalarKind: ScalarKind.ScriptVariable,
      value: raw,
    };
  }

  if (raw.length >= 2 && raw.startsWith("$") && raw.endsWith("$")) {
    return {
      raw,
      scalarKind: ScalarKind.Parameter,
      value: raw,
    };
  }

  return {
    raw,
    scalarKind: ScalarKind.Identifier,
    value: raw,
  };
}

class Parser {
  readonly diagnostics: ParserDiagnostic[] = [];
  private readonly tokens: readonly Token[];
  private readonly eofToken: Token;
  private index = 0;

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
    const eofToken: Token | undefined = tokens.at(-1);

    if (eofToken === undefined || eofToken.kind !== TokenKind.EndOfFile) {
      throw new Error("The parser requires a token stream ending in EOF.");
    }

    this.eofToken = eofToken;
  }

  parseDocument(): Document {
    const entries: EntryNode[] = [];

    while (this.current().kind !== TokenKind.EndOfFile) {
      entries.push(this.parseEntry(true));
    }

    const start: Position = this.tokens[0]?.span.start ?? this.eofToken.span.start;
    return {
      kind: NodeKind.Document,
      entries,
      span: span(start, this.eofToken.span.end),
    };
  }

  private current(): Token {
    return this.tokens[this.index] ?? this.eofToken;
  }

  private peek(distance = 1): Token {
    return this.tokens[this.index + distance] ?? this.eofToken;
  }

  private advance(): Token {
    const token: Token = this.current();

    if (token.kind !== TokenKind.EndOfFile) {
      this.index += 1;
    }

    return token;
  }

  private nextSignificant(fromIndex = this.index + 1): SignificantToken {
    let candidateIndex: number = fromIndex;

    while (candidateIndex < this.tokens.length) {
      const token: Token | undefined = this.tokens[candidateIndex];

      if (token === undefined) {
        break;
      }

      if (!isTriviaToken(token)) {
        return { token, index: candidateIndex };
      }

      candidateIndex += 1;
    }

    return { token: this.eofToken, index: this.tokens.length - 1 };
  }

  private collectTrivia(): Token[] {
    const tokens: Token[] = [];

    while (isTriviaToken(this.current())) {
      tokens.push(this.advance());
    }

    return tokens;
  }

  private parseEntry(allowUnkeyed: boolean): EntryNode {
    const token: Token = this.current();

    if (isTriviaToken(token)) {
      return this.parseTrivia();
    }

    if (token.kind === TokenKind.OpenBracket && this.peek().kind === TokenKind.OpenBracket) {
      return this.parseOptionalBlock();
    }

    if (isScalarToken(token)) {
      const following: SignificantToken = this.nextSignificant();

      if (isAssignmentOperatorKind(following.token.kind)) {
        return this.parseAssignment();
      }

      if (
        this.isInlineMathPrefix(token) &&
        following.token.kind === TokenKind.OpenBracket &&
        following.index === this.index + 1
      ) {
        return this.parseInlineMath();
      }

      if (allowUnkeyed && following.token.kind === TokenKind.OpenBrace && this.isOnCurrentLine(following.index)) {
        return this.parsePrefixedBlock();
      }

      if (allowUnkeyed) {
        return this.parseScalar();
      }

      this.diagnostics.push({
        code: ParserDiagnosticCode.UnexpectedRootValue,
        message: `Unexpected unkeyed value ${JSON.stringify(token.text)} at the document root.`,
        span: token.span,
      });
      this.advance();
      return {
        kind: NodeKind.Error,
        tokens: [token],
        span: token.span,
      };
    }

    if (allowUnkeyed && token.kind === TokenKind.OpenBrace) {
      return this.parseBlock();
    }

    return this.parseUnexpectedToken(
      allowUnkeyed ? "Unexpected token in block." : "Unexpected token at the document root.",
    );
  }

  private parseTrivia(): Trivia {
    const tokens: Token[] = this.collectTrivia();
    const first: Token = tokens[0] ?? this.current();
    const last: Token = tokens.at(-1) ?? first;

    return {
      kind: NodeKind.Trivia,
      tokens,
      span: span(first.span.start, last.span.end),
    };
  }

  private parseScalar(): Scalar {
    const token: Token = this.advance();
    const value: Pick<Scalar, "raw" | "scalarKind" | "value"> = scalarValue(token);

    return {
      kind: NodeKind.Scalar,
      ...value,
      span: token.span,
    };
  }

  private parseAssignment(): Assignment {
    const key: Scalar = this.parseScalar();
    const beforeOperatorTrivia: Token[] = this.collectTrivia();
    const operatorToken: Token = this.advance();
    const beforeValueTrivia: Token[] = this.collectTrivia();
    const value: ValueNode = this.parseValue();

    return {
      kind: NodeKind.Assignment,
      key,
      operator: assignmentOperator(operatorToken),
      operatorSpan: operatorToken.span,
      beforeOperatorTrivia,
      beforeValueTrivia,
      value,
      span: span(key.span.start, value.span.end),
    };
  }

  private parseValue(): ValueNode {
    const token: Token = this.current();

    if (token.kind === TokenKind.OpenBracket && this.peek().kind === TokenKind.OpenBracket) {
      return this.parseOptionalBlock();
    }

    if (token.kind === TokenKind.OpenBrace) {
      return this.parseBlock();
    }

    if (isScalarToken(token)) {
      const following: SignificantToken = this.nextSignificant();

      if (
        this.isInlineMathPrefix(token) &&
        following.token.kind === TokenKind.OpenBracket &&
        following.index === this.index + 1
      ) {
        return this.parseInlineMath();
      }

      if (following.token.kind === TokenKind.OpenBrace && this.isOnCurrentLine(following.index)) {
        return this.parsePrefixedBlock();
      }

      return this.parseScalar();
    }

    if (
      token.kind === TokenKind.EndOfFile ||
      token.kind === TokenKind.CloseBrace ||
      token.kind === TokenKind.CloseBracket
    ) {
      this.diagnostics.push({
        code: ParserDiagnosticCode.ExpectedValue,
        message: "Expected a value after the assignment operator.",
        span: token.span,
      });
      return {
        kind: NodeKind.Error,
        tokens: [],
        span: token.span,
      };
    }

    return this.parseUnexpectedToken("Expected a value.");
  }

  private parseBlock(): Block {
    const openingBrace: Token = this.advance();
    const entries: EntryNode[] = [];

    while (this.current().kind !== TokenKind.CloseBrace && this.current().kind !== TokenKind.EndOfFile) {
      entries.push(this.parseEntry(true));
    }

    if (this.current().kind === TokenKind.CloseBrace) {
      const closingBrace: Token = this.advance();
      return {
        kind: NodeKind.Block,
        entries,
        closed: true,
        span: span(openingBrace.span.start, closingBrace.span.end),
      };
    }

    this.diagnostics.push({
      code: ParserDiagnosticCode.ExpectedCloseBrace,
      message: "Expected '}' before the end of the file.",
      span: this.current().span,
    });
    return {
      kind: NodeKind.Block,
      entries,
      closed: false,
      span: span(openingBrace.span.start, this.current().span.end),
    };
  }

  private parsePrefixedBlock(): PrefixedBlock {
    const prefix: Scalar = this.parseScalar();
    const beforeBlockTrivia: Token[] = this.collectTrivia();
    const block: Block = this.parseBlock();

    return {
      kind: NodeKind.PrefixedBlock,
      prefix,
      beforeBlockTrivia,
      block,
      span: span(prefix.span.start, block.span.end),
    };
  }

  private parseOptionalBlock(): OptionalBlock {
    const firstOpeningBracket: Token = this.advance();
    this.advance();
    const header: Token[] = [];

    while (this.current().kind !== TokenKind.CloseBracket && this.current().kind !== TokenKind.EndOfFile) {
      header.push(this.advance());
    }

    if (header.length === 0 || header.every((headerToken) => isTriviaToken(headerToken))) {
      this.diagnostics.push({
        code: ParserDiagnosticCode.ExpectedOptionalHeader,
        message: "Expected an optional-block parameter name.",
        span: this.current().span,
      });
    }

    if (this.current().kind === TokenKind.EndOfFile) {
      this.diagnostics.push({
        code: ParserDiagnosticCode.ExpectedCloseBracket,
        message: "Expected ']' after the optional-block header.",
        span: this.current().span,
      });
      return {
        kind: NodeKind.OptionalBlock,
        header,
        entries: [],
        closed: false,
        span: span(firstOpeningBracket.span.start, this.current().span.end),
      };
    }

    this.advance();
    const entries: EntryNode[] = [];

    while (this.current().kind !== TokenKind.CloseBracket && this.current().kind !== TokenKind.EndOfFile) {
      entries.push(this.parseEntry(true));
    }

    if (this.current().kind === TokenKind.CloseBracket) {
      const closingBracket: Token = this.advance();
      return {
        kind: NodeKind.OptionalBlock,
        header,
        entries,
        closed: true,
        span: span(firstOpeningBracket.span.start, closingBracket.span.end),
      };
    }

    this.diagnostics.push({
      code: ParserDiagnosticCode.ExpectedCloseBracket,
      message: "Expected ']' before the end of the optional block.",
      span: this.current().span,
    });
    return {
      kind: NodeKind.OptionalBlock,
      header,
      entries,
      closed: false,
      span: span(firstOpeningBracket.span.start, this.current().span.end),
    };
  }

  private parseInlineMath(): InlineMath {
    const tokens: Token[] = [];
    const prefix: Token = this.advance();
    tokens.push(prefix);

    while (isTriviaToken(this.current())) {
      tokens.push(this.advance());
    }

    const openingBracket: Token = this.advance();
    tokens.push(openingBracket);
    let bracketDepth = 1;
    let closed = false;

    while (this.current().kind !== TokenKind.EndOfFile) {
      const token: Token = this.advance();
      tokens.push(token);

      if (token.kind === TokenKind.OpenBracket) {
        bracketDepth += 1;
      } else if (token.kind === TokenKind.CloseBracket) {
        bracketDepth -= 1;
        if (bracketDepth === 0) {
          closed = true;
          break;
        }
      }
    }

    if (!closed) {
      this.diagnostics.push({
        code: ParserDiagnosticCode.ExpectedCloseBracket,
        message: "Expected ']' before the end of the inline-math expression.",
        span: this.current().span,
      });
    }

    const last: Token = tokens.at(-1) ?? prefix;
    return {
      kind: NodeKind.InlineMath,
      tokens,
      escaped: prefix.text === "@\\",
      closed,
      span: span(prefix.span.start, last.span.end),
    };
  }

  private isInlineMathPrefix(token: Token): boolean {
    return token.kind === TokenKind.Atom && (token.text === "@" || token.text === "@\\");
  }

  private isOnCurrentLine(followingIndex: number): boolean {
    for (let candidateIndex: number = this.index + 1; candidateIndex < followingIndex; candidateIndex += 1) {
      if (this.tokens[candidateIndex]?.kind === TokenKind.Newline) {
        return false;
      }
    }

    return true;
  }

  private parseUnexpectedToken(message: string): ErrorNode {
    const token: Token = this.current();
    const tokens: Token[] = token.kind === TokenKind.EndOfFile ? [] : [this.advance()];

    this.diagnostics.push({
      code: ParserDiagnosticCode.UnexpectedToken,
      message: `${message} Found ${token.kind} ${JSON.stringify(token.text)}.`,
      span: token.span,
    });

    return {
      kind: NodeKind.Error,
      tokens,
      span: token.span,
    };
  }
}

function lexerDiagnostics(result: LexResult): ParserDiagnostic[] {
  return result.diagnostics.map((diagnostic): ParserDiagnostic => ({
    code: ParserDiagnosticCode.LexerError,
    message: `${diagnostic.code}: ${diagnostic.message}`,
    span: diagnostic.span,
  }));
}

function emptyDocument(result: LexResult): Document {
  const eofToken: Token | undefined = result.tokens.at(-1);
  const position: Position = eofToken?.span.end ?? {
    offset: 0,
    line: 1,
    column: 1,
  };

  return {
    kind: NodeKind.Document,
    entries: [],
    span: span(position, position),
  };
}

export function parse(source: string): ParseResult {
  const lexResult: LexResult = tokenize(source);
  const diagnostics: ParserDiagnostic[] = lexerDiagnostics(lexResult);

  try {
    const parser = new Parser(lexResult.tokens);
    const document: Document = parser.parseDocument();
    diagnostics.push(...parser.diagnostics);
    return {
      document,
      diagnostics,
      hadBom: lexResult.hadBom,
    };
  } catch (error: unknown) {
    const eofToken: Token | undefined = lexResult.tokens.at(-1);
    const diagnosticSpan: Span =
      eofToken?.span ?? span({ offset: 0, line: 1, column: 1 }, { offset: 0, line: 1, column: 1 });
    diagnostics.push({
      code: ParserDiagnosticCode.InternalError,
      message: `The parser could not continue: ${error instanceof Error ? error.message : String(error)}`,
      span: diagnosticSpan,
    });
    return {
      document: emptyDocument(lexResult),
      diagnostics,
      hadBom: lexResult.hadBom,
    };
  }
}
