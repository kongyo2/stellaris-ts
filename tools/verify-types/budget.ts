/**
 * What each type still rejects of the game, measured on 4.4.6 over 31,397
 * definitions.
 *
 * Regenerated with `npm run verify:types -- --report`. Vanilla is not authored
 * through this library, so some of this will never reach zero: a `.gui` file
 * has case-insensitive keys and inline `@constant` declarations, and a cwt
 * literal union is a list someone wrote down that the game has since added to.
 * A ceiling, never a target, and per type so a new hole cannot hide behind a
 * fix somewhere else.
 *
 * `main` measures 13,771 over the same corpus; this measures 7,728. Both are
 * the same on every run.
 */
export const BUDGET: Readonly<Record<string, number>> = {
  ai_budget: 13,
  anomaly_category: 248,
  bitmapfont: 399,
  bitmapfont_override: 400,
  citizenship_type: 1,
  component_template: 9,
  component_template_starbase: 1,
  cosmic_storm_mission: 3,
  decision: 27,
  diplomacy_economy: 2,
  empire_name_format: 167,
  empire_name_parts_list: 233,
  fallen_empire_initializer: 25,
  game_rule: 1,
  gui_type: 35,
  job: 2,
  megastructure: 1,
  message_type: 5,
  model_animation: 386,
  model_entity: 1,
  model_mesh: 371,
  music: 30,
  named_color: 88,
  opinion_modifier: 9,
  particle_type: 455,
  piechart: 400,
  planet_class: 10,
  planet_class_random_list: 69,
  pop_faction: 21,
  pop_faction_name_format: 167,
  pop_faction_name_parts_list: 233,
  portrait: 71,
  pre_communications_name_format: 167,
  pre_communications_name_parts_list: 233,
  prescripted_country: 1,
  progressbartype: 397,
  resolution_category: 1,
  ship_behavior: 3,
  ship_of_size_limit: 1,
  ship_size: 60,
  situation_type: 3,
  social_strata: 6,
  sound: 164,
  sound_category: 395,
  sound_effect: 270,
  sound_falloff: 399,
  sound_master_compressor: 400,
  sound_music_compressor: 400,
  sprite: 56,
  starbase_building: 15,
  starbase_level: 10,
  starbase_module: 32,
  starbase_type: 5,
  swapped_civic: 391,
  war_goal: 9,
  war_name_format: 167,
  war_name_parts_list: 233,
  zones: 27,
};
