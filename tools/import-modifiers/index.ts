import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { vanillaGameVersion, vanillaIdsByType } from "../../src/generated/vanilla/index.js";
import { describeDump, newestDump } from "../dumps.js";
import type { Dump } from "../dumps.js";

/**
 * Imports the game's own modifier documentation.
 *
 * `-debug` makes Stellaris print every modifier it knows. The list is 41,016
 * names, but it is not 41,016 facts: most of them are generated, one per
 * definition of some type, and the interesting thing is the rule rather than the
 * result. `job_researcher_add` exists because `researcher` is a job — so a mod
 * that adds a job gets its modifiers the same way, and the rule keeps working
 * on a build newer than the dump.
 *
 * So the dump is factored rather than copied: each name is split against the
 * identifiers vanilla declares, a rule is kept when it accounts for nearly every
 * identifier of one type, and whatever no rule explains is the fixed set the
 * executable carries.
 *
 * The newest dump under `refs/` is read: the installed game's own, which
 * `npm run dump:docs` takes with no mod loaded, or failing that the newest
 * collected at <https://github.com/OldEnt/stellaris-triggers-modifiers-effects-list>.
 * A dump taken with a mod loaded lists that mod's modifiers as the game's, so
 * the player's own `logs/script_documentation` is not read. The version is
 * recorded next to the data, and `verify:conformance` holds it to the
 * installed game's.
 */

const REPOSITORY_ROOT: string = fileURLToPath(new URL("../../", import.meta.url));
const OUTPUT: string = join(REPOSITORY_ROOT, "src", "schema", "modifiers.ts");

/**
 * When a candidate rule is believed.
 *
 * The game generates one modifier per definition, so a real rule accounts for
 * nearly all of them; a coincidence accounts for a handful. The floor on how
 * many identifiers a type has matters as much as the ratio: four of five
 * technology tiers matching is a ratio of 0.8 and means nothing, because a tier
 * is spelled `1` and matches any name with a `1` in it.
 */
const MIN_RATIO = 0.7;
const MIN_MATCHED_IDS = 4;
const MIN_TYPE_SIZE = 4;
/** An identifier this short matches by accident. */
const MIN_ID_LENGTH = 3;

