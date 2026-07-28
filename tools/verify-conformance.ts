import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { requireGamePath } from "./game-path.js";

import { vanillaFieldNames } from "../src/generated/vanilla/index.js";
import { schema } from "../src/schema/index.js";
import { isVanillaDefect, vanillaFieldDefects } from "../src/schema/vanilla-defects.js";
import { checkConformance, type ConformanceReport } from "./verify-schema/conformance.js";

/**
 * Types that must be strict enough for a verdict to mean anything.
 *
 * Every type is now held to zero unknown fields, but a permissive type reaches
 * zero by accepting everything. These five are checked for strictness as well:
 * the first four are what the MVP takes end to end, and `static_modifier` is the
 * one type whose fields are modifier names, so its verdict is what proves the
 * modifier namespace resolves.
 */
const GATED_TYPES: readonly string[] = ["building", "technology", "trait", "event", "static_modifier"];

/**
 * How many of the gated types can currently detect an unknown field at all.
 *
 * A type is `permissive` when some top-level rule accepts arbitrary keys — an
 * open rule-set expansion, or a key drawn from an enum whose members are
 * extracted from the game rather than listed in the corpus. Zero unknown fields
 * on a permissive type proves nothing, so the count is pinned here: it may rise
 * as extraction lands in Phase 8, never fall silently.
 */
const STRICT_GATED_BUDGET = 5;

/**
 * How many field names the game must still be declaring for itself.
 *
 * The defines types accept whatever `index:game` read out of `common/defines`,
 * which is right — the engine decides what a define is — but it also means a
 * broken extractor would make them accept nothing and report nothing, and the
 * report would look better for it. 2,379 names were read from 4.4.6; the floor
 * is low enough to survive a patch removing some and high enough that an empty
 * extraction fails.
 */
const DECLARED_FIELD_FLOOR = 2000;

async function gameVersion(gamePath: string): Promise<string> {
  try {
    const raw: string = await readFile(join(gamePath, "launcher-settings.json"), "utf8");
    const match: RegExpExecArray | null = /"rawVersion"\s*:\s*"([^"]+)"/u.exec(raw);
    return match?.[1] ?? "unknown";
  } catch {
    return "unknown";
  }
}

const gamePath: string = requireGamePath();
const report: ConformanceReport = await checkConformance(schema, gamePath);
const version: string = await gameVersion(gamePath);

// Findings go to the console and nowhere else. A generated markdown report reads
// as a specification of the gaps it lists, and the gaps are defects rather than
// design; writing them up invites treating them as settled.
if (process.argv.includes("--list-unused")) {
  for (const entry of report.types) {
    for (const rule of entry.unusedRules) {
      console.log(`UNUSED ${entry.type} ${rule}`);
    }
  }
}

const declaredFields: number = Object.values(vanillaFieldNames).reduce((total, names) => total + names.length, 0);

/**
 * Every unknown key left, minus the lines the game itself drops.
 *
 * Held at zero across all types and every depth: `npm run propose:corrections`
 * and `npm run propose:commands` turn what vanilla writes into rules, so a key
 * still reported here is one nobody has looked at.
 */
const unexplained: readonly { readonly type: string; readonly where: string; readonly occurrences: number }[] =
  report.types.flatMap((entry) =>
    entry.unknownFields
      .filter((finding) => !isVanillaDefect(entry.type, finding.field, finding.path))
      .map((finding) => ({
        type: entry.type,
        where: finding.path.length === 0 ? finding.field : `${finding.path}.${finding.field}`,
        occurrences: finding.occurrences,
        example: finding.examples[0] ?? "",
      })),
  );

const defectsFound: number = report.types.reduce(
  (total, entry) =>
    total + entry.unknownFields.filter((finding) => isVanillaDefect(entry.type, finding.field, finding.path)).length,
  0,
);

const expectedDefects: number = Object.values(vanillaFieldDefects).reduce((total, list) => total + list.length, 0);

