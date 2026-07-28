import { describe, expect, it } from "vitest";

import { define } from "../src/builders/index.js";
import { defineMod } from "../src/index.js";
import { validate } from "../src/validate/index.js";

const codes = (mod: Parameters<typeof validate>[0]): readonly string[] =>
  validate(mod).map((diagnostic) => diagnostic.code);

/**
 * References are checked against what the schema says a field points at, not
 * against whether the field happens to share a name with a definition type.
 * `picture` points at a sprite; nothing about the word says so.
 */
describe("reference checking", () => {
  it("accepts a sprite the game ships", () => {
    const mod = defineMod({ name: "Pic", version: "1", supportedVersion: "v4.4.*" })
      .add(define("event", "pic.1", { picture: "GFX_evt_mining_station" }, { as: "country_event" }))
      .localise("l_english", "pic.1", "x");

    expect(codes(mod)).not.toContain("unresolved-reference");
  });

  it("rejects one it does not", () => {
    const mod = defineMod({ name: "Typo", version: "1", supportedVersion: "v4.4.*" })
      .add(define("event", "typo.1", { picture: "GFX_evt_no_such_picture" }, { as: "country_event" }))
      .localise("l_english", "typo.1", "x");

    expect(codes(mod)).toContain("unresolved-reference");
  });

  it("checks every entry of a list of references", () => {
    const mod = defineMod({ name: "List", version: "1", supportedVersion: "v4.4.*" }).add(
      define("technology", "t", {
        area: "physics",
        category: ["computing"],
        tier: "0",
        prerequisites: ["tech_basic_science_lab_1", "tech_no_such_thing"],
      }),
    );
    const unresolved = validate(mod).filter((diagnostic) => diagnostic.code === "unresolved-reference");

    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.message).toContain("tech_no_such_thing");
  });
});
