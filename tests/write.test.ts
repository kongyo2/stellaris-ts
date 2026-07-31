import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { define } from "../src/builders/index.js";
import { defineMod, emit, writePlan } from "../src/index.js";

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
});
