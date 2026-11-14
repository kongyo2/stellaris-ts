import { describe, expect, it } from "vitest";

import { definitionIds } from "../src/schema/definition-ids.js";
import { schema } from "../src/schema/index.js";
import type { DefinitionType } from "../src/schema/index.js";
import { parse } from "../src/syntax/index.js";
import { expandInlineScripts, instantiate, readsToTheEnd } from "../tools/index-game/inline-scripts.js";

const typeOf = (id: string): DefinitionType => {
  const found = schema.definitionTypes.find((type) => type.id === id);
  if (found === undefined) {
    throw new Error(`no type ${id}`);
  }
  return found;
};

const idsOf = (type: string, text: string, fileName = "fixture.txt"): readonly string[] =>
  definitionIds(typeOf(type), parse(text).document, fileName).map((claim) => claim.id);

/**
 * An `inline_script` is replaced by the file it names before the block around
 * it is read, each `$PARAM$` filled in. The base game writes whole definitions
 * that way, and the index has to read them as the game does.
 */
describe("inline scripts", () => {
  it("fills in a parameter, takes a default and leaves an unknown one as written", () => {
    const parameters = new Map([["TIER", "2"]]);

    expect(instantiate("key = GUN_$TIER$", parameters)).toBe("key = GUN_2");
    expect(instantiate("cost = $COST|100$", parameters)).toBe("cost = 100");
    expect(instantiate("name = $NAME$", parameters)).toBe("name = $NAME$");
  });

  it("keeps an optional block when its parameter is passed, and a negated one when it is not", () => {
    const text = "a = 1 [[TIER] b = $TIER$ ] [[!TIER] c = 3 ] [[OTHER] d = 4 ]";

    expect(parse(instantiate(text, new Map([["TIER", "2"]]))).errors).toEqual([]);
    expect(
      instantiate(text, new Map([["TIER", "2"]]))
        .replaceAll(/\s+/gu, " ")
        .trim(),
    ).toBe("a = 1 b = 2");
    expect(instantiate(text, new Map<string, string>()).replaceAll(/\s+/gu, " ").trim()).toBe("a = 1 c = 3");
  });

  it("puts what a script defines where the script was called, at the root and inside a definition", () => {
    const scripts: Readonly<Record<string, string>> = {
      "factions/curtain": "the_curtain_$ETHIC$ = { guiding_ethic = ethic_$ETHIC$ }",
      "components/gun": "key = GUN_$TIER$\nsize = small",
    };
    const load = (name: string): string | undefined => scripts[name];
    const factions = expandInlineScripts(
      parse("inline_script = { script = factions/curtain ETHIC = xenophobe }\nplain = { }").document,
      load,
    );
    const components = expandInlineScripts(
      parse("weapon_component_template = { inline_script = { script = components/gun TIER = 2 } }").document,
      load,
    );

    expect(definitionIds(typeOf("pop_faction"), factions, "x.txt").map((claim) => claim.id)).toEqual([
      "the_curtain_xenophobe",
      "plain",
    ]);
    expect(definitionIds(typeOf("component_template"), components, "x.txt").map((claim) => claim.id)).toEqual([
      "GUN_2",
    ]);
  });

  it("leaves a call to a script it cannot find where it stands", () => {
    const document = parse("inline_script = { script = nowhere/at_all }").document;

    expect(expandInlineScripts(document, () => undefined).entries).toHaveLength(document.entries.length);
  });

  it("reads a file to its end when only its last block is left open, as the game does", () => {
    expect(readsToTheEnd(parse("objectTypes = { pdxmesh = { name = a }"))).toBe(true);
    expect(readsToTheEnd(parse("a = { b = > }"))).toBe(false);
  });
});

/** The game reads a key without regard to case, and a block that follows a word as that word's. */
describe("the ids a file defines", () => {
  it("reads a name field written in capitals", () => {
    expect(idsOf("special_project", 'special_project = { KEY = "STS_PROJECT" }')).toEqual(["STS_PROJECT"]);
  });

  it("takes a block key in whatever case it is written", () => {
    const text = 'spriteTypes = { progressbarType = { name = "GFX_sts_bar" } spriteType = { name = "GFX_sts_icon" } }';

    expect(idsOf("progressbartype", text, "x.gfx")).toEqual(["GFX_sts_bar"]);
    expect(idsOf("sprite", text, "x.gfx")).toEqual(["GFX_sts_icon"]);
  });

  it("reads a definition written with no equals sign", () => {
    expect(idsOf("sprite", 'spriteTypes = { spriteType { name = "GFX_sts_icon" } }', "x.gfx")).toEqual([
      "GFX_sts_icon",
    ]);
  });
});
