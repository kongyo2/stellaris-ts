import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { run } from "../src/cli/index.js";

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

     export default defineMod({ name: "Cli Demo", version: "1", supportedVersion: "v4.4.*" })
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
