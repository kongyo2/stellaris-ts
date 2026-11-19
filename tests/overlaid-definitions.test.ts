import { describe, expect, it } from "vitest";

import { define } from "../src/builders/index.js";
import { vanillaModsCompatibilityVersion } from "../src/generated/vanilla/game-version.js";
import {
  all,
  defineMod,
  entries,
  isEntries,
  renderDefinitions,
  repeated,
  type EntriesValue,
  type Mod,
} from "../src/index.js";
import { validate, type ValidationDiagnostic } from "../src/validate/index.js";

const mod = (): Mod =>
  defineMod({ name: "Overlay", version: "1", supportedVersion: `v${vanillaModsCompatibilityVersion}.*` });

/** A body as written, for a definition of any type: an ordered list takes any key. */
type Body = EntriesValue | Readonly<Record<string, unknown>>;

const def = (
  type: Parameters<typeof define>[0],
  id: string,
  body: Body,
  options?: Parameters<typeof define>[3],
): ReturnType<typeof define> => define(type, id, isEntries(body) ? body : entries(Object.entries(body)), options);

/** The diagnostics one code produced, as `definition.path`. */
const reported = (target: Mod, code: string): readonly string[] =>
  validate(target)
    .filter((diagnostic: ValidationDiagnostic) => diagnostic.code === code)
    .map((diagnostic) =>
      diagnostic.path.length === 0 ? diagnostic.definition : `${diagnostic.definition}.${diagnostic.path}`,
    );

const messages = (target: Mod, code: string): readonly string[] =>
  validate(target)
    .filter((diagnostic) => diagnostic.code === code)
    .map((diagnostic) => diagnostic.message);

import {
  precedenceOf,
  overlaidDefinitionDirectories,
  lastDefinitionWinsDirectories,
} from "../src/schema/definition-precedence.js";
import { schema } from "../src/schema/index.js";
import { vanillaAiBudgetCategories, vanillaEconomicPlanSubplans } from "../src/generated/vanilla/script-facts.js";

const plan = (id: string, body: Body) => def("economic_plan", id, body);
const subplan = (name: string | undefined, extra: Readonly<Record<string, unknown>> = {}) => ({
  ...(name === undefined ? {} : { set_name: name }),
  potential: { always: true },
  focus: { alloys: 10 },
  ...extra,
});

/**
 * Six of the game's databases read a second definition of an id into the
 * first: the handler in their own vtable calls the object's reader on the
 * object that is there (`0xb54ca0` for economic plans) and logs nothing.
 */
describe("a directory where the game reads a second definition into the first", () => {
  it("is neither one that keeps the last nor one that merges without a word", () => {
    for (const directory of Object.keys(overlaidDefinitionDirectories)) {
      expect(lastDefinitionWinsDirectories).not.toContain(directory);
    }
    const type = (id: string) => schema.definitionTypes.find((candidate) => candidate.id === id);
    for (const id of ["economic_plan", "species_class", "portrait_set", "portrait_category", "authority"]) {
      const found = type(id);
      expect(found === undefined ? undefined : precedenceOf(found)).toBe("overlaid");
    }
  });

  it("says nothing of a plan that only adds a subplan to one of the base game's", () => {
    const target = mod().add(plan("basic_economy_plan", { subplan: subplan("sts_alloys") }));
    expect(validate(target)).toEqual([]);
  });

  it("says nothing of two definitions of one plan, each adding its own subplan", () => {
    const target = mod()
      .add(plan("basic_economy_plan", { subplan: subplan("sts_one") }))
      .add(plan("basic_economy_plan", { subplan: subplan("sts_two") }));
    expect(validate(target)).toEqual([]);
  });

  it("says which subplan of the base game's a subplan of the same name takes the place of", () => {
    const theirs: string = vanillaEconomicPlanSubplans["basic_economy_plan"]?.[0] ?? "";
    const target = mod().add(plan("basic_economy_plan", { subplan: subplan(theirs) }));
    expect(theirs.length).toBeGreaterThan(0);
    expect(reported(target, "replaces-vanilla-subplan")).toEqual(["basic_economy_plan.subplan"]);
    expect(messages(target, "replaces-vanilla-subplan")[0]).toContain(
      `Duplicate AI subplan '${theirs}' found in basic_economy_plan`,
    );
  });

  it("says what else a definition of a base-game plan is read on top of", () => {
    const target = mod().add(plan("basic_economy_plan", { income: { alloys: 50 }, pops: 100 }));
    const [message] = messages(target, "overlays-vanilla-definition");
    expect(message).toContain("income and pops are read on top of the base game's");
    expect(message).toContain("resource by resource");
    expect(reported(target, "replaces-vanilla-definition")).toEqual([]);
  });

  it("reports subplans of one name, and of no name, as the one subplan the game keeps", () => {
    const named = mod().add(plan("sts_plan", { income: { alloys: 1 }, subplan: repeated(subplan("a"), subplan("a")) }));
    const unnamed = mod().add(
      plan("sts_plan", { income: { alloys: 1 }, subplan: repeated(subplan(undefined), subplan(undefined)) }),
    );
    const apart = mod()
      .add(plan("sts_plan", { income: { alloys: 1 }, subplan: subplan("a") }))
      .add(plan("sts_plan", { subplan: subplan("a") }));

    expect(reported(named, "duplicate-subplan")).toEqual(["sts_plan.subplan"]);
    expect(messages(unnamed, "duplicate-subplan")[0]).toContain("write no set_name");
    expect(reported(apart, "duplicate-subplan")).toEqual(["sts_plan.subplan"]);
    expect(reported(apart, "duplicate-definition")).toEqual([]);
  });

  it("asks a plan of the mod's own for an income to aim for, at its own level", () => {
    const without = mod().add(plan("sts_plan", { subplan: subplan("a", { income: { alloys: 5 } }) }));
    const split = mod()
      .add(plan("sts_plan", { subplan: subplan("a") }))
      .add(plan("sts_plan", { income: { alloys: 5 } }));
    expect(reported(without, "missing-income-goal")).toEqual(["sts_plan"]);
    expect(reported(split, "missing-income-goal")).toEqual([]);
  });

  it("takes the ten keys the plan's reader takes, at both levels, and no other", () => {
    const target = mod().add(
      plan("sts_plan", {
        income: { alloys: 1 },
        potential: { is_ai: true },
        subplan: { set_name: "a", optional: true, scaling: true, naval_cap: 10, empire_size: 3 },
      }),
    );
    expect(reported(target, "unknown-field")).toEqual(["sts_plan.subplan"]);
  });

  it("reads a partial definition of a base-game species class as an overlay, not as an incomplete class", () => {
    const target = mod().add(def("species_class", "HUM", { playable: { always: false } }));
    expect(reported(target, "overlays-vanilla-definition")).toEqual(["HUM"]);
    expect(reported(target, "missing-field")).toEqual([]);
    expect(reported(target, "replaces-vanilla-definition")).toEqual([]);
  });
});

