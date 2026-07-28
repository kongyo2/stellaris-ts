import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import {
  DefinitionTypeId,
  defaultSchemaPolicy,
  defineType,
  field,
  occurs,
  primitive,
  taggedBlocks,
  type DefinitionType,
  type SchemaModel,
} from "../src/schema/index.js";
import { indexGame } from "../tools/index-game/extract.js";
import { checkConformance } from "../tools/verify-schema/conformance.js";

it("applies a root-key filter to nested definitions after selecting their container", async () => {
  const root: string = await mkdtemp(join(tmpdir(), "stellaris-ts-container-filter-"));

  try {
    const directory: string = join(root, "interface");
    await mkdir(directory);
    await writeFile(
      join(directory, "fixture.gui"),
      [
        "guiTypes = {",
        "  containerWindowType = { name = kept allowed = yes }",
        "  unrelatedType = { name = excluded forbidden = yes }",
        "}",
      ].join("\n"),
      "utf8",
    );

    const definition: DefinitionType = defineType({
      id: DefinitionTypeId.ParagonUiNameType,
      source: taggedBlocks("interface", "name", [], false, {
        rootKeyFilter: { mode: "include", values: ["containerWindowType"] },
        container: { kind: "named-container", key: "guiTypes" },
      }),
      variants: [],
      localisation: [],
      modifiers: [],
      entries: [
        field("name", primitive("scalar"), occurs.one),
        field("allowed", primitive("boolean"), occurs.optional),
      ],
    });
    const model: SchemaModel = {
      policy: defaultSchemaPolicy,
      modifiers: { base: [], templates: [], source: "test" },
      definitionTypes: [definition],
      enums: [],
      scopes: [],
      scopeGroups: [],
      links: [],
      commands: [],
      ruleSets: [],
      namedValues: [],
      valueSets: [],
    };

    const index = await indexGame(model, root, "test");
    expect(index.types).toEqual([
      {
        type: DefinitionTypeId.ParagonUiNameType,
        directory: "interface",
        ids: ["kept"],
        // The block key is a tag for this type, so the tag is indexed too.
        tags: ["containerWindowType"],
      },
    ]);

    const report = await checkConformance(model, root);
    expect(report.types).toHaveLength(1);
    expect(report.types[0]).toMatchObject({
      type: DefinitionTypeId.ParagonUiNameType,
      definitionsSeen: 1,
      filesSeen: 1,
      unknownFields: [],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
