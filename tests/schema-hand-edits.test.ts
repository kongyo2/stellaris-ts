import { describe, expect, it } from "vitest";

import { vanillaIdsByType } from "../src/generated/vanilla/ids.js";
import {
  localisationCommandsByScope,
  localisationProperties,
  localisationPromotions,
} from "../src/generated/vanilla/localisation-commands.js";
import { DefinitionTypeId, schema, type EntryRule } from "../src/schema/index.js";

/**
 * Locks the fields added by hand after vanilla contradicted the ported corpus.
 *
 * They live in `corrections.ts`, outside the directory the importer rewrites,
 * because a correction inside `definitions/` is one `--emit` away from vanishing
 * and the conformance gate would only notice it on a machine with the game
 * installed. These assertions notice everywhere.
 */
const fieldKeys = (typeId: string): readonly string[] =>
  (schema.definitionTypes.find((definition) => definition.id === typeId)?.entries ?? [])
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

  /**
   * The game's own list of scoped localisation commands, carried as data.
   * Nothing enforces it: measured against vanilla's localisation, requiring a
   * chain's middle elements to be promotions this dump lists rejects 3,390
   * statements the game accepts, and the position stays open even after the
   * scope links are joined in — a saved event target can be called anything.
   */
  it("carries what the localisation dump documents", () => {
    expect(Object.keys(localisationCommandsByScope)).toHaveLength(43);
    expect(localisationPromotions).toHaveLength(44);
    expect(localisationProperties).toHaveLength(146);
    expect(localisationCommandsByScope["Country"]?.properties).toContain("GetName");
    expect(localisationCommandsByScope["Country"]?.promotions).toContain("Ruler");
  });

  /**
   * cwt calls both tag directories `type_per_file`, which makes the identifier
   * the file name — `00_tags` — and every tag the game actually defines
   * unknown. The files are lists of bare words, and a job writes
   * `tags = { crime enforcer }` against them, so a mod that spelled its tags
   * correctly got one warning per tag and nothing to do about it.
   */
  for (const typeId of [DefinitionTypeId.JobTags, DefinitionTypeId.TraitTags]) {
    it(`reads ${typeId} as the words in the file, not the file name`, () => {
      expect(schema.definitionTypes.find((definition) => definition.id === typeId)?.source.kind).toBe("bare-values");
      expect(vanillaIdsByType[typeId]).toContain("research");
      expect(vanillaIdsByType[typeId]).not.toContain("00_tags");
    });
  }
});
