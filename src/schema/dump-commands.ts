import { ScopeId } from "./catalog.js";
import {
  anyValue,
  block,
  field,
  occurs,
  oneOf,
  primitive,
  scopeRef,
  scriptCommand,
  scriptValue,
  typeKey,
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
 * Measured by comparing the trigger and effect dumps against `schema.commands`:
 * eight from 4.3.7, and forty-five more from 4.5.1. Every other name in those
 * dumps is already here, counting the logic connectors, which the corpus
 * declares in upper case and the game writes in either.
 *
 * The documentation line and the usage line are quoted, because the shape comes
 * from them and nothing else. Where the dump shows a comparison — `>= <int>` —
 * the operator is left open rather than pinned to `=`, since that is what the
 * game printed. An iterator is left as open as the siblings vanilla does use,
 * which `vanilla-commands.ts` declares without a shape.
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

  // From here on, the 4.5.1 dumps.

  // is_ai_ship_role - Checks whether the scoped country may assign a ship role
  // to a ship size.
  // is_ai_ship_role = { ship_size = weaver_stage_1 role = buffer_role }
  scriptCommand({
    id: "is_ai_ship_role",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: block([
      field("ship_size", typeRef("ship_size"), occurs.one),
      field("role", primitive("scalar"), occurs.one),
    ]),
    documentation: "Checks whether the scoped country may assign a ship role to a ship size.",
  }),

  // waystation_network_stockpile_used - Checks max stockpile usage across all
  // waystations in the network (0.0 to 1.0)
  // waystation_network_stockpile_used >= 0.5
  scriptCommand({
    id: "waystation_network_stockpile_used",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "==",
    value: scriptValue("number"),
    documentation: "Checks max stockpile usage across all waystations in the network (0.0 to 1.0)",
  }),

  // waystation_network_has_remote_collection - Checks if any waystation in the
  // network has remote stockpile collection capability
  // waystation_network_has_remote_collection = yes
  scriptCommand({
    id: "waystation_network_has_remote_collection",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: primitive("boolean"),
    documentation: "Checks if any waystation in the network has remote stockpile collection capability",
  }),

  // fallen_empire_strength_scale - Checks Fallen / Awakened Empire strength
  // scaling in game setup
  // The dump prints no usage line for this one, so the value is left open.
  scriptCommand({
    id: "fallen_empire_strength_scale",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "==",
    value: anyValue(),
    documentation: "Checks Fallen / Awakened Empire strength scaling in game setup",
  }),

  // trade_action_value - Returns the negotiated value (0 to 1) of a trade action
  // in a trade deal with the specified empire. with_country is required.
  // trade_action_value = { action = <action_key> with_country = <other_country_scope> value >=< 0.5 }
  scriptCommand({
    id: "trade_action_value",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: block([
      field("action", primitive("scalar"), occurs.one),
      field("with_country", scopeRef(ScopeId.Country), occurs.one),
      field("value", scriptValue("number"), occurs.one, { operator: "==" }),
    ]),
    documentation:
      "Returns the negotiated value (0 to 1) of a trade action in a trade deal with the specified empire. with_country is required.",
  }),

  // has_mission_flag - Checks if the mission has a specific flag
  // has_mission_flag = <flag>
  scriptCommand({
    id: "has_mission_flag",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: primitive("scalar"),
    documentation: "Checks if the mission has a specific flag",
  }),

  // is_being_surveyed - Checks if any fleet of the given fleet's controller
  // (other than the given fleet itself) is currently executing a survey order
  // targeting this planet/deposit holder.
  // is_being_surveyed = { who = <fleet> }
  scriptCommand({
    id: "is_being_surveyed",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: block([field("who", scopeRef(ScopeId.Fleet), occurs.one)]),
    documentation:
      "Checks if any fleet of the given fleet's controller (other than the given fleet itself) is currently executing a survey order targeting this planet/deposit holder.",
  }),

  // has_ethos - Checks if a country or a pop group ethos contains all ethics of
  // the other target ethos
  // has_ethos = <target>
  scriptCommand({
    id: "has_ethos",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: scopeRef(),
    documentation: "Checks if a country or a pop group ethos contains all ethics of the other target ethos",
  }),

  // used_stockpile_capacity_percentage - Checks the used percentage (0.00-1.00)
  // of the ship's or starbase's local stockpile capacity.
  // used_stockpile_capacity_percentage > 0.5
  scriptCommand({
    id: "used_stockpile_capacity_percentage",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "==",
    value: scriptValue("number"),
    documentation: "Checks the used percentage (0.00-1.00) of the ship's or starbase's local stockpile capacity.",
  }),

  // pop_ethic_percentage - Checks the amount or percentage of pops following or
  // not following the ethic. If used rhs this return percentage of pops.
  // pop_ethic_percentage = {
  //   amount ><= <value>/<variable> OR percentage ><= <value>/<variable>
  //   ethic = <key> OR ethic != <key>
  // }
  scriptCommand({
    id: "pop_ethic_percentage",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: block([
      field("amount", scriptValue("number"), occurs.optional, { operator: "==" }),
      field("percentage", scriptValue("number"), occurs.optional, { operator: "==" }),
      field("ethic", typeRef("ethos"), occurs.one, { operator: "==" }),
    ]),
    documentation:
      "Checks the amount or percentage of pops following or not following the ethic. If used rhs this return percentage of pops.",
  }),

  // is_mission_type - Returns true if the scoped mission is of type <type>
  // is_mission_type = <type>
  scriptCommand({
    id: "is_mission_type",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: primitive("scalar"),
    documentation: "Returns true if the scoped mission is of type <type>",
  }),

  // used_starbase_capacity - Checks the country's used starbase capacity in
  // absolute numbers
  // used_starbase_capacity = 15
  scriptCommand({
    id: "used_starbase_capacity",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: scriptValue("integer"),
    documentation: "Checks the country's used starbase capacity in absolute numbers",
  }),

  // count_visible_contracts - Count all contracts visible to the scoped country
  // (ie available and in progress)
  // count_visible_contracts >= 3
  scriptCommand({
    id: "count_visible_contracts",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "==",
    value: scriptValue("integer"),
    documentation: "Count all contracts visible to the scoped country (ie available and in progress)",
  }),

  // count_contracts_in_progress - Count all contracts currently in progress by
  // the scoped country
  // count_contracts_in_progress >= 3
  scriptCommand({
    id: "count_contracts_in_progress",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "==",
    value: scriptValue("integer"),
    documentation: "Count all contracts currently in progress by the scoped country",
  }),

  // has_civilian_job_category - Checks if the job or the pop group has the one
  // of the civilian pop categories
  // has_civilian_job_category = yes
  scriptCommand({
    id: "has_civilian_job_category",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: primitive("boolean"),
    documentation: "Checks if the job or the pop group has the one of the civilian pop categories",
  }),

  // num_claims_on_system - Counts the number of claims the scoped empire has on
  // the target system
  // num_claims_on_system = { Target = FROM Count >= 1 }
  scriptCommand({
    id: "num_claims_on_system",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: block([
      field("Target", scopeRef(ScopeId.System), occurs.one),
      field("Count", scriptValue("integer"), occurs.one, { operator: "==" }),
    ]),
    documentation: "Counts the number of claims the scoped empire has on the target system",
  }),

  // hostile_military_power - Returns the hostile military power in the system
  // (galactic_object scope) as perceived by the given country, optionally
  // multiplied by ENEMY_FLEET_POWER_MULT as a safety buffer.
  // hostile_military_power = { who = root safety_buffer = yes value > 5000 }
  scriptCommand({
    id: "hostile_military_power",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: block([
      field("who", scopeRef(ScopeId.Country), occurs.one),
      field("safety_buffer", primitive("boolean"), occurs.optional),
      field("value", scriptValue("number"), occurs.one, { operator: "==" }),
    ]),
    documentation:
      "Returns the hostile military power in the system (galactic_object scope) as perceived by the given country, optionally multiplied by ENEMY_FLEET_POWER_MULT as a safety buffer.",
  }),

  // has_automation_setting - Checks whether the given automation setting is
  // active for this fleet. Only valid during automated target selection.
  // has_automation_setting = waystation_systems
  scriptCommand({
    id: "has_automation_setting",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: primitive("scalar"),
    documentation:
      "Checks whether the given automation setting is active for this fleet. Only valid during automated target selection (an action's ai.weight or possible block).",
  }),

  // has_overclock_cooldown - Checks whether the scoped megastructure is still
  // inside its overclock_cooldown and so cannot change mode yet.
  // has_overclock_cooldown = yes/no
  scriptCommand({
    id: "has_overclock_cooldown",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: primitive("boolean"),
    documentation:
      "Checks whether the scoped megastructure is still inside its overclock_cooldown and so cannot change mode yet.",
  }),

  // count_owned_mission - Iterate through each mission a country has
  scriptCommand({
    id: "count_owned_mission",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: anyValue(),
    documentation: "Iterate through each mission a country has",
  }),

  // count_issued_mission - Iterate through each mission that the current country
  // has issued
  scriptCommand({
    id: "count_issued_mission",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: anyValue(),
    documentation: "Iterate through each mission that the current country has issued",
  }),

  // count_owned_contract - Iterate through each contract a country has
  scriptCommand({
    id: "count_owned_contract",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: anyValue(),
    documentation: "Iterate through each contract a country has",
  }),

  // any_controlled_colony - Iterate through each colony controlled by the
  // current empire
  scriptCommand({
    id: "any_controlled_colony",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: anyValue(),
    documentation: "Iterate through each colony controlled by the current empire",
  }),

  // count_controlled_colony - Iterate through each colony controlled by the
  // current empire
  scriptCommand({
    id: "count_controlled_colony",
    family: "trigger",
    input: unspecifiedScope(),
    operator: "=",
    value: anyValue(),
    documentation: "Iterate through each colony controlled by the current empire",
  }),

  // set_mission_flag - Sets an arbitrarily-named flag on the scoped mission
  // set_mission_flag = <key>
  scriptCommand({
    id: "set_mission_flag",
    family: "effect",
    input: unspecifiedScope(),
    operator: "=",
    value: primitive("scalar"),
    documentation: "Sets an arbitrarily-named flag on the scoped mission",
  }),

  // remove_mission_flag - Removes a flag from the scoped mission
  // remove_mission_flag = <key>
  scriptCommand({
    id: "remove_mission_flag",
    family: "effect",
    input: unspecifiedScope(),
    operator: "=",
    value: primitive("scalar"),
    documentation: "Removes a flag from the scoped mission",
  }),

  // add_resource_to_local_stockpile - Adds specific resources to a ship's
  // stockpile (ship must be able to collect resources; will not add resources
  // above capacity)
  // add_resource_to_local_stockpile = {
  //   <resource_name_1> = <value_1>
  //   mult = <variable> (optional: multiplies all gained resources by a variable)
  // }
  scriptCommand({
    id: "add_resource_to_local_stockpile",
    family: "effect",
    input: unspecifiedScope(),
    operator: "=",
    value: block([
      field(typeKey("resource"), scriptValue("number"), occurs.oneOrMore),
      field("mult", scriptValue("number"), occurs.optional),
    ]),
    documentation:
      "Adds specific resources to a ship's stockpile (ship must be able to collect resources; will not add resources above capacity)",
  }),

  // transfer_carrier - Transfer the colony to another carrier
  // transfer_carrier = { source = <source colony/carrier> target = <target carrier>
  //   transfer_ownership = yes/no transfer_controller = yes/no merge_pops = yes/no
  //   destroy_colony = yes/no }
  scriptCommand({
    id: "transfer_carrier",
    family: "effect",
    input: unspecifiedScope(),
    operator: "=",
    value: block([
      field("source", scopeRef(), occurs.one),
      field("target", scopeRef(), occurs.one),
      field("transfer_ownership", primitive("boolean"), occurs.optional),
      field("transfer_controller", primitive("boolean"), occurs.optional),
      field("merge_pops", primitive("boolean"), occurs.optional),
      field("destroy_colony", primitive("boolean"), occurs.optional),
    ]),
    documentation: "Transfer the colony to another carrier",
  }),

  // create_sector - Creates a sector with the scoped colony as capital, if it's
  // not already within a sector
  // create_sector = yes
  scriptCommand({
    id: "create_sector",
    family: "effect",
    input: unspecifiedScope(),
    operator: "=",
    value: primitive("boolean"),
    documentation: "Creates a sector with the scoped colony as capital, if it's not already within a sector",
  }),

  // force_show_espionage - Forces the diplomacy view to open for the scoped
  // country targeted at the given country, on the espionage tab.
  // force_show_espionage = <target country>
  scriptCommand({
    id: "force_show_espionage",
    family: "effect",
    input: unspecifiedScope(),
    operator: "=",
    value: scopeRef(ScopeId.Country),
    documentation:
      "Forces the diplomacy view to open for the scoped country targeted at the given country, on the espionage tab.",
  }),

  // pop_force_transfer_ethic - Transfers an amount of pops from an ethic to
  // another
  // pop_force_transfer_ethic = { new_ethic = <key> old_ethic = <key>
  //   amount = <amount> OR percentage = <percentage> random = <number> }
  scriptCommand({
    id: "pop_force_transfer_ethic",
    family: "effect",
    input: unspecifiedScope(),
    operator: "=",
    value: block([
      field("new_ethic", typeRef("ethos"), occurs.one),
      field("old_ethic", typeRef("ethos"), occurs.one),
      field("amount", scriptValue("number"), occurs.optional),
      field("percentage", scriptValue("number"), occurs.optional),
      field("random", primitive("number"), occurs.optional),
    ]),
    documentation: "Transfers an amount of pops from an ethic to another",
  }),

  // set_overclock - Switches the scoped megastructure to an overclock mode,
  // replacing the current one.
  // set_overclock = <overclock_type>
  // set_overclock = { overclock = <overclock_type> cooldown = yes/no }
  scriptCommand({
    id: "set_overclock",
    family: "effect",
    input: unspecifiedScope(),
    operator: "=",
    value: oneOf(
      typeRef("mega_overclock"),
      block([
        field("overclock", typeRef("mega_overclock"), occurs.one),
        field("cooldown", primitive("boolean"), occurs.optional),
      ]),
    ),
    documentation:
      "Switches the scoped megastructure to an overclock mode, replacing the current one. Ignores potential, possible and cost, but starts the megastructure's overclock_cooldown unless told otherwise.",
  }),

  // The iterators, open like their siblings.
  ...[
    ["ordered_owned_mission", "Iterate through each mission a country has"],
    ["every_owned_mission", "Iterate through each mission a country has"],
    ["random_issued_mission", "Iterate through each mission that the current country has issued"],
    ["ordered_issued_mission", "Iterate through each mission that the current country has issued"],
    ["ordered_owned_contract", "Iterate through each contract a country has"],
    ["ordered_system_planet_colony", "Iterate through each planet colony in the current system"],
    ["ordered_system_ship_colony", "Iterate through each ship colony in the current system"],
    ["random_controlled_colony", "Iterate through each colony controlled by the current empire"],
    ["ordered_controlled_colony", "Iterate through each colony controlled by the current empire"],
    ["every_controlled_colony", "Iterate through each colony controlled by the current empire"],
    [
      "random_starbase_in_network",
      "Iterate through every starbase in the same waystation network as the scoped starbase.",
    ],
    [
      "ordered_starbase_in_network",
      "Iterate through every starbase in the same waystation network as the scoped starbase.",
    ],
    [
      "every_starbase_in_network",
      "Iterate through every starbase in the same waystation network as the scoped starbase.",
    ],
  ].map(([id = "", documentation = ""]) =>
    scriptCommand({
      id,
      family: "effect",
      input: unspecifiedScope(),
      operator: "=",
      value: anyValue(),
      documentation,
    }),
  ),
];

