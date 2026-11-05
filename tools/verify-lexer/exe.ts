/**
 * Reading the lexer's own tables out of the game's executable.
 *
 * Only bytes are compared; nothing is disassembled and nothing is run. The
 * shapes searched for are the ones the 4.4.6 and 4.5.2 builds both have:
 *
 * - The lexer classifies a token's first character by `character - '!'`
 *   through a 93-entry byte table over `!`..`}`. Every ordinary character maps
 *   to one default case; the punctuation of the format maps elsewhere. The
 *   12 case handlers' addresses sit in a table of 32-bit RVAs immediately
 *   before it, and each handler opens with `mov eax, <token id>`.
 * - A bare token is ended through a second, two-valued table of the same 93
 *   entries: 0 for a character that ends the token, 1 for one that does not.
 *   4.5.2 has two copies of it.
 * - Each built-in keyword is registered by the same 24 bytes —
 *   `lea r8, [rip+word]`, `mov edx, <id>`, `lea rcx, [rip+slot]`, `call` — so
 *   a word's id is read off the instruction after the one that names it.
 */

export interface Section {
  readonly name: string;
  readonly virtualAddress: number;
  readonly virtualSize: number;
  readonly rawOffset: number;
  readonly rawSize: number;
}

export interface PortableExecutable {
  readonly bytes: Uint8Array;
  readonly sections: readonly Section[];
}

const FIRST = 0x21; // '!'
const LAST = 0x7d; // '}'
export const TABLE_WIDTH: number = LAST - FIRST + 1;

/** The section table of a 64-bit PE file, or `undefined` when it is not one. */
export function readPortableExecutable(bytes: Uint8Array): PortableExecutable | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.length < 0x40 || view.getUint16(0, true) !== 0x5a4d) {
    return undefined;
  }

  const header: number = view.getUint32(0x3c, true);

  if (header + 24 > bytes.length || view.getUint32(header, true) !== 0x4550) {
    return undefined;
  }

  const sectionCount: number = view.getUint16(header + 6, true);
  const optionalSize: number = view.getUint16(header + 20, true);

  if (view.getUint16(header + 24, true) !== 0x20b) {
    return undefined;
  }

  const sections: Section[] = [];
  let entry: number = header + 24 + optionalSize;

  for (let index = 0; index < sectionCount; index += 1, entry += 40) {
    const name: string = new TextDecoder("latin1").decode(bytes.subarray(entry, entry + 8)).replace(/\0+$/u, "");
    sections.push({
      name,
      virtualSize: view.getUint32(entry + 8, true),
      virtualAddress: view.getUint32(entry + 12, true),
      rawSize: view.getUint32(entry + 16, true),
      rawOffset: view.getUint32(entry + 20, true),
    });
  }

  return { bytes, sections };
}

export function sectionNamed(image: PortableExecutable, name: string): Section | undefined {
  return image.sections.find((section) => section.name === name);
}

/** The file offset of an RVA, or `undefined` when no section holds it. */
export function offsetOf(image: PortableExecutable, rva: number): number | undefined {
  for (const section of image.sections) {
    if (rva >= section.virtualAddress && rva < section.virtualAddress + section.rawSize) {
      return rva - section.virtualAddress + section.rawOffset;
    }
  }
  return undefined;
}

export function rvaOf(image: PortableExecutable, offset: number): number | undefined {
  for (const section of image.sections) {
    if (offset >= section.rawOffset && offset < section.rawOffset + section.rawSize) {
      return offset - section.rawOffset + section.virtualAddress;
    }
  }
  return undefined;
}

export interface CharacterTable {
  /** File offset of the first entry, the one for `!`. */
  readonly offset: number;
  /** The value every ordinary character maps to. */
  readonly defaultCase: number;
  /** Each character the table sends anywhere else, with where it sends it. */
  readonly cases: ReadonlyMap<string, number>;
}

/**
 * Every 93-byte table over `!`..`}` in which most characters share a case.
 *
 * The characters from `?` to `z` hold no punctuation of the format, so a run of
 * 60 equal bytes is where to look; the characters the table sends elsewhere are
 * read out of it rather than assumed, so a punctuation mark added or removed in
 * a later build shows up as a difference instead of a table not found.
 */
