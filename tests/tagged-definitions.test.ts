import { describe, expect, it } from "vitest";

import { define } from "../src/builders/index.js";
import { defineMod, emit } from "../src/index.js";

/**
 * The 43 types whose block key is a tag rather than their identity.
 *
 * An event is `country_event = { id = utopia.1 }`. Writing `utopia.1 = { ... }`
 * instead parses, loads, and defines nothing — the game reports no error and the
 * event simply never fires, which is the worst kind of mistake this library can
 * let through.
 */
const fileNamed = (mod: Parameters<typeof emit>[0], suffix: string): string =>
  emit(mod).files.find((file) => file.path.endsWith(suffix))?.contents ?? "";

describe("a type written under a tag", () => {
  it("writes the tag as the key and the identity as a field", () => {
    const mod = defineMod({ name: "Tagged", version: "1", supportedVersion: "v4.4.*" }).add(
      define("event", "sts_demo.1", { is_triggered_only: true }, { as: "country_event" }),
    );

    expect(fileNamed(mod, "events/zz_tagged_event.txt")).toContain("country_event = {\n\tid = sts_demo.1");
  });

  it("declares the namespace the file's ids belong to", () => {
    const mod = defineMod({ name: "Ns", version: "1", supportedVersion: "v4.4.*" })
      .add(define("event", "sts_demo.1", { is_triggered_only: true }, { as: "country_event" }))
      .add(define("event", "sts_demo.2", { is_triggered_only: true }, { as: "planet_event" }));

    const contents = fileNamed(mod, "events/zz_ns_event.txt");
    expect(contents.startsWith("namespace = sts_demo\n")).toBe(true);
    expect(contents.split("namespace = sts_demo")).toHaveLength(2);
  });

  it("refuses a definition with no tag, and names the ones the game writes", () => {
    expect(() => define("event", "sts_demo.1", {})).toThrow(/country_event/u);
  });

  it("refuses a tag the game does not write", () => {
    expect(() => define("event", "sts_demo.1", {}, { as: "galaxy_event" })).toThrow(/not written under galaxy_event/u);
  });

  it("uses the only tag a type has without being asked", () => {
    const mod = defineMod({ name: "Sole", version: "1", supportedVersion: "v4.4.*" }).add(
      define("component_set", "sts_set", {}),
    );

    expect(fileNamed(mod, "common/component_sets/zz_sole_component_set.txt")).toContain(
      "component_set = {\n\tkey = sts_set",
    );
  });

  it("leaves a type written under its own identifier alone", () => {
    const mod = defineMod({ name: "Plain", version: "1", supportedVersion: "v4.4.*" }).add(
      define("building", "sts_lab", { category: "research" }),
    );

    expect(fileNamed(mod, "common/buildings/zz_plain_building.txt")).toContain("sts_lab = {");
    expect(() => define("building", "sts_lab", { category: "research" }, { as: "building" })).toThrow(/would have/u);
  });
});
