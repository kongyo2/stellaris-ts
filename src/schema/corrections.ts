import {
  anyKey,
  anyValue,
  block,
  effectEntries,
  field,
  item,
  literal,
  modifierEntries,
  modifierRuleEntries,
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
};

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
  /** Field keys from the definition body down to the block being corrected. */
  readonly path: readonly string[];
  readonly entries: readonly EntryRule[];
  /** Where this came from, so a stale one can be recognised. */
  readonly evidence: string;
}

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

export const nestedCorrections: readonly NestedCorrection[] = [
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
];

/**
 * Relaxes the fields vanilla proves are not required.
 *
 * Only the occurrence changes: the value rule is whatever cwt said, and a field
 * the base game leaves out of half its own definitions is not one a mod must
 * write.
 */
function withOptionalFields(type: DefinitionType, optional: readonly string[]): DefinitionType {
  const relaxed: ReadonlySet<string> = new Set(optional);

  const visit = (entries: readonly EntryRule[]): readonly EntryRule[] =>
    entries.map((entry) => {
      if (entry.kind === "variant-rules") {
        return { ...entry, entries: visit(entry.entries) };
      }

      if (entry.kind !== "field" || typeof entry.key !== "string" || !relaxed.has(entry.key)) {
        return entry;
      }

      return { ...entry, occurrence: { min: 0, max: entry.occurrence.max } };
    });

  return { ...type, entries: visit(type.entries) };
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

    if (entry.kind !== "field" || entry.key !== head || entry.value.kind !== "block") {
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
  return types.map((type) => {
    const extra: readonly EntryRule[] = [
      ...(definitionCorrections[type.id] ?? []),
      ...(vanillaFieldCorrections[type.id] ?? []),
    ];
    const nested: readonly NestedCorrection[] = nestedCorrections.filter((correction) => correction.type === type.id);
    const optional: readonly string[] | undefined = vanillaOptionalFields[type.id];
    const relaxed: DefinitionType = optional === undefined ? type : withOptionalFields(type, optional);
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
  return types.map((type) => {
    const extra: readonly EntryRule[] | undefined = definitionCorrections[type.id];
    const nested: readonly NestedCorrection[] = nestedCorrections.filter((correction) => correction.type === type.id);
    const withNested: DefinitionType = nested.length === 0 ? type : applyNested(type, nested);
    return extra === undefined ? withNested : { ...withNested, entries: [...withNested.entries, ...extra] };
  });
}
