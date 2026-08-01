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
import { quotedStringValue, tokenize } from "./lexer.js";
import type { DiagnosticSeverity, LexOptions, LexResult } from "./lexer.js";
import type { Position, Span } from "./position.js";
import { isReaderOperator, isTriviaToken, TokenKind } from "./token.js";
import type { Token } from "./token.js";

export const ParserDiagnosticCode = {
  LexerError: "lexer-error",
  UnexpectedRootValue: "unexpected-root-value",
  UnexpectedToken: "unexpected-token",
  ExpectedValue: "expected-value",
  ExpectedCloseBrace: "expected-close-brace",
  ExpectedCloseBracket: "expected-close-bracket",
  ExpectedOptionalHeader: "expected-optional-header",
  InvalidVariableName: "invalid-variable-name",
  InternalError: "internal-error",
} as const;

export type ParserDiagnosticCode = (typeof ParserDiagnosticCode)[keyof typeof ParserDiagnosticCode];

export interface ParserDiagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: ParserDiagnosticCode;
  readonly message: string;
  readonly span: Span;
}

export interface ParseResult {
  readonly document: Document;
  readonly diagnostics: readonly ParserDiagnostic[];
  /**
   * The subset that says the script is wrong.
   *
   * Callers deciding whether to use the document want this rather than
   * `diagnostics`, which also carries what the game merely warns about and
   * then reads anyway.
   */
  readonly errors: readonly ParserDiagnostic[];
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
  return token.kind === TokenKind.Atom || token.kind === TokenKind.QuotedString || isPunctuationToken(token);
}

/**
 * A character the lexer tokenises but the reader has no rule for.
 *
 * `(`, `)`, `,` and a lone `!` each get their own token id and then fall
 * through the reader's key/operator/value dispatch, which means a script may
 * write them where a word would go and the game reads them as that word. They
 * are scalars here for the same reason.
 */
