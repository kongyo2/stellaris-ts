import { describe, expect, it } from "vitest";

import { CwtDirectiveName } from "../tools/import-cwt/model.js";
import { readCwtSource } from "../tools/import-cwt/reader.js";

describe("readCwtSource", () => {
  it("rehydrates declarations, directives, and documentation over the L0 structure", () => {
    const source = [
      "types = {",
      "\t## graph_related_types = { technology }",
      "\ttype[building] = {",
      '\t\tpath = "game/common/buildings"',
      "\t\t## type_key_filter <> random_list",
      "\t\tsubtype[corporate] = { owner_type = corporate }",
      "\t}",
      "}",
      "enums = {",
      "\tenum[building_category] = { normal special }",
      '\tcomplex_enum[building_set] = { path = "game/common/buildings" name = { enum_name } }',
      "}",
      "## push_scope = planet",
      "### Building documentation",
      "building = {",
      "\t## cardinality 0..1",
      "\towner_type = enum[building_owner_type]",
      "}",
      "alias[trigger:has_building] == <building>",
      "single_alias[effect] = scalar",
      "value_set[building_flag] = bool",
      "",
    ].join("\n");
    const result = readCwtSource("inline.cwt", source);
    const directives = result.entries.flatMap((entry) =>
      entry.leading.filter((annotation) => annotation.kind === "directive"),
    );
    const documentation = result.entries.flatMap((entry) =>
      entry.leading.filter((annotation) => annotation.kind === "documentation"),
    );

    expect(result.metrics.unknownSyntaxCount).toBe(0);
    expect(result.metrics.l0DiagnosticCount).toBe(0);
    expect(result.metrics.orphanAnnotationCount).toBe(0);
    expect(result.constructs.some((construct) => construct.head === "single_alias")).toBe(true);
    expect(directives.map((directive) => directive.name)).toEqual([
      CwtDirectiveName.GraphRelatedTypes,
      CwtDirectiveName.TypeKeyFilter,
      CwtDirectiveName.PushScope,
      CwtDirectiveName.Cardinality,
    ]);
    expect(directives.map((directive) => directive.operator)).toEqual(["=", "<>", "=", "legacy-space"]);
    expect(documentation.map((entry) => entry.text)).toEqual(["Building documentation"]);
  });

  it("records a new directive as unknown syntax", () => {
    const result = readCwtSource("unknown-directive.cwt", ["## future_rule = yes", "key = bool"].join("\n"));

    expect(result.metrics.unknownSyntaxCount).toBe(1);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("unknown-directive");
  });

  it("preserves prose that happens to start with two hashes", () => {
    const result = readCwtSource("prose.cwt", ["## This is a maintainer note.", "key = bool"].join("\n"));
    const comments = result.entries.flatMap((entry) =>
      entry.leading.filter((annotation) => annotation.kind === "comment"),
    );

    expect(result.metrics.unknownSyntaxCount).toBe(0);
    expect(comments.map((comment) => comment.text)).toEqual(["This is a maintainer note."]);
  });
});
