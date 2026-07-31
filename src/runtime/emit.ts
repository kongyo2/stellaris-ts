import { vanillaFiles as indexedVanillaFiles } from "../generated/vanilla/files.js";
import { vanillaModsCompatibilityVersion } from "../generated/vanilla/game-version.js";
import { renderDefinitions } from "./build.js";
import { bare, entries as orderedEntries, isBare, isEntries, type Entry } from "./values.js";
import {
  localisationFileName,
  renderLocalisation,
  LOCALISATION_LANGUAGES,
  type LocalisationEntry,
} from "./localisation.js";
import type { DefinitionRecord, Mod, ModOptions } from "./mod.js";

/**
 * Lays a mod out as files.
 *
 * Emitting is deliberately separate from writing to disk: the plan can be
 * inspected, diffed and tested without a filesystem, and the CLI writes it.
 */

export interface EmittedTextFile {
  readonly kind: "text";
  readonly path: string;
  readonly contents: string;
  /** UTF-8 with a BOM. Only localisation needs it, and it needs it absolutely. */
  readonly byteOrderMark: boolean;
}

/**
 * A file that is not script.
 *
 * Every icon a mod adds is a `.dds`, and a definition whose icon is missing
 * draws the missing-texture square on every button it appears on. Bytes rather
 * than a string because a `.dds` is not text in any encoding, and putting one
 * through one corrupts it silently.
 */
export interface EmittedBinaryFile {
  readonly kind: "binary";
  readonly path: string;
  readonly bytes: Uint8Array;
}

export type EmittedFile = EmittedBinaryFile | EmittedTextFile;

export interface EmitDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

export interface EmitPlan {
  readonly files: readonly EmittedFile[];
  readonly diagnostics: readonly EmitDiagnostic[];
  readonly descriptorPath: string;
  readonly modFileName: string;
}

export interface EmitOptions {
  /**
   * Vanilla file names per directory.
   *
   * Defaults to the listing shipped with this package. Pass your own to check
   * against a different game version, or `{}` to skip the check knowingly —
   * skipping it is reported, because a mod that shadows a vanilla file disables
   * everything else that file defined and gives no other warning.
   */
  readonly vanillaFiles?: Readonly<Record<string, readonly string[]>>;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

/**
 * A marker for a name that has no ASCII in it at all.
 *
 * Two mods called 共鳴の遺産 and 星々の記憶 both reduce to nothing, and the folder
 * they share is the least of it: both would write
 * `common/buildings/zz_mod_building.txt`, and whichever loads last would be the
 * only one whose buildings exist. Derived from the name so it is the same on
 * every machine and every build.
 */
function marker(value: string): string {
  let hash = 0x811c9dc5;

  for (const character of value) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  }

  return hash.toString(36);
}

/** The name a mod's own files are called after. */
function modSlug(options: ModOptions): string {
  if (options.id !== undefined) {
    return options.id;
  }

  const derived: string = slug(options.name);
  return derived.length === 0 ? `mod_${marker(options.name)}` : derived;
}

/**
 * The file a definition lands in.
 *
 * The default carries a `zz_<mod>_` prefix for two reasons: it cannot collide
 * with a vanilla name, and Stellaris loads files in alphabetical order, so a
 * late name wins where load order decides.
 */
function targetFile(mod: ModOptions, definition: DefinitionRecord): string {
  if (definition.overrides !== undefined) {
    return definition.overrides;
  }

  if (definition.file !== undefined) {
    return `${definition.directory}/${definition.file}`;
  }

  return `${definition.directory}/zz_${modSlug(mod)}_${definition.type}.txt`;
}