export function findCharacterTables(bytes: Uint8Array, from: number, to: number): readonly CharacterTable[] {
  const tables: CharacterTable[] = [];
  const runStart: number = 0x3f - FIRST; // '?'
  const runLength = 60; // '?'..'z'
  let index: number = from + runStart;

  while (index + runLength <= to) {
    const value: number | undefined = bytes[index];
    let length = 0;

    while (index + length < to && bytes[index + length] === value) {
      length += 1;
    }

    if (value !== undefined && length === runLength) {
      const offset: number = index - runStart;
      const cases = new Map<string, number>();

      for (let position = 0; position < TABLE_WIDTH; position += 1) {
        const entry: number | undefined = bytes[offset + position];
        if (entry !== value) {
          cases.set(String.fromCharCode(FIRST + position), entry ?? -1);
        }
      }

      // A table sends a handful of characters elsewhere; a run of padding next
      // to unrelated bytes sends most of them elsewhere.
      if (cases.size > 0 && cases.size <= 20 && [...cases.values()].every((entry) => entry >= 0 && entry < 32)) {
        tables.push({ offset, defaultCase: value, cases });
      }
    }

    index += Math.max(length, 1);
  }

  return tables;
}

/** The handlers' token ids, by character, read through the jump table before the index table. */
export function caseTokenIds(
  image: PortableExecutable,
  table: CharacterTable,
): ReadonlyMap<string, number> | undefined {
  const caseCount: number = Math.max(table.defaultCase, ...table.cases.values()) + 1;
  const jumpTable: number = table.offset - caseCount * 4;
  const view = new DataView(image.bytes.buffer, image.bytes.byteOffset, image.bytes.byteLength);
  const tableRva: number | undefined = rvaOf(image, table.offset);

  if (jumpTable < 0 || tableRva === undefined) {
    return undefined;
  }

  const ids = new Map<string, number>();

  for (const [character, entry] of table.cases) {
    const target: number = view.getUint32(jumpTable + entry * 4, true);

    // A handler of this switch lies just before its own tables.
    if (target > tableRva || tableRva - target > 0x4000) {
      return undefined;
    }

    const handler: number | undefined = offsetOf(image, target);

    if (handler === undefined || image.bytes[handler] !== 0xb8) {
      return undefined;
    }

    ids.set(character, view.getUint32(handler + 1, true));
  }

  return ids;
}

/** The offset of the NUL-terminated string `text`, when it occurs exactly once in the range. */
export function findString(bytes: Uint8Array, text: string, from: number, to: number): number | undefined {
  const needle: Uint8Array = new TextEncoder().encode(`\0${text}\0`);
  let found: number | undefined;
  let start: number = from;

  while (start < to) {
    const hit: number = indexOf(bytes, needle, start, to);

    if (hit < 0) {
      break;
    }

    if (found !== undefined) {
      return undefined;
    }

    found = hit + 1;
    start = hit + 1;
  }

  return found;
}

function indexOf(bytes: Uint8Array, needle: Uint8Array, from: number, to: number): number {
  const first: number = needle[0] ?? 0;
  const matchesAt = (index: number): boolean => needle.every((byte, offset) => bytes[index + offset] === byte);

  for (
    let index = bytes.indexOf(first, from);
    index >= 0 && index + needle.length <= to;
    index = bytes.indexOf(first, index + 1)
  ) {
    if (matchesAt(index)) {
      return index;
    }
  }

  return -1;
}

export interface Registration {
  /** RVA of the word the registration names. */
  readonly word: number;
  readonly id: number;
  /** RVA of the function it calls. */
  readonly callee: number;
}

/** Every `lea r8, [rip+word]; mov edx, id; lea rcx, [rip+slot]; call` in the section. */
export function findRegistrations(image: PortableExecutable, section: Section): readonly Registration[] {
  const { bytes } = image;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: Registration[] = [];
  const end: number = section.rawOffset + section.rawSize - 24;

  for (
    let index = bytes.indexOf(0x4c, section.rawOffset);
    index >= 0 && index < end;
    index = bytes.indexOf(0x4c, index + 1)
  ) {
    if (
      bytes[index + 1] !== 0x8d ||
      bytes[index + 2] !== 0x05 ||
      bytes[index + 7] !== 0xba ||
      bytes[index + 12] !== 0x48 ||
      bytes[index + 13] !== 0x8d ||
      bytes[index + 14] !== 0x0d ||
      bytes[index + 19] !== 0xe8
    ) {
      continue;
    }

    const at: number = index - section.rawOffset + section.virtualAddress;
    found.push({
      word: at + 7 + view.getInt32(index + 3, true),
      id: view.getUint32(index + 8, true),
      callee: at + 24 + view.getInt32(index + 20, true),
    });
  }

  return found;
}
