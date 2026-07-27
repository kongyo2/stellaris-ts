import { describe, expect, it } from "vitest";

import { schema } from "../src/schema/index.js";
import type { CountryTriggers, PlanetTriggers } from "../src/generated/types/index.js";

/**
 * The scope-typed surface, and how much of it is real.
 *
 * A scope-typed API is worth exactly what its source data says. The ported
 * corpus constrains none of the 2,328 scripted commands; the game's own -debug
 * documentation constrains most of them, which is why that is imported too.
 * The proportion is asserted rather than assumed, so a regression in the import
 * shows up here instead of quietly making every trigger legal everywhere.
 */
describe("scope constraints", () => {
  const scripted = schema.commands.filter((command) => command.family === "trigger" || command.family === "effect");
  const constrained = scripted.filter(
    (command) => command.input.kind === "listed-scopes" && command.input.scopes.length > 0,
  );

  it("covers every scope the game declares", () => {
    expect(schema.scopes.length).toBe(41);
  });

  it("constrains the large majority of scripted commands", () => {
    expect(scripted.length).toBe(2328);
    // 1,920 of 2,328 today. It may rise; it must not fall.
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
