import { NodeKind, type Block, type EntryNode } from "../syntax/index.js";
import type { ExtractionStep } from "./ir.js";

/**
 * Following an extraction route over parsed script.
 *
 * An extracted enum's members are whatever the game's own files put at the end
 * of a route — the counters an event chain declares, the words a tag file
 * holds. Two callers follow the same routes and must agree: the indexer, over
 * the installed game, and `validate`, over the files a mod ships as script it
 * wrote itself. Two copies of this drifted apart once already, which is how
 * `component_tags` came to be read with the route starting a level too deep and
 * yielded nothing at all.
 */

function blockOf(entry: EntryNode): Block | undefined {
  return entry.kind === NodeKind.Assignment && entry.value.kind === NodeKind.Block ? entry.value : undefined;
}

function keyOf(entry: EntryNode): string | undefined {
  return entry.kind === NodeKind.Assignment ? String(entry.key.value) : undefined;
}

/** Follows an extraction route from a block, collecting whatever the route captures. */
export function captureAlong(entries: readonly EntryNode[], route: readonly ExtractionStep[], into: Set<string>): void {
  const step: ExtractionStep | undefined = route[0];

  if (step === undefined) {
    return;
  }

  const rest: readonly ExtractionStep[] = route.slice(1);

  if (step.kind === "capture") {
    for (const entry of entries) {
      if (step.source === "key") {
        const key: string | undefined = keyOf(entry);
        if (key !== undefined) {
          into.add(key);
        }
      } else if (entry.kind === NodeKind.Scalar) {
        into.add(String(entry.value));
      } else if (entry.kind === NodeKind.Assignment && entry.value.kind === NodeKind.Scalar) {
        into.add(String(entry.value.value));
      }
    }
    return;
  }

  for (const entry of entries) {
    const block: Block | undefined = blockOf(entry);

    if (step.kind === "field") {
      if (keyOf(entry) === step.key) {
        if (block !== undefined) {
          captureAlong(block.entries, rest, into);
        } else if (rest[0]?.kind === "capture" && entry.kind === NodeKind.Assignment) {
          captureAlong([entry], rest, into);
        }
      }
      continue;
    }

    if (block !== undefined) {
      captureAlong(block.entries, rest, into);
    }
  }
}

/**
 * A whole file's worth of entries, as a route sees them.
 *
 * A route that does not start at the root describes a path relative to each
 * definition, so it has to descend one level first. Applying it at the file
 * root instead finds nothing, which is what left 26 of the 27 extracted enums
 * empty when this was first written.
 */
export function captureFromDocument(
  entries: readonly EntryNode[],
  route: readonly ExtractionStep[],
  startFromRoot: boolean,
  into: Set<string>,
): void {
  if (startFromRoot) {
    captureAlong(entries, route, into);
    return;
  }

  for (const entry of entries) {
    const block: Block | undefined = blockOf(entry);
    if (block !== undefined) {
      captureAlong(block.entries, route, into);
    }
  }
}
