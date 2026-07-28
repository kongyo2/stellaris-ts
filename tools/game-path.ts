import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * Finds an installed copy of Stellaris.
 *
 * The tools that read the game are developer tools, not part of the package,
 * but they still cannot carry one machine's paths: nobody else has the game on
 * the same drive. `STELLARIS_GAME_PATH` wins; otherwise the usual Steam
 * locations are tried, including the extra library folders Steam creates when
 * the default drive fills up.
 */

const RELATIVE_INSTALL: readonly string[] = ["steamapps", "common", "Stellaris"];

function steamRoots(): readonly string[] {
  const home: string = homedir();

  switch (platform()) {
    case "win32":
      return [
        String.raw`C:\Program Files (x86)\Steam`,
        String.raw`C:\Program Files\Steam`,
        ...["C", "D", "E", "F"].map((drive) => `${drive}:\\Steam`),
        ...["C", "D", "E", "F"].map((drive) => `${drive}:\\SteamLibrary`),
        ...["C", "D", "E", "F"].map((drive) => `${drive}:\\Games\\Steam`),
      ];
    case "darwin":
      return [join(home, "Library", "Application Support", "Steam")];
    default:
      return [
        join(home, ".steam", "steam"),
        join(home, ".local", "share", "Steam"),
        join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
      ];
  }
}

/** Where the launcher keeps local mods. */
export function defaultModsDirectory(): string {
  const home: string = homedir();

  switch (platform()) {
    case "win32":
      return join(home, "Documents", "Paradox Interactive", "Stellaris", "mod");
    case "darwin":
      return join(home, "Documents", "Paradox Interactive", "Stellaris", "mod");
    default:
      return join(home, ".local", "share", "Paradox Interactive", "Stellaris", "mod");
  }
}

export function findGamePath(): string | undefined {
  const configured: string | undefined = process.env["STELLARIS_GAME_PATH"];

  if (configured !== undefined && configured.length > 0) {
    return configured;
  }

  for (const root of steamRoots()) {
    const candidate: string = join(root, ...RELATIVE_INSTALL);
    if (existsSync(join(candidate, "launcher-settings.json"))) {
      return candidate;
    }
  }

  return undefined;
}

/** Same, but says what to do when it cannot find one. */
export function requireGamePath(): string {
  const found: string | undefined = findGamePath();

  if (found === undefined) {
    throw new Error(
      "No Stellaris installation found. Set STELLARIS_GAME_PATH to the folder holding launcher-settings.json.",
    );
  }

  return found;
}
