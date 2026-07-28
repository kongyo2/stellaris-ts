import type { DefinitionType, ScriptBlockValue, SchemaModel } from "./ir.js";

/**
 * Whether a type is read by the interface parser, which ignores case on keys.
 *
 * `interface/` and `gfx/` hold `.gui`, `.gfx` and `.asset` files, and vanilla
 * writes `texturefile` in 6,295 places against `textureFile` in the rest. Both
 * load sprites, so the reader plainly does not distinguish them. Script under
 * `common/` is left alone: vanilla is consistent there, and there is no evidence
 * either way.
 */
export function usesInterfaceFormat(type: DefinitionType): boolean {
  const directory: string = type.source.directory;
  return directory === "interface" || directory === "gfx" || /^(interface|gfx)\//u.test(directory);
}

/**
 * Keys that are syntax rather than fields of anything.
 *
 * `@size = 5` declares a script variable, and it can sit at the top of any file
 * the game parses. `$PARAM$` is substituted before the block is read, so a key
 * holding one — `remove_$SCOPE_TYPE$_flag` as much as `$FROM$` — has no final
 * spelling to check. Neither is a field, and treating them as one reports holes
 * that are not there.
 */
export function isSyntacticKey(key: string): boolean {
  return key.startsWith("@") || key.includes("$");
}

/** The words that name a scope without naming a link. */
const FRAME_WORDS: readonly string[] = [
  "this",
  "root",
  "prev",
  "prevprev",
  "prevprevprev",
  "prevprevprevprev",
  "from",
  "fromfrom",
  "fromfromfrom",
  "fromfromfromfrom",
];

/**
 * Names a trigger or effect block accepts beyond the commands it declares.
 *
 * Three kinds, all of which vanilla writes constantly and none of which the
 * ported corpus lists as a command:
 *
 * - **another scripted trigger or effect**, called by its own name. That is what
 *   `common/scripted_triggers` is for, so every id in it is callable.
 * - **a scope to enter** — `owner = { ... }` runs the block on the owner.
 * - **a logical operator** — declared, but as `OR` where vanilla writes both
 *   `OR` and `or`. The game does not distinguish, so neither does this.
 *
 * Everything is lowercased; see {@link isScopeKey} for the chained forms.
 */
export function scriptBlockNames(
  model: SchemaModel,
  family: ScriptBlockValue["family"],
  idsByType: Readonly<Record<string, readonly string[]>>,
): ReadonlySet<string> {
  const names = new Set<string>();

  for (const command of model.commands) {
    if (command.family === family) {
      names.add(command.id.toLowerCase());
    }
  }

  const callable: string | undefined =
    family === "trigger" ? "scripted_trigger" : family === "effect" ? "scripted_effect" : undefined;

  if (callable !== undefined) {
    for (const id of idsByType[callable] ?? []) {
      names.add(id.toLowerCase());
    }
  }

  for (const name of scopeEntryNames(model)) {
    names.add(name);
  }

  return names;
}

/** Every way of naming a scope in one step: a link, a scope, or a frame word. */
export function scopeEntryNames(model: SchemaModel): ReadonlySet<string> {
  const names = new Set<string>(FRAME_WORDS);

  for (const link of model.links) {
    if (link.kind === "scope-link") {
      names.add(link.id.toLowerCase());
    }
  }

  for (const scope of model.scopes) {
    names.add(scope.id.toLowerCase());

    for (const alias of scope.aliases) {
      names.add(alias.toLowerCase());
    }
  }

  return names;
}

/** Prefixes that introduce a scope resolved at run time, as `prefix:value`. */
function dynamicPrefixes(model: SchemaModel): ReadonlySet<string> {
  const prefixes = new Set<string>();

  for (const set of model.valueSets) {
    prefixes.add(set.id.toLowerCase());
  }

  for (const link of model.links) {
    if (link.kind === "data-link") {
      prefixes.add(link.prefix.replace(/:$/u, "").toLowerCase());
    }
  }

  return prefixes;
}

const prefixCache = new WeakMap<SchemaModel, ReadonlySet<string>>();

/**
 * Whether a key names a scope to enter rather than a field.
 *
 * A scope can be reached by a chain — `capital_scope.solar_system` — by a
 * run-time lookup — `event_target:graygoo_country` — and either can carry a
 * trailing `?`, which means "skip the block if this scope does not exist"
 * rather than being part of the name.
 */
export function isScopeKey(model: SchemaModel, key: string, names: ReadonlySet<string>): boolean {
  const withoutOptional: string = key.endsWith("?") ? key.slice(0, -1) : key;

  if (withoutOptional.length === 0) {
    return false;
  }

  let prefixes: ReadonlySet<string> | undefined = prefixCache.get(model);

  if (prefixes === undefined) {
    prefixes = dynamicPrefixes(model);
    prefixCache.set(model, prefixes);
  }

  return withoutOptional.split(".").every((segment) => {
    const lowered: string = segment.toLowerCase();
    const colon: number = lowered.indexOf(":");

    if (colon > 0) {
      return prefixes.has(lowered.slice(0, colon)) && lowered.length > colon + 1;
    }

    return names.has(lowered);
  });
}
