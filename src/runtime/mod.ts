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

export interface RawFileRecord {
  readonly path: string;
  readonly contents: string;
  readonly overrides?: string;
}

export class Mod {
  readonly options: ModOptions;
  readonly #definitions: DefinitionRecord[] = [];
  readonly #localisation = new Map<string, Map<string, LocalisationEntry>>();
  readonly #replacements = new Map<string, Map<string, LocalisationEntry>>();
  readonly #files: RawFileRecord[] = [];

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

  get definitions(): readonly DefinitionRecord[] {
    return this.#definitions;
  }

  get files(): readonly RawFileRecord[] {
    return this.#files;
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
