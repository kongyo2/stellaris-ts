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
 * this finds are per key rather than per definition, and the sixtieth building
 * says what the first ten did.
 *
 * Sixty rather than more because the answer has to be the same twice. At four
 * hundred the compiler returned 3,800, 3,806 and 3,809 for one unchanged tree —
 * a corpus that large is past where it answers stably, and a gate that cannot
 * be reproduced is worse than none. Three runs at sixty gave 1,532 each time.
 */
const PER_TYPE_LIMIT = 60;

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

function blockOf(entry: EntryNode): Block | undefined {
  return entry.kind === NodeKind.Assignment && entry.value.kind === NodeKind.Block ? entry.value : undefined;
}

/** The bodies a type claims from one file, already converted to object form. */
function bodiesOf(type: DefinitionType, document: Document): readonly Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];
  // A tagged type carries its identity inside the block and `define` writes it
  // there, so the generated body type does not have it.
  const nameField: string | undefined = type.source.kind === "tagged-blocks" ? type.source.nameField : undefined;
  const container = type.source.container;

  const claim = (block: Block): void => {
    const converted: ConversionResult = convertBlock(block);
    const value: Record<string, unknown> | undefined = converted.value;

    // A body that is a value list has no object form and is written with
    // `mod.file`, which has no type to check.
    if (value === undefined || Object.keys(value).some((key) => key.length === 0)) {
      return;
    }

    if (nameField !== undefined) {
      const { [nameField]: _identity, ...rest } = value;
      bodies.push(rest);
      return;
    }

    bodies.push(value);
  };

  for (const entry of document.entries) {
    const block: Block | undefined = blockOf(entry);

    if (block === undefined) {
      continue;
    }

    if (container !== undefined) {
      for (const nested of block.entries) {
        const nestedBlock: Block | undefined = blockOf(nested);
        if (nestedBlock !== undefined) {
          claim(nestedBlock);
        }
      }
      continue;
    }

    claim(block);
  }

  return bodies;
}

const gamePath: string = requireGamePath();
const directory: string = mkdtempSync(join(tmpdir(), "stellaris-ts-types-"));

try {
  const typesPath: string = join(REPOSITORY_ROOT, "src", "generated", "types", "index.ts").replaceAll("\\", "/");
  const valuesPath: string = join(REPOSITORY_ROOT, "src", "runtime", "values.ts").replaceAll("\\", "/");
  const names: string[] = [];
  let written = 0;
  let skipped = 0;

  for (const type of schema.definitionTypes) {
    if (type.source.kind === "bare-values") {
      continue;
    }

    const files: readonly string[] = collectFiles(
      join(gamePath, ...type.source.directory.split("/")),
      type.source.includeSubdirectories,
    ).filter(
      (file) => type.source.files === undefined || type.source.files.includes(file.split(/[\\/]/u).at(-1) ?? ""),
    );

    const literals: string[] = [];

    for (const file of files) {
      if (literals.length >= PER_TYPE_LIMIT) {
        break;
      }

      const source: string = new TextDecoder("utf-8", { ignoreBOM: true }).decode(readFileSync(file));
      const result = parse(source);

      if (result.diagnostics.length > 0) {
        continue;
      }

      for (const body of bodiesOf(type, result.document)) {
        if (literals.length >= PER_TYPE_LIMIT) {
          break;
        }

        try {
          literals.push(literal(body));
        } catch {
          skipped += 1;
        }
      }
    }

    if (literals.length === 0) {
      continue;
    }

    const name = `${pascal(type.id)}Definition`;
    const file = `type_${type.id.replace(/[^A-Za-z0-9_]/gu, "_")}.ts`;

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
    { cwd: directory, encoding: "utf8" },
  );

  const output: string = `${result.stdout}${result.stderr}`;
  const errors: readonly string[] = output.split(/\r?\n/u).filter((line) => /error TS\d+/u.test(line));
  const byType = new Map<string, number>();

  for (const line of errors) {
    const file: string = /^type_([A-Za-z0-9_]+)\.ts/u.exec(line)?.[1] ?? "?";
    byType.set(file, (byType.get(file) ?? 0) + 1);
  }

  const budgeted: number = Object.values(ERROR_BUDGET).reduce((total, count) => total + count, 0);

  console.log(
    [
      "SUMMARY mode=types",
      `types=${String(names.length)}`,
      `definitions=${String(written)}`,
      `unconvertible=${String(skipped)}`,
      `errors=${String(errors.length)}`,
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

  for (const line of errors.slice(0, 10)) {
    console.error(`TYPES ${line}`);
  }

  if (over.length > 0) {
    console.error(`TYPES ${String(over.length)} types reject more of the game than they did.`);
    process.exitCode = 1;
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  rmSync(directory, { recursive: true, force: true });
}
