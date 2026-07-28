/**
 * The two things a plain object cannot say about PDX script.
 *
 * A definition body is `{ key: value }`, which covers most of the format. Two
 * constructs fall outside it, and between them they account for most of what a
 * mod author would otherwise have to drop to a raw file for:
 *
 * - a key compared rather than assigned — `num_owned_planets > 1`
 * - a key repeated with scalar values — `has_modifier = a` then `has_modifier = b`,
 *   which is not the same as `has_modifier = { a b }`
 *
 * Both are marked values rather than new syntax, so the body stays an object.
 */

// `Symbol()` types as `unique symbol` under `const`, which is what the branded
// interfaces need. `Symbol.for` would return a plain `symbol` and force a cast.
const COMPARISON_KEY: unique symbol = Symbol("stellaris-ts.comparison");
const REPEATED_KEY: unique symbol = Symbol("stellaris-ts.repeated");
const RAW_KEY: unique symbol = Symbol("stellaris-ts.raw");
const ENTRIES_KEY: unique symbol = Symbol("stellaris-ts.entries");

export type ComparisonOperator = "=" | "==" | "!=" | ">" | ">=" | "<" | "<=";

export interface ComparedValue {
  readonly [COMPARISON_KEY]: true;
  readonly operator: ComparisonOperator;
  /** Usually a number, but `switch` compares a key against a whole block. */
  readonly value: unknown;
}

export interface RepeatedValue {
  readonly [REPEATED_KEY]: true;
  readonly values: readonly unknown[];
}

/**
 * Script written out directly, for the constructs an object cannot hold.
 *
 * Inline maths, a colour written `rgb { 255 0 0 }`, an optional block — the
 * format has corners a `{ key: value }` shape will never reach, and a library
 * that cannot express them forces whole files out of the typed path for the
 * sake of one line. What goes in is parsed and re-printed, so a malformed
 * fragment fails here rather than in the game.
 */
export interface RawValue {
  readonly [RAW_KEY]: true;
  readonly text: string;
}

export function isRaw(value: unknown): value is RawValue {
  return typeof value === "object" && value !== null && RAW_KEY in value;
}

/** `raw("@[ base * 2 ]")`, `raw("rgb { 255 0 0 }")`. */
export function raw(text: string): RawValue {
  return { [RAW_KEY]: true, text };
}

/** `rgb(255, 0, 0)` → `rgb { 255 0 0 }`. */
export function rgb(red: number, green: number, blue: number, alpha?: number): RawValue {
  const parts: readonly number[] = alpha === undefined ? [red, green, blue] : [red, green, blue, alpha];
  return raw(`rgb { ${parts.map((part) => String(part)).join(" ")} }`);
}

/** `hsv(0.5, 1, 1)` → `hsv { 0.5 1 1 }`. */
export function hsv(hue: number, saturation: number, value: number, alpha?: number): RawValue {
  const parts: readonly number[] = alpha === undefined ? [hue, saturation, value] : [hue, saturation, value, alpha];
  return raw(`hsv { ${parts.map((part) => String(part)).join(" ")} }`);
}

/**
 * A block written as an ordered sequence.
 *
 * A PDX block is a list, not a map: it keeps its order, the same key may appear
 * several times, and a bare value may sit between two keyed ones. A JavaScript
 * object is none of those things, which is why a definition body that is just
 * `{ a b c }`, a block holding `{ ... }` with no key, and a block mixing bare
 * values with assignments all fail to convert. This is the one shape that
 * covers all three.
 */
export interface EntriesValue {
  readonly [ENTRIES_KEY]: true;
  readonly entries: readonly Entry[];
}

/** One entry: a keyed value, or a bare value with no key. */
export type Entry = readonly [key: string, value: unknown] | { readonly bare: unknown };

export function isEntries(value: unknown): value is EntriesValue {
  return typeof value === "object" && value !== null && ENTRIES_KEY in value;
}

export function isBare(entry: Entry): entry is { readonly bare: unknown } {
  return !Array.isArray(entry);
}

/**
 * `entries([["a", 1], bare("x"), ["a", 2]])` gives `{ a = 1 x a = 2 }`.
 *
 * Reach for it when order matters, when a key repeats around other keys, or
 * when a bare value sits inside a keyed block. A plain object is shorter and
 * says the same thing whenever none of those apply.
 */
export function entries(items: readonly Entry[]): EntriesValue {
  return { [ENTRIES_KEY]: true, entries: items };
}

/** A value with no key, for use inside {@link entries}. */
export function bare(value: unknown): { readonly bare: unknown } {
  return { bare: value };
}

export function isCompared(value: unknown): value is ComparedValue {
  return typeof value === "object" && value !== null && COMPARISON_KEY in value;
}

export function isRepeated(value: unknown): value is RepeatedValue {
  return typeof value === "object" && value !== null && REPEATED_KEY in value;
}

function compared(operator: ComparisonOperator, value: unknown): ComparedValue {
  return { [COMPARISON_KEY]: true, operator, value };
}

/** `key > value` */
export function gt(value: unknown): ComparedValue {
  return compared(">", value);
}

/** `key >= value` */
export function gte(value: unknown): ComparedValue {
  return compared(">=", value);
}

/** `key < value` */
export function lt(value: unknown): ComparedValue {
  return compared("<", value);
}

/** `key <= value` */
export function lte(value: unknown): ComparedValue {
  return compared("<=", value);
}

/** `key != value` */
export function ne(value: unknown): ComparedValue {
  return compared("!=", value);
}

/** `key == value`, which PDX distinguishes from `=` in trigger position. */
export function eq(value: unknown): ComparedValue {
  return compared("==", value);
}

/**
 * Writes the key once per value.
 *
 * `{ has_modifier: repeated("a", "b") }` gives two `has_modifier` lines.
 * `{ has_modifier: ["a", "b"] }` gives one line holding a value list, which is
 * a different thing entirely.
 */
export function repeated(...values: readonly unknown[]): RepeatedValue {
  return { [REPEATED_KEY]: true, values };
}
