import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { requireGamePath } from "../game-path.js";
import { schema } from "../../src/schema/index.js";
import { NodeKind, parse, type Block, type Document, type EntryNode } from "../../src/syntax/index.js";
import { convertBlock, type ConversionResult } from "../verify-reproduce/roundtrip.js";
import { bare, entries as orderedEntries, isEntries, type EntriesValue, type Entry } from "../../src/runtime/values.js";
import { HELPERS, literal } from "./literal.js";
import { BUDGET } from "./budget.js";
import type { DefinitionType } from "../../src/schema/ir.js";

/**
 * Asks the compiler whether the generated types accept the game.
 *
 * Every other gate reads the schema. This one reads what the schema was turned
 * into, which is what a mod author actually writes against, and the difference
 * is not academic: the schema declares `inline_script` legal in every block,
 * codegen never read that, and 19 types rejected a key vanilla writes 336 files
 * over. `verify:conformance` could not have seen it — it subtracts macro keys
 * before it counts — and `verify:reproduce` could not either, because printing
 * a definition never consults its type.
 *
 * The budget is a measured number, not a target. Vanilla is not authored
 * through this library and never was, so some of it does not typecheck for
 * reasons that are nobody's defect — a `.gui` file's keys are case-insensitive
 * and it declares `@constants` inline. What matters is that the number does not
 * rise.
 */

const REPOSITORY_ROOT: string = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set(["", ".txt", ".gui", ".gfx", ".asset", ".sound"]);

/**
 * How many definitions of a type are written out.
 *
 * Every definition of a small type, and a spread of a large one: the errors
 * this finds are per key rather than per definition, and the four-hundredth
 * building says what the first ten did.
 *
 * The answer has to be the same twice, and for a while it was not: 3,800, then
 * 3,806, then 3,809 for one unchanged tree. That was read as the compiler
 * giving up on a corpus this size, and it was not — the output was overflowing
 * `spawnSync`'s default buffer and being truncated at a different point each
 * run, which dropped diagnostics silently. With the buffer raised, three runs
 * give the same number every time, and the truncated figure had been hiding
 * nearly half of what the compiler said.
 */
const PER_TYPE_LIMIT = 400;

/**
 * What each type still rejects, measured on 4.4.6, and a ceiling rather than a
 * target.
 *
 * Vanilla is not authored through this library, so some of it will never
 * typecheck for reasons that are nobody's defect: a `.gui` file's keys are
 * case-insensitive and it declares `@constants` inline, and a cwt literal union
 * is a list someone wrote down that the game has since added to. Per type
 * rather than one number, so a new hole cannot hide behind a fix somewhere
 * else, and a type absent from this map must have none at all.
 *
 * Regenerate deliberately with `npm run verify:types -- --report`, and say in
 * the commit what moved and why.
 */
const ERROR_BUDGET: Readonly<Record<string, number>> = BUDGET;

function pascal(value: string): string {
  const parts: readonly string[] = value.split(/[^A-Za-z0-9]+/u).filter((part) => part.length > 0);
  const joined: string = parts
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join("");
  return /^[A-Za-z_$]/u.test(joined) ? joined : `Type${joined}`;
}

function collectFiles(directory: string, recurse: boolean): string[] {
  let entries: readonly { name: string; isDirectory: () => boolean; isFile: () => boolean }[];

  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: string[] = [];

  for (const entry of entries) {
    const path: string = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (recurse) {
        found.push(...collectFiles(path, recurse));
      }
      continue;
    }

    const dot: number = entry.name.lastIndexOf(".");
    const extension: string = dot < 0 ? "" : entry.name.slice(dot).toLowerCase();

    if (entry.isFile() && SCRIPT_EXTENSIONS.has(extension)) {
      found.push(path);
    }
  }

  return found;
}

/**
 * The same order everywhere, whatever the filesystem hands back.
 *
 * A type with more definitions than the sample takes the first of them, so an
 * unsorted enumeration would make the budget depend on how a directory happens
 * to be laid out — stable on one machine and not on another.
 */
