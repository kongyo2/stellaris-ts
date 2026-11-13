import { describe, expect, it } from "vitest";

import { define } from "../src/builders/index.js";
import { bare, defineMod, entries, raw, repeated, type Mod } from "../src/index.js";
import { branchChain, isBranchBody } from "../src/schema/script-order.js";
import { validate, type ValidationDiagnostic } from "../src/validate/index.js";
import { vanillaModsCompatibilityVersion } from "../src/generated/vanilla/game-version.js";

/** What this build of the game asks a mod to declare, so no test pins one release. */
const SUPPORTED_VERSION = `v${vanillaModsCompatibilityVersion}.*`;

const mod = (): Mod => defineMod({ name: "Branches", version: "1", supportedVersion: SUPPORTED_VERSION });

const strays = (target: Mod): readonly ValidationDiagnostic[] =>
  validate(target).filter((diagnostic) => diagnostic.code === "else-without-if");

const effect = (body: Parameters<typeof define<"scripted_effect">>[2]) =>
  define("scripted_effect", "sts_branches", body);

const when = { limit: { always: true }, set_country_flag: "sts_a" };

/**
 * The reader of an effect block matches an `else` to the effect read just
 * before it in the same block, and only an `if` or an `else_if` will do
 * (`0x3a97f0` in the 4.5.2 executable; `0x345b30` for a trigger block).
 */
describe("an else", () => {
  it("follows an if, through any number of else_if", () => {
    expect(strays(mod().add(effect({ if: when, else_if: when, else: { set_country_flag: "sts_b" } })))).toEqual([]);
    expect(strays(mod().add(effect({ if: repeated(when, when), else: { set_country_flag: "sts_b" } })))).toEqual([]);
  });

  it("is reported with nothing before it, with another effect between, and after another else", () => {
    const first = effect({ else: { set_country_flag: "sts_b" }, if: when });
    const between = effect(
      entries([
        ["if", when],
        ["set_country_flag", "sts_c"],
        ["else", { set_country_flag: "sts_b" }],
      ]),
    );
    const twice = effect(
      entries([
        ["if", when],
        ["else", { set_country_flag: "sts_b" }],
        ["else", { set_country_flag: "sts_c" }],
      ]),
    );

    for (const target of [first, between, twice]) {
      const reported = strays(mod().add(target));
      expect(reported).toHaveLength(1);
      expect(reported[0]?.severity).toBe("error");
      expect(reported[0]?.message).toContain("Else/else if not following an if or else if");
    }
  });

  it("is matched in a trigger block as in an effect block", () => {
    const trigger = define("scripted_trigger", "sts_branches", {
      else: { always: true },
      if: { limit: { always: true }, always: true },
    });

    expect(strays(mod().add(trigger))).toHaveLength(1);
  });

  it("is not parted from its if by a field the block's own reader takes", () => {
    // An option's `name` is read by the option, and never joins its effects.
    const event = define(
      "event",
      "sts_branches.1",
      {
        is_triggered_only: true,
        title: "sts.t",
        desc: "sts.d",
        picture: "GFX_evt_alien_city",
        option: entries([
          ["if", when],
          ["name", "sts.ok"],
          ["else", { set_country_flag: "sts_b" }],
        ]),
      },
      { as: "country_event" },
    );

    expect(strays(mod().add(event))).toEqual([]);
  });

  it("is left alone inside the if it belongs to, as the base game still writes it", () => {
    const nested = effect({
      if: { limit: { always: true }, set_country_flag: "sts_a", else: { set_country_flag: "sts_b" } },
    });

    expect(strays(mod().add(nested))).toEqual([]);
    expect(isBranchBody("immediate.if")).toBe(true);
    expect(isBranchBody("else_if")).toBe(true);
    expect(isBranchBody("immediate.every_owned_planet")).toBe(false);
  });

  it("is not parted from its if by a script variable's declaration", () => {
    const declared = effect(
      entries([
        ["if", when],
        ["@sts_amount", 5],
        ["else", { set_country_flag: "sts_b" }],
      ]),
    );

    expect(strays(mod().add(declared))).toEqual([]);
  });

  // `entries()` writes a bare `raw()` where it stands, and it may be the `if`.
  it("is not judged after a bare raw() it may belong to", () => {
    const afterRaw = effect(
      entries([bare(raw("if = { limit = { always = yes } }")), ["else", { set_country_flag: "sts_b" }]]),
    );
    const afterWord = effect(entries([bare("optimize_memory"), ["else", { set_country_flag: "sts_b" }]]));

    expect(strays(mod().add(afterRaw))).toEqual([]);
    expect(strays(mod().add(afterWord))).toHaveLength(1);
  });

  it("is not judged after script this cannot see", () => {
    const chain = branchChain();

    expect(chain.next("inline_script")).toBe(true);
    expect(chain.next("else")).toBe(true);
    expect(chain.next("else")).toBe(false);

    chain.unknown();
    expect(chain.next("else_if")).toBe(true);
    expect(chain.next("else")).toBe(true);
  });
});
