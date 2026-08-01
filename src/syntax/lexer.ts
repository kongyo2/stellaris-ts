import type { Position, Span } from "./position.js";
import { OPERATOR_WORDS, TokenKind } from "./token.js";
import type { Token, TokenKind as TokenKindType } from "./token.js";

export const LexerDiagnosticCode = {
  UnterminatedString: "unterminated-string",
  UnknownEscape: "unknown-escape",
  MissingByteOrderMark: "missing-byte-order-mark",
} as const;

export type LexerDiagnosticCode = (typeof LexerDiagnosticCode)[keyof typeof LexerDiagnosticCode];

/**
 * Whether the game would stop at this, or say so and read on.
 *
 * It warns about a file with no byte-order mark and about an unrecognised
 * escape, and reads the file either way — so a tool that treats those as
 * failures refuses input the game accepts. `interface/reference.txt` is the
 * case that showed it: one `\P` inside a Windows path, and 18 definitions
 * dropped out of a corpus that had been reading them.
 */
export type DiagnosticSeverity = "error" | "warning";

export interface LexerDiagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: LexerDiagnosticCode;
  readonly message: string;
  readonly span: Span;
}

export interface LexResult {
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly LexerDiagnostic[];
  readonly hadBom: boolean;
}

export interface LexOptions {
  /**
   * Report a file that carries no byte-order mark.
   *
   * The game says `File '%s' should be in utf8-bom encoding (will try to use it
   * anyways)` and then reads it, so this is a warning about the file rather
   * than about the script inside it. Off by default: nothing that reads a
   * fragment rather than a file wants it.
   */
  readonly requireByteOrderMark?: boolean;
  /**
   * Read `==` as one token, which only `.cwt` needs.
   *
   * Off for script, because the game has no such operator and pretending
   * otherwise hides the bug rather than reporting it. The cwt importer turns it
   * on because cwtools' schema language does use `==`.
   */
  readonly equalsEquals?: boolean;
}

/**
 * The twelve characters that end a bare token, and nothing else.
 *
 * Both of the game's dispatch tables — the one that classifies a token's first
 * character (RVA 0x1d35bd0) and the one that ends an accumulating bare token
 * (0x1d35c38) — send exactly these twelve away from the default case, over the
 * range `!`..`}`. Characters outside that range never reach either table, so
 * `~`, every byte of a UTF-8 sequence and every control character that is not
 * whitespace all stay inside the token.
 */
const DELIMITERS: ReadonlySet<string> = new Set(["!", '"', "#", "(", ")", ",", ";", "<", "=", ">", "{", "}"]);

/**
 * C's `isspace`, which is what the game calls.
 *
 * Not Unicode whitespace: the lexer walks bytes, and a non-breaking space is
 * 0xc2 0xa0 — two ordinary bare-token characters as far as it is concerned.
 * Treating one as a separator here would split an identifier the game keeps
 * whole.
 */
function isWhitespace(character: string): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\v" ||
    character === "\f" ||
    character === "\r"
  );
}

