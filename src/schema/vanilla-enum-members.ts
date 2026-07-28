import type { EnumDefinition } from "./ir.js";

/**
 * Enum members the game has and the ported corpus does not.
 *
 * A static enum in cwt is a list someone wrote down, and the game keeps adding
 * to it: 4.4 brought the Nomads DLC, the `colony` scope and a district grid box
 * the corpus never heard of. A member missing here is script the checker calls
 * an error while the game reads it happily.
 *
 * Only ever *adds*. Every entry names where vanilla writes it, because that is
 * the whole evidence for it.
 */
export const additionalEnumMembers: Readonly<Record<string, readonly string[]>> = {
  // common/traits/18_nomads_species_traits.txt, and nine more places.
  DLCs: ["Nomads"],
  // common/astral_actions/astral_planes_actions.txt
  astral_actions_upgrade: ["action_exodus_jump_insight_2"],
  // common/districts: every value the game writes that the corpus lacks.
  gridbox: ["district_arcology_fortress", "district_city", "district_farming", "district_srw_commercial"],
  // common/leader_classes/00_base_classes.txt: `is_scope_type = colony`
  scope_type_tokens: ["colony"],
  // common/economic_categories/00_common_categories.txt, 97 uses in all.
  scripted_modifier_categories: ["colony"],
  // common/special_projects/00_projects_1.txt: the carrier is a 4.4 scope.
  sp_event_scopes: ["carrier_event"],
  // common/solar_system_initializers/00_nomad_custom_initializers.txt
  usage_type: ["nomad_init"],
};

/** Adds them to the static enums, leaving the extracted ones alone. */
export function withEnumMembers(enums: readonly EnumDefinition[]): readonly EnumDefinition[] {
  return enums.map((definition) => {
    if (definition.kind !== "static-enum") {
      return definition;
    }

    const extra: readonly string[] | undefined = additionalEnumMembers[definition.id];

    return extra === undefined ? definition : { ...definition, values: [...definition.values, ...extra] };
  });
}
