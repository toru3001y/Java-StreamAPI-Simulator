# Phase 7 完了報告（Gatherers）

## 1. 判定

**Phase 7 完了**。

`docs/Claude_Code_Phase7_Implementation_Instructions.md` §15の完了条件をすべて満たした。

| 完了条件（§15） | 結果 |
|---|---|
| v0.9 §9の完了条件（Gatherer構造表示・状態遷移・§6.2のsnapshot列・§6.3のID契約・§7の空入力・型遷移がJDK 25実測との回帰照合を含めて成立し、既存P1〜P6テストが全件成功） | 満たす |
| v0.9 §2.1の5メソッドの縦断実装（OperationCatalog→DSL→instantiate→Step Engine→template / fixture→UI→テスト→Oracle） | 満たす |
| §7の確定値（SnapshotKind 6値・SimValue `list`・ID規則・DSL契約・`GATHER_SIZE_LIMIT`・template 7形 / fixture 11件・GatherContextView・取込対象外2点） | すべて実装 |
| §8.2の11ケースの実測snapshot列が確定列と一致 | 11/11一致（§5） |
| P7必須39 IDの実装・成功、既存P1〜P6 IDが許可範囲を除き変更なく成功 | 満たす（§9・§10） |
| lint、型検査、production build成功 | 満たす |
| Playwright E2E、視覚回帰、PC / 狭幅確認、§10の総点検完了 | 満たす（§12・§13・§14） |
| P7-O01・P7-O02がJDK 25で成功（OBSERVATION 12行含む）、`artifacts/phase-1`〜`phase-6`不変 | 満たす（§11） |
| Terminal DSL・Collector DSL・Import Contract仕様（§7.8の2点を除く）・fixture経路が不変 | 満たす（§10・§17） |
| mapConcurrent実行・カスタムGatherer・gather取込開放を実装していない | 満たす（§16） |
| ユーザーの既存変更を破棄していない | 満たす（§17） |

## 2. 基準コミットと作業ブランチ

- 基準コミット（§3.1）: `7664dad00a55095f018bf1f1abd79faa958bde72`（PR #7 merge commit）
- 作業ブランチ: `phase-7`（作業開始時HEAD `5c4d41f`。基準コミットの子孫であることを `git merge-base --is-ancestor` で確認）
- 変更前基準の取得: 基準コミットの一時git worktreeをプロジェクト外
  （`C:/Users/toru3/.claude/jobs/05e23dc5/tmp/p7-baseline`）へ作成し、
  そこで `npm run test:e2e` / `npm run test:oracle` を実行して取得後、`git worktree remove --force` で撤去した。
  作業worktreeの `artifacts/phase-1`〜`phase-6` へは一切書き込んでいない。

**変更前基準（実測）**: lint 0 / typecheck 0 / Vitest 515件（52ファイル）全成功 / build成功 /
Playwright 72件全成功 / Oracle 6 suite（P1-O01〜P6-O01 + P4-O02 / P6-O02）全PASS。
変更前からの失敗は0件。

## 3. 実装したGatherer縦断構成の設計概要

```text
FixtureScenarioProvider（fixture 11件）
  → PipelineTemplate（templatesP7.ts。gatherer slot・node-gather）
  → 検証済みGatherer DSL（gatherAst / validateGather）・TypeRef（fromGatherer）
  → PipelineDefinition（PipelineNodeDef.gatherer）
  → Step Engine（GatherRuntime・GATHER_INITIALIZED・processThroughChainのgather分岐・finish cascade）
  → Snapshot（SnapshotKind 6値・OperationContextView kind:'gather'）
  → React UI（GathererStructurePanel）
```

### 3.1 DSL層

- `src/domain/dsl/gatherAst.ts`: `GathererDsl` union 4 kind（windowFixed / windowSliding / scan / fold）、
  Gatherer専用 `GatherAccumulationRule` union 3 kind、
  `GATHER_FIELD_WHITELIST = ['age','salary','evaluation']`、windowSize境界（1〜16）。
  `ReductionIdentity` は**type-only import**で再利用し、`terminalAst.ts` は無変更。
- `src/domain/dsl/validateGather.ts`: closed schema検証（kind → 許可キー集合 → ホワイトリスト → 型・値域）。
  identityの値検証は既存 `validateReductionIdentity` へ委譲（受理範囲が同一であることをP7-D04が検証）。
  `resolveGathererOutputElementType` がv0.9 §8.3の型適合表を実装し、
  window系→`List<T>`、scan / fold→boxed型を返す。primitive Stream直結は `TYPE_MISMATCH` + boxed()誘導。
- `src/domain/dsl/evaluateGather.ts`: boxed変換契約（`int→boxedInt` / `long→boxedLong` /
  `double→boxedDouble` / `string→string`）と累積評価。**`evaluateReduction.ts` は呼ばない**
  （判断は `docs/phase-7-decisions.md` §1）。

### 3.2 runtime層

- `GatherRuntime`（`stepEngine.ts`）: バッファ / evict要素 / 窓連番 / 累積値 / 累積履歴 /
  integrator呼出し回数 / 放出済み / finisher確定内容 / 通過済みメンバー集合。
- `GATHER_INITIALIZED` は実行開始ブロック（source送出前）で各gatherノードにつき正確に1件、空ソースでも無条件発行。
- `processThroughChain` のgather分岐: windowFixed（追加→窓成立時に放出→下流再帰→バッファ初期化）、
  windowSliding（evict+appendを1回の状態更新→窓成立ごと放出→バッファ保持）、
  scan（累積→同一elementId継承で放出→`continue`）、fold（累積のみ→`return false`）。
- finish cascade: sorted専用だったcascadeをgatherへ一般化。合成要素は
  `registerElement` → 要素状態設定 → `GATHER_EMITTED` → 下流再帰 → `confirmPendingShortCircuits()` の順。

### 3.3 context層

`OperationContextView` へ `kind: 'gather'` を追加。§7.7の契約項目をすべて保持する:
`nodeId` / `gathererKind` / `gathererLabel`（Javaコード式）/ 入出力型ラベル / `typeTransitionLabel` /
**4構成要素の常設4行**（`elements`）/ `windowSize` / `buffer` / `evictedLast` / `unmodifiableNote` /
`initialLabel` / `accumulatorLabel` / `history` / `emitted`（`memberIds` 含む）/ `emittedCount` / `finishedNote`。
すべてプレーンデータで `structuredClone` / `deepFreeze` 可能。

### 3.4 UIパネル

`src/ui/components/GathererStructurePanel.tsx`（新設）。Phase 5のCollector構造ツリーの
**CSS・描画パターンのみ流用**し、型契約は独立。4構成要素の常設4行（`<table>` の rowheader）、
window系のバッファ / evict / メンバー / unmodifiable注記、scan / foldの初期値 / 累積履歴 / 放出方針、
型遷移（window系はListになることを強調）、`<details>` 内の補助説明（integrator false短絡と
limit / takeWhileの対比、mapConcurrent対象外理由、fold↔reduce・scan↔reduce対比、
教材モデル注記、Oracle観測注記）。

