import { NodeKind, type EntryNode, type Scalar } from "../syntax/index.js";
import type { SchemaModel } from "./ir.js";
import { fleetActionFacts, subplansOf, type CategoryBudgetUse, type Subplan } from "./load-facts.js";

/**
 * What the game checks of a definition as it loads it, and tells only its log.
 *
 * A handful of mistakes the game does notice: a ship size whose entity is not
 * there, a megastructure the outliner has no icon for, a situation approach
 * that does nothing it can show. It writes each one to `error.log` and loads
 * the definition anyway — the ship drawn as the test object, the outliner row
 * blank, the approach's tooltip empty — so a mod author who does not read the
 * log finds out from a player.
 *
 * Each check here is read out of the 4.5.2 executable, at the address given
 * beside it, and holds of vanilla: `verify:conformance` runs every one over
 * the base game, which the game itself loads without one of these lines.
 *
 * The checks read a definition through {@link LoadBlock}, which both a mod's
 * definition bodies and the parsed game files convert to, so `validate` and the
 * conformance gate ask exactly the same question of each.
 */

const commandNames = new WeakMap<SchemaModel, Map<string, ReadonlySet<string>>>();

/**
 * The effects or the triggers the executable registers by name, lower-cased:
 * every command the schema declares under its own name. The ones declared by
 * a construct instead, a call to a scripted effect or a scope to enter, are no
 * command of the executable's.
 *
 * Lower-cased because the lookup that finds a clash folds case: a name is
 * walked down the keyword trie one `tolower` at a time (`0x1bb78a0`, the
 * registry's own lookup), so a scripted trigger called `or` is the `OR` the
 * schema declares in capitals.
 */
export function engineCommandNames(model: SchemaModel, family: "effect" | "trigger"): ReadonlySet<string> {
  let families: Map<string, ReadonlySet<string>> | undefined = commandNames.get(model);
  if (families === undefined) {
    families = new Map<string, ReadonlySet<string>>();
    commandNames.set(model, families);
  }

  let names: ReadonlySet<string> | undefined = families.get(family);
  if (names === undefined) {
    names = new Set(
      model.commands
        .filter((command) => command.family === family && command.key === undefined)
        .map((command) => command.id.toLowerCase()),
    );
    families.set(family, names);
  }

  return names;
}

/** A definition's body, or a block inside it, as the checks read it. */
export interface LoadBlock {
  readonly kind: "block";
  readonly entries: readonly LoadEntry[];
  /**
   * The block holds script this cannot read: an `inline_script`, a
   * `[[PARAM] … ]` block, raw text that does not parse. What it adds is
   * unknown, so a check that needs something to be absent says nothing.
   */
  readonly open: boolean;
}

export type LoadValue =
  LoadBlock | { readonly kind: "scalar"; readonly text: string } | { readonly kind: "unreadable" };

/** One entry, in written order. A value with no key has none. */
export interface LoadEntry {
  readonly key: string | undefined;
  readonly value: LoadValue;
}

export interface LoadCheckContext {
  /** Whether a definition of the type exists, in the base game or in the mod. */
  readonly defines: (type: string, id: string) => boolean;
  /** Every id of the type, the base game's and the mod's. */
  readonly ids: (type: string) => readonly string[];
  /**
   * Whether the executable registers an effect or a trigger by this name. A
   * caller that cannot say leaves it out, and the checks that need it say
   * nothing.
   */
  readonly command?: (family: "effect" | "trigger", name: string) => boolean;
  /** Whether a modifier of this name exists apart from any static modifier. */
  readonly modifier?: (name: string) => boolean;
  /**
   * Whether the game would find a file at this path: one the base game ships
   * or the mod writes. The path is as the game resolves it, from the root of
   * the game folder, `/` between its parts.
   */
  readonly fileExists?: (path: string) => boolean;
  /**
   * The animation ids a mesh declares, `animation = { id = … }` by
   * `animation`; none for a mesh that declares none, and `undefined` for a
   * mesh nothing here knows.
   */
  readonly meshAnimations?: (mesh: string) => readonly string[] | undefined;
  /**
   * What an economic category says to the AI's budget; `undefined` for a
   * category nothing here knows.
   */
  readonly budgetUse?: (category: string) => CategoryBudgetUse | undefined;
  /** The options a policy holds, by name; `undefined` for a policy nothing here knows. */
  readonly policyOptions?: (policy: string) => readonly string[] | undefined;
}

export interface LoadFinding {
  /**
   * `unresolved-reference` for a name the game builds and cannot find;
   * `missing-description` for a block the game says will not display well;
   * `untriggered-event` for an event nothing fires and no mean time does;
   * `mismatched-event-trigger` for a mean time or a weight the event's kind
   * does not read; `incomplete-event` for a window missing a part the game
   * draws it with; `hidden-event-options` for options nobody is shown;
   * `conflicting-fields` for two fields the game does not take together;
   * `shadows-engine-name` for a name the executable already uses;
   * `missing-building-sets` for a building no zone can hold;
   * `missing-category` for a building the build menu has no place for;
   * `missing-zone-slots` for a district the game says will crash it;
   * `unprefixed-concept` for a game concept not named `concept_…`;
   * `missing-file` for a file the game looks for and nothing ships;
   * `unknown-animation` for a state playing what its mesh has not got;
   * `duplicate-field` for a field the game reads once and logs twice;
   * `missing-uplifted-portrait` for a portrait with nothing to be uplifted to;
   * `duplicate-subplan` for a subplan that takes the place of another;
   * `unused-ai-budget` for a budget the AI never draws on;
   * `invalid-macro-entry` for a `[` the game reads as the start of a
   * parameter block, and `unpaired-parameter` for a `$` with no partner;
   * `missing-script-id` for a trigger or an effect of a fleet action with no
   * `id`; `malformed-token` for a value the game's own reader cannot take;
   * `scopeless-event` for an event of some kind of object fired with none;
   * `unknown-policy-option` for an option of another policy.
   */
  readonly code:
    | "conflicting-fields"
    | "duplicate-field"
    | "duplicate-subplan"
    | "hidden-event-options"
    | "incomplete-event"
    | "invalid-macro-entry"
    | "malformed-token"
    | "mismatched-event-trigger"
    | "missing-building-sets"
    | "missing-category"
    | "missing-description"
    | "missing-file"
    | "missing-script-id"
    | "missing-uplifted-portrait"
    | "missing-zone-slots"
    | "scopeless-event"
    | "shadows-engine-name"
    | "unknown-animation"
    | "unknown-policy-option"
    | "unpaired-parameter"
    | "unprefixed-concept"
    | "unresolved-reference"
    | "untriggered-event"
    | "unused-ai-budget";
  /** Where inside the definition, dotted. Empty for the definition itself. */
  readonly path: string;
  readonly message: string;
  /**
   * `error` for what leaves the definition not doing what it says: a block the
   * game drops, text it cuts out. A line in the log beside a definition that
   * still loads is a warning, and that is what a finding is when it says nothing.
   */
  readonly severity?: "error" | "warning";
}

/** The scalar a written value holds, with no quotes; `undefined` for a block. */
function scalarText(scalar: Scalar): string {
  return typeof scalar.value === "string" ? scalar.value : scalar.raw;
}

/**
 * A parsed block as the checks read it.
 *
 * `inline_script` is the one key that injects script, and `[[PARAM] … ]`
 * holds script that may or may not be there; either makes the block open.
 */
export function loadBlockOfEntries(entries: readonly EntryNode[]): LoadBlock {
  const out: LoadEntry[] = [];
  let open = false;

  for (const entry of entries) {
    switch (entry.kind) {
      case NodeKind.Assignment: {
        const key: string = String(entry.key.value);
        if (key.toLowerCase() === "inline_script") {
          open = true;
        }
        const value: LoadValue =
          entry.value.kind === NodeKind.Block
            ? loadBlockOfEntries(entry.value.entries)
            : entry.value.kind === NodeKind.Scalar
              ? { kind: "scalar", text: scalarText(entry.value) }
              : { kind: "unreadable" };
        out.push({ key, value });
        break;
      }
      case NodeKind.Scalar:
        out.push({ key: undefined, value: { kind: "scalar", text: scalarText(entry) } });
        break;
      case NodeKind.Block:
        out.push({ key: undefined, value: loadBlockOfEntries(entry.entries) });
        break;
      case NodeKind.OptionalBlock:
      case NodeKind.InlineMath:
      case NodeKind.PrefixedBlock:
      case NodeKind.Error:
        open = true;
        break;
      default:
        break;
    }
  }

  return { kind: "block", entries: out, open };
}

function valuesOf(block: LoadBlock, key: string): readonly LoadValue[] {
  const wanted: string = key.toLowerCase();
  return block.entries.filter((entry) => entry.key?.toLowerCase() === wanted).map((entry) => entry.value);
}

