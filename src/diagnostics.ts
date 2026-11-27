/**
 * Every code a diagnostic of this package carries, and what each one means.
 *
 * A code is what a report is filtered and counted by, so the set is closed:
 * `validate`, the load checks and `emit` are typed to it, and a code with no
 * entry here does not compile. `stellaris-ts explain <code>` prints an entry,
 * for whoever — or whatever — reads the report and has to decide what to change.
 */
export type DiagnosticCode =
  | "collision-check-skipped"
  | "conflicting-fields"
  | "duplicate-definition"
  | "duplicate-field"
  | "duplicate-file"
  | "duplicate-script-id"
  | "duplicate-subplan"
  | "else-without-if"
  | "escaping-path"
  | "hidden-event-options"
  | "ignored-vanilla-override"
  | "incomplete-event"
  | "inline-script-missing-script"
  | "invalid-macro-entry"
  | "malformed-mod-id"
  | "malformed-supported-version"
  | "malformed-token"
  | "mismatched-event-trigger"
  | "missing-building-sets"
  | "missing-category"
  | "missing-description"
  | "missing-field"
  | "missing-file"
  | "missing-income-goal"
  | "missing-localisation"
  | "missing-mod-name"
  | "missing-script-id"
  | "missing-uplifted-portrait"
  | "missing-zone-slots"
  | "overlays-vanilla-definition"
  | "replaces-vanilla-definition"
  | "replaces-vanilla-directory"
  | "replaces-vanilla-subplan"
  | "replaces-vanilla-variable"
  | "reserved-mod-id"
  | "scopeless-event"
  | "shadows-engine-name"
  | "unexpected-block"
  | "unexpected-comparison"
  | "unexpected-value-list"
  | "unknown-animation"
  | "unknown-definition-type"
  | "unknown-field"
  | "unknown-language"
  | "unknown-modifier"
  | "unknown-policy-option"
  | "unknown-replace-path"
  | "unknown-trigger"
  | "unknown-value"
  | "unnamespaced-event"
  | "unpaired-parameter"
  | "unprefixed-concept"
  | "unread-extension"
  | "unread-file"
  | "unresolved-reference"
  | "unsupported-game-version"
  | "untriggered-event"
  | "unused-ai-budget"
  | "unused-scripted-variable"
  | "vanilla-filename-collision"
  | "vanilla-override"
  | "wrong-scope";

export interface DiagnosticExplanation {
  /** What is wrong, and what the game does with it. */
  readonly summary: string;
  /** What to change. */
  readonly fix: string;
}

