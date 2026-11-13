import { describe, expect, it } from "vitest";

import { define } from "../src/builders/index.js";
import type { PdxBlock } from "../src/generated/types/script.js";
import { defineMod, raw, repeated, type Mod } from "../src/index.js";
import { validate, type ValidationDiagnostic } from "../src/validate/index.js";
import { vanillaModsCompatibilityVersion } from "../src/generated/vanilla/game-version.js";

/** What this build of the game asks a mod to declare, so no test pins one release. */
const SUPPORTED_VERSION = `v${vanillaModsCompatibilityVersion}.*`;

const mod = (): Mod => defineMod({ name: "Load", version: "1", supportedVersion: SUPPORTED_VERSION });

/** The diagnostics one code produced, as `definition.path`. */
const reported = (target: Mod, code: string): readonly string[] =>
  validate(target)
    .filter((diagnostic: ValidationDiagnostic) => diagnostic.code === code)
    .map((diagnostic) =>
      diagnostic.path.length === 0 ? diagnostic.definition : `${diagnostic.definition}.${diagnostic.path}`,
    );

const missingStrings = (target: Mod): readonly string[] =>
  validate(target)
    .filter((diagnostic) => diagnostic.code === "missing-localisation")
    .map((diagnostic) => /string for (\S+?)[,;]/u.exec(diagnostic.message)?.[1] ?? "?");

/** A station that is nothing but the fields the type requires. */
const station = (body: Record<string, unknown>) =>
  define("ship_size", "sts_station", { class: "shipclass_military_station", ...body });

/**
 * The game's loader looks for `<key>_entity` when a ship size names none, and
 * for `<culture>_<entity>` unless `graphical_culture = no`; a name it cannot
 * find is drawn as the test object (`0xd293f0`).
 */
describe("a ship size's entity", () => {
  it("is looked for under the ship size's own name when none is written", () => {
    expect(reported(mod().add(station({ graphical_culture: false })), "unresolved-reference")).toEqual(["sts_station"]);
  });

  it("is found when the mod defines it, in a definition or in its own .asset file", () => {
    const defined = mod()
      .add(station({ graphical_culture: false }))
      .add(define("model_entity", "sts_station_entity", { pdxmesh: "sts_station_mesh" }));
    const shipped = mod().add(station({ graphical_culture: false }));
    shipped.file({
      path: "gfx/models/ships/sts_station.asset",
      contents: 'entity = { name = "sts_station_entity" pdxmesh = "sts_station_mesh" }\n',
    });

    // The entity's own mesh is not this test's business.
    expect(reported(defined, "unresolved-reference").filter((where) => where.startsWith("sts_station."))).toEqual([]);
    expect(reported(defined, "unresolved-reference")).not.toContain("sts_station");
    expect(reported(shipped, "unresolved-reference")).toEqual([]);
  });

  it("is found through a graphical culture unless the ship size turns cultures off", () => {
    // Vanilla has `mammalian_01_corvette_entity` and no `corvette_entity`.
    expect(reported(mod().add(station({ entity: "corvette_entity" })), "unresolved-reference")).toEqual([]);
    expect(
      reported(mod().add(station({ entity: "corvette_entity", graphical_culture: false })), "unresolved-reference"),
    ).toEqual(["sts_station.entity"]);
  });

  it("is the base game's when the base game has it", () => {
    expect(
      reported(
        mod().add(station({ entity: "enclave_station_entity", graphical_culture: false })),
        "unresolved-reference",
      ),
    ).toEqual([]);
  });

  it("is not judged when an inline script may write it", () => {
    expect(reported(mod().add(station({ inline_script: { script: "sts/station" } })), "unresolved-reference")).toEqual(
      [],
    );
  });
});

const site = (body: Record<string, unknown>) =>
  define("megastructure", "sts_site", { entity: "construction_platform_entity", ...body });

