/**
 * Types whose field names the game declares rather than the schema.
 *
 * `common/defines` is one block per subsystem holding a few thousand engine
 * constants. A mod changes one by writing the same key, and it cannot invent a
 * key the engine does not read — so the valid set is exactly what the game
 * ships, and listing it in a ported corpus only guarantees the list is a patch
 * behind. Vanilla 4.4.6 uses 113 defines the corpus never declared.
 *
 * The names are collected by `npm run index:game` and applied by whatever is
 * checking, the same way modifier names are: keeping them out of the schema
 * itself is what stops `@kongyo2/stellaris-ts/schema` pulling the whole index in
 * behind it.
 */
import { anyValue, field, occurs } from "./ir.js";
import type { DefinitionType, EntryRule } from "./ir.js";

export const gameDeclaredFieldTypes: readonly string[] = [
  "Checked_NInterface",
  "NAI",
  "NAdditionalContent",
  "NArmy",
  "NCamera",
  "NCombat",
  "NEconomy",
  "NEngine",
  "NGameplay",
  "NGraphics",
  "NPop",
  "NShip",
  "NSpecies",
  "Unchecked_NInterface",
];

/**
 * Replaces those types' fields with the ones the game declares.
 *
 * Replaces rather than adds, because a define the engine does not read is not a
 * define. The ported corpus lists 11 the installed game does not have: nine were
 * removed by some later patch, and two are misspellings of real ones
 * (`..._THRESOLD` for `..._THRESHOLD`). Accepting those means a mod can set them
 * and see nothing happen, which is the mistake this library exists to catch.
 *
 * The corpus's value rule is kept wherever it describes a key the game still
 * has, since the game's list says which keys exist and nothing about what they
 * hold.
 */
export function withGameDeclaredFields(
  types: readonly DefinitionType[],
  fieldNames: Readonly<Record<string, readonly string[]>>,
): readonly DefinitionType[] {
  return types.map((type) => {
    const declared: readonly string[] | undefined = fieldNames[type.id];

    if (declared === undefined || declared.length === 0) {
      return type;
    }

    const allowed: ReadonlySet<string> = new Set(declared);
    const kept: EntryRule[] = [];
    const described = new Set<string>();

    for (const entry of type.entries) {
      if (entry.kind === "field" && typeof entry.key === "string") {
        if (!allowed.has(entry.key)) {
          continue;
        }
        described.add(entry.key);
      }
      kept.push(entry);
    }

    for (const name of declared) {
      if (!described.has(name)) {
        kept.push(field(name, anyValue(), occurs.optional));
      }
    }

    return { ...type, entries: kept };
  });
}
