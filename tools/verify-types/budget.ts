/**
 * What each type still rejects of the game, measured on 4.4.6 over 23,020
 * definitions.
 *
 * Regenerated with `npm run verify:types -- --report`. Vanilla is not authored
 * through this library, so some of this will never reach zero. A ceiling, never
 * a target, and per type so a new hole cannot hide behind a fix somewhere else.
 *
 * 5,331 two releases ago, 1,182 on the last, **57** now. Most of that fall was
 * four disagreements between this generator and the checker the library ships:
 * the generator narrowed `colour` and `scalar` to strings, required a key
 * inside every alternative of a block rather than one of them, and matched enum
 * members case-sensitively where the engine folds case. The checker enforced
 * none of it, so `verify:conformance` stayed green throughout and only the
 * compiler could see the difference.
 *
 * What is left is genuinely awkward: a definition written entirely as an
 * `inline_script` call has none of the fields its type requires
 * (`pop_faction`, `message_type`), and a few enums the corpus lists as names
 * take a number or a `value:` reference too.
 */
export const BUDGET: Readonly<Record<string, number>> = {
  component_template: 1,
  diplomacy_economy: 2,
  game_rule: 1,
  message_type: 5,
  opinion_modifier: 6,
  particle_type: 2,
  pop_faction: 21,
  resolution_category: 1,
  ship_of_size_limit: 1,
  sound_category: 3,
  sound_falloff: 3,
  starbase_building: 5,
  starbase_module: 5,
  war_goal: 1,
};
