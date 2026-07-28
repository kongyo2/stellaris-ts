import { describe, expect, it } from "vitest";

import { define } from "../src/builders/index.js";
import { defineMod } from "../src/index.js";
import { schema } from "../src/schema/index.js";
import { expandModifierNames } from "../src/schema/modifier-namespace.js";
import { validate } from "../src/validate/index.js";

const codes = (mod: Parameters<typeof validate>[0]): readonly string[] =>
  validate(mod).map((diagnostic) => diagnostic.code);

/**
 * A modifier name is generated, not declared. The game turns each definition of
 * certain types into modifiers, so what counts as a modifier depends on what is
 * defined — including by the mod being checked.
 */
describe("the modifier namespace", () => {
  it("accepts a modifier generated from a vanilla job", () => {
    const mod = defineMod({ name: "Lab", version: "1", supportedVersion: "v4.4.*" })
      .add(define("building", "b", { planet_modifier: { job_researcher_add: 2 } }))
      .localise("l_english", "b", "x");

    expect(codes(mod)).not.toContain("unknown-modifier");
  });

  it("rejects one no rule produces", () => {
    const mod = defineMod({ name: "Typo", version: "1", supportedVersion: "v4.4.*" })
      .add(define("building", "b", { planet_modifier: { job_reseacher_add: 2 } }))
      .localise("l_english", "b", "x");

    const found = validate(mod).filter((diagnostic) => diagnostic.code === "unknown-modifier");

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("job_reseacher_add");
  });

  it("generates modifiers from the mod's own definitions", () => {
    const mod = defineMod({ name: "Job", version: "1", supportedVersion: "v4.4.*" })
      .add(define("job", "my_job", { category: "specialist" }))
      .add(define("building", "b", { planet_modifier: { job_my_job_add: 1 } }))
      .localise("l_english", "b", "x")
      .localise("l_english", "job_my_job", "x")
      .localise("l_english", "job_my_job_plural", "x")
      .localise("l_english", "job_my_job_desc", "x");

    expect(codes(mod)).not.toContain("unknown-modifier");
  });

  it("does not distinguish case, as the game does not", () => {
    const mod = defineMod({ name: "Case", version: "1", supportedVersion: "v4.4.*" })
      .add(define("static_modifier", "m", { COUNTRY_NAVAL_COVERAGE_MULT: 1 }))
      .localise("l_english", "m", "x");

    expect(codes(mod)).not.toContain("unknown-field");
  });

  /**
   * The set has to stay computed. Freezing the expansion would mean a mod's own
   * jobs and ship sizes silently produce nothing.
   */
  it("expands a template over whatever identifiers it is given", () => {
    const names = expandModifierNames(schema.modifiers, { job: ["invented_job"] });

    expect(names.has("job_invented_job_add")).toBe(true);
    expect(names.has("job_researcher_add")).toBe(false);
  });
});
