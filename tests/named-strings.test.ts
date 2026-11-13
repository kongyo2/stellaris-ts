import { describe, expect, it } from "vitest";

import { define, type DefinitionBody } from "../src/builders/index.js";
import { defineMod, repeated, type Mod } from "../src/index.js";
import { localisationKeyIn, variantHolds } from "../src/schema/localisation-references.js";
import { validate, type ValidationDiagnostic } from "../src/validate/index.js";
import { vanillaLocalisationKeys } from "../src/generated/vanilla/localisation-keys.js";
import { vanillaModsCompatibilityVersion } from "../src/generated/vanilla/game-version.js";

/** What this build of the game asks a mod to declare, so no test pins one release. */
const SUPPORTED_VERSION = `v${vanillaModsCompatibilityVersion}.*`;

const mod = (): Mod => defineMod({ name: "Strings", version: "1", supportedVersion: SUPPORTED_VERSION });

/** The strings reported missing, as `path key`. */
const missing = (target: Mod, languages?: readonly string[]): readonly string[] =>
  validate(target, languages === undefined ? {} : { languages })
    .filter((diagnostic: ValidationDiagnostic) => diagnostic.code === "missing-localisation")
    .map((diagnostic) => {
      const key: string = /string for (\S+?)[,;]/u.exec(diagnostic.message)?.[1] ?? "?";
      return diagnostic.path.length === 0 ? key : `${diagnostic.path} ${key}`;
    });

const event = (body: Record<string, unknown>) =>
  define("event", "sts_strings.1", { is_triggered_only: true, ...body }, { as: "country_event" });

/**
 * A definition names most of its text by key, and the game shows a key nothing
 * defines as the key itself: an option the mod never wrote a string for reads
 * `sts_strings.1.a` on the button.
 */
