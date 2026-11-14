import {
  anyKey,
  anyValue,
  between,
  block,
  effectEntries,
  field,
  item,
  literal,
  modifierEntries,
  modifierRuleEntries,
  numericKey,
  occurs,
  oneOf,
  primitive,
  replaceScope,
  ruleSetEntries,
  scriptValue,
  triggerEntries,
  typeKey,
  typeRef,
  whenVariant,
} from "./ir.js";
import { DefinitionTypeId, ScopeId } from "./catalog.js";
import { vanillaFieldCorrections, vanillaOptionalFields } from "./vanilla-corrections.js";
import type { DefinitionType, EntryRule } from "./ir.js";

/**
 * Fields vanilla uses that the ported corpus never declared.
 *
 * These live outside `definitions/` on purpose. That directory is rewritten
 * wholesale by `npm run import:cwt -- --emit`, so a correction placed there is
 * one careless re-import away from vanishing — and it would only be missed on a
 * machine that has the game installed to run `verify:conformance` against.
 *
 * Each entry names where it came from. Delete one only when upstream declares
 * the field itself.
 */
export const definitionCorrections: Readonly<Record<string, readonly EntryRule[]>> = {
  // vanilla 4.4.6: common/alerts.txt
  alert: [
    field("icon", typeRef("sprite"), occurs.optional),
    field("priority", oneOf(literal("HIGH"), literal("MEDIUM"), literal("LOW")), occurs.optional),
    field("alert_setting_key", primitive("localisation"), occurs.optional),
  ],
  // vanilla 4.4.6: common/colony_automation_exceptions/00_crisis_exceptions.txt
  colony_automation_exception: [
    field("available", block([triggerEntries()]), occurs.one),
    field(
      "buildings",
      block([
        field(
          anyKey(),
          block([
            field("building", typeRef("building"), occurs.one),
            field("available", block([triggerEntries()]), occurs.optional),
            field("upgrade_trigger", block([triggerEntries()]), occurs.optional),
          ]),
          occurs.oneOrMore,
        ),
      ]),
      occurs.optional,
    ),
    field("category", primitive("scalar"), occurs.one),
    field("emergency", primitive("boolean"), occurs.optional),
    field("empire_wide_emergency", primitive("boolean"), occurs.optional),
    field(
      "job_changes",
      block([
        field(
          anyKey(),
          block([
            field("available", block([triggerEntries()]), occurs.optional),
            field("job", typeRef("job"), occurs.one),
            field("amount", primitive("integer"), occurs.one),
          ]),
          occurs.oneOrMore,
        ),
      ]),
      occurs.optional,
    ),
    field("prio_districts", block([item(typeRef("district"), occurs.any)]), occurs.optional),
    field("should_ai_use_job_micro", primitive("boolean"), occurs.optional),
  ],
  // vanilla 4.4.6: interface/paragon_ui_types.gui; the reusable block is a containerWindowType body.
  Paragon_UI_NAME_type: [
    field("name", primitive("scalar"), occurs.one),
    field("clipping", primitive("boolean"), occurs.optional),
    field("fade_time", primitive("integer"), occurs.optional),
    ruleSetEntries("gui_background"),
    ruleSetEntries("gui"),
    ruleSetEntries("gui_button"),
    ruleSetEntries("gui_standard_element"),
  ],
  // vanilla 4.4.6: common/governments/civics; standalone view of each nested swap_type block.
  swapped_civic: [
    whenVariant("localised", [field("name", primitive("scalar"), occurs.one)]),
    field("name", primitive("scalar"), occurs.optional),
    field("description", primitive("localisation"), occurs.optional),
    field("negative_description", primitive("localisation"), occurs.optional),
    field("trigger", block([triggerEntries()]), occurs.one),
    field("modifier", block([modifierEntries()]), occurs.optional),
  ],
  // vanilla 4.4.6: common/traditions; standalone view of each nested tradition_swap block.
  tradition_swap: [
    field("name", primitive("scalar"), occurs.optional),
    field("inherit_icon", primitive("boolean"), occurs.optional),
    field("inherit_name", primitive("boolean"), occurs.optional),
    field("inherit_effects", primitive("boolean"), occurs.optional),
    field("custom_tooltip", primitive("localisation"), occurs.any),
    field("custom_tooltip_with_modifiers", primitive("localisation"), occurs.any),
    field("unlocks_agenda", typeRef("council_agenda"), occurs.optional),
    field(
      "modifier",
      block([
        field("description", primitive("localisation"), occurs.optional),
        field("description_parameters", block([field(anyKey(), primitive("number"), occurs.any)]), occurs.optional),
        modifierEntries(),
        field("custom_tooltip", primitive("localisation"), occurs.any),
        field("show_only_custom_tooltip", primitive("boolean"), occurs.any),
      ]),
      occurs.optional,
      { scope: replaceScope({ root: ScopeId.Country }) },
    ),
    field("on_enabled", block([effectEntries()]), occurs.optional, {
      scope: replaceScope({ root: ScopeId.Country }),
    }),
    field("weight", block([modifierRuleEntries()]), occurs.optional, {
      scope: replaceScope({ root: ScopeId.Country }),
    }),
    field("trigger", block([triggerEntries()]), occurs.optional, {
      scope: replaceScope({ root: ScopeId.Country }),
    }),
    field(
      "triggered_modifier",
      block([
        field("potential", block([triggerEntries()]), occurs.optional),
        modifierEntries(),
        field("mult", scriptValue("number"), occurs.optional),
      ]),
      occurs.any,
      { scope: replaceScope({ root: ScopeId.Country }) },
    ),
  ],
  // vanilla 4.4.6: common/traits/03_species_traits_presapients.txt
  trait: [
    field(
      "forced_integration",
      block([
        field("integration_rate", primitive("number"), occurs.optional),
        field("minimum_colony_age", primitive("integer"), occurs.optional),
      ]),
      occurs.optional,
    ),
  ],
  // vanilla 4.4.6: events/nomads_events_1.txt, paired with notification_event_icon
  event: [field("notification_event_icon_frame", primitive("integer"), occurs.optional)],
  // vanilla 4.4.6: common/special_projects. `triggered_requirement` pairs a
  // requirement with the trigger that makes it apply; `situation_log_category`
  // files the project in the log.
  special_project: [
    field(
      "triggered_requirement",
      block([
        field("trigger", block([triggerEntries()]), occurs.optional),
        field("potential", block([triggerEntries()]), occurs.optional),
        field(anyKey(), anyValue(), occurs.any),
      ]),
      occurs.any,
    ),
    field("situation_log_category", primitive("scalar"), occurs.optional),
  ],
  // vanilla 4.4.6: 36 uses in common/star_classes/00_star_classes.txt
  star_class: [field("arkship_picture", primitive("scalar"), occurs.optional)],
  // vanilla 4.5.2: common/megastructures/99_README_MEGASTRUCTURES.txt documents
  // it as a trigger, scope fleet, from country. Vanilla's one use is commented
  // out, so reading vanilla's script alone stopped finding it.
  megastructure: [
    field("build_menu_potential", block([triggerEntries()]), occurs.optional),
    // 4.5.2 executable, the megastructure reader (`0xd42150`): two flags read as
    // yes or no, the two dismantle effects beside `on_dismantle_complete`, two
    // modifier blocks beside `station_modifier`, and a number. Vanilla writes
    // none of them, so reading vanilla never found them.
    field("can_prevent_crisis_terraformation", primitive("boolean"), occurs.optional),
    field("generate_borders", primitive("boolean"), occurs.optional),
    field("on_dismantle_start", block([effectEntries()]), occurs.optional),
    field("on_dismantle_cancel", block([effectEntries()]), occurs.optional),
    field("orbit_modifier", block([modifierEntries()]), occurs.optional),
    field("system_modifier", block([modifierEntries()]), occurs.optional),
    field("starbase_capacity_used", primitive("number"), occurs.optional),
  ],
  // 4.5.2 executable, the policy reader (`0x501e90`): a policy's own
  // `prerequisites`, read into the same technology list as an option's.
  policy: [field("prerequisites", block([item(typeRef("technology"), occurs.any)]), occurs.optional)],
  // 4.5.2 executable, the ship size reader (`0xd26c70`). Its
  // `combat_max_speed`, `combat_rotation_speed` and `empire_limit` handlers
  // only log that the key was removed, so those stay unknown.
  ship_size: [
    field("build_speed_mult", primitive("number"), occurs.optional),
    field("encampment_required_progress", primitive("number"), occurs.optional),
    field("can_lead_armada", primitive("boolean"), occurs.optional),
    field("ignore_closed_borders", primitive("boolean"), occurs.optional),
  ],
  // 4.5.2 executable, the situation reader (`0x4e3690`): four strings, read
  // as `override_finisher_desc` and the others vanilla writes are.
  situation_type: [
    field("custom_tooltip", primitive("localisation"), occurs.optional),
    field("custom_tooltip_with_modifiers", primitive("localisation"), occurs.optional),
    field("override_active_desc", primitive("localisation"), occurs.optional),
    field("override_active_title", primitive("localisation"), occurs.optional),
  ],
};

