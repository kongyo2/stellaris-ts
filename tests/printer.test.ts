import { describe, expect, it } from "vitest";

import { isTriviaToken, NodeKind, parse, print } from "../src/syntax/index.js";
import type { Document, EntryNode } from "../src/syntax/index.js";

function normalizedEntries(entries: readonly EntryNode[]): readonly unknown[] {
  const normalized: unknown[] = [];

  for (const entry of entries) {
    const value = normalizedEntry(entry);
    if (value !== undefined) {
      normalized.push(value);
    }
  }

  return normalized;
}

function normalizedEntry(entry: EntryNode): unknown {
  switch (entry.kind) {
    case NodeKind.Assignment:
      return {
        kind: entry.kind,
        key: normalizedEntry(entry.key),
        operator: entry.operator,
        value: normalizedEntry(entry.value),
      };
    case NodeKind.Block:
      return {
        kind: entry.kind,
        entries: normalizedEntries(entry.entries),
        closed: entry.closed,
      };
    case NodeKind.Scalar:
      return {
        kind: entry.kind,
        raw: entry.raw,
        value: entry.value,
        scalarKind: entry.scalarKind,
      };
    case NodeKind.PrefixedBlock:
      return {
        kind: entry.kind,
        prefix: normalizedEntry(entry.prefix),
        block: normalizedEntry(entry.block),
      };
    case NodeKind.InlineMath:
      return {
        kind: entry.kind,
        tokens: entry.tokens.filter((token) => !isTriviaToken(token)).map((token) => token.text),
        escaped: entry.escaped,
        closed: entry.closed,
      };
    case NodeKind.OptionalBlock:
      return {
        kind: entry.kind,
        header: entry.header.filter((token) => !isTriviaToken(token)).map((token) => token.text),
        entries: normalizedEntries(entry.entries),
        closed: entry.closed,
      };
    case NodeKind.Trivia:
      return undefined;
    case NodeKind.Error:
      return {
        kind: entry.kind,
        tokens: entry.tokens.filter((token) => !isTriviaToken(token)).map((token) => token.text),
      };
    default:
      throw new Error("Unknown AST entry kind.");
  }
}

function normalizedDocument(document: Document): unknown {
  return {
    kind: document.kind,
    entries: normalizedEntries(document.entries),
  };
}

describe("print", () => {
  it("prints assignments, blocks, prefixed blocks, anonymous blocks, and root tags canonically", () => {
    const source = "tag_one tag_two\nroot={child=yes nested={value=1} palette=rgb{142 188 241} {anonymous=yes}}\n";
    const parsed = parse(source);

    expect(parsed.diagnostics).toEqual([]);
    expect(print(parsed.document)).toBe(
      [
        "tag_one",
        "tag_two",
        "root = {",
        "\tchild = yes",
        "\tnested = {",
        "\t\tvalue = 1",
        "\t}",
        "\tpalette = rgb {",
        "\t\t142",
        "\t\t188",
        "\t\t241",
        "\t}",
        "\t{",
        "\t\tanonymous = yes",
        "\t}",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("preserves duplicate-key order", () => {
    const parsed = parse("desc=first desc=second desc={value=third}");

    expect(parsed.diagnostics).toEqual([]);
    expect(print(parsed.document)).toBe(
      ["desc = first", "desc = second", "desc = {", "\tvalue = third", "}", ""].join("\n"),
    );
  });

  it("prints optional blocks with direct and escaped inline math", () => {
    const source = String.raw`[[PARAM]direct=@[ base + 1 ] escaped=@\[(72 * $PROGRESS$)]]`;
    const parsed = parse(source);

    expect(parsed.diagnostics).toEqual([]);
    expect(print(parsed.document)).toBe(
      ["[[PARAM]", "\tdirect = @[ base + 1 ]", "\tescaped = @\\[(72 * $PROGRESS$)]", "]", ""].join("\n"),
    );
  });

  it("preserves comments while canonicalizing surrounding whitespace", () => {
    const source = "# leading\r\nroot     =       {\r\n        # child\r\n child    =       yes       # tail\r\n}\r\n";
    const parsed = parse(source);
    const output = print(parsed.document);

    expect(parsed.diagnostics).toEqual([]);
    expect(output.match(/# (?:leading|child|tail)/gu)).toEqual(["# leading", "# child", "# tail"]);
    expect(output).toContain("root = {\n");
    expect(output).toMatch(/\tchild = yes(?: # tail)?\n/u);
    expect(output).not.toContain("root     =");
    expect(output).not.toContain("child    =");
    expect(output).not.toContain("\r");

    const reparsed = parse(output);
    expect(reparsed.diagnostics).toEqual([]);
    expect(print(reparsed.document)).toBe(output);
  });

  it("removes BOM, normalizes CRLF to LF, and is deterministic for the same AST", () => {
    const parsed = parse("\uFEFFroot = {\r\n  value = yes\r\n}\r\n");

    expect(parsed.hadBom).toBe(true);
    expect(parsed.diagnostics).toEqual([]);

    const first = print(parsed.document);
    const second = print(parsed.document);

    expect(first).toBe(["root = {", "\tvalue = yes", "}", ""].join("\n"));
    expect(first.startsWith("\uFEFF")).toBe(false);
    expect(first).not.toContain("\r");
    expect(second).toBe(first);
  });

  it("round-trips semantic structure while ignoring trivia and spans", () => {
    const source = String.raw`root_tag
root = {
  # retained but structurally ignored
  desc = first
  desc = second
  palette = rgb { 1 2 3 }
  { anonymous yes }
  [[FLAG]
    direct = @[ base + 1 ]
    escaped = @\[(72 * $PROGRESS$)]
  ]
}
`;
    const initial = parse(source);

    expect(initial.diagnostics).toEqual([]);

    const output = print(initial.document);
    const reparsed = parse(output);

    expect(reparsed.diagnostics).toEqual([]);
    expect(normalizedDocument(reparsed.document)).toEqual(normalizedDocument(initial.document));
  });
});
