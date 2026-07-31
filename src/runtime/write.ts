import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { BYTE_ORDER_MARK } from "./localisation.js";
import type { EmitPlan } from "./emit.js";
import { renderModFile } from "./emit.js";
import type { Mod } from "./mod.js";

/** Writes an emit plan to disk. Refuses when the plan has errors. */
export interface WriteResult {
  readonly modDirectory: string;
  readonly modFilePath: string;
  readonly written: readonly string[];
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

  const modFilePath: string = resolve(modsDirectory, plan.modFileName);
  await writeFile(modFilePath, renderModFile(mod.options, modDirectory), "utf8");

  return { modDirectory, modFilePath, written: written.sort() };
}

export { BYTE_ORDER_MARK };
