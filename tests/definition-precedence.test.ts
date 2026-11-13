import { describe, expect, it } from "vitest";

import { define, defineIn } from "../src/builders/index.js";
import { defineMod, type Mod } from "../src/index.js";
import { lastDefinitionWinsDirectories, precedenceOf, readOrder } from "../src/schema/definition-precedence.js";
import { schema } from "../src/schema/index.js";
import { validate, type ValidationDiagnostic } from "../src/validate/index.js";
import { vanillaFiles, vanillaIdsByType } from "../src/generated/vanilla/index.js";
import { vanillaModsCompatibilityVersion } from "../src/generated/vanilla/game-version.js";

/** What this build of the game asks a mod to declare, so no test pins one release. */
const SUPPORTED_VERSION = `v${vanillaModsCompatibilityVersion}.*`;

const mod = (): Mod => defineMod({ name: "Order", version: "1", supportedVersion: SUPPORTED_VERSION });

const found = (target: Mod, code: string): readonly ValidationDiagnostic[] =>
  validate(target).filter((diagnostic) => diagnostic.code === code);

const typeOf = (id: string) => {
  const type = schema.definitionTypes.find((candidate) => candidate.id === id);
  if (type === undefined) {
    throw new Error(`no type ${id}`);
  }
  return type;
};

/** An event of the base game's, and a hidden body that says nothing else about it. */
const vanillaEvent: string = (vanillaIdsByType["event"] ?? [])[0] ?? "";
const hidden = { hide_window: true, is_triggered_only: true };

/**
 * Which of two definitions of one id the game keeps is read out of the 4.5.2
 * executable: the generic database reads the new one over the old
 * (`0x466b70`), and the event manager drops the new one (`0x3f3d30`).
 */
describe("which definition of an id the game keeps", () => {
  it("is the last for the directories read through the generic database", () => {
    for (const id of ["building", "technology", "job", "scripted_effect", "scripted_trigger", "decision", "edict"]) {
      expect(precedenceOf(typeOf(id)), id).toBe("last");
    }
    expect(lastDefinitionWinsDirectories).toContain("common/buildings");
    expect(new Set(lastDefinitionWinsDirectories).size).toBe(lastDefinitionWinsDirectories.length);
  });

  it("is the first for events", () => {
    expect(precedenceOf(typeOf("event"))).toBe("first");
  });

  it("is neither where the game merges, and is not claimed where a loader of its own decides", () => {
    expect(precedenceOf(typeOf("on_action"))).toBe("merged");
    expect(precedenceOf(typeOf("trait"))).toBe("unknown");
    expect(precedenceOf(typeOf("static_modifier"))).toBe("unknown");
    // Their loader holds a "duplicate" message for each, and is always called
    // with the flag under which it overwrites instead (`0x91f7d0`).
    for (const id of ["component_template", "component_set", "section_template"]) {
      expect(precedenceOf(typeOf(id)), id).toBe("unknown");
    }
  });
});

describe("the order the game reads a directory's files in", () => {
  it("is the byte order of their names, upper case before lower and digits before both", () => {
    const others = ["action_events_1.txt", "utopia_events.txt", "Zeta.txt"];

    expect(readOrder("000_first.txt", others)).toBe(-1);
    expect(readOrder("zz_mod_event.txt", others)).toBe(1);
    expect(readOrder("my_events.txt", others)).toBe(0);
    // `Z` is 0x5a and sorts before every lower-case letter.
    expect(readOrder("Y.txt", ["Zeta.txt", "alpha.txt"])).toBe(-1);
    expect(readOrder("_x.txt", ["Zeta.txt", "alpha.txt"])).toBe(0);
  });

  it("leaves a file of the same name out, since the mod's replaces it", () => {
    expect(readOrder("only.txt", ["only.txt"])).toBe(-1);
  });
});

