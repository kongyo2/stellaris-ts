## CP1 — Foundation
- 検証: `npm run format:check && npm run lint:strict && npm run lint:types && npm run typecheck:ci` → exit 0; `npm run verify` は 1–6 成功 / 7–8 skip
- 残り: CP2 Lexer と全対象ファイルの tokenization
- ブロック: なし
- 所見: `oxlint-tsgolint` の要件により TypeScript 7.0.2 を確定し、type-aware lint は各 `tsconfig.json` を自動検出する構成にした

## CP2 — Lexer
- 検証: `npm run verify:roundtrip -- --tokenize-only` → 2,213 files / 9,307,904 tokens / 84 BOM / 337 CRLF / 0 unknown / 0 diagnostics / 0 coverage issues
- 残り: CP3 AST / Parser と診断ゼロの全数 parse
- ブロック: なし
- 所見: `@\[` が 22 例あり lossless に保持した; `common/scripted_loc/scripted_loc_ruloc.txt` の末尾に閉じ波括弧欠落が 1 例あり CP3 で分類する

## CP3 — Parser
- 検証: `npm run verify:roundtrip -- --parse-only` → 2,213 files / 2,210 success / 3 excluded / 0 failed / 0 diagnostics
- 残り: CP4 deterministic Printer と構造 round-trip 比較
- ブロック: なし
- 所見: root の bare tags / anonymous block / prefixed block と `@\[` を実コーパスに合わせて汎用 AST で保持した

## CP4 — Printer / Round-trip
- 検証: `npm run verify:roundtrip` → 2,213 files / 2,210 success / 3 excluded / 0 failed / 0 mismatches / 0 output issues
- 残り: CP5 byte-preserved fixtures と CI regression coverage
- ブロック: なし
- 所見: canonical tab indentation、BOM なし、LF 出力で comment を保持し、trivia/span を除く構造同値を証明した

## CP5 — CI Regression
- 検証: `npm run test` → 4 files / 30 tests; `npm run typecheck:test:ci` → exit 0
- 残り: CP6 package-consumer probe と最終 aggregate verification
- ブロック: なし
- 所見: 10 fixtures / 9,908 bytes を SHA-256 固定し、BOM・CRLF・4 corpus roots と strict indexed access を回帰化した

## CP6 — Public Gate
- 検証: `npm run verify` → 8/8 exit 0; package `stellaris-ts-0.1.0.tgz` Node / NodeNext tsc ともに成功
- 残り: なし
- ブロック: なし
- 所見: source-derived tar file set、types-first exports、runtime dependency なし、公開 subpath と deep-import 遮断を実 consumer で証明した

## Phase 2 CP1 — Corpus and Publication Gates
- Proof: `npm run verify` → 10/10 exit 0; round-trip covered 2,214 files with 2,211 successes and 3 documented exclusions.
- Scope: the extensionless script is included; only 2 CSV, 1 JSON, and 2 ODS files are filtered; ATTW and publint pass.
- Blockers: none; next is the one-shot CWTools reader.

## Phase 2 CP2 — CWT Reader
- Proof: `npm run import:cwt` → 101 files / 44,370 terminators / 0 unknown syntax / 1 recorded recovery; 9 focused tests pass.
- Counts: 234 type declarations, 207 enum names, 912/818 trigger/effect aliases, 171 link blocks (86 declarations), 41 scopes.
- Blocker: PLAN treats 449 types and 171 links as semantic IR counts; the source has 234 type and 86 link declarations.

## Phase 2 CP2 Audit — Structural Counts
- Proof: structural recount → type 234/234 unique; subtype 257 declarations under 45 types + 112 references = 369 constructs.
- Enums: 180 fixed declarations/179 names + 28 derived declarations/27 names = 206 declared names; the former 207 mixed matchers.
- Links: 86 declarations / 85 names; the former 171 counted the wrapper and 84 nested `input_scopes` blocks.

## Phase 2 CP3 — Schema IR
- Proof: four hand-authored MVP definitions pass source/test typechecks, strict and typed lint, and 3 focused IR tests.
- Design: ordered rules retain duplicate keys; variants remain nested; enums/scopes are literal-checked; global inline scripts are explicit policy.
- Documentation: `docs/schema-ir.md` records source routing, extraction, scope/command vocabulary, and intentional departures from CWT.
- Blockers: none; next is the one-shot full import and `verify:schema`.

## Phase 2 CP4 — Schema Import
- Proof: `npm run import:cwt -- --emit` emits 234 definitions / 206 enums / 86 links with opaque=0 and 0 emit diagnostics; `npm run verify` is 11/11 exit 0.
- Remaining: CP5 refs-independence proof, CP6 vanilla conformance harness.
- Blockers: none.
- Notes: `<modifier>` is the modifier alias family rather than a declared type, so the IR gained `modifierRef()`. Coverage floors are now measured values with their counting definition recorded, replacing two estimates.

## Phase 2 CP5 — Reference Independence
- Proof: `npm run verify:norefs` parks `refs/`, builds and typechecks clean, restores it, and reports 0 leaks; `npm run verify` is 12/12 exit 0.
- Remaining: CP6 vanilla conformance harness, CP7 closing the MVP gaps.
- Blockers: none.
- Notes: mutation-tested the new gate both ways — a `refs/` string in `src/` and a `refs` entry in `package.json` `files` each fail it.