export const diagnosticCodes: Readonly<Record<DiagnosticCode, DiagnosticExplanation>> = {
  "collision-check-skipped": {
    summary: "The list of the base game's files was empty, so nothing compared the mod's file names with it.",
    fix: "Reinstall the package: its generated data is incomplete.",
  },
  "conflicting-fields": {
    summary:
      "Two fields the game does not take together, such as an option's trigger beside its exclusive_trigger; it logs the pair and keeps one.",
    fix: "Keep the one that says what is meant and remove the other.",
  },
  "duplicate-definition": {
    summary:
      "The mod defines one id twice. The game keeps one of the two — the last it reads for most types, the first for events — and the message says which.",
    fix: "Give one of them another id, or remove the one that is not kept.",
  },
  "duplicate-field": {
    summary:
      "A field written twice where the game reads it once and logs the second, such as two potential blocks in one subplan.",
    fix: "Merge the two blocks into one; all() keeps separate conditions apart inside it.",
  },
  "duplicate-file": {
    summary: "Two files would be written at one path, counting names that differ only in case. Only one would survive.",
    fix: "Give one of the definitions or files another file name.",
  },
  "duplicate-script-id": {
    summary:
      "An id of a trigger or effect inside queue_actions is registered more than once. The game keeps fleet actions by id and logs the second; a scripted effect called from two places registers every id inside it once per call unless it says optimize_memory.",
    fix: "Make each id unique — build it from a parameter of the scripted effect — or set optimize_memory = yes on the scripted effect.",
  },
  "duplicate-subplan": {
    summary:
      "Two subplans of one economic plan carry the same set_name, no name counting as a name. The game keeps the last and logs the first as a duplicate.",
    fix: "Give each subplan its own set_name.",
  },
  "else-without-if": {
    summary:
      "An else or else_if that does not follow an if in the same block. The game matches it to the effect read just before it and drops the branch when that is anything else.",
    fix: "Write the else directly after its if. In an object the key order is insertion order, and a repeated key is grouped: use entries([...]) for the block.",
  },
  "escaping-path": {
    summary: "A file path that leaves the mod folder, so the file is not written.",
    fix: "Name the file relative to the mod folder, with no '..' and no drive or leading slash.",
  },
  "hidden-event-options": {
    summary: "An event with hide_window = yes that has options: nobody is shown them, and the game logs it.",
    fix: "Move what the options do into immediate, or show the window.",
  },
  "ignored-vanilla-override": {
    summary:
      "The mod redefines something of the base game where the game keeps the first definition it reads and the base game's is read first: an event id, or a scripted variable. The mod's version is dropped.",
    fix: "For an event, define a new id and fire that instead. For a variable, name the file so it sorts before the base game's, or use another name.",
  },
  "incomplete-event": {
    summary:
      "An event that opens a window without a title, a description, a picture or an option; the game logs each part it cannot draw.",
    fix: "Add the missing part, or set hide_window = yes for an event that shows nothing.",
  },
  "inline-script-missing-script": {
    summary: "An inline_script written as a block with no script entry: nothing names the file to inject.",
    fix: "Add script = <path under common/inline_scripts, without .txt>.",
  },
  "invalid-macro-entry": {
    summary:
      "A [ in a scripted effect, scripted trigger or script value. The game keeps those as text and reads every unescaped [ as the start of [[PARAMETER] ... ]: with no second ] it logs Invalid macro entry, with one it cuts script out in silence.",
    fix: "Write a literal bracket as \\\\[ and \\\\], as the base game does, or move the text (a log line naming [Root.GetName]) into an event.",
  },
  "malformed-mod-id": {
    summary:
      "The mod's id holds characters other than a-z, 0-9 and _. It names the mod's folder and every file it writes.",
    fix: "Set id in defineMod to a name of those characters.",
  },
  "malformed-supported-version": {
    summary: "A supported_version the launcher cannot read.",
    fix: "Write it as v4.5.* or as a full version such as 4.5.4.",
  },
  "malformed-token": {
    summary:
      "A value the game's reader of that block cannot take and logs as Malformed token: a merge_fleet action given a target, which its reader reads again as allow_ftl.",
    fix: "Remove the field; the message says what the reader does with it.",
  },
  "mismatched-event-trigger": {
    summary:
      "An event's mean_time_to_happen, weight_multiplier or is_triggered_only does not fit how it is fired: a mean time in a triggered event, a weight in one that is not, or is_triggered_only written after either — the game reads an event's fields in order.",
    fix: "Write is_triggered_only first, and keep only the field that belongs to how the event is fired.",
  },
  "missing-building-sets": {
    summary: "A building in no building_sets: no zone's slots admit it, so it can never be built.",
    fix: "Add building_sets = { ... } naming the sets whose zones should hold it.",
  },
  "missing-category": {
    summary: "A building with no category, which the game logs: the build menu has no place for it.",
    fix: "Add category = <one of the building categories>.",
  },
  "missing-description": {
    summary:
      "A block the game logs as one that 'will not display well': a situation approach with nothing to show, an on_fail holding a single effect, or a condition with no desc in a weight the game explains reason by reason.",
    fix: "Add the name, desc or custom_tooltip the message names.",
  },
  "missing-field": {
    summary: "A field the definition's type requires is absent.",
    fix: "Add the field. If the base game's own definitions omit it too, that is a fault in this library's schema worth reporting.",
  },
  "missing-file": {
    summary:
      "A file a definition names that neither the base game nor the mod ships: a texture, a mesh, an animation, an icon the game builds the path of from the definition's key.",
    fix: "Add the file with mod.asset(path, bytes), or correct the path; the message gives the path the game looks for.",
  },
  "missing-income-goal": {
    summary:
      "An economic plan that sets no income at its own level; the game logs that it has no income goals, and counts it fulfilled at once.",
    fix: "Give the plan an income block, or — to add to a plan of the base game — write only subplans under the base game's plan id.",
  },
  "missing-localisation": {
    summary:
      "A string the definition needs or names that neither the mod nor the base game defines in the language checked. The game shows the key itself.",
    fix: "Add it with mod.localise(language, key, text), or mod.localiseAll(key, { english: … }) to write every language at once.",
  },
  "missing-mod-name": {
    summary: "defineMod was given no name. The launcher lists a mod by it and dependencies name it by it.",
    fix: "Set name in defineMod.",
  },
  "missing-script-id": {
    summary:
      "An effect, while or trigger inside queue_actions with no id. The game keeps fleet actions by id and logs one that has none.",
    fix: "Add id = <a name unique in the whole game> to the block.",
  },
  "missing-uplifted-portrait": {
    summary: "A portrait_set whose uplifted_portraits is shorter than its portraits; the two are paired by position.",
    fix: "List one uplifted portrait for each portrait, in the same order.",
  },
  "missing-zone-slots": {
    summary: "A district with no zone_slots, which the game says will crash it.",
    fix: "Add zone_slots = { ... }.",
  },
  "overlays-vanilla-definition": {
    summary:
      "The id is also the base game's, in one of the six directories where the game reads a second definition into the first, field by field, and logs nothing: economic plans, species classes, portrait sets and categories, authorities, ownership limits.",
    fix: "Nothing, when adding to the base game's definition is the intent: write only what is added. To replace it whole, ship the base game's file name with overrides.",
  },
  "replaces-vanilla-definition": {
    summary:
      "The id is also the base game's. The game keeps the last definition it reads, and the mod's default file sorts after the base game's, so this replaces it whole.",
    fix: "Nothing, when replacing is the intent — copy every field that should stay. Otherwise choose another id.",
  },
  "replaces-vanilla-directory": {
    summary:
      "replacePaths hides a directory of the base game entirely: every definition it held stops loading unless the mod supplies it.",
    fix: "Keep it only when the whole directory is meant to go.",
  },
  "replaces-vanilla-subplan": {
    summary:
      "A subplan with the set_name of one the base game's plan already has: the game keeps the last and logs the other as a duplicate.",
    fix: "Give the subplan a set_name of its own, unless replacing the base game's is the intent.",
  },
  "replaces-vanilla-variable": {
    summary:
      "A @variable declared in common/scripted_variables under a name the base game declares too, in a file read first: every script of the game then gets the mod's value.",
    fix: "Use another name unless changing the base game's value everywhere is the intent.",
  },
  "reserved-mod-id": {
    summary: "The mod's id is a device name on Windows (con, nul, com1 …), so no folder or file can be called it.",
    fix: "Choose another id.",
  },
  "scopeless-event": {
    summary:
      "An event of some kind of object — a country_event, a planet_event — that only on_actions fired with no scope list, such as on_yearly_pulse or on_game_start. The game refuses it each time: 'attempting to fire country scope event … on no_scope'.",
    fix: "List it under the on_action that fires once per object (on_yearly_pulse_country), or make it a plain event that iterates with every_country.",
  },
  "shadows-engine-name": {
    summary:
      "A scripted effect or trigger named as a command the game itself provides, or a static modifier named as a modifier. The game logs that it overwrites an existing one.",
    fix: "Rename it, with the mod's prefix.",
  },
  "unexpected-block": {
    summary:
      "A block where the game reads a single value. It takes the '{' itself as the value — an event title written this way reads '{' — and reads the block's contents as keys beside it.",
    fix: "Write a single value. For a title that depends on a condition, use the form the type documents (a desc = { trigger = … text = … } block where it takes one).",
  },
  "unexpected-comparison": {
    summary:
      "A comparison (gt, lt, …) outside a trigger. Nothing there reads the operator: add_resource = { energy > 500 } adds 500.",
    fix: "Write a plain value; compare in a trigger or limit block.",
  },
  "unexpected-value-list": {
    summary:
      "An array of blocks under a key that takes no list: option: [{…}, {…}] is one option holding two blocks with no key, and the event has no options.",
    fix: "Use repeated({…}, {…}) to write the key once per block.",
  },
  "unknown-animation": {
    summary:
      "A state of an entity plays an animation its mesh does not declare. A state names one of the mesh's own animation = { id = … }, and one that names anything else stands frozen.",
    fix: "Use an id the mesh declares, or add the animation to the mesh.",
  },
  "unknown-definition-type": {
    summary: "A definition whose type is not one the schema has.",
    fix: "Use define() with one of the type names it completes; for content with no type, mod.file() writes a file verbatim.",
  },
  "unknown-field": {
    summary:
      "A key no rule accepts where it is written — or one the game's own reader of the definition has no case for, which it logs as an Unexpected token and skips.",
    fix: "Check the spelling against the type's fields (the generated types complete them). The message says where the key moved when a patch moved it.",
  },
  "unknown-language": {
    summary: "A language name the game reads no localisation for.",
    fix: "Use a language the message lists, such as l_english or l_japanese. mod.localise takes the name with its l_ prefix; localiseAll, validate and the command line take it with or without.",
  },
  "unknown-modifier": {
    summary:
      "A modifier name the game does not generate, counting the ones the mod's own definitions bring into existence and its static modifiers. The game drops the line on load.",
    fix: "Check the name against vanillaModifierNames and the rule for its type (job_<id>_add exists because <id> is a job).",
  },
  "unknown-policy-option": {
    summary: "set_policy names an option the policy it is given with does not have.",
    fix: "Use one of that policy's options; vanillaPolicyOptions lists the base game's.",
  },
  "unknown-replace-path": {
    summary: "replacePaths names a directory the base game does not load from, so nothing would be replaced.",
    fix: "Name a directory as the game does, such as common/buildings.",
  },
  "unknown-trigger": {
    summary:
      "A trigger named for its value that does not exist: order_by = trigger:<name>, or the trigger of export_trigger_value_to_variable.",
    fix: "Name a trigger the game documents as returning a number.",
  },
  "unknown-value": {
    summary: "A value outside what the rules take: the wrong member of an enum, a word where a number belongs.",
    fix: "Use one of the values the message lists.",
  },
  "unnamespaced-event": {
    summary:
      "An event id without a namespace. An event id is written namespace.number, and the file needs its namespace line.",
    fix: "Name the event <namespace>.<number>; define() writes the namespace line.",
  },
  "unpaired-parameter": {
    summary:
      "An odd number of $ in a scripted effect, scripted trigger or script value. The game pairs them as $PARAMETER$, and an unpaired one takes the rest of the token for its name.",
    fix: "Write a literal dollar sign as \\\\$, or close the parameter.",
  },
  "unprefixed-concept": {
    summary: "A game concept whose key does not start with concept_; the game logs it.",
    fix: "Name it concept_<something>.",
  },
  "unread-extension": {
    summary:
      "The definition would be written into a file whose extension the game does not read for its type, such as a sprite in a .txt file.",
    fix: "Leave the file name to define(), or give one with the extension the message names.",
  },
  "unread-file": {
    summary:
      "The game reads this type from one file alone — an alert from common/alerts.txt — and the definition is in another.",
    fix: "Write it into that file, which replaces the base game's: copy what should stay.",
  },
  "unresolved-reference": {
    summary:
      "A name written where the game looks something up, which neither the base game nor the mod defines: a technology, a sprite, a scripted trigger, the entity <key>_entity a ship size is drawn with.",
    fix: "Define it, or correct the name; the vanilla…Ids lists of @kongyo2/stellaris-ts/ids hold the base game's.",
  },
  "unsupported-game-version": {
    summary:
      "supportedVersion does not cover the game this build checks against; the launcher will list the mod as out of date.",
    fix: "Set supportedVersion to v4.5.* (the modsCompatibilityVersion of the game).",
  },
  "untriggered-event": {
    summary:
      "An event with neither is_triggered_only nor a mean time, which the game tries to fire every day for every object, or one written under a key it fires nothing by mean time for.",
    fix: "Set is_triggered_only = yes and fire it from an on_action or another event, or give it a mean_time_to_happen.",
  },
  "unused-ai-budget": {
    summary:
      "A budget the AI never draws on, because its economic category does not itself say use_for_ai_budget = yes; the game logs it as unused.",
    fix: "Use a category that says so (vanillaAiBudgetCategories), or define one.",
  },
  "unused-scripted-variable": {
    summary:
      "A @variable the mod declares for every file of the game in common/scripted_variables, which nothing in the mod reads.",
    fix: "Remove it, or use it; a variable used in one file only can be declared at the top of that file.",
  },
  "vanilla-filename-collision": {
    summary:
      "The mod ships a file under a name the base game already uses there, which replaces the base game's file whole.",
    fix: "Rename the file, or pass overrides: true to say the replacement is intended.",
  },
  "vanilla-override": {
    summary:
      "A file marked as replacing the base game's file of the same name: everything else that file defined stops loading.",
    fix: "Nothing, when intended; make sure the file carries everything of the original that should stay.",
  },
  "wrong-scope": {
    summary:
      "A trigger or effect read on the wrong kind of object — a fleet's effect in a country's block — or a target of the wrong kind, or one read where there is no scope at all. The game answers a wrongly scoped trigger with false for ever and logs nothing while loading.",
    fix: "Change scope first (owner = { … }, every_owned_fleet = { … }), or use the command of the object in scope; the message lists the scopes the command accepts.",
  },
};

/** Whether a word is one of the codes. */
export function isDiagnosticCode(code: string): code is DiagnosticCode {
  return Object.hasOwn(diagnosticCodes, code);
}

/** The explanation of a code, or nothing for a word that is not one. */
export function explainDiagnostic(code: string): DiagnosticExplanation | undefined {
  return isDiagnosticCode(code) ? diagnosticCodes[code] : undefined;
}