function isLineBreak(character: string): boolean {
  return character === "\r" || character === "\n";
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

/**
 * How the game decides a bare token is a number.
 *
 * A first character of a digit or `-` settles it on the spot — the token is
 * number-like whatever follows, which is why `--`, `1-2` and `1.2.3` are all
 * number-like. Anything else is looked up as a keyword first, and only a token
 * the registry does not know is scanned: made of digits, `-` and `.` alone it
 * is a number, and otherwise a string. So `.5` *is* number-like — its first
 * character is not a digit, but every character passes the scan — while `+1` is
 * not, because `+` fails it.
 */
export function isNumberLikeAtom(text: string): boolean {
  const first: string | undefined = text[0];

  if (first === undefined) {
    return false;
  }

  if (isDigit(first) || first === "-") {
    return true;
  }

  for (const character of text) {
    if (!isDigit(character) && character !== "-" && character !== ".") {
      return false;
    }
  }

  return true;
}

/**
 * The kind a bare token settles on.
 *
 * The keyword lookup happens before the numeric scan and folds ASCII case, so
 * `GREATER_THAN` is the same token as `>`. Only the six operator words change
 * a token's kind here; the other 9,886 built-ins are still atoms, because what
 * they mean depends on where they were written and this is the wrong layer to
 * decide that.
 */
function atomKind(text: string): TokenKindType {
  const first: string | undefined = text[0];

  if (first !== undefined && (isDigit(first) || first === "-")) {
    return TokenKind.Atom;
  }

  return OPERATOR_WORDS.get(text.toLowerCase()) ?? TokenKind.Atom;
}

export function tokenize(source: string, options: LexOptions = {}): LexResult {
  const tokens: Token[] = [];
  const diagnostics: LexerDiagnostic[] = [];
  const hadBom: boolean = source.charCodeAt(0) === 0xfeff;
  let offset: number = hadBom ? 1 : 0;
  let line = 1;
  let column = 1;

  const currentPosition = (): Position => ({ offset, line, column });

  const advance = (): void => {
    const character: string | undefined = source[offset];

    if (character === undefined) {
      return;
    }

    if (character === "\r") {
      offset += 1;
      if (source[offset] === "\n") {
        offset += 1;
      }
      line += 1;
      column = 1;
      return;
    }

    offset += 1;
    if (character === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  };

  const emit = (kind: TokenKindType, start: Position): Token => {
    const token: Token = {
      kind,
      text: source.slice(start.offset, offset),
      span: {
        start,
        end: currentPosition(),
      },
    };
    tokens.push(token);
    return token;
  };

  const isAtomBoundary = (at: number): boolean => {
    const character: string | undefined = source[at];
    return character === undefined || isWhitespace(character) || DELIMITERS.has(character);
  };

  if (options.requireByteOrderMark === true && !hadBom) {
    const origin: Position = { offset: 0, line: 1, column: 1 };
    diagnostics.push({
      severity: "warning",
      code: LexerDiagnosticCode.MissingByteOrderMark,
      message: "File should be in utf8-bom encoding (the game reads it anyway).",
      span: { start: origin, end: origin },
    });
  }

  while (offset < source.length) {
    const start: Position = currentPosition();
    const character: string | undefined = source[offset];

    if (character === undefined) {
      break;
    }

    if (isLineBreak(character)) {
      advance();
      emit(TokenKind.Newline, start);
      continue;
    }

    if (isWhitespace(character)) {
      while (offset < source.length) {
        const whitespaceCharacter: string | undefined = source[offset];
        if (
          whitespaceCharacter === undefined ||
          !isWhitespace(whitespaceCharacter) ||
          isLineBreak(whitespaceCharacter)
        ) {
          break;
        }
        advance();
      }
      emit(TokenKind.Whitespace, start);
      continue;
    }

    // `;` is a line comment exactly as `#` is: both characters index the same
    // entry of the game's dispatch table and both run to the next line feed.
    // A mod that ends a statement the way C does loses the rest of that line,
    // silently, and nothing but this says so.
    if (character === "#" || character === ";") {
      while (offset < source.length) {
        const commentCharacter: string | undefined = source[offset];
        if (commentCharacter === undefined || isLineBreak(commentCharacter)) {
          break;
        }
        advance();
      }
      emit(TokenKind.Comment, start);
      continue;
    }

    if (character === '"') {
      advance();
      let terminated = false;

      while (offset < source.length) {
        const stringCharacter: string | undefined = source[offset];

        // Only `\"` and `\\` are escapes. The game warns about any other `\x`
        // and keeps both characters, so a backslash before an ordinary letter
        // does not consume it and cannot swallow a closing quote.
        if (stringCharacter === "\\") {
          const next: string | undefined = source[offset + 1];

          if (next === '"' || next === "\\") {
            advance();
            advance();
            continue;
          }

          const escapeStart: Position = currentPosition();
          advance();
          diagnostics.push({
            severity: "warning",
            code: LexerDiagnosticCode.UnknownEscape,
            message: `Unknown escape sequence \\${next ?? ""}; the game keeps both characters.`,
            span: { start: escapeStart, end: currentPosition() },
          });
          continue;
        }

        advance();
        if (stringCharacter === '"') {
          terminated = true;
          break;
        }
      }

      const token: Token = emit(TokenKind.QuotedString, start);
      if (!terminated) {
        diagnostics.push({
          severity: "error",
          code: LexerDiagnosticCode.UnterminatedString,
          message: "Quoted string is not terminated before the end of the file.",
          span: token.span,
        });
      }
      continue;
    }

    if (character === "{") {
      advance();
      emit(TokenKind.OpenBrace, start);
      continue;
    }

    if (character === "}") {
      advance();
      emit(TokenKind.CloseBrace, start);
      continue;
    }

    if (character === "(") {
      advance();
      emit(TokenKind.OpenParen, start);
      continue;
    }

    if (character === ")") {
      advance();
      emit(TokenKind.CloseParen, start);
      continue;
    }

    if (character === ",") {
      advance();
      emit(TokenKind.Comma, start);
      continue;
    }

    // No `==` unless asked for: the game folds a following `=` after `>`, `<`
    // and `!` and after nothing else, so two `=` in a row are two tokens and
    // the second is read as the value.
    if (character === "=") {
      advance();
      if (options.equalsEquals === true && source[offset] === "=") {
        advance();
        emit(TokenKind.EqualEqual, start);
      } else {
        emit(TokenKind.Equals, start);
      }
      continue;
    }

    if (character === "!") {
      advance();
      if (source[offset] === "=") {
        advance();
        emit(TokenKind.NotEqual, start);
      } else {
        emit(TokenKind.Bang, start);
      }
      continue;
    }

    if (character === ">") {
      advance();
      if (source[offset] === "=") {
        advance();
        emit(TokenKind.GreaterThanOrEqual, start);
      } else {
        emit(TokenKind.GreaterThan, start);
      }
      continue;
    }

    if (character === "<") {
      advance();
      if (source[offset] === "=") {
        advance();
        emit(TokenKind.LessThanOrEqual, start);
      } else {
        emit(TokenKind.LessThan, start);
      }
      continue;
    }

    do {
      advance();
    } while (offset < source.length && !isAtomBoundary(offset));
    emit(atomKind(source.slice(start.offset, offset)), start);
  }

  const end: Position = currentPosition();
  tokens.push({
    kind: TokenKind.EndOfFile,
    text: "",
    span: {
      start: end,
      end,
    },
  });

  return {
    tokens,
    diagnostics,
    hadBom,
  };
}

/**
 * The characters of a quoted string, with the two escapes resolved.
 *
 * `"a\"b"` holds `a"b` and `"a\nb"` holds `a\nb`, backslash included — the
 * game removes a backslash only before a quote or another backslash. Callers
 * that re-print script want {@link Token.text}; callers that compare a value
 * against an identifier want this.
 */
export function quotedStringValue(raw: string): string {
  const body: string = raw.endsWith('"') && raw.length >= 2 ? raw.slice(1, -1) : raw.slice(1);
  let value = "";

  for (let index = 0; index < body.length; index += 1) {
    const character: string | undefined = body[index];

    if (character === "\\") {
      const next: string | undefined = body[index + 1];

      if (next === '"' || next === "\\") {
        value += next;
        index += 1;
        continue;
      }
    }

    value += character ?? "";
  }

  return value;
}
