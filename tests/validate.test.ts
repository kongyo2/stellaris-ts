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
      // The generated type rejects this too, and the `@ts-expect-error` is what
      // says so — if `building` ever goes back to accepting arbitrary keys, this
      // line stops erroring and the test fails. The validator is the layer that
      // still catches it for a body assembled at runtime, from data or from
      // JavaScript, where no type was ever consulted.
      // @ts-expect-error not_a_real_field is not a building field
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
});
