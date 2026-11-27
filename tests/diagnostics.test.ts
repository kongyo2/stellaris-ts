import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { run } from "../src/cli/index.js";
import { diagnosticCodes, explainDiagnostic } from "../src/diagnostics.js";

const lines = (calls: readonly (readonly unknown[])[]): string => calls.map((call) => String(call[0])).join("\n");

function sources(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? entry.name === "generated"
        ? []
        : sources(join(directory, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(directory, entry.name)]
        : [],
  );
}

/**
 * A report is read by its codes, by an agent as often as by a person, and a
 * code that nothing explains is a word to guess at. The set is closed by the
 * compiler — a diagnostic's code is typed to it — and every entry says what is
 * wrong and what to change.
 */
describe("the diagnostic codes", () => {
  it("explains each one, and says what to change", () => {
    for (const [code, explanation] of Object.entries(diagnosticCodes)) {
      expect(code).toMatch(/^[a-z]+(?:-[a-z0-9]+)+$/u);
      expect(explanation.summary.length, code).toBeGreaterThan(40);
      expect(explanation.fix.length, code).toBeGreaterThan(15);
    }
  });

  it("explains no code that nothing reports", () => {
    const text: string = sources(join(process.cwd(), "src"))
      .filter((path) => !path.endsWith("diagnostics.ts"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(Object.keys(diagnosticCodes).filter((code) => !text.includes(`"${code}"`))).toEqual([]);
  });

  it("answers for a code and for nothing else", () => {
    expect(explainDiagnostic("unknown-field")?.fix).toContain("spelling");
    expect(explainDiagnostic("toString")).toBeUndefined();
    expect(explainDiagnostic("no-such-code")).toBeUndefined();
  });
});

describe("stellaris-ts explain", () => {
  it("prints what a code means and what to change", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      expect(await run(["explain", "else-without-if"])).toBe(0);
      expect(lines(log.mock.calls)).toContain("else-without-if");
      expect(lines(log.mock.calls)).toContain("Fix: ");
    } finally {
      log.mockRestore();
    }
  });

  it("lists every code when none is given", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      expect(await run(["explain"])).toBe(0);
      expect(log.mock.calls).toHaveLength(Object.keys(diagnosticCodes).length);
    } finally {
      log.mockRestore();
    }
  });

  it("exits 2 for a word that is no code", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      expect(await run(["explain", "unknown-feild"])).toBe(2);
      expect(lines(error.mock.calls)).toContain("is not a code");
    } finally {
      error.mockRestore();
    }
  });
});
