import { describe, expect, it } from "vitest";

import { define } from "../src/builders/index.js";
import { vanillaModsCompatibilityVersion } from "../src/generated/vanilla/game-version.js";
import { defineMod, emit, entries, gt, isEntries, raw, type EntriesValue, type Mod } from "../src/index.js";
import { validate, type ValidationDiagnostic } from "../src/validate/index.js";

const mod = (): Mod =>
  defineMod({ name: "Macro", version: "1", supportedVersion: `v${vanillaModsCompatibilityVersion}.*` });

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

import { vanillaScriptIds, vanillaScriptedVariables } from "../src/generated/vanilla/script-facts.js";
import { schema } from "../src/schema/index.js";

const effect = (id: string, body: Body) => def("scripted_effect", id, body);
const event = (id: string, immediate: Body) =>
  def("event", id, { is_triggered_only: true, hide_window: true, immediate }, { as: "country_event" });

/**
 * A scripted effect is kept as text, and the game reads two characters in it
 * as its own (`0xaff210` and `0xafef60`, `metascript.cpp`).
 */
describe("a [ or a $ in a definition the game keeps as text", () => {
  it("is an invalid macro entry when no second ] follows the bracket", () => {
    const target = mod().add(effect("sts_log", { log: "x [Root.some_variable] y" }));
    expect(reported(target, "invalid-macro-entry")).toEqual(["sts_log.log"]);
    expect(messages(target, "invalid-macro-entry")[0]).toContain('"Invalid macro entry in sts_log: oot.some_variable"');
  });

  it("is script cut out without a word when a second ] does follow", () => {
    const target = mod().add(
      effect(
        "sts_log",
        entries([
          ["log", "a [Root.GetName] b"],
          ["set_country_flag", "sts_between"],
          ["log", "c [From.GetName] d"],
        ]),
      ),
    );
    const [message] = messages(target, "invalid-macro-entry");
    expect(reported(target, "invalid-macro-entry")).toEqual(["sts_log.log"]);
    expect(message).toContain("Nothing is logged");
    expect(message).toContain('"c [From.GetName] d"');
  });

  it("is neither with a backslash before it, as the base game writes one", () => {
    const target = mod().add(effect("sts_log", { log: "x \\[Root.GetName] y and \\$5" }));
    expect(reported(target, "invalid-macro-entry")).toEqual([]);
    expect(reported(target, "unpaired-parameter")).toEqual([]);
  });

  it("is a parameter that never closes when a word holds one $", () => {
    expect(reported(mod().add(effect("sts_pay", { log: "costs $5" })), "unpaired-parameter")).toEqual(["sts_pay.log"]);
    expect(reported(mod().add(effect("sts_pay", { add_energy: "$AMOUNT$" })), "unpaired-parameter")).toEqual([]);
  });

  it("is asked of a scripted trigger and a script value, and of nothing read into script at load", () => {
    const trigger = mod().add(def("scripted_trigger", "sts_is", { custom_tooltip: "[x]" }));
    const value = mod().add(def("script_value", "sts_value", { base: 1, desc: "[x]" }));
    const inEvent = mod().add(event("sts.1", { log: "x [Root.GetName] y" }));
    expect(reported(trigger, "invalid-macro-entry")).toEqual(["sts_is.custom_tooltip"]);
    expect(reported(value, "invalid-macro-entry")).toEqual(["sts_value.desc"]);
    expect(reported(inEvent, "invalid-macro-entry")).toEqual([]);
  });

  it("leaves a block it cannot read through out of the pairing", () => {
    const target = mod().add(
      effect("sts_log", entries([{ bare: raw("[[FLAG] set_country_flag = $FLAG$ ]") }, ["log", "x [Root.GetName] y"]])),
    );
    expect(reported(target, "invalid-macro-entry")).toEqual(["sts_log.log"]);
  });
});

/**
 * The triggers and effects of a fleet action are kept by an `id`
 * (`fleet_actions.cpp:181` and `:793`), registered once for the whole game.
 */
