import { anyValue, block, field, item, occurs, primitive } from "./ir.js";
import type { DefinitionType, EntryRule, ValueRule } from "./ir.js";

/**
 * Keys the ported corpus declares that the game's own reader does not take.
 *
 * A definition is read by a function of the executable that switches on the
 * key: `Read(this, reader, keyId)`, slot 4 of the class's vtable, called once
 * per key by the generic loop in slot 3 (`0x50dc70`). A key the switch has no
 * case for goes to `0x1bac460`, which records `Unexpected token`, and the
 * loop's caller writes that to `error.log` with the file and the line
 * (`0x1bab900`, `persistent.cpp:41`). The key and whatever it held are then
 * skipped.
 *
 * So a rule for such a key accepts script the game drops. Each entry below is
 * a key no case of the 4.5.2 reader named beside it takes — found by following
 * the switch for every one of the 10,004 keywords the executable registers —
 * and that the base game writes nowhere, which is the other half of the
 * evidence: the base game loads without one `Unexpected token`.
 *
 * A dotted name is a key inside a block: `option.name` is `name` in `option`,
 * and `*` the block under a key that is no literal, as each stage of a
 * situation is written under its own name.
 */
export const unreadFields: Readonly<Record<string, readonly string[]>> = {
  // `0x40f6b0`, `job_type.cpp`. These four are not keywords of the executable
  // at all, so no reader can take them.
  job: ["clothes_texture_index", "demotion", "pop_modifier", "promotion"],
  // `0x404770`. Not a keyword either.
  leader_class: ["can_research"],
  // `0x319da0`.
  message_type: ["auto_opens", "default_disabled"],
  // `0x3ed500`, `namelist.cpp`.
  name_list: ["language", "ruler_names"],
  // `0xd332c0`.
  planet_class: ["allowed_archetypes", "outliner_planet_type", "tile_set"],
  // `0x518210`. 4.5 took `parameters` out of every pop faction type, and out
  // of the reader with them.
  pop_faction: ["parameters"],
  // `0x51f4f0`, `empire_design.cpp`.
  prescripted_country: ["flags"],
  // `0xd26c70`, `ship_size.cpp`.
  ship_size: ["custom_state_loc_prefix", "hero_ship_fleet_background", "is_hero_ship"],
  // `0x4e21a0`, the reader of one stage: 14 keys, and no `potential`. None of
  // the base game's 259 stages writes one.
  situation_type: ["stages.*.potential"],
  // `0x409c70`, `pop_category.cpp`. All but the last two are not keywords.
  social_strata: [
    "assign_to_pop",
    "clothes_texture_index",
    "custom_demotion_icon",
    "custom_demotion_loc",
    "custom_promotion_icon",
    "custom_promotion_loc",
    "demotion_time",
    "display_unemployment",
    "keep_from_former_job",
    "unemployment_resources",
    "should_apply_unemployment_penalties",
    "unemployment_penalties",
  ],
  // `0x5407a0`. `collects_trade` is not a keyword.
  starbase_level: ["collects_trade", "portrait", "special_construction"],
  // `0x423dd0`, `technology.cpp`.
  technology: ["ai_update_type"],
  // `0x4eac20`, `trait.cpp`. The first three are not keywords. `negative`,
  // which the corpus declares and the base game writes nowhere either, stays:
  // the reader compares against its id inside one of its cases.
  trait: [
    "assist_research_planet_modifier",
    "potential_crossbreeding_chance",
    "species_potential_remove",
    "ai_categories",
    "councilor_trait",
    "destiny_background_icon",
    "destiny_trait",
    "is_councilor_trait_for_ruler",
    "subclass_background_icon",
    "subclass_trait",
    "valid_for_all_ethics",
    "valid_for_all_origins",
    "veteran_class_locked_trait",
  ],
  // `0x5435b0`.
  war_goal: ["hide_if_no_cb", "show_claims_in_description"],
  // `0x440aa0`, `species_class.cpp`: 23 keys. A species class listed its
  // portraits itself until 4.0 moved them to `common/portrait_sets`, and
  // `custom_portraits` is not even a keyword of the executable any more.
  species_class: [
    "custom_portraits",
    "modifier",
    "non_pre_ftl_portraits",
    "non_randomized_portraits",
    "portraits",
    "uplifted_portraits",
  ],
};

/**
 * Where what a retired key said is said now, for the keys that moved rather
 * than went: appended to the report of the key as unknown, by `type.key`.
 */
export const movedFields: Readonly<Record<string, string>> = {
  "species_class.portraits":
    "Since 4.0 a species class gets its portraits from a portrait_set that names it: define one in common/portrait_sets, and list it in a portrait_category for the empire designer to show.",
  "species_class.custom_portraits":
    "Since 4.0 this is conditional_portraits in a portrait_set that names the species class.",
  "species_class.non_randomized_portraits":
    "Since 4.0 this is non_randomized_portraits in a portrait_set that names the species class.",
  "species_class.non_pre_ftl_portraits":
    "Since 4.0 this is non_pre_ftl_portraits in a portrait_set that names the species class.",
  "species_class.uplifted_portraits":
    "Since 4.0 this is uplifted_portraits in a portrait_set that names the species class.",
};

