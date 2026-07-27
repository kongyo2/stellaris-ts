import { block, field, occurs, primitive } from "./ir.js";
import type { DefinitionType, EntryRule } from "./ir.js";

/**
 * Fields vanilla uses that the ported corpus never declared.
 *
 * These live outside `definitions/` on purpose. That directory is rewritten
 * wholesale by `npm run import:cwt -- --emit`, so a correction placed there is
 * one careless re-import away from vanishing — and it would only be missed on a
 * machine that has the game installed to run `verify:conformance` against.
 *
 * Each entry names where it came from. Delete one only when upstream declares
 * the field itself.
 */
export const definitionCorrections: Readonly<Record<string, readonly EntryRule[]>> = {
  // vanilla 4.4.6: common/traits/03_species_traits_presapients.txt
  trait: [
    field(
      "forced_integration",
      block([
        field("integration_rate", primitive("number"), occurs.optional),
        field("minimum_colony_age", primitive("integer"), occurs.optional),
      ]),
      occurs.optional,
    ),
  ],
  // vanilla 4.4.6: events/nomads_events_1.txt, paired with notification_event_icon
  event: [field("notification_event_icon_frame", primitive("integer"), occurs.optional)],
};

/** Applies the corrections to the imported types, leaving everything else alone. */
export function withCorrections(types: readonly DefinitionType[]): readonly DefinitionType[] {
  return types.map((type) => {
    const extra: readonly EntryRule[] | undefined = definitionCorrections[type.id];
    return extra === undefined ? type : { ...type, entries: [...type.entries, ...extra] };
  });
}
