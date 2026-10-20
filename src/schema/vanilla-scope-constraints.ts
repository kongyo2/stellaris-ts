/**
 * Scopes a command accepts that the newest `-debug` dump does not mention.
 *
 * Where vanilla's own script uses a command in a scope the dump does not list,
 * the game is the later witness. Both tables are empty while the dump is 4.5.1:
 * the four entries the 4.3.7 dump needed — 4.4 made a carrier ship an empire's
 * capital and its colony, so `is_capital`, `is_colony`,
 * `planet_resource_compare` and `set_graphical_culture` read a ship — are all
 * in it now.
 *
 * Only ever *adds* scopes. Narrowing on this evidence would be wrong in the
 * other direction — a scope vanilla happens not to use is not a scope the game
 * refuses.
 */
export const additionalTriggerScopes: Readonly<Record<string, readonly string[]>> = {};

export const additionalEffectScopes: Readonly<Record<string, readonly string[]>> = {};
