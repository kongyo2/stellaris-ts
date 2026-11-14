import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { requireGamePath } from "./game-path.js";

import { vanillaFieldNames } from "../src/generated/vanilla/index.js";
import { schema } from "../src/schema/index.js";
import {
  isVanillaDefect,
  isVanillaMissingFile,
  isVanillaScopeDefect,
  isVanillaUnlocalisedDefinition,
  isVanillaUnlocalisedReference,
  isVanillaUnresolvedReference,
  isVanillaValueDefect,
  vanillaFieldDefects,
  vanillaMissingFiles,
  vanillaScopeDefects,
  vanillaUnlocalisedDefinitions,
  vanillaUnlocalisedReferences,
  vanillaUnresolvedReferences,
} from "../src/schema/vanilla-defects.js";
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

/**
 * How many definitions the load checks must have read.
 *
 * The gate fails on a finding, and a check that reads nothing finds nothing:
 * a type id renamed in `loadCheckedTypes`, or a definition block that stops
 * matching, would pass it in silence. 4.5.2 has 18,117 definitions of the
 * checked types, more than half of them events; the floor is low enough to survive a
 * patch and high enough that losing a whole type fails.
 */
const LOAD_CHECK_FLOOR = 15_000;

/**
 * The same for the `else` and `else_if` matched to an `if`: 4.5.2 writes 4,392
 * outside the body of an `if`, where the older nested form is left alone.
 */
const BRANCH_FLOOR = 3500;

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

// Direction E: a value the rules reject. Reported the same way as an unknown
// key, because the game treats it the same way — the line is read and dropped.
const unexplainedValues = report.types.flatMap((entry) =>
  entry.valueMismatches
    .filter((finding) => !isVanillaValueDefect(entry.type, finding.path, finding.field, finding.example))
    .map((finding) => ({ type: entry.type, ...finding })),
);

for (const finding of unexplainedValues) {
  console.error(
    `CONFORMANCE ${finding.type} value: ${finding.path.length === 0 ? finding.field : `${finding.path}.${finding.field}`} must be ${finding.expected}, and vanilla writes ${JSON.stringify(finding.example)} (${String(finding.occurrences)}x, e.g. ${finding.examples[0] ?? ""}).`,
  );
}

// Direction D: a command written in a scope its constraint forbids. The game
// answers a wrongly-scoped trigger with `false` for ever and never says why, so
// a disagreement here is either a real bug in vanilla or a wrong constraint —
// and the constraints come from a dump two patches older than the install.
const unexplainedScopes = report.types.flatMap((entry) =>
  entry.scopeViolations
    .filter((finding) => !isVanillaScopeDefect(entry.type, finding.path, finding.command))
    .map((finding) => ({ type: entry.type, finding })),
);

const staleScopes: readonly string[] = Object.entries(vanillaScopeDefects).flatMap(([type, sites]) =>
  sites.filter(
    (site) =>
      !report.types.some(
        (entry) =>
          entry.type === type && entry.scopeViolations.some((finding) => `${finding.path} ${finding.command}` === site),
      ),
  ),
);

for (const site of staleScopes) {
  console.error(`CONFORMANCE ${site} is listed as a scope mistake in vanilla and is no longer found.`);
}

