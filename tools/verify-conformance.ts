import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { requireGamePath } from "./game-path.js";

import { schema } from "../src/schema/index.js";
import { checkConformance, renderConformanceReport, type ConformanceReport } from "./verify-schema/conformance.js";

const REPOSITORY_ROOT: string = fileURLToPath(new URL("../", import.meta.url));
const REPORT_PATH: string = join(REPOSITORY_ROOT, "docs", "schema-conformance.md");

/**
 * Types that must have no unknown fields.
 *
 * A hole in one of these shows up as a mod that fails to load. The first four
 * are what the MVP takes end to end; `static_modifier` joins them because its
 * fields are modifier names, so it is the one type whose verdict proves the
 * modifier namespace resolves.
 */
const GATED_TYPES: readonly string[] = ["building", "technology", "trait", "event", "static_modifier"];

/**
 * Fields vanilla writes that are not fields of anything.
 *
 * Each of these is a `static_modifier` id written where a modifier name belongs,
 * inside another static modifier's body. None of the 3,081 static modifier ids
 * is a modifier — the game's own documentation lists zero of them — so the game
 * reads these lines and drops them. They are vanilla's mistakes, not the
 * schema's, and they are listed by name so that a seventh one still fails.
 */
const VANILLA_DEFECTS: Readonly<Record<string, readonly string[]>> = {
  static_modifier: [
    // 16_static_modifiers_paragon.txt:359, inside its own definition
    "paragon_death_the_hive_endures",
    // 23_static_modifiers_unplugged.txt:62
    "planet_new_colony_militarist_attraction",
    // 11_static_modifiers_federations.txt:853 and :858
    "proclaim_religious_finding",
    "proclaim_superiority",
    // 25_static_modifiers_nomads.txt:396
    "sacred_path_jobs_bonus_workforce_mult",
    // 21_static_modifiers_cosmic_storms.txt
    "storm_attraction_field_modifier",
  ],
};

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

const gated: readonly { readonly type: string; readonly fields: readonly string[] }[] = report.types
  .filter((entry) => GATED_TYPES.includes(entry.type))
  .map((entry) => ({
    type: entry.type,
    fields: entry.unknownFields
      .map((finding) => finding.field)
      .filter((field) => !(VANILLA_DEFECTS[entry.type] ?? []).includes(field)),
  }))
  .filter((entry) => entry.fields.length > 0);

const defectsFound: number = report.types
  .filter((entry) => GATED_TYPES.includes(entry.type))
  .reduce(
    (total, entry) =>
      total +
      entry.unknownFields.filter((finding) => (VANILLA_DEFECTS[entry.type] ?? []).includes(finding.field)).length,
    0,
  );

for (const entry of gated) {
  for (const field of entry.fields) {
    console.error(`CONFORMANCE ${entry.type} unknown-field: ${field}`);
  }
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
    `gatedUnknownFields=${String(gated.reduce((total, entry) => total + entry.fields.length, 0))}`,
    `gatedStrict=${String(strictGated.length)}/${String(GATED_TYPES.length)}`,
    `gatedPermissive=${permissiveGated.join(",") || "none"}`,
    `vanillaDefects=${String(defectsFound)}`,
    `modifierDump=${schema.modifiers.source}`,
  ].join(" "),
);

if (gated.length > 0 || missingGated.length > 0 || strictnessRegressed) {
  process.exitCode = 1;
}