describe("the fleet actions a definition queues", () => {
  const find = (id: string | undefined, found: Readonly<Record<string, unknown>> = { move_to: "this" }) => ({
    queue_actions: {
      find_closest_fleet: {
        trigger: { ...(id === undefined ? {} : { id }), is_ship_class: "shipclass_military" },
        found_fleet: found,
      },
    },
  });

  it("are asked an id of each trigger and effect", () => {
    const target = mod().add(
      effect("sts_gather", {
        queue_actions: {
          repeat: { max_iterations: 3, while: { always: true }, wait: 10 },
          effect: { set_fleet_flag: "sts_done" },
          find_closest_planet: { trigger: { id: "sts.planet" }, found_planet: { orbit_planet: "this" } },
        },
      }),
    );
    expect(reported(target, "missing-script-id")).toEqual([
      "sts_gather.queue_actions.effect",
      "sts_gather.queue_actions.repeat.while",
    ]);
    expect(reported(mod().add(effect("sts_gather", find("sts.find"))), "missing-script-id")).toEqual([]);
  });

  it("register an id once for each place a scripted effect is called", () => {
    const twice = mod()
      .add(effect("sts_gather", find("sts.find")))
      .add(event("sts.1", { every_owned_fleet: { sts_gather: true } }))
      .add(event("sts.2", { every_owned_fleet: { sts_gather: true } }));
    const [message] = messages(twice, "duplicate-script-id");
    expect(reported(twice, "duplicate-script-id")).toEqual(["sts_gather.queue_actions.find_closest_fleet.trigger"]);
    expect(message).toContain('A trigger with id = "sts.find" already exist. id has to be unique');
    expect(message).toContain("2 of them");

    const once = mod()
      .add(effect("sts_gather", find("sts.find")))
      .add(event("sts.1", { every_owned_fleet: { sts_gather: true } }));
    expect(reported(once, "duplicate-script-id")).toEqual([]);
  });

  it("register it once with optimize_memory, or with a parameter in the id", () => {
    const callers = (target: Mod): Mod =>
      target
        .add(event("sts.1", { every_owned_fleet: { sts_gather: true } }))
        .add(event("sts.2", { every_owned_fleet: { sts_gather: true } }));
    const kept = callers(
      mod().add(
        effect("sts_gather", entries([{ bare: "optimize_memory" }, ["queue_actions", find("sts.find").queue_actions]])),
      ),
    );
    const named = callers(mod().add(effect("sts_gather", find("sts.find.$WHO$"))));
    expect(reported(kept, "duplicate-script-id")).toEqual([]);
    expect(reported(named, "duplicate-script-id")).toEqual([]);
  });

  it("may not take an id the base game's fleet actions use, or use one twice", () => {
    const theirs: string = vanillaScriptIds.trigger.find((id) => !id.includes("$")) ?? "";
    const taken = mod().add(event("sts.1", { every_owned_fleet: find(theirs) }));
    const both = mod()
      .add(event("sts.1", { every_owned_fleet: find("sts.find") }))
      .add(event("sts.2", { every_owned_fleet: find("sts.find") }));
    expect(messages(taken, "duplicate-script-id")[0]).toContain("the base game has a trigger of this id");
    expect(reported(both, "duplicate-script-id")).toHaveLength(2);
  });

  it("log a merge_fleet target whatever it is, as the game's reader of it does", () => {
    const target = mod().add(
      effect("sts_merge", { queue_actions: { merge_fleet: { target: "event_target:sts_anchor", allow_ftl: false } } }),
    );
    expect(messages(target, "malformed-token")[0]).toContain('"Malformed token: event_target:sts_anchor"');
  });

  it("take the keys the executable's readers take", () => {
    const actions = schema.ruleSets.filter((rule) => rule.family === "fleet_action").map((rule) => rule.name);
    expect(actions).toEqual(expect.arrayContaining(["find_fleet", "find_planet", "find_system"]));
    const target = mod().add(
      effect("sts_stance", {
        queue_actions: {
          change_stance: { fleet_stance: "aggressive", days: 10 },
          find_fleet: { method: "random", trigger: { id: "sts.any" }, found_fleet: { move_to: "this" } },
        },
      }),
    );
    expect(reported(target, "unknown-field")).toEqual([]);
    expect(
      reported(
        mod().add(effect("sts_stance", { queue_actions: { change_stance: { stance: "aggressive" } } })),
        "unknown-field",
      ),
    ).toEqual(["sts_stance.queue_actions.change_stance"]);
  });
});

