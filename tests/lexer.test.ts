import { describe, expect, it } from "vitest";

import { isTriviaToken, LexerDiagnosticCode, tokenize, TokenKind } from "../src/syntax/index.js";

describe("tokenize", () => {
  it("discards an initial BOM and tracks CRLF positions", () => {
    const source = '\uFEFFkey = "value"\r\n# comment\r\nnext >= 1';
    const result = tokenize(source);
    const significantTokens = result.tokens.filter((token) => !isTriviaToken(token));
    const newlineTokens = result.tokens.filter((token) => token.kind === TokenKind.Newline);

    expect(result.hadBom).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(significantTokens.map((token) => [token.kind, token.text])).toEqual([
      [TokenKind.Atom, "key"],
      [TokenKind.Equals, "="],
      [TokenKind.QuotedString, '"value"'],
      [TokenKind.Atom, "next"],
      [TokenKind.GreaterThanOrEqual, ">="],
      [TokenKind.Atom, "1"],
      [TokenKind.EndOfFile, ""],
    ]);
    expect(significantTokens[0]?.span.start).toEqual({ offset: 1, line: 1, column: 1 });
    expect(significantTokens[3]?.span.start).toEqual({ offset: 27, line: 3, column: 1 });
    expect(newlineTokens.map((token) => token.text)).toEqual(["\r\n", "\r\n"]);
    expect(result.tokens.some((token) => token.text.includes("\uFEFF"))).toBe(false);
  });

  it("preserves optional-block and escaped inline-math punctuation losslessly", () => {
    const source = String.raw`[[!PARAM] value = @\[( 72 * $PROGRESS$ )] ]`;
    const result = tokenize(source);
    const atomTexts = result.tokens.filter((token) => token.kind === TokenKind.Atom).map((token) => token.text);

    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.some((token) => token.kind === TokenKind.Unknown)).toBe(false);
    expect(result.tokens.map((token) => token.text).join("")).toBe(source);
    expect(atomTexts).toContain("!PARAM");
    expect(atomTexts).toContain("@\\");
    expect(atomTexts).toContain("$PROGRESS$");
  });

  it("reports unexpected control characters without throwing", () => {
    const result = tokenize("key\u0000value");
    const unknownToken = result.tokens.find((token) => token.kind === TokenKind.Unknown);

    expect(unknownToken?.text).toBe("\u0000");
    expect(unknownToken?.span.start).toEqual({ offset: 3, line: 1, column: 4 });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe(LexerDiagnosticCode.UnexpectedCharacter);
  });
});
