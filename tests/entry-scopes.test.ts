import { describe, expect, it } from "vitest";

import { schema } from "../src/schema/index.js";
import { vanillaEntryScopes } from "../src/schema/vanilla-entry-scopes.js";
import type { BuildingDefinition, EdictDefinition } from "../src/generated/types/index.js";

/**
 * Which object a definition body reads.
 *
 * It decides what every trigger and effect inside may be, and the ported corpus
 * states it for 16 of 235 types. The rest are inferred from the commands vanilla
 * writes straight into each body — a command reads one kind of object, so what
 * all of them accept is what the body is — and checked by re-reading the whole
 * game with them applied.
 */
describe("entry scopes", () => {
  it("knows the scope of most definition types", () => {
    const known = schema.definitionTypes.filter((type) => typeof type.entryScope === "string");

    // 16 stated by cwt plus 38 inferred. It may rise; it must not fall.
    expect(known.length).toBeGreaterThanOrEqual(54);
    expect(Object.keys(vanillaEntryScopes).length).toBeGreaterThanOrEqual(38);
  });

  it("reads a building on the planet it stands on", () => {
    const building = schema.definitionTypes.find((type) => type.id === "building");
    expect(building?.entryScope).toBe("planet");

    // Which is what makes the trigger block a planet's triggers.
    const allow: BuildingDefinition["allow"] = { is_colony: true };
    expect(allow).toBeTruthy();
  });

  it("reads an edict on the country that enacts it", () => {
    expect(schema.definitionTypes.find((type) => type.id === "edict")?.entryScope).toBe("country");

    const potential: EdictDefinition["potential"] = { has_country_flag: "example" };
    expect(potential).toBeTruthy();
  });

  it("never overrules a scope the corpus states", () => {
    for (const [type, inferred] of Object.entries(vanillaEntryScopes)) {
      const definition = schema.definitionTypes.find((candidate) => candidate.id === type);
      expect(definition?.entryScope).toBe(inferred);
    }
  });
});
