# Repository Guidelines

## Project Structure & Module Organization

- `src/` contains the publishable TypeScript library. Keep the L0 PDX syntax implementation in `src/syntax/` and
  expose public APIs through the package subpaths defined in `package.json`.
- `src/schema/` contains the self-owned L1 IR. Files under `src/schema/definitions/` are committed, hand-editable
  source after import, not generated artifacts; keep the design rationale in `docs/schema-ir.md`.
- `tools/` contains development-only Node.js utilities. It is outside the library's `rootDir`, is checked with
  `tools/tsconfig.json`, and must not be published.
- `tests/` contains Vitest suites. `tests/fixtures/` contains byte-preserved extracts from Stellaris and must not be
  reformatted or line-ending-normalized.
- `refs/` is ignored, disposable migration input. Only development tools may read it; library builds, verification
  other than import auditing, and runtime code must remain green when it is absent.
- `src/generated/`, `dist/`, and coverage output are generated artifacts. Fix generators rather than hand-editing
  generated source.
- `src/schema/` is different: it was imported **once** from cwtools-stellaris-config and is now maintained by hand.
  `npm run import:cwt -- --check` proposes a diff after an upstream refresh; it must never be wired to apply
  automatically. Nothing under `src/` may read `.cwt` at build or run time (PLAN.md §0.1).
- `PLAN.md` is the sole implementation specification. Work through its checkpoints in order.

## AGENTS.md Maintenance Policy

Update this file in the same commit whenever repository structure, scripts, verification gates, or coding conventions
change. Treat stale guidance as a defect: add, remove, or revise the affected command and path descriptions as part of
the change that made them stale. Keep this document concise, English-only, and consistent with `PLAN.md`.

## Build, Test, and Development Commands

- `npm run build` emits the publishable ESM library and declarations into `dist/`.
- `npm run format` formats repository-owned source with Prettier; `npm run format:check` is the read-only gate.
- `npm run lint` runs the fast Oxlint loop in agent format, while `npm run lint:fix` applies safe fixes.
- `npm run lint:strict` denies warnings, and `npm run lint:types` runs the additional type-aware Oxlint gate. Compiler
  diagnostics remain in the separate TypeScript gates.
- `npm run typecheck` checks library source without emitting. `npm run typecheck:ci`, `npm run typecheck:test`, and
  `npm run typecheck:test:ci` cover cache-free and test-specific configurations.
- `npm run typecheck:tools` checks development utilities through `tools/tsconfig.json`; `typecheck:tools:ci` is its
  cache-free gate and is included in aggregate verification.
- `npm run test` runs Vitest and fails when no tests are discovered.
- `npm run verify:norefs` parks `refs/`, rebuilds and typechecks without it, then restores it, and greps the shipped
  surface for any path that would reintroduce the dependency. This is what makes PLAN.md §0.1 checkable rather than a
  promise.
- `npm run verify:schema` checks the schema IR against itself: every enum, scope and definition type a rule points at
  must exist, and coverage must not fall below the importer's measured counts.
- `npm run import:cwt` reads the cwt corpus and prints structural counts; `-- --emit` rewrites the schema sources and
  `-- --check` reports what would change without writing. Requires `npm run refs:sync` first.

## Counting Definitions

Numbers that gate the build carry the definition that produced them, because a number without one gets re-derived
differently later. The importer's structural output is canonical; prose in `PLAN.md` is not.

- definition types **234** — `type[x] = {` declarations
- enums **206** — static (179) plus complex (27) declarations
- scopes **41** — blocks directly inside `scopes = { }`
- links **86 declared / 85 unique** — blocks directly inside `links = { }`; `last_created_pop_faction` is declared twice
- variants **257** — `subtype[x] = {` declarations, excluding the 112 references in localisation and schema selectors
- `npm run verify` is the authoritative aggregate gate. It covers format, strict lint, typed lint, CI source and test
  checking, tests, full-game round-trip, the package-consumer probe, and strict package publication linting.
- `npm run verify:roundtrip -- --tokenize-only` proves lossless lexical coverage, `--parse-only` proves parsing, and no
  arguments runs full structural round-trip for every non-excluded file under the four corpus roots except `.json`,
  `.csv`, and `.ods` files.
- `npm run verify:pack` builds and packs the publishable files, installs the tarball offline into a temporary consumer,
  and proves both Node ESM execution and TypeScript NodeNext resolution.
- `npm run verify:publish` builds and checks the packed package with both `attw --pack .` and `publint --strict`;
  `.attw.json` selects ATTW's `esm-only` profile to match the package's intentional ESM-only exports.
