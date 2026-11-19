import type { LoadBlock } from "../schema/load-checks.js";
import { fleetActionFacts, optimisesMemory, type ScriptId } from "../schema/load-facts.js";

/**
 * An `id` registered more than once.
 *
 * A trigger block that writes `id = "x"` is entered in a table of the whole
 * game under that name as it is read (`0x347410` in the 4.5.2 executable; an
 * effect block likewise, `0x3a97f0`), and a second block of the same name is
 * logged as `A trigger with id = "x" already exist. id has to be unique`
 * (`trigger.cpp:242`) and left out of the table. The triggers and effects of
 * a fleet action are the ones that must have one, so that is where an id is
 * written, and written twice.
 *
 * Twice is easier than it looks. A scripted effect is not read into effects
 * when the game loads it: it is kept as text and built anew at every place
 * that calls it (`0x16df490`), so an id written once inside one is registered
 * once for each call — and a scripted effect that calls it is itself built
 * once for each of its own calls. Unless the scripted effect says
 * `optimize_memory`: then the game keeps the copy it built, by the arguments
 * it was called with, and hands the same one to every call that passes the
 * same (the branch at `0x16df4c7`, on the flag the reader sets at `0xafe89c`).
 * A call that passes other arguments still gets a copy of its own.
 *
 * A call is a key the walk of a definition resolved as one: the name of a
 * scripted effect where effects are read, of a scripted trigger where
 * triggers are. A key that merely spells the same — `weight` inside an
 * `ai_weight`, beside a scripted effect someone called `weight` — calls
 * nothing.
 *
 * The base game writes each of its 322 ids once, or with a parameter in it
 * (`$EVENT_ID$.trigger`), which makes every copy's id its own.
 */

export interface ScriptedDefinition {
  readonly id: string;
  readonly type: string;
  readonly body: LoadBlock;
}

/** One call of a scripted effect or trigger, as the walk of a definition found it. */
export interface ScriptedCall {
  /** `effect:id` or `trigger:id` of what is called. */
  readonly callee: string;
  /** The same of the scripted effect or trigger the call is written in; none for a definition read once. */
  readonly caller: string | undefined;
  /** The definition the call is written in, for a message. */
  readonly callerName: string;
  /** The arguments passed, as one string: two calls with the same arguments have the same one. */
  readonly arguments: string;
}

export interface ScriptIdFinding {
  readonly definition: string;
  readonly path: string;
  readonly message: string;
}

interface Site extends ScriptId {
  readonly definition: string;
  /** How many copies of the block the game reads. */
  readonly copies: number;
  /** The scripted effect or trigger it is written in, when it is in one. */
  readonly scripted: string | undefined;
  /** The definitions that call it, for a message. */
  readonly callers: readonly string[];
}

function keyOf(definition: ScriptedDefinition): string | undefined {
  return definition.type === "scripted_effect"
    ? `effect:${definition.id}`
    : definition.type === "scripted_trigger"
      ? `trigger:${definition.id}`
      : undefined;
}

/**
 * How many copies of each scripted effect and trigger the game builds: one for
 * each call from a definition that is read once, and one for each copy of a
 * scripted effect that calls it — or, for one that says `optimize_memory`,
 * one for each set of arguments it is called with.
 */
function copiesOf(
  definitions: readonly ScriptedDefinition[],
  calls: readonly ScriptedCall[],
): {
  readonly copies: (key: string) => number;
  readonly callers: (key: string) => readonly string[];
} {
  const optimised = new Set<string>();
  for (const definition of definitions) {
    const key: string | undefined = keyOf(definition);
    if (key !== undefined && optimisesMemory(definition.body)) {
      optimised.add(key);
    }
  }

  const callsOf = new Map<string, ScriptedCall[]>();
  for (const call of calls) {
    // One that calls itself is read once: what the game makes of it is no count.
    if (call.caller === call.callee) {
      continue;
    }
    const bucket: ScriptedCall[] = callsOf.get(call.callee) ?? [];
    bucket.push(call);
    callsOf.set(call.callee, bucket);
  }

  const known = new Map<string, number>();
  const visiting = new Set<string>();

  const copies = (key: string): number => {
    const cached: number | undefined = known.get(key);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(key)) {
      return 0;
    }
    visiting.add(key);

    let total = 0;
    const passed = new Set<string>();
    for (const call of callsOf.get(key) ?? []) {
      const built: number = call.caller === undefined ? 1 : copies(call.caller);
      total += built;
      if (built > 0) {
        passed.add(call.arguments);
      }
    }

    visiting.delete(key);
    const built: number = optimised.has(key) ? passed.size : total;
    known.set(key, built);
    return built;
  };

  return {
    copies,
    callers: (key: string): readonly string[] =>
      [...new Set((callsOf.get(key) ?? []).map((call) => call.callerName))].sort(),
  };
}