/**
 * Commands the game no longer has.
 *
 * Each is in the 4.4.6 dumps and absent from the 4.5.1 ones, and 4.5.2 vanilla
 * writes it nowhere but in comments. The corpus still declares them, so without
 * this a mod written against 4.4 would check clean and then do nothing: the game
 * drops an unknown trigger or effect with a line in error.log and nothing else.
 */
export const retiredCommands: readonly { readonly id: string; readonly family: string; readonly reason: string }[] = [
  {
    id: "check_pop_faction_parameter",
    family: "trigger",
    reason: "no pop faction type has `parameters` any more",
  },
  {
    id: "pop_has_ethic",
    family: "trigger",
    reason: "the dump documents `pop_ethic_amount` and `pop_ethic_percentage` in its place",
  },
  {
    id: "pop_group_has_ethic",
    family: "trigger",
    reason: "the dump documents `pop_ethic_amount` and `pop_ethic_percentage` in its place",
  },
  { id: "pop_event", family: "effect", reason: "vanilla's last uses are commented out" },
];

/** The commands without the ones the game no longer has. */
export function withoutRetiredCommands(
  commands: readonly ScriptCommandDefinition[],
): readonly ScriptCommandDefinition[] {
  return commands.filter(
    (command) => !retiredCommands.some((retired) => retired.id === command.id && retired.family === command.family),
  );
}