/**
 * The kind of starbase a building or a module belongs on.
 *
 * Not a starbase type and not a megastructure, which is what the corpus read
 * it as: `orbital_ring` happens to be the id of one, and `arkship` and
 * `waystation`, written 129 times, are the id of neither. The executable
 * registers the four words side by side as keywords (`0x191be8` to
 * `0x191c33` in the 4.5.2 keyword table): `starbase`, `orbital_ring`,
 * `arkship`, `waystation`.
 */
function starbaseKind(): EntryRule {
  return field(
    "starbase_type",
    oneOf(literal("starbase"), literal("orbital_ring"), literal("arkship"), literal("waystation")),
    occurs.optional,
  );
}

/**
 * Rules that replace what the corpus says of a key, where what it says is
 * wrong rather than incomplete: every rule the type has for the key goes, and
 * these stand in its place.
 */
export const fieldReplacements: Readonly<Record<string, readonly EntryRule[]>> = {
  starbase_building: [starbaseKind()],
  starbase_module: [starbaseKind()],
};

/** A type's entries with the rules for the replaced keys taken out. */
function withoutReplaced(type: DefinitionType): DefinitionType {
  const replaced: ReadonlySet<string> = new Set(
    (fieldReplacements[type.id] ?? []).flatMap((entry) =>
      entry.kind === "field" && typeof entry.key === "string" ? [entry.key] : [],
    ),
  );

  return replaced.size === 0
    ? type
    : {
        ...type,
        entries: type.entries.filter(
          (entry) => !(entry.kind === "field" && typeof entry.key === "string" && replaced.has(entry.key)),
        ),
      };
}

