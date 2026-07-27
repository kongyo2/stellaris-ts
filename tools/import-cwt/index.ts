import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { CwtCorpusMetrics, CwtReaderDiagnostic } from "./model.js";
import { readCwtCorpus } from "./reader.js";

interface ExpectedMetric {
  readonly actual: number;
  readonly expected: number;
  readonly name: string;
}

const REPOSITORY_ROOT: string = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULT_CONFIG_DIRECTORY: string = join(REPOSITORY_ROOT, "refs", "cwtools-stellaris-config", "config");

function expectedMetrics(metrics: CwtCorpusMetrics): readonly ExpectedMetric[] {
  return [
    { name: "files", actual: metrics.fileCount, expected: 101 },
    { name: "lines", actual: metrics.lineCount, expected: 44_370 },
    { name: "typeDefinitions", actual: metrics.typeDefinitionCount, expected: 234 },
    { name: "enumNames", actual: metrics.enumCount, expected: 207 },
    { name: "triggerAliases", actual: metrics.triggerAliasCount, expected: 912 },
    { name: "effectAliases", actual: metrics.effectAliasCount, expected: 818 },
    { name: "linkBlocks", actual: metrics.linkBlockCount, expected: 171 },
    { name: "linkDefinitions", actual: metrics.linkDefinitionCount, expected: 86 },
    { name: "scopes", actual: metrics.scopeCount, expected: 41 },
    { name: "unknownSyntax", actual: metrics.unknownSyntaxCount, expected: 0 },
    { name: "recoveries", actual: metrics.recoveryCount, expected: 1 },
    { name: "l0Diagnostics", actual: metrics.l0DiagnosticCount, expected: 0 },
    { name: "orphanAnnotations", actual: metrics.orphanAnnotationCount, expected: 0 },
  ];
}

function formatDiagnostic(diagnostic: CwtReaderDiagnostic): string {
  return (
    `${diagnostic.category.toUpperCase()} ${diagnostic.path}:` +
    `${String(diagnostic.span.start.line)}:${String(diagnostic.span.start.column)} ` +
    `${diagnostic.code}: ${diagnostic.message}`
  );
}

function parseConfigDirectory(arguments_: readonly string[]): string | undefined {
  if (arguments_.length === 0) {
    return DEFAULT_CONFIG_DIRECTORY;
  }

  if (arguments_.length === 2 && arguments_[0] === "--config") {
    const configuredPath: string | undefined = arguments_[1];
    return configuredPath === undefined ? undefined : resolve(configuredPath);
  }

  return undefined;
}

async function main(): Promise<void> {
  const configDirectory: string | undefined = parseConfigDirectory(process.argv.slice(2));
  if (configDirectory === undefined) {
    console.error("Usage: tsx tools/import-cwt/index.ts [--config <directory>]");
    process.exitCode = 2;
    return;
  }

  const corpus = await readCwtCorpus(configDirectory);
  const mismatches: readonly ExpectedMetric[] = expectedMetrics(corpus.metrics).filter(
    (metric) => metric.actual !== metric.expected,
  );

  for (const file of corpus.files) {
    for (const diagnostic of file.diagnostics) {
      console.error(formatDiagnostic(diagnostic));
    }
  }

  for (const mismatch of mismatches) {
    console.error(`COUNT ${mismatch.name} expected=${String(mismatch.expected)} actual=${String(mismatch.actual)}`);
  }

  console.log(
    [
      "SUMMARY",
      `files=${String(corpus.metrics.fileCount)}`,
      `lines=${String(corpus.metrics.lineCount)}`,
      `typeDefinitions=${String(corpus.metrics.typeDefinitionCount)}`,
      `typeKeySubtypes=${String(corpus.metrics.typeKeySubtypeCount)}`,
      `enumNames=${String(corpus.metrics.enumCount)}`,
      `enumDefinitions=${String(corpus.metrics.enumDefinitionCount)}`,
      `complexEnumDefinitions=${String(corpus.metrics.complexEnumDefinitionCount)}`,
      `triggerAliases=${String(corpus.metrics.triggerAliasCount)}`,
      `effectAliases=${String(corpus.metrics.effectAliasCount)}`,
      `linkBlocks=${String(corpus.metrics.linkBlockCount)}`,
      `linkDefinitions=${String(corpus.metrics.linkDefinitionCount)}`,
      `scopes=${String(corpus.metrics.scopeCount)}`,
      `annotations=${String(corpus.metrics.annotationCount)}`,
      `documentation=${String(corpus.metrics.documentationCount)}`,
      `unknownSyntax=${String(corpus.metrics.unknownSyntaxCount)}`,
      `recoveries=${String(corpus.metrics.recoveryCount)}`,
      `l0Diagnostics=${String(corpus.metrics.l0DiagnosticCount)}`,
      `orphanAnnotations=${String(corpus.metrics.orphanAnnotationCount)}`,
    ].join(" "),
  );
  console.log(
    "SPEC_DRIFT objectiveTypeCount=449 actualTypeDefinitions=234 " +
      "objectiveLinkCount=171 metric=all-blocks actualLinkDefinitions=86",
  );

  if (mismatches.length > 0) {
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
