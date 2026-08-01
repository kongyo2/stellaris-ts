import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";

import {
  NodeKind,
  parse,
  tokenize,
  TokenKind,
  type Block,
  type Document,
  type EntryNode,
  type LexOptions,
  type Span,
  type Token,
  type ValueNode,
} from "../../src/syntax/index.js";

/**
 * `.cwt` is a dialect, not script.
 *
 * cwtools' schema language writes `alias[trigger:x] == <y>` — 227 times in
 * `triggers.cwt` alone — and the game has no `==` at all. Reading the corpus
 * needs the operator; writing script must never produce one, which is why it
 * is an option rather than a feature of the lexer.
 */
const CWT_DIALECT: LexOptions = { equalsEquals: true };
import {
  CwtDirectiveName,
  type CwtAnnotatedEntry,
  type CwtAnnotation,
  type CwtConstruct,
  type CwtCorpus,
  type CwtCorpusMetrics,
  type CwtDirective,
  type CwtDirectiveName as CwtDirectiveNameType,
  type CwtDocumentation,
  type CwtFileMetrics,
  type CwtPreservedComment,
  type CwtReaderDiagnostic,
  type CwtReadResult,
} from "./model.js";
import { prepareCwtSource, type CwtPreparedSource, type CwtRewrite } from "./prepare.js";

interface EntryTarget {
  readonly depth: number;
  readonly entry: EntryNode;
}

interface MutableEntryMetadata {
  readonly leading: CwtAnnotation[];
  readonly trailing: CwtAnnotation[];
}

interface AnnotationClassification {
  readonly annotation?: CwtAnnotation;
  readonly diagnostic?: CwtReaderDiagnostic;
}

interface ParsedBracketConstruct {
  readonly argument: string;
  readonly head: string;
}

const directiveNames: ReadonlySet<string> = new Set<string>(Object.values(CwtDirectiveName));

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

function countNewlines(source: string): number {
  let count = 0;

  for (const character of source) {
    if (character === "\n") {
      count += 1;
    }
  }

  return count;
}

function isDirectiveName(value: string): value is CwtDirectiveNameType {
  return directiveNames.has(value);
}

function collectValueTargets(value: ValueNode, depth: number, targets: EntryTarget[]): void {
  switch (value.kind) {
    case NodeKind.Block:
      collectEntryTargets(value.entries, depth, targets);
      return;
    case NodeKind.OptionalBlock:
      collectEntryTargets(value.entries, depth, targets);
      return;
    case NodeKind.PrefixedBlock:
      collectEntryTargets(value.block.entries, depth, targets);
      return;
    case NodeKind.Error:
    case NodeKind.InlineMath:
    case NodeKind.Scalar:
      return;
    default:
      return;
  }
}

function collectEntryTargets(entries: readonly EntryNode[], depth: number, targets: EntryTarget[]): void {
  for (const entry of entries) {
    if (entry.kind === NodeKind.Trivia) {
      continue;
    }

    targets.push({ depth, entry });

    switch (entry.kind) {
      case NodeKind.Assignment:
        collectValueTargets(entry.value, depth + 1, targets);
        break;
      case NodeKind.Block:
        collectEntryTargets(entry.entries, depth + 1, targets);
        break;
      case NodeKind.OptionalBlock:
        collectEntryTargets(entry.entries, depth + 1, targets);
        break;
      case NodeKind.PrefixedBlock:
        collectEntryTargets(entry.block.entries, depth + 1, targets);
        break;
      case NodeKind.Error:
      case NodeKind.InlineMath:
      case NodeKind.Scalar:
        break;
      default:
        break;
    }
  }
}

function isFullLineComment(source: string, token: Token): boolean {
  const precedingNewline: number = source.lastIndexOf("\n", token.span.start.offset - 1);
  const lineStart: number = precedingNewline < 0 ? 0 : precedingNewline + 1;
  return /^[\t ]*$/u.test(source.slice(lineStart, token.span.start.offset));
}

