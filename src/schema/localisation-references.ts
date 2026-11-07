import type { ResolvedValue } from "./resolve.js";
import type { DefinitionType, LocalisationRequirement, VariantPredicate } from "./ir.js";

/**
 * Where a definition names a string, and whether the string exists.
 *
 * A definition names most of its text by key: an event's `title` and `desc`,
 * each option's `name`, a `custom_tooltip`, a trigger's `fail_text`, a stage of
 * a situation by the key it is written under. The game looks each one up when
 * it shows it and, when nothing defines the key, shows the key itself. It says
 * nothing at load for most of them, so a mod that ships `probe.10.desc` without
 * writing the string finds out from a screenshot.
 *
 * The lookup is exact. The 4.5.2 executable hashes the key's bytes with
 * MurmurHash3 (`0x1b430e0`, whose block loop reads each byte as it is) and
 * finds that hash in its localisation table (`0x1b9ad60`), so `Probe.10.Desc`
 * and `probe.10.desc` are two keys.
 */

/**
 * Whether a scalar written under a key with these rules names a localisation
 * key.
 *
 * Only when every rule that could read a scalar takes one: `name` in a
 * technology swap is a technology or a string, and naming either is fine. A
 * rule that only describes a block says nothing about a scalar written there —
 * an event's `desc` is a key or a `{ trigger text }` block, and a key written as
 * a scalar is still a key.
 */
export function namesLocalisation(values: readonly ResolvedValue[]): boolean {
  let names = false;

  for (const value of values) {
    switch (value.kind) {
      case "block":
      case "script-block":
      case "scripted-call":
      case "list":
      case "rule-set-reference":
        continue;
      case "primitive":
        if (value.type !== "localisation") {
          return false;
        }
        names = true;
        continue;
      default:
        return false;
    }
  }

  return names;
}

/**
 * The key a string names, or `undefined` when it names none the file can say.
 *
 * A value with a space in it is text rather than a key — the game shows a key
 * it cannot find as itself, so written text reaches the screen as written, and
 * a key never holds a space. `[Root.GetName]` is a command, `$NAME$` a parameter
 * and `@x`, `value:x` and `scope:x` stand for something only the game knows,
 * so none of those can be looked up here.
 */
export function localisationKeyIn(text: string): string | undefined {
  if (text.length === 0 || /\s/u.test(text)) {
    return undefined;
  }

  if (text.startsWith("@") || text.includes("$") || text.includes("[") || text.includes(":")) {
    return undefined;
  }

  return text;
}

/**
 * One occurrence of a definition's own field, as a variant predicate reads it.
 *
 * `never` is the trigger `{ always = no }`, which is how vanilla says a
 * definition can never be what the field asks: a name list written
 * `selectable = { always = no }` is not selectable, and a species class written
 * `playable = { always = no }` is not playable — 12 of vanilla's 16 name lists
 * with `selectable` and most of its unplayable classes say exactly that.
 */
export type FieldOccurrence =
  { readonly kind: "scalar"; readonly text: string } | { readonly kind: "block"; readonly never: boolean };

/** What a predicate needs to know about one definition. */
export interface VariantSubject {
  /** The key the definition is written under: the tag of a tagged type, the id otherwise. */
  readonly rootKey: string;
  /** Each occurrence of one of the definition's own fields, in order. */
  readonly occurrences: (field: string) => readonly FieldOccurrence[];
}

/** A boolean as script writes it, so `fieldEquals("hide_window", true)` matches `hide_window = yes`. */
function written(value: string | number | boolean): string {
  return typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
}

/**
 * Whether a definition is in a variant.
 *
 * Keys and values compare without case, as the game reads both here: vanilla
 * writes `is_capped_by_modifier = yes` and `YES` alike.
 */
export function variantHolds(predicate: VariantPredicate, subject: VariantSubject): boolean {
  switch (predicate.kind) {
    case "always":
      return true;
    case "all":
      return predicate.predicates.every((each) => variantHolds(each, subject));
    case "any":
      return predicate.predicates.some((each) => variantHolds(each, subject));
    case "not":
      return !variantHolds(predicate.predicate, subject);
    case "root-key":
      return predicate.values.some((value) => value.toLowerCase() === subject.rootKey.toLowerCase());
    case "field-presence": {
      // A field that can never hold is not one the definition has.
      const holds: boolean = subject
        .occurrences(predicate.field)
        .some((occurrence) => occurrence.kind === "scalar" || !occurrence.never);
      return holds === predicate.present;
    }
    case "field-never": {
      const occurrences = subject.occurrences(predicate.field);
      return (
        occurrences.length > 0 && occurrences.every((occurrence) => occurrence.kind === "block" && occurrence.never)
      );
    }
    case "field-equals": {
      const wanted: string = written(predicate.value).toLowerCase();
      return subject
        .occurrences(predicate.field)
        .some((occurrence) => occurrence.kind === "scalar" && occurrence.text.toLowerCase() === wanted);
    }
    default:
      return false;
  }
}

/**
 * Whether a requirement applies to one definition.
 *
 * A requirement scoped to a variant asks for its string only from the
 * definitions in that variant: a job needs `job_<id>_plural` when it can be
 * worked at all, and a situation needs `<id>_type` only when it writes no
 * `title` of its own. Applied to every definition, the 48 requirements that name
 * a variant asked for strings the game never shows.
 */
export function requirementApplies(
  type: DefinitionType,
  requirement: LocalisationRequirement,
  subject: VariantSubject,
): boolean {
  if (requirement.variant === undefined) {
    return true;
  }

  const variant = type.variants.find((candidate) => candidate.id === requirement.variant);
  return variant !== undefined && variantHolds(variant.when, subject);
}
