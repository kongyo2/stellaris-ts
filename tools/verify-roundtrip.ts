import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { TextDecoder } from "node:util";
import { requireGamePath } from "./game-path.js";

import {
  isTriviaToken,
  NodeKind,
  parse,
  print,
  tokenize,
  TokenKind,
  type Document,
  type EntryNode,
  type Scalar,
  type Token,
} from "../src/syntax/index.js";
import { roundtripExclusions } from "../tests/roundtrip-exclusions.js";

const CORPUS_ROOTS: readonly string[] = ["common", "events", "prescripted_countries", "map"];
const NON_SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([".csv", ".json", ".ods"]);

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

type RoundtripFailureCategory = "mismatch" | "output" | "parse-diagnostic" | "print-diagnostic";

interface RoundtripFailure {
  readonly path: string;
  readonly category: RoundtripFailureCategory;
  readonly message: string;
}

interface ExclusionValidation {
  readonly paths: ReadonlySet<string>;
  readonly issues: readonly ExclusionIssue[];
  readonly exceedsMaximum: boolean;
  readonly excludedFileCount: number;
}

interface RoundtripFileResult {
  readonly failures: readonly RoundtripFailure[];
  readonly parseDiagnosticCount: number;
  readonly printDiagnosticCount: number;
  readonly mismatchCount: number;
  readonly outputIssueCount: number;
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

async function collectCorpusFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareOrdinal(left.name, right.name));

  const fileGroups: string[][] = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const entryPath: string = join(directory, entry.name);

      if (entry.isDirectory()) {
        return collectCorpusFiles(entryPath);
      }

      if (entry.isFile() && !NON_SCRIPT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
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

function formatRoundtripFailure(failure: RoundtripFailure): string {
  return `FAILURE ${failure.path} category=${failure.category} ${failure.message}`;
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?|\u2028|\u2029/gu, "\n");
}

function significantEntries(entries: readonly EntryNode[]): EntryNode[] {
  return entries.filter((entry) => entry.kind !== NodeKind.Trivia);
}

function significantTokens(tokens: readonly Token[]): Token[] {
  return tokens.filter((token) => !isTriviaToken(token));
}

function compareTokens(left: readonly Token[], right: readonly Token[], path: string): string | undefined {
  const leftTokens: readonly Token[] = significantTokens(left);
  const rightTokens: readonly Token[] = significantTokens(right);

  if (leftTokens.length !== rightTokens.length) {
    return `${path} token count differs: source=${String(leftTokens.length)} printed=${String(rightTokens.length)}.`;
  }

  for (let index = 0; index < leftTokens.length; index += 1) {
    const leftToken: Token | undefined = leftTokens[index];
    const rightToken: Token | undefined = rightTokens[index];

    if (leftToken === undefined || rightToken === undefined) {
      return `${path}[${String(index)}] is missing from one token sequence.`;
    }

    if (leftToken.kind !== rightToken.kind) {
      return (
        `${path}[${String(index)}].kind differs: ` +
        `source=${JSON.stringify(leftToken.kind)} printed=${JSON.stringify(rightToken.kind)}.`
      );
    }

    const leftText: string = normalizeNewlines(leftToken.text);
    const rightText: string = normalizeNewlines(rightToken.text);
    if (leftText !== rightText) {
      return (
        `${path}[${String(index)}].text differs: ` +
        `source=${JSON.stringify(leftText)} printed=${JSON.stringify(rightText)}.`
      );
    }
  }

  return undefined;
}

function compareScalar(left: Scalar, right: Scalar, path: string): string | undefined {
  if (left.scalarKind !== right.scalarKind) {
    return (
      `${path}.scalarKind differs: ` +
      `source=${JSON.stringify(left.scalarKind)} printed=${JSON.stringify(right.scalarKind)}.`
    );
  }

  const leftRaw: string = normalizeNewlines(left.raw);
  const rightRaw: string = normalizeNewlines(right.raw);
  if (leftRaw !== rightRaw) {
    return `${path}.raw differs: source=${JSON.stringify(leftRaw)} printed=${JSON.stringify(rightRaw)}.`;
  }

  const leftValue: string | number | boolean =
    typeof left.value === "string" ? normalizeNewlines(left.value) : left.value;
  const rightValue: string | number | boolean =
    typeof right.value === "string" ? normalizeNewlines(right.value) : right.value;
  if (leftValue !== rightValue) {
    return `${path}.value differs: source=${JSON.stringify(leftValue)} printed=${JSON.stringify(rightValue)}.`;
  }

  return undefined;
}

