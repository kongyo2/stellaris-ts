import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { requireGamePath } from "./game-path.js";

import { vanillaFieldNames } from "../src/generated/vanilla/index.js";
import { schema } from "../src/schema/index.js";
import { isVanillaDefect, vanillaFieldDefects } from "../src/schema/vanilla-defects.js";
import { checkConformance, renderConformanceReport, type ConformanceReport } from "./verify-schema/conformance.js";

const REPOSITORY_ROOT: string = fileURLToPath(new URL("../", import.meta.url));
const REPORT_PATH: string = join(REPOSITORY_ROOT, "docs", "schema-conformance.md");

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

await mkdir(dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, `${renderConformanceReport(report, version)}\n`, "utf8");

const declaredFields: number = Object.values(vanillaFieldNames).reduce((total, names) => total + names.length, 0);

/**
 * Every unknown field left, minus the lines the game itself drops.
 *
 * Direction A is held at zero across all 229 types now, not just the gated five:
 * `npm run propose:corrections` turns what vanilla writes into rules, so a field
 * still reported here is one nobody has looked at.
 */
const unexplained: readonly { readonly type: string; readonly fields: readonly string[] }[] = report.types
  .map((entry) => ({
    type: entry.type,
    fields: entry.unknownFields.map((finding) => finding.field).filter((field) => !isVanillaDefect(entry.type, field)),
  }))
  .filter((entry) => entry.fields.length > 0);

const defectsFound: number = report.types.reduce(
  (total, entry) => total + entry.unknownFields.filter((finding) => isVanillaDefect(entry.type, finding.field)).length,
  0,
);

const expectedDefects: number = Object.values(vanillaFieldDefects).reduce((total, list) => total + list.length, 0);

for (const entry of unexplained) {
  for (const field of entry.fields) {
    console.error(`CONFORMANCE ${entry.type} unknown-field: ${field}`);
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
    `unknownFields=${String(report.unknownFieldTotal)}`,
    `unusedRules=${String(report.unusedRuleTotal)}`,
    `missingDirectories=${String(report.missingDirectories.length)}`,
    `unexplainedFields=${String(unexplained.reduce((total, entry) => total + entry.fields.length, 0))}`,
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
  defectsFound !== expectedDefects ||
  missingGated.length > 0 ||
  strictnessRegressed ||
  declaredFields < DECLARED_FIELD_FLOOR
) {
  process.exitCode = 1;
}