describe("a scripted effect or trigger read where it is called", () => {
  it("is read in the caller's scope, whatever the scope", () => {
    const target = mod()
      .add(effect("sts_home", { set_fleet_flag: "sts_at_home" }))
      .add(def("scripted_trigger", "sts_shielded", { has_shield_hp: gt(1) }))
      .add(event("sts.1", { every_owned_ship: { sts_home: true } }))
      .add(event("sts.2", { every_owned_fleet: { limit: { sts_shielded: true }, set_fleet_flag: "x" } }))
      .add(event("sts.3", { every_owned_fleet: { sts_home: true } }));
    expect(reported(target, "wrong-scope")).toEqual([
      "sts.1.immediate.every_owned_ship.sts_home>",
      "sts.2.immediate.every_owned_fleet.limit.sts_shielded>",
    ]);
  });

  it("is read two calls deep, and once for a body called twice in one scope", () => {
    const target = mod()
      .add(effect("sts_inner", { set_fleet_flag: "sts_at_home" }))
      .add(effect("sts_outer", { sts_inner: true }))
      .add(
        event("sts.1", {
          every_owned_ship: entries([
            ["sts_outer", true],
            ["sts_outer", true],
          ]),
        }),
      );
    expect(reported(target, "wrong-scope")).toEqual(["sts.1.immediate.every_owned_ship.sts_outer>.sts_inner>"]);
  });
});

describe("an event of some kind of object that nothing hands one", () => {
  it("is reported with the game's own line, and the pulse that would fire it", () => {
    const target = mod()
      .add(event("sts.1", { set_country_flag: "x" }))
      .add(def("on_action", "on_yearly_pulse", { events: ["sts.1"] }));
    const [message] = messages(target, "scopeless-event");
    expect(reported(target, "scopeless-event")).toEqual(["sts.1"]);
    expect(message).toContain('"Script Error, attempting to fire country scope event sts.1 on no_scope"');
    expect(message).toContain("on_yearly_pulse_country");
  });

  it("is not reported where the on_action hands it a country, or something else fires it", () => {
    const handed = mod()
      .add(event("sts.1", { set_country_flag: "x" }))
      .add(def("on_action", "on_yearly_pulse_country", { events: ["sts.1"] }));
    const fired = mod()
      .add(event("sts.1", { set_country_flag: "x" }))
      .add(event("sts.2", { country_event: { id: "sts.1" } }))
      .add(def("on_action", "on_yearly_pulse", { events: ["sts.1"] }));
    expect(reported(handed, "scopeless-event")).toEqual([]);
    expect(reported(fired, "scopeless-event")).toEqual([]);
  });
});

describe("a value that names the wrong thing", () => {
  it("is a target of another kind than the effect takes", () => {
    const target = mod().add(
      event("sts.1", {
        every_owned_fleet: entries([
          ["set_home_base", "capital_scope"],
          ["auto_follow_fleet", { target: "root" }],
          ["set_home_base", "event_target:sts_base"],
        ]),
      }),
    );
    expect(messages(target, "wrong-scope")).toEqual([
      "set_home_base = capital_scope names a planet, and set_home_base takes a starbase. Given another kind of object, the game has nothing to act on.",
      "target = root names a country, and target takes a fleet. Given another kind of object, the game has nothing to act on.",
    ]);
  });

  it("is a trigger that does not exist, read for its value", () => {
    const target = mod().add(
      event(
        "sts.1",
        entries([
          [
            "ordered_owned_fleet",
            { limit: { always: true }, order_by: "trigger:fleet_powr", position: 0, set_fleet_flag: "a" },
          ],
          [
            "ordered_owned_fleet",
            { limit: { always: true }, order_by: "trigger:fleet_power", position: 0, set_fleet_flag: "b" },
          ],
          ["export_trigger_value_to_variable", { trigger: "has_shield_hpp", variable: "sts_shields" }],
          ["export_trigger_value_to_variable", { trigger: "fleet_power", variable: "sts_power" }],
        ]),
      ),
    );
    expect(reported(target, "unknown-trigger")).toEqual([
      "sts.1.immediate.export_trigger_value_to_variable",
      "sts.1.immediate.ordered_owned_fleet",
    ]);
  });

  it("is an option of another policy, or a weapon type that is no component tag", () => {
    const target = mod().add(
      event(
        "sts.1",
        entries([
          ["set_policy", { policy: "economic_policy", option: "weapon_preference_kinetic", cooldown: false }],
          ["set_policy", { policy: "economic_policy", option: "economic_policy_military", cooldown: false }],
          ["set_ai_weapon_preference", "weapon_type_kinetik"],
          ["set_ai_weapon_preference", "weapon_type_kinetic"],
        ]),
      ),
    );
    expect(messages(target, "unknown-policy-option")[0]).toContain(
      "an option of weapon_preference, and none of economic_policy",
    );
    expect(reported(target, "unknown-policy-option")).toHaveLength(1);
    expect(messages(target, "unknown-value")).toEqual([
      "set_ai_weapon_preference = weapon_type_kinetik is not one of component_tags.",
    ]);
  });
});