function blocksOf(block: LoadBlock, key: string): readonly LoadBlock[] {
  return valuesOf(block, key).filter((value): value is LoadBlock => value.kind === "block");
}

function scalarOf(value: LoadValue | undefined): string | undefined {
  return value?.kind === "scalar" ? value.text : undefined;
}

function isNo(value: LoadValue): boolean {
  return value.kind === "scalar" && value.text.toLowerCase() === "no";
}

/** A value only the game can work out: `@cost`, `$PARAM$`, `[[x]`, `value:x`. */
function isIndirect(text: string): boolean {
  return text.startsWith("@") || text.includes("$") || text.includes("[") || text.includes(":");
}

/**
 * Whether a value holds something, or might: a block with an entry, one this
 * cannot read through, or anything that is not a block at all.
 */
function holdsAnything(value: LoadValue): boolean {
  return value.kind !== "block" || value.open || value.entries.length > 0;
}

/**
 * A ship size's entity.
 *
 * The ship size's check (`0xd293f0`, `ship_size.cpp:785`) takes the entity
 * named by `entity`, or `<key>_entity` when there is none (`0xd296f7`). With
 * `graphical_culture = no` it looks that name up and nothing else; otherwise
 * it looks up `<culture>_<entity>` for each graphical culture, through the
 * culture's fallbacks, and falls back to the name itself (`0x436710`). A name
 * none of those finds is logged as `Could not find any entity by the name`,
 * and the ship is drawn as `test_object_entity`, which has no locators either.
 *
 * Reported only when nothing by the name exists at all — neither the name nor
 * any culture's — since which cultures fall back to which is the game's to
 * decide. Vanilla's 319 ship sizes all resolve.
 */
function shipSizeEntity(id: string, body: LoadBlock, context: LoadCheckContext): readonly LoadFinding[] {
  const written: string | undefined = valuesOf(body, "entity")
    .map(scalarOf)
    .find((text) => text !== undefined && text.length > 0);

  if (written === undefined && (body.open || valuesOf(body, "entity").some((value) => value.kind !== "scalar"))) {
    return [];
  }

  const entity: string = written ?? `${id}_entity`;

  if (isIndirect(entity) || context.defines("model_entity", entity)) {
    return [];
  }

  const direct: boolean = valuesOf(body, "graphical_culture").some(isNo);

  if (
    !direct &&
    context.ids("graphical_culture").some((culture) => context.defines("model_entity", `${culture}_${entity}`))
  ) {
    return [];
  }

  const looked: string = direct ? entity : `${entity}, or <culture>_${entity} for a graphical culture,`;

  return [
    {
      code: "unresolved-reference",
      path: written === undefined ? "" : "entity",
      message:
        written === undefined
          ? `${id} names no entity, so the game looks for ${looked} and neither the base game nor this mod defines one. It logs "Could not find any entity by the name" and draws the ship as its test object.`
          : `entity = ${entity} names no entity the base game or this mod defines${direct ? "" : `, and no graphical culture has a <culture>_${entity}`}. The game logs "Could not find any entity by the name" and draws the ship as its test object.`,
    },
  ];
}

/**
 * The sprite the outliner shows a megastructure by.
 *
 * Every megastructure type gets `GFX_<key>_outliner_icon` (`0xd438a2`), with no
 * field to name another. One the outliner shows — `show_in_outliner` is yes
 * unless written otherwise, the constructor sets the flag (`0xd4203a`) — is
 * logged as `missing outliner icon sprite` when that sprite does not exist
 * (`0xd51cc0`, `megastructure_type.cpp:2002`). Vanilla's one-stage
 * structures, `orbital_ring` and `deep_space_citadel_0` among them, write
 * `show_in_outliner = no` instead of an icon.
 *
 * An `outliner_trigger` with a condition in it is evaluated there before the
 * sprite is looked for, on a scope this cannot know, so a megastructure with
 * one is not judged.
 */
function megastructureOutlinerIcon(id: string, body: LoadBlock, context: LoadCheckContext): readonly LoadFinding[] {
  if (
    body.open ||
    valuesOf(body, "show_in_outliner").some(isNo) ||
    valuesOf(body, "outliner_trigger").some(holdsAnything)
  ) {
    return [];
  }

  const sprite: string = `GFX_${id}_outliner_icon`;

  if (context.defines("sprite", sprite)) {
    return [];
  }

  return [
    {
      code: "unresolved-reference",
      path: "",
      message: `${id} is shown in the outliner, which is the default, and the outliner shows it by the sprite ${sprite}; neither the base game nor this mod defines that sprite, and the game logs "missing outliner icon sprite" for it. Define the sprite, or write show_in_outliner = no as vanilla does for a structure built in one stage.`,
    },
  ];
}

/**
 * An approach with nothing to show.
 *
 * The situation's check (`0x4e4490`, `situation_type.cpp:455`) logs `lacks any
 * effects, this will not display well` for an approach whose `on_select` holds
 * no effect (`+0x20c`, the count of the block at `+0x1f0`), whose `modifier`
 * and `target_modifier` are empty, which has no `triggered_modifier` or
 * `triggered_target_modifier`, and whose `resources` names no category. The
 * approach's own `custom_tooltip` is not among them: the reader keeps it apart
 * (`+0x498`, `0x4e65d0`), and the check never reads it.
 */
function situationApproaches(body: LoadBlock): readonly LoadFinding[] {
  const findings: LoadFinding[] = [];

  for (const approach of blocksOf(body, "approach")) {
    if (approach.open) {
      continue;
    }

    const shows: boolean =
      valuesOf(approach, "on_select").some(holdsAnything) ||
      valuesOf(approach, "modifier").some(holdsAnything) ||
      valuesOf(approach, "target_modifier").some(holdsAnything) ||
      valuesOf(approach, "triggered_modifier").length > 0 ||
      valuesOf(approach, "triggered_target_modifier").length > 0 ||
      valuesOf(approach, "resources").some(
        (value) => value.kind !== "block" || value.open || valuesOf(value, "category").length > 0,
      );

    if (shows) {
      continue;
    }

    const name: string = scalarOf(valuesOf(approach, "name")[0]) ?? "with no name";
    findings.push({
      code: "missing-description",
      path: "approach",
      message: `The approach ${name} does nothing the game can show: no effect in on_select, no modifier and no resources. The game logs that it "lacks any effects, this will not display well"; give on_select at least a custom_tooltip.`,
    });
  }

  return findings;
}

/**
 * An outcome of one effect.
 *
 * The same check logs that `on_fail` or `on_complete` "is probably lacking a
 * description of what it does" when the block holds exactly one effect
 * (`+0x1f4` and `+0x134`, each block's count at `+0x1c`): a lone
 * `destroy_situation = this` shows nothing, and so does a lone
 * `custom_tooltip`, which is one effect as well. Vanilla's say what they do
 * with a `custom_tooltip` and put the rest in a `hidden_effect`, an empty one
 * where there is nothing else — "here just to silence the error log", as its
 * own comments put it.
 */
function situationOutcomes(id: string, body: LoadBlock): readonly LoadFinding[] {
  const findings: LoadFinding[] = [];

  for (const [key, label] of [
    ["on_fail", "on_fail"],
    ["on_progress_complete", "on_complete"],
  ] as const) {
    for (const outcome of blocksOf(body, key)) {
      if (outcome.open || outcome.entries.filter((entry) => entry.key !== undefined).length !== 1) {
        continue;
      }

      findings.push({
        code: "missing-description",
        path: key,
        message: `${key} holds one effect, and the game logs "${label} in situation type ${id} is probably lacking a description of what it does" for any that does. Say what it does with a custom_tooltip and put the effect in a hidden_effect beside it, as vanilla does.`,
      });
    }
  }

  return findings;
}

/**
 * The keys a weight's `modifier` reads as its own; any other is a condition.
 *
 * `0x337e80` maps these to the block's operation; `desc` is its description
 * (`0x340c1e`), and every other key goes to the trigger that decides whether
 * the modifier applies (`0x347410`).
 */
const WEIGHT_OPERATIONS: ReadonlySet<string> = new Set([
  "abs",
  "add",
  "ceiling",
  "desc",
  "divide",
  "factor",
  "floor",
  "max",
  "min",
  "modulo",
  "mult",
  "multiply",
  "pow",
  "round",
  "round_to",
  "set",
  "square",
  "square_root",
  "subtract",
  "weight",
]);

/**
 * The weights the game shows with their reasons, and so asks each reason for
 * a description.
 *
 * A weight's modifiers are checked by `0x343220` and by copies of its loop
 * inlined where the owner finishes loading; nothing else calls the check, so
 * these are all of them. Each one logs `script_value/weight field: lacking a
 * custom description` for a `modifier` that has a condition and no `desc`
 * (`0x341400`), and for any `complex_trigger_modifier` without one
 * (`0x341b50`). Vanilla gives every such modifier a `desc` — 1,844 in its
 * resolutions alone — and gives none to the weights not listed here.
 */
