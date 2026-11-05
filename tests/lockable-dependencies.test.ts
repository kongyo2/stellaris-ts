import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Whether the lock file installs on a platform other than the one that wrote it.
 *
 * npm resolves optional bindings per platform. `rolldown` used to carry a
 * `wasm32-wasi` binding whose runtime peer-depends on `@emnapi/core` and
 * `@emnapi/runtime`; npm never reaches that binding on Windows, so a lock
 * written there had no entry for the peers, and on Linux, where it does reach
 * it, `npm ci` refused the lock. CI could not install at all, and three
 * packages nothing imports were pinned to put the peers back.
 *
 * rolldown 1.2 ships no wasm binding, so the pins went with it. What they
 * protected is checked here instead, over every package in the lock: a peer a
 * package needs has to be in the lock wherever npm would look for it.
 */
interface LockedPackage {
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>;
}

interface LockFile {
  readonly packages?: Readonly<Record<string, LockedPackage>>;
}

function readLock(): LockFile {
  const parsed: unknown = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package-lock.json", import.meta.url)), "utf8"),
  );

  if (typeof parsed !== "object" || parsed === null) {
    throw new TypeError("package-lock.json is not an object.");
  }

  return parsed;
}

/** Whether `name` resolves from the package at `path`: its own node_modules, then each one above it. */
function resolvesFrom(packages: Readonly<Record<string, LockedPackage>>, path: string, name: string): boolean {
  let base: string = path;

  for (;;) {
    if (`${base === "" ? "" : `${base}/`}node_modules/${name}` in packages) {
      return true;
    }

    if (base === "") {
      return false;
    }

    const parent: number = base.lastIndexOf("/node_modules/");
    base = parent === -1 ? "" : base.slice(0, parent);
  }
}

describe("the lock file", () => {
  it("records every peer a locked package requires", () => {
    const packages: Readonly<Record<string, LockedPackage>> = readLock().packages ?? {};
    const missing: string[] = [];

    expect(Object.keys(packages).length).toBeGreaterThan(1);

    for (const [path, locked] of Object.entries(packages)) {
      for (const name of Object.keys(locked.peerDependencies ?? {})) {
        if (
          path !== "" &&
          locked.peerDependenciesMeta?.[name]?.optional !== true &&
          !resolvesFrom(packages, path, name)
        ) {
          missing.push(`${path} needs ${name}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
