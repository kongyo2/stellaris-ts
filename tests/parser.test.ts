import { describe, expect, it } from "vitest";

import {
  AssignmentOperator,
  NodeKind,
  ScalarKind,
  type Assignment,
  type Block,
  type EntryNode,
  type InlineMath,
  type OptionalBlock,
  type Scalar,
  type Trivia,
  type ValueNode,
} from "../src/syntax/ast.js";
import { parse, TokenKind } from "../src/syntax/index.js";

function assignments(entries: readonly EntryNode[]): Assignment[] {
  return entries.filter((entry): entry is Assignment => entry.kind === NodeKind.Assignment);
}

function triviaEntries(entries: readonly EntryNode[]): Trivia[] {
  return entries.filter((entry): entry is Trivia => entry.kind === NodeKind.Trivia);
}

function assignmentValueAt(parsedAssignments: readonly Assignment[], index: number): ValueNode {
  const assignment = parsedAssignments[index];
  expect(assignment).toBeDefined();
  if (assignment === undefined) {
    throw new Error(`Expected assignment at index ${index}.`);
  }
  return assignment.value;
}

function asBlock(value: ValueNode): Block {
  expect(value.kind).toBe(NodeKind.Block);
  if (value.kind !== NodeKind.Block) {
    throw new Error(`Expected a block, received ${value.kind}.`);
  }
  return value;
}

function asScalar(value: ValueNode): Scalar {
  expect(value.kind).toBe(NodeKind.Scalar);
  if (value.kind !== NodeKind.Scalar) {
    throw new Error(`Expected a scalar, received ${value.kind}.`);
  }
  return value;
}

function asInlineMath(value: ValueNode): InlineMath {
  expect(value.kind).toBe(NodeKind.InlineMath);
  if (value.kind !== NodeKind.InlineMath) {
    throw new Error(`Expected inline math, received ${value.kind}.`);
  }
  return value;
}

function optionalBlocks(entries: readonly EntryNode[]): OptionalBlock[] {
  return entries.filter((entry): entry is OptionalBlock => entry.kind === NodeKind.OptionalBlock);
}

function optionalBlockAt(entries: readonly EntryNode[], index: number): OptionalBlock {
  const block = optionalBlocks(entries)[index];
  expect(block).toBeDefined();
  if (block === undefined) {
    throw new Error(`Expected optional block at index ${index}.`);
  }
  return block;
}

