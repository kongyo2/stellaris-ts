import type { LocalisationEntry } from "./localisation.js";

/**
 * A mod under construction.
 *
 * Definitions are collected with the directory the game loads them from, and
 * with the file they should land in. File placement is not cosmetic: Stellaris
 * replaces a vanilla file wholesale when a mod ships one of the same name, so
 * the default name is prefixed to make that impossible by accident, and
 * overwriting has to be asked for.
 */

export interface ModOptions {
  readonly name: string;
  /**
   * The name the mod's own files are called after: its folder, its `.mod` file
   * and the prefix on every script file it writes.
   *
   * Defaults to the display name reduced to `a-z0-9_`, which is what most mods
   * would pick anyway. A name written in Japanese, Russian or Chinese reduces to
   * nothing, and two of those would otherwise both write
   * `common/buildings/zz_mod_building.txt` and silently replace each other, so
   * the default carries a marker taken from the name when that happens. Set this
   * to choose the name yourself.
   */
  readonly id?: string;
  readonly version: string;
  /** Which game versions this mod declares support for, e.g. `v4.4.*`. */
  readonly supportedVersion: string;
  readonly tags?: readonly string[];
  /** Steam Workshop id, if this mod has been published there. */
  readonly remoteFileId?: string;
  readonly picture?: string;
  /**
   * Mods this one must load after, by the exact `name` in their descriptor.
   *
   * Load order is otherwise alphabetical by folder, which is not something a
   * dependent mod can rely on. Naming a mod here also makes the launcher warn
   * when it is missing.
   */
  readonly dependencies?: readonly string[];
  /**
   * Game directories to hide from the base game entirely.
   *
   * A mod's file is added to a directory, not merged into it, so there is no
   * other way to *remove* a vanilla definition. `replace_path = "common/buildings"`
   * makes the game read no vanilla file from there at all, which is drastic:
   * every definition that directory held is gone unless this mod supplies it.
   */
  readonly replacePaths?: readonly string[];
}

export interface DefinitionRecord {
  readonly type: string;
  readonly directory: string;
  readonly id: string;
  readonly body: object;
  readonly file?: string;
  readonly overrides?: string;
  /**
   * The block key, when the type is written under a tag rather than its id.
   *
   * `country_event = { id = utopia.1 }`: the key says what kind, the name field
   * says which one. Writing the id as the key instead parses and defines
   * nothing.
   */
  readonly blockKey?: string;
  /** The field inside the block that carries the id, for a tagged type. */
  readonly nameField?: string;
  /**
   * Written as the identifier alone, with no block after it.
   *
   * `common/job_tags` and `common/trait_tags` are lists of words: the word is
   * the definition. Writing `my_tag = { }` there parses and defines nothing.
   */
  readonly bareValue?: boolean;
  /**
   * Which of the type's variants this is.
   *
   * A country event and a planet event are one type with one set of fields and
   * two different scopes; the block key is what says which, and the scope is
   * what every trigger inside is checked against.
   */
  readonly variant?: string;
  /** Lines the file needs before any definition, such as an event namespace. */
  readonly headers?: readonly string[];
}

/**
 * Says the vanilla file of the same name is meant to be replaced.
 *
 * Shipping a file vanilla already ships disables everything else that file
 * defined, which is reported as an error precisely because it is usually an
 * accident. Sometimes it is the whole point — replacing an interface file, or a
 * `.dds` the base game draws — and this is how to say so.
 */
export interface OverrideOption {
  readonly overrides?: boolean;
}

export interface RawFileRecord extends OverrideOption {
  readonly path: string;
  readonly contents: string;
}

/**
 * A file the mod ships that is not text.
 *
 * Icons are `.dds`, portraits are `.dds`, sounds are `.wav`. A definition whose
 * icon is absent draws the missing-texture square wherever it appears, so a
 * build that can only write script writes a mod that visibly does not work.
 */
export interface AssetRecord extends OverrideOption {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export class Mod {
  readonly options: ModOptions;
  readonly #definitions: DefinitionRecord[] = [];
  readonly #localisation = new Map<string, Map<string, LocalisationEntry>>();
  readonly #replacements = new Map<string, Map<string, LocalisationEntry>>();
  readonly #files: RawFileRecord[] = [];
  readonly #assets: AssetRecord[] = [];

  constructor(options: ModOptions) {
    this.options = options;
  }

  add(definition: DefinitionRecord): this {
    this.#definitions.push(definition);
    return this;
  }

  /** Adds a localisation string. Later writes to the same key win. */
  localise(language: string, key: string, value: string, version?: number): this {
    const bucket: Map<string, LocalisationEntry> = this.#localisation.get(language) ?? new Map();
    bucket.set(key, version === undefined ? { key, value } : { key, value, version });
    this.#localisation.set(language, bucket);
    return this;
  }

  /**
   * Overrides a string the base game already defines.
   *
   * An ordinary localisation file cannot do it: the game reads every file and
   * the winner is decided by load order, which a mod does not control. Files
   * under `localisation/<language>/replace/` are read last, whatever else is
   * installed, and that is the one place an override is reliable.
   */
  localiseReplace(language: string, key: string, value: string, version?: number): this {
    const bucket: Map<string, LocalisationEntry> = this.#replacements.get(language) ?? new Map();
    bucket.set(key, version === undefined ? { key, value } : { key, value, version });
    this.#replacements.set(language, bucket);
    return this;
  }

  /** Adds a file verbatim, for content this library has no definition type for. */
  file(record: RawFileRecord): this {
    this.#files.push(record);
    return this;
  }

  /**
   * Adds a file the mod ships as bytes: an icon, a portrait, a sound.
   *
   * The path is relative to the mod folder and is written exactly as given —
   * `gfx/interface/icons/buildings/my_lab.dds` — because where an asset has to
   * sit is decided by the interface files that name it, not by this library.
   */
  asset(path: string, bytes: Uint8Array, options: OverrideOption = {}): this {
    this.#assets.push({ path, bytes, ...options });
    return this;
  }

  get definitions(): readonly DefinitionRecord[] {
    return this.#definitions;
  }

  get files(): readonly RawFileRecord[] {
    return this.#files;
  }

  get assets(): readonly AssetRecord[] {
    return this.#assets;
  }

  get localisation(): ReadonlyMap<string, readonly LocalisationEntry[]> {
    return new Map([...this.#localisation].map(([language, bucket]) => [language, [...bucket.values()]]));
  }

  get localisationReplacements(): ReadonlyMap<string, readonly LocalisationEntry[]> {
    return new Map([...this.#replacements].map(([language, bucket]) => [language, [...bucket.values()]]));
  }
}

export function defineMod(options: ModOptions): Mod {
  return new Mod(options);
}
