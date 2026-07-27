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

export type ComparisonOperator = "=" | "==" | "!=" | ">" | ">=" | "<" | "<=";

export interface ComparedValue {
  readonly [COMPARISON_KEY]: true;
  readonly operator: ComparisonOperator;
  readonly value: boolean | number | string;
}

export interface RepeatedValue {
  readonly [REPEATED_KEY]: true;
  readonly values: readonly unknown[];
}

export function isCompared(value: unknown): value is ComparedValue {
  return typeof value === "object" && value !== null && COMPARISON_KEY in value;
}

export function isRepeated(value: unknown): value is RepeatedValue {
  return typeof value === "object" && value !== null && REPEATED_KEY in value;
}

function compared(operator: ComparisonOperator, value: boolean | number | string): ComparedValue {
  return { [COMPARISON_KEY]: true, operator, value };
}

/** `key > value` */
export function gt(value: number | string): ComparedValue {
  return compared(">", value);
}

/** `key >= value` */
export function gte(value: number | string): ComparedValue {
  return compared(">=", value);
}

/** `key < value` */
export function lt(value: number | string): ComparedValue {
  return compared("<", value);
}

/** `key <= value` */
export function lte(value: number | string): ComparedValue {
  return compared("<=", value);
}

/** `key != value` */
export function ne(value: boolean | number | string): ComparedValue {
  return compared("!=", value);
}

/** `key == value`, which PDX distinguishes from `=` in trigger position. */
export function eq(value: boolean | number | string): ComparedValue {
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