describe("a string a definition names", () => {
  it("is looked up for an event's text, its options and its tooltips", () => {
    const target = mod().add(
      event({
        title: "sts_strings.1.name",
        desc: "sts_strings.1.desc",
        option: repeated(
          { name: "sts_strings.1.a", custom_tooltip: "sts_tooltip" },
          { name: "sts_strings.1.b", allow: { custom_tooltip: { fail_text: "sts_fail", always: true } } },
        ),
      }),
    );

    target.localise("l_english", "sts_strings.1.name", "Name");

    // A field of the definition itself is reported at the definition, with no path.
    expect(missing(target)).toEqual([
      "sts_strings.1.desc",
      "option sts_strings.1.a",
      "option sts_strings.1.b",
      "option sts_tooltip",
      "option.allow.custom_tooltip sts_fail",
    ]);
  });

  it("is satisfied by the mod's string, by a replacement, and by the base game's", () => {
    const vanilla: string | undefined = vanillaLocalisationKeys.find((key) => /^[a-z_]+$/u.test(key));
    const target = mod().add(event({ title: "sts_own", desc: "sts_replaced", option: { name: vanilla } }));

    target.localise("l_english", "sts_own", "Own");
    target.localiseReplace("l_english", "sts_replaced", "Replaced");

    expect(vanilla).toBeDefined();
    expect(missing(target)).toEqual([]);
  });

  it("is checked in every language asked for", () => {
    const target = mod().add(event({ title: "sts_title", desc: "sts_title" }));

    target.localise("l_english", "sts_title", "Title");

    expect(missing(target, ["l_english", "l_japanese"])).toEqual(["sts_title"]);
    expect(
      validate(target, { languages: ["l_english", "l_japanese"] }).every((d) => !d.message.includes("No l_english")),
    ).toBe(true);
  });

  // The 4.5.2 executable hashes a key's bytes as they are and folds no case.
  it("compares the key as written", () => {
    const target = mod().add(event({ title: "sts_case", desc: "sts_case" }));

    target.localise("l_english", "STS_CASE", "Title");

    expect(missing(target)).toEqual(["sts_case"]);
  });

  // Writing the string once mends every place that names it.
  it("is reported once for a definition, however many of its fields name it", () => {
    const target = mod().add(
      event({
        title: "sts_shared",
        desc: "sts_shared",
        option: repeated({ name: "sts_shared" }, { name: "sts_other" }, { name: "sts_other" }),
      }),
    );

    expect(missing(target)).toEqual(["sts_shared", "option sts_other"]);
    expect(missing(target, ["l_english", "l_japanese"])).toHaveLength(4);
  });

  // A scripted effect called where there is no scope is read a second time,
  // there, for the scopes it reads; what that reading finds missing is not
  // reported, and must not count as reported for the caller.
  it("is reported for a caller whose callee names it too", () => {
    const target = mod()
      .add(define("scripted_effect", "sts_strings_fx", { custom_tooltip: "sts_shared_tt" }))
      .add(
        define(
          "event",
          "sts_strings.9",
          {
            is_triggered_only: true,
            hide_window: true,
            immediate: { sts_strings_fx: true, custom_tooltip: "sts_shared_tt" },
          },
          { as: "event" },
        ),
      )
      .add(define("on_action", "on_yearly_pulse", { events: ["sts_strings.9"] }));
    const reported: readonly string[] = validate(target)
      .filter((diagnostic) => diagnostic.code === "missing-localisation")
      .map((diagnostic) => diagnostic.definition);

    expect(reported).toEqual(["sts_strings.9", "sts_strings_fx"]);
  });

  it("is not looked up when the value is text, a command or a parameter", () => {
    expect(localisationKeyIn("Some written text")).toBeUndefined();
    expect(localisationKeyIn("[Root.GetName]")).toBeUndefined();
    expect(localisationKeyIn("$NAME$")).toBeUndefined();
    expect(localisationKeyIn("@title")).toBeUndefined();
    expect(localisationKeyIn("")).toBeUndefined();
    expect(localisationKeyIn("sts_key")).toBe("sts_key");
  });

  // A hidden event's title and desc are never shown, and its rules take any
  // word there; every other event's are the keys its window shows.
  it("reads a hidden event's title as the word it is", () => {
    const target = mod().add(event({ hide_window: true, title: "sts_hidden_title", desc: "sts_hidden_desc" }));

    expect(missing(target)).toEqual([]);
  });

  /**
   * The executable checks each of these at load (`situation_type.cpp`,
   * `0x4e4490`): the name, `_monthly_change_tooltip`, `_type` unless the
   * situation writes a `title`, `_desc` unless it writes a `desc`, the name of
   * every approach and the key of every stage.
   */
  it("follows what the game checks for a situation", () => {
    const situation = (id: string, extra: Record<string, unknown>) =>
      define("situation_type", id, {
        stages: { [`${id}_stage`]: { icon: "GFX_situation_stage_1", icon_background: "GFX_bg", end: 100 } },
        monthly_progress: { add: 1 },
        approach: { name: `${id}_approach`, icon: "GFX_icon", icon_background: "GFX_bg", default: true },
        ...extra,
      });

    const target = mod()
      .add(situation("sts_bare", {}))
      .add(situation("sts_titled", { title: "sts_titled_title", desc: "sts_titled_text" }));

    for (const key of [
      "sts_bare",
      "sts_bare_monthly_change_tooltip",
      "sts_titled",
      "sts_titled_monthly_change_tooltip",
      "sts_titled_title",
      "sts_titled_text",
      "sts_bare_approach",
      "sts_titled_approach",
      "sts_bare_stage",
      "sts_titled_stage",
    ]) {
      target.localise("l_english", key, key);
    }

    expect(missing(target)).toEqual(["sts_bare_desc", "sts_bare_type"]);
  });

  it("reads the key of a situation's stage as a string's name", () => {
    const target = mod().add(
      define("situation_type", "sts_staged", {
        stages: { sts_unwritten_stage: { icon: "GFX_situation_stage_1", icon_background: "GFX_bg", end: 100 } },
        monthly_progress: { add: 1 },
      }),
    );

    expect(missing(target)).toContain("stages sts_unwritten_stage");
  });
});

