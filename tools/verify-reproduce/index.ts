import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderDefinitions } from "../../src/runtime/build.js";
import { schema } from "../../src/schema/index.js";
import { NodeKind, parse, type Block, type EntryNode } from "../../src/syntax/index.js";
import { convertBlock, type ConversionFailure, type ConversionResult } from "./roundtrip.js";

/**
 * Asks whether this library could have produced vanilla.
 *
 * The conformance harness checks the schema against the game. This checks the
 * *authoring model*: every definition the game ships is converted back into
 * what a mod author would have written, printed, and compared with the original.
 * Anything that fails is script no one can write through `define()`.
 *
 * Guessing which constructs are expressible gets it wrong both ways — a value
 * list and a script-variable reference look exotic and are perfectly writable,
 * while a comparison operator looks ordinary and is not writable at all. So
 * nothing is guessed: the conversion is attempted and the failures counted.
 */

const REPOSITORY_ROOT: string = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULT_GAME_PATH: string = String.raw`D:\steam\steamapps\common\Stellaris`;
const REPORT_PATH: string = join(REPOSITORY_ROOT, "docs", "authoring-gaps.md");
const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set(["", ".txt"]);
const READ_CONCURRENCY = 32;

type Failure = ConversionFailure | "print-mismatch" | "reparse-failed";

