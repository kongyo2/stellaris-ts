import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isTriviaToken, NodeKind, parse, print } from "../src/syntax/index.js";
import type { Document, EntryNode } from "../src/syntax/index.js";

interface FixtureFile {
  readonly absolutePath: string;
  readonly portablePath: string;
}

interface ExpectedFixture {
  readonly path: string;
  readonly sha256: string;
}

const fixturesDirectory: string = fileURLToPath(new URL("./fixtures", import.meta.url));
const expectedFixtures: readonly ExpectedFixture[] = [
  {
    path: "common/component_tags/00_tags.txt",
    sha256: "55edbe040fd0a41b0ccffa26fc8e9019ec15eef97a9927e3a495a65f865b7463",
  },
  {
    path: "common/gamesetup_settings/gamesetup_settings.txt",
    sha256: "378db579f78902f845727fbee6299a0e2ba97e4478dfbdfba16c86a66ca9da2a",
  },
  {
    path: "common/name_lists/IA.txt",
    sha256: "f2acaaedf269b8b7d9733477b3f35f10b8d27c08d5c1fe9dcfae29892bb6d64d",
  },
  {
    path: "common/named_colors/01_trait_colors.txt",
    sha256: "a6521127534f5aa3676b00e0c9a978ca3a865662e4883044f068509bd46ffe06",
  },
  {
    path: "common/script_values/optional-bonus.txt",
    sha256: "5afc6ff7e4455ea67b73990bae8c117344bf8fcf9066dee8e860d5995613f659",
  },
  {
    path: "common/scripted_effects/escaped-inline-math.txt",
    sha256: "99316c3b32138bf546d81fc1da235b09eea235d9179d5ad08c331db265f9df87",
  },
  {
    path: "common/static_modifiers/direct-inline-math.txt",
    sha256: "5155ba099b4e72849c8eed6dbd16fa441f391505c8a4c1d92fa6c603752c43ab",
  },
  {
    path: "events/federations_vote_events.txt",
    sha256: "cf1ebd5f0fc1fc16ae62dba3ae95835a8ef6df05298815e4aefc6210699e8eaa",
  },
  {
    path: "map/setup_scenarios/tiny.txt",
    sha256: "68ddf0db62a38530557ebab42571c0b7f4bcb663bd51147c53acd0b1ef5b1369",
  },
  {
    path: "prescripted_countries/default.txt",
    sha256: "c4b8a100e63631294c3553ea4b0f2e3335f9e6ca18b9e91b55108c2abe5f30fb",
  },
];

function compareCodeUnits(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function collectFixtureFiles(root: string): readonly FixtureFile[] {
  if (!existsSync(root)) {
    return [];
  }

  const files: FixtureFile[] = [];

  function visit(directory: string): void {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      compareCodeUnits(left.name, right.name),
    );

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".txt")) {
        files.push({
          absolutePath,
          portablePath: relative(root, absolutePath).split(sep).join("/"),
        });
      }
    }
  }

  visit(root);
  return files.sort((left, right) => compareCodeUnits(left.portablePath, right.portablePath));
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

function hasCrLf(bytes: Uint8Array): boolean {
  for (let index = 0; index + 1 < bytes.length; index += 1) {
    if (bytes[index] === 0x0d && bytes[index + 1] === 0x0a) {
      return true;
    }
  }
  return false;
}

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

const fixtureFiles: readonly FixtureFile[] = collectFixtureFiles(fixturesDirectory);

describe("fixture round-trip", () => {
  it("discovers the byte-locked fixture manifest", () => {
    expect(fixtureFiles.map((fixture) => fixture.portablePath)).toEqual(
      expectedFixtures.map((fixture) => fixture.path),
    );

    for (const [index, fixture] of fixtureFiles.entries()) {
      const expected: ExpectedFixture | undefined = expectedFixtures[index];
      expect(expected).toBeDefined();
      if (expected === undefined) {
        throw new Error(`Missing fixture manifest entry for ${fixture.portablePath}.`);
      }

      const digest: string = createHash("sha256").update(readFileSync(fixture.absolutePath)).digest("hex");
      expect(digest, `Fixture bytes changed for ${fixture.portablePath}.`).toBe(expected.sha256);
    }
  });

  it("includes at least one UTF-8 BOM fixture", () => {
    const hasBomFixture = fixtureFiles.some((fixture) => hasUtf8Bom(readFileSync(fixture.absolutePath)));

    expect(hasBomFixture, "Expected at least one fixture whose bytes begin with a UTF-8 BOM.").toBe(true);
  });

  it("includes at least one CRLF fixture", () => {
    const hasCrLfFixture = fixtureFiles.some((fixture) => hasCrLf(readFileSync(fixture.absolutePath)));

    expect(hasCrLfFixture, "Expected at least one fixture containing CRLF line endings.").toBe(true);
  });

  for (const fixture of fixtureFiles) {
    it(fixture.portablePath, () => {
      const bytes = readFileSync(fixture.absolutePath);
      const source = decodeUtf8(bytes);
      const sourceHasBom = hasUtf8Bom(bytes);

      expect(source.startsWith("\uFEFF")).toBe(sourceHasBom);

      const initial = parse(source);
      expect(initial.hadBom).toBe(sourceHasBom);
      expect(initial.diagnostics, `Initial parse diagnostics for ${fixture.portablePath}`).toEqual([]);

      const output = print(initial.document);
      expect(output).not.toContain("\uFEFF");
      expect(output).not.toMatch(/[\r\u2028\u2029]/u);

      const reparsed = parse(output);
      expect(reparsed.diagnostics, `Reparse diagnostics for ${fixture.portablePath}`).toEqual([]);
      expect(normalizedDocument(reparsed.document)).toEqual(normalizedDocument(initial.document));
    });
  }
});
