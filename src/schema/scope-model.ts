import { ScopeId } from "./catalog.js";
import { listedScopes } from "./ir.js";
import type { ScriptCommandDefinition } from "./ir.js";
import { effectScopes, triggerScopes } from "./scope-constraints.js";
import { additionalEffectScopes, additionalTriggerScopes } from "./vanilla-scope-constraints.js";

const KNOWN_SCOPES: ReadonlySet<string> = new Set(Object.values(ScopeId));

/**
 * The catalog's ids for the scopes a command accepts, or `undefined` when the
 * catalog lacks one of them.
 *
 * Keeping the known names and dropping the rest would narrow the command to
 * what is left. That is how `colony`, which the dumps list for 250 commands
 * in 4.4 and 256 in 4.5.1, went missing from every one of them while the
 * catalog did not have it: `any_moon` (`colony planet ship`) read as
 * planet-or-ship. A constraint that cannot be stated whole is not applied, so a
 * rename upstream loosens a command rather than rejecting script the game
 * accepts.
 */
function asScopeIds(names: readonly string[]): readonly ScopeId[] | undefined {
  if (names.some((name) => !KNOWN_SCOPES.has(name))) {
    return undefined;
  }

  return Object.values(ScopeId).filter((scope) => names.includes(scope));
}

/**
 * Applies the scopes the game itself documents.
 *
 * The ported corpus constrains none of the 2,328 scripted commands, so without
 * this every trigger would be offered in every scope and the scope-typed
 * surface would prove nothing. A command the dump does not mention stays
 * unconstrained: silence there means "not documented", not "nowhere legal".
 */
export function withScopeConstraints(commands: readonly ScriptCommandDefinition[]): readonly ScriptCommandDefinition[] {
  return commands.map((command) => {
    if (command.family !== "trigger" && command.family !== "effect") {
      return command;
    }

    const table: Readonly<Record<string, readonly string[]>> =
      command.family === "trigger" ? triggerScopes : effectScopes;
    const extra: Readonly<Record<string, readonly string[]>> =
      command.family === "trigger" ? additionalTriggerScopes : additionalEffectScopes;
    const documented: readonly string[] | undefined = table[command.id];

    if (documented === undefined || documented.length === 0) {
      return command;
    }

    const scopes: readonly string[] = [...documented, ...(extra[command.id] ?? [])];

    const resolved: readonly ScopeId[] | undefined = asScopeIds(scopes);

    return resolved === undefined || resolved.length === 0 ? command : { ...command, input: listedScopes(...resolved) };
  });
}
