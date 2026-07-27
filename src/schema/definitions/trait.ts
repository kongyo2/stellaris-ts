import { DefinitionTypeId, EnumId, ScopeId } from "../catalog.js";
import {
  block,
  defineType,
  definitionLocalisation,
  effectBlock,
  enumRef,
  fieldAbsent,
  fieldEquals,
  fieldPresent,
  item,
  keyedBlocks,
  list,
  literal,
  modifierBlock,
  modifierRuleBlock,
  occurs,
  oneOf,
  oneOrMore,
  optional,
  primitive,
  repeatable,
  replaceScope,
  required,
  triggerBlock,
  typeKey,
  typeRef,
  whenVariant,
} from "../ir.js";
import type { DefinitionType } from "../ir.js";

const technologyPrerequisites = block([
  item(typeRef("technology"), occurs.optional),
  optional("OR", list(typeRef("technology"), occurs.any)),
]);

const triggeredDescription = block([
  optional("trigger", triggerBlock(), {
    documentation: "Appends text when the trigger is true.",
  }),
  optional("exclusive_trigger", triggerBlock(), {
    documentation: "Replaces the other text when the trigger is true.",
  }),
  required("text", primitive("localisation")),
]);

const layeredIcon = block([
  oneOrMore(
    "layer",
    block([
      required("icon", oneOf(typeRef("sprite"), primitive("file")), {
        documentation: "Texture registered by the interface files, or a direct file path.",
      }),
      optional("color", typeRef("named_color")),
      optional("visible", triggerBlock(), {
        documentation: "Hides this layer when the trigger is false.",
        scope: replaceScope({ current: ScopeId.Leader, root: ScopeId.Leader }),
      }),
    ]),
    {
      documentation: "One rendered layer of a composite trait icon.",
    },
  ),
  optional("icon", typeRef("sprite"), {
    documentation: "Inline-script compatibility form.",
  }),
]);

