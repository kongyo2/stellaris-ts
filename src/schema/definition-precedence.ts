import type { DefinitionType } from "./ir.js";
import { mergedDefinitionTypes } from "./merged-types.js";

/**
 * Which definition the game keeps when two share an id.
 *
 * A mod that defines an id twice, or an id the base game already uses, has
 * written two definitions and the game keeps one. Which one is not the same
 * everywhere, and the difference decides whether an override does anything.
 *
 * Read out of the 4.5.2 executable. Files of a directory are read in the byte
 * order of their names, whichever mod they come from: the listing is
 * stable-sorted by `std::string::compare` on the name (`0x99f420`, with the
 * comparison at `0x9a0040`), so `Z` sorts before `_`, and `_` before `a`.
 *
 * Most directories are read through one template, `game_singleobjectdatabase.h`.
 * Its loader (`0x466d00` for `common/bypass`) looks each key up, and for one
 * it already has calls the database's duplicate handler (`0x466b70`), which
 * logs `Object with key: %s already exists, using the one at %s`, destroys the
 * object in place and reads the new definition into it: the last one read is
 * the one that loads. The directory loader passes no flag that would silence
 * the line (`0x200b80`), so every override of this kind is in `error.log`.
 *
 * The event manager keeps the first instead and drops the rest: it logs `an
 * event with id [%s] already exists!` and deletes the event it has just read
 * (`0x3f3d30`). It would replace the old one were it asked to, and the loader
 * of the `events` directory never asks (`0x3f4b80` passes 0 for the flag).
 *
 * Six of those databases are of a class derived from the template, which puts
 * a handler of its own in the template's place: the same slot of the vtable
 * the database ends up with holds a function that, asked without the flag the
 * directory loader never sets, hands the second definition to the object the
 * first one made (`0xb54ca0` for `common/economic_plans`, calling the plan's
 * own reader on it) and logs nothing. Every field written again is read again
 * on top of what is there, and a field left out keeps what it had: a second
 * `basic_economy_plan` holding one `subplan` adds that subplan to the plan,
 * which is what the game's own `00_example.txt` says of the directory. The
 * template's handler is still in the executable for each of them, in the
 * vtable the constructor passes through on its way, which is how a list made
 * from the handlers alone counted them among the directories that replace.
 *
 * Any other type is read by a loader of its own, and nothing is said about
 * which of its definitions wins. The loader of section templates, component
 * sets and component templates (`0xd3a060`) shows why a message is not
 * enough to go by: it holds `duplicate section template found`, `A
 * compnent_set with the name "%s" already exists!` and `Component template
 * key used multiple times`, each of them logged as the new definition is
 * dropped — and its one caller (`0x91f7d0`) always sets the flag under which
 * the new definition is copied over the old instead, with none of the three.
 */
export type DefinitionPrecedence = "first" | "last" | "merged" | "overlaid" | "unknown";

/** The types whose loader keeps the first definition it reads, with the line it logs for a later one. */
export const firstDefinitionWins: Readonly<Record<string, string>> = {
  event: "an event with id [%s] already exists!",
};

/** What the generic database logs for a key it already has, before it reads the new definition over the old. */
export const LAST_DEFINITION_LOG = "Object with key: %s already exists, using the one at %s";

/**
 * The directories the executable reads through its generic database.
 *
 * Each instantiation of the template has its own duplicate handler, the
 * function that holds {@link LAST_DEFINITION_LOG}; the handler sits in the
 * database's vtable, and the constructor that installs the vtable names the
 * directory it reads. 161 handlers, walked from handler to vtable to
 * constructor. `common/ascension_perks` shares the traditions' instantiation
 * and `common/job_tags` the trait tags', so there are 162 directories.
 */
