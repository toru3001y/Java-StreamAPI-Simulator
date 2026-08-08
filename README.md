# Java Stream API 可視化シミュレーター

Java Stream API の処理の流れ（要素の通過・除外、型遷移、遅延評価）を1ステップずつ可視化する学習教材アプリ。

- 基準仕様: `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`（Draft v0.8 / Java SE 25基準）
- 実装状況: **Phase 3 完了**（stateful中間操作 distinct / sorted / limit / skip / takeWhile / dropWhile / peek と
  無限sourceの有限化。詳細は `docs/phase-3-completion-report.md`）
- 実装指示: `docs/Claude_Code_Phase1_Implementation_Instructions.md` / `docs/Claude_Code_Phase2_Implementation_Instructions.md` / `docs/Claude_Code_Phase3_Implementation_Instructions.md`

## 実装済み操作（Phase 3時点）

- **Stream生成**: `Collection.stream()` / `Arrays.stream()`（object・int[]・long[]・double[]）/ `Stream.of()` /
  `Stream.generate()` / `Stream.iterate(seed, operator)` / `Stream.iterate(seed, predicate, operator)` /
  `IntStream.range()` / `IntStream.rangeClosed()` / 各種 `empty()`
  - `Stream.generate()` と2引数 `iterate()` は無限sourceのまま、`limit()` を含むtemplateで実行可能
    （必要source要求件数を事前導出し、supplier / operatorは必要回数だけ実行。limitなし候補は
    `UNBOUNDED_SOURCE` として事前拒否）
- **中間操作（stateless）**: `filter` / `map` / `mapToInt` / `mapToLong` / `mapToDouble` / `boxed` / `mapToObj` /
  `flatMap` / `flatMapToInt` / `flatMapToLong` / `flatMapToDouble` / `peek`
- **中間操作（stateful）**: `distinct` / `sorted()` / `sorted(Comparator)` / `limit` / `skip` /
  `takeWhile` / `dropWhile`（takeWhile / dropWhileはsequential + ordered限定）
  - sortedはJ-2契約どおり「全入力buffer → 順序確定（処理中0件・1回のみ）→ 1件ずつ放出」
  - limit / takeWhileの短絡後は残りを未評価（`UNEVALUATED`）として保持
  - peekのConsumer実行履歴は通常結果と分離した不変のSide Effect履歴としてsnapshotへ保持
- **終端**: `toList()`（primitive Streamは `boxed().toList()` で結果化）

## 技術構成

- React 19 + TypeScript 6 + Vite 8
- テスト: Vitest + React Testing Library / Playwright（E2E・視覚回帰）
- Oracle照合: Docker + Eclipse Temurin JDK 25

## アーキテクチャ

依存方向は外側 → 内側のみ。Simulation Core（`src/domain/`）は React / DOM / タイマー / HTTP / AI SDK に依存しない。

```
React UI (src/ui)
  → Application (src/application)   … SimulationSession・履歴cursor・1000ms自動再生・500上限
    → Simulation Core (src/domain)  … TypeRef・OperationCatalog・DSL・Template・Step Engine・Snapshot
      → ScenarioProvider (src/providers) … FixtureScenarioProvider（Phase 1〜5）
```

- 検証済み DSL / AST（Predicate・Source・Mapper・Comparator・Consumer・count）を単一のSource of Truthとし、評価・型遷移（TypeRef）・Java表示コード・自然文説明・操作固有状態表示を同一ASTから生成
- Step Engine は PipelineDefinition から決定的な確定snapshot列（timeline）を純粋に導出。Phase 3では要素1件のdepth-first規則を維持したまま、node runtime（seen / buffer / count / 境界 / Side Effect）+ finish cascade（sorted flush）+ 短絡キャンセル（limit / takeWhile）を合成
- 無限source（generate / iterate2）は有限性解析で必要source要求件数を事前導出し、必要な分だけ決定的に生成（`PipelineDefinition.boundedness` / `orderMeta`）
- 「戻る」は再計算せず保存済みsnapshotを復元（seen・buffer・count・Side Effect履歴も完全復元）。全パネルが同一snapshot IDを描画

## 実行方法

```bash
npm install
npm run dev          # 開発サーバー
npm run typecheck    # 型検査（strict）
npm run lint         # oxlint
npm run test:unit    # Domain/Application/Reactテスト（Vitest）
npm run build        # production build
npm run test:e2e     # Playwright E2E + 視覚回帰（要: npx playwright install chromium）
npm run test:oracle  # JDK 25照合 P1-O01/P2-O01/P3-O01（要: Docker + gradle:9.6.1-jdk25イメージ）
```

## テスト結果（Phase 3 最終）

| 種別 | 件数 | 結果 |
|---|---|---|
| Vitest（Domain / Application / React、P1 + P2 + P3） | 225 | 全成功 |
| E2E・視覚回帰（P1-E01〜11 + P2-E01〜10 + P3-E01〜10） | 37 | 全成功 |
| JDK 25 Oracle（P1-O01 / P2-O01 / P3-O01） | 3 | 完全一致 |

- P1必須41 ID + P1-O01、P2必須52 ID + P2-O01、P3必須60 ID をすべて実装・成功（対応表: 各completion-report）
- 画面キャプチャ・Oracle結果・snapshot予算実測: `artifacts/phase-1/`〜`artifacts/phase-3/`
- 視覚回帰の期待画像: `e2e/__screenshots__/`

## ドキュメント

| ファイル | 内容 |
|---|---|
| `docs/phase-3-completion-report.md` | Phase 3完了報告（判定・証跡・60 ID対応表・J-2不変条件・Oracle結果・差異記録） |
| `docs/phase-3-decisions.md` | Phase 3判断記録（J-2 `sorted`確定 + Phase 3本体の実装判断） |
| `docs/phase-2-completion-report.md` | Phase 2完了報告（判定・証跡・52 ID対応表・TypeRef連鎖・Oracle結果） |
| `docs/phase-2-decisions.md` | generate/iterate2境界・flatMap親子とJ-2・実装判断の記録 |
| `docs/phase-1-completion-report.md` | Phase 1完了報告（判定・証跡・テスト対応表・仕様差異） |
| `docs/phase-1-decisions.md` | J-1（JDK 25 Oracle Tests）/ J-3（playbackState ERROR）の判断記録 |

## ブランチ構成

マージフロー型で運用している。各工程は main から分岐したブランチ（`phase1/01-scaffold` 〜 `phase1/12-reports`）で作業し、確認後に `--no-ff` で main へマージする。次の工程は前工程マージ後の main から分岐する。`phase1/00-spec` は初期コミット（仕様書）を指す。各工程で作成したファイルは、各ブランチの先頭コミット（またはmainの対応するマージコミット）の差分で確認できる。
