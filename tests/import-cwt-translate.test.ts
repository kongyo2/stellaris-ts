import { describe, expect, it } from "vitest";

import { readCwtSource } from "../tools/import-cwt/reader.js";
import { translateCwtFiles } from "../tools/import-cwt/translate.js";

describe("translateCwtFiles", () => {
  it("normalises type metadata, nested variants, annotations, and ordered schema rules", () => {
    const source = [
      "types = {",
      "\t## graph_related_types = { technology }",
      "\t## type_key_filter = building",
      "\ttype[building] = {",
      '\t\tname_field = "id"',
      '\t\tpath = "game/common/buildings"',
      '\t\tpath_file = "00_buildings.txt"',
      "\t\tpath_strict = yes",
      "\t\tskip_root_key = buildings",
      "\t\tseverity = warning",
      "\t\tmodifiers = {",
      '\t\t\t"planet_$_build_speed_mult" = Planets',
      "\t\t}",
      "\t\t## type_key_filter = corporate_building",
      "\t\t## push_scope = planet",
      "\t\t## display_name = Corporate Building",
      "\t\tsubtype[corporate] = { owner_type = corporate }",
      "\t\tlocalisation = {",
      "\t\t\t## required",
      '\t\t\tName = "$"',
      "\t\t}",
      "\t}",
      "}",
      "## push_scope = planet",
      "### Building schema",
      "building = {",
      "\t## cardinality = 0..1",
      "\t## replace_scopes = { this = planet root = planet prev = system }",
      "\t## severity = info",
      "\towner_type = enum[building_owner_type]",
      "\t## cardinality = 0..1",
      "\towner_type = corporate",
      "\tprerequisites = {",
      "\t\t## cardinality = 0..inf",
      "\t\t<technology>",
      "\t}",
      "\tsubtype[corporate] = { holding = no }",
      "\talias_name[trigger] = alias_match_left[trigger]",
      "\ttarget = scope[planet].enum[building_categories]",
      "\ticon = icon[gfx/interface/icons/buildings]",
      "}",
      "",
    ].join("\n");

    const translation = translateCwtFiles([readCwtSource("building.cwt", source)]);
    expect(translation.unsupported).toEqual([]);
    expect(translation.definitionTypes).toHaveLength(1);

    const definition = translation.definitionTypes[0];
    if (definition === undefined) {
      throw new Error("Expected the building definition.");
    }

    expect(definition.id).toBe("building");
    expect(definition.source).toMatchObject({
      kind: "tagged-blocks",
      directory: "common/buildings",
      includeSubdirectories: false,
      file: "00_buildings.txt",
      nameField: "id",
      rootKey: "buildings",
      severity: "warning",
    });
    expect(definition.source.keyFilters.map((filter) => [filter.mode, filter.values])).toEqual([
      ["include", ["building"]],
    ]);
    expect(definition.entryScopes).toEqual(["planet"]);
    expect(definition.annotations.relatedTypes).toEqual(["technology"]);
    expect(definition.schemaBlocks[0]?.annotations.documentation).toEqual(["Building schema"]);

    expect(definition.subtypes).toHaveLength(1);
    expect(definition.subtypes[0]).toMatchObject({
      id: "corporate",
      entryScopes: ["planet"],
      displayNames: ["Corporate Building"],
    });
    expect(definition.subtypes[0]?.keyFilters.map((filter) => filter.values)).toEqual([["corporate_building"]]);
    expect(definition.localisation[0]).toMatchObject({
      kind: "localisation",
      role: "Name",
      template: "$",
      requirements: ["required"],
    });
    expect(definition.modifiers[0]).toMatchObject({
      kind: "generated-modifier",
      prefix: "planet_",
      suffix: "_build_speed_mult",
      category: "Planets",
    });

    expect(definition.entries.map((entry) => entry.kind)).toEqual([
      "field",
      "field",
      "field",
      "variant-rules",
      "alias-expansion",
      "field",
      "field",
    ]);
    const firstOwnerRule = definition.entries[0];
    const secondOwnerRule = definition.entries[1];
    if (firstOwnerRule?.kind !== "field" || secondOwnerRule?.kind !== "field") {
      throw new Error("Expected both owner_type rules to remain fields.");
    }
    const ownerRules = [firstOwnerRule, secondOwnerRule];
    expect(ownerRules.map((entry) => entry.key)).toEqual([
      { kind: "literal-key", value: "owner_type" },
      { kind: "literal-key", value: "owner_type" },
    ]);
    expect(ownerRules[0]).toMatchObject({
      occurrence: { min: 0, max: 1 },
      value: { kind: "enum-reference", enum: "building_owner_type" },
    });
    expect(ownerRules[0]?.annotations.scopes[0]).toMatchObject({
      kind: "replace-scope",
      bindings: [
        { slot: "current", scope: "planet" },
        { slot: "root", scope: "planet" },
        { slot: "previous", scope: "system" },
      ],
    });
    expect(ownerRules[0]?.annotations.severities).toEqual(["information"]);

    const prerequisites = definition.entries[2];
    if (prerequisites?.kind !== "field") {
      throw new Error("Expected prerequisites to remain a field.");
    }
    expect(prerequisites.value).toMatchObject({
      kind: "block",
      entries: [
        {
          kind: "item",
          occurrence: { min: 0, max: null },
          value: { kind: "type-reference", type: "technology" },
        },
      ],
    });
    const variantRules = definition.entries[3];
    if (variantRules?.kind !== "variant-rules") {
      throw new Error("Expected the corporate selector to become a variant rule group.");
    }
    expect(variantRules).toMatchObject({
      mode: "include",
      variant: "corporate",
      entries: [
        {
          kind: "field",
          value: { kind: "literal", value: false },
        },
      ],
    });
    expect(definition.entries[4]).toMatchObject({
      kind: "alias-expansion",
      family: "trigger",
    });
    expect(definition.entries[5]).toMatchObject({
      kind: "field",
      value: {
        kind: "chained-enum-reference",
        scope: "planet",
        enum: "building_categories",
      },
    });
    expect(definition.entries[6]).toMatchObject({
      kind: "field",
      value: {
        kind: "primitive",
        type: "icon",
        path: "gfx/interface/icons/buildings",
      },
    });
  });

  it("records unsupported semantics with source positions instead of hiding them", () => {
    const source = [
      "types = {",
      '\ttype[thing] = { path = "game/common/things" }',
      "}",
      "thing = {",
      "\t## cardinality = 0.inf",
      "\tbad_count = int",
      "\tformula = @[ value + 1 ]",
      "}",
      "",
    ].join("\n");

    const translation = translateCwtFiles([readCwtSource("unsupported.cwt", source)]);

    expect(translation.unsupported.map((semantic) => semantic.code)).toEqual([
      "invalid-cardinality",
      "inline-math-schema-value",
    ]);
    expect(translation.unsupported.map((semantic) => semantic.source.span.start.line)).toEqual([5, 7]);
    expect(translation.definitionTypes[0]?.entries[1]).toMatchObject({
      kind: "field",
      value: {
        kind: "unsupported-value",
        semantic: { code: "inline-math-schema-value" },
      },
    });
  });
});
