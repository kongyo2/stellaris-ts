import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Why three WASM packages are declared that nothing here imports.
 *
 * `vitest` pulls `rolldown`, which has an optional `wasm32-wasi` binding, which
 * peer-depends on `@emnapi/core` and `@emnapi/runtime`. npm resolves optional
 * bindings per platform: on Windows it takes the native one and never reaches
 * those peers, so a lock file written there has no entry for them — and on
 * Linux, where the wasm branch *is* reachable, `npm ci` refuses to install
 * against a lock that is missing what it needs. CI could not install at all.
 *
 * Declaring them makes the lock record them everywhere, and the overrides keep
 * every reference on one version rather than the two the resolvers pick between.
 * Neither is imported; both are load-bearing, which is exactly the kind of thing
 * that gets tidied away.
 */
interface Manifest {
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly overrides?: Readonly<Record<string, string>>;
}

function readManifest(): Manifest {
  const parsed: unknown = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));

  if (typeof parsed !== "object" || parsed === null) {
    throw new TypeError("package.json is not an object.");
  }

  return parsed;
}

const MANIFEST: Manifest = readManifest();

const PINNED: Readonly<Record<string, string>> = {
  "@emnapi/core": "1.11.1",
  "@emnapi/runtime": "1.11.1",
  "@emnapi/wasi-threads": "1.2.2",
};

describe("the packages the lock file needs on every platform", () => {
  it("declares them, so a Windows-written lock installs on Linux", () => {
    for (const [name, version] of Object.entries(PINNED)) {
      expect(MANIFEST.devDependencies?.[name]).toBe(version);
    }
  });

  it("pins every reference to them to one version", () => {
    for (const [name, version] of Object.entries(PINNED)) {
      expect(MANIFEST.overrides?.[name]).toBe(version);
    }
  });
});
