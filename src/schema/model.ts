import { commands, ruleSets } from "./commands.js";
import { withCorrections } from "./corrections.js";
import { withScopeConstraints } from "./scope-model.js";
import { namedValues, scopeGroups, valueSets } from "./dynamic-sets.js";
import { definitionTypes } from "./definitions/index.js";
import { enums } from "./enums.js";
import { withEnumMembers } from "./vanilla-enum-members.js";
import { defaultSchemaPolicy, defineSchema } from "./ir.js";
import { modifierNamespace } from "./modifiers.js";
import { withGameDeclaredFields } from "./open-fields.js";
import { vanillaFieldNames } from "../generated/vanilla/field-names.js";
import type { SchemaModel } from "./ir.js";
import { withModifierCorrections } from "./modifier-corrections.js";
import { links, scopes } from "./scopes.js";
import { vanillaLinks, vanillaScopes } from "./vanilla-scopes.js";
import { dumpCommands, withoutRetiredCommands } from "./dump-commands.js";
import { vanillaCommands } from "./vanilla-commands.js";
import { withEntryScopes } from "./vanilla-entry-scopes.js";
import { vanillaDefinitionTypes } from "./vanilla-types.js";

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
  definitionTypes: withEntryScopes(
    withGameDeclaredFields(withCorrections([...definitionTypes, ...vanillaDefinitionTypes]), vanillaFieldNames),
  ),
  enums: withEnumMembers(enums),
  scopes: [...scopes, ...vanillaScopes],
  scopeGroups,
  links: [...links, ...vanillaLinks],
  // Every command goes through the constraint pass, because the dump is where
  // the scopes come from and it documents commands from all three sources:
  // each of the 84 found in vanilla's script is in the 4.5.1 dumps too. A
  // command the dump does not mention passes through unchanged.
  commands: withoutRetiredCommands(withScopeConstraints([...commands, ...dumpCommands, ...vanillaCommands])),
  ruleSets,
  namedValues,
  valueSets,
});
