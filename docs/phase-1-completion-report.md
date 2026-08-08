# Phase 1 完了報告書

- 報告日: 2026-08-08（最終レビュー指摘対応で同日更新）
- 基準仕様: `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`（Draft v0.8、全文確認済み・無編集）
- 実装指示: `docs/Claude_Code_Phase1_Implementation_Instructions.md`

## 1. 判定

**Phase 1 完了。**

Draft v0.8 §21の実装範囲、§22の受入条件、§23の必須41テストID（+J-1で追加したP1-O01）を
すべて実装・実行し、成功を確認した。判定根拠は以下の各節に示す。

## 2. 実装済み機能

- React + TypeScript + Vite プロジェクト（React 19.2 / TypeScript 6.0 / Vite 8.2）
- TypeRef（構造化型・型遷移・表示ラベル導出）
- OperationCatalog（source / filter=INTERMEDIATE,STATELESS / toList=TERMINAL、拡張可能な登録方式）
- PipelineTemplate / TemplateInstance / PipelineDefinition と TemplateRegistry
  （同一target operation=filterへ基準template + filterチェーンtemplateの複数登録）
- DSL（fieldCompare / int定数 / GTE）: §9.3の順序による構造 → template/slot → ホワイトリスト
  → 型 → 教材制約 → snapshot予算の検証、安全な評価（eval等不使用）
- 同一ASTからのJavaコード生成（record定義 + dataset + Pipeline、ASCII構文、安定line ID）と自然文説明生成
- Step Engine（純粋・決定的）: INITIAL / source送出 / node到着 / Predicate評価確定 /
  通過・除外 / toList追加 / 結果確定 / STREAM CONSUMED の確定snapshot列
- Snapshot History（不変snapshot、cursor移動、戻る=再計算なしの完全復元、進む=history再利用）
- 再生制御: 最初から / 戻る / 進む / 自動（1000ms固定）/ 停止、追い越しなし、
  完了・上限・エラー・scenario切替での自動停止
- 500 snapshot安全上限（501件目を作らずLIMIT_REACHED + 理由表示）
- ScenarioProvider interface + FixtureScenarioProvider（標準 / 途中0件 / 空ソースの3モード、
  安定element ID、template ID/version、scenario revision、provenance）
- scenario revisionの発行規則: GenerateRequestへ現在のrevisionを渡し（§10.2）、
  Providerは切替のたびに以前とは異なる新しいrevisionを発行する
  （標準 → 途中0件 → 標準と戻しても最初のrevisionを再利用しない）。
  「最初から」は現在のscenarioとrevisionを維持する（§18）
- AI capability: 利用不能理由を返し、AIボタンのdisabled状態と理由表示が一致。fixtureへの自動フォールバックなし
- React UI 7領域: ScenarioControls / PipelineViewport / Input・Processing・Output /
  JavaCode / Explanation / Details / StickyPlaybackBar
- Pipeline表示: 左詰め・非折返し・専用横スクロール・active node追従・min-height + auto height
- 表示規則: 状態記号（－▶○×）+ 文言、Java ASCII構文（-> >=）と視覚フロー（→）の使い分け、
  filter凡例は4状態のみ（バッファ済み非表示）
- アクセシビリティ: キーボード操作、:focus-visible可視化、状態の文言表示、prefers-reduced-motion対応
- レスポンシブ: PC 3列 + 下段2列 / 狭幅の縦積み、stickyバー下余白

## 3. 未実装機能（Phase 1対象外の操作一覧）

以下はDraft v0.8 §21.4のとおり未実装であり、スタブでの偽装もない。UI上は対象操作の
選択肢が「filter（中間操作）」のみのdisabledセレクトであり、未実装操作は選択不能。

- filter以外の中間操作の本実装: map、mapToInt/Long/Double、boxed、mapToObj、flatMap系、
  distinct、sorted、peek、limit、skip、takeWhile、dropWhile
- 終端操作: forEach系、toArray、collect、reduce、count、min/max、find系、match系、
  sum、average、summaryStatistics（toListは縦断fixtureに必要な最小実装のみ）
