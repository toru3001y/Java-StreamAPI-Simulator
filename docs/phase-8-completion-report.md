# Phase 8 完了報告（Collectors.toMap）

## 1. Phase 8の完了 / 未完了判定

**判定: Phase 8 未完了**（指示§15の完了条件のうち1項目が未達）。

未達項目は **teeing branchへのtoMap配置**（指示§8.1-5 / §12.1 P8-D18、および P8-D15 のteeing部分）
である。これにより **P8-D18は未実装ID、P8-D15は部分実装ID**となり、
**P8必須39 IDのうち完全成功は37 ID**である（§9の対応表を参照）。それ以外の完了条件——v0.11 §2.1の3 overloadの縦断実装、実行失敗契約
（`COLLECT_FAILED` 終端 / `FAILED` 状態 / `ExecutionFailureView`）、§8.2の10ケースの確定snapshot列、
決定性・復元、§7の特殊ケース、§8のDSL検証、JDK 25実測照合、既存P1〜P7テストの全件成功、
lint / 型検査 / production build、E2E・視覚回帰・PC / 狭幅確認、§10の総点検、統合docxのv0.11取込——は
すべて満たしている。

> **追記（2026-08-13、Phase 9）**: 未達だったteeing branchへのtoMap配置はPhase 9
> （仕様v0.12差分`docs/Java_Stream_API_Visualization_Spec_v0.12_TeeingToMap.md`・ブランチ`phase-9`）で
> 解消し、P8-D18 / P8-D15を含む**P8必須39 IDはすべて完全成功**となった。本節以下の判定記述は
> Phase 8終了時点の歴史的記録としてそのまま残す。詳細は§17-1の追記と`docs/phase-8-decisions.md` §9.2。

**未達の理由**（詳細は `docs/phase-8-decisions.md` §9）:

`resolveCollectorType` の `teeing` 分岐は、merger record の型契約に従い
**左branch = `Long` / 右branch = `Double`** の結果型を要求する。`TEEING_MERGER_IDS` は
`'SalarySummary::new'`（`record SalarySummary(long employeeCount, double averageSalary)`）の
**1件のみ**である。toMapの結果型は `Map<K, U>`（TypeRef kind = `map`）であるため、
`teeing(toMap(…), …)` / `teeing(…, toMap(…))` は**どう構築しても `TYPE_MISMATCH` で検証に落ち、
Step Engine へ到達できない**（`createNode` が `resolveCollectorType` の失敗で throw する）。
これは指示§17の停止条件（「§8.2の確定snapshot列を既存engineの発行機構と両立させられない」に相当）に
該当したため実装作業を中断して報告し、**ユーザー決定（2026-08-13）により「teeing merger IDを追加せず、
未実装として報告し他を完遂する」方針**を採った（指示§11「既存ホワイトリストの変更をしない」を優先）。

**代替の担保（契約の充足ではない）**: P8-D06 / P8-D15 / P8-D18 が「teeing × toMap が
`TYPE_MISMATCH` で拒否される」ことを機械検証して制約を記録として固定し、あわせて既存teeing
templateのsnapshot列がPhase 8で変化していないことを回帰検証している。これらは
**P8-D15 / P8-D18の契約を検証するものではなく、検証できない理由の固定**である。

**実装側の状態（未検証であることの明示）**: teeing branch経路のtoMap実装は
**到達不能なため一度も実行されておらず、動作は未検証**である。以下は「実装済み・検証済み」ではない。

| 箇所 | 状態 |
|---|---|
| `isLeafAccumulator` がtoMapをleafと判定（default分岐） | コード上そうなるが、**未実行・未検証** |
| `overrideKind = 'TEE_BRANCH_ACCUMULATED'` によるCONTAINER_UPDATED置換 | 既存機構に乗るはずだが、**未実行・未検証** |
| 失敗要素で `TEE_BRANCH_ACCUMULATED` を発行しないガード（teeing分岐へ追加） | **未実行・未検証** |
| 左右branch間で `ctx.path` を復元する処理 | **未実装**（§17-1の残作業(1)） |
| 初回 `TEE_BRANCH_ACCUMULATED` / 0件branchの `TEE_BRANCH_FINISHED` へのTreeMap生成context | **未実装**（§17-1の残作業(3)） |

## 2. 基準コミットと作業ブランチ

- 基準コミット: **`4575628`**（Phase 7完了・運用ファイル整理済みの `main`。PR #9 のmerge commit）
- 作業ブランチ: **`phase-8`**（作業開始時のHEAD: `251fa03`。`git merge-base --is-ancestor 4575628 HEAD` = 真）
- 作業開始時のworktree: clean（未追跡ファイルは0件。codexレビュー結果ファイルは `251fa03` で `.gitignore` 済み）

## 3. 実行失敗契約の実装設計概要

### 3.1 `COLLECT_FAILED` の生成経路

1. **Collector Runtime**（`src/domain/engine/collectorRuntime.ts`）
   `accumulateNode` の `case 'toMap'` で、重複キーかつ `mergeFunctionId === null` を検出したとき、
   `DUPLICATE_KEY_DETECTED` を発行したうえで `ctx.failure`（`WalkCtx` の可変フィールド）へ
   `ExecutionFailureView` を格納して `return` する。**TypeScript例外は投げない**。
   composite Collector（flatMappingの子要素ループ・teeingのbranchループ）は
   `ctx.failure !== null` で走査を打ち切る。
2. **`collectorAccumulate`** は戻り値を `ExecutionFailureView | null` へ変更し、`ctx.failure` を返す。
3. **Step Engine**（`stepEngine.ts` の `buildTimeline`）
   `handleTerminalElement` で戻り値が非nullなら、`collectFailure` 変数へ格納し、
   `COLLECT_FAILED` を `completion: 'EXECUTION_FAILED'` / `confirmed: false` /
   `executionFailure: failure` で push する。`TimelineBuilder.push` は `executionFailure` が非nullのとき
   `terminalResult` を `null` にする（**null化はこの1か所に閉じている**）。
   直後に `b.cancelAt(chain.length)` で上流（source・sorted放出・flatMap子送出）を停止する。
4. **終端化**: finish cascade ループ冒頭・sorted flush内で `collectFailure !== null` なら break し、
   Collector finish stage の直前で `return materialize(def, b.drafts)` する。
   したがって `RESULT_CONFIRMED` / `STREAM_CONSUMED` は発行されず、
   `nextSnapshot` は `COLLECT_FAILED` の次に `null` を返す。

### 3.2 `FAILED` 遷移（`src/application/session.ts`）

`PlaybackState` へ `'FAILED'` を追加（7値目）。v0.11 §6.2の4の表と1対1で実装した。

| 事象 | 実装 |
|---|---|
| `COLLECT_FAILED` 到達（手動・自動再生とも） | `stepForwardOnce` で `next.completion === 'EXECUTION_FAILED'` → `finishAuto('FAILED')`（タイマー停止） |
| `FAILED` で進む / 自動再生開始 | `stepForwardOnce` 冒頭・`play()` 冒頭のガードで no-op |
| `FAILED` で戻る | `stepBack` は `ERROR` のみ拒否。`derivePassiveState()` が1件前で `PAUSED` を返す |
| 保存済み `COLLECT_FAILED` へ再前進 | 履歴内移動で `atFailedSnapshot()` → `finishAuto('FAILED')`（**再計算しない**。historyは伸びない） |
| restart / シナリオ切替 | 既存どおり `READY`（`stopReason` も null へ） |

### 3.3 `EngineInvariantError` との分離方法

- 失敗は**戻り値・状態**でのみ伝搬し、`EngineInvariantError` を送出しない。
- `session.ts` の `catch (e instanceof EngineInvariantError)` 経路は一切通らない
  （P8-D16 が `nextSnapshot` の全ステップで例外が送出されないことを機械検証）。
- `stopReason` は **FAILED では設定しない**（null のまま）。`stopReason` は `SessionState` 上で
  「LIMIT_REACHED / ERROR の停止理由」と定義された既存フィールドであり、区分を混同させないため。
  FAILED専用の表示情報は `Snapshot.executionFailure`（構造化view）が持ち、UIはそこからのみ描画する。
- UI表示も区分を分けた: `playback-state` の `data-state="FAILED"` / ラベル「実行失敗（想定内）」、
  失敗パネルの冒頭文言「教材上想定された実行失敗です（エンジンの内部エラーではありません）」。

## 4. `SnapshotOutput.result` null許容化の消費箇所棚卸し

`result: TerminalResultView` → `TerminalResultView | null` へ変更した。**null になるのは
`COLLECT_FAILED` のみ**である。

| # | 消費箇所 | 対応 |
|---|---|---|
| 1 | `src/domain/engine/stepEngine.ts` `TimelineBuilder.push` | `executionFailure` が非nullのときだけ `terminalResult` を null にする分岐を追加（**null化の唯一の生成点**） |
| 2 | `src/domain/engine/stepEngine.ts` `materialize` | `output.result: draft.terminalResult` をそのまま渡す（型が `\| null` へ拡張） |
| 3 | `src/domain/engine/stepEngine.ts` `createInitialSnapshot` のフォールバック | `result: { kind: 'LIST' }` のまま（非null） |
| 4 | `src/ui/components/MainSimulation.tsx` `TerminalResultOutput` | 冒頭で `result === null` を判定し `ExecutionFailureResult` へ委譲する **null分岐1か所**を追加 |
| 5 | `src/ui/components/MainSimulation.tsx` `MapResult` / `CollectionResult` / `NestedResult` | Map値・コンテナ値は `TerminalResultView`（非null）のままであり**変更なし** |
| 6 | `tests/p5-oracle-expected.ts` / `p6-oracle-expected.ts` / `p7-oracle-expected.ts` | 対象templateが正常完了のみのため実質影響なし（型エラーも発生せず） |
| 7 | `tests/p8-oracle-expected.ts`（新規） | `result` の null チェックを明示的に記述 |
| 8 | 既存テスト（P1〜P7、`output.result` を参照する全assertion） | すべて正常完了snapshotに対する参照であり、型エラー・実行時エラーとも発生しなかった（`npm run typecheck` / `npm run test:unit` で確認） |

