import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, relative } from "node:path";

import { extractedEnumMembers, vanillaIdsByType, vanillaModifierNames } from "../../src/generated/vanilla/index.js";
import { expandModifierNames } from "../../src/schema/modifier-namespace.js";
import { isScopeKey, isSyntacticKey, scopeEntryNames, scriptBlockNames } from "../../src/schema/script-keys.js";
import { NodeKind, parse, type Block, type Document } from "../../src/syntax/index.js";
import type { DefinitionType, EntryRule, EnumDefinition, KeyRule, SchemaModel } from "../../src/schema/ir.js";

/**
 * Checks the schema against the installed game rather than against cwt.
 *
 * cwtools-stellaris-config is a porting source, not an oracle (PLAN.md §0.1).
 * Vanilla is: 2,214 files that the game actually loads. This reports both
 * directions of disagreement —
 *
 *   A. the schema rejects a field vanilla really uses  → a hole in the schema
 *   B. the schema requires a field vanilla never uses  → a phantom rule
 *
 * A type whose rules accept arbitrary keys cannot produce direction A at all,
 * so its verdict is reported as `permissive` rather than silently passing.
 */

/**
 * Definition directories are not all script directories — `flags/` holds `.dds`
 * images, `sound/` holds audio. Allow only what the game parses as script; a
 * denylist would silently start reading binaries the day a type points at one.
 * The empty string covers `common/inline_scripts`, whose files carry no
 * extension because the game references them by bare path.
 */
const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set(["", ".txt", ".gui", ".gfx", ".asset", ".sound"]);

/** Vanilla has ~2,200 script files; opening them all at once exhausts the fd table. */
const READ_CONCURRENCY = 32;

async function mapWithLimit<Item, Result>(
  items: readonly Item[],
  limit: number,
  handler: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = new Array<Result>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index: number = next;
      next += 1;
      const item: Item | undefined = items[index];

      if (item === undefined) {
        return;
      }

      // Sequential by design: this loop is one of a fixed number of workers, and
      // awaiting here is what bounds concurrency. Parallelising it would restore
      // the unbounded fan-out that exhausts the file-descriptor table.
      // oxlint-disable-next-line no-await-in-loop
      results[index] = await handler(item);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export interface FieldFinding {
  readonly type: string;
  readonly field: string;
  readonly occurrences: number;
  readonly examples: readonly string[];
}

export interface TypeReport {
  readonly type: string;
  readonly directory: string;
  readonly sourceKind: string;
  readonly strictness: "permissive" | "strict";
  readonly definitionsSeen: number;
  readonly filesSeen: number;
  readonly unknownFields: readonly FieldFinding[];
  readonly unusedRules: readonly string[];
}

export interface ConformanceReport {
  readonly types: readonly TypeReport[];
  readonly missingDirectories: readonly string[];
  readonly unknownFieldTotal: number;
  readonly unusedRuleTotal: number;
  readonly strictTypeCount: number;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function collectFiles(directory: string, recurse: boolean): Promise<string[]> {
  let entries: readonly Dirent[];

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const groups: string[][] = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const path: string = join(directory, entry.name);

      if (entry.isDirectory()) {
        return recurse ? collectFiles(path, recurse) : [];
      }

      const dot: number = entry.name.lastIndexOf(".");
      const extension: string = dot < 0 ? "" : entry.name.slice(dot).toLowerCase();
      return entry.isFile() && SCRIPT_EXTENSIONS.has(extension) ? [path] : [];
    }),
  );

  return groups.flat();
}

interface KeyAcceptor {
  readonly wildcard: boolean;
  readonly literals: ReadonlySet<string>;
  /** Names matched without regard to case; held lowercased. */
  readonly insensitive: ReadonlySet<string>;
  /** Whether a chained or run-time scope — `root.owner`, `event_target:x` — is a key here. */
  readonly scopeKeys: boolean;
  readonly prefixes: readonly { readonly prefix: string; readonly suffix: string }[];
}

interface AcceptorDraft {
  wildcard: boolean;
  scopeKeys: boolean;
  readonly literals: Set<string>;
  readonly insensitive: Set<string>;
  readonly prefixes: { prefix: string; suffix: string }[];
}

/**
 * An extracted enum's members live in the game's own script, so they are only
 * knowable after `npm run index:game`. Without them every key drawn from one
 * has to be treated as accepting anything.
 */
