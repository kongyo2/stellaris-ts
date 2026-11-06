import { describe, expect, it } from "vitest";

import { define } from "../src/builders/index.js";
import { vanillaModsCompatibilityVersion } from "../src/generated/vanilla/game-version.js";
import { bare, defineMod, entries, eq, gt, gte, lt, ne, renderDefinitions, repeated, type Mod } from "../src/index.js";
import type { DefinitionRecord } from "../src/runtime/mod.js";
import { validate, type ValidationDiagnostic } from "../src/validate/index.js";

/**
 * Script the game reads as something other than what it says.
 *
 * Each of these parses, loads and is wrong: a block where the reader takes one
 * value, a comparison where nothing reads the operator, and an array written
 * for a key that was meant to appear once per element.
 */

const SUPPORTED_VERSION = `v${vanillaModsCompatibilityVersion}.*`;

const modOf = (...definitions: readonly DefinitionRecord[]): Mod => {
  const mod = defineMod({ name: "Shape", id: "shape", version: "1", supportedVersion: SUPPORTED_VERSION });
  for (const definition of definitions) {
    mod.add(definition);
  }
  return mod;
};

const coded = (mod: Mod, code: string): readonly ValidationDiagnostic[] =>
  validate(mod).filter((diagnostic) => diagnostic.code === code);

/**
 * A definition holding the body given, placed by `define`.
 *
 * The bodies here are wrong on purpose, and the generated shapes would refuse
 * most of them before the checker under test ever saw them.
 */
const holding = (definition: DefinitionRecord, body: object): DefinitionRecord => ({ ...definition, body });

const event = (id: string, body: object): DefinitionRecord =>
  holding(define("event", id, {}, { as: "country_event" }), body);

describe("a block where the game reads one value", () => {
  /**
   * In the game the title reads "{", the description is empty and the
   * options give way to the default OK: the block's closing brace closes the
   * event, and everything after it is read outside.
   */
  it("reports an event title written as a block, once", () => {
    const found = coded(
      modOf(
        event("shape.1", {
          title: repeated(
            { trigger: { has_global_flag: "shape_a" }, text: "shape.1.a" },
            { trigger: { has_global_flag: "shape_b" }, text: "shape.1.b" },
          ),
          desc: "shape.1.desc",
          is_triggered_only: true,
          option: { name: "shape.1.ok" },
        }),
      ),
      "unexpected-block",
    );

    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("error");
    expect(found[0]?.path).toBe("");
    expect(found[0]?.message).toContain("title");
  });

  it("reports it for a hidden event too, which reads its title the same way", () => {
    const found = coded(
      modOf(event("shape.2", { title: { text: "x" }, hide_window: true, is_triggered_only: true })),
      "unexpected-block",
    );

    expect(found).toHaveLength(1);
  });

  it("accepts the blocks vanilla does write: a triggered description and picture", () => {
    const mod = modOf(
      event("shape.3", {
        title: "shape.3.name",
        desc: repeated(
          { trigger: { has_global_flag: "shape_a" }, text: "shape.3.a" },
          { trigger: { has_global_flag: "shape_b" }, text: "shape.3.b" },
        ),
        picture: { trigger: { has_global_flag: "shape_a" }, picture: "GFX_evt_alien_city" },
        is_triggered_only: true,
        option: { name: "shape.3.ok" },
      }),
    );

    expect(coded(mod, "unexpected-block")).toEqual([]);
  });

  it("accepts a colour written as the block of numbers it is", () => {
    const mod = modOf(define("named_color", "shape_colour", { color: [255, 0, 255, 255] }));

    expect(coded(mod, "unexpected-block")).toEqual([]);
    expect(coded(mod, "unexpected-value-list")).toEqual([]);
  });
});

