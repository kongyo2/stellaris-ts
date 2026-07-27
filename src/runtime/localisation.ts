/**
 * Writes Stellaris localisation files.
 *
 * The format only looks like YAML. Indentation carries no meaning, values are
 * always quoted, and the file must start with a UTF-8 BOM — vanilla ships 2,318
 * of these and not one lacks it. A YAML library gets all three wrong, so this is
 * written by hand.
 *
 * Vanilla itself is inconsistent about the rest (leading space present or not,
 * version number present or not), so reading has to accept every form while
 * writing picks one and stays there.
 */

export const BYTE_ORDER_MARK = "\uFEFF";

/** The languages the game ships. A file must be named for one of them. */
export const LOCALISATION_LANGUAGES: readonly string[] = [
  "l_braz_por",
  "l_english",
  "l_french",
  "l_german",
  "l_japanese",
  "l_korean",
  "l_polish",
  "l_russian",
  "l_simp_chinese",
  "l_spanish",
];

export interface LocalisationEntry {
  readonly key: string;
  readonly value: string;
  /** The game's own version marker. Vanilla uses 0 almost everywhere. */
  readonly version?: number;
}

function escapeValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\r\n", "\\n").replaceAll("\n", "\\n");
}

/**
 * Renders one language's file.
 *
 * Emits the majority form: a BOM, the language header, then one entry per line
 * with a single leading space and an explicit version number.
 */
export function renderLocalisation(language: string, entries: readonly LocalisationEntry[]): string {
  const lines: string[] = [`${language}:`];

  for (const entry of [...entries].sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))) {
    lines.push(` ${entry.key}:${String(entry.version ?? 0)} "${escapeValue(entry.value)}"`);
  }

  return `${BYTE_ORDER_MARK}${lines.join("\n")}\n`;
}

export function localisationFileName(modName: string, language: string): string {
  const stem: string = modName
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return `${stem.length === 0 ? "mod" : stem}_${language}.yml`;
}