function documentationFromToken(token: Token): CwtDocumentation {
  return {
    kind: "documentation",
    text: token.text.replace(/^#{3,}[\t ]?/u, ""),
    rawText: token.text,
    span: token.span,
  };
}

function preservedCommentFromToken(token: Token): CwtPreservedComment {
  return {
    kind: "comment",
    text: token.text.slice(2).trimStart(),
    rawText: token.text,
    span: token.span,
  };
}

function directiveFromParts(
  token: Token,
  name: CwtDirectiveNameType,
  operator: CwtDirective["operator"],
  value: string | null,
): CwtDirective {
  return {
    kind: "directive",
    name,
    operator,
    value,
    rawText: token.text,
    span: token.span,
  };
}

function unknownDirectiveDiagnostic(path: string, token: Token, name: string): CwtReaderDiagnostic {
  return {
    category: "unknown-syntax",
    code: "unknown-directive",
    message: `Unknown CWT directive ${JSON.stringify(name)}.`,
    path,
    span: token.span,
  };
}

function classifyAnnotation(path: string, token: Token, fullLine: boolean): AnnotationClassification {
  if (token.text.startsWith("###")) {
    return { annotation: documentationFromToken(token) };
  }

  if (!token.text.startsWith("##") || token.text.startsWith("###")) {
    return {};
  }

  if (!fullLine) {
    return { annotation: preservedCommentFromToken(token) };
  }

  const payload: string = token.text.slice(2).trimStart();
  const legacyCardinalityMatch: RegExpExecArray | null = /^cardinality[\t ]+(.+)$/u.exec(payload);

  if (legacyCardinalityMatch !== null) {
    return {
      annotation: directiveFromParts(
        token,
        CwtDirectiveName.Cardinality,
        "legacy-space",
        legacyCardinalityMatch[1] ?? "",
      ),
    };
  }

  const directiveMatch: RegExpExecArray | null = /^([A-Za-z_][A-Za-z0-9_]*)(?:[\t ]*(=|<>)[\t ]*(.*))?$/u.exec(payload);

  if (directiveMatch === null) {
    return { annotation: preservedCommentFromToken(token) };
  }

  const name: string = directiveMatch[1] ?? "";
  if (!isDirectiveName(name)) {
    const hasDirectiveShape: boolean = directiveMatch[2] !== undefined || /^[A-Za-z_][A-Za-z0-9_]*$/u.test(payload);
    return hasDirectiveShape
      ? { diagnostic: unknownDirectiveDiagnostic(path, token, name) }
      : { annotation: preservedCommentFromToken(token) };
  }

  const rawOperator: string | undefined = directiveMatch[2];
  if (rawOperator === undefined) {
    return { annotation: directiveFromParts(token, name, "bare", null) };
  }

  return {
    annotation: directiveFromParts(token, name, rawOperator === "<>" ? "<>" : "=", directiveMatch[3] ?? ""),
  };
}

function metadataForTarget(metadata: Map<EntryNode, MutableEntryMetadata>, target: EntryTarget): MutableEntryMetadata {
  const existing: MutableEntryMetadata | undefined = metadata.get(target.entry);

  if (existing !== undefined) {
    return existing;
  }

  const created: MutableEntryMetadata = { leading: [], trailing: [] };
  metadata.set(target.entry, created);
  return created;
}

function findLeadingTarget(targets: readonly EntryTarget[], token: Token): EntryTarget | undefined {
  return targets.find((target) => target.entry.span.start.offset >= token.span.end.offset);
}

function findTrailingTarget(targets: readonly EntryTarget[], token: Token): EntryTarget | undefined {
  const containing: readonly EntryTarget[] = targets.filter(
    (target) =>
      target.entry.span.start.offset <= token.span.start.offset &&
      target.entry.span.end.offset >= token.span.end.offset,
  );

  if (containing.length > 0) {
    return containing.reduce((selected, target) => (target.depth > selected.depth ? target : selected));
  }

  const precedingOnLine: readonly EntryTarget[] = targets.filter(
    (target) =>
      target.entry.span.end.offset <= token.span.start.offset && target.entry.span.end.line === token.span.start.line,
  );

  return precedingOnLine.at(-1);
}

function annotatedEntries(
  prepared: CwtPreparedSource,
  document: Document,
): {
  readonly diagnostics: readonly CwtReaderDiagnostic[];
  readonly entries: readonly CwtAnnotatedEntry[];
} {
  const targets: EntryTarget[] = [];
  collectEntryTargets(document.entries, 0, targets);
  targets.sort(
    (left, right) =>
      left.entry.span.start.offset - right.entry.span.start.offset ||
      right.depth - left.depth ||
      left.entry.span.end.offset - right.entry.span.end.offset,
  );

  const metadata = new Map<EntryNode, MutableEntryMetadata>();
  const diagnostics: CwtReaderDiagnostic[] = [];
  const tokens: readonly Token[] = tokenize(prepared.parseSource, CWT_DIALECT).tokens;

  for (const token of tokens) {
    if (token.kind !== TokenKind.Comment || !token.text.startsWith("##")) {
      continue;
    }

    const fullLine: boolean = isFullLineComment(prepared.original, token);
    const classification: AnnotationClassification = classifyAnnotation(prepared.path, token, fullLine);

    if (classification.diagnostic !== undefined) {
      diagnostics.push(classification.diagnostic);
      continue;
    }

    if (classification.annotation === undefined) {
      continue;
    }

    const target: EntryTarget | undefined = fullLine
      ? findLeadingTarget(targets, token)
      : findTrailingTarget(targets, token);

    if (target === undefined) {
      diagnostics.push({
        category: "orphan-annotation",
        code: "orphan-annotation",
        message: "CWT annotation does not have an adjacent syntax entry.",
        path: prepared.path,
        span: token.span,
      });
      continue;
    }

    const entryMetadata: MutableEntryMetadata = metadataForTarget(metadata, target);
    (fullLine ? entryMetadata.leading : entryMetadata.trailing).push(classification.annotation);
  }

  const entries: CwtAnnotatedEntry[] = targets.map((target): CwtAnnotatedEntry => {
    const entryMetadata: MutableEntryMetadata | undefined = metadata.get(target.entry);

    return {
      syntax: target.entry,
      originalText: prepared.original.slice(target.entry.span.start.offset, target.entry.span.end.offset),
      leading: entryMetadata?.leading ?? [],
      trailing: entryMetadata?.trailing ?? [],
    };
  });

  return { diagnostics, entries };
}

function parsedBracketConstruct(rewrite: CwtRewrite): ParsedBracketConstruct | undefined {
  if (rewrite.kind === "angle-reference") {
    return {
      head: "<>",
      argument: rewrite.originalText.slice(1, -1),
    };
  }

  const openBracket: number = rewrite.originalText.indexOf("[");
  if (openBracket <= 0) {
    return undefined;
  }

  const hasCloseBracket: boolean = rewrite.originalText.endsWith("]");
  const argumentEnd: number = hasCloseBracket ? rewrite.originalText.length - 1 : rewrite.originalText.length;

  return {
    head: rewrite.originalText.slice(0, openBracket),
    argument: rewrite.originalText.slice(openBracket + 1, argumentEnd).trimEnd(),
  };
}

function constructsFromPreparedSource(prepared: CwtPreparedSource): CwtConstruct[] {
  return prepared.rewrites.flatMap((rewrite): CwtConstruct[] => {
    const parsedConstruct: ParsedBracketConstruct | undefined = parsedBracketConstruct(rewrite);
    if (parsedConstruct === undefined) {
      return [];
    }

    return [
      {
        head: parsedConstruct.head,
        argument: parsedConstruct.argument,
        rawText: rewrite.originalText,
        recovered: rewrite.kind === "recovered-bracket-atom",
        span: rewrite.span,
      },
    ];
  });
}

function diagnosticsFromPreparedSource(prepared: CwtPreparedSource): CwtReaderDiagnostic[] {
  return prepared.diagnostics.map((diagnostic): CwtReaderDiagnostic => ({
    category: diagnostic.category,
    code: diagnostic.code,
    message: diagnostic.message,
    path: prepared.path,
    span: diagnostic.span,
  }));
}

function countAnnotations(entries: readonly CwtAnnotatedEntry[]): {
  readonly annotations: number;
  readonly documentation: number;
} {
  let annotations = 0;
  let documentation = 0;

  for (const entry of entries) {
    for (const annotation of [...entry.leading, ...entry.trailing]) {
      annotations += 1;
      if (annotation.kind === "documentation") {
        documentation += 1;
      }
    }
  }

  return { annotations, documentation };
}

export function readCwtSource(path: string, source: string): CwtReadResult {
  const prepared: CwtPreparedSource = prepareCwtSource(path, source);
  const parseResult = parse(prepared.parseSource, CWT_DIALECT);
  const annotated = annotatedEntries(prepared, parseResult.document);
  const diagnostics: CwtReaderDiagnostic[] = [
    ...diagnosticsFromPreparedSource(prepared),
    ...parseResult.diagnostics.map((diagnostic): CwtReaderDiagnostic => ({
      category: "l0-diagnostic",
      code: diagnostic.code,
      message: diagnostic.message,
      path,
      span: diagnostic.span,
    })),
    ...annotated.diagnostics,
  ];
  const constructs: CwtConstruct[] = constructsFromPreparedSource(prepared);
  const annotationCounts = countAnnotations(annotated.entries);
  const metrics: CwtFileMetrics = {
    annotationCount: annotationCounts.annotations,
    constructCount: constructs.length,
    documentationCount: annotationCounts.documentation,
    lineCount: countNewlines(source),
    l0DiagnosticCount: diagnostics.filter((diagnostic) => diagnostic.category === "l0-diagnostic").length,
    orphanAnnotationCount: diagnostics.filter((diagnostic) => diagnostic.category === "orphan-annotation").length,
    recoveryCount: diagnostics.filter((diagnostic) => diagnostic.category === "recovery").length,
    unknownSyntaxCount: diagnostics.filter((diagnostic) => diagnostic.category === "unknown-syntax").length,
  };

  return {
    source: prepared,
    document: parseResult.document,
    entries: annotated.entries,
    constructs,
    diagnostics,
    metrics,
  };
}

async function collectCwtFiles(directory: string): Promise<string[]> {
  const directoryEntries = await readdir(directory, { withFileTypes: true });
  directoryEntries.sort((left, right) => compareOrdinal(left.name, right.name));

  const groups: string[][] = await Promise.all(
    directoryEntries.map(async (entry): Promise<string[]> => {
      const entryPath: string = join(directory, entry.name);

      if (entry.isDirectory()) {
        return collectCwtFiles(entryPath);
      }

      return entry.isFile() && extname(entry.name).toLowerCase() === ".cwt" ? [entryPath] : [];
    }),
  );

  return groups.flat();
}

function originalScalarText(file: CwtReadResult, span: Span): string {
  return file.source.original.slice(span.start.offset, span.end.offset);
}

function assignmentKey(file: CwtReadResult, entry: EntryNode): string | undefined {
  return entry.kind === NodeKind.Assignment ? originalScalarText(file, entry.key.span).trim() : undefined;
}

function parseBracketText(rawText: string): ParsedBracketConstruct | undefined {
  const openBracket: number = rawText.indexOf("[");
  if (openBracket <= 0) {
    return undefined;
  }

  const closeBracket: number = rawText.lastIndexOf("]");
  const argumentEnd: number = closeBracket > openBracket ? closeBracket : rawText.length;

  return {
    head: rawText.slice(0, openBracket),
    argument: rawText.slice(openBracket + 1, argumentEnd).trim(),
  };
}

function annotatedEntryForSyntax(file: CwtReadResult, entry: EntryNode): CwtAnnotatedEntry | undefined {
  return file.entries.find((annotated) => annotated.syntax === entry);
}

function directAssignments(block: Block): readonly EntryNode[] {
  return block.entries.filter((entry) => entry.kind === NodeKind.Assignment);
}

function typeCounts(files: readonly CwtReadResult[]): {
  readonly definitions: number;
  readonly names: number;
  readonly subtypeConstructs: number;
  readonly subtypeDefinitions: number;
  readonly subtypeDefinitionOwners: number;
  readonly subtypeLocalisationReferences: number;
  readonly subtypeReferences: number;
  readonly subtypeSchemaNestedSelectors: number;
  readonly subtypeSchemaRootSelectors: number;
  readonly typeKeySubtypeDefinitions: number;
} {
  let definitions = 0;
  let subtypeDefinitions = 0;
  let subtypeDefinitionOwners = 0;
  let subtypeLocalisationReferences = 0;
  let subtypeSchemaRootSelectors = 0;
  let typeKeySubtypeDefinitions = 0;
  const typeNames = new Set<string>();
  const subtypeConstructs: number = files.reduce(
    (sum, file) => sum + file.constructs.filter((construct) => construct.head === "subtype").length,
    0,
  );

  for (const file of files) {
    for (const rootEntry of file.document.entries) {
      if (
        assignmentKey(file, rootEntry) !== "types" ||
        rootEntry.kind !== NodeKind.Assignment ||
        rootEntry.value.kind !== NodeKind.Block
      ) {
        continue;
      }

      for (const typeEntry of directAssignments(rootEntry.value)) {
        const typeKey: string | undefined = assignmentKey(file, typeEntry);
        if (
          typeKey === undefined ||
          parseBracketText(typeKey)?.head !== "type" ||
          typeEntry.kind !== NodeKind.Assignment ||
          typeEntry.value.kind !== NodeKind.Block
        ) {
          continue;
        }

        definitions += 1;
        const parsedType: ParsedBracketConstruct | undefined = parseBracketText(typeKey);
        if (parsedType !== undefined) {
          typeNames.add(parsedType.argument);
        }
        let ownsSubtype = false;

        for (const subtypeEntry of directAssignments(typeEntry.value)) {
          const subtypeKey: string | undefined = assignmentKey(file, subtypeEntry);
          if (subtypeKey === undefined || parseBracketText(subtypeKey)?.head !== "subtype") {
            if (
              subtypeKey === "localisation" &&
              subtypeEntry.kind === NodeKind.Assignment &&
              subtypeEntry.value.kind === NodeKind.Block
            ) {
              subtypeLocalisationReferences += directAssignments(subtypeEntry.value).filter((entry) => {
                const key: string | undefined = assignmentKey(file, entry);
                return key !== undefined && parseBracketText(key)?.head === "subtype";
              }).length;
            }
            continue;
          }

          ownsSubtype = true;
          subtypeDefinitions += 1;
          const metadata: CwtAnnotatedEntry | undefined = annotatedEntryForSyntax(file, subtypeEntry);
          if (
            metadata?.leading.some(
              (annotation) => annotation.kind === "directive" && annotation.name === CwtDirectiveName.TypeKeyFilter,
            ) === true
          ) {
            typeKeySubtypeDefinitions += 1;
          }
        }

        if (ownsSubtype) {
          subtypeDefinitionOwners += 1;
        }
      }
    }

    for (const rootEntry of file.document.entries) {
      if (
        rootEntry.kind !== NodeKind.Assignment ||
        rootEntry.value.kind !== NodeKind.Block ||
        assignmentKey(file, rootEntry) === "types"
      ) {
        continue;
      }

      subtypeSchemaRootSelectors += directAssignments(rootEntry.value).filter((entry) => {
        const key: string | undefined = assignmentKey(file, entry);
        return key !== undefined && parseBracketText(key)?.head === "subtype";
      }).length;
    }
  }

  const subtypeReferences: number = subtypeConstructs - subtypeDefinitions;
  const subtypeSchemaNestedSelectors: number =
    subtypeReferences - subtypeLocalisationReferences - subtypeSchemaRootSelectors;

  return {
    definitions,
    names: typeNames.size,
    subtypeConstructs,
    subtypeDefinitions,
    subtypeDefinitionOwners,
    subtypeLocalisationReferences,
    subtypeReferences,
    subtypeSchemaNestedSelectors,
    subtypeSchemaRootSelectors,
    typeKeySubtypeDefinitions,
  };
}

function enumCounts(files: readonly CwtReadResult[]): {
  readonly complexDeclarations: number;
  readonly complexNames: number;
  readonly declaredNames: number;
  readonly staticDeclarations: number;
  readonly staticNames: number;
  readonly syntaxNames: number;
  readonly syntaxOccurrences: number;
} {
  const staticEnumNames = new Set<string>();
  const complexEnumNames = new Set<string>();
  const syntaxEnumNames = new Set<string>();
  let staticDeclarations = 0;
  let complexDeclarations = 0;
  let syntaxOccurrences = 0;

  for (const file of files) {
    for (const rewrite of file.source.rewrites) {
      for (const match of rewrite.originalText.matchAll(/(?:^|[^A-Za-z0-9_])(?:\.)?enum\[([^\]]+)\]/gu)) {
        const name: string | undefined = match[1];
        if (name !== undefined) {
          syntaxOccurrences += 1;
          syntaxEnumNames.add(name.trim());
        }
      }
    }

    for (const rootEntry of file.document.entries) {
      if (
        rootEntry.kind !== NodeKind.Assignment ||
        rootEntry.value.kind !== NodeKind.Block ||
        assignmentKey(file, rootEntry) !== "enums"
      ) {
        continue;
      }

      for (const declaration of directAssignments(rootEntry.value)) {
        const key: string | undefined = assignmentKey(file, declaration);
        if (
          key === undefined ||
          declaration.kind !== NodeKind.Assignment ||
          declaration.value.kind !== NodeKind.Block
        ) {
          continue;
        }

        const construct: ParsedBracketConstruct | undefined = parseBracketText(key);
        if (construct?.head === "enum") {
          staticDeclarations += 1;
          staticEnumNames.add(construct.argument);
        } else if (construct?.head === "complex_enum") {
          complexDeclarations += 1;
          complexEnumNames.add(construct.argument);
        }
      }
    }
  }

  return {
    complexDeclarations,
    complexNames: complexEnumNames.size,
    declaredNames: new Set<string>([...staticEnumNames, ...complexEnumNames]).size,
    staticDeclarations,
    staticNames: staticEnumNames.size,
    syntaxNames: syntaxEnumNames.size,
    syntaxOccurrences,
  };
}

