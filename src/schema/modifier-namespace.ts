import type { ModifierNamespace } from "./ir.js";

/**
 * Resolves which modifier names exist.
 *
 * A modifier name is either fixed in the executable or generated from a
 * definition, so the set depends on what is defined. It is computed rather than
 * listed: a mod that adds a job called `my_job` gets `job_my_job_add` for free,
 * exactly as the game does, and a name that no rule produces is a typo the game
 * would silently ignore.
 *
 * Names are compared lowercased. The game does not distinguish case here —
 * vanilla itself writes `COUNTRY_NAVAL_COVERAGE_MULT` for the modifier the
 * documentation calls `country_naval_coverage_mult`.
 */
export function expandModifierNames(
  namespace: ModifierNamespace,
  idsByType: Readonly<Record<string, readonly string[]>>,
  extra: readonly string[] = [],
): ReadonlySet<string> {
  const names = new Set<string>();

  for (const name of namespace.base) {
    names.add(name.toLowerCase());
  }

  for (const template of namespace.templates) {
    const ids: readonly string[] = idsByType[template.type] ?? [];

    for (const id of ids) {
      names.add(`${template.prefix}${id}${template.suffix}`.toLowerCase());
    }
  }

  for (const name of extra) {
    names.add(name.toLowerCase());
  }

  return names;
}

/** Merges identifier tables, so a mod's own definitions generate modifiers too. */
export function mergeIdsByType(
  ...tables: readonly Readonly<Record<string, readonly string[]>>[]
): Readonly<Record<string, readonly string[]>> {
  const merged: Record<string, string[]> = {};

  for (const table of tables) {
    for (const [type, ids] of Object.entries(table)) {
      const bucket: string[] = merged[type] ?? [];

      for (const id of ids) {
        bucket.push(id);
      }
      merged[type] = bucket;
    }
  }

  return merged;
}
