import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The game's own documentation of itself, wherever the newest copy is.
 *
 * On every start Stellaris prints the triggers, effects, scope links, modifiers
 * and localisation commands its executable registers into
 * `logs/script_documentation` of its user directory. That is the game speaking
 * for itself, and there are two places a copy may be:
 *
 * - `refs/script-documentation/<version>/`, written by `npm run dump:docs`,
 *   which starts the installed game on an empty user directory — so with no mod
 *   loaded — and keeps what it printed;
 * - `refs/stellaris-triggers-modifiers-effects-list/`, the collection at
 *   <https://github.com/OldEnt/stellaris-triggers-modifiers-effects-list>,
 *   which `npm run refs:sync` clones and which trails the game by a patch or
 *   two.
 *
 * The highest version wins, and between two of one version the installed
 * game's own: it is the build every other gate reads, and a collected dump may
 * have been taken with anything loaded.
 */

const REPOSITORY_ROOT: string = fileURLToPath(new URL("../", import.meta.url));

/** Where `npm run dump:docs` keeps what the installed game printed. */
export const GAME_DUMP_DIRECTORY: string = join(REPOSITORY_ROOT, "refs", "script-documentation");
/** Where `npm run refs:sync` clones the collection. */
export const COLLECTED_DUMP_DIRECTORY: string = join(
  REPOSITORY_ROOT,
  "refs",
  "stellaris-triggers-modifiers-effects-list",
);

export type DumpKind = "effects" | "localizations" | "modifiers" | "scopes" | "triggers";

/** The five files a start of the game writes, by the names it gives them. */
export const DUMP_KINDS: readonly DumpKind[] = ["effects", "localizations", "modifiers", "scopes", "triggers"];

export interface Dump {
  /** The game version, without the leading `v`: `4.5.4`. */
  readonly version: string;
  /** `game` for a dump `npm run dump:docs` took, `collection` for a collected one. */
  readonly origin: "collection" | "game";
  /** The file, from `refs/`. */
  readonly source: string;
  readonly text: string;
}

interface Candidate {
  readonly version: string;
  readonly origin: Dump["origin"];
  readonly source: string;
  readonly path: string;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Orders `4.10.0` after `4.9.2`, which a comparison of the text would not. */
export function compareVersions(left: string, right: string): number {
  const parts = (version: string): readonly number[] =>
    version.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const leftParts: readonly number[] = parts(left);
  const rightParts: readonly number[] = parts(right);

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference: number = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

async function list(directory: string): Promise<readonly string[]> {
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}

/** Where to look, for a test that has dumps of its own. */
export interface DumpRoots {
  readonly game: string;
  readonly collected: string;
}

async function candidates(kind: DumpKind, roots: DumpRoots): Promise<readonly Candidate[]> {
  const versions: readonly string[] = (await list(roots.game)).filter((name) => /^\d+(?:\.\d+)*$/u.test(name));
  const taken: readonly (Candidate | undefined)[] = await Promise.all(
    versions.map(async (version): Promise<Candidate | undefined> =>
      (await list(join(roots.game, version))).includes(`${kind}.log`)
        ? {
            version,
            origin: "game",
            source: `script-documentation/${version}/${kind}.log`,
            path: join(roots.game, version, `${kind}.log`),
          }
        : undefined,
    ),
  );

  // The collection keeps a file per build, and beside them a `compare_versions`
  // folder holding a copy of one of them that is not always the newest.
  const named = new RegExp(`^(\\d+(?:\\.\\d+)*)_game_${kind}\\.(?:log|txt)$`, "u");
  const collected: readonly (readonly Candidate[])[] = await Promise.all(
    ["", "compare_versions/"].map(async (prefix): Promise<readonly Candidate[]> =>
      (await list(join(roots.collected, prefix))).flatMap((name): readonly Candidate[] => {
        const version: string | undefined = named.exec(name)?.[1];
        return version === undefined
          ? []
          : [
              {
                version,
                origin: "collection",
                source: `stellaris-triggers-modifiers-effects-list/${prefix}${name}`,
                path: join(roots.collected, prefix, name),
              },
            ];
      }),
    ),
  );

  return [...taken.filter((candidate) => candidate !== undefined), ...collected.flat()];
}

const DEFAULT_ROOTS: DumpRoots = { game: GAME_DUMP_DIRECTORY, collected: COLLECTED_DUMP_DIRECTORY };

/** Newest first, and the installed game's own before a collected one of the same version. */
function byPreference(left: Candidate, right: Candidate): number {
  return (
    compareVersions(right.version, left.version) ||
    (left.origin === right.origin ? 0 : left.origin === "game" ? -1 : 1) ||
    compareOrdinal(left.source, right.source)
  );
}

async function read(candidate: Candidate, encoding: "latin1" | "utf8"): Promise<Dump> {
  return {
    version: candidate.version,
    origin: candidate.origin,
    source: candidate.source,
    text: new TextDecoder(encoding).decode(await readFile(candidate.path)),
  };
}

/**
 * The dump of one kind to import from.
 *
 * The one of `preferred` — the version of the installed game, which is what
 * the data is checked against — when `refs/` holds it, and otherwise the
 * newest. Taking the newest regardless would import a 4.5.5 dump the
 * collection had gained into a build that reads 4.5.4, and
 * `verify:conformance` would then ask for an import that makes the same
 * choice again.
 *
 * `latin1` for the localisation commands, which the collection has kept in
 * more than one encoding; the names read out of any of them are ASCII.
 */
export async function newestDump(
  kind: DumpKind,
  encoding: "latin1" | "utf8" = "utf8",
  roots: DumpRoots = DEFAULT_ROOTS,
  preferred?: string,
): Promise<Dump> {
  const found: readonly Candidate[] = [...(await candidates(kind, roots))].sort(byPreference);
  const chosen: Candidate | undefined = found.find((candidate) => candidate.version === preferred) ?? found[0];

  if (chosen === undefined) {
    throw new Error(
      `No ${kind} dump found under refs/. Run \`npm run dump:docs\` to take one from the installed game, or \`npm run refs:sync\` for the collected ones.`,
    );
  }

  return read(chosen, encoding);
}

/** The dump of one kind and one version, or nothing: no other version's stands in for it. */
export async function dumpOf(
  kind: DumpKind,
  version: string,
  encoding: "latin1" | "utf8" = "utf8",
  roots: DumpRoots = DEFAULT_ROOTS,
): Promise<Dump | undefined> {
  const chosen: Candidate | undefined = [...(await candidates(kind, roots))]
    .sort(byPreference)
    .find((candidate) => candidate.version === version);

  return chosen === undefined ? undefined : read(chosen, encoding);
}

/** How a generated file says where its dump came from. */
export function describeDump(dump: Dump): string {
  return dump.origin === "game"
    ? `${dump.version}, printed by the installed game with no mod loaded (\`npm run dump:docs\`)`
    : `${dump.version}, as collected (${dump.source})`;
}