for (const { type, finding } of unexplainedScopes) {
  console.error(
    `CONFORMANCE ${type} scope: ${finding.command} at ${finding.path} runs in ${finding.writtenIn}, and accepts only ${finding.accepts.join(", ")} (${String(finding.occurrences)}x, e.g. ${finding.examples[0] ?? ""}).`,
  );
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

// Direction F: a block where the rules take a single value, or a bare block in
// a list where no item rule takes one. The game reads the `{` as the value and
// the block's contents one level up, so a vanilla file that loads this way is a
// hole in the schema — and `validate` reports the same shape in a mod as an
// error.
for (const entry of report.types) {
  for (const finding of entry.shapeMismatches) {
    console.error(
      `CONFORMANCE ${entry.type} shape: ${finding.path.length === 0 ? finding.field : `${finding.path}.${finding.field}`} is a block, and ${finding.shape === "block-for-value" ? "every rule takes a single value" : "no item rule takes a block"} (${String(finding.occurrences)}x, e.g. ${finding.examples[0] ?? ""}).`,
    );
  }
}

// Direction G: a comparison outside a trigger. Nothing there reads the
// operator unless the rule says so, and `validate` reports one in a mod.
for (const entry of report.types) {
  for (const finding of entry.comparisonMismatches) {
    console.error(
      `CONFORMANCE ${entry.type} comparison: ${finding.path.length === 0 ? finding.field : `${finding.path}.${finding.field}`} ${finding.operator} outside a trigger, and no rule for it compares (${String(finding.occurrences)}x, e.g. ${finding.examples[0] ?? ""}).`,
    );
  }
}

// Direction N: an `else` or an `else_if` with no `if` read just before it.
// The game logs "Else/else if not following an if or else if" for one and
// drops the branch, and `validate` reports one in a mod as an error.
for (const entry of report.types) {
  for (const finding of entry.branchMismatches) {
    console.error(
      `CONFORMANCE ${entry.type} branch: ${finding.field} ${finding.path.length === 0 ? "at the root" : `inside ${finding.path}`} follows no if (${String(finding.occurrences)}x, e.g. ${finding.examples[0] ?? ""}).`,
    );
  }
}

// Direction L: a string vanilla names that no localisation file defines. The
// game shows such a key as itself, so a rule reading the value as a string's
// name is right only if vanilla's own values are strings' names; each one that
// is not is either a gap in vanilla, listed by key, or a rule to correct.
const unexplainedStrings = report.types.flatMap((entry) =>
  entry.unresolvedStrings
    .filter((finding) => !isVanillaUnlocalisedReference(entry.type, finding.key))
    .map((finding) => ({ type: entry.type, ...finding })),
);

for (const finding of unexplainedStrings) {
  const where: string =
    finding.field === "<key>"
      ? `the key ${finding.key} written`
      : finding.field === "<item>"
        ? "an item"
        : finding.field;
  console.error(
    `CONFORMANCE ${finding.type} unlocalised: ${where} ${finding.path.length === 0 ? "" : `inside ${finding.path} `}names ${finding.key}, which no localisation file defines (${String(finding.occurrences)}x, e.g. ${finding.examples[0] ?? ""}).`,
  );
}

// Direction R: a name vanilla writes where every rule reads a reference, and
// which names no definition the index holds. `validate` reports the same in a
// mod, so each one is a rule that reads the value wrongly, an index that
// misses definitions the game has, or something vanilla names and never
// defined — the last listed by name, the others to be corrected.
const unexplainedReferences = report.types.flatMap((entry) =>
  entry.unresolvedReferences
    .filter((finding) => !isVanillaUnresolvedReference(entry.type, finding.name))
    .map((finding) => ({ type: entry.type, ...finding })),
);

const REFERENCE_LIMIT = 400;

for (const finding of unexplainedReferences.slice(0, REFERENCE_LIMIT)) {
  console.error(
    `CONFORMANCE ${finding.type} reference: ${finding.field === "<item>" ? "an item" : finding.field} ${finding.path.length === 0 ? "" : `inside ${finding.path} `}names ${finding.types.join(" or ")} ${finding.name}, which the index does not hold (${String(finding.occurrences)}x, e.g. ${finding.examples[0] ?? ""}).`,
  );
}

if (unexplainedReferences.length > REFERENCE_LIMIT) {
  console.error(
    `CONFORMANCE ${String(unexplainedReferences.length - REFERENCE_LIMIT)} further unresolved references not listed.`,
  );
}

const staleReferences: readonly string[] = Object.entries(vanillaUnresolvedReferences).flatMap(([type, names]) =>
  names
    .filter(
      (name) =>
        !report.types.some(
          (entry) => entry.type === type && entry.unresolvedReferences.some((finding) => finding.name === name),
        ),
    )
    .map((name) => `${type} reference ${name}`),
);

for (const stale of staleReferences) {
  console.error(`CONFORMANCE ${stale} is listed as a reference to nothing in vanilla and is no longer found.`);
}

// Direction A: a file vanilla names where every rule reads a file, which the
// index of the game's files does not hold. `validate` reports the same in a
// mod as a file nothing ships.
const missingFiles = report.types.flatMap((entry) =>
  entry.missingFiles
    .filter((finding) => !isVanillaMissingFile(entry.type, finding.name))
    .map((finding) => ({ type: entry.type, ...finding })),
);

const staleFiles: readonly string[] = Object.entries(vanillaMissingFiles).flatMap(([type, names]) =>
  names
    .filter(
      (name) =>
        !report.types.some(
          (entry) => entry.type === type && entry.missingFiles.some((finding) => finding.name === name),
        ),
    )
    .map((name) => `${type} file ${name}`),
);

for (const stale of staleFiles) {
  console.error(`CONFORMANCE ${stale} is listed as a file vanilla names and does not ship, and is no longer found.`);
}

const FILE_LIMIT = 150;
const fileGroups = new Map<string, { count: number; names: string[]; example: string }>();
for (const finding of missingFiles) {
  const where: string = `${finding.type} ${finding.path.length === 0 ? "" : `${finding.path}.`}${finding.field}`;
  const group = fileGroups.get(where) ?? { count: 0, names: [], example: finding.examples[0] ?? "" };
  group.count += finding.occurrences;
  if (group.names.length < 4) {
    group.names.push(finding.name);
  }
  fileGroups.set(where, group);
}
for (const [where, group] of [...fileGroups].slice(0, FILE_LIMIT)) {
  console.error(
    `CONFORMANCE ${where} file: names ${group.names.join(", ")}${group.names.length < group.count ? ", …" : ""}, which the game does not ship (${String(group.count)}x, e.g. ${group.example}).`,
  );
}

const referenceGaps: number = report.types.reduce(
  (total, entry) =>
    total +
    entry.unresolvedReferences.filter((finding) => isVanillaUnresolvedReference(entry.type, finding.name)).length,
  0,
);

// And a string a requirement asks of every definition, which vanilla's own
// definitions lack. Kept as a requirement only where vanilla nearly always has
// it, with the exceptions listed by id; otherwise the requirement is wrong.
const unexplainedMissing = report.types.flatMap((entry) =>
  entry.missingStrings.flatMap((finding) =>
    finding.ids
      .filter((id) => !isVanillaUnlocalisedDefinition(entry.type, id))
      .map((id) => ({ type: entry.type, pattern: finding.pattern, id, finding })),
  ),
);

for (const { type, pattern, id, finding } of unexplainedMissing) {
  console.error(
    `CONFORMANCE ${type} missing-string: ${pattern}${finding.variant === undefined ? "" : ` (variant ${finding.variant})`} is required, and vanilla's ${id} has none; ${String(finding.missingFrom)} of ${String(finding.appliesTo)} lack it.`,
  );
}

// A listed gap that is no longer found has been fixed, or the rule reading it
// changed; either way the list is stale and would excuse the next one.
const staleStrings: readonly string[] = [
  ...Object.entries(vanillaUnlocalisedReferences).flatMap(([type, keys]) =>
    keys
      .filter(
        (key) =>
          !report.types.some(
            (entry) => entry.type === type && entry.unresolvedStrings.some((finding) => finding.key === key),
          ),
      )
      .map((key) => `${type} reference ${key}`),
  ),
  ...Object.entries(vanillaUnlocalisedDefinitions).flatMap(([type, ids]) =>
    ids
      .filter(
        (id) =>
          !report.types.some(
            (entry) => entry.type === type && entry.missingStrings.some((finding) => finding.ids.includes(id)),
          ),
      )
      .map((id) => `${type} definition ${id}`),
  ),
];

for (const stale of staleStrings) {
  console.error(`CONFORMANCE ${stale} is listed as a localisation gap in vanilla and is no longer found.`);
}

// Direction M: what the game's loader logs about a definition — an entity or
// an outliner icon it cannot find, an approach or a weight's reason it says
// will not display well. The game loads vanilla without one of those lines in
// its log, so a vanilla definition one of these checks reports is a check
// that is wrong.
const loadFindings = report.types.flatMap((entry) =>
  entry.loadFindings.map((finding) => ({ type: entry.type, ...finding })),
);

for (const finding of loadFindings) {
  console.error(
    `CONFORMANCE ${finding.type} load-check: ${finding.id}${finding.path.length === 0 ? "" : `.${finding.path}`} ${finding.code}: ${finding.message} (${finding.file})`,
  );
}

const loadChecked: number = report.types.reduce((total, entry) => total + entry.loadChecked, 0);

const stringGaps: number = report.types.reduce(
  (total, entry) =>
    total + entry.unresolvedStrings.filter((finding) => isVanillaUnlocalisedReference(entry.type, finding.key)).length,
  0,
);

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
    `scopeViolations=${String(unexplainedScopes.length)}`,
    `valueMismatches=${String(unexplainedValues.length)}`,
    `shapeMismatches=${String(report.shapeMismatchTotal)}`,
    `comparisonMismatches=${String(report.comparisonMismatchTotal)}`,
    `branchMismatches=${String(report.branchMismatchTotal)}/${String(report.branchesChecked)}`,
    `missingDirectories=${String(report.missingDirectories.length)}`,
    `unexplainedKeys=${String(unexplained.length)}`,
    `gatedStrict=${String(strictGated.length)}/${String(GATED_TYPES.length)}`,
    `gatedPermissive=${permissiveGated.join(",") || "none"}`,
    `vanillaDefects=${String(defectsFound)}`,
    `stringsChecked=${String(report.stringsChecked)}`,
    `scopelessEvents=${String(report.scopelessEventsWalked)}/${String(report.scopelessEvents)}`,
    `callsFollowed=${String(report.callsFollowed)}`,
    `unlocalised=${String(unexplainedStrings.length)}`,
    `missingStrings=${String(unexplainedMissing.length)}`,
    `vanillaStringGaps=${String(stringGaps)}`,
    `filesChecked=${String(report.filesChecked)}`,
    `missingFiles=${String(missingFiles.length)}`,
    `referencesChecked=${String(report.referencesChecked)}`,
    `unresolvedReferences=${String(unexplainedReferences.length)}`,
    `vanillaReferenceGaps=${String(referenceGaps)}`,
    `loadChecked=${String(loadChecked)}`,
    `loadFindings=${String(loadFindings.length)}`,
    `modifierDump=${schema.modifiers.source}`,
    `gameDeclaredFields=${String(declaredFields)}`,
  ].join(" "),
);

