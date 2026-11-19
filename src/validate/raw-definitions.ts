import { vanillaPlacement } from "../generated/vanilla/index.js";
import type { DefinitionRecord, RawFileRecord } from "../runtime/mod.js";
import { bare, entries, eq, gt, gte, lt, lte, ne, raw, type Entry, type EntriesValue } from "../runtime/values.js";
import { definitionIds } from "../schema/definition-ids.js";
import type { DefinitionType, SchemaModel } from "../schema/ir.js";
import { NodeKind, ScalarKind, type Document, type EntryNode, type Scalar, type ValueNode } from "../syntax/index.js";

/**
 * The definitions a mod's raw files hold, as `define()` would have built them.
 *
 * `mod.file()` writes script verbatim, and the game reads what it holds like
 * any other file: a `common/defines` file with a misspelled key, a scripted
 * effect written by hand with a fleet's effect in a ship's scope. Counted only
 * for the names they declare, such a file was a way round every check — the
 * one place a mistake could not be reported was the place written without
 * types. Each block a file holds, where a type is read from, is turned into
 * the body `define()` takes and checked as one.
 *
 * What a body cannot hold as a value stays text: inline maths, a
 * `[[PARAM] … ]` block, `rgb { … }`. That is what `raw()` is, and a check
 * reads it as it reads one.
 */

function scalarValue(scalar: Scalar): boolean | number | string {
  if (scalar.scalarKind === ScalarKind.Boolean && typeof scalar.value === "boolean") {
    return scalar.value;
  }
  if (scalar.scalarKind === ScalarKind.Number && typeof scalar.value === "number") {
    return scalar.value;
  }
  return typeof scalar.value === "string" ? scalar.value : scalar.raw;
}

function textOf(node: EntryNode | ValueNode, source: string): string {
  return source.slice(node.span.start.offset, node.span.end.offset);
}

function valueOf(node: ValueNode, source: string): unknown {
  switch (node.kind) {
    case NodeKind.Scalar:
      return scalarValue(node);
    case NodeKind.Block:
      return bodyOfEntries(node.entries, source);
    default:
      return raw(textOf(node, source));
  }
}

function compared(operator: string, value: unknown): unknown {
  switch (operator) {
    case ">":
      return gt(value);
    case ">=":
      return gte(value);
    case "<":
      return lt(value);
    case "<=":
      return lte(value);
    case "!=":
      return ne(value);
    case "=":
      return value;
    default:
      return eq(value);
  }
}

/** A block's entries as an ordered body: what is written, in the order it is written. */
export function bodyOfEntries(nodes: readonly EntryNode[], source: string): EntriesValue {
  const items: Entry[] = [];

  for (const node of nodes) {
    switch (node.kind) {
      case NodeKind.Trivia:
        break;
      case NodeKind.Assignment:
        items.push([String(node.key.value), compared(node.operator, valueOf(node.value, source))]);
        break;
      case NodeKind.Scalar:
        items.push(bare(scalarValue(node)));
        break;
      case NodeKind.Block:
        items.push(bare(bodyOfEntries(node.entries, source)));
        break;
      default:
        items.push(bare(raw(textOf(node, source))));
    }
  }

  return entries(items);
}

/** A raw file's path as the emitter writes it: one separator, no `.` segment. */
function normalised(written: string): string {
  return written
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/");
}

function variantOf(type: DefinitionType, key: string): string | undefined {
  return type.variants.find(
    // Without regard to case, as the key was claimed: `COUNTRY_EVENT` is a country's event.
    (variant) =>
      variant.when.kind === "root-key" &&
      variant.when.values.some((value) => value.toLowerCase() === key.toLowerCase()),
  )?.id;
}

/**
 * Every definition the raw files hold, of the types that are read where each
 * file sits and from files of its extension.
 */
export function rawDefinitions(
  model: SchemaModel,
  files: readonly RawFileRecord[],
  parsed: ReadonlyMap<string, Document>,
): readonly DefinitionRecord[] {
  const records: DefinitionRecord[] = [];

  for (const file of files) {
    const document: Document | undefined = parsed.get(file.path);
    if (document === undefined) {
      continue;
    }

    const path: string = normalised(file.path);
    const slash: number = path.lastIndexOf("/");
    const directory: string = slash < 0 ? "" : path.slice(0, slash);
    const name: string = path.slice(slash + 1);
    const dot: number = name.lastIndexOf(".");
    const extension: string = dot < 0 ? "" : name.slice(dot).toLowerCase();

    for (const type of model.definitionTypes) {
      const source = type.source;
      const covers: boolean = source.includeSubdirectories
        ? directory === source.directory || directory.startsWith(`${source.directory}/`)
        : directory === source.directory;

      if (
        !covers ||
        source.kind === "bare-values" ||
        (source.files !== undefined && !source.files.includes(name)) ||
        extension !== (vanillaPlacement[type.id]?.extension ?? ".txt")
      ) {
        continue;
      }

      if (source.kind === "file-definitions") {
        const id: string = source.stripExtension ? name.replace(/\.[^.]+$/u, "") : name;
        records.push({
          type: type.id,
          directory,
          id,
          body: bodyOfEntries(document.entries, file.contents),
          file: name,
          wholeFile: true,
        });
        continue;
      }

      for (const claim of definitionIds(type, document, name)) {
        if (claim.block === undefined || claim.key === undefined) {
          continue;
        }
        const variant: string | undefined = variantOf(type, claim.key);
        records.push({
          type: type.id,
          directory,
          id: claim.id,
          body: bodyOfEntries(claim.block.entries, file.contents),
          file: name,
          ...(source.kind === "tagged-blocks" ? { blockKey: claim.key, nameField: source.nameField } : {}),
          ...(variant === undefined ? {} : { variant }),
          ...(claim.container === undefined ? {} : { container: claim.container }),
        });
      }
    }
  }

  return records;
}