## 4. SimValue `list` variant追加に伴う網羅switch棚卸し一覧

14箇所を棚卸しした。詳細と各箇所の処理は `docs/phase-7-decisions.md` §3の表に記載。要約:

| 扱い | 箇所数 | 内訳 |
|---|---|---|
| `list` を**実装**した | 2 | `value.ts` の `formatSimValue`（再帰整形）・`typeOfSimValue`（自己保持elementType） |
| **`EngineInvariantError`** で塞いだ | 9 | `distinctKey.ts`（`case 'list'`）、`evaluate.ts`（3関数）、`evaluateMapper.ts`（2関数）、`evaluateComparator.ts`（3関数）、`evaluateConsumer.ts`（1関数）、`evaluateReduction.ts`（2関数）、`evaluateGather.ts`（2関数・3経路）、`collectorRuntime.ts`（4関数）に `assertNotCompositeList` を追加。`stepEngine.ts` `boxValue` は既存の `default` が既に `EngineInvariantError` を送出（変更なし） |
| 該当なし（生成側のみ / SimValueを受け取らない） | 3 | `materializeSource.ts`、`javaCode.ts`、UIの `formatSimValue` 呼出し |

**例外型を揃える理由**: `SimulationSession.step`（`src/application/session.ts`）は
`EngineInvariantError` **だけ**を捕捉してタイマーを解除し、最後の確定snapshotとhistoryを保持したまま
`ERROR` へ遷移する（J-3のフェイルセーフ）。plain `Error` は再送出されるため、同じ内部不整合でも
復帰可能性が変わる。したがって棚卸し箇所は例外型まで統一する必要がある。

**既存挙動の保存**: 共有ガード `assertNotCompositeList(value, where)` を各関数の**先頭**で呼び、
`list` だけを判定する。それ以外のkindは従来どおりの検証・例外へ進むため、**既存kindの例外型・
メッセージ・挙動は一切変わらない**（P7-D07が回帰検証）。

**検証**: P7-D07が、公開関数から直接叩ける**17経路すべて**について `EngineInvariantError` の送出を
個別に検証し、あわせて既存kindの例外型が変わっていないことを検証する。
残る `boxValue`（private関数）はPipeline構造検証、`collectorRuntime.ts` の内側3関数は
入口 `collectorAccumulate` を4種別で叩く多層防御の検証に分けている（判断記録§3.3）。

> `evaluateGather.ts` の3経路は、codexレビュー第2回の指摘（棚卸し漏れ）を受けて追加した。
> Gatherer DSLの累積をTerminal DSLと共通化せず独立実装とした判断（判断記録§1）の裏返しで、
> 「`evaluateReduction.ts` を塞げば累積経路は塞がる」という前提が成り立っていなかった。

付随変更として `EngineInvariantError` の実体を `src/domain/types/invariantError.ts`（依存を持たない
中立モジュール）へ抽出し、`assertNotCompositeList(value, where)` 共有ガードを併設した。
`src/domain/dsl` と `src/domain/engine` の双方から参照するためであり、`distinctKey.ts` →
`stepEngine.ts` の循環importも避けられる。`stepEngine.ts` からの再エクスポートにより
`session.ts` / `stepEngine.test.ts` の既存import経路は無変更。

## 5. §8.2の11ケースの実測snapshot列と確定列の一致確認結果

**11ケースすべてで、kind列・件数・期待結果値が指示書§8.2の確定列と完全一致**した
（`tests/domain/p7-engine.test.ts` が確定列を定数として保持し `toEqual` で比較。実装に合わせた列の書き換えは行っていない）。

| # | template × mode | 確定件数 | 実測件数 | kind列 | 結果値 |
|---|---|---|---|---|---|
| 1 | window-fixed × standard | 21 | **21** | 一致 | `[[佐藤（age=35）, 鈴木（age=27）, 高橋（age=42）], [田中（age=29）]]` |
| 2 | window-fixed-exact × standard | 21 | **21** | 一致（`GATHER_FINISHED` 後に `GATHER_EMITTED` なし） | `[[佐藤, 鈴木], [高橋, 田中]]` |
| 3 | window-fixed × emptySource | 5 | **5** | 一致 | `[]`（放出0件をcontext明示） |
| 4 | window-sliding × standard | 23 | **23** | 一致（evict+appendが1回の `WINDOW_BUFFER_UPDATED`） | `[["Java", "SQL"], ["SQL", "Git"], ["Git", "AWS"]]` |
| 5 | window-sliding-short × standard | 13 | **13** | 一致 | `[["Java", "SQL"]]`（全要素の1窓） |
| 6 | window-sliding × emptySource | 5 | **5** | 一致（#3と同列） | `[]` |
| 7 | scan × standard | 28 | **28** | 一致（`GATHER_FINISHED` 不発行） | `List<Integer> [3, 4, 8]` |
| 8 | scan × emptySource | 4 | **4** | 一致 | `[]`（初期値生成のみ実演） |
| 9 | scan-concat × standard | 19 | **19** | 一致 | `["Java", "JavaSQL", "JavaSQLGit"]` |
| 10 | fold × standard | 20 | **20** | 一致（`FIND_SELECTED` → `SHORT_CIRCUIT_CONFIRMED`） | `Optional[21_700_000L]` |
| 11 | fold × emptySource | 8 | **8** | 一致 | `Optional[0L]`（identity放出） |

§8.2注記のとおり、表の期待結果は意味上の省略表記であり、
テストの厳密なassertionは `formatSimValue` の再帰整形出力（Employee要素は `佐藤（age=35）`、
String要素は `"Java"`）を正としている。

**§8.2 #10 / #11の `SHORT_CIRCUIT_CONFIRMED` について**: 既存findFirstの発行規則
（`FIND_SELECTED` 後のpendingShortCircuitを `confirmPendingShortCircuits` が確定する）が
確定列と両立することを実装前に確認済みで、列の変更は不要だった（§17の停止条件に該当せず）。

## 6. 主な変更ファイルとアーキテクチャ上の役割

### 6.1 新設（21ファイル。`docs/phase-7-*.md` 2件を除く）

