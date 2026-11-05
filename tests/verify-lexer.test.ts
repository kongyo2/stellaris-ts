import { describe, expect, it } from "vitest";

import {
  caseTokenIds,
  findCharacterTables,
  findRegistrations,
  type PortableExecutable,
  type Section,
} from "../tools/verify-lexer/exe.js";

/**
 * The reading half of `verify:lexer`, on bytes laid out the way 4.5.2 lays
 * them out: twelve handlers that each load a token id, the jump table to them,
 * and the 93-entry first-character table right after it.
 */
const TEXT_RVA = 0x1000;
const TEXT: Section = { name: ".text", virtualAddress: TEXT_RVA, virtualSize: 0x800, rawOffset: 0, rawSize: 0x800 };
const CASES: Readonly<Record<string, number>> = {
  "!": 0,
  '"': 1,
  "#": 2,
  "(": 3,
  ")": 4,
  ",": 5,
  ";": 2,
  "<": 6,
  "=": 7,
  ">": 8,
  "{": 9,
  "}": 10,
};
const IDS: readonly number[] = [1062, 2, 9, 5, 6, 8, 468, 1, 467, 3, 4];

function image(extra: Readonly<Record<string, number>> = {}): PortableExecutable {
  const bytes = new Uint8Array(0x800).fill(0xcc);
  const view = new DataView(bytes.buffer);

  IDS.forEach((id, index) => {
    bytes[0x100 + index * 8] = 0xb8;
    view.setUint32(0x100 + index * 8 + 1, id, true);
  });

  // The default case loads something other than a constant.
  bytes[0x100 + 11 * 8] = 0x8b;

  for (let index = 0; index < 12; index += 1) {
    view.setUint32(0x400 + index * 4, TEXT_RVA + 0x100 + index * 8, true);
  }

  const table = 0x430;
  for (let position = 0; position < 93; position += 1) {
    const character = String.fromCharCode(0x21 + position);
    bytes[table + position] = { ...CASES, ...extra }[character] ?? 11;
  }

  return { bytes, sections: [TEXT] };
}

describe("reading the lexer out of the executable", () => {
  it("finds the first-character table and what each mark starts", () => {
    const pe = image();
    const tables = findCharacterTables(pe.bytes, 0, pe.bytes.length);

    expect(tables).toHaveLength(1);
    expect([...(tables[0]?.cases.keys() ?? [])].sort()).toEqual('!"#(),;<=>{}'.split("").sort());

    const ids = tables[0] === undefined ? undefined : caseTokenIds(pe, tables[0]);
    expect(ids?.get("=")).toBe(1);
    expect(ids?.get(">")).toBe(467);
    expect(ids?.get(";")).toBe(9);
    expect(ids?.get("#")).toBe(9);
  });

  /** What the gate has to notice: a punctuation mark the lexer does not know. */
  it("reports a character a later build starts treating as punctuation", () => {
    const pe = image({ "+": 5 });
    const cases = findCharacterTables(pe.bytes, 0, pe.bytes.length)[0]?.cases;

    expect(cases?.has("+")).toBe(true);
    expect(cases?.size).toBe(13);
  });

  it("refuses a switch whose handlers do not load a token id", () => {
    const pe = image();
    pe.bytes[0x100 + 7 * 8] = 0x90; // the `=` handler
    const table = findCharacterTables(pe.bytes, 0, pe.bytes.length)[0];

    expect(table === undefined ? undefined : caseTokenIds(pe, table)).toBeUndefined();
  });

  it("reads a keyword's id off its registration", () => {
    const pe = image();
    const view = new DataView(pe.bytes.buffer);
    const at = 0x600;
    const word = TEXT_RVA + 0x700;
    const callee = TEXT_RVA + 0x10;

    pe.bytes.set([0x4c, 0x8d, 0x05], at);
    view.setInt32(at + 3, word - (TEXT_RVA + at + 7), true);
    pe.bytes[at + 7] = 0xba;
    view.setUint32(at + 8, 971, true);
    pe.bytes.set([0x48, 0x8d, 0x0d], at + 12);
    view.setInt32(at + 15, 0, true);
    pe.bytes[at + 19] = 0xe8;
    view.setInt32(at + 20, callee - (TEXT_RVA + at + 24), true);

    expect(findRegistrations(pe, TEXT)).toEqual([{ word, id: 971, callee }]);
  });
});
