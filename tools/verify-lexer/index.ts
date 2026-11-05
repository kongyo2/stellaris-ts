import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { requireGamePath } from "../game-path.js";
import { GAME_TOKEN_IDS, OPERATOR_WORDS, TokenKind, tokenize } from "../../src/syntax/index.js";
import type { Token } from "../../src/syntax/index.js";
import {
  caseTokenIds,
  findCharacterTables,
  findRegistrations,
  findString,
  readPortableExecutable,
  rvaOf,
  sectionNamed,
  TABLE_WIDTH,
} from "./exe.js";
import type { CharacterTable } from "./exe.js";

/**
 * Whether the lexer still splits script where the installed game does.
 *
 * `src/syntax` was written from the 4.4.6 executable and re-read from 4.5.2's.
 * An update that changed what ends a token, which character starts a comment or
 * which id an operator word carries would leave every other gate green: they
 * all parse with this lexer, so they would agree with it. This one asks the
 * executable instead, by its bytes, and holds `tokenize` to what it says.
 */

const failures: string[] = [];
const fail = (message: string): void => {
  failures.push(message);
  console.error(`LEXER ${message}`);
};

const gamePath: string = requireGamePath();
const executable: string = join(gamePath, "stellaris.exe");

if (!existsSync(executable)) {
  // The Linux and macOS builds ship a different binary format. Saying so is
  // the point: a gate that did not run must not read as one that passed.
  console.log(`SUMMARY mode=lexer skipped=no-windows-executable path=${executable}`);
  process.exit(0);
}

const bytes: Uint8Array = readFileSync(executable);
const image = readPortableExecutable(bytes);

if (image === undefined) {
  console.error(`LEXER ${executable} is not a 64-bit PE file.`);
  process.exit(1);
}

const text = sectionNamed(image, ".text");
const rdata = sectionNamed(image, ".rdata");

if (text === undefined || rdata === undefined) {
  console.error("LEXER the executable has no .text or no .rdata section.");
  process.exit(1);
}

const hex = (value: number | undefined): string => (value === undefined ? "?" : `0x${value.toString(16)}`);
const sorted = (characters: Iterable<string>): string => [...characters].sort().join(" ");

// 1. The punctuation, read out of the tables rather than assumed.
const tables: readonly CharacterTable[] = findCharacterTables(bytes, text.rawOffset, text.rawOffset + text.rawSize);
const enders = tables.filter(
  (table) => table.defaultCase === 1 && [...table.cases.values()].every((entry) => entry === 0),
);
// The first-character table is the many-valued one whose own switch can be
// read: other tables over the same range (the `@[ ]` expression tokenizer's,
// for one) share its shape but not its handlers.
const classifiers = tables.filter((table) => !enders.includes(table) && caseTokenIds(image, table) !== undefined);
const classifier: CharacterTable | undefined = classifiers.length === 1 ? classifiers[0] : undefined;

if (classifier === undefined) {
  fail(
    `expected one first-character table in .text and found ${String(classifiers.length)}: ${classifiers.map((table) => hex(rvaOf(image, table.offset))).join(", ") || "none"}.`,
  );
}

if (enders.length === 0) {
  fail("found no table that ends a bare token.");
}

const gamePunctuation: ReadonlySet<string> = new Set(classifier?.cases.keys() ?? []);

for (const table of enders) {
  const ends = new Set(table.cases.keys());
  if (sorted(ends) !== sorted(gamePunctuation)) {
    fail(
      `the token-end table at RVA ${hex(rvaOf(image, table.offset))} ends a token on ${sorted(ends)}, and the first-character table sends ${sorted(gamePunctuation)} away from the default.`,
    );
  }
}

// 2. `tokenize` splits on exactly those characters, over the range the tables cover.
const significant = (source: string): readonly Token[] =>
  tokenize(source).tokens.filter(
    (token) =>
      token.kind !== TokenKind.Whitespace && token.kind !== TokenKind.Newline && token.kind !== TokenKind.EndOfFile,
  );

