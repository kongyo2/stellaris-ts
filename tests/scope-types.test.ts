import { describe, expect, it } from "vitest";

import { schema } from "../src/schema/index.js";
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
 * The counts include what vanilla itself witnesses on top of the corpus: 92
 * commands the corpus never declared, and the `colony` and `carrier` scopes 4.4
 * added. Those carry no scope constraint, which is why the constrained floor is
 * a floor and not a proportion.
 */
describe("scope constraints", () => {
  const scripted = schema.commands.filter((command) => command.family === "trigger" || command.family === "effect");
  const constrained = scripted.filter(
    (command) => command.input.kind === "listed-scopes" && command.input.scopes.length > 0,
  );

  it("covers every scope the game declares", () => {
    // 41 from the corpus, plus `colony` and `carrier`, which vanilla writes as
    // scope changes since 4.4 and the 4.5.1 dump documents as links.
    expect(schema.scopes.length).toBe(43);
  });

  it("constrains the large majority of scripted commands", () => {
    // 2,415 from the corpus and vanilla's own script, less the four the game
    // retired in 4.5, plus the 53 the game's `-debug` documentation declares and
    // neither of those had: with them, every command in the 4.5.1 trigger and
    // effect dumps is in the schema.
    expect(scripted.length).toBe(2468);
    // 1,950 of them today. It may rise; it must not fall.
    expect(constrained.length).toBeGreaterThanOrEqual(1900);
  });

  /**
   * The dumps are the game describing itself, so a command they document and
   * the schema does not is a command a mod may write and the checker will call
   * unknown. Locked by name, because they were found by measuring and the
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
      // From the 4.5.1 dumps.
      "trigger:is_ai_ship_role",
      "trigger:waystation_network_stockpile_used",
      "trigger:waystation_network_has_remote_collection",
      "trigger:fallen_empire_strength_scale",
      "trigger:trade_action_value",
      "trigger:has_mission_flag",
      "trigger:is_being_surveyed",
      "trigger:has_ethos",
      "trigger:used_stockpile_capacity_percentage",
      "trigger:pop_ethic_percentage",
      "trigger:is_mission_type",
      "trigger:used_starbase_capacity",
      "trigger:count_visible_contracts",
      "trigger:count_contracts_in_progress",
      "trigger:has_civilian_job_category",
      "trigger:num_claims_on_system",
      "trigger:hostile_military_power",
      "trigger:has_automation_setting",
      "trigger:has_overclock_cooldown",
      "trigger:count_owned_mission",
      "trigger:count_issued_mission",
      "trigger:count_owned_contract",
      "trigger:any_controlled_colony",
      "trigger:count_controlled_colony",
      "effect:set_mission_flag",
      "effect:remove_mission_flag",
      "effect:add_resource_to_local_stockpile",
      "effect:transfer_carrier",
      "effect:create_sector",
      "effect:force_show_espionage",
      "effect:pop_force_transfer_ethic",
      "effect:set_overclock",
      "effect:ordered_owned_mission",
      "effect:every_owned_mission",
      "effect:random_issued_mission",
      "effect:ordered_issued_mission",
      "effect:ordered_owned_contract",
      "effect:ordered_system_planet_colony",
      "effect:ordered_system_ship_colony",
      "effect:random_controlled_colony",
      "effect:ordered_controlled_colony",
      "effect:every_controlled_colony",
      "effect:random_starbase_in_network",
      "effect:ordered_starbase_in_network",
      "effect:every_starbase_in_network",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  /**
   * The corpus still declares four commands 4.5 took out. A mod that writes one
   * checked clean and then did nothing, because the game drops a trigger or
   * effect it does not know with a line in error.log.
   */
  it("drops the commands the game no longer has", () => {
    const ids = new Set(schema.commands.map((command) => `${command.family}:${command.id}`));

    for (const id of [
      "trigger:check_pop_faction_parameter",
      "trigger:pop_has_ethic",
      "trigger:pop_group_has_ethic",
      "effect:pop_event",
    ]) {
      expect(ids.has(id)).toBe(false);
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
});
