## CP1 — Foundation
- 検証: `npm run format:check && npm run lint:strict && npm run lint:types && npm run typecheck:ci` → exit 0; `npm run verify` は 1–6 成功 / 7–8 skip
- 残り: CP2 Lexer と全対象ファイルの tokenization
- ブロック: なし
- 所見: `oxlint-tsgolint` の要件により TypeScript 7.0.2 を確定し、type-aware lint は各 `tsconfig.json` を自動検出する構成にした
