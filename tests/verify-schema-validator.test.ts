import { describe, expect, it } from "vitest";

import {
  DefinitionTypeId,
  EnumId,
  ScopeId,
  allOf,
  always,
  anyScope,
  anyValue,
  block,
  chainedEnum,
  defaultSchemaPolicy,
  enterScope,
  enumKey,
  enumRef,
  field,
  fieldPresent,
  interpolatedType,
  list,
  namedValue,
  namedValueKey,
  not,
  noScope,
  oneOf,
  oneOfScopes,
  opaque,
  optional,
  patternKey,
  primitive,
  replaceScope,
  ruleSetEntries,
  ruleSetKey,
  ruleSetKeyRef,
  ruleSetKeysFieldKey,
  ruleSetRef,
  scopeGroup,
  scopeGroupKey,
  scopeKey,
  scopeRef,
  scriptValue,
  staticEnum,
  typeKey,
  typeRef,
  unspecifiedScope,
  valueSet,
  valueSetKey,
  whenVariant,
} from "../src/schema/index.js";
import type {
  DefinitionType,
  EnumId as EnumIdentifier,
  SchemaModel,
  ScopeId as ScopeIdentifier,
} from "../src/schema/index.js";
import { validateSchema } from "../tools/verify-schema/validate.js";

function validDefinition(): DefinitionType {
  return {
    id: DefinitionTypeId.Building,
    source: {
      kind: "keyed-blocks",
      directory: "common/buildings",
      includeSubdirectories: true,
      files: ["00_buildings.txt"],
    },
    entryScope: ScopeId.Planet,
    variants: [
      {
        id: "planet",
        when: allOf(always(), not(fieldPresent("disabled"))),
        entryScope: anyScope(),
      },
    ],
    localisation: [
      {
        role: "name",
        source: { kind: "definition-id", suffix: "" },
        required: true,
        variant: "planet",
      },
    ],
    modifiers: [{ category: "planet", prefix: "", suffix: "_add", variant: "planet" }],
    entries: [
      optional("duplicate-is-legal", primitive("scalar"), { operator: "!=" }),
      optional("duplicate-is-legal", primitive("boolean")),
      optional("category", enumRef(EnumId.BuildingCategories)),
      optional("owner", scopeRef(ScopeId.Planet)),
      optional("pseudo-enter", primitive("scalar"), { scope: enterScope(noScope()) }),
      optional("base", typeRef(DefinitionTypeId.Building, "planet")),
      optional("known-set", valueSet("known-set")),
      optional(
        "new-value-kinds",
        oneOf(
          anyValue(),
          chainedEnum(ScopeId.Planet, EnumId.BuildingCategories),
          interpolatedType(DefinitionTypeId.Building, "$", "$"),
          namedValue("known-value"),
          scopeGroup("known-group"),
          scriptValue("number"),
          ruleSetRef("known-family", "known"),
          ruleSetKeyRef("known-family"),
        ),
      ),
      optional(namedValueKey("known-value"), primitive("scalar")),
      optional(patternKey("prefix_", "", DefinitionTypeId.Building), primitive("scalar")),
      optional(scopeKey(anyScope()), primitive("scalar")),
      optional(scopeGroupKey("known-group"), primitive("scalar")),
      optional(ruleSetKey("known-family", "known"), primitive("scalar")),
      optional(ruleSetKeysFieldKey("known-family"), primitive("scalar")),
      ruleSetEntries("known-family"),
      whenVariant("planet", [optional("nested", block([optional("value", primitive("integer"))]))]),
    ],
  };
}

function validModel(): SchemaModel {
  const duplicateScopeLink = {
    kind: "scope-link" as const,
    id: "overloaded-link",
    input: { kind: "listed-scopes" as const, scopes: [ScopeId.Planet] },
    output: { kind: "fixed-scope" as const, scopes: [ScopeId.Planet] },
  };
  const duplicateCommand = {
    id: "overloaded-command",
    family: "trigger" as const,
    input: unspecifiedScope(),
    operator: ">=" as const,
    scope: replaceScope({
      current: oneOfScopes(ScopeId.Planet, anyScope(), noScope()),
      root: anyScope(),
      previous: noScope(),
      from: ScopeId.Planet,
      fromFrom: oneOfScopes(noScope(), ScopeId.Planet),
      fromFromFrom: anyScope(),
      fromFromFromFrom: noScope(),
    }),
    value: primitive("boolean"),
  };
  return {
    policy: defaultSchemaPolicy,
    modifiers: { source: "test", base: [], templates: [] },
    definitionTypes: [validDefinition()],
    enums: [staticEnum(EnumId.BuildingCategories, ["capital", "regular"])],
    scopes: [{ id: ScopeId.Planet, aliases: ["planet"] }],
    scopeGroups: [{ id: "known-group", scopes: [ScopeId.Planet] }],
    links: [duplicateScopeLink, duplicateScopeLink],
    commands: [duplicateCommand, duplicateCommand],
    ruleSets: [
      {
        family: "known-family",
        name: "known",
        single: false,
        operator: "==",
        value: primitive("scalar"),
      },
    ],
    namedValues: [{ id: "known-value", value: primitive("number") }],
    valueSets: [{ id: "known-set", key: "key", value: primitive("scalar") }],
  };
}