**波及していないことの機械検証**: P8-D16 が**全実行可能template（124件）× 全mode（232組合せ）の
全snapshot**を走査し、`result === null` のsnapshotは必ず `kind === 'COLLECT_FAILED'` かつ
`executionFailure !== null` であること、逆に `COLLECT_FAILED` 以外では常に非nullであることを検証する。
現在のtemplate集合では null は **1件**（`tmpl-collect-tomap-duplicate:standard` の最終snapshot）のみ。

## 5. §8.2の10ケースの実測snapshot列と確定列の一致確認結果

**10ケースすべてが確定列と完全一致した**（kind列・`currentElementId`・件数）。担当テストは
P8-D07〜D12（`tests/domain/p8-engine.test.ts`）で、件数はP8-D20（`tests/domain/p8-catalog.test.ts`）が
`snapshotCount` 実測と突き合わせる。

| # | template × mode | 確定件数 | 実測件数 | 一致 | 特記 |
|---|---|---|---|---|---|
| 1 | tomap-identity × standard | 23 | 23 | ✓ | `CONTAINER_CREATED` 不発行。全4要素が「×5」 |
| 2 | tomap-identity × emptySource | 3 | 3 | ✓ | `INITIAL` → `RESULT_CONFIRMED`（空Map）→ `STREAM_CONSUMED` |
| 3 | tomap-duplicate × standard | 12 | 12 | ✓ | `COLLECT_FAILED` 終端。emp-103〜105は `SOURCE_EMIT` されず、`RESULT_CONFIRMED` / `STREAM_CONSUMED` も不発行 |
| 4 | tomap-merge-first × standard | 32 | 32 | ✓ | emp-102 / emp-103が「×7」（DUP → MERGE → UPDATED） |
| 5 | tomap-merge-last × standard | 32 | 32 | ✓ | #4と同一のkind列（結果値のみ異なる） |
| 6 | tomap-merge-concat × standard | 32 | 32 | ✓ | 同上。2回のmergeが「現在Mapにある値」へ順次適用 |
| 7 | tomap-treemap × standard | 26 | 26 | ✓ | `INITIAL` 直後に `CONTAINER_CREATED`（TreeMap::new）1回。emp-003が「×7」 |
| 8 | tomap-treemap × emptySource | 4 | 4 | ✓ | `CONTAINER_CREATED` → `RESULT_CONFIRMED`（空TreeMap）→ `STREAM_CONSUMED` |
| 9 | tomap-grouped × standard | 31 | 31 | ✓ | 各要素が7件（SOURCE_EMIT → NODE_ARRIVAL → CLASSIFIER → BUCKET → KEY → VALUE → UPDATED） |
| 10 | groupby-mergedemo × standard | 28 | 28 | ✓ | 既存P5 `groupingBy(region)` 標準templateとkind構成が一致（`uniqueKinds` 完全一致で検証） |

**期待結果値も §8.2 と一致**（P8-D07〜D12・P8-O01で検証）:

- #1 `{佐藤=佐藤（age=35）, 鈴木=…, 高橋=…, 田中=…}`（`Map<String, Employee>` 4 entry）
- #3 実行失敗（`IllegalStateException` / 重複キー `関東` / 既存値 `"伊藤"` / 新しい値 `"渡辺"`）
- #4 `{関東="伊藤", 関西="中村", 中部="小林"}` / #5 `{関東="山本", …}` / #6 `{関東="伊藤, 渡辺, 山本", …}`
- #7 TreeMapキー昇順 `{中部=4_800_000L, 関東=5_500_000L, 関西=4_200_000L}`（firstにより関東は佐藤）
- #9 `{関東={佐藤=5_500_000L, 高橋=7_200_000L}, 関西={鈴木=…}, 中部={田中=…}}`
- #10 `{関東=[伊藤, 渡辺, 山本], 関西=[中村], 中部=[小林]}`
- #2 / #8 空Map / 空TreeMap

**#7のTreeMapキー順（中部 → 関東 → 関西）**: `String.compareTo`（UTF-16コード単位。
中 U+4E2D < 関 U+95A2、東 U+6771 < 西 U+897F）による導出であり、
**既存Phase 5のTreeMap template（`groupingBy(region, TreeMap::new, toList())`）の実測順と一致**
（P8-D11が両者を突き合わせ）。**P8-O01のJDK 25実測とも一致**。

## 6. 主な変更ファイルとアーキテクチャ上の役割

### 新設

| ファイル | 役割 |
|---|---|
| `src/domain/fixtures/mergeDemoEmployees.ts` | merge実演用の補助Employeeデータセット5件（関東3件） |
| `src/domain/template/templatesP8.ts` | Phase 8 template 8件（toMap 7件 + 同一データgroupingBy比較1件）と教材規約jdkNote |
| `oracle/OracleP8.java` | P8-O01の固定Java 25コード（10ケース + partitioningBy空partition + OBSERVATION） |
| `oracle/expected-p8-from-core.json` | Simulation Core由来の期待値 |
| `tests/p8-helpers.ts` / `tests/p8-oracle-expected.ts` | Phase 8テスト共通helper / Oracle期待値生成 |
| `tests/domain/p8-dsl.test.ts` | P8-D01〜D06（DSL構造・値DSL・merge whitelist・keyMapper制約・結果型・配置制約） |
| `tests/domain/p8-engine.test.ts` | P8-D07〜D12（§8.2の確定snapshot列との完全一致） |
| `tests/domain/p8-failure.test.ts` | P8-D13〜D18（ExecutionFailureViewの配置別・出力契約・決定性 / 復元・teeing） |
| `tests/domain/p8-catalog.test.ts` | P8-D19〜D22（Javaコード・catalog / template / source不変条件・取込対象外・総点検） |
| `tests/domain/p8-oracleSync.test.ts` / `p8-review.test.ts` | P8-O01(sync) / P8-O02 |
| `tests/application/p8-session.test.ts` | P8-A01〜A04 |
| `tests/react/p8-app.test.tsx` | P8-R01〜R06 |
| `e2e/phase8.spec.ts` / `p8-capture.spec.ts` / `p8-narrow.spec.ts` / `p8-utils.ts` | P8-E01〜E05と証跡キャプチャ |

### 変更

| ファイル | 変更点 |
|---|---|
| `src/domain/dsl/collectorAst.ts` | `CollectorDsl` へ `toMap` kind追加（leaf）、`ToMapValueDsl` / `TO_MAP_VALUE_KINDS` / `ToMapMergeId` / `TO_MAP_MERGE_IDS` / `TO_MAP_MERGE_META` / 省略行の意味論文言定数 / `toMapArity` を新設。`COLLECTOR_DSL_KINDS` へ追加。`collectorDepth` / `collectorKindsOf` は**変更なし**（leafのためdefault分岐で正しく扱われる） |
| `src/domain/dsl/validateCollector.ts` | toMapのclosed schema（5キー厳密）・overload組合せ拒否・`validateToMapValueStructure`（専用実装）・`resolveToMapValueType`・`resolveCollectorType` のtoMap分岐（`Map<K, U>` / concat×String / TreeMap×Comparableキー / Employee入力slot制約） |
| `src/domain/dsl/javaCode.ts` | `collectorToJavaExpr` のtoMap分岐と `toMapValueToJavaExpr`。`collection` sourceのJava変数名を `collectionId` 由来へ（既存 `employees` の表示は不変） |
| `src/domain/dsl/explanation.ts` | `describeToMapValue` / `describeToMapMerge`（先勝ち・後勝ちの意味論と入力順の明示） |
| `src/domain/dsl/sourceAst.ts` / `validateSource.ts` | `SOURCE_COLLECTION_IDS` へ `'employeesMergeDemo'` を加算的追加と受理検証 |
| `src/domain/engine/snapshot.ts` | `SnapshotKind` へ5値追加（48→53）、`completion` へ `'EXECUTION_FAILED'`、`Snapshot.executionFailure`、`SnapshotOutput.result` のnull許容化、`CollectorAccumulationView` の `TO_MAP` variant、`ToMapEntryView` / `CollectorToMapView` / `ExecutionFailureView` 新設、`CollectorNodeView.toMap` |
| `src/domain/engine/collectorRuntime.ts` | toMapの蓄積実装（キー評価 → 値評価 → put / merge / 重複失敗）、`WalkCtx` への失敗・bucketPath追加、`effectiveContainerNode` による `CONTAINER_CREATED` の実効root判定、bucket downstream Map生成表示、toMap view構築（蓄積 / 構造4行 / 結果MAP）、`collectorAccumulate` の戻り値化、**`nodeContainerLabel` へtoMap分岐を追加**（4引数版の`CONTAINER_CREATED`説明が「空のを生成しました」と欠落するバグの修正。codexレビュー中-2） |
| `src/domain/engine/stepEngine.ts` | `COLLECT_FAILED` の発行と `completion: 'EXECUTION_FAILED'`、失敗後の終端化（finish cascade・`RESULT_CONFIRMED`・`STREAM_CONSUMED` の不発行）、`Draft` / `PushInput` への `executionFailure` 追加 |
| `src/application/session.ts` | `PlaybackState` へ `'FAILED'` 追加と §7.2 の遷移表実装 |
| `src/application/importContract.ts` | **§7.7の1点のみ**（`hasToMapCollectorSlot` と importable導出への条件追加・`TO_MAP_NOT_IMPORTABLE_REASON`）。`collectorVariants` へtoMap variantは**追加していない** |
| `src/domain/template/pipelineTemplate.ts` | `expectedCompletion?` 任意フィールドと `expectedCompletionOf()` |
| `src/domain/template/templates.ts` | `ALL_TEMPLATES` へ `...P8_TEMPLATES` を集約 |
| `src/providers/fixtureScenarioProvider.ts` | Phase 8 fixture 10件追加 |
| `src/ui/components/CollectorStructurePanel.tsx` | toMap構造4行（`ToMapStructureView`）とentry蓄積表示（`TO_MAP` variant） |
| `src/ui/components/MainSimulation.tsx` | `result === null` のnull分岐と `ExecutionFailureResult`（例外型 / 原因キー / 衝突2値 / Collector経路 / bucketキー） |
| `src/ui/components/StickyPlaybackBar.tsx` | `FAILED` のラベルと進む・自動の無効化（戻るは有効） |
| `oracle/oracle-lib.mjs` / `run-oracle.mjs` | P8-O01 suite追加・P7-O01の `writeReportPath` null化・`REQUIRED_SUITE_IDS` / `CURRENT_PHASE_*` / `PAST_ARTIFACT_DIRS` のP8化・`P7_*` fixture定数と `P8_MATCH_NOTES` の追加 |
| `e2e/capture-helper.ts` | `CAPTURE_TARGET_PHASE` を `7` → `8`（この1か所のみ） |
| `README.md` | Phase 8対応（実装済み操作・テスト結果・実行方法・ドキュメント一覧・ブランチ構成） |