const DESCRIBED_WEIGHTS: Readonly<Record<string, readonly string[]>> = {
  // `0x4b5730`, the action's `ai_acceptance` at `+0x5a8`.
  diplomatic_action: ["ai_acceptance"],
  // `0x553c30` and `0x5522d0`, from `federation_type_database.cpp`.
  federation_type: ["ai_weight"],
  // `0x5590c0`, for every law in the database.
  federation_law: ["ai_weight"],
  // `0x8ae2d0`: `monthly_decrease` at `+0x628` and `monthly_increase` at `+0x738`; `daily_decrease` is not checked.
  psionic_auras: ["monthly_increase", "monthly_decrease"],
  // `0x4c7260`, the resolution's `ai_weight` at `+0x958`.
  resolution: ["ai_weight"],
  // `0x4e4490`, the situation's `monthly_progress` at `+0x580`.
  situation_type: ["monthly_progress"],
  // `0x4d9d90`, the project's `cost` at `+0x38`.
  special_project: ["cost"],
  // `0x2138e4`, the action's `ai_acceptance` at `+0x508`.
  tradable_actions: ["ai_acceptance"],
};

function weightDescriptions(type: string, body: LoadBlock): readonly LoadFinding[] {
  const findings: LoadFinding[] = [];

  for (const field of DESCRIBED_WEIGHTS[type] ?? []) {
    for (const weight of blocksOf(body, field)) {
      for (const entry of weight.entries) {
        const key: string | undefined = entry.key?.toLowerCase();
        if ((key !== "modifier" && key !== "complex_trigger_modifier") || entry.value.kind !== "block") {
          continue;
        }

        const modifier: LoadBlock = entry.value;
        if (modifier.open || valuesOf(modifier, "desc").length > 0) {
          continue;
        }

        // Only a modifier with a condition is asked; one that always applies
        // is part of the base.
        const conditional: boolean =
          key === "complex_trigger_modifier" ||
          modifier.entries.some((inner) => inner.key !== undefined && !WEIGHT_OPERATIONS.has(inner.key.toLowerCase()));

        if (!conditional) {
          continue;
        }

        findings.push({
          code: "missing-description",
          path: `${field}.${entry.key ?? key}`,
          message:
            key === "modifier"
              ? `A modifier in ${field} applies under a condition and has no desc to say which. ${field} is one of the weights the game shows reason by reason, and it logs "lacking a custom description, this will not display well" for this one; vanilla gives every such modifier a desc.`
              : `A complex_trigger_modifier in ${field} has no desc. ${field} is one of the weights the game shows reason by reason, and it logs "lacking a custom description for a complex_trigger_modifier, this will not display well" for this one.`,
        });
      }
    }
  }

  return findings;
}

function isYes(value: LoadValue): boolean {
  return value.kind === "scalar" && value.text.toLowerCase() === "yes";
}

/**
 * The keys an event is written under that the game keeps no list to fire by
 * mean time from.
 *
 * The event manager files an event that is not `is_triggered_only` under its
 * scope (`0x3f55e0`), and has a list for nine of the twenty-two keys its loader
 * takes (`0x3f3d30`): `country_event`, `planet_event`, `colony_event`,
 * `ship_event`, `fleet_event`, `pop_event`, `pop_group_event`,
 * `pop_faction_event` and `observer_event`. For each key here it logs `event
 * %s must be is_triggered_only, MTTH is not enabled for %s scope events`
 * (`eventmanager.cpp:899`) and files the event nowhere, so it never fires.
 * `carrier_event` has neither a list nor the message.
 */
const EVENT_KEYS_WITHOUT_MEAN_TIME: ReadonlySet<string> = new Set([
  "agreement_event",
  "astral_rift_event",
  "bypass_event",
  "cosmic_storm_event",
  "cosmic_storm_influence_field_event",
  "espionage_operation_event",
  "event",
  "first_contact_event",
  "leader_event",
  "situation_event",
  "starbase_event",
  "system_event",
]);

/** The fields of an event that decide which of the checks below apply to it. */
const EVENT_FLAGS: ReadonlySet<string> = new Set([
  "archaeology",
  "astral_rift",
  "diplomatic",
  "espionage_operation",
  "event_window_type",
  "first_contact",
  "hide_window",
  "is_advisor_event",
  "is_test_event",
  "is_triggered_only",
]);

/** The fields of an event the checks below read, as its reader leaves them. */
interface EventState {
  triggered: boolean;
  /** A `mean_time_to_happen` or a `weight_multiplier` was read. */
  timed: boolean;
  /** The `weight_multiplier` that was read, when one was. */
  weight: LoadValue | undefined;
  hidden: boolean;
  test: boolean;
  diplomatic: boolean;
  advisor: boolean;
  archaeology: boolean;
  astralRift: boolean;
  firstContact: boolean;
  espionage: boolean;
  window: string;
  difficulty: number | undefined;
  title: boolean;
  descs: number;
  pictures: number;
  sounds: number;
  options: LoadBlock[];
}

/**
 * What the game logs about an event as it loads it.
 *
 * The event's reader (`0x8e6c70`, `event.cpp`) takes its fields in written
 * order, and three of them depend on it: `mean_time_to_happen` is skipped with
 * `Use 'weight_multiplier' instead` when `is_triggered_only` has already been
 * read as yes (`:1313`), `weight_multiplier` with `Use 'mean_time_to_happen'
 * instead` when it has not (`:1326`), and `is_triggered_only` logs that it
 * `should always come before` them when one was read first (`:1346`).
 *
 * Once the event is read its own check runs (`0x8e85c0`): an event with no
 * mean time that is neither `is_triggered_only` nor `is_test_event` is logged
 * as one that `will try to fire every day` (`:1508`); a `leader_recruit`
 * window needs an option tagged `hire_leader` and one tagged `dismiss_leader`
 * (`:1540`, `:1546`); `diplomatic = yes` with `event_window_type =
 * leader_story` is a `forbidden combination` (`:1553`); only an astral rift
 * event may set a `difficulty`, and each one must (`:1561`, `:1566`); and an
 * archaeology, espionage, first contact, astral rift or `leader_recruit` event
 * that is shown needs a `show_sound` (`:1498`).
 *
 * Then the manager's (`0x3f3d30`, `eventmanager.cpp`): a hidden event `has
 * options even though it's marked as hidden` (`:476`); one that is shown `is
 * missing a title` unless it is an advisor's (`:446`), `is missing a desc`
 * (`:452`), `has no pictures` unless it is diplomatic or an advisor's (`:458`)
 * and `has no options` (`:464`); and one that is `is_triggered_only` with a
 * `weight_multiplier` whose own factor is not 1 `does not have a 1
 * base-factor` (`:483`). Every one of vanilla's 75 `weight_multiplier` blocks
 * writes `factor = 1` first.
 *
 * An option (`0xa23dc0`, `eventoption.cpp:538`) `cannot have both trigger and
 * exclusive_trigger`. The two are not asked the same thing: reading
 * `exclusive_trigger` sets a flag whatever its block holds (`+0x4ec`), and the
 * check asks for that flag and for a `trigger` holding at least one condition
 * (the count at `+0x1f4`). So an empty `exclusive_trigger` beside a `trigger`
 * that says something is logged, and an empty `trigger` beside either is not.
 *
 * An event that inherits from another with `base` copies what the other read,
 * so nothing is said about one; nor about one holding script this cannot see.
 */
