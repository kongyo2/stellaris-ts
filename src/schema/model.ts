import { commands, ruleSets } from "./commands.js";
import { withCorrections } from "./corrections.js";
import { withScopeConstraints } from "./scope-model.js";
import { namedValues, scopeGroups, valueSets } from "./dynamic-sets.js";
import { definitionTypes } from "./definitions/index.js";
import { enums } from "./enums.js";
import { defaultSchemaPolicy, defineSchema } from "./ir.js";
import { modifierNamespace } from "./modifiers.js";
import type { SchemaModel } from "./ir.js";
import { withModifierCorrections } from "./modifier-corrections.js";
import { links, scopes } from "./scopes.js";

/**
 * The whole schema in one value.
 *
 * Assembled from sources that were imported once from cwtools-stellaris-config
 * and are now maintained by hand. Nothing here reads `.cwt` at build or run
 * time; `npm run verify:norefs` proves it by building with the reference
 * checkouts taken away.
 */
export const schema: SchemaModel = defineSchema({
  policy: defaultSchemaPolicy,
  modifiers: withModifierCorrections(modifierNamespace),
  definitionTypes: withCorrections(definitionTypes),
  enums,
  scopes,
  scopeGroups,
  links,
  commands: withScopeConstraints(commands),
  ruleSets,
  namedValues,
  valueSets,
});
