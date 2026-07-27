import { vanillaFiles as indexedVanillaFiles } from "../generated/vanilla/files.js";
import { renderDefinitions } from "./build.js";
import { localisationFileName, renderLocalisation, LOCALISATION_LANGUAGES } from "./localisation.js";
import type { DefinitionRecord, Mod, ModOptions } from "./mod.js";

/**
 * Lays a mod out as files.
 *
 * Emitting is deliberately separate from writing to disk: the plan can be
 * inspected, diffed and tested without a filesystem, and the CLI writes it.
 */

export interface EmittedFile {
  readonly path: string;
  readonly contents: string;
  /** UTF-8 with a BOM. Only localisation needs it, and it needs it absolutely. */
  readonly byteOrderMark: boolean;
}

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
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "_")
      .replace(/^_+|_+$/gu, "") || "mod"
  );
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

  return `${definition.directory}/zz_${slug(mod.name)}_${definition.type}.txt`;
}

function renderDescriptor(options: ModOptions, includePath: string | undefined): string {
  const lines: string[] = [`version="${options.version}"`];

  if (options.tags !== undefined && options.tags.length > 0) {
    lines.push("tags={", ...options.tags.map((tag) => `\t"${tag}"`), "}");
  }

  lines.push(`name="${options.name}"`, `supported_version="${options.supportedVersion}"`);

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

export function emit(mod: Mod, options: EmitOptions = {}): EmitPlan {
  const diagnostics: EmitDiagnostic[] = [];
  const grouped = new Map<string, [string, object][]>();

  for (const definition of mod.definitions) {
    const path: string = targetFile(mod.options, definition);
    const bucket: [string, object][] = grouped.get(path) ?? [];
    bucket.push([definition.id, definition.body]);
    grouped.set(path, bucket);

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
    // Sorted by id so the same mod always emits the same bytes.
    const sorted: readonly [string, object][] = [...definitions].sort((left, right) =>
      compareOrdinal(left[0], right[0]),
    );
    files.push({ path, contents: renderDefinitions(sorted), byteOrderMark: false });
  }

  for (const [language, entries] of mod.localisation) {
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
      path: `localisation/${language.replace(/^l_/u, "")}/${localisationFileName(mod.options.name, language)}`,
      contents: renderLocalisation(language, entries),
      byteOrderMark: true,
    });
  }

  for (const record of mod.files) {
    files.push({ path: record.path, contents: record.contents, byteOrderMark: false });
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
          severity: mod.definitions.some((definition) => definition.overrides === file.path) ? "warning" : "error",
          code: "vanilla-filename-collision",
          message: `Vanilla ships ${directory}/${name}. Shipping the same name replaces it entirely; rename it, or set overrides to say the replacement is intended.`,
          path: file.path,
        });
      }
    }
  }

  files.push({
    path: "descriptor.mod",
    contents: renderDescriptor(mod.options, undefined),
    byteOrderMark: false,
  });

  return {
    files: files.sort((left, right) => compareOrdinal(left.path, right.path)),
    diagnostics,
    descriptorPath: "descriptor.mod",
    modFileName: `${slug(mod.options.name)}.mod`,
  };
}

/** The `.mod` file that sits beside the folder and points the launcher at it. */
export function renderModFile(options: ModOptions, modDirectoryPath: string): string {
  return renderDescriptor(options, modDirectoryPath.replaceAll("\\", "/"));
}
