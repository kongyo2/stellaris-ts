import { describe, expect, it } from "vitest";

import { define } from "../src/builders/index.js";
import { defineMod, repeated } from "../src/index.js";
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
      // `building` accepts arbitrary keys at the type level, and has to: the
      // schema says `inline_script` may be written in any block, so no block
      // enumerates every key it takes. The validator is the layer that knows
      // this particular one is not real.
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

  /**
   * `common/on_actions` is read differently: the game fires every definition of
   * the same on_action, which is what its own README says and what ten of the
   * twenty most recently updated workshop mods rely on. Adding to
   * `on_game_start` is the standard way to hook the start of a game, so a mod
   * that did it correctly was told it had replaced the base game.
   */
  it("says nothing about adding to an on_action the base game defines", () => {
    const mod = defineMod({ name: "Hook", version: "1", supportedVersion: "v4.4.*" })
      .add(define("on_action", "on_game_start", { events: ["sts_demo.1"] }))
      .add(define("on_action", "on_game_start", { events: ["sts_demo.2"] }));

    expect(codes(mod)).not.toContain("replaces-vanilla-definition");
    expect(codes(mod)).not.toContain("duplicate-definition");
  });

  it("still says so for a type the game replaces rather than merges", () => {
    const mod = defineMod({ name: "Shadow", version: "1", supportedVersion: "v4.4.*" }).add(
      define("building", "building_capital", { category: "unity" }),
    );

    expect(codes(mod)).toContain("replaces-vanilla-definition");
  });

  it("does not flag a reference the mod itself defines", () => {
    const mod = defineMod({ name: "Self", version: "1", supportedVersion: "v4.4.*" })
      .add(define("building", "sts_other", { category: "research" }))
      .add(define("building", "sts_lab", { category: "research", upgrades: ["sts_other"] }));

    expect(codes(mod)).not.toContain("unresolved-reference");
  });

  /**
   * An extracted enum's members are read off the game, so a mod that brings new
   * ones into existence has to join them — the same way its own definitions join
   * the modifier namespace. A chain's counters are the case that shows it:
   * declaring `counter = { notes_heard = { max = 3 } }` and then counting it was
   * reported as counting something that is not a counter.
   */
  const chainMod = (counter: string) =>
    defineMod({ name: "Chain", version: "1", supportedVersion: "v4.4.*" })
      .add(define("event_chain", "sts_chain", { counter: { sts_notes_heard: { max: 3 } } }))
      .add(
        define(
          "event",
          "sts_demo.1",
          {
            is_triggered_only: true,
            immediate: { add_event_chain_counter: { event_chain: "sts_chain", counter, amount: 1 } },
          },
          { as: "country_event" },
        ),
      );

  it("counts a counter the mod's own event chain declares", () => {
    expect(validate(chainMod("sts_notes_heard")).filter((d) => d.code === "unknown-value")).toEqual([]);
  });

  it("still reports a counter no chain declares", () => {
    expect(codes(chainMod("sts_typo_here"))).toContain("unknown-value");
  });

  /**
   * A policy flag is declared inside an option, and a policy writes `option`
   * more than once. Extraction only reached the first spelling of that it met,
   * and the mod was told its own flag was not one.
   */
  const flagMod = (flag: string) =>
    defineMod({ name: "Flags", version: "1", supportedVersion: "v4.4.*" })
      .add(
        define("policy", "sts_policy", {
          option: repeated({ name: "sts_option", policy_flags: ["sts_resonant"] }),
        }),
      )
      .add(define("building", "sts_lab", { category: "research", potential: { has_policy_flag: flag } }));

  it("reads a flag the mod's own policy declares in a list", () => {
    expect(validate(flagMod("sts_resonant")).filter((d) => d.code === "unknown-value")).toEqual([]);
  });

  it("still reports a flag no policy declares", () => {
    expect(codes(flagMod("sts_typo_here"))).toContain("unknown-value");
  });

  /**
   * `common/component_tags` has no definition type, so a mod adds one the way
   * Gigastructural Engineering does: a file of bare words. Reading the game's
   * copy of that file without reading the mod's would turn an empty check into
   * one that accepts vanilla and nothing else.
   */
  const componentMod = (declared: boolean) => {
    const mod = defineMod({ name: "Comp", version: "1", supportedVersion: "v4.4.*" }).add(
      define(
        "component_template",
        "sts_weapon",
        {
          size: "medium",
          type: "instant",
          ai_weight: { weight: 1, modifier: { factor: 2, is_preferred_weapons: "weapon_type_kyome" } },
        },
        { as: "weapon_component_template" },
      ),
    );

    return declared
      ? mod.file({ path: "common/component_tags/zz_comp_tags.txt", contents: "weapon_type_kyome\n" })
      : mod;
  };

  it("reads a component tag the mod ships as a raw file", () => {
    expect(validate(componentMod(true)).filter((d) => d.code === "unknown-value")).toEqual([]);
  });

  it("still reports a component tag nothing declares", () => {
    expect(codes(componentMod(false))).toContain("unknown-value");
  });

  /**
   * A ship class is behaviour in the executable, so a mod cannot add one — and
   * `ship_size.class` is both where the enum is read from and where it is
   * checked, so joining the mod's own values would let a misspelling declare
   * itself and then legitimise every use of it.
   */
  it("still reports a ship class the game does not have", () => {
    const mod = defineMod({ name: "Ship", version: "1", supportedVersion: "v4.4.*" }).add(
      define("ship_size", "sts_ship", { class: "shipclass_militaryy", entity: "corvette_entity" }),
    );

    expect(codes(mod)).toContain("unknown-value");
  });

  /**
   * A technology tier is `0` … `5`, so a reference to one is a number. Reading
   * only strings meant `tier = 99` pointed at nothing and was told nothing.
   */
  it("reports a numeric reference to something that does not exist", () => {
    const mod = defineMod({ name: "Tier", version: "1", supportedVersion: "v4.4.*" }).add(
      define("technology", "sts_tech", { area: "physics", tier: 99, category: ["computing"], cost: 100 }),
    );

    expect(codes(mod)).toContain("unresolved-reference");
  });

  it("says nothing about a tier the game has", () => {
    const mod = defineMod({ name: "Tier", version: "1", supportedVersion: "v4.4.*" }).add(
      define("technology", "sts_tech", { area: "physics", tier: 3, category: ["computing"], cost: 100 }),
    );

    expect(codes(mod)).not.toContain("unresolved-reference");
  });
});
