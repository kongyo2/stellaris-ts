import {
  NodeKind,
  type Assignment,
  type Block,
  type EntryNode,
  type Scalar,
  type ValueNode,
} from "../../src/syntax/index.js";
import type { CwtCorpus, CwtReadResult } from "./model.js";
import type { ImportedCatalog, ImportedScope } from "./catalog.js";

export interface ImportedStaticEnum {
  readonly kind: "static";
  readonly id: string;
  readonly values: readonly string[];
}

export interface ImportedExtractionField {
  readonly kind: "field";
  readonly key: string;
}

export interface ImportedExtractionAnyField {
  readonly kind: "any-field";
}

export interface ImportedExtractionCapture {
  readonly kind: "capture";
  readonly source: "key" | "scalar";
}

export type ImportedExtractionStep = ImportedExtractionAnyField | ImportedExtractionCapture | ImportedExtractionField;

export interface ImportedEnumExtraction {
  readonly directory: string;
  readonly includeSubdirectories: boolean;
  readonly route: readonly ImportedExtractionStep[];
  readonly startFromRoot: boolean;
}

export interface ImportedExtractedEnum {
  readonly kind: "extracted";
  readonly id: string;
  readonly sources: readonly ImportedEnumExtraction[];
}

export type ImportedEnum = ImportedExtractedEnum | ImportedStaticEnum;

export interface ImportedScopeLink {
  readonly kind: "scope";
  readonly id: string;
  readonly input: "any" | readonly string[];
  readonly output: "dynamic" | readonly string[];
}

export interface ImportedDataLink {
  readonly kind: "data";
  readonly id: string;
  readonly prefix: string;
  readonly source: {
    readonly kind: "type" | "value-set";
    readonly id: string;
  };
}

export type ImportedLink = ImportedDataLink | ImportedScopeLink;

interface BracketConstruct {
  readonly argument: string;
  readonly head: string;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function originalText(file: CwtReadResult, node: { readonly span: Scalar["span"] }): string {
  return file.source.original.slice(node.span.start.offset, node.span.end.offset);
}

function originalKey(file: CwtReadResult, entry: EntryNode): string | undefined {
  return entry.kind === NodeKind.Assignment ? originalText(file, entry.key).trim() : undefined;
}

function originalValue(file: CwtReadResult, value: ValueNode): string {
  return originalText(file, value).trim();
}

function bracketConstruct(text: string): BracketConstruct | undefined {
  const match: RegExpExecArray | null = /^([A-Za-z_.]+)\[([^\]]+)\]$/u.exec(text);
  const head: string | undefined = match?.[1];
  const argument: string | undefined = match?.[2];
  return head === undefined || argument === undefined ? undefined : { head, argument: argument.trim() };
}

function directAssignments(block: Block): readonly Assignment[] {
  return block.entries.filter((entry): entry is Assignment => entry.kind === NodeKind.Assignment);
}

function scalarEntries(block: Block): readonly Scalar[] {
  return block.entries.filter((entry): entry is Scalar => entry.kind === NodeKind.Scalar);
}