function eventChecks(id: string, body: LoadBlock, rootKey: string): readonly LoadFinding[] {
  const key: string = rootKey.toLowerCase();

  if (body.open || valuesOf(body, "base").length > 0) {
    return [];
  }

  const findings: LoadFinding[] = [];
  const state: EventState = {
    triggered: false,
    timed: false,
    weight: undefined,
    hidden: false,
    test: false,
    diplomatic: false,
    advisor: false,
    archaeology: false,
    astralRift: false,
    firstContact: false,
    espionage: false,
    window: "default",
    difficulty: undefined,
    title: false,
    descs: 0,
    pictures: 0,
    sounds: 0,
    options: [],
  };

  for (const entry of body.entries) {
    const field: string | undefined = entry.key?.toLowerCase();
    const value: LoadValue = entry.value;

    if (field === undefined) {
      continue;
    }

    // A flag only the game can work out leaves the event's kind unknown: `@x`
    // or `$PARAM$` where yes or no belongs. Any other field may hold what it
    // likes — vanilla's astral rift events write `difficulty = @…`, and a
    // `location` is as often an `event_target:` as not.
    if (EVENT_FLAGS.has(field) && (value.kind !== "scalar" || isIndirect(value.text))) {
      return [];
    }

    switch (field) {
      case "is_triggered_only":
        state.triggered = isYes(value);
        if (state.timed) {
          findings.push({
            code: "mismatched-event-trigger",
            path: "is_triggered_only",
            message: `is_triggered_only is written after the event's mean_time_to_happen or weight_multiplier, and the game reads an event's fields in order: it logs "'is_triggered_only' should always come before 'mean_time_to_happen' or 'weight_multiplier'" for ${id}. Write is_triggered_only first.`,
          });
        }
        break;
      case "mean_time_to_happen":
        if (state.triggered) {
          findings.push({
            code: "mismatched-event-trigger",
            path: "mean_time_to_happen",
            message: `${id} is is_triggered_only, and the game does not read mean_time_to_happen in such an event: it logs "Use 'weight_multiplier' instead of 'mean_time_to_happen'" and skips the block.`,
          });
        } else {
          state.timed = true;
        }
        break;
      case "weight_multiplier":
        if (state.triggered) {
          state.timed = true;
          state.weight = value;
        } else {
          findings.push({
            code: "mismatched-event-trigger",
            path: "weight_multiplier",
            message: `${id} is not is_triggered_only where weight_multiplier is written, and the game reads weight_multiplier only in an event that is: it logs "Use 'mean_time_to_happen' instead of 'weight_multiplier'" and skips the block. If the event is triggered, write is_triggered_only = yes before it.`,
          });
        }
        break;
      case "hide_window":
        state.hidden = isYes(value);
        break;
      case "is_test_event":
        state.test = isYes(value);
        break;
      case "diplomatic":
        state.diplomatic = isYes(value);
        break;
      case "is_advisor_event":
        state.advisor = isYes(value);
        break;
      case "archaeology":
        state.archaeology = isYes(value);
        break;
      case "astral_rift":
        state.astralRift = isYes(value);
        break;
      case "first_contact":
        state.firstContact = isYes(value);
        break;
      case "espionage_operation":
        state.espionage = isYes(value);
        break;
      case "event_window_type":
        state.window = scalarOf(value)?.toLowerCase() ?? "default";
        break;
      case "difficulty":
        state.difficulty = value.kind === "scalar" && /^-?\d+$/u.test(value.text) ? Number(value.text) : undefined;
        break;
      case "title":
        state.title = value.kind !== "scalar" || value.text.length > 0;
        break;
      case "desc":
        state.descs += 1;
        break;
      case "picture":
        state.pictures += 1;
        break;
      case "show_sound":
        state.sounds += 1;
        break;
      case "option":
        if (value.kind === "block") {
          state.options.push(value);
        }
        break;
      default:
        break;
    }
  }

  const shownSpecially: boolean =
    state.archaeology || state.espionage || state.firstContact || state.astralRift || state.window === "leader_recruit";

  if (shownSpecially && !state.hidden && state.sounds === 0) {
    findings.push({
      code: "incomplete-event",
      path: "",
      message: `${id} is ${state.window === "leader_recruit" ? "a leader_recruit" : "an archaeology, espionage, first contact or astral rift"} event with no show_sound, and the game logs "Event ${id} is missing a sound" for one that is shown.`,
    });
  }

  if (!state.triggered && !state.test) {
    if (EVENT_KEYS_WITHOUT_MEAN_TIME.has(key)) {
      findings.push({
        code: "untriggered-event",
        path: "",
        message: `${id} is written as ${rootKey} and is not is_triggered_only. The game fires only country, planet, colony, ship, fleet, pop, pop group, pop faction and observer events by mean time: it logs "event ${id} must be is_triggered_only, MTTH is not enabled" and never fires this one. Write is_triggered_only = yes and fire it from an on_action or another event.`,
      });
    } else if (!state.timed) {
      findings.push({
        code: "untriggered-event",
        path: "",
        message: `${id} has neither is_triggered_only = yes nor a mean_time_to_happen, so the game tries to fire it every day for every ${key.replace(/_event$/u, "").replaceAll("_", " ")}, and logs that it "will try to fire every day". Write is_triggered_only = yes if something fires it, or mean_time_to_happen = { days = 1 } if every day is meant.`,
      });
    }
  }

  if (state.window === "leader_recruit") {
    const tags: readonly string[] = state.options.flatMap((option) =>
      option.open ? ["hire_leader", "dismiss_leader"] : valuesOf(option, "tag").map((tag) => scalarOf(tag) ?? ""),
    );
    for (const tag of ["hire_leader", "dismiss_leader"]) {
      if (!tags.some((written) => written.toLowerCase() === tag)) {
        findings.push({
          code: "incomplete-event",
          path: "option",
          message: `${id} is a leader_recruit event with no option written tag = ${tag}, and the game logs that it "is missing an option with 'tag = ${tag}', which is required for the leader_recruit event type".`,
        });
      }
    }
  } else if (state.window === "leader_story" && state.diplomatic) {
    findings.push({
      code: "conflicting-fields",
      path: "event_window_type",
      message: `${id} writes diplomatic = yes with event_window_type = leader_story, which the game logs as a "forbidden combination".`,
    });
  }

  if (state.difficulty !== undefined && state.difficulty >= 0 && !state.astralRift) {
    findings.push({
      code: "conflicting-fields",
      path: "difficulty",
      message: `${id} sets a difficulty and is not an astral rift event. The game logs "Only Astral Rifts events support difficulty".`,
    });
  } else if (state.astralRift && (state.difficulty === undefined || state.difficulty < 0)) {
    // None written, or a number below zero, which is what the game holds for
    // none. A name only the game can work out, `@astral_rift_…`, is left alone.
    if (valuesOf(body, "difficulty").length === 0 || state.difficulty !== undefined) {
      findings.push({
        code: "incomplete-event",
        path: "",
        message: `${id} is an astral rift event with no difficulty, and the game logs "Astral Rift events must have a difficulty".`,
      });
    }
  }

  if (state.hidden) {
    if (state.options.length > 0) {
      findings.push({
        code: "hidden-event-options",
        path: "option",
        message: `${id} is hide_window = yes and has ${state.options.length === 1 ? "an option" : "options"}. Nobody is shown them, and the game logs "Event ${id} has options even though it's marked as hidden!"; what a hidden event does goes in immediate.`,
      });
    }
  } else {
    const missing: string[] = [];
    if (!state.title && !state.advisor) {
      missing.push("a title");
    }
    if (state.descs === 0) {
      missing.push("a desc");
    }
    if (state.pictures === 0 && !state.diplomatic && !state.advisor) {
      missing.push("a picture");
    }
    if (state.options.length === 0 && valuesOf(body, "option").length === 0) {
      missing.push("an option");
    }
    if (missing.length > 0) {
      findings.push({
        code: "incomplete-event",
        path: "",
        message: `${id} opens a window and has no ${missing.map((part) => part.replace(/^an? /u, "")).join(", no ")}. The game logs each part it misses ("Event ${id} is missing a title", "has no pictures", "has no options"); write hide_window = yes for an event that only runs its immediate.`,
      });
    }
  }

  if (state.triggered && state.weight?.kind === "block" && !state.weight.open) {
    const factor: string | undefined = valuesOf(state.weight, "factor")
      .map(scalarOf)
      .find((text) => text !== undefined);
    if (factor !== undefined && /^-?\d*\.?\d+$/u.test(factor) && Number(factor) !== 1) {
      findings.push({
        code: "mismatched-event-trigger",
        path: "weight_multiplier",
        message: `weight_multiplier starts from factor = ${factor}, and the game logs that a triggered event "does not have a 1 base-factor". Write factor = 1 and scale it in a modifier, as every weight_multiplier in the base game does.`,
      });
    }
  }

  for (const option of state.options) {
    if (option.open || valuesOf(option, "exclusive_trigger").length === 0) {
      continue;
    }
    if (valuesOf(option, "trigger").some((trigger) => trigger.kind === "block" && trigger.entries.length > 0)) {
      findings.push({
        code: "conflicting-fields",
        path: "option",
        message: `The option ${scalarOf(valuesOf(option, "name")[0]) ?? "with no name"} has both trigger and exclusive_trigger. The game logs "event option cannot have both trigger and exclusive_trigger"; write the conditions in one of them.`,
      });
    }
  }

  return findings;
}

/**
 * A building in no set.
 *
 * The building's check (`0x46c9f0`, `building_type.cpp:762`) logs `Building
 * '%s' is lacking the building_sets definition.` for one whose
 * `building_sets` holds nothing (the count at `+0x18e4` of the list its
 * reader fills at `+0x18d0`) and whose `owner_type` is the default: `0x337b70`
 * reads `corporate`, `subject_holding` and `none` as kinds of their own, and
 * `normal` or any other word as the default. A zone takes buildings by set —
 * `included_building_sets = { research unity origin }` — so a building in
 * none is one no zone's slots admit. Every building of the base game is in a
 * set or is a branch office's or an overlord's holding.
 */
