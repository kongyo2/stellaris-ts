import type { EffectsByScope, ScopeName, TriggersByScope } from "../generated/types/scopes.js";

/**
 * The scope-typed view of triggers and effects.
 *
 * A trigger is legal in some scopes and not others — `has_country_flag` reads a
 * country, `is_colony` reads a planet — and writing one where it does not belong
 * is a line the game evaluates as false for ever. These interfaces carry that
 * from the game's own `-debug` documentation, so `TriggersFor<"planet">`
 * completes with what a planet accepts.
 *
 * A command the documentation does not constrain appears in every scope: absent
 * evidence is not evidence of absence, and narrowing on a guess would reject
 * script the game runs.
 */
export type { EffectsByScope, ScopeName, TriggersByScope };

/** The triggers one scope accepts, by name. */
export type TriggersFor<Scope extends ScopeName> = TriggersByScope[Scope];

/** The effects one scope accepts, by name. */
export type EffectsFor<Scope extends ScopeName> = EffectsByScope[Scope];
