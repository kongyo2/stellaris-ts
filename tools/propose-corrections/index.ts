import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { requireGamePath } from "../game-path.js";
import { schema } from "../../src/schema/index.js";
import { withHandCorrections } from "../../src/schema/corrections.js";
import { definitionTypes } from "../../src/schema/definitions/index.js";
import { withGameDeclaredFields } from "../../src/schema/open-fields.js";
import { vanillaFieldNames } from "../../src/generated/vanilla/index.js";
import { isVanillaDefect } from "../../src/schema/vanilla-defects.js";
import { checkConformance, type ConformanceReport } from "../verify-schema/conformance.js";
import { NodeKind, parse, type Document, type EntryNode, type ValueNode } from "../../src/syntax/index.js";
import { readFile } from "node:fs/promises";

/**
 * Proposes the rules the ported corpus is missing.
 *
 * `verify:conformance` says which fields vanilla uses that the schema rejects.
 * It does not say what they hold — and a field the schema does not have is worse
 * than a field whose value it describes loosely, because the type omits it
 * entirely and the checker calls correct script an error.
 *
 * So each finding is looked up in the file it came from, its values are read,
 * and the narrowest shape that covers all of them is proposed. The output is
 * committed and reviewed rather than recomputed: a hole that opens in a later
 * patch has to show up as a diff, not be absorbed silently.
 *
 * The same report answers the opposite question. A field the corpus marks
 * required that vanilla definitions leave out is not required — the game loads
 * those definitions — so the second half of this file relaxes them. Without it
 * the checker would reject 115 of 219 achievements for having no `possible`.
 */

const REPOSITORY_ROOT: string = fileURLToPath(new URL("../../", import.meta.url));
const OUTPUT: string = join(REPOSITORY_ROOT, "src", "schema", "vanilla-corrections.ts");

type Shape = "block" | "boolean" | "integer" | "list" | "number" | "scalar";

function shapeOf(value: ValueNode): Shape {
  if (value.kind === NodeKind.Block) {
    return value.entries.every((entry) => entry.kind === NodeKind.Scalar) && value.entries.length > 0
      ? "list"
      : "block";
  }

  // Inline maths, a prefixed block, an optional block: all shapes a narrower
  // rule would reject, so they widen to whatever holds text.
  if (value.kind !== NodeKind.Scalar) {
    return "scalar";
  }

  const text: string = String(value.value);

  if (text === "yes" || text === "no") {
    return "boolean";
  }
  if (/^-?\d+$/u.test(text)) {
    return "integer";
  }
  if (/^-?\d*\.\d+$/u.test(text)) {
    return "number";
  }
  return "scalar";
}

/** The one shape that covers both, widening only as far as it has to. */
function widen(left: Shape, right: Shape): Shape {
  if (left === right) {
    return left;
  }
  if ((left === "integer" && right === "number") || (left === "number" && right === "integer")) {
    return "number";
  }
  if ((left === "block" && right === "list") || (left === "list" && right === "block")) {
    return "block";
  }
  if (left === "block" || right === "block" || left === "list" || right === "list") {
    return "block";
  }
  return "scalar";
}

const EXPRESSION: Readonly<Record<Shape, string>> = {
  block: "anyValue()",
  boolean: 'primitive("boolean")',
  integer: 'primitive("integer")',
  list: "anyValue()",
  number: 'primitive("number")',
  scalar: 'primitive("scalar")',
};

const gamePath: string = requireGamePath();
// Against the corpus as it was before this file existed, so a second run
// proposes the same rules rather than deciding nothing is missing.
const report: ConformanceReport = await checkConformance(
  // Everything except this file's own output. The defines types declare their
  // fields from the game rather than from the corpus, so that layer stays on —
  // without it every one of the 2,379 engine constants reads as a missing field.
  {
    ...schema,
    definitionTypes: withGameDeclaredFields(withHandCorrections(definitionTypes), vanillaFieldNames),
  },
  gamePath,
);

interface Proposal {
  readonly type: string;
  readonly field: string;
  readonly shape: Shape;
  readonly uses: number;
  readonly example: string;
}

const documents = new Map<string, Document>();

async function documentAt(path: string): Promise<Document | undefined> {
  const cached: Document | undefined = documents.get(path);

  if (cached !== undefined) {
    return cached;
  }

  try {
    const source: string = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await readFile(path));
    const result = parse(source);

    if (result.errors.length > 0) {
      return undefined;
    }

    documents.set(path, result.document);
    return result.document;
  } catch {
    return undefined;
  }
}

/** Every value written under a key anywhere in a document. */
function valuesFor(entries: readonly EntryNode[], key: string, into: ValueNode[]): void {
  for (const entry of entries) {
    if (entry.kind !== NodeKind.Assignment) {
      continue;
    }

    if (String(entry.key.value) === key) {
      into.push(entry.value);
    }

    if (entry.value.kind === NodeKind.Block) {
      valuesFor(entry.value.entries, key, into);
    }
  }
}

const proposals: Proposal[] = [];

