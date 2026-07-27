import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Proves the package does not depend on the reference corpus.
 *
 * `.cwt` is a one-shot porting source, not an input to the build (PLAN.md §0.1).
 * That promise is only worth anything if something checks it, so this moves
 * `refs/` out of the way, builds and typechecks without it, and puts it back.
 * It also greps the shipped surface for any path that would reintroduce the
 * dependency at runtime.
 */

const REPOSITORY_ROOT: string = fileURLToPath(new URL("../", import.meta.url));
const REFS: string = join(REPOSITORY_ROOT, "refs");
const PARKED: string = join(REPOSITORY_ROOT, ".refs-parked-by-verify");
const GUARDED_ROOTS: readonly string[] = ["src"];
const FORBIDDEN: RegExp = /(^|[^A-Za-z0-9_])refs\//u;

interface StepResult {
  readonly script: string;
  readonly status: number;
  readonly output: string;
}

function runScript(script: string): StepResult {
  const npmCliPath: string | undefined = process.env["npm_execpath"];

  if (npmCliPath === undefined) {
    throw new Error("Unable to locate npm CLI: run this through an npm script.");
  }

  const result: SpawnSyncReturns<string> = spawnSync(process.execPath, [npmCliPath, "run", script], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    windowsHide: true,
  });

  return {
    script,
    status: result.status ?? 1,
    output: `${result.stdout}${result.stderr}`,
  };
}

function collectSources(directory: string): string[] {
  const paths: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = join(directory, entry.name);

    if (entry.isDirectory()) {
      paths.push(...collectSources(entryPath));
      continue;
    }

    if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".json"))) {
      paths.push(entryPath);
    }
  }

  return paths;
}

/** Reads `files` from the manifest without asserting a shape onto `JSON.parse`. */
function manifestFiles(): readonly string[] {
  const parsed: unknown = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8"));

  if (typeof parsed !== "object" || parsed === null || !("files" in parsed)) {
    return [];
  }

  const files: unknown = parsed.files;
  return Array.isArray(files) ? files.filter((entry): entry is string => typeof entry === "string") : [];
}

/** A shipped file naming `refs/` would reintroduce the dependency at runtime. */
function referenceLeaks(): string[] {
  const leaks: string[] = [];

  for (const root of GUARDED_ROOTS) {
    const absolute: string = join(REPOSITORY_ROOT, root);
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
      continue;
    }

    for (const path of collectSources(absolute)) {
      const contents: string = readFileSync(path, "utf8");
      for (const [index, line] of contents.split("\n").entries()) {
        if (FORBIDDEN.test(line)) {
          leaks.push(`${relative(REPOSITORY_ROOT, path).replaceAll("\\", "/")}:${String(index + 1)}: ${line.trim()}`);
        }
      }
    }
  }

  for (const entry of manifestFiles()) {
    if (FORBIDDEN.test(entry) || entry === "refs") {
      leaks.push(`package.json files: ${entry}`);
    }
  }

  return leaks;
}

const leaks: readonly string[] = referenceLeaks();
for (const leak of leaks) {
  console.error(`LEAK ${leak}`);
}

const refsPresent: boolean = existsSync(REFS);
const failures: StepResult[] = [];

if (refsPresent) {
  if (existsSync(PARKED)) {
    console.error(`A previous run left ${PARKED} behind; restore it manually before retrying.`);
    process.exitCode = 1;
  } else {
    renameSync(REFS, PARKED);
  }
}

try {
  for (const script of ["build", "typecheck:ci"]) {
    const result: StepResult = runScript(script);
    if (result.status !== 0) {
      failures.push(result);
    }
  }
} finally {
  if (refsPresent && existsSync(PARKED)) {
    renameSync(PARKED, REFS);
  }
}

for (const failure of failures) {
  console.error(`FAILED npm run ${failure.script}`);
  console.error(failure.output.split("\n").slice(0, 40).join("\n"));
}

console.log(
  [
    "SUMMARY mode=norefs",
    `refsParked=${String(refsPresent)}`,
    `scripts=${String(2)}`,
    `failures=${String(failures.length)}`,
    `leaks=${String(leaks.length)}`,
  ].join(" "),
);

if (failures.length > 0 || leaks.length > 0) {
  process.exitCode = 1;
}
