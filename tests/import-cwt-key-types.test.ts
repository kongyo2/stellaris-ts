import { describe, expect, it } from "vitest";

import { readCwtSource } from "../tools/import-cwt/reader.js";
import { translateCwtFiles } from "../tools/import-cwt/translate.js";
import type { ImportedFieldRule, ImportedKeyRule } from "../tools/import-cwt/translate.js";

/**
 * cwt writes a *type* where a key belongs, and porting it as a name matches
 * nothing.
 *
 * `random_list = { int = { ... } }` means any integer is a key; `filepath` and
 * `localisation` mean any path and any string key. Read as fields named `int`,
 * `filepath` and `localisation` they matched nothing at all — vanilla writes
 * none of those three words as a key anywhere — and 4,700 real keys went
 * unchecked behind them.
 */
function keysOf(source: string): readonly ImportedKeyRule[] {
  const translation = translateCwtFiles([readCwtSource("test.cwt", source)]);
  const type = translation.definitionTypes[0];

  return (type?.entries ?? [])
    .filter((entry): entry is ImportedFieldRule => entry.kind === "field")
    .map((entry) => entry.key);
}

const SOURCE = (body: string): string =>
  ["types = {", "\ttype[thing] = {", '\t\tpath = "game/common/things"', "\t}", "}", "thing = {", body, "}"].join("\n");

describe("cwt key types", () => {
  it("reads int and float as numeric keys", () => {
    const keys = keysOf(SOURCE(["\tint = scalar", "\tfloat = scalar"].join("\n")));

    expect(keys).toEqual([
      { kind: "numeric-key", integer: true },
      { kind: "numeric-key", integer: false },
    ]);
  });

  it("reads filepath and localisation as primitive keys", () => {
    const keys = keysOf(SOURCE(["\tfilepath = scalar", "\tlocalisation = scalar"].join("\n")));

    expect(keys).toEqual([
      { kind: "primitive-key", type: "file" },
      { kind: "primitive-key", type: "localisation" },
    ]);
  });

  it("leaves icon alone, because vanilla writes it as a field", () => {
    expect(keysOf(SOURCE("\ticon = scalar"))).toEqual([{ kind: "literal-key", value: "icon" }]);
  });
});

describe("alias names that are constructs", () => {
  it("carries the key semantic of an alias named with a type", () => {
    const translation = translateCwtFiles([readCwtSource("t.cwt", "alias[trigger:<scripted_trigger>] = bool")]);
    const command = translation.commands[0];

    expect(command?.name).toBe("<scripted_trigger>");
    expect(command?.key).toEqual({ kind: "type-key", type: "scripted_trigger" });
  });

  it("carries the key semantic of an alias named with an enum", () => {
    const translation = translateCwtFiles([
      readCwtSource("t.cwt", "alias[modifier_rule:enum[simple_maths_enum]] = yes"),
    ]);
    const command = translation.commands[0];

    expect(command?.key).toEqual({ kind: "enum-key", enum: "simple_maths_enum" });
  });

  it("leaves an ordinary alias name without one", () => {
    const translation = translateCwtFiles([readCwtSource("t.cwt", "alias[trigger:always] = bool")]);

    expect(translation.commands[0]?.key).toBeUndefined();
  });
});
