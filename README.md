# Java Stream API 可視化シミュレーター

Java Stream API の処理の流れ（要素の通過・除外、型遷移、遅延評価）を1ステップずつ可視化する学習教材アプリ。

- 基準仕様: `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`（Draft v0.8 / Java SE 25基準）
- 実装状況: **Phase 2 完了**（Stream生成 + map / mapToX / boxed / mapToObj / flatMap系。詳細は `docs/phase-2-completion-report.md`）
- 実装指示: `docs/Claude_Code_Phase1_Implementation_Instructions.md` / `docs/Claude_Code_Phase2_Implementation_Instructions.md`

## 実装済み操作（Phase 2時点）

- **Stream生成**: `Collection.stream()` / `Arrays.stream()`（object・int[]・long[]・double[]）/ `Stream.of()` /
  `Stream.iterate(seed, predicate, operator)` / `IntStream.range()` / `IntStream.rangeClosed()` / 各種 `empty()`
  - `Stream.generate()` と2引数 `iterate()` はDSL・検証・コード生成まで実装済みだが、無限Streamのため
    Phase 3の `limit()` 実装まで実行不能（`UNBOUNDED_SOURCE` として事前拒否）
- **中間操作**: `filter` / `map` / `mapToInt` / `mapToLong` / `mapToDouble` / `boxed` / `mapToObj` /
  `flatMap` / `flatMapToInt` / `flatMapToLong` / `flatMapToDouble`
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

- 検証済み DSL / AST（Predicate・Source・Mapper）を単一のSource of Truthとし、評価・型遷移（TypeRef）・Java表示コード・自然文説明を同一ASTから生成
- Step Engine は PipelineDefinition から決定的な確定snapshot列（timeline）を純粋に導出。flatMapの親子位置・mapped Stream・close状態も確定snapshotとして表現
- 「戻る」は再計算せず保存済みsnapshotを復元。全パネルが同一snapshot IDを描画

## 実行方法

```bash
npm install
npm run dev          # 開発サーバー
npm run typecheck    # 型検査（strict）
npm run lint         # oxlint
npm run test:unit    # Domain/Application/Reactテスト（Vitest）
npm run build        # production build
npm run test:e2e     # Playwright E2E + 視覚回帰（要: npx playwright install chromium）
npm run test:oracle  # P1-O01 JDK 25照合（要: Docker + gradle:9.6.1-jdk25イメージ）
```

## テスト結果（Phase 2 最終）

| 種別 | 件数 | 結果 |
|---|---|---|
| Domain単体（P1-D01〜14 + P2-D01〜26 ほか） | 96 | 全成功 |
| 履歴・Application（P1-A01〜08 + P2-A01〜06） | 17 | 全成功 |
| React統合（P1-R01〜08 + P2-R01〜09） | 17 | 全成功 |
| E2E・視覚回帰（P1-E01〜11 + P2-E01〜10） | 25 | 全成功 |
| JDK 25 Oracle（P1-O01 / P2-O01） | 2 | 完全一致 |

- P1必須41 ID + P1-O01、P2必須52 ID をすべて実装・成功（対応表: 各completion-report）
- 画面キャプチャ・Oracle結果・snapshot予算実測: `artifacts/phase-1/`、`artifacts/phase-2/`
- 視覚回帰の期待画像: `e2e/__screenshots__/`

## ドキュメント

| ファイル | 内容 |
|---|---|
| `docs/phase-2-completion-report.md` | Phase 2完了報告（判定・証跡・52 ID対応表・TypeRef連鎖・Oracle結果） |
| `docs/phase-2-decisions.md` | generate/iterate2境界・flatMap親子とJ-2・実装判断の記録 |
| `docs/phase-1-completion-report.md` | Phase 1完了報告（判定・証跡・テスト対応表・仕様差異） |
| `docs/phase-1-decisions.md` | J-1（JDK 25 Oracle Tests）/ J-3（playbackState ERROR）の判断記録 |

## ブランチ構成

マージフロー型で運用している。各工程は main から分岐したブランチ（`phase1/01-scaffold` 〜 `phase1/12-reports`）で作業し、確認後に `--no-ff` で main へマージする。次の工程は前工程マージ後の main から分岐する。`phase1/00-spec` は初期コミット（仕様書）を指す。各工程で作成したファイルは、各ブランチの先頭コミット（またはmainの対応するマージコミット）の差分で確認できる。
