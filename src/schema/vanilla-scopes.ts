import { ScopeId } from "./catalog.js";
import { fixedScopes, listedScopes } from "./ir.js";
import type { LinkDefinition, ScopeDefinition } from "./ir.js";

/**
 * Scopes and links the game has and the ported corpus does not.
 *
 * These live outside `scopes.ts` because `npm run import:cwt -- --emit` rewrites
 * that file wholesale. All three arrived in 4.4, after the 4.3.7 dump the
 * corpus was checked against: vanilla writes `colony = { ... }` and
 * `carrier = { ... }` as scope changes, and the 4.4.1 scope dump already has
 * `issuer` out of a mission.
 *
 * Each link's input and output are the ones the game's own scope dump prints
 * (4.5.1, `Supported Scopes` and `Output Scope`), not a guess. The other links
 * listed here are in the 4.4.1 dump too, except `home_colony` and
 * `background_colony`, which the 4.4.6 one added.
 */
export const vanillaScopes: readonly ScopeDefinition[] = [
  // vanilla 4.4.6: `carrier = { ... }`, `set_carrier_flag`, `carrier_event`.
  { id: "carrier", displayName: "Carrier", aliases: ["carrier"] },
  // vanilla 4.4.6: `colony = { ... }`, `colony.controller`, `any_owned_colony`.
  { id: "colony", displayName: "Colony", aliases: ["colony"] },
  // The dumps since 4.4.1: `issuer - Scopes from a mission to its issuer.`, and
  // the mission triggers and effects (`has_mission_flag`, `add_mission_counter`).
  { id: "mission", displayName: "Mission", aliases: ["mission"] },
];

export const vanillaLinks: readonly LinkDefinition[] = [
  // carrier - Scopes from a colony to its carrier.
  {
    kind: "scope-link",
    id: "carrier",
    input: listedScopes(ScopeId.Planet, ScopeId.Ship, ScopeId.Colony),
    output: fixedScopes(ScopeId.Planet),
  },
  // colony - Scopes from an object to its colony.
  {
    kind: "scope-link",
    id: "colony",
    input: listedScopes(
      ScopeId.Megastructure,
      ScopeId.Planet,
      ScopeId.Ship,
      ScopeId.PopGroup,
      ScopeId.Leader,
      ScopeId.Army,
      ScopeId.Starbase,
      ScopeId.Deposit,
      ScopeId.ArchaeologicalSite,
      ScopeId.Pop,
      ScopeId.PopJob,
      ScopeId.Colony,
    ),
    output: fixedScopes(ScopeId.Colony),
  },
  // ship - Scopes from a starbase to its station ship or from a colony to its
  // carrier ship.
  {
    kind: "scope-link",
    id: "ship",
    input: listedScopes(ScopeId.Planet, ScopeId.Ship, ScopeId.Starbase, ScopeId.Colony),
    output: fixedScopes(ScopeId.Ship),
  },
  // home_colony - Scopes to a species' home colony.
  {
    kind: "scope-link",
    id: "home_colony",
    input: listedScopes(ScopeId.Country, ScopeId.PopGroup, ScopeId.Leader, ScopeId.Species),
    output: fixedScopes(ScopeId.Colony),
  },
  // background_colony - Scopes from a leader to their background colony.
  {
    kind: "scope-link",
    id: "background_colony",
    input: listedScopes(ScopeId.Leader),
    output: fixedScopes(ScopeId.Colony),
  },
  // issuer - Scopes from a mission to its issuer.
  { kind: "scope-link", id: "issuer", input: listedScopes(ScopeId.Mission), output: fixedScopes(ScopeId.Country) },
  // first/second/third_damaging_country - Scopes to the country that dealt the
  // corresponding ranked damage to the fleet. Can be null.
  ...(["first", "second", "third"] as const).map((rank): LinkDefinition => ({
    kind: "scope-link",
    id: `${rank}_damaging_country`,
    input: listedScopes(ScopeId.Fleet),
    output: fixedScopes(ScopeId.Country),
  })),
  /**
   * `hidden:owner = { ... }` evaluates the block in that scope without showing
   * it in the tooltip. It is written where a scope is written, so it is a prefix
   * over one rather than a scope of its own.
   */
  { kind: "data-link", id: "hidden_scope", prefix: "hidden:", source: { kind: "scope-reference" } },
];