interface Sample {
  readonly file: string;
  readonly definition: string;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function mapWithLimit<Item>(
  items: readonly Item[],
  limit: number,
  handler: (item: Item) => Promise<void>,
): Promise<void> {
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index: number = next;
      next += 1;
      const item: Item | undefined = items[index];

      if (item === undefined) {
        return;
      }

      // oxlint-disable-next-line no-await-in-loop
      await handler(item);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
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

/**
 * Compares two parsed blocks by what the game would load.
 *
 * Three differences are deliberately not differences:
 *
 * - `icon = "x"` and `icon = x` are the same string, as are `0.50` and `0.5`.
 * - The order of *distinct* keys in a definition body. The game reads them into
 *   a struct; nothing depends on which came first.
 * - Nothing else. The order of a key's own repetitions is compared, because a
 *   list of triggered modifiers is evaluated in order.
 *
 * A plain object cannot interleave two keys the way script can, so without the
 * second point every definition that alternates `a b a` would read as a failure
 * when the game cannot tell the difference.
 */
interface Shape {
  readonly kind: string;
  readonly value?: string | number | boolean;
  readonly operator?: string;
  readonly children?: readonly Shape[];
}

function shapeOf(entry: EntryNode): Shape | undefined {
  switch (entry.kind) {
    case NodeKind.Assignment:
      return {
        kind: "assignment",
        operator: entry.operator,
        value: entry.key.value,
        children: entry.value.kind === NodeKind.Block ? shapesOf(entry.value.entries) : [shapeOfValue(entry.value)],
      };
    case NodeKind.Scalar:
      return { kind: "scalar", value: entry.value };
    case NodeKind.Block:
      return { kind: "block", children: shapesOf(entry.entries) };
    case NodeKind.Trivia:
      return undefined;
    default:
      return { kind: entry.kind };
  }
}

function shapeOfValue(value: EntryNode): Shape {
  return value.kind === NodeKind.Scalar ? { kind: "scalar", value: value.value } : (shapeOf(value) ?? { kind: "?" });
}

/** Groups by key, keeping each key's own repetitions in order. */
function shapesOf(entries: readonly EntryNode[]): readonly Shape[] {
  return entries.map(shapeOf).filter((shape): shape is Shape => shape !== undefined);
}

function keyOf(shape: Shape): string {
  return `${shape.kind}:${String(shape.value ?? "")}:${shape.operator ?? ""}`;
}

function sameShape(left: readonly EntryNode[], right: readonly EntryNode[]): boolean {
  return sameShapes(shapesOf(left), shapesOf(right));
}

function sameShapes(left: readonly Shape[], right: readonly Shape[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const group = (shapes: readonly Shape[]): Map<string, Shape[]> => {
    const grouped = new Map<string, Shape[]>();
    for (const shape of shapes) {
      const bucket: Shape[] = grouped.get(keyOf(shape)) ?? [];
      bucket.push(shape);
      grouped.set(keyOf(shape), bucket);
    }
    return grouped;
  };

  const l: Map<string, Shape[]> = group(left);
  const r: Map<string, Shape[]> = group(right);

  if (l.size !== r.size) {
    return false;
  }

  for (const [key, lefts] of l) {
    const rights: Shape[] | undefined = r.get(key);

    if (rights === undefined || rights.length !== lefts.length) {
      return false;
    }

    for (let index = 0; index < lefts.length; index += 1) {
      const a: Shape | undefined = lefts[index];
      const b: Shape | undefined = rights[index];

      if (a === undefined || b === undefined) {
        return false;
      }

      if (!sameShapes(a.children ?? [], b.children ?? [])) {
        return false;
      }
    }
  }

  return true;
}

const gamePath: string = process.env["STELLARIS_GAME_PATH"] ?? DEFAULT_GAME_PATH;
const directories: readonly { readonly path: string; readonly recurse: boolean }[] = [
  ...new Map(
    schema.definitionTypes.map((type) => [
      type.source.directory,
      { path: type.source.directory, recurse: type.source.includeSubdirectories },
    ]),
  ).values(),
];

const failures = new Map<Failure, { count: number; files: Set<string>; samples: Sample[] }>();
let filesRead = 0;
let definitions = 0;
let reproduced = 0;

function record(failure: Failure, file: string, definition: string): void {
  const bucket = failures.get(failure) ?? { count: 0, files: new Set<string>(), samples: [] };
  bucket.count += 1;
  bucket.files.add(file);
  if (bucket.samples.length < 3) {
    bucket.samples.push({ file, definition });
  }
  failures.set(failure, bucket);
}

const listings: readonly (readonly string[])[] = await Promise.all(
  directories.map(async (directory) => collectFiles(join(gamePath, ...directory.path.split("/")), directory.recurse)),
);

await mapWithLimit([...new Set(listings.flat())], READ_CONCURRENCY, async (file): Promise<void> => {
  const source: string = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await readFile(file));
  const parsed = parse(source);
  filesRead += 1;

  if (parsed.diagnostics.length > 0) {
    return;
  }

  const relative: string = file.slice(gamePath.length + 1).replaceAll("\\", "/");

  for (const entry of parsed.document.entries) {
    if (entry.kind !== NodeKind.Assignment || entry.value.kind !== NodeKind.Block) {
      continue;
    }

    definitions += 1;
    const id: string = entry.key.raw;
    const original: Block = entry.value;
    const converted: ConversionResult = convertBlock(original);

    if (converted.failure !== undefined || converted.value === undefined) {
      record(converted.failure ?? "reparse-failed", relative, id);
      continue;
    }

    let printed: string;
    try {
      printed = renderDefinitions([[id, converted.value]]);
    } catch {
      record("print-mismatch", relative, id);
      continue;
    }

    const reparsed = parse(printed);
    if (reparsed.diagnostics.length > 0) {
      record("reparse-failed", relative, id);
      continue;
    }

    const round = reparsed.document.entries.find((candidate) => candidate.kind === NodeKind.Assignment);

    if (round?.kind !== NodeKind.Assignment || round.value.kind !== NodeKind.Block) {
      record("print-mismatch", relative, id);
      continue;
    }

    if (sameShape(original.entries, round.value.entries)) {
      reproduced += 1;
    } else {
      record("print-mismatch", relative, id);
    }
  }
});

const reports: readonly {
  readonly failure: Failure;
  readonly count: number;
  readonly files: number;
  readonly samples: readonly Sample[];
}[] = [...failures.entries()]
  .map(([failure, bucket]) => ({
    failure,
    count: bucket.count,
    files: bucket.files.size,
    samples: bucket.samples,
  }))
  .sort((left, right) => right.count - left.count || compareOrdinal(left.failure, right.failure));

const blocked: number = reports.reduce((total, report) => total + report.count, 0);
const percentage: string = definitions === 0 ? "0" : ((reproduced / definitions) * 100).toFixed(2);

const lines: string[] = [
  "# What the authoring model cannot express",
  "",
  "Generated by `npm run verify:reproduce`. Do not edit by hand.",
  "",
  "The conformance report asks whether the schema knows what vanilla ships. This asks the harder",
  "question: **could a mod author have written it?** Every vanilla definition is converted back into",
  "what `define({ ... })` would have taken, printed, re-parsed, and compared with the original.",
  "",
  "Nothing here is inferred from how a construct looks. A value list and a script-variable reference",
  "both look exotic and are perfectly writable; a comparison operator looks ordinary and is not.",
  "These are the ones that actually failed the round trip.",
  "",
  "## Summary",
  "",
  "| | |",
  "| --- | --- |",
  `| definitions inspected | ${String(definitions)} |`,
  `| reproduced exactly | ${String(reproduced)} (${percentage}%) |`,
  `| blocked | ${String(blocked)} |`,
  `| distinct causes | ${String(reports.length)} |`,
  `| files read | ${String(filesRead)} |`,
  "",
  "## Causes",
  "",
  "| cause | definitions | files | example |",
  "| --- | --- | --- | --- |",
  ...reports.map(
    (report) =>
      `| \`${report.failure}\` | ${String(report.count)} | ${String(report.files)} | ${report.samples[0]?.definition ?? ""} in \`${report.samples[0]?.file ?? ""}\` |`,
  ),
  "",
];

await mkdir(dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, `${lines.join("\n")}\n`, "utf8");

/**
 * How much of vanilla the authoring model can express.
 *
 * Pinned so the number can only go up. It rose from 34% to 98% as comparisons,
 * repeated keys and raw script each got a spelling; what still blocks the rest
 * is listed in the report.
 */
const REPRODUCTION_FLOOR = 98.0;

console.log(
  [
    "SUMMARY mode=reproduce",
    `files=${String(filesRead)}`,
    `definitions=${String(definitions)}`,
    `reproduced=${String(reproduced)}`,
    `percent=${percentage}`,
    `blocked=${String(blocked)}`,
    `causes=${String(reports.length)}`,
  ].join(" "),
);

for (const report of reports) {
  console.log(`GAP ${report.failure} definitions=${String(report.count)} files=${String(report.files)}`);
}

if (Number(percentage) < REPRODUCTION_FLOOR) {
  console.error(`REPRODUCE ${percentage}% of vanilla is expressible, below the pinned ${String(REPRODUCTION_FLOOR)}%.`);
  process.exitCode = 1;
}
