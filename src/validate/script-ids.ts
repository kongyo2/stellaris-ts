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
 *
 * The base game writes each of its 322 ids once, or with a parameter in it
 * (`$EVENT_ID$.trigger`), which makes every copy's id its own.
 */

export interface ScriptedDefinition {
  readonly id: string;
  readonly type: string;
  readonly body: LoadBlock;
}

export interface ScriptIdFinding {
  readonly definition: string;
  readonly path: string;
  readonly message: string;
}

const SCRIPTED: ReadonlySet<string> = new Set(["scripted_effect", "scripted_trigger"]);

/** How often each key is written in a block, at any depth. */
function countKeys(block: LoadBlock, into: Map<string, number>): void {
  for (const entry of block.entries) {
    if (entry.key !== undefined) {
      into.set(entry.key, (into.get(entry.key) ?? 0) + 1);
    }
    if (entry.value.kind === "block") {
      countKeys(entry.value, into);
    }
  }
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

/**
 * How many copies of each scripted effect and trigger the game builds: one for
 * each call from a definition that is read once, and one for each copy of a
 * scripted effect that calls it.
 */
function copiesOf(definitions: readonly ScriptedDefinition[]): {
  readonly copies: (id: string) => number;
  readonly callers: (id: string) => readonly string[];
} {
  const scripted = new Map<string, ScriptedDefinition>();
  for (const definition of definitions) {
    if (SCRIPTED.has(definition.type)) {
      scripted.set(definition.id, definition);
    }
  }

  // caller -> callee -> how often the caller writes the callee's name as a key
  const calls = new Map<string, Map<string, number>>();
  const callers = new Map<string, Set<string>>();
  const direct = new Map<string, number>();

  for (const definition of definitions) {
    const keys = new Map<string, number>();
    countKeys(definition.body, keys);

    for (const [key, count] of keys) {
      if (!scripted.has(key) || (SCRIPTED.has(definition.type) && key === definition.id)) {
        continue;
      }
      const named: Set<string> = callers.get(key) ?? new Set<string>();
      named.add(definition.id);
      callers.set(key, named);

      if (SCRIPTED.has(definition.type)) {
        const bucket: Map<string, number> = calls.get(definition.id) ?? new Map<string, number>();
        bucket.set(key, (bucket.get(key) ?? 0) + count);
        calls.set(definition.id, bucket);
      } else {
        direct.set(key, (direct.get(key) ?? 0) + count);
      }
    }
  }

  const known = new Map<string, number>();
  const visiting = new Set<string>();

  const copies = (id: string): number => {
    const cached: number | undefined = known.get(id);
    if (cached !== undefined) {
      return cached;
    }
    // One that calls itself is read once here: what the game makes of it is
    // not a count.
    if (visiting.has(id)) {
      return 0;
    }
    visiting.add(id);

    let total: number = direct.get(id) ?? 0;
    for (const [caller, callees] of calls) {
      const count: number | undefined = callees.get(id);
      if (count !== undefined) {
        total += count * copies(caller);
      }
    }

    visiting.delete(id);
    const definition: ScriptedDefinition | undefined = scripted.get(id);
    // `optimize_memory`: one copy for each set of arguments, taken here as one.
    const built: number = definition !== undefined && optimisesMemory(definition.body) ? Math.min(total, 1) : total;
    known.set(id, built);
    return built;
  };

  return { copies, callers: (id: string): readonly string[] => [...(callers.get(id) ?? [])].sort() };
}

function someOf(names: readonly string[]): string {
  const shown: readonly string[] = names.slice(0, 3);
  return names.length > shown.length
    ? `${shown.join(", ")} and ${String(names.length - shown.length)} more`
    : shown.join(", ");
}

export function scriptIdFindings(
  definitions: readonly ScriptedDefinition[],
  vanillaIds: { readonly trigger: readonly string[]; readonly effect: readonly string[] },
): readonly ScriptIdFinding[] {
  const { copies, callers } = copiesOf(definitions);
  const sites = new Map<string, Site[]>();

  for (const definition of definitions) {
    const inScripted: boolean = SCRIPTED.has(definition.type);

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
        copies: inScripted ? copies(definition.id) : 1,
        scripted: inScripted ? definition.id : undefined,
        callers: inScripted ? callers(definition.id) : [],
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
          ? ` Put a parameter in the id so that each copy has its own, id = "${first.id}_$WHO$", or write optimize_memory at the top of ${site.scripted}: the game then keeps one copy for each set of arguments and gives it to every call that passes the same.`
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