| ファイル | 役割 |
|---|---|
| `src/domain/dsl/gatherAst.ts` | Gatherer DSL型・専用ホワイトリスト・windowSize境界定数 |
| `src/domain/dsl/validateGather.ts` | closed schema構造検証・ホワイトリスト検証・出力型解決 |
| `src/domain/dsl/evaluateGather.ts` | boxed変換契約と累積評価（Gatherer専用の独立実装） |
| `src/domain/types/invariantError.ts` | `EngineInvariantError` の実体と `assertNotCompositeList` 共有ガード（dsl / engine双方から参照する中立モジュール） |
| `src/domain/template/templatesP7.ts` | Phase 7 template 7件（`ALL_TEMPLATES` へ集約） |
| `src/ui/components/GathererStructurePanel.tsx` | Gatherer構造パネル（4構成要素常設4行） |
| `oracle/OracleP7.java` | P7-O01の固定Java 25コード（11ケース + OBSERVATION 13行） |
| `oracle/expected-p7-from-core.json` | Simulation Core由来の期待値 |
| `tests/p7-helpers.ts` / `tests/p7-oracle-expected.ts` | Phase 7テスト共通helper・期待値導出 |
| `tests/domain/p7-dsl.test.ts` | P7-D01〜D07 |
| `tests/domain/p7-engine.test.ts` | P7-D08〜D18・D22 |
| `tests/domain/p7-catalog.test.ts` | P7-D19〜D21 |
| `tests/application/p7-session.test.ts` | P7-A01〜A04 |
| `tests/react/p7-app.test.tsx` | P7-R01〜R06 |
| `tests/domain/p7-oracleSync.test.ts` / `tests/domain/p7-review.test.ts` | P7-O01(sync) / P7-O02 |
| `e2e/phase7.spec.ts` / `e2e/p7-capture.spec.ts` / `e2e/p7-narrow.spec.ts` / `e2e/p7-utils.ts` | P7-E01〜E05と証跡キャプチャ |

### 6.2 変更（31ファイル・1371追加 / 130削除。`README.md` を含む）

| ファイル | 変更点 |
|---|---|
| `src/domain/engine/snapshot.ts` | `SnapshotKind` 6値追加（42→48）、`OperationContextView` へ `kind:'gather'` variant、`GathererElementView` / `GathererItemView` / `GathererHistoryEntry` |
| `src/domain/engine/stepEngine.ts` | `GatherRuntime`・`createRuntime`・`gatherContextView`・`GATHER_INITIALIZED` 発行・`processThroughChain` のgather分岐・finish cascade一般化・合成ID・要素状態遷移 |
| `src/domain/catalog/operationCatalog.ts` | `TypeRule` へ `{ kind: 'fromGatherer' }` |
| `src/domain/catalog/operations.ts` | `gather` 登録（46操作目。intermediate / INTERMEDIATE+STATEFUL） |
| `src/domain/template/pipelineTemplate.ts` | `ParameterSlot` へ `gatherer` variant（12種目） |
| `src/domain/pipeline/pipelineDefinition.ts` | `PipelineNodeDef.gatherer` |
| `src/domain/template/instantiate.ts` | 手順1（構造検証）・手順3（ホワイトリスト）・手順4（`fromGatherer` 型解決）・nodeDef組立・legend絞り込み。**7手順の枠組み・順序は不変** |
| `src/domain/model/value.ts` | `SimValue` へ `list` variant、`formatSimValue` / `typeOfSimValue` 対応 |
| `src/domain/types/result.ts` | `GATHER_SIZE_LIMIT` 追加（22個目） |
| `src/domain/engine/distinctKey.ts` | `list` を `EngineInvariantError` で塞ぐ |
| `src/domain/dsl/javaCode.ts` | `gathererToJavaExpr` / `gatherAccumulationToJavaExpr`、`nodeLineText` の `case 'gather'` |
| `src/providers/fixtureScenarioProvider.ts` | Phase 7 fixture 11件 |
| `src/application/importContract.ts` | **§7.8の2点のみ**（importable導出・`slotSpecOf` の全拒否spec） |
| `src/ui/components/OperationStatePanel.tsx` | `case 'gather'` 追加（17種目） |
| `src/ui/styles.css` | gatherパネル用CSS（狭幅の縦積み・横スクロールコンテナ） |
| `src/domain/template/templates.ts` | `ALL_TEMPLATES` へ `...P7_TEMPLATES` |
| `oracle/oracle-lib.mjs` / `oracle/run-oracle.mjs` | P7-O01 suite追加・P6-O01のnull化・現行Phase切替・`P7_MATCH_NOTES` |
| `e2e/capture-helper.ts` | `CAPTURE_TARGET_PHASE` を `6`→`7`（この1か所のみ） |
| `README.md` | Phase 7完了時の更新（§14の全項目。実装済み操作へgather / Gatherers 4種、テスト結果表、必須ID実績、`test:oracle` 説明、総点検件数、ドキュメント一覧、`artifacts/phase-7/`、ブランチ構成、アーキテクチャ節へGatherRuntime / cascade一般化） |
| `src/domain/dsl/evaluate.ts` / `evaluateComparator.ts` / `evaluateConsumer.ts` / `evaluateMapper.ts` / `evaluateReduction.ts` / `src/domain/engine/collectorRuntime.ts` | SimValue棚卸し（§5.2）の`list`専用ガード追加。既存kindの検証・例外は不変 |
| 既存テスト5ファイル | §12冒頭の許可範囲のみ（§10に列挙） |

## 7. 実行した全コマンドと終了結果

| コマンド | 実行時点 | 結果 |
|---|---|---|
| `npm ci` | 変更前 / 一時worktree | 成功 |
| `npm run lint`（oxlint） | 変更前 / 最終 | **成功（警告0件）** |
| `npm run typecheck`（tsc -b） | 変更前 / 各Stage / 最終 | **成功（エラー0件）** |
| `npm run test:unit`（vitest run） | 変更前 / 各Stage / 最終 | **成功** |
| `npm run build`（tsc -b && vite build） | 変更前 / 最終 | **成功**（各chunk 500 kB未満） |
| `npm run test:e2e`（playwright test） | 変更前（一時worktree）/ 最終 | **成功**（下記の実測環境に注記あり） |
| `npm run test:oracle`（Docker + gradle:9.6.1-jdk25） | 変更前（一時worktree）/ 最終 | **成功** |
| `git worktree add / remove --force` | Stage 0 | 成功（プロジェクト外パス） |
| `git diff --check` / `git diff --stat` / `git status --short` | 最終 | 確認済み（§17） |

## 8. テスト種別ごとの総数・成功・失敗・skip・未実行

| 種別 | 変更前 | 最終 | 成功 | 失敗 | skip | 未実行 |
|---|---|---|---|---|---|---|
| Vitest（Domain / Application / React） | 515件（52ファイル） | **651件（59ファイル）** | 651 | 0 | 0 | 0 |
| Playwright E2E・視覚回帰 | 72件 | **81件** | 81 | 0 | 0 | 0 |
| JDK 25 Oracle | 6 suite | **7 suite**（P1-O01〜P7-O01） | 7 | 0 | 0 | 0 |

- Vitestの増分136件はすべてPhase 7新規（P7-D 22 ID / P7-A 4 ID / P7-R 6 ID を含む7ファイル）。
- Playwrightの増分9件はPhase 7新規（`phase7.spec.ts` 4件 + `p7-capture.spec.ts` 2件 + `p7-narrow.spec.ts` 3件）。
- **skip・未実行は0件**。環境制約による未実行はない（Docker + `gradle:9.6.1-jdk25` イメージ、
  Playwright chromiumともに利用可能な環境で全件実行した）。

