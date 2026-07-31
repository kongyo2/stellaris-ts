import { describe, expect, it } from "vitest";

import { define } from "../src/builders/index.js";
import { defineMod, emit } from "../src/index.js";
import { renderDefinitions } from "../src/runtime/build.js";
import { bare, entries, gt, raw, repeated } from "../src/runtime/values.js";

/**
 * A key the game reads more than once under one definition.
 *
 * `option`, `desc`, `triggered_planet_modifier` and the rest are written by
 * repeating the key, not by giving it a list: vanilla's `apoc.10` carries four
 * separate `desc = { }` blocks. A list instead produces a block of nameless
 * blocks, which parses and defines nothing, and nothing downstream complains.
 */
const render = (body: object): string => renderDefinitions([["x", body]]);

describe("a key written more than once", () => {
  it("writes one entry per value of a repetition", () => {
    expect(render({ option: repeated({ name: "a" }, { name: "b" }) })).toBe(
      "x = {\n\toption = {\n\t\tname = a\n\t}\n\toption = {\n\t\tname = b\n\t}\n}\n",
    );
  });

  it("writes one entry per element of an array of blocks", () => {
    expect(render({ option: [{ name: "a" }, { name: "b" }] })).toBe(
      render({ option: repeated({ name: "a" }, { name: "b" }) }),
    );
  });

  it("keeps an array of scalars a value list, which is a different statement", () => {
    expect(render({ prerequisites: ["a", "b"] })).toBe("x = {\n\tprerequisites = {\n\t\ta\n\t\tb\n\t}\n}\n");
  });

  it("leaves an empty array as a key written once holding nothing", () => {
    expect(render({ potential: [] })).toBe("x = {\n\tpotential = {\n\t}\n}\n");
  });

  it("keeps the operator of a comparison inside a repetition", () => {
    expect(render({ num_owned_planets: repeated(gt(1), gt(2)) })).toBe(
      "x = {\n\tnum_owned_planets > 1\n\tnum_owned_planets > 2\n}\n",
    );
  });

  it("expands a repetition inside an ordered entry list", () => {
    expect(
      render(
        entries([
          ["a", 1],
          ["option", repeated({ name: "x" })],
        ]),
      ),
    ).toBe("x = {\n\ta = 1\n\toption = {\n\t\tname = x\n\t}\n}\n");
  });

  it("expands an array of blocks inside an ordered entry list", () => {
    expect(render(entries([["option", [{ name: "a" }, { name: "b" }]]]))).toBe(
      render(entries([["option", repeated({ name: "a" }, { name: "b" })]])),
    );
  });

  it("expands an ordered list held by a repeated key", () => {
    expect(render({ option: repeated(entries([["name", "a"], bare("x")])) })).toBe(
      "x = {\n\toption = {\n\t\tname = a\n\t\tx\n\t}\n}\n",
    );
  });

  it("refuses a repetition where no key is written", () => {
    expect(() => render({ option: [repeated(1, 2)] })).toThrow(/needs a key/u);
    expect(() => render(entries([bare(repeated(1, 2))]))).toThrow(/needs a key/u);
  });

  it("leaves an array of raw fragments a value list, since raw may be a scalar", () => {
    expect(render({ colours: [raw("@base"), raw("@other")] })).toBe(
      "x = {\n\tcolours = {\n\t\t@base\n\t\t@other\n\t}\n}\n",
    );
  });
});

/**
 * A tagged type moves its id inside the block, which converts the body to an
 * ordered entry list on the way. That conversion is where repetition used to be
 * lost: `option` came out as `option = { values = { ... } }` for the 43 types
 * written under a tag, and correctly for every other type.
 */
describe("a key written more than once under a tag", () => {
  it("writes an event's options as separate blocks", () => {
    const mod = defineMod({ name: "Rep", version: "1", supportedVersion: "v4.4.*" }).add(
      define(
        "event",
        "sts_demo.1",
        { is_triggered_only: true, option: repeated({ name: "sts_demo.1.a" }, { name: "sts_demo.1.b" }) },
        { as: "country_event" },
      ),
    );

    const emitted = emit(mod).files.find((file) => file.path.endsWith("events/zz_rep_event.txt"));
    const contents = emitted?.kind === "text" ? emitted.contents : "";

    expect(contents).toContain(
      "\toption = {\n\t\tname = sts_demo.1.a\n\t}\n\toption = {\n\t\tname = sts_demo.1.b\n\t}",
    );
    expect(contents).not.toContain("values");
  });
});