- `npm run refs:sync` clones the fixed CWTools source into ignored `refs/` for Phase 2 one-shot import work only.
- `npm run import:cwt` audits every `.cwt` file in that ignored checkout through a source-position-preserving adapter
  over the L0 parser. It fails on unknown syntax or count drift and records, rather than hides, upstream recoveries.
- CWT coverage counts are structural: a type is a block-valued `type[x]` directly under `types`; a subtype declaration
  is a block-valued `subtype[x]` directly under that type; fixed and derived enums are direct `enum[x]` and
  `complex_enum[x]` children of `enums`; links are direct children of `links`. References and nested selectors never
  increase declaration baselines. The pinned import baseline is 234 types, 257 subtypes under 45 types, 179 fixed plus
  27 derived unique enum names, and 86 link declarations / 85 unique names.

## Coding Style & Naming Conventions

- Write source, generated source, documentation, and comments in English. Use `camelCase` for values and functions,
  `PascalCase` for types, and kebab-case for package subpaths and script-oriented filenames.
- Prettier owns formatting. Oxlint owns correctness, suspicious-code, and performance diagnostics; do not move style
  enforcement into the linter.
- Use TypeScript 7.0.x, not TypeScript 6. `oxlint-tsgolint`, the required typed-lint runtime, requires TypeScript 7.0 or
  later, so choosing TypeScript 6 would also mean abandoning the typed-lint gate. The project generates code with its
  own deterministic string emitter and does not use the JavaScript TypeScript compiler API, `typescript-eslint`, or
  `ts-morph`; therefore TypeScript 7's missing compiler API is not a blocker. Oxlint and `oxlint-tsgolint` are pinned
  together. Revisit this decision only if a required tool begins importing the compiler API.
- Follow the strict TypeScript configuration without local escapes. `erasableSyntaxOnly` forbids `enum`; use an
  `as const` object plus `(typeof Value)[keyof typeof Value]`. Add explicit types to exported declarations, use
  `import type` for type-only imports, and write relative Node ESM imports with `.js` extensions.
- Account for `noUncheckedIndexedAccess` instead of asserting indexed values. Preserve ordered PDX entries in arrays;
  never replace them with `Record`, because duplicate keys are valid.
- Keep subtypes as ordered variants within their base definition type. Use IR vocabulary such as `triggerBlock`,
  `typeRef`, and variant predicates; never copy CWT bracket expressions into publishable schema source.

## Testing Guidelines

- Place focused unit tests beside the behavior they cover under `tests/`, using `*.test.ts`.
- Test lexer and parser diagnostics as well as successful AST output. All nodes and tokens must retain source positions,
  and parse errors must return partial results instead of throwing.
- Round-trip tests compare parse → print → parse structure while ignoring trivia. Accept UTF-8 BOM, LF, and CRLF input;
  print deterministic UTF-8 without BOM and with LF line endings.
- Keep fixture bytes unchanged; `tests/fixture-roundtrip.test.ts` locks their manifest with SHA-256. List each
  non-script prose exclusion explicitly with its path and one-line reason; stop and investigate before the exclusion
  list exceeds 15 entries.
- Preserve compile-time regression coverage for strict flags, including a deliberate indexed-access error guarded by
  `@ts-expect-error`.

## Configuration & Security Notes

- Published code supports Node 22 or later. The pinned development linter stack requires Node 22.12 or later, so use
  that floor for local development and CI.
- Never write to the installed Stellaris directory. Treat
  `D:\steam\steamapps\common\Stellaris` as read-only verification input.
- `tools/refs-sync.ts` may only clone `https://github.com/cwtools/cwtools-stellaris-config` into ignored `refs/`; it
  must not pull, update, or make that checkout a build, verification, or runtime dependency.
- Do not commit secrets, local machine paths beyond documented test defaults, `refs/`, build output, coverage, or npm
  cache artifacts.
- Do not weaken a gate, parser rule, fixture, or exclusion policy to make verification pass. Raise contradictions with
  `PLAN.md` before changing the specification.

## Commit & PR Guidelines

- Keep changes focused on one checkpoint concern and preserve unrelated user modifications.
- At each checkpoint, append no more than five lines to `PROGRESS.md`, run the checkpoint's proof commands, and commit
  before moving to the next checkpoint.
- Use concise, imperative commit subjects. Do not mix generated-output changes with unrelated refactors.
- Pull requests must summarize behavior and design decisions, list the exact verification commands and outcomes, call
  out exclusions or known limitations, and include the measured TypeScript check time when the performance gate applies.
