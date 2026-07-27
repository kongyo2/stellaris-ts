import { DefinitionTypeId, EnumId, ScopeId } from "../catalog.js";
import {
  block,
  defineType,
  definitionLocalisation,
  effectBlock,
  enumRef,
  fieldEquals,
  generatedModifier,
  keyedBlocks,
  list,
  literal,
  modifierBlock,
  modifierRuleBlock,
  occurs,
  oneOf,
  optional,
  primitive,
  repeatable,
  replaceScope,
  required,
  triggerBlock,
  typeRef,
} from "../ir.js";
import type { DefinitionType } from "../ir.js";

export const building: DefinitionType = defineType({
  id: DefinitionTypeId.Building,
  source: keyedBlocks("common/buildings"),
  entryScope: ScopeId.Planet,
  variants: [
    {
      id: "corporate",
      when: fieldEquals("owner_type", "corporate"),
      displayName: "Corporate building",
    },
    {
      id: "holding",
      when: fieldEquals("owner_type", "subject_holding"),
      displayName: "Subject holding",
    },
  ],
  localisation: [definitionLocalisation("name", "", true), definitionLocalisation("description", "_desc", true)],
  modifiers: [generatedModifier("planet_", "_build_speed_mult", "Planets")],
  entries: [
    repeatable(
      "desc",
      block([
        optional("trigger", triggerBlock(), {
          scope: replaceScope({ current: ScopeId.Planet, root: ScopeId.Planet }),
        }),
        required("text", primitive("localisation")),
      ]),
    ),
    optional("owner_type", oneOf(literal("corporate"), literal("subject_holding")), {
      documentation: "Selects the corporate or subject-holding building variant.",
    }),
    optional("base_buildtime", primitive("integer")),
    optional(
      "planet_limit",
      oneOf(
        primitive("integer"),
        block([required("base", primitive("integer")), repeatable("modifier", modifierRuleBlock())]),
      ),
    ),
    optional("exempt_from_ai_planet_specialization", primitive("boolean"), {
      documentation: "Prevents AI planet-specialisation plans from swapping this building into a group.",
    }),
    repeatable("category", enumRef(EnumId.BuildingCategories)),
    optional("icon", oneOf(primitive("icon", undefined, "gfx/interface/icons/buildings"), typeRef("building"))),
    optional("ruined_icon", oneOf(primitive("icon", undefined, "gfx/interface/icons/buildings"), typeRef("building"))),
    optional("capital", primitive("boolean")),
    optional("can_demolish", primitive("boolean")),
    optional("can_be_ruined", primitive("boolean")),
    optional("can_be_disabled", primitive("boolean")),
    optional("can_build", primitive("boolean")),
    optional("base_cap_amount", primitive("integer")),
    optional("is_capped_by_modifier", primitive("boolean")),
    optional("planetary_ftl_inhibitor", primitive("boolean")),
    optional("position_priority", primitive("integer")),
    optional("capital_tier", primitive("integer")),
    optional("district_limit", primitive("integer")),
    repeatable("custom_tooltip", primitive("localisation")),
    optional("allow", triggerBlock()),
    optional("empire_limit", oneOf(modifierRuleBlock(), primitive("integer")), {
      scope: replaceScope({ root: ScopeId.Country }),
    }),
    optional("on_queued", effectBlock()),
    optional("on_unqueued", effectBlock()),
    optional("on_built", effectBlock()),
    optional("on_enabled", effectBlock()),
    optional("on_destroy", effectBlock()),
    optional("on_repaired", effectBlock()),
    optional("potential", triggerBlock()),
    optional("abort_trigger", triggerBlock()),
    optional("ruined_trigger", triggerBlock()),
    optional("destroy_trigger", triggerBlock()),
    optional("show_tech_unlock_if", triggerBlock(), {
      scope: replaceScope({ current: ScopeId.Country, root: ScopeId.Country }),
    }),
    optional("upgrades", list(typeRef("building"), occurs.any)),
    repeatable("planet_modifier", modifierBlock(), {
      scope: replaceScope({ current: ScopeId.Planet, root: ScopeId.Planet }),
    }),
    optional("prerequisites", list(typeRef("technology"), occurs.any)),
    optional("custom_storm_ai_weight", modifierRuleBlock()),
    optional("ai_weight", modifierRuleBlock()),
    repeatable("convert_to", list(typeRef("building"), occurs.oneOrMore)),
    optional("country_modifier", modifierBlock(), {
      scope: replaceScope({ current: ScopeId.Country, root: ScopeId.Country }),
    }),
    optional("system_modifier", modifierBlock(), {
      scope: replaceScope({ current: ScopeId.System, root: ScopeId.System }),
    }),
    optional("is_essential", primitive("boolean"), {
      documentation: "Removes non-essential build tasks when this building enters the AI build queue.",
    }),
    optional("show_in_tech", typeRef("technology")),
    optional("additional_ai_weight", primitive("integer")),
    optional("ai_weight_coefficient", primitive("number")),
  ],
  documentation:
    "A planet building definition, including corporate and subject-holding variants, limits, lifecycle hooks, and AI metadata.",
});