/**
 * A rule missing from a block *inside* a definition rather than from its body.
 *
 * `policy.option` takes an `ai_weight`; `trait.slave_cost` is a resource cost
 * block and vanilla pays in `trade`. Neither can be expressed as a top-level
 * field, and editing `definitions/` directly would be one `--emit` away from
 * being lost — so the correction names the path it belongs at.
 */
export interface NestedCorrection {
  readonly type: string;
  /**
   * Field keys from the definition body down to the block being corrected.
   * {@link ITEM_BLOCKS} steps into the blocks a list holds with no key.
   */
  readonly path: readonly string[];
  readonly entries: readonly EntryRule[];
  /** Where this came from, so a stale one can be recognised. */
  readonly evidence: string;
}

/**
 * A path step into the keyless blocks of a list.
 *
 * `variants = { { value = { … } trigger = { … } } }` holds its entries as
 * blocks with no key, so no field name reaches inside them.
 */
export const ITEM_BLOCKS = "{}";

/**
 * A path step into the block under a key that is no literal: the name of a
 * situation's stage, a case of a `switch`, a scope.
 *
 * `stages = { my_stage = { … } }` holds each stage under the key of its own
 * name, so no field name reaches inside one either.
 */
export const ANY_KEY = "*";

/**
 * The boolean wrapper vanilla writes around a technology prerequisite list.
 *
 * `prerequisites = { OR = { tech_a tech_b } }` and, once, an `AND` inside that.
 * One level is spelled out and the next left open: nesting deeper is legal and
 * nothing here knows how deep a mod will go.
 */
function prerequisiteLogic(): readonly EntryRule[] {
  return ["OR", "AND", "NOR", "NOT"].map((key) =>
    field(key, block([item(typeRef("technology"), occurs.any), field(anyKey(), anyValue(), occurs.any)]), occurs.any),
  );
}

