import { DefinitionTypeId, EnumId, ScopeId } from "../catalog.js";
import {
  between,
  block,
  definitionLocalisation,
  defineType,
  enumRef,
  fieldEquals,
  fieldPresent,
  item,
  keyedBlocks,
  list,
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
  unlessVariant,
  valueSet,
  valueSetKey,
  whenVariant,
} from "../ir.js";
import type { DefinitionType } from "../ir.js";

const countryContext = replaceScope({
  current: ScopeId.Country,
  root: ScopeId.Country,
});

export const technology: DefinitionType = defineType({
  id: DefinitionTypeId.Technology,
  documentation:
    "A researchable technology. Its ordered rules preserve alternatives and nested validation without exposing CWT syntax.",
  source: keyedBlocks("common/technology", false),
  variants: [
    {
      id: "repeatable",
      when: fieldPresent("levels"),
      displayName: "Repeatable technology",
      abbreviation: "REP",
    },
    {
      id: "start-tech",
      when: fieldEquals("start_tech", true),
      displayName: "Starting technology",
      abbreviation: "START",
    },
  ],
  localisation: [definitionLocalisation("name", "", true), definitionLocalisation("description", "_desc", true)],
  modifiers: [],
  entries: [
    required("area", enumRef(EnumId.ResearchAreas), {
      documentation: "Research branch used by the technology deck.",
    }),
    required("tier", typeRef("technology_tier")),
    required("category", list(typeRef("technology_category")), {
      documentation: "The technology category, represented by its keyed definition.",
    }),
    optional("icon", primitive("icon", undefined, "gfx/interface/icons/technologies")),
    optional("weight", primitive("number")),
    optional("cost", oneOf(modifierRuleBlock(), primitive("script-value")), {
      documentation: "Either a context-sensitive cost formula or a script-value expression.",
      scope: countryContext,
    }),
    unlessVariant("start-tech", [
      optional("is_dangerous", primitive("boolean")),
      optional("levels", primitive("integer", { min: -1, max: 100 })),
    ]),
    optional(
      "prerequisites",
      block([
        item(typeRef("technology"), between(0, 100)),
        optional("OR", block([item(typeRef("technology"), between(0, 100))])),
      ]),
      {
        documentation: "Direct prerequisites plus an optional group in which any technology may satisfy the edge.",
      },
    ),
    optional("potential", triggerBlock(), {
      documentation: "Controls whether the technology may enter the research deck.",
      scope: countryContext,
    }),
    optional("gateway", primitive("scalar")),
    whenVariant("repeatable", [required("cost_per_level", primitive("integer"))]),
    optional("weight_groups", list(valueSet("tech_weight_group"), occurs.any), {
      documentation: "Named affinity groups that influence later technology draws.",
    }),
    repeatable("mod_weight_if_group_picked", block([required(valueSetKey("tech_weight_group"), primitive("number"))])),
    optional("start_tech", primitive("boolean")),
    optional("is_reverse_engineerable", primitive("boolean")),
    optional("is_rare", primitive("boolean")),
    optional("ai_update_type", enumRef(EnumId.TechAiType)),
    optional("is_insight", primitive("boolean")),
    optional("feature_flags", list(enumRef(EnumId.FeatureFlags), between(0, 100))),
    optional("modifier", modifierBlock(), {
      documentation: "Country modifiers granted while the technology is active.",
      scope: countryContext,
    }),
    repeatable(
      "technology_swap",
      block([
        optional("name", oneOf(typeRef("technology"), primitive("localisation"))),
        optional("inherit_icon", primitive("boolean")),
        optional("inherit_effects", primitive("boolean")),
        optional("trigger", triggerBlock()),
        repeatable(
          "prereqfor_desc",
          block([
            required(
              "custom",
              block([required("title", primitive("localisation")), optional("desc", primitive("localisation"))]),
            ),
          ]),
        ),
        optional("weight", block([required("factor", primitive("integer"))])),
        optional("modifier", modifierBlock()),
        optional("area", enumRef(EnumId.ResearchAreas)),
        optional("category", list(typeRef("technology_category"))),
      ]),
      {
        documentation: "A conditional presentation and rules override for this technology.",
        scope: countryContext,
      },
    ),
    repeatable("weight_modifier", modifierRuleBlock(), { scope: countryContext }),
    optional("ai_weight", modifierRuleBlock(), { scope: countryContext }),
    optional("starting_potential", triggerBlock(), {
      documentation: "Additional scripted conditions evaluated for starting technologies.",
      scope: countryContext,
    }),
  ],
});
