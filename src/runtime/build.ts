import {
  isBare,
  isCompared,
  isEntries,
  isRaw,
  isRepeated,
  type ComparedValue,
  type EntriesValue,
  type Entry,
  type RawValue,
  type RepeatedValue,
} from "./values.js";
import {
  AssignmentOperator,
  NodeKind,
  parse,
  ScalarKind,
  print,
  type Assignment,
  type Block,
  type Document,
  type EntryNode,
  type Position,
  type Scalar,
  type Span,
  type ValueNode,
} from "../syntax/index.js";

/**
 * Turns plain JavaScript values into PDX script.
 *
 * The AST is built and handed to the same printer that round-trips vanilla,
 * rather than formatting strings here: one formatter means output stays
 * deterministic and stays consistent with what the parser reads back.
 */

/** Any value a definition can hold. Arrays stand for a key repeated in script. */
export type ScriptValue =
  | boolean
  | number
  | string
  | ScriptObject
  | readonly ScriptValue[]
  | ComparedValue
  | EntriesValue
  | RawValue
  | RepeatedValue;

export interface ScriptObject {
  readonly [key: string]: ScriptValue | undefined;
}

const ORIGIN: Position = { offset: 0, line: 1, column: 1 };
const SPAN: Span = { start: ORIGIN, end: ORIGIN };

/**
 * A bare identifier needs no quotes; anything else does.
 *
 * Quoting is not cosmetic here: an unquoted value containing a space or a brace
 * would change the parse, so the test is what the lexer would accept as one
 * identifier token rather than what merely looks tidy.
 */
function needsQuotes(value: string): boolean {
  return value.length === 0 || /[\s{}="<>#[\]]/u.test(value);
}

function scalar(value: string | number | boolean): Scalar {
  if (typeof value === "boolean") {
    return { kind: NodeKind.Scalar, raw: value ? "yes" : "no", value, scalarKind: ScalarKind.Boolean, span: SPAN };
  }

  if (typeof value === "number") {
    // PDX has no spelling for these. Written out they become the identifiers
    // `NaN` and `Infinity`, which the game reads as a word where a number
    // belongs — and this library's own parser reads back as one too.
    if (!Number.isFinite(value)) {
      throw new TypeError(`PDX script has no number ${String(value)}.`);
    }

    return { kind: NodeKind.Scalar, raw: String(value), value, scalarKind: ScalarKind.Number, span: SPAN };
  }

  if (needsQuotes(value)) {
    // Not `JSON.stringify`: PDX does not use a backslash as an escape, so
    // `"- This: \[This.GetName]"` is a literal backslash and doubling it
    // changes the string the game reads. Only the quote needs escaping.
    const raw: string = `"${value.replaceAll('"', '\\"')}"`;
    return { kind: NodeKind.Scalar, raw, value, scalarKind: ScalarKind.QuotedString, span: SPAN };
  }

  return { kind: NodeKind.Scalar, raw: value, value, scalarKind: ScalarKind.Identifier, span: SPAN };
}

function block(entries: readonly EntryNode[]): Block {
  return { kind: NodeKind.Block, entries, closed: true, span: SPAN };
}

function assignment(
  key: string,
  value: ValueNode,
  operator: Assignment["operator"] = AssignmentOperator.Equals,
): Assignment {
  return {
    kind: NodeKind.Assignment,
    key: scalar(key),
    operator,
    operatorSpan: SPAN,
    beforeOperatorTrivia: [],
    beforeValueTrivia: [],
    value,
    span: SPAN,
  };
}

function isScriptArray(value: ScriptValue): value is readonly ScriptValue[] {
  return Array.isArray(value);
}

/**
 * An array is a value list, whatever its elements are.
 *
 * Marked values are resolved here rather than at each call site. Handling them
 * where they were first needed missed them three times running — inside a
 * repetition, in a bare position, and on the right of a comparison — because
 * each new position is a new place to forget.
 */
function valueNode(value: ScriptValue, at: string): ValueNode {
  if (isRaw(value)) {
    return parseRawValue("x", value.text);
  }

  if (isEntries(value)) {
    return block(orderedEntries(value.entries));
  }

  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return scalar(value);
  }

  // A repetition is a key written more than once, so it says nothing where no
  // key is written: as a bare entry, as an element of a value list, or on the
  // right of a comparison. Printing its innards is what it used to do, and the
  // result parses as `{ values = { ... } }`, which the game reads as nothing.
  if (isRepeated(value)) {
    throw new TypeError(`repeated() at ${at} needs a key to write more than once; here there is none.`);
  }

  if (isScriptArray(value)) {
    return block(value.map((item, index) => valueNode(item, `${at}[${String(index)}]`)));
  }

  return block(entriesOf(value));
}

