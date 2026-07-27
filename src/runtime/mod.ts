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
}

export interface DefinitionRecord {
  readonly type: string;
  readonly directory: string;
  readonly id: string;
  readonly body: object;
  readonly file?: string;
  readonly overrides?: string;
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
}

export function defineMod(options: ModOptions): Mod {
  return new Mod(options);
}
