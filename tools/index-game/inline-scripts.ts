import {
  NodeKind,
  ParserDiagnosticCode,
  parse,
  type Assignment,
  type Block,
  type Document,
  type EntryNode,
  type ParseResult,
} from "../../src/syntax/index.js";

/**
 * Reads the base game's files as the game does where reading them as written
 * leaves definitions out.
 *
 * Two things did. An `inline_script` is replaced by the file it names before
 * the block around it is read, with each `$PARAM$` filled in — and 4.5 writes
 * whole definitions that way: `the_curtain_$ETHIC$ = { … }` is a pop faction
 * type per ethic, `key = ANTI_EVASION_GUN_$TIER$` a component per tier, and an
 * `EVENT_ID` passed to a script file is the id of an event no events file
 * spells out. Read as written, the 6,917 calls of 4.5.2 named nothing: the
 * definitions they write were missing from the index, 112 component templates
 * and 87 events among them, and every reference to one of those looked like a
 * reference to nothing.
 *
 * And a file whose last block is never closed is read to its end all the
 * same: `gfx/models/ui/nomads_frontend.gfx` lacks its final brace and the game
 * draws its nine meshes.
 */

/** The text of `common/inline_scripts/<name>.txt`, or `undefined` when there is none. */
export type InlineScriptLoader = (name: string) => string | undefined;

const MAX_DEPTH = 8;

/**
 * Whether a parsed file is one the game reads in full: no error at all, or
 * none but blocks left open at the end of the file.
 */
export function readsToTheEnd(result: ParseResult): boolean {
  return result.errors.every((error) => error.code === ParserDiagnosticCode.ExpectedCloseBrace);
}

function scalarText(entry: EntryNode | undefined): string | undefined {
  if (entry === undefined || entry.kind !== NodeKind.Scalar) {
    return undefined;
  }
  return typeof entry.value === "string" ? entry.value : entry.raw.replace(/^"|"$/gu, "");
}

/**
 * The end of the `[[NAME] … ]` block that opens at `start`, by counting
 * brackets: an optional block may hold another, and inline maths is written
 * `@[ … ]`.
 */
function closingBracket(text: string, start: number): number {
  let depth = 0;

  for (let index = start; index < text.length; index += 1) {
    const character: string = text.charAt(index);
    // A bracket in a string or a comment closes nothing: `name = "]"`.
    if (character === '"') {
      const end: number = text.indexOf('"', index + 1);
      if (end < 0) {
        return -1;
      }
      index = end;
      continue;
    }
    if (character === "#") {
      const end: number = text.indexOf("\n", index);
      if (end < 0) {
        return -1;
      }
      index = end;
      continue;
    }
    if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

/**
 * A script file's text with its parameters filled in.
 *
 * `[[NAME] … ]` stays when the parameter was passed and `[[!NAME] … ]` when it
 * was not; `$NAME$` becomes the value passed, and `$NAME|default$` the default
 * when none was. A parameter nobody passed and nothing defaults is left as
 * written, which marks whatever holds it as something only the game can name.
 */
export function instantiate(text: string, parameters: ReadonlyMap<string, string>): string {
  let out = "";
  let cursor = 0;

  for (;;) {
    const open: number = text.indexOf("[[", cursor);
    if (open < 0) {
      out += text.slice(cursor);
      break;
    }

    const header: number = text.indexOf("]", open);
    const close: number = closingBracket(text, open);
    if (header < 0 || close < 0 || close < header) {
      out += text.slice(cursor);
      break;
    }

    const written: string = text.slice(open + 2, header).trim();
    const negated: boolean = written.startsWith("!");
    const name: string = negated ? written.slice(1).trim() : written;
    out += text.slice(cursor, open);
    if (parameters.has(name) !== negated) {
      out += instantiate(text.slice(header + 1, close), parameters);
    }
    cursor = close + 1;
  }

  return out.replace(
    /\$([A-Za-z_][A-Za-z0-9_]*)(?:\|([^$]*))?\$/gu,
    (whole: string, name: string, fallback?: string) => {
      return parameters.get(name) ?? fallback ?? whole;
    },
  );
}

/** The script an `inline_script` names and the parameters it passes, or `undefined` for one this cannot read. */
function invocation(
  entry: Assignment,
): { readonly script: string; readonly parameters: ReadonlyMap<string, string> } | undefined {
  if (entry.value.kind === NodeKind.Scalar) {
    const script: string | undefined = scalarText(entry.value);
    return script === undefined ? undefined : { script, parameters: new Map<string, string>() };
  }

  if (entry.value.kind !== NodeKind.Block) {
    return undefined;
  }

  let script: string | undefined;
  const parameters = new Map<string, string>();

  for (const field of entry.value.entries) {
    if (field.kind !== NodeKind.Assignment || field.value.kind !== NodeKind.Scalar) {
      continue;
    }
    const key: string = String(field.key.value);
    const value: string | undefined = scalarText(field.value);
    if (value === undefined) {
      continue;
    }
    if (key.toLowerCase() === "script") {
      script = value;
    } else {
      parameters.set(key, value);
    }
  }

  return script === undefined ? undefined : { script, parameters };
}

function expandEntries(entries: readonly EntryNode[], load: InlineScriptLoader, depth: number): readonly EntryNode[] {
  const out: EntryNode[] = [];

  for (const entry of entries) {
    if (entry.kind === NodeKind.Assignment && String(entry.key.value).toLowerCase() === "inline_script") {
      const called = depth < MAX_DEPTH ? invocation(entry) : undefined;
      const text: string | undefined = called === undefined ? undefined : load(called.script);

      if (called !== undefined && text !== undefined) {
        const result: ParseResult = parse(instantiate(text, called.parameters));
        if (readsToTheEnd(result)) {
          out.push(...expandEntries(result.document.entries, load, depth + 1));
          continue;
        }
      }

      out.push(entry);
      continue;
    }

    if (entry.kind === NodeKind.Assignment && entry.value.kind === NodeKind.Block) {
      const value: Block = { ...entry.value, entries: expandEntries(entry.value.entries, load, depth) };
      out.push({ ...entry, value });
      continue;
    }

    if (entry.kind === NodeKind.Block) {
      out.push({ ...entry, entries: expandEntries(entry.entries, load, depth) });
      continue;
    }

    // `spriteType { … }`, a block written after a word with no `=`.
    if (entry.kind === NodeKind.PrefixedBlock) {
      out.push({ ...entry, block: { ...entry.block, entries: expandEntries(entry.block.entries, load, depth) } });
      continue;
    }

    out.push(entry);
  }

  return out;
}

/**
 * A file with every `inline_script` in it replaced by what it injects, at any
 * depth. One that names no file this can find, or a file that does not parse,
 * is left where it stands.
 */
export function expandInlineScripts(document: Document, load: InlineScriptLoader): Document {
  return { ...document, entries: expandEntries(document.entries, load, 0) };
}