function pathValue(file: CwtReadResult, block: Block): string | undefined {
  const pathEntry: Assignment | undefined = directAssignments(block).find(
    (entry) => originalKey(file, entry) === "path",
  );
  return pathEntry?.value.kind === NodeKind.Scalar ? String(pathEntry.value.value).replace(/^game\//u, "") : undefined;
}

function staticEnumValues(file: CwtReadResult, block: Block): string[] {
  const values: string[] = [];

  for (const entry of block.entries) {
    if (entry.kind === NodeKind.Scalar) {
      // A quoted scalar keeps its quotes in the raw value; the enum member is
      // the text inside them.
      values.push(String(entry.value).replace(/^"|"$/gu, ""));
    } else if (entry.kind === NodeKind.Assignment) {
      const key: string | undefined = originalKey(file, entry);
      if (key !== undefined) {
        values.push(key.replace(/^"|"$/gu, ""));
      }
    }
  }

  return values;
}

function isWildcardTemplateKey(key: string): boolean {
  if (key === "scalar" || key === "int" || key === "float") {
    return true;
  }

  const construct: BracketConstruct | undefined = bracketConstruct(key);
  return construct !== undefined && construct.head !== "enum_name";
}

function extractionRoutesFromValue(
  file: CwtReadResult,
  value: ValueNode,
  prefix: readonly ImportedExtractionStep[],
): ImportedExtractionStep[][] {
  if (value.kind === NodeKind.Scalar) {
    return originalValue(file, value) === "enum_name" ? [[...prefix, { kind: "capture", source: "scalar" }]] : [];
  }

  if (value.kind !== NodeKind.Block) {
    return [];
  }

  return extractionRoutesFromBlock(file, value, prefix);
}

function extractionRoutesFromBlock(
  file: CwtReadResult,
  block: Block,
  prefix: readonly ImportedExtractionStep[],
): ImportedExtractionStep[][] {
  const routes: ImportedExtractionStep[][] = [];

  for (const entry of block.entries) {
    if (entry.kind === NodeKind.Scalar && originalText(file, entry).trim() === "enum_name") {
      routes.push([...prefix, { kind: "capture", source: "scalar" }]);
      continue;
    }

    if (entry.kind !== NodeKind.Assignment) {
      continue;
    }

    const key: string | undefined = originalKey(file, entry);
    if (key === undefined) {
      continue;
    }

    if (key === "enum_name") {
      routes.push([...prefix, { kind: "capture", source: "key" }]);
      continue;
    }

    const step: ImportedExtractionStep = isWildcardTemplateKey(key)
      ? { kind: "any-field" }
      : { kind: "field", key: key.replace(/^"|"$/gu, "") };
    routes.push(...extractionRoutesFromValue(file, entry.value, [...prefix, step]));
  }

  return routes;
}

function complexEnumSources(file: CwtReadResult, block: Block): ImportedEnumExtraction[] {
  const directory: string | undefined = pathValue(file, block);
  const nameEntry: Assignment | undefined = directAssignments(block).find(
    (entry) => originalKey(file, entry) === "name",
  );

  if (directory === undefined || nameEntry?.value.kind !== NodeKind.Block) {
    return [];
  }

  const startEntry: Assignment | undefined = directAssignments(block).find(
    (entry) => originalKey(file, entry) === "start_from_root",
  );
  const startFromRoot: boolean = startEntry?.value.kind === NodeKind.Scalar && String(startEntry.value.value) === "yes";

  return extractionRoutesFromBlock(file, nameEntry.value, []).map((route) => ({
    directory,
    includeSubdirectories: true,
    route,
    startFromRoot,
  }));
}

export function extractImportedEnums(corpus: CwtCorpus): ImportedEnum[] {
  const fixed = new Map<string, string[]>();
  const extracted = new Map<string, ImportedEnumExtraction[]>();

  for (const file of corpus.files) {
    for (const rootEntry of file.document.entries) {
      if (
        rootEntry.kind !== NodeKind.Assignment ||
        originalKey(file, rootEntry) !== "enums" ||
        rootEntry.value.kind !== NodeKind.Block
      ) {
        continue;
      }

      for (const declaration of directAssignments(rootEntry.value)) {
        if (declaration.value.kind !== NodeKind.Block) {
          continue;
        }

        const key: string | undefined = originalKey(file, declaration);
        const construct: BracketConstruct | undefined = key === undefined ? undefined : bracketConstruct(key);
        if (construct?.head === "enum") {
          const values: string[] = fixed.get(construct.argument) ?? [];
          values.push(...staticEnumValues(file, declaration.value));
          fixed.set(construct.argument, values);
        } else if (construct?.head === "complex_enum") {
          const sources: ImportedEnumExtraction[] = extracted.get(construct.argument) ?? [];
          sources.push(...complexEnumSources(file, declaration.value));
          extracted.set(construct.argument, sources);
        }
      }
    }
  }

  const enums: ImportedEnum[] = [
    ...[...fixed].map(([id, values]): ImportedStaticEnum => ({
      kind: "static",
      id,
      values: [...new Set(values)],
    })),
    ...[...extracted].map(([id, sources]): ImportedExtractedEnum => ({
      kind: "extracted",
      id,
      sources,
    })),
  ];

  return enums.sort((left, right) => compareOrdinal(left.id, right.id));
}

function scopeLookup(scopes: readonly ImportedScope[]): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();

  for (const scope of scopes) {
    for (const name of [scope.id, scope.displayName, ...scope.aliases]) {
      lookup.set(name.toLowerCase().replaceAll(" ", "_"), scope.id);
      lookup.set(name.toLowerCase().replaceAll("_", ""), scope.id);
    }
  }

  return lookup;
}

function canonicalScope(lookup: ReadonlyMap<string, string>, value: string): string | undefined {
  return lookup.get(value.toLowerCase().replaceAll(" ", "_")) ?? lookup.get(value.toLowerCase().replaceAll("_", ""));
}

function linkScopes(lookup: ReadonlyMap<string, string>, block: Block): "any" | readonly string[] | undefined {
  const values: readonly string[] = scalarEntries(block).map((entry) => String(entry.value));
  if (values.some((value) => value.toLowerCase() === "all")) {
    return "any";
  }

  const canonical: string[] = [];
  for (const value of values) {
    const id: string | undefined = canonicalScope(lookup, value);
    if (id === undefined) {
      return undefined;
    }
    canonical.push(id);
  }

  return canonical;
}