export const trait: DefinitionType = defineType({
  id: DefinitionTypeId.Trait,
  source: keyedBlocks("common/traits"),
  variants: [
    {
      id: "species_trait",
      when: fieldAbsent("leader_class"),
      displayName: "Species Trait",
    },
    {
      id: "leader_trait",
      when: fieldPresent("leader_class"),
      displayName: "Leader Trait",
    },
    {
      id: "leader_trait_subclass",
      when: fieldEquals("subclass_trait", true),
      displayName: "Leader Subclass Trait",
    },
    {
      id: "leader_trait_veteran",
      when: fieldEquals("veteran_class_locked_trait", true),
      displayName: "Veteran Leader Trait",
    },
    {
      id: "leader_trait_destiny",
      when: fieldEquals("destiny_trait", true),
      displayName: "Destiny Leader Trait",
    },
    {
      id: "leader_trait_replacement",
      when: fieldPresent("replace_traits"),
      displayName: "Replacement Leader Trait",
    },
    {
      id: "leader_trait_not_replacement",
      when: fieldAbsent("replace_traits"),
      displayName: "Regular Leader Trait",
    },
  ],
  localisation: [
    definitionLocalisation("name", "", false),
    definitionLocalisation("description", "_desc", false),
    definitionLocalisation("name", "", true, "leader_trait_not_replacement"),
    definitionLocalisation("description", "_desc", true, "leader_trait_not_replacement"),
  ],
  modifiers: [],
  entries: [
    optional("host_has_dlc", enumRef(EnumId.Dlcs)),
    optional("immortal_leaders", primitive("boolean"), {
      documentation: "Whether leaders with this trait are immortal. Defaults to no.",
    }),
    optional("icon", oneOf(primitive("file"), layeredIcon), {
      documentation:
        "A direct texture path or layered icon. When omitted it defaults to gfx/interface/icons/traits/<trait name>.dds.",
    }),
    optional("leader_trait_rarity", enumRef(EnumId.LeaderTraitRarity)),
    optional("cost", oneOf(primitive("integer"), modifierRuleBlock()), {
      documentation: "A fixed or scripted point cost paid or granted when this trait is selected.",
    }),
    optional("auto_mod", primitive("boolean")),
    optional("category", enumRef(EnumId.SpeciesCategoryType)),
    optional("valid_for_all_ethics", primitive("boolean")),
    optional("allowed_ethics", list(typeRef("ethos"), occurs.oneOrMore), {
      documentation: "Ethics accepted when valid_for_all_ethics is no.",
    }),
    optional("valid_for_all_origins", primitive("boolean")),
    optional("allowed_origins", list(typeRef("civic_or_origin", "origin"), occurs.oneOrMore), {
      documentation: "Origins accepted when valid_for_all_origins is no.",
    }),
    optional("sorting_priority", primitive("integer")),
    optional("bound_to_planet_classes", list(typeRef("planet_class"), occurs.any)),
    optional("leader_trait_type", enumRef(EnumId.LeaderTraitRarity)),
    whenVariant("species_trait", [
      optional("assembly_score", modifierRuleBlock(), {
        scope: replaceScope({
          current: ScopeId.Species,
          root: ScopeId.Species,
          from: ScopeId.Planet,
        }),
      }),
      optional("short_name", primitive("localisation")),
      required("allowed_archetypes", list(typeRef("species_archetype"), occurs.oneOrMore)),
      optional("allowed_planet_classes", list(typeRef("planet_class"), occurs.oneOrMore)),
      optional("allowed_planet_classes_override", triggerBlock()),
      optional("ideal_planet_class", typeRef("planet_class")),
      optional("species_class", list(typeRef("species_class"), occurs.oneOrMore)),
      optional("modifier", modifierBlock(), {
        scope: replaceScope({ current: ScopeId.Country, root: ScopeId.Country }),
      }),
      optional("assembling_modifier", modifierBlock(), {
        scope: replaceScope({ current: ScopeId.Planet, root: ScopeId.Planet }),
      }),
      optional("declining_modifier", modifierBlock(), {
        scope: replaceScope({ current: ScopeId.Planet, root: ScopeId.Planet }),
      }),
      optional("growing_modifier", modifierBlock(), {
        scope: replaceScope({ current: ScopeId.Planet, root: ScopeId.Planet }),
      }),
      optional("sapient", primitive("boolean"), {
        documentation: "Whether the species is sapient. Defaults to yes.",
      }),
      optional("forced_happiness", primitive("boolean")),
      optional("improves_leaders", primitive("boolean")),
      optional("advanced_trait", primitive("boolean")),
      optional("leader_age_min", primitive("integer")),
      optional("leader_age_max", primitive("integer")),
      optional("species_potential_add", triggerBlock(), {
        scope: replaceScope({
          current: ScopeId.Species,
          root: ScopeId.Species,
          from: ScopeId.Country,
        }),
      }),
      optional("species_possible_add", triggerBlock(), {
        scope: replaceScope({
          current: ScopeId.Species,
          root: ScopeId.Species,
          from: ScopeId.Country,
        }),
      }),
      optional("species_potential_remove", triggerBlock(), {
        scope: replaceScope({
          current: ScopeId.Species,
          root: ScopeId.Species,
          from: ScopeId.Country,
        }),
      }),
      optional("species_possible_remove", triggerBlock(), {
        scope: replaceScope({
          current: ScopeId.Species,
          root: ScopeId.Species,
          from: ScopeId.Country,
        }),
      }),
      optional("allowed_civics", list(typeRef("civic_or_origin", "civic"), occurs.any)),
      optional("country_modifier", modifierBlock(), {
        scope: replaceScope({ current: ScopeId.Country, root: ScopeId.Country }),
      }),
      optional("localized_tags", list(primitive("localisation"), occurs.any)),
      optional("portrait_override", list(oneOf(typeRef("portrait_group"), typeRef("portrait")), occurs.any)),
      optional("tags", list(typeRef("trait_tags"), occurs.any)),
      optional("prerequisites", technologyPrerequisites),
      optional("opposites", list(typeRef("trait", "species_trait"), occurs.any)),
      optional("forbidden_ethics", list(typeRef("ethos"), occurs.any)),
      optional("potential_crossbreeding_chance", primitive("number")),
      optional("slave_cost", block([required("energy", primitive("integer"))])),
      optional("infertile", primitive("boolean")),
      optional("random_weight", block([repeatable(typeKey("species_class"), primitive("number"))])),
      repeatable("triggered_species_modifier", modifierBlock(), {
        documentation: "Conditional species modifiers; detailed predicates are retained during the full import.",
        scope: replaceScope({
          current: ScopeId.Leader,
          root: ScopeId.Leader,
          from: ScopeId.Country,
        }),
      }),
    ]),
    whenVariant("leader_trait", [
      optional("starting_ruler_trait", literal(true), {
        documentation: "Makes the trait available during ruler creation.",
      }),
      optional("forbidden_origins", list(typeRef("civic_or_origin", "origin"), occurs.oneOrMore)),
      optional("councilor_trait", primitive("boolean")),
      optional("negative", primitive("boolean")),
      optional("is_councilor_trait_for_ruler", primitive("boolean")),
      optional("subclass_trait", literal(true)),
      optional("subclass_background_icon", typeRef("sprite")),
      optional("veteran_class_locked_trait", literal(true)),
      optional("destiny_trait", literal(true)),
      optional("destiny_background_icon", typeRef("sprite")),
      optional("ethic_destiny_trait", primitive("boolean")),
      optional("immortal_leaders", primitive("boolean")),
      optional("randomized", primitive("boolean")),
      optional("hide_age", primitive("boolean")),
      optional("can_retreat", primitive("boolean")),
      optional("self_modifier", modifierBlock(), {
        scope: replaceScope({ current: ScopeId.Leader, root: ScopeId.Leader }),
      }),
      optional("modifier", modifierBlock(), {
        scope: replaceScope({ current: ScopeId.Country, root: ScopeId.Country }),
      }),
      optional("planet_modifier", modifierBlock(), {
        scope: replaceScope({ current: ScopeId.Planet, root: ScopeId.Planet }),
      }),
      repeatable("triggered_desc", triggeredDescription, {
        scope: replaceScope({ current: ScopeId.Leader, root: ScopeId.Leader }),
      }),
      optional("custom_subtitle", primitive("localisation")),
      optional("prerequisites", technologyPrerequisites),
      repeatable("triggered_modifier", modifierBlock(), {
        documentation: "Conditional leader modifiers; detailed predicates are retained during the full import.",
        scope: replaceScope({
          current: ScopeId.Leader,
          root: ScopeId.Leader,
          from: ScopeId.Country,
        }),
      }),
      optional("councilor_modifier", modifierBlock(), {
        scope: replaceScope({
          current: ScopeId.Leader,
          root: ScopeId.Leader,
          from: ScopeId.Country,
        }),
      }),
      repeatable("triggered_councilor_modifier", modifierBlock(), {
        documentation: "Conditional council modifiers; detailed predicates are retained during the full import.",
        scope: replaceScope({
          current: ScopeId.Leader,
          root: ScopeId.Leader,
          from: ScopeId.Country,
        }),
      }),
      optional("leader_class", literal("all")),
      optional("requires_traits", list(typeRef("trait", "species_trait"), occurs.oneOrMore)),
      optional("opposites", list(typeRef("trait", "leader_trait"), occurs.any)),
      optional("replace_traits", list(typeRef("trait", "leader_trait"), occurs.oneOrMore)),
      optional("selectable_weight", oneOf(primitive("integer"), modifierRuleBlock()), {
        documentation: "A fixed or scripted availability weight at level-up. Defaults to 100.",
        scope: replaceScope({
          current: ScopeId.Leader,
          root: ScopeId.Leader,
          from: ScopeId.Country,
        }),
      }),
      optional("notify_on_gained", primitive("boolean")),
      optional("on_gained_effect", effectBlock(), {
        scope: replaceScope({ current: ScopeId.Leader, root: ScopeId.Leader }),
      }),
      optional("background_icon", typeRef("sprite")),
      optional("force_councilor_trait", literal(true)),
    ]),
    repeatable("triggered_desc", triggeredDescription),
    optional("initial", primitive("boolean")),
    optional("randomized", primitive("boolean")),
    optional("hidden", primitive("boolean")),
    optional("custom_tooltip", primitive("localisation"), {
      documentation: "Replaces the automatically generated modifier text.",
    }),
    optional("custom_tooltip_with_modifiers", primitive("localisation"), {
      documentation: "Appends text after the automatically generated modifier text.",
    }),
    optional("ai_weight", oneOf(primitive("integer"), modifierRuleBlock())),
  ],
  documentation: "A species or leader trait declared under common/traits.",
});