function buildingSets(id: string, body: LoadBlock): readonly LoadFinding[] {
  if (body.open) {
    return [];
  }

  const owner: LoadValue | undefined = valuesOf(body, "owner_type").at(-1);

  if (owner !== undefined) {
    const kind: string | undefined = scalarOf(owner)?.toLowerCase();
    if (
      kind === undefined ||
      isIndirect(kind) ||
      kind === "corporate" ||
      kind === "subject_holding" ||
      kind === "none"
    ) {
      return [];
    }
  }

  const sets: readonly LoadValue[] = valuesOf(body, "building_sets");

  // A list this cannot read, or one that holds something, is not an empty one.
  if (sets.some((set) => set.kind !== "block" || set.open || set.entries.length > 0)) {
    return [];
  }

  return [
    {
      code: "missing-building-sets",
      path: sets.length === 0 ? "" : "building_sets",
      message: `${id} is in no building set, and the game logs "Building '${id}' is lacking the building_sets definition." A zone admits buildings by set (included_building_sets), so name the sets it belongs to, as the base game's laboratories write building_sets = { research }.`,
    },
  ];
}

/**
 * A building's icon, and its category.
 *
 * A building is drawn by a file, not by a sprite: its reader turns `icon = x`
 * into `gfx/interface/icons/buildings/x.dds` as it reads the key (`0x468a20`),
 * and a building that names none gets the same path with its own key in it
 * (`0x46cb40`). That check then asks the file system for the path and logs
 * `Building … is missing texture …` for one that is not there
 * (`building_type.cpp:844`), and the building is drawn with the default icon.
 *
 * The same check logs `No category assigned to building type …` (`:830`) for
 * one whose `category` was never read. Each of the base game's buildings has
 * its file and its category.
 */
function buildingIcon(id: string, body: LoadBlock, context: LoadCheckContext): readonly LoadFinding[] {
  if (body.open) {
    return [];
  }

  const findings: LoadFinding[] = [];

  if (valuesOf(body, "category").length === 0) {
    findings.push({
      code: "missing-category",
      path: "",
      message: `${id} has no category, and the game logs "No category assigned to building type ${id}". Write the category the build menu lists it under, as the base game's laboratories write category = research.`,
    });
  }

  if (context.fileExists === undefined) {
    return findings;
  }

  const written: readonly LoadValue[] = valuesOf(body, "icon");
  const icon: string | undefined = scalarOf(written.at(-1));

  if (written.length > 0 && (icon === undefined || isIndirect(icon))) {
    return findings;
  }

  const path: string = `gfx/interface/icons/buildings/${icon ?? id}.dds`;

  if (!isIndirect(id) && !context.fileExists(path)) {
    findings.push({
      code: "missing-file",
      path: icon === undefined ? "" : "icon",
      message:
        icon === undefined
          ? `${id} names no icon, so the game draws it with ${path}, and neither the base game nor this mod ships that file. It logs "Building ${id} is missing texture ${path}" and shows the default icon. Ship the file with mod.asset(), or name a building's icon that exists: icon = building_research_lab_1.`
          : `icon = ${icon} is drawn from ${path}, and neither the base game nor this mod ships that file. The game logs "Building ${id} is missing texture ${path}" and shows the default icon. An icon is the name of a file in gfx/interface/icons/buildings, without its extension.`,
    });
  }

  return findings;
}

/**
 * A district with no zone slots.
 *
 * The district's check (`0x48d620`, `district_type.cpp:451`) logs `District
 * type is missing zone slots. This will lead to a crash: %s` for one whose
 * `zone_slots` holds nothing: the count at `+0x1064` of the list its reader
 * fills at `+0x1048`. All 147 districts of the base game name their slots.
 */
function districtZoneSlots(id: string, body: LoadBlock): readonly LoadFinding[] {
  if (body.open) {
    return [];
  }

  const slots: readonly LoadValue[] = valuesOf(body, "zone_slots");

  if (slots.some((slot) => slot.kind !== "block" || slot.open || slot.entries.length > 0)) {
    return [];
  }

  return [
    {
      code: "missing-zone-slots",
      path: slots.length === 0 ? "" : "zone_slots",
      message: `${id} has no zone_slots, and the game logs "District type is missing zone slots. This will lead to a crash: ${id}". Name at least one slot, as every district of the base game does.`,
    },
  ];
}

/**
 * A game concept's key.
 *
 * Once `common/game_concepts` is read, each key is searched for `concept_` and
 * one that does not start with it is logged as `Game Concept %s is expected to
 * have "concept_" prefix` (`0x7c9ae0`, `game_concept_type.cpp:256`). The text
 * that names a concept writes the key the same way: `['concept_unity']`.
 */
function conceptPrefix(id: string): readonly LoadFinding[] {
  return id.startsWith("concept_")
    ? []
    : [
        {
          code: "unprefixed-concept",
          path: "",
          message: `${id} does not start with concept_, and the game logs 'Game Concept ${id} is expected to have "concept_" prefix'. Name it concept_${id}.`,
        },
      ];
}

/**
 * A name the executable already uses.
 *
 * A scripted effect is built with its name looked up among the effects the
 * executable registers (`0x851e80`), and one that is found is logged as
 * `scripted effect %s is overwriting an existing effect, rename it`
 * (`scriptedeffect.cpp:33`); a scripted trigger the same way (`0x852990`,
 * `scriptedtrigger.cpp`). A static modifier's name is compared with every
 * modifier the game has defined by then (`0x3720a0`), and one that matches is
 * logged as `Static modifier %s is overwriting an existing modifier, rename
 * it` (`modifier.cpp:3268`). None of the base game's 1,687 scripted effects,
 * 1,684 scripted triggers or 3,080 static modifiers is named so.
 */
function engineNames(type: string, id: string, context: LoadCheckContext): readonly LoadFinding[] {
  if (type === "static_modifier") {
    return context.modifier?.(id) === true
      ? [
          {
            code: "shadows-engine-name",
            path: "",
            message: `${id} is already the name of a modifier, and a static modifier may not take it: the game logs "Static modifier ${id} is overwriting an existing modifier, rename it". A block that writes ${id} = … would no longer mean the modifier.`,
          },
        ]
      : [];
  }

  const family: "effect" | "trigger" = type === "scripted_effect" ? "effect" : "trigger";

  return context.command?.(family, id.toLowerCase()) === true
    ? [
        {
          code: "shadows-engine-name",
          path: "",
          message: `${id} is ${family === "effect" ? "an effect" : "a trigger"} the game itself provides, and a scripted ${family} may not take its name: the game logs "scripted ${family} ${id} is overwriting an existing ${family}, rename it".`,
        },
      ]
    : [];
}

/** The words a list holds: its values with no key, each a scalar. */
function wordsOf(list: LoadBlock): readonly string[] {
  return list.entries.flatMap((entry) =>
    entry.key === undefined && entry.value.kind === "scalar" ? [entry.value.text] : [],
  );
}

/**
 * An animation's file.
 *
 * The one file a definition names that is not a path from the root of the
 * game folder, and so not one `validate` can look for where it is written:
 * the reader of an asset file joins the name to the directory of the file that declares the
 * animation (`0x1ab7f80`, `assetfactory.cpp:1078`) and asks for that. One it
 * cannot find is logged as `Could not find animation file … (referenced near
 * line … in …)` and the animation is never registered, so a mesh that names
 * it has nothing to play. Every one of the base game's 2,457 animations
 * writes a bare name and sits beside its file.
 */
function animationFile(
  id: string,
  body: LoadBlock,
  context: LoadCheckContext,
  file: string | undefined,
): readonly LoadFinding[] {
  if (context.fileExists === undefined || file === undefined) {
    return [];
  }

  const slash: number = file.lastIndexOf("/");
  const directory: string = slash < 0 ? "" : file.slice(0, slash);
  const findings: LoadFinding[] = [];

  for (const value of valuesOf(body, "file")) {
    const name: string | undefined = scalarOf(value);
    if (name === undefined || name.length === 0 || isIndirect(name)) {
      continue;
    }
    const path: string = directory.length === 0 ? name : `${directory}/${name}`;
    if (context.fileExists(path)) {
      continue;
    }
    findings.push({
      code: "missing-file",
      path: "file",
      message: `file = ${name} is looked for beside the file that declares the animation, as ${path}, and neither the base game nor this mod ships that. The game logs "Could not find animation file ${path}" and never registers ${id}, so a mesh that plays it stands still. Ship the .anim in ${directory.length === 0 ? "the same directory" : directory}, or write this definition to a file beside it.`,
    });
  }

  return findings;
}

