/**
 * What each type still rejects of the game, measured on 4.4.6 over 23,021
 * definitions.
 *
 * Regenerated with `npm run verify:types -- --report`. Vanilla is not authored
 * through this library, so some of this will never reach zero: a `.gui` file
 * has case-insensitive keys and inline `@constant` declarations, and a cwt
 * literal union is a list someone wrote down that the game has since added to.
 * A ceiling, never a target, and per type so a new hole cannot hide behind a
 * fix somewhere else.
 *
 * `main` measures 5,331 over the same corpus; this measures 1,182. Both are the
 * same on every run.
 */
export const BUDGET: Readonly<Record<string, number>> = {
  ai_budget: 13,
  anomaly_category: 248,
  bitmapfont_override: 54,
  citizenship_type: 1,
  component_template: 9,
  component_template_starbase: 1,
  cosmic_storm_mission: 3,
  decision: 27,
  diplomacy_economy: 2,
  fallen_empire_initializer: 25,
  game_rule: 1,
  gui_type: 35,
  job: 2,
  megastructure: 1,
  message_type: 5,
  named_color: 88,
  opinion_modifier: 9,
  particle_type: 457,
  planet_class: 1,
  pop_faction: 21,
  prescripted_country: 1,
  resolution_category: 1,
  ship_behavior: 3,
  ship_of_size_limit: 1,
  ship_size: 60,
  situation_type: 3,
  social_strata: 6,
  sound_category: 3,
  sound_falloff: 3,
  starbase_building: 15,
  starbase_level: 10,
  starbase_module: 32,
  starbase_type: 5,
  war_goal: 9,
  zones: 27,
};