const REPORTED_LIMIT = 60;

for (const entry of unexplained.slice(0, REPORTED_LIMIT)) {
  console.error(`CONFORMANCE ${entry.type} unknown-key: ${entry.where} (${String(entry.occurrences)}x)`);
}

if (unexplained.length > REPORTED_LIMIT) {
  console.error(`CONFORMANCE ${String(unexplained.length - REPORTED_LIMIT)} further unknown keys not listed.`);
}

// Direction C: a field the schema requires that a vanilla definition omits.
// The game loads those definitions, so the requirement is the schema's mistake,
// and every one of them would reject correct mod script.
for (const entry of report.types) {
  for (const finding of entry.missingRequired) {
    console.error(
      `CONFORMANCE ${entry.type} phantom-requirement: ${finding.field} is required, and ${String(finding.missingFrom)} of ${String(entry.definitionsSeen)} vanilla definitions omit it.`,
    );
  }
}

if (defectsFound !== expectedDefects) {
  console.error(
    `CONFORMANCE ${String(expectedDefects)} vanilla defects are listed but ${String(defectsFound)} were found; a listed one has stopped being reported, so the list is stale.`,
  );
}

const missingGated: readonly string[] = GATED_TYPES.filter(
  (type) => !report.types.some((entry) => entry.type === type),
);

const strictGated: readonly string[] = report.types
  .filter((entry) => GATED_TYPES.includes(entry.type) && entry.strictness === "strict")
  .map((entry) => entry.type);
const permissiveGated: readonly string[] = report.types
  .filter((entry) => GATED_TYPES.includes(entry.type) && entry.strictness === "permissive")
  .map((entry) => entry.type);
const strictnessRegressed: boolean = strictGated.length < STRICT_GATED_BUDGET;

for (const type of permissiveGated) {
  console.error(
    `CONFORMANCE ${type} permissive: a top-level rule accepts arbitrary keys, so zero unknown fields proves nothing here.`,
  );
}

if (strictnessRegressed) {
  console.error(
    `CONFORMANCE strict gated types fell from ${String(STRICT_GATED_BUDGET)} to ${String(strictGated.length)}.`,
  );
}

for (const type of missingGated) {
  console.error(`CONFORMANCE ${type} not-checked: its source directory was not found in this install.`);
}

console.log(
  [
    "SUMMARY mode=conformance",
    `version=${version}`,
    `types=${String(report.types.length)}`,
    `strict=${String(report.strictTypeCount)}`,
    `keysChecked=${String(report.keysChecked)}`,
    `unknownKeys=${String(report.unknownFieldTotal)}`,
    `topLevelUnknown=${String(report.topLevelUnknownTotal)}`,
    `unusedRules=${String(report.unusedRuleTotal)}`,
    `phantomRequirements=${String(report.missingRequiredTotal)}`,
    `missingDirectories=${String(report.missingDirectories.length)}`,
    `unexplainedKeys=${String(unexplained.length)}`,
    `gatedStrict=${String(strictGated.length)}/${String(GATED_TYPES.length)}`,
    `gatedPermissive=${permissiveGated.join(",") || "none"}`,
    `vanillaDefects=${String(defectsFound)}`,
    `modifierDump=${schema.modifiers.source}`,
    `gameDeclaredFields=${String(declaredFields)}`,
  ].join(" "),
);

if (declaredFields < DECLARED_FIELD_FLOOR) {
  console.error(
    `CONFORMANCE the game declared ${String(declaredFields)} field names, below the floor of ${String(DECLARED_FIELD_FLOOR)}; the defines types would accept nothing and report nothing. Re-run \`npm run index:game\`.`,
  );
}

if (
  unexplained.length > 0 ||
  report.missingRequiredTotal > 0 ||
  defectsFound !== expectedDefects ||
  missingGated.length > 0 ||
  strictnessRegressed ||
  declaredFields < DECLARED_FIELD_FLOOR
) {
  process.exitCode = 1;
}