if (loadChecked < LOAD_CHECK_FLOOR) {
  console.error(
    `CONFORMANCE the load checks read ${String(loadChecked)} definitions, below the floor of ${String(LOAD_CHECK_FLOOR)}; a check that reads nothing finds nothing.`,
  );
}

if (report.branchesChecked < BRANCH_FLOOR) {
  console.error(
    `CONFORMANCE ${String(report.branchesChecked)} else and else_if were matched to an if, below the floor of ${String(BRANCH_FLOOR)}.`,
  );
}

if (declaredFields < DECLARED_FIELD_FLOOR) {
  console.error(
    `CONFORMANCE the game declared ${String(declaredFields)} field names, below the floor of ${String(DECLARED_FIELD_FLOOR)}; the defines types would accept nothing and report nothing. Re-run \`npm run index:game\`.`,
  );
}

if (
  unexplained.length > 0 ||
  report.missingRequiredTotal > 0 ||
  unexplainedScopes.length > 0 ||
  staleScopes.length > 0 ||
  unexplainedValues.length > 0 ||
  report.shapeMismatchTotal > 0 ||
  report.comparisonMismatchTotal > 0 ||
  report.branchMismatchTotal > 0 ||
  report.branchesChecked < BRANCH_FLOOR ||
  loadChecked < LOAD_CHECK_FLOOR ||
  defectsFound !== expectedDefects ||
  unexplainedStrings.length > 0 ||
  unexplainedMissing.length > 0 ||
  staleStrings.length > 0 ||
  unexplainedReferences.length > 0 ||
  staleReferences.length > 0 ||
  missingFiles.length > 0 ||
  staleFiles.length > 0 ||
  loadFindings.length > 0 ||
  missingGated.length > 0 ||
  strictnessRegressed ||
  declaredFields < DECLARED_FIELD_FLOOR
) {
  process.exitCode = 1;
}