/** `GFX_<key>_outliner_icon` is the only sprite the outliner shows a megastructure by (`0xd51cc0`). */
describe("a megastructure's outliner icon", () => {
  it("is asked for, since the outliner shows a megastructure unless told not to", () => {
    expect(reported(mod().add(site({})), "unresolved-reference")).toEqual(["sts_site"]);
  });

  it("is not asked for once show_in_outliner = no", () => {
    expect(reported(mod().add(site({ show_in_outliner: false })), "unresolved-reference")).toEqual([]);
  });

  it("is found in a sprite the mod defines or ships in its own .gfx file", () => {
    const defined = mod()
      .add(site({}))
      .add(
        define("sprite", "GFX_sts_site_outliner_icon", { texturefile: "gfx/interface/sts.dds" }, { as: "spriteType" }),
      );
    const shipped = mod().add(site({}));
    shipped.file({
      path: "interface/sts_outliner.gfx",
      contents:
        'spriteTypes = { spriteType = { name = "GFX_sts_site_outliner_icon" texturefile = "gfx/interface/sts.dds" } }\n',
    });

    expect(reported(defined, "unresolved-reference")).toEqual([]);
    expect(reported(shipped, "unresolved-reference")).toEqual([]);
  });

  it("is not judged behind an outliner_trigger, which the game evaluates first", () => {
    expect(reported(mod().add(site({ outliner_trigger: { always: false } })), "unresolved-reference")).toEqual([]);
  });
});

const situation = (body: Record<string, unknown>) =>
  define("situation_type", "sts_situation", { monthly_progress: { base: 1 }, ...body });

const approach = (body: Record<string, unknown>) => ({
  name: "sts_approach",
  icon: "GFX_situation_approach_scales",
  icon_background: "GFX_situation_approach_bg_green",
  ...body,
});

/** `0x4e4490` logs an approach that has nothing to show, and an outcome of one effect. */
describe("a situation", () => {
  it("is told when an approach has no effect, modifier or resources to show", () => {
    expect(reported(mod().add(situation({ approach: approach({ default: true }) })), "missing-description")).toEqual([
      "sts_situation.approach",
    ]);
  });

  it("is not told when the approach has an effect, a modifier, resources, or an inline script", () => {
    const shows = [
      { on_select: { custom_tooltip: "sts_tooltip" } },
      { modifier: { country_unity_produces_mult: 0.1 } },
      { resources: { category: "situations", upkeep: { energy: 1 } } },
      { inline_script: { script: "sts/approach" } },
    ];

    for (const body of shows) {
      expect(reported(mod().add(situation({ approach: approach(body) })), "missing-description")).toEqual([]);
    }
  });

  // The approach's own custom_tooltip is kept apart, and the check never reads it.
  it("is told even when the approach writes its own custom_tooltip and nothing in on_select", () => {
    expect(
      reported(mod().add(situation({ approach: approach({ custom_tooltip: "sts_tooltip" }) })), "missing-description"),
    ).toEqual(["sts_situation.approach"]);
  });

  it("is told when on_fail or on_progress_complete holds exactly one effect", () => {
    const target = mod().add(
      situation({
        on_fail: { destroy_situation: "this" },
        on_progress_complete: { custom_tooltip: "sts_done" },
      }),
    );

    expect(reported(target, "missing-description")).toEqual([
      "sts_situation.on_fail",
      "sts_situation.on_progress_complete",
    ]);
  });

  it("is not told about an outcome that says what it does beside a hidden_effect", () => {
    const target = mod().add(
      situation({
        on_fail: { custom_tooltip: "sts_failed", hidden_effect: { destroy_situation: "this" } },
        on_progress_complete: {},
      }),
    );

    expect(reported(target, "missing-description")).toEqual([]);
  });
});

