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
