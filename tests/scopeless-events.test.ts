import { describe, expect, it } from "vitest";

import { define } from "../src/builders/index.js";
import { defineMod, raw, type Mod } from "../src/index.js";
import { scopelessEvents } from "../src/schema/scopeless-on-actions.js";
import { validate } from "../src/validate/index.js";
import { vanillaModsCompatibilityVersion } from "../src/generated/vanilla/game-version.js";

/** What this build of the game asks a mod to declare, so no test pins one release. */
const SUPPORTED_VERSION = `v${vanillaModsCompatibilityVersion}.*`;

const mod = (): Mod => defineMod({ name: "Scopeless", version: "1", supportedVersion: SUPPORTED_VERSION });

/** Where a scope was read on nothing, as `path: message head`. */
const emptyScopes = (target: Mod): readonly string[] =>
  validate(target)
    .filter((diagnostic) => diagnostic.code === "wrong-scope")
    .map((diagnostic) => `${diagnostic.definition}.${diagnostic.path}: ${diagnostic.message.split(",")[0] ?? ""}`);

/** An event written `event = { … }`, whose root is whatever fires it. */
const yearly = (id: string, body: Record<string, unknown>) =>
  define("event", id, { is_triggered_only: true, hide_window: true, ...body }, { as: "event" });

const trust = { every_country: { limit: { is_ai: true }, add_trust: { who: "root", amount: 5 } } };

/**
 * A generic event has no scope of its own; its `root` is what fired it. The
 * game fires `on_yearly_pulse` and the other pulses, and `on_game_start`, with
 * none at all, so an event only they fire reads `root` as nothing.
 */