function aliasNames(file: CwtReadResult, category: "effect" | "trigger"): string[] {
  return file.constructs.flatMap((construct): string[] =>
    construct.head === "alias" && construct.argument.startsWith(`${category}:`)
      ? [construct.argument.slice(category.length + 1)]
      : [],
  );
}

function countBlocks(block: Block): number {
  let count = 1;

  for (const entry of block.entries) {
    if (entry.kind === NodeKind.Assignment && entry.value.kind === NodeKind.Block) {
      count += countBlocks(entry.value);
    } else if (entry.kind === NodeKind.Block) {
      count += countBlocks(entry);
    }
  }

  return count;
}

function linkCounts(files: readonly CwtReadResult[]): {
  readonly blocks: number;
  readonly declarations: number;
  readonly names: number;
} {
  let blocks = 0;
  let declarations = 0;
  const names = new Set<string>();

  for (const file of files) {
    for (const entry of file.document.entries) {
      if (
        assignmentKey(file, entry) === "links" &&
        entry.kind === NodeKind.Assignment &&
        entry.value.kind === NodeKind.Block
      ) {
        blocks += countBlocks(entry.value);
        const links: readonly EntryNode[] = directAssignments(entry.value);
        declarations += links.length;
        for (const link of links) {
          const name: string | undefined = assignmentKey(file, link);
          if (name !== undefined) {
            names.add(name);
          }
        }
      }
    }
  }

  return { blocks, declarations, names: names.size };
}

