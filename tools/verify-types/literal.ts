import {
  isBare,
  isCompared,
  isEntries,
  isRaw,
  isRepeated,
  type ComparisonOperator,
  type Entry,
} from "../../src/runtime/values.js";

/**
 * Writes a converted vanilla definition back out as TypeScript source.
 *
 * The reproduce gate proves a definition can be *expressed*; this writes the
 * expression down so the compiler can be asked whether the generated type
 * accepts it. Nothing else in the repository asks that question, which is how a
 * type that rejected `inline_script` — a key the schema itself declares legal
 * in every block — passed every gate there was.
 */

/** The comparison helpers, by the operator they stand for. */
const COMPARISONS: Readonly<Record<ComparisonOperator, string>> = {
  "=": "eq",
  "==": "eq",
  "!=": "ne",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
};

/** Every helper this module can emit, so the caller can import exactly those. */
export const HELPERS: readonly string[] = ["bare", "entries", "eq", "gt", "gte", "lt", "lte", "ne", "raw", "repeated"];

function key(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name) ? name : JSON.stringify(name);
}

function entryLiteral(entry: Entry): string {
  return isBare(entry) ? `bare(${literal(entry.bare)})` : `[${JSON.stringify(entry[0])}, ${literal(entry[1])}]`;
}

export function literal(value: unknown): string {
  if (isRaw(value)) {
    return `raw(${JSON.stringify(value.text)})`;
  }

  if (isRepeated(value)) {
    return `repeated(${value.values.map((item) => literal(item)).join(", ")})`;
  }

  if (isCompared(value)) {
    return `${COMPARISONS[value.operator]}(${literal(value.value)})`;
  }

  if (isEntries(value)) {
    return `entries([${value.entries.map((entry) => entryLiteral(entry)).join(", ")}])`;
  }

  if (Array.isArray(value)) {
    return `[${(value as readonly unknown[]).map((item) => literal(item)).join(", ")}]`;
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value === "object" && value !== null) {
    const fields: readonly string[] = Object.entries(value).map(([name, item]) => `${key(name)}: ${literal(item)}`);
    return `{ ${fields.join(", ")} }`;
  }

  // Nothing else survives conversion, so reaching here is a converter change
  // rather than something a definition contained.
  throw new TypeError(`No TypeScript literal for ${typeof value}.`);
}
