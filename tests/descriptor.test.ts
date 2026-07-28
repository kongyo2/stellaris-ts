import { describe, expect, it } from "vitest";

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

const descriptor = (mod: Parameters<typeof emit>[0]): string =>
  emit(mod).files.find((file) => file.path === "descriptor.mod")?.contents ?? "";

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
      expect(file.byteOrderMark).toBe(true);
      expect(file.contents.startsWith("﻿")).toBe(true);
    }
  });
});
