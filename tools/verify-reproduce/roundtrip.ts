import { NodeKind, print, type Block, type Document, type EntryNode, type ValueNode } from "../../src/syntax/index.js";

/** Prints one value node on its own, so it can be handed back as raw script. */
function printValue(value: ValueNode): string {
  const document: Document = {
    kind: NodeKind.Document,
    entries: [
      {
        kind: NodeKind.Assignment,
        key: { kind: NodeKind.Scalar, raw: "x", value: "x", scalarKind: "Identifier", span: value.span },
        operator: "=",
        operatorSpan: value.span,
        beforeOperatorTrivia: [],
        beforeValueTrivia: [],
        value,
        span: value.span,
      },
    ],
    span: value.span,
  };

  return print(document).replace(/^x = /u, "").trimEnd();
}
import { repeated, type ComparisonOperator } from "../../src/runtime/values.js";
import * as marked from "../../src/runtime/values.js";

/**
 * Converts a parsed definition back into what a mod author would have written.
 *
 * This is the honest test of the authoring model. Guessing which constructs are
 * expressible gets it wrong in both directions — a value list and a script
 * variable reference both look exotic and are both perfectly writable, while a
 * comparison operator looks ordinary and is not writable at all. Attempting the
 * conversion answers it exactly.
 *
 * Returns the reason it could not, rather than a partial result: a definition
 * that half converts is a definition that cannot be authored.
 */

/** Marks a block that is really a value list, so the caller can unwrap it. */
const LIST_SENTINEL = "";

export type ConversionFailure = "anonymous-block" | "error-node" | "duplicate-key-mixed-with-list";

export interface ConversionResult {
  readonly value?: Record<string, unknown>;
  readonly failure?: ConversionFailure;
}

function convertValue(value: ValueNode): { value?: unknown; failure?: ConversionFailure } {
  switch (value.kind) {
    case NodeKind.Scalar:
      // The parsed value, not the raw text: a quoted string's raw form still
      // carries its quotes, and the printer adds them back, so using raw would
      // emit `"\"x\""`. A script-variable reference and a `$PARAM$` are
      // unquoted identifiers, so their value and raw agree.
      return { value: value.value };
    case NodeKind.Block: {
      const converted: ConversionResult = convertBlock(value);
      return converted.value === undefined
        ? { failure: converted.failure ?? "error-node" }
        : { value: converted.value };
    }
    case NodeKind.InlineMath:
    case NodeKind.OptionalBlock:
    case NodeKind.PrefixedBlock:
      // These have no object shape, which is exactly what `raw` is for.
      return { value: marked.raw(printValue(value)) };
    default:
      return { failure: "error-node" };
  }
}

/**
 * A block becomes an object, a value list becomes an array, and a key that
 * repeats becomes an array of what it repeats.
 */
export function convertBlock(block: Block): ConversionResult {
  const entries: readonly EntryNode[] = block.entries.filter((entry) => entry.kind !== NodeKind.Trivia);
  const scalars: EntryNode[] = entries.filter((entry) => entry.kind === NodeKind.Scalar);
  const assignments: EntryNode[] = entries.filter((entry) => entry.kind === NodeKind.Assignment);

  // A block holding only bare values is a value list, which is an array.
  if (scalars.length > 0 && assignments.length === 0) {
    const listed: unknown[] = [];

    for (const entry of entries) {
      if (entry.kind !== NodeKind.Scalar) {
        return { failure: entry.kind === NodeKind.Block ? "anonymous-block" : "error-node" };
      }
      listed.push(entry.value);
    }

    // An array is the value of a key, so it is returned through a sentinel the
    // caller unwraps rather than as an object.
    return { value: { [LIST_SENTINEL]: listed } };
  }

  const result: Record<string, unknown> = {};
  const occurrences = new Map<string, unknown[]>();

  for (const entry of entries) {
    if (entry.kind === NodeKind.Scalar) {
      // A bare value mixed in with assignments has no key to hang on.
      return { failure: "duplicate-key-mixed-with-list" };
    }

    if (entry.kind === NodeKind.Block) {
      return { failure: "anonymous-block" };
    }

    if (entry.kind !== NodeKind.Assignment) {
      return { failure: "error-node" };
    }

    const converted = convertValue(entry.value);
    if (converted.failure !== undefined || converted.value === undefined) {
      return { failure: converted.failure ?? "error-node" };
    }

    const key: string = String(entry.key.value);
    const unwrapped: unknown = unwrapList(converted.value);

    // A comparison is a marked value carrying its operator.
    const written: unknown =
      entry.operator === "="
        ? unwrapped
        : compare(entry.operator, entry.value.kind === NodeKind.Scalar ? entry.value.value : 0);

    const bucket: unknown[] = occurrences.get(key) ?? [];
    bucket.push(written);
    occurrences.set(key, bucket);
  }

  for (const [key, bucket] of occurrences) {
    const only: unknown = bucket[0];

    if (bucket.length === 1) {
      result[key] = only;
      continue;
    }

    // A key written more than once is `repeated`, whatever the values are:
    // an array would print as one key holding a value list instead.
    result[key] = repeated(...bucket);
  }

  return { value: result };
}

/**
 * `gt` and friends take a narrower value than the parser hands back, so the
 * operators that only accept numbers or strings fall through when given a
 * boolean rather than being forced.
 */
function compare(operator: ComparisonOperator, value: boolean | number | string): unknown {
  if (operator === "==") {
    return marked.eq(value);
  }

  if (operator === "!=") {
    return marked.ne(value);
  }

  if (typeof value === "boolean") {
    return value;
  }

  switch (operator) {
    case ">":
      return marked.gt(value);
    case ">=":
      return marked.gte(value);
    case "<":
      return marked.lt(value);
    case "<=":
      return marked.lte(value);
    default:
      return value;
  }
}

/** `convertBlock` returns a value list under an empty key; unwrap it here. */
function unwrapList(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }

  const entries: readonly (readonly [string, unknown])[] = Object.entries(value);
  const only: readonly [string, unknown] | undefined = entries[0];

  return entries.length === 1 && only?.[0] === LIST_SENTINEL ? (only[1] ?? []) : value;
}
