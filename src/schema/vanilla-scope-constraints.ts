/**
 * Scopes a command accepts that the newest `-debug` dump does not mention.
 *
 * The dump is 4.3.7 and the installed game is 4.4.6. Where vanilla's own script
 * uses a command in a scope the dump does not list, the game is the later
 * witness: 4.4 made a carrier ship an empire's capital and its colony, so
 * `is_capital`, `is_colony` and `planet_resource_compare` read a ship now.
 *
 * Only ever *adds* scopes. Narrowing on this evidence would be wrong in the
 * other direction — a scope vanilla happens not to use is not a scope the game
 * refuses.
 */
export const additionalTriggerScopes: Readonly<Record<string, readonly string[]>> = {
  // events/nomads_events_1.txt: `any_owned_ship = { is_capital = no }`
  is_capital: ["ship"],
  // events/nomads_events_1.txt: `random_owned_ship = { limit = { is_colony = yes } }`
  is_colony: ["ship"],
  // events/shroud_events.txt: inside `random_owned_ship`
  planet_resource_compare: ["ship"],
};

export const additionalEffectScopes: Readonly<Record<string, readonly string[]>> = {
  // common/scripted_effects/nomads_effects.txt: inside `create_ship = { effect = { ... } }`
  set_graphical_culture: ["ship"],
};
