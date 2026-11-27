import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";

import { DUMP_KINDS, GAME_DUMP_DIRECTORY } from "../dumps.js";
import { requireGamePath } from "../game-path.js";
import { documented, hasHyphen, launchArguments, SETTINGS, STARTED } from "./session.js";

/**
 * Takes the game's own documentation from the installed game.
 *
 * Stellaris prints the triggers, effects, scope links, modifiers and
 * localisation commands its executable registers into
 * `logs/script_documentation` on every start: the function that does it
 * (`game_application.cpp:1419`) is called once loading is done with no
 * condition around the call (`0x1b9b7c` in 4.5.4), and a player's own session
 * leaves the files as well. So the newest dump there is does not have to be
 * waited for: this starts the installed game, waits until it has printed them,
 * stops it, and keeps the five files under
 * `refs/script-documentation/<version>/`, where the importers look first.
 *
 * It starts the game on a user directory of its own (`-userdir=`, read by
 * `main.cpp`) rather than the player's. That is what makes the dump the base
 * game's: an empty user directory has no `dlc_load.json`, so no mod is loaded,
 * and a dump taken with one loaded lists that mod's modifiers as the game's —
 * the reason the 4.5.2 data kept reading a 4.5.1 dump. It also leaves the
 * player's settings, saves and logs as they were.
 *
 * The game splits its command line on `-`, so a path holding one is cut there:
 * `-userdir=C:\\a\\b-c` is read as the directory `C:\\a\\b`. And it does not
 * create the directory it is given. Both were measured on 4.5.4.
 */

const EXECUTABLE: Readonly<Record<string, readonly string[]>> = {
  win32: ["stellaris.exe"],
  darwin: ["stellaris.app", "Contents", "MacOS", "stellaris"],
  linux: ["stellaris"],
};

const POLL_MILLISECONDS = 2000;
const DEFAULT_TIMEOUT_MINUTES = 20;

function fail(message: string): never {
  console.error(`DUMP ${message}`);
  process.exit(1);
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });

async function text(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function size(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

function timeoutMinutes(): number {
  const flag: number = process.argv.indexOf("--timeout-minutes");
  const value: number = flag < 0 ? Number.NaN : Number.parseFloat(process.argv[flag + 1] ?? "");
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MINUTES;
}

const gamePath: string = requireGamePath();
const executable: string = join(gamePath, ...(EXECUTABLE[platform()] ?? ["stellaris"]));

if (!existsSync(executable)) {
  fail(`found no executable at ${executable}.`);
}

const version: string =
  /"rawVersion"\s*:\s*"v?([^"]+)"/u.exec(await text(join(gamePath, "launcher-settings.json")))?.[1] ?? "unknown";

if (!/^\d+(?:\.\d+)*$/u.test(version)) {
  fail(`could not read the game's version from launcher-settings.json (${version}).`);
}

// A directory of this run's own, which the game is told to use and which is
// removed afterwards. `STELLARIS_DOCS_USERDIR` names another parent for it,
// for a machine whose temporary directory has a `-` in its path.
const parent: string = process.env["STELLARIS_DOCS_USERDIR"] ?? tmpdir();
const userDirectory: string = join(parent, `stellaris_ts_docs_${Date.now().toString(36)}`);

if (hasHyphen(userDirectory)) {
  fail(
    `the user directory would be ${userDirectory}, and the game cuts a command-line path at the first "-". Set STELLARIS_DOCS_USERDIR to a directory with no "-" in its path.`,
  );
}

await mkdir(userDirectory, { recursive: true });
await Promise.all(
  Object.entries(SETTINGS).map(([name, contents]) => writeFile(join(userDirectory, name), contents, "utf8")),
);

const logs: string = join(userDirectory, "logs");
const documentation: string = join(logs, "script_documentation");
const started: number = Date.now();
const deadline: number = started + timeoutMinutes() * 60_000;

console.log(`DUMP starting ${executable} on ${userDirectory}; the game opens a window and is closed again.`);

const child: ChildProcess = spawn(executable, launchArguments(userDirectory), { cwd: gamePath, stdio: "ignore" });

/** How the game's process ended, once it has. */
const ended: Promise<string> = new Promise((resolvePromise) => {
  child.once("error", (error: Error) => {
    resolvePromise(`it could not be started: ${error.message}`);
  });
  child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
    resolvePromise(code === null ? `signal ${signal ?? "unknown"}` : `exit code ${String(code)}`);
  });
});

/** The end of the process if it comes within the time given, and nothing otherwise. */
const endedWithin = (milliseconds: number): Promise<string | undefined> =>
  Promise.race([ended, sleep(milliseconds).then(() => undefined)]);

async function stop(): Promise<void> {
  if ((await endedWithin(0)) === undefined) {
    child.kill();

    if ((await endedWithin(30_000)) === undefined) {
      child.kill("SIGKILL");
    }
  }
}

