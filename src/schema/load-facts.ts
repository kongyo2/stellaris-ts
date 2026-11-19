import type { LoadBlock, LoadEntry, LoadValue } from "./load-checks.js";

/**
 * What one definition says that a check of another definition asks about.
 *
 * A budget is unused when its category does not say `use_for_ai_budget`, a
 * policy option belongs to the policy it is written in, and a subplan replaces
 * the one of the same name in the plan it is read into: each of those is a
 * fact about one definition that decides what the game does with another.
 * Read here from a {@link LoadBlock}, which both the base game's files and a
 * mod's definition bodies convert to, so the index of the base game and the
 * check of a mod read the fact the same way.
 */

function entriesNamed(block: LoadBlock, key: string): readonly LoadEntry[] {
  const wanted: string = key.toLowerCase();
  return block.entries.filter((entry) => entry.key?.toLowerCase() === wanted);
}

function blocksNamed(block: LoadBlock, key: string): readonly LoadBlock[] {
  return entriesNamed(block, key).flatMap((entry) => (entry.value.kind === "block" ? [entry.value] : []));
}

function lastScalar(block: LoadBlock, key: string): string | undefined {
  const value: LoadValue | undefined = entriesNamed(block, key).at(-1)?.value;
  return value?.kind === "scalar" ? value.text : undefined;
}

/** The words a list holds: its values with no key, each a scalar. */
function words(block: LoadBlock): readonly string[] {
  return block.entries.flatMap((entry) =>
    entry.key === undefined && entry.value.kind === "scalar" ? [entry.value.text] : [],
  );
}

/** One subplan of an economic plan, as the plan's reader keeps it. */
export interface Subplan {
  /**
   * Its `set_name`, the empty string for a subplan that writes none: the
   * reader compares the names as they stand (`0xb52700` in the 4.5.2
   * executable), and two subplans with no name have the same one.
   */
  readonly name: string;
  /** The name is written in a way only the game can read: `@x`, `$PARAM$`. */
  readonly indirect: boolean;
}

/**
 * The subplans a plan writes at its own level, in written order.
 *
 * `undefined` when the plan holds script this cannot read through, since what
 * that adds is not known.
 */
export function subplansOf(plan: LoadBlock): readonly Subplan[] | undefined {
  if (plan.open) {
    return undefined;
  }

  const found: Subplan[] = [];

  for (const entry of entriesNamed(plan, "subplan")) {
    if (entry.value.kind !== "block" || entry.value.open) {
      return undefined;
    }
    const named: readonly LoadEntry[] = entriesNamed(entry.value, "set_name");
    const last: LoadValue | undefined = named.at(-1)?.value;
    if (last !== undefined && last.kind !== "scalar") {
      return undefined;
    }
    const name: string = last?.kind === "scalar" ? last.text : "";
    found.push({ name, indirect: name.startsWith("@") || name.includes("$") });
  }

  return found;
}

/** What an economic category says to the AI's budget, as its reader keeps it. */
export interface CategoryBudgetUse {
  /** `use_for_ai_budget = yes`, written in the category itself. */
  readonly budget: boolean;
  /** The resources `ai_use_parent_for_resources_expenditure` lists. */
  readonly parentExpenditure: readonly string[];
  /** The resources `ai_use_parent_for_resources_upkeep` lists. */
  readonly parentUpkeep: readonly string[];
}

/**
 * What a category says to the AI's budget.
 *
 * The flag is the category's own: the reader sets it from the category's
 * `use_for_ai_budget` (`0x1657f56`), the constructor clears it, and the pass
 * that follows each category's `parent` once all are read (`0x1659550`) copies
 * nothing down. `situations` writes none and is not for budgets, whatever its
 * parent `country` says.
 */
export function categoryBudgetUse(category: LoadBlock): CategoryBudgetUse {
  return {
    budget: lastScalar(category, "use_for_ai_budget")?.toLowerCase() === "yes",
    parentExpenditure: blocksNamed(category, "ai_use_parent_for_resources_expenditure").flatMap(words),
    parentUpkeep: blocksNamed(category, "ai_use_parent_for_resources_upkeep").flatMap(words),
  };
}

/** The options a policy holds, by the `name` each is looked up by. */
export function policyOptionsOf(policy: LoadBlock): readonly string[] {
  return blocksNamed(policy, "option").flatMap((option) => {
    const name: string | undefined = lastScalar(option, "name");
    return name === undefined ? [] : [name];
  });
}

/** An `id` a trigger or an effect registers, where it is written. */
export interface ScriptId {
  readonly family: "effect" | "trigger";
  readonly id: string;
  /** Where inside the definition, dotted. */
  readonly path: string;
}

/** A block of a fleet action that the game asks an `id` of, and has none. */
export interface MissingScriptId {
  readonly family: "effect" | "trigger";
  readonly path: string;
  /** The action the block belongs to, `find_closest_fleet`, `repeat`, `effect`. */
  readonly action: string;
}

/** A `merge_fleet` that names a target. */
export interface MergeTarget {
  readonly path: string;
  readonly target: string;
}