function scopeCount(files: readonly CwtReadResult[]): number {
  let count = 0;

  for (const file of files) {
    for (const entry of file.document.entries) {
      if (
        assignmentKey(file, entry) === "scopes" &&
        entry.kind === NodeKind.Assignment &&
        entry.value.kind === NodeKind.Block
      ) {
        count += directAssignments(entry.value).length;
      }
    }
  }

  return count;
}

export function measureCwtFiles(files: readonly CwtReadResult[]): CwtCorpusMetrics {
  const types = typeCounts(files);
  const enums = enumCounts(files);
  const links = linkCounts(files);
  const triggerFile: CwtReadResult | undefined = files.find(
    (file) => basename(file.source.path).toLowerCase() === "triggers.cwt",
  );
  const effectFile: CwtReadResult | undefined = files.find(
    (file) => basename(file.source.path).toLowerCase() === "effects.cwt",
  );
  const triggerAliases: readonly string[] = files.flatMap((file) => aliasNames(file, "trigger"));
  const effectAliases: readonly string[] = files.flatMap((file) => aliasNames(file, "effect"));

  return {
    annotationCount: files.reduce((sum, file) => sum + file.metrics.annotationCount, 0),
    complexEnumDeclarationCount: enums.complexDeclarations,
    complexEnumNameCount: enums.complexNames,
    declaredEnumNameCount: enums.declaredNames,
    documentationCount: files.reduce((sum, file) => sum + file.metrics.documentationCount, 0),
    effectAliasDeclarationCount: effectAliases.length,
    effectAliasNameCount: new Set<string>(effectAliases).size,
    enumSyntaxNameCount: enums.syntaxNames,
    enumSyntaxOccurrenceCount: enums.syntaxOccurrences,
    fileCount: files.length,
    lineCount: files.reduce((sum, file) => sum + file.metrics.lineCount, 0),
    linkBlockCount: links.blocks,
    linkDeclarationCount: links.declarations,
    linkNameCount: links.names,
    l0DiagnosticCount: files.reduce((sum, file) => sum + file.metrics.l0DiagnosticCount, 0),
    orphanAnnotationCount: files.reduce((sum, file) => sum + file.metrics.orphanAnnotationCount, 0),
    primaryEffectAliasDeclarationCount: effectFile === undefined ? 0 : aliasNames(effectFile, "effect").length,
    primaryTriggerAliasDeclarationCount: triggerFile === undefined ? 0 : aliasNames(triggerFile, "trigger").length,
    recoveryCount: files.reduce((sum, file) => sum + file.metrics.recoveryCount, 0),
    scopeCount: scopeCount(files),
    staticEnumDeclarationCount: enums.staticDeclarations,
    staticEnumNameCount: enums.staticNames,
    subtypeConstructCount: types.subtypeConstructs,
    subtypeDefinitionCount: types.subtypeDefinitions,
    subtypeDefinitionOwnerCount: types.subtypeDefinitionOwners,
    subtypeLocalisationReferenceCount: types.subtypeLocalisationReferences,
    subtypeReferenceCount: types.subtypeReferences,
    subtypeSchemaNestedSelectorCount: types.subtypeSchemaNestedSelectors,
    subtypeSchemaRootSelectorCount: types.subtypeSchemaRootSelectors,
    triggerAliasDeclarationCount: triggerAliases.length,
    triggerAliasNameCount: new Set<string>(triggerAliases).size,
    typeDefinitionCount: types.definitions,
    typeKeySubtypeDefinitionCount: types.typeKeySubtypeDefinitions,
    typeNameCount: types.names,
    unknownSyntaxCount: files.reduce((sum, file) => sum + file.metrics.unknownSyntaxCount, 0),
  };
}

export async function readCwtCorpus(configDirectory: string): Promise<CwtCorpus> {
  const paths: readonly string[] = await collectCwtFiles(configDirectory);
  const files: CwtReadResult[] = await Promise.all(
    paths.map(async (path): Promise<CwtReadResult> => {
      const source: string = await readFile(path, "utf8");
      const displayPath: string = toPortablePath(relative(configDirectory, path));
      return readCwtSource(displayPath, source);
    }),
  );

  files.sort((left, right) => compareOrdinal(left.source.path, right.source.path));

  return {
    files,
    metrics: measureCwtFiles(files),
  };
}
