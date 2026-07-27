import { describe, expect, it } from "vitest";

import { DefinitionTypeId, definitionTypes, type EntryRule } from "../src/schema/index.js";

/**
 * Locks the fields added by hand after vanilla contradicted the ported corpus.
 *
 * `npm run import:cwt -- --emit` rewrites these files wholesale, so a careless
 * re-import would silently drop them and the conformance gate would only notice
 * on a machine that has the game installed. These assertions notice everywhere.
 */
const fieldKeys = (typeId: string): readonly string[] =>
  (definitionTypes.find((definition) => definition.id === typeId)?.entries ?? [])
    .filter((entry: EntryRule): entry is Extract<EntryRule, { kind: "field" }> => entry.kind === "field")
    .map((entry) => entry.key)
    .filter((key): key is string => typeof key === "string");

describe("hand-maintained schema corrections", () => {
  it("keeps trait.forced_integration, which vanilla 4.4.6 uses and cwt never declared", () => {
    expect(fieldKeys(DefinitionTypeId.Trait)).toContain("forced_integration");
  });

  it("keeps event.notification_event_icon_frame, which vanilla 4.4.6 uses and cwt never declared", () => {
    expect(fieldKeys(DefinitionTypeId.Event)).toContain("notification_event_icon_frame");
  });
});
