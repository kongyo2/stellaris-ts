import { describe, expect, it } from "vitest";

import { define, defineIn } from "../src/builders/index.js";
import { vanillaModsCompatibilityVersion } from "../src/generated/vanilla/game-version.js";
import { vanillaPlacement } from "../src/generated/vanilla/placement.js";
import { vanillaTaggedKeys } from "../src/generated/vanilla/tagged-keys.js";
import type { DefinitionShapes } from "../src/generated/types/index.js";
import { defineMod, emit, NodeKind, parse, type EmitPlan, type Mod } from "../src/index.js";
import { schema } from "../src/schema/index.js";
import type { DefinitionType } from "../src/schema/ir.js";
import type { DefinitionRecord } from "../src/runtime/mod.js";

/**
 * Where a definition is written decides whether the game reads it at all.
 *
 * The game lists `interface` for `.gfx`, reads a sprite only from inside
 * `spriteTypes = { }`, and opens `common/alerts.txt` by name. A sprite written
 * as a bare `spriteType` in `interface/zz_mod_sprite.txt` loads nothing, and
 * the game says nothing about it.
 */

const SUPPORTED_VERSION = `v${vanillaModsCompatibilityVersion}.*`;

const modOf = (...definitions: readonly DefinitionRecord[]): Mod => {
  const mod = defineMod({ name: "Placed", id: "placed", version: "1", supportedVersion: SUPPORTED_VERSION });
  for (const definition of definitions) {
    mod.add(definition);
  }
  return mod;
};

function contentsAt(plan: EmitPlan, path: string): string {
  const file = plan.files.find((candidate) => candidate.path === path);
  if (file?.kind !== "text") {
    throw new Error(`No script at ${path}. Got: ${plan.files.map((candidate) => candidate.path).join(", ")}`);
  }
  return file.contents;
}

/** The root-level keys of a file, in order. */
function rootKeys(contents: string): readonly string[] {
  return parse(contents).document.entries.flatMap((entry) =>
    entry.kind === NodeKind.Assignment ? [String(entry.key.value)] : [],
  );
}

const isShapeType = (id: string): id is keyof DefinitionShapes => schema.definitionTypes.some((type) => type.id === id);

/**
 * A definition placed as `define` places it, holding the body given.
 *
 * The body is swapped in afterwards because the placement is what is under
 * test, and the generated shapes rightly refuse the empty bodies used here.
 */
function placed(
  typeId: string,
  id: string,
  body: object = {},
  options: { as?: string; file?: string } = {},
): DefinitionRecord {
  if (!isShapeType(typeId)) {
    throw new Error(`${typeId} is not a definition type.`);
  }

  const tag: string | undefined = options.as ?? vanillaTaggedKeys[typeId]?.[0];
  return {
    ...define(
      typeId,
      id,
      {},
      { ...(tag === undefined ? {} : { as: tag }), ...(options.file === undefined ? {} : { file: options.file }) },
    ),
    body,
  };
}

/** A definition of the type with an empty body, under its first tag when it has tags. */
const emptyDefinition = (type: DefinitionType): DefinitionRecord => placed(type.id, `placed_${type.id.toLowerCase()}`);

