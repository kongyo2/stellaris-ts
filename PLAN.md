# stellaris-ts — 実装計画

TypeScript から Stellaris の PDX スクリプト（Clausewitz script）を書き、mod フォルダを出力するライブラリ。
[hikkaku](https://github.com/pnsk-lab/hikkaku) の Stellaris 版にあたる、AI エージェントが第一級の利用者であることを前提にした設計。

この文書は **実装のための仕様書** であり、決定済み事項と未決事項を明示的に分けている。

> **実装体制の変更（2026-07-27）**: Phase 0 〜 Phase 2 CP3 までは外部エージェント（codex）が実装した。以降は Claude が引き継いで完成させる。この文書中の「codex のタスク」といった記述は担当者を問わない要件として読むこと。

---

## 0. 決定事項（合意済み）

| 項目 | 決定 |
| --- | --- |
| API スタイル | **二層**。下層 = PDX と 1:1 のデータ宣言、上層 = scope が型で流れるビルダー DSL |
| 型・ID の配布 | **全部 npm に同梱**。cwt 由来のスキーマもバニラ ID もビルド時に生成してコミット・公開 |
| リポジトリ構成 | **単一パッケージ + subpath exports**（SKILL.md §3 = Publishable library emitted by tsc） |
| `.cwt` の扱い | **ワンショットの移植元にすぎない。ランタイム依存もビルド依存も持たせない** |
| MVP | パーサ/プリンタ + mod 出力の骨格 / cwt パーサ + 型コード生成 / 定義タイプ数種を通しで実装 |

### 0.1 `.cwt` 非依存の意味（この計画で最も重要な制約）

cwtools-stellaris-config は「最初に語彙を移植するときの参考材料」であって、正解ではない。modder としての実感どおり穴がある。したがって：

- `.cwt` を実行時に読む機能は**作らない**。
- `.cwt` をビルドパイプラインの入力に**しない**（`npm run build` が cwt を必要としてはいけない）。
- cwt → スキーマ IR の変換は **一度きりのインポータ** (`tools/import-cwt`) として実装し、その出力 (`src/schema/definitions/*.ts`) を**普通の TypeScript ソースとしてコミットし、以後は手で育てる**。
- インポータは「初回移植」と「上流 cwt が更新されたときの差分提案」のためだけに存在する。後者は**自動適用せず diff を出すだけ**にする。
- cwt の穴は §8 の**バニラ照合ハーネス**で機械的に見つけて埋める。バニラのスクリプト 2,016 ファイルが実質的な正解データなので、cwt より信頼できる。

### 0.2 前提（違う場合は指摘してほしい）

- npm パッケージ名 `stellaris-ts`（レジストリ上で**空きを確認済み**）
- ライセンス MIT
- 対象ゲームバージョン `Pegasus v4.4.6` / mod 互換バージョン `4.4`
- Node の下限 22 LTS（`target`/`lib` = `es2022`、consumer 側の floor として保守的に）
- ソースコード・生成コード・README・SKILL.md は英語。この PLAN.md と会話は日本語
- ゲーム本体: `D:\steam\steamapps\common\Stellaris`
- mod 出力先: `C:\Users\prett\Documents\Paradox Interactive\Stellaris\mod`（現在空）

---

## 1. 調査で確定した事実

実装の見積もりと設計はこの数字に基づいている。

**cwtools-stellaris-config**（MIT / tboby, 2018）

> **この節の数値は grep で概算したものだったため誤りが 2 件あった。**`type[x]` を 449、`links` を 171 としていたが、前者は `subtype[` への部分一致による汚染（汚染値 478）、後者は `root 1 + link 86 + input_scopes 84` を数えていた。**正規の数値は `tools/import-cwt` の構造解析が出すものとする。** 以下は独立に再計測した値で、数え方の定義を併記する。

| 項目 | 値 | 数え方 |
| --- | --- | --- |
| `.cwt` ファイル | 101 | — |
| 行数 | 44,370 | `wc -l` 換算 |
| **type** | **234** | `type[x] = {` の宣言 |
| subtype | 要確定 | **宣言と `localisation = { subtype[x] = {} }` の参照を区別すること。** 行ベースの概算では 58 type / 369 件だが、参照を含んでいる可能性が高い |
| enum | 要確定 | 参照を含む一意名は 206。宣言のみの数と区別すること |
| complex_enum | 27 | 一意名 |
| `alias[trigger:*]` | 912 | 行頭アンカー |
| `alias[effect:*]` | 818 | 行頭アンカー |
| **links** | **86 宣言 / 85 unique** | `links = { }` 直下のブロック。`last_created_pop_faction` が重複 |
| scope | 41 | `scopes = { }` 直下 |

**教訓**: このプロジェクトでは grep の概算を仕様の数値として固定してはいけない。§8 のバニラ照合ハーネスと同じ原則で、**数値はパーサが構造から出す**。`verify:schema` の下限値も PLAN.md ではなく `tools/import-cwt` の実測から決めること。
- アノテーション出現数: `## cardinality` 8,788 / `## replace_scope` 684 / `## push_scope` 573 / `## type_key_filter` 220 / `## required` 207 / `## severity` 105

**ゲーム本体 (4.4.6)** — 全数調査した結果。**サンプル 1 個から一般化してはいけない領域**だったので、以下は全ファイルを数えた値。

| | ファイル数 | LF | CRLF | BOM 付き |
| --- | --- | --- | --- | --- |
| `common/**/*.txt` | 2,016 (27 MB) | 1,697 | **319** | **84** |
| `events/**/*.txt` | 170 | 160 | **10** | 0 |
| `prescripted_countries/**/*.txt` | 20 | 12 | **8** | 0 |
| `map/**/*.txt` | 7 | 7 | 0 | 0 |
| `localisation/**/*.yml` | 2,318 | 2,315 | 3 | **2,318（例外なし）** |

ここから出る 2 つの実装要件:

1. **スクリプトファイルにも BOM がある。** `common/` の 84 ファイル。Lexer が先頭 BOM を捨てないと、この 84 ファイルは最初のキーに `﻿` が混ざってパースに失敗する
2. **改行は混在している。** `common/` の 16% が CRLF。「バニラは LF」という前提を置いてはいけない

**localisation の擬似 YAML**（English 132 ファイル / 111,315 エントリを全数集計）

- BOM は **2,318/2,318 で必須**と見なしてよい。例外ゼロ
- 値は **100% 引用符付き**。引用符なしの値はゼロ
- 行の形は **vanilla 内で揺れている**。以下は全部合法:

  | 形 | 割合 |
  | --- | --- |
  | ` KEY:0 "value"`（先頭スペース 1 + バージョン番号） | 56.63% |
  | ` KEY: "value"`（先頭スペース 1 + 番号なし） | 41.83% |
  | `KEY: "value"`（**先頭スペースなし**） | 1.52% |
  | `  KEY: "value"`（先頭スペース 2） | 0.02% |

  つまり **先頭スペースもバージョン番号も必須ではない**。バージョン番号は `0` 以外に `1` 〜 `7` も出る
- 値の後ろに **`# コメント` を書ける**（`ANCIENT_RELICS_TITLE: "Ancient Relics Story Pack" # Do not translate`）
- 値の中身の出現数: `$var$` 35,823 / `§` 色コード 19,037 / `[Scope.GetName]` 15,669 / `\n` 13,471 / `£icon£` 4,910 / `\"` 40
- 正規の YAML ではない（インデントに意味がなく、値のクォートが YAML の規則と違う）ので **YAML ライブラリを使わない**

**hikkaku から採る設計**
- ambient なビルドコンテキスト（`composer.ts` のスコープスタック）で宣言を収集するパターン
- `.claude/skills/` `.codex/skills/` `.agents/skills/` の 3 箇所に同一 SKILL を配置し、スクリプトで同期する Agent-first 構成
- Vite プラグインによる HMR 開発ループ（Stellaris 版では「保存 → mod フォルダへ出力」の watch に相当）

---

## 2. アーキテクチャ

```
L0  syntax     PDX script の Lexer / Parser / AST / Printer
L1  schema     スキーマ IR（自前の source of truth。TS ソースとしてコミット）
L2  codegen    schema IR → 型定義・ビルダー・scope 別 API・ID union・検証テーブル
L3  runtime    defineMod / 定義の登録 / mod フォルダ emit / localisation
L4  scope      scope が型で流れる上層 DSL
L5  validate   生成物の静的検証
L6  cli        stellaris-ts init / build / check / dev
L7  agent      SKILL.md + rules/（3 箇所同期）
```

依存の向きは L0 ← L1 ← L2 ← L3/L4/L5 ← L6。**L1 より上は `.cwt` を一切知らない。**

`tools/` はパッケージ外の開発専用ツールで、`refs/`（cwt / ゲーム本体）を読むのはここだけ。

---

## 3. パッケージ構成

単一パッケージ + subpath exports。`exports` は各条件ブロックで `types` を先頭に置き、`attw --pack .` + `publint --strict` で機械検証する。

| subpath | 内容 |
| --- | --- |
| `.` | `defineMod`, `emit`, 中核型 |
| `./syntax` | `parse`, `print`, AST 型 |
| `./schema` | スキーマ IR の型とアクセサ |
| `./types` | 生成された定義型（`BuildingDefinition` 等） |
| `./builders` | `defineBuilding` 等 |
| `./scope` | scope DSL |
| `./ids` | バニラ ID の literal union（重いので分離、必要な人だけ import） |
| `./validate` | バリデータ |
| `bin: stellaris-ts` | CLI |

`./ids` を分離するのは型チェック時間のため（§10）。`.` から re-export しない。

---

## 4. ディレクトリ構成

```
stellaris-ts/
├── src/
│   ├── index.ts
│   ├── syntax/           lexer.ts parser.ts ast.ts printer.ts trivia.ts position.ts
│   ├── schema/
│   │   ├── ir.ts         スキーマ IR の型定義（手書き）
│   │   ├── scopes.ts     scope 一覧と link グラフ（手書き + 生成）
│   │   └── definitions/  building.ts technology.ts trait.ts event.ts ...（生成 → 手で育てる）
│   ├── generated/        codegen 出力。コミットする。手で編集しない
│   │   ├── types/        ids/  triggers/  effects/  modifiers/
│   │   └── tables/       検証用ランタイムテーブル（JSON ではなく as const TS）
│   ├── runtime/          mod.ts emit.ts descriptor.ts localisation.ts filemap.ts
│   ├── scope/
│   ├── validate/
│   └── cli/
├── tools/                npm には含めない。refs/ を読むのはここだけ
│   ├── import-cwt/       cwt → schema IR（ワンショット + 差分提案）
│   ├── index-game/       ゲーム本体 → バニラ ID 一覧
│   ├── verify-schema/    バニラ照合ハーネス（§8）
│   └── sync-skills.ts    SKILL を 3 箇所へ同期
├── refs/                 .gitignore。`npm run refs:sync` で clone
├── tests/
│   └── fixtures/         バニラから抽出したパース回帰用サンプル（サイズを絞ってコミット）
├── examples/
├── .claude/skills/stellaris-ts/   .codex/... .agents/...
├── AGENTS.md
├── tsconfig.json  tsconfig.ci.json  tsconfig.test.json
└── package.json
```

`refs/` は `.gitignore` に入れ、`tools/refs-sync.ts` で必要になったときだけ取得する。**submodule にはしない**（cwt への継続的な依存に見えてしまうため）。

**参考リポジトリはそのフェーズで実際に使うときだけ置く。** hikkaku（Scratch 用ライブラリ）は設計思想の出発点ではあるが、本プロジェクトは構成・ツールチェイン・API のいずれでも意図的に hikkaku から逸れている（monorepo → 単一パッケージ、Bun+turbo → Node+tsc、ambient DSL のみ → データ宣言が主）。手元に置いておくと形を無意識にコピーする力が働くので、**必要な知見は本文書に取り込み済みとして、クローンは残さない**。cwt も Phase 2 に入るまで置かない。

---

## 5. L0 — PDX script の syntax

### 5.1 対応すべき文法

バニラのスクリプトから確認済みのものを含む。

| 要素 | 例 |
| --- | --- |
| 代入 | `key = value` |
| ブロック | `key = { ... }` |
| 比較演算子 | `key > v` `<` `>=` `<=` `!=` `==` |
| script variable | `@buildings_t1 = 1` / 参照 `@buildings_t1` |
| inline math（直接） | `@[ base + 1 ]` — 41 例 / 13 ファイル |
| **inline math（エスケープ）** | `@\[ ( 72 * $PROGRESS$ ) ]` — **22 例 / 8 ファイル**。バニラの `common/scripted_effects/99_advanced_documentation.txt` 自身が文法として記述している |
| パラメータ置換 | `$AMOUNT$`（inline_script / scripted_effect） |
| 省略可能ブロック | `[[PARAM] ... ]` — 54 例 / 14 ファイル。**否定形 `[[!PARAM] ... ]` もある** |
| 値の並び（キーなし） | `{ a b c }` — `convert_to = { ... }` など |
| **root の裸タグ列** | ファイル全体が `=` を持たない識別子の並び。`common/component_tags/00_tags.txt` が実例 |
| **root の無名ブロック** | root 直下の `{ ... }`（キーなし） |
| **root の prefixed block** | root 直下の `prefix { ... }` |
| 真偽値 | `yes` / `no` |
| 日付 | `2200.01.01` |
| 引用文字列 | `"anomaly.1.name"` |
| コメント | `# ...` |
| 色 | `{ 0.5 0.5 0.5 1.0 }` / `rgb { 255 0 0 }` / `hsv { ... }` |
| **重複キー** | `desc = {}` や `inline_script = {}` が同一ブロックに複数 — **合法** |

### 5.2 AST の要求

- **先頭の UTF-8 BOM を捨てる。** `common/` の 84 ファイルに BOM が付いている（§1）。捨てないとその 84 ファイルが「最初のキーに不可視文字が混ざる」形で落ちる。これを除外リストで処理してはいけない
- **CRLF と LF の両方を受ける。** `common/` の 319 ファイルが CRLF（§1）
- **順序付きエントリ配列**。`Record` にしてはいけない（重複キーが合法なので情報が落ちる）
- trivia（コメント・空行）を保持し、**round-trip 可能**にする
- 位置情報（offset / line / column）を全ノードに持たせる — 診断とパーサの回帰テストに必須
- エラー回復あり。不完全な入力でも部分 AST を返し、診断を配列で返す（throw しない）

```ts
type Node = Block | Assignment | Scalar | ...
interface Assignment { kind: 'assignment'; key: Key; op: Op; value: Value; span: Span; trivia: Trivia }
interface Block { kind: 'block'; entries: Entry[]; span: Span }   // entries は順序付き
```

### 5.3 Printer

- バニラのスタイルに合わせる: タブインデント、`key = value`、ブロックは改行
- **決定的**（同じ AST → 常に同じバイト列）。diff の安定が mod 開発では効く
- 出力は UTF-8 **BOM なし** / 改行 **LF** に統一する。バニラは混在している（`common/` の 16% が CRLF、84 ファイルが BOM 付き）が、**入力の揺れをそのまま出力に持ち越さない**。読むときは両方受け、書くときは一方に決めるのが決定性の条件。localisation だけは BOM 付き（§7.3）

### 5.4 受け入れ基準 — **Phase 1 完了時点で達成済み**

対象コーパスは **`common/` + `events/` + `prescripted_countries/` + `map/`**。`localisation/` は PDX script ではない別形式なので対象外（§7.3 で別に扱う）。

**拡張子で絞ってはいけない。** `.txt` 限定にすると `common/inline_scripts/traditions/tr_purity_imperfection_remediation_wilderness`（拡張子なしの実在する PDX script）がこぼれる。inline_scripts はゲーム側が拡張子なしのパスで参照するため、これは正当なスクリプト。4 root 配下で PDX script でないのは `.json` 1 / `.csv` 2 / `.ods` 2 のみなので、**この 3 拡張子を除外する形で収集する**のが正しい。

**parse → print → parse が AST 同値**（trivia を除いた構造比較）であること。ゲーム本体が無い CI では `tests/fixtures/` のバイト固定サンプルで代替。

実績: 2,213 ファイル中 2,210 成功 / 除外 3 / 失敗 0 / 診断 0。BOM 84 件と CRLF 337 件は除外せず処理。

**除外 3 件は全部バニラ側の非スクリプト or 実バグ**（独立検証済み）:

| ファイル | 理由 |
| --- | --- |
| `common/HOW_TO_MAKE_NEW_SHIPS.txt` | コメント化されていない英文散文が 43 行 |
| `common/edicts/99_README_EDICTS.txt` | コメント化されていない見出しが 3 行 |
| `common/scripted_loc/scripted_loc_ruloc.txt` | **バニラのバグ**。312 行目の `defined_text = {` が EOF まで閉じていない（ブレース収支 開 111 / 閉 110） |

最後の 1 件は Phase 5 以降に効いてくる: **バニラには構文的に壊れたファイルが実在する**。バリデータは「バニラは常に正しい」という前提を置いてはいけない。

---

## 6. L1 — スキーマ IR

### 6.1 位置づけ

**cwt の写しではない。** cwt の概念のうち必要なものだけを自前の語彙に翻訳し、TypeScript ソースとして持つ。手で読めて手で直せることが最優先。

```ts
// src/schema/definitions/building.ts
import { defineType, enumRef, triggerBlock, modifierBlock } from '../ir.ts'

export const building = defineType({
  id: 'building',
  path: 'common/buildings',
  scope: { push: 'planet' },
  localisation: [
    { key: 'name', pattern: '$',      required: true },
    { key: 'desc', pattern: '$_desc', required: true },
  ],
  modifiers: [{ pattern: 'planet_$_build_speed_mult', category: 'planets' }],
  subtypes: [
    { id: 'corporate', when: { owner_type: 'corporate' } },
    { id: 'holding',   when: { owner_type: 'subject_holding' } },
  ],
  fields: {
    category:        { value: enumRef('building_categories'), cardinality: [1, 1] },
    potential:       { value: triggerBlock(),                 cardinality: [0, 1] },
    planet_modifier: { value: modifierBlock('planets'),       cardinality: [0, 1] },
    // ...
  },
})
```

cwt の `alias_name[trigger] = alias_match_left[trigger]` のような表現は `triggerBlock()` に、`<building>` のような型参照は `typeRef('building')` に翻訳する。**cwt の記法は IR に持ち込まない。**

### 6.2 IR に持つ情報

- 定義タイプ: id / 出力パス / name の取り方（`name_field`, `skip_root_key` 相当）/ subtype / localisation 要求 / 生成する modifier
- フィールド: 値の型 / cardinality / scope 効果（push / replace）/ ドキュメント文字列 / severity
- enum: 静的な値の一覧、および「バニラのファイルから抽出する」動的 enum（cwt の `complex_enum` 相当）
- scope: 一覧、別名、link グラフ（`owner: planet → country` など 171 本）
- trigger / effect: 名前 / 有効な scope 集合 / 引数の形 / ドキュメント

### 6.3 IR の品質を担保する仕組み

IR は手で育てるので、壊れやすい。以下で守る：

1. IR 自身に `satisfies` と型を効かせる（未知の scope 名、未知の enum 参照はコンパイルエラー）
2. IR の整合性チェック（`tools/verify-schema` の一部）: 参照先の enum / type / scope が実在するか
3. §8 のバニラ照合

---

## 7. L2/L3 — codegen と runtime

### 7.1 codegen の出力

`src/schema/**` → `src/generated/**`。生成物はコミットする（npm 同梱の決定に従う）。

| 出力 | 内容 |
| --- | --- |
| `types/definitions/*.d.ts` | `BuildingDefinition` などデータ宣言用のオブジェクト型 |
| `builders/*.ts` | `defineBuilding()` 等の実装（下層・上層の両方） |
| `types/scopes.ts` | scope union と link マップ |
| `types/triggers/<scope>.ts` | **scope ごとに事前展開した** trigger interface |
| `types/effects/<scope>.ts` | 同上 |
| `types/ids/*.ts` | バニラ ID の literal union（タイプ別に分割） |
| `types/modifiers.ts` | modifier 名の union とカテゴリ |
| `tables/*.ts` | バリデータが使う `as const` テーブル |

**`isolatedDeclarations: true` を有効にするので、生成コードは全 export に明示的な型注釈を吐く必要がある。** codegen の実装で最初に効いてくる制約なので、テンプレートの設計時点で織り込むこと。

### 7.2 API 二層の具体形

**下層（データ宣言）** — LLM が既に知っている PDX の形。学習コストほぼゼロ。

```ts
import { defineBuilding } from 'stellaris-ts/builders'

export default defineBuilding('my_lab', {
  category: 'research',
  potential: {
    exists: 'owner',
    owner: { is_regular_empire: true },
  },
  planet_modifier: { planet_researchers_add: 2 },
})
```

重複キーが必要な箇所は配列で表現する（PDX 側では同名キーの繰り返しに展開される）：

```ts
defineBuilding('x', {
  triggered_planet_modifier: [
    { potential: { /* ... */ }, modifier: { /* ... */ } },
    { potential: { /* ... */ }, modifier: { /* ... */ } },
  ],
})
```

**上層（scope 付き DSL）** — scope が型で流れる。

```ts
defineBuilding('my_lab', (b) => {
  b.category('research')
  b.potential((s) => {              // s: Scope<'planet'>
    s.exists('owner')
    s.owner((s) => {                // s: Scope<'country'>
      s.is_regular_empire(true)     // planet scope で書くと型エラー
    })
  })
  b.planet_modifier({ planet_researchers_add: 2 })
})
```

両方が同じ IR に落ち、同じ printer を通る。混在も許す（下層のオブジェクトの一部フィールドだけ関数で書ける）。

### 7.3 mod 出力

**ファイル配置**が Stellaris mod の最重要ポイントなので、ここは丁寧にやる。

- **Stellaris は同名ファイルを丸ごと置換する。** `common/buildings/00_capital_buildings.txt` という名前のファイルを mod に置くと、バニラのそのファイルは完全に無効化される。
  → **バニラのファイル名との衝突を検出して必ず警告する。** 意図的な上書きは明示フラグ（`{ overrides: 'common/buildings/00_capital_buildings.txt' }`）を要求する。
  → デフォルトのファイル名は `zz_<modname>_buildings.txt` のように衝突しない prefix を付ける。
- ファイル名は明示指定と自動の両方を提供。自動は決定的（定義の登録順ではなく id のソート順）。
- `descriptor.mod`（mod フォルダ直下）と `<name>.mod`（mod ディレクトリ直下、`path=` 付き）の両方を生成する。

```
version="1.0.0"
tags={
	"Gameplay"
}
name="My Mod"
supported_version="v4.4.*"
```

> **要実機確認（Phase 5 で実施）**: このマシンには mod が 1 つも入っていないため、`descriptor.mod` / `<name>.mod` の正確な差分（`path=` の要否、パス区切り、`remote_file_id`）と、Launcher v2 の sqlite DB に対して手置きの `.mod` がどう認識されるかは実機で確認すること。有効なタグの一覧も launcher assets から抽出すること。

**localisation**

`localisation/<lang>/<name>_l_<lang>.yml`。正規の YAML ではないので **YAML ライブラリを使わず専用の writer / parser を書く**。

§1 のとおり vanilla の書式は揺れているので、**writer が出す形と parser が受ける形を分ける**。

*writer（1 つに決め打つ）*
- **UTF-8 BOM 付き**（2,318/2,318 が BOM 付き。ここは揺らさない）
- 改行 LF
- `l_<lang>:` のヘッダ行は先頭スペースなし
- エントリは **` KEY:0 "value"`**（先頭スペース 1 + 明示的なバージョン番号 `0`）— vanilla の最多形（56.63%）
- `"` は `\"`、改行は `\n` にエスケープ。`$var$` / `§` 色コード / `£icon£` / `[Scope.GetName]` は**透過**（エスケープしない）

*parser（vanilla を読むときに必要。全部受ける）*
- 先頭スペース 0 / 1 / 2 個のいずれも
- バージョン番号の省略、および `0` 以外の値（`1`〜`7` が実在）
- 値の後ろの `# コメント`
- BOM の有無、CRLF / LF の両方

定義に紐付いた localisation（`building_x` → `building_x` / `building_x_desc`）は IR の `localisation` から**欠落を検出**する。

**その他**
- `common/inline_scripts/`、`scripted_effects`、`scripted_triggers` も生成対象にする（TS の関数で抽象化しても、PDX 側の再利用単位として出力したい場面がある）
- watch モードでは mod フォルダに直接書き出す（`stellaris-ts dev`）

---

## 8. バニラ照合ハーネス（cwt が不完全であることへの回答）

これが「cwt を信用しない」という方針を機械で支える仕組みで、**この計画の要**。

`tools/verify-schema`:

1. ゲーム本体の `common/` 全定義をパースする
2. 自前のスキーマ IR で検証する
3. **「スキーマが弾いたが、バニラに実在する」構文を全部レポートする** ＝ スキーマの穴のリスト
4. 逆に「スキーマが要求するが、バニラの全定義に一度も現れないフィールド」もレポートする ＝ 幻のフィールド（cwt の古い記述など）

出力はタイプ別・フィールド別に集計した Markdown。これを見ながら IR を直していく。cwt の穴が構造的に見つかる。

さらに：
- DLC の zip 内スクリプトも対象にできると網羅性が上がる（`dlc/dlcXXX/dlcXXX.zip`）。優先度は低め
- ゲーム更新時にこのハーネスを回せば、追加/変更されたフィールドが差分として出る ＝ **バージョン追従の主経路**（cwt の更新を待たなくてよい）
- CI ではゲーム本体が無いので、抽出済み fixture に対する回帰テストとして縮小版を走らせる

---

## 9. TypeScript 設定（SKILL.md 準拠）

参照: `ts-tsconfig-modern-strict-starter/SKILL.md`。ルートは **§3 Publishable library (emitted by tsc)**。

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    // Strict Core（SKILL.md 記載のものをそのまま）
    "skipLibCheck": true, "incremental": true,
    "moduleDetection": "force", "isolatedModules": true,
    "verbatimModuleSyntax": true, "erasableSyntaxOnly": true,
    "useDefineForClassFields": true, "resolveJsonModule": true, "allowJs": false,
    "strict": true,
    "noUncheckedIndexedAccess": true, "noPropertyAccessFromIndexSignature": true,
    "exactOptionalPropertyTypes": true, "noImplicitOverride": true,
    "noImplicitReturns": true, "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true, "noUnusedParameters": true,
    "allowUnreachableCode": false, "allowUnusedLabels": false,
    "noUncheckedSideEffectImports": true,
    "noErrorTruncation": true,

    // §3 Library
    "target": "es2022", "module": "nodenext", "moduleResolution": "nodenext",
    "lib": ["es2022"], "types": [],
    "rootDir": "./src", "outDir": "./dist",
    "declaration": true, "declarationMap": true, "sourceMap": true,
    "isolatedDeclarations": true,
    "noEmitOnError": true, "allowImportingTsExtensions": false
  },
  "include": ["src/**/*"],
  "exclude": ["**/*.test.ts", "dist"]
}
```

加えて `tsconfig.ci.json`（`noEmit` / `incremental:false` / `skipLibCheck:false`）と `tsconfig.test.json`（`include` を再記述、`rootDir: "./"`、`types` にランナーの globals）を §5 のとおり用意する。**`extends` はマージであってリセットではない**ので、値は継承に頼らず全部書き直すこと。

実装上、以下は特に効いてくる：

- **`erasableSyntaxOnly`** → `enum` 禁止。scope 名や opcode は `as const` オブジェクト + `(typeof X)[keyof typeof X]` で表現する。**codegen もこの形で吐く**
- **`isolatedDeclarations`** → 生成コードの全 export に型注釈が要る（§7.1）
- **`noUncheckedIndexedAccess`** → Lexer/Parser の実装が一番影響を受ける。`arr[i]` は `T | undefined`
- **`package.json` に `"type": "module"` が必須**（無いと `nodenext` が `.ts` を CJS と判定して全 import が TS1295/TS1287 になる）
- 相対 import は `./thing.js` と書く（`nodenext` の要求）

`tools/` は `src/` の外なので、`rootDir: "./src"` の外に置くことになる。**`tools/` 専用の tsconfig を別に切る**こと。ファイル名は `tsconfig.tools.json` ではなく **`tools/tsconfig.json`**（`noEmit: true`）— oxlint の type-aware lint が `tsconfig.json` という名前しか自動検出しないため（§9.1）。

**TypeScript は 7.0 で確定**（当初は Phase 0 での判断事項としていたが、調査の結果もう決まる）。7.0 は JS コンパイラ API を出していないため typescript-eslint / ts-morph 等は動かないが、本プロジェクトは codegen を**自前の文字列生成**で行い ts-morph に依存しない方針なので支障がない。決め手は `oxlint-tsgolint`（型付き lint の実行系）が **TypeScript 7.0 以上を要求する**こと。7.0 を採る以外の選択肢は型付き lint を捨てることになる。この根拠を AGENTS.md に記録すること。

### 9.1 Lint / Format

3 つの SKILL.md が役割分担しているので、混ぜないこと。**整形は Prettier、lint は Oxlint、型付き lint は Oxlint の `--type-aware`。** Oxlint 側で style / pedantic を切るのは「整形は formatter の領分であって linter の仕事ではない」という理由による。

`.prettierrc.json` — `ts-npm-prettier-starter` のとおり

```json
{
  "printWidth": 120,
  "trailingComma": "all",
  "arrowParens": "always",
  "semi": true,
  "endOfLine": "lf"
}
```

`.prettierignore` — starter の既定に本プロジェクト固有の 3 つを足す

```
node_modules
dist
build
coverage
*.min.js
package-lock.json
*.md
src/generated
tests/fixtures
refs
```

- **`src/generated`** — codegen 出力の整形は**生成器の責任**。Prettier に整形させると真実の源が二重になり、Prettier をバージョンアップしただけで数万行の diff が出る。PDX printer に決定性を要求するのと同じ理由（§5.3）
- **`tests/fixtures`** — バニラからの抜き出しをバイト単位で保つ
- **`refs`** — クローンした他人のリポジトリを絶対に整形しない
- `*.md`（starter の既定）— Prettier の markdown 整形は段落や表を再流し込みするため、この PLAN.md 自体を守る効果もある

`.oxlintrc.json` — `ts-npm-oxlint-starter` に `ignorePatterns` だけ追加

```json
{
  "plugins": ["typescript", "import", "promise", "node"],
  "categories": {
    "correctness": "error",
    "suspicious": "warn",
    "perf": "warn",
    "style": "off",
    "pedantic": "off"
  },
  "rules": { "no-console": "off" },
  "ignorePatterns": ["node_modules", "dist", "build", "coverage", "*.min.js", "refs", "tests/fixtures"]
}
```

- `plugins` は既定集合を**上書きする**（追加ではない）ので、必要なものを全部書く
- **`src/generated` は ignore しない。** 整形は生成器の仕事だが、correctness の指摘は生成器のバグの証拠なので拾いたい。**生成コードに lint エラーが出たら、出力ではなく生成器を直す**
- `no-console: off` — CLI が stdout に書くのは正当な用途なので、そのまま切っておく

スクリプト

```json
{
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "lint": "oxlint --format agent",
  "lint:fix": "oxlint --fix",
  "lint:strict": "oxlint --deny-warnings",
  "lint:types": "oxlint --type-aware --deny-warnings"
}
```

内側のループは `lint`（`--format agent` は oxc チームが LLM に食わせるために用意した出力形式）、ゲートは `lint:strict` と `lint:types`。型付き lint は `tsc` が意見を持たない `no-floating-promises` と `no-unsafe-*` を拾うので、パーサのように `any` が境界を越えやすいコードでは効く。

**`lint:types` に `--tsconfig` と `--type-check` を付けない。** 参照元の tsconfig SKILL.md は `oxlint --type-aware --type-check --tsconfig tsconfig.ci.json` と書いているが、oxlint の実挙動と合っていない（公式 CLI ドキュメントで確認済み）:

- **`--tsconfig` は import 解決にしか効かず、type-aware lint はこのフラグを尊重しない。** 公式ドキュメントは、指定すると import 解決と type-aware lint の間に食い違いが生じうると明示的に警告している。type-aware lint は**各ファイルについて最も近い `tsconfig.json` を自動検出する**
- **`--type-check` は experimental で、`tsc` のコンパイラ診断を lint 出力に混ぜる。** SKILL.md はこれを「CI の `tsc --noEmit` を置き換えられる」機能として挙げているが、本プロジェクトは `typecheck:ci` を独立したゲートとして残すので、付けると同じ型エラーが二重に報告されるだけ。エージェント向け出力からノイズを排除するという Oxlint starter の前提に反する

**自動検出の帰結**（`tsconfig.json` という名前しか探さない）:

- `src/**` → ルートの `tsconfig.json` に載る。ここが型付き lint の主戦場なので目的は達成される
- `tools/**` → **`tsconfig.tools.json` は名前が違うので検出されない。** そのため tools 用の設定は `tools/tsconfig.json` としてディレクトリに置く（`tsc -p tools` でも通るようになるので、どのみちこちらが素直）
- テストファイルはルートの `tsconfig.json` の `exclude` に入っているため型付き lint の対象外になる。これは**許容する**。型の正しさは `typecheck:test:ci` が `tsc` で押さえており、`lint:types` は追加的な価値（`no-floating-promises` 等）を提供する層にすぎないため、穴があっても correctness のゲートは崩れない

`oxlint-tsgolint` は **TypeScript 7.0 以上を要求する**。したがって §9 の「TS 7 か 6 か」の判断は**型付き lint を採る時点で TS 7 に確定する**。`oxlint` と `oxlint-tsgolint` はバージョンが歩調を合わせるので、両方 devDependency に入れてピン留めする。

**Windows での改行** — これは**このリポジトリのソースコードの話**で、バニラの改行（§1 のとおり混在）とは別物。`endOfLine: "lf"` と整合させるため `.gitattributes` を以下にする。`* text=auto` だけだと Windows のチェックアウトが CRLF になり、**新規クローン直後に `format:check` が落ちる**。

```
* text=auto eol=lf
tests/fixtures/** -text
```

`tests/fixtures/**` を `-text`（バイナリ扱い）にするのは、バニラからの抜き出しに git の改行正規化を一切かけないため。round-trip テストは入力がバイト単位で元のままであることが前提。

### 9.2 ゲート

SKILL.md の Gate 節に対応。内側のループ（`lint` / `typecheck` / `test`）とは別物として扱う。

- `format:check`
- `lint:strict` / `lint:types`
- `typecheck:ci` / `typecheck:tools:ci` / `typecheck:test` / `typecheck:test:ci`
- `attw --pack .` + `publint --strict` — **Phase 1 時点では未導入**。次のゴールで `verify` に入れる
- **runtime probe**: `npm pack` → 別ディレクトリの scratch consumer にインストール → `node` と `tsc --moduleResolution nodenext` の両方で import が通ることを確認。SKILL.md が「このファイルの主題領域で最も高くつく失敗」と呼んでいる箇所なので必ずやる

---

## 10. 型爆発対策と性能予算

規模が大きいので、素朴に書くと型チェックが実用速度を割る。**最初から対策を入れる。**

| リスク | 対策 |
| --- | --- |
| trigger × scope の組み合わせ爆発（912 × 41） | **codegen 時に展開する**。scope ごとに該当 trigger だけを持つ interface を生成し、TS の型計算（`Extract` や conditional type）に頼らない。1 interface あたり数百メンバに収まる想定 |
| ID の巨大 union | タイプ別に分割（`BuildingId` `TechnologyId` …）。個々は数千以下。`./ids` を別 subpath にして、使わない人には読み込ませない |
| カスタム ID が書けない | `type BuildingRef = VanillaBuildingId \| (string & {})` — 補完を効かせつつ任意文字列を許す |
| 生成コードの再帰型 | trigger/effect のネストは深さ制限付きの明示的な型で表現し、無制限の再帰は避ける |

**性能予算を CI に置く**: `tsc --diagnostics` で `Check time` を計測し、閾値を超えたら fail させる。閾値の初期値は最初の実測後に決める。SKILL.md の「コンパイラ出力は機械が消費する成果物」という考え方の延長。

---

## 11. テスト戦略

| 層 | 内容 |
| --- | --- |
| L0 | 手書きのユニットテスト + **ゲーム本体全ファイルの round-trip**（ローカル） + fixture での縮小版（CI） |
| L1 | IR の整合性（参照先の実在）、`satisfies` によるコンパイル時検査 |
| L2 | 生成コードのスナップショット、`tsc` が通ること、型レベルテスト（`expectTypeOf`） |
| L3 | emit した mod フォルダのファイル一覧・内容のスナップショット。localisation の BOM/改行/エスケープ |
| L4 | **型レベルテスト**。「country 限定 trigger を planet scope で書くと型エラー」を `@ts-expect-error` で固定する |
| L5 | 既知の壊れた mod 定義を投入して、期待どおりの診断が出ること |
| E2E | 生成した mod を実際に Stellaris で読み込む（手動、リリース前チェックリスト） |

型レベルテストは SKILL.md の「コメントを検査可能な成果物に変える」方針そのものなので、scope 安全性の保証は必ず `@ts-expect-error` で固定すること。

---

## 12. フェーズ計画

### Phase 0 — 基盤
- リポジトリ初期化、`package.json`（`"type": "module"`、exports map）、tsconfig 一式（§9）
- oxlint / biome、テストランナー、CI
- `refs/` を `.gitignore`、`tools/refs-sync.ts`
- `AGENTS.md` 初版。エージェント向けの契約として書く。節構成は以下を基本にする（hikkaku の AGENTS.md から採った実績のある構成）:
  Project Structure & Module Organization / **AGENTS.md Maintenance Policy**（構造・スクリプト・規約が変わったら同じコミットで AGENTS.md を更新する、という自己維持の約束） / Build, Test, and Development Commands / Coding Style & Naming Conventions / Testing Guidelines / Configuration & Security Notes / Commit & PR Guidelines

### Phase 1 — L0 syntax  ★MVP
- AST 型、Lexer、Parser（エラー回復）、Printer
- 受け入れ: ゲーム本体全スクリプトの round-trip 一致

### Phase 2 — L1 IR + cwt ワンショット移植  ★MVP
- IR の型を自前で設計（§6）
- `tools/import-cwt`: L0 のパーサを再利用して `.cwt` を読み、`##`/`###` アノテーションを抽出、IR の TS ソースを生成
- 生成物を `src/schema/definitions/` にコミットし、**以後 cwt を参照しない**
- 受け入れ: `tools/import-cwt` の構造解析が出す実測値（§1 の表）を IR が網羅しており、`npm run build` が `refs/` 無しで通る。**PLAN.md の数値ではなくパーサの実測を正とする**

### Phase 3 — バニラ照合ハーネス  ★MVP（縮小版）
- `tools/verify-schema`（§8）
- MVP では Phase 5 で扱う 4 タイプ分だけ照合し、レポートの形と修正フローを確立する

### Phase 4 — L2 codegen  ★MVP
- IR → 生成 TS（§7.1）。`isolatedDeclarations` 準拠
- 型チェック時間の計測を CI に載せる

### Phase 5 — L3 runtime / emit  ★MVP
- `defineMod`、定義の登録、`descriptor.mod` / `<name>.mod`、localisation writer、ファイル配置とバニラ衝突検出
- 対象タイプを **building / technology / trait / event** に絞って通しで実装
- 受け入れ: 生成 mod が実機の Stellaris で読み込まれ、ゲーム内で効果が確認できる

### Phase 6 — L4 scope DSL
- `Scope<S>` の生成、link による遷移、`this`/`root`/`from`/`prev` の追跡
- 受け入れ: 型レベルテストで scope 違反がコンパイルエラーになる

### Phase 7 — L5 validate + L6 CLI
- 未定義 ID 参照、cardinality 違反、localisation 欠落、scope 不整合の検出
- `init` / `build` / `check` / `dev`（watch → mod フォルダ）

### Phase 8 — バニラ ID インデクサ + 全タイプ展開
- `tools/index-game` でバニラ ID を抽出し `src/generated/types/ids/` を生成
- 全 type（実測 234。§1）へ拡張

### Phase 9 — Agent Skill / docs / npm 公開
- SKILL.md + `rules/`、`tools/sync-skills.ts` で 3 箇所へ同期
- README、examples、runtime probe を含む公開ゲート、`0.1.0` publish

**MVP = Phase 0–5。** ここまでで「TS を書いて mod がゲームで動く」が成立する。

---

## 13. Agent 向けの設計（L7）

このライブラリの一次利用者は AI エージェントなので、以下を明示的に設計する。

- **下層 API が PDX と 1:1** であること自体が最大の Agent 対応。LLM は Stellaris のスクリプトを既に知っているので、翻訳表を覚える必要がない
- `SKILL.md` + `rules/`。`.claude/skills/stellaris-ts/` `.codex/skills/...` `.agents/skills/...` の 3 箇所に同一内容を置き、`tools/sync-skills.ts` で同期する。SKILL.md の frontmatter は以下の形:
  ```yaml
  ---
  name: stellaris-ts
  description: <何をするものか>; use when <呼び出すべき場面>.
  license: MIT
  metadata:
    author: kongyo2
  ---
  ```
  - `rules/definitions/*.md` — 定義タイプごとの書き方
  - `rules/triggers.md` `rules/effects.md` `rules/scopes.md` — scope の考え方
  - `rules/localisation.md`
  - `rules/pitfalls.md` — **バニラファイル名の衝突による意図しない上書き**、`common/` の同名ファイル置換、localisation の BOM、`yes`/`no` と `true`/`false` の混同 など
- 診断メッセージは機械可読を意識する（1 行 1 診断、ファイル:行:列、ANSI なし）
- `stellaris-ts check` の出力をそのままエージェントに食わせられる形にする

---

## 14. リスクと未決事項

| # | 項目 | 内容 |
| --- | --- | --- |
| R1 | **バニラ ID の npm 同梱** | 「全部同梱」の決定に従うが、Paradox のゲームデータ由来の識別子を再配布することになる。リスクを下げるため **識別子の名前だけを配布し、localisation の本文・数値バランス・スクリプト本体は配布しない**方針にする。cwtools 由来部分は MIT なので `THIRD_PARTY.md` に帰属表示を置く。この線引きで問題ないか確認したい |
| R2 | パッケージサイズと型チェック時間 | 234 タイプ + subtype + 数万 ID。§10 の対策を最初から入れ、CI で計測する |
| R3 | `descriptor.mod` / Launcher v2 の挙動 | 実機に mod が無いため未検証。Phase 5 で実機確認（§7.3） |
| R4 | ゲームバージョン追従 | §8 のハーネスがそのまま追従手段になる。cwt の更新は待たない |
| R5 | TypeScript 7 とツールチェイン | ts-morph 等を使わない前提なら問題ない。Phase 0 で確定し AGENTS.md に記録 |
| R6 | inline_script / `$PARAM$` の扱い | TS 側で計算すれば不要な場面が多いが、既存 mod との相互運用や PDX 側での再利用のため出力もできるようにする。優先度は Phase 7 以降 |

### 確認したいこと

1. **R1 の線引き**（ID 名のみ配布 / 本文・数値は非配布）でよいか
2. GitHub リポジトリ名は `stellaris-ts` でよいか、公開先の org / user は `kongyo2` か
3. MVP で通す定義タイプは **building / technology / trait / event** でよいか（他に優先したいものがあれば差し替える）
