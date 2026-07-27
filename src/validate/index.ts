import { extractedEnumMembers, vanillaIdsByType } from "../generated/vanilla/index.js";
import type { Mod } from "../runtime/mod.js";
import { schema } from "../schema/index.js";
import type { DefinitionType, EntryRule, KeyRule, SchemaModel } from "../schema/ir.js";

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
  readonly patterns: { prefix: string; suffix: string }[];
}

interface Acceptor {
  readonly open: boolean;
  readonly literals: ReadonlySet<string>;
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

function collectEntry(model: SchemaModel, entry: EntryRule, into: AcceptorDraft): void {
  switch (entry.kind) {
    case "field":
      collectKey(model, entry.key, into);
      return;
    case "variant-rules":
      for (const child of entry.entries) {
        collectEntry(model, child, into);
      }
      return;
    case "script-entries":
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

function acceptorFor(model: SchemaModel, type: DefinitionType): Acceptor {
  const draft: AcceptorDraft = { open: false, literals: new Set<string>(), patterns: [] };

  for (const entry of type.entries) {
    collectEntry(model, entry, draft);
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
  const declared = new Set<string>(mod.definitions.map((definition) => `${definition.type}:${definition.id}`));
  const strings = new Map<string, ReadonlySet<string>>();
  const seen = new Set<string>();

  for (const [language, entries] of mod.localisation) {
    strings.set(language, new Set(entries.map((entry) => entry.key)));
  }

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
      acceptor = acceptorFor(model, type);
      acceptors.set(type.id, acceptor);
    }

    for (const [field, value] of Object.entries(definition.body)) {
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
      const targets: readonly string[] | undefined = vanillaIdsByType[field];

      if (
        typeof value === "string" &&
        targets !== undefined &&
        !targets.includes(value) &&
        !declared.has(`${field}:${value}`)
      ) {
        diagnostics.push({
          severity: "warning",
          code: "unresolved-reference",
          message: `${field} points at ${value}, which is neither in vanilla nor defined by this mod.`,
          definition: definition.id,
        });
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