/** `0x343220` and its inlined copies ask each reason of a few weights for a desc. */
describe("a weight the game shows reason by reason", () => {
  const resolution = (ai_weight: PdxBlock) =>
    define("resolution", "sts_resolution", {
      icon: "GFX_resolution_galactic_commerce",
      resources: { category: "resolutions", cost: { influence: 10 } },
      target: false,
      ai_weight,
    });

  it("needs a desc on a modifier that applies under a condition", () => {
    expect(
      reported(mod().add(resolution({ base: 1, modifier: { factor: 2, is_megacorp: true } })), "missing-description"),
    ).toEqual(["sts_resolution.ai_weight.modifier"]);
  });

  it("does not need one on a described modifier, or one with no condition", () => {
    const described = resolution({ base: 1, modifier: { factor: 2, is_megacorp: true, desc: "sts_megacorp" } });
    const unconditional = resolution({ base: 1, modifier: { factor: 2 } });

    expect(reported(mod().add(described), "missing-description")).toEqual([]);
    expect(reported(mod().add(unconditional), "missing-description")).toEqual([]);
  });

  it("needs a desc on every complex_trigger_modifier", () => {
    const target = mod().add(
      resolution({ base: 1, complex_trigger_modifier: { trigger: "num_owned_planets", mode: "add" } }),
    );

    expect(reported(target, "missing-description")).toEqual(["sts_resolution.ai_weight.complex_trigger_modifier"]);
  });

  it("is only the weights the game checks: a policy option's ai_weight is not one", () => {
    const target = mod().add(
      define("policy", "sts_policy", {
        option: {
          name: "sts_option",
          ai_weight: { factor: 1, modifier: { factor: 2, is_megacorp: true } },
        },
      }),
    );

    expect(reported(target, "missing-description")).toEqual([]);
  });

  it("is a situation's monthly_progress as well", () => {
    const target = mod().add(situation({ monthly_progress: { base: 1, modifier: { add: 1, is_ai: true } } }));

    expect(reported(target, "missing-description")).toEqual(["sts_situation.monthly_progress.modifier"]);
  });
});

/**
 * A policy option's name is looked up as written and with `_desc`, and each of
 * its flags with `_name` (`0x4ffdf0`, `0x4fee10`); the option itself is never
 * asked for `<name>_name`.
 */
describe("a policy option's strings", () => {
  it("are its name, its name's _desc and each flag's _name", () => {
    const target = mod().add(
      define("policy", "sts_policy", {
        option: repeated(
          { name: "sts_plain", ai_weight: { factor: 1 } },
          { name: "sts_flagged", policy_flags: ["sts_flag"], ai_weight: { factor: 1 } },
        ),
      }),
    );

    for (const key of ["policy_sts_policy", "policy_sts_policy_desc", "sts_plain", "sts_flagged"]) {
      target.localise("l_english", key, key);
    }

    expect(missingStrings(target)).toEqual(["sts_plain_desc", "sts_flag_name", "sts_flagged_desc"].sort());
  });
});

/** A value with no key names strings as a keyed one does. */
describe("a list item that names a string", () => {
  it("is looked up", () => {
    const target = mod().add(
      define("timeline_events_type", "sts_timeline", { gui: ["sts_gui"], text: ["sts_missing_text"] }),
    );

    expect(missingStrings(target)).toContain("sts_missing_text");
  });

  it("is not looked up where the item is a word: a civic's flags, a timeline event's targets", () => {
    const target = mod().add(
      define(
        "event",
        "sts_load.1",
        {
          is_triggered_only: true,
          immediate: { add_timeline_event: { type: "timeline_empire", targets: ["root", "root.owner"] } },
        },
        { as: "country_event" },
      ),
    );

    expect(missingStrings(target).filter((key) => key.startsWith("root"))).toEqual([]);
  });
});