function enumValues(model: SchemaModel, id: string): readonly string[] {
  const definition: EnumDefinition | undefined = model.enums.find((candidate) => candidate.id === id);

  if (definition === undefined) {
    return [];
  }

  return definition.kind === "static-enum" ? definition.values : (extractedEnumMembers[id] ?? []);
}

function collectKey(model: SchemaModel, key: KeyRule, into: AcceptorDraft): void {
  if (typeof key === "string") {
    into.literals.add(key);
    return;
  }

  switch (key.kind) {
    case "enum-key": {
      const values: readonly string[] = enumValues(model, key.enum);
      if (values.length === 0) {
        into.wildcard = true;
        return;
      }
      for (const value of values) {
        into.literals.add(value);
      }
      return;
    }
    case "pattern-key":
      into.prefixes.push({ prefix: key.prefix, suffix: key.suffix });
      return;
    default:
      // any-key, type-key, value-set-key, named-value-key, scope-key,
      // scope-group-key, rule-set-key, parameter-key: all accept open sets.
      into.wildcard = true;
  }
}

function collectEntry(model: SchemaModel, entry: EntryRule, into: AcceptorDraft): void {
  switch (entry.kind) {
    case "field":
      collectKey(model, entry.key, into);
      return;
    case "variant-rules":
      for (const child of entry.entries) {
        collectEntry(model, child, into);
      }
      return;
    case "script-entries": {
      // A modifier block is keyed by modifier name. Those are a namespace of
      // their own — mostly generated from definitions, matched without regard to
      // case — so they are resolved rather than looked up among the commands.
      if (entry.family === "modifier") {
        for (const name of modifierNames(model)) {
          into.insensitive.add(name);
        }
        return;
      }

      // A trigger or effect block accepts every command declared in that
      // family, every scripted trigger or effect by name, and a scope to enter.
      // The set is known, so enumerate it rather than giving up: a wildcard here
      // is what stopped most types reporting an unknown field.
      const names: ReadonlySet<string> = scriptBlockNames(model, entry.family, vanillaIdsByType);

      if (names.size === 0) {
        into.wildcard = true;
        return;
      }

      for (const name of names) {
        into.insensitive.add(name);
      }
      into.scopeKeys = true;
      return;
    }
    case "rule-set-entries": {
      const names: readonly string[] = model.ruleSets
        .filter((ruleSet) => ruleSet.family === entry.family)
        .map((ruleSet) => ruleSet.name)
        .filter((name): name is string => name !== undefined && name.length > 0);

      if (names.length === 0) {
        into.wildcard = true;
        return;
      }

      for (const name of names) {
        into.literals.add(name);
      }
      return;
    }
    default:
      return;
  }
}

/** The modifier namespace, expanded once against what vanilla declares. */
let resolvedModifiers: ReadonlySet<string> | undefined;

function modifierNames(model: SchemaModel): ReadonlySet<string> {
  resolvedModifiers ??= expandModifierNames(model.modifiers, vanillaIdsByType, vanillaModifierNames);
  return resolvedModifiers;
}

function acceptorFor(model: SchemaModel, type: DefinitionType): KeyAcceptor {
  const into: AcceptorDraft = {
    wildcard: false,
    scopeKeys: false,
    literals: new Set<string>(),
    insensitive: new Set<string>(),
    prefixes: [],
  };

  for (const entry of type.entries) {
    collectEntry(model, entry, into);
  }

  // The global inline_script macro is legal in every block.
  for (const macro of model.policy.macros) {
    into.literals.add(macro.key);
  }

  return {
    wildcard: into.wildcard,
    scopeKeys: into.scopeKeys,
    literals: into.literals,
    insensitive: into.insensitive,
    prefixes: into.prefixes,
  };
}

function accepts(model: SchemaModel, acceptor: KeyAcceptor, key: string): boolean {
  if (
    acceptor.wildcard ||
    isSyntacticKey(key) ||
    acceptor.literals.has(key) ||
    acceptor.insensitive.has(key.toLowerCase())
  ) {
    return true;
  }

  if (acceptor.scopeKeys && isScopeKey(model, key, scopeEntryNames(model))) {
    return true;
  }

  return acceptor.prefixes.some(
    (pattern) =>
      key.length >= pattern.prefix.length + pattern.suffix.length &&
      key.startsWith(pattern.prefix) &&
      key.endsWith(pattern.suffix),
  );
}

