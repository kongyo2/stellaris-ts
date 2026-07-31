import { describe, expect, it } from "vitest";

import { define, defineIn } from "../src/builders/index.js";
import { bare, defineMod, emit, entries, gt, parse, print, raw, repeated, rgb, type EmitPlan } from "../src/index.js";
import { BYTE_ORDER_MARK } from "../src/runtime/localisation.js";

function fileNamed(plan: EmitPlan, path: string): string {
  const file = plan.files.find((candidate) => candidate.path === path);
  if (file === undefined) {
    throw new Error(`No emitted file at ${path}. Got: ${plan.files.map((f) => f.path).join(", ")}`);
  }
  if (file.kind !== "text") {
    throw new Error(`${path} was emitted as bytes, not script.`);
  }
  return file.contents;
}

/** Everything a plan writes, in a form two runs can be compared by. */
const bytesOf = (plan: EmitPlan): readonly string[] =>
  plan.files.map((file) => (file.kind === "text" ? file.contents : new TextDecoder().decode(file.bytes)));

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

  /**
   * Writing is concurrent, so two entries at one path is not a merge — it is a
   * race, and the file that survives is whichever finished last.
   */
  it("refuses two files at the same path", () => {
    const clashing = defineMod({ name: "Twice", version: "1", supportedVersion: "v4.4.*" })
      .add(define("building", "sts_lab", { category: "research" }))
      .file({ path: "common/buildings/zz_twice_building.txt", contents: "sts_other = { }\n" });

    const found = emit(clashing).diagnostics.find((diagnostic) => diagnostic.code === "duplicate-file");

    expect(found?.severity).toBe("error");
  });

  /**
   * The descriptor is a file like any other. It was appended after the check
   * that catches two files at one path, so a mod writing its own descriptor got
   * two of them and nothing said so — and the launcher reads whichever survived
   * being written.
   */
  it("counts the descriptor it generates when a mod writes one too", () => {
    const clashing = defineMod({ name: "Desc", version: "1", supportedVersion: "v4.4.*" }).file({
      path: "descriptor.mod",
      contents: 'name="Hand written"\n',
    });

    const found = emit(clashing).diagnostics.find((diagnostic) => diagnostic.code === "duplicate-file");

    expect(found?.severity).toBe("error");
    expect(found?.path).toBe("descriptor.mod");
  });

  it("leaves an ordinary mod's descriptor alone", () => {
    expect(emit(mod, { vanillaFiles: {} }).files.filter((file) => file.path === "descriptor.mod")).toHaveLength(1);
    expect(emit(mod).diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("duplicate-file");
  });

  it("is deterministic", () => {
    const again: EmitPlan = emit(mod, { vanillaFiles: {} });
    expect(bytesOf(again)).toEqual(bytesOf(emit(mod, { vanillaFiles: {} })));
  });
});

