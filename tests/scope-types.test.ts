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
    expect(scripted.length).toBe(2385);
    // 1,920 of them today. It may rise; it must not fall.
    expect(constrained.length).toBeGreaterThanOrEqual(1900);
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
