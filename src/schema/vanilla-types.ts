import { block, defineType, field, item, keyedBlocks, occurs, primitive, triggerEntries, typeRef } from "./ir.js";
import type { BlockValue, DefinitionType } from "./ir.js";

/**
 * A list of portraits: each word is a portrait, or a portrait group.
 *
 * The game checks a set's `portraits` against one table (`0x4482f0` in the
 * 4.5.2 executable, scanning the list at `+0x1d48` of the portrait database),
 * and that table holds both: every `portrait_groups` entry as it is read
 * (`0xef5ab0`), and one more for each portrait once every file is in
 * (`0xef7780`). Of the 420 names the base game's sets write, 363 are portraits
 * and 56 are groups.
 */
function portraitList(): BlockValue {
  return block([item(typeRef("portrait"), occurs.any), item(typeRef("portrait_group"), occurs.any)]);
}

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

  /**
   * `common/portrait_sets` is where a species class gets its portraits. A
   * species class used to list them itself, and since 4.0 its reader takes
   * none of those keys: a class nothing here names has no portrait at all.
   *
   * The six keys are the ones the set's reader takes (`0x447e80`,
   * `species_portrait_set.cpp`), and the three inside `conditional_portraits`
   * the ones its reader does (`0xa30e10`); anything else is an `Unexpected
   * token` in the log. `playable` and `randomizable` are conditions with no
   * scope, read as yes, no or a trigger.
   */
  defineType({
    id: "portrait_set",
    source: keyedBlocks("common/portrait_sets"),
    variants: [],
    localisation: [],
    modifiers: [],
    entries: [
      field("species_class", typeRef("species_class"), occurs.one, {
        documentation:
          'The species class the portraits belong to. A set that names none, or one that does not exist, is logged as one that "doesn\'t reference a valid species class" and is left out of every category.',
      }),
      field("portraits", portraitList(), occurs.optional, {
        documentation: "Portraits the species class has under no condition.",
      }),
      field(
        "conditional_portraits",
        block([
          field("randomizable", primitive("boolean"), occurs.optional),
          field("randomizable", block([triggerEntries()]), occurs.optional, {
            documentation: "Whether a randomly generated species may take one of these. Yes when left out.",
          }),
          field("playable", primitive("boolean"), occurs.optional),
          field("playable", block([triggerEntries()]), occurs.optional, {
            documentation: "Whether the empire designer offers these. Yes when left out.",
          }),
          field("portraits", portraitList(), occurs.optional),
        ]),
        occurs.any,
        { documentation: "Portraits the species class has when their conditions hold." },
      ),
      field("non_randomized_portraits", portraitList(), occurs.optional, {
        documentation: "Portraits no randomly generated empire takes.",
      }),
      field("non_pre_ftl_portraits", portraitList(), occurs.optional, {
        documentation: "Portraits no pre-FTL empire takes.",
      }),
      field("uplifted_portraits", portraitList(), occurs.optional, {
        documentation:
          "The portrait each of `portraits` becomes when the species is uplifted, in the same order: the first for the first.",
      }),
    ],
  }),

  /**
   * `common/portrait_categories` groups portrait sets into the tabs of the
   * empire designer. Its reader takes two keys (`0x44e1b0`,
   * `species_portrait_category.cpp`): `name`, the tab's string, and `sets`,
   * each of which it looks up among the portrait sets as it reads the list.
   */
  defineType({
    id: "portrait_category",
    source: keyedBlocks("common/portrait_categories"),
    variants: [],
    localisation: [],
    modifiers: [],
    entries: [
      field("name", primitive("localisation"), occurs.optional, {
        documentation: "The key of the string the empire designer heads the category with.",
      }),
      field("sets", block([item(typeRef("portrait_set"), occurs.any)]), occurs.optional, {
        documentation: "The portrait sets shown in the category, in order.",
      }),
    ],
  }),
];
