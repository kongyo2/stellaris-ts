import { commands, ruleSets } from "./commands.js";
import { namedValues, scopeGroups, valueSets } from "./dynamic-sets.js";
import { definitionTypes } from "./definitions/index.js";
import { enums } from "./enums.js";
import { defaultSchemaPolicy, defineSchema } from "./ir.js";
import type { SchemaModel } from "./ir.js";
import { links, scopes } from "./scopes.js";

/**
 * The whole schema in one value.
 *
 * Assembled from sources that were imported once from cwtools-stellaris-config
 * and are now maintained by hand. Nothing here reads `.cwt` at build or run
 * time — see PLAN.md §0.1.
 */
export const schema: SchemaModel = defineSchema({
  policy: defaultSchemaPolicy,
  definitionTypes,
  enums,
  scopes,
  scopeGroups,
  links,
  commands,
  ruleSets,
  namedValues,
  valueSets,
});
