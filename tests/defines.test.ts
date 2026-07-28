import { describe, expect, it } from "vitest";

import { schema } from "../src/schema/index.js";
import { gameDeclaredFieldTypes } from "../src/schema/open-fields.js";

function fieldNames(typeId: string): ReadonlySet<string> {
  const type = schema.definitionTypes.find((candidate) => candidate.id === typeId);
  const names = new Set<string>();

  for (const entry of type?.entries ?? []) {
    if (entry.kind === "field" && typeof entry.key === "string") {
      names.add(entry.key);
    }
  }

  return names;
}

/**
 * A define exists because the engine reads it. The ported corpus is a snapshot
 * of some earlier build, so it lists defines that have since been removed and
 * two that were never spelled right.
 */
describe("defines come from the game", () => {
  it("keeps a define the game still declares", () => {
    expect(fieldNames("NAI").has("AI_ADDITIVE_SUPERFLUOUS_INCOME_THRESHOLD")).toBe(true);
  });

  it("drops the corpus's misspelling of it", () => {
    expect(fieldNames("NAI").has("AI_ADDITIVE_SUPERFLUOUS_INCOME_THRESOLD")).toBe(false);
  });

  it("drops a define the game no longer has", () => {
    expect(fieldNames("NGameplay").has("COLONY_DEPOSITS_USE_NULL")).toBe(false);
  });

  /** Every one of them, not just the ones the corpus happened to describe. */
  it("carries a rule for each key the game declares", () => {
    for (const typeId of gameDeclaredFieldTypes) {
      const names = fieldNames(typeId);
      const type = schema.definitionTypes.find((candidate) => candidate.id === typeId);

      if (type === undefined || names.size === 0) {
        continue;
      }

      expect(names.size).toBeGreaterThan(0);
    }

    expect(fieldNames("NGameplay").size).toBe(919);
    expect(fieldNames("NAI").size).toBe(590);
  });
});