/**
 * The animation each state of an entity plays.
 *
 * A state's `animation` is not the name of an animation: it is one of the ids
 * the entity's mesh gives its own, `animation = { id = "idle" type = … }`.
 * As the entity is built (`0xf79700`, `pdx_entity.cpp`) the id is hashed and
 * looked up among the mesh's; one that is not there is logged as `Could not
 * find animation "…" for state "…" in entity "…"` (`:251`), and the state
 * plays nothing — a portrait that stands frozen. Where the mesh declares no
 * animation at all, any state that names one is logged as using an animation
 * the entity `does not have an animated mesh` for (`:266`).
 *
 * The hash is of the bytes as written, so `Idle` is not `idle`. Of the base
 * game's 8,429 entities, 6,346 states name an animation, and every one of
 * them is an id of its entity's mesh.
 */
function entityAnimations(id: string, body: LoadBlock, context: LoadCheckContext): readonly LoadFinding[] {
  if (context.meshAnimations === undefined || body.open) {
    return [];
  }

  const mesh: string | undefined = valuesOf(body, "pdxmesh")
    .map(scalarOf)
    .find((name) => name !== undefined && name.length > 0);

  if (mesh === undefined || isIndirect(mesh)) {
    return [];
  }

  const declared: readonly string[] | undefined = context.meshAnimations(mesh);

  if (declared === undefined) {
    return [];
  }

  const findings: LoadFinding[] = [];

  for (const state of blocksOf(body, "state")) {
    if (state.open) {
      continue;
    }

    const animation: string | undefined = scalarOf(valuesOf(state, "animation")[0]);

    if (animation === undefined || animation.length === 0 || isIndirect(animation) || declared.includes(animation)) {
      continue;
    }

    const name: string = scalarOf(valuesOf(state, "name")[0]) ?? "with no name";

    findings.push({
      code: "unknown-animation",
      path: "state",
      message:
        declared.length === 0
          ? `The state ${name} plays animation = ${animation}, and the mesh ${mesh} declares no animation at all. The game logs "${id}.${name} uses [animation = ${animation}] but the entity does not have an animated mesh!" and the state plays nothing.`
          : `The state ${name} plays animation = ${animation}, which is not an animation id of the mesh ${mesh}: it declares ${someIds(declared)}. A state names one of its mesh's own ids, not an animation. The game logs "Could not find animation "${animation}" for state "${name}" in entity "${id}"" and the state plays nothing.`,
    });
  }

  return findings;
}

/** `idle, attack, death and 4 more`: ids short enough to read. */
function someIds(ids: readonly string[]): string {
  const shown: readonly string[] = ids.slice(0, 6);
  return ids.length > shown.length
    ? `${shown.join(", ")} and ${String(ids.length - shown.length)} more`
    : shown.join(", ");
}

/**
 * What the game logs about a portrait set.
 *
 * Its `conditional_portraits` take one `playable` and one `randomizable`
 * each: a second one read after a first that holds a condition is logged as
 * `Duplicate trigger at …` (`0xa30e10`, `species_conditional_portrait.cpp`,
 * asking the count of the trigger already read).
 *
 * And `uplifted_portraits` is read by position. When a species is uplifted,
 * its portrait's place in `portraits` is looked up and the same place in
 * `uplifted_portraits` taken (`0x44a650`, `species_portrait_set.cpp:244`); a
 * list too short to have that place is logged as `Cannot find corresponding
 * uplifted portrait … The number of portraits is different than the number
 * of uplifted portraits`. The base game's eleven such sets pair them one to
 * one.
 */
function portraitSet(id: string, body: LoadBlock): readonly LoadFinding[] {
  if (body.open) {
    return [];
  }

  const findings: LoadFinding[] = [];

  for (const conditional of blocksOf(body, "conditional_portraits")) {
    if (conditional.open) {
      continue;
    }
    for (const key of ["playable", "randomizable"]) {
      const written: readonly LoadValue[] = valuesOf(conditional, key);
      // The first has to hold a condition for the second to be logged.
      const first: LoadValue | undefined = written[0];
      if (written.length > 1 && first !== undefined && first.kind === "block" && first.entries.length > 0) {
        findings.push({
          code: "duplicate-field",
          path: "conditional_portraits",
          message: `conditional_portraits writes ${key} ${String(written.length)} times. The game reads one condition there and logs "Duplicate trigger" for each one after the first; write the conditions in a single ${key}.`,
        });
      }
    }
  }

  const uplifted: readonly LoadBlock[] = blocksOf(body, "uplifted_portraits");

  if (uplifted.length > 0 && uplifted.every((list) => !list.open)) {
    const portraits: readonly string[] = blocksOf(body, "portraits").flatMap(wordsOf);
    const targets: readonly string[] = uplifted.flatMap(wordsOf);

    if (portraits.length > targets.length && blocksOf(body, "portraits").every((list) => !list.open)) {
      const orphan: string = portraits[targets.length] ?? "";
      findings.push({
        code: "missing-uplifted-portrait",
        path: "uplifted_portraits",
        message: `${id} lists ${String(portraits.length)} portraits and ${String(targets.length)} uplifted_portraits. The two are paired by position, so ${orphan} and every portrait after it has nothing to be uplifted to: the game logs "Cannot find corresponding uplifted portrait for portrait '${orphan}' in species portrait set '${id}'. The number of portraits is different than the number of uplifted portraits".`,
      });
    }
  }

  return findings;
}

/**
 * The species class a block of species names is written under.
 *
 * The key of a block in `common/species_names` is looked up among the
 * species classes as the file is read (`0x3d6f90`, `species.cpp:205`). One
 * that is no species class is logged as `Error: Name list for species … could
 * not be read / Reason: Invalid Species Class!`, and none of the names under
 * it are read. All 19 keys the base game writes are species classes.
 */
function speciesNameClass(id: string, context: LoadCheckContext): readonly LoadFinding[] {
  return isIndirect(id) || context.defines("species_class", id)
    ? []
    : [
        {
          code: "unresolved-reference",
          path: "",
          message: `${id} is written in common/species_names as the species class its names belong to, and neither the base game nor this mod defines a species class of that id. The game logs "Error: Name list for species ${id} could not be read / Reason: Invalid Species Class!" and reads none of the names.`,
        },
      ];
}

/**
 * Two subplans of one name, and a plan's `potential` written twice.
 *
 * A plan and each of its subplans are read by one function (`0xb524c0`,
 * `ai_economic_strategy.cpp`). As it reads a `subplan` it compares the new
 * one's `set_name` with every subplan the plan already holds (`0xb52700`), and
 * one of the same name is logged as `Duplicate AI subplan '%s' found in %s,
 * using the one that ends at %s` (`:3177`), taken out, and the new one put in
 * its place. A subplan that writes no `set_name` has the empty name, which is
 * a name like any other: of several such, the last is the only one left.
 *
 * The same reader logs `Duplicate trigger at %s` (`:3192`) for a `potential`
 * read where the one before it holds a condition, and keeps the second.
 *
 * Each of the base game's six plans names every one of its 126 subplans
 * differently, through the inline scripts it is assembled from.
 */
function economicPlan(id: string, body: LoadBlock): readonly LoadFinding[] {
  const findings: LoadFinding[] = [];

  const read = (plan: LoadBlock, path: string): void => {
    const subplans: readonly Subplan[] | undefined = subplansOf(plan);
    const counted = new Map<string, number>();

    for (const subplan of subplans ?? []) {
      if (!subplan.indirect) {
        counted.set(subplan.name, (counted.get(subplan.name) ?? 0) + 1);
      }
    }

    for (const [name, count] of counted) {
      if (count < 2) {
        continue;
      }
      const which: string = name.length === 0 ? "write no set_name" : `are set_name = ${JSON.stringify(name)}`;
      findings.push({
        code: "duplicate-subplan",
        severity: "error",
        path: path.length === 0 ? "subplan" : `${path}.subplan`,
        message: `${String(count)} subplans of ${id} ${which}. The game keeps the subplans of a plan by name and reads each one in place of the one it already has under the same name${name.length === 0 ? ", and no name is a name like any other" : ""}: only the last of these is left, and the game logs "Duplicate AI subplan '${name}' found in ${id}" for each of the others. Give every subplan a set_name of its own.`,
      });
    }

    const potentials: readonly LoadValue[] = valuesOf(plan, "potential");
    const first: LoadValue | undefined = potentials[0];
    if (potentials.length > 1 && first !== undefined && first.kind === "block" && first.entries.length > 0) {
      findings.push({
        code: "duplicate-field",
        path: path.length === 0 ? "potential" : `${path}.potential`,
        message: `potential is written ${String(potentials.length)} times. The game keeps one and logs "Duplicate trigger" for each one after the first, whose conditions it drops; write the conditions in a single potential.`,
      });
    }

    // A subplan is read by the function that reads a plan, and may hold its own.
    for (const subplan of blocksOf(plan, "subplan")) {
      read(subplan, path.length === 0 ? "subplan" : `${path}.subplan`);
    }
  };

  read(body, "");
  return findings;
}

