import type { ResolvedValue } from "./resolve.js";

/**
 * The file a value names, when naming a file is all it can do.
 *
 * A sprite's `textureFile`, a mesh's `file`, each word of a portrait's
 * `character_textures`: the value is a path from the root of the game folder,
 * and the game looks for it among its own files and every mod's. One it does
 * not find is a white square, a test object or a portrait with a layer
 * missing. Asked of a mod by `validate` and of the base game by the
 * conformance gate, which is what holds each rule that reads a value as a
 * file to the files the game really ships.
 */

/**
 * The paths a scalar under these rules is looked for at, in the order the game
 * tries them; empty unless every rule that could read a scalar reads a file.
 *
 * A texture is tried as written and then with the other of the two endings
 * the texture handler knows (`0x1cd9f10`, `texturehandler.cpp`: `.dds`, then
 * `.tga`). An icon is the name of a `.dds` in the directory its rule names.
 */
export function namedFiles(values: readonly ResolvedValue[], written: string): readonly string[] {
  // The file system the game is mostly run on drops a space after a name, and
  // one sprite of the base game is found only because it does.
  const text: string = written.trim();
  let paths: readonly string[] | undefined;

  for (const value of values) {
    switch (value.kind) {
      case "block":
      case "script-block":
      case "scripted-call":
      case "list":
        continue;
      case "primitive": {
        let own: readonly string[];
        if (value.type === "icon" && value.path !== undefined) {
          own = [`${value.path}/${text}.dds`];
        } else if (value.type === "file" && value.path === undefined) {
          const other: string | undefined = /\.dds$/iu.test(text)
            ? text.replace(/\.dds$/iu, ".tga")
            : /\.tga$/iu.test(text)
              ? text.replace(/\.tga$/iu, ".dds")
              : undefined;
          own = other === undefined ? [text] : [text, other];
        } else {
          return [];
        }
        if (paths !== undefined && paths.join("\n") !== own.join("\n")) {
          return [];
        }
        paths = own;
        continue;
      }
      default:
        return [];
    }
  }

  return paths ?? [];
}

/** A path as the file system the game is mostly run on reads it: one separator, no case. */
export function foldedPath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/")
    .toLowerCase();
}
