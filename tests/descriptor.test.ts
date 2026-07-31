import { describe, expect, it } from "vitest";

import { define, defineIn } from "../src/builders/index.js";
import { emit } from "../src/runtime/emit.js";
import { defineMod } from "../src/index.js";

/**
 * What the launcher reads, and what a mod cannot do without it.
 *
 * A mod's files are added to the game's directories, never merged into them, so
 * `replace_path` is the only way to take a vanilla definition away and
 * `dependencies` the only way to say what must load first. Both live in the
 * descriptor, and neither has any other spelling.
 */
const codes = (mod: Parameters<typeof emit>[0]): readonly string[] =>
  emit(mod).diagnostics.map((diagnostic) => diagnostic.code);

const descriptor = (mod: Parameters<typeof emit>[0]): string => {
  const file = emit(mod).files.find((candidate) => candidate.path === "descriptor.mod");
  return file?.kind === "text" ? file.contents : "";
};

/**
 * A mod's own files are named after it, and a name with no ASCII in it reduces
 * to nothing at all. Two Japanese mods both writing
 * `common/buildings/zz_mod_building.txt` would replace each other's buildings
 * outright, with nothing said anywhere.
 */
describe("the name a mod's files are called after", () => {
  const paths = (options: { name: string; id?: string }): readonly string[] => {
    const mod = defineMod({ version: "1", supportedVersion: "v4.4.*", ...options }).add(
      define("building", "sts_lab", { category: "research" }),
    );
    return [emit(mod).modFileName, ...emit(mod).files.map((file) => file.path)];
  };

  it("keeps two names that share no ASCII apart", () => {
    const first: readonly string[] = paths({ name: "共鳴の遺産" });
    const second: readonly string[] = paths({ name: "星々の記憶" });

    expect(first).not.toEqual(second);
    expect(first.some((path) => path === "common/buildings/zz_mod_building.txt")).toBe(false);
  });

  it("gives the same name every time, on every machine", () => {
    expect(paths({ name: "共鳴の遺産" })).toEqual(paths({ name: "共鳴の遺産" }));
  });

  /**
   * One ASCII character anywhere in the name used to defeat the marker: `[JP] 共鳴の遺産`
   * and `[JP] 星々の記憶` both reduced to `jp`, which is the collision the marker
   * exists to stop. Punctuation is not a word, so an ordinary name keeps its
   * ordinary folder.
   */
  it("keeps two names apart when only their non-ASCII words differ", () => {
    expect(paths({ name: "[JP] 共鳴の遺産" })).not.toEqual(paths({ name: "[JP] 星々の記憶" }));
  });

  it("leaves a name whose words are all ASCII alone", () => {
    expect(paths({ name: "Example Mod" })).toContain("example_mod.mod");
    expect(paths({ name: "Example Mod!" })).toContain("example_mod.mod");
  });

  /**
   * `Café` can be written with one character or with `e` and a combining
   * accent. The accent is a mark rather than a letter, so the second spelling
   * read as punctuation and took the same folder as `Cafe`.
   */
  it("keeps a decomposed name apart from the one it decomposes to", () => {
    const decomposed = `Cafe${String.fromCodePoint(0x0301)}`;

    expect(decomposed).not.toBe("Café");
    expect(paths({ name: decomposed })).not.toEqual(paths({ name: "Cafe" }));
    expect(paths({ name: decomposed })).toEqual(paths({ name: "Café" }));
  });

  /**
   * `con`, `nul` and the numbered ports are devices on Windows, so no folder or
   * file can be called one — and every test of what a name may contain passes
   * them.
   */
  it("refuses a chosen id Windows cannot make a folder for", () => {
    const mod = defineMod({ name: "X", id: "con", version: "1", supportedVersion: "v4.4.*" });

    expect(emit(mod).diagnostics.map((diagnostic) => diagnostic.code)).toContain("reserved-mod-id");
  });

  it("does not derive one either", () => {
    expect(paths({ name: "Con" })).not.toContain("con.mod");
  });

  /**
   * `defineIn` takes a file name from the caller, so a definition's path needs
   * the same canonicalisation a supplied one gets: `./same.txt` and `same.txt`
   * are two strings and one file.
   */
  it("reads a definition path and a raw path as the one file they are", () => {
    const aliased = defineMod({ name: "Alias", version: "1", supportedVersion: "v4.4.*" })
      .add(defineIn("building", "./same.txt", "sts_lab", { category: "research" }))
      .file({ path: "common/buildings/same.txt", contents: "x = { }" });

    expect(emit(aliased).diagnostics.map((diagnostic) => diagnostic.code)).toContain("duplicate-file");
  });

  it("refuses a path that leaves the mod folder", () => {
    const escaping = defineMod({ name: "Esc", version: "1", supportedVersion: "v4.4.*" })
      .file({ path: "../../escaped.txt", contents: "x" })
      .asset("../escaped.dds", new Uint8Array([1]));

    const escapes = emit(escaping).diagnostics.filter((diagnostic) => diagnostic.code === "escaping-path");

    expect(escapes).toHaveLength(2);
    expect(escapes.every((diagnostic) => diagnostic.severity === "error")).toBe(true);
  });

  /**
   * Most people build on a filesystem that folds case, where `gfx/Icon.dds` and
   * `gfx/icon.dds` are one file and the bytes that survive are whichever write
   * finished last.
   */
  it("reads two names that differ only in case as the one file they are", () => {
    const cased = defineMod({ name: "Case", version: "1", supportedVersion: "v4.4.*" })
      .asset("gfx/interface/icons/buildings/Sts_Icon.dds", new Uint8Array([1]))
      .asset("gfx/interface/icons/buildings/sts_icon.dds", new Uint8Array([2]));

    expect(emit(cased).diagnostics.map((diagnostic) => diagnostic.code)).toContain("duplicate-file");
  });

  /**
   * A definition's path is canonicalised on the way into the plan, so the
   * override it declares has to be canonicalised the same way — otherwise the
   * intent is recorded under a spelling the collision check never looks up, and
   * a declared replacement is reported as a mistake.
   */
  it("recognises an intended override written in another spelling", () => {
    const aliased = defineMod({ name: "Ov", version: "1", supportedVersion: "v4.4.*" }).add({
      type: "building",
      directory: "common/buildings",
      id: "sts_lab",
      body: { category: "research" },
      overrides: "common/buildings/./00_capital_buildings.txt",
    });

    const collision = emit(aliased).diagnostics.find((diagnostic) => diagnostic.code === "vanilla-filename-collision");

    expect(collision?.severity).toBe("warning");
  });

  /**
   * The listing holds `AVATAR_CHAMBER_1.dds` as vanilla spells it; a mod
   * shipping `avatar_chamber_1.dds` replaces that file wherever the filesystem
   * folds case, and an exact-string lookup would say nothing.
   */
  it("reports an asset that differs from a vanilla name only in case", () => {
    const mod = defineMod({ name: "Fold", version: "1", supportedVersion: "v4.4.*" }).asset(
      "gfx/interface/icons/buildings/AVATAR_CHAMBER_1.dds",
      new Uint8Array([1]),
    );

    expect(emit(mod).diagnostics.map((diagnostic) => diagnostic.code)).toContain("vanilla-filename-collision");
  });

  it("reads two spellings of one path as the one file they are", () => {
    const same = defineMod({ name: "Same", version: "1", supportedVersion: "v4.4.*" })
      .file({ path: "common/x.txt", contents: "FIRST" })
      .file({ path: "./common/x.txt", contents: "SECOND" });

    expect(emit(same).diagnostics.map((diagnostic) => diagnostic.code)).toContain("duplicate-file");
  });

  it("uses the id when one is given, for the folder and every file", () => {
    expect(paths({ name: "共鳴の遺産", id: "resonant_legacy" })).toContain(
      "common/buildings/zz_resonant_legacy_building.txt",
    );
    expect(paths({ name: "共鳴の遺産", id: "resonant_legacy" })).toContain("resonant_legacy.mod");
  });

  it("refuses an id that is not a file name", () => {
    const mod = defineMod({ name: "X", id: "共鳴", version: "1", supportedVersion: "v4.4.*" });

    expect(emit(mod).diagnostics.map((diagnostic) => diagnostic.code)).toContain("malformed-mod-id");
  });
});

