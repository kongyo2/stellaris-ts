import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { defaultSchemaPolicy, scriptedEffect, type SchemaModel } from "../src/schema/index.js";
import { indexGame } from "../tools/index-game/extract.js";

const model: SchemaModel = {
  policy: defaultSchemaPolicy,
  modifiers: { base: [], templates: [], source: "test" },
  definitionTypes: [scriptedEffect],
  enums: [],
  scopes: [],
  scopeGroups: [],
  links: [],
  commands: [],
  ruleSets: [],
  namedValues: [],
  valueSets: [],
};

it("reads the parameter an optional block is named after", async () => {
  const root: string = await mkdtemp(join(tmpdir(), "stellaris-ts-parameters-"));

  try {
    const directory: string = join(root, "common", "scripted_effects");
    await mkdir(directory, { recursive: true });
    // The shape of vanilla's `add_random_trait_evopred`: the parameter is
    // named only in the header, and `[[SPECIES]` reaches the indexer as one
    // token, brackets and all.
    await writeFile(
      join(directory, "fixture.txt"),
      [
        "fixture_effect = {",
        "  [[SPECIES] set_species_flag = picked ]",
        "  [[!ROLLBACK] add_resource = { energy = $AMOUNT|1$ } ]",
        "}",
      ].join("\n"),
      "utf8",
    );

    const index = await indexGame(model, root, "test");

    expect(index.scriptedParameters["scripted_effect:fixture_effect"]).toEqual(["AMOUNT", "ROLLBACK", "SPECIES"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
