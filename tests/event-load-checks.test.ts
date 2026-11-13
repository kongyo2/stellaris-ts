import { describe, expect, it } from "vitest";

import { define, type DefinitionBody } from "../src/builders/index.js";
import { defineMod, entries, repeated, type Mod } from "../src/index.js";
import { validate, type ValidationDiagnostic } from "../src/validate/index.js";
import { vanillaModsCompatibilityVersion } from "../src/generated/vanilla/game-version.js";

/** What this build of the game asks a mod to declare, so no test pins one release. */
const SUPPORTED_VERSION = `v${vanillaModsCompatibilityVersion}.*`;

const mod = (): Mod => defineMod({ name: "Events", version: "1", supportedVersion: SUPPORTED_VERSION });

/** The diagnostics one code produced, as `definition.path`. */
const reported = (target: Mod, code: string): readonly string[] =>
  validate(target)
    .filter((diagnostic: ValidationDiagnostic) => diagnostic.code === code)
    .map((diagnostic) =>
      diagnostic.path.length === 0 ? diagnostic.definition : `${diagnostic.definition}.${diagnostic.path}`,
    );

/** Every code the game's own checks of an event produce. */
const EVENT_CODES: readonly string[] = [
  "conflicting-fields",
  "hidden-event-options",
  "incomplete-event",
  "mismatched-event-trigger",
  "untriggered-event",
];

const eventCodes = (target: Mod): readonly string[] =>
  validate(target)
    .map((diagnostic) => diagnostic.code)
    .filter((code) => EVENT_CODES.includes(code));

/** A window the game can draw: a title, a desc, a picture and an option. */
const window = { title: "sts.title", desc: "sts.desc", picture: "GFX_evt_alien_city", option: { name: "sts.ok" } };

const countryEvent = (body: DefinitionBody<"event">) => define("event", "sts_events.1", body, { as: "country_event" });

/**
 * The event's own check (`0x8e85c0` in the 4.5.2 executable) logs an event
 * that has no mean time and is neither `is_triggered_only` nor `is_test_event`
 * as one that "will try to fire every day", and the manager (`0x3f55e0`) has
 * no list to fire twelve of the twenty-two event keys from by mean time.
 */
describe("an event nothing fires", () => {
  it("is reported when it has neither is_triggered_only nor a mean time", () => {
    expect(reported(mod().add(countryEvent(window)), "untriggered-event")).toEqual(["sts_events.1"]);
  });

  it("is fine triggered, timed, or marked as a test", () => {
    expect(eventCodes(mod().add(countryEvent({ is_triggered_only: true, ...window })))).toEqual([]);
    expect(eventCodes(mod().add(countryEvent({ ...window, mean_time_to_happen: { months: 5 } })))).toEqual([]);
    expect(eventCodes(mod().add(countryEvent({ is_test_event: true, ...window })))).toEqual([]);
  });

  it("is reported under a key the game fires nothing by mean time for, whatever mean time it has", () => {
    const timed = { ...window, mean_time_to_happen: { months: 5 } };

    for (const key of ["event", "leader_event", "system_event", "starbase_event", "situation_event"]) {
      const target = mod().add(define("event", "sts_events.1", timed, { as: key }));
      expect(reported(target, "untriggered-event"), key).toEqual(["sts_events.1"]);
    }

    for (const key of ["planet_event", "ship_event", "fleet_event", "pop_group_event", "pop_faction_event"]) {
      const target = mod().add(define("event", "sts_events.1", timed, { as: key }));
      expect(reported(target, "untriggered-event"), key).toEqual([]);
    }
  });

  it("says nothing of an event that inherits from another, or holds script it cannot see", () => {
    expect(eventCodes(mod().add(countryEvent({ base: "sts_events.0" })))).toEqual([]);
    expect(eventCodes(mod().add(countryEvent({ inline_script: { script: "sts/event" } })))).toEqual([]);
  });
});

/**
 * The reader takes an event's fields in order (`0x8e6c70`): a mean time is
 * skipped once `is_triggered_only` has been read as yes, a weight unless it
 * has, and `is_triggered_only` complains when either was read before it.
 */
describe("an event's mean time and its weight", () => {
  it("are each read only in the kind of event they belong to", () => {
    const triggeredWithMeanTime = countryEvent({
      is_triggered_only: true,
      ...window,
      mean_time_to_happen: { months: 5 },
    });
    const untriggeredWithWeight = countryEvent({ ...window, weight_multiplier: { factor: 1 } });

    expect(reported(mod().add(triggeredWithMeanTime), "mismatched-event-trigger")).toEqual([
      "sts_events.1.mean_time_to_happen",
    ]);
    expect(reported(mod().add(untriggeredWithWeight), "mismatched-event-trigger")).toEqual([
      "sts_events.1.weight_multiplier",
    ]);
  });

  it("have to come after is_triggered_only", () => {
    // An object writes its keys in the order they were added.
    const late = countryEvent({ ...window, mean_time_to_happen: { months: 5 }, is_triggered_only: true });
    const ordered = countryEvent(
      entries([
        ["is_triggered_only", true],
        ["weight_multiplier", { factor: 1, modifier: { factor: 2, always: true } }],
        ...Object.entries(window),
      ]),
    );

    expect(reported(mod().add(late), "mismatched-event-trigger")).toEqual(["sts_events.1.is_triggered_only"]);
    expect(eventCodes(mod().add(ordered))).toEqual([]);
  });

  it("start a triggered event's weight from 1", () => {
    const scaled = countryEvent({ is_triggered_only: true, ...window, weight_multiplier: { factor: 2 } });

    expect(reported(mod().add(scaled), "mismatched-event-trigger")).toEqual(["sts_events.1.weight_multiplier"]);
  });
});