describe("a comparison where nothing reads the operator", () => {
  it("reports a comparison inside an effect, and says what the game reads", () => {
    const found = coded(
      modOf(holding(define("scripted_effect", "shape_effect", {}), { add_resource: { energy: gt(500) } })),
      "unexpected-comparison",
    );

    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("error");
    expect(found[0]?.path).toBe("add_resource");
    expect(found[0]?.message).toContain("energy = 500");
  });

  it("reports one in a modifier block and in an effect's duration", () => {
    const mod = modOf(
      holding(define("building", "shape_lab", {}), {
        category: "research",
        planet_modifier: { job_researcher_add: gt(2) },
      }),
      define("scripted_effect", "shape_timed", { add_modifier: { modifier: "shape_mod", days: lt(360) } }),
    );

    expect(coded(mod, "unexpected-comparison").map((diagnostic) => diagnostic.path)).toEqual([
      "planet_modifier",
      "add_modifier",
    ]);
  });

  it("leaves a trigger to compare, at any depth", () => {
    const mod = modOf(
      holding(define("scripted_trigger", "shape_trigger", {}), {
        num_owned_planets: gt(1),
        check_variable: { which: "shape_var", value: gte(2) },
      }),
      holding(define("building", "shape_gate", {}), {
        category: "research",
        potential: { owner: { num_owned_planets: gt(3) } },
        on_built: { if: { limit: { num_pops: gt(5) }, add_resource: { energy: 10 } } },
      }),
    );

    expect(coded(mod, "unexpected-comparison")).toEqual([]);
  });

  it("accepts the comparisons vanilla writes in an effect, and = spelled as a comparison", () => {
    const mod = modOf(
      holding(define("scripted_effect", "shape_spawn", {}), {
        spawn_system: { min_distance: gte(10), max_distance: lt(20), initializer: "random" },
        remove_random_starbase_module: { type: ne("shipyard") },
        add_resource: { energy: eq(5) },
      }),
    );

    expect(coded(mod, "unexpected-comparison")).toEqual([]);
  });
});

describe("an array, which is one key holding a list", () => {
  it("is rendered as one block of keyless entries", () => {
    expect(renderDefinitions([["shape", { option: [{ name: "a" }, { name: "b" }] }]])).toBe(
      [
        "shape = {",
        "\toption = {",
        "\t\t{",
        "\t\t\tname = a",
        "\t\t}",
        "\t\t{",
        "\t\t\tname = b",
        "\t\t}",
        "\t}",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("reports an array of blocks under a key that takes none", () => {
    const found = coded(
      modOf(
        event("shape.4", {
          is_triggered_only: true,
          hide_window: true,
          option: [{ name: "shape.4.a" }, { name: "shape.4.b" }],
        }),
      ),
      "unexpected-value-list",
    );

    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("error");
    expect(found[0]?.message).toContain("repeated()");
  });

  it("reports the same blocks written as bare entries of an ordered list", () => {
    const found = coded(
      modOf(
        event("shape.6", {
          is_triggered_only: true,
          hide_window: true,
          option: entries([bare({ name: "shape.6.a" }), bare({ name: "shape.6.b" })]),
        }),
      ),
      "unexpected-value-list",
    );

    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe("");
  });

  it("accepts the same options written with repeated()", () => {
    const mod = modOf(
      event("shape.5", {
        is_triggered_only: true,
        hide_window: true,
        option: repeated({ name: "shape.5.a" }, { name: "shape.5.b" }),
      }),
    );

    expect(coded(mod, "unexpected-value-list")).toEqual([]);
  });

  it("checks the blocks of a list that does take them", () => {
    const mod = modOf(
      holding(define("scripted_effect", "shape_fleet", {}), {
        create_random_fleet: {
          size: 3,
          ship_designs: ["NAME_Alpha", { design: "NAME_Beta", weight: 2, max: 1, colour: "red" }],
        },
      }),
    );

    expect(coded(mod, "unexpected-value-list")).toEqual([]);
    expect(coded(mod, "unknown-field").map((diagnostic) => diagnostic.message)).toEqual([
      expect.stringContaining("colour"),
    ]);
  });

  it("still checks what the items of a value list point at", () => {
    const found = coded(
      modOf(
        define("technology", "shape_tech", {
          area: "physics",
          category: ["computing"],
          tier: 1,
          prerequisites: ["tech_lasers_1", "tech_shape_missing"],
        }),
      ),
      "unresolved-reference",
    );

    expect(found.map((diagnostic) => diagnostic.message)).toEqual([expect.stringContaining("tech_shape_missing")]);
  });
});
