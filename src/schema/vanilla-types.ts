import { defineType, field, keyedBlocks, occurs, primitive, typeRef } from "./ir.js";
import type { DefinitionType } from "./ir.js";

/**
 * Definition types the game loads and the ported corpus has no entry for.
 *
 * These live outside `definitions/` because `npm run import:cwt -- --emit`
 * rewrites that directory wholesale, and a type added there would be one
 * re-import away from vanishing.
 */
export const vanillaDefinitionTypes: readonly DefinitionType[] = [
  /**
   * `common/missions/mission_categories` sorts contracts and gives each kind its
   * map and log icons. `cosmic_storm_mission` used to claim the whole of
   * `common/missions`, so these 15 definitions were read as missions and every
   * one of them reported five missing fields.
   */
  defineType({
    id: "mission_category",
    source: keyedBlocks("common/missions/mission_categories"),
    variants: [],
    localisation: [],
    modifiers: [],
    entries: [
      field("is_contract", primitive("boolean"), occurs.optional, {
        documentation: "Whether this is a contract rather than another kind of mission.",
      }),
      field("map_icon", typeRef("sprite"), occurs.optional, { documentation: "Icon shown on the galaxy map." }),
      field("log_icon", primitive("file"), occurs.optional, {
        documentation: "Icon shown in the situation log, as a file path.",
      }),
      field("show_in_issue_list", primitive("boolean"), occurs.optional, {
        documentation: "Whether the category heads the contract issue list. Contracts only.",
      }),
    ],
  }),
];
