import { describe, expect, it } from "vitest";

import { schema } from "../src/schema/index.js";
import { isScopeKey, isSyntacticKey, scopeEntryNames, scriptBlockNames } from "../src/schema/script-keys.js";

/**
 * A trigger block holds more than triggers. Vanilla's own scripted triggers are
 * a third of what its scripted triggers contain, and `owner = { ... }` is a
 * scope to enter rather than a field of anything.
 */
describe("what a script block accepts", () => {
  const triggers: ReadonlySet<string> = scriptBlockNames(schema, "trigger", {
    scripted_trigger: ["is_my_thing"],
  });

  it("takes a declared trigger", () => {
    expect(triggers.has("has_modifier")).toBe(true);
  });

  it("takes a scripted trigger by name", () => {
    expect(triggers.has("is_my_thing")).toBe(true);
  });

  it("takes a scope to enter", () => {
    expect(triggers.has("owner")).toBe(true);
    expect(triggers.has("root")).toBe(true);
  });

  /** Vanilla writes both `OR = {` and `or = {`; the game reads both. */
  it("does not distinguish case on a logical operator", () => {
    expect(triggers.has("or")).toBe(true);
    expect(triggers.has("not")).toBe(true);
  });

  it("still rejects a name nothing declares", () => {
    expect(triggers.has("has_modifierr")).toBe(false);
  });
});

describe("scope keys", () => {
  const names: ReadonlySet<string> = scopeEntryNames(schema);

  it("follows a chain", () => {
    expect(isScopeKey(schema, "root.owner", names)).toBe(true);
    expect(isScopeKey(schema, "capital_scope.solar_system", names)).toBe(true);
  });

  it("takes a run-time lookup", () => {
    expect(isScopeKey(schema, "event_target:graygoo_country", names)).toBe(true);
  });

  /** A trailing `?` means "skip if absent", not part of the name. */
  it("ignores the optional marker", () => {
    expect(isScopeKey(schema, "capital_scope?", names)).toBe(true);
  });

  it("rejects a chain with an invented link", () => {
    expect(isScopeKey(schema, "root.ownerr", names)).toBe(false);
    expect(isScopeKey(schema, "no_such_prefix:x", names)).toBe(false);
  });
});

describe("syntactic keys", () => {
  it("treats a script variable as syntax", () => {
    expect(isSyntacticKey("@view_h")).toBe(true);
  });

  /** `remove_$SCOPE_TYPE$_flag` has no final spelling until substitution. */
  it("treats a parameterised key as syntax", () => {
    expect(isSyntacticKey("$FROM$")).toBe(true);
    expect(isSyntacticKey("remove_$SCOPE_TYPE$_flag")).toBe(true);
  });

  it("leaves an ordinary key alone", () => {
    expect(isSyntacticKey("planet_modifier")).toBe(false);
  });
});
