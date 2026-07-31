import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Imports the game's own list of scoped localisation commands.
 *
 * A localisation value can carry `[Root.Owner.GetName]`, and every part of that
 * is engine-defined: `Owner` is a scope change the game calls a promotion, and
 * `GetName` is a property. Misspell either and the game prints the statement as
 * text, which is the same class of silent failure as a misspelled trigger and
 * has had no check at all.
 *
 * Only the names are taken. What each property returns is game content and
 * stays in the game.
 *
 * Imported as data and deliberately not enforced. Measured against vanilla's
 * own 2,318 localisation files: reading a chain like `[Root.Owner.GetName]` and
 * requiring every middle element to be a promotion this dump lists rejects
 * 3,390 statements the game accepts. Joining the scope links from
 * `game_scopes` brings that to 421, and what is left is legitimate too —
 * `Patron:the_cradle_of_souls` and `parameter:enemy` name something the
 * statement was handed, and a saved event target can be called anything a mod
 * likes. The position is open, so a check on it would reject text that works.
 * Filling a gap is safe; narrowing on dump evidence alone is not.
 */

const REPOSITORY_ROOT: string = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE_DIRECTORY: string = join(REPOSITORY_ROOT, "refs", "stellaris-triggers-modifiers-effects-list");
const OUTPUT: string = join(REPOSITORY_ROOT, "src", "generated", "vanilla", "localisation-commands.ts");

const SECTION = /^--(.+)--$/u;

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface Section {
  readonly promotions: Set<string>;
  readonly properties: Set<string>;
}

/**
 * The newest dump, wherever it is.
 *
 * The upstream repository keeps a versioned file per build beside a
 * `compare_versions` folder holding a copy of one of them. Both places are
 * read and the highest version wins: the copy is not always the newest, and
 * here it is two builds behind the file beside it.
 */
async function readDump(): Promise<{ readonly source: string; readonly text: string }> {
  const places: readonly (readonly [string, string])[] = [
    [SOURCE_DIRECTORY, ""],
    [join(SOURCE_DIRECTORY, "compare_versions"), "compare_versions/"],
  ];

  const listings: readonly (readonly { directory: string; prefix: string; name: string }[])[] = await Promise.all(
    places.map(async ([directory, prefix]) => {
      try {
        const names: readonly string[] = await readdir(directory);
        return names
          .filter((name) => /_game_localizations\.(log|txt)$/u.test(name))
          .map((name) => ({ directory, prefix, name }));
      } catch {
        return [];
      }
    }),
  );

  const candidates: readonly { source: string; text: string }[] = await Promise.all(
    listings.flat().map(async (entry) => ({
      source: `${entry.prefix}${entry.name}`,
      text: new TextDecoder("latin1").decode(await readFile(join(entry.directory, entry.name))),
    })),
  );

  // By version, the way every other importer picks one. Size is not the test:
  // `compare_versions/current` and `4.1.7` are byte-identical here while 4.3.7
  // exists beside them, so the largest file is two builds behind the newest.
  const versioned = [...candidates]
    .map((candidate) => ({
      ...candidate,
      key: (/(\d+(?:\.\d+)*)_game_localizations/u.exec(candidate.source)?.[1] ?? "0")
        .split(".")
        .map((part) => Number.parseInt(part, 10) || 0),
    }))
    .sort((left, right) => {
      for (let index = 0; index < Math.max(left.key.length, right.key.length); index += 1) {
        const difference: number = (right.key[index] ?? 0) - (left.key[index] ?? 0);
        if (difference !== 0) {
          return difference;
        }
      }
      return compareOrdinal(left.source, right.source);
    });

  const newest = versioned[0];

  if (newest === undefined) {
    throw new Error(`No localisation dump found under ${SOURCE_DIRECTORY}. Run \`npm run refs:sync\` first.`);
  }

  return newest;
}

const dump = await readDump();
const sections = new Map<string, Section>();
let current: Section | undefined;
let mode: "promotions" | "properties" | undefined;

for (const raw of dump.text.split(/\r?\n/u)) {
  const heading = SECTION.exec(raw.trim());

  if (heading?.[1] !== undefined) {
    current = { promotions: new Set<string>(), properties: new Set<string>() };
    sections.set(heading[1].trim(), current);
    mode = undefined;
    continue;
  }

  const line: string = raw.trim();

  if (line === "Promotions:") {
    mode = "promotions";
    continue;
  }

  if (line === "Properties" || line === "Properties:") {
    mode = "properties";
    continue;
  }

  // Only the indented entries under a heading are names; the prose at the top
  // of the file is neither indented nor inside a section.
  if (current === undefined || mode === undefined || !raw.startsWith(" ") || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(line)) {
    continue;
  }

  current[mode].add(line);
}

const promotions = new Set<string>();
const properties = new Set<string>();

for (const section of sections.values()) {
  for (const name of section.promotions) {
    promotions.add(name);
  }
  for (const name of section.properties) {
    properties.add(name);
  }
}

const ordered: readonly (readonly [string, Section])[] = [...sections].sort(([left], [right]) =>
  compareOrdinal(left, right),
);
const list = (values: ReadonlySet<string>): string =>
  [...values]
    .sort(compareOrdinal)
    .map((value) => JSON.stringify(value))
    .join(", ");

await mkdir(join(REPOSITORY_ROOT, "src", "generated", "vanilla"), { recursive: true });
await writeFile(
  OUTPUT,
  [
    "// Generated by `npm run import:localisations` from the game's own -debug dump.",
    `// Source: ${dump.source}. Names only, no game content.`,
    "//",
    "// A localisation value can carry `[Root.Owner.GetName]`. `Owner` is a scope",
    "// change the game calls a promotion; `GetName` is a property. Both are",
    "// engine-defined, and a misspelling of either prints as text in game.",
    "",
    "/** Every promotion the game documents, in any scope. */",
    `export const localisationPromotions: readonly string[] = [${list(promotions)}];`,
    "",
    "/** Every property the game documents, in any scope. */",
    `export const localisationProperties: readonly string[] = [${list(properties)}];`,
    "",
    "/** What each scope the dump names offers, under the dump's own section names. */",
    "export const localisationCommandsByScope: Readonly<",
    "  Record<string, { readonly promotions: readonly string[]; readonly properties: readonly string[] }>",
    "> = {",
    ...ordered.map(
      ([name, section]) =>
        `  ${JSON.stringify(name)}: { promotions: [${list(section.promotions)}], properties: [${list(section.properties)}] },`,
    ),
    "};",
    "",
  ].join("\n"),
  "utf8",
);

console.log(
  [
    "SUMMARY mode=import-localisations",
    `source=${dump.source}`,
    `scopes=${String(sections.size)}`,
    `promotions=${String(promotions.size)}`,
    `properties=${String(properties.size)}`,
  ].join(" "),
);
