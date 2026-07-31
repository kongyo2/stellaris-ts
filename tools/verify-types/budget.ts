/**
 * What each type still rejects of the game, measured on 4.4.6.
 *
 * Regenerated with `npm run verify:types -- --report`. Vanilla is not authored
 * through this library, so some of this will never reach zero: a `.gui` file
 * has case-insensitive keys and inline `@constant` declarations, and a cwt
 * literal union is a list someone wrote down that the game has since added to.
 * A ceiling, never a target, and per type so a new hole cannot hide behind a
 * fix somewhere else.
 *
 * Over the same 8,522 definitions, `main` measures 2,925 and this measures
 * 1,532. Three runs of each gave the same number; at a larger sample the
 * compiler stopped answering the same way twice, which is why the sample is
 * what it is.
 */
export const BUDGET: Readonly<Record<string, number>> = {
  ai_budget: 5,
  anomaly_category: 50,
  bitmapfont: 60,
  bitmapfont_override: 60,
  citizenship_type: 1,
  component_template: 1,
  component_template_starbase: 1,
  cosmic_storm_mission: 2,
  decision: 18,
  diplomacy_economy: 2,
  empire_name_format: 60,
  fallen_empire_initializer: 25,
  gui_type: 13,
  model_animation: 50,
  model_mesh: 60,
  music: 30,
  named_color: 60,
  opinion_modifier: 3,
  particle: 46,
  particle_type: 90,
  piechart: 60,
  planet_class: 5,
  planet_class_random_list: 55,
  pop_faction: 21,
  pop_faction_name_format: 60,
  portrait: 37,
  pre_communications_name_format: 60,
  prescripted_country: 1,
  progressbartype: 60,
  resolution_category: 1,
  ship_behavior: 3,
  ship_of_size_limit: 1,
  ship_size: 3,
  social_strata: 6,
  sound: 41,
  sound_category: 57,
  sound_effect: 49,
  sound_falloff: 60,
  sound_master_compressor: 60,
  sound_music_compressor: 60,
  sprite: 7,
  starbase_building: 10,
  starbase_level: 10,
  starbase_module: 26,
  starbase_type: 5,
  swapped_civic: 57,
  war_goal: 3,
  war_name_format: 60,
  zones: 17,
};
