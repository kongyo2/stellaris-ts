import type { Position, Span } from "./position.js";
import { TokenKind } from "./token.js";
import type { Token, TokenKind as TokenKindType } from "./token.js";

export const LexerDiagnosticCode = {
  UnexpectedCharacter: "unexpected-character",
  UnterminatedString: "unterminated-string",
} as const;

export type LexerDiagnosticCode = (typeof LexerDiagnosticCode)[keyof typeof LexerDiagnosticCode];

export interface LexerDiagnostic {
  readonly code: LexerDiagnosticCode;
  readonly message: string;
  readonly span: Span;
}

export interface LexResult {
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly LexerDiagnostic[];
  readonly hadBom: boolean;
}

function isHorizontalWhitespace(character: string): boolean {
  const code: number = character.charCodeAt(0);
  return (
    character === " " ||
    character === "\t" ||
    character === "\v" ||
    character === "\f" ||
    code === 0x00a0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

function isLineBreak(character: string): boolean {
  return character === "\r" || character === "\n" || character === "\u2028" || character === "\u2029";
}

function isUnexpectedControl(character: string): boolean {
  const code: number = character.charCodeAt(0);
  return (
    (code < 0x20 && character !== "\t" && character !== "\v" && character !== "\f") || (code >= 0x7f && code <= 0x9f)
  );
}

export function tokenize(source: string): LexResult {
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
    if (character === "\n" || character === "\u2028" || character === "\u2029") {
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

    if (
      character === undefined ||
      isHorizontalWhitespace(character) ||
      isLineBreak(character) ||
      isUnexpectedControl(character)
    ) {
      return true;
    }

    if (
      character === '"' ||
      character === "#" ||
      character === "{" ||
      character === "}" ||
      character === "[" ||
      character === "]" ||
      character === "=" ||
      character === "<" ||
      character === ">"
    ) {
      return true;
    }

    return character === "!" && source[at + 1] === "=";
  };

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

    if (isHorizontalWhitespace(character)) {
      while (offset < source.length) {
        const whitespaceCharacter: string | undefined = source[offset];
        if (whitespaceCharacter === undefined || !isHorizontalWhitespace(whitespaceCharacter)) {
          break;
        }
        advance();
      }
      emit(TokenKind.Whitespace, start);
      continue;
    }

    if (character === "#") {
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

        if (stringCharacter === "\\") {
          advance();
          advance();
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

    if (character === "[") {
      advance();
      emit(TokenKind.OpenBracket, start);
      continue;
    }

    if (character === "]") {
      advance();
      emit(TokenKind.CloseBracket, start);
      continue;
    }

    if (character === "=") {
      advance();
      if (source[offset] === "=") {
        advance();
        emit(TokenKind.EqualEqual, start);
      } else {
        emit(TokenKind.Equals, start);
      }
      continue;
    }

    if (character === "!" && source[offset + 1] === "=") {
      advance();
      advance();
      emit(TokenKind.NotEqual, start);
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

    if (isUnexpectedControl(character)) {
      advance();
      const token: Token = emit(TokenKind.Unknown, start);
      diagnostics.push({
        code: LexerDiagnosticCode.UnexpectedCharacter,
        message: `Unexpected control character U+${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}.`,
        span: token.span,
      });
      continue;
    }

    do {
      advance();
    } while (offset < source.length && !isAtomBoundary(offset));
    emit(TokenKind.Atom, start);
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