## Phase 2 CP4b — Commands, Rule Sets and Dynamic Sets
- Proof: `npm run import:cwt -- --emit` now emits 2,339 commands, 187 rule sets, 42 value sets, 37 named values and 7 scope groups alongside the 234 definitions, all with opaque=0; `npm run verify` is 12/12 exit 0.
- Remaining: CP6 vanilla conformance harness, CP7 closing the MVP gaps.
- Blockers: none.
- Notes: triggers and effects were never being imported — the reader counted them but nothing translated the root-level `alias[family:name]` declarations, whose value is usually a bare scalar rather than a block. 2,339 object literals in one array hit TS2590, fixed by routing each through an identity constructor with an explicit return type. 21 diagnostics remain and are holes in the cwt corpus itself; they are recorded with a budget the gate enforces rather than suppressed.

## Phase 3 CP6 — Vanilla Conformance
- Proof: `npm run verify:conformance` checks 229 types against v4.4.6 and writes `docs/schema-conformance.md`; `npm run verify` is 13/13 exit 0.
- Findings: 1,132 fields vanilla uses that the schema rejects, across 36 types; 312 rules vanilla never exercises. These are holes in the ported corpus, now visible.
- Remaining: CP7 closing the MVP gaps, which needs the extracted-enum members from Phase 8 before building/event/trait can be checked strictly.
- Blockers: none.
- Notes: three of the four gated types are permissive, so their zero unknown fields proves nothing. The gate says so out loud and pins the strict count at 1 rather than reporting a clean pass it has not earned.

## Phase 8 (partial) + Phase 3 CP7 — Game Index and MVP Conformance
- Proof: `npm run index:game` indexes 59,802 identifiers across 214 types and 2,468 members across 25 extracted enums from 23,228 files; `npm run verify` is 13/13 exit 0 with gatedStrict=4/4, gatedPermissive=none, gatedUnknownFields=0.
- Remaining: Phase 4 codegen, Phase 5 mod output, Phase 6 scope DSL, Phase 7 CLI, Phase 9 publish.
- Blockers: none.
- Notes: three defects surfaced and were fixed. Extraction routes were being applied at the file root, but 26 of the 27 extracted enums describe a path relative to each definition — one enum resolved before, 25 after. The conformance acceptor treated every rule-set and script expansion as accepting anything, when both families have known key sets; resolving them took strict types from 181 to 220 and the gated four from 1/4 to 4/4. Root-level `inline_script` blocks were being counted as definitions, which reported 32 phantom holes in `event`. What survived was two genuine holes in the ported corpus — `trait.forced_integration` and `event.notification_event_icon_frame`, both used by vanilla 4.4.6 and absent from cwt — now hand-added and locked by a test.

## Phase 4 — Definition Types
- Proof: `npm run codegen` emits 234 definition interfaces with 4,777 properties and 246 literal unions; `npm run verify` is 13/13 exit 0 at 0.69s check time over 178,866 lines.
- Remaining: builders and the scope DSL, then Phase 5 mod output.
- Blockers: none.
- Notes: one `as const` object holding all 59,802 identifiers exceeded what the compiler will serialise, so the type side (a union alias per definition type) and the value side (an annotated array) are emitted separately, and four types past 3,000 identifiers widen to `string`. Quoted scalars were carrying their quotes into identifiers, enum members and literal types, producing types like `"\"x\""` that match nothing writable. The test locking the two hand corrections caught a re-import dropping them, which is exactly what it was for; corrections now live outside the directory the importer rewrites.

## Phase 5 — Mod Output
- Proof: `npm run verify` is 13/13 exit 0 with 63 tests; a two-definition example written to the real mod folder produces a descriptor, a launcher `.mod`, tab-indented script matching vanilla's shape, and localisation with a BOM and LF.
- Remaining: Phase 6 scope DSL, Phase 7 CLI, Phase 9 publish.
- Blockers: launching the game to confirm in-game behaviour is outside what can be automated here; the emitted bytes match the vanilla format verified exhaustively in Phase 1.
- Notes: the indexer now also records every vanilla file name per directory, so the filename-collision check is on by default rather than something a caller has to supply. Generated definition interfaces have no index signature and so are not assignable to a `Record`; rather than cast, the builder takes `object` and the AST walk rejects anything PDX cannot express, naming the offending key.

## Phase 7 — Validator and CLI
- Proof: `npm run verify` is 13/13 exit 0 with 68 tests; the CLI reports an unknown field as an error and missing strings as warnings, and exits 1.
- Remaining: Phase 6 scope DSL, Phase 9 skill docs and publish.
- Blockers: none.
- Notes: the validator catches what the game silently ignores — an unknown field, a duplicate id where only the last one loads, a required string that would ship as its own key, a reference to something neither vanilla nor the mod defines. A definition type with open rules accepts arbitrary keys at the type level by design, so those checks belong here rather than in the generated types; narrowing the type instead would reject script the game accepts.

