import { describe, expect, it } from "vitest";

import { extractedEnumMembers, vanillaIdsByType } from "../src/generated/vanilla/index.js";
import { anyKey, anyValue, block, field, occurs, primitive, schema } from "../src/schema/index.js";
import { SchemaResolver } from "../src/schema/resolve.js";

const resolver = new SchemaResolver(schema, {
  idsByType: vanillaIdsByType,
  modifierNames: new Set<string>(),
  enumMembers: extractedEnumMembers,
});

/**
 * A rule that takes any key says what the key holds, unless another rule for
 * the same block takes the block whatever it holds.
 */
describe("what a key under any key holds", () => {
  const numbers = block([field(anyKey(), primitive("number"), occurs.any)]);

  it("is what the rule that takes any key says", () => {
    const rules = resolver.rulesForValues([numbers]);

    expect(resolver.resolve(rules, "custom").values).toEqual([primitive("number")]);
  });

  it("is nothing in particular where an alternative takes anything", () => {
    const rules = resolver.rulesForValues([anyValue(), numbers]);

    expect(resolver.resolve(rules, "custom").accepted).toBe(true);
    expect(resolver.resolve(rules, "custom").values).toEqual([]);
  });

  it("is not what the any-key rule says for a key a literal rule claims", () => {
    const rules = resolver.rulesForValues([
      block([field("name", primitive("scalar"), occurs.optional), field(anyKey(), primitive("number"), occurs.any)]),
    ]);

    expect(resolver.resolve(rules, "name").values).toEqual([primitive("scalar")]);
  });
});
