import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REFERENCE_REPOSITORY_URL: string = "https://github.com/cwtools/cwtools-stellaris-config";
/** The game's own -debug dumps, which are where scope constraints come from. */
const SCOPE_DUMP_REPOSITORY_URL: string = "https://github.com/OldEnt/stellaris-triggers-modifiers-effects-list";
const REPOSITORY_ROOT: string = fileURLToPath(new URL("../", import.meta.url));
const REFS_DIRECTORY: string = resolve(REPOSITORY_ROOT, "refs");
const REFERENCE_REPOSITORY_DIRECTORY: string = resolve(REFS_DIRECTORY, "cwtools-stellaris-config");
const SCOPE_DUMP_DIRECTORY: string = resolve(REFS_DIRECTORY, "stellaris-triggers-modifiers-effects-list");

function runClone(url: string, directory: string): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const child: ChildProcess = spawn("git", ["clone", "--depth", "1", "--", url, directory], { stdio: "inherit" });

    child.once("error", rejectPromise);
    child.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`git clone failed with exit code ${String(code)} and signal ${signal ?? "none"}.`));
    });
  });
}

export async function cloneReferenceRepository(): Promise<void> {
  await mkdir(REFS_DIRECTORY, { recursive: true });
  await runClone(REFERENCE_REPOSITORY_URL, REFERENCE_REPOSITORY_DIRECTORY);
  await runClone(SCOPE_DUMP_REPOSITORY_URL, SCOPE_DUMP_DIRECTORY);
}

const entryPath: string | undefined = process.argv[1];

if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  try {
    await cloneReferenceRepository();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
