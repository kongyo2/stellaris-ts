import { describe, expect, it } from "vitest";

import { extractImportedCatalog } from "../tools/import-cwt/catalog.js";
import { extractImportedEnums, extractImportedLinks } from "../tools/import-cwt/metadata.js";
import type { CwtCorpus } from "../tools/import-cwt/model.js";
import { measureCwtFiles, readCwtSource } from "../tools/import-cwt/reader.js";

function corpusFrom(source: string): CwtCorpus {
  const files = [readCwtSource("sample.cwt", source)];
  return { files, metrics: measureCwtFiles(files) };
}

describe("CWT metadata import", () => {
  it("separates fixed and game-extracted enums", () => {
    const corpus = corpusFrom(`
types = {
  type[building] = { path = "game/common/buildings" }
}
enums = {
  enum[mode] = { one two }
  complex_enum[names] = {
    path = "game/common/items"
    name = { item = { name = enum_name } }
  }
}
scopes = {
  System = { aliases = { galacticobject system galactic_object } }
}
`);

    const catalog = extractImportedCatalog(corpus);
    expect(catalog.definitionTypeIds).toEqual(["building"]);
    expect(catalog.enumIds).toEqual(["mode", "names"]);
    expect(catalog.scopes).toEqual([
      {
        id: "system",
        aliases: ["galacticobject", "system", "galactic_object"],
        displayName: "System",
      },
    ]);
    expect(extractImportedEnums(corpus)).toEqual([
      { kind: "static", id: "mode", values: ["one", "two"] },
      {
        kind: "extracted",
        id: "names",
        sources: [
          {
            directory: "common/items",
            includeSubdirectories: true,
            startFromRoot: false,
            route: [
              { kind: "field", key: "item" },
              { kind: "field", key: "name" },
              { kind: "capture", source: "scalar" },
            ],
          },
        ],
      },
    ]);
  });

  it("retains scope and data link declarations as different IR concepts", () => {
    const corpus = corpusFrom(`
scopes = {
  Country = { aliases = { country } }
  Planet = { aliases = { planet } }
}
links = {
  owner = {
    input_scopes = { Planet }
    output_scope = Country
  }
  script_value = {
    from_data = yes
    type = value
    prefix = value:
    data_source = <script_value>
  }
}
`);

    const catalog = extractImportedCatalog(corpus);
    expect(extractImportedLinks(corpus, catalog)).toEqual([
      {
        kind: "scope",
        id: "owner",
        input: ["planet"],
        output: ["country"],
      },
      {
        kind: "data",
        id: "script_value",
        prefix: "value:",
        source: { kind: "type", id: "script_value" },
      },
    ]);
  });
});
