import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { define } from "../src/builders/index.js";
import { defineMod, emit, writePlan, WRITE_MANIFEST } from "../src/index.js";

/**
 * What actually reaches the disk.
 *
 * The `.mod` file beside the folder is what the launcher reads, and the `path`
 * in it is resolved from the launcher's own working directory rather than from
 * wherever the build ran. A relative one written out verbatim points at nothing
 * and says nothing about it — the mod is simply absent from the list.
 */
let directory = "";

const mod = defineMod({ name: "Written", version: "1", supportedVersion: "v4.4.*" })
  .add(define("building", "sts_lab", { category: "research" }))
  .asset("gfx/interface/icons/buildings/sts_lab.dds", new Uint8Array([0x44, 0x44, 0x53, 0x20, 0x00, 0xff]));

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "stellaris-ts-write-"));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("writing a plan", () => {
  it("names the folder absolutely, whatever it was handed", async () => {
    const result = await writePlan(mod, emit(mod), relative(process.cwd(), directory));
    const descriptor: string = await readFile(result.modFilePath, "utf8");

    expect(isAbsolute(result.modDirectory)).toBe(true);
    expect(isAbsolute(result.modFilePath)).toBe(true);
    expect(descriptor).toContain(`path="${result.modDirectory.replaceAll("\\", "/")}"`);
  });

  it("writes an asset as the bytes it was given", async () => {
    const result = await writePlan(mod, emit(mod), directory);
    const bytes = await readFile(join(result.modDirectory, "gfx", "interface", "icons", "buildings", "sts_lab.dds"));

    expect([...bytes]).toEqual([0x44, 0x44, 0x53, 0x20, 0x00, 0xff]);
  });

  it("refuses to write a plan with errors", async () => {
    const broken = defineMod({ name: "", version: "1", supportedVersion: "v4.4.*" });

    await expect(writePlan(broken, emit(broken), directory)).rejects.toThrow(/Refusing to write/u);
  });

  /**
   * A build writes into the folder the last one wrote. A file no definition
   * lands in any more — a type dropped, a `defineIn` moved — stayed and kept
   * loading, so the game ran definitions the mod no longer had.
   */
  it("removes what its last build wrote and this one does not, and nothing else", async () => {
    const base = await mkdtemp(join(tmpdir(), "stellaris-ts-rebuild-"));

    try {
      const before = defineMod({ name: "Rebuilt", version: "1", supportedVersion: "v4.4.*" })
        .add(define("building", "sts_lab", { category: "research" }))
        .add(define("static_modifier", "sts_mod", { planet_stability_add: 1 }));
      const first = await writePlan(before, emit(before), base);
      const stale: string = join(first.modDirectory, "common", "static_modifiers", "zz_rebuilt_static_modifier.txt");
      const foreign: string = join(first.modDirectory, "thumbnail.png");

      await writeFile(foreign, "not ours");
      expect(await exists(stale)).toBe(true);

      const after = defineMod({ name: "Rebuilt", version: "1", supportedVersion: "v4.4.*" }).add(
        define("building", "sts_lab", { category: "research" }),
      );
      const second = await writePlan(after, emit(after), base);

      expect(second.removed).toEqual(["common/static_modifiers/zz_rebuilt_static_modifier.txt"]);
      expect(await exists(stale)).toBe(false);
      expect(await exists(foreign)).toBe(true);
      expect(await exists(join(second.modDirectory, "common", "buildings", "zz_rebuilt_building.txt"))).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("keeps a file whose name changed only in case", async () => {
    const base = await mkdtemp(join(tmpdir(), "stellaris-ts-recase-"));

    try {
      const icon = (path: string) =>
        defineMod({ name: "Recased", version: "1", supportedVersion: "v4.4.*" }).asset(path, new Uint8Array([1]));
      const upper = icon("gfx/interface/icons/Sts_Icon.dds");
      const lower = icon("gfx/interface/icons/sts_icon.dds");

      await writePlan(upper, emit(upper), base);
      const second = await writePlan(lower, emit(lower), base);

      expect(second.removed).toEqual([]);
      expect(await exists(join(second.modDirectory, "gfx", "interface", "icons", "sts_icon.dds"))).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("ignores a manifest entry that points outside the folder", async () => {
    const base = await mkdtemp(join(tmpdir(), "stellaris-ts-escape-"));

    try {
      const plain = defineMod({ name: "Guarded", version: "1", supportedVersion: "v4.4.*" }).add(
        define("building", "sts_lab", { category: "research" }),
      );
      const first = await writePlan(plain, emit(plain), base);
      const outside: string = join(base, "keep.txt");

      await writeFile(outside, "keep");
      await writeFile(
        join(first.modDirectory, WRITE_MANIFEST),
        JSON.stringify({ files: ["../keep.txt", "/etc/hosts", "common/../../keep.txt"] }),
      );

      const second = await writePlan(plain, emit(plain), base);

      expect(second.removed).toEqual([]);
      expect(await exists(outside)).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