/**
 * A budget the AI never draws on.
 *
 * Once the budgets are read each is checked against its category (`0xb39a80`,
 * `ai_budget_entry.cpp`). One whose category does not itself write
 * `use_for_ai_budget = yes` is logged as `AI budget entry %s for category %s is
 * unused for AI budgets as that category lacks use_for_ai_budget` (`:47`),
 * and so is an `expenditure` of a resource the category lists under
 * `ai_use_parent_for_resources_expenditure` (`:57`) and an `upkeep` of one it
 * lists under `ai_use_parent_for_resources_upkeep` (`:66`): the category has
 * handed that resource to its parent, and a budget for it is read by nothing.
 *
 * The flag is not inherited. The category's reader sets it from the
 * category's own field (`0x1657f56`), and nothing copies a parent's down.
 * Each of the base game's 200 budgets names a category that says yes.
 */
function aiBudget(id: string, body: LoadBlock, context: LoadCheckContext): readonly LoadFinding[] {
  if (body.open || context.budgetUse === undefined) {
    return [];
  }

  const category: string | undefined = scalarOf(valuesOf(body, "category").at(-1));

  if (category === undefined || isIndirect(category)) {
    return [];
  }

  const use: CategoryBudgetUse | undefined = context.budgetUse(category);

  // No category of that name: the reference to it is what is wrong.
  if (use === undefined) {
    return [];
  }

  if (!use.budget) {
    return [
      {
        code: "unused-ai-budget",
        path: "category",
        message: `category = ${category} is an economic category that does not write use_for_ai_budget = yes, and the AI keeps a budget only for one that does: the game logs "AI budget entry ${id} for category ${category} is unused for AI budgets as that category lacks use_for_ai_budget" and never draws on this one. The flag is the category's own, whatever its parent says.`,
      },
    ];
  }

  const resource: string | undefined = scalarOf(valuesOf(body, "resource").at(-1));
  const type: string | undefined = scalarOf(valuesOf(body, "type").at(-1))?.toLowerCase();
  const handedUp: readonly string[] =
    type === "expenditure" ? use.parentExpenditure : type === "upkeep" ? use.parentUpkeep : [];

  if (resource === undefined || type === undefined || !handedUp.includes(resource)) {
    return [];
  }

  const field: string = `ai_use_parent_for_resources_${type}`;

  return [
    {
      code: "unused-ai-budget",
      path: "category",
      message: `${category} lists ${resource} under ${field}: what it ${type === "upkeep" ? "pays in upkeep" : "spends"} of ${resource} comes out of its parent's budget, and a budget of its own for it is read by nothing. The game logs "AI budget entry ${id} for category ${category} is unused for AI budgets as that category specifies ${field} for ${resource}".`,
    },
  ];
}

/** The definitions the game keeps as text and reads again each time one is used. */
const METASCRIPTS: Readonly<Record<string, string>> = {
  script_value: "script value",
  scripted_effect: "scripted effect",
  scripted_trigger: "scripted trigger",
};

/** Where a character stands with no backslash before it, as `0xafe320` looks for one. */
function unescaped(text: string, character: string): readonly number[] {
  const found: number[] = [];
  let from = 0;

  for (;;) {
    const at: number = text.indexOf(character, from);
    if (at < 0) {
      return found;
    }
    if (at === 0 || text[at - 1] !== "\\") {
      found.push(at);
    }
    from = at + 1;
  }
}

/**
 * A `[` or a `$` the game reads as its own syntax.
 *
 * A scripted effect, a scripted trigger and a script value are not read into
 * effects and triggers when the game loads them. Each is kept as text
 * (`0xafe590`, `metascript.cpp`, built by `0x851e80`, `0x852990` and
 * `0x84fb70`), and turned into script wherever it is used, with the caller's
 * parameters written in. Two characters in that text are the game's:
 *
 * `$`. Each word is searched for `$NAME$` (`0xafef60`): from a `$` to the
 * next one in the same word is a parameter's name. A word with one `$` and no
 * partner gives it the rest of the word as a name, and the search for the next
 * parameter then starts over at the beginning of the same word.
 *
 * `[`. The whole text is searched for `[[NAME] … ]` (`0xaff210`): from a `[`,
 * what follows up to the next `]` is a parameter's name, and what follows that
 * up to the `]` after it is script kept only when the parameter is passed.
 * It does not look whether the `[` is doubled. `log = "x [Root.GetName] y"`
 * therefore opens such a block: with no second `]` anywhere after it the game
 * logs `Invalid macro entry in <name>: oot.GetName` (`:218`), and with one it
 * has a block to drop, and drops the script between the two.
 *
 * Both searches pass over a character with a backslash before it, and the
 * backslash is taken out once the parameters are in (`0xafe930` replaces
 * `\\[`, `\\]`, `\\|` and `\\$`). That is how the base game writes one:
 * `log = "- This: \\\\[This.GetName]"`, the lexer making one backslash of the two,
 * and `@\\[ … ]` for inline maths. Of its 3,371 scripted effects and triggers
 * and its script values, two hold a bare one, and lose script to it without
 * a line in the log: they are listed beside the base game's other mistakes.
 */
function metascript(type: string, id: string, body: LoadBlock): readonly LoadFinding[] {
  const kind: string | undefined = METASCRIPTS[type];

  if (kind === undefined) {
    return [];
  }

  // Every word of the definition in the order the game holds them, and
  // whether all of them are here: a `[[PARAM] … ]` block or inline maths is
  // script this cannot read, with brackets of its own.
  const words: { readonly text: string; readonly path: string }[] = [];
  let whole: boolean = !body.open;

  const read = (block: LoadBlock, path: string): void => {
    for (const entry of block.entries) {
      const here: string = entry.key === undefined ? path : path.length === 0 ? entry.key : `${path}.${entry.key}`;
      if (entry.key !== undefined) {
        words.push({ text: entry.key, path });
      }
      if (entry.value.kind === "scalar") {
        words.push({ text: entry.value.text, path: here });
      } else if (entry.value.kind === "block") {
        whole &&= !entry.value.open;
        read(entry.value, here);
      } else {
        whole = false;
      }
    }
  };

  read(body, "");

  const findings: LoadFinding[] = [];
  const escape: string =
    'Write a literal bracket with a backslash before it, as the base game does: "\\\\[" in TypeScript, which is written \\\\[ in the file and reaches the game as \\[.';

  for (const word of words) {
    if (unescaped(word.text, "$").length % 2 === 1) {
      findings.push({
        code: "unpaired-parameter",
        severity: "error",
        path: word.path,
        message: `${JSON.stringify(word.text)} holds a $ with no partner, and in a ${kind} a $ opens the name of a parameter that the next $ in the same word closes. Finding none, the game takes the rest of the word as the name and starts its search for the next parameter over from the beginning of the same word, where the same $ is waiting. Write $NAME$ for a parameter, and a literal dollar with a backslash before it: "\\\\$" in TypeScript.`,
      });
    }
  }

  // The brackets with no backslash before them, in the order the game meets them.
  const brackets: { readonly open: boolean; readonly word: number; readonly at: number }[] = [];
  for (const [index, word] of words.entries()) {
    const found: { open: boolean; at: number }[] = [
      ...unescaped(word.text, "[").map((at) => ({ open: true, at })),
      ...unescaped(word.text, "]").map((at) => ({ open: false, at })),
    ].sort((left, right) => left.at - right.at);
    brackets.push(...found.map((bracket) => ({ ...bracket, word: index })));
  }

  const reads: string = `in a ${kind} every [ is the start of [[PARAMETER] … ] to the game: it takes what follows up to the next ] as a parameter's name and the script from there to the ] after that as script to keep only when that parameter is passed`;

  if (!whole) {
    // Brackets this cannot see stand somewhere among these: which ] the game
    // pairs with which [ is not known, only that it reads each [ as its own.
    for (const word of words) {
      if (unescaped(word.text, "[").length > 0) {
        findings.push({
          code: "invalid-macro-entry",
          severity: "error",
          path: word.path,
          message: `${JSON.stringify(word.text)} holds a [ with no backslash before it, and ${reads}. Finding no second ] it logs "Invalid macro entry in ${id}"; finding one, it cuts everything between the two out without a word. ${escape}`,
        });
      }
    }
    return findings;
  }

  // The game's own search (`0xaff210`): from a [ to the next ], and from
  // there to the ] after it, then on from behind that one.
  let from = 0;

  for (;;) {
    const start: number = brackets.findIndex((bracket, index) => index >= from && bracket.open);
    const opening = brackets[start];
    if (start < 0 || opening === undefined) {
      break;
    }

    const first: number = brackets.findIndex((bracket, index) => index > start && !bracket.open);
    const second: number = first < 0 ? -1 : brackets.findIndex((bracket, index) => index > first && !bracket.open);
    const word = words[opening.word];
    const nameEnd = brackets[first];
    const end = brackets[second];
    const text: string = word?.text ?? "";
    const name: string =
      nameEnd === undefined
        ? text.slice(opening.at + 2)
        : nameEnd.word === opening.word
          ? text.slice(opening.at + 2, nameEnd.at)
          : `${text.slice(opening.at + 2)} …`;

    if (end === undefined) {
      findings.push({
        code: "invalid-macro-entry",
        severity: "error",
        path: word?.path ?? "",
        message: `${JSON.stringify(text)} holds a [ with no backslash before it, and ${reads}. Here the name it reads is ${JSON.stringify(name)}, and there is no second ] after it in ${id}: the game logs "Invalid macro entry in ${id}: ${name}". ${escape}`,
      });
      break;
    }

    const closing = words[end.word];
    const cut: string =
      end.word === opening.word
        ? JSON.stringify(text.slice(opening.at, end.at + 1))
        : `everything from this [ to the ] in ${JSON.stringify(closing?.text ?? "")}${closing === undefined || closing.path === word?.path ? "" : ` at ${closing.path}`}, whatever stands between them`;

    findings.push({
      code: "invalid-macro-entry",
      severity: "error",
      path: word?.path ?? "",
      message: `${JSON.stringify(text)} holds a [ with no backslash before it, and ${reads}. Here the name it reads is ${JSON.stringify(name)}, and the script it keeps for a caller that passes that name, and cuts out for every other, is ${cut}. Nothing is logged. ${escape}`,
    });

    from = second + 1;
  }

  return findings;
}