/**
 * The branches of a triggered description's `switch` case.
 *
 * `desc = { trigger = { switch = { trigger = has_technology tech_x = { if = {
 * limit = { … } text = a } else_if = { … } else = { text = b } } } } }`: a case
 * picks its text with `if`, and the corpus declared the `if` and neither of the
 * two that follow it. The base game writes both, in shroud.5320 among others.
 */
function descriptionBranches(): readonly EntryRule[] {
  return [
    field(
      "else_if",
      block([
        field("limit", block([triggerEntries()]), occurs.one),
        field("text", primitive("localisation"), occurs.one),
      ]),
      occurs.any,
    ),
    field("else", block([field("text", primitive("localisation"), occurs.one)]), occurs.optional),
  ];
}

export const nestedCorrections: readonly NestedCorrection[] = [
  ...(
    [
      ["desc", "trigger", "switch", ANY_KEY],
      ["desc", "trigger", ANY_KEY, "switch", ANY_KEY],
      ["desc", "exclusive_trigger", "switch", ANY_KEY],
      ["desc", "exclusive_trigger", ANY_KEY, "switch", ANY_KEY],
      ["option", "name", "trigger", "switch", ANY_KEY],
      ["option", "name", "trigger", ANY_KEY, "switch", ANY_KEY],
    ] as const
  ).map((path): NestedCorrection => ({
    type: DefinitionTypeId.Event,
    path,
    evidence:
      "vanilla 4.5.2: `else_if` and `else` after the `if` of a description's switch case, e.g. shroud.5320 in events/shroud_events.txt",
    entries: descriptionBranches(),
  })),
  {
    type: DefinitionTypeId.SituationType,
    path: ["stages", ANY_KEY],
    evidence:
      "4.5.2 executable: the stage reader (`0x4e21a0`) takes 14 keys, these four among them; vanilla 4.5.2 writes `color` and `section_weight` in the stages of situation_nomad_economy",
    entries: [
      field("color", typeRef("named_color"), occurs.optional),
      field("section_weight", anyValue(), occurs.optional),
      field("key", primitive("scalar"), occurs.optional),
      field("custom_tooltip_with_modifiers", primitive("localisation"), occurs.optional),
    ],
  },
  {
    type: DefinitionTypeId.SituationType,
    path: ["approach"],
    evidence:
      "4.5.2 executable: the approach reader (`0x4e65d0`) reads `custom_tooltip` as a string, kept apart from the effects the situation's check counts",
    entries: [field("custom_tooltip", primitive("localisation"), occurs.optional)],
  },
  {
    type: DefinitionTypeId.Building,
    path: ["prerequisites"],
    evidence: "vanilla 4.4.6: common/buildings/24_nomads_buildings.txt",
    entries: prerequisiteLogic(),
  },
  {
    type: DefinitionTypeId.Edict,
    path: ["prerequisites"],
    evidence: "vanilla 4.4.6: 10 uses in common/edicts/01_campaigns.txt",
    entries: prerequisiteLogic(),
  },
  {
    type: DefinitionTypeId.Resource,
    path: ["prerequisites"],
    evidence: "vanilla 4.4.6: 3 uses in common/strategic_resources/00_strategic_resources.txt",
    entries: prerequisiteLogic(),
  },
  {
    type: DefinitionTypeId.SectionTemplate,
    path: ["prerequisites"],
    evidence: "vanilla 4.4.6: common/section_templates/other.txt nests AND inside OR",
    entries: prerequisiteLogic(),
  },
  {
    type: DefinitionTypeId.Policy,
    path: ["option"],
    evidence: "vanilla 4.4.6: 144 uses in common/policies/00_policies.txt",
    entries: [field("ai_weight", block([modifierRuleEntries()]), occurs.optional)],
  },
  {
    type: DefinitionTypeId.Trait,
    path: ["slave_cost"],
    evidence: "vanilla 4.4.6: 244 uses; the block is a resource cost, and trade is a resource",
    entries: [field(typeKey("resource"), primitive("integer"), occurs.any)],
  },
  {
    type: DefinitionTypeId.Concept,
    path: ["databank"],
    evidence: "vanilla 4.4.6: 13 uses in common/game_concepts/00_game_concepts.txt",
    entries: [field("postfix", primitive("localisation"), occurs.optional)],
  },
  {
    type: DefinitionTypeId.ShipSize,
    path: ["map_icon_override"],
    evidence: "vanilla 4.4.6: 10 uses in common/ship_sizes/29_nomads_dlc_ships.txt",
    entries: [field("encamped", primitive("scalar"), occurs.optional)],
  },
  {
    type: DefinitionTypeId.SituationType,
    path: ["approach"],
    evidence: "vanilla 4.4.6: 6 uses in common/situations/06_astral_planes_situations.txt",
    entries: [field("custom_tooltip_with_modifiers", primitive("localisation"), occurs.any)],
  },
  {
    type: DefinitionTypeId.SpecialProject,
    path: ["requirements"],
    evidence: "vanilla 4.4.6: 21 uses in common/special_projects/06_projects_nomads.txt",
    entries: [field("carries_colony", primitive("integer"), occurs.optional)],
  },
  {
    type: DefinitionTypeId.ModelEntity,
    path: ["state", "propagate_state"],
    evidence: "vanilla 4.4.6: 8 uses in gfx/models/ships/colossus/mindwarden_01",
    entries: [field("effects", primitive("scalar"), occurs.any)],
  },
  {
    type: DefinitionTypeId.AnomalyCategory,
    path: ["on_success"],
    evidence:
      "vanilla 4.5.2: 91 weighted outcomes written `1 = { anomaly_event = … }` in common/anomalies; cwt's `int = { … }` was ported as a field called int",
    entries: [
      field(
        numericKey(),
        block([
          field("max_once", primitive("boolean"), occurs.optional),
          field("max_once_global", primitive("boolean"), occurs.optional),
          modifierRuleEntries(),
          field("anomaly_event", typeRef("event", "ship"), occurs.optional),
          field("ship_event", typeRef("event", "ship"), occurs.optional),
        ]),
        occurs.any,
      ),
    ],
  },
  {
    type: DefinitionTypeId.ParticleType,
    path: ["subsystem", "childsystem"],
    evidence:
      "vanilla 4.5.2: `duration={ 12 2.5 }` in gfx/particles/infernal_red_giant_explosion.asset, as a subsystem writes it",
    entries: [field("duration", block([item(primitive("number"), between(0, 2))]), occurs.optional)],
  },
  {
    type: DefinitionTypeId.Portrait,
    path: ["portrait_evolution", "variants", ITEM_BLOCKS, "value"],
    evidence:
      "vanilla 4.5.2: 19 psionic evolutions in gfx/portraits/portraits/24_portraits_psionics.txt swap the entity with `{ portrait_override = … }` instead of a decal and mask",
    entries: [item(block([field("portrait_override", typeRef("model_entity"), occurs.one)]), occurs.any)],
  },
  {
    type: DefinitionTypeId.SpecialProject,
    path: ["requirements"],
    evidence: "vanilla 4.5.2: `skill >` 3 times and `fleet_power >` or `>=` 12 times in common/special_projects",
    entries: [
      field("skill", primitive("integer", { min: 1, max: 10 }), occurs.optional, { operator: "==" }),
      field("fleet_power", primitive("integer"), occurs.optional, { operator: "==" }),
    ],
  },
];

