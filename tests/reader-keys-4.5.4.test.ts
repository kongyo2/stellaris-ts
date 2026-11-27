import { describe, expect, it } from "vitest";

import { define } from "../src/builders/index.js";
import { defineMod, entries, type Mod } from "../src/index.js";
import { vanillaModsCompatibilityVersion } from "../src/generated/vanilla/game-version.js";
import { readFields, unreadFields } from "../src/schema/reader-fields.js";
import { validate } from "../src/validate/index.js";

const mod = (): Mod =>
  defineMod({ name: "Readers", version: "1", supportedVersion: `v${vanillaModsCompatibilityVersion}.*` });

const unknown = (target: Mod): readonly string[] =>
  validate(target)
    .filter((diagnostic) => diagnostic.code === "unknown-field")
    .map((diagnostic) => `${diagnostic.definition}: ${diagnostic.message}`);

/**
 * What reading the 4.5.4 executable changed.
 *
 * Its 883 readers take the keys the 4.5.2 ones took, bar eight readers of saved
 * games; what moved is which of the ported rules were held against them. A
 * rule the base game never uses was compared with the reader of its type:
 * a key that reader has no case for is an `Unexpected token` in the log, and
 * one it has a case for and no rule declared was refused here though the game
 * reads it.
 */
describe("the keys the 4.5.4 readers take", () => {
  it("refuses a job's icon beside swappable_data, and says where the game reads it", () => {
    const job = mod().add(define("job", "sts_job", { category: "worker", icon: "miner" }));
    const [message] = unknown(job);

    expect(unknown(job)).toHaveLength(1);
    expect(message).toContain("swappable_data");
  });

  it("refuses the keys of other blocks written at the root of a country type", () => {
    const type = mod().add(
      define("country_type", "sts_type", {
        ai: { enabled: false },
        blocks_pirate: true,
        min_navy_for_wars: 0.5,
        blocks_piracy: true,
      }),
    );
    const messages = unknown(type);

    expect(messages).toHaveLength(2);
    expect(messages.join("\n")).toContain("blocks_piracy");
    expect(messages.join("\n")).toContain("ai = { }");
  });

  it("refuses a district capped by a modifier, which is a zone's to say", () => {
    const district = mod().add(define("district", "sts_district", { potential: {}, is_capped_by_modifier: true }));
    const zone = mod().add(define("zones", "sts_zone", { is_capped_by_modifier: true, on_built: {} }));

    expect(unknown(district)).toHaveLength(1);
    expect(unknown(zone)).toEqual([]);
  });

  it("takes what the readers of a technology and a pop faction take", () => {
    const target = mod()
      .add(
        define("technology", "sts_tech", {
          area: "physics",
          tier: 1,
          category: ["computing"],
          hidden: true,
          is_custom_tech_1: true,
        }),
      )
      .add(
        define("pop_faction", "sts_faction", {
          can_join_faction: {},
          resources: { category: "pop_factions" },
          unique: true,
          hidden: true,
          max_support: 3,
          skip_creation_cooldown: true,
        }),
      );

    expect(unknown(target)).toEqual([]);
  });

  it("refuses a title for a male ruler, which the ruler block has no key for", () => {
    // Ordered blocks, so the country is written with the keys under test and no others.
    const country = (titles: Readonly<Record<string, string>>): Mod =>
      mod().add(
        define(
          "prescripted_country",
          "sts_country",
          entries([
            ["name", "sts_country_name"],
            ["ruler", entries([["gender", "male"], ...Object.entries(titles)])],
          ]),
        ),
      );

    expect(unknown(country({ ruler_title: "sts_title", ruler_title_female: "sts_title_f" }))).toEqual([]);
    expect(unknown(country({ ruler_title_male: "sts_title_m" }))).toHaveLength(1);
  });

  it("names no key as both read and unread", () => {
    for (const [type, read] of Object.entries(readFields)) {
      const unread: readonly string[] = unreadFields[type] ?? [];
      expect(Object.keys(read).filter((key) => unread.includes(key))).toEqual([]);
    }
  });
});

/**
 * `set_war_goal` reads `enemy` on a country and not on a war (`0x1742c70` in
 * 4.5.4): 4.5.4's own `unrest.4200` sets a goal from the `effect` of a
 * `declare_war` with a `type` and a `target` alone.
 */
describe("set_war_goal", () => {
  it("does not ask for an enemy", () => {
    const event = mod().add(
      define(
        "event",
        "sts_war.1",
        {
          is_triggered_only: true,
          hide_window: true,
          immediate: {
            declare_war: {
              target: "from",
              attacker_war_goal: "wg_conquest",
              effect: { set_war_goal: { type: "wg_conquest", target: "from" } },
            },
          },
        },
        { as: "country_event" },
      ),
    );

    expect(validate(event).filter((diagnostic) => diagnostic.code === "missing-field")).toEqual([]);
  });
});
