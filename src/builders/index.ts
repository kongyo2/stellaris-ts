import { definitionTypes } from "../schema/definitions/index.js";
import type { DefinitionType } from "../schema/ir.js";
import type { DefinitionRecord } from "../runtime/mod.js";
import type { DefinitionShapes } from "../generated/types/index.js";

/**
 * Builds one definition of a given type.
 *
 * The body is the PDX script with different punctuation, so a reader who knows
 * the game knows this. The directory comes from the schema rather than the call
 * site: where a type lives is a fact about the game, not a decision.
 */
export function define<Type extends keyof DefinitionShapes>(
  type: Type,
  id: string,
  body: DefinitionShapes[Type],
): DefinitionRecord {
  const schemaType: DefinitionType | undefined = definitionTypes.find((candidate) => candidate.id === type);

  if (schemaType === undefined) {
    throw new Error(`Unknown definition type: ${type}`);
  }

  return { type, directory: schemaType.source.directory, id, body };
}

/** Same as {@link define}, but places the definition in a named file. */
export function defineIn<Type extends keyof DefinitionShapes>(
  type: Type,
  file: string,
  id: string,
  body: DefinitionShapes[Type],
): DefinitionRecord {
  return { ...define(type, id, body), file };
}