export const lastDefinitionWinsDirectories: readonly string[] = [
  "common/agreement_presets",
  "common/agreement_resources",
  "common/agreement_term_values",
  "common/agreement_terms",
  "common/ai_budget",
  "common/ai_espionage/operations",
  "common/ai_espionage/spynetworks",
  "common/ai_espionage/targets",
  "common/anomalies",
  "common/archaeological_site_types",
  "common/armies",
  "common/artifact_actions",
  "common/ascension_perk_categories",
  "common/ascension_perks",
  "common/asteroid_belts",
  "common/astral_actions",
  "common/astral_rifts",
  "common/attitudes",
  "common/bombardment_stances",
  "common/buildings",
  "common/button_effects",
  "common/bypass",
  "common/casus_belli",
  "common/cloaking_strength_levels",
  "common/colony_automation",
  "common/colony_automation_categories",
  "common/colony_automation_exceptions",
  "common/colony_types",
  "common/component_slot_templates",
  "common/council_agendas",
  "common/country_container",
  "common/country_customization",
  "common/country_focus/card_categories",
  "common/country_focus/focus_cards",
  "common/country_focus/focus_rewards",
  "common/country_limits/ship_of_size_limits",
  "common/country_types",
  "common/crisis_levels",
  "common/crisis_objectives",
  "common/crisis_paths",
  "common/decisions",
  "common/deposit_categories",
  "common/deposits",
  "common/diplomacy_economy",
  "common/diplomatic_actions",
  "common/districts",
  "common/dust_clouds",
  "common/dynamic_text",
  "common/economic_categories",
  "common/edicts",
  "common/espionage_assets",
  "common/espionage_operation_categories",
  "common/espionage_operation_types",
  "common/ethic_categories",
  "common/ethics",
  "common/event_chains",
  "common/federation_law_categories",
  "common/federation_laws",
  "common/federation_perks",
  "common/federation_types",
  "common/first_contact",
  "common/frontend_backgrounds",
  "common/galactic_community_actions",
  "common/galactic_focuses",
  "common/game_concept_categories",
  "common/game_concepts",
  "common/governments",
  "common/governments/civics",
  "common/governments/councilors",
  "common/greeting_overlay_sounds",
  "common/intel_categories",
  "common/intel_levels",
  "common/job_tags",
  "common/lawsuits",
  "common/leader_classes",
  "common/leader_tiers",
  "common/map_modes",
  "common/megastructure_overclock_types",
  "common/megastructures",
  "common/menace_perks",
  "common/missions/mission_categories",
  "common/missions/missions",
  "common/mutations",
  "common/named_colors",
  "common/notification_modifiers",
  "common/observation_station_missions",
  "common/patrons",
  "common/patrons/callings",
  "common/patrons/deeds",
  "common/patrons/psionic_auras",
  "common/personalities",
  "common/planet_modifiers",
  "common/policies",
  "common/policy_categories",
  "common/pop_categories",
  "common/pop_faction_types",
  "common/pop_jobs",
  "common/precursor_civilizations",
  "common/prescripted_flags",
  "common/relics",
  "common/resolution_categories",
  "common/resolution_groups",
  "common/resolutions",
  "common/resource_converters",
  "common/resource_regions",
  "common/script_values",
  "common/scripted_actions",
  "common/scripted_effects",
  "common/scripted_modifiers",
  "common/scripted_triggers",
  "common/sector_types",
  "common/ship_sets",
  "common/ship_sizes",
  "common/situation_log/categories",
  "common/situations",
  "common/specialist_subject_perks",
  "common/specialist_subject_types",
  "common/species_archetypes",
  "common/species_rights/citizenship_types",
  "common/species_rights/colonization_controls",
  "common/species_rights/living_standards",
  "common/species_rights/migration_controls",
  "common/species_rights/military_service_types",
  "common/species_rights/population_controls",
  "common/species_rights/purge_types",
  "common/species_rights/slavery_types",
  "common/species_rights/subspecies_integration_types",
  "common/specimens",
  "common/star_classes",
  "common/star_classes/randomizers",
  "common/starbase_buildings",
  "common/starbase_levels",
  "common/starbase_modules",
  "common/starbase_types",
  "common/storm_types",
  "common/system_tooltips",
  "common/system_types",
  "common/target_types",
  "common/technology",
  "common/technology/category",
  "common/technology/tier",
  "common/technology_ages/preftl",
  "common/timeline_events",
  "common/tradable_actions",
  "common/tradition_categories",
  "common/traditions",
  "common/trait_tags",
  "common/war_goals",
  "common/zone_slots",
  "common/zones",
  "dlc_metadata/dlc_recommendations",
  "gfx/portraits/sprite_configurations",
  "gfx/projectiles/planet_destruction",
  "interface/resource_groups",
  "map/galaxy",
  "sound/advisor_voice_types",
];

/**
 * The directories whose database reads a second definition of an id into the
 * first, with the handler that does it.
 *
 * Found by following each of the 161 template handlers to the vtables that
 * hold it and each of those to the functions that install it: a constructor
 * that goes on to store a second vtable has a class of its own, and these are
 * the six whose own vtable holds something else in the handler's slot. Each
 * of the six functions has the same two halves — read into the object that
 * exists, or destroy it, build it again and read — and the half is chosen by
 * the handler's last argument, which every one of the six per-file loaders
 * hands on from the directory loader (`0x200b80`) and that loader sets to zero.
 */
export const overlaidDefinitionDirectories: Readonly<Record<string, string>> = {
  "common/country_limits/ownership_limits": "0x43b080",
  "common/economic_plans": "0xb54ca0",
  "common/governments/authorities": "0x52d630",
  "common/portrait_categories": "0x44ea80",
  "common/portrait_sets": "0x44a960",
  "common/species_classes": "0x445d30",
};

const genericDirectories: ReadonlySet<string> = new Set(lastDefinitionWinsDirectories);

/** Which of two definitions of one id the game keeps, for a type. */
export function precedenceOf(type: Pick<DefinitionType, "id" | "source">): DefinitionPrecedence {
  if (mergedDefinitionTypes[type.id] !== undefined) {
    return "merged";
  }
  if (firstDefinitionWins[type.id] !== undefined) {
    return "first";
  }
  if (Object.hasOwn(overlaidDefinitionDirectories, type.source.directory)) {
    return "overlaid";
  }
  return genericDirectories.has(type.source.directory) ? "last" : "unknown";
}

/**
 * Whether a file is read before every one of the others, after every one, or
 * among them: `-1`, `1` or `0`.
 *
 * In the byte order the game sorts names by. A name the base game ships is
 * replaced by the mod's file of the same name, so it is not compared.
 */
export function readOrder(name: string, others: readonly string[]): -1 | 0 | 1 {
  let before = 0;
  let after = 0;

  for (const other of others) {
    if (other === name) {
      continue;
    }
    if (name < other) {
      before += 1;
    } else {
      after += 1;
    }
  }

  return after === 0 ? -1 : before === 0 ? 1 : 0;
}
