/**
 * Types the game merges rather than replaces.
 *
 * A mod that defines an id the base game already uses normally replaces it, and
 * whichever file loads last is the one that counts. A few directories do not
 * work that way: the engine reads every definition of the same id and keeps
 * them all. Warning about those is not a small nuisance — it is a warning on
 * the one construct the directory exists for, and it fires on every mod that
 * uses the directory correctly.
 *
 * Each entry says what the evidence is. Adding one on reasoning alone would
 * silence a real warning, so nothing goes here without the game or a working
 * mod showing the merge.
 */
export const mergedDefinitionTypes: Readonly<Record<string, string>> = {
  // The game's own `common/on_actions/99_README_ON_ACTIONS.txt`: an on_action
  // "will go through every single event in its events = {}". Vanilla writes
  // `on_game_start` twice in one file, and ten of the twenty most recently
  // updated workshop mods add to `on_game_start` from their own files —
  // Gigastructural Engineering from five of them at once, which under
  // last-one-wins would leave four of its own files dead.
  on_action: "every definition of the same on_action fires; the events lists join",

  // `common/job_tags` and `common/trait_tags` are lists of words. Gigastructural
  // Engineering adds one by shipping `giga_job_tags.txt` beside vanilla's
  // `00_tags.txt`, and both files are read, so a word written twice is a list
  // with the word in it twice rather than one definition replacing another.
  job_tags: "the directory is a list, and every file in it is read",
  trait_tags: "the directory is a list, and every file in it is read",

  // `common/defines` is one block per subsystem, and a mod writes only the
  // constants it changes: every mod checked ships a partial `NGameplay = { }`
  // holding two or three keys. The block does not replace the vanilla one, the
  // keys inside it do.
  Checked_NInterface: "a defines block merges key by key",
  NAI: "a defines block merges key by key",
  NAdditionalContent: "a defines block merges key by key",
  NArmy: "a defines block merges key by key",
  NCamera: "a defines block merges key by key",
  NCombat: "a defines block merges key by key",
  NEconomy: "a defines block merges key by key",
  NEngine: "a defines block merges key by key",
  NGameplay: "a defines block merges key by key",
  NGraphics: "a defines block merges key by key",
  NPop: "a defines block merges key by key",
  NShip: "a defines block merges key by key",
  NSpecies: "a defines block merges key by key",
  Unchecked_NInterface: "a defines block merges key by key",
};
