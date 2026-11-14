import { NodeKind, type Block, type Document, type EntryNode } from "../syntax/index.js";

/**
 * The animation ids each mesh of a file declares, by mesh name.
 *
 * A mesh is `objectTypes = { pdxmesh = { name = … animation = { id = … type =
 * … } } }`, and the `id` is what a state of an entity plays: the entity is
 * built with each state's `animation` looked up among its mesh's own ids
 * (`0xf79700` in the 4.5.2 executable), not among the animations by name. Two
 * callers read a file this way and have to agree: the indexer, over the base
 * game's meshes, and `validate`, over the meshes a mod ships as script it
 * wrote itself.
 *
 * Keys are matched without regard to case, as the game reads them. A mesh
 * with no animation is recorded with none, which is not the same as a mesh
 * nothing is known of — nor as one that holds script this cannot read: an
 * `inline_script` may declare the animations, and so may a `[[PARAM] … ]`
 * block. Such a mesh is named in `unreadable`, when the caller asks.
 */
export function meshAnimationsOf(document: Document, into: Map<string, Set<string>>, unreadable?: Set<string>): void {
  /** Whether a block holds something that may add entries this cannot see. */
  const opaque = (entries: readonly EntryNode[]): boolean =>
    entries.some(
      (entry) =>
        entry.kind === NodeKind.OptionalBlock ||
        entry.kind === NodeKind.Error ||
        (entry.kind === NodeKind.Assignment && String(entry.key.value).toLowerCase() === "inline_script"),
    );

  const blocksUnder = (entries: readonly EntryNode[], key: string): Block[] =>
    entries.flatMap((entry) =>
      entry.kind === NodeKind.Assignment &&
      entry.value.kind === NodeKind.Block &&
      String(entry.key.value).toLowerCase() === key
        ? [entry.value]
        : [],
    );
  const scalarUnder = (block: Block, key: string): string | undefined => {
    for (const entry of block.entries) {
      if (
        entry.kind === NodeKind.Assignment &&
        String(entry.key.value).toLowerCase() === key &&
        entry.value.kind === NodeKind.Scalar
      ) {
        return String(entry.value.value);
      }
    }
    return undefined;
  };

  for (const container of blocksUnder(document.entries, "objecttypes")) {
    for (const mesh of blocksUnder(container.entries, "pdxmesh")) {
      const name: string | undefined = scalarUnder(mesh, "name");
      if (name === undefined) {
        continue;
      }
      const ids: Set<string> = into.get(name) ?? new Set<string>();
      let readable: boolean = !opaque(mesh.entries);
      for (const animation of blocksUnder(mesh.entries, "animation")) {
        const id: string | undefined = scalarUnder(animation, "id");
        if (id !== undefined && !id.includes("$") && !id.startsWith("@")) {
          ids.add(id);
        } else {
          readable = false;
        }
        readable &&= !opaque(animation.entries);
      }
      into.set(name, ids);
      if (!readable) {
        unreadable?.add(name);
      }
    }
  }
}
