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
/**
 * Extracted enums whose members the engine fixes, so a mod cannot add one.
 *
 * An extracted enum is read off the game's files, and a mod's own definitions
 * join it — which is right wherever a mod can bring a member into existence.
 * Where it cannot, the join has only one effect: the field the enum is read
 * from is also the field it is checked at, so a misspelling declares itself and
 * then legitimises every use of it.
 *
 * Evidence, not reasoning: the twenty most recently updated workshop mods write
 * 134 `class` values in `common/ship_sizes` and not one of them is outside the
 * fifteen the game ships. `planet_class.district_set` is the same shape and
 * gets the opposite answer — Gigastructural Engineering alone adds
 * `giga_alderson` and `giga_birch_world` — so this is per enum, never a rule.
 */
export const engineFixedEnums: Readonly<Record<string, string>> = {
  shipsize_classes: "a ship class is a behaviour in the executable; 20 mods add none",
};

export const mergedDefinitionTypes: Readonly<Record<string, string>> = {
  // The game's own `common/on_actions/99_README_ON_ACTIONS.txt`: an on_action
  // "will go through every single event in its events = {}". Vanilla defines
  // each on_action once, so the evidence for the merge is the README plus the
  // mods: ten of the twenty most recently updated workshop mods add to
  // `on_game_start` from their own files, Gigastructural Engineering from five
  // at once, which under last-one-wins would leave four of its own files dead.
  on_action: "every definition of the same on_action fires; the events lists join",

  // 170 `part = { }` blocks in the one vanilla
  // `common/start_screen_messages` file. Under last-one-wins the start screen
  // would have one line.
  start_screen_message: "the parts of the start screen are 170 blocks of one name",

  // 258 `terraform_link = { }` blocks across the three vanilla
  // `common/terraform` files — 19, 72 and 167.
  terraform_link: "every terraform link in the game is a block of this one name",

  // 226 `randomizable_combo = { }` blocks in `flags/colors.txt`.
  randomizable_combo: "the flag colour combinations are 226 blocks of one name",

  // `guiTypes = { }` is the root of 167 of the 169 vanilla `.gui` files, and a
  // mod adding an interface element writes another one.
  gui_type: "every .gui file wraps its elements in a block of this one name",

  // `HUM` is defined in both `species_00.txt` and `species_01.txt`, with
  // different names in each; the game draws from all of them.
  species_name: "a species class's name lists are spread across files and join",

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
