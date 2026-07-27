import type { Position, Span } from "../../src/syntax/position.js";

export const CwtConstructorName: {
  readonly Alias: "alias";
  readonly AliasMatchLeft: "alias_match_left";
  readonly AliasName: "alias_name";
  readonly ChainedEnum: ".enum";
  readonly Colour: "colour";
  readonly ComplexEnum: "complex_enum";
  readonly Enum: "enum";
  readonly Filepath: "filepath";
  readonly Float: "float";
  readonly Icon: "icon";
  readonly Int: "int";
  readonly IntValueField: "int_value_field";
  readonly Scope: "scope";
  readonly ScopeGroup: "scope_group";
  readonly SingleAlias: "single_alias";
  readonly SingleAliasRight: "single_alias_right";
  readonly StellarisNameFormat: "stellaris_name_format";
  readonly Subtype: "subtype";
  readonly Type: "type";
  readonly Value: "value";
  readonly ValueField: "value_field";
  readonly ValueSet: "value_set";
  readonly AliasKeysField: "alias_keys_field";
} = {
  Alias: "alias",
  AliasMatchLeft: "alias_match_left",
  AliasName: "alias_name",
  ChainedEnum: ".enum",
  Colour: "colour",
  ComplexEnum: "complex_enum",
  Enum: "enum",
  Filepath: "filepath",
  Float: "float",
  Icon: "icon",
  Int: "int",
  IntValueField: "int_value_field",
  Scope: "scope",
  ScopeGroup: "scope_group",
  SingleAlias: "single_alias",
  SingleAliasRight: "single_alias_right",
  StellarisNameFormat: "stellaris_name_format",
  Subtype: "subtype",
  Type: "type",
  Value: "value",
  ValueField: "value_field",
  ValueSet: "value_set",
  AliasKeysField: "alias_keys_field",
} as const;

export type CwtConstructorName = (typeof CwtConstructorName)[keyof typeof CwtConstructorName];

export const CwtRewriteKind: {
  readonly AngleReference: "angle-reference";
  readonly BracketAtom: "bracket-atom";
  readonly RecoveredBracketAtom: "recovered-bracket-atom";
} = {
  AngleReference: "angle-reference",
  BracketAtom: "bracket-atom",
  RecoveredBracketAtom: "recovered-bracket-atom",
} as const;

export type CwtRewriteKind = (typeof CwtRewriteKind)[keyof typeof CwtRewriteKind];

export const CwtPrepareDiagnosticCategory: {
  readonly Recovery: "recovery";
  readonly UnknownSyntax: "unknown-syntax";
} = {
  Recovery: "recovery",
  UnknownSyntax: "unknown-syntax",
} as const;

export type CwtPrepareDiagnosticCategory =
  (typeof CwtPrepareDiagnosticCategory)[keyof typeof CwtPrepareDiagnosticCategory];

export const CwtPrepareDiagnosticCode: {
  readonly InvalidAngleReference: "invalid-angle-reference";
  readonly InvalidConstructor: "invalid-constructor";
  readonly RecoveredMissingCloseBracket: "recovered-missing-close-bracket";
  readonly UnexpectedBracket: "unexpected-bracket";
  readonly UnknownConstructor: "unknown-constructor";
  readonly UnterminatedConstructor: "unterminated-constructor";
  readonly UnterminatedNativeBracket: "unterminated-native-bracket";
} = {
  InvalidAngleReference: "invalid-angle-reference",
  InvalidConstructor: "invalid-constructor",
  RecoveredMissingCloseBracket: "recovered-missing-close-bracket",
  UnexpectedBracket: "unexpected-bracket",
  UnknownConstructor: "unknown-constructor",
  UnterminatedConstructor: "unterminated-constructor",
  UnterminatedNativeBracket: "unterminated-native-bracket",
} as const;

export type CwtPrepareDiagnosticCode = (typeof CwtPrepareDiagnosticCode)[keyof typeof CwtPrepareDiagnosticCode];

export interface CwtRewrite {
  readonly kind: CwtRewriteKind;
  readonly span: Span;
  readonly originalText: string;
  readonly surrogateText: string;
}

export interface CwtPrepareDiagnostic {
  readonly category: CwtPrepareDiagnosticCategory;
  readonly code: CwtPrepareDiagnosticCode;
  readonly message: string;
  readonly span: Span;
}

export interface CwtPreparedSource {
  readonly path: string;
  readonly original: string;
  readonly parseSource: string;
  readonly rewrites: readonly CwtRewrite[];
  readonly diagnostics: readonly CwtPrepareDiagnostic[];
}