export interface FleetActionFacts {
  readonly ids: readonly ScriptId[];
  readonly missing: readonly MissingScriptId[];
  readonly mergeTargets: readonly MergeTarget[];
}

/**
 * The fleet actions that look for something, each with the key its `found`
 * actions are written under.
 *
 * The factory of fleet actions (`0xe8a640`) builds one object for each of the
 * three kinds whichever of its three names is written: `find_planet` is
 * `find_closest_planet`, and `find_random_planet` the same with its `method`
 * preset.
 */
const FINDERS: Readonly<Record<string, string>> = {
  find_closest_fleet: "found_fleet",
  find_closest_planet: "found_planet",
  find_closest_system: "found_system",
  find_fleet: "found_fleet",
  find_planet: "found_planet",
  find_random_fleet: "found_fleet",
  find_random_planet: "found_planet",
  find_random_system: "found_system",
  find_system: "found_system",
};

function idOf(block: LoadBlock): string | undefined {
  return lastScalar(block, "id");
}

function join(path: string, key: string): string {
  return path.length === 0 ? key : `${path}.${key}`;
}

/** The actions of one list: a `queue_actions`, a `repeat`, a `found_fleet`. */
function readActions(actions: LoadBlock, path: string, into: Mutable): void {
  for (const entry of actions.entries) {
    const key: string | undefined = entry.key?.toLowerCase();
    if (key === undefined || entry.value.kind !== "block") {
      continue;
    }

    const here: string = join(path, entry.key ?? key);
    const value: LoadBlock = entry.value;

    if (key === "effect") {
      // `0xe8ccb0`: an effect block with no id is logged, `fleet_actions.cpp:793`.
      const id: string | undefined = idOf(value);
      if (id !== undefined) {
        into.ids.push({ family: "effect", id, path: here });
      } else if (!value.open) {
        into.missing.push({ family: "effect", path: here, action: "effect" });
      }
      // What the effect does may queue actions of its own, for this fleet or
      // another: those are fleet actions like any, wherever they are written.
      findQueues(value, here, into);
      continue;
    }

    if (key === "repeat") {
      // `0xe8c130`: `max_iterations`, `while`, and every other key an action.
      for (const condition of blocksNamed(value, "while")) {
        const id: string | undefined = idOf(condition);
        if (id !== undefined) {
          into.ids.push({ family: "trigger", id, path: join(here, "while") });
        } else if (!condition.open) {
          into.missing.push({ family: "trigger", path: join(here, "while"), action: "repeat" });
        }
      }
      readActions(value, here, into);
      continue;
    }

    if (key === "merge_fleet") {
      const target: string | undefined = lastScalar(value, "target");
      if (target !== undefined) {
        into.mergeTargets.push({ path: here, target });
      }
      continue;
    }

    const found: string | undefined = FINDERS[key];
    if (found === undefined) {
      continue;
    }

    for (const condition of blocksNamed(value, "trigger")) {
      const id: string | undefined = idOf(condition);
      if (id !== undefined) {
        into.ids.push({ family: "trigger", id, path: join(here, "trigger") });
      } else if (!condition.open) {
        into.missing.push({ family: "trigger", path: join(here, "trigger"), action: entry.key ?? key });
      }
    }
    for (const inner of [found, "failed"]) {
      for (const list of blocksNamed(value, inner)) {
        readActions(list, join(here, inner), into);
      }
    }
  }
}

interface Mutable {
  readonly ids: ScriptId[];
  readonly missing: MissingScriptId[];
  readonly mergeTargets: MergeTarget[];
}

function findQueues(block: LoadBlock, path: string, into: Mutable): void {
  for (const entry of block.entries) {
    if (entry.value.kind !== "block") {
      continue;
    }
    const here: string = entry.key === undefined ? path : join(path, entry.key);
    if (entry.key?.toLowerCase() === "queue_actions") {
      readActions(entry.value, here, into);
    } else {
      findQueues(entry.value, here, into);
    }
  }
}

/**
 * What the fleet actions a definition queues register and lack.
 *
 * A trigger or an effect inside `queue_actions` is kept by its `id`, so that a
 * saved game can find it again: the reader of each logs one that has none
 * (`0xe8aca0` for the `trigger` of a `find_…` and the `while` of a `repeat`,
 * `0xe8ccb0` for an `effect`). An id is registered in a table of the whole
 * game as its block is read (`0x347410`, `0x3a97f0`), and the second block to
 * register one is logged and dropped.
 */
export function fleetActionFacts(body: LoadBlock): FleetActionFacts {
  const into: Mutable = { ids: [], missing: [], mergeTargets: [] };
  findQueues(body, "", into);
  return into;
}

/** Whether a body names `optimize_memory`, as a scripted effect or trigger may at its root. */
export function optimisesMemory(body: LoadBlock): boolean {
  return body.entries.some(
    (entry) => entry.key === undefined && entry.value.kind === "scalar" && entry.value.text === "optimize_memory",
  );
}