interface Template {
  readonly type: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly ids: Set<string>;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// The dump of the build the vanilla tables were indexed from, when there is one.
const dump: Dump = await newestDump("modifiers", "utf8", undefined, vanillaGameVersion.replace(/^v/u, ""));
const dumped: string[] = [];

for (const line of dump.text.split(/\r?\n/u)) {
  const match: RegExpExecArray | null = /^- ([A-Za-z0-9_.-]+), Category: /u.exec(line);

  if (match?.[1] !== undefined) {
    dumped.push(match[1].toLowerCase());
  }
}

const byType: Readonly<Record<string, readonly string[]>> = vanillaIdsByType;
const owners = new Map<string, string[]>();

for (const [type, ids] of Object.entries(byType)) {
  for (const id of ids) {
    if (id.length < MIN_ID_LENGTH) {
      continue;
    }

    const lowered: string = id.toLowerCase();
    const list: string[] | undefined = owners.get(lowered);

    if (list === undefined) {
      owners.set(lowered, [type]);
    } else if (!list.includes(type)) {
      list.push(type);
    }
  }
}

/**
 * Every way a dumped name can be read as `prefix + <id of some type> + suffix`.
 *
 * Splitting on `_` keeps the candidates aligned to how identifiers are written,
 * so `shipsize_civilian_arkship_tier_1_hull_add` offers `civilian_arkship_tier_1`
 * rather than every substring of it.
 */
const templates = new Map<string, Template>();

for (const name of dumped) {
  const tokens: readonly string[] = name.split("_");

  for (let start = 0; start < tokens.length; start += 1) {
    for (let end = tokens.length; end > start; end -= 1) {
      const candidate: string = tokens.slice(start, end).join("_");
      const types: string[] | undefined = owners.get(candidate);

      if (types === undefined) {
        continue;
      }

      const prefix: string = start === 0 ? "" : `${tokens.slice(0, start).join("_")}_`;
      const suffix: string = end === tokens.length ? "" : `_${tokens.slice(end).join("_")}`;

      for (const type of types) {
        const key = `${type}\0${prefix}\0${suffix}`;
        const existing: Template | undefined = templates.get(key);

        if (existing === undefined) {
          templates.set(key, { type, prefix, suffix, ids: new Set([candidate]) });
        } else {
          existing.ids.add(candidate);
        }
      }
    }
  }
}

const eligible: readonly Template[] = [...templates.values()].filter((template) => {
  const size: number = (byType[template.type] ?? []).filter((id) => id.length >= MIN_ID_LENGTH).length;
  return size >= MIN_TYPE_SIZE && template.ids.size >= MIN_MATCHED_IDS && template.ids.size / size >= MIN_RATIO;
});

/**
 * Drops a rule another rule already covers.
 *
 * Two types can share identifiers — `resource` and `agreement_resource` name
 * most of the same things — and then both produce the same rule twice. Only a
 * rule whose identifiers are entirely contained in another's is redundant:
 * buildings and districts both generate `planet_<id>_build_speed_mult` and
 * neither is the other, so both have to stay.
 */
const idSets = new Map<string, ReadonlySet<string>>(Object.entries(byType).map(([type, ids]) => [type, new Set(ids)]));

/** Whether every identifier of one type is also an identifier of another. */
function containedIn(inner: string, outer: string): boolean {
  const left: ReadonlySet<string> | undefined = idSets.get(inner);
  const right: ReadonlySet<string> | undefined = idSets.get(outer);

  if (left === undefined || right === undefined || left.size > right.size) {
    return false;
  }

  for (const id of left) {
    if (!right.has(id)) {
      return false;
    }
  }

  return true;
}

const chosen: Template[] = eligible.filter((template) => {
  const shape = `${template.prefix}\0${template.suffix}`;
  return !eligible.some((other) => {
    if (other === template || `${other.prefix}\0${other.suffix}` !== shape) {
      return false;
    }
    if (!containedIn(template.type, other.type)) {
      return false;
    }
    const mine: number = (byType[template.type] ?? []).length;
    const theirs: number = (byType[other.type] ?? []).length;
    return theirs > mine || compareOrdinal(other.type, template.type) < 0;
  });
});

const produced = new Set<string>();

for (const template of chosen) {
  for (const id of byType[template.type] ?? []) {
    produced.add(`${template.prefix}${id}${template.suffix}`.toLowerCase());
  }
}

const base: readonly string[] = [...new Set(dumped.filter((name) => !produced.has(name)))].sort(compareOrdinal);
const sorted: readonly Template[] = [...chosen].sort(
  (left, right) =>
    compareOrdinal(left.type, right.type) ||
    compareOrdinal(left.prefix, right.prefix) ||
    compareOrdinal(left.suffix, right.suffix),
);

await writeFile(
  OUTPUT,
  [
    "// Generated by `npm run import:modifiers` from the game's own documentation of itself.",
    `// Modifier dump: ${describeDump(dump)}.`,
    "//",
    "// The dump lists names; this lists the rules behind them. A rule is kept when",
    "// it accounts for nearly every identifier of one definition type, which is what",
    "// `the game generates one per definition` looks like from the outside. Names no",
    "// rule explains are fixed in the executable and listed as they are.",
    "",
    'import type { ModifierNamespace } from "./ir.js";',
    "",
    "export const modifierNamespace: ModifierNamespace = {",
    `  source: ${JSON.stringify(dump.version)},`,
    "  base: [",
    ...base.map((name) => `    ${JSON.stringify(name)},`),
    "  ],",
    "  templates: [",
    ...sorted.map(
      (template) =>
        `    { type: ${JSON.stringify(template.type)}, prefix: ${JSON.stringify(template.prefix)}, suffix: ${JSON.stringify(template.suffix)} },`,
    ),
    "  ],",
    "};",
    "",
  ].join("\n"),
  "utf8",
);

const perType = new Map<string, number>();

for (const template of sorted) {
  perType.set(template.type, (perType.get(template.type) ?? 0) + 1);
}

const unexplainedByRule: number = dumped.filter((name) => !produced.has(name)).length;

console.log(
  [
    "SUMMARY mode=import-modifiers",
    `dump=${dump.version}`,
    `dumpedNames=${String(new Set(dumped).size)}`,
    `templates=${String(sorted.length)}`,
    `templateTypes=${String(perType.size)}`,
    `base=${String(base.length)}`,
    `generated=${String(produced.size)}`,
    `namespace=${String(produced.size + base.length)}`,
    `unexplained=${String(unexplainedByRule)}`,
  ].join(" "),
);

console.log(
  `MODIFIERS templates per type: ${[...perType]
    .sort((left, right) => right[1] - left[1])
    .map(([type, count]) => `${type}:${String(count)}`)
    .join(" ")}`,
);
