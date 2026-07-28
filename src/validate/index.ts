import { extractedEnumMembers, vanillaIdsByType, vanillaModifierNames } from "../generated/vanilla/index.js";
import type { Mod } from "../runtime/mod.js";
import { isBare, isEntries, isRaw, isRepeated } from "../runtime/values.js";
import { schema } from "../schema/index.js";
import { expandModifierNames, mergeIdsByType } from "../schema/modifier-namespace.js";
import type { DefinitionType, EntryRule, KeyRule, SchemaModel, ValueRule } from "../schema/ir.js";

/**
 * Checks a mod against the schema before it reaches the game.
 *
 * The game reports almost nothing when a mod is wrong: an unknown field is
 * ignored, a missing string shows as the key itself, and a reference to
 * something that does not exist fails at the moment it is used, possibly hours
 * into a session. These are the mistakes that can be caught without launching.
 */

export interface ValidationDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly definition: string;
}

export interface ValidationOptions {
  /** Languages a definition's required strings must exist in. Defaults to English. */
  readonly languages?: readonly string[];
  readonly model?: SchemaModel;
}

interface AcceptorDraft {
  open: boolean;
  readonly literals: Set<string>;
  /** Names the game matches without regard to case; compared lowercased. */
  readonly insensitive: Set<string>;
  readonly patterns: { prefix: string; suffix: string }[];
}

interface Acceptor {
  readonly open: boolean;
  readonly literals: ReadonlySet<string>;
  readonly insensitive: ReadonlySet<string>;
  readonly patterns: readonly { readonly prefix: string; readonly suffix: string }[];
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function enumMembers(model: SchemaModel, id: string): readonly string[] {
  const definition = model.enums.find((candidate) => candidate.id === id);

  if (definition === undefined) {
    return [];
  }

  return definition.kind === "static-enum" ? definition.values : (extractedEnumMembers[id] ?? []);
}

function collectKey(model: SchemaModel, key: KeyRule, into: AcceptorDraft): void {
  if (typeof key === "string") {
    into.literals.add(key);
    return;
  }

  if (key.kind === "enum-key") {
    const members: readonly string[] = enumMembers(model, key.enum);

    if (members.length === 0) {
      into.open = true;
      return;
    }

    for (const member of members) {
      into.literals.add(member);
    }
    return;
  }

  if (key.kind === "pattern-key") {
    into.patterns.push({ prefix: key.prefix, suffix: key.suffix });
    return;
  }

  into.open = true;
}

function addNames(names: readonly string[], into: AcceptorDraft): void {
  if (names.length === 0) {
    into.open = true;
    return;
  }

  for (const name of names) {
    into.literals.add(name);
  }
}

function collectEntry(model: SchemaModel, entry: EntryRule, into: AcceptorDraft, modifiers: ReadonlySet<string>): void {
  switch (entry.kind) {
    case "field":
      collectKey(model, entry.key, into);
      return;
    case "variant-rules":
      for (const child of entry.entries) {
        collectEntry(model, child, into, modifiers);
      }
      return;
    case "script-entries":
      // A modifier block is keyed by modifier name, and those are a namespace of
      // their own: mostly generated from definitions rather than declared, and
      // matched without regard to case.
      if (entry.family === "modifier") {
        if (modifiers.size === 0) {
          into.open = true;
          return;
        }
        for (const name of modifiers) {
          into.insensitive.add(name);
        }
        return;
      }

      addNames(
        model.commands.filter((command) => command.family === entry.family).map((command) => command.id),
        into,
      );
      return;
    case "rule-set-entries":
      addNames(
        model.ruleSets
          .filter((ruleSet) => ruleSet.family === entry.family)
          .map((ruleSet) => ruleSet.name)
          .filter((name): name is string => name !== undefined && name.length > 0),
        into,
      );
      return;
    default:
      return;
  }
}

/**
 * Which definition type each top-level field points at.
 *
 * Matching a field name against a type name catches `technology = x` and misses
 * everything else — `picture = GFX_evt_x` points at a sprite, `icon` at an icon,
 * `prerequisites` at technologies. The schema already says which, so it is read
 * rather than guessed.
 */
function referenceTargets(type: DefinitionType): ReadonlyMap<string, string> {
  const targets = new Map<string, string>();

  const note = (key: KeyRule, value: ValueRule): void => {
    if (typeof key !== "string") {
      return;
    }

    if (value.kind === "type-reference") {
      targets.set(key, value.type);
      return;
    }

    // A list of references is still a list of references.
    if (value.kind === "list" && value.item.kind === "type-reference") {
      targets.set(key, value.item.type);
      return;
    }

    // `prerequisites = { tech_a tech_b }` is a block whose bare items are the
    // references, which is how PDX spells a list.
    if (value.kind === "block") {
      for (const entry of value.entries) {
        if (entry.kind === "item" && entry.value.kind === "type-reference") {
          targets.set(key, entry.value.type);
          return;
        }
      }
    }
  };

  const visit = (entries: readonly EntryRule[]): void => {
    for (const entry of entries) {
      if (entry.kind === "field") {
        note(entry.key, entry.value);
      } else if (entry.kind === "variant-rules") {
        visit(entry.entries);
      }
    }
  };

  visit(type.entries);
  return targets;
}

/**
 * Which top-level fields hold a block of modifiers.
 *
 * `planet_modifier = { job_researcher_add = 2 }` is where a typo costs the most:
 * the field itself is spelled right, so nothing above notices, and the game drops
 * the line without a word. The schema marks these blocks, so they can be read off
 * rather than guessed at from the name.
 */
function modifierBlockFields(type: DefinitionType): ReadonlySet<string> {
  const fields = new Set<string>();

  const visit = (entries: readonly EntryRule[]): void => {
    for (const entry of entries) {
      if (entry.kind === "variant-rules") {
        visit(entry.entries);
        continue;
      }

      if (
        entry.kind === "field" &&
        typeof entry.key === "string" &&
        entry.value.kind === "block" &&
        entry.value.entries.some((inner) => inner.kind === "script-entries" && inner.family === "modifier")
      ) {
        fields.add(entry.key);
      }
    }
  };

  visit(type.entries);
  return fields;
}

/** The keys a body value writes, for the shapes that carry keys at all. */
function keysOf(value: unknown): readonly string[] {
  if (isEntries(value)) {
    const keys: string[] = [];

    for (const entry of value.entries) {
      if (!isBare(entry)) {
        keys.push(entry[0]);
      }
    }

    return keys;
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value) && !isRaw(value) && !isRepeated(value)) {
    return Object.keys(value);
  }

