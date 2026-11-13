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
export const additionalModifierTemplates: readonly ModifierTemplate[] = [];

/**
 * Modifiers the game carries that neither the dump nor a rule accounts for.
 *
 * Each one is a name vanilla uses in more than one place and localises, which
 * makes it real; it is listed rather than generated because nothing generates
 * it. The list stays short by construction — anything with a shape belongs in
 * `additionalModifierTemplates` instead.
 *
 * Both lists are empty. They held `<job>_jobs_bonus_workforce_mult` as a rule
 * and the two `…_cat_bonus_workforce_mult` names, which no dump lists because
 * they are not modifiers: each is a static modifier of
 * `common/static_modifiers/24_static_modifiers_jobs.txt`, and a modifier block
 * takes a static modifier's name as a key (see `SchemaResolver`). Read as a
 * rule, they promised a modifier for every job a mod adds and refused the
 * static modifiers a mod writes the same way.
 */
export const additionalBaseModifiers: readonly string[] = [];

export function withModifierCorrections(namespace: ModifierNamespace): ModifierNamespace {
  return {
    source: namespace.source,
    base: [...namespace.base, ...additionalBaseModifiers],
    templates: [...namespace.templates, ...additionalModifierTemplates],
  };
}