describe("the descriptor", () => {
  it("writes the dependencies the launcher orders by", () => {
    const mod = defineMod({
      name: "Dependent",
      version: "1",
      supportedVersion: "v4.4.*",
      dependencies: ["Some Framework", "Another Mod"],
    });

    expect(descriptor(mod)).toContain('dependencies={\n\t"Some Framework"\n\t"Another Mod"\n}');
  });

  it("writes one replace_path line per directory, and says what it costs", () => {
    const mod = defineMod({
      name: "Replacer",
      version: "1",
      supportedVersion: "v4.4.*",
      replacePaths: ["common/buildings"],
    });

    expect(descriptor(mod)).toContain('replace_path="common/buildings"');
    expect(codes(mod)).toContain("replaces-vanilla-directory");
  });

  it("refuses a replace_path the base game does not load from", () => {
    const mod = defineMod({
      name: "Typo",
      version: "1",
      supportedVersion: "v4.4.*",
      replacePaths: ["common/buildingz"],
    });

    expect(codes(mod)).toContain("unknown-replace-path");
  });

  it("rejects a supported_version the launcher cannot read", () => {
    const mod = defineMod({ name: "Bad", version: "1", supportedVersion: "latest" });
    expect(codes(mod)).toContain("malformed-supported-version");
  });

  it("warns when the declared version does not cover this build", () => {
    const mod = defineMod({ name: "Old", version: "1", supportedVersion: "v3.12.*" });
    expect(codes(mod)).toContain("unsupported-game-version");
  });

  it("accepts the version this build asks for", () => {
    const mod = defineMod({ name: "Current", version: "1", supportedVersion: "v4.4.*" });
    expect(codes(mod)).not.toContain("unsupported-game-version");
    expect(codes(mod)).not.toContain("malformed-supported-version");
  });
});

describe("localisation overrides", () => {
  it("puts a replacement where the game reads it last", () => {
    const mod = defineMod({ name: "Override", version: "1", supportedVersion: "v4.4.*" })
      .localise("l_english", "sts_own_key", "Mine")
      .localiseReplace("l_english", "building_capital", "Palace");

    const paths = emit(mod).files.map((file) => file.path);

    expect(paths).toContain("localisation/english/override_l_english.yml");
    expect(paths).toContain("localisation/english/replace/override_l_english.yml");
  });

  it("keeps the byte order mark on both", () => {
    const mod = defineMod({ name: "Bom", version: "1", supportedVersion: "v4.4.*" })
      .localise("l_english", "a", "A")
      .localiseReplace("l_english", "b", "B");

    for (const file of emit(mod).files.filter((candidate) => candidate.path.startsWith("localisation/"))) {
      expect(file.kind).toBe("text");
      if (file.kind !== "text") {
        continue;
      }
      expect(file.byteOrderMark).toBe(true);
      expect(file.contents.startsWith("﻿")).toBe(true);
    }
  });
});