async function discard(): Promise<void> {
  // The game holds its files a moment longer than its process.
  await rm(userDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}

/**
 * One look at what the game has written so far.
 *
 * The start-up time is the last thing a start writes, after the documentation;
 * and the files are read only once they have stopped growing.
 */
async function look(previous: string): Promise<{ readonly sizes: string; readonly done: boolean }> {
  const sizes: string = (await Promise.all(DUMP_KINDS.map((kind) => size(join(documentation, `${kind}.log`))))).join(
    ",",
  );
  const settled: boolean = sizes === previous && !sizes.split(",").includes("0");

  return { sizes, done: settled && STARTED.test(await text(join(logs, "time.log"))) };
}

let complete = false;
let sizes = "";
let stoppedEarly: string | undefined;

while (!complete && stoppedEarly === undefined && Date.now() < deadline) {
  // oxlint-disable-next-line no-await-in-loop -- one look every two seconds, each after the last
  stoppedEarly = await endedWithin(POLL_MILLISECONDS);
  // oxlint-disable-next-line no-await-in-loop -- as above
  const seen = await look(sizes);
  sizes = seen.sizes;
  complete = seen.done;
}

const seconds: number = Math.round((Date.now() - started) / 1000);

if (!complete) {
  const errors: string = (await text(join(logs, "error.log"))).trim();
  await stop();
  await discard();
  fail(
    stoppedEarly === undefined
      ? `the game had not printed its documentation after ${String(seconds)} seconds. Pass --timeout-minutes for a slower machine.`
      : `the game stopped by itself (${stoppedEarly}) before it had printed its documentation.${errors.length === 0 ? "" : ` Its error.log:\n${errors}`}`,
  );
}

const printed: Readonly<Record<string, string>> = Object.fromEntries(
  await Promise.all(
    DUMP_KINDS.map(async (kind): Promise<readonly [string, string]> => [
      kind,
      await text(join(documentation, `${kind}.log`)),
    ]),
  ),
);
const errorLog: string = await text(join(logs, "error.log"));
const build: string = /Game Version: (.+)/u.exec(await text(join(logs, "game.log")))?.[1]?.trim() ?? "unknown";

await stop();

const counts = documented(printed);
const problems: string[] = [];

if (!build.includes(version)) {
  problems.push(`the game that ran calls itself "${build}", and launcher-settings.json says ${version}`);
}

for (const kind of DUMP_KINDS) {
  if ((counts[kind] ?? 0) === 0) {
    problems.push(`${kind}.log documents nothing`);
  }
}

if (existsSync(join(userDirectory, "dlc_load.json"))) {
  problems.push("the user directory has a dlc_load.json, so the session may have loaded mods");
}

if (problems.length > 0) {
  await discard();
  fail(`${problems.join("; ")}. Nothing was kept.`);
}

// Written beside the place it will take and moved there whole. A copy that
// fails half way — a full disk — then leaves the dump an earlier run kept as it
// was, rather than some of its files and some of this run's, which the
// importers would read as one dump. The staging name is no version, so nothing
// reads it.
const target: string = join(GAME_DUMP_DIRECTORY, version);
const staging: string = join(GAME_DUMP_DIRECTORY, `${version}.incoming`);
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await Promise.all(DUMP_KINDS.map((kind) => copyFile(join(documentation, `${kind}.log`), join(staging, `${kind}.log`))));

// What the game logged while it loaded nothing but itself: the measure of
// every check ported from one of its messages, which must find nothing here.
await writeFile(join(staging, "error.log"), errorLog, "utf8");

const sha256: string = createHash("sha256")
  .update(await readFile(executable))
  .digest("hex");
const errorLines: readonly string[] = errorLog.split(/\r?\n/u).filter((line) => line.trim().length > 0);

await writeFile(
  join(staging, "manifest.json"),
  `${JSON.stringify(
    {
      version,
      build,
      executableSha256: sha256,
      taken: new Date(started).toISOString(),
      mods: [],
      startupSeconds: seconds,
      documented: counts,
      errorLogLines: errorLines.length,
    },
    undefined,
    2,
  )}\n`,
  "utf8",
);

await rm(target, { recursive: true, force: true });
await rename(staging, target);
await discard();

console.log(
  [
    "SUMMARY mode=dump-docs",
    `version=${version}`,
    `sha256=${sha256.slice(0, 16)}`,
    ...DUMP_KINDS.map((kind) => `${kind}=${String(counts[kind] ?? 0)}`),
    `errorLogLines=${String(errorLines.length)}`,
    `startupSeconds=${String(seconds)}`,
    `kept=refs/script-documentation/${version}`,
  ].join(" "),
);

for (const line of errorLines) {
  console.log(`DUMP error.log: ${line}`);
}
