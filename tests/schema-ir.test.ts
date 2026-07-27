import { describe, expect, it } from "vitest";

import {
  DefinitionTypeId,
  EnumId,
  block,
  defaultSchemaPolicy,
  enumExtraction,
  extractedEnum,
  extractionField,
  mvpDefinitionTypes,
  optional,
  primitive,
  captureScalar,
} from "../src/schema/index.js";

describe("schema IR", () => {
  it("keeps the four MVP definitions ordered and routes technology narrowly", () => {
    expect(mvpDefinitionTypes.map((definition) => definition.id)).toEqual([
      DefinitionTypeId.Building,
      DefinitionTypeId.Technology,
      DefinitionTypeId.Trait,
      DefinitionTypeId.Event,
    ]);

    const technology = mvpDefinitionTypes.find((definition) => definition.id === DefinitionTypeId.Technology);

    expect(technology?.source).toEqual({
      kind: "keyed-blocks",
      directory: "common/technology",
      includeSubdirectories: false,
    });
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