> **E2Eの「成功」の実測範囲と、レビュー中に判明した実行環境の制約**
>
> 上記の「成功」は、**Windows 11 ネイティブ環境での実測**である。4173未使用の状態から、
> 作業ツリーで4回・作業ツリー外の一時コピー（`node_modules`込み・cold build）で1回、
> 計6回すべて `exit 0`（81 passed / 約53〜56秒）、実行後のポート・プロセス残留なしを確認した。
> teardownは `Terminating the WebServer` → `Terminated the WebServer` が83msで完了している。
>
> codexレビュー第2回・第3回で「81件成功後にコマンドが終了しない」と報告されたが、
> **第4回で原因が特定された。codexの管理サンドボックスがWindowsの `taskkill` を
> `Access denied` で拒否する**ため、Playwrightのteardownがプロセスツリーを停止できず、
> 子プロセスの `close` イベント待ちで無限待ちになっていた。
> **サンドボックス外で同じ設定・同じ一時コピーを実行すると 81 passed / exit 0**
> （teardown 84ms、実行後の4173 LISTENなし）であることをcodex側が実測し、
> 「通常のWindows実行を対象とする限りリポジトリ側の修正は不要」と判定された。
>
> したがって `playwright.config.ts` は変更していない。判断の詳細と没にした対案は
> 判断記録 §12.6、経緯は `docs/codex_review_request_P7_Implementation.md` に記載。

## 9. P7必須39 IDの対応表

### 9.1 DSL・engine契約テスト（P7-D、22 ID）

| ID | 実装ファイル | 検証内容 | v0.9 §9・§10の観点 | 結果 |
|---|---|---|---|---|
| P7-D01 | `p7-dsl.test.ts` | 4 kindのclosed schema受理、未知kind / 許可外キー / 必須キー欠落 / 非objectの拒否 | §8.1（DSL構造） | PASS |
| P7-D02 | `p7-dsl.test.ts` | 1 / 16受理、0以下 `STRUCTURE_INVALID`、17以上 `GATHER_SIZE_LIMIT`、非整数・非有限値拒否 | §8.2（windowSize上限） | PASS |
| P7-D03 | `p7-dsl.test.ts` | 3 kind受理、未知kind / 未知field拒否、**`REDUCTION_FIELD_WHITELIST` が `['salary','age']` のまま不変** | §8.2（Terminal DSL不変） | PASS |
| P7-D04 | `p7-dsl.test.ts` | 4 type受理・null拒否・int32 / safe integer範囲、既存 `validateReductionIdentity` と同一受理範囲 | §8.2（identity） | PASS |
| P7-D05 | `p7-dsl.test.ts` | 型適合表全行、不適合の `TYPE_MISMATCH`、primitive Stream直結拒否（boxed誘導） | §8.3（型適合表） | PASS |
| P7-D06 | `p7-dsl.test.ts` | window系 `Stream<T> → Stream<List<T>>`、scan / fold `Stream<boxed R>`、resultType導出 | §5（型遷移） | PASS |
| P7-D07 | `p7-dsl.test.ts` | `list` の整形 / 型解決、既存 `stringList` 不変、deepFreeze / structuredClone、**棚卸し17経路すべての `EngineInvariantError` 送出**（`evaluateGather.ts` の3経路を含む）、既存kindの例外型不変、boxed変換契約 | §6.3-1（合成値モデル）・§10-5 | PASS |
| P7-D08 | `p7-engine.test.ts` | 全template×全modeで正確に1件、`INITIAL` 直後・source送出前 | §6.1（GATHER_INITIALIZED） | PASS |
| P7-D09 | `p7-engine.test.ts` | §8.2 #1完全一致、`GATHER_EMITTED`→`SINK_APPENDED` 順序、残余flush | §6.2（windowFixed標準） | PASS |
| P7-D10 | `p7-engine.test.ts` | §8.2 #2完全一致、`GATHER_FINISHED` 後に `GATHER_EMITTED` なし、「残余なし」明示 | §6.2（倍数ケース） | PASS |
| P7-D11 | `p7-engine.test.ts` | §8.2 #3完全一致、放出0件のcontext明示 | §6.2・§7（空入力） | PASS |
| P7-D12 | `p7-engine.test.ts` | §8.2 #4完全一致、evict+appendが1回でevict要素がcontextに載る | §6.1（WINDOW_BUFFER_UPDATED） | PASS |
| P7-D13 | `p7-engine.test.ts` | §8.2 #5 / #6完全一致、全要素1窓のメンバー構成 | §6.2（sliding境界） | PASS |
| P7-D14 | `p7-engine.test.ts` | §8.2 #7 / #8完全一致、`SCAN_ACCUMULATED` と `GATHER_EMITTED` の分離、出力IDの継承、`GATHER_FINISHED` 不発行 | §6.1・§6.3-3 | PASS |
| P7-D15 | `p7-engine.test.ts` | §8.2 #10 / #11完全一致、`FOLD_ACCUMULATED` が放出を伴わない、空ソースの `Optional[identity]` | §6.2・§7（fold空） | PASS |
| P7-D16 | `p7-engine.test.ts` | `node-gather-win-N` の生成順採番・`node-gather-result`、`memberIds` 一致、ID一意性、決定性 | §6.3-2・§6.3-4・§6.3-6 | PASS |
| P7-D17 | `p7-engine.test.ts` | BUFFERED→最初の窓放出でPASSED、sliding放出後のlatest維持、scan=map系、fold=reduce系、REJECTED不発生 | §6.3-5 | PASS |
| P7-D18 | `p7-engine.test.ts` | 任意cursorからgather contextの全フィールド復元、戻る→進むで一致 | §6.3-6（復元契約） | PASS |
| P7-D19 | `p7-catalog.test.ts` | 7 templateの `.gather(Gatherers.…)` 式が構文的に正当で実データ・評価結果と一致、既存fixtureのJavaコード不変 | §5（Javaコード表示） | PASS |
| P7-D20 | `p7-catalog.test.ts` | `gather` 登録（46操作目）、既存45操作不変、template 118 / 実行可能116、全template×modeのfixture存在、snapshotCount実測が§8.2の計と一致 | §9（OperationCatalog） | PASS |
| P7-D21 | `p7-catalog.test.ts` | gather 7 templateの `importable: false` ＋理由、全拒否specが正規4 kindを含む任意値をすべて拒否、非gather templateの不変、`buildScenario` へ到達しない | §10-6（取込開放の可否） | PASS |
| P7-D22 | `p7-engine.test.ts` | §8.2 #9完全一致、string累積のboxed変換契約、空文字initialの表示、出力IDの継承 | §8.2・§8.3 | PASS |

### 9.2 Applicationテスト（P7-A、4 ID）

| ID | 実装ファイル | 検証内容 | 結果 |
|---|---|---|---|
| P7-A01 | `p7-session.test.ts` | シナリオ切替意味論（タイマー停止・新revision `${templateId}:${mode}:r${counter}`・history初期化・READY） | PASS |
| P7-A02 | `p7-session.test.ts` | 全7 template×全mode（11組合せ）で初期snapshotから終端到達、cursor移動の完全復元、snapshotCount一致 | PASS |
| P7-A03 | `p7-session.test.ts` | 操作一覧へ `gather` が中間categoryで追加、既存操作・既存templateのfixture経路が不変 | PASS |
| P7-A04 | `p7-session.test.ts` | gather template選択中の取込系操作がthrowせず失敗理由を返し、シナリオ・履歴・再生状態が不変 | PASS |

