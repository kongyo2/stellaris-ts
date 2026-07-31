import { define } from "../src/builders/index.js";
import { EnumId, ScopeId, enumRef, scopeRef } from "../src/schema/index.js";

const values: string[] = [];

// This must remain an error so disabling noUncheckedIndexedAccess also fails on an unused expectation.
// @ts-expect-error Array indexing is intentionally `string | undefined`.
const first: string = values[0];

void first;

enumRef(EnumId.BuildingCategories);
scopeRef(ScopeId.Planet);

// @ts-expect-error Unknown enum ids must not enter committed schema IR.
enumRef("missing_enum");

// @ts-expect-error Unknown scope ids must not enter committed schema IR.
scopeRef("missing_scope");

// A system initializer's whole job is to place planets, and `planet` reaches it
// through a rule-set family rather than a field. Rendering the family's members
// as properties is what gives it a type; before that the one key the type
// exists for was the one key it did not have.
define("solar_system_initializer", "sts_system", {
  class: "sc_g",
  planet: { count: 1, class: "star", orbit_distance: 0, size: { min: 20, max: 30 } },
});

// Technology tiers are named `0` … `5`, and every technology writes `tier = 3`.
// A reference to a type whose identifiers are numbers takes a number.
define("technology", "sts_tech", { area: "physics", tier: 3, category: ["computing"], cost: 100 });

// `modifier_category = colony` is written by every job category in the game.
define("economic_category", "sts_category", { modifier_category: "colony" });

// A family may name the same key twice with two different shapes, and both are
// forms the game accepts: vanilla writes 326 `resources` blocks with a category
// and six with nothing but `produces`.
define("deposit", "sts_deposit_a", {
  resources: { category: "planet_deposits", produces: { minerals: 4 } },
});
define("deposit", "sts_deposit_b", { resources: { produces: { society_research: 8 } } });

// A building's triggered modifier blocks come from rule-set families too.
define("building", "sts_lab", {
  category: "research",
  triggered_planet_modifier: { potential: { exists: "owner" }, job_researcher_add: 1 },
});

export {};
