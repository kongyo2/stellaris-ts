import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { TextDecoder } from "node:util";

import { parse, tokenize, TokenKind } from "../src/syntax/index.js";
import { roundtripExclusions } from "../tests/roundtrip-exclusions.js";

const DEFAULT_GAME_PATH: string = String.raw`D:\steam\steamapps\common\Stellaris`;
const CORPUS_ROOTS: readonly string[] = ["common", "events", "prescripted_countries", "map"];

interface UnknownTokenLocation {
  readonly path: string;
  readonly offset: number;
  readonly line: number;
  readonly column: number;
  readonly text: string;
}

interface VerificationIssue {
  readonly path: string;
  readonly offset: number;
  readonly line: number;
  readonly column: number;
  readonly category: "coverage" | "diagnostic";
  readonly message: string;
}

interface ParseDiagnosticLocation {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly code: string;
  readonly message: string;
}

interface ExclusionIssue {
  readonly path: string;
  readonly message: string;
}

function compareOrdinal(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function toPortablePath(path: string): string {
  return path.replaceAll("\\", "/");
}

async function collectTextFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareOrdinal(left.name, right.name));

  const fileGroups: string[][] = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const entryPath: string = join(directory, entry.name);

      if (entry.isDirectory()) {
        return collectTextFiles(entryPath);
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith(".txt")) {
        return [entryPath];
      }

      return [];
    }),
  );

  return fileGroups.flat();
}

function formatUnknown(location: UnknownTokenLocation): string {
  return (
    `UNKNOWN ${location.path}:${String(location.line)}:${String(location.column)}` +
    ` offset=${String(location.offset)} text=${JSON.stringify(location.text)}`
  );
}

function formatIssue(issue: VerificationIssue): string {
  return (
    `${issue.category.toUpperCase()} ${issue.path}:${String(issue.line)}:${String(issue.column)}` +
    ` offset=${String(issue.offset)} ${issue.message}`
  );
}

function formatParseDiagnostic(diagnostic: ParseDiagnosticLocation): string {
  return (
    `DIAGNOSTIC ${diagnostic.path}:${String(diagnostic.line)}:${String(diagnostic.column)}` +
    ` ${diagnostic.code}: ${diagnostic.message}`
  );
}

function formatExclusionIssue(issue: ExclusionIssue): string {
  return `EXCLUSION ${issue.path} ${issue.message}`;
}

