import { anyScope, dynamicScope } from "./ir.js";
import type { LinkDefinition, ScopeDefinition } from "./ir.js";

/**
 * Scopes and links the game has and the ported corpus does not.
 *
 * These live outside `scopes.ts` because `npm run import:cwt -- --emit` rewrites
 * that file wholesale, and outside the `-debug` dumps because the newest dump is
 * 4.3.7 and these arrived in 4.4. The evidence is the installed game: vanilla
 * writes `colony = { ... }` and `carrier = { ... }` as scope changes and runs the
 * script that does.
 *
 * The input and output scopes are left unconstrained rather than guessed. A
 * scope the checker does not know rejects correct script; a scope constraint
 * invented here would reject correct script too, and less visibly.
 */
export const vanillaScopes: readonly ScopeDefinition[] = [
  // vanilla 4.4.6: `carrier = { ... }`, `set_carrier_flag`, `carrier_event`.
  { id: "carrier", displayName: "Carrier", aliases: ["carrier"] },
  // vanilla 4.4.6: `colony = { ... }`, `colony.controller`, `any_owned_colony`.
  { id: "colony", displayName: "Colony", aliases: ["colony"] },
];

export const vanillaLinks: readonly LinkDefinition[] = [
  { kind: "scope-link", id: "carrier", input: anyScope(), output: dynamicScope() },
  { kind: "scope-link", id: "colony", input: anyScope(), output: dynamicScope() },
  /**
   * `hidden:owner = { ... }` evaluates the block in that scope without showing
   * it in the tooltip. It is written where a scope is written, so it is a prefix
   * over one rather than a scope of its own.
   */
  { kind: "data-link", id: "hidden_scope", prefix: "hidden:", source: { kind: "scope-reference" } },
];