/**
 * The manager's check of each event it has read (`0x3f3d30`): a hidden event
 * with options, and a shown one with no title, desc, picture or option.
 */
describe("an event's window", () => {
  it("needs a title, a desc, a picture and an option when it is shown", () => {
    const bare = countryEvent({ is_triggered_only: true });
    const found = validate(mod().add(bare)).filter((diagnostic) => diagnostic.code === "incomplete-event");

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("no title, no desc, no picture, no option");
    expect(found[0]?.severity).toBe("warning");
  });

  it("needs no picture when it is diplomatic, and no title either when it is an advisor's", () => {
    const { picture: _picture, ...unpictured } = window;
    const { title: _title, ...untitled } = unpictured;

    expect(eventCodes(mod().add(countryEvent({ is_triggered_only: true, diplomatic: true, ...unpictured })))).toEqual(
      [],
    );
    expect(
      eventCodes(mod().add(countryEvent({ is_triggered_only: true, is_advisor_event: true, ...untitled }))),
    ).toEqual([]);
    expect(reported(mod().add(countryEvent({ is_triggered_only: true, ...unpictured })), "incomplete-event")).toEqual([
      "sts_events.1",
    ]);
  });

  it("is not asked of a hidden event, which is asked to have no options instead", () => {
    const hidden = countryEvent({ hide_window: true, is_triggered_only: true, immediate: { add_influence: 1 } });
    const hiddenWithOption = countryEvent({ hide_window: true, is_triggered_only: true, option: { name: "sts.ok" } });

    expect(eventCodes(mod().add(hidden))).toEqual([]);
    expect(reported(mod().add(hiddenWithOption), "hidden-event-options")).toEqual(["sts_events.1.option"]);
  });

  it("takes the last value written for a flag, as the reader does", () => {
    const shownAgain = countryEvent(
      entries([
        ["hide_window", true],
        ["is_triggered_only", true],
        ["hide_window", false],
      ]),
    );

    expect(reported(mod().add(shownAgain), "incomplete-event")).toEqual(["sts_events.1"]);
  });
});

describe("an event's fields that do not go together", () => {
  it("are an option's trigger and exclusive_trigger", () => {
    const both = countryEvent({
      is_triggered_only: true,
      ...window,
      option: repeated(
        { name: "sts.a", trigger: { always: true }, exclusive_trigger: { always: true } },
        { name: "sts.b", exclusive_trigger: { always: true } },
        { name: "sts.c", trigger: {}, exclusive_trigger: { always: true } },
      ),
    });
    const found = validate(mod().add(both)).filter((diagnostic) => diagnostic.code === "conflicting-fields");

    // Only the first: an empty trigger holds nothing, and the game asks what it holds.
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("sts.a");
  });

  it("are diplomatic with a leader_story window, and a difficulty outside an astral rift event", () => {
    const story = countryEvent({
      is_triggered_only: true,
      diplomatic: true,
      event_window_type: "leader_story",
      ...window,
    });
    // The base game writes every difficulty as `@astral_rift_…`, so the type takes a name.
    const difficult = countryEvent({ is_triggered_only: true, difficulty: "3", ...window });

    expect(reported(mod().add(story), "conflicting-fields")).toEqual(["sts_events.1.event_window_type"]);
    expect(reported(mod().add(difficult), "conflicting-fields")).toEqual(["sts_events.1.difficulty"]);
  });
});

describe("an event the game shows in a window of its own", () => {
  it("needs a sound, and a leader_recruit one its two tagged options", () => {
    const recruit = countryEvent({
      is_triggered_only: true,
      event_window_type: "leader_recruit",
      ...window,
      option: repeated({ name: "sts.hire", tag: "hire_leader" }, { name: "sts.no" }),
    });
    const found = validate(mod().add(recruit)).filter((diagnostic) => diagnostic.code === "incomplete-event");

    expect(found.map((diagnostic) => diagnostic.message.includes("show_sound"))).toEqual([true, false]);
    expect(found[1]?.message).toContain("tag = dismiss_leader");
  });

  it("needs a difficulty when it is an astral rift event", () => {
    const rift = define(
      "event",
      "sts_events.1",
      { is_triggered_only: true, astral_rift: true, show_sound: "event_default", ...window },
      { as: "astral_rift_event" },
    );
    const found = validate(mod().add(rift)).filter((diagnostic) => diagnostic.code === "incomplete-event");

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("Astral Rift events must have a difficulty");
  });
});

/**
 * The loader takes twenty-two keys (`0x3f3d30`); the base game writes nineteen,
 * and `define` used to refuse the three it does not.
 */
describe("the keys an event is written under", () => {
  it("are the ones the executable reads, not only the ones the base game uses", () => {
    for (const key of ["pop_event", "cosmic_storm_event", "cosmic_storm_influence_field_event", "country_event"]) {
      expect(() => define("event", "sts_events.1", { is_triggered_only: true }, { as: key })).not.toThrow();
    }

    expect(() => define("event", "sts_events.1", { is_triggered_only: true }, { as: "galaxy_event" })).toThrow(
      /not written under galaxy_event/u,
    );
  });
});