/**
 * A requirement scoped to a variant asks only the definitions in it. Applied
 * to all of them, 48 requirements asked for strings the game never shows.
 */
describe("a string only some definitions need", () => {
  it("asks a job for its plural only when the job can be worked", () => {
    const job = (id: string, body: DefinitionBody<"job">) => define("job", id, body);
    const target = mod()
      .add(job("sts_job_open", { possible: { always: true } }))
      .add(job("sts_job_never", { possible: { always: false } }))
      .add(job("sts_job_unset", {}));

    const plurals: readonly string[] = missing(target).filter((entry) => entry.endsWith("_plural"));

    expect(plurals).toEqual(["job_sts_job_open_plural"]);
  });

  it("asks a trait for its own name only when it replaces nothing", () => {
    const target = mod()
      .add(define("trait", "sts_trait_own", { leader_trait: ["admiral"] }))
      .add(define("trait", "sts_trait_replacing", { leader_trait: ["admiral"], replace_traits: ["sts_trait_own"] }));

    const names: readonly string[] = missing(target).filter((entry) => entry.startsWith("sts_trait_"));

    expect(names).toEqual(["sts_trait_own", "sts_trait_own_desc"]);
  });

  it("reads a trigger written to never hold as a field the definition has not got", () => {
    const subject = (never: boolean) => ({
      rootKey: "x",
      occurrences: () => [{ kind: "block" as const, never }],
    });
    const present = { kind: "field-presence", field: "playable", present: true } as const;

    expect(variantHolds(present, subject(false))).toBe(true);
    expect(variantHolds(present, subject(true))).toBe(false);
  });
});

/** Variants the port lost a `## cardinality = 0..0` from, read the way cwt meant them. */
describe("a variant that asks for a field's absence", () => {
  it("asks a name list for its name unless it says it is never selectable", () => {
    const target = mod()
      .add(define("name_list", "STS_OPEN", {}))
      .add(define("name_list", "STS_NEVER", { selectable: { always: false } }));

    expect(missing(target).filter((entry) => entry.startsWith("name_list_"))).toEqual(["name_list_STS_OPEN"]);
  });

  it("reads a species trait's short name as a string's name", () => {
    const target = mod()
      .add(define("trait", "sts_species_trait", { short_name: "sts_unwritten_short" }))
      .add(define("trait", "sts_leader_trait", { leader_class: ["admiral"], short_name: "sts_leader_short" }));

    const named: readonly string[] = missing(target).filter((entry) => entry.endsWith("_short"));

    expect(named).toEqual(["sts_unwritten_short"]);
  });
});

describe("what a value means in the definition it is in", () => {
  // Another variant's `desc` block declares `text` a string's name; a hidden
  // event's `desc` is any value and is never shown.
  it("reads a hidden event's desc block as nothing to look up", () => {
    const target = mod().add(event({ hide_window: true, desc: { text: "sts_never_shown" } }));

    expect(missing(target)).toEqual([]);
  });

  it("looks up the same block in an event that shows it", () => {
    const target = mod().add(event({ title: "sts_shown_title", desc: { text: "sts_shown_text" } }));

    target.localise("l_english", "sts_shown_title", "Title");

    expect(missing(target)).toEqual(["desc sts_shown_text"]);
  });

  // `exactOptionalPropertyTypes` keeps this out of typed code here, and a
  // project without it, or plain JavaScript, can write it.
  it("reads a field left undefined as not written", () => {
    const body = {
      stages: { sts_unset_stage: { icon: "GFX_situation_stage_1", icon_background: "GFX_bg", end: 100 } },
      monthly_progress: { add: 1 },
    };
    Reflect.set(body, "title", undefined);
    const target = mod().add(define("situation_type", "sts_unset", body));

    expect(missing(target)).toContain("sts_unset_type");
  });

  it("keeps the base game's keys out of the identifier index", async () => {
    const ids: Record<string, unknown> = await import("../src/generated/vanilla/index.js");

    expect("vanillaLocalisationKeys" in ids).toBe(false);
    expect(vanillaLocalisationKeys.length).toBeGreaterThan(100_000);
  });
});
