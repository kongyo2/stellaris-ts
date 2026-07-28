import type { ModifierNamespace, ModifierTemplate } from "./ir.js";

/**
 * Modifiers the newest `-debug` dump predates.
 *
 * The dump is a snapshot of one build. When the installed game is newer, script
 * it ships can name modifiers that build introduced, and no rule factored out of
 * an older dump will produce them.
 *
 * Only whole families are added here, never single names. A family is admitted
 * when several distinct definitions of one type all take the same shape, which
 * is what a generated modifier looks like and what a typo does not. Adding names
 * one at a time would make `verify:conformance` agree with whatever vanilla
 * happens to contain, and it would stop being a check.
 *
 * See [[modifiers.ts]] for the generated part, which this only adds to.
 */
export const additionalModifierTemplates: readonly ModifierTemplate[] = [
  // `common/colony_types` and `common/buildings` in 4.4 write
  // `artisan_jobs_bonus_workforce_mult`, `foundry_jobs_...`, `trader_jobs_...`
  // and a dozen more: one per job, none of them in the 4.3.7 dump.
  { type: "job", prefix: "", suffix: "_jobs_bonus_workforce_mult" },
];

/**
 * Modifiers the game carries that neither the dump nor a rule accounts for.
 *
 * Each one is a name vanilla uses in more than one place and localises, which
 * makes it real; it is listed rather than generated because nothing generates
 * it. The list stays short by construction — anything with a shape belongs in
 * `additionalModifierTemplates` instead.
 */
export const additionalBaseModifiers: readonly string[] = [
  // 4.4 splits workforce bonuses across two composite pop categories that
  // `common/pop_categories` does not declare.
  "specialist_and_complex_drone_cat_bonus_workforce_mult",
  "worker_and_simple_drone_cat_bonus_workforce_mult",
];

export function withModifierCorrections(namespace: ModifierNamespace): ModifierNamespace {
  return {
    source: namespace.source,
    base: [...namespace.base, ...additionalBaseModifiers],
    templates: [...namespace.templates, ...additionalModifierTemplates],
  };
}
