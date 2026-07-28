import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { emitCatalogSource, extractImportedCatalog, type ImportedCatalog } from "./catalog.js";
import {
  collectReferencedNames,
  emitCommandsSource,
  emitReferencedNamesSource,
  emitSchemaSources,
  type EmitResult,
} from "./emit.js";
import { emitEnumsSource, emitScopesSource, extractImportedEnums, extractImportedLinks } from "./metadata.js";
import type { CwtCorpusMetrics, CwtReaderDiagnostic } from "./model.js";
import { readCwtCorpus } from "./reader.js";
import { translateCwtCorpus } from "./translate.js";

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

interface CliOptions {
  readonly configDirectory: string;
  readonly emit: boolean;
  readonly check: boolean;
}

function parseCli(arguments_: readonly string[]): CliOptions | undefined {
  let configDirectory: string = DEFAULT_CONFIG_DIRECTORY;
  let emit = false;
  let check = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument: string | undefined = arguments_[index];

    if (argument === "--emit") {
      emit = true;
      continue;
    }

    if (argument === "--check") {
      check = true;
      continue;
    }

    if (argument === "--config") {
      const configuredPath: string | undefined = arguments_[index + 1];
      if (configuredPath === undefined) {
        return undefined;
      }
      configDirectory = resolve(configuredPath);
      index += 1;
      continue;
    }

    return undefined;
  }

  return { configDirectory, emit, check };
}

/**
 * Writes the emitted schema sources. `--check` reports what would change
 * instead of writing, which is how an upstream cwt refresh proposes a diff
 * rather than silently overwriting hand-maintained sources.
 */
async function applyEmit(files: readonly { readonly path: string; readonly source: string }[], check: boolean) {
  const definitionsDirectory: string = join(REPOSITORY_ROOT, "src", "schema", "definitions");
  const emittedPaths: ReadonlySet<string> = new Set(files.map((file) => file.path));
  const changed: string[] = [];
  const removed: string[] = [];

  let existing: readonly string[] = [];
  try {
    existing = (await readdir(definitionsDirectory)).map((name) => `src/schema/definitions/${name}`);
  } catch {
    existing = [];
  }

  const stale: readonly string[] = existing.filter((path) => !emittedPaths.has(path));
  removed.push(...stale);

  if (!check) {
    await Promise.all(stale.map(async (path) => rm(join(REPOSITORY_ROOT, path), { force: true })));
  }

  const outcomes: readonly (string | undefined)[] = await Promise.all(
    files.map(async (file): Promise<string | undefined> => {
      const absolute: string = join(REPOSITORY_ROOT, file.path);
      let previous: string | undefined;
      try {
        previous = await readFile(absolute, "utf8");
      } catch {
        previous = undefined;
      }

      if (previous === file.source) {
        return undefined;
      }

      if (!check) {
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, file.source, "utf8");
      }

      return file.path;
    }),
  );

  changed.push(...outcomes.filter((path): path is string => path !== undefined));

  return { changed, removed };
}

async function main(): Promise<void> {
  const options: CliOptions | undefined = parseCli(process.argv.slice(2));
  if (options === undefined) {
    console.error("Usage: tsx tools/import-cwt/index.ts [--config <directory>] [--emit] [--check]");
    process.exitCode = 2;
    return;
  }

  const { configDirectory } = options;
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

  if (!options.emit && !options.check) {
    return;
  }

  const catalog: ImportedCatalog = extractImportedCatalog(corpus);
  const translation = translateCwtCorpus(corpus);
  const enums = extractImportedEnums(corpus);
  const referenced = collectReferencedNames(translation.definitionTypes, translation.commands);
  const links = extractImportedLinks(corpus, catalog);
  const schema: EmitResult = emitSchemaSources(translation.definitionTypes, catalog);
  const commands = emitCommandsSource(translation.commands, catalog);
  const files: readonly { readonly path: string; readonly source: string }[] = [
    { path: "src/schema/catalog.ts", source: emitCatalogSource(catalog) },
    { path: "src/schema/commands.ts", source: commands.source },
    { path: "src/schema/enums.ts", source: emitEnumsSource(enums) },
    { path: "src/schema/dynamic-sets.ts", source: emitReferencedNamesSource(referenced, catalog) },
    { path: "src/schema/scopes.ts", source: emitScopesSource(catalog, links) },
    ...schema.files,
  ];

  const { changed, removed } = await applyEmit(files, options.check);

  for (const diagnostic of schema.diagnostics.slice(0, 40)) {
    console.error(`EMIT ${diagnostic.definition} ${diagnostic.code}: ${diagnostic.detail.slice(0, 120)}`);
  }

  console.log(
    [
      options.check ? "EMIT mode=check" : "EMIT mode=write",
      `files=${String(files.length)}`,
      `definitions=${String(schema.files.length - 1)}`,
      `commands=${String(commands.commandCount)}`,
      `ruleSets=${String(commands.ruleSetCount)}`,
      `enums=${String(enums.length)}`,
      `valueSets=${String(referenced.valueSets.length)}`,
      `namedValues=${String(referenced.namedValues.length)}`,
      `scopeGroups=${String(referenced.scopeGroups.length)}`,
      `links=${String(links.length)}`,
      `changed=${String(changed.length)}`,
      `removed=${String(removed.length)}`,
      `opaque=${String(schema.opaqueCount)}`,
      `emitDiagnostics=${String(schema.diagnostics.length)}`,
    ].join(" "),
  );

  if (options.check && (changed.length > 0 || removed.length > 0)) {
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