/** The blocks a definition type claims from one parsed file. */
function definitionBlocks(model: SchemaModel, type: DefinitionType, document: Document): Block[] {
  const blocks: Block[] = [];
  const filter = type.source.rootKeyFilter;
  // `inline_script = { script = x PARAM = y }` at the root injects script; it is
  // not a definition, and counting its parameters as fields of the surrounding
  // type reports holes that do not exist.
  const macroKeys: ReadonlySet<string> = new Set(model.policy.macros.map((macro) => macro.key));

  const accept = (key: string): boolean => {
    if (filter === undefined) {
      return true;
    }
    return filter.mode === "include" ? filter.values.includes(key) : !filter.values.includes(key);
  };

  if (type.source.kind === "file-definitions") {
    const synthetic: Block = { kind: NodeKind.Block, entries: document.entries, closed: true, span: document.span };
    blocks.push(synthetic);
    return blocks;
  }

  for (const entry of document.entries) {
    if (entry.kind !== NodeKind.Assignment || entry.value.kind !== NodeKind.Block) {
      continue;
    }

    const key: string = String(entry.key.value);
    if (!accept(key) || macroKeys.has(key)) {
      continue;
    }

    const container = type.source.container;

    if (container !== undefined) {
      // A type that names a container has its definitions inside it and nowhere
      // else. Falling through to the root when the key is a different one reads
      // whatever else the file holds as definitions — 517 of the findings for
      // `portrait_group` were the settings blocks sitting beside
      // `portrait_groups` in the same file.
      if (container.kind === "any-container" || key === container.key) {
        for (const nested of entry.value.entries) {
          if (nested.kind === NodeKind.Assignment && nested.value.kind === NodeKind.Block) {
            blocks.push(nested.value);
          }
        }
      }
      continue;
    }

    blocks.push(entry.value);
  }

  return blocks;
}

function topLevelKeys(block: Block): string[] {
  const keys: string[] = [];

  for (const entry of block.entries) {
    if (entry.kind === NodeKind.Assignment) {
      keys.push(String(entry.key.value));
    }
  }

  return keys;
}

function literalRuleKeys(model: SchemaModel, type: DefinitionType): readonly string[] {
  const into: AcceptorDraft = {
    wildcard: false,
    scopeKeys: false,
    literals: new Set<string>(),
    insensitive: new Set<string>(),
    prefixes: [],
  };

  for (const entry of type.entries) {
    if (entry.kind === "field" && typeof entry.key === "string") {
      into.literals.add(entry.key);
    } else if (entry.kind === "variant-rules") {
      collectEntry(model, entry, into);
    }
  }

  return [...into.literals].sort(compareOrdinal);
}

export async function checkConformance(model: SchemaModel, gamePath: string): Promise<ConformanceReport> {
  const reports: TypeReport[] = [];
  const missingDirectories: string[] = [];

  await mapWithLimit(model.definitionTypes, 8, async (type): Promise<void> => {
    const directory: string = join(gamePath, ...type.source.directory.split("/"));
    const files: readonly string[] = await collectFiles(directory, type.source.includeSubdirectories);

    if (files.length === 0) {
      missingDirectories.push(type.source.directory);
      return;
    }

    const acceptor: KeyAcceptor = acceptorFor(model, type);
    const ruleKeys: readonly string[] = literalRuleKeys(model, type);
    const unknown = new Map<string, { count: number; examples: string[] }>();
    const seen = new Set<string>();
    let definitionsSeen = 0;

    await mapWithLimit(files, READ_CONCURRENCY, async (file): Promise<void> => {
      const source: string = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await readFile(file));
      const result = parse(source);

      if (result.diagnostics.length > 0) {
        return;
      }

      for (const block of definitionBlocks(model, type, result.document)) {
        definitionsSeen += 1;

        for (const key of topLevelKeys(block)) {
          seen.add(key);

          if (accepts(model, acceptor, key)) {
            continue;
          }

          const record = unknown.get(key) ?? { count: 0, examples: [] };
          record.count += 1;
          if (record.examples.length < 3) {
            const display: string = relative(gamePath, file).replaceAll("\\", "/");
            if (!record.examples.includes(display)) {
              record.examples.push(display);
            }
          }
          unknown.set(key, record);
        }
      }
    });

    reports.push({
      type: type.id,
      directory: type.source.directory,
      sourceKind: type.source.kind,
      strictness: acceptor.wildcard ? "permissive" : "strict",
      definitionsSeen,
      filesSeen: files.length,
      unknownFields: [...unknown.entries()]
        .map(([field, record]) => ({ type: type.id, field, occurrences: record.count, examples: record.examples }))
        .sort((left, right) => right.occurrences - left.occurrences || compareOrdinal(left.field, right.field)),
      unusedRules: ruleKeys.filter((key) => !seen.has(key)),
    });
  });

  reports.sort((left, right) => compareOrdinal(left.type, right.type));

  return {
    types: reports,
    missingDirectories: [...missingDirectories].sort(compareOrdinal),
    unknownFieldTotal: reports.reduce((total, report) => total + report.unknownFields.length, 0),
    unusedRuleTotal: reports.reduce((total, report) => total + report.unusedRules.length, 0),
    strictTypeCount: reports.filter((report) => report.strictness === "strict").length,
  };
}