/**
 * Accepts any object rather than `ScriptObject`.
 *
 * A generated definition interface describes the same data but has no index
 * signature, so it is not assignable to a `Record`. Casting it would be a lie
 * the compiler cannot check; walking it and rejecting what PDX cannot express
 * is checkable, and catches a stray `Date` or function at the boundary instead
 * of writing something the game will not parse.
 */
function entriesOf(object: object): EntryNode[] {
  const entries: EntryNode[] = [];

  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined && value !== null) {
      pushEntry(entries, key, value);
    }
  }

  return entries;
}

/**
 * Writes one field, which is not always one entry.
 *
 * `repeated()` is the only thing that writes a key more than once, and it has
 * to be understood everywhere a field is written. A plain object body and an
 * ordered entry list used to reach the printer by different routes and only one
 * of them knew about repetition, so a tagged type — whose id moves inside the
 * block, which converts the body to an ordered list on the way — printed
 * `option = { values = { ... } }` for what an untagged type printed correctly.
 *
 * An array is never a repetition. Both shapes are in the game and they are not
 * interchangeable: an event writes `option = { }` twice, while a policy writes
 * `in_breach_of = { { key = a } { key = b } }` once — one key holding blocks
 * with no key of their own, which is what an array is. Reading an array as
 * repetition wrote the second of those as the first, in 189 places vanilla
 * writes it, and no rule the printer can see distinguishes them.
 */
function pushEntry(nodes: EntryNode[], key: string, value: unknown): void {
  // A key written once per value, which is not the same as one key holding a
  // value list. Each occurrence goes through the same path as a lone value,
  // so a comparison inside a repetition keeps its operator.
  if (isRepeated(value)) {
    for (const item of value.values) {
      if (item !== undefined && item !== null) {
        pushEntry(nodes, key, item);
      }
    }
    return;
  }

  nodes.push(entryFor(key, value));
}

/** Renders an ordered entry list, where a plain object cannot keep the order. */
function orderedEntries(items: readonly Entry[]): EntryNode[] {
  const nodes: EntryNode[] = [];

  for (const item of items) {
    if (isBare(item)) {
      nodes.push(valueNode(asScriptValue("<bare>", item.bare), "<bare>"));
      continue;
    }

    const [key, value] = item;
    if (value !== undefined && value !== null) {
      pushEntry(nodes, key, value);
    }
  }

  return nodes;
}

/** One `key op value` entry, whatever kind of value it is. */
function entryFor(key: string, value: unknown): Assignment {
  // `num_owned_planets > 1` is a comparison, not an assignment. The right side
  // is usually a number, but `switch` compares against a block and a situation
  // compares against inline maths.
  if (isCompared(value)) {
    return assignment(key, valueNode(asScriptValue(key, value.value), key), value.operator);
  }

  return assignment(key, valueNode(asScriptValue(key, value), key));
}

function asScriptValue(key: string, value: unknown): ScriptValue {
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => asScriptValue(`${key}[${String(index)}]`, item));
  }

  // A class instance, a Date or a Map has no PDX spelling. Rejecting it here
  // names the offending key; letting it through writes something the game
  // cannot parse and says nothing about where it came from.
  // A marked value is resolved where its key is known, which can be any depth
  // down. Rebuilding the object around it here would strip the marker.
  if (isCompared(value) || isRepeated(value) || isRaw(value) || isEntries(value)) {
    return value;
  }

  if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined && item !== null)
        .map(([name, item]) => [name, asScriptValue(`${key}.${name}`, item)]),
    );
  }

  throw new TypeError(`PDX script cannot express ${typeof value} at ${key}.`);
}

/**
 * Parses a raw fragment as the right-hand side of an assignment.
 *
 * Exactly one entry, or none of it is written. `raw("{ a = 1 } b = 2")` parses
 * without complaint and only the first entry was kept, so the rest vanished
 * from a mod whose author had reached for `raw()` precisely because nothing
 * else could say it.
 */
function parseRawValue(key: string, text: string): ValueNode {
  const result = parse(`${key} = ${text}`);
  const first: EntryNode | undefined = result.document.entries[0];

  if (result.diagnostics.length > 0 || result.document.entries.length !== 1 || first?.kind !== NodeKind.Assignment) {
    throw new SyntaxError(`raw() at ${key} is not one PDX value: ${JSON.stringify(text)}`);
  }

  return first.value;
}

/**
 * A file's worth of definitions.
 *
 * An entry rather than a pair, because not every definition is `key = { ... }`:
 * a job tag is written as the word alone, with no block after it, and
 * {@link bare} is what says so.
 */
export function toDocument(definitions: readonly Entry[]): Document {
  return { kind: NodeKind.Document, entries: orderedEntries(definitions), span: SPAN };
}

export function renderDefinitions(definitions: readonly Entry[]): string {
  return print(toDocument(definitions));
}
