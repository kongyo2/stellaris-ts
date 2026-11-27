/**
 * What `npm run dump:docs` hands the game and reads back from it, apart from
 * the starting and stopping: the parts that can be tested without a game.
 */

/** The last line a start writes, after it has printed its documentation. */
export const STARTED: RegExp = /Startup real time/u;

/**
 * Whether the game would cut this path short.
 *
 * `main.cpp` joins its arguments and splits the result on `-`, then reads each
 * piece by its prefix, so the `-` inside a value ends the value: measured on
 * 4.5.4, `-userdir=…\\stsx_hy-phen` wrote its files into `…\\stsx_hy`. A space
 * is kept.
 */
export function hasHyphen(path: string): boolean {
  return path.includes("-");
}

/** The arguments of a start on a user directory of its own. */
export function launchArguments(userDirectory: string): readonly string[] {
  // `-gdpr-compliant` is what the launcher passes on every start.
  return [`-userdir=${userDirectory}`, "-gdpr-compliant"];
}

/**
 * The settings the session starts with: a window instead of the whole screen,
 * and no sound. Whatever is not said here the game fills in with its defaults.
 */
export const SETTINGS: Readonly<Record<string, string>> = {
  "settings.txt": [
    'language="l_english"',
    "graphics=",
    "{",
    "\tsize=",
    "\t{",
    "\t\tx=1280",
    "\t\ty=720",
    "\t}",
    "",
    "\tfullScreen=no",
    "\tborderless=no",
    "}",
    "sound_fx_volume=0.000000",
    "music_volume=0.000000",
    "master_volume=0.000000",
    "ambient_volume=0.000000",
    "voice_volume=0.000000",
    "",
  ].join("\r\n"),
  "pdx_settings.txt": [
    '"Graphics"=',
    "{",
    '\t"display_mode"=',
    "\t{",
    '\t\tvalue="windowed"',
    "\t\tversion=0",
    "\t}",
    "}",
    '"System"=',
    "{",
    '\t"language"=',
    "\t{",
    '\t\tvalue="l_english"',
    "\t\tversion=0",
    "\t}",
    "}",
    "",
  ].join("\r\n"),
};

/**
 * How many entries each file documents.
 *
 * A file that holds its header and nothing under it is a start that was
 * stopped too early, and an importer reading it would retire every command the
 * game has. The triggers, effects and scope links are `name - description`
 * blocks, a modifier is `- name, Category: …`, and a localisation command is an
 * indented name under a `--Scope--` heading.
 */
export function documented(printed: Readonly<Record<string, string>>): Readonly<Record<string, number>> {
  const count = (kind: string, pattern: RegExp): number => [...(printed[kind] ?? "").matchAll(pattern)].length;

  return {
    effects: count("effects", /^[A-Za-z_][A-Za-z_0-9]* - /gmu),
    localizations: count("localizations", /^[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]*\r?$/gmu),
    modifiers: count("modifiers", /^- [A-Za-z0-9_.-]+, Category: /gmu),
    scopes: count("scopes", /^[A-Za-z_][A-Za-z_0-9]* - /gmu),
    triggers: count("triggers", /^[A-Za-z_][A-Za-z_0-9]* - /gmu),
  };
}