/** Unused values are the schema's own claims; a wildcard type cannot report direction A. */
export function renderConformanceReport(report: ConformanceReport, gameVersion: string): string {
  const withUnknown: readonly TypeReport[] = report.types
    .filter((entry) => entry.unknownFields.length > 0)
    .sort((left, right) => right.unknownFields.length - left.unknownFields.length);
  const withUnused: readonly TypeReport[] = report.types
    .filter((entry) => entry.unusedRules.length > 0)
    .sort((left, right) => right.unusedRules.length - left.unusedRules.length);

  const lines: string[] = [
    "# Schema conformance against vanilla",
    "",
    "Generated by `npm run verify:conformance`. Do not edit by hand.",
    "",
    `Game version: ${gameVersion}`,
    "",
    "The schema was ported from cwtools-stellaris-config, which is a porting source rather than an oracle.",
    "This report checks it against what the game actually ships.",
    "",
    "- **Direction A — unknown fields**: vanilla uses a top-level field the schema rejects. Each one is a hole in the schema.",
    "- **Direction B — unused rules**: the schema declares a field vanilla never uses. Each one is a possible phantom rule.",
    "",
    "A type whose rules accept arbitrary keys (a trigger block, a pattern key, an open enum) cannot produce direction A,",
    "so it is listed as `permissive` rather than counted as clean.",
    "",
    "## Summary",
    "",
    `| | |`,
    `| --- | --- |`,
    `| definition types checked | ${String(report.types.length)} |`,
    `| strict enough to detect unknown fields | ${String(report.strictTypeCount)} |`,
    `| types with unknown fields | ${String(withUnknown.length)} |`,
    `| distinct unknown fields | ${String(report.unknownFieldTotal)} |`,
    `| types with unused rules | ${String(withUnused.length)} |`,
    `| distinct unused rules | ${String(report.unusedRuleTotal)} |`,
    `| directories absent from this install | ${String(report.missingDirectories.length)} |`,
    "",
    "### Permissive types",
    "",
    "These accept arbitrary top-level keys, so direction A cannot report anything for them. Most are waiting on the",
    "game-data indexer: a key drawn from an extracted enum only becomes checkable once that enum's members are known.",
    "",
    ...report.types.filter((entry) => entry.strictness === "permissive").map((entry) => `- \`${entry.type}\``),
    "",
    "## Direction A — fields vanilla uses that the schema rejects",
    "",
  ];

  if (withUnknown.length === 0) {
    lines.push("None.", "");
  } else {
    lines.push("| type | field | uses | example |", "| --- | --- | --- | --- |");
    for (const entry of withUnknown) {
      for (const finding of entry.unknownFields) {
        lines.push(
          `| \`${entry.type}\` | \`${finding.field}\` | ${String(finding.occurrences)} | ${finding.examples[0] ?? ""} |`,
        );
      }
    }
    lines.push("");
  }

  lines.push("## Direction B — rules vanilla never exercises", "");

  if (withUnused.length === 0) {
    lines.push("None.", "");
  } else {
    lines.push("| type | unused rules |", "| --- | --- |");
    for (const entry of withUnused) {
      lines.push(`| \`${entry.type}\` | ${entry.unusedRules.map((rule) => `\`${rule}\``).join(", ")} |`);
    }
    lines.push("");
  }

  if (report.missingDirectories.length > 0) {
    lines.push(
      "## Directories absent from this install",
      "",
      "A type whose directory does not exist here cannot be checked. Usually DLC-only content.",
      "",
      ...report.missingDirectories.map((directory) => `- \`${directory}\``),
      "",
    );
  }

  return lines.join("\n");
}