function without(entries: readonly EntryRule[], paths: readonly (readonly string[])[]): readonly EntryRule[] {
  const out: EntryRule[] = [];

  for (const entry of entries) {
    if (entry.kind === "variant-rules") {
      out.push({ ...entry, entries: without(entry.entries, paths) });
      continue;
    }

    if (entry.kind !== "field") {
      out.push(entry);
      continue;
    }

    // `*` steps into the block under a key that is no literal.
    const key: string = typeof entry.key === "string" ? entry.key : "*";
    const here: readonly (readonly string[])[] = paths.filter((path) => path[0] === key);

    if (here.some((path) => path.length === 1)) {
      continue;
    }

    const inside: readonly (readonly string[])[] = here.map((path) => path.slice(1));

    out.push(
      inside.length > 0 && entry.value.kind === "block"
        ? { ...entry, value: { ...entry.value, entries: without(entry.value.entries, inside) } }
        : entry,
    );
  }

  return out;
}

/** What a reader's case reads the value of a key with. */
export type ReadAs = "any" | "boolean" | "number" | "scalar" | "words";

/**
 * Keys the game's readers take that the ported corpus never declared.
 *
 * The other direction of the same comparison: a case of the reader's switch
 * with no rule here. The base game writes none of them, which is why reading
 * the base game never found them, and a mod that does was told the key is not
 * one. What a key is read as is taken from the first thing its case does —
 * the reader's own call for a yes or no (`0x1bb88d0`), a word (`0x1bae7f0`),
 * a number (`0x2a8960`) or a list of words (`0x162100`) — and anything else,
 * a block read by a reader of its own, is left open rather than guessed at.
 *
 * Left out: `combat_max_speed`, `combat_rotation_speed` and `empire_limit` of
 * a ship size, whose cases only log that the key was removed.
 */