describe("parse", () => {
  it("preserves duplicate assignments in source order", () => {
    const result = parse("desc = first\ndesc = second\ndesc = { nested = third }\n");
    const parsedAssignments = assignments(result.document.entries);

    expect(result.diagnostics).toEqual([]);
    expect(parsedAssignments.map((assignment) => assignment.key.raw)).toEqual(["desc", "desc", "desc"]);
    expect(asScalar(assignmentValueAt(parsedAssignments, 0)).raw).toBe("first");
    expect(asScalar(assignmentValueAt(parsedAssignments, 1)).raw).toBe("second");
    expect(assignments(asBlock(assignmentValueAt(parsedAssignments, 2)).entries).map((entry) => entry.key.raw)).toEqual(
      ["nested"],
    );
  });

  it("accepts root tag lists, anonymous blocks, and prefixed blocks", () => {
    const result = parse("tag_one\ntag_two\n{ anonymous = yes }\nrgb { 142 188 241 }\n");
    const significantEntries = result.document.entries.filter((entry) => entry.kind !== NodeKind.Trivia);

    expect(result.diagnostics).toEqual([]);
    expect(significantEntries.map((entry) => entry.kind)).toEqual([
      NodeKind.Scalar,
      NodeKind.Scalar,
      NodeKind.Block,
      NodeKind.PrefixedBlock,
    ]);
  });

  it("parses every comparison assignment operator", () => {
    const source = "a > 1\nb < 2\nc >= 3\nd <= 4\ne != 5\nf == 6\n";
    const result = parse(source);

    expect(result.diagnostics).toEqual([]);
    expect(assignments(result.document.entries).map((assignment) => assignment.operator)).toEqual([
      AssignmentOperator.GreaterThan,
      AssignmentOperator.LessThan,
      AssignmentOperator.GreaterThanOrEqual,
      AssignmentOperator.LessThanOrEqual,
      AssignmentOperator.NotEqual,
      AssignmentOperator.EqualEqual,
    ]);
  });

  it("classifies every scalar form in an unkeyed block", () => {
    const source = 'values = { alpha yes no 2200.01.01 42 -3.5 "quoted" @variable $PARAM$ }\n';
    const result = parse(source);
    const parsedAssignments = assignments(result.document.entries);
    const block = asBlock(assignmentValueAt(parsedAssignments, 0));
    const scalars = block.entries.filter((entry): entry is Scalar => entry.kind === NodeKind.Scalar);

    expect(result.diagnostics).toEqual([]);
    expect(scalars.map((scalar) => scalar.raw)).toEqual([
      "alpha",
      "yes",
      "no",
      "2200.01.01",
      "42",
      "-3.5",
      '"quoted"',
      "@variable",
      "$PARAM$",
    ]);
    expect(scalars.map((scalar) => scalar.scalarKind)).toEqual([
      ScalarKind.Identifier,
      ScalarKind.Boolean,
      ScalarKind.Boolean,
      ScalarKind.Date,
      ScalarKind.Number,
      ScalarKind.Number,
      ScalarKind.QuotedString,
      ScalarKind.ScriptVariable,
      ScalarKind.Parameter,
    ]);
    expect(scalars.map((scalar) => scalar.value)).toEqual([
      "alpha",
      true,
      false,
      "2200.01.01",
      42,
      -3.5,
      "quoted",
      "@variable",
      "$PARAM$",
    ]);
  });

  it("parses nested optional blocks", () => {
    const source = "[[OUTER]\n  before = yes\n  [[!INNER]\n    nested = no\n  ]\n]\n";
    const result = parse(source);
    const outer = optionalBlockAt(result.document.entries, 0);

    expect(result.diagnostics).toEqual([]);
    expect(outer.closed).toBe(true);
    expect(outer.header.map((token) => token.text).join("")).toBe("OUTER");
    expect(assignments(outer.entries).map((assignment) => assignment.key.raw)).toEqual(["before"]);

    const inner = optionalBlockAt(outer.entries, 0);
    expect(inner.closed).toBe(true);
    expect(inner.header.map((token) => token.text).join("")).toBe("!INNER");
    expect(assignments(inner.entries).map((assignment) => assignment.key.raw)).toEqual(["nested"]);
  });

  it("distinguishes direct and escaped inline math", () => {
    const source = String.raw`direct = @[ base + 1 ]
escaped = @\[( 72 * $PROGRESS$ )]
`;
    const result = parse(source);
    const parsedAssignments = assignments(result.document.entries);
    const direct = asInlineMath(assignmentValueAt(parsedAssignments, 0));
    const escaped = asInlineMath(assignmentValueAt(parsedAssignments, 1));

    expect(result.diagnostics).toEqual([]);
    expect(direct.escaped).toBe(false);
    expect(direct.closed).toBe(true);
    expect(direct.tokens.map((token) => token.text).join("")).toContain("base + 1");
    expect(escaped.escaped).toBe(true);
    expect(escaped.closed).toBe(true);
    expect(escaped.tokens.map((token) => token.text).join("")).toContain("$PROGRESS$");
  });

  it("tracks BOM, CRLF, trivia, and source positions", () => {
    const source = '\uFEFF# lead\r\nkey = "value"\r\n\r\nnext = yes # tail\r\n';
    const result = parse(source);
    const parsedAssignments = assignments(result.document.entries);
    const first = parsedAssignments[0];
    const second = parsedAssignments[1];
    const documentTrivia = triviaEntries(result.document.entries).flatMap((entry) => entry.tokens);

    expect(result.hadBom).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(first?.beforeOperatorTrivia.map((token) => token.text)).toEqual([" "]);
    expect(first?.beforeValueTrivia.map((token) => token.text)).toEqual([" "]);
    expect(documentTrivia.map((token) => token.text).join("")).toBe("# lead\r\n\r\n\r\n # tail\r\n");
    expect(documentTrivia.some((token) => token.kind === TokenKind.Comment)).toBe(true);
    expect(documentTrivia.filter((token) => token.kind === TokenKind.Newline).map((token) => token.text)).toEqual([
      "\r\n",
      "\r\n",
      "\r\n",
      "\r\n",
    ]);
    expect(first?.key.span.start).toEqual({ offset: 9, line: 2, column: 1 });
    expect(first?.operatorSpan.start).toEqual({ offset: 13, line: 2, column: 5 });
    expect(first?.value.span.start).toEqual({ offset: 15, line: 2, column: 7 });
    expect(second?.key.span.start).toEqual({ offset: 26, line: 4, column: 1 });
  });

  it("returns a partial AST and diagnostics for invalid syntax without throwing", () => {
    const source = "good = yes\nbroken = {\n  nested = no\n";

    expect(() => parse(source)).not.toThrow();

    const result = parse(source);
    const parsedAssignments = assignments(result.document.entries);
    const broken = parsedAssignments.find((assignment) => assignment.key.raw === "broken");

    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(parsedAssignments.map((assignment) => assignment.key.raw)).toEqual(["good", "broken"]);
    expect(asScalar(assignmentValueAt(parsedAssignments, 0)).value).toBe(true);
    expect(broken).toBeDefined();
    if (broken === undefined) {
      throw new Error("Expected the partial AST to contain the broken assignment.");
    }
    expect(asBlock(broken.value).closed).toBe(false);
  });
});