function dataLink(file: CwtReadResult, id: string, block: Block): ImportedDataLink | undefined {
  const fields: ReadonlyMap<string, Assignment> = new Map(
    directAssignments(block).flatMap((entry): readonly [string, Assignment][] => {
      const key: string | undefined = originalKey(file, entry);
      return key === undefined ? [] : [[key, entry]];
    }),
  );
  const prefixEntry: Assignment | undefined = fields.get("prefix");
  const sourceEntry: Assignment | undefined = fields.get("data_source");
  if (prefixEntry?.value.kind !== NodeKind.Scalar || sourceEntry === undefined) {
    return undefined;
  }

  const sourceText: string = originalValue(file, sourceEntry.value);
  const angleMatch: RegExpExecArray | null = /^<([^>]+)>$/u.exec(sourceText);
  const construct: BracketConstruct | undefined = bracketConstruct(sourceText);
  if (angleMatch?.[1] !== undefined) {
    return {
      kind: "data",
      id,
      prefix: String(prefixEntry.value.value),
      source: { kind: "type", id: angleMatch[1] },
    };
  }

  if (construct?.head === "alias_keys_field") {
    return {
      kind: "data",
      id,
      prefix: String(prefixEntry.value.value),
      source: { kind: "value-set", id: construct.argument },
    };
  }

  return undefined;
}

export function extractImportedLinks(corpus: CwtCorpus, catalog: ImportedCatalog): ImportedLink[] {
  const links: ImportedLink[] = [];
  const lookup: ReadonlyMap<string, string> = scopeLookup(catalog.scopes);

  for (const file of corpus.files) {
    for (const rootEntry of file.document.entries) {
      if (
        rootEntry.kind !== NodeKind.Assignment ||
        originalKey(file, rootEntry) !== "links" ||
        rootEntry.value.kind !== NodeKind.Block
      ) {
        continue;
      }

      for (const linkEntry of directAssignments(rootEntry.value)) {
        const id: string | undefined = originalKey(file, linkEntry);
        if (id === undefined || linkEntry.value.kind !== NodeKind.Block) {
          continue;
        }

        const fields: ReadonlyMap<string, Assignment> = new Map(
          directAssignments(linkEntry.value).flatMap((entry): readonly [string, Assignment][] => {
            const key: string | undefined = originalKey(file, entry);
            return key === undefined ? [] : [[key, entry]];
          }),
        );
        const inputEntry: Assignment | undefined = fields.get("input_scopes");
        const outputEntry: Assignment | undefined = fields.get("output_scope");
        if (inputEntry?.value.kind === NodeKind.Block && outputEntry?.value.kind === NodeKind.Scalar) {
          const input: "any" | readonly string[] | undefined = linkScopes(lookup, inputEntry.value);
          const outputText: string = String(outputEntry.value.value);
          const outputId: string | undefined = canonicalScope(lookup, outputText);
          if (input !== undefined && (outputId !== undefined || outputText.toLowerCase() === "any")) {
            links.push({
              kind: "scope",
              id,
              input,
              output: outputId === undefined ? "dynamic" : [outputId],
            });
          }
          continue;
        }

        const dynamic: ImportedDataLink | undefined = dataLink(file, id, linkEntry.value);
        if (dynamic !== undefined) {
          links.push(dynamic);
        }
      }
    }
  }

  return links;
}