function sortedFiles(files: readonly string[]): readonly string[] {
  return [...files].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function blockOf(entry: EntryNode): Block | undefined {
  return entry.kind === NodeKind.Assignment && entry.value.kind === NodeKind.Block ? entry.value : undefined;
}

/** The blocks a type claims from one file. */
function claimedBlocks(type: DefinitionType, document: Document): readonly Block[] {
  const blocks: Block[] = [];
  const container = type.source.container;
  // A type that names its root keys claims those and no others. `sound_falloff`
  // shares `sound/` with `sound`, `category` and `soundeffect`, and reading
  // every block there as a falloff filled the budget with errors about blocks
  // that were never of this type.
  const filter = type.source.rootKeyFilter;
  const accepted = (key: string): boolean =>
    filter === undefined
      ? true
      : filter.mode === "include"
        ? filter.values.includes(key)
        : !filter.values.includes(key);

  for (const entry of document.entries) {
    const block: Block | undefined = blockOf(entry);
    const key: string | undefined =
      entry.kind === NodeKind.Assignment ? String(entry.key.value).replace(/^"|"$/gu, "") : undefined;

    if (block === undefined || key === undefined) {
      continue;
    }

    if (container !== undefined) {
      if (container.kind !== "any-container" && container.key !== key) {
        continue;
      }
      for (const nested of block.entries) {
        const nestedBlock: Block | undefined = blockOf(nested);
        const nestedKey: string | undefined =
          nested.kind === NodeKind.Assignment ? String(nested.key.value).replace(/^"|"$/gu, "") : undefined;
        if (nestedBlock !== undefined && nestedKey !== undefined && accepted(nestedKey)) {
          blocks.push(nestedBlock);
        }
      }
      continue;
    }

    if (accepted(key)) {
      blocks.push(block);
    }
  }

  return blocks;
}

/**
 * A tagged type carries its identity inside the block and `define` writes it
 * there, so the body a mod author writes does not have it.
 */
function nameFieldOf(type: DefinitionType): string | undefined {
  return type.source.kind === "tagged-blocks" ? type.source.nameField : undefined;
}

/** The bodies a type claims from one file, already converted to object form. */
function bodiesOf(type: DefinitionType, document: Document): readonly Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];
  const nameField: string | undefined = nameFieldOf(type);

  for (const block of claimedBlocks(type, document)) {
    const converted: ConversionResult = convertBlock(block);
    const value: Record<string, unknown> | undefined = converted.value;

    // A body with no object form is an ordered one, which `orderedBodiesOf`
    // asks about against the type `define` takes.
    if (value === undefined || Object.keys(value).some((key) => key.length === 0)) {
      continue;
    }

    if (nameField !== undefined) {
      const { [nameField]: _identity, ...rest } = value;
      bodies.push(rest);
      continue;
    }

    bodies.push(value);
  }

  return bodies;
}

/**
 * The bodies an author can only write as an ordered list, as `define` is handed
 * them.
 *
 * Read in written order, the way the reproduce gate reads them: a scripted
 * effect's `set_variable`, `if`, `set_variable` is a body no object can hold.
 * These are checked against what `define` takes rather than against the
 * object shape, because that is the question an author meets — and for as long
 * as the body parameter was the object shape alone, every one of them failed
 * with "Index signature for type 'string' is missing in type 'EntriesValue'"
 * and nothing here asked.
 */
function orderedBodiesOf(type: DefinitionType, document: Document): readonly EntriesValue[] {
  const bodies: EntriesValue[] = [];
  const nameField: string | undefined = nameFieldOf(type);

  for (const block of claimedBlocks(type, document)) {
    const converted: ConversionResult = convertBlock(block, { order: "written" });
    const wrapped: unknown = converted.value?.[""];

    if (wrapped === undefined) {
      continue;
    }

    const items: readonly Entry[] = isEntries(wrapped)
      ? wrapped.entries
      : Array.isArray(wrapped)
        ? (wrapped as readonly unknown[]).map((item) => bare(item))
        : [];

    bodies.push(
      orderedEntries(
        nameField === undefined ? items : items.filter((item) => !Array.isArray(item) || item[0] !== nameField),
      ),
    );
  }

  return bodies;
}

