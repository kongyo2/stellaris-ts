import { describe, expect, it } from "vitest";

import { define } from "../src/builders/index.js";
import { defineMod } from "../src/index.js";
import { localisationKey, schema } from "../src/schema/index.js";
import { validate } from "../src/validate/index.js";

/**
 * The key a definition needs a string under.
 *
 * `$` is the id, and it is not always at the front: a job's name is `job_$` and
 * its modifier `mod_job_$_add`, which vanilla localises exactly so. Treating the
 * pattern as a suffix asked for `my_jobjob_$` — a key with a literal `$` in it,
 * which nothing would ever satisfy.
 */
const keysFor = (type: string, id: string): readonly string[] =>
  (schema.definitionTypes.find((candidate) => candidate.id === type)?.localisation ?? [])
    .filter((requirement) => requirement.source.kind === "definition-id")
    .map((requirement) =>
      requirement.source.kind === "definition-id" ? localisationKey(requirement.source.pattern, id) : "",
    );

describe("localisation keys", () => {
  it("puts the id where the pattern puts it", () => {
    expect(keysFor("job", "researcher")).toContain("job_researcher");
    expect(keysFor("job", "researcher")).toContain("job_researcher_plural");
    expect(keysFor("job", "researcher")).toContain("mod_job_researcher_add");
  });

  it("still handles a pattern that is only the id", () => {
    expect(keysFor("building", "building_capital")).toContain("building_capital");
    expect(keysFor("building", "building_capital")).toContain("building_capital_desc");
  });

  it("never asks for a key with a marker left in it", () => {
    for (const type of schema.definitionTypes) {
      for (const requirement of type.localisation) {
        if (requirement.source.kind === "definition-id") {
          expect(localisationKey(requirement.source.pattern, "x")).not.toContain("$");
        }
      }
    }
  });

  it("reports the key the game would look up", () => {
    const mod = defineMod({ name: "Loc", version: "1", supportedVersion: "v4.4.*" }).add(
      define("job", "sts_curator", { category: "specialist" }),
    );

    const missing = validate(mod)
      .filter((diagnostic) => diagnostic.code === "missing-localisation")
      .map((diagnostic) => diagnostic.message);

    expect(missing.join(" ")).toContain("job_sts_curator");
    expect(missing.join(" ")).not.toContain("$");
  });
});
