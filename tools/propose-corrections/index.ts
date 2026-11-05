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
import { checkConformance, type ConformanceReport, type ValueShape } from "../verify-schema/conformance.js";

/**
 * Proposes the rules the ported corpus is missing.
 *
 * `verify:conformance` says which fields vanilla uses that the schema rejects.
 * It does not say what they hold — and a field the schema does not have is worse
 * than a field whose value it describes loosely, because the type omits it
 * entirely and the checker calls correct script an error.
 *
 * So each finding carries the narrowest shape that covers every use, widened
 * by the conformance walk across all of them, and that is proposed. The output is
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

const EXPRESSION: Readonly<Record<ValueShape, string>> = {
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
  readonly shape: ValueShape;
  readonly uses: number;
  readonly example: string;
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

    // The shape conformance widened over every use. Reading it back out of the
    // files a finding names saw at most the three it keeps as examples, and
    // any key of the same name at any depth: `policy.category` came out a bare
    // word because the one list of categories, in 00_policies.txt, was not
    // among the three.
    const shape: ValueShape = finding.shape;

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

const shapes = new Map<ValueShape, number>();

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
