import { describe, expect, it } from "vitest";

import { define } from "../src/builders/index.js";
import { defineMod } from "../src/index.js";
import { schema } from "../src/schema/index.js";
import { expandModifierNames } from "../src/schema/modifier-namespace.js";
import { validate } from "../src/validate/index.js";
import { vanillaModsCompatibilityVersion } from "../src/generated/vanilla/game-version.js";

/** What this build of the game asks a mod to declare, so no test pins one release. */
const SUPPORTED_VERSION = `v${vanillaModsCompatibilityVersion}.*`;

const codes = (mod: Parameters<typeof validate>[0]): readonly string[] =>
  validate(mod).map((diagnostic) => diagnostic.code);

/**
 * A modifier name is generated, not declared. The game turns each definition of
 * certain types into modifiers, so what counts as a modifier depends on what is
 * defined — including by the mod being checked.
 */
describe("the modifier namespace", () => {
  it("accepts a modifier generated from a vanilla job", () => {
    const mod = defineMod({ name: "Lab", version: "1", supportedVersion: SUPPORTED_VERSION })
      .add(define("building", "b", { planet_modifier: { job_researcher_add: 2 } }))
      .localise("l_english", "b", "x");

    expect(codes(mod)).not.toContain("unknown-modifier");
  });

  it("rejects one no rule produces", () => {
    const mod = defineMod({ name: "Typo", version: "1", supportedVersion: SUPPORTED_VERSION })
      .add(define("building", "b", { planet_modifier: { job_reseacher_add: 2 } }))
      .localise("l_english", "b", "x");

    const found = validate(mod).filter((diagnostic) => diagnostic.code === "unknown-modifier");

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("job_reseacher_add");
  });

  it("generates modifiers from the mod's own definitions", () => {
    const mod = defineMod({ name: "Job", version: "1", supportedVersion: SUPPORTED_VERSION })
      .add(define("job", "my_job", { category: "specialist" }))
      .add(define("building", "b", { planet_modifier: { job_my_job_add: 1 } }))
      .localise("l_english", "b", "x")
      .localise("l_english", "job_my_job", "x")
      .localise("l_english", "job_my_job_plural", "x")
      .localise("l_english", "job_my_job_desc", "x");

    expect(codes(mod)).not.toContain("unknown-modifier");
  });

  /**
   * The reader of a modifier block looks its key up among the static modifiers
   * first (`0x36db20` in the 4.5.2 executable) and applies the one it finds,
   * scaled by the value: the base game writes
   * `artisan_jobs_bonus_workforce_mult = 0.10` in a building, and that is a
   * static modifier of `24_static_modifiers_jobs.txt`.
   */
  it("takes a static modifier's name as a key, the base game's or the mod's own", () => {
    const mod = defineMod({ name: "Bundle", version: "1", supportedVersion: SUPPORTED_VERSION })
      .add(define("static_modifier", "sts_bundle", { planet_stability_add: 1, planet_amenities_add: 2 }))
      .add(
        define("building", "b", {
          planet_modifier: { sts_bundle: 0.5, artisan_jobs_bonus_workforce_mult: 0.1 },
        }),
      );

    expect(codes(mod)).not.toContain("unknown-modifier");
  });

  it("does not promise a workforce modifier for every job, which no rule of the game's generates", () => {
    const mod = defineMod({ name: "Job", version: "1", supportedVersion: SUPPORTED_VERSION })
      .add(define("job", "sts_job", { category: "specialist" }))
      .add(define("building", "b", { planet_modifier: { sts_job_jobs_bonus_workforce_mult: 0.1 } }));
    const found = validate(mod).filter((diagnostic) => diagnostic.code === "unknown-modifier");

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("sts_job_jobs_bonus_workforce_mult");
  });

  it("does not distinguish case, as the game does not", () => {
    const mod = defineMod({ name: "Case", version: "1", supportedVersion: SUPPORTED_VERSION })
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