describe("a definition of an id the base game uses", () => {
  it("replaces it where the last one read wins", () => {
    const building: string = (vanillaIdsByType["building"] ?? [])[0] ?? "";
    const target = mod().add(define("building", building, { category: "research" }));
    const reported = found(target, "replaces-vanilla-definition");

    expect(reported).toHaveLength(1);
    expect(reported[0]?.message).toContain("is read after every file of the base game in common/buildings");
    expect(reported[0]?.message).toContain("keeps the last building of an id it reads");
    expect(reported[0]?.message).toContain(`Object with key: ${building} already exists`);
  });

  it("is read over by the base game's where the last one wins and its file is read first", () => {
    const building: string = (vanillaIdsByType["building"] ?? [])[0] ?? "";
    const early: string = "000_first.txt";
    const target = mod().add(defineIn("building", early, building, { category: "research" }));
    const ignored = found(target, "ignored-vanilla-override");

    expect(readOrder(early, vanillaFiles["common/buildings"] ?? [])).toBe(-1);
    expect(found(target, "replaces-vanilla-definition")).toEqual([]);
    expect(ignored).toHaveLength(1);
    expect(ignored[0]?.message).toContain("the base game's definition is read over this one");
  });

  it("does nothing in the default file where the first one read wins", () => {
    const target = mod().add(define("event", vanillaEvent, hidden, { as: "country_event" }));
    const ignored = found(target, "ignored-vanilla-override");

    expect(found(target, "replaces-vanilla-definition")).toEqual([]);
    expect(ignored).toHaveLength(1);
    expect(ignored[0]?.severity).toBe("error");
    expect(ignored[0]?.message).toContain("events/zz_order_event.txt is read after every file of the base game");
    expect(ignored[0]?.message).toContain(`an event with id [${vanillaEvent}] already exists!`);
  });

  it("names a file that is read first, which then replaces it", () => {
    const ignored = found(
      mod().add(define("event", vanillaEvent, hidden, { as: "country_event" })),
      "ignored-vanilla-override",
    );
    const suggested: string = /defineIn\("event", "([^"]+)"/u.exec(ignored[0]?.message ?? "")?.[1] ?? "";

    expect(suggested).not.toBe("");
    expect(readOrder(suggested, vanillaFiles["events"] ?? [])).toBe(-1);

    const target = mod().add(defineIn("event", suggested, vanillaEvent, hidden, { as: "country_event" }));
    const replaced = found(target, "replaces-vanilla-definition");

    expect(found(target, "ignored-vanilla-override")).toEqual([]);
    expect(replaced).toHaveLength(1);
    expect(replaced[0]?.message).toContain("is read before every file of the base game");
  });

  it("is not judged for a file whose place among the base game's cannot be told", () => {
    const target = mod().add(defineIn("event", "my_events.txt", vanillaEvent, hidden, { as: "country_event" }));
    const replaced = found(target, "replaces-vanilla-definition");

    expect(found(target, "ignored-vanilla-override")).toEqual([]);
    expect(replaced).toHaveLength(1);
    expect(replaced[0]?.message).toContain("counts only if its file is read before");
  });

  // `replace_path` hides the directory's base-game files, so no definition
  // of the base game's is left there to come first or to be replaced.
  it("is the only one where the mod replaces the directory it is read from", () => {
    const target = defineMod({
      name: "Order",
      version: "1",
      supportedVersion: SUPPORTED_VERSION,
      replacePaths: ["events/"],
    }).add(define("event", vanillaEvent, hidden, { as: "country_event" }));

    expect(found(target, "ignored-vanilla-override")).toEqual([]);
    expect(found(target, "replaces-vanilla-definition")).toEqual([]);
  });

  // A file of the base game's name replaces that file and all it defined,
  // and the index does not say which file defined which id.
  it("is not called dropped where the mod replaces a file of the base game's in that directory", () => {
    const replacedFile: string = (vanillaFiles["events"] ?? [])[0] ?? "";
    const target = mod().add(define("event", vanillaEvent, hidden, { as: "country_event" }));
    target.file({ path: `events/${replacedFile.toUpperCase()}`, contents: "", overrides: true });
    const replaced = found(target, "replaces-vanilla-definition");

    expect(found(target, "ignored-vanilla-override")).toEqual([]);
    expect(replaced).toHaveLength(1);
    expect(replaced[0]?.message).toContain(`This mod replaces ${replacedFile} in events`);
    expect(replaced[0]?.message).toContain("this definition is the only one left");
  });

  it("names a few of the files it replaces and counts the rest", () => {
    const target = mod().add(define("event", vanillaEvent, hidden, { as: "country_event" }));
    for (const name of (vanillaFiles["events"] ?? []).slice(0, 5)) {
      target.file({ path: `events/${name}`, contents: "", overrides: true });
    }

    expect(found(target, "replaces-vanilla-definition")[0]?.message).toContain("and 2 more in events");
  });

  it("is still no warning where the game merges", () => {
    const target = mod().add(define("on_action", "on_game_start", { events: [] }));

    expect(found(target, "replaces-vanilla-definition")).toEqual([]);
    expect(found(target, "ignored-vanilla-override")).toEqual([]);
  });
});

describe("an id the mod defines twice", () => {
  it("keeps the first of two events and the last of two buildings, and says which", () => {
    const events = mod()
      .add(define("event", "sts_order.1", hidden, { as: "country_event" }))
      .add(define("event", "sts_order.1", hidden, { as: "country_event" }));
    const buildings = mod()
      .add(define("building", "sts_order_lab", { category: "research" }))
      .add(define("building", "sts_order_lab", { category: "research" }));

    expect(found(events, "duplicate-definition")[0]?.message).toContain("keeps the first one it reads");
    expect(found(events, "duplicate-definition")[0]?.message).toContain(
      "an event with id [sts_order.1] already exists!",
    );
    expect(found(buildings, "duplicate-definition")[0]?.message).toContain("only the last one the game reads loads");
  });

  it("claims neither for a type whose loader was not followed", () => {
    const traits = mod()
      .add(define("trait", "sts_order_trait", {}))
      .add(define("trait", "sts_order_trait", {}));

    expect(found(traits, "duplicate-definition")[0]?.message).toContain("the game keeps one of them");
  });
});
