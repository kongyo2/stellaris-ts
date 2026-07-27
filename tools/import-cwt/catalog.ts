import { NodeKind, type Assignment, type Block, type EntryNode, type Scalar } from "../../src/syntax/index.js";
import type { CwtCorpus, CwtReadResult } from "./model.js";

export interface ImportedScope {
  readonly id: string;
  readonly aliases: readonly string[];
  readonly displayName: string;
}

export interface ImportedCatalog {
  readonly definitionTypeIds: readonly string[];
  readonly enumIds: readonly string[];
  readonly scopes: readonly ImportedScope[];
}

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

function snakeCase(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .toLowerCase();
}

function collectDeclarationIds(corpus: CwtCorpus, wrapper: string, heads: ReadonlySet<string>): string[] {
  const ids: string[] = [];

  for (const file of corpus.files) {
    for (const rootEntry of file.document.entries) {
      if (
        rootEntry.kind !== NodeKind.Assignment ||
        originalKey(file, rootEntry) !== wrapper ||
        rootEntry.value.kind !== NodeKind.Block
      ) {
        continue;
      }

      for (const declaration of directAssignments(rootEntry.value)) {
        const key: string | undefined = originalKey(file, declaration);
        const construct: BracketConstruct | undefined = key === undefined ? undefined : bracketConstruct(key);
        if (construct !== undefined && heads.has(construct.head) && declaration.value.kind === NodeKind.Block) {
          ids.push(construct.argument);
        }
      }
    }
  }

  return [...new Set(ids)].sort(compareOrdinal);
}

function collectScopes(corpus: CwtCorpus): ImportedScope[] {
  const scopes: ImportedScope[] = [];

  for (const file of corpus.files) {
    for (const rootEntry of file.document.entries) {
      if (
        rootEntry.kind !== NodeKind.Assignment ||
        originalKey(file, rootEntry) !== "scopes" ||
        rootEntry.value.kind !== NodeKind.Block
      ) {
        continue;
      }

      for (const scopeEntry of directAssignments(rootEntry.value)) {
        if (scopeEntry.value.kind !== NodeKind.Block) {
          continue;
        }

        const aliasesEntry: Assignment | undefined = directAssignments(scopeEntry.value).find(
          (entry) => originalKey(file, entry) === "aliases",
        );
        if (aliasesEntry?.value.kind !== NodeKind.Block) {
          continue;
        }

        const aliases: readonly string[] = scalarEntries(aliasesEntry.value).map((entry) => String(entry.value));
        const displayNameValue: string | undefined = originalKey(file, scopeEntry);
        if (displayNameValue === undefined) {
          continue;
        }

        const displayName: string = displayNameValue.replace(/^"|"$/gu, "");
        const preferredId: string = snakeCase(displayName);
        const id: string | undefined = aliases.find((alias) => alias.toLowerCase() === preferredId) ?? aliases[0];
        if (id === undefined) {
          continue;
        }

        scopes.push({
          id,
          aliases: [...new Set(aliases)],
          displayName,
        });
      }
    }
  }

  return scopes.sort((left, right) => compareOrdinal(left.id, right.id));
}

export function extractImportedCatalog(corpus: CwtCorpus): ImportedCatalog {
  return {
    definitionTypeIds: collectDeclarationIds(corpus, "types", new Set(["type"])),
    enumIds: collectDeclarationIds(corpus, "enums", new Set(["complex_enum", "enum"])),
    scopes: collectScopes(corpus),
  };
}

function propertyBase(value: string): string {
  const parts: readonly string[] = value.split(/[^A-Za-z0-9]+/u).filter((part) => part.length > 0);
  const joined: string = parts
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join("");
  const prefixed: string = /^[A-Za-z_$]/u.test(joined) ? joined : `Value${joined}`;
  return prefixed.length === 0 ? "Value" : prefixed;
}

function objectProperties(values: readonly string[]): readonly { readonly name: string; readonly value: string }[] {
  const used = new Map<string, number>();

  return values.map((value) => {
    const base: string = propertyBase(value);
    const next: number = (used.get(base) ?? 0) + 1;
    used.set(base, next);
    return { name: next === 1 ? base : `${base}${String(next)}`, value };
  });
}

function emitIdObject(name: string, values: readonly string[]): string {
  const properties: readonly { readonly name: string; readonly value: string }[] = objectProperties(values);
  const body: string = properties
    .map((property) => `  readonly ${property.name}: ${JSON.stringify(property.value)};`)
    .join("\n");
  const valueBody: string = properties
    .map((property) => `  ${property.name}: ${JSON.stringify(property.value)},`)
    .join("\n");

  return [
    `export const ${name}: {`,
    body,
    `} = {`,
    valueBody,
    `} as const;`,
    "",
    `export type ${name} = (typeof ${name})[keyof typeof ${name}];`,
  ].join("\n");
}

export function emitCatalogSource(catalog: ImportedCatalog): string {
  return [
    emitIdObject("DefinitionTypeId", catalog.definitionTypeIds),
    "",
    emitIdObject("EnumId", catalog.enumIds),
    "",
    emitIdObject(
      "ScopeId",
      catalog.scopes.map((scope) => scope.id),
    ),
    "",
  ].join("\n");
}