function someOf(names: readonly string[]): string {
  const shown: readonly string[] = names.slice(0, 3);
  return names.length > shown.length
    ? `${shown.join(", ")} and ${String(names.length - shown.length)} more`
    : shown.join(", ");
}

export function scriptIdFindings(
  definitions: readonly ScriptedDefinition[],
  calls: readonly ScriptedCall[],
  vanillaIds: { readonly trigger: readonly string[]; readonly effect: readonly string[] },
): readonly ScriptIdFinding[] {
  const { copies, callers } = copiesOf(definitions, calls);
  const sites = new Map<string, Site[]>();

  for (const definition of definitions) {
    const scriptedKey: string | undefined = keyOf(definition);
    const inScripted: boolean = scriptedKey !== undefined;

    for (const registered of fleetActionFacts(definition.body).ids) {
      // A parameter in the id makes each copy's its own, and `@x` is a value
      // only the game can work out.
      if (registered.id.includes("$") || registered.id.startsWith("@") || registered.id.length === 0) {
        continue;
      }
      const key: string = `${registered.family}\t${registered.id}`;
      const bucket: Site[] = sites.get(key) ?? [];
      bucket.push({
        ...registered,
        definition: definition.id,
        copies: scriptedKey === undefined ? 1 : copies(scriptedKey),
        scripted: inScripted ? definition.id : undefined,
        callers: scriptedKey === undefined ? [] : callers(scriptedKey),
      });
      sites.set(key, bucket);
    }
  }

  const findings: ScriptIdFinding[] = [];

  for (const bucket of sites.values()) {
    const first: Site | undefined = bucket[0];
    if (first === undefined) {
      continue;
    }

    const family: "effect" | "trigger" = first.family;
    const inVanilla: boolean = vanillaIds[family].includes(first.id);
    const total: number = bucket.reduce((sum, site) => sum + site.copies, 0) + (inVanilla ? 1 : 0);

    if (total < 2) {
      continue;
    }

    const logged: string = `${family === "trigger" ? "A trigger" : "An effect"} with id = "${first.id}" already exist. id has to be unique`;

    for (const site of bucket) {
      if (site.copies === 0) {
        continue;
      }

      const others: readonly Site[] = bucket.filter((other) => other !== site);
      const reasons: string[] = [];

      if (inVanilla) {
        reasons.push(`the base game has ${family === "trigger" ? "a trigger" : "an effect"} of this id`);
      }
      if (others.length > 0) {
        reasons.push(
          `it is also written in ${someOf(others.map((other) => (other.definition === site.definition ? `${other.definition} at ${other.path}` : other.definition)))}`,
        );
      }
      if (site.scripted !== undefined && site.copies > 1) {
        reasons.push(
          `${site.scripted} is built anew at each place that calls it, ${String(site.copies)} of them (from ${someOf(site.callers)}), and each copy registers the id`,
        );
      }

      const remedy: string =
        site.scripted !== undefined && site.copies > 1
          ? ` Put a parameter in the id so that each copy has its own, id = "${first.id}_$WHO$", or write optimize_memory at the top of ${site.scripted}: the game then keeps one copy for each set of arguments and gives it to every call that passes the same — one copy in all, where every call passes the same.`
          : " Give each one a name of its own.";

      findings.push({
        definition: site.definition,
        path: site.path,
        message: `id = "${first.id}" is registered more than once: ${reasons.join("; ")}. The game keeps every ${family} with an id in one table for the whole game, and logs "${logged}" for each one after the first, which a saved game then cannot find.${remedy}`,
      });
    }
  }

  return findings;
}