`tools/build_spec_docx.py` は**変更していない**（v0.11対応は着手前のコミット `c5dbad2` / `d9e04b4` /
`e1ea25a` で完了済み。本Phaseでは `tools/verify_spec_docx.py` による検証のみ実施）。

## 7. 実行した全コマンドと終了結果

### 変更前の回帰基準（指示§3.3）

| コマンド | 実行場所 | 結果 |
|---|---|---|
| `npm run lint` | 作業worktree | 終了コード 0 |
| `npm run typecheck` | 作業worktree | 終了コード 0 |
| `npm run test:unit` | 作業worktree | **651 passed（59ファイル）** |
| `npm run build` | 作業worktree | 終了コード 0 |
| `git worktree add <scratchpad>/baseline-4575628 4575628` + `npm ci` | 一時worktree（プロジェクト外） | 終了コード 0 |
| `npm run test:e2e` | 一時worktree | **81 passed** |
| `npm run test:oracle` | 一時worktree | **P7-O01 PASSED / P7-O02 PASSED / P4-O01/P4-O02 REGRESSION PASSED** |
| `git worktree remove --force <scratchpad>/baseline-4575628` | — | 終了コード 0 |

一時worktreeは `C:\Users\toru3\AppData\Local\Temp\claude\...\scratchpad\baseline-4575628`
（**プロジェクトディレクトリの外**）に作成し、取得後に削除した。作業worktreeの
`artifacts/phase-1`〜`phase-7` へは一切書き込んでいない（基準取得時点では
`CAPTURE_TARGET_PHASE = 7` のままだったため、作業worktreeでは E2E / Oracle を実行していない）。

### 変更後（完了判定前の全件再実行）

| コマンド | 結果 |
|---|---|
| `npm run lint` | 終了コード 0（oxlint 指摘0件） |
| `npm run typecheck` | 終了コード 0（`tsc -b` strict） |
| `npm run test:unit` | **787 passed（67ファイル）／ 失敗0・skip0**（codexレビュー対応でP8-D18へ残作業固定テストを1件追加） |
| `npm run build` | 終了コード 0（`✓ built`。各chunk 500 kB未満） |
| `npm run test:e2e` | **終了コード 0 / 最終summary `93 passed`**（**3回連続**で計測。所要58 / 58 / 58秒。実行前後のlistener(4173)は0→0、`node.exe`プロセス数は6→6）。詳細と他条件の実測は§8を参照 |
| `npm run test:oracle` | **P8-O01 PASSED / P8-O02 PASSED / P4-O01/P4-O02 REGRESSION PASSED**（総合判定 PASS） |
| `python tools/verify_spec_docx.py …（v0.11統合docx）` | **合格（失敗 0 件）** |
| `git diff --check` | 出力なし（空白エラーなし） |

## 8. テスト種別ごとの総数・成功・失敗・skip・未実行

| 種別 | 総数 | 成功 | 失敗 | skip | 未実行 |
|---|---|---|---|---|---|
| Vitest（Domain / Application / React） | **787**（67ファイル） | 787 | 0 | 0 | 0 |
| Playwright E2E・視覚回帰 | **93**（PC幅74 / 狭幅19） | 93 | 0 | 0 | 0 |
| JDK 25 Oracle suite | **8**（P1-O01〜P8-O01） | 8 | 0 | 0 | 0 |

- Vitest増分: 651 → 787（**+136件 / +8ファイル**）
- E2E増分: 81 → 93（**+12件**）
- Oracle増分: 7 suite → 8 suite（**+P8-O01**）
- 環境制約による未実行テストは**なし**（Docker + JDK 25 は利用可能、Playwright chromium もインストール済み）

### E2Eの終了挙動（codexレビュー第1回中-3 / 第2回中-1。**未解決・環境差あり**）

レビュー環境では「全assertionが成功表示された後、最終summaryと終了コード0を返さずタイムアウトする」
事象が2回報告されている（第1回: 全93件で180秒／Phase 8 scoped 10件で120秒。
第2回: `npm run test:e2e -- e2e/phase8.spec.ts --project=chromium-pc` の7件で90秒）。
**当環境では一度も再現していない。原因は未特定であり、確定した説明は提示できない。**

#### 当環境の実測（すべて終了コード0）

| # | 実行条件 | 回数 | 終了コード | 所要 | 最終summary | 実行前後のlistener(4173) / node.exeプロセス数 |
|---|---|---|---|---|---|---|
| 1 | `npm run test:e2e` | 3 | すべて **0** | 58 / 58 / 58秒 | `93 passed` を出力 | 0→0 / 6→6（3回とも） |
| 2 | `npm run test:e2e -- e2e/phase8.spec.ts --project=chromium-pc`（レビューと同条件） | 1 | **0** | 16秒 | `7 passed` を出力 | 0→0 / 6→6 |
| 3 | `npx playwright test e2e/phase8.spec.ts --project=chromium-pc`（npmラッパーなし） | 1 | **0** | 16秒 | `7 passed` を出力 | 0→0 / 6→6 |
| 4 | 上記2に `--workers=1` | 1 | **0** | 26秒 | `7 passed` を出力 | 0→0 / 6→6 |
| 5 | 上記2に `--reporter=dot` | 1 | **0** | 15秒 | `7 passed` を出力 | 0→0 / 6→6 |
| 6 | 外部で`npm run preview`を起動（`reuseExistingServer: true`で再利用） | 1 | **0** | 54秒 | `93 passed` を出力 | 1→1（外部起動分。Playwrightは所有しないため停止しないのが正しい挙動） |

環境: Playwright 1.62.1 / Node.js v24.14.0 / npm 11.9.0 / Windows 11。

#### 実施した切り分け（レビュー指摘の調査対象に対応）

| 調査対象 | 実施内容 | 結果 |
|---|---|---|
| 既存listenerの再利用 | 実行前後にポート4173のLISTENER数を記録（上表） | **当環境では常に0→0。第1回で提示した「中断された`vite preview`の残存」仮説は、レビュー環境の実測（listenerなしでも再現）と当環境の実測の双方から支持されない。仮説として取り下げる** |
| プロセスhandleの残留 | 実行前後に`node.exe`プロセス数を記録（上表） | 増減なし（6→6）。孤児プロセスは観測されず |
| npmラッパー | `npx playwright test`で直接実行（上表#3） | 終了コード0。npmラッパー由来の差は当環境では観測できず |
| reporter | `--reporter=dot`で実行（上表#5） | 終了コード0。既定の`list` reporter固有の問題は当環境では観測できず |
| worker数 | `--workers=1`で実行（上表#4） | 終了コード0。並列度由来ではない |
| webServerの終了処理 | `DEBUG=pw:webserver`でライフサイクルを採取 | `WebServer available` → 全テスト実行 → `Terminating the WebServer`（07:17:04.725）→ `Terminated the WebServer`（07:17:04.815）。**終了に90ms**。ハングは観測されず |
| 標準入出力 | 全実行でstdout / stderrをファイルへリダイレクトして計測 | 終了コード0。パイプEOF待ちは当環境では観測できず |

#### 結論（確定事項として扱わない）

- **当環境（Playwright 1.62.1 / Node v24.14.0 / npm 11.9.0 / Windows 11）では、
  上記6条件・計8回すべてで終了コード0と最終summary出力を実測した。Playwrightが起動した
  新規の孤児プロセスは観測されず（`node.exe`数は全条件で実行前後とも同数）、外部preview再利用条件
  （条件6）ではPlaywrightの所有外である既存previewだけが意図どおり残った。**
  なお上表の「listener / `node.exe`数」欄は総プロセス数の増減を示すものであり、
  「実行によって新たに残った孤児プロセスが観測されなかったこと」を意味する（総数0ではない）。
- **レビュー環境では、listenerなしの状態でも全assertion成功後に未終了となる事象が再現している。**
  レビュー第3回の再実測では、`DEBUG=pw:webserver` のログが
  **`Terminating the WebServer` までは出力され、`Terminated the WebServer` が出力されないまま
  60秒でタイムアウト**した（実行前後とも listener 0 / `node.exe` 6）。
  すなわちレビュー環境では**webServer終了要求後の待機で停止**している。
  当環境では同区間が90msで完了しており、**同一箇所での挙動差**であることまでは切り分けられたが、
  差が生じる原因は特定できていない。
- 両者は**環境差**として並記する。原因は特定できていないため、`playwright.config.ts`（Phase 1〜7の
  E2Eにも影響する共有設定）は**根拠なく変更していない**。現時点でPhase 8実装固有の不具合とは
  断定できない。
- **検証境界（残す）**: 本事象について、**レビュー環境では終了コード0を独立確認できていない**。
  当環境の実測のみで「解消済み」とは扱わない。
- **Phase 8の未完了理由には数えない**: 未完了理由は引き続きP8-D15 / P8-D18の必須契約未達であり
  （§1・§9）、本E2E事象を独立した未完了理由として追加していない（レビュー第3回の判断）。
- 再検証時は、実行前後の listener / `node.exe` プロセス数、最終summary、終了コードを記録し、
  あわせて `DEBUG=pw:webserver` のログ（`Terminating the WebServer` → `Terminated the WebServer` の
  出力有無と所要時間）を採取いただきたい。当環境の同ログを上表に併記しており、
  どの段階で停止しているかの切り分けに使える。

## 9. P8必須39 IDの対応表

**37 ID 完全成功 / 1 ID 部分実装（P8-D15）/ 1 ID 未実装（P8-D18）。**

「部分実装」「未実装」のIDは**成功件数に数えていない**。P8-D15はv0.11 §6.2の9が要求する6配置
（root / 単段groupingBy / 多段groupingBy / partitioningBy / adapter系経由 / teeing branch）のうち
**teeing branchの1配置が未検証**であり、P8-D18は契約検証自体を実施できていない。
両IDに対応するテストは「制約の記録」と「既存teeingの回帰確認」であって、契約の充足ではない。