  return [];
}

function acceptorFor(model: SchemaModel, type: DefinitionType, modifiers: ReadonlySet<string>): Acceptor {
  const draft: AcceptorDraft = {
    open: false,
    literals: new Set<string>(),
    insensitive: new Set<string>(),
    patterns: [],
  };

  for (const entry of type.entries) {
    collectEntry(model, entry, draft, modifiers);
  }

  for (const macro of model.policy.macros) {
    draft.literals.add(macro.key);
  }

  return draft;
}

function accepts(acceptor: Acceptor, key: string): boolean {
  return (
    acceptor.open ||
    acceptor.literals.has(key) ||
    acceptor.insensitive.has(key.toLowerCase()) ||
    acceptor.patterns.some(
      (pattern) =>
        key.length >= pattern.prefix.length + pattern.suffix.length &&
        key.startsWith(pattern.prefix) &&
        key.endsWith(pattern.suffix),
    )
  );
}

export function validate(mod: Mod, options: ValidationOptions = {}): readonly ValidationDiagnostic[] {
  const model: SchemaModel = options.model ?? schema;
  const languages: readonly string[] = options.languages ?? ["l_english"];
  const diagnostics: ValidationDiagnostic[] = [];
  const acceptors = new Map<string, Acceptor>();
  const referenceMaps = new Map<string, ReadonlyMap<string, string>>();
  const modifierBlocks = new Map<string, ReadonlySet<string>>();
  const declared = new Set<string>(mod.definitions.map((definition) => `${definition.type}:${definition.id}`));
  const strings = new Map<string, ReadonlySet<string>>();
  const seen = new Set<string>();

  for (const [language, entries] of mod.localisation) {
    strings.set(language, new Set(entries.map((entry) => entry.key)));
  }

  // A mod's own definitions generate modifiers exactly as vanilla's do: adding a
  // job called `my_job` brings `job_my_job_add` into existence, so the mod has to
  // be part of what the namespace is expanded over.
  const ownIds: Record<string, string[]> = {};
  for (const definition of mod.definitions) {
    (ownIds[definition.type] ??= []).push(definition.id);
  }
  const modifiers: ReadonlySet<string> = expandModifierNames(
    model.modifiers,
    mergeIdsByType(vanillaIdsByType, ownIds),
    vanillaModifierNames,
  );

  for (const definition of mod.definitions) {
    const type: DefinitionType | undefined = model.definitionTypes.find(
      (candidate) => candidate.id === definition.type,
    );

    if (type === undefined) {
      diagnostics.push({
        severity: "error",
        code: "unknown-definition-type",
        message: `${definition.type} is not a definition type in the schema.`,
        definition: definition.id,
      });
      continue;
    }

    // Two definitions of the same id: the later one wins and the earlier one
    // silently does nothing.
    const identity: string = `${definition.type}:${definition.id}`;
    if (seen.has(identity)) {
      diagnostics.push({
        severity: "error",
        code: "duplicate-definition",
        message: `${definition.id} is defined more than once as a ${definition.type}; only the last one loads.`,
        definition: definition.id,
      });
    }
    seen.add(identity);

    let acceptor: Acceptor | undefined = acceptors.get(type.id);
    if (acceptor === undefined) {
      acceptor = acceptorFor(model, type, modifiers);
      acceptors.set(type.id, acceptor);
    }

    let targets: ReadonlyMap<string, string> | undefined = referenceMaps.get(type.id);
    if (targets === undefined) {
      targets = referenceTargets(type);
      referenceMaps.set(type.id, targets);
    }

    let modifierFields: ReadonlySet<string> | undefined = modifierBlocks.get(type.id);
    if (modifierFields === undefined) {
      modifierFields = modifierBlockFields(type);
      modifierBlocks.set(type.id, modifierFields);
    }

    for (const [field, value] of Object.entries(definition.body)) {
      if (modifierFields.has(field)) {
        for (const name of keysOf(value)) {
          if (!modifiers.has(name.toLowerCase())) {
            diagnostics.push({
              severity: "error",
              code: "unknown-modifier",
              message: `${name} is not a modifier, so ${field} would drop it silently.`,
              definition: definition.id,
            });
          }
        }
      }

      if (!accepts(acceptor, field)) {
        diagnostics.push({
          severity: "error",
          code: "unknown-field",
          message: `${type.id} has no field ${field}. The game ignores what it does not know, so this would do nothing.`,
          definition: definition.id,
        });
      }

      // A reference to something neither vanilla nor this mod defines fails when
      // the game reaches it, which can be a long way into a session.
      const targetType: string | undefined = targets.get(field);
      const known: readonly string[] | undefined = targetType === undefined ? undefined : vanillaIdsByType[targetType];

      if (known !== undefined && targetType !== undefined) {
        for (const reference of typeof value === "string" ? [value] : Array.isArray(value) ? value : []) {
          if (
            typeof reference === "string" &&
            !known.includes(reference) &&
            !declared.has(`${targetType}:${reference}`)
          ) {
            diagnostics.push({
              severity: "warning",
              code: "unresolved-reference",
              message: `${field} points at ${targetType} ${reference}, which is neither in vanilla nor defined by this mod.`,
              definition: definition.id,
            });
          }
        }
      }
    }

    // A missing string shows in-game as the raw key: easy to ship, easy to miss.
    for (const requirement of type.localisation) {
      if (!requirement.required || requirement.source.kind !== "definition-id") {
        continue;
      }

      const key: string = `${definition.id}${requirement.source.suffix}`;

      for (const language of languages) {
        if (strings.get(language)?.has(key) !== true) {
          diagnostics.push({
            severity: "warning",
            code: "missing-localisation",
            message: `No ${language} string for ${key}; the game will show the key itself.`,
            definition: definition.id,
          });
        }
      }
    }
  }

  return diagnostics.sort(
    (left, right) =>
      compareOrdinal(left.definition, right.definition) ||
      compareOrdinal(left.code, right.code) ||
      compareOrdinal(left.message, right.message),
  );
}
