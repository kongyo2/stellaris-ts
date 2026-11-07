import type { ResolvedValue } from "./resolve.js";

/**
 * The on_actions the game fires with no scope at all.
 *
 * An event written `event = { … }` has no scope of its own: the 4.5.2
 * executable lets one fire on any scope, because its accepted-scope mask is
 * empty (`0x8e5f60` returns at once when the mask at `+0x70` is zero), and
 * its `root` is whatever fired it. `on_astral_rift_spawned` hands it the rift
 * that spawned — vanilla's `astral_planes.7` reads `solar_system.owner` from
 * there — so a generic event's `root` cannot be judged on its own.
 *
 * These eight hand it nothing. The yearly update (`0x261eb0`) builds a scope
 * whose type field is zero and fires the on_action table's `+0x30` to `+0x58`
 * with it, which the on_action reader (`0x3fa5c0`) fills from
 * `on_yearly_pulse`, `on_bi_yearly_pulse`, `on_five_year_pulse`,
 * `on_decade_pulse`, `on_mid_game_pulse` and `on_late_game_pulse`; the
 * `_country` slots after them get a country scope instead, type 4 and the
 * country's id. The monthly update fires `+0x28`, `on_monthly_pulse`, with a
 * scope the default constructor (`0x390ec0`) leaves empty, and the start of a
 * game fires `on_game_start` with an empty scope built inline (`0x2710d0`).
 *
 * An event that only these fire runs with `this`, `root`, `prev` and `from`
 * all empty, and a command that reads a scope reads nothing there.
 */
export const scopelessOnActions: readonly string[] = [
  "on_bi_yearly_pulse",
  "on_decade_pulse",
  "on_five_year_pulse",
  "on_game_start",
  "on_late_game_pulse",
  "on_mid_game_pulse",
  "on_monthly_pulse",
  "on_yearly_pulse",
];

/** The scope an event fired by one of {@link scopelessOnActions} runs in: none. */
export const NO_SCOPE = "none";

/**
 * Whether a scalar written under a key with these rules names a scope.
 *
 * `add_trust = { who = root }` names the country `root` is; written where
 * `root` is nothing, the effect has no one to add trust towards. Only when
 * every rule that could read a scalar takes a scope, as with the rules a
 * string's name is read from.
 */
export function namesScope(values: readonly ResolvedValue[]): boolean {
  let names = false;

  for (const value of values) {
    switch (value.kind) {
      case "block":
      case "script-block":
      case "scripted-call":
      case "list":
      case "rule-set-reference":
        continue;
      case "scope-reference":
      case "scope-group-reference":
        names = true;
        continue;
      default:
        return false;
    }
  }

  return names;
}

/**
 * Which on_actions fire each event, among the ones that list it.
 *
 * An event is fired with no scope only when nothing else fires it: every
 * reference to its id is one of these on_actions listing it, and no
 * `fire_on_action` fires one of them from somewhere with a scope. Any other
 * mention of the id — a `country_event = { id = … }`, a scripted on_action —
 * may hand it a scope this cannot see, and then nothing is said about it.
 */
export function scopelessEvents(
  listings: ReadonlyMap<string, readonly string[]>,
  mentions: ReadonlyMap<string, number>,
): ReadonlyMap<string, readonly string[]> {
  const scopeless: ReadonlySet<string> = new Set(
    scopelessOnActions.filter((onAction) => (mentions.get(onAction) ?? 0) === 0),
  );
  const firedBy = new Map<string, string[]>();
  const listedTimes = new Map<string, number>();

  for (const [onAction, events] of listings) {
    for (const event of events) {
      listedTimes.set(event, (listedTimes.get(event) ?? 0) + 1);
      if (scopeless.has(onAction)) {
        const by: string[] = firedBy.get(event) ?? [];
        if (!by.includes(onAction)) {
          by.push(onAction);
        }
        firedBy.set(event, by);
      }
    }
  }

  const result = new Map<string, readonly string[]>();

  for (const [event, by] of firedBy) {
    // Listed by another on_action as well, or named anywhere else: fired with a
    // scope this cannot see, or at least not only without one.
    const fromScopeless: number = [...listings]
      .filter(([onAction]) => scopeless.has(onAction))
      .reduce((total, [, events]) => total + events.filter((listed) => listed === event).length, 0);

    if ((listedTimes.get(event) ?? 0) === fromScopeless && (mentions.get(event) ?? 0) === 0) {
      result.set(event, [...by].sort());
    }
  }

  return result;
}