### 9.3 React統合テスト（P7-R、6 ID）

| ID | 実装ファイル | 検証内容 | 結果 |
|---|---|---|---|
| P7-R01 | `p7-app.test.tsx` | 4行常設、combiner「呼出し0回」意味論、scanのfinisher「終端での追加産出なし」意味論、JDK実装同一性を断定しない文言、Oracle観測の観測環境つき反映 | PASS |
| P7-R02 | `p7-app.test.tsx` | バッファ内容・evict要素・窓メンバー・unmodifiable注記・型遷移表示 | PASS |
| P7-R03 | `p7-app.test.tsx` | 初期値・累積履歴・foldの放出なし累積とscanの逐次放出の区別、reduceとの対比 | PASS |
| P7-R04 | `p7-app.test.tsx` | 「中間」optgroupへの `gather` 追加、既存optgroup構成不変、mapConcurrent対象外の補助説明、integrator false短絡とlimit / takeWhileの対比 | PASS |
| P7-R05 | `p7-app.test.tsx` | gather template選択中はコピー・貼付の両方が無効化され理由表示（P6-R05様式・記号併記）、非gatherへ戻すと復帰 | PASS |
| P7-R06 | `p7-app.test.tsx` | キーボード操作・focus・テーブルセマンティクス（columnheader 3 / rowheader 4）・横スクロールコンテナ・全template×modeの描画 | PASS |

### 9.4 E2E・視覚テスト（P7-E、5 ID）

| ID | 実装ファイル | 検証内容 | 結果 |
|---|---|---|---|
| P7-E01 | `e2e/phase7.spec.ts` | windowFixed standard実行が `[[佐藤,鈴木,高橋],[田中]]` へ到達、残余flushの表示と履歴復元 | PASS |
| P7-E02 | `e2e/phase7.spec.ts` | scanの逐次出力 `[3, 4, 8]`、foldの `Optional[21_700_000L]`、空ソースの `GATHER_INITIALIZED` 表示 | PASS |
| P7-E03 | `e2e/phase7.spec.ts` | evict表示と、入力<窓サイズの1窓flush | PASS |
| P7-E04 | `e2e/phase7.spec.ts` | 既存E2E全件成功、全gather template×mode（11件）の到達チェックリスト、非gather回帰 | PASS |
| P7-E05 | `e2e/p7-capture.spec.ts` / `e2e/p7-narrow.spec.ts` | PC幅 / 狭幅表示・横スクロール・sticky非遮蔽、P7基準画像8枚新設（既存27枚は据え置き・threshold緩和なし） | PASS |

### 9.5 JDK 25 Oracle Test（P7-O、2 ID）

| ID | 実装 | 検証内容 | 結果 |
|---|---|---|---|
| P7-O01 | `oracle/OracleP7.java` + `tests/domain/p7-oracleSync.test.ts` | §8.2の11ケースをJSON文字列厳密照合、v0.9 §7の空入力表4行を全て含む、OBSERVATION 12行 | PASS |
| P7-O02 | `tests/domain/p7-review.test.ts` + `run-oracle.mjs` | 必須7 suite各1件、書込みが `artifacts/phase-7/oracle-result.md` のみ、`artifacts/phase-1`〜`phase-6` のSHA-256不変 | PASS |

## 10. 既存P1〜P6必須IDの回帰結果と意図的更新の一覧

**回帰結果**: 既存P1〜P6の全テスト（Vitest 515件・Playwright 72件・Oracle 6 suite）が
下表の意図的更新を除き**変更なく全成功**した。既存テストIDの削除・緩和・skipは0件。

**§12冒頭で許可された意図的更新（5件）**:

| # | 対象 | 更新内容 | 理由 |
|---|---|---|---|
| 1 | `tests/domain/p6-contract.test.ts`（P6-D01〜D03） | ローカル `EXECUTABLE_TEMPLATES` の走査対象を「取込対象の実行可能template（＝gatherノードを含まない実行可能template）」へ限定 | gather templateは `importable: false`（§7.8）のため、現行の「全実行可能templateで `importable === true`」（P6-D01）・「全実行可能fixtureのContract受理」（P6-D02）・「全slotにContract specと既存構造validatorがある」（P6-D03）はgather追加後に必ず失敗する。**既存の非gather実行可能template全件**に対する検証意味は保存。gather templateの拒否検証はP7-D21が担う |
| 2 | `tests/application/p6-session.test.ts`（P6-A03） | 「プロンプト出力例の全実行可能template×mode往復」の走査対象を `IMPORTABLE_TEMPLATES` へ限定 | 同上（gather templateは取込対象外のためプロンプト生成へ到達しない）。実行不能template（`tmpl-src-generate` / `tmpl-src-iterate2`）の検証は不変 |
| 3 | `tests/p6-helpers.ts` | `IMPORTABLE_TEMPLATES` / `GATHER_TEMPLATES` ヘルパを追加 | 上記の限定に必要。`EXECUTABLE_TEMPLATES` の意味・値は**変更していない**（P6-D22の実行総点検は従来どおり全116件を通す） |
| 4 | `tests/domain/p6-review.test.ts`（P6-O02） | Phase 6時点のOracle suite構成を**fixtureとして固定**する形へリファクタリング（`P6_SUITES` / `P6_REQUIRED_SUITE_IDS` / `P6_CURRENT_PHASE_*` / `P6_PAST_ARTIFACT_DIRS`） | Phase 7でsuite構成が変わった（7 suite・P7単独書込み・過去artifactsへphase-6追加）ため。P4-O02 / P5-O02の前例に従い、検証意味は変更・緩和していない。ライブ構成の検証は新規 `p7-review.test.ts`（P7-O02）が担う |
| 5 | `e2e/capture-helper.ts` | `CAPTURE_TARGET_PHASE` を `6`→`7`（**この1か所のみ**） | §14の成果物要件。過去Phaseのcapture specは変更していない |

**「件数前提・一覧前提が壊れる既存assertion」の最小更新（1件）**:

| # | 対象 | 更新内容 | 理由 |
|---|---|---|---|
| 6 | `tests/domain/p6-javacode.test.ts`（P6-D18） | golden JSONとのキー集合**完全一致**（`toEqual`）を、「goldenの全キーが現在も存在し値が完全一致」＋「追加キーはgather template×modeのちょうど11件だけ」の2段検証へ変更 | goldenはPhase 6改修前の全fixture Javaコードのスナップショットであり、template 7件の追加でキー集合の完全一致は必ず崩れる。**検証意味（既存fixtureのJavaコード出力が改修前後で不変）はそのまま保存**し、追加キーの内訳を明示検証する形へ強化した。goldenファイル（`tests/fixtures/fixture-javacode-before-p6.json`）自体は**書き換えていない** |

