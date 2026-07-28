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
import { bare, repeated, type ComparisonOperator, type Entry } from "../../src/runtime/values.js";
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

export type ConversionFailure = "error-node";

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
 * A block becomes an object where it can, and an ordered entry list where it
 * cannot.
 *
 * A plain object is the right shape for most of the format and reads far better,
 * so it stays the default. Order only becomes visible when a bare value sits
 * among keyed ones, or a nested block has no key — and then nothing but an
 * ordered list will do.
 */
export function convertBlock(block: Block): ConversionResult {
  const entries: readonly EntryNode[] = block.entries.filter((entry) => entry.kind !== NodeKind.Trivia);
  const hasBare: boolean = entries.some((entry) => entry.kind === NodeKind.Scalar);
  const hasKeyed: boolean = entries.some((entry) => entry.kind === NodeKind.Assignment);
  const hasAnonymous: boolean = entries.some((entry) => entry.kind === NodeKind.Block);

  // A block of nothing but bare values is a value list, which is an array.
  if (hasBare && !hasKeyed && !hasAnonymous) {
    const listed: unknown[] = [];

    for (const entry of entries) {
      if (entry.kind !== NodeKind.Scalar) {
        return { failure: "error-node" };
      }
      listed.push(entry.value);
    }

    return { value: { [LIST_SENTINEL]: listed } };
  }

  if ((hasBare && hasKeyed) || hasAnonymous) {
    return convertOrdered(entries);
  }

  const result: Record<string, unknown> = {};
  const occurrences = new Map<string, unknown[]>();

  for (const entry of entries) {
    if (entry.kind !== NodeKind.Assignment) {
      return convertOrdered(entries);
    }

    const converted = convertValue(entry.value);
    if (converted.value === undefined) {
      return { failure: converted.failure ?? "error-node" };
    }

    const key: string = String(entry.key.value);
    const unwrapped: unknown = unwrapList(converted.value);
    const written: unknown =
      entry.operator === "="
        ? unwrapped
        : compare(entry.operator, entry.value.kind === NodeKind.Scalar ? entry.value.value : unwrapped);

    const bucket: unknown[] = occurrences.get(key) ?? [];
    bucket.push(written);
    occurrences.set(key, bucket);
  }

  for (const [key, bucket] of occurrences) {
    result[key] = bucket.length === 1 ? bucket[0] : repeated(...bucket);
  }

  return { value: result };
}

/** Keeps the written order, which an object cannot. */
function convertOrdered(entries: readonly EntryNode[]): ConversionResult {
  const items: Entry[] = [];

  for (const entry of entries) {
    if (entry.kind === NodeKind.Assignment) {
      const converted = convertValue(entry.value);
      if (converted.value === undefined) {
        return { failure: converted.failure ?? "error-node" };
      }

      const unwrapped: unknown = unwrapList(converted.value);
      items.push([
        String(entry.key.value),
        entry.operator === "="
          ? unwrapped
          : compare(entry.operator, entry.value.kind === NodeKind.Scalar ? entry.value.value : unwrapped),
      ]);
      continue;
    }

    if (entry.kind === NodeKind.Scalar) {
      items.push(bare(entry.value));
      continue;
    }

    if (entry.kind === NodeKind.Trivia) {
      continue;
    }

    const converted = convertValue(entry);
    if (converted.value === undefined) {
      return { failure: converted.failure ?? "error-node" };
    }
    items.push(bare(unwrapList(converted.value)));
  }

  return { value: { [LIST_SENTINEL]: marked.entries(items) } };
}

/**
 * `gt` and friends take a narrower value than the parser hands back, so the
 * operators that only accept numbers or strings fall through when given a
 * boolean rather than being forced.
 */
function compare(operator: ComparisonOperator, value: unknown): unknown {
  if (operator === "==") {
    return marked.eq(value);
  }

  if (operator === "!=") {
    return marked.ne(value);
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
