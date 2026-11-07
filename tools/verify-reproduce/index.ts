import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { requireGamePath } from "../game-path.js";

import { renderDefinitions } from "../../src/runtime/build.js";
import { schema } from "../../src/schema/index.js";
import { NodeKind, parse, type Block, type EntryNode } from "../../src/syntax/index.js";
import { bare, entries as orderedEntries, isEntries } from "../../src/runtime/values.js";
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

const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set(["", ".txt"]);
const READ_CONCURRENCY = 32;

type Failure = ConversionFailure | "list-body" | "print-mismatch" | "reparse-failed";

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
 * Two differences are deliberately not differences: `icon = "x"` and
 * `icon = x` are the same string, and `0.50` and `0.5` the same number, so a
 * shape holds the parsed value rather than the text.
 *
 * Order is compared, at every depth. It used to be compared only among one
 * key's own repetitions, on the reading that a definition body is loaded into a
 * struct — which holds for a building and not for a scripted effect, whose body
 * runs top to bottom. `set_variable`, `if`, `set_variable` written back as
 * `set_variable`, `set_variable`, `if` passed, and the gate counted 2,626
 * definitions as reproduced that an object can only write in another order.
 * The converter now keeps the written order wherever an object would not, so
 * what is printed is what was read, in sequence.
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

function shapesOf(entries: readonly EntryNode[]): readonly Shape[] {
  return entries.map(shapeOf).filter((shape): shape is Shape => shape !== undefined);
}

function keyOf(shape: Shape): string {
  return `${shape.kind}:${String(shape.value ?? "")}:${shape.operator ?? ""}`;
}

function sameShape(left: readonly EntryNode[], right: readonly EntryNode[]): boolean {
  return firstDifference(shapesOf(left), shapesOf(right), "root") === undefined;
}

/** Names the first place two shapes differ, in order, or `undefined` when they do not. */
function firstDifference(left: readonly Shape[], right: readonly Shape[], path: string): string | undefined {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a: Shape | undefined = left[index];
    const b: Shape | undefined = right[index];

    if (a === undefined || b === undefined) {
      return `${path}: ${String(left.length)} vs ${String(right.length)} entries; first unmatched is ${keyOf(a ?? b ?? { kind: "?" })} at ${String(index)}`;
    }

    if (keyOf(a) !== keyOf(b)) {
      return `${path}[${String(index)}]: ${keyOf(a)} was written, ${keyOf(b)} came back`;
    }

    const deeper: string | undefined = firstDifference(
      a.children ?? [],
      b.children ?? [],
      `${path}.${String(a.value ?? a.kind)}`,
    );

    if (deeper !== undefined) {
      return deeper;
    }
  }

  return undefined;
}

const gamePath: string = requireGamePath();
const directories: readonly { readonly path: string; readonly recurse: boolean }[] = [
  ...new Map(
    schema.definitionTypes.map((type) => [
      type.source.directory,
      { path: type.source.directory, recurse: type.source.includeSubdirectories },
    ]),
  ).values(),
];

const explain: boolean = process.argv.includes("--explain");
let explained = 0;
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

  if (parsed.errors.length > 0) {
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
    const converted: ConversionResult = convertBlock(original, { order: "written" });

    if (converted.failure !== undefined || converted.value === undefined) {
      record(converted.failure ?? "reparse-failed", relative, id);
      continue;
    }

    // The converter wraps a body that is not a plain object under a sentinel
    // key: either an ordered entry list, which `define()` takes, or a bare
    // value list, which has no object form at all and needs `mod.file()`.
    const wrapper: Record<string, unknown> = converted.value;
    const wrapperKeys: readonly string[] = Object.keys(wrapper);
    const wrapped: unknown = wrapperKeys.length === 1 && wrapperKeys[0] === "" ? wrapper[""] : undefined;

    // A body that is a bare value list is still an ordered sequence — just one
    // with no keys in it — so it goes through `entries` like any other.
    const body: object = isEntries(wrapped)
      ? wrapped
      : Array.isArray(wrapped)
        ? orderedEntries(wrapped.map((item) => bare(item)))
        : wrapper;

    let printed: string;
    try {
      printed = renderDefinitions([[id, body]]);
    } catch {
      record("print-mismatch", relative, id);
      continue;
    }

    const reparsed = parse(printed);
    if (reparsed.errors.length > 0) {
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

      if (explain && explained < 10) {
        explained += 1;
        const why: string =
          firstDifference(shapesOf(original.entries), shapesOf(round.value.entries), "root") ?? "unknown";
        console.error(`EXPLAIN ${relative} :: ${id}: ${why}`);
      }
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

/**
 * How much of vanilla the authoring model can express.
 *
 * Pinned at 100: every definition the game ships can be written through
 * `define()`. It started at 34%, and rose as comparisons, repeated keys, raw
 * script and ordered entry lists each got a spelling. Anything that drops it is
 * a regression, and the report names what failed.
 */
const REPRODUCTION_FLOOR = 100;

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

// The console is the only output. A generated markdown report would read as a
// specification of the gaps it lists, and a gap here is a defect, not a design.
for (const report of reports) {
  console.log(
    `GAP ${report.failure} definitions=${String(report.count)} files=${String(report.files)} example=${report.samples[0]?.definition ?? ""} in ${report.samples[0]?.file ?? ""}`,
  );
}

if (Number(percentage) < REPRODUCTION_FLOOR) {
  console.error(`REPRODUCE ${percentage}% of vanilla is expressible, below the pinned ${String(REPRODUCTION_FLOOR)}%.`);
  process.exitCode = 1;
}