describe("schema self-validator", () => {
  it("accepts ordered duplicate fields, links, and commands", () => {
    const model = validModel();
    expect(
      validateSchema(model, {
        minimums: {
          commands: 2,
          definitionTypes: 1,
          enums: 1,
          links: 2,
          macros: 1,
          namedValues: 1,
          ruleSets: 1,
          scopeGroups: 1,
          scopeLinks: 2,
          scopes: 1,
          triggerCommands: 2,
          valueSets: 1,
          variants: 1,
        },
      }),
    ).toEqual([]);
    expect(model.definitionTypes[0]?.entries.find((entry) => entry.kind === "field")?.operator).toBe("!=");
    expect(model.commands[0]?.operator).toBe(">=");
    expect(model.ruleSets[0]?.operator).toBe("==");
  });

  it("walks every nested reference-bearing schema branch and reports migration debt", () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The validator must reject runtime data that bypassed the catalog type.
    const missingEnum = "missing-enum" as EnumIdentifier;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The validator must reject runtime data that bypassed the catalog type.
    const missingScope = "missing-scope" as ScopeIdentifier;
    const malformedDefinition: DefinitionType = {
      id: DefinitionTypeId.Building,
      source: {
        kind: "keyed-blocks",
        directory: "C:\\private\\schema",
        includeSubdirectories: true,
        files: ["../outside.txt"],
      },
      entryScope: missingScope,
      variants: [
        {
          id: "duplicate",
          when: { kind: "all", predicates: [{ kind: "not", predicate: { kind: "always" } }] },
          entryScope: missingScope,
        },
        { id: "duplicate", when: { kind: "always" } },
      ],
      localisation: [
        {
          role: "name",
          source: { kind: "definition-id", suffix: "" },
          required: true,
          variant: "unknown-localisation-variant",
        },
      ],
      modifiers: [
        {
          category: "test",
          prefix: "",
          suffix: "",
          variant: "unknown-modifier-variant",
        },
      ],
      entries: [
        whenVariant("unknown-rule-variant", [
          field(
            enumKey(missingEnum),
            oneOf(
              enumRef(missingEnum),
              chainedEnum(missingScope, missingEnum),
              typeRef("missing-type"),
              typeRef(DefinitionTypeId.Building, "missing-target-variant"),
              interpolatedType("target_pop_job", "<", ">"),
              scopeRef(missingScope),
              scopeGroup("missing-group"),
              namedValue("missing-named"),
              valueSet("missing-set"),
              ruleSetRef("missing-family", "missing-name", true),
              ruleSetKeyRef("missing-family"),
              list(
                block([
                  field(typeKey("missing-key-type"), primitive("scalar"), {
                    min: -1,
                    max: null,
                  }),
                  optional(valueSetKey("missing-key-set"), primitive("scalar")),
                  optional(patternKey("", "", "missing-pattern-type"), primitive("scalar")),
                  optional(namedValueKey("missing-named-key"), primitive("scalar")),
                  optional(scopeKey(missingScope), primitive("scalar")),
                  optional(scopeGroupKey("missing-key-group"), primitive("scalar")),
                  optional(ruleSetKey("missing-family", "missing-key-rule", true), primitive("scalar")),
                  optional(ruleSetKeysFieldKey("missing-family"), primitive("scalar")),
                  ruleSetEntries("missing-family"),
                ]),
                { min: 3, max: 2 },
              ),
              opaque("untranslated upstream bracket expression"),
              primitive("icon", undefined, "/absolute/icons"),
              anyValue(),
              scriptValue("percentage"),
            ),
            { min: 2, max: 1 },
            {
              operator: ">=",
              scope: replaceScope({
                current: oneOfScopes(missingScope, anyScope(), noScope()),
                root: oneOfScopes(anyScope(), missingScope),
                previous: oneOfScopes(noScope(), missingScope),
                from: oneOfScopes(missingScope),
                fromFrom: oneOfScopes(missingScope, noScope()),
                fromFromFrom: oneOfScopes(anyScope(), missingScope),
                fromFromFromFrom: oneOfScopes(missingScope, anyScope(), noScope()),
              }),
            },
          ),
        ]),
      ],
    };
    const duplicateDefinition = validDefinition();
    const duplicateMacro = {
      id: "inline-script",
      key: "inline_script",
      appliesTo: "all-blocks",
    } as const;
    const model: SchemaModel = {
      policy: {
        macros: [duplicateMacro, duplicateMacro],
      },
      modifiers: { source: "test", base: [], templates: [] },
      definitionTypes: [malformedDefinition, duplicateDefinition],
      enums: [
        staticEnum(EnumId.BuildingCategories, ["one"]),
        staticEnum(EnumId.BuildingCategories, ["two"]),
        {
          kind: "extracted-enum",
          id: EnumId.FeatureFlags,
          sources: [
            {
              directory: "refs/cwtools",
              includeSubdirectories: true,
              startFromRoot: false,
              route: [{ kind: "capture", source: "key" }],
            },
          ],
        },
      ],
      scopes: [
        { id: ScopeId.Planet, aliases: [] },
        { id: ScopeId.Planet, aliases: ["duplicate"] },
      ],
      scopeGroups: [
        { id: "duplicate-group", scopes: [missingScope] },
        { id: "duplicate-group", scopes: [] },
      ],
      links: [
        {
          kind: "scope-link",
          id: "same-link-id-is-legal",
          input: { kind: "listed-scopes", scopes: [missingScope] },
          output: { kind: "fixed-scope", scopes: [missingScope] },
          value: scopeRef(missingScope),
        },
        {
          kind: "data-link",
          id: "same-link-id-is-legal",
          prefix: "value:",
          source: enumRef(missingEnum),
        },
      ],
      commands: [
        {
          id: "same-command-id-is-legal",
          family: "effect",
          input: { kind: "listed-scopes", scopes: [missingScope] },
          operator: "!=",
          scope: replaceScope({ current: missingScope }),
          value: typeRef("missing-command-type"),
        },
        {
          id: "same-command-id-is-legal",
          family: "effect",
          input: unspecifiedScope(),
          operator: "=",
          value: primitive("boolean"),
        },
      ],
      ruleSets: [
        {
          family: "known-family",
          name: "known",
          single: false,
          operator: "<=",
          scope: enterScope(missingScope),
          value: namedValue("missing-from-rule-set"),
        },
      ],
      namedValues: [
        { id: "duplicate-named", value: scopeRef(missingScope) },
        { id: "duplicate-named", value: primitive("scalar") },
      ],
      valueSets: [
        { id: "duplicate-set", key: valueSetKey("missing-key-set"), value: enumRef(missingEnum) },
        { id: "duplicate-set", key: "key", value: primitive("scalar") },
      ],
    };

    const first = validateSchema(model);
    const second = validateSchema(model);
    expect(second).toEqual(first);
    expect(new Set(first.map((diagnostic) => diagnostic.code))).toEqual(
      new Set([
        "duplicate-definition-type-id",
        "duplicate-enum-id",
        "duplicate-macro-id",
        "duplicate-named-value-id",
        "duplicate-scope-group-id",
        "duplicate-scope-id",
        "duplicate-value-set-id",
        "duplicate-variant-id",
        "invalid-occurrence",
        "missing-enum-reference",
        "missing-named-value-reference",
        "missing-rule-set-reference",
        "missing-scope-group-reference",
        "missing-scope-reference",
        "missing-type-reference",
        "missing-value-set-reference",
        "opaque-migration-debt",
        "unknown-variant-reference",
        "unsafe-path",
      ]),
    );
    expect(first.map((diagnostic) => diagnostic.path)).toEqual([...first.map((diagnostic) => diagnostic.path)].sort());
    expect(first.some((diagnostic) => diagnostic.path === "links[0].input.scopes[0]")).toBe(true);
    expect(first.some((diagnostic) => diagnostic.path === "links[1].source.enum")).toBe(true);
    expect(first.some((diagnostic) => diagnostic.path === "commands[0].value.type")).toBe(true);
    expect(
      first.some(
        (diagnostic) => diagnostic.code === "missing-type-reference" && diagnostic.message.includes("target_pop_job"),
      ),
    ).toBe(true);
    expect(first.some((diagnostic) => diagnostic.code === "opaque-migration-debt")).toBe(true);
    expect(first.some((diagnostic) => diagnostic.path.endsWith(".scope.frame.fromFromFromFrom.scopes[0]"))).toBe(true);
  });

  it("uses only caller-provided structural minimums", () => {
    const empty: SchemaModel = {
      policy: { macros: [] },
      modifiers: { source: "test", base: [], templates: [] },
      definitionTypes: [],
      enums: [],
      scopes: [],
      scopeGroups: [],
      links: [],
      commands: [],
      ruleSets: [],
      namedValues: [],
      valueSets: [],
    };
    expect(validateSchema(empty)).toEqual([]);

    expect(
      validateSchema(validModel(), {
        minimums: {
          dataLinks: 1,
          definitionTypes: 2,
          effectCommands: 1,
          ruleSets: 2,
          scopeGroups: 2,
          variants: -1,
        },
      }).map(({ code, path }) => ({ code, path })),
    ).toEqual([
      { code: "below-structural-minimum", path: "minimums.dataLinks" },
      { code: "below-structural-minimum", path: "minimums.definitionTypes" },
      { code: "below-structural-minimum", path: "minimums.effectCommands" },
      { code: "below-structural-minimum", path: "minimums.ruleSets" },
      { code: "below-structural-minimum", path: "minimums.scopeGroups" },
      { code: "invalid-structural-minimum", path: "minimums.variants" },
    ]);
  });
});
