import { NodeKind, type EntryNode, type Scalar } from "../syntax/index.js";

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
}

export interface LoadFinding {
  /**
   * `unresolved-reference` for a name the game builds and cannot find;
   * `missing-description` for a block the game says will not display well.
   */
  readonly code: "missing-description" | "unresolved-reference";
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

/**
 * Everything the game's loader would log about one definition, by the checks
 * above.
 *
 * `type` is the definition type's id and `id` the definition's.
 */
export function loadChecks(
  type: string,
  id: string,
  body: LoadBlock,
  context: LoadCheckContext,
): readonly LoadFinding[] {
  switch (type) {
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
  "megastructure",
  "ship_size",
  "situation_type",
  ...Object.keys(DESCRIBED_WEIGHTS),
]);
