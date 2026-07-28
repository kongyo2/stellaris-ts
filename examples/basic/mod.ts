import { homedir } from "node:os";
import { join } from "node:path";

import { define } from "@kongyo2/stellaris-ts/builders";
import { defineMod, emit, writePlan } from "@kongyo2/stellaris-ts";
import { validate } from "@kongyo2/stellaris-ts/validate";

/**
 * A minimal mod: one building, one technology, and the strings for both.
 *
 * Run with `npx tsx examples/basic/mod.ts` to write it into the game's mod
 * folder, then enable "stellaris-ts Example" in the launcher.
 */
const mod = defineMod({
  name: "stellaris-ts Example",
  version: "0.1.0",
  supportedVersion: "v4.4.*",
  tags: ["Gameplay"],
})
  .add(
    define("building", "sts_example_lab", {
      category: "research",
      base_buildtime: 360,
      icon: "GFX_building_physics_lab",
      potential: { exists: "owner" },
      allow: { has_upgraded_capital: true },
      resources: {
        category: "planet_buildings",
        cost: { minerals: 300 },
        upkeep: { energy: 3 },
      },
      planet_modifier: { job_researcher_add: 2 },
    }),
  )
  .add(
    define("technology", "sts_tech_example", {
      area: "physics",
      cost: 500,
      // A tier is a `technology_tier` id, and those are named "0" to "5".
      tier: "1",
      category: ["computing"],
      prerequisites: ["tech_basic_science_lab_1"],
      weight: 10,
    }),
  )
  .localise("l_english", "sts_example_lab", "Example Laboratory")
  .localise("l_english", "sts_example_lab_desc", "A research building added by stellaris-ts.")
  .localise("l_english", "sts_tech_example", "Example Research")
  .localise("l_english", "sts_tech_example_desc", "A technology added by stellaris-ts.");

// Every key, at every depth, against what the installed game accepts. The game
// itself would say nothing about a misspelling here.
for (const diagnostic of validate(mod)) {
  const where: string =
    diagnostic.path.length === 0 ? diagnostic.definition : `${diagnostic.definition}.${diagnostic.path}`;
  console.error(`${diagnostic.severity.toUpperCase()} ${where}: ${diagnostic.code}: ${diagnostic.message}`);
}

const plan = emit(mod);

for (const diagnostic of plan.diagnostics) {
  console.error(`${diagnostic.severity.toUpperCase()} ${diagnostic.path}: ${diagnostic.code}: ${diagnostic.message}`);
}

// `stellaris-ts build` locates this itself; the example spells it out so it
// runs standalone.
const modsDirectory: string =
  process.env["STELLARIS_MODS_DIR"] ?? join(homedir(), "Documents", "Paradox Interactive", "Stellaris", "mod");

const result = await writePlan(mod, plan, modsDirectory);
console.log(`Wrote ${String(result.written.length)} files to ${result.modDirectory}`);
console.log(`Launcher entry: ${result.modFilePath}`);