const lexerPunctuation = new Set<string>();

for (let code = 0x21; code < 0x21 + TABLE_WIDTH; code += 1) {
  const character: string = String.fromCharCode(code);
  if (significant(`a${character}b`).length > 1) {
    lexerPunctuation.add(character);
  }
}

if (classifier !== undefined && sorted(lexerPunctuation) !== sorted(gamePunctuation)) {
  fail(`tokenize ends a bare token on ${sorted(lexerPunctuation)}; the game on ${sorted(gamePunctuation)}.`);
}

// 3. What each punctuation mark starts, by the id its handler loads.
const ids: ReadonlyMap<string, number> | undefined =
  classifier === undefined ? undefined : caseTokenIds(image, classifier);
let handlersChecked = 0;

if (classifier !== undefined && ids === undefined) {
  fail(
    `could not read the case handlers behind the first-character table at RVA ${hex(rvaOf(image, classifier.offset))}.`,
  );
}

for (const [character, id] of ids ?? []) {
  const kind: string | undefined = significant(character)[0]?.kind;
  const expected: number | undefined = kind === undefined ? undefined : GAME_TOKEN_IDS[kind];
  handlersChecked += 1;

  if (expected !== id) {
    fail(
      `the game starts token ${String(id)} at ${JSON.stringify(character)}; tokenize starts ${kind ?? "nothing"} (${String(expected)}).`,
    );
  }
}

// `#` and `;` reach the same handler, which reads to the end of the line.
if (classifier !== undefined && classifier.cases.get("#") !== classifier.cases.get(";")) {
  fail("the game no longer sends `#` and `;` to the same case.");
}

// 4. The operator words, and the id the registry gives each.
const registrations = findRegistrations(image, text);
let wordsChecked = 0;
let registry: number | undefined;

for (const [word, kind] of OPERATOR_WORDS) {
  const at: number | undefined = findString(bytes, word, rdata.rawOffset, rdata.rawOffset + rdata.rawSize);
  const rva: number | undefined = at === undefined ? undefined : rvaOf(image, at);
  const registration = registrations.find((entry) => entry.word === rva);

  if (registration === undefined) {
    fail(`found no registration of the keyword ${JSON.stringify(word)}.`);
    continue;
  }

  registry ??= registration.callee;
  wordsChecked += 1;

  if (registration.id !== GAME_TOKEN_IDS[kind]) {
    fail(
      `the game registers ${JSON.stringify(word)} as ${String(registration.id)}; tokenize reads it as ${kind} (${String(GAME_TOKEN_IDS[kind])}).`,
    );
  }

  // The lookup folds ASCII case.
  for (const spelling of [word, word.toUpperCase()]) {
    if (significant(`a ${spelling} 1`)[1]?.kind !== kind) {
      fail(`tokenize does not read ${JSON.stringify(spelling)} as ${kind}.`);
    }
  }
}

const keywords: number = registrations.filter((entry) => entry.callee === registry).length;
const version: string =
  /"rawVersion"\s*:\s*"([^"]+)"/u.exec(readFileSync(join(gamePath, "launcher-settings.json"), "utf8"))?.[1] ??
  "unknown";

console.log(
  [
    "SUMMARY mode=lexer",
    `version=${version}`,
    `sha256=${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`,
    `firstCharacterTable=${hex(classifier === undefined ? undefined : rvaOf(image, classifier.offset))}`,
    `tokenEndTables=${enders.map((table) => hex(rvaOf(image, table.offset))).join(",") || "none"}`,
    `punctuation=${String(gamePunctuation.size)}`,
    `handlers=${String(handlersChecked)}`,
    `operatorWords=${String(wordsChecked)}/${String(OPERATOR_WORDS.size)}`,
    `keywords=${String(keywords)}`,
    `mismatches=${String(failures.length)}`,
  ].join(" "),
);

if (failures.length > 0) {
  process.exitCode = 1;
}