- primitive特化Stream、Collector Engine / Collector AST
- 実AI接続、サーバーAPI、RemoteScenarioProvider
- 自由Pipelineビルダー、自由式編集、任意コード実行
- parallelStream実行シミュレーション、再生速度変更UI
- null / NaN / Infinity / overflow / 例外教材、本番デプロイ構成

## 4. 主な変更ファイルとアーキテクチャ上の役割

依存方向は React UI → Application → Simulation Core（domain）→ Provider 境界で、
Simulation CoreはReact / DOM / タイマー / HTTP / AI SDKへ依存しない（§5.1）。

| パス | 役割 |
|---|---|
| `src/domain/types/` | TypeRef、安定ID、検証Result |
| `src/domain/model/employee.ts` | Employee/Department表示モデルとfieldメタデータ |
| `src/domain/fixtures/employees.ts` | §21.3の基準fixture（4件、安定ID emp-001〜004） |
| `src/domain/catalog/` | OperationDefinition / OperationCatalog / Phase 1の3操作 |
| `src/domain/dsl/` | AST、検証（構造/ホワイトリスト/型）、評価、Javaコード生成、説明生成 |
| `src/domain/template/` | PipelineTemplate、TemplateRegistry、2つの教材template、instantiate（§9.3検証チェーン） |
| `src/domain/pipeline/pipelineDefinition.ts` | 検証済み不変PipelineDefinition |
| `src/domain/engine/` | Snapshot構造とStep Engine（純粋・決定的、J-3フェイルセーフ） |
| `src/application/session.ts` | SimulationSession、history/cursor、再生制御、500上限、scheduler抽象 |
| `src/application/scenarioFactory.ts` | ScenarioCandidate検証 → 確定Scenario |
| `src/providers/` | ScenarioProvider interface、FixtureScenarioProvider、AI capability |
| `src/ui/` | 7コンポーネント + App + styles（ライトテーマ、レスポンシブ、a11y） |
| `tests/` | Domain / Application / React テスト（Vitest + RTL） |
| `e2e/` | Playwright E2E + 視覚回帰 + キャプチャ |
| `oracle/` | P1-O01（JDK 25照合）: OracleP1.java、期待値、Docker実行スクリプト |
| `docs/phase-1-decisions.md` | J-1 / J-3の判断記録 |

## 5. 実行した全コマンドと終了結果（最終検証時）

| # | コマンド | 結果 |
|---|---|---|
| 1 | `npm install`（依存整合確認含む） | 成功、0 vulnerabilities |
| 2 | `npm run lint`（oxlint） | 成功、警告0 |
| 3 | `npm run typecheck`（`tsc -b`、strict） | 成功、エラー0 |
| 4 | `npm run test:unit`（Vitest） | 9ファイル / 65テスト 全成功 |
| 5 | `npm run build`（`tsc -b && vite build`） | 成功（dist生成） |
| 6 | `npx playwright test`（build + preview + E2E + 視覚回帰） | 13テスト全成功 |
| 7 | `npm run test:oracle`（Docker JDK 25照合） | P1-O01 PASSED（完全一致） |
| 8 | 禁止実装のgrep（eval / new Function / AI SDK） | 実装ヒット0（コメント1件のみ） |
| 9 | `git status` / `git diff` | 新規ファイルのみ、既存変更の破棄なし |

## 6. テスト種別ごとの集計

| 種別 | 基盤 | 総数 | 成功 | 失敗 | skip |
|---|---|---|---|---|---|
| Domain単体 | Vitest | 46 | 46 | 0 | 0 |
| 履歴・Application | Vitest（fake timers） | 11 | 11 | 0 | 0 |
| React統合 | Vitest + RTL + jsdom | 8 | 8 | 0 | 0 |
| E2E・視覚 | Playwright（chromium PC 1280 / 狭幅 375） | 13 | 13 | 0 | 0 |
| Oracle | Docker + Temurin JDK 25 | 1 | 1 | 0 | 0 |
| **合計** | | **79** | **79** | **0** | **0** |

Vitestは9ファイル / 65テスト（Domain 7ファイル46件、Application 1ファイル11件、React 1ファイル8件）。
P1-A07には最終レビュー指摘対応として、連続切替時のrevision非再利用・history初期化・
新revisionのsnapshot ID反映・タイマー停止の検証を追加した。