interface SourceLineIndex {
  readonly starts: readonly number[];
}

const CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set<string>(Object.values(CwtConstructorName));
const ANGLE_REFERENCE_PATTERN: RegExp = /^<[A-Za-z_][A-Za-z0-9_.-]*>/u;
const RECOVERABLE_MISSING_CLOSE_PATTERN: RegExp = /^(alias\[trigger:is_market_leader)([ \t]+)=[ \t]*bool[ \t]*$/u;
const SURROGATE_CHARACTER = "x";

function isLineBreak(character: string | undefined): boolean {
  return character === "\r" || character === "\n" || character === "\u2028" || character === "\u2029";
}

function makeSourceLineIndex(source: string): SourceLineIndex {
  const starts: number[] = [source.charCodeAt(0) === 0xfeff ? 1 : 0];
  let offset = starts[0] ?? 0;

  while (offset < source.length) {
    const character: string | undefined = source[offset];

    if (character === "\r") {
      offset += source[offset + 1] === "\n" ? 2 : 1;
      starts.push(offset);
      continue;
    }

    offset += 1;
    if (character === "\n" || character === "\u2028" || character === "\u2029") {
      starts.push(offset);
    }
  }

  return { starts };
}

function positionAt(index: SourceLineIndex, offset: number): Position {
  let lower = 0;
  let upper = index.starts.length - 1;
  let selected = -1;

  while (lower <= upper) {
    const middle: number = Math.floor((lower + upper) / 2);
    const candidate: number | undefined = index.starts[middle];

    if (candidate !== undefined && candidate <= offset) {
      selected = middle;
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }

  if (selected < 0) {
    return { offset, line: 1, column: 1 };
  }

  const lineStart: number = index.starts[selected] ?? 0;
  return {
    offset,
    line: selected + 1,
    column: offset - lineStart + 1,
  };
}

function makeSpan(index: SourceLineIndex, startOffset: number, endOffset: number): Span {
  return {
    start: positionAt(index, startOffset),
    end: positionAt(index, endOffset),
  };
}

function isConstructorBoundary(character: string | undefined): boolean {
  return (
    character === undefined ||
    /\s/u.test(character) ||
    character === '"' ||
    character === "#" ||
    character === "{" ||
    character === "}" ||
    character === "[" ||
    character === "]" ||
    character === "<" ||
    character === ">" ||
    character === "="
  );
}

function constructorPrefixStart(source: string, openBracketOffset: number): number {
  let offset = openBracketOffset - 1;

  while (offset >= 0 && !isConstructorBoundary(source[offset])) {
    offset -= 1;
  }

  return offset + 1;
}

function lineCodeEnd(source: string, fromOffset: number): number {
  let offset = fromOffset;

  while (offset < source.length) {
    const character: string | undefined = source[offset];
    if (character === "#" || isLineBreak(character)) {
      break;
    }
    offset += 1;
  }

  return offset;
}

function commentEnd(source: string, hashOffset: number): number {
  let offset = hashOffset + 1;

  while (offset < source.length && !isLineBreak(source[offset])) {
    offset += 1;
  }

  return offset;
}

function skipQuotedString(source: string, quoteOffset: number): number {
  let offset = quoteOffset + 1;

  while (offset < source.length) {
    const character: string | undefined = source[offset];

    if (character === "\\") {
      offset = Math.min(offset + 2, source.length);
      continue;
    }

    offset += 1;
    if (character === '"') {
      break;
    }
  }

  return offset;
}

function matchingCloseBracket(source: string, openBracketOffset: number): number | null {
  let depth = 1;
  let offset = openBracketOffset + 1;

  while (offset < source.length) {
    const character: string | undefined = source[offset];

    if (character === "#" || isLineBreak(character)) {
      return null;
    }

    if (character === '"') {
      offset = skipQuotedString(source, offset);
      continue;
    }

    if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        return offset;
      }
    }

    offset += 1;
  }

  return null;
}

function isInlineMathOpen(source: string, openBracketOffset: number): boolean {
  return (
    source[openBracketOffset - 1] === "@" ||
    (source[openBracketOffset - 1] === "\\" && source[openBracketOffset - 2] === "@")
  );
}

function recoverableMissingCloseEnd(source: string, prefixStart: number, codeEnd: number): number | null {
  const code: string = source.slice(prefixStart, codeEnd);
  const match: RegExpExecArray | null = RECOVERABLE_MISSING_CLOSE_PATTERN.exec(code);

  if (match === null) {
    return null;
  }

  const key: string | undefined = match[1];
  return key === undefined ? null : prefixStart + key.length;
}