function compareEntrySequences(
  leftEntries: readonly EntryNode[],
  rightEntries: readonly EntryNode[],
  path: string,
): string | undefined {
  const left: readonly EntryNode[] = significantEntries(leftEntries);
  const right: readonly EntryNode[] = significantEntries(rightEntries);

  if (left.length !== right.length) {
    return `${path} entry count differs: source=${String(left.length)} printed=${String(right.length)}.`;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftEntry: EntryNode | undefined = left[index];
    const rightEntry: EntryNode | undefined = right[index];

    if (leftEntry === undefined || rightEntry === undefined) {
      return `${path}[${String(index)}] is missing from one entry sequence.`;
    }

    const mismatch: string | undefined = compareEntry(leftEntry, rightEntry, `${path}[${String(index)}]`);
    if (mismatch !== undefined) {
      return mismatch;
    }
  }

  return undefined;
}

function compareEntry(left: EntryNode, right: EntryNode, path: string): string | undefined {
  if (left.kind !== right.kind) {
    return `${path}.kind differs: source=${JSON.stringify(left.kind)} printed=${JSON.stringify(right.kind)}.`;
  }

  switch (left.kind) {
    case NodeKind.Assignment: {
      if (right.kind !== NodeKind.Assignment) {
        return `${path}.kind differs after assignment narrowing.`;
      }

      const keyMismatch: string | undefined = compareScalar(left.key, right.key, `${path}.key`);
      if (keyMismatch !== undefined) {
        return keyMismatch;
      }

      if (left.operator !== right.operator) {
        return (
          `${path}.operator differs: ` +
          `source=${JSON.stringify(left.operator)} printed=${JSON.stringify(right.operator)}.`
        );
      }

      return compareEntry(left.value, right.value, `${path}.value`);
    }
    case NodeKind.Block:
      if (right.kind !== NodeKind.Block) {
        return `${path}.kind differs after block narrowing.`;
      }
      if (left.closed !== right.closed) {
        return `${path}.closed differs: source=${String(left.closed)} printed=${String(right.closed)}.`;
      }
      return compareEntrySequences(left.entries, right.entries, `${path}.entries`);
    case NodeKind.Scalar:
      if (right.kind !== NodeKind.Scalar) {
        return `${path}.kind differs after scalar narrowing.`;
      }
      return compareScalar(left, right, path);
    case NodeKind.PrefixedBlock: {
      if (right.kind !== NodeKind.PrefixedBlock) {
        return `${path}.kind differs after prefixed-block narrowing.`;
      }

      const prefixMismatch: string | undefined = compareScalar(left.prefix, right.prefix, `${path}.prefix`);
      if (prefixMismatch !== undefined) {
        return prefixMismatch;
      }

      return compareEntry(left.block, right.block, `${path}.block`);
    }
    case NodeKind.InlineMath: {
      if (right.kind !== NodeKind.InlineMath) {
        return `${path}.kind differs after inline-math narrowing.`;
      }

      if (left.escaped !== right.escaped) {
        return `${path}.escaped differs: source=${String(left.escaped)} printed=${String(right.escaped)}.`;
      }

      if (left.closed !== right.closed) {
        return `${path}.closed differs: source=${String(left.closed)} printed=${String(right.closed)}.`;
      }

      return compareTokens(left.tokens, right.tokens, `${path}.tokens`);
    }
    case NodeKind.OptionalBlock: {
      if (right.kind !== NodeKind.OptionalBlock) {
        return `${path}.kind differs after optional-block narrowing.`;
      }

      if (left.closed !== right.closed) {
        return `${path}.closed differs: source=${String(left.closed)} printed=${String(right.closed)}.`;
      }

      const headerMismatch: string | undefined = compareTokens(left.header, right.header, `${path}.header`);
      if (headerMismatch !== undefined) {
        return headerMismatch;
      }

      return compareEntrySequences(left.entries, right.entries, `${path}.entries`);
    }
    case NodeKind.Error:
      if (right.kind !== NodeKind.Error) {
        return `${path}.kind differs after error narrowing.`;
      }
      return compareTokens(left.tokens, right.tokens, `${path}.tokens`);
    case NodeKind.Trivia:
      return undefined;
    default:
      return `${path} has an unsupported entry kind.`;
  }
}