const gamePath: string = requireGamePath();
const directory: string = mkdtempSync(join(tmpdir(), "stellaris-ts-types-"));

try {
  const typesPath: string = join(REPOSITORY_ROOT, "src", "generated", "types", "index.ts").replaceAll("\\", "/");
  const valuesPath: string = join(REPOSITORY_ROOT, "src", "runtime", "values.ts").replaceAll("\\", "/");
  const buildersPath: string = join(REPOSITORY_ROOT, "src", "builders", "index.ts").replaceAll("\\", "/");
  const names: string[] = [];
  let written = 0;
  let writtenOrdered = 0;
  let skipped = 0;

  for (const type of schema.definitionTypes) {
    if (type.source.kind === "bare-values") {
      continue;
    }

    const files: readonly string[] = sortedFiles(
      collectFiles(join(gamePath, ...type.source.directory.split("/")), type.source.includeSubdirectories).filter(
        (file) => type.source.files === undefined || type.source.files.includes(file.split(/[\\/]/u).at(-1) ?? ""),
      ),
    );

    const literals: string[] = [];
    const ordered: string[] = [];

    for (const file of files) {
      if (literals.length >= PER_TYPE_LIMIT && ordered.length >= PER_TYPE_LIMIT) {
        break;
      }

      const source: string = new TextDecoder("utf-8", { ignoreBOM: true }).decode(readFileSync(file));
      const result = parse(source);

      if (result.errors.length > 0) {
        continue;
      }

      for (const body of literals.length >= PER_TYPE_LIMIT ? [] : bodiesOf(type, result.document)) {
        if (literals.length >= PER_TYPE_LIMIT) {
          break;
        }

        try {
          literals.push(literal(body));
        } catch {
          skipped += 1;
        }
      }

      for (const body of ordered.length >= PER_TYPE_LIMIT ? [] : orderedBodiesOf(type, result.document)) {
        if (ordered.length >= PER_TYPE_LIMIT) {
          break;
        }

        try {
          ordered.push(literal(body));
        } catch {
          skipped += 1;
        }
      }
    }

    const stem: string = type.id.replace(/[^A-Za-z0-9_]/gu, "_");

    if (literals.length > 0) {
      const name = `${pascal(type.id)}Definition`;
      const file = `type_${stem}.ts`;

      writeFileSync(
        join(directory, file),
        [
          `import type { ${name} } from "${typesPath}";`,
          `import { ${HELPERS.join(", ")} } from "${valuesPath}";`,
          "",
          `void [${HELPERS.join(", ")}];`,
          "",
          ...literals.map((body, index) => `export const value${String(index)}: ${name} = ${body};`),
          "",
        ].join("\n"),
        "utf8",
      );

      names.push(file);
      written += literals.length;
    }

    // The bodies only an ordered list can write, against what `define` takes.
    // Not budgeted: an ordered list holds its values untyped, so the one thing
    // that can fail here is whether the body is accepted at all.
    if (ordered.length > 0) {
      const file = `ordered_${stem}.ts`;

      writeFileSync(
        join(directory, file),
        [
          `import type { DefinitionBody } from "${buildersPath}";`,
          `import { ${HELPERS.join(", ")} } from "${valuesPath}";`,
          "",
          `void [${HELPERS.join(", ")}];`,
          "",
          ...ordered.map(
            (body, index) =>
              `export const ordered${String(index)}: DefinitionBody<${JSON.stringify(type.id)}> = ${body};`,
          ),
          "",
        ].join("\n"),
        "utf8",
      );

      names.push(file);
      writtenOrdered += ordered.length;
    }
  }

  writeFileSync(
    join(directory, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          allowImportingTsExtensions: true,
          module: "nodenext",
          moduleResolution: "nodenext",
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: "es2022",
          types: [],
        },
        files: names,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const result: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    [join(REPOSITORY_ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", ".", "--pretty", "false"],
    // The default is a megabyte, and the compiler says far more than that about
    // 31,000 definitions. Overflowing it truncates the output, which drops
    // diagnostics and makes the count depend on where the buffer happened to
    // end — the wobble that was blamed on the compiler.
    { cwd: directory, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
  );

  // The compiler has to have finished. Output with no diagnostics in it says
  // nothing at all when the process never started, was killed, or fell over —
  // and this gate exists because a check that cannot fail looks like one that
  // passed.
  if (result.error !== undefined || result.signal !== null || result.status === null) {
    const why: string = result.error?.message ?? `signal ${result.signal ?? "none"}, status ${String(result.status)}`;
    throw new Error(`The compiler did not finish: ${why}.`);
  }

  const output: string = `${result.stdout}${result.stderr}`;
  const errors: readonly string[] = output.split(/\r?\n/u).filter((line) => /error TS\d+/u.test(line));

  if (result.status !== 0 && errors.length === 0) {
    throw new Error(
      `The compiler exited ${String(result.status)} without reporting a diagnostic:\n${output.slice(0, 2000)}`,
    );
  }

  const byType = new Map<string, number>();
  const orderedErrors: readonly string[] = errors.filter((line) => /^ordered_[A-Za-z0-9_]+\.ts/u.test(line));

  for (const line of errors) {
    if (/^ordered_[A-Za-z0-9_]+\.ts/u.test(line)) {
      continue;
    }
    const file: string = /^type_([A-Za-z0-9_]+)\.ts/u.exec(line)?.[1] ?? "?";
    byType.set(file, (byType.get(file) ?? 0) + 1);
  }

  const budgeted: number = Object.values(ERROR_BUDGET).reduce((total, count) => total + count, 0);

  console.log(
    [
      "SUMMARY mode=types",
      `types=${String(names.length)}`,
      `definitions=${String(written)}`,
      `orderedBodies=${String(writtenOrdered)}`,
      `unconvertible=${String(skipped)}`,
      `errors=${String(errors.length - orderedErrors.length)}`,
      `orderedErrors=${String(orderedErrors.length)}`,
      `budget=${String(budgeted)}`,
    ].join(" "),
  );

  if (process.argv.includes("--report")) {
    const report: readonly string[] = [...byType]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([type, count]) => `  ${JSON.stringify(type)}: ${String(count)},`);
    console.log(["const BUDGET: Readonly<Record<string, number>> = {", ...report, "};"].join("\n"));
  }

  const over: readonly string[] = [...byType]
    .filter(([type, count]) => count > (ERROR_BUDGET[type] ?? 0))
    .map(([type, count]) => `${type} ${String(count)} > ${String(ERROR_BUDGET[type] ?? 0)}`);

  for (const line of over) {
    console.error(`TYPES over budget: ${line}`);
  }

  // The errors of a type over its budget first, all of them: the new error is
  // the one to read, and the first ten overall are the budgeted ones it hides
  // behind.
  const overTypes: ReadonlySet<string> = new Set(
    [...byType].filter(([type, count]) => count > (ERROR_BUDGET[type] ?? 0)).map(([type]) => type),
  );
  const isOver = (line: string): boolean => overTypes.has(/^type_([A-Za-z0-9_]+)\.ts/u.exec(line)?.[1] ?? "?");

  for (const line of [...errors.filter(isOver), ...errors.filter((error) => !isOver(error)).slice(0, 10)]) {
    console.error(`TYPES ${line}`);
  }

  if (over.length > 0) {
    console.error(`TYPES ${String(over.length)} types reject more of the game than they did.`);
    process.exitCode = 1;
  }

  // Nothing is budgeted here: a body only an ordered list can write is one
  // `define` has to take, or that definition cannot be authored at all.
  for (const line of orderedErrors.slice(0, 20)) {
    console.error(`TYPES ${line}`);
  }

  if (orderedErrors.length > 0) {
    console.error(
      `TYPES ${String(orderedErrors.length)} ordered bodies are rejected by the type define takes for their body.`,
    );
    process.exitCode = 1;
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  rmSync(directory, { recursive: true, force: true });
}
