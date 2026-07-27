import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { schema } from "../../src/schema/index.js";

/**
 * Imports the game's own scope documentation.
 *
 * `-debug` makes Stellaris dump every trigger and effect with the scopes it
 * accepts. That is the game speaking for itself, which beats the ported corpus:
 * cwtools-stellaris-config carries no scope constraint for any of the 2,328
 * scripted commands, so without this the scope-typed surface constrains
 * nothing.
 *
 * The dumps are collected at <https://github.com/OldEnt/stellaris-triggers-modifiers-effects-list>.
 * They lag the current build slightly, so the version read is recorded next to
 * the data rather than assumed to match.
 */

const REPOSITORY_ROOT: string = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE_DIRECTORY: string = join(REPOSITORY_ROOT, "refs", "stellaris-triggers-modifiers-effects-list");
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

async function latestDump(kind: string): Promise<{ readonly version: string; readonly text: string }> {
  const { readdir } = await import("node:fs/promises");
  const names: readonly string[] = (await readdir(SOURCE_DIRECTORY)).filter((name) =>
    name.endsWith(`_game_${kind}.log`),
  );

  const versioned: { readonly version: string; readonly name: string; readonly key: readonly number[] }[] = names.map(
    (name) => {
      const version: string = name.slice(0, name.indexOf("_game_"));
      return { version, name, key: version.split(".").map((part) => Number.parseInt(part, 10) || 0) };
    },
  );

  const newest = versioned.sort((left, right): number => {
    for (let index = 0; index < Math.max(left.key.length, right.key.length); index += 1) {
      const difference: number = (right.key[index] ?? 0) - (left.key[index] ?? 0);
      if (difference !== 0) {
        return difference;
      }
    }
    return compareOrdinal(right.version, left.version);
  })[0];

  if (newest === undefined) {
    throw new Error(`No ${kind} dump found in ${SOURCE_DIRECTORY}. Run \`npm run refs:sync\` first.`);
  }

  return { version: newest.version, text: await readFile(join(SOURCE_DIRECTORY, newest.name), "utf8") };
}

const triggers = await latestDump("triggers");
const effects = await latestDump("effects");
const knownScopes: ReadonlySet<string> = new Set(schema.scopes.map((scope) => scope.id));
const aliases = new Map<string, string>();

for (const scope of schema.scopes) {
  aliases.set(scope.id.toLowerCase(), scope.id);
  for (const alias of scope.aliases) {
    aliases.set(alias.toLowerCase(), scope.id);
  }
}

const unknown = new Set<string>();

function resolve(scopes: readonly string[]): readonly string[] {
  const resolved: string[] = [];

  for (const scope of scopes) {
    const canonical: string | undefined = aliases.get(scope);

    if (canonical === undefined || !knownScopes.has(canonical)) {
      unknown.add(scope);
      continue;
    }

    if (!resolved.includes(canonical)) {
      resolved.push(canonical);
    }
  }

  return resolved.sort(compareOrdinal);
}

function render(kind: string, entries: readonly Entry[]): readonly string[] {
  const lines: string[] = [`export const ${kind}Scopes: Readonly<Record<string, readonly string[]>> = {`];

  for (const entry of [...entries].sort((left, right) => compareOrdinal(left.name, right.name))) {
    const resolved: readonly string[] = resolve(entry.scopes);
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
    "// Generated by `npm run import:scopes` from the game's own -debug documentation.",
    `// Trigger dump: ${triggers.version}. Effect dump: ${effects.version}.`,
    "//",
    "// The ported corpus carries no scope constraint for any scripted command, so",
    "// without this the scope-typed surface would constrain nothing. A command",
    "// absent here is unconstrained, which is not the same as constrained to none.",
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
  ].join(" "),
);

if (unknown.size > 0) {
  console.error(`SCOPES unrecognised: ${[...unknown].sort(compareOrdinal).slice(0, 20).join(", ")}`);
}