/**
 * Fields the corpus marks required that the base game leaves out, inside a
 * block no field name reaches: `*` steps into the block under a key that is
 * no literal.
 *
 * `npm run propose:corrections` finds the ones a dotted field name can say;
 * these are the ones it cannot.
 */
export const optionalFields: Readonly<Record<string, readonly string[]>> = {
  // vanilla 4.5.2: the stages `mutiny` and `planetfall` of
  // situation_passenger_satisfaction draw no icon; 2 of 259.
  situation_type: ["stages.*.icon", "stages.*.icon_background"],
};

/**
 * Relaxes the fields vanilla proves are not required.
 *
 * Only the occurrence changes: the value rule is whatever cwt said, and a field
 * the base game leaves out of half its own definitions is not one a mod must
 * write. A dotted name such as `resources.category` is a field inside a block.
 */
function withOptionalFields(type: DefinitionType, optional: readonly string[]): DefinitionType {
  return {
    ...type,
    entries: relaxFields(
      type.entries,
      optional.map((name) => name.split(".")),
    ),
  };
}

function relaxFields(entries: readonly EntryRule[], paths: readonly (readonly string[])[]): readonly EntryRule[] {
  return entries.map((entry) => {
    if (entry.kind === "variant-rules") {
      return { ...entry, entries: relaxFields(entry.entries, paths) };
    }

    if (entry.kind !== "field") {
      return entry;
    }

    // `*` steps into the block under a key that is no literal.
    const key: string = typeof entry.key === "string" ? entry.key : ANY_KEY;
    const here: readonly (readonly string[])[] = paths.filter((path) => path[0] === key);
    const inside: readonly (readonly string[])[] = here.filter((path) => path.length > 1).map((path) => path.slice(1));
    let relaxed: EntryRule = entry;

    if (here.some((path) => path.length === 1)) {
      relaxed = { ...relaxed, occurrence: { min: 0, max: entry.occurrence.max } };
    }

    if (inside.length > 0 && relaxed.value.kind === "block") {
      relaxed = { ...relaxed, value: { ...relaxed.value, entries: relaxFields(relaxed.value.entries, inside) } };
    }

    return relaxed;
  });
}

