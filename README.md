# Java Stream API 可視化シミュレーター

Java Stream API の処理の流れ（要素の通過・除外、型遷移、遅延評価）を1ステップずつ可視化する学習教材アプリ。

- 基準仕様: `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`（Draft v0.8 / Java SE 25基準）
- 実装状況: **Phase 1 完了**（filter の縦断実装。詳細は `docs/phase-1-completion-report.md`）
- 実装指示: `docs/Claude_Code_Phase1_Implementation_Instructions.md`

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

- 検証済み DSL / AST を単一のSource of Truthとし、Predicate評価・型遷移・Java表示コード・自然文説明を同一ASTから生成
- Step Engine は `next(currentSnapshot, pipelineDefinition)` の純粋関数で、決定的な確定snapshot列を生成
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

## テスト結果（Phase 1 最終）

| 種別 | 件数 | 結果 |
|---|---|---|
| Domain単体（P1-D01〜D14） | 46 | 全成功 |
| 履歴・Application（P1-A01〜A08） | 11 | 全成功 |
| React統合（P1-R01〜R08） | 8 | 全成功 |
| E2E・視覚回帰（P1-E01〜E11） | 13 | 全成功 |
| JDK 25 Oracle（P1-O01） | 1 | 完全一致 |

- 必須41テストID + P1-O01 をすべて実装・成功（対応表: `docs/phase-1-completion-report.md` §7）
- 画面キャプチャ・Oracle結果: `artifacts/phase-1/`
- 視覚回帰の期待画像: `e2e/__screenshots__/`

## ドキュメント

| ファイル | 内容 |
|---|---|
| `docs/phase-1-completion-report.md` | Phase 1完了報告（判定・証跡・テスト対応表・仕様差異） |
| `docs/phase-1-decisions.md` | J-1（JDK 25 Oracle Tests）/ J-3（playbackState ERROR）の判断記録 |

## ブランチ構成

main に工程順のコミットを積み上げ、各工程時点を指すブランチ（`phase1/00-spec` 〜 `phase1/12-reports`）を作成している。各ブランチの最新コミットの差分が「その工程で作成したファイル」を表す。