function renderDescriptor(options: ModOptions, includePath: string | undefined): string {
  const lines: string[] = [`version="${options.version}"`];

  if (options.tags !== undefined && options.tags.length > 0) {
    lines.push("tags={", ...options.tags.map((tag) => `\t"${tag}"`), "}");
  }

  if (options.dependencies !== undefined && options.dependencies.length > 0) {
    lines.push("dependencies={", ...options.dependencies.map((name) => `\t"${name}"`), "}");
  }

  lines.push(`name="${options.name}"`, `supported_version="${options.supportedVersion}"`);

  // One line per path, which is how the launcher reads them.
  for (const path of options.replacePaths ?? []) {
    lines.push(`replace_path="${path.replaceAll("\\", "/")}"`);
  }

  if (options.picture !== undefined) {
    lines.push(`picture="${options.picture}"`);
  }

  if (options.remoteFileId !== undefined) {
    lines.push(`remote_file_id="${options.remoteFileId}"`);
  }

  if (includePath !== undefined) {
    lines.push(`path="${includePath}"`);
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Whether a `supported_version` covers the version the launcher asks about.
 *
 * `v4.4.*` covers 4.4; `v4.3.*` does not, and the launcher marks the mod out of
 * date. A `*` matches whatever stands in its place.
 */
function coversVersion(supported: string, compatibility: string): boolean {
  if (compatibility.length === 0) {
    return true;
  }

  const declared: readonly string[] = supported.replace(/^v/u, "").split(".");
  const wanted: readonly string[] = compatibility.replace(/^v/u, "").split(".");

  return wanted.every((part, index) => {
    const own: string | undefined = declared[index];
    return own === undefined || own === "*" || own === part;
  });
}

/**
 * The body a tagged type is written with.
 *
 * The identity moves inside the block, under the field the type names, and goes
 * first because that is where every vanilla definition puts it.
 */
function withNameField(nameField: string, id: string, body: object): object {
  const existing: readonly Entry[] = isEntries(body)
    ? body.entries
    : Object.entries(body).map(([key, value]): Entry => [key, value]);

  const named: boolean = existing.some((entry) => !isBare(entry) && entry[0] === nameField);

  return named ? orderedEntries(existing) : orderedEntries([[nameField, id], ...existing]);
}

/** One definition on its way to a file, kept with the id it sorts by. */
interface DefinitionEntry {
  readonly id: string;
  readonly entry: Entry;
}

export function emit(mod: Mod, options: EmitOptions = {}): EmitPlan {
  const diagnostics: EmitDiagnostic[] = [];
  const grouped = new Map<string, DefinitionEntry[]>();
  const headers = new Map<string, Set<string>>();

  if (!/^v?\d+(?:\.(?:\d+|\*)){0,2}$/u.test(mod.options.supportedVersion)) {
    diagnostics.push({
      severity: "error",
      code: "malformed-supported-version",
      message: `supported_version must look like v4.4.* or 4.4.6, not ${mod.options.supportedVersion}. The launcher cannot read this one and will treat the mod as unsupported.`,
      path: "descriptor.mod",
    });
  } else if (!coversVersion(mod.options.supportedVersion, vanillaModsCompatibilityVersion)) {
    diagnostics.push({
      severity: "warning",
      code: "unsupported-game-version",
      message: `supported_version ${mod.options.supportedVersion} does not cover ${vanillaModsCompatibilityVersion}, which this build of the game asks for; the launcher will show the mod as out of date.`,
      path: "descriptor.mod",
    });
  }

  if (mod.options.name.length === 0) {
    diagnostics.push({
      severity: "error",
      code: "missing-mod-name",
      message: "A mod needs a name; the launcher lists it by that and dependencies name it by that.",
      path: "descriptor.mod",
    });
  }

  // The id becomes a folder name and a file name on every platform the game
  // runs on, so it has to be spellable on all of them.
  if (mod.options.id !== undefined && !/^[a-z0-9_]+$/u.test(mod.options.id)) {
    diagnostics.push({
      severity: "error",
      code: "malformed-mod-id",
      message: `id names the mod's folder and every file it writes, so it takes a-z, 0-9 and _ only, not ${mod.options.id}.`,
      path: "descriptor.mod",
    });
  }

  for (const definition of mod.definitions) {
    const path: string = targetFile(mod.options, definition);
    const bucket: DefinitionEntry[] = grouped.get(path) ?? [];

    if (definition.bareValue === true) {
      bucket.push({ id: definition.id, entry: bare(definition.id) });
    } else {
      const body: object =
        definition.nameField === undefined
          ? definition.body
          : withNameField(definition.nameField, definition.id, definition.body);
      bucket.push({ id: definition.id, entry: [definition.blockKey ?? definition.id, body] });
    }

    grouped.set(path, bucket);

    if (definition.headers !== undefined && definition.headers.length > 0) {
      const lines: Set<string> = headers.get(path) ?? new Set<string>();
      for (const line of definition.headers) {
        lines.add(line);
      }
      headers.set(path, lines);
    }

    if (definition.overrides !== undefined) {
      diagnostics.push({
        severity: "warning",
        code: "vanilla-override",
        message: `Replaces the vanilla file wholesale. Everything else it defined stops loading.`,
        path,
      });
    }
  }

  const files: EmittedFile[] = [];

  for (const [path, definitions] of [...grouped].sort((left, right) => compareOrdinal(left[0], right[0]))) {
    // Sorted by id so the same mod always emits the same bytes. Not by block
    // key: a tagged type writes many definitions under the same one.
    const sorted: readonly Entry[] = [...definitions]
      .sort((left, right) => compareOrdinal(left.id, right.id))
      .map((definition) => definition.entry);
    const preamble: readonly string[] = [...(headers.get(path) ?? [])].sort(compareOrdinal);
    const body: string = renderDefinitions(sorted);
    files.push({
      kind: "text",
      path,
      contents: preamble.length === 0 ? body : `${preamble.join("\n")}\n\n${body}`,
      byteOrderMark: false,
    });
  }

  const localisationSets: readonly (readonly [ReadonlyMap<string, readonly LocalisationEntry[]>, string])[] = [
    [mod.localisation, ""],
    // Read after every other localisation file, whatever else is installed.
    [mod.localisationReplacements, "replace/"],
  ];

  for (const [set, folder] of localisationSets) {
    for (const [language, entries] of set) {
      if (!LOCALISATION_LANGUAGES.includes(language)) {
        diagnostics.push({
          severity: "error",
          code: "unknown-language",
          message: `${language} is not a language the game ships; the file will not be read.`,
          path: `localisation/${language}`,
        });
        continue;
      }

      files.push({
        kind: "text",
        path: `localisation/${language.replace(/^l_/u, "")}/${folder}${localisationFileName(modSlug(mod.options), language)}`,
        contents: renderLocalisation(language, entries),
        byteOrderMark: true,
      });
    }
  }

  // Which paths were said to replace a vanilla file on purpose. A definition
  // says it by naming the file it overrides; a raw file or an asset says it in
  // the record, and until now saying it there did nothing at all.
  const intendedOverrides = new Set<string>(
    mod.definitions.map((definition) => definition.overrides).filter((path): path is string => path !== undefined),
  );

  for (const record of mod.files) {
    files.push({ kind: "text", path: record.path, contents: record.contents, byteOrderMark: false });

    if (record.overrides === true) {
      intendedOverrides.add(record.path);
    }
  }

  // An icon, a portrait, a sound. The game reads them from the same folder tree
  // as the script, so they belong in the same plan: a build that writes the
  // definitions and leaves the assets to a second pipeline is a build whose
  // output does not run.
  for (const asset of mod.assets) {
    files.push({ kind: "binary", path: asset.path, bytes: asset.bytes });

    if (asset.overrides === true) {
      intendedOverrides.add(asset.path);
    }
  }

  for (const path of intendedOverrides) {
    if (!mod.definitions.some((definition) => definition.overrides === path)) {
      diagnostics.push({
        severity: "warning",
        code: "vanilla-override",
        message: `Replaces the vanilla file wholesale. Everything else it defined stops loading.`,
        path,
      });
    }
  }

  // Two entries for one path is not a merge: writing is concurrent, so which of
  // them survives is decided by whichever finishes last. A raw file put where a
  // definition already lands is the way it happens.
  const byPath = new Set<string>();

  for (const file of files) {
    if (byPath.has(file.path)) {
      diagnostics.push({
        severity: "error",
        code: "duplicate-file",
        message: `Two files were emitted at ${file.path}. Only one of them would survive being written, and which one is not decided anywhere.`,
        path: file.path,
      });
    }
    byPath.add(file.path);
  }

  // A mod file that shadows a vanilla one disables everything else that file
  // defined. Detecting it needs the vanilla listing; say so when it is absent
  // rather than reporting a clean result that was never checked.
  const listing: Readonly<Record<string, readonly string[]>> = options.vanillaFiles ?? indexedVanillaFiles;

  if (Object.keys(listing).length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "collision-check-skipped",
      message: "The vanilla file listing was empty, so filename collisions with the base game were not checked.",
      path: "<emit>",
    });
  } else {
    for (const file of files) {
      const separator: number = file.path.lastIndexOf("/");
      const directory: string = separator < 0 ? "" : file.path.slice(0, separator);
      const name: string = file.path.slice(separator + 1);
      const known: readonly string[] | undefined = listing[directory];

      if (known?.includes(name) === true) {
        diagnostics.push({
          severity: intendedOverrides.has(file.path) ? "warning" : "error",
          code: "vanilla-filename-collision",
          message: `Vanilla ships ${directory}/${name}. Shipping the same name replaces it entirely; rename it, or set overrides to say the replacement is intended.`,
          path: file.path,
        });
      }
    }
  }

  // A `replace_path` naming a directory the game does not have hides nothing,
  // and reads as a working override until someone checks.
  for (const path of mod.options.replacePaths ?? []) {
    const normalised: string = path.replaceAll("\\", "/").replace(/\/+$/u, "");

    if (Object.keys(listing).length > 0 && listing[normalised] === undefined) {
      diagnostics.push({
        severity: "error",
        code: "unknown-replace-path",
        message: `replace_path names ${normalised}, which the base game does not load from. Nothing would be replaced.`,
        path: "descriptor.mod",
      });
      continue;
    }

    diagnostics.push({
      severity: "warning",
      code: "replaces-vanilla-directory",
      message: `${normalised} is hidden from the base game entirely. Every definition vanilla kept there stops loading unless this mod supplies it.`,
      path: "descriptor.mod",
    });
  }

  files.push({
    kind: "text",
    path: "descriptor.mod",
    contents: renderDescriptor(mod.options, undefined),
    byteOrderMark: false,
  });

  return {
    files: files.sort((left, right) => compareOrdinal(left.path, right.path)),
    diagnostics,
    descriptorPath: "descriptor.mod",
    modFileName: `${modSlug(mod.options)}.mod`,
  };
}

/** The `.mod` file that sits beside the folder and points the launcher at it. */
export function renderModFile(options: ModOptions, modDirectoryPath: string): string {
  return renderDescriptor(options, modDirectoryPath.replaceAll("\\", "/"));
}