上記6件以外に、既存P1〜P6テストの変更は行っていない。

## 11. P7-O01 / P7-O02の照合結果とOBSERVATION観測

### 11.1 JDKベンダー / バージョン

```text
openjdk version "25.0.3" 2026-04-21 LTS
OpenJDK Runtime Environment Temurin-25.0.3+9 (build 25.0.3+9-LTS)
OpenJDK 64-Bit Server VM Temurin-25.0.3+9 (build 25.0.3+9-LTS, mixed mode, sharing)
```

Dockerイメージ: `gradle:9.6.1-jdk25`。証跡: `artifacts/phase-7/oracle-result.md`。

### 11.2 11ケースの照合結果

**P7-O01: PASS（JSON完全一致）**。Simulation Core由来の期待値
（`oracle/expected-p7-from-core.json`）と固定Java 25コードの実測値が文字列レベルで完全一致した。

| ケース | 実測値 | v0.9 §7 根拠区分 |
|---|---|---|
| windowFixed(3) standard | `["[佐藤（age=35）, 鈴木（age=27）, 高橋（age=42）]","[田中（age=29）]"]` | — |
| windowFixed(2) standard | `["[佐藤（age=35）, 鈴木（age=27）]","[高橋（age=42）, 田中（age=29）]"]` | — |
| windowFixed 空 | `[]` | **公式仕様で確定** |
| windowSliding(2) standard | `["[\"Java\", \"SQL\"]","[\"SQL\", \"Git\"]","[\"Git\", \"AWS\"]"]` | — |
| windowSliding(3) 入力2件 | `["[\"Java\", \"SQL\"]"]` | — |
| windowSliding 空 | `[]` | **公式仕様で確定** |
| scan standard | `["3","4","8"]` | — |
| scan 空 | `[]` | **公式定義から導出** |
| scan-concat standard | `["\"Java\"","\"JavaSQL\"","\"JavaSQLGit\""]` | — |
| fold standard | `present=true, "21_700_000L"` | — |
| fold 空 | `present=true, "0L"` | **公式定義から導出** |

**v0.9 §7の「導出」区分2件（scan空・fold空）は、導出と実測が一致した**
（scan空 → 出力0件 `[]`、fold空 → `Optional[0L]`）。§17の停止条件には該当しない。

加えて出力要素のboxed型（`scanElementClass="Integer"` / `foldElementClass="Long"`）も一致し、
v0.9 §8.3の型適合表が裏付けられた。

### 11.3 OBSERVATION観測結果（12行 + 補足1行）

| Gatherer | `integrator() instanceof Greedy` | `combiner() == defaultCombiner()` | `finisher() == defaultFinisher()` |
|---|---|---|---|
| `windowFixed` | **true** | **true** | **false** |
| `windowSliding` | **true** | **true** | **false** |
| `scan` | **true** | **true** | **true** |
| `fold` | **true** | **true** | **false** |

補足: `windowFixed.windowIsUnmodifiable=true`（v0.9 §3.2「Each window produced is an unmodifiable List」の裏取り）。

**教材モデルとの整合**:

- combinerは4種すべてdefaultと同一 → 「逐次実行のため呼出し0回」表示の裏付け。
- finisherは終端産出のある3種（windowFixed / windowSliding / fold）だけがdefaultと別実装で、
  終端産出のないscanのみdefaultと同一 → v0.9 §6.1の `GATHER_FINISHED` 統一発行規則
  （scanのみ不発行）と教材モデルが一致。
- integratorは4種すべてGreedy → v0.9 §2.2「組み込み4種の実行で短絡は発生しない前提」の裏付け
  （v0.9執筆時点では「API仕様に明示がないため観測項目とする」としていた点が実測で確認できた）。

### 11.4 表示文言への反映内容

`GathererStructurePanel.tsx` の補助説明へ `OBSERVATION_NOTE_BY_KIND` を追加し、
Gatherer kindごとに観測結果を表示する。**JDK内部実装を断定せず**、次を必ず明示している。

- 「**OpenJDK Temurin 25.0.3+9での観測では**」（観測環境の明示）
- 「これは観測結果であり、**JDKの保証ではありません**」（断定回避）

4構成要素の常設4行の文言自体は「教材モデル上の割当て」のままとし、観測結果で置き換えていない
（`gatherer-model-note` に断定回避の注記を常設）。検証はP7-R01。

### 11.5 P7-O02（Oracle運用検証）

**PASS**。

- 必須7 suite（P1-O01 / P2-O01 / P3-O01 / P4-O01 / P5-O01 / P6-O01 / P7-O01）が各1件存在: PASS
- 証跡書込みは現行Phase（P7）のみ、書込み先は `artifacts/phase-7/oracle-result.md` だけ: PASS
  （P6-O01の `writeReportPath` はnull化し、照合は回帰として継続）
- 実行前後で `artifacts/phase-1`〜`phase-6` のSHA-256が不変: PASS
- 過去Phase suiteの回帰: P1-O01〜P6-O01すべてPASS、P4-O02（Long境界値）もPASS

## 12. §10の総点検（116 template × 222組合せ）の結果

**全件成功**。

- `tests/domain/p6-fullcheck.test.ts`（P6-D22）が全実行可能template × `supportedModes` の
  全組合せについて、終端（`STREAM_CONSUMED`）到達・snapshot予算内・Javaコード生成を機械検証。
  **gather templateを除外していない**（importabilityに依存しない実行総点検であり、
  gather 7 template × 11組合せも通過対象）。
- 実測: template総数 **118**（111→+7）、実行可能 **116**（109→+7）、
  実行可能template × supportedModesの組合せ **222**（211→+11）。P7-D20が数値を機械検証。
- E2E側（P7-E04）でも全gather template×mode 11件の画面到達を確認済み。

## 13. 視覚回帰基準画像の新設一覧と既存画像の扱い

**既存27枚は据え置き（更新0枚）**。`npm run test:e2e` 全件実行で既存基準画像との差分は発生せず、
`git diff -- e2e/__screenshots__` が空であることを確認した。threshold緩和は行っていない。

**Phase 7基準画像を8枚新設**:

| ファイル | 内容 |
|---|---|
| `e2e/__screenshots__/p7-capture.spec.ts/p7-e05-window-fixed-emitted.png` | windowFixedの窓成立・放出時（PC幅） |
| `e2e/__screenshots__/p7-capture.spec.ts/p7-e05-window-sliding-evicted.png` | windowSlidingのevict表示（PC幅） |
| `e2e/__screenshots__/p7-capture.spec.ts/p7-e05-scan-completed.png` | scanの累積履歴つき完了状態（PC幅） |
| `e2e/__screenshots__/p7-capture.spec.ts/p7-e05-fold-completed.png` | foldのOptional結果（PC幅） |
| `e2e/__screenshots__/p7-capture.spec.ts/p7-e05-empty-initialized.png` | 空ソースの `GATHER_INITIALIZED` 表示（PC幅） |
| `e2e/__screenshots__/p7-narrow.spec.ts/p7-e05-narrow-window-fixed.png` | 狭幅のGathererパネル縦積み |
| `e2e/__screenshots__/p7-narrow.spec.ts/p7-e05-narrow-scan.png` | 狭幅のscan累積表示 |
| `e2e/__screenshots__/p7-narrow.spec.ts/p7-e05-narrow-import-disabled.png` | 狭幅の取込UI無効化状態 |