describe("the format's awkward corners", () => {
  it("writes a comparison rather than an assignment", () => {
    const mod = defineMod({ name: "Cmp", version: "1", supportedVersion: "v4.4.*" }).add(
      define("building", "cmp", { potential: { num_owned_planets: gt(1) } }),
    );

    expect(fileNamed(emit(mod), "common/buildings/zz_cmp_building.txt")).toContain("num_owned_planets > 1");
  });

  it("repeats a key rather than collapsing it into a value list", () => {
    const mod = defineMod({ name: "Rep", version: "1", supportedVersion: "v4.4.*" }).add(
      define("building", "rep", { potential: { has_modifier: repeated("a", "b") } }),
    );
    const script: string = fileNamed(emit(mod), "common/buildings/zz_rep_building.txt");

    expect(script).toContain("has_modifier = a");
    expect(script).toContain("has_modifier = b");
    expect(script).not.toContain("has_modifier = {");
  });

  it("keeps a plain array a value list, which is a different thing", () => {
    const mod = defineMod({ name: "List", version: "1", supportedVersion: "v4.4.*" }).add(
      define("building", "lst", { convert_to: ["a", "b"] }),
    );

    expect(fileNamed(emit(mod), "common/buildings/zz_list_building.txt")).toMatch(/convert_to = \{\s+a\s+b\s+\}/u);
  });

  it("takes raw script for what has no object shape, and rejects it when malformed", () => {
    const mod = defineMod({ name: "Raw", version: "1", supportedVersion: "v4.4.*" })
      .add(define("building", "raw_one", { base_buildtime: raw("@[ base * 2 ]") }))
      .add(define("authority", "raw_two", { color: rgb(255, 0, 0), ruler_council_position: "councilor_head" }));

    expect(fileNamed(emit(mod), "common/buildings/zz_raw_building.txt")).toContain("@[ base * 2 ]");
    // Raw script is parsed and re-printed in the canonical style, so a colour
    // comes back as a block rather than the one-liner it went in as. The game
    // reads both the same.
    expect(fileNamed(emit(mod), "common/governments/authorities/zz_raw_authority.txt")).toMatch(
      /color = rgb \{\s+255\s+0\s+0\s+\}/u,
    );

    const broken = defineMod({ name: "Broken", version: "1", supportedVersion: "v4.4.*" }).add(
      define("building", "broken", { base_buildtime: raw("} = =") }),
    );
    expect(() => emit(broken)).toThrow(/not one PDX value/u);
  });

  /**
   * `raw()` is the escape hatch for what the object form cannot say, so losing
   * half of what was written is the failure it can least afford. A fragment
   * holding two entries parses without complaint, and only the first was kept.
   */
  it("refuses a raw fragment that is more than one value", () => {
    const trailing = defineMod({ name: "Trail", version: "1", supportedVersion: "v4.4.*" }).add(
      define("building", "trail", { base_buildtime: raw("{ a = 1 } b = 2") }),
    );

    expect(() => emit(trailing)).toThrow(/not one PDX value/u);
  });

  it("refuses a number PDX cannot write", () => {
    const infinite = defineMod({ name: "Inf", version: "1", supportedVersion: "v4.4.*" }).add(
      define("building", "inf", { base_buildtime: 1 / 0 }),
    );

    expect(() => emit(infinite)).toThrow(/has no number Infinity/u);
  });

  /**
   * A mod with no icons is not a mod anyone ships: every definition that draws
   * one shows the missing-texture square without it. A `.dds` is not text in any
   * encoding, so it travels as bytes all the way to the file.
   */
  it("carries an asset through as the bytes that went in", () => {
    const bytes = new Uint8Array([0x44, 0x44, 0x53, 0x20, 0x00, 0xff, 0x80]);
    const mod = defineMod({ name: "Icons", version: "1", supportedVersion: "v4.4.*" }).asset(
      "gfx/interface/icons/buildings/sts_lab.dds",
      bytes,
    );

    const file = emit(mod).files.find((candidate) => candidate.path.endsWith("sts_lab.dds"));

    expect(file?.kind).toBe("binary");
    expect(file?.kind === "binary" ? [...file.bytes] : []).toEqual([...bytes]);
  });

  /**
   * The listing has to hold the formats an asset is actually in. It was built
   * from the directories the definition types name, which is where script
   * lives, so a `.dds` at a vanilla path could never match it and the check
   * passed every texture a mod could possibly replace.
   */
  it("says nothing about an asset under a name of the mod's own", () => {
    const mod = defineMod({ name: "Fine", version: "1", supportedVersion: "v4.4.*" }).asset(
      "gfx/interface/icons/buildings/sts_kyome_lab.dds",
      new Uint8Array([1]),
    );

    expect(emit(mod).diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("vanilla-filename-collision");
  });

  it("reports an asset that would replace a vanilla texture", () => {
    const mod = defineMod({ name: "Clash", version: "1", supportedVersion: "v4.4.*" }).asset(
      "gfx/interface/icons/buildings/avatar_chamber_1.dds",
      new Uint8Array([1]),
    );
    const found = emit(mod).diagnostics.find((diagnostic) => diagnostic.code === "vanilla-filename-collision");

    expect(found?.severity).toBe("error");
  });

  /**
   * Replacing a vanilla file on purpose is a real thing to do, and both the raw
   * file record and the asset record have said so since they existed. Emit read
   * neither, so declaring it left the error in place with nothing to be done
   * about it.
   */
  it("takes an intended replacement at its word, for a raw file and for an asset", () => {
    const mod = defineMod({ name: "Meant", version: "1", supportedVersion: "v4.4.*" })
      .file({ path: "common/alerts.txt", contents: "x = { }\n", overrides: true })
      .asset("gfx/interface/icons/buildings/avatar_chamber_1.dds", new Uint8Array([1]), { overrides: true });

    const diagnostics = emit(mod).diagnostics.filter((diagnostic) => diagnostic.code === "vanilla-filename-collision");

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((diagnostic) => diagnostic.severity === "warning")).toBe(true);
  });

  /**
   * The flag says "the collision you are about to report is intended", so it
   * downgrades that report and says nothing of its own. Saying something of its
   * own claimed a vanilla file had been replaced at paths vanilla does not
   * ship, and said it twice at paths it does.
   */
  it("says nothing about an intended replacement of a file vanilla does not ship", () => {
    const mod = defineMod({ name: "Own", version: "1", supportedVersion: "v4.4.*" }).file({
      path: "common/buildings/zz_own_extra.txt",
      contents: "x = { }\n",
      overrides: true,
    });

    expect(emit(mod).diagnostics).toEqual([]);
  });

  it("keeps written order when bare values sit among keyed ones", () => {
    const mod = defineMod({ name: "Ord", version: "1", supportedVersion: "v4.4.*" }).add(
      define("building", "ord", {
        potential: entries([["first", 1], bare("loose"), ["second", 2]]),
      }),
    );
    const script: string = fileNamed(emit(mod), "common/buildings/zz_ord_building.txt");
    const order: readonly number[] = ["first = 1", "loose", "second = 2"].map((part) => script.indexOf(part));

    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
  });
});

describe("quoting", () => {
  it("does not double a backslash, which PDX does not use as an escape", () => {
    const mod = defineMod({ name: "Esc", version: "1", supportedVersion: "v4.4.*" }).add(
      define("building", "esc", { potential: { log: String.raw`- This: \[This.GetName]` } }),
    );
    const script: string = fileNamed(emit(mod), "common/buildings/zz_esc_building.txt");

    expect(script).toContain(String.raw`log = "- This: \[This.GetName]"`);
    // Two backslashes would be a different string to the game.
    expect(script).not.toContain("\\\\[");
  });

  it("still escapes a quote, which would end the string", () => {
    const mod = defineMod({ name: "Q", version: "1", supportedVersion: "v4.4.*" }).add(
      define("building", "q", { potential: { log: 'say "hi"' } }),
    );

    expect(fileNamed(emit(mod), "common/buildings/zz_q_building.txt")).toContain('log = "say \\"hi\\""');
  });
});
