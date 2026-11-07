import { describe, expect, it } from "vitest";

import { renderDefinitions } from "../src/runtime/build.js";
import { isEntries } from "../src/runtime/values.js";
import { NodeKind, parse, type Block } from "../src/syntax/index.js";
import { convertBlock } from "../tools/verify-reproduce/roundtrip.js";

const blockOf = (source: string): Block => {
  const entry = parse(source).document.entries[0];
  if (entry?.kind !== NodeKind.Assignment || entry.value.kind !== NodeKind.Block) {
    throw new Error("expected one block");
  }
  return entry.value;
};

/** The body a converted block prints, re-read, as its keys in order. */
const printedKeys = (source: string, order: "grouped" | "written"): readonly string[] => {
  const converted = convertBlock(blockOf(source), { order });
  const value: unknown = converted.value?.[""] ?? converted.value;
  const printed: string = renderDefinitions([["x", value]]);
  return blockOf(printed).entries.flatMap((entry) =>
    entry.kind === NodeKind.Assignment ? [String(entry.key.value)] : [],
  );
};

/**
 * The reproduce gate reads vanilla back the way an author would write it, and
 * a block is a sequence. A scripted effect's `set_variable`, `if`,
 * `set_variable` regrouped into an object prints the two `set_variable` first,
 * which is a different effect — and the gate used to count it reproduced.
 */
describe("converting a block in written order", () => {
  const steps = "x = { set_variable = { which = a } if = { limit = { always = yes } } set_variable = { which = b } }";

  it("keeps a key repeated around another one where it was written", () => {
    expect(printedKeys(steps, "written")).toEqual(["set_variable", "if", "set_variable"]);
    expect(printedKeys(steps, "grouped")).toEqual(["set_variable", "set_variable", "if"]);
  });

  // An object lists canonical array indices first and in ascending order.
  it("keeps numeric keys in the order they were written", () => {
    const weights = "x = { 50 = { a = 1 } 25 = { b = 1 } }";

    expect(printedKeys(weights, "written")).toEqual(["50", "25"]);
    expect(printedKeys(weights, "grouped")).toEqual(["25", "50"]);
  });

  it("stays an object where an object prints the same order", () => {
    const converted = convertBlock(blockOf("x = { a = 1 a = 2 b = 3 }"), { order: "written" });

    expect(isEntries(converted.value?.[""])).toBe(false);
    expect(Object.keys(converted.value ?? {})).toEqual(["a", "b"]);
  });
});
