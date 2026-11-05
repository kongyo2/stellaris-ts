/**
 * Scopes a command accepts that the newest `-debug` dump does not mention.
 *
 * Where vanilla's own script uses a command in a scope the dump does not list,
 * vanilla is the witness that the game takes it there. The four entries the
 * 4.3.7 dump needed — 4.4 made a carrier ship an empire's capital and its
 * colony, so `is_capital`, `is_colony`, `planet_resource_compare` and
 * `set_graphical_culture` read a ship — are all in the 4.5.1 dump now.
 *
 * Only ever *adds* scopes. Narrowing on this evidence would be wrong in the
 * other direction — a scope vanilla happens not to use is not a scope the game
 * refuses.
 */
export const additionalTriggerScopes: Readonly<Record<string, readonly string[]>> = {};

export const additionalEffectScopes: Readonly<Record<string, readonly string[]>> = {
  // The 4.5.1 dump gives `colony` alone, and vanilla 4.5.2 fires it from a
  // planet twelve times in four files — `capital_scope = { colony_event = {
  // id = aquatics.150 ... } }` in events/aquatics_events.txt, and in
  // observation_events, shroud_situation_events and situation_events.
  colony_event: ["planet"],
};
