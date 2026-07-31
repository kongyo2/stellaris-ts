import {
  anyValue,
  block,
  field,
  occurs,
  primitive,
  scriptCommand,
  scriptValue,
  typeRef,
  unspecifiedScope,
} from "./ir.js";

import type { ScriptCommandDefinition } from "./ir.js";

/**
 * Triggers and effects the game documents that the ported corpus never did.
 *
 * `src/schema/vanilla-commands.ts` holds the ones found by reading the game's
 * *script*; these were found by reading the game's own `-debug` documentation,
 * which lists commands vanilla happens not to use and a mod may still write.
 * Eight of them, measured by comparing the 4.3.7 trigger and effect dumps
 * against `schema.commands`: every other name in those dumps is already here,
 * counting the logic connectors, which the corpus declares in upper case and
 * the game writes in either.
 *
 * The documentation line and the usage line are quoted, because the shape comes
 * from them and nothing else. Where the dump shows a comparison — `>= <int>` —
 * the operator is left open rather than pinned to `=`, since that is what the
 * game printed.
 */
export const dumpCommands: readonly ScriptCommandDefinition[] = [
  // council_agenda_progress - Checks the progress of the current Agenda.
  // council_agenda_progress >= <value>
  scriptCommand({
    id: "council_agenda_progress",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "==",
    value: scriptValue("number"),
    documentation: "Checks the progress of the current Agenda.",
  }),

  // has_ruler_trait - Checks if a leader has a certain ruler trait, even if
  // they are not currently ruler
  // has_ruler_trait = leader_trait_carefree
  scriptCommand({
    id: "has_ruler_trait",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: typeRef("trait"),
    documentation: "Checks if a leader has a certain ruler trait, even if they are not currently ruler",
  }),

  // built_on_planet - Checks if the scoped megastructure is built on a planet
  // built_on_planet = yes
  scriptCommand({
    id: "built_on_planet",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: primitive("boolean"),
    documentation: "Checks if the scoped megastructure is built on a planet",
  }),

  // is_spynetwork_max_level - Compares spy network max level of the scoped object
  // is_spynetwork_max_level >= <int>
  scriptCommand({
    id: "is_spynetwork_max_level",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "==",
    value: scriptValue("integer"),
    documentation: "Compares spy network max level of the scoped object",
  }),

  // cosmic_storm_system_influence - Checks the systems total cosmic storm influence
  // The dump prints no usage line for this one, so the value is left open.
  scriptCommand({
    id: "cosmic_storm_system_influence",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "==",
    value: anyValue(),
    documentation: "Checks the systems total cosmic storm influence",
  }),

  // is_market_leader - Checks if country owns the galactic market
  // is_market_leader = yes/no
  scriptCommand({
    id: "is_market_leader",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: primitive("boolean"),
    documentation: "Checks if country owns the galactic market",
  }),

  // delete_fleet_naval_cap - Deletes up to naval_cap worth of ships in the
  // target fleet (no death graphics)
  // delete_ship_naval_cap = { target=<target> naval_cap=<max naval cap> kill_leader=<yes/no> }
  scriptCommand({
    id: "delete_fleet_naval_cap",
    family: "effect",
    input: unspecifiedScope(),
    operator: "=",
    value: block([
      field("target", anyValue(), occurs.optional),
      field("naval_cap", primitive("number"), occurs.optional),
      field("kill_leader", primitive("boolean"), occurs.optional),
    ]),
    documentation: "Deletes up to naval_cap worth of ships in the target fleet (no death graphics)",
  }),

  // finish_current_operation_stage - Finish the current operation phase
  // finish_current_operation_stage = yes/no
  scriptCommand({
    id: "finish_current_operation_stage",
    family: "effect",
    input: unspecifiedScope(),
    operator: "=",
    value: primitive("boolean"),
    documentation: "Finish the current operation phase",
  }),
];
