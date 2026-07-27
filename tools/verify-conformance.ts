import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { schema } from "../src/schema/index.js";
import { checkConformance, renderConformanceReport, type ConformanceReport } from "./verify-schema/conformance.js";

const REPOSITORY_ROOT: string = fileURLToPath(new URL("../", import.meta.url));
const DEFAULT_GAME_PATH: string = String.raw`D:\steam\steamapps\common\Stellaris`;
const REPORT_PATH: string = join(REPOSITORY_ROOT, "docs", "schema-conformance.md");

/**
 * The four types the MVP takes end to end. These must have no unknown fields:
 * a hole here would show up as a mod that fails to load. Every other type has
 * its numbers recorded without gating, because closing all 234 is Phase 8 work.
 */
const GATED_TYPES: readonly string[] = ["building", "technology", "trait", "event"];

/**
 * How many of the gated types can currently detect an unknown field at all.
 *
 * A type is `permissive` when some top-level rule accepts arbitrary keys — an
 * open rule-set expansion, or a key drawn from an enum whose members are
 * extracted from the game rather than listed in the corpus. Zero unknown fields
 * on a permissive type proves nothing, so the count is pinned here: it may rise
 * as extraction lands in Phase 8, never fall silently.
 */
const STRICT_GATED_BUDGET = 4;

async function gameVersion(gamePath: string): Promise<string> {
  try {
    const raw: string = await readFile(join(gamePath, "launcher-settings.json"), "utf8");
    const match: RegExpExecArray | null = /"rawVersion"\s*:\s*"([^"]+)"/u.exec(raw);
    return match?.[1] ?? "unknown";
  } catch {
    return "unknown";
  }
}

const gamePath: string = process.env["STELLARIS_GAME_PATH"] ?? DEFAULT_GAME_PATH;
const report: ConformanceReport = await checkConformance(schema, gamePath);
const version: string = await gameVersion(gamePath);

await mkdir(dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, `${renderConformanceReport(report, version)}\n`, "utf8");

const gated: readonly { readonly type: string; readonly fields: readonly string[] }[] = report.types
  .filter((entry) => GATED_TYPES.includes(entry.type) && entry.unknownFields.length > 0)
  .map((entry) => ({ type: entry.type, fields: entry.unknownFields.map((finding) => finding.field) }));

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
  ].join(" "),
);

if (gated.length > 0 || missingGated.length > 0 || strictnessRegressed) {
  process.exitCode = 1;
}
