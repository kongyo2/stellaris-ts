import { describe, expect, it } from "vitest";

import { defineMod, emit, LOCALISATION_LANGUAGES, type Mod } from "../src/index.js";
import { vanillaModsCompatibilityVersion } from "../src/generated/vanilla/game-version.js";

const mod = (): Mod =>
  defineMod({ name: "Strings", version: "1", supportedVersion: `v${vanillaModsCompatibilityVersion}.*` });

const text = (target: Mod, language: string, key: string): string | undefined =>
  target.localisation.get(language)?.find((entry) => entry.key === key)?.value;

/**
 * A language with no string for a key shows the key itself, whatever the other
 * languages say. A mod written in English and Japanese therefore shows raw keys
 * to a player in German unless every string is written ten times over, which is
 * what both mods built on this library ended up doing by hand.
 */
describe("localiseAll", () => {
  it("writes the languages given, and the English text for every other language the game reads", () => {
    const target = mod().localiseAll("sts_lab", { english: "Laboratory", japanese: "研究所" });

    expect(text(target, "l_english", "sts_lab")).toBe("Laboratory");
    expect(text(target, "l_japanese", "sts_lab")).toBe("研究所");
    expect(LOCALISATION_LANGUAGES.length).toBeGreaterThan(2);

    for (const language of LOCALISATION_LANGUAGES) {
      expect(text(target, language, "sts_lab")).toBe(language === "l_japanese" ? "研究所" : "Laboratory");
    }
  });

  it("takes a language by either of its names", () => {
    const target = mod().localiseAll("sts_lab", { l_english: "Laboratory", l_german: "Labor" });

    expect(text(target, "l_german", "sts_lab")).toBe("Labor");
    expect(text(target, "l_french", "sts_lab")).toBe("Laboratory");
  });

  it("falls back on the language it is told to", () => {
    const target = mod().localiseAll("sts_lab", { japanese: "研究所", korean: "연구소" }, { fallback: "japanese" });

    expect(text(target, "l_english", "sts_lab")).toBe("研究所");
    expect(text(target, "l_korean", "sts_lab")).toBe("연구소");
  });

  it("writes only what it was given when told not to fall back", () => {
    const target = mod().localiseAll("sts_lab", { japanese: "研究所" }, { fallback: false });

    expect([...target.localisation.keys()]).toEqual(["l_japanese"]);
  });

  it("refuses to guess a fallback it was not given", () => {
    expect(() => mod().localiseAll("sts_lab", { japanese: "研究所" })).toThrow(/no l_english text/u);
  });

  it("is written out as one file for each language", () => {
    const plan = emit(mod().localiseAll("sts_lab", { english: "Laboratory" }));
    const written = plan.files.filter((file) => file.path.startsWith("localisation/"));

    expect(written).toHaveLength(LOCALISATION_LANGUAGES.length);
    expect(plan.diagnostics).toEqual([]);
  });
});
