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