/** Adds entries to the block a path names, leaving every other rule alone. */
function applyNested(type: DefinitionType, corrections: readonly NestedCorrection[]): DefinitionType {
  let entries: readonly EntryRule[] = type.entries;

  for (const correction of corrections) {
    entries = addAtPath(entries, correction.path, correction.entries);
  }

  return { ...type, entries };
}

function addAtPath(
  entries: readonly EntryRule[],
  path: readonly string[],
  extra: readonly EntryRule[],
): readonly EntryRule[] {
  const [head, ...rest] = path;

  if (head === undefined) {
    return [...entries, ...extra];
  }

  return entries.map((entry) => {
    if (entry.kind === "variant-rules") {
      return { ...entry, entries: addAtPath(entry.entries, path, extra) };
    }

    const step: boolean =
      head === ITEM_BLOCKS
        ? entry.kind === "item"
        : head === ANY_KEY
          ? entry.kind === "field" && typeof entry.key !== "string"
          : entry.kind === "field" && entry.key === head;

    if (!step || (entry.kind !== "field" && entry.kind !== "item") || entry.value.kind !== "block") {
      return entry;
    }

    return { ...entry, value: { ...entry.value, entries: addAtPath(entry.value.entries, rest, extra) } };
  });
}

/**
 * Applies the corrections to the imported types, leaving everything else alone.
 *
 * Two sources, and the order matters only for reading a diff: the hand-written
 * ones above, then the ones `npm run propose:corrections` derived from what
 * vanilla actually writes.
 */
export function withCorrections(types: readonly DefinitionType[]): readonly DefinitionType[] {
  return types.map(withoutReplaced).map((type) => {
    const extra: readonly EntryRule[] = [
      ...(fieldReplacements[type.id] ?? []),
      ...(definitionCorrections[type.id] ?? []),
      ...(vanillaFieldCorrections[type.id] ?? []),
    ];
    const nested: readonly NestedCorrection[] = nestedCorrections.filter((correction) => correction.type === type.id);
    const optional: readonly string[] = [...(vanillaOptionalFields[type.id] ?? []), ...(optionalFields[type.id] ?? [])];
    const relaxed: DefinitionType = optional.length === 0 ? type : withOptionalFields(type, optional);
    const withNested: DefinitionType = nested.length === 0 ? relaxed : applyNested(relaxed, nested);
    return extra.length === 0 ? withNested : { ...withNested, entries: [...withNested.entries, ...extra] };
  });
}

/**
 * The same, minus what vanilla itself taught us.
 *
 * `npm run propose:corrections` has to see the corpus as it was before its own
 * output was folded in, or the second run finds nothing missing and empties the
 * file it wrote on the first.
 */
export function withHandCorrections(types: readonly DefinitionType[]): readonly DefinitionType[] {
  return types.map(withoutReplaced).map((type) => {
    const extra: readonly EntryRule[] = [
      ...(fieldReplacements[type.id] ?? []),
      ...(definitionCorrections[type.id] ?? []),
    ];
    const nested: readonly NestedCorrection[] = nestedCorrections.filter((correction) => correction.type === type.id);
    const withNested: DefinitionType = nested.length === 0 ? type : applyNested(type, nested);
    return extra.length === 0 ? withNested : { ...withNested, entries: [...withNested.entries, ...extra] };
  });
}
