import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { documented, hasHyphen, launchArguments, SETTINGS, STARTED } from "../tools/dump-docs/session.js";
import { compareVersions, describeDump, newestDump } from "../tools/dumps.js";
import type { DumpRoots } from "../tools/dumps.js";

/**
 * Which copy of the game's documentation of itself the importers read.
 *
 * Two places hold one: what `npm run dump:docs` kept of the installed game,
 * and the collection `npm run refs:sync` clones. The newest wins, and the
 * installed game's own between two of one version — a collected dump may have
 * been taken with a mod loaded, and then lists the mod's modifiers as the
 * game's.
 */
let roots: DumpRoots = { game: "", collected: "" };
let directory = "";

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "stellaris-ts-dumps-"));
  roots = { game: join(directory, "game"), collected: join(directory, "collected") };

  await mkdir(join(roots.game, "4.5.4"), { recursive: true });
  await mkdir(join(roots.game, "not-a-version"), { recursive: true });
  await mkdir(join(roots.collected, "compare_versions"), { recursive: true });
  await writeFile(join(roots.game, "4.5.4", "triggers.log"), "game 4.5.4", "utf8");
  await writeFile(join(roots.game, "not-a-version", "triggers.log"), "stray", "utf8");
  await writeFile(join(roots.collected, "4.5.4_game_triggers.log"), "collected 4.5.4", "utf8");
  await writeFile(join(roots.collected, "4.5.1_game_triggers.log"), "collected 4.5.1", "utf8");
  await writeFile(join(roots.collected, "4.10.0_game_effects.log"), "collected 4.10.0", "utf8");
  await writeFile(join(roots.collected, "4.9.2_game_effects.log"), "collected 4.9.2", "utf8");
  await writeFile(join(roots.collected, "compare_versions", "4.5.3_game_scopes.txt"), "copy 4.5.3", "utf8");
  await writeFile(join(roots.collected, "4.5.1_game_scopes.log"), "collected 4.5.1", "utf8");
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("the newest dump", () => {
  it("is the installed game's own between two of one version", async () => {
    const dump = await newestDump("triggers", "utf8", roots);

    expect(dump).toMatchObject({ version: "4.5.4", origin: "game", text: "game 4.5.4" });
    expect(describeDump(dump)).toContain("no mod loaded");
  });

  it("orders versions by their numbers, not their text", async () => {
    expect(compareVersions("4.10.0", "4.9.2")).toBeGreaterThan(0);
    expect(compareVersions("4.5", "4.5.0")).toBe(0);
    expect((await newestDump("effects", "utf8", roots)).text).toBe("collected 4.10.0");
  });

  it("reads the collection's copy when that is the newest there is", async () => {
    const dump = await newestDump("scopes", "utf8", roots);

    expect(dump).toMatchObject({ version: "4.5.3", origin: "collection" });
    expect(describeDump(dump)).toContain("compare_versions/4.5.3_game_scopes.txt");
  });

  it("says how to get one when there is none", async () => {
    await expect(newestDump("modifiers", "utf8", roots)).rejects.toThrow(/npm run dump:docs/u);
  });
});

/**
 * What `npm run dump:docs` hands the game. Measured on 4.5.4: the game splits
 * its command line on `-`, so `-userdir=C:\\a\\b-c` wrote into `C:\\a\\b`.
 */
describe("a start of the game on a user directory of its own", () => {
  it("refuses a directory the game would cut short", () => {
    expect(hasHyphen("C:\\Users\\someone\\AppData\\Local\\Temp\\stellaris_ts_docs_x")).toBe(false);
    expect(hasHyphen("/tmp/stellaris-ts/docs")).toBe(true);
  });

  it("names the directory and passes what the launcher passes", () => {
    expect(launchArguments("D:\\docs_1")).toEqual(["-userdir=D:\\docs_1", "-gdpr-compliant"]);
  });

  it("starts in a window with no sound", () => {
    expect(SETTINGS["settings.txt"]).toContain("fullScreen=no");
    expect(SETTINGS["settings.txt"]).toContain("master_volume=0.000000");
    expect(SETTINGS["pdx_settings.txt"]).toContain('value="windowed"');
  });

  it("knows a start that has finished from one that has not", () => {
    expect(STARTED.test("[12:30:44][main.cpp:1710]: [Thread 8076] Startup real time: 196138 ms")).toBe(true);
    expect(STARTED.test("")).toBe(false);
  });

  it("counts what each file documents, so a header with nothing under it is not kept", () => {
    const counts = documented({
      triggers:
        "[12:30:42][game_application.cpp:1419]: \r\n== TRIGGER DOCUMENTATION ==\r\ntext - Shows custom text\r\nSupported Scopes: all\r\n\r\nnot - An inverted trigger\r\n",
      effects: "== EFFECT DOCUMENTATION ==\r\n",
      scopes: "owner - Scopes to the owner\r\n",
      modifiers:
        "Printing Modifier Definitions:\r\n- blank_modifier, Category: Pops\r\n- pop_happiness, Category: Pops\r\n",
      localizations: "--Country--\r\nPromotions:\r\n  Owner\r\nProperties\r\n  GetName\r\n",
    });

    expect(counts).toEqual({ triggers: 2, effects: 0, scopes: 1, modifiers: 2, localizations: 2 });
  });
});