for (const type of report.types) {
  for (const finding of type.unknownFields) {
    // A line the game itself drops is not a rule to write down.
    if (isVanillaDefect(type.type, finding.field, finding.path)) {
      continue;
    }

    // Only the definition's own fields. A key nested inside one belongs to
    // whatever rule governs that block, and appending it here would declare a
    // top-level field the type does not have.
    if (finding.path.length > 0 || finding.context !== "block") {
      continue;
    }

    const values: ValueNode[] = [];

    // Every file the finding names, not just the first: a field can hold a
    // number in one place and a block in another, and widening across all of
    // them is the only way to see it.
    for (const example of finding.examples) {
      // oxlint-disable-next-line no-await-in-loop
      const document: Document | undefined = await documentAt(join(gamePath, ...example.split("/")));

      if (document !== undefined) {
        valuesFor(document.entries, finding.field, values);
      }
    }

    const first: ValueNode | undefined = values[0];
    const shape: Shape =
      first === undefined ? "scalar" : values.map(shapeOf).reduce((left, right) => widen(left, right), shapeOf(first));

    proposals.push({
      type: type.type,
      field: finding.field,
      shape,
      uses: finding.occurrences,
      example: finding.examples[0] ?? "",
    });
  }
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const byType = new Map<string, Proposal[]>();

for (const proposal of proposals) {
  const bucket: Proposal[] = byType.get(proposal.type) ?? [];
  bucket.push(proposal);
  byType.set(proposal.type, bucket);
}

interface Relaxation {
  readonly type: string;
  readonly field: string;
  readonly missingFrom: number;
  readonly definitions: number;
  readonly example: string;
}

const relaxations: readonly Relaxation[] = report.types
  .flatMap((type) =>
    type.missingRequired.map((entry) => ({
      type: type.type,
      field: entry.field,
      missingFrom: entry.missingFrom,
      definitions: type.definitionsSeen,
      example: entry.examples[0] ?? "",
    })),
  )
  .sort((left, right) => compareOrdinal(left.type, right.type) || compareOrdinal(left.field, right.field));

const relaxedByType = new Map<string, Relaxation[]>();

for (const relaxation of relaxations) {
  const bucket: Relaxation[] = relaxedByType.get(relaxation.type) ?? [];
  bucket.push(relaxation);
  relaxedByType.set(relaxation.type, bucket);
}

const lines: string[] = [
  "// Generated by `npm run propose:corrections` from the installed game, then reviewed.",
  "//",
  "// Fields vanilla writes that cwtools-stellaris-config never declared. Without",
  "// them the generated type omits the field and the checker calls correct script",
  "// an error, which is worse than describing the value loosely — so the value is",
  "// the narrowest shape that covers every use found, and `anyValue()` where that",
  "// is a block whose contents nothing has described yet.",
  "//",
  "// Committed rather than recomputed: a hole that opens in a later patch has to",
  "// arrive as a diff.",
  "",
  ...(proposals.length === 0 ? [] : ['import { anyValue, field, occurs, primitive } from "./ir.js";', ""]),
  'import type { EntryRule } from "./ir.js";',
  "",
  "export const vanillaFieldCorrections: Readonly<Record<string, readonly EntryRule[]>> = {",
];

for (const [type, bucket] of [...byType].sort(([left], [right]) => compareOrdinal(left, right))) {
  lines.push(`  ${JSON.stringify(type)}: [`);

  for (const proposal of [...bucket].sort((left, right) => compareOrdinal(left.field, right.field))) {
    lines.push(
      `    // ${String(proposal.uses)} uses, e.g. ${proposal.example}`,
      `    field(${JSON.stringify(proposal.field)}, ${EXPRESSION[proposal.shape]}, occurs.any),`,
    );
  }

  lines.push("  ],");
}

lines.push("};", "");

lines.push(
  "",
  "/**",
  " * Fields the corpus marks required that vanilla definitions leave out.",
  " *",
  " * The game loads those definitions, so the field is not required. Left as it",
  " * came from cwt, the checker would reject correct script — and reject it for the",
  " * commonest shape a mod copies, since these are the fields base-game content",
  " * omits most often.",
  " */",
  "export const vanillaOptionalFields: Readonly<Record<string, readonly string[]>> = {",
);

for (const [type, bucket] of [...relaxedByType].sort(([left], [right]) => compareOrdinal(left, right))) {
  lines.push(`  ${JSON.stringify(type)}: [`);

  for (const relaxation of bucket) {
    lines.push(
      `    // ${String(relaxation.missingFrom)} of ${String(relaxation.definitions)} omit it, e.g. ${relaxation.example}`,
      `    ${JSON.stringify(relaxation.field)},`,
    );
  }

  lines.push("  ],");
}

lines.push("};", "");

await writeFile(OUTPUT, lines.join("\n"), "utf8");

const shapes = new Map<Shape, number>();

for (const proposal of proposals) {
  shapes.set(proposal.shape, (shapes.get(proposal.shape) ?? 0) + 1);
}

console.log(
  [
    "SUMMARY mode=propose-corrections",
    `types=${String(byType.size)}`,
    `fields=${String(proposals.length)}`,
    `relaxedTypes=${String(relaxedByType.size)}`,
    `relaxedFields=${String(relaxations.length)}`,
    ...[...shapes].sort((left, right) => right[1] - left[1]).map(([shape, count]) => `${shape}=${String(count)}`),
  ].join(" "),
);