describe("an event the game fires with no scope", () => {
  it("says nothing about an event whose caller it cannot see", () => {
    expect(emptyScopes(mod().add(yearly("sts_scope.1", { immediate: trust })))).toEqual([]);
  });

  it("reports root read where on_yearly_pulse hands it nothing", () => {
    const target = mod()
      .add(yearly("sts_scope.1", { trigger: { has_country_flag: "sts_flag" }, immediate: trust }))
      .add(define("on_action", "on_yearly_pulse", { events: ["sts_scope.1"] }));

    expect(emptyScopes(target)).toEqual([
      "sts_scope.1.immediate.every_country.add_trust: who = root names root",
      "sts_scope.1.trigger: has_country_flag reads a country",
    ]);
  });

  // An event list written with raw() is a list the game reads like any other:
  // another on_action listing the event there fires it with a scope.
  it("reads an event list written with raw()", () => {
    const listedTwice = mod()
      .add(yearly("sts_scope.1", { immediate: trust }))
      .add(define("on_action", "on_yearly_pulse", { events: ["sts_scope.1"] }))
      .add(define("on_action", "on_yearly_pulse_country", { events: raw("{ sts_scope.1 }") }));
    const onlyRaw = mod()
      .add(yearly("sts_scope.1", { immediate: trust }))
      .add(define("on_action", "on_yearly_pulse", { events: raw("{ sts_scope.1 }") }));
    const unreadable = mod()
      .add(yearly("sts_scope.1", { immediate: trust }))
      .add(define("on_action", "on_yearly_pulse", { events: ["sts_scope.1"] }))
      .add(define("on_action", "on_yearly_pulse_country", { events: raw("{ sts_scope.1") }));

    expect(emptyScopes(listedTwice)).toEqual([]);
    expect(emptyScopes(onlyRaw)).toHaveLength(1);
    expect(emptyScopes(unreadable)).toEqual([]);
  });

  it("reads a weighted random_events list the same way", () => {
    const target = mod()
      .add(yearly("sts_scope.1", { immediate: trust }))
      .add(define("on_action", "on_monthly_pulse", { random_events: { 10: "sts_scope.1", 90: 0 } }));

    expect(emptyScopes(target)).toHaveLength(1);
  });

  it("follows a scripted effect the event calls into the scope it is called in", () => {
    const target = mod()
      .add(define("scripted_effect", "sts_trust_effect", { add_trust: { who: "root", amount: 5 } }))
      .add(yearly("sts_scope.1", { immediate: { every_country: { sts_trust_effect: true } } }))
      .add(
        define(
          "event",
          "sts_scope.2",
          { is_triggered_only: true, immediate: { sts_trust_effect: true } },
          { as: "country_event" },
        ),
      )
      .add(define("on_action", "on_yearly_pulse", { events: ["sts_scope.1"] }));

    expect(emptyScopes(target)).toEqual([
      "sts_scope.1.immediate.every_country.sts_trust_effect>.add_trust: who = root names root",
    ]);
  });

  it("says nothing when something else may fire the event with a scope", () => {
    const listedTwice = mod()
      .add(yearly("sts_scope.1", { immediate: trust }))
      .add(define("on_action", "on_yearly_pulse", { events: ["sts_scope.1"] }))
      .add(define("on_action", "on_yearly_pulse_country", { events: ["sts_scope.1"] }));

    const firedElsewhere = mod()
      .add(yearly("sts_scope.1", { immediate: trust }))
      .add(define("on_action", "on_yearly_pulse", { events: ["sts_scope.1"] }))
      .add(
        define(
          "event",
          "sts_scope.2",
          { is_triggered_only: true, immediate: { country_event: { id: "sts_scope.1" } } },
          { as: "country_event" },
        ),
      );

    const pulseFiredFromScope = mod()
      .add(yearly("sts_scope.1", { immediate: trust }))
      .add(define("on_action", "on_yearly_pulse", { events: ["sts_scope.1"] }))
      .add(
        define(
          "event",
          "sts_scope.2",
          { is_triggered_only: true, immediate: { fire_on_action: { on_action: "on_yearly_pulse" } } },
          { as: "country_event" },
        ),
      );

    expect(emptyScopes(listedTwice)).toEqual([]);
    expect(emptyScopes(firedElsewhere)).toEqual([]);
    expect(emptyScopes(pulseFiredFromScope)).toEqual([]);
  });

  it("only infers from the on_actions the game fires without a scope", () => {
    const listings = new Map<string, readonly string[]>([
      ["on_yearly_pulse", ["a"]],
      ["on_yearly_pulse_country", ["b"]],
      ["my_scripted_on_action", ["c"]],
    ]);

    expect([...scopelessEvents(listings, new Map()).keys()]).toEqual(["a"]);
  });
});

describe("what else may fire an event", () => {
  it("counts a mention inside an optional block of raw script", () => {
    const target = mod()
      .add(yearly("sts_scope.1", { immediate: trust }))
      .add(define("on_action", "on_yearly_pulse", { events: ["sts_scope.1"] }))
      .add(
        define("scripted_effect", "sts_maybe_fire", {
          if: { limit: { always: true }, inline: raw("[[FIRE] country_event = { id = sts_scope.1 } ]") },
        }),
      );

    expect(emptyScopes(target)).toEqual([]);
  });

  // The scalar call and the call with parameters are two rules for one callee,
  // and following both doubled the work at every link of a chain.
  it("follows a long chain of scripted effects once per call", () => {
    const depth = 40;
    const target = mod()
      .add(yearly("sts_scope.1", { immediate: { every_country: { sts_chain_0: true } } }))
      .add(define("on_action", "on_yearly_pulse", { events: ["sts_scope.1"] }));

    for (let link = 0; link < depth; link += 1) {
      target.add(
        define(
          "scripted_effect",
          `sts_chain_${String(link)}`,
          link === depth - 1 ? { add_trust: { who: "root", amount: 5 } } : { [`sts_chain_${String(link + 1)}`]: true },
        ),
      );
    }

    expect(emptyScopes(target)).toHaveLength(1);
  });
});