/** What a raw file defines is the mod's own, like what define() writes. */
describe("a definition a raw file declares", () => {
  it("is known: a scripted trigger written by hand is a trigger the mod has", () => {
    const target = mod().add(
      define(
        "event",
        "sts_load.2",
        { is_triggered_only: true, trigger: { sts_is_ready: true } },
        { as: "country_event" },
      ),
    );

    expect(reported(target, "unknown-field")).toEqual(["sts_load.2.trigger"]);

    target.file({ path: "common/scripted_triggers/sts_triggers.txt", contents: "sts_is_ready = { always = yes }\n" });

    expect(reported(target, "unknown-field")).toEqual([]);
  });

  it("is read under either spelling of its path", () => {
    const target = mod().add(
      define(
        "event",
        "sts_load.4",
        { is_triggered_only: true, trigger: { sts_is_ready: true } },
        { as: "country_event" },
      ),
    );

    target.file({
      path: "./common\\scripted_triggers\\sts_triggers.txt",
      contents: "sts_is_ready = { always = yes }\n",
    });

    expect(reported(target, "unknown-field")).toEqual([]);
  });

  it("counts only where the game reads it from", () => {
    const target = mod().add(
      define(
        "event",
        "sts_load.3",
        { is_triggered_only: true, trigger: { sts_is_ready: true } },
        { as: "country_event" },
      ),
    );

    target.file({ path: "common/scripted_effects/sts_effects.txt", contents: "sts_is_ready = { log = x }\n" });

    expect(reported(target, "unknown-field")).toEqual(["sts_load.3.trigger"]);
  });

  it("can be raw() inside a body, and is read as the game reads it", () => {
    const target = mod().add(situation({ approach: approach({ on_select: raw("{ custom_tooltip = sts_tooltip }") }) }));

    expect(reported(target, "missing-description")).toEqual([]);
  });
});

/**
 * The building's check logs one whose `building_sets` holds nothing and whose
 * `owner_type` is the default (`0x46c9f0`): a zone takes buildings by set.
 */
describe("a building's sets", () => {
  const lab = (body: Record<string, unknown>) => define("building", "sts_lab", { category: "research", ...body });

  it("are asked of a building, and an empty list is none", () => {
    expect(reported(mod().add(lab({})), "missing-building-sets")).toEqual(["sts_lab"]);
    expect(reported(mod().add(lab({ building_sets: [] })), "missing-building-sets")).toEqual(["sts_lab.building_sets"]);
    expect(reported(mod().add(lab({ building_sets: ["research"] })), "missing-building-sets")).toEqual([]);
  });

  it("are not asked of a branch office's building or an overlord's holding", () => {
    for (const owner of ["corporate", "subject_holding", "none"]) {
      expect(reported(mod().add(lab({ owner_type: owner })), "missing-building-sets"), owner).toEqual([]);
    }
    // `0x337b70` reads `normal`, and any word it does not know, as the default.
    expect(reported(mod().add(lab({ owner_type: "normal" })), "missing-building-sets")).toEqual(["sts_lab"]);
  });

  it("are not judged when an inline script may write them", () => {
    expect(
      reported(mod().add(lab({ inline_script: { script: "sts/building_sets" } })), "missing-building-sets"),
    ).toEqual([]);
  });
});

/** The district's check: `District type is missing zone slots. This will lead to a crash` (`0x48d620`). */
describe("a district's zone slots", () => {
  const district = (body: Record<string, unknown>) =>
    define("district", "district_sts", { potential: { always: true }, ...body });

  it("are asked of every district", () => {
    const bare = validate(mod().add(district({}))).filter((diagnostic) => diagnostic.code === "missing-zone-slots");

    expect(bare).toHaveLength(1);
    expect(bare[0]?.message).toContain("This will lead to a crash: district_sts");
    expect(reported(mod().add(district({ zone_slots: ["slot_city_01"] })), "missing-zone-slots")).toEqual([]);
    expect(reported(mod().add(district({ zone_slots: [] })), "missing-zone-slots")).toEqual([
      "district_sts.zone_slots",
    ]);
  });
});

/** Each key of `common/game_concepts` is searched for `concept_` at its start (`0x7c9ae0`). */
describe("a game concept's key", () => {
  it("starts with concept_", () => {
    const unprefixed = mod().add(define("concept", "sts_idea", {}));
    const prefixed = mod().add(define("concept", "concept_sts_idea", {}));

    expect(reported(unprefixed, "unprefixed-concept")).toEqual(["sts_idea"]);
    expect(reported(prefixed, "unprefixed-concept")).toEqual([]);
  });
});