/**
 * `ai_budget_entry.cpp:47`: a budget whose category does not itself write
 * `use_for_ai_budget = yes` is logged as unused.
 */
describe("a budget the AI never draws on", () => {
  const budget = (category: string, extra: Readonly<Record<string, unknown>> = {}) =>
    def("ai_budget", "sts_budget", {
      resource: "alloys",
      type: "expenditure",
      category,
      potential: { always: true },
      weight: { weight: 1 },
      ...extra,
    });

  it("is one for a category that does not say use_for_ai_budget", () => {
    expect(vanillaAiBudgetCategories).toContain("ships");
    expect(vanillaAiBudgetCategories).not.toContain("rare_edicts");
    expect(reported(mod().add(budget("ships")), "unused-ai-budget")).toEqual([]);
    expect(messages(mod().add(budget("rare_edicts")), "unused-ai-budget")[0]).toContain(
      "AI budget entry sts_budget for category rare_edicts is unused for AI budgets as that category lacks use_for_ai_budget",
    );
  });

  it("is one for an upkeep of a resource the category leaves to its parent", () => {
    const target = mod().add(budget("ships", { type: "upkeep", resource: "energy" }));
    expect(messages(target, "unused-ai-budget")[0]).toContain("ai_use_parent_for_resources_upkeep for energy");
  });

  it("reads a category of the mod's own by what it says itself", () => {
    const category = (use: boolean) =>
      def("economic_category", "sts_category", {
        parent: "country",
        ...(use ? { use_for_ai_budget: true } : {}),
      });
    expect(reported(mod().add(category(true)).add(budget("sts_category")), "unused-ai-budget")).toEqual([]);
    expect(reported(mod().add(category(false)).add(budget("sts_category")), "unused-ai-budget")).toEqual([
      "sts_budget.category",
    ]);
  });

  it("takes a number for a factor, and a variable of the mod's own", () => {
    const target = mod().add(
      budget("ships", {
        desired_min: { base: 100, modifier: repeated({ factor: 2, is_at_war: true }, { factor: "sts_variable" }) },
      }),
    );
    expect(validate(target).filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });
});

/**
 * An object holds a key once, and a spread obeys that without a word: the
 * condition a spread overwrites is gone before anything can see it.
 */
describe("conditions built from parts", () => {
  it("are kept apart by all(), each in a block of its own", () => {
    const posture = { has_country_flag: "sts_mobilising" };
    const merged = { ...posture, has_country_flag: "sts_prey" };
    expect(Object.values(merged)).toEqual(["sts_prey"]);
    expect(renderDefinitions([["potential", all(posture, { has_country_flag: "sts_prey" })]])).toBe(
      [
        "potential = {",
        "\tAND = {",
        "\t\thas_country_flag = sts_mobilising",
        "\t}",
        "\tAND = {",
        "\t\thas_country_flag = sts_prey",
        "\t}",
        "}",
        "",
      ].join("\n"),
    );
  });
});