| ID | 対象 | 実装ファイル | 結果 | v0.11 §9・§10 の観点 |
|---|---|---|---|---|
| P8-D01 | toMap DSL構造検証（3 overload受理・未知kind / 許可外キー / 必須キー欠落の拒否・mapFactory∧mergeなしの `STRUCTURE_INVALID`） | `tests/domain/p8-dsl.test.ts` | 成功 | §8.1（overload組合せ） |
| P8-D02 | `ToMapValueDsl`（identity / fieldAccess受理、fieldToPrimitive等の拒否、共有MapperDsl・validateMapperの許可範囲不変） | 同上 | 成功 | §8.3（共有DSL不変。§10-3） |
| P8-D03 | mergeFunction whitelist（3 ID受理・未知ID拒否・concat×非String の `TYPE_MISMATCH`） | 同上 | 成功 | §8.4 |
| P8-D04 | keyMapper・TreeMap制約（ClassifierDsl 3形の流用受理、employeeDepartment×TreeMap拒否、定義不変） | 同上 | 成功 | §8.2・§8.5 |
| P8-D05 | 結果型導出（`Map<String, Employee>` / `Map<String, Long>` / TreeMap表示名 / nested `Map<String, Map<String, Long>>`） | 同上 | 成功 | §8.6（TypeRef再帰） |
| P8-D06 | 配置制約（downstream受理・深さ4以内、mapping配下の `TYPE_MISMATCH`、深さ超過の `COLLECTOR_DEPTH`） | 同上 | 成功 | §8.6 |
| P8-D07 | snapshot列: identity（§8.2 #1 / #2 完全一致・entry蓄積順） | `tests/domain/p8-engine.test.ts` | 成功 | §6.3 |
| P8-D08 | snapshot列: 実行失敗（§8.2 #3 完全一致・`COLLECT_FAILED` 終端・後続不発行・`EXECUTION_FAILED`） | 同上 | 成功 | §6.2の1・3 |
| P8-D09 | snapshot列: first / last（§8.2 #4 / #5・merge引数順・結果差） | 同上 | 成功 | §3.2・§8.4 |
| P8-D10 | snapshot列: concat 3件衝突（§8.2 #6・順次適用） | 同上 | 成功 | §4の4 |
| P8-D11 | snapshot列: TreeMap・`CONTAINER_CREATED` 判定（§8.2 #7 / #8、root adapter経由の実効root判定、キー昇順） | 同上 | 成功 | §6.1・§6.3 |
| P8-D12 | snapshot列: downstream形・配置別生成表示（§8.2 #9 / #10、groupingBy配下4引数版、partitioningBy配下4引数版と空partition） | 同上 | 成功 | §6.3・§3.3・§7 |
| P8-D13 | `ExecutionFailureView`: root（全フィールド厳密一致・他snapshotでnull） | `tests/domain/p8-failure.test.ts` | 成功 | §6.2の9（§10-3） |
| P8-D14 | `ExecutionFailureView`: bucket系（単段 `['c0','c0.bucket#1']` / 多段3要素・bucketPath外側→内側）**配列完全一致** | 同上 | 成功 | §6.2の9 |
| P8-D15 | `ExecutionFailureView`: partitioningBy（bucketPath 1要素）・adapter系（`['c0','c0.down']`・bucketPath空）**配列完全一致**。**teeing branch配置は未検証** | 同上 | **部分実装（成功に数えない）** | §6.2の9 |
| P8-D16 | 実行失敗の出力契約（`confirmed: false` / `result: null`、全template走査でnullは `COLLECT_FAILED` のみ、例外不送出、棚卸し） | 同上 | 成功 | §6.2の6（§10-3） |
| P8-D17 | 決定性・復元（同一revision再実行の同一列、任意cursor移動での完全復元） | 同上 | 成功 | §6.4 |
| P8-D18 | teeing排他・branch生成表示 | 同上 | **未実装（成功に数えない）**。テストは構築不能の記録・既存teeing列の回帰・残作業の固定のみ | §6.3 |
| P8-D19 | Javaコード表示（8 templateの式・source行 / 宣言行・型遷移・既存fixtureの不変） | `tests/domain/p8-catalog.test.ts` | 成功 | §9 |
| P8-D20 | catalog / template / source不変条件（操作46・traits不変、126 / 124 / 232、fixture存在、snapshotCount実測、source契約、dataset対応） | 同上 | 成功 | §9・§10-4 |
| P8-D21 | 取込対象外（7 templateの `importable: false` と理由文言、Contract拒否、groupby-mergedemoは `importable: true`、非toMapの不変、取込系操作の到達不能） | 同上 | 成功 | §10-6 |
| P8-D22 | `expectedCompletion` 総点検（124 template × 232組合せ・予算内・Javaコード生成） | 同上 | 成功 | §1.2 |
| P8-A01 | シナリオ切替（タイマー停止・新revision・history初期化・READY） | `tests/application/p8-session.test.ts` | 成功 | §9 |
| P8-A02 | 再生・復元（全8 template × 全modeの期待終端到達・cursor移動の完全復元・snapshotCount一致） | 同上 | 成功 | §6.4 |
| P8-A03 | FAILED状態遷移（§7.2の遷移表全行・ERROR用stopReason / catch経路の不使用） | 同上 | 成功 | §6.2の3・4（§10-2） |
| P8-A04 | 既存経路回帰・取込Result経路（既存templateの挙動不変、取込系がthrowせず失敗理由を返す） | 同上 | 成功 | §1.2 |
| P8-R01 | toMap構造4行（常設4行・省略行の意味論文言） | `tests/react/p8-app.test.tsx` | 成功 | §5（§10-8） |
| P8-R02 | 蓄積・重複・merge表示（entry蓄積順、重複3点、merge適用フロー、意味論併記、引数順） | 同上 | 成功 | §5・§8.4 |
| P8-R03 | 実行失敗表示（区分表示・例外型・原因キー・ERRORとの文言区別・進む / 自動の無効化と戻るの有効性・経路 / bucketキー） | 同上 | 成功 | §5・§6.2（§10-2） |
| P8-R04 | 操作選択・補助説明・比較導線（操作一覧不変、対象外4件の補助説明、§7.8の教材規約文言、groupingBy比較導線の相互参照） | 同上 | 成功 | §2.2・§4の1・§8.6追補（§10-8） |
| P8-R05 | 取込UI無効化（コピー・貼付の両方無効化と理由表示、非toMapで復帰） | 同上 | 成功 | §10-6 |
| P8-R06 | a11y・responsive（キーボード操作・rowheaderセマンティクス・role="status"・全template描画） | 同上 | 成功 | §5 |
| P8-E01 | identity成功E2E（4 entry到達・entry蓄積表示・履歴復元） | `e2e/phase8.spec.ts` | 成功 | §9 |
| P8-E02 | 実行失敗E2E（`COLLECT_FAILED` 到達・失敗表示・進む不可・戻る→再前進の復元） | 同上 | 成功 | §6.2 |
| P8-E03 | merge / TreeMap / 比較導線E2E（first / last / concatの結果差、3件連結、TreeMapキー昇順、groupingBy比較と相互参照文言） | 同上 | 成功 | §4の1・§8.6追補 |
| P8-E04 | 総点検回帰（全toMap template × modeの到達、既存代表シナリオの回帰、取込UI無効化、処理中表示） | 同上 | 成功 | §1.2 |
| P8-E05 | 狭幅・視覚回帰（PC幅 / 狭幅、横スクロール、sticky非遮蔽、P8基準画像の新設） | `e2e/p8-capture.spec.ts` / `p8-narrow.spec.ts` | 成功 | §5 |
| P8-O01 | toMap実行のJDK 25照合（10ケース + 追加照合・例外型のみ・正規化 / TreeMap実順・OBSERVATION） | `oracle/OracleP8.java` / `tests/domain/p8-oracleSync.test.ts` | 成功 | §3.1・§3.2・§3.3・§7・§9 |
| P8-O02 | Oracle運用検証（必須8 suite・現行Phase単独書込み・過去artifacts不変） | `tests/domain/p8-review.test.ts` | 成功 | §1.2 |

## 10. 既存P1〜P7必須IDの回帰結果と、§12冒頭で許可した意図的更新

**既存P1〜P7の全テストIDが成功**（Vitest 651件相当・Playwright 81件相当・Oracle 7 suiteはすべて
Phase 8実行後も成功。削除・緩和・skipは0件）。

### 意図的更新の一覧（§12冒頭の許可範囲）

