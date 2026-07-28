import {
  anyKey,
  block,
  effectEntries,
  field,
  item,
  literal,
  modifierEntries,
  modifierRuleEntries,
  oneOf,
  occurs,
  primitive,
  replaceScope,
  ruleSetEntries,
  scriptValue,
  triggerEntries,
  typeRef,
  whenVariant,
} from "./ir.js";
import { ScopeId } from "./catalog.js";
import { vanillaFieldCorrections } from "./vanilla-corrections.js";
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
};

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
    return extra.length === 0 ? type : { ...type, entries: [...type.entries, ...extra] };
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
    return extra === undefined ? type : { ...type, entries: [...type.entries, ...extra] };
  });
}