## 7. 必須41テストID + P1-O01 対応表

すべて実装済み・成功。テスト名にIDを含めて追跡可能にしている。

| ID | 実装箇所 | 結果 |
|---|---|---|
| P1-D01 | `tests/domain/typeRefAndCatalog.test.ts` | 成功 |
| P1-D02 | `tests/domain/typeRefAndCatalog.test.ts` | 成功 |
| P1-D03 | `tests/domain/template.test.ts` | 成功 |
| P1-D04 | `tests/domain/template.test.ts` | 成功 |
| P1-D05 | `tests/domain/dsl.test.ts` | 成功 |
| P1-D06 | `tests/domain/dsl.test.ts` | 成功 |
| P1-D07 | `tests/domain/dsl.test.ts` | 成功 |
| P1-D08 | `tests/domain/dsl.test.ts` | 成功 |
| P1-D09 | `tests/domain/dsl.test.ts` | 成功 |
| P1-D10 | `tests/domain/teachingConstraints.test.ts` | 成功 |
| P1-D11 | `tests/domain/stepEngine.test.ts` | 成功 |
| P1-D12 | `tests/domain/stepEngine.test.ts` | 成功 |
| P1-D13 | `tests/domain/stepEngine.test.ts` | 成功 |
| P1-D14 | `tests/domain/safetyLimit.test.ts` | 成功 |
| P1-A01〜A08 | `tests/application/session.test.ts` | 成功（8 ID） |
| P1-R01〜R08 | `tests/react/app.test.tsx` | 成功（8 ID） |
| P1-E01〜E08, E10, E11 | `e2e/phase1.spec.ts` | 成功（10 ID） |
| P1-E09 | `e2e/narrow.spec.ts` | 成功 |
| P1-O01 | `oracle/`一式 + `tests/domain/oracleSync.test.ts` | 成功 |

## 8. J-1: JDK 25 Oracle Tests

- **判断**: 選択肢1を採用。P1-O01をPhase 1へ追加した（詳細は `docs/phase-1-decisions.md`）。
- **JDK 25ランタイム調達**: ローカルDockerイメージ `gradle:9.6.1-jdk25`。
  `java -version` 実測で **Eclipse Temurin 25.0.3+9（LTS）** を確認。
- **結果**: filter標準（佐藤・高橋）/ 途中0件（空）/ 空ソース（空）/ 5段チェーン（高橋）/
  `Stream.toList()` unmodifiable性のすべてが Simulation Core と完全一致（PASS）。
- レポート: `artifacts/phase-1/oracle-result.md`。再実行: `npm run test:oracle`。

## 9. J-3: playbackState `ERROR`

- **決定内容**: 入力検証はPipelineDefinition生成前に完了し、実行時ERRORは
  `EngineInvariantError`（revision不一致、index範囲外、Predicate未束縛、未知phase）を
  検知した場合のフェイルセーフに限定。遷移時はタイマー解除・最後の確定snapshotとhistory保持・
  理由表示。復帰は「最初から」またはscenario切替。詳細は `docs/phase-1-decisions.md`。
- **実装箇所**: `src/domain/engine/stepEngine.ts`（検知）、`src/application/session.ts`（遷移処理）、
  `src/ui/components/StickyPlaybackBar.tsx`（理由表示・ボタン連動）。
- **テスト結果**: `tests/domain/stepEngine.test.ts`（J-3×2）、
  `tests/application/session.test.ts`（J-3×1）すべて成功。

## 10. J-2: 持越し事項（Phase 1では決定しない）

- 論点: §12.6「1つの確定snapshotに処理中要素は原則1件」の例外規定
  （flatMap親子、sortedの一括並べ替え確定、teeingの左右2系統）。
- 期限: **sortedの例外規定はPhase 3着手前**、**teeingの例外規定はPhase 5着手前**に決定する。

## 11. 代表snapshotの構造比較結果

文字列比較ではなく、snapshot ID / 連番 / revision / kind / active node / line ID /
TypeRefラベル / 要素状態（ノード別履歴 + 最新状態）/ 出力 / playback state を含む構造比較で検証した。