| # | 対象 | 更新内容 | 理由 |
|---|---|---|---|
| 1 | `tests/domain/p6-fullcheck.test.ts`（P6-D22） | 走査母集団を `EXECUTABLE_TEMPLATES` → `PHASE7_EXECUTABLE_TEMPLATES`（`ALL_TEMPLATES` から `P8_TEMPLATES` 全件を除外）へ固定 | Phase 8は正常完了しないtemplateを追加するため、末尾が常に `STREAM_CONSUMED` であることを要求する本テストと衝突する。既存全templateへの検証意味（`STREAM_CONSUMED` 終端・予算内・Javaコード生成）は保存。全templateの総点検はP8-D22が引き継ぐ |
| 2 | `tests/domain/p7-catalog.test.ts`（P7-D20） | 総数118 / 実行可能116 / 組合せ222の検証対象を `PHASE7_TEMPLATES` / `PHASE7_EXECUTABLE_TEMPLATES` へスコープ固定 | 同上。「toMap非含有」抽出では `tmpl-collect-groupby-mergedemo` が残り 119 / 117 / 223 になるため、除外はtemplate ID集合（`P8_TEMPLATE_IDS`）で行った。Phase 8の件数はP8-D20が担う |
| 3 | `tests/p6-helpers.ts` の `IMPORTABLE_TEMPLATES` | 「取込対象template」導出を「gatherノード非含有」→「gatherノード非含有**かつ** collector slotに `'toMap'` を含まない」へ拡張（`hasToMapCollectorSlot` を使用）。`TO_MAP_TEMPLATES` / `PHASE7_TEMPLATES` / `PHASE7_EXECUTABLE_TEMPLATES` を追加 | toMap templateは `importable: false` のため、Contract受理を前提とするテストの走査対象から外す。導出をヘルパへ一元化した |
| 4 | `tests/domain/p6-contract.test.ts`（P6-D01〜D03） | ローカル定義の `EXECUTABLE_TEMPLATES` を `IMPORTABLE_TEMPLATES`（ヘルパ）へ差し替え | #3の一元化。既存の非gather・非toMap template全件への検証意味は保存。toMap templateの拒否検証はP8-D21が担う |
| 5 | `tests/application/p6-session.test.ts`（P6-A03） | 変更なし（`IMPORTABLE_TEMPLATES` をヘルパから参照しているため #3 の更新で自動的に整合） | 同上 |
| 6 | `tests/domain/p7-catalog.test.ts`（P7-D21） | 変更なし（`IMPORTABLE_TEMPLATES` 参照のため #3 で整合） | 同上 |
| 7 | `tests/domain/p6-javacode.test.ts`（P6-D18） | 追加キーの許可集合を「Phase 7 gather 11件」→「Phase 7 gather 11件 + Phase 8の10 fixture」へ拡張（件数もassert） | golden JSON自体は書き換えず、既存キー・出力の不変検証は一切緩めていない |
| 8 | `tests/domain/p7-review.test.ts`（P7-O02） | Phase 7時点のsuite構成を**fixtureとして固定**する形へリファクタリング（`P7_SUITES` ローカル定数 + `P7_REQUIRED_SUITE_IDS` / `P7_CURRENT_PHASE_*` / `P7_PAST_ARTIFACT_DIRS` / `P7_MATCH_NOTES`） | Phase 8でライブ構成が8 suite・P8単独書込みへ変わるため。P5-O02 / P6-O02の前例に従う。検証意味は変更・緩和していない。ライブ構成の検証は新規P8-O02が担う |
| 9 | `tests/domain/p5-catalog-dsl.test.ts`（P5-D02） | 「未知kind」の例に使っていた `{ kind: 'toMap' }` を `{ kind: 'toConcurrentMap' }` へ差し替え | toMapがPhase 8で実装済みkindになったため。v0.11 §2.2で対象外と明記された `toConcurrentMap` を代わりに用いた。検証意味（未知kindは `STRUCTURE_UNKNOWN_KIND` で拒否）は不変。**§12冒頭末尾の「件数前提・一覧前提が壊れる既存assertionの最小更新」に該当** |
| 10 | `e2e/capture-helper.ts` | `CAPTURE_TARGET_PHASE` を `7` → `8`（この1か所のみ） | 指示§12冒頭・§14 |
| 11 | 視覚回帰基準画像（`e2e/__screenshots__/`） | **既存35枚は1枚も更新していない**。Phase 8分8枚を新設 | 指示§10「原則据え置き」。差分が発生しなかったためdiff確認つき意図的更新も不要だった |

上記以外の既存テストの削除・緩和・skipは行っていない。

## 11. P8-O01 / P8-O02 の結果

- **JDKベンダー / バージョン**: `openjdk version "25.0.3" 2026-04-21 LTS` /
  `OpenJDK Runtime Environment Temurin-25.0.3+9 (build 25.0.3+9-LTS)` /
  `OpenJDK 64-Bit Server VM Temurin-25.0.3+9 (build 25.0.3+9-LTS, mixed mode, sharing)`
  （Dockerイメージ `gradle:9.6.1-jdk25`）
- **P8-O01: PASS**（期待値と実測値のJSON完全一致）。10ケース + 追加照合1件（partitioningBy空partition）。
- **P8-O02: PASS**（必須8 suite各1件・現行Phase単独書込み・過去artifacts SHA-256不変）。
- **P1-O01〜P7-O01 の回帰**: 全PASS（照合のみ・証跡書込みなし）。**P4-O02**（Long境界値）もPASS。
- 証跡: `artifacts/phase-8/oracle-result.md`

### Map結果のキー順正規化とTreeMap実順序比較の区別

| 対象 | 方式 | 実測結果 |
|---|---|---|
| 順序保証のないMap（2・3引数版toMap・groupingBy・nested Map） | `キー=値` 文字列の**辞書順へ正規化**して比較（正規化は比較のためだけであり、iteration order保証を意味しない） | `identity` / `mergeFirst` / `mergeLast` / `mergeConcat` / `groupingByMergeDemo` / `groupedToMap` の6キーで完全一致 |
| TreeMap（4引数版・partitioningBy配下） | **実entry順のまま**厳密比較（順序自体が検証対象） | `treeMapOrdered = ["中部=4_800_000L","関東=5_500_000L","関西=4_200_000L"]`（encounter orderの 関東 → 関西 → 中部 とは異なることを機械検証）。`partitionTrue = ["佐藤=…","田中=…","鈴木=…","高橋=…"]` |

### merge適用順・encounter orderの結果値検証

- **first → `関東="伊藤"` / last → `関東="山本"`**: 同一データ・同一keyMapperでの結果差が
  「(既存値, 新しい値)」の適用順を実証した（JDK実測と完全一致）。
- **concat → `関東="伊藤, 渡辺, 山本"`**: 連結順が順次適用のencounter orderを実証した。
- **同一データのgroupingBy → `関東=[伊藤（age=31）, 渡辺（age=38）, 山本（age=26）]`**: 1キー多値で
  衝突しないことを実証した。
- **空stream（v0.11 §7の「導出」区分）**: `identityEmpty = []` / `treeMapEmpty = []`（空Map）。導出と実測が一致。
- **partitioningBy空partition（v0.11 §3.3の公式仕様）**: `partitionFalseEmpty = []`（要素0件のpartitionにも
  downstream supplierの適用結果 = 空TreeMap が値として入る）。実測一致。

### OBSERVATION（厳密比較の対象外。JDKの保証として扱わない）

```
OBSERVATION: toMap2Arg.exceptionMessage=Duplicate key 関東 (attempted merging values 伊藤 and 渡辺)
OBSERVATION: toMap3Arg.mergeCallOrder=merge(伊藤, 渡辺) | merge(伊藤, 渡辺, 山本)
OBSERVATION: toMap3Arg.mergeLoggedResult=伊藤, 渡辺, 山本
OBSERVATION: toMap2Arg.returnedMapClass=HashMap
OBSERVATION: toMap4Arg.returnedMapClass=TreeMap
OBSERVATION: partitioningBy.keySet=[false, true]
```

- **例外メッセージ**: 契約は例外**型のみ**（`IllegalStateException`）。メッセージ全文は
  照合・表示のいずれの契約にも含めていない。観測記録として上記に保存した。
- **mergeFunctionの呼出し順**: 第1引数が**Map内の既存値**（2回目は前回merge結果 `伊藤, 渡辺`）で
  あることを実測で確認した（v0.11 §3.2の `Map.merge` 契約と一致。指示§17の停止条件に該当せず）。
- **返却Map型**: 2引数版は `HashMap`、4引数版は `TreeMap`。2引数版の型はJDKの保証対象外であり、
  教材では型名を断定表示していない（構造4行のmapFactory行は「なし（Map実装型は無保証）」）。

## 12. §10の総点検（124 template × 232組合せ）の結果

**P8-D22（`tests/domain/p8-catalog.test.ts`）が全件成功。**

- 走査対象: 実行可能template **124件** × `supportedModes` の全組合せ **232組合せ**（機械的に件数を検証）
- `expectedCompletion` どおりの終端: **232 / 232 一致**（不一致0件）
  - `EXECUTION_FAILED` を期待するのは `tmpl-collect-tomap-duplicate:standard` の **1組合せのみ**
  - 残り231組合せは `STREAM_CONSUMED`
- snapshot安全上限（500）超過: **0件**
- Javaコード表示が0行の組合せ: **0件**
- `expectedCompletion` を明示しているtemplateは1件のみで、未指定templateの導出値は全件 `STREAM_CONSUMED`

あわせて **P6-D22** がPhase 7完了時点集合（116 template / 222組合せ）に対する
`STREAM_CONSUMED` 終端検証を従来どおり継続している。画面上の総点検は **P8-E04**
（全toMap template × modeの到達確認）と **P7-E04 / P6-E04**（既存分）が担う。

## 13. 視覚回帰基準画像の新設一覧と既存画像の更新有無

**既存基準画像（P1〜P7の35枚）は1枚も更新していない**（`git status e2e/__screenshots__` に
変更ファイルなし。`--update-snapshots` なしでの再実行も全件PASS）。
**色比較のthresholdも `maxDiffPixels` も緩和していない**（`playwright.config.ts` は無変更）。

### Phase 8基準画像の再生成（意図的更新。指示§10の「diff確認の上での意図的更新」）

**事象**: 新設した `p8-e05-groupby-mergedemo.png` で、fullPage比較が**間欠的に**
98ピクセル（全体の0.01%）の差分を出した（6回中1回。worker数を1にしても発生）。

**diff確認の内容**: 差分ピクセルの座標を集計したところ、閾値を超える差分は
**y=2295〜2307 の13px帯に限局**しており、これはページ最下部の
`DetailsDisclosure`（閉じた`<summary>`行「詳細（record定義・元データ・JDK補足）」）である。
actual / expected の当該領域を切り出して並べて拡大比較した結果、**表示内容は完全に同一**で、
サブピクセルのレイアウト丸めによる1pxのゆらぎであることを確認した
（意味のある表示差ではない）。

**対応（thresholdを緩めない方法を選択）**:

1. P8-E05の8枚のスクリーンショット比較に `mask: [page.getByTestId('details-disclosure')]` を指定し、
   **この1要素だけを比較対象から外した**（`e2e/p8-capture.spec.ts` / `p8-narrow.spec.ts` の
   `stableShot()`）。色比較のthreshold・`maxDiffPixels` は既定のまま変更していない。
2. マスク指定に伴い **Phase 8の8枚を再生成**した（既存P1〜P7の35枚は対象外・無変更）。
3. 再生成後、P8 specを**4回連続**（すべて終了コード0）、全E2Eを**3回連続**（すべて終了コード0・93 passed）
   実行して安定を確認した。

**マスクによる検証範囲の変化（正確な表現）**: マスクした`details-disclosure`要素については、
**視覚回帰の範囲が除外される**（色・境界線・余白・折返し等の視覚差は検出できなくなる）。
一方、**P8-E05の主目的であるtoMap表示・FAILED表示・狭幅レイアウトはマスク外の領域で従来どおり
比較を維持**しており、マスクしたのは主対象外の「閉じた補助欄」1要素に限られる。
当該要素の**内容面**（対象外機能の補助説明・groupingBy比較導線の相互参照文言・record定義・元データ）は
**P8-R04 がDOMレベルで補完**する。thresholdも緩和していない。

