import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { BYTE_ORDER_MARK } from "./localisation.js";
import type { EmitPlan } from "./emit.js";
import { renderModFile } from "./emit.js";
import type { Mod } from "./mod.js";

/** Writes an emit plan to disk. Refuses when the plan has errors. */
export interface WriteResult {
  readonly modDirectory: string;
  readonly modFilePath: string;
  readonly written: readonly string[];
  /** Files the previous build wrote and this one no longer does, now deleted. */
  readonly removed: readonly string[];
}

/**
 * The files the last build wrote, kept beside them.
 *
 * The game reads every file in the directories it loads from, and a build
 * writes into the folder the last one wrote — so a file no definition lands in
 * any more, after a type was dropped or a `defineIn` moved, stayed behind and
 * kept loading. Only what this list names is ever removed: anything else in the
 * folder was put there by someone else.
 */
export const WRITE_MANIFEST = ".stellaris-ts-files.json";

/** Whether a path recorded in the manifest still names a file inside the folder. */
function isInside(modDirectory: string, path: string): boolean {
  const parts: readonly string[] = path.split("/");

  if (parts.some((part) => part === "" || part === "." || part === "..") || /^[A-Za-z]:/u.test(path)) {
    return false;
  }

  return resolve(modDirectory, ...parts).startsWith(`${modDirectory}${sep}`);
}

async function previousFiles(modDirectory: string): Promise<readonly string[]> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(await readFile(join(modDirectory, WRITE_MANIFEST), "utf8"));
  } catch {
    // No manifest is a first build, or a folder some other tool wrote; either
    // way there is nothing this build is entitled to remove.
    return [];
  }

  if (typeof parsed !== "object" || parsed === null || !("files" in parsed) || !Array.isArray(parsed.files)) {
    return [];
  }

  return (parsed.files as readonly unknown[]).filter(
    (file): file is string => typeof file === "string" && isInside(modDirectory, file),
  );
}

export async function writePlan(mod: Mod, plan: EmitPlan, modsDirectory: string): Promise<WriteResult> {
  const errors: readonly string[] = plan.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => `${diagnostic.path}: ${diagnostic.code}: ${diagnostic.message}`);

  if (errors.length > 0) {
    throw new Error(`Refusing to write a mod with errors:\n${errors.join("\n")}`);
  }

  const folder: string = plan.modFileName.replace(/\.mod$/u, "");
  // Absolute, because the `.mod` file carries this path and the launcher reads
  // it from its own working directory rather than from here. A relative one
  // written out verbatim points at nothing the launcher can find, and it says
  // nothing about it: the mod is simply not in the list.
  const modDirectory: string = resolve(modsDirectory, folder);
  const previous: readonly string[] = await previousFiles(modDirectory);
  const written: string[] = [];

  await Promise.all(
    plan.files.map(async (file) => {
      const absolute: string = join(modDirectory, ...file.path.split("/"));
      await mkdir(dirname(absolute), { recursive: true });

      if (file.kind === "binary") {
        await writeFile(absolute, file.bytes);
      } else {
        await writeFile(absolute, file.byteOrderMark ? file.contents : file.contents.replace(/^\uFEFF/u, ""), "utf8");
      }

      written.push(file.path);
    }),
  );

  // Folded, because a file renamed only in case is the same file wherever the
  // filesystem folds case, and removing the old spelling would remove the new.
  const current = new Set<string>(plan.files.map((file) => file.path.toLowerCase()));
  const removed: readonly string[] = previous.filter((path) => !current.has(path.toLowerCase())).sort();

  await Promise.all(removed.map(async (path) => rm(join(modDirectory, ...path.split("/")), { force: true })));

  await writeFile(
    join(modDirectory, WRITE_MANIFEST),
    `${JSON.stringify({ files: [...written].sort() }, undefined, 2)}\n`,
    "utf8",
  );

  const modFilePath: string = resolve(modsDirectory, plan.modFileName);
  await writeFile(modFilePath, renderModFile(mod.options, modDirectory), "utf8");

  return { modDirectory, modFilePath, written: written.sort(), removed };
}

export { BYTE_ORDER_MARK };
