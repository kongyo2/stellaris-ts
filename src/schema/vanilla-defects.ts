/**
 * Keys vanilla writes that are not keys of anything.
 *
 * Lines the game reads and drops. There is one, and finding it took checking
 * every candidate: the six `static_modifier` ids that used to be listed here
 * turned out to be a construct rather than a mistake — a static modifier's id
 * inside a modifier block merges its contents in, and vanilla does it 66 times
 * across the galactic community, cosmic storms and relay networks. The two
 * `senate_*_council_member_speed_mult` modifiers in
 * common/resolutions/05_resolutions_nomads.txt were listed as well, until the
 * modifier dump moved past 4.3.7: the game has carried both since 4.4.
 *
 * They are listed here rather than turned into rules because a rule would teach
 * the checker that the key is fine, and a modder copying the pattern would get
 * no warning. Listing them by name also means the next one still fails.
 */
export const vanillaFieldDefects: Readonly<Record<string, readonly string[]>> = {
  // common/name_lists/MACHINE3.txt names an army type that does not exist: the
  // army is `perfected_clone_army`, and the prefix is doubled. The sequential
  // name it carries is never used.
  "name_list.army_names": ["perfected_perfected_clone_army"],
};

/**
 * Values vanilla writes that are not values of anything.
 *
 * Three typos in asset files, each in a numeric field: a stray semicolon, a
 * doubled decimal point, and two letters of a note left on the end of a volume.
 * The game reads what it can of each and carries on, which is why they have
 * survived.
 */
export const vanillaValueDefects: Readonly<Record<string, readonly string[]>> = {
  // gfx/models/ships/colossus/aquatic_01/aquatic_01_colossus.asset: `scale = 1;`
  "model_entity.scale": ["1;"],
  // gfx/models/effects/cosmic_storms: `uv_animation_speed = .0.2`
  "model_entity.game_data.uv_animation_speed": [".0.2"],
  // sound/guardians/guardians.asset: `volume = 0.8dw`
  "sound_effect.volume": ["0.8dw"],
};

/** Whether a value is a known mistake in the base game rather than a narrow rule. */
export function isVanillaValueDefect(type: string, path: string, field: string, value: string): boolean {
  const site: string = path.length === 0 ? `${type}.${field}` : `${type}.${path}.${field}`;
  return (vanillaValueDefects[site] ?? []).includes(value);
}

/**
 * Whether a key is a known mistake in the base game rather than a hole here.
 *
 * Keyed by type, or by `type.path` for one nested inside a definition.
 */
export function isVanillaDefect(type: string, field: string, path = ""): boolean {
  const site: string = path.length === 0 ? type : `${type}.${path}`;
  return (vanillaFieldDefects[site] ?? []).includes(field);
}

/**
 * Strings vanilla names that no localisation file of the game defines.
 *
 * Each is shown in game as its own key — an event titled
 * `grand_archive.8530.name`, a greeting that reads `PRE_FTL_UNAWARE_GREETING_03`.
 * They are vanilla's mistakes rather than rules that read a value wrongly: the
 * values under those keys are strings' names everywhere else, and a mod naming
 * a string it never wrote under the same key is making the same mistake.
 * Listed by key, per type, so that a new one still fails the gate.
 */
export const vanillaUnlocalisedReferences: Readonly<Record<string, readonly string[]>> = {
  card_categories: ["FOCUS_CARD_TYPE_CORE_DESC"],
  diplo_phrase: [
    "01_DOW_VOTE_PROPOSE",
    "A_DOW_ACCEPT_04",
    "BW_MAKE_RIVAL_HOSTILE",
    "CORP_ASK_FOR_VASS_SELECT_01",
    "HM_DOW_VOTE_PROPOSE",
    "PRE_FTL_UNAWARE_GREETING_03",
    "PRE_FTL_UNAWARE_GREETING_04",
    "PRE_FTL_UNAWARE_GREETING_05",
    "PRE_FTL_UNAWARE_MATERIALIST_GREETING_01",
    "PRE_FTL_UNAWARE_MATERIALIST_GREETING_02",
    "PRE_FTL_UNAWARE_MATERIALIST_GREETING_03",
    "PRE_FTL_UNAWARE_SPIRITUALIST_GREETING_01",
    "PRE_FTL_UNAWARE_SPIRITUALIST_GREETING_02",
    "PRE_FTL_UNAWARE_SPIRITUALIST_GREETING_03",
    "S_ASK_TO_BE_RELEASED_SUBJECT_REFUSE",
    "S_LEAVE_ACCEPT",
  ],
  // common/ethics/00_ethics.txt: eight `desc = FROM_OVERLORD` in attraction modifiers.
  ethos: ["FROM_OVERLORD"],
  event: ["NAME_Hold_the_line_habitat", "cetana_desc", "grand_archive.8530.name"],
  leader_class: ["envoy_description", "envoy_plural"],
  megastructure: ["arc_furnace_tooltip", "habitat_tooltip"],
  scripted_effect: ["cetana_desc"],
  starbase_module: ["allows_nanites_collection"],
  static_modifier: ["nomads_waystation_weapon_damage_tt"],
};

