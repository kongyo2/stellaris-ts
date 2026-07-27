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
    { name: "typeNames", actual: metrics.typeNameCount, expected: 234 },
    { name: "subtypeDefinitionOwners", actual: metrics.subtypeDefinitionOwnerCount, expected: 45 },
    { name: "subtypeDefinitions", actual: metrics.subtypeDefinitionCount, expected: 257 },
    { name: "typeKeySubtypeDefinitions", actual: metrics.typeKeySubtypeDefinitionCount, expected: 158 },
    { name: "subtypeReferences", actual: metrics.subtypeReferenceCount, expected: 112 },
    { name: "subtypeLocalisationReferences", actual: metrics.subtypeLocalisationReferenceCount, expected: 17 },
    { name: "subtypeSchemaRootSelectors", actual: metrics.subtypeSchemaRootSelectorCount, expected: 90 },
    { name: "subtypeSchemaNestedSelectors", actual: metrics.subtypeSchemaNestedSelectorCount, expected: 5 },
    { name: "subtypeConstructs", actual: metrics.subtypeConstructCount, expected: 369 },
    { name: "staticEnumDeclarations", actual: metrics.staticEnumDeclarationCount, expected: 180 },
    { name: "staticEnumNames", actual: metrics.staticEnumNameCount, expected: 179 },
    { name: "complexEnumDeclarations", actual: metrics.complexEnumDeclarationCount, expected: 28 },
    { name: "complexEnumNames", actual: metrics.complexEnumNameCount, expected: 27 },
    { name: "declaredEnumNames", actual: metrics.declaredEnumNameCount, expected: 206 },
    { name: "enumSyntaxOccurrences", actual: metrics.enumSyntaxOccurrenceCount, expected: 822 },
    { name: "enumSyntaxNames", actual: metrics.enumSyntaxNameCount, expected: 206 },
    { name: "primaryTriggerAliases", actual: metrics.primaryTriggerAliasDeclarationCount, expected: 912 },
    { name: "primaryEffectAliases", actual: metrics.primaryEffectAliasDeclarationCount, expected: 818 },
    { name: "triggerAliasDeclarations", actual: metrics.triggerAliasDeclarationCount, expected: 1_125 },
    { name: "triggerAliasNames", actual: metrics.triggerAliasNameCount, expected: 1_045 },
    { name: "effectAliasDeclarations", actual: metrics.effectAliasDeclarationCount, expected: 1_204 },
    { name: "effectAliasNames", actual: metrics.effectAliasNameCount, expected: 1_111 },
    { name: "linkBlocks", actual: metrics.linkBlockCount, expected: 171 },
    { name: "linkDeclarations", actual: metrics.linkDeclarationCount, expected: 86 },
    { name: "linkNames", actual: metrics.linkNameCount, expected: 85 },
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
      `typeNames=${String(corpus.metrics.typeNameCount)}`,
      `subtypeDefinitionOwners=${String(corpus.metrics.subtypeDefinitionOwnerCount)}`,
      `subtypeDefinitions=${String(corpus.metrics.subtypeDefinitionCount)}`,
      `typeKeySubtypeDefinitions=${String(corpus.metrics.typeKeySubtypeDefinitionCount)}`,
      `subtypeReferences=${String(corpus.metrics.subtypeReferenceCount)}`,
      `subtypeLocalisationReferences=${String(corpus.metrics.subtypeLocalisationReferenceCount)}`,
      `subtypeSchemaRootSelectors=${String(corpus.metrics.subtypeSchemaRootSelectorCount)}`,
      `subtypeSchemaNestedSelectors=${String(corpus.metrics.subtypeSchemaNestedSelectorCount)}`,
      `subtypeConstructs=${String(corpus.metrics.subtypeConstructCount)}`,
      `staticEnumDeclarations=${String(corpus.metrics.staticEnumDeclarationCount)}`,
      `staticEnumNames=${String(corpus.metrics.staticEnumNameCount)}`,
      `complexEnumDeclarations=${String(corpus.metrics.complexEnumDeclarationCount)}`,
      `complexEnumNames=${String(corpus.metrics.complexEnumNameCount)}`,
      `declaredEnumNames=${String(corpus.metrics.declaredEnumNameCount)}`,
      `enumSyntaxOccurrences=${String(corpus.metrics.enumSyntaxOccurrenceCount)}`,
      `enumSyntaxNames=${String(corpus.metrics.enumSyntaxNameCount)}`,
      `primaryTriggerAliases=${String(corpus.metrics.primaryTriggerAliasDeclarationCount)}`,
      `primaryEffectAliases=${String(corpus.metrics.primaryEffectAliasDeclarationCount)}`,
      `triggerAliasDeclarations=${String(corpus.metrics.triggerAliasDeclarationCount)}`,
      `triggerAliasNames=${String(corpus.metrics.triggerAliasNameCount)}`,
      `effectAliasDeclarations=${String(corpus.metrics.effectAliasDeclarationCount)}`,
      `effectAliasNames=${String(corpus.metrics.effectAliasNameCount)}`,
      `linkBlocks=${String(corpus.metrics.linkBlockCount)}`,
      `linkDeclarations=${String(corpus.metrics.linkDeclarationCount)}`,
      `linkNames=${String(corpus.metrics.linkNameCount)}`,
      `scopes=${String(corpus.metrics.scopeCount)}`,
      `annotations=${String(corpus.metrics.annotationCount)}`,
      `documentation=${String(corpus.metrics.documentationCount)}`,
      `unknownSyntax=${String(corpus.metrics.unknownSyntaxCount)}`,
      `recoveries=${String(corpus.metrics.recoveryCount)}`,
      `l0Diagnostics=${String(corpus.metrics.l0DiagnosticCount)}`,
      `orphanAnnotations=${String(corpus.metrics.orphanAnnotationCount)}`,
    ].join(" "),
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
