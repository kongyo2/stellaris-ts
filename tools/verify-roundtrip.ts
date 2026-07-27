import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { TextDecoder } from "node:util";

import { tokenize, TokenKind } from "../src/syntax/index.js";

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

async function main(): Promise<void> {
  const cliArguments: readonly string[] = process.argv.slice(2);

  if (cliArguments.length > 1 || (cliArguments.length === 1 && cliArguments[0] !== "--tokenize-only")) {
    console.error("Usage: tsx tools/verify-roundtrip.ts [--tokenize-only]");
    process.exitCode = 2;
    return;
  }

  const configuredGamePath: string | undefined = process.env["STELLARIS_GAME_PATH"];
  const gamePath: string = resolve(configuredGamePath ?? DEFAULT_GAME_PATH);
  const corpusFileGroups: string[][] = await Promise.all(
    CORPUS_ROOTS.map(async (root): Promise<string[]> => collectTextFiles(join(gamePath, root))),
  );
  const files: string[] = corpusFileGroups.flat();

  files.sort((left, right) =>
    compareOrdinal(toPortablePath(relative(gamePath, left)), toPortablePath(relative(gamePath, right))),
  );

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
