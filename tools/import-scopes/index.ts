import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { schema } from "../../src/schema/index.js";
import { describeDump, newestDump } from "../dumps.js";
import type { Dump } from "../dumps.js";

/**
 * Imports the game's own scope documentation.
 *
 * `-debug` makes Stellaris dump every trigger and effect with the scopes it
 * accepts. That is the game speaking for itself, which beats the ported corpus:
 * cwtools-stellaris-config carries no scope constraint for any of the 2,328
 * scripted commands, so without this the scope-typed surface constrains
 * nothing.
 *
 * The newest dump under `refs/` is read: the installed game's own, which
 * `npm run dump:docs` takes, or failing that the newest collected at
 * <https://github.com/OldEnt/stellaris-triggers-modifiers-effects-list>. The
 * version read is recorded next to the data rather than assumed to match, and
 * `verify:conformance` holds it to the installed game's.
 */

const REPOSITORY_ROOT: string = fileURLToPath(new URL("../../", import.meta.url));
const OUTPUT: string = join(REPOSITORY_ROOT, "src", "schema", "scope-constraints.ts");

interface Entry {
  readonly name: string;
  readonly scopes: readonly string[];
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Reads the `name - description … Supported Scopes: a b c` blocks.
 *
 * `all` means the command is unrestricted, which is different from a command
 * the dump never mentions; only the ones that name scopes constrain anything.
 */
function parseDump(text: string): readonly Entry[] {
  const entries: Entry[] = [];
  let current: string | undefined;

  for (const line of text.split("\n")) {
    const trimmed: string = line.trim();
    const heading: RegExpExecArray | null = /^([a-z_][a-z_0-9]*) - /u.exec(trimmed);

    if (heading?.[1] !== undefined) {
      current = heading[1];
      continue;
    }

    const supported: RegExpExecArray | null = /^Supported Scopes:\s*(.+)$/u.exec(trimmed);

    if (supported?.[1] === undefined || current === undefined) {
      continue;
    }

    const scopes: readonly string[] = supported[1]
      .split(/\s+/u)
      .map((scope) => scope.trim().toLowerCase())
      .filter((scope) => scope.length > 0);

    if (!scopes.includes("all") && !scopes.includes("any")) {
      entries.push({ name: current, scopes });
    }

    current = undefined;
  }

  return entries;
}

const triggers: Dump = await newestDump("triggers");
const effects: Dump = await newestDump("effects");
const knownScopes: ReadonlySet<string> = new Set(schema.scopes.map((scope) => scope.id));
const aliases = new Map<string, string>();

for (const scope of schema.scopes) {
  aliases.set(scope.id.toLowerCase(), scope.id);
  for (const alias of scope.aliases) {
    aliases.set(alias.toLowerCase(), scope.id);
  }
}

/**
 * Scope names the dump prints that are not a scope an object can be in.
 *
 * `no_scope` is the empty scope: `any_agreement` lists `country no_scope`
 * because it also runs with nothing in scope at all. The checker never holds
 * that as the current scope, so leaving it out narrows nothing it can test.
 */
const NOT_SCOPES: ReadonlySet<string> = new Set(["no_scope"]);

const unknown = new Set<string>();
const leftOpen: string[] = [];

/**
 * The scopes a command accepts, or `undefined` when one of them is unknown here.
 *
 * Dropping only the unknown name would keep the rest and narrow the command to
 * them: before the catalog had the mission scope, `add_mission_counter`
 * (`country mission`) came out as country-only, and a mod using it on a mission
 * would have been told it could not. A constraint that cannot be stated whole
 * is not stated.
 */
function resolve(scopes: readonly string[]): readonly string[] | undefined {
  const resolved: string[] = [];
  let complete = true;

  for (const scope of scopes) {
    if (NOT_SCOPES.has(scope)) {
      continue;
    }

    const canonical: string | undefined = aliases.get(scope);

    if (canonical === undefined || !knownScopes.has(canonical)) {
      unknown.add(scope);
      complete = false;
      continue;
    }

    if (!resolved.includes(canonical)) {
      resolved.push(canonical);
    }
  }

  return complete ? resolved.sort(compareOrdinal) : undefined;
}

function render(kind: string, entries: readonly Entry[]): readonly string[] {
  const lines: string[] = [`export const ${kind}Scopes: Readonly<Record<string, readonly string[]>> = {`];

  for (const entry of [...entries].sort((left, right) => compareOrdinal(left.name, right.name))) {
    const resolved: readonly string[] | undefined = resolve(entry.scopes);
    if (resolved === undefined) {
      leftOpen.push(`${kind}:${entry.name}`);
      continue;
    }
    if (resolved.length > 0) {
      lines.push(`  ${JSON.stringify(entry.name)}: [${resolved.map((scope) => JSON.stringify(scope)).join(", ")}],`);
    }
  }

  lines.push("};", "");
  return lines;
}

const triggerEntries: readonly Entry[] = parseDump(triggers.text);
const effectEntries: readonly Entry[] = parseDump(effects.text);

await writeFile(
  OUTPUT,
  [
    "// Generated by `npm run import:scopes` from the game's own documentation of itself.",
    `// Trigger dump: ${describeDump(triggers)}.`,
    `// Effect dump: ${describeDump(effects)}.`,
    "//",
    "// The ported corpus carries no scope constraint for any scripted command, so",
    "// without this the scope-typed surface would constrain nothing. A command",
    "// absent here is unconstrained, which is not the same as constrained to none.",
    "",
    "/** The game version each dump was printed by, which `verify:conformance` holds to the installed game's. */",
    `export const scopeConstraintSource: { readonly triggers: string; readonly effects: string } = { triggers: ${JSON.stringify(triggers.version)}, effects: ${JSON.stringify(effects.version)} };`,
    "",
    ...render("trigger", triggerEntries),
    ...render("effect", effectEntries),
  ].join("\n"),
  "utf8",
);

console.log(
  [
    "SUMMARY mode=import-scopes",
    `triggerDump=${triggers.version}`,
    `effectDump=${effects.version}`,
    `constrainedTriggers=${String(triggerEntries.length)}`,
    `constrainedEffects=${String(effectEntries.length)}`,
    `unknownScopeNames=${String(unknown.size)}`,
    `leftUnconstrained=${String(leftOpen.length)}`,
  ].join(" "),
);

if (unknown.size > 0) {
  console.error(`SCOPES unrecognised: ${[...unknown].sort(compareOrdinal).slice(0, 20).join(", ")}`);
  console.error(`SCOPES left unconstrained because of them: ${leftOpen.sort(compareOrdinal).join(", ")}`);
}