## 14. PC幅 / 狭幅キャプチャの保存先

`artifacts/phase-7/`（22枚 + `oracle-result.md`）。

**PC幅（15枚）**: windowFixedの初期化 / 窓放出 / finisher確定 / 完了、windowSlidingのevict / 完了、
入力<窓サイズのflush、scan完了、scan-concat完了、foldの累積中 / 完了、
空ソースの `GATHER_INITIALIZED` / fold identity、**取込UI無効化状態**、非gather回帰。

**狭幅（7枚）**: windowFixedの初期化 / 窓放出、windowSlidingのevict、scan完了、fold完了、
空ソースの `GATHER_INITIALIZED`、取込UI無効化状態。

§14の要件（gather 4種の代表snapshot・空ソースの `GATHER_INITIALIZED` 表示・取込UI無効化状態）を
PC幅・狭幅の両方で満たしている。

## 15. 仕様との差異と実装判断

**仕様（v0.8 / v0.9 / v0.10）との差異は0件**。v0.9と指示書の矛盾も検出されなかった（§17の停止条件に該当なし）。

仕様本文を変更しない範囲の実装判断は `docs/phase-7-decisions.md` に記録した。主な項目:

1. 累積評価を `evaluateReduction.ts` と独立実装した判断（§1）
2. `stringList` / `list` 並存の役割分担（§2）
3. SimValue網羅switch棚卸しと `EngineInvariantError` 化（§3）
4. midEmpty非対応とgather固有教材制約を追加しない判断（§4）
5. `tmpl-gather-scan-concat` 追加の判断（§5）
6. 取込対象外の実装方式（§6）
7. Javaコード表記の細部（§7）
8. legend絞り込み（§8）
9. Oracle照合の表記整合の選定判断（§9）
10. OBSERVATION観測結果と表示文言への反映（§10）
11. 視覚回帰更新の有無と理由（§11）
12. その他の実装判断（§12: `EngineInvariantError` の配置・gatherランタイムの配置・バッファ初期化タイミング・`GATHER_INITIALIZED` の位置・cascade一般化方式・`<details>` 追加・**E2E webServerの停止方式を変更しなかった判断**）

## 16. 既知の問題と持越し事項

**既知の問題**: なし。全テスト・全検証が成功しており、skip・未実行・既知の不具合は0件。

**持越し事項（v0.9 §2.2でPhase 7対象外と定義済み。いずれも未実装であることを確認）**:

| 項目 | 状態 | 備考 |
|---|---|---|
| **gather DSLの手動連携取込への開放** | **持越し**（ユーザー決定） | Phase 7では取込対象外化の2点（importable導出・全拒否spec）のみ実装。gather DSLを受理するContract specは追加していない（P7-D21が検証）。将来拡張時は v0.9 §8.4の限定（1ノード・下流短絡なし・windowSize 1〜16）を候補検証の契約とする |
| `Gatherers.mapConcurrent` の実行 | 対象外 | 存在と対象外理由（並行実行の意味論）を補助説明で表示のみ。操作登録なし |
| カスタムGathererの自由記述・任意コード実行 | 対象外 | `eval` / `new Function` / 動的コード生成は追加コードに存在しない（grep確認済み） |
| short-circuitするGathererの実行 | 対象外 | 説明・jdkNoteのみ。組み込み4種がGreedyであることはOracleで観測済み |
| `Gatherer.andThen` 合成・複数gatherノードの連結・gather下流の短絡合成 | 対象外 | `fold → findFirst` のみ例外として実装。P7-D20が全gather templateで制約充足を検証 |
| `Stream.gather` のprimitive特化Stream版 | JDKに存在しない | primitive Stream直結は `TYPE_MISMATCH` で拒否し `boxed()` 経由を促す（P7-D05） |
| `Collectors.toMap()` | 未実装（Phase 5からの継続） | Draft v0.8 付録A.4の対象外 |

## 17. 最終 `git diff --stat` / `git status --short` とcommit・push・PR未実施の確認

### 17.1 `git diff --stat`（変更ファイル31件・1371追加 / 130削除）

```text
 README.md                                 |  63 +++-
 e2e/capture-helper.ts                     |   4 +-
 oracle/oracle-lib.mjs                     |  76 ++++-
 oracle/run-oracle.mjs                     |  27 +-
 src/application/importContract.ts         |  34 +-
 src/domain/catalog/operationCatalog.ts    |   6 +
 src/domain/catalog/operations.ts          |  39 +++
 src/domain/dsl/javaCode.ts                |  40 +++
 src/domain/engine/distinctKey.ts          |   6 +
 src/domain/engine/snapshot.ts             | 111 ++++++-
 src/domain/engine/stepEngine.ts           | 615 +++++++++++++++++++++++++++++-
 src/domain/model/value.ts                 |  13 +
 src/domain/pipeline/pipelineDefinition.ts |   3 +
 src/domain/template/instantiate.ts        |  92 ++++-
 src/domain/template/pipelineTemplate.ts   |   9 +
 src/domain/template/templates.ts          |   3 +
 src/domain/types/result.ts                |   6 +
 src/providers/fixtureScenarioProvider.ts  | 149 ++++++++
 src/ui/components/OperationStatePanel.tsx |   3 +
 src/ui/styles.css                         |  67 ++++
 tests/application/p6-session.test.ts      |   7 +-
 tests/domain/p6-contract.test.ts          |  13 +-
 tests/domain/p6-javacode.test.ts          |  26 +-
 tests/domain/p6-review.test.ts            | 140 +++++---
 tests/p6-helpers.ts                       |  19 +
 31 files changed, 1371 insertions(+), 130 deletions(-)
```

**`artifacts/phase-1`〜`phase-6`、`docs/phase-1〜6-*.md`、v0.8 / v0.9 / v0.10仕様書、統合docxは
差分0件**（`git diff --stat -- artifacts/phase-1 … artifacts/phase-6` が空であることを確認）。
`e2e/__screenshots__` の既存27枚も差分0件。

`git diff --check` は空行末・空白エラーなし。

### 17.2 `git status --short`（未追跡31件）