function assertPreparedSourceInvariants(original: string, parseSource: string, rewrites: readonly CwtRewrite[]): void {
  if (parseSource.length !== original.length) {
    throw new Error("CWT preparation changed the UTF-16 source length.");
  }

  for (let offset = 0; offset < original.length; offset += 1) {
    if (isLineBreak(original[offset]) && parseSource[offset] !== original[offset]) {
      throw new Error(`CWT preparation changed a line break at UTF-16 offset ${String(offset)}.`);
    }
  }

  let previousEnd = 0;
  for (const rewrite of rewrites) {
    const startOffset: number = rewrite.span.start.offset;
    const endOffset: number = rewrite.span.end.offset;

    if (startOffset < previousEnd) {
      throw new Error("CWT preparation produced overlapping rewrites.");
    }
    if (rewrite.originalText.length !== rewrite.surrogateText.length) {
      throw new Error("A CWT rewrite changed the UTF-16 span length.");
    }
    if (original.slice(startOffset, endOffset) !== rewrite.originalText) {
      throw new Error("A CWT rewrite does not match its original source span.");
    }
    if (parseSource.slice(startOffset, endOffset) !== rewrite.surrogateText) {
      throw new Error("A CWT rewrite does not match its prepared source span.");
    }

    previousEnd = endOffset;
  }
}

