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
 * The counts include what vanilla itself witnesses on top of the corpus: 58
 * commands the dump predates, and the `colony` and `carrier` scopes 4.4 added.
 * Those carry no scope constraint, which is why the constrained floor is a
 * floor and not a proportion.
 */
describe("scope constraints", () => {
  const scripted = schema.commands.filter((command) => command.family === "trigger" || command.family === "effect");
  const constrained = scripted.filter(
    (command) => command.input.kind === "listed-scopes" && command.input.scopes.length > 0,
  );

  it("covers every scope the game declares", () => {
    // 41 from the corpus, plus `colony` and `carrier`, which vanilla 4.4.6
    // writes as scope changes and no dump yet lists.
    expect(schema.scopes.length).toBe(43);
  });

  it("constrains the large majority of scripted commands", () => {
    // 2,385 from the corpus and vanilla's own script, plus the eight the game's
    // `-debug` documentation declares and neither of those had: with them, every
    // command in the 4.3.7 trigger and effect dumps is in the schema.
    expect(scripted.length).toBe(2393);
    // 1,927 of them today. It may rise; it must not fall.
    expect(constrained.length).toBeGreaterThanOrEqual(1900);
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
});