describe("where a definition is written", () => {
  it("writes sprites inside spriteTypes, in a .gfx file", () => {
    const plan = emit(
      modOf(
        define("sprite", "GFX_placed_b", { textureFile: "gfx/interface/icons/b.dds" }, { as: "spriteType" }),
        define("sprite", "GFX_placed_a", { textureFile: "gfx/interface/icons/a.dds" }, { as: "spriteType" }),
      ),
    );

    expect(contentsAt(plan, "interface/zz_placed_sprite.gfx")).toBe(
      [
        "spriteTypes = {",
        "\tspriteType = {",
        "\t\tname = GFX_placed_a",
        "\t\ttextureFile = gfx/interface/icons/a.dds",
        "\t}",
        "\tspriteType = {",
        "\t\tname = GFX_placed_b",
        "\t\ttextureFile = gfx/interface/icons/b.dds",
        "\t}",
        "}",
        "",
      ].join("\n"),
    );
    expect(plan.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("wraps portraits, portrait groups and name lists in the block vanilla reads them from", () => {
    const plan = emit(
      modOf(
        placed("portrait", "placed_portrait"),
        placed("portrait_group", "placed_group"),
        placed("species_named_list", "placed_names"),
      ),
    );

    expect(rootKeys(contentsAt(plan, "gfx/portraits/portraits/zz_placed_portrait.txt"))).toEqual(["portraits"]);
    expect(rootKeys(contentsAt(plan, "gfx/portraits/portraits/zz_placed_portrait_group.txt"))).toEqual([
      "portrait_groups",
    ]);
    expect(rootKeys(contentsAt(plan, "common/species_names/zz_placed_species_named_list.txt"))).toEqual([
      "named_lists",
    ]);
  });

  it("writes one block per container when a file holds two kinds", () => {
    const plan = emit(
      modOf(
        placed("sprite", "GFX_placed", {}, { as: "spriteType", file: "placed.gfx" }),
        placed("bitmapfont", "placed_font", {}, { file: "placed.gfx" }),
      ),
    );

    expect(rootKeys(contentsAt(plan, "interface/placed.gfx"))).toEqual(["bitmapfonts", "spriteTypes"]);
  });

  it("puts a sound in the .asset file the game lists sound for", () => {
    const plan = emit(modOf(placed("sound_effect", "placed_sound")));

    expect(rootKeys(contentsAt(plan, "sound/zz_placed_sound_effect.asset"))).toEqual(["soundeffect"]);
  });

  it("refuses a file the game does not open for the type", () => {
    const plan = emit(
      modOf(defineIn("sprite", "placed.txt", "GFX_placed", { textureFile: "gfx/x.dds" }, { as: "spriteType" })),
    );
    const found = plan.diagnostics.find((diagnostic) => diagnostic.code === "unread-extension");

    expect(found?.severity).toBe("error");
    expect(found?.path).toBe("interface/placed.txt");
  });

  it("writes a whole-file definition as the file its id names", () => {
    const plan = emit(
      modOf(
        placed("diplomacy_economy", "placed_economy", { once: { federation: { trigger: { has_federation: true } } } }),
      ),
    );

    expect(rootKeys(contentsAt(plan, "common/diplomacy_economy/placed_economy.txt"))).toEqual(["once"]);
  });

  it("says when the game reads a type from one file it opens by name", () => {
    const plan = emit(modOf(placed("alert", "placed_alert")));
    const found = plan.diagnostics.find((diagnostic) => diagnostic.code === "unread-file");

    expect(found?.severity).toBe("error");
    expect(found?.message).toContain("common/alerts.txt");
  });

  it("writes that file when the replacement is asked for", () => {
    const plan = emit(modOf({ ...placed("alert", "placed_alert"), overrides: "common/alerts.txt" }));
    const codes: readonly string[] = plan.diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).not.toContain("unread-file");
    expect(codes).toContain("vanilla-override");
    expect(rootKeys(contentsAt(plan, "common/alerts.txt"))).toEqual(["alerts"]);
  });

  it("refuses a block that only exists inside another definition", () => {
    expect(() => placed("swapped_civic", "placed_swap")).toThrow(/swap_type/u);
    expect(() => placed("tradition_swap", "placed_swap")).toThrow(/tradition_swap/u);
  });

  /**
   * Every type the schema reads from inside a block: thirteen named containers,
   * and the bitmap fonts vanilla keeps in `bitmapfonts`.
   */
  const contained: readonly DefinitionType[] = schema.definitionTypes.filter(
    (type) =>
      type.source.container !== undefined &&
      (type.source.container.kind === "named-container" || vanillaPlacement[type.id]?.container !== undefined),
  );

  it("covers every contained type", () => {
    expect(contained.length).toBeGreaterThanOrEqual(14);
  });

  for (const type of contained) {
    it(`writes ${type.id} inside the block the game reads it from`, () => {
      const definition: DefinitionRecord = emptyDefinition(type);
      const plan = emit(
        modOf({ ...definition, ...(definition.onlyFile === undefined ? {} : { overrides: definition.onlyFile }) }),
      );
      const expected: string | undefined =
        type.source.container?.kind === "named-container"
          ? type.source.container.key
          : vanillaPlacement[type.id]?.container;
      const file = plan.files.find(
        (candidate) => candidate.kind === "text" && candidate.path.startsWith(`${type.source.directory}/`),
      );

      expect(file?.kind).toBe("text");
      expect(rootKeys(file?.kind === "text" ? file.contents : "")).toEqual([expected]);
    });
  }

  for (const [typeId, placement] of Object.entries(vanillaPlacement)) {
    if (placement.extension === ".txt" || schema.definitionTypes.every((type) => type.id !== typeId)) {
      continue;
    }

    it(`gives ${typeId} the ${placement.extension} extension vanilla keeps it in`, () => {
      const type = schema.definitionTypes.find((candidate) => candidate.id === typeId);
      const definition: DefinitionRecord | undefined = type === undefined ? undefined : emptyDefinition(type);
      const plan = emit(modOf(...(definition === undefined ? [] : [definition])));

      expect(plan.files.some((file) => file.path.endsWith(placement.extension) && file.path !== "descriptor.mod")).toBe(
        true,
      );
      expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("unread-extension");
    });
  }
});
