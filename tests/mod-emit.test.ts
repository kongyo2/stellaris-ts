import { describe, expect, it } from "vitest";

import { define, defineIn } from "../src/builders/index.js";
import { defineMod, emit, parse, print, type EmitPlan } from "../src/index.js";
import { BYTE_ORDER_MARK } from "../src/runtime/localisation.js";

function fileNamed(plan: EmitPlan, path: string): string {
  const file = plan.files.find((candidate) => candidate.path === path);
  if (file === undefined) {
    throw new Error(`No emitted file at ${path}. Got: ${plan.files.map((f) => f.path).join(", ")}`);
  }
  return file.contents;
}

describe("mod emit", () => {
  const mod = defineMod({
    name: "Example Mod",
    version: "1.0.0",
    supportedVersion: "v4.4.*",
    tags: ["Gameplay"],
  })
    .add(
      define("building", "example_lab", {
        category: "research",
        base_buildtime: 360,
        potential: { exists: "owner" },
        planet_modifier: { job_researcher_add: 2 },
      }),
    )
    .localise("l_english", "example_lab", "Example Laboratory")
    .localise("l_english", "example_lab_desc", 'A "quoted" name\nover two lines');

  const plan: EmitPlan = emit(mod, { vanillaFiles: { "common/buildings": ["00_capital_buildings.txt"] } });

  it("routes a definition to its vanilla directory under a non-colliding name", () => {
    expect(plan.files.map((file) => file.path)).toContain("common/buildings/zz_example_mod_building.txt");
  });

  it("emits script the parser reads back to the same values", () => {
    const contents: string = fileNamed(plan, "common/buildings/zz_example_mod_building.txt");
    const result = parse(contents);

    expect(result.diagnostics).toEqual([]);
    expect(print(result.document)).toBe(contents);
    expect(contents).toContain("example_lab = {");
    expect(contents).toContain("category = research");
    expect(contents).toContain("base_buildtime = 360");
  });

  it("writes localisation with a BOM, LF and escaped values", () => {
    const contents: string = fileNamed(plan, "localisation/english/example_mod_l_english.yml");

    expect(contents.startsWith(BYTE_ORDER_MARK)).toBe(true);
    expect(contents).not.toContain("\r");
    expect(contents).toContain(`${BYTE_ORDER_MARK}l_english:`);
    expect(contents).toContain(' example_lab:0 "Example Laboratory"');
    expect(contents).toContain('\\"quoted\\"');
    expect(contents).toContain("\\n");
  });

  it("writes a descriptor the launcher can read", () => {
    const descriptor: string = fileNamed(plan, "descriptor.mod");

    expect(descriptor).toContain('name="Example Mod"');
    expect(descriptor).toContain('supported_version="v4.4.*"');
    expect(descriptor).toContain('version="1.0.0"');
    expect(descriptor).toContain('\t"Gameplay"');
    expect(plan.modFileName).toBe("example_mod.mod");
  });

  it("refuses a filename vanilla already ships unless the override is declared", () => {
    const colliding = defineMod({ name: "Collide", version: "1", supportedVersion: "v4.4.*" }).add(
      defineIn("building", "00_capital_buildings.txt", "x", {}),
    );
    const result: EmitPlan = emit(colliding, {
      vanillaFiles: { "common/buildings": ["00_capital_buildings.txt"] },
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("vanilla-filename-collision");
    expect(result.diagnostics.find((d) => d.code === "vanilla-filename-collision")?.severity).toBe("error");
  });

  it("checks against the shipped vanilla listing by default", () => {
    const collides = defineMod({ name: "Collide", version: "1", supportedVersion: "v4.4.*" }).add(
      defineIn("building", "00_capital_buildings.txt", "x", {}),
    );

    expect(emit(collides).diagnostics.map((diagnostic) => diagnostic.code)).toContain("vanilla-filename-collision");
    expect(emit(mod).diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("collision-check-skipped");
  });

  it("says so when the listing it was handed is empty", () => {
    expect(emit(mod, { vanillaFiles: {} }).diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "collision-check-skipped",
    );
  });

  it("is deterministic", () => {
    const again: EmitPlan = emit(mod, { vanillaFiles: {} });
    expect(again.files.map((file) => file.contents)).toEqual(
      emit(mod, { vanillaFiles: {} }).files.map((file) => file.contents),
    );
  });
});
