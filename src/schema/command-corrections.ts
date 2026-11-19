import { EnumId, ScopeId } from "./catalog.js";
import { block, enumRef, field, literal, occurs, oneOf, scopeRef } from "./ir.js";
import type { EntryRule, FieldRule, RuleSetDefinition, ScriptCommandDefinition, ValueRule } from "./ir.js";

/**
 * Where a command reads something other than its ported rule says.
 *
 * Kept apart from `commands.ts`, which the importer wrote and may write
 * again, and from `vanilla-commands.ts`, which `propose:commands` writes: a
 * correction made in either is one regeneration from gone. Each says what it
 * was read from.
 */

/** The fields of a block rule, each put through `change`; any other rule as it is. */
function withFields(value: ValueRule, change: (rule: FieldRule) => readonly EntryRule[]): ValueRule {
  return value.kind !== "block"
    ? value
    : block(value.entries.flatMap((entry) => (entry.kind === "field" ? change(entry) : [entry])));
}

/**
 * The commands that take one of the words of `common/component_tags`.
 *
 * The game's own documentation of the trigger says what the word is — "Checks
 * if the country's AI prefers weapons using this component tag" — and the
 * rule for `is_preferred_weapons` already read it so; its five siblings were
 * proposed from the dumps, which show one example value, and took any word.
 * `set_ai_weapon_preference = weapon_type_kinetik` names no tag, and a
 * preference for a tag no component carries prefers nothing.
 */
const COMPONENT_TAG_COMMANDS: ReadonlySet<string> = new Set([
  "is_preferred_platform_weapons",
  "is_preferred_starbase_weapons",
  "set_ai_platform_weapon_preference",
  "set_ai_starbase_weapon_preference",
  "set_ai_weapon_preference",
]);

export function withCommandCorrections(
  commands: readonly ScriptCommandDefinition[],
): readonly ScriptCommandDefinition[] {
  return commands.flatMap((command): readonly ScriptCommandDefinition[] => {
    if (COMPONENT_TAG_COMMANDS.has(command.id)) {
      return [{ ...command, value: enumRef(EnumId.ComponentTags) }];
    }

    // "Use in_place_of instead of orbit_X / random_pos to use the location of
    // an existing spatial object", says the game's documentation of the
    // effect, and the base game writes `in_place_of = star`: a planet. The
    // ported rule took a system only.
    if (command.id === "spawn_natural_wormhole") {
      return [
        {
          ...command,
          value: withFields(command.value, (rule) =>
            rule.key === "in_place_of" ? [{ ...rule, value: scopeRef() }] : [rule],
          ),
        },
      ];
    }

    // The base game destroys a starbase's fleet from its ship, `ship = {
    // destroy_fleet = this }`, twice in `nomads_effects.txt`; and where the
    // executable has "target is not a fleet" for `destroy_fleet_naval_cap`, it
    // has only "has invalid target" for this one. A ship is taken here as
    // well as a fleet, so the kind of its target is not judged: what the game
    // makes of a ship there is not decoded.
    if (
      command.id === "destroy_fleet" &&
      command.family === "effect" &&
      command.value.kind === "scope-reference" &&
      command.value.scope === ScopeId.Fleet
    ) {
      return [{ ...command, value: oneOf(scopeRef(ScopeId.Fleet), scopeRef(ScopeId.Ship)) }];
    }

    return [command];
  });
}

/**
 * The fleet actions, as the executable's own reader of each takes them.
 *
 * The factory of fleet actions (`0xe8a640` in 4.5.2) switches on nineteen
 * words. Three of them the ported rules never had: `find_planet`,
 * `find_system` and `find_fleet` build the object `find_closest_…` builds,
 * with the same reader (`0xe8d300`, `0xe8eae0`, `0xe902c0`). Each of those
 * readers also takes `method = closest` or `method = random`, which is all
 * that tells `find_random_…` from the rest. And the reader of
 * `change_stance` (`0xe92920`) takes `fleet_stance` and `days`: the `stance`
 * of the ported rule is a word it has no case for, an `Unexpected token` in
 * the log.
 */
const FINDERS: Readonly<Record<string, string>> = {
  find_closest_fleet: "find_fleet",
  find_closest_planet: "find_planet",
  find_closest_system: "find_system",
};

const FOUND_BY_METHOD: ReadonlySet<string> = new Set([
  "find_closest_fleet",
  "find_closest_planet",
  "find_closest_system",
  "find_random_fleet",
  "find_random_planet",
  "find_random_system",
]);

export function withRuleSetCorrections(ruleSets: readonly RuleSetDefinition[]): readonly RuleSetDefinition[] {
  return ruleSets.flatMap((rule): readonly RuleSetDefinition[] => {
    if (rule.family !== "fleet_action" || rule.name === undefined) {
      return [rule];
    }

    if (rule.name === "change_stance") {
      return [
        {
          ...rule,
          value: withFields(rule.value, (entry) =>
            entry.key === "stance" ? [{ ...entry, key: "fleet_stance" }] : [entry],
          ),
        },
      ];
    }

    if (!FOUND_BY_METHOD.has(rule.name) || rule.value.kind !== "block") {
      return [rule];
    }

    const read: RuleSetDefinition = {
      ...rule,
      value: block([
        ...rule.value.entries,
        field("method", oneOf(literal("closest"), literal("random")), occurs.optional),
      ]),
    };
    const alias: string | undefined = FINDERS[rule.name];

    return alias === undefined ? [read] : [read, { ...read, name: alias }];
  });
}
