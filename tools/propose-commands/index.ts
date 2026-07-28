import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { requireGamePath } from "../game-path.js";
import { schema } from "../../src/schema/index.js";
import { commands as importedCommands, ruleSets } from "../../src/schema/commands.js";
import { withScopeConstraints } from "../../src/schema/scope-model.js";
import { checkConformance, type ConformanceReport, type ValueShape } from "../verify-schema/conformance.js";
import type { ScriptBlockValue, SchemaModel } from "../../src/schema/ir.js";

/**
 * Proposes the engine commands the ported corpus is missing.
 *
 * A key written inside a trigger or effect block that is not a command, not a
 * scripted trigger or effect, and not a scope, is an engine command the corpus
 * never declared — the game evaluates that line every time it loads the script,
 * so its existence is not in doubt. cwtools-stellaris-config is a patch or two
 * behind and the newest `-debug` dump is 4.3.7 against an installed 4.4.6, so
 * for `is_nomadic` and the whole `carrier` family the installed game is the only
 * witness there is.
 *
 * What the command *holds* is not witnessed the same way. Only the shape vanilla
 * writes is recorded, and a block is left open: claiming to know the inside of
 * `carrier_event = { ... }` would invent a constraint, and a wrong constraint
 * rejects correct script.
 *
 * The output is committed and reviewed rather than recomputed, so a command that
 * appears in a later patch arrives as a diff.
 */

const REPOSITORY_ROOT: string = fileURLToPath(new URL("../../", import.meta.url));
const OUTPUT: string = join(REPOSITORY_ROOT, "src", "schema", "vanilla-commands.ts");

/**
 * How many uses make a key a command.
 *
 * One. A line inside a trigger or effect block is a line the engine evaluates,
 * so one use is already the game saying the command exists — and the eleven
 * single-use ones here are `cancel_contract`, `return_from_mia`,
 * `set_animation_state` and the like, which are plainly commands. Vanilla's own
 * bad lines are all `static_modifier` ids in modifier blocks, and modifier
 * context is excluded above.
 */
const MINIMUM_USES = 1;

/**
 * Keys that are a rule elsewhere rather than a command of their own.
 *
 * `else = { limit = { ... } }` appears seven times in vanilla. Read as a command
 * it would make `limit` legal in every effect block; it belongs to `else`, so it
 * was added there instead.
 */
const NOT_COMMANDS: ReadonlySet<string> = new Set(["effect:limit", "trigger:limit"]);

const SHAPE_VALUE: Readonly<Record<ValueShape, string>> = {
  block: "anyValue()",
  boolean: 'primitive("boolean")',
  integer: 'primitive("integer")',
  list: "anyValue()",
  number: 'primitive("number")',
  scalar: 'primitive("scalar")',
};

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The schema as it was before this file existed.
 *
 * A second run has to propose the same commands rather than deciding nothing is
 * missing, so the corpus is assembled here without its own output folded in.
 */
const base: SchemaModel = {
  ...schema,
  commands: withScopeConstraints(importedCommands),
  ruleSets,
};

const gamePath: string = requireGamePath();
const report: ConformanceReport = await checkConformance(base, gamePath);

interface Proposal {
  readonly id: string;
  readonly family: ScriptBlockValue["family"];
  readonly shape: ValueShape;
  readonly uses: number;
  readonly types: Set<string>;
  readonly example: string;
}

const proposals = new Map<string, Proposal>();
const skippedRare: string[] = [];

for (const type of report.types) {
  for (const finding of type.unknownFields) {
    if (finding.context === "block") {
      continue;
    }

    // A modifier name is not a command: it is resolved against the generated
    // namespace, and adding it here would let any name through.
    if (finding.context === "modifier") {
      continue;
    }

    const family: ScriptBlockValue["family"] = finding.context;
    const identity: string = `${family}:${finding.field}`;

    if (NOT_COMMANDS.has(identity)) {
      continue;
    }
    const existing: Proposal | undefined = proposals.get(identity);

    if (existing === undefined) {
      proposals.set(identity, {
        id: finding.field,
        family,
        shape: finding.shape,
        uses: finding.occurrences,
        types: new Set([type.type]),
        example: finding.examples[0] ?? "",
      });
      continue;
    }

    existing.types.add(type.type);
    proposals.set(identity, {
      ...existing,
      uses: existing.uses + finding.occurrences,
      shape: existing.shape === finding.shape ? existing.shape : "scalar",
      types: existing.types,
    });
  }
}

const kept: readonly Proposal[] = [...proposals.values()]
  .filter((proposal) => {
    if (proposal.uses >= MINIMUM_USES) {
      return true;
    }
    skippedRare.push(`${proposal.family}:${proposal.id}`);
    return false;
  })
  .sort((left, right) => compareOrdinal(left.family, right.family) || compareOrdinal(left.id, right.id));

const lines: string[] = [
  "// Generated by `npm run propose:commands` from the installed game, then reviewed.",
  "//",
  "// Triggers and effects vanilla writes that cwtools-stellaris-config never",
  "// declared and the newest -debug dump (4.3.7) predates. The game evaluates",
  "// every one of these lines, so they exist; what they hold is only as narrow as",
  "// the shapes vanilla was seen to write, and a block is left open rather than",
  "// invented.",
  "//",
  "// Committed rather than recomputed: a command added by a later patch has to",
  "// arrive as a diff.",
  "",
  ...(kept.length === 0 ? [] : ['import { anyValue, primitive, scriptCommand, unspecifiedScope } from "./ir.js";', ""]),
  'import type { ScriptCommandDefinition } from "./ir.js";',
  "",
  "export const vanillaCommands: readonly ScriptCommandDefinition[] = [",
];

for (const proposal of kept) {
  const types: readonly string[] = [...proposal.types].sort(compareOrdinal);
  lines.push(
    `  // ${String(proposal.uses)} uses across ${String(types.length)} type${types.length === 1 ? "" : "s"}, e.g. ${proposal.example}`,
    "  scriptCommand({",
    `    id: ${JSON.stringify(proposal.id)},`,
    `    family: ${JSON.stringify(proposal.family)},`,
    "    input: unspecifiedScope(),",
    '    operator: "=",',
    `    value: ${SHAPE_VALUE[proposal.shape]},`,
    "  }),",
  );
}

lines.push("];", "");

await writeFile(OUTPUT, lines.join("\n"), "utf8");

const byFamily = new Map<string, number>();
for (const proposal of kept) {
  byFamily.set(proposal.family, (byFamily.get(proposal.family) ?? 0) + 1);
}

console.log(
  [
    "SUMMARY mode=propose-commands",
    `proposed=${String(kept.length)}`,
    ...[...byFamily].sort(([left], [right]) => compareOrdinal(left, right)).map(([f, n]) => `${f}=${String(n)}`),
    `skippedBelowThreshold=${String(skippedRare.length)}`,
  ].join(" "),
);

for (const rare of skippedRare.sort(compareOrdinal).slice(0, 40)) {
  console.log(`RARE ${rare}`);
}

if (skippedRare.length > 40) {
  console.log(`RARE ${String(skippedRare.length - 40)} further single-use keys not listed.`);
}