export const readFields: Readonly<Record<string, Readonly<Record<string, ReadAs>>>> = {
  // `0x5700a0`
  agreement_term_value: { subject_tech_cost_mult: "any" },
  // `0xb3dd20`
  ai_personality: { species_mod_priority: "any" },
  // `0xd226b0`, `ambient_object_database.cpp`
  ambient_object: { tag: "scalar" },
  // `0x83f000`, `anomaly_type.cpp`
  anomaly_category: { hard_level_requirement: "boolean", tooltip: "any" },
  // `0x42e520`, `army_type.cpp`
  army: { built_for_ruler: "boolean", on_built: "any" },
  // `0x4bd7c0`, `tradition_type.cpp`: one reader for traditions and ascension perks
  ascension_perk: { on_disabled: "any", unlocks_agenda: "any" },
  tradition: { on_disabled: "any", potential: "any" },
  // `0x4bced0`
  tradition_swap: { on_disabled: "any" },
  // `0x848ba0`
  asteroid_belt_type: { shader_file: "any" },
  // `0xd574f0`, `astral_rift.cpp`
  astral_rift: { situation_log_category: "any" },
  // `0x468a20`, `building_type.cpp`
  building: {
    abort_effect: "any",
    icon_frame: "number",
    is_colony: "any",
    triggered_waystation_network_country_modifier: "any",
    triggered_waystation_network_system_modifier: "any",
    waystation_network_country_modifier: "any",
    waystation_network_system_modifier: "any",
  },
  // `0x52fbe0`, `government_civic_type.cpp`
  civic_or_origin: { cost: "number", homeworld: "any" },
  // `0x44f7e0`, `colony_type.cpp`
  colony_type: {
    triggered_planet_pop_group_modifier_for_all: "any",
    triggered_planet_pop_group_modifier_for_species: "any",
  },
  // `0x3b5370`
  component_set: { affects_target_focus: "boolean" },
  // `0x7c8ff0`, `game_concept_type.cpp`
  concept: { texture: "scalar" },
  // `0x57bb50`, `mission_type.cpp`
  cosmic_storm_mission: {
    desc_issuer: "any",
    desc_operator: "any",
    on_fail: "any",
    on_start: "any",
    possible: "any",
    potential: "any",
    situation_log_category: "any",
    sound: "any",
  },
  // `0x5689c0`
  crisis_level: { required_menace: "any" },
  // `0x496f60`, `deposit_type.cpp`
  deposit: { all_terraforming_swap_types: "any", triggered_planet_pop_group_modifier_for_all: "any" },
  // `0x4b4a20`
  diplomatic_action: { on_propose: "any" },
  // `0x48ab10`, `district_type.cpp`
  district: {
    abort_effect: "any",
    abort_trigger: "any",
    custom_gui: "scalar",
    district_background: "scalar",
    district_width: "number",
    has_primary_zone: "any",
    icon_frame: "number",
    is_colony: "any",
    is_essential: "any",
    ruined_deposit: "any",
    triggered_planet_pop_group_modifier_for_all: "any",
    triggered_planet_pop_group_modifier_for_species: "any",
  },
  // `0x1657ee0`, `economic_category.cpp`
  economic_category: {
    ai_use_parent_for_resources_expenditure: "words",
    ai_use_parent_for_resources_logistics: "words",
    triggered_logistics_modifier: "any",
  },
  // `0x4a8a90`
  edict: { icon_frame: "any" },
  // `0x457220`, `ethic.cpp`
  ethos: { pop_group_modifier: "any" },
  // `0x82db50`
  federation_perk: { icon: "any", triggered_modifier: "any" },
  // `0x551d00`, `federation_type_database.cpp`
  federation_type: { background: "scalar" },
  // `0x554a20`, `galactic_focus.cpp`
  galactic_focus: { weight: "any" },
  // `0xd23050`, `ship_category.cpp`
  grand_archive_ship_category_type: { description: "any" },
  // `0x40f6b0`, `job_type.cpp`
  job: { triggered_system_modifier: "any" },
  // `0x404770`
  leader_class: { ai_weight_for_planet_assignment: "any" },
  // `0x1ab6540`, `assetfactory.cpp`
  model_entity: { attribute: "any", group: "any", preload_textures: "boolean", version: "any" },
  // `0x5801e0`, `mutation.cpp`
  mutations_type: { icon_frame: "number" },
  // `0x4d48d0`, `observation_station_missions.cpp`
  observation_station_mission: { country_modifier: "any", planet_modifier: "any" },
  // `0x3d14e0`, `opinion_modifier.cpp`
  opinion_modifier: { years: "number" },
  // `0xd332c0`, `planet_class.cpp`
  planet_class: {
    minerals: "any",
    moon_start_dist: "any",
    physics_research: "any",
    plane_offset: "any",
    random_weight: "any",
    society_research: "any",
    uses_preview_background: "any",
  },
  // `0x51f4f0`, `empire_design.cpp`
  prescripted_country: {
    disallow_editing: "boolean",
    ftl: "any",
    key: "scalar",
    observer: "boolean",
    random: "boolean",
    weapon: "any",
  },
  // `0x3ad010`, `strategic_resource.cpp`
  resource: { icon_frame: "any", potential: "any" },
  // `0x670140`, `section.cpp`
  section_template: { build_time: "any", max_hitpoints: "any" },
  // `0x1abd960`, `assetfactory_audio.cpp`
  sound: { pan: "any" },
  // `0x1abea00`
  sound_master_compressor: { enabled: "boolean" },
  // `0x4d9460`, `special_project_type.cpp`
  special_project: { energy: "any" },
  // `0x7a35f0`
  storm_type: {
    on_monthly: "any",
    triggered_country_modifier: "any",
    triggered_planet_pop_group_modifier_for_all: "any",
    triggered_planet_pop_group_modifier_for_species: "any",
  },
  // `0x52ec90`
  swapped_civic: { hide_modifiers: "boolean" },
  // `0x4eac20`, `trait.cpp`
  trait: {
    archetype_override: "any",
    forbidden_civics: "words",
    icon_frame: "number",
    modification: "any",
    triggered_background_planet_pop_group_modifier: "any",
    triggered_planet_pop_group_modifier_for_all: "any",
  },
  // `0x4861d0`
  zone_slots: { excluded_zone_sets: "any" },
};

function ruleFor(kind: ReadAs): ValueRule {
  switch (kind) {
    case "boolean":
      return primitive("boolean");
    case "number":
      return primitive("number");
    case "scalar":
      return primitive("scalar");
    case "words":
      return block([item(primitive("scalar"), occurs.any)]);
    default:
      return anyValue();
  }
}

/** Adds a rule for each key a reader takes and the type says nothing of. */
export function withReadFields(types: readonly DefinitionType[]): readonly DefinitionType[] {
  return types.map((type) => {
    const read: Readonly<Record<string, ReadAs>> | undefined = readFields[type.id];

    if (read === undefined) {
      return type;
    }

    const declared = new Set<string>();
    const collect = (entries: readonly EntryRule[]): void => {
      for (const entry of entries) {
        if (entry.kind === "variant-rules") {
          collect(entry.entries);
        } else if (entry.kind === "field" && typeof entry.key === "string") {
          declared.add(entry.key.toLowerCase());
        }
      }
    };
    collect(type.entries);

    const added: readonly EntryRule[] = Object.entries(read)
      .filter(([key]) => !declared.has(key.toLowerCase()))
      .map(([key, kind]) => field(key, ruleFor(kind), occurs.optional));

    return added.length === 0 ? type : { ...type, entries: [...type.entries, ...added] };
  });
}

/** Drops the rules for the keys the game's readers do not take. */
export function withoutUnreadFields(types: readonly DefinitionType[]): readonly DefinitionType[] {
  return types.map((type) => {
    const unread: readonly string[] | undefined = unreadFields[type.id];

    return unread === undefined
      ? type
      : {
          ...type,
          entries: without(
            type.entries,
            unread.map((name) => name.split(".")),
          ),
        };
  });
}