### 新設（8枚）

| ファイル | 内容 |
|---|---|
| `e2e/__screenshots__/p8-capture.spec.ts/p8-e05-tomap-identity-completed.png` | identity成功（PC幅） |
| `e2e/__screenshots__/p8-capture.spec.ts/p8-e05-tomap-duplicate-failed.png` | 実行失敗（`COLLECT_FAILED` / FAILED表示） |
| `e2e/__screenshots__/p8-capture.spec.ts/p8-e05-tomap-merge-concat.png` | concat 3件衝突 |
| `e2e/__screenshots__/p8-capture.spec.ts/p8-e05-groupby-mergedemo.png` | 同一データのgroupingBy比較 |
| `e2e/__screenshots__/p8-capture.spec.ts/p8-e05-tomap-treemap.png` | 4引数版TreeMap（キー昇順） |
| `e2e/__screenshots__/p8-capture.spec.ts/p8-e05-tomap-grouped.png` | downstream形（nested Map） |
| `e2e/__screenshots__/p8-narrow.spec.ts/p8-e05-narrow-tomap-identity.png` | 狭幅（375px）toMap表示 |
| `e2e/__screenshots__/p8-narrow.spec.ts/p8-e05-narrow-tomap-failed.png` | 狭幅（375px）FAILED表示 |

## 14. PC幅 / 狭幅キャプチャの保存先

`artifacts/phase-8/`（17ファイル）。

- **PC幅（1280×900）**: `p8-tomap-identity-accumulating.png` / `p8-tomap-identity-completed.png` /
  `p8-tomap-duplicate-detected.png` / `p8-tomap-duplicate-failed.png` / `p8-tomap-merge-first.png` /
  `p8-tomap-merge-last.png` / `p8-tomap-merge-concat.png` / `p8-groupby-mergedemo.png` /
  `p8-tomap-treemap.png` / `p8-tomap-grouped.png` / `p8-import-disabled.png`
- **狭幅（375×812）**: `p8-narrow-tomap-identity.png` / `p8-narrow-tomap-failed.png` /
  `p8-narrow-tomap-merge-concat.png` / `p8-narrow-groupby-mergedemo.png` / `p8-narrow-tomap-treemap.png`
- **Oracle結果**: `p8` suiteの `oracle-result.md`（OBSERVATION行を含む）

証跡書込みは `CAPTURE_TARGET_PHASE = 8` により `artifacts/phase-8/` のみへ限定され、
`artifacts/phase-1`〜`phase-7` は E2E・Oracle の実行前後で不変であることを確認した
（`git status` に変更なし、Oracle は SHA-256 実測比較で PASS）。

**PC幅 / 狭幅の目視確認（指示§13-5）**: 上記キャプチャで、toMap構造4行の常設表示、entry蓄積
（キー → 値1件）、重複検出の3点表示、merge適用フローと意味論併記、実行失敗表示（例外型・原因キー・
衝突2値・Collector経路）、取込UIの無効化と理由、狭幅での縦積み・横スクロール非漏出・sticky非遮蔽を
確認した。狭幅の幾何条件（本文の横スクロールなし・sticky再生バーが本文を隠さない）は
P8-E05 が数値で機械検証している。

## 15. 統合docxビルドの実行結果と目視確認内容

`tools/build_spec_docx.py` の v0.11 対応と統合docxの生成は、**Phase 8実装着手前**に完了済みである
（コミット `c5dbad2`「統合版docx v0.11を生成しビルド・検証ツールへ--v11対応を追加」、
`d9e04b4` / `e1ea25a` でcodexレビュー指摘を反映。指示§14の「`tools/build_spec_docx.py` のv0.11対応と
統合docxの再ビルド」はこの時点で完了している）。本Phaseでは**再生成は行わず、検証のみ**実施した
（実装開始依頼文の指示に従う）。

### `tools/verify_spec_docx.py` の実行結果

```
python tools/verify_spec_docx.py \
  --base docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx \
  --out  docs/Java_Stream_API_Visualization_Spec_v0.11.docx \
  --v09  docs/Java_Stream_API_Visualization_Spec_v0.9_Gatherers.md \
  --v10  docs/Java_Stream_API_Visualization_Spec_v0.10_Phase6_ManualLink.md \
  --v11  docs/Java_Stream_API_Visualization_Spec_v0.11_toMap.md
→ 結果: 合格（失敗 0 件）
   note: v0.8 SHA-256 = 673eb8ea36f93bf04971ce189871a8b9eaf60d684c9f2877ccce5bc894e56666
```

**検証項目の内訳（すべてOK）**:

1. v0.8 docx がバイト単位で不変（SHA-256一致）
2. ZIP/XML整合（全part存在・XMLパース可能・style / numId定義済み）
3. 差分の限定（v0.8本文要素の削除なし・変更要素が想定どおり）
4. 転記の網羅性: 第26章（v0.9）・第27章（v0.10）・**第28章（v0.11）** の見出し・表行・リスト項目数が
   差分mdと完全一致（**第28章: md見出し27 / docx見出し27、md表行35 / docx表行35、
   mdリスト107 / docxリスト107、md段落22、欠落0件**）
5. §参照の健全性: 全参照が実在する見出しを指す（欠落なし。参照された章 115件 / 総見出し 434件）。
   「v0.8 §」表記の残存なし

**追加の引数パターン確認**: v0.10統合docx（`--v09` + `--v10`）も**合格（失敗 0 件）**。
`--v11` を `--v10` なしで指定した場合は設計どおり
「`--v11` には `--v10` が必要です（省略すると第27章の転記検証が抜ける）」で拒否された。

**目視確認**: 第28章「Java Stream API 可視化シミュレーター 仕様書 v0.11（Collectors.toMap差分版）」が
章として取り込まれ、§1〜§10の見出し階層・3 overload表・mergeFunction表・snapshot列表・
`ExecutionFailureView` のコードブロック・§8.6末尾の追補が本文へ反映されていることを確認した。
仕様書原本（v0.8 docx / v0.9 md / v0.10 md / v0.11 md）はいずれも**未変更**である
（`git status` に変更なし）。

## 16. 仕様との差異と実装判断

**未実装の差異が1件ある**: v0.11 §6.2の9 / §6.3が要求する **teeing branch配置のtoMap契約
（`ExecutionFailureView`の配列検証・branch直下 / branch内部の更新kind排他・4引数版のTreeMap生成context）が
未実装**である（本報告§1・§17-1、`docs/phase-8-decisions.md` §9）。
それ以外については、v0.11と実装の意味論上の差異はない。
指示書が実装へ委ねた事項の確定内容は `docs/phase-8-decisions.md` に記録した（17節）。
主要なものは次のとおり。

| 事項 | 決定 | 参照 |
|---|---|---|
| 補助データセットとSource DSLの加算的追加 | `employeesMergeDemo`（5件・関東3件）を新設。既存 `employees` は完全に不変 | decisions §1 |
| データ選択の単一定義源 | `FixtureScenarioProvider` の dataset。`collectionId` は識別子（`materializeSource` の構造は不変） | decisions §2 |
| merge結果値のID | 独立IDを**付与しない**（`keyRef` + `valueLabel` で復元契約・決定性を満たす） | decisions §3 |
| midEmpty | 全Phase 8 templateで非対応 | decisions §4 |
| `expectedCompletion` | 任意フィールド + `expectedCompletionOf()` へ導出を一元化 | decisions §5 |
| 取込対象外の実装方式 | `importContract.ts` の1点のみ。`collectorVariants` へvariantを追加しない二重防御 | decisions §6 |
| `result` null許容化の波及 | UIのnull分岐1か所。P8-D16が全template走査で非波及を機械検証 | decisions §7 / 本報告§4 |
| Javaコード表記 | `Function.identity()` / `(a, b) -> a` 等。`import` 行は既存規約どおり表示しない | decisions §8 |
| **teeing branchへのtoMap配置** | **未実装**（現行merger whitelistの型制約により構築不能。ユーザー決定で追加せず） | decisions §9 / 本報告§1 |
| FAILED の stopReason | 設定しない（表示情報は `Snapshot.executionFailure`） | decisions §10 |
| 実行失敗の伝搬 | 戻り値・状態のみ（TypeScript例外・`EngineInvariantError` を使わない） | decisions §11 |
| `CONTAINER_CREATED` の実効root判定 | toMapのみadapter連なりを辿る。既存 `toCollection` の判定は不変 | decisions §12 |
| bucket downstream Map の生成表示 | groupingByは新規 `BUCKET_SELECTED` のjdkNoteへ加算。partitioningByは初期構造viewが担う | decisions §13 |
| Oracle照合の表記整合 | 正規化 / TreeMap実順 / 結果値検証 / 例外型のみ + OBSERVATION | decisions §14 |
| 視覚回帰 | 既存据え置き（更新0件）・Phase 8分8枚を新設 | decisions §15 |

## 17. 既知の問題と持越し事項

