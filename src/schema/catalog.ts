export const DefinitionTypeId: {
  readonly Building: "building";
  readonly Event: "event";
  readonly Technology: "technology";
  readonly Trait: "trait";
} = {
  Building: "building",
  Event: "event",
  Technology: "technology",
  Trait: "trait",
} as const;

export type DefinitionTypeId = (typeof DefinitionTypeId)[keyof typeof DefinitionTypeId];

export const EnumId: {
  readonly BuildingCategories: "building_categories";
  readonly BuildingOwnerType: "building_owner_type";
  readonly Dlcs: "DLCs";
  readonly EventWindowType: "event_window_type";
  readonly FeatureFlags: "feature_flags";
  readonly LeaderTraitRarity: "leader_trait_rarity";
  readonly ResearchAreas: "research_areas";
  readonly SpeciesCategoryType: "species_category_type";
  readonly TechAiType: "tech_ai_type";
} = {
  BuildingCategories: "building_categories",
  BuildingOwnerType: "building_owner_type",
  Dlcs: "DLCs",
  EventWindowType: "event_window_type",
  FeatureFlags: "feature_flags",
  LeaderTraitRarity: "leader_trait_rarity",
  ResearchAreas: "research_areas",
  SpeciesCategoryType: "species_category_type",
  TechAiType: "tech_ai_type",
} as const;

export type EnumId = (typeof EnumId)[keyof typeof EnumId];

export const ScopeId: {
  readonly Agreement: "agreement";
  readonly AstralRift: "astral_rift";
  readonly Bypass: "bypass";
  readonly Country: "country";
  readonly EspionageOperation: "espionage_operation";
  readonly FirstContact: "first_contact";
  readonly Fleet: "fleet";
  readonly Leader: "leader";
  readonly Planet: "planet";
  readonly Pop: "pop";
  readonly PopFaction: "pop_faction";
  readonly PopGroup: "pop_group";
  readonly Ship: "ship";
  readonly Situation: "situation";
  readonly Species: "species";
  readonly Starbase: "starbase";
  readonly System: "system";
} = {
  Agreement: "agreement",
  AstralRift: "astral_rift",
  Bypass: "bypass",
  Country: "country",
  EspionageOperation: "espionage_operation",
  FirstContact: "first_contact",
  Fleet: "fleet",
  Leader: "leader",
  Planet: "planet",
  Pop: "pop",
  PopFaction: "pop_faction",
  PopGroup: "pop_group",
  Ship: "ship",
  Situation: "situation",
  Species: "species",
  Starbase: "starbase",
  System: "system",
} as const;

export type ScopeId = (typeof ScopeId)[keyof typeof ScopeId];