function isPunctuationToken(token: Token): boolean {
  return (
    token.kind === TokenKind.OpenParen ||
    token.kind === TokenKind.CloseParen ||
    token.kind === TokenKind.Comma ||
    token.kind === TokenKind.Bang
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

/**
 * Whether this token opens `@[ … ]`.
 *
 * Both spellings start an atom: `@[` when a space follows the bracket, and the
 * whole expression when it does not. `@\[` is the same construct written
 * inside an inline script, where a bare `@` would be substituted too early.
 */
function isInlineMathOpening(token: Token): boolean {
  return token.kind === TokenKind.Atom && (token.text.startsWith("@[") || token.text.startsWith("@\\["));
}

function isOptionalBlockOpening(token: Token): boolean {
  return token.kind === TokenKind.Atom && token.text.startsWith("[[");
}

/**
 * The names `@name = value` will accept.
 *
 * The game checks each character as it registers the variable: a letter first,
 * then letters, digits and `_`. A name that fails gets a diagnostic and the
 * declaration is dropped, so every later `@name` silently stays the literal
 * text `@name` — there is no second complaint. All 3,480 declarations in
 * vanilla and all 3,608 across the twenty workshop mods pass it.
 */
const VARIABLE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/u;

/**
 * Whether a declaration's name can be judged yet.
 *
 * Inside `common/inline_scripts` a name is often half parameter —
 * `@bio_ship_armor_$SIZE$_$TIER$` — and only becomes a real name once the
 * script is expanded. Nothing here knows what it will expand to.
 */
function isCheckableVariableName(name: string): boolean {
  return !name.includes("$");
}

/**
 * The parameter an optional block tests, without its brackets or negation.
 *
 * `[[POP_GROUP]` and `[[ !POP_GROUP ]` both name `POP_GROUP`; the second one
 * arrives as three tokens because `!` ends a bare token.
 */
export function optionalBlockParameter(header: readonly Token[]): string {
  const text: string = header
    .filter((token) => token.kind !== TokenKind.Comment)
    .map((token) => token.text)
    .join("");
  const withoutBrackets: string = text.replace(/^\[\[/u, "").replace(/\]\s*$/u, "");
  return withoutBrackets.replace(/^\s*!/u, "").trim();
}

/** Whether an optional block applies when its parameter is *not* set. */
export function isOptionalBlockNegated(header: readonly Token[]): boolean {
  const text: string = header
    .filter((token) => token.kind !== TokenKind.Comment)
    .map((token) => token.text)
    .join("");
  return /^\[\[\s*!/u.test(text);
}

function scalarValue(token: Token): Pick<Scalar, "raw" | "scalarKind" | "value"> {
  const raw: string = token.text;

  if (token.kind === TokenKind.QuotedString) {
    return {
      raw,
      // The two escapes are resolved: `"a\"b"` is the three characters `a"b`,
      // and comparing the raw text against an identifier would not match.
      scalarKind: ScalarKind.QuotedString,
      value: quotedStringValue(raw),
    };
  }

  if (isPunctuationToken(token)) {
    return {
      raw,
      scalarKind: ScalarKind.Punctuation,
      value: raw,
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

    if (isOptionalBlockOpening(token)) {
      return this.parseOptionalBlock();
    }

    if (isScalarToken(token)) {
      if (isInlineMathOpening(token)) {
        return this.parseInlineMath();
      }

      const following: SignificantToken = this.nextSignificant();

      if (isReaderOperator(following.token.kind)) {
        return this.parseAssignment();
      }

      if (allowUnkeyed && following.token.kind === TokenKind.OpenBrace && this.isOnCurrentLine(following.index)) {
        return this.parsePrefixedBlock();
      }

      if (allowUnkeyed) {
        return this.parseScalar();
      }

      this.diagnostics.push({
        severity: "error",
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
    this.checkVariableDeclaration(key);
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

    if (isOptionalBlockOpening(token)) {
      return this.parseOptionalBlock();
    }

    if (token.kind === TokenKind.OpenBrace) {
      return this.parseBlock();
    }

    if (isScalarToken(token)) {
      if (isInlineMathOpening(token)) {
        return this.parseInlineMath();
      }

      const following: SignificantToken = this.nextSignificant();

      if (following.token.kind === TokenKind.OpenBrace && this.isOnCurrentLine(following.index)) {
        return this.parsePrefixedBlock();
      }

      return this.parseScalar();
    }

    if (token.kind === TokenKind.EndOfFile || token.kind === TokenKind.CloseBrace) {
      this.diagnostics.push({
        severity: "error",
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
      severity: "error",
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

  /**
   * `[[PARAM] … ]`.
   *
   * The header runs to the first token whose text carries the `]` that closes
   * it, which is the opening token itself when the parameter was written tight
   * against the brackets — `[[POP_GROUP]` is one atom — and three tokens when a
   * `!` split it, because `!` is a delimiter and `[` is not. The body then runs
   * to a `]` standing alone.
   */
  private parseOptionalBlock(): OptionalBlock {
    const opening: Token = this.advance();
    const header: Token[] = [opening];
    let headerClosed: boolean = opening.text.includes("]");

    while (!headerClosed && this.current().kind !== TokenKind.EndOfFile) {
      const token: Token = this.advance();
      header.push(token);
      headerClosed = token.kind !== TokenKind.Comment && token.text.includes("]");
    }

    if (optionalBlockParameter(header).length === 0) {
      this.diagnostics.push({
        severity: "error",
        code: ParserDiagnosticCode.ExpectedOptionalHeader,
        message: "Expected an optional-block parameter name.",
        span: opening.span,
      });
    }

    if (!headerClosed) {
      this.diagnostics.push({
        severity: "error",
        code: ParserDiagnosticCode.ExpectedCloseBracket,
        message: "Expected ']' after the optional-block header.",
        span: this.current().span,
      });
      return {
        kind: NodeKind.OptionalBlock,
        header,
        entries: [],
        closed: false,
        span: span(opening.span.start, this.current().span.end),
      };
    }

    const entries: EntryNode[] = [];

    while (!this.isOptionalBlockClosing() && this.current().kind !== TokenKind.EndOfFile) {
      entries.push(this.parseEntry(true));
    }

    if (this.isOptionalBlockClosing()) {
      const closingBracket: Token = this.advance();
      return {
        kind: NodeKind.OptionalBlock,
        header,
        entries,
        closed: true,
        span: span(opening.span.start, closingBracket.span.end),
      };
    }

    this.diagnostics.push({
      severity: "error",
      code: ParserDiagnosticCode.ExpectedCloseBracket,
      message: "Expected ']' before the end of the optional block.",
      span: this.current().span,
    });
    return {
      kind: NodeKind.OptionalBlock,
      header,
      entries,
      closed: false,
      span: span(opening.span.start, this.current().span.end),
    };
  }

  /**
   * Reports `@name = value` whose name the game would refuse to register.
   *
   * Worth reporting because the failure is silent afterwards: the game says so
   * once, at the declaration, and then every use of that variable reads as the
   * literal text `@name` — a value no rule matches and no later message
   * mentions.
   */
  private checkVariableDeclaration(key: Scalar): void {
    if (key.scalarKind !== ScalarKind.ScriptVariable || key.raw.startsWith("@[") || key.raw.startsWith("@\\[")) {
      return;
    }

    const name: string = key.raw.slice(1);

    if (!isCheckableVariableName(name) || VARIABLE_NAME.test(name)) {
      return;
    }

    this.diagnostics.push({
      severity: "error",
      code: ParserDiagnosticCode.InvalidVariableName,
      message:
        `${JSON.stringify(key.raw)} is not a name the game will register: ` +
        "a variable starts with a letter and continues with letters, digits or '_'.",
      span: key.span,
    });
  }

  private isOptionalBlockClosing(): boolean {
    const token: Token = this.current();
    return token.kind === TokenKind.Atom && token.text === "]";
  }

  /**
   * `@[ base * 2 ]`, `@[-effect_mult]`, `@\[( 72 * $PROGRESS$ )]`.
   *
   * The expression ends at the first token carrying a `]`, matching the game,
   * which searches its own token text for one rather than counting brackets.
   * A tight spelling is a single atom that both opens and closes here.
   */
  private parseInlineMath(): InlineMath {
    const opening: Token = this.advance();
    const tokens: Token[] = [opening];
    let closed: boolean = opening.text.includes("]", opening.text.startsWith("@\\[") ? 3 : 2);

    while (!closed && this.current().kind !== TokenKind.EndOfFile) {
      const token: Token = this.advance();
      tokens.push(token);
      closed = token.kind !== TokenKind.Comment && token.text.includes("]");
    }

    if (!closed) {
      this.diagnostics.push({
        severity: "error",
        code: ParserDiagnosticCode.ExpectedCloseBracket,
        message: "Expected ']' before the end of the inline-math expression.",
        span: this.current().span,
      });
    }

    const last: Token = tokens.at(-1) ?? opening;
    return {
      kind: NodeKind.InlineMath,
      tokens,
      escaped: opening.text.startsWith("@\\["),
      closed,
      span: span(opening.span.start, last.span.end),
    };
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
      severity: "error",
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
    severity: diagnostic.severity,
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

export function parse(source: string, options: LexOptions = {}): ParseResult {
  const lexResult: LexResult = tokenize(source, options);
  const diagnostics: ParserDiagnostic[] = lexerDiagnostics(lexResult);

  try {
    const parser = new Parser(lexResult.tokens);
    const document: Document = parser.parseDocument();
    diagnostics.push(...parser.diagnostics);
    return {
      document,
      diagnostics,
      errors: diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
      hadBom: lexResult.hadBom,
    };
  } catch (error: unknown) {
    const eofToken: Token | undefined = lexResult.tokens.at(-1);
    const diagnosticSpan: Span =
      eofToken?.span ?? span({ offset: 0, line: 1, column: 1 }, { offset: 0, line: 1, column: 1 });
    diagnostics.push({
      severity: "error",
      code: ParserDiagnosticCode.InternalError,
      message: `The parser could not continue: ${error instanceof Error ? error.message : String(error)}`,
      span: diagnosticSpan,
    });
    return {
      document: emptyDocument(lexResult),
      diagnostics,
      errors: diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
      hadBom: lexResult.hadBom,
    };
  }
}