- P1-D11: 基準fixtureの全21 snapshotのkind列が仕様の順序と完全一致。2回実行のJSON構造が完全一致（決定性）。
- P1-D12: 全snapshotで「active node=line ID一致」「出力要素は全操作通過済み」「最新状態と履歴の無矛盾」
  「ID・連番・revision一貫」「凍結による不変性」を確認。
- P1-A01: 進む → 戻るで直前snapshotが同一オブジェクトかつJSON構造完全一致。
- P1-E04: E2Eで戻る後の全パネル（snapshot ID属性・出力HTML・強調行・位置表示）が復元前と一致。

## 12. 画面キャプチャの保存先

`artifacts/phase-1/` 配下:

- PC幅（1280px）: `capture-pc-initial.png` / `capture-pc-passed.png` / `capture-pc-chain.png`
- 狭幅（375px）: `capture-narrow-standard.png` / `capture-narrow-chain.png`

## 13. P1-E11 視覚回帰結果

- 期待画像は§21.3の基準fixture（4要素）を正として作成（5要素の図1モックは不使用）。
- 代表4snapshot（初期 / 通過確定 / 除外確定 / 完了）の期待画像を
  `e2e/__screenshots__/phase1.spec.ts/` に保存し、再実行で `toHaveScreenshot` 照合が成功。
- ベースラインは本レポート§12のキャプチャとあわせて目視確認済み。

## 14. 仕様との差異

既知の仕様差異はゼロ。以下は仕様が明示しない点の実装判断（差異ではなく解釈）:

- INITIAL snapshotはactive nodeなし（コード強調なし）とした。
- §13.2の「Predicate評価確定」と「通過 / 除外」を別々の確定snapshotとした
  （§21.2 M-1のsnapshotBudget「4要素×5ノード≒60前後」と整合。チェーンは53件）。
- 凡例は選択操作（filter）のlegendStates（4状態）を常時表示する。
- LIMIT_REACHED / COMPLETED から「戻る」した場合はPAUSED（cursor 0ならREADY）へ復帰する。

## 15. 500 snapshot上限への影響と検証結果

- 事前検証（§9.3手順6）: instantiate時に決定的な事前実行で正確なsnapshot件数を算出し、
  500超を拒否する（`SNAPSHOT_BUDGET`エラー）。
- 実測件数: 基準標準 21 / 途中0件 19 / 空ソース 3 / 5段チェーン 53 — 全fixture 500以内
  （P1-D14で機械検証。チェーンは仕様の「≒60前後」と整合）。
- 実行時上限: 501件目を作らず500件目を保持してLIMIT_REACHED + 理由表示。
  Phase 1のfixtureでは事前検証により500件へ到達しないため、実行時上限メカニズムは
  上限値を注入した同一コードパスで検証し、既定値500は定数アサーションで確認した（P1-D14）。

## 16. 既知の問題と次Phaseへの持越し事項

- 既知の問題: なし（テスト失敗・skip・未実行はゼロ）。
- 留意点: fullPageスクリーンショットでは`position: fixed`のstickyバーがキャプチャ内の
  ビューポート位置に写る（Playwrightの仕様。実画面では常に最下部固定で、P1-E08で非遮蔽を検証済み）。
- 持越し:
  - J-2の例外規定（§10節参照。sorted: Phase 3着手前、teeing: Phase 5着手前）
  - Oracle TestsのCI実行環境整備（現状はローカルDocker。Phase 2以降で対象操作を拡張）
  - 教材Pipeline最大ノード数ガイドライン（生成1+中間最大3+終端1）はPhase 6のAI生成制約へ流用予定。
    Phase 1はsnapshotBudgetを実質上限として運用（§3.3どおり）

## 17. 最終git statusとコミット状態

- `git init` のみ実施（変更範囲確認のため）。**コミット・push・Pull Request作成は行っていない**
  （指示§2-10のとおり。`git log` はコミット0件）。
- `git status`: 全ファイルが新規（untracked）。既存ファイルの変更・破棄はない
  （作業前から存在したのは `docs/` の仕様書・指示書のみで、無変更）。
- `git diff`: 追跡済みファイルが存在しないため差分なし。