export function prepareCwtSource(path: string, original: string): CwtPreparedSource {
  const lineIndex: SourceLineIndex = makeSourceLineIndex(original);
  const preparedCharacters: string[] = original.split("");
  const rewrites: CwtRewrite[] = [];
  const diagnostics: CwtPrepareDiagnostic[] = [];
  const nativeBracketOffsets: number[] = [];
  let nativeRootOffset: number | null = null;
  let offset = 0;

  const addDiagnostic = (
    category: CwtPrepareDiagnosticCategory,
    code: CwtPrepareDiagnosticCode,
    message: string,
    startOffset: number,
    endOffset: number,
  ): void => {
    diagnostics.push({
      category,
      code,
      message,
      span: makeSpan(lineIndex, startOffset, endOffset),
    });
  };

  const addRewrite = (kind: CwtRewriteKind, startOffset: number, endOffset: number): void => {
    const originalText: string = original.slice(startOffset, endOffset);

    if (/[\r\n\u2028\u2029]/u.test(originalText)) {
      throw new Error("CWT opaque lexemes must not cross a line break.");
    }

    const surrogateText: string = SURROGATE_CHARACTER.repeat(originalText.length);
    preparedCharacters.fill(SURROGATE_CHARACTER, startOffset, endOffset);
    rewrites.push({
      kind,
      span: makeSpan(lineIndex, startOffset, endOffset),
      originalText,
      surrogateText,
    });
  };

  const pushNativeBracket = (bracketOffset: number): void => {
    if (nativeBracketOffsets.length === 0) {
      nativeRootOffset = bracketOffset;
    }
    nativeBracketOffsets.push(bracketOffset);
  };

  while (offset < original.length) {
    const character: string | undefined = original[offset];

    if (character === "#") {
      offset = commentEnd(original, offset);
      continue;
    }

    if (character === '"') {
      offset = skipQuotedString(original, offset);
      continue;
    }

    if (character === "[") {
      if (original[offset + 1] === "[") {
        pushNativeBracket(offset);
        nativeBracketOffsets.push(offset + 1);
        offset += 2;
        continue;
      }

      const prefixStart: number = constructorPrefixStart(original, offset);
      const prefix: string = original.slice(prefixStart, offset);

      if (CONSTRUCTOR_NAMES.has(prefix)) {
        const closeBracketOffset: number | null = matchingCloseBracket(original, offset);

        if (closeBracketOffset !== null) {
          if (closeBracketOffset === offset + 1) {
            addDiagnostic(
              CwtPrepareDiagnosticCategory.UnknownSyntax,
              CwtPrepareDiagnosticCode.InvalidConstructor,
              `CWT constructor ${JSON.stringify(prefix)} has an empty bracket argument.`,
              prefixStart,
              closeBracketOffset + 1,
            );
          } else {
            addRewrite(CwtRewriteKind.BracketAtom, prefixStart, closeBracketOffset + 1);
          }
          offset = closeBracketOffset + 1;
          continue;
        }

        const codeEnd: number = lineCodeEnd(original, offset + 1);
        const recoveredEnd: number | null =
          prefix === CwtConstructorName.Alias ? recoverableMissingCloseEnd(original, prefixStart, codeEnd) : null;

        if (recoveredEnd !== null) {
          addRewrite(CwtRewriteKind.RecoveredBracketAtom, prefixStart, recoveredEnd);
          addDiagnostic(
            CwtPrepareDiagnosticCategory.Recovery,
            CwtPrepareDiagnosticCode.RecoveredMissingCloseBracket,
            "Recovered the known missing ']' in \"alias[trigger:is_market_leader\".",
            prefixStart,
            recoveredEnd,
          );
          offset = recoveredEnd;
          continue;
        }

        addDiagnostic(
          CwtPrepareDiagnosticCategory.UnknownSyntax,
          CwtPrepareDiagnosticCode.UnterminatedConstructor,
          `CWT constructor ${JSON.stringify(prefix)} is missing a closing ']'.`,
          prefixStart,
          codeEnd,
        );
        offset = codeEnd;
        continue;
      }

      if (isInlineMathOpen(original, offset)) {
        pushNativeBracket(offset);
        offset += 1;
        continue;
      }

      if (nativeBracketOffsets.length > 0) {
        nativeBracketOffsets.push(offset);
        offset += 1;
        continue;
      }

      const closeBracketOffset: number | null = matchingCloseBracket(original, offset);
      const unknownEnd: number =
        closeBracketOffset === null ? lineCodeEnd(original, offset + 1) : closeBracketOffset + 1;
      addDiagnostic(
        CwtPrepareDiagnosticCategory.UnknownSyntax,
        prefix.length === 0 ? CwtPrepareDiagnosticCode.UnexpectedBracket : CwtPrepareDiagnosticCode.UnknownConstructor,
        prefix.length === 0
          ? "Unexpected '[' outside an L0-native bracket form."
          : `Unknown CWT constructor ${JSON.stringify(prefix)}.`,
        prefix.length === 0 ? offset : prefixStart,
        unknownEnd,
      );
      offset = unknownEnd;
      continue;
    }

    if (character === "]") {
      if (nativeBracketOffsets.length > 0) {
        nativeBracketOffsets.pop();
        if (nativeBracketOffsets.length === 0) {
          nativeRootOffset = null;
        }
      } else {
        addDiagnostic(
          CwtPrepareDiagnosticCategory.UnknownSyntax,
          CwtPrepareDiagnosticCode.UnexpectedBracket,
          "Unexpected ']' outside an L0-native bracket form.",
          offset,
          offset + 1,
        );
      }
      offset += 1;
      continue;
    }

    if (character === "<" && original[offset + 1] !== "=") {
      const codeEnd: number = lineCodeEnd(original, offset + 1);
      const candidate: string = original.slice(offset, codeEnd);
      const referenceMatch: RegExpExecArray | null = ANGLE_REFERENCE_PATTERN.exec(candidate);

      if (referenceMatch !== null) {
        const reference: string | undefined = referenceMatch[0];
        if (reference !== undefined) {
          const referenceEnd: number = offset + reference.length;
          addRewrite(CwtRewriteKind.AngleReference, offset, referenceEnd);
          offset = referenceEnd;
          continue;
        }
      }

      const relativeCloseOffset: number = candidate.indexOf(">");
      if (relativeCloseOffset >= 0) {
        const invalidEnd: number = offset + relativeCloseOffset + 1;
        addDiagnostic(
          CwtPrepareDiagnosticCategory.UnknownSyntax,
          CwtPrepareDiagnosticCode.InvalidAngleReference,
          "Angle reference must match <[A-Za-z_][A-Za-z0-9_.-]*>.",
          offset,
          invalidEnd,
        );
        offset = invalidEnd;
        continue;
      }
    }

    offset += 1;
  }

  if (nativeBracketOffsets.length > 0 && nativeRootOffset !== null) {
    addDiagnostic(
      CwtPrepareDiagnosticCategory.UnknownSyntax,
      CwtPrepareDiagnosticCode.UnterminatedNativeBracket,
      "L0-native bracket form is missing a closing ']'.",
      nativeRootOffset,
      original.length,
    );
  }

  const parseSource: string = preparedCharacters.join("");
  assertPreparedSourceInvariants(original, parseSource, rewrites);

  return {
    path,
    original,
    parseSource,
    rewrites,
    diagnostics,
  };
}
