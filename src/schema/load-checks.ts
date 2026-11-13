import { NodeKind, type EntryNode, type Scalar } from "../syntax/index.js";
import type { SchemaModel } from "./ir.js";

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
 * The effects or the triggers the executable registers by name: every command
 * the schema declares under its own name. The ones declared by a construct
 * instead, a call to a scripted effect or a scope to enter, are no command of
 * the executable's.
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
        .map((command) => command.id),
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
   * `missing-zone-slots` for a district the game says will crash it;
   * `unprefixed-concept` for a game concept not named `concept_…`.
   */
  readonly code:
    | "conflicting-fields"
    | "hidden-event-options"
    | "incomplete-event"
    | "mismatched-event-trigger"
    | "missing-building-sets"
    | "missing-description"
    | "missing-zone-slots"
    | "shadows-engine-name"
    | "unprefixed-concept"
    | "unresolved-reference"
    | "untriggered-event";
  /** Where inside the definition, dotted. Empty for the definition itself. */
  readonly path: string;
  readonly message: string;
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
 * exclusive_trigger`: `exclusive_trigger` is read apart from `trigger`
 * (`+0x240` and `+0x168`), and the check asks whether both hold anything.
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
    if (valuesOf(body, "difficulty").length === 0) {
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

  return context.command?.(family, id) === true
    ? [
        {
          code: "shadows-engine-name",
          path: "",
          message: `${id} is ${family === "effect" ? "an effect" : "a trigger"} the game itself provides, and a scripted ${family} may not take its name: the game logs "scripted ${family} ${id} is overwriting an existing ${family}, rename it".`,
        },
      ]
    : [];
}

/**
 * Everything the game's loader would log about one definition, by the checks
 * above.
 *
 * `type` is the definition type's id, `id` the definition's, and `rootKey` the
 * key it is written under: its tag for a tagged type, which is what says an
 * event is a `country_event`.
 */
export function loadChecks(
  type: string,
  id: string,
  body: LoadBlock,
  context: LoadCheckContext,
  rootKey: string = id,
): readonly LoadFinding[] {
  switch (type) {
    case "building":
      return buildingSets(id, body);
    case "concept":
      return conceptPrefix(id);
    case "district":
      return districtZoneSlots(id, body);
    case "event":
      return eventChecks(id, body, rootKey);
    case "scripted_effect":
    case "scripted_trigger":
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

/** The definition types any check reads, for a caller that wants to skip the rest. */
export const loadCheckedTypes: ReadonlySet<string> = new Set([
  "building",
  "concept",
  "district",
  "event",
  "megastructure",
  "scripted_effect",
  "scripted_trigger",
  "ship_size",
  "situation_type",
  "static_modifier",
  ...Object.keys(DESCRIBED_WEIGHTS),
]);