1. **teeing branchへのtoMap配置（P8-D18 未実装 / P8-D15 部分実装）** — Phase 8で未実装。
   現行の制約自体はP8-D06 / P8-D15 / P8-D18が機械検証として固定している。
   将来 Map結果を受け取れる teeing merger record（例:
   `record RegionIndex(Map<String, String> byRegion, long count)`）を追加して到達可能にする場合、
   **次の3点が未対応のまま残っている**（`docs/phase-8-decisions.md` §9。
   `tests/domain/p8-failure.test.ts` の「P8-D18(残作業の固定)」が現状を機械的に固定している）。

   | # | 残作業 | 現状 |
   |---|---|---|
   | (1) | **左右branch間の`ctx.path`復元** | `collectorRuntime.ts` のteeing分岐は `ctx.pathLabels` の長さのみ戻し、`ctx.path` を戻していない。そのため右branchの経路は `['c0','c0.left','c0.right']` になる（テストで固定済み）。v0.11 §6.2の9が右branch失敗に期待する `['c0','c0.right']` と一致しないため、`ctx.path` の復元が必要。**ただしこの経路は Phase 5 の既存teeing snapshot（`currentPath`）契約でもあるため、変更時は既存P5テスト・基準画像への影響評価が必須** |
   | (2) | **branch直下 / branch内部（adapter経由）の更新kind排他のtoMapでの検証** | `isLeafAccumulator` + `overrideKind` の既存機構に依存しており、toMapでは一度も実行されていない。branch直下は `CONTAINER_UPDATED` → `TEE_BRANCH_ACCUMULATED` 置換、branch内部は内部 `CONTAINER_UPDATED` ＋ branch確定の別事象、失敗要素は `TEE_BRANCH_ACCUMULATED` 不発行、の3分岐を実行検証する必要がある |
   | (3) | **初回`TEE_BRANCH_ACCUMULATED` / 0件branchの`TEE_BRANCH_FINISHED`へのTreeMap生成context** | **未実装**。v0.11 §6.3の親種別表（teeing行）が要求する「branchのdownstream Map生成表示」を、これらの事象のcontextへ載せる実装が必要（現状は生成表示を持たないことをテストで固定している） |

   **解消（2026-08-13追記、Phase 9）**: 本項はPhase 9（仕様v0.12差分・ブランチ`phase-9`）で
   `docs/phase-8-decisions.md` §9.1のA案（`RegionIndex::new`の追加）とともに**すべて解消した**。
   P8-D18はbranch直下（成功put / merge / 重複キー失敗）とbranch内部（adapter経由の内部
   `CONTAINER_UPDATED` + branch確定の別事象発行）の排他、およびbranch生成表示（全snapshot列で
   正確に1回）を実行検証し、P8-D15は第6配置
   （teeing branch）の`collectorPath` / `bucketPath`配列完全一致を検証した。上記の固定テスト
   「P8-D18(残作業の固定)」「P8-D15(未実施記録)」は実装版へ書き換えた。(1)のPhase 5波及は実測ゼロ
   （P5テストに右branch経路のassertはなく、視覚回帰基準画像はmerger適用時点〔`currentPath = []`〕のみで
   画素不変）。これによりP8必須39 IDはすべて完全成功となった。記録は`docs/phase-8-decisions.md` §9.2。
2. **toMapの手動連携取込開放** — v0.11 §10-6のユーザー決定（2026-08-13）により見送り。
   開放する場合は `collectorVariants` へのtoMap variant追加とプロンプト生成のtoMap言語化が必要。
   `importable: false` 化（§7.7）は開放ではなく対象外化のための実装である。
3. **`Collectors.toUnmodifiableMap` 系** — nullキー / null値の禁止と不変Mapの可視化という別論点を伴うため、
   `toUnmodifiableList` / `toUnmodifiableSet` / finisher可視化 / `UnsupportedOperationException` の
   Oracle確認とあわせて将来の「unmodifiable系一括Phase」へ持越す（v0.11 §2.2）。

   **解消（2026-08-14追記、Phase 11）**: 本項はPhase 11（仕様v0.14差分
   `docs/Java_Stream_API_Visualization_Spec_v0.14_Unmodifiable.md`・ブランチ`phase-11`）で
   **一括して解消した**。v0.11 §2.2が一括Phaseの内容として挙げた4点はすべて実装している。

   | # | 持越し時の論点 | Phase 11での解消内容 |
   |---|---|---|
   | (1) | `toUnmodifiableList` / `toUnmodifiableSet`を含む一括追加 | 3 kindをleaf Collectorとして追加（v0.14 §2.1）。closed schemaは`mapFactoryId`キーを許可集合に含めず、存在すれば構造検証で拒否する（Javaにmap Factory版overloadが存在しないため）。keyMapper / valueMapper / merge 6種の検証は既存toMapを変更なしで流用 |
   | (2) | finisher可視化 | 3 kindを`COLLECTOR_FINISHED`の発行対象へ追加（Phase 5発行表の加算的拡張。v0.14 §3.2）。蓄積ラベル`List（蓄積中）`→ 結果ラベル`List（unmodifiable）`のコンテナラベル遷移で変換を示す。配置別の発行契約（通常root 1件 / bucketごと / teeing branch直下は`TEE_BRANCH_FINISHED`のみ / branch内部nestedは別事象 / 二重発行なし）と、finisher前後で**値とTypeRefが不変**であることをP11-D08・P11-D09が機械検証する |
   | (3) | 変更操作が`UnsupportedOperationException`になることのOracle確認 | 画面上では実演せず（v0.14 §3.4のユーザー決定）、JDK 25実測で担保した。P8-O01へUOE契約3キー（`uoeOnListAdd` / `uoeOnSetAdd` / `uoeOnMapPut`）を追加し完全一致（PASS）。例外が送出されない場合は`NO_EXCEPTION(...)`形式で値化して見逃しを防ぐ。実測の返却実装クラス（`ListN` / `SetN` / `MapN`）と例外メッセージはOBSERVATION行に留め、JDK内部実装は断定しない |
   | (4) | nullキー・null値禁止の扱い | NPEは実行対象外のまま（v0.11 §2.2の判断を維持）とし、その前提となる**非null不変条件**を明文化して3層の機械検証を新設した（v0.14 §4）。producer登録集合はOperationCatalog全46 operationの全域分類と識別可能union実軸の互換直積から**機械導出**し、値生成operation集合とproducer展開のカバー集合の**双方向一致**を検証する。全producerが`VALUE_REACHED` / `ZERO_EMISSION` / `INVARIANT_BLOCKED`のいずれかで検証済み・未実行0件であることをassertする（`INVARIANT_BLOCKED`はwindow系のみ。合成List値がPhase 7の構造的不変条件によりCollector境界へ到達できないため、gather放出点の全窓値検査と`EngineInvariantError`による遮断の負例で検証する）。導出元への仮想operation / kind注入で登録差分が検出されることを負例メタテストで確認している |

   あわせて教材template 3件（`tmpl-collect-tounmod-list` / `-set` / `-map`）を追加し、既存教材
   （toList / `Stream.toList()` / toSet / toMap merge first）との対比導線をjdkNotesへ付した。
   2引数版の重複キーは意味論がtoMap 2引数版と同一のため専用templateを設けず、
   `tmpl-collect-tomap-duplicate`への参照注記で扱っている（ユーザー決定）。
   `TO_MAP_OUT_OF_SCOPE_NOTES`からtoUnmodifiableMap項を削除し、P8-R04を書き換えた
   （残る対象外注記はtoConcurrentMapとkey側identityの2件）。
   検証はVitest 885 / Playwright 93 / oracle PASS / docx verify合格（第31章）で、
   視覚回帰基準画像の更新はゼロ。記録は`docs/phase-8-decisions.md` §18。
   codex実装レビューは第1〜3回が承認不可、**第4回で承認**（高0・中0・低0）。指摘はすべて
   §4非null機械検証の保証の強度に関するもので、Collector本体の実装への指摘は全回0件だった。
   第1回の高指摘を受けてv0.14 §4-2b / §4-3 / §6を改訂し、producer完了状態へ
   `INVARIANT_BLOCKED`を追加している（経緯と各回の対応は`docs/phase-8-decisions.md` §18.1・§18.4）。
4. **数値加算merge（`Long::sum` 等）** — オーバーフロー・safe integer範囲・doubleの丸めを整理したうえで
   型付きの数値mergeファミリーとして設計する必要があるため持越す（v0.11 §2.2）。

   **解消（2026-08-13追記、Phase 10）**: 本項はPhase 10（仕様v0.13差分
   `docs/Java_Stream_API_Visualization_Spec_v0.13_NumericMerge.md`・ブランチ`phase-10`）で解消した。
   `sumInt` / `sumLong` / `sumDouble`の3 ID（Java表示は`Integer::sum` / `Long::sum` / `Double::sum`）を
   型付きファミリーとして追加し、v0.13 §3が求められていた整理（intラップ・safe integer範囲・
   doubleの丸め）に回答した。教材template 3件（employeesMergeDemo × region × age / salary /
   evaluation）を追加し、P8-O01へ3キーを追加してJDK 25実測と完全一致。
   記録は`docs/phase-8-decisions.md` §17。
5. **`Collectors.toConcurrentMap` 系** — unordered Collectorであり決定的な逐次Step Engineでは
   意味論を正確に可視化できないため対象外のまま（補助説明のみ）。
6. **key側 `Function.identity()`（Employeeキー）** — recordのequalsによるキー等価と TreeMap不可
   （EmployeeはComparableでない）という別論点を伴うため、実行対象外のまま（補助説明のみ）。
7. **`Map.merge` の「remapping結果がnullならentry削除」意味論** — 許可merge 3種はnullを返さないため
   本教材の実行では発生しない（存在は補助説明のみ）。

## 18. 最終 `git diff --stat` / `git status --short` と、commit / push / PR を行っていないことの確認

### `git diff --stat`（追跡済みファイルの変更）

```
 README.md                                     |  80 ++++--
 e2e/capture-helper.ts                         |   2 +-
 oracle/oracle-lib.mjs                         |  86 ++++--
 oracle/run-oracle.mjs                         |  23 +-
 src/application/importContract.ts             |  26 +-
 src/application/session.ts                    |  37 ++-
 src/domain/dsl/collectorAst.ts                |  81 ++++++
 src/domain/dsl/explanation.ts                 |  28 ++
 src/domain/dsl/javaCode.ts                    |  34 ++-
 src/domain/dsl/sourceAst.ts                   |  16 +-
 src/domain/dsl/validateCollector.ts           | 149 +++++++++-
 src/domain/dsl/validateSource.ts              |   8 +-
 src/domain/engine/collectorRuntime.ts         | 389 +++++++++++++++++++++++++-
 src/domain/engine/snapshot.ts                 | 102 ++++++-
 src/domain/engine/stepEngine.ts               |  69 ++++-
 src/domain/template/pipelineTemplate.ts       |  14 +
 src/domain/template/templates.ts              |   3 +
 src/providers/fixtureScenarioProvider.ts      | 187 +++++++++++++
 src/ui/components/CollectorStructurePanel.tsx |  74 +++++
 src/ui/components/MainSimulation.tsx          |  78 ++++++
 src/ui/components/StickyPlaybackBar.tsx       |   5 +
 tests/domain/p5-catalog-dsl.test.ts           |   7 +-
 tests/domain/p6-contract.test.ts              |  10 +-
 tests/domain/p6-fullcheck.test.ts             |  13 +-
 tests/domain/p6-javacode.test.ts              |  18 +-
 tests/domain/p7-catalog.test.ts               |  22 +-
 tests/domain/p7-review.test.ts                | 146 ++++++----
 tests/p6-helpers.ts                           |  33 ++-
 28 files changed, 1573 insertions(+), 167 deletions(-)
```