function compareDocuments(left: Document, right: Document): string | undefined {
  return compareEntrySequences(left.entries, right.entries, "document.entries");
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

function validateExclusions(gamePath: string, files: readonly string[]): ExclusionValidation {
  const collectedPaths: ReadonlySet<string> = new Set(
    files.map((filePath): string => toPortablePath(relative(gamePath, filePath))),
  );
  const exclusionPaths = new Set<string>();
  const exclusionIssues: ExclusionIssue[] = [];
  const exceedsMaximum: boolean = roundtripExclusions.length > 15;

  if (exceedsMaximum) {
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

  return {
    paths: exclusionPaths,
    issues: exclusionIssues,
    exceedsMaximum,
    excludedFileCount: [...exclusionPaths].filter((path) => collectedPaths.has(path)).length,
  };
}

async function verifyParseOnly(gamePath: string, files: readonly string[]): Promise<void> {
  const exclusionValidation: ExclusionValidation = validateExclusions(gamePath, files);

  if (exclusionValidation.exceedsMaximum) {
    for (const issue of exclusionValidation.issues) {
      console.error(formatExclusionIssue(issue));
    }

    console.log(
      [
        "SUMMARY mode=parse-only",
        `files=${String(files.length)}`,
        "success=0",
        `excluded=${String(exclusionValidation.excludedFileCount)}`,
        "failed=0",
        "diagnostics=0",
        `exclusionIssues=${String(exclusionValidation.issues.length)}`,
      ].join(" "),
    );
    process.exitCode = 1;
    return;
  }

  const filesToParse: readonly string[] = files.filter(
    (filePath) => !exclusionValidation.paths.has(toPortablePath(relative(gamePath, filePath))),
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

  for (const issue of exclusionValidation.issues) {
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
      `exclusionIssues=${String(exclusionValidation.issues.length)}`,
    ].join(" "),
  );

  if (parseDiagnostics.length > 0 || exclusionValidation.issues.length > 0) {
    process.exitCode = 1;
  }
}

function outputFailures(path: string, output: string): RoundtripFailure[] {
  const failures: RoundtripFailure[] = [];

  if (output.startsWith("\uFEFF")) {
    failures.push({
      path,
      category: "output",
      message: "printed output starts with a BOM.",
    });
  }

  if (output.includes("\r")) {
    failures.push({
      path,
      category: "output",
      message: "printed output contains a carriage return.",
    });
  }

  if (output.includes("\u2028")) {
    failures.push({
      path,
      category: "output",
      message: "printed output contains U+2028 LINE SEPARATOR.",
    });
  }

  if (output.includes("\u2029")) {
    failures.push({
      path,
      category: "output",
      message: "printed output contains U+2029 PARAGRAPH SEPARATOR.",
    });
  }

  return failures;
}

async function verifyRoundtripFile(gamePath: string, filePath: string): Promise<RoundtripFileResult> {
  const displayPath: string = toPortablePath(relative(gamePath, filePath));
  const failures: RoundtripFailure[] = [];
  let parseDiagnosticCount = 0;
  let printDiagnosticCount = 0;
  let mismatchCount = 0;
  let outputIssueCount = 0;
  const bytes: Buffer = await readFile(filePath);
  const source: string = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const parsedSource = parse(source);

  parseDiagnosticCount = parsedSource.diagnostics.length;
  for (const diagnostic of parsedSource.diagnostics) {
    failures.push({
      path: displayPath,
      category: "parse-diagnostic",
      message:
        `source ${String(diagnostic.span.start.line)}:${String(diagnostic.span.start.column)} ` +
        `${diagnostic.code}: ${diagnostic.message}`,
    });
  }

  if (parsedSource.diagnostics.length > 0) {
    return {
      failures,
      parseDiagnosticCount,
      printDiagnosticCount,
      mismatchCount,
      outputIssueCount,
    };
  }

  let output: string;
  try {
    output = print(parsedSource.document);
  } catch (error: unknown) {
    printDiagnosticCount = 1;
    failures.push({
      path: displayPath,
      category: "print-diagnostic",
      message: `print(document) threw: ${error instanceof Error ? error.message : String(error)}`,
    });
    return {
      failures,
      parseDiagnosticCount,
      printDiagnosticCount,
      mismatchCount,
      outputIssueCount,
    };
  }

  const invalidOutput: readonly RoundtripFailure[] = outputFailures(displayPath, output);
  failures.push(...invalidOutput);
  outputIssueCount = invalidOutput.length;

  const parsedOutput = parse(output);
  printDiagnosticCount = parsedOutput.diagnostics.length;
  for (const diagnostic of parsedOutput.diagnostics) {
    failures.push({
      path: displayPath,
      category: "print-diagnostic",
      message:
        `printed output ${String(diagnostic.span.start.line)}:${String(diagnostic.span.start.column)} ` +
        `${diagnostic.code}: ${diagnostic.message}`,
    });
  }

  if (parsedOutput.diagnostics.length === 0) {
    const mismatch: string | undefined = compareDocuments(parsedSource.document, parsedOutput.document);
    if (mismatch !== undefined) {
      mismatchCount = 1;
      failures.push({
        path: displayPath,
        category: "mismatch",
        message: mismatch,
      });
    }
  }

  return {
    failures,
    parseDiagnosticCount,
    printDiagnosticCount,
    mismatchCount,
    outputIssueCount,
  };
}

async function verifyRoundtrip(gamePath: string, files: readonly string[]): Promise<void> {
  const exclusionValidation: ExclusionValidation = validateExclusions(gamePath, files);

  if (exclusionValidation.exceedsMaximum) {
    for (const issue of exclusionValidation.issues) {
      console.error(formatExclusionIssue(issue));
    }

    console.log(
      [
        "SUMMARY mode=roundtrip",
        `files=${String(files.length)}`,
        "success=0",
        `excluded=${String(exclusionValidation.excludedFileCount)}`,
        "failed=0",
        "parseDiagnostics=0",
        "printDiagnostics=0",
        "mismatches=0",
        "outputIssues=0",
        `exclusionIssues=${String(exclusionValidation.issues.length)}`,
      ].join(" "),
    );
    process.exitCode = 1;
    return;
  }

  const filesToVerify: readonly string[] = files.filter(
    (filePath) => !exclusionValidation.paths.has(toPortablePath(relative(gamePath, filePath))),
  );
  const failures: RoundtripFailure[] = [];
  let successCount = 0;
  let failedCount = 0;
  let parseDiagnosticCount = 0;
  let printDiagnosticCount = 0;
  let mismatchCount = 0;
  let outputIssueCount = 0;
  let nextFileIndex = 0;

  const processNextFile = async (): Promise<void> => {
    const filePath: string | undefined = filesToVerify[nextFileIndex];
    nextFileIndex += 1;

    if (filePath === undefined) {
      return;
    }

    const result: RoundtripFileResult = await verifyRoundtripFile(gamePath, filePath);
    failures.push(...result.failures);
    parseDiagnosticCount += result.parseDiagnosticCount;
    printDiagnosticCount += result.printDiagnosticCount;
    mismatchCount += result.mismatchCount;
    outputIssueCount += result.outputIssueCount;

    if (result.failures.length === 0) {
      successCount += 1;
    } else {
      failedCount += 1;
    }

    await processNextFile();
  };

  await Promise.all(Array.from({ length: 8 }, processNextFile));

  failures.sort(
    (left, right) =>
      compareOrdinal(left.path, right.path) ||
      compareOrdinal(left.category, right.category) ||
      compareOrdinal(left.message, right.message),
  );

  for (const issue of exclusionValidation.issues) {
    console.error(formatExclusionIssue(issue));
  }

  for (const failure of failures) {
    console.error(formatRoundtripFailure(failure));
  }

  console.log(
    [
      "SUMMARY mode=roundtrip",
      `files=${String(files.length)}`,
      `success=${String(successCount)}`,
      `excluded=${String(files.length - filesToVerify.length)}`,
      `failed=${String(failedCount)}`,
      `parseDiagnostics=${String(parseDiagnosticCount)}`,
      `printDiagnostics=${String(printDiagnosticCount)}`,
      `mismatches=${String(mismatchCount)}`,
      `outputIssues=${String(outputIssueCount)}`,
      `exclusionIssues=${String(exclusionValidation.issues.length)}`,
    ].join(" "),
  );

  if (failures.length > 0 || exclusionValidation.issues.length > 0) {
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
    console.error("With no argument, verifies parse-print-parse structural round trips.");
    process.exitCode = 2;
    return;
  }

  const mode: string = cliArguments[0] ?? "roundtrip";
  const gamePath: string = resolve(requireGamePath());
  const corpusFileGroups: string[][] = await Promise.all(
    CORPUS_ROOTS.map(async (root): Promise<string[]> => collectCorpusFiles(join(gamePath, root))),
  );
  const files: string[] = corpusFileGroups.flat();

  files.sort((left, right) =>
    compareOrdinal(toPortablePath(relative(gamePath, left)), toPortablePath(relative(gamePath, right))),
  );

  if (mode === "--parse-only") {
    await verifyParseOnly(gamePath, files);
    return;
  }

  if (mode === "roundtrip") {
    await verifyRoundtrip(gamePath, files);
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
