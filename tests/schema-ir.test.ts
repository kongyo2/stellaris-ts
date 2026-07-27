import { describe, expect, it } from "vitest";

import {
  DefinitionTypeId,
  EnumId,
  block,
  defaultSchemaPolicy,
  definitionTypes,
  enumExtraction,
  extractedEnum,
  extractionField,
  optional,
  primitive,
  captureScalar,
  schema,
} from "../src/schema/index.js";

describe("schema IR", () => {
  it("covers every imported definition type and keeps ids unique", () => {
    // The importer measured 234 `type[x] = {` declarations; see PLAN.md §1.
    expect(definitionTypes.length).toBe(234);
    expect(new Set(definitionTypes.map((definition) => definition.id)).size).toBe(definitionTypes.length);

    for (const id of [
      DefinitionTypeId.Building,
      DefinitionTypeId.Technology,
      DefinitionTypeId.Trait,
      DefinitionTypeId.Event,
    ]) {
      expect(definitionTypes.some((definition) => definition.id === id)).toBe(true);
    }
  });

  it("routes each MVP definition at its vanilla directory", () => {
    const technology = definitionTypes.find((definition) => definition.id === DefinitionTypeId.Technology);
    const building = definitionTypes.find((definition) => definition.id === DefinitionTypeId.Building);

    expect(technology?.source.kind).toBe("keyed-blocks");
    expect(technology?.source.directory).toBe("common/technology");
    expect(building?.source.directory).toBe("common/buildings");
  });

  it("assembles one schema model from the imported sources", () => {
    expect(schema.definitionTypes).toBe(definitionTypes);
    expect(schema.enums.length).toBeGreaterThanOrEqual(206);
    expect(schema.scopes.length).toBeGreaterThanOrEqual(41);
    expect(schema.links.length).toBeGreaterThanOrEqual(85);
  });

  it("preserves duplicate ordered rules instead of collapsing them into an object", () => {
    const value = block([optional("desc", primitive("localisation")), optional("desc", primitive("localisation"))]);

    expect(value.entries).toHaveLength(2);
    expect(value.entries.map((entry) => (entry.kind === "field" ? entry.key : entry.kind))).toEqual(["desc", "desc"]);
  });

  it("makes extraction routes and the global inline-script policy explicit", () => {
    const derived = extractedEnum(EnumId.FeatureFlags, [
      enumExtraction("common/game_rules", [extractionField("flags"), captureScalar()]),
    ]);

    expect(derived.kind).toBe("extracted-enum");
    expect(derived.sources[0]?.route).toEqual([
      { kind: "field", key: "flags" },
      { kind: "capture", source: "scalar" },
    ]);
    expect(defaultSchemaPolicy.macros).toEqual([
      { id: "inline-script", key: "inline_script", appliesTo: "all-blocks" },
    ]);
  });
});