function quoteList(values: readonly string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function emitExtractionStep(step: ImportedExtractionStep): string {
  if (step.kind === "field") {
    return `extractionField(${JSON.stringify(step.key)})`;
  }

  if (step.kind === "any-field") {
    return "extractionAnyField()";
  }

  return step.source === "key" ? "captureKey()" : "captureScalar()";
}

export function emitEnumsSource(enums: readonly ImportedEnum[]): string {
  const entries: string = enums
    .map((definition) => {
      if (definition.kind === "static") {
        return `  staticEnum(${JSON.stringify(definition.id)}, ${quoteList(definition.values)}),`;
      }

      const sources: string = definition.sources
        .map(
          (source) =>
            `enumExtraction(${JSON.stringify(source.directory)}, [${source.route.map(emitExtractionStep).join(", ")}], ${String(source.includeSubdirectories)}, ${String(source.startFromRoot)})`,
        )
        .join(", ");
      return `  extractedEnum(${JSON.stringify(definition.id)}, [${sources}]),`;
    })
    .join("\n");

  // `noUnusedLocals` makes a speculative import a build failure, so only import
  // the helpers this particular emission actually referenced.
  const candidates: readonly string[] = [
    "captureKey",
    "captureScalar",
    "enumExtraction",
    "extractedEnum",
    "extractionAnyField",
    "extractionField",
    "staticEnum",
  ];
  const used: readonly string[] = candidates.filter((name) => new RegExp(`\\b${name}\\(`, "u").test(entries));

  return [
    `import { ${used.join(", ")} } from "./ir.js";`,
    'import type { EnumDefinition } from "./ir.js";',
    "",
    "export const enums: readonly EnumDefinition[] = [",
    entries,
    "];",
    "",
  ].join("\n");
}

export function emitScopesSource(catalog: ImportedCatalog, links: readonly ImportedLink[]): string {
  const scopes: string = catalog.scopes
    .map(
      (scope) =>
        `  { id: ${JSON.stringify(scope.id)}, displayName: ${JSON.stringify(scope.displayName)}, aliases: ${quoteList(scope.aliases)} },`,
    )
    .join("\n");
  const emittedLinks: string = links
    .map((link) => {
      if (link.kind === "data") {
        const source: string =
          link.source.kind === "type"
            ? `typeRef(${JSON.stringify(link.source.id)})`
            : `valueSet(${JSON.stringify(link.source.id)})`;
        return `  { kind: "data-link", id: ${JSON.stringify(link.id)}, prefix: ${JSON.stringify(link.prefix)}, source: ${source} },`;
      }

      const input: string =
        link.input === "any"
          ? "anyScope()"
          : `listedScopes(${link.input.map((scope) => JSON.stringify(scope)).join(", ")})`;
      const output: string =
        link.output === "dynamic"
          ? "dynamicScope()"
          : `fixedScopes(${link.output.map((scope) => JSON.stringify(scope)).join(", ")})`;
      return `  { kind: "scope-link", id: ${JSON.stringify(link.id)}, input: ${input}, output: ${output} },`;
    })
    .join("\n");

  return [
    'import { anyScope, dynamicScope, fixedScopes, listedScopes, typeRef, valueSet } from "./ir.js";',
    'import type { LinkDefinition, ScopeDefinition } from "./ir.js";',
    "",
    "export const scopes: readonly ScopeDefinition[] = [",
    scopes,
    "];",
    "",
    "export const links: readonly LinkDefinition[] = [",
    emittedLinks,
    "];",
    "",
  ].join("\n");
}

/**
 * Value sets and named values are declared by usage, not by a registry:
 * `set_country_flag = value_set[country_flag]` is what brings `country_flag`
 * into existence. Collecting every name the corpus mentions is therefore the
 * declaration list.
 */
export interface ImportedDynamicSets {
  readonly valueSets: readonly string[];
  readonly namedValues: readonly string[];
}

export function extractImportedDynamicSets(corpus: CwtCorpus): ImportedDynamicSets {
  const valueSets = new Set<string>();
  const namedValues = new Set<string>();

  for (const file of corpus.files) {
    const source: string = file.source.original;
    for (const match of source.matchAll(/\b(value_set|value)\[([^\]]+)\]/gu)) {
      const name: string | undefined = match[2];
      if (name !== undefined) {
        valueSets.add(name.trim());
      }
    }
    for (const match of source.matchAll(/\bvalue_set\[([^\]]+)\]/gu)) {
      const name: string | undefined = match[1];
      if (name !== undefined) {
        valueSets.add(name.trim());
      }
    }
    for (const match of source.matchAll(/\b(?:variable_field|int_variable_field)\[([^\]]+)\]/gu)) {
      const name: string | undefined = match[1];
      if (name !== undefined) {
        namedValues.add(name.trim());
      }
    }
  }

  return {
    valueSets: [...valueSets].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    namedValues: [...namedValues].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
  };
}

export function emitDynamicSetsSource(sets: ImportedDynamicSets): string {
  const valueSetEntries: string = sets.valueSets
    .map((id) => `  { id: ${JSON.stringify(id)}, key: anyKey(), value: primitive("scalar") },`)
    .join("\n");
  const namedValueEntries: string = sets.namedValues
    .map((id) => `  { id: ${JSON.stringify(id)}, value: primitive("number") },`)
    .join("\n");

  return [
    "// Generated by `npm run import:cwt` from cwtools-stellaris-config, then maintained by hand.",
    "// Value sets and named values are declared by usage; this is the collected name list.",
    "",
    'import { anyKey, primitive } from "./ir.js";',
    'import type { NamedValueDefinition, ValueSetDefinition } from "./ir.js";',
    "",
    "export const valueSets: readonly ValueSetDefinition[] = [",
    valueSetEntries,
    "];",
    "",
    "export const namedValues: readonly NamedValueDefinition[] = [",
    namedValueEntries,
    "];",
    "",
  ].join("\n");
}