function isPathUnderCorpusRoot(path: string): boolean {
  const segments: readonly string[] = path.split("/");
  const root: string | undefined = segments[0];

  return (
    segments.length >= 2 &&
    root !== undefined &&
    CORPUS_ROOTS.includes(root) &&
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
}

function isOneLineEnglishReason(reason: string): boolean {
  const trimmedReason: string = reason.trim();

  if (trimmedReason.length === 0 || reason.includes("\r") || reason.includes("\n") || !/[A-Za-z]/u.test(reason)) {
    return false;
  }

  for (const character of reason) {
    const characterCode: number = character.charCodeAt(0);
    if (characterCode < 0x20 || characterCode > 0x7e) {
      return false;
    }
  }

  return true;
}

async function verifyParseOnly(gamePath: string, files: readonly string[]): Promise<void> {
  const collectedPaths: ReadonlySet<string> = new Set(
    files.map((filePath): string => toPortablePath(relative(gamePath, filePath))),
  );
  const exclusionPaths = new Set<string>();
  const exclusionIssues: ExclusionIssue[] = [];

  if (roundtripExclusions.length > 15) {
    exclusionIssues.push({
      path: "<exclusions>",
      message: `exclusion count ${String(roundtripExclusions.length)} exceeds the maximum of 15.`,
    });
  }

  for (const exclusion of roundtripExclusions) {
    const exclusionPath: string = toPortablePath(exclusion.path);

    if (exclusionPaths.has(exclusionPath)) {
      exclusionIssues.push({
        path: exclusionPath,
        message: "duplicate exclusion path.",
      });
    } else {
      exclusionPaths.add(exclusionPath);
    }

    if (!isPathUnderCorpusRoot(exclusionPath)) {
      exclusionIssues.push({
        path: exclusionPath,
        message: `path must be under one of: ${CORPUS_ROOTS.join(", ")}.`,
      });
    }

    if (!collectedPaths.has(exclusionPath)) {
      exclusionIssues.push({
        path: exclusionPath,
        message: "path does not name an existing collected corpus file.",
      });
    }

    if (!isOneLineEnglishReason(exclusion.reason)) {
      exclusionIssues.push({
        path: exclusionPath,
        message: "reason must be nonempty, one-line, printable English text.",
      });
    }
  }

  exclusionIssues.sort(
    (left, right) => compareOrdinal(left.path, right.path) || compareOrdinal(left.message, right.message),
  );

  if (roundtripExclusions.length > 15) {
    for (const issue of exclusionIssues) {
      console.error(formatExclusionIssue(issue));
    }

    console.log(
      [
        "SUMMARY mode=parse-only",
        `files=${String(files.length)}`,
        "success=0",
        `excluded=${String([...exclusionPaths].filter((path) => collectedPaths.has(path)).length)}`,
        "failed=0",
        "diagnostics=0",
        `exclusionIssues=${String(exclusionIssues.length)}`,
      ].join(" "),
    );
    process.exitCode = 1;
    return;
  }

  const filesToParse: readonly string[] = files.filter(
    (filePath) => !exclusionPaths.has(toPortablePath(relative(gamePath, filePath))),
  );
  const parseDiagnostics: ParseDiagnosticLocation[] = [];
  let successCount = 0;
  let failedCount = 0;
  let nextFileIndex = 0;

  const processNextFile = async (): Promise<void> => {
    const filePath: string | undefined = filesToParse[nextFileIndex];
    nextFileIndex += 1;

    if (filePath === undefined) {
      return;
    }

    const displayPath: string = toPortablePath(relative(gamePath, filePath));
    const bytes: Buffer = await readFile(filePath);
    const source: string = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const result = parse(source);

    if (result.diagnostics.length === 0) {
      successCount += 1;
    } else {
      failedCount += 1;
    }

    for (const diagnostic of result.diagnostics) {
      parseDiagnostics.push({
        path: displayPath,
        line: diagnostic.span.start.line,
        column: diagnostic.span.start.column,
        code: diagnostic.code,
        message: diagnostic.message,
      });
    }

    await processNextFile();
  };

  await Promise.all(Array.from({ length: 8 }, processNextFile));

  parseDiagnostics.sort(
    (left, right) =>
      compareOrdinal(left.path, right.path) ||
      left.line - right.line ||
      left.column - right.column ||
      compareOrdinal(left.code, right.code) ||
      compareOrdinal(left.message, right.message),
  );

  for (const issue of exclusionIssues) {
    console.error(formatExclusionIssue(issue));
  }

  for (const diagnostic of parseDiagnostics) {
    console.error(formatParseDiagnostic(diagnostic));
  }

  console.log(
    [
      "SUMMARY mode=parse-only",
      `files=${String(files.length)}`,
      `success=${String(successCount)}`,
      `excluded=${String(files.length - filesToParse.length)}`,
      `failed=${String(failedCount)}`,
      `diagnostics=${String(parseDiagnostics.length)}`,
      `exclusionIssues=${String(exclusionIssues.length)}`,
    ].join(" "),
  );

  if (parseDiagnostics.length > 0 || exclusionIssues.length > 0) {
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const cliArguments: readonly string[] = process.argv.slice(2);

  if (
    cliArguments.length > 1 ||
    (cliArguments.length === 1 && cliArguments[0] !== "--tokenize-only" && cliArguments[0] !== "--parse-only")
  ) {
    console.error("Usage: tsx tools/verify-roundtrip.ts [--tokenize-only|--parse-only]");
    process.exitCode = 2;
    return;
  }

  const mode: string = cliArguments[0] ?? "--tokenize-only";
  const configuredGamePath: string | undefined = process.env["STELLARIS_GAME_PATH"];
  const gamePath: string = resolve(configuredGamePath ?? DEFAULT_GAME_PATH);
  const corpusFileGroups: string[][] = await Promise.all(
    CORPUS_ROOTS.map(async (root): Promise<string[]> => collectTextFiles(join(gamePath, root))),
  );
  const files: string[] = corpusFileGroups.flat();

  files.sort((left, right) =>
    compareOrdinal(toPortablePath(relative(gamePath, left)), toPortablePath(relative(gamePath, right))),
  );

  if (mode === "--parse-only") {
    await verifyParseOnly(gamePath, files);
    return;
  }

  let tokenCount = 0;
  let bomFileCount = 0;
  let crlfFileCount = 0;
  let lfFileCount = 0;
  let diagnosticCount = 0;
  const unknownTokens: UnknownTokenLocation[] = [];
  const verificationIssues: VerificationIssue[] = [];

  const processFile = async (filePath: string): Promise<void> => {
    const displayPath: string = toPortablePath(relative(gamePath, filePath));
    const bytes: Buffer = await readFile(filePath);
    const source: string = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const result = tokenize(source);

    tokenCount += result.tokens.length;
    diagnosticCount += result.diagnostics.length;

    if (result.hadBom) {
      bomFileCount += 1;
    }

    if (source.includes("\r\n")) {
      crlfFileCount += 1;
    } else {
      lfFileCount += 1;
    }

    for (const diagnostic of result.diagnostics) {
      verificationIssues.push({
        path: displayPath,
        offset: diagnostic.span.start.offset,
        line: diagnostic.span.start.line,
        column: diagnostic.span.start.column,
        category: "diagnostic",
        message: `${diagnostic.code}: ${diagnostic.message}`,
      });
    }

    let expectedOffset: number = result.hadBom ? 1 : 0;
    let eofCount = 0;

    for (const token of result.tokens) {
      if (token.kind === TokenKind.EndOfFile) {
        eofCount += 1;
        continue;
      }

      if (token.span.start.offset !== expectedOffset) {
        verificationIssues.push({
          path: displayPath,
          offset: token.span.start.offset,
          line: token.span.start.line,
          column: token.span.start.column,
          category: "coverage",
          message: `expected token to start at offset ${String(expectedOffset)}, got ${String(token.span.start.offset)}.`,
        });
      }

      if (source.slice(token.span.start.offset, token.span.end.offset) !== token.text) {
        verificationIssues.push({
          path: displayPath,
          offset: token.span.start.offset,
          line: token.span.start.line,
          column: token.span.start.column,
          category: "coverage",
          message: "token text does not equal its source span.",
        });
      }

      expectedOffset = token.span.end.offset;

      if (token.kind !== TokenKind.Unknown) {
        continue;
      }

      unknownTokens.push({
        path: displayPath,
        offset: token.span.start.offset,
        line: token.span.start.line,
        column: token.span.start.column,
        text: token.text,
      });
    }

    const eofToken = result.tokens.at(-1);
    if (
      expectedOffset !== source.length ||
      eofCount !== 1 ||
      eofToken?.kind !== TokenKind.EndOfFile ||
      eofToken.text !== "" ||
      eofToken.span.start.offset !== source.length ||
      eofToken.span.end.offset !== source.length
    ) {
      verificationIssues.push({
        path: displayPath,
        offset: eofToken?.span.start.offset ?? expectedOffset,
        line: eofToken?.span.start.line ?? 1,
        column: eofToken?.span.start.column ?? 1,
        category: "coverage",
        message: "token stream does not cover the complete source followed by exactly one terminal EOF token.",
      });
    }
  };

  let nextFileIndex = 0;

  const processNextFile = async (): Promise<void> => {
    const filePath: string | undefined = files[nextFileIndex];
    nextFileIndex += 1;

    if (filePath === undefined) {
      return;
    }

    await processFile(filePath);
    await processNextFile();
  };

  await Promise.all(Array.from({ length: 8 }, processNextFile));

  unknownTokens.sort(
    (left, right) =>
      compareOrdinal(left.path, right.path) || left.offset - right.offset || compareOrdinal(left.text, right.text),
  );
  verificationIssues.sort(
    (left, right) =>
      compareOrdinal(left.path, right.path) ||
      left.offset - right.offset ||
      compareOrdinal(left.category, right.category) ||
      compareOrdinal(left.message, right.message),
  );

  for (const unknown of unknownTokens) {
    console.error(formatUnknown(unknown));
  }

  for (const issue of verificationIssues) {
    console.error(formatIssue(issue));
  }

  console.log(
    [
      "SUMMARY mode=tokenize-only",
      `files=${String(files.length)}`,
      `tokens=${String(tokenCount)}`,
      `bomFiles=${String(bomFileCount)}`,
      `crlfFiles=${String(crlfFileCount)}`,
      `lfFiles=${String(lfFileCount)}`,
      `unknownTokens=${String(unknownTokens.length)}`,
      `diagnostics=${String(diagnosticCount)}`,
      `verificationIssues=${String(verificationIssues.length)}`,
    ].join(" "),
  );

  if (unknownTokens.length > 0 || verificationIssues.length > 0) {
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
