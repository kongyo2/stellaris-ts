import { ScopeId } from "./catalog.js";
import { listedScopes } from "./ir.js";
import type { ScriptCommandDefinition } from "./ir.js";
import { effectScopes, triggerScopes } from "./scope-constraints.js";

const KNOWN_SCOPES: ReadonlySet<string> = new Set(Object.values(ScopeId));

function asScopeIds(names: readonly string[]): readonly ScopeId[] {
  // The dump names scopes as text; only the ones the catalog knows are kept, so
  // a rename upstream drops a constraint rather than fabricating a scope.
  return Object.values(ScopeId).filter((scope) => names.includes(scope) && KNOWN_SCOPES.has(scope));
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
    const scopes: readonly string[] | undefined = table[command.id];

    if (scopes === undefined || scopes.length === 0) {
      return command;
    }

    const resolved: readonly ScopeId[] = asScopeIds(scopes);

    return resolved.length === 0 ? command : { ...command, input: listedScopes(...resolved) };
  });
}
