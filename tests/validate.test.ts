import { describe, expect, it } from "vitest";

import { define } from "../src/builders/index.js";
import { defineMod } from "../src/index.js";
import { validate } from "../src/validate/index.js";

const codes = (mod: Parameters<typeof validate>[0]): readonly string[] =>
  validate(mod).map((diagnostic) => diagnostic.code);

describe("validate", () => {
  it("accepts a definition whose fields and strings are all present", () => {
    const mod = defineMod({ name: "Ok", version: "1", supportedVersion: "v4.4.*" })
      .add(define("building", "ok_lab", { category: "research" }))
      .localise("l_english", "ok_lab", "Lab")
      .localise("l_english", "ok_lab_desc", "A lab");

    expect(validate(mod)).toEqual([]);
  });

  it("rejects a field the game would silently ignore", () => {
    const mod = defineMod({ name: "Bad", version: "1", supportedVersion: "v4.4.*" }).add(
      // `building` accepts arbitrary keys at the type level, because its schema
      // has open rules. The validator is the layer that knows the field is not
      // real.
      define("building", "bad_lab", { not_a_real_field: 1 }),
    );

    expect(codes(mod)).toContain("unknown-field");
    expect(validate(mod).find((d) => d.code === "unknown-field")?.severity).toBe("error");
  });

  it("warns about a missing required string, which ships as the raw key", () => {
    const mod = defineMod({ name: "Loc", version: "1", supportedVersion: "v4.4.*" }).add(
      define("building", "loc_lab", { category: "research" }),
    );

    expect(codes(mod).filter((code) => code === "missing-localisation")).toHaveLength(2);
  });

  it("rejects the same id defined twice, where only the last one loads", () => {
    const mod = defineMod({ name: "Dupe", version: "1", supportedVersion: "v4.4.*" })
      .add(define("building", "same", { category: "research" }))
      .add(define("building", "same", { category: "unity" }));

    expect(codes(mod)).toContain("duplicate-definition");
  });

  it("does not flag a reference the mod itself defines", () => {
    const mod = defineMod({ name: "Self", version: "1", supportedVersion: "v4.4.*" })
      .add(define("building", "sts_other", { category: "research" }))
      .add(define("building", "sts_lab", { category: "research", building: "sts_other" }));

    expect(codes(mod)).not.toContain("unresolved-reference");
  });
});
