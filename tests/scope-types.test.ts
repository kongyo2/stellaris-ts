import { describe, expect, it } from "vitest";

import { commands, dumpCommands, schema, vanillaCommands } from "../src/schema/index.js";
import type { CountryTriggers, PlanetTriggers } from "../src/generated/types/index.js";

/**
 * The scope-typed surface, and how much of it is real.
 *
 * A scope-typed API is worth exactly what its source data says. The ported
 * corpus constrains none of the scripted commands; the game's own -debug
 * documentation constrains most of them, which is why that is imported too.
 * The proportion is asserted rather than assumed, so a regression in the import
 * shows up here instead of quietly making every trigger legal everywhere.
 *
 * The counts include what vanilla itself witnesses on top of the corpus: the
 * commands vanilla writes that the corpus never declared, and the `colony` and
 * `carrier` scopes 4.4 added. A command no dump documents carries no scope
 * constraint, which is why the constrained floor is a floor and not a
 * proportion.
 */
describe("scope constraints", () => {
  const scripted = schema.commands.filter((command) => command.family === "trigger" || command.family === "effect");
  const constrained = scripted.filter(
    (command) => command.input.kind === "listed-scopes" && command.input.scopes.length > 0,
  );

  it("covers every scope the game declares", () => {
    // 41 from the corpus, plus `colony`, `carrier` and `mission`, which the
    // game has had since 4.4 and the corpus predates.
    expect(schema.scopes.length).toBe(44);
  });

  it("constrains the large majority of scripted commands", () => {
    // The corpus, vanilla's own script, and what the game's `-debug`
    // documentation declares and neither of those had: with them, every command
    // in the 4.5.1 trigger and effect dumps and the 4.5.2 game's own is in the
    // schema, less the four 4.5 removed and the ten last documented in 4.3.7.
    // One more declaration than commands for `damage_ship`, which the 4.5.2
    // documentation gives a block form too.
    expect(scripted.length).toBe(2459);
    // 2,042 of them today. It may rise; it must not fall.
    expect(constrained.length).toBeGreaterThanOrEqual(2042);
  });

  /**
   * The dumps are the game describing itself, so a command they document and
   * the schema does not is a command a mod may write and the checker will call
   * unknown. Locked by name, because the eight were found by measuring and the
   * measurement needs `refs/`, which the build must never require.
   */
  it("keeps the commands only the game's own documentation declares", () => {
    const ids = new Set(schema.commands.map((command) => `${command.family}:${command.id}`));

    for (const id of [
      "trigger:council_agenda_progress",
      "trigger:has_ruler_trait",
      "trigger:built_on_planet",
      "trigger:is_spynetwork_max_level",
      "trigger:cosmic_storm_system_influence",
      "trigger:is_market_leader",
      "effect:delete_fleet_naval_cap",
      "effect:finish_current_operation_stage",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("keeps a country-only trigger out of the planet scope", () => {
    const country: CountryTriggers = { has_country_flag: "example" };
    expect(country["has_country_flag"]).toBe("example");

    // `is_at_war` is documented for country, not planet. The generated planet
    // interface has no such member, which is the whole point of the split.
    const planet: PlanetTriggers = {};
    expect(Object.keys(planet)).toEqual([]);
  });

  it("agrees with the schema about which scopes a known trigger accepts", () => {
    const atWar = schema.commands.find((command) => command.family === "trigger" && command.id === "is_at_war");

    expect(atWar?.input.kind).toBe("listed-scopes");
    if (atWar?.input.kind === "listed-scopes") {
      expect(atWar.input.scopes).toContain("country");
      expect(atWar.input.scopes).not.toContain("planet");
    }
  });

  /**
   * A scope the dump lists is kept or the constraint is dropped whole, never
   * cut down to the scopes the catalog happens to know. Cutting it down is how
   * `colony`, listed for 256 commands in the 4.5.1 dumps, went missing from all
   * of them while the catalog lacked it, and how `add_mission_counter` read as
   * country-only before the catalog had the mission.
   */
  it("keeps every scope a documented command accepts", () => {
    expect(acceptedScopes("trigger", "any_moon")).toEqual(["colony", "planet", "ship"]);
    expect(acceptedScopes("effect", "add_mission_counter")).toEqual(["country", "mission"]);
    // The dump lists `galactic_community` for this one, which is a scope
    // nothing else names; the command is left open rather than narrowed.
    expect(acceptedScopes("effect", "save_global_event_target_as")).toBeUndefined();
  });

  /** Vanilla's script found these, and the dump says where they run. */
  it("constrains a command vanilla writes when the dump documents it", () => {
    expect(acceptedScopes("trigger", "pop_ethic_amount")).toEqual(["colony", "country", "pop_faction", "pop_group"]);
    // The dump says colony; vanilla fires it from `capital_scope`, a planet.
    expect(acceptedScopes("effect", "colony_event")).toEqual(["colony", "planet"]);
  });

  it("declares what 4.5.2 documents and no collected dump has yet", () => {
    expect(acceptedScopes("trigger", "is_preferred_platform_weapons")).toEqual(["country"]);
    expect(acceptedScopes("trigger", "pop_ethics_divergence")).toEqual(["colony", "planet", "ship"]);

    for (const id of [
      "set_ai_platform_weapon_preference",
      "clear_ai_platform_weapon_preference",
      "set_ai_platform_armor_ratio",
      "clear_ai_platform_armor_ratio",
      "set_ai_platform_shields_ratio",
      "clear_ai_platform_shields_ratio",
    ]) {
      expect(acceptedScopes("effect", id)).toEqual(["country"]);
    }
  });

  /** In the 4.4.6 dumps, in neither 4.5 one, and written by 4.5.2 vanilla only in comments. */
  it("drops the commands 4.5 removed", () => {
    for (const [family, id] of [
      ["trigger", "check_pop_faction_parameter"],
      ["trigger", "pop_has_ethic"],
      ["trigger", "pop_group_has_ethic"],
      ["effect", "pop_event"],
    ] as const) {
      expect(schema.commands.some((command) => command.family === family && command.id === id)).toBe(false);
    }
  });

  /**
   * A command found in vanilla's script is proposed only when nothing else
   * declares it. Proposing one the documentation already declares would put a
   * second, unconstrained definition beside the one with its scopes.
   */
  it("declares each command vanilla's script proposed once", () => {
    const declared = new Set([...commands, ...dumpCommands].map((command) => `${command.family}:${command.id}`));

    expect(vanillaCommands.filter((command) => declared.has(`${command.family}:${command.id}`))).toEqual([]);
  });

  /** Each link the scope dump has carried since 4.4 that the corpus predates. */
  it("knows the links the corpus predates, with the scopes the dump gives them", () => {
    const link = (id: string) => schema.links.find((entry) => entry.kind === "scope-link" && entry.id === id);

    expect(link("issuer")).toMatchObject({
      input: { scopes: ["mission"] },
      output: { scopes: ["country"] },
    });
    expect(link("home_colony")).toMatchObject({ output: { scopes: ["colony"] } });
    expect(link("background_colony")).toMatchObject({ input: { scopes: ["leader"] } });
    expect(link("ship")).toMatchObject({ output: { scopes: ["ship"] } });

    for (const rank of ["first", "second", "third"]) {
      expect(link(`${rank}_damaging_country`)).toMatchObject({
        input: { scopes: ["fleet"] },
        output: { scopes: ["country"] },
      });
    }
  });
});

/** The scopes a command accepts, sorted, or `undefined` when it is unconstrained. */
function acceptedScopes(family: "trigger" | "effect", id: string): readonly string[] | undefined {
  const command = schema.commands.find((entry) => entry.family === family && entry.id === id);

  expect(command, `${family}:${id}`).toBeDefined();

  return command?.input.kind === "listed-scopes" ? [...command.input.scopes].sort() : undefined;
}