`git diff --check` は出力なし（空白エラーなし）。

### `git status --short`（未追跡の新規ファイル）

**件数の内訳と対象範囲**:

| 区分 | 件数 | 内訳 |
|---|---|---|
| **Phase 8レビュー・成果物の対象** | **51件** | 変更28 / 未追跡23（下記一覧） |
| 作業ツリー全体 | **52件** | 上記51件 + `.claude/`（未追跡1） |

`.claude/`（実体は`.claude/settings.local.json`の1ファイル）は**Phase 8の対象外**とする。
内容はClaude Codeのスキルのローカルoverride（`skillOverrides`）のみでPhase 8の実装・テスト・証跡へ
影響せず、タイムスタンプ（2026-08-12 21:51）もPhase 8着手時のHEAD `251fa03`（2026-08-13 12:16）より
前であり、本Phaseで作成・変更していない。当環境ではユーザーのグローバル除外設定
（`~/.config/git/ignore` の `**/.claude/settings.local.json`）により`git status`へ出現しないため
51件と表示される（レビュー環境で52件と観測されたのは**環境差**）。
リポジトリの`.gitignore`への`.claude/`追加はPhase 8のスコープ外と判断し、行っていない。

```
?? artifacts/phase-8/
?? docs/phase-8-completion-report.md
?? docs/phase-8-decisions.md
?? e2e/__screenshots__/p8-capture.spec.ts/
?? e2e/__screenshots__/p8-narrow.spec.ts/
?? e2e/p8-capture.spec.ts
?? e2e/p8-narrow.spec.ts
?? e2e/p8-utils.ts
?? e2e/phase8.spec.ts
?? oracle/OracleP8.java
?? oracle/expected-p8-from-core.json
?? src/domain/fixtures/mergeDemoEmployees.ts
?? src/domain/template/templatesP8.ts
?? tests/application/p8-session.test.ts
?? tests/domain/p8-catalog.test.ts
?? tests/domain/p8-dsl.test.ts
?? tests/domain/p8-engine.test.ts
?? tests/domain/p8-failure.test.ts
?? tests/domain/p8-oracleSync.test.ts
?? tests/domain/p8-review.test.ts
?? tests/p8-helpers.ts
?? tests/p8-oracle-expected.ts
?? tests/react/p8-app.test.tsx
```

### 保護対象の不変性

- **v0.8 / v0.9 / v0.10 / v0.11 の各仕様書と統合docx**: 変更なし（`git status` に出現せず。
  v0.8 docx の SHA-256 も verify で一致確認）
- **`docs/phase-1-*.md` 〜 `docs/phase-7-*.md`（完了報告・判断記録）**: 変更なし
- **`artifacts/phase-1` 〜 `artifacts/phase-7`**: 変更なし（E2E・Oracle実行後も `git status` に出現せず）
- **共有DSL（`mapperAst.ts` / `validateMapper.ts` / `terminalAst.ts` / `gatherAst.ts` /
  `validateTerminal.ts` / `validateGather.ts`）**: `git diff --stat` に出現せず = 無変更
- **`ClassifierDsl` の定義**: `collectorAst.ts` 内の定義・`CLASSIFIER_*` 定数・
  `COMPARABLE_CLASSIFIER_KINDS` に差分なし（`git diff` で確認）
- **`eval` / `new Function` / 動的コード生成**: 追加コード・Javaコードとも0件（grep確認）
- **`collectorVariants` へのtoMap variant**: 追加していない（grep確認。`importContract.ts` の
  `toMap` 出現は取込対象外化の実装とコメントのみ）

### commit / push / PR / merge

**行っていない。** 本Phaseでは `git switch` / `git status` / `git diff` / `git worktree add` /
`git worktree remove`（一時worktreeの作成と削除）のみを実行した。
`git add` / `git commit` / `git push` / `gh pr create` / `git merge` はいずれも未実行である。
ブランチは `phase-8` のまま、HEADは作業開始時と同じ `251fa03` である。

> **その後の扱い**: 本報告の作成後、**ユーザーの明示指示（2026-08-13）を受けて**
> commit・push・PR作成を実施し、**PR #10 は同日 `main` へmergeされた**
> （merge commit `a887203`）。詳細は **§20**。
> 上記の `git diff --stat` / `git status --short` は **commit直前**の実測記録であり、
> そのまま残している。

## 19. v0.11 §10 の判断事項8件それぞれの結論

| # | v0.11 §10の判断事項 | 結論 | 実装との差異 |
|---|---|---|---|
| 1 | SnapshotKind候補名の最終確定と既存全kindとの衝突再確認 | 候補5種をそのまま確定: `TO_MAP_KEY_EVALUATED` / `TO_MAP_VALUE_EVALUATED` / `DUPLICATE_KEY_DETECTED` / `MERGE_FUNCTION_APPLIED` / `COLLECT_FAILED`。既存48値 → **53値**。衝突なし | なし（指示§7.1の確定値どおり） |
| 2 | `completion` 新値・再生状態新値の最終名と ERROR区分と混同しないUI表示 | `completion: 'EXECUTION_FAILED'` / `PlaybackState: 'FAILED'`（7値目）。UIは `data-state="FAILED"` / ラベル「実行失敗（想定内）」/ 失敗パネル冒頭に「エンジンの内部エラーではありません」を明示 | なし。ただし `stopReason` は**設定しない**判断を追加（decisions §10。指示§7.2の「ERROR用stopReasonを流用しない」を最も明確に満たす形） |
| 3 | `ExecutionFailureView` の値参照の具体型と `result` null許容化の影響範囲 | 値参照は**「表示ラベル + 安定キー文字列」のペア**（SimValueを直接保持しない）。null許容化の影響はUI 1か所のnull分岐のみで、P8-D16が全template走査で非波及を機械検証 | なし（指示§7.5-1・§7.5-2の確定値どおり）。棚卸し結果は本報告§4 |
| 4 | 重複キー・3件以上衝突を含むfixture（基準4件で足りるか） | **補助データセット `employeesMergeDemo`（5件・関東3件）を追加**。基準4件では最大2件衝突のため3件以上の衝突を実演できない。snapshot予算は最大32件（上限500）で余裕あり | なし（指示§7.6の確定値どおり） |
| 5 | Map entry view・merge結果値IDの具体型（既存 `CollectorMapEntryView` の流用可否） | 蓄積viewは**新設 `TO_MAP` variant**（`ToMapEntryView`。既存 `MAP` variantはgroupingBy / partitioningBy専用のまま不変）。終端結果viewは既存 `MAP` + `SCALAR` の組合せを再利用。**merge結果値へ独立IDは付与しない** | なし（指示§7.5-3・§7.5-6の確定値どおり）。結果viewでの `SCALAR` 再利用は実装判断として decisions §16 へ記録 |
| 6 | 手動連携取込候補へのtoMap開放可否 | **開放しない**（ユーザー決定2026-08-13）。`importContract.ts` の1点のみで `importable: false` 化し、`collectorVariants` へvariantを追加しない二重防御とした | なし（指示§7.7の確定値どおり） |
| 7 | 視覚回帰基準画像・共通UI・Oracle suite構成の意図的更新の範囲 | 視覚回帰: 既存35枚**据え置き**・新規8枚。共通UI: 操作一覧不変（新operationIdなし）、`StickyPlaybackBar` へFAILEDラベルと無効化条件を加算。Oracle: P8-O01追加・P7-O01の書込み停止・`PAST_ARTIFACT_DIRS` へphase-7追加・P7-O02のfixture固定化 | なし。すべて本報告§10・§13に理由つきで記録 |
| 8 | §6.2の8（表示順の教材規約）の表示文言 | 確定文言:「この表示順（キー評価 → 値評価 → 重複検出）は教材上の規約であり、JDK内部でのkeyMapper / valueMapper評価と例外送出の実際の順序を示すものではありません。」を `TO_MAP_KEY_EVALUATED` のjdkNoteとtemplate jdkNoteの双方へ配置。あわせて encounter order は Javadoc Implementation Note 区分として扱い、first / last の「先 / 後」は現在の決定的な逐次実行における入力順であることを明示 | なし（指示§7.8の確定値どおり）。P8-R04が画面表示を機械検証 |

## 20. commit / push / PRの実施内容

Phase 8実装中は commit / push / PR / merge を行わなかった（§18）。
本報告の作成後、**ユーザーの明示指示（2026-08-13）を受けて** commit・push・PR作成を実施し、
**PR #10 は同日 `main` へmergeされた**（merge commit `a887203`）。

### commit列

| commit | 内容 |
|---|---|
| `c5dbad2` / `d9e04b4` / `e1ea25a` | （Phase 8着手前）統合版docx v0.11の生成と、ビルド・検証ツールの `--v11` 対応 |
| `251fa03` | （Phase 8着手前）codexレビュー結果ファイルの `.gitignore` 追加。**作業開始時のHEAD** |
| `7b185de` | Phase 8本体（**71ファイル**）。`src` / `tests` / `e2e`（specとP8基準画像8枚）/ `oracle` / `artifacts/phase-8`（17件）/ `README.md` |
| `33b5b72` | Phase 8完了報告と判断記録（`docs/phase-8-completion-report.md` / `docs/phase-8-decisions.md`。判断記録 §9.1 を含む） |
| `e492169` | 本節の新設と、§18を実施済みへ更新 |
| `a887203` | PR #10 のmerge commit（`main`） |
| （本commit） | 本節へmerge commitを確定記載（別ブランチ `chore/phase-8-merge-record` 経由） |

Pull Request: **#10** https://github.com/toru3001y/Java-StreamAPI-Simulator/pull/10
（base `main` / head `phase-8`。merge commit `a887203`）

push先: `origin/phase-8`（新規ブランチ。`251fa03..e492169`）

`phase-8` ブランチはmerge後も削除していない（工程別ブランチを残す既存運用に従う。
`phase-1`〜`phase-7` も同様に残置されている）。

### 完了判定への影響

commit / push / PR の実施は **Phase 8の完了判定を変更しない**。§1の判定は
**未完了**（P8-D15 部分実装 / P8-D18 未実装、完全成功37 ID）のままである。
teeing branchへのtoMap配置は `docs/phase-8-decisions.md` §9.1 の決定
（2026-08-13）に従い、残作業(1)〜(3)とあわせて独立Phaseで扱う。
