import { describe, expect, it } from "vitest";

import { define } from "../src/builders/index.js";
import { defineMod, type Mod } from "../src/index.js";
import { retiredCommands } from "../src/schema/dump-commands.js";
import { schema } from "../src/schema/index.js";
import { engineCommandNames } from "../src/schema/load-checks.js";
import { validate, type ValidationDiagnostic } from "../src/validate/index.js";
import { vanillaIdsByType } from "../src/generated/vanilla/index.js";
import { vanillaModsCompatibilityVersion } from "../src/generated/vanilla/game-version.js";

/** What this build of the game asks a mod to declare, so no test pins one release. */
const SUPPORTED_VERSION = `v${vanillaModsCompatibilityVersion}.*`;

const mod = (): Mod => defineMod({ name: "Names", version: "1", supportedVersion: SUPPORTED_VERSION });

const found = (target: Mod, code: string): readonly ValidationDiagnostic[] =>
  validate(target).filter((diagnostic) => diagnostic.code === code);

const scriptedEffects: ReadonlySet<string> = new Set(vanillaIdsByType["scripted_effect"] ?? []);
const scriptedTriggers: ReadonlySet<string> = new Set(vanillaIdsByType["scripted_trigger"] ?? []);

/**
 * The ported corpus declared 84 of the base game's scripted effects and four
 * of its scripted triggers as commands, and kept them out of the types. The
 * game's own documentation lists none of those names, and
 * `common/scripted_effects` defines each of them.
 */
describe("a scripted effect of the base game", () => {
  it("is a scripted effect, and no command of the executable's", () => {
    for (const id of ["roll_boon", "accept_end_of_the_cycle", "create_mindwarden_enclave", "break_cycles"]) {
      expect(scriptedEffects.has(id), id).toBe(true);
      expect(engineCommandNames(schema, "effect").has(id), id).toBe(false);
    }

    for (const id of ["pop_amount", "sapient_pop_amount", "psionic_pop_amount", "is_leader_in_storm"]) {
      expect(scriptedTriggers.has(id), id).toBe(true);
      expect(engineCommandNames(schema, "trigger").has(id), id).toBe(false);
    }
  });

  it("is still called by its name, with the parameters it declares", () => {
    const target = mod().add(
      define("scripted_effect", "sts_names_roll", {
        roll_boon: { GOOD: 70, NEUTRAL: 20, BAD: 10 },
        accept_end_of_the_cycle: true,
      }),
    );

    expect(found(target, "unknown-field")).toEqual([]);
  });

  it("is replaced by a mod's of the same name, and said to be", () => {
    const target = mod().add(define("scripted_effect", "roll_boon", { add_influence: 1 }));

    expect(found(target, "replaces-vanilla-definition")).toHaveLength(1);
    expect(found(target, "shadows-engine-name")).toEqual([]);
  });

  it("shares no name with a command, in either family", () => {
    expect([...scriptedEffects].filter((id) => engineCommandNames(schema, "effect").has(id))).toEqual([]);
    expect([...scriptedTriggers].filter((id) => engineCommandNames(schema, "trigger").has(id))).toEqual([]);
  });
});

describe("a command the executable does not register", () => {
  it("is no key of an effect or a trigger block", () => {
    const target = mod()
      .add(define("scripted_effect", "sts_names_old", { resettle_pop: { pop: "this", planet: "root" } }))
      .add(define("scripted_trigger", "sts_names_count", { count_armies: { count: 1 } }));

    expect(found(target, "unknown-field").map((diagnostic) => diagnostic.definition)).toEqual([
      "sts_names_count",
      "sts_names_old",
    ]);
  });

  it("is retired for a reason, once per family", () => {
    const keys: readonly string[] = retiredCommands.map((retired) => `${retired.family}:${retired.id}`);

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("effect:scope_field");
    expect(keys).toContain("trigger:scope_field");
    expect(retiredCommands.every((retired) => retired.reason.length > 0)).toBe(true);
    for (const retired of retiredCommands) {
      expect(schema.commands.some((command) => command.id === retired.id && command.family === retired.family)).toBe(
        false,
      );
    }
  });
});

/**
 * A scripted effect is built with its name looked up among the executable's
 * effects (`0x851e80`), a scripted trigger among its triggers (`0x852990`),
 * and a static modifier's name is compared with every modifier (`0x3720a0`);
 * each logs that the new one "is overwriting an existing" one.
 */
describe("a name the executable already uses", () => {
  it("is reported for a scripted effect and a scripted trigger", () => {
    const target = mod()
      .add(define("scripted_effect", "add_resource", { add_influence: 1 }))
      .add(define("scripted_trigger", "has_technology", { always: true }));
    const reported = found(target, "shadows-engine-name");

    expect(reported.map((diagnostic) => diagnostic.definition)).toEqual(["add_resource", "has_technology"]);
    expect(reported[0]?.message).toContain("scripted effect add_resource is overwriting an existing effect");
    expect(reported[1]?.message).toContain("scripted trigger has_technology is overwriting an existing trigger");
    expect(reported.every((diagnostic) => diagnostic.severity === "warning")).toBe(true);
  });

  // The lookup that finds the clash walks the keyword trie one `tolower` at
  // a time (`0x1bb78a0`), and the schema declares the connectors in capitals.
  it("is found whatever its case", () => {
    const target = mod()
      .add(define("scripted_effect", "Add_Resource", { add_influence: 1 }))
      .add(define("scripted_trigger", "or", { always: true }));

    expect(found(target, "shadows-engine-name").map((diagnostic) => diagnostic.definition)).toEqual([
      "Add_Resource",
      "or",
    ]);
  });

  it("is each family's own: a trigger's name is free for an effect", () => {
    const target = mod().add(define("scripted_effect", "has_technology", { add_influence: 1 }));

    expect(found(target, "shadows-engine-name")).toEqual([]);
  });

  it("is reported for a static modifier named as a modifier, the mod's own generated ones included", () => {
    const target = mod()
      .add(define("job", "sts_names_job", { category: "specialist" }))
      .add(define("static_modifier", "planet_stability_add", { planet_amenities_add: 1 }))
      .add(define("static_modifier", "job_sts_names_job_add", { planet_amenities_add: 1 }))
      .add(define("static_modifier", "sts_names_bundle", { planet_amenities_add: 1 }));

    expect(found(target, "shadows-engine-name").map((diagnostic) => diagnostic.definition)).toEqual([
      "job_sts_names_job_add",
      "planet_stability_add",
    ]);
  });

  it("is not reported for a static modifier of the base game's own names", () => {
    // 24 of them are written as keys of modifier blocks, and none is a modifier.
    expect(vanillaIdsByType["static_modifier"]).toContain("artisan_jobs_bonus_workforce_mult");

    const target = mod().add(define("static_modifier", "sts_names_other", { artisan_jobs_bonus_workforce_mult: 1 }));

    expect(found(target, "shadows-engine-name")).toEqual([]);
    expect(found(target, "unknown-field")).toEqual([]);
  });
});
