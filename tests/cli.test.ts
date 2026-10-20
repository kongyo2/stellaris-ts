import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { defaultModsDirectory, run } from "../src/cli/index.js";

/**
 * The command line, driven the way a mod author drives it.
 *
 * The entry has to be a real file, because the CLI imports it. The language a
 * mod is written in is what is checked here; the message a split mod gets from
 * Node is checked in `verify:pack`, against a real Node process, since a test
 * runner resolves `./part.js` to `part.ts` itself and the failure never happens.
 */
let directory = "";

const lines = (calls: readonly (readonly unknown[])[]): string => calls.map((call) => String(call[0])).join("\n");

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "stellaris-ts-cli-"));

  await writeFile(
    join(directory, "mod.ts"),
    `import { defineMod } from "${join(process.cwd(), "src", "index.ts").replaceAll("\\", "/")}";
     import { define } from "${join(process.cwd(), "src", "builders", "index.ts").replaceAll("\\", "/")}";

     export default defineMod({ name: "Cli Demo", version: "1", supportedVersion: "v4.5.*" })
       .add(define("building", "sts_cli_lab", { category: "research" }))
       .localise("l_english", "sts_cli_lab", "Lab")
       .localise("l_english", "sts_cli_lab_desc", "A lab");`,
    "utf8",
  );

  await writeFile(
    join(directory, "split.ts"),
    `import { part } from "./part.js";
     export default part;`,
    "utf8",
  );
  await writeFile(join(directory, "part.ts"), "export const part = 1;\n", "utf8");
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("the command line", () => {
  it("checks the languages it was asked about, not only English", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      expect(await run(["check", join(directory, "mod.ts")])).toBe(0);
      expect(lines(warn.mock.calls)).not.toContain("missing-localisation");

      warn.mockClear();
      expect(await run(["check", join(directory, "mod.ts"), "--language", "japanese"])).toBe(0);
      expect(lines(warn.mock.calls)).toContain("missing-localisation");
      expect(lines(warn.mock.calls)).toContain("l_japanese");
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });

  it("takes the language with or without its l_ prefix, and refuses one the game does not read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      expect(await run(["check", join(directory, "mod.ts"), "--language=l_japanese"])).toBe(0);
      expect(await run(["check", join(directory, "mod.ts"), "--language", "klingon"])).toBe(2);
      expect(lines(error.mock.calls)).toContain("Not a language the game reads: l_klingon");
    } finally {
      error.mockRestore();
      warn.mockRestore();
      log.mockRestore();
    }
  });

  it("leaves an import that is missing in every spelling alone", async () => {
    await expect(run(["check", join(directory, "absent.ts")])).rejects.toThrow(/Cannot find module/u);
  });

  /**
   * `check` with nothing after it printed the usage and exited 0, so a script
   * that lost its argument reported a clean mod.
   */
  it("fails when there is no entry to check", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      expect(await run(["check"])).toBe(2);
      expect(await run(["build", "--out", directory])).toBe(2);
      expect(lines(error.mock.calls)).toContain("check needs the module whose default export is the mod");
    } finally {
      error.mockRestore();
    }
  });

  it("takes the entry before or after its options, and only one of it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      expect(await run(["check", "--language", "japanese", join(directory, "mod.ts")])).toBe(0);
      expect(lines(warn.mock.calls)).toContain("l_japanese");
      expect(await run(["check", join(directory, "mod.ts"), join(directory, "split.ts")])).toBe(2);
      expect(lines(error.mock.calls)).toContain("check takes one entry");
    } finally {
      error.mockRestore();
      warn.mockRestore();
      log.mockRestore();
    }
  });

  it("says which version it is and which game it checks against", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      expect(await run(["--version"])).toBe(0);
      expect(lines(log.mock.calls)).toMatch(/^stellaris-ts \d+\.\d+\.\d+\S* \(Stellaris v\d+\.\d+\.\d+\)$/u);
    } finally {
      log.mockRestore();
    }
  });
});

/**
 * Where a build lands when no folder is named.
 *
 * OneDrive moves the documents folder under itself and names it in the system's
 * language, so `Documents\Paradox Interactive` is not where the game is on a
 * great many Windows machines.
 */
describe("the default mod folder", () => {
  let home = "";

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "stellaris-ts-home-"));
  });

  afterAll(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("finds the game's folder where OneDrive moved it", async () => {
    const moved: string = join(home, "OneDrive", "ドキュメント", "Paradox Interactive", "Stellaris");
    await mkdir(moved, { recursive: true });

    expect(defaultModsDirectory(home, "win32")).toBe(join(moved, "mod"));
  });

  it("keeps Documents where the game's folder is there, and on other systems", async () => {
    const documents: string = join(home, "Documents", "Paradox Interactive", "Stellaris");

    expect(defaultModsDirectory(home, "darwin")).toBe(join(documents, "mod"));
    expect(defaultModsDirectory(home, "linux")).toBe(
      join(home, ".local", "share", "Paradox Interactive", "Stellaris", "mod"),
    );

    await mkdir(documents, { recursive: true });
    expect(defaultModsDirectory(home, "win32")).toBe(join(documents, "mod"));
  });

  /**
   * Reading the options twice is what lets one swallow another: `--out
   * --language japanese` once gave the language to the check and `--language`
   * to the mod folder, then reported having written the mod.
   */
  it("refuses an option whose value is another option", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      expect(await run(["build", join(directory, "mod.ts"), "--out", "--language", "japanese"])).toBe(2);
      expect(lines(error.mock.calls)).toContain("--out needs a directory after it.");

      error.mockClear();
      expect(await run(["check", join(directory, "mod.ts"), "--language"])).toBe(2);
      expect(lines(error.mock.calls)).toContain("--language needs a language after it");

      error.mockClear();
      expect(await run(["check", join(directory, "mod.ts"), "--langauge", "japanese"])).toBe(2);
      expect(lines(error.mock.calls)).toContain("Unknown option: --langauge.");
    } finally {
      error.mockRestore();
      log.mockRestore();
    }
  });
});
