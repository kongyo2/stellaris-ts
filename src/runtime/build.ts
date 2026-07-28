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
    return { kind: NodeKind.Scalar, raw: String(value), value, scalarKind: ScalarKind.Number, span: SPAN };
  }

  if (needsQuotes(value)) {
    const raw: string = JSON.stringify(value);
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

function isScriptObject(value: ScriptValue): value is ScriptObject {
  return typeof value === "object" && !isScriptArray(value);
}

/** An array of scalars is a value list; an array of objects is a repeated key. */
function valueNode(value: ScriptValue): ValueNode {
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return scalar(value);
  }

  if (isScriptArray(value)) {
    return block(value.map((item) => valueNode(item)));
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

  for (const [key, raw] of Object.entries(object)) {
    if (raw === undefined || raw === null) {
      continue;
    }

    // A key written once per value, which is not the same as one key holding a
    // value list. Each occurrence goes through the same path as a lone value,
    // so a comparison inside a repetition keeps its operator.
    if (isRepeated(raw)) {
      for (const item of raw.values) {
        if (item !== undefined && item !== null) {
          entries.push(entryFor(key, item));
        }
      }
      continue;
    }

    entries.push(entryFor(key, raw));

    const value: ScriptValue = asScriptValue(key, raw);

    // A repeated key is written once per element, which is how PDX expresses
    // several `desc = { }` blocks under one definition.
    if (Array.isArray(value) && (value as readonly ScriptValue[]).every(isScriptObject)) {
      for (const item of value as readonly ScriptObject[]) {
        entries.push(assignment(key, block(entriesOf(item))));
      }
      continue;
    }
  }

  return entries;
}

/** Renders an ordered entry list, where a plain object cannot keep the order. */
function orderedEntries(items: readonly Entry[]): EntryNode[] {
  const nodes: EntryNode[] = [];

  for (const item of items) {
    if (isBare(item)) {
      // A bare value can be raw script too — a colour block sitting inside a
      // definition has no key of its own.
      nodes.push(isRaw(item.bare) ? parseRawValue("x", item.bare.text) : valueNode(asScriptValue("<bare>", item.bare)));
      continue;
    }

    const [key, value] = item;
    if (value !== undefined && value !== null) {
      nodes.push(entryFor(key, value));
    }
  }

  return nodes;
}

/** One `key op value` entry, whatever kind of value it is. */
function entryFor(key: string, value: unknown): Assignment {
  if (isEntries(value)) {
    return assignment(key, block(orderedEntries(value.entries)));
  }

  // Raw script is parsed here so a malformed fragment fails at authoring time
  // rather than silently producing something the game cannot read.
  if (isRaw(value)) {
    return assignment(key, parseRawValue(key, value.text));
  }

  // `num_owned_planets > 1` is a comparison, not an assignment. The right side
  // is usually a number, but `switch` compares a key against a whole block.
  if (isCompared(value)) {
    return assignment(key, valueNode(asScriptValue(key, value.value)), value.operator);
  }

  return assignment(key, valueNode(asScriptValue(key, value)));
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

/** Parses a raw fragment as the right-hand side of an assignment. */
function parseRawValue(key: string, text: string): ValueNode {
  const result = parse(`${key} = ${text}`);
  const first: EntryNode | undefined = result.document.entries.find((entry) => entry.kind === NodeKind.Assignment);

  if (result.diagnostics.length > 0 || first?.kind !== NodeKind.Assignment) {
    throw new SyntaxError(`raw() at ${key} is not valid PDX script: ${JSON.stringify(text)}`);
  }

  return first.value;
}

export function toDocument(definitions: readonly (readonly [string, object])[]): Document {
  return {
    kind: NodeKind.Document,
    entries: definitions.map(([id, body]) =>
      assignment(id, block(isEntries(body) ? orderedEntries(body.entries) : entriesOf(body))),
    ),
    span: SPAN,
  };
}

export function renderDefinitions(definitions: readonly (readonly [string, object])[]): string {
  return print(toDocument(definitions));
}
