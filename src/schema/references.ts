import type { ResolvedValue } from "./resolve.js";

/**
 * What a value names, when naming a definition is all it can do.
 *
 * Shared by `validate`, which asks it of a mod, and by the conformance gate,
 * which asks it of the base game: a rule that reads a value as a reference is
 * right only if the base game's own values under it are names of definitions,
 * and until the gate asked, no rule had been held to that.
 */

/** The definitions a value may name, and the words it may be instead. */
export interface ReferenceTargets {
  /** The definition types, as alternatives: a name of any one of them will do. */
  readonly types: readonly string[];
  /**
   * The words a rule beside the references takes as written, lower-cased:
   * `name_list = random` in `create_species` is no name list and is not meant
   * to be one.
   */
  readonly words: ReadonlySet<string>;
}

const NOTHING: ReferenceTargets = { types: [], words: new Set<string>() };

/**
 * What a value under these rules may name; no type at all unless every rule
 * that could read a scalar is a reference or a word.
 *
 * A field is often `<building> | scalar` — `icon` is — and a scalar rule means
 * the value may be anything, so naming one of the alternatives as unresolved
 * would be wrong. A block rule says nothing about a scalar written under the
 * same key, so it is neither a reference nor a reason to stop reporting one.
 */
export function referenceTargets(values: readonly ResolvedValue[]): ReferenceTargets {
  const types: string[] = [];
  const words = new Set<string>();
  let onlyReferences = values.length > 0;

  const visit = (value: ResolvedValue): void => {
    if (value.kind === "type-reference") {
      if (!types.includes(value.type)) {
        types.push(value.type);
      }
      return;
    }
    if (value.kind === "literal") {
      // A boolean is written `yes` or `no`: `remove_deposit = yes` removes the
      // deposit in scope and names none.
      if (typeof value.value === "boolean") {
        words.add(value.value ? "yes" : "no");
        words.add(String(value.value));
      } else {
        words.add(String(value.value).replace(/^"|"$/gu, "").toLowerCase());
      }
      return;
    }
    if (value.kind === "primitive" && value.type === "boolean") {
      words.add("yes");
      words.add("no");
      return;
    }
    if (value.kind === "list") {
      visit(value.item);
      return;
    }
    if (value.kind === "choice") {
      for (const choice of value.choices) {
        visit(choice);
      }
      return;
    }
    if (value.kind !== "block" && value.kind !== "script-block" && value.kind !== "scripted-call") {
      onlyReferences = false;
    }
  };

  for (const value of values) {
    visit(value);
  }

  return onlyReferences && types.length > 0 ? { types, words } : NOTHING;
}

/**
 * Whether a name is none of the definitions a reference may point at.
 *
 * The types are alternatives. A portrait set lists portraits and portrait
 * groups in one block, and `mam5` is the one and `human` the other: asked of
 * each type in turn, every correct name was reported as missing from the type
 * it is not. `known` answers `undefined` for a type whose definitions are not
 * indexed, and one such alternative leaves the question open. Nothing at all
 * is no name: `soundeffect = ""` says there is none.
 */
export function namesNoDefinition(
  targets: ReferenceTargets,
  name: string,
  known: (type: string) => ReadonlySet<string> | undefined,
): boolean {
  if (targets.types.length === 0 || name.length === 0 || targets.words.has(name.toLowerCase())) {
    return false;
  }

  for (const type of targets.types) {
    const ids: ReadonlySet<string> | undefined = known(type);
    if (ids === undefined || ids.has(name)) {
      return false;
    }
  }

  return true;
}

/** `portrait or portrait_group`: the alternatives a reference may point at, for a message. */
export function referenceLabel(targets: ReferenceTargets): string {
  return targets.types.join(" or ");
}