describe("what is not a definition written with def()", () => {
  it("checks the definitions a raw file holds as it checks the others", () => {
    const target = mod();
    target.file({
      path: "common/defines/sts_defines.txt",
      contents: "NAI = {\n\tAI_INCOME_TARGET_BUFER_FACTOR = 0.25\n}\n",
    });
    target.file({
      path: "common/scripted_effects/sts_effects.txt",
      contents: 'sts_home = {\n\tevery_owned_ship = { set_home_base = root }\n\tlog = "x [Root.GetName]"\n}\n',
    });
    expect(reported(target, "unknown-field")).toEqual(["NAI"]);
    expect(reported(target, "wrong-scope")).toEqual(["sts_home.every_owned_ship"]);
    expect(reported(target, "invalid-macro-entry")).toEqual(["sts_home.log"]);
  });

  it("keeps the first value of a scripted variable, and says which file is read first", () => {
    const theirs: string = vanillaScriptedVariables[0] ?? "";
    const late = mod();
    late.file({ path: "common/scripted_variables/zz_sts.txt", contents: `${theirs} = 2\n` });
    const early = mod();
    early.file({ path: "common/scripted_variables/!_sts.txt", contents: `${theirs} = 2\n` });
    expect(theirs.startsWith("@")).toBe(true);
    expect(reported(late, "ignored-vanilla-override")).toEqual([theirs]);
    expect(messages(late, "ignored-vanilla-override")[0]).toContain("is already taken");
    expect(reported(early, "replaces-vanilla-variable")).toEqual([theirs]);
  });

  it("reports a variable of the mod's own that nothing reads", () => {
    const unread = mod();
    unread.file({ path: "common/scripted_variables/sts.txt", contents: "@sts_reserch_factor = 10\n" });
    const read = mod().add(effect("sts_pay", { add_energy: "@sts_cost" }));
    read.file({ path: "common/scripted_variables/sts.txt", contents: "@sts_cost = 10\n@sts_half = 5\n" });
    read.file({ path: "common/inline_scripts/sts.txt", contents: "energy = @[ sts_half * 2 ]\n" });
    expect(reported(unread, "unused-scripted-variable")).toEqual(["@sts_reserch_factor"]);
    expect(reported(read, "unused-scripted-variable")).toEqual([]);
  });

  it("takes a language by either of its names, and reports one the game does not read", () => {
    const target = mod().add(def("opinion_modifier", "sts_opinion", { opinion: { base: 10 } }));
    target.localise("l_japanese", "sts_opinion", "x");
    const missing = (languages: readonly string[]): number =>
      validate(target, { languages }).filter((diagnostic) => diagnostic.code === "missing-localisation").length;
    expect(missing(["l_japanese"])).toBe(0);
    expect(missing(["japanese"])).toBe(0);
    expect(missing(["english", "japanese"])).toBe(1);
    expect(validate(target, { languages: ["klingon"] }).map((diagnostic) => diagnostic.code)).toEqual([
      "unknown-language",
    ]);
  });

  it("knows every file of a directory the game reads, not only its script", () => {
    const target = mod();
    target.file({ path: "common/component_templates/weapon_components.csv", contents: "key;cost\n" });
    expect(emit(target).diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["vanilla-filename-collision"]);
  });
});