/**
 * What the game logs about the fleet actions a definition queues.
 *
 * A trigger or an effect inside `queue_actions` has to be found again when a
 * saved game is loaded, and is kept by its `id`. The reader of a `find_…`
 * action's `trigger` and of a `repeat`'s `while` (`0xe8aca0`,
 * `fleet_actions.cpp:181`) logs `Trigger has no ID or ID is not unique! All
 * triggers and effects within fleet actions needs a unique ID for save games
 * to work.` for a block that writes none, and the reader of an `effect`
 * action (`0xe8ccb0`, `:793`) the same of an effect. Every one of the 322 the
 * base game queues has its id.
 *
 * And `merge_fleet` cannot be given a target without a line in the log. Its
 * reader (`0xe94160`) reads `target` and then, where the reader of
 * `attack_fleet` beside it returns (`0xe93440`), goes on into the case below
 * it and reads the same word as the yes or no of `allow_ftl`: `Malformed
 * token: event_target:x`, logged at `:235`, whatever the target is. The
 * target has been taken by then. The base game never writes the action.
 */
function fleetActions(body: LoadBlock): readonly LoadFinding[] {
  const facts = fleetActionFacts(body);
  const findings: LoadFinding[] = [];

  for (const missing of facts.missing) {
    findings.push({
      code: "missing-script-id",
      severity: "error",
      path: missing.path,
      message:
        missing.family === "effect"
          ? `This effect is queued for a fleet and has no id. The game keeps an effect inside queue_actions by an id of its own, so that a saved game can find it again, and logs "Effect has no ID or ID is not unique! An effect in a queue_action needs a unique ID for save games to work." for one that has none. Write id = "…" in the block: a name no other effect in the game has.`
          : `The ${missing.path.split(".").at(-1) ?? "trigger"} of ${missing.action} has no id. The game keeps every trigger inside queue_actions by an id of its own, so that a saved game can find it again, and logs "Trigger has no ID or ID is not unique! All triggers and effects within fleet actions needs a unique ID for save games to work." for one that has none. Write id = "…" in the block: a name no other trigger in the game has.`,
    });
  }

  for (const merge of facts.mergeTargets) {
    if (isIndirect(merge.target) && !merge.target.includes(":")) {
      continue;
    }
    findings.push({
      code: "malformed-token",
      path: merge.path,
      message: `merge_fleet = { target = ${merge.target} } is logged as "Malformed token: ${merge.target}", whatever the target is. The game's reader of merge_fleet takes the target and then reads the same word again as the yes or no of allow_ftl, where the reader of attack_fleet stops; there is no spelling of a target it reads without the line, and the base game never writes the action.`,
    });
  }

  return findings;
}

/**
 * Everything the game's loader would log about one definition, by the checks
 * above.
 *
 * `type` is the definition type's id, `id` the definition's, and `rootKey` the
 * key it is written under: its tag for a tagged type, which is what says an
 * event is a `country_event`. `file` is the file the definition is written to,
 * from the root of the game folder, for the checks that resolve a name against
 * it.
 */
export function loadChecks(
  type: string,
  id: string,
  body: LoadBlock,
  context: LoadCheckContext,
  rootKey: string = id,
  file?: string,
): readonly LoadFinding[] {
  return [
    ...typeChecks(type, id, body, context, rootKey, file),
    ...fleetActions(body),
    ...policyOptions(body, context),
  ];
}

/**
 * An option given with a policy it is not an option of.
 *
 * `set_policy = { policy = … option = … }` and `can_set_policy` name a policy
 * and one of its options. An option is written inside its policy, and is one
 * of that policy's: `weapon_preference_kinetic` is an option, and no option
 * of `economic_policy`. Each of the 275 pairs the base game writes names an
 * option of the policy beside it.
 */
function policyOptions(body: LoadBlock, context: LoadCheckContext): readonly LoadFinding[] {
  const options = context.policyOptions;

  if (options === undefined) {
    return [];
  }

  const findings: LoadFinding[] = [];

  const read = (block: LoadBlock, path: string): void => {
    for (const entry of block.entries) {
      if (entry.value.kind !== "block") {
        continue;
      }
      const here: string = entry.key === undefined ? path : path.length === 0 ? entry.key : `${path}.${entry.key}`;
      const key: string | undefined = entry.key?.toLowerCase();

      if ((key === "set_policy" || key === "can_set_policy") && !entry.value.open) {
        const policy: string | undefined = scalarOf(valuesOf(entry.value, "policy").at(-1));
        const option: string | undefined = scalarOf(valuesOf(entry.value, "option").at(-1));
        const held: readonly string[] | undefined =
          policy === undefined || isIndirect(policy) ? undefined : options(policy);

        if (
          held !== undefined &&
          policy !== undefined &&
          option !== undefined &&
          !isIndirect(option) &&
          !held.includes(option)
        ) {
          const owner: string | undefined = context
            .ids("policy")
            .find((other) => options(other)?.includes(option) === true);
          findings.push({
            code: "unknown-policy-option",
            path: here,
            message: `option = ${option} is ${owner === undefined ? "no option" : `an option of ${owner}, and none`} of ${policy}, whose options are ${held.join(", ")}. An option is one of the policy it is written in, and ${entry.key ?? key} looks for it there.`,
          });
        }
      }

      read(entry.value, here);
    }
  };

  read(body, "");
  return findings;
}

/** The checks of one type; a definition of any type may queue fleet actions. */
function typeChecks(
  type: string,
  id: string,
  body: LoadBlock,
  context: LoadCheckContext,
  rootKey: string,
  file: string | undefined,
): readonly LoadFinding[] {
  switch (type) {
    case "economic_plan":
      return economicPlan(id, body);
    case "ai_budget":
      return aiBudget(id, body, context);
    case "script_value":
      return metascript(type, id, body);
    case "model_animation":
      return animationFile(id, body, context, file);
    case "model_entity":
      return entityAnimations(id, body, context);
    case "portrait_set":
      return portraitSet(id, body);
    case "species_name":
      return speciesNameClass(id, context);
    case "building":
      return [...buildingSets(id, body), ...buildingIcon(id, body, context)];
    case "concept":
      return conceptPrefix(id);
    case "district":
      return districtZoneSlots(id, body);
    case "event":
      return eventChecks(id, body, rootKey);
    case "scripted_effect":
    case "scripted_trigger":
      return [...engineNames(type, id, context), ...metascript(type, id, body)];
    case "static_modifier":
      return engineNames(type, id, context);
    case "ship_size":
      return shipSizeEntity(id, body, context);
    case "megastructure":
      return megastructureOutlinerIcon(id, body, context);
    case "situation_type":
      return [...situationApproaches(body), ...situationOutcomes(id, body), ...weightDescriptions(type, body)];
    default:
      return weightDescriptions(type, body);
  }
}

/**
 * The definition types that have a check of their own. A definition of any
 * type is read for the fleet actions it queues, so this is not a list of the
 * types worth reading.
 */
export const loadCheckedTypes: ReadonlySet<string> = new Set([
  "ai_budget",
  "building",
  "concept",
  "district",
  "economic_plan",
  "event",
  "megastructure",
  "model_animation",
  "model_entity",
  "portrait_set",
  "script_value",
  "scripted_effect",
  "scripted_trigger",
  "ship_size",
  "situation_type",
  "species_name",
  "static_modifier",
  ...Object.keys(DESCRIBED_WEIGHTS),
]);