```text
?? artifacts/phase-7/                      … Phase 7証跡（キャプチャ22枚 + oracle-result.md）
?? e2e/__screenshots__/p7-capture.spec.ts/ … P7視覚回帰基準画像（PC幅5枚）
?? e2e/__screenshots__/p7-narrow.spec.ts/  … P7視覚回帰基準画像（狭幅3枚）
?? e2e/phase7.spec.ts / p7-capture.spec.ts / p7-narrow.spec.ts / p7-utils.ts
?? oracle/OracleP7.java / oracle/expected-p7-from-core.json
?? src/domain/dsl/gatherAst.ts / validateGather.ts / evaluateGather.ts
?? src/domain/types/invariantError.ts
?? src/domain/template/templatesP7.ts
?? src/ui/components/GathererStructurePanel.tsx
?? tests/p7-helpers.ts / tests/p7-oracle-expected.ts
?? tests/domain/p7-dsl.test.ts / p7-engine.test.ts / p7-catalog.test.ts
?? tests/domain/p7-oracleSync.test.ts / p7-review.test.ts
?? tests/application/p7-session.test.ts / tests/react/p7-app.test.tsx
?? docs/phase-7-completion-report.md / docs/phase-7-decisions.md
?? docs/phase7_start_request.md            … 運用ファイル（作業開始時から存在。コミット対象外）
?? docs/codex_review_request_P7_Implementation_Instructions.md … 同上
?? docs/phase6_start_request.md            … Phase 6運用ファイルの残置分（同上）
?? docs/codex_review_request_P6_Implementation_Instructions.md … 同上
?? docs/codex_review_request_P7_Implementation.md … 運用ファイル（レビュー中に作成。コミット対象外）
```

作業開始時に存在した未追跡4件（Phase 6 / Phase 7の運用ファイル）は、stash・削除・上書きを
一切行わずそのまま保持している。**ユーザーの既存変更は破棄していない。**
`docs/codex_review_request_P7_Implementation.md` はレビュー中に作成した運用ファイルであり、
Phase 1〜6と同じくコミット対象外とする（`codex_review_request_*` / `*_start_request.md` は
いずれのPhaseでも追跡していない）。

### 17.3 commit / push / PR / merge の状況

実装中は **commit、push、Pull Request作成、mainへのmergeを一切行わなかった**（指示§18・§3.2）。
codexレビュー完了（第4回で承認可）後、**ユーザーの明示指示を受けて**commit・push・PR作成を実施した。
`main`へのmergeは実施していない（指示に含まれていないため）。詳細は §19。

なお §17.1・§17.2 の `git diff --stat` / `git status --short` は、**commit直前**の状態である。

## 18. v0.9 §10の判断事項7件それぞれの結論

| # | 判断事項 | 結論 | 指示書での確定 | 実装との差異 |
|---|---|---|---|---|
| 1 | window系templateの窓サイズと基準データ件数 | windowFixed 3 / 2、windowSliding 2 / 3。Employee 4件・String 4件 / 2件・int 3件。snapshot最大28件（予算500以内） | 指示§7.6で確定済み | **差異なし** |
| 2 | Gatherer専用AccumulationRuleの実装上の配置 | `src/domain/dsl/gatherAst.ts` へ新設。累積評価も `evaluateGather.ts` として独立実装し、Terminal DSL・Collector DSLの許可範囲・検証挙動は一切変更しない。identityの**値検証のみ**既存 `validateReductionIdentity` へ委譲（受理範囲が同一であることをP7-D04が検証） | 指示§7.4で委譲範囲を確定 | **差異なし**（判断記録 §1・§13-2） |
| 3 | 組み込み4種の構成要素実装のOracle観測 | 実施。12行を観測（integrator: 4種すべてGreedy / combiner: 4種すべてdefault / finisher: scanのみdefault、他3種は別実装）。`artifacts/phase-7/oracle-result.md` へ保存し、表示文言へ観測環境（OpenJDK Temurin 25.0.3+9）つきで反映 | 指示§12.5でOBSERVATION 12行を要求 | **差異なし**（本報告 §11・判断記録 §10） |
| 4 | SnapshotKind候補名の最終確定と衝突再確認 | v0.9 §6.1の候補名6種をそのまま確定。Phase 6完了時点の42値と衝突なし（`GATHER` / `WINDOW` / `SCAN` / `FOLD` を含む既存kindは0件を実測確認）→ 48値 | 指示§7.1で確定 | **差異なし** |
| 5 | 合成値モデルの具体型と既存SimValueとの統合方法 | `SimValue` へ `list` variant（`elementType` 自己保持）を追加し、既存 `stringList` は不変のまま並存 | 指示§7.2で確定 | **差異なし**（判断記録 §2） |
| 6 | AI生成候補へのgather DSL開放の可否 | **開放しない**（ユーザー決定）。Phase 6は手動連携方式（v0.10）へ置換済みであり、取込対象外化の2点のみ実装。将来拡張として持越し | 指示§7.8で確定 | **差異なし**（判断記録 §6・本報告 §16） |
| 7 | 視覚回帰基準画像・共通UI・Oracle suite構成の意図的更新の範囲 | 視覚回帰: 既存27枚据え置き（更新0枚）・P7 8枚新設。共通UI: 操作選択の「中間」optgroupへ `gather` が1行増えるのみ（optgroup新設・`CATEGORY_LABELS` 変更なし）。Oracle suite: P7-O01追加・P6-O01の `writeReportPath` をnull化・`PAST_ARTIFACT_DIRS` へ `artifacts/phase-6` 追加（7 suite構成） | 指示§10・§12.5 | **差異なし**（本報告 §10・§13、判断記録 §11） |

## 19. commit / push / PRの実施内容

Phase 7実装指示 §18により、実装中はcommit / push / PR / mergeを行わなかった。
**codexレビュー完了（第4回で承認可）後、ユーザーの明示指示を受けて**、
次のとおりcommitとpush、PR作成を実施した。
**`main`へのmergeは実施していない**（指示に含まれていないため）。

### commit列

| commit | 内容 |
|---|---|
| `5c4d41f` | （Phase 7着手前）Phase 7実装指示書の追加 |
| `a0c50ca` | Phase 7本体（83ファイル）。`src` / `tests` / `e2e` / `oracle` / `artifacts/phase-7` / P7視覚回帰基準画像8枚 / `README.md` |
| `3395212` | Phase 7完了報告と判断記録（`docs/phase-7-completion-report.md` / `docs/phase-7-decisions.md`） |
| （本commit） | 本節へcommit SHAとPR URLを確定記載し、§17.3を実施済みへ更新（commit自身のSHAは記載できないため `git log` で確認できる） |

Pull Request: **#8** https://github.com/toru3001y/Java-StreamAPI-Simulator/pull/8
（base `main` / head `phase-7`。**未merge**）

push先: `origin/phase-7`（新規ブランチ。`5c4d41f..3395212`）

### commitに含めなかったファイル（意図的）

Phase 1〜6と同じく、`codex_review_request_*` / `*_start_request.md` はいずれのPhaseでも
追跡していない。次の5件は未追跡のまま保持している。

- `docs/phase7_start_request.md`（実装開始依頼文）
- `docs/codex_review_request_P7_Implementation_Instructions.md`（指示書のレビュー依頼文）
- `docs/codex_review_request_P7_Implementation.md`（実装のレビュー依頼文・レビュー記録）
- `docs/phase6_start_request.md`（Phase 6運用ファイルの残置分）
- `docs/codex_review_request_P6_Implementation_Instructions.md`（同上）