/** Whether a string a vanilla definition names is a known gap in the base game's localisation. */
export function isVanillaUnlocalisedReference(type: string, key: string): boolean {
  return (vanillaUnlocalisedReferences[type] ?? []).includes(key);
}

/**
 * Vanilla definitions that lack a string their type asks of every definition.
 *
 * A handful per type, against hundreds that have it: a test perk
 * (`temp_remove`), a dummy tradition category, two DLC species classes, the
 * AI's own component sets. The requirement holds for the rest of vanilla and is
 * kept, so that a mod's definition still gets the warning; these are listed by
 * id so that a new gap still fails the gate. Where vanilla commonly lacks a
 * string, the requirement is what changed instead — see the variants that
 * scope `concept`, `situation_type`, `trait` and `tradition_swap`.
 */
export const vanillaUnlocalisedDefinitions: Readonly<Record<string, readonly string[]>> = {
  ai_personality: ["galactic_defense_force"],
  component_set: [
    "AI_STRIKE_CRAFT_1",
    "OBSERVATORY_1",
    "OBSERVATORY_2",
    "OBSERVATORY_3",
    "OBSERVATORY_4",
    "PLANET_KILLER_1",
    "aura_components",
    "battleship_combat_computers",
    "corvette_combat_computers",
    "cruiser_combat_computers",
    "destroyer_combat_computers",
    "dsc_aura_components",
    "ftl_components_bio",
    "paladin_crest",
    "sensor_components_bio",
    "station_large_aura_components",
    "station_medium_aura_components",
    "station_small_aura_components",
  ],
  federation_perk: ["hostile", "neutral", "temp_remove"],
  planet_class: ["pc_crystal_habitat", "pc_warden_guardian"],
  scripted_modifier: [
    "job_augmentor_trade_value_add",
    "job_healthcare_pop_assembly_organic_add",
    "mining_district_buildings_add",
    "trade_from_trait_mult",
  ],
  species_class: ["BIOGENESIS_01", "SOLARPUNK"],
  starbase_building: ["nanite_harvester"],
  starbase_module: ["solar_panel_network", "waystation_logistics_hub"],
  subject_specialist_type: ["any"],
  swapped_civic: [
    "civic_hive_devouring_swarm_lithoid_nomadic",
    "civic_hive_subspace_ephapse_fircon",
    "civic_hive_wilderness_natural_design",
    "origin_storm_chasers_nomadic",
  ],
  tradition_category: ["tradition_dummy"],
  tradition_swap: ["tr_synthetics_finish_machine"],
};

/** Whether a vanilla definition's missing string is a known gap in the base game. */
export function isVanillaUnlocalisedDefinition(type: string, id: string): boolean {
  return (vanillaUnlocalisedDefinitions[type] ?? []).includes(id);
}

/**
 * Commands vanilla writes where nothing hands them a scope.
 *
 * One, found by reading each generic event in the scope the game fires it in.
 * `origin.5045` is fired by `on_mid_game_pulse` alone, which the game fires
 * with no scope at all, and its trigger guards against firing twice with
 * `NOT = { has_country_flag = cost_of_freedom_chain }`: a country flag read on
 * nothing, so the guard never holds. Keyed by type, then `path command`.
 */
export const vanillaScopeDefects: Readonly<Record<string, readonly string[]>> = {
  event: ["trigger.NOT has_country_flag"],
};

/** Whether a command written in the wrong scope is a known mistake in the base game. */
export function isVanillaScopeDefect(type: string, path: string, command: string): boolean {
  return (vanillaScopeDefects[type] ?? []).includes(`${path} ${command}`);
}
