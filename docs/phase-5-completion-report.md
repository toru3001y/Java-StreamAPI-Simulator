# Phase 5 完了報告（Collector可視化）

## 1. 判定

**Phase 5 完了**。

Draft v0.8 §20のPhase 5実装内容（3引数collect、Collector AST、単純Collector、downstream、
grouping、partitioning、collectingAndThen、teeing）と完了条件（構造ツリー、蓄積、結果型、
空partition、finisher / merger snapshotが正しい）を、Domain・Application・React・E2E・
JDK 25 Oracle Testで実証した。`docs/phase-5-decisions.md` §3〜§11のJ-2確定事項どおりteeingが成立し、
Phase 1〜4の全必須テストIDが回帰として成功している。Phase 6は実装していない。

第1回codexレビュー（Blocker 0件 / Major 4件 / Minor 1件 / Nit 1件）の指摘6件はすべて是正済みである
（§20。是正内容は`docs/phase-5-decisions.md` §22へ記録した）。
第2回codexレビューで**「Phase 5完了として承認可」**の判定を得た（前回6件はすべて是正済み判定、
新規Blocker / Major / Minor 0件、Nit 3件）。Nit 3件も是正済みである（§21）。

## 2. 基準コミットと作業ブランチ

- 作業ブランチ: `phase-5`（開始時HEAD: `639efb900c3e49911146f71cfbde9b78867396ec`）
- Phase 4の正式承認コミット: `58f28e29083a9a10f6c2eeba935a87d9bfdfacaa`
- Phase 4を`main`へ統合したマージコミット: `ae1094cbaab93bcfd61cdf27234c3ae6081fbe01`
- J-2（teeing）仕様確定コミット: `7f3ea840b05ca113c5b4f4d8ae516ed33ee1524e`

開始前の`git merge-base --is-ancestor`検証（指示§3.2）:

| 検証 | 結果 |
|---|---|
| `ae1094c`（Phase 4マージ）がHEADの祖先 | OK |
| `7f3ea84`（teeing確定）がHEADの祖先 | OK |
| `58f28e2`（Phase 4承認）がHEADの祖先 | OK |
| `git status --short`（開始時） | clean（未コミットのユーザー変更なし） |
| Draft v0.8 docx / `docs/phase-5-decisions.md` の存在 | 両方存在 |

## 3. 実装済み操作

### 3.1 collect本体

- `collect(Collector)`（OperationCatalog: `collect`、category `collector`）
- `collect(Supplier, BiConsumer, BiConsumer)`（同: `collectTriple`）
  - supplier / accumulator / combinerは定義済みIDの組合せホワイトリスト
    （`ArrayList::new` / `ArrayList::add` / `ArrayList::addAll`）
  - sequential実行のみのため、combinerは定義表示のみ（呼出し0回）で、実行済みのように表示しない
  - primitive特化Streamの3引数collectは対象外（object Streamのみ受理）

### 3.2 Collector（Draft v0.8 付録A.4の全項目）

| 分類 | 実装 | 教材template |
|---|---|---|
| 単純 | `toList` | `tmpl-collect-tolist` / `-midempty` |
| 単純 | `toSet` | `tmpl-collect-toset` |
| 単純 | `toCollection`（supplier ID） | `tmpl-collect-tocollection` |
| 単純 | `joining()` / `joining(delimiter)` / `joining(delimiter, prefix, suffix)` | `tmpl-collect-joining` / `-delimiter` / `-full` |
| 単純 | `counting` | `tmpl-collect-counting` |
| 単純 | `summingInt` / `summingLong` / `summingDouble` | `tmpl-collect-summing-int` / `-long` / `-double` |
| 単純 | `averagingInt` / `averagingLong` / `averagingDouble` | `tmpl-collect-averaging-int` / `-long` / `-double` |
| 単純 | `summarizingInt` / `summarizingLong` / `summarizingDouble` | `tmpl-collect-summarizing-int` / `-long` / `-double` |
| 単純 | `minBy` / `maxBy` | `tmpl-collect-minby` / `-maxby` |
| 単純 | `reducing`（BinaryOperator） | `tmpl-collect-reducing` |
| downstream合成 | `mapping` | `tmpl-collect-mapping` |
| downstream合成 | `filtering` | `tmpl-collect-filtering` |
| downstream合成 | `flatMapping` | `tmpl-collect-flatmapping` |
| downstream合成 | `collectingAndThen` | `tmpl-collect-collectingandthen` |
| 分類ツリー | `groupingBy(classifier)` | `tmpl-collect-groupingby` / `-midempty` |
| 分類ツリー | `groupingBy(classifier, downstream)` | `tmpl-collect-groupingby-counting` / `-averaging` |
| 分類ツリー | `groupingBy(classifier, mapFactory, downstream)` | `tmpl-collect-groupingby-treemap` |
| 分類ツリー | nested `groupingBy` | `tmpl-collect-groupingby-nested` |
| 分類ツリー | `partitioningBy(predicate)` | `tmpl-collect-partitioningby` |
| 分類ツリー | `partitioningBy(predicate, downstream)` | `tmpl-collect-partitioningby-counting` |
| Collector入れ子 | `teeing` | `tmpl-collect-teeing` / `-midempty` |
| 3引数collect | supplier / accumulator / combiner | `tmpl-collect-triple` |

`Collectors.toMap()`は付録A.4の対象外のため実装していない。

### 3.3 持越し対応（指示§5.3）

- `tmpl-takewhile-employee`: `takeWhile(e -> e.salary() >= 5_000_000L)` → `[佐藤]`
  （鈴木 4,200,000で境界到達し短絡。高橋 7,200,000はPredicateならtrueだが未評価）
- `tmpl-dropwhile-employee`: `dropWhile(e -> e.salary() >= 5_000_000L)` → `[鈴木, 高橋, 田中]`
  （佐藤をdropし、鈴木で通過モードへ遷移。以降Predicateを再評価しない）
- いずれも標準 / 途中0件 / 空ソースの3modeを提供

## 4. Collector Engine一般化の設計概要

### 4.1 runtime構造

`src/domain/engine/collectorRuntime.ts`（新規、約1600行）。

Phase 3のSTATEFUL共通バッファ（`nodeId` 1階層 + 固定フィールドのフラット構造）にも、
Phase 4の`TerminalRuntime`（全terminalを合併した平坦な単一構造体）にも押し込めないため、
**Collector ASTに対応する再帰的なCollectorRuntime**として別建てした。

- `CollectorRuntimeNode`: AST 1ノード分の状態。`nodeKey`（`c0` / `c0.down` / `c0.left` /
  `c0.bucket#1` の安定パス）、入力型・結果型、蓄積状態、finisher状態、bucket、teeing contextを持つ。
- double集計は`addWithCompensation` / `finalCompensatedSum`（`sum - compensation`）でJDKと一致させる（§12.1・§16.2）。
- container生成 / bucket決定 / 蓄積更新 / finisher適用 / merger適用をノード単位で表現する。
- bucketはruntime内では`Map<string, BucketRuntime>` + **生成順配列**、viewでは生成順配列として公開する
  （bucket生成順の決定性が構造的に成立する）。
- snapshot発行はStep Engineへ委譲する（`CollectorEmit`コールバック）。「1事象 = 1 snapshot」を守り、
  `TimelineBuilder.push`の直前に必ずcontext / result viewを同期する（既存`syncTerminal`と同型の`syncCollector`）。
- Step Engineへの組み込み: `handleTerminalElement`へcollect分岐を追加し、
  全要素処理後の構造snapshotフェーズ（finish stage）を`RESULT_CONFIRMED`の直前へ新設した。
- Phase 4の既存終端操作（reduce / count / min・max / find / match / sum / average / statistics /
  toList / toArray / forEach系）の挙動・snapshot列・テストは変更していない（P5-D31で回帰検証）。

### 4.2 新設SnapshotKind（8種。既存34種 → 42種）

| SnapshotKind | 内容 |
|---|---|
| `CONTAINER_CREATED` | supplier適用によるコンテナ生成確定（3引数collect必須 / toCollectionにも発行） |
| `CLASSIFIER_EVALUATED` | groupingBy classifierの評価確定（groupingBy専用） |
| `BUCKET_SELECTED` | bucket決定確定（新規生成か既存かを区別） |
| `CONTAINER_UPDATED` | コンテナ / bucketへの蓄積更新確定 |
| `COLLECTOR_FINISHED` | Collector finisher適用確定（collectingAndThenを含む） |
| `TEE_BRANCH_ACCUMULATED` | teeing左右branchの蓄積更新確定（`activeBranch: LEFT | RIGHT`） |
| `TEE_BRANCH_FINISHED` | teeing左右branchのfinisher適用確定（R1 / R2確定） |
| `TEE_MERGER_APPLIED` | merger適用確定（R1・R2 → R） |

既存kindの再利用（二重発行なし）: `NODE_ARRIVAL` / `PREDICATE_EVALUATED`（partitioningBy・filtering）/
`MAPPING_APPLIED`（mapping）/ `MAPPED_STREAM_CREATED` + `CHILD_EMITTED`（flatMapping）/
`RESULT_CONFIRMED` / `STREAM_CONSUMED`。

### 4.3 context構造

`OperationContextView`へ`collector` variantを追加（`operationContexts`は`NodeId`キーのため、
Collectorツリー全体を1 variant内の再帰viewとして保持し、CollectorノードごとにnodeIdを発番しない）。

- `root: CollectorNodeView`（AST・ノード別蓄積・ノード別結果TypeRef・finisher状態・bucket・teeing）
- `currentPath: readonly string[]` / `currentPathLabel`（現在経路）
- `triple`（3引数collectのsupplier / accumulator / combiner、combiner呼出し0回と注記）
- `CollectorTeeingView`は`docs/phase-5-decisions.md` §6の契約項目を1項目ずつ保持する
  （teeing node ID、左右node ID、左右AST、現在入力elementId、`activeBranch` 3値、
  左右branch状態4値、左右蓄積、左右結果、R1・R2のTypeRef、merger識別子、merger適用済みフラグ、
  最終結果、RのTypeRef、左→右の教材上表示順、JDK呼出し順保証でない旨の注記）
- viewはプレーンなobject / 配列のみ（`structuredClone`可能・`deepFreeze`可能）

終端結果は`TerminalResultView`へ`COLLECTION` / `MAP` / `RECORD`を追加した（既存variantは非破壊）。
Map entryの値は`TerminalResultView`を再帰的に持つ（nested groupingByはvalueが`MAP`）。

## 5. 未実装のPhase 6機能一覧

- サーバーAPI
- AI adapter / 実AI接続 / AI候補検証
- `RemoteScenarioProvider`
- AI capability（現在は`available: false`で理由「AI生成はPhase 6で提供予定のため、現在は利用できません。
  固定サンプルをご利用ください。」を表示）
- レスポンシブ最終調整・総合試験

あわせて、Phase 5の対象外として次も実装していない: `Collectors.toMap()`（付録A.4対象外）、
primitive Streamの3引数collect（Draft v0.8 §15.1）、parallelStream実行シミュレーション（combinerの実実行）、
任意Pipelineビルダー、Predicate / mapper / Collector / Javaコードの自由入力、自動再生速度変更UI、
null / NaN / Infinity / overflow / 例外を主題とする教材。

## 6. 主な変更ファイルとアーキテクチャ上の役割

### 6.1 新規

| ファイル | 役割 |
|---|---|
| `src/domain/dsl/collectorAst.ts` | Collector AST（再帰的な識別可能Union）・IDホワイトリスト・入れ子上限 |
| `src/domain/dsl/validateCollector.ts` | closed schema構造検証・3引数collect検証・結果TypeRefの再帰導出 |
| `src/domain/engine/collectorRuntime.ts` | 再帰CollectorRuntime（container / bucket / finisher / merger）・context view・result view |
| `src/domain/template/templatesP5.ts` | Phase 5 Collector教材template（28件）と持越しtemplate（2件） |
| `src/ui/displayOrderProjection.ts` | Set / Mapの学習用表示順projection（純粋なUI関数） |
| `src/ui/components/CollectorStructurePanel.tsx` | Collector構造ツリー・現在経路・ノード別蓄積・teeing表示 |
| `oracle/OracleP5.java` | P5-O01のJDK 25固定Javaコード（unordered正規化を含む） |
| `oracle/expected-p5-from-core.json` | Simulation Core由来の期待値（67キー） |

### 6.2 主な変更

| ファイル | 変更内容 |
|---|---|
| `src/domain/engine/snapshot.ts` | SnapshotKind 8種追加、`collector` context variant、`COLLECTION`/`MAP`/`RECORD` result variant |
| `src/domain/engine/stepEngine.ts` | collector runtime生成・collect分岐・finish stage新設・結果ラベル拡張 |
| `src/domain/catalog/operations.ts` | `collect` / `collectTriple`を`collector` categoryで登録、古いヘッダコメント修正 |
| `src/domain/catalog/operationCatalog.ts` | `fromCollector`型規則を追加 |
| `src/domain/template/instantiate.ts` | `collector` / `collectTriple` slotの7手順への配線、`fromCollector`の結果型解決 |
| `src/domain/template/pipelineTemplate.ts` | `ParameterSlot`へ`collector` / `collectTriple` variant |
| `src/domain/pipeline/pipelineDefinition.ts` | `PipelineNodeDef`へ`collector` / `collectTriple` |
| `src/domain/dsl/javaCode.ts` | `collectorToJavaExpr`（再帰）・collect行生成・`SalarySummary` record宣言・`javaStringLiteral` export |
| `src/domain/dsl/ast.ts` / `validate.ts` / `evaluate.ts` / `explanation.ts` | Predicate DSLへlong定数を加算的に追加（`salary >= 5_000_000L`） |
| `src/domain/types/typeRef.ts` | `TYPE_LONG` / `TYPE_DOUBLE` / `TYPE_BOOLEAN_WRAPPER` / `setOf` / `mapOf` / `optionalOf` |
| `src/domain/types/result.ts` | `ValidationCode`へ`COLLECTOR_DEPTH` |
| `src/providers/fixtureScenarioProvider.ts` | Phase 5 fixture 73件を追加 |
| `src/ui/appInstance.ts` | `UNIMPLEMENTED_OPERATIONS`を空配列化（Phase 5項目0件） |
| `src/ui/components/ScenarioControls.tsx` | Collector optgroup追加・空の未実装optgroupを描画しない |
| `src/ui/components/MainSimulation.tsx` | `COLLECTION` / `MAP` / `RECORD`結果の描画（入れ子・表示順projection） |
| `src/ui/components/OperationStatePanel.tsx` | `collector` contextの描画分岐 |
| `src/ui/components/DetailsDisclosure.tsx` | teeing merger recordの定義表示 |
| `src/ui/App.tsx` / `styles.css` | 副題をPhase 5へ更新、Collector表示のスタイル追加 |
| `e2e/capture-helper.ts` | `CAPTURE_TARGET_PHASE`を`5`へ（この1か所のみ） |
| `oracle/oracle-lib.mjs` / `run-oracle.mjs` | `P5-O01` suite追加・`P4-O01`の書込み停止・過去artifacts不変検証へphase-4追加・現行Phase判定の新設 |

## 7. 実行した全コマンドと終了結果

### 7.1 変更前基準（指示§3.3）

`npm ci` / `npm run lint` / `npm run typecheck` / `npm run test:unit` / `npm run build` は
作業ディレクトリで実行（生成物は`.gitignore`済みの`node_modules` / `dist`のみ）。

`npm run test:e2e` / `npm run test:oracle` は、現状コードのまま実行すると追跡ファイルである
Phase 4証跡を書き換えるため（§21参照）、**HEAD（`639efb9`）の一時git worktreeを
作業ディレクトリ外へ作成し、そこで実行**した。実プロジェクトの`artifacts/phase-4`には書き込んでいない。

| コマンド | 実行場所 | 結果 |
|---|---|---|
| `npm ci` | 作業ディレクトリ | exit 0（121 packages） |
| `npm run lint` | 作業ディレクトリ | exit 0 |
| `npm run typecheck` | 作業ディレクトリ | exit 0 |
| `npm run test:unit` | 作業ディレクトリ | **36ファイル / 311件 全成功** |
| `npm run build` | 作業ディレクトリ | exit 0 |
| `npm ci` | 一時worktree | exit 0 |
| `npm run test:e2e` | 一時worktree | **50件 全成功** |
| `npm run test:oracle` | 一時worktree | **P1-O01 / P2-O01 / P3-O01 / P4-O01 全PASS + P4-O02 / P4-O03 PASS** |

いずれも変更前から失敗はなく、指示§3.3の基準値（Vitest 311件・36ファイル、Playwright 50件、
Oracle 4 suite）と一致した。取得後、worktreeは`git worktree remove`で削除した。

### 7.2 変更後（完了判定時）

| コマンド | 結果 |
|---|---|
| `npm ci` | exit 0 |
| `npm run lint`（oxlint） | exit 0 |
| `npm run typecheck`（tsc -b） | exit 0 |
| `npm run test:unit`（vitest run） | **44ファイル / 392件 全成功**（失敗0・skip 0） |
| `npm run build`（tsc -b && vite build） | exit 0 |
| `npm run test:e2e`（playwright test） | **63件 全成功**（chromium-pc / chromium-narrow） |
| `npm run test:oracle`（Docker + JDK 25） | **P5-O01 PASSED / P5-O02 PASSED / P4-O01・P4-O02 REGRESSION PASSED** |
| `git diff --check` | 出力なし（whitespaceエラーなし） |

## 8. テスト種別ごとの総数・成功・失敗・skip・未実行

| 種別 | 総数 | 成功 | 失敗 | skip | 未実行 |
|---|---|---|---|---|---|
| Vitest（Domain / Application / React） | 392（44ファイル） | 392 | 0 | 0 | 0 |
| うちPhase 5新規（8ファイル） | 81 | 81 | 0 | 0 | 0 |
| Playwright E2E・視覚回帰 | 63 | 63 | 0 | 0 | 0 |
| JDK 25 Oracle suite | 5（P1〜P5-O01） | 5 | 0 | 0 | 0 |
| Oracle 判定ID | P5-O01 / P5-O02 / P4-O02（回帰） | 3 | 0 | 0 | 0 |

環境制約による未実行のテストはない（Docker + `gradle:9.6.1-jdk25`は利用可能）。

## 9. P5必須59 IDの対応表

### 9.1 Domain単体テスト（P5-D01〜P5-D32）

| ID | 対象 | テストファイル |
|---|---|---|
| P5-D01 | Collector Catalog | `tests/domain/p5-catalog-dsl.test.ts` |
| P5-D02 | Collector AST検証（closed schema。埋込みDSL各階層の負例・Comparator適合検証を含む） | `tests/domain/p5-catalog-dsl.test.ts` |
| P5-D03 | 3引数collect | `tests/domain/p5-collectors.test.ts` |
| P5-D04 | toList / toSet / toCollection | `tests/domain/p5-collectors.test.ts` |
| P5-D05 | joining（3 overload・空結果） | `tests/domain/p5-collectors.test.ts` |
| P5-D06 | counting / summing系 | `tests/domain/p5-collectors.test.ts` |
| P5-D07 | averaging / summarizing系（double補償付き加算のJDK一致を含む） | `tests/domain/p5-collectors.test.ts` |
| P5-D08 | minBy / maxBy / reducing | `tests/domain/p5-collectors.test.ts` |
| P5-D09 | mapping | `tests/domain/p5-collectors.test.ts` |
| P5-D10 | filtering（空bucketが残る） | `tests/domain/p5-collectors.test.ts` |
| P5-D11 | flatMapping | `tests/domain/p5-collectors.test.ts` |
| P5-D12 | collectingAndThen | `tests/domain/p5-collectors.test.ts` |
| P5-D13 | groupingBy（Department record値等価） | `tests/domain/p5-collectors.test.ts` |
| P5-D14 | groupingBy + downstream（bucket生成順finisher・nested Collector内部finisher） | `tests/domain/p5-collectors.test.ts` |
| P5-D15 | groupingBy + mapFactory（TreeMap順序・**finisherも実キー順**・禁止組合せの負例） | `tests/domain/p5-collectors.test.ts` |
| P5-D16 | nested groupingBy | `tests/domain/p5-collectors.test.ts` |
| P5-D17 | partitioningBy（wrapper Boolean・両キー） | `tests/domain/p5-collectors.test.ts` |
| P5-D18 | partitioningBy + downstream（**finisherもfalse → true固定順**） | `tests/domain/p5-collectors.test.ts` |
| P5-D19 | teeing蓄積 | `tests/domain/p5-teeing.test.ts` |
| P5-D20 | teeing merger | `tests/domain/p5-teeing.test.ts` |
| P5-D21 | teeing空Stream | `tests/domain/p5-teeing.test.ts` |
| P5-D22 | nested teeing（テストローカルtemplate。branch内部の汎用finisher発行を含む） | `tests/domain/p5-teeing.test.ts` |
| P5-D23 | teeing標準結果 | `tests/domain/p5-teeing.test.ts` |
| P5-D24 | 空入力（付録B） | `tests/domain/p5-invariants.test.ts` |
| P5-D25 | 結果TypeRef連鎖（§7.3の全22型） | `tests/domain/p5-invariants.test.ts` |
| P5-D26 | Collector context不変条件 | `tests/domain/p5-invariants.test.ts` |
| P5-D27 | PROCESSING最大1件 | `tests/domain/p5-invariants.test.ts` |
| P5-D28 | 決定性・500 snapshot予算 | `tests/domain/p5-invariants.test.ts` |
| P5-D29 | Source of Truth（eval / new Function不在を含む） | `tests/domain/p5-invariants.test.ts` |
| P5-D30 | takeWhile / dropWhile持越し | `tests/domain/p5-invariants.test.ts` |
| P5-D31 | 終端回帰（Phase 4終端が不変） | `tests/domain/p5-invariants.test.ts` |
| P5-D32 | teeing context契約（§6の15項目を1項目ずつ） | `tests/domain/p5-teeing.test.ts` |

P5-D03〜P5-D18には、対象Collectorのsnapshot列が指示§9.1の発行規則・発行表と一致することの検証
（`COLLECTOR_FINISHED`の発行有無、bucketごとの発行、`PREDICATE_EVALUATED` / `MAPPING_APPLIED`の再利用、
二重発行なし）を含めている。

### 9.2 Applicationテスト（P5-A01〜P5-A05）

| ID | 対象 | テストファイル |
|---|---|---|
| P5-A01 | 操作切替（timer停止・新revision・history 1件・cursor 0・READY） | `tests/application/p5-session.test.ts` |
| P5-A02 | template / mode切替（supportedModes・revision再利用なし） | `tests/application/p5-session.test.ts` |
| P5-A03 | 履歴復元（bucket・蓄積・finisher・merger・Set保持elementId） | `tests/application/p5-session.test.ts` |
| P5-A04 | 自動再生（1 snapshotずつ・finisher / mergerを飛ばさない） | `tests/application/p5-session.test.ts` |
| P5-A05 | 検証エラー（許可外AST・型不一致・深すぎる入れ子・任意コード・Comparator不適合） | `tests/application/p5-session.test.ts` |

### 9.3 React統合テスト（P5-R01〜P5-R10）

| ID | 対象 | テストファイル |
|---|---|---|
| P5-R01 | 操作 / template UI（Collector optgroup・未実装0件・AI理由Phase 6維持） | `tests/react/p5-app.test.tsx` |
| P5-R02 | 構造ツリー表示（AST・現在経路・active bucket / branch） | `tests/react/p5-app.test.tsx` |
| P5-R03 | 蓄積表示（bucket成長・Set無変化・joining連結・統計値） | `tests/react/p5-app.test.tsx` |
| P5-R04 | 結果TypeRef表示（全パネル一致） | `tests/react/p5-app.test.tsx` |
| P5-R05 | finisher / merger表示（前後・左右結果・merger定義・最終結果） | `tests/react/p5-app.test.tsx` |
| P5-R06 | 空結果表示（空partition両キー・各Collectorの空結果） | `tests/react/p5-app.test.tsx` |
| P5-R07 | 表示順projection（決定的順序・注記・TreeMap優先・**構造ツリー順と結果順の区別**） | `tests/react/p5-app.test.tsx` |
| P5-R08 | コード・説明同期（line ID強調・jdkNote・snapshot ID一致） | `tests/react/p5-app.test.tsx` |
| P5-R09 | record表示（SalarySummary定義と結果値） | `tests/react/p5-app.test.tsx` |
| P5-R10 | a11y・responsive（記号+文言・keyboard・focus・狭幅） | `tests/react/p5-app.test.tsx` |

### 9.4 E2E・視覚テスト（P5-E01〜P5-E10）

| ID | 対象 | テストファイル |
|---|---|---|
| P5-E01 | 単純Collector（toList / toSet / joining / counting） | `e2e/phase5.spec.ts` |
| P5-E02 | 3引数collect（進む / 戻る / 自動） | `e2e/phase5.spec.ts` |
| P5-E03 | groupingBy系（bucket成長・downstream・nested・mapFactory） | `e2e/phase5.spec.ts` |
| P5-E04 | partitioningBy（固定2分岐・空partition） | `e2e/phase5.spec.ts` |
| P5-E05 | downstream合成とcollectingAndThen finisher | `e2e/phase5.spec.ts` |
| P5-E06 | teeing標準（左右蓄積 → finisher×2 → merger） | `e2e/phase5.spec.ts` |
| P5-E07 | teeing空Stream | `e2e/phase5.spec.ts` |
| P5-E08 | mode / 操作切替 | `e2e/phase5.spec.ts` |
| P5-E09 | 履歴・自動 | `e2e/phase5.spec.ts` |
| P5-E10 | 狭幅・視覚回帰 | `e2e/phase5.spec.ts`（PC幅4枚）/ `e2e/p5-narrow.spec.ts`（狭幅） |

### 9.5 JDK 25 Oracle Test（P5-O01・P5-O02）

| ID | 対象 | 実装 |
|---|---|---|
| P5-O01 | JDK 25照合（全実装Collector・3引数collectの標準・空Stream） | `oracle/OracleP5.java` + `oracle/expected-p5-from-core.json` + `tests/domain/p5-oracleSync.test.ts` |
| P5-O02 | Oracle運用検証（必須5 suite・現行Phase単独書込み・過去artifacts不変） | `oracle/run-oracle.mjs` + `tests/domain/p5-review.test.ts` |

合計 32 + 5 + 10 + 10 + 2 = **59 ID**をすべて実装・成功。

## 10. `docs/phase-5-decisions.md` §10の24条件と担当テストID

| # | 条件 | 担当ID |
|---|---|---|
| 1 | 全snapshotでPROCESSINGが0件または1件 | P5-D27（P5-D19 / P5-D22も検証） |
| 2 | 左右に表示される入力要素が同じ安定elementId | P5-D19 |
| 3 | 入力1件につき左downstreamの蓄積が正確に1回 | P5-D19 |
| 4 | 入力1件につき右downstreamの蓄積が正確に1回 | P5-D19 |
| 5 | 左右の蓄積更新が別snapshot | P5-D19 |
| 6 | 教材上のsnapshot順が左→右で決定的 | P5-D19 |
| 7 | 右branch完了前に次の入力要素を処理しない | P5-D19 |
| 8 | 全入力の左右蓄積完了前にmergerを適用しない | P5-D20 |
| 9 | 両downstreamのfinisher完了前にmergerを適用しない | P5-D20 |
| 10 | `TEE_MERGER_APPLIED`がteeingノードごとに正確に1件 | P5-D20（nested: P5-D22） |
| 11 | merger snapshotで`currentElementId === null` | P5-D20 |
| 12 | merger snapshotでPROCESSINGが0件 | P5-D20 |
| 13 | R1・R2・RのTypeRefがCollector ASTと一致 | P5-D20（P5-D32も検証） |
| 14 | 標準fixtureの結果が`employeeCount=4, averageSalary=5425000.0` | P5-D23 |
| 15 | 空Streamの結果が`employeeCount=0, averageSalary=0.0` | P5-D21 |
| 16 | empty時にもmergerが1回適用される | P5-D21 |
| 17 | nested teeingでも各mergerの依存順が正しい | P5-D22 |
| 18 | nested teeingでもPROCESSINGが最大1件 | P5-D22 |
| 19 | 戻る→進むで同じsnapshotを完全復元 | P5-A03 |
| 20 | 同一revisionの再実行で同一snapshot列 | P5-D28 |
| 21 | 自動再生でも1回に1 snapshotだけ進む | P5-A04 |
| 22 | 基準templateが500 snapshot以内 | P5-D28 |
| 23 | JDK 25 Oracle Testで標準・空Streamの最終結果が一致 | P5-O01 |
| 24 | Java表示コードがDSL / Collector ASTから生成され、任意Javaコード文字列を実行しない | P5-D29 |

24条件すべてに担当テストが存在し、成功している。

## 11. 既存P1〜P4必須IDの回帰結果と、許可された既存テスト期待値更新

### 11.1 回帰結果

| Phase | 必須ID数（実測: テスト・E2E・Oracle内の一意ID参照数） | 結果 |
|---|---|---|
| Phase 1 | 42（必須41 + P1-O01） | 全成功 |
| Phase 2 | 52 | 全成功 |
| Phase 3 | 60 | 全成功 |
| Phase 4 | 72 | 全成功 |

Oracle IDも全成功（P1-O01 / P2-O01 / P3-O01 / P4-O01 / P4-O02 / P4-O03の契約検証）。
既存テストIDの削除・緩和・skipは行っていない。

### 11.2 §12冒頭で許可された更新の一覧と理由

| ファイル / ID | 更新内容 | 理由 |
|---|---|---|
| `tests/domain/p4-catalog-dsl.test.ts` | `expect(catalog.has('collect')).toBe(false)` → `true` | Phase 5でcollectが実装・登録済みになったため。検証意味（Catalog登録状態が現状と一致すること）を維持 |
| `tests/domain/p4-invariants.test.ts` P4-D40 | 「Phase 5未実装」検証 → 「collect / collectTripleは`collector` categoryで登録、Collectors各種は操作ではなくCollector AST kind」の検証へ | 現状のOperationCatalog登録範囲の契約を検証し続けるため。`groupingBy` / `partitioningBy`が操作として登録されないことの検証は維持 |
| `tests/react/p4-app.test.tsx` P4-R01 | 「Phase 5で実装予定」文言の検証 → 「未実装リストが空・空optgroup非描画・Collector操作が選択可能」の検証へ | 指示§10.1の移行後UIに合わせた。Phase 4終端15操作が選択可能であることの検証は維持 |
| `tests/react/p2-app.test.tsx` P2-R01 | 未実装操作の件数（≥7）・Phase表記の検証 → 未実装リストが空・空optgroup非描画の検証へ | 同上（Phase 3での同種更新の先例と同じ書式でコード内へ理由を記載） |
| `tests/react/p3-app.test.tsx` P3-R01 | 同上 | 同上 |
| `tests/domain/p4-review.test.ts` P4-O03 | ライブ`SUITES`依存を`P4_SUITES_FIXTURE`（Phase 4時点の4 suite構成）へ差し替え | Phase 5でsuite構成が変わったため。**検証意味（必須4 suite各1件・P4のみが`artifacts/phase-4/oracle-result.md`へ書込み）は変更・緩和していない**。ライブ構成の検証は新規P5-O02が担当。あわせて`evaluateOracleIds` / `buildOracleIdSection`を`suites` / `requiredSuiteIds` / `writerSuiteId` / `writerReportPath`でパラメータ化した |

### 11.3 視覚回帰基準画像の意図的更新

Phase 5のUI変更（ヘッダー副題「Phase 5: Collectorと可変リダクション（Java SE 25基準）」、
操作選択へのCollector optgroup追加と未実装optgroup削除に伴う選択行のレイアウト変化）が
全画面基準画像に写るため、P1-E11 / P2-E10 / P3-E10 / P4-E10の基準画像16枚を意図的に更新した
（Phase 2〜4と同じ扱い）。

- 更新前にPlaywrightのdiff画像を確認し、**差分がヘッダー副題と操作選択行に限られ、
  Pipeline・シミュレーション・コード・説明・再生バー領域に予期しない差分がない**ことを確認済み。
- thresholdは緩和していない。画像テストの削除・skipもしていない。
- P5-E10の基準画像4枚（groupingBy bucket / 空partition / collectingAndThen finisher / teeing merger）は
  代表snapshotのみを新規基準化した。
- `artifacts/phase-1`〜`artifacts/phase-4`は変更していない（`git status`で無変更を確認）。

## 12. P5-O01 / P5-O02のJDKベンダー・バージョン・ケース・照合結果

- Dockerイメージ: `gradle:9.6.1-jdk25`
- JDKベンダー / バージョン: **Eclipse Temurin OpenJDK 25.0.3+9（2026-04-21 LTS）**
  （`openjdk version "25.0.3" 2026-04-21 LTS` / `OpenJDK Runtime Environment Temurin-25.0.3+9`）
- 照合方式: JSON.parse後のオブジェクトをJSON.stringifyし文字列完全一致で判定。
  64bit境界値（`Long.MAX_VALUE` / `Long.MIN_VALUE`）と`±Infinity`は10進文字列のまま比較する。

### 12.1 P5-O01のケース（67キー）

- 単純Collector: toList / toSet / toCollection / joining（3 overload）/ counting /
  summing・averaging・summarizing（Int / Long / Double）/ minBy / maxBy / reducing
  （いずれも標準・空Stream）
- downstream合成: mapping / filtering / flatMapping / collectingAndThen
- 分類ツリー: groupingBy（Department recordキー）/ groupingBy + counting / groupingBy + averagingLong /
  groupingBy + TreeMap（実順序）/ nested groupingBy / partitioningBy / partitioningBy + counting
  （空partitionを含む）
- teeing: 標準（`SalarySummary[employeeCount=4, averageSalary=5425000.0]`）/
  空Stream（`SalarySummary[employeeCount=0, averageSalary=0.0]`）
- 3引数collect: 標準・空Stream
- 持越し: takeWhile / dropWhile（`salary >= 5_000_000L`）
- joining空結果: 引数なし版`""` / 3引数版`"[]"`
- double集計の実測値: `summingDouble` = `16.6` / `averagingDouble` = `4.15` /
  `summarizingDouble` = `count=4, sum=16.6, min=3.8, max=4.6, average=4.15` /
  `averagingLong` = `5425000.0` / `averagingInt` = `33.25`
- **補償付き加算が効くdouble列**（第1回レビュー是正で追加）: `[0.001, 0.01]` /
  `[1e16, 1, 1, 1, -1e16]` / `[0.1, 0.2, 0.3]` について
  `compensatedSums` = `["0.011000000000000001", "4.0", "0.6"]`、
  `naiveSums` = `["0.011", "0.0", "0.6000000000000001"]`、
  `compensatedAverages` = `["0.0055000000000000005", "0.8", "0.19999999999999998"]`、
  `compensatedStatsSums` = `["0.011000000000000001", "4.0", "0.6"]`。
  単純合計と異なることも同時に照合する。**この3ケースはいずれも有限値であり、
  旧実装の逆符号（`sum + compensation`）および単純加算への退行を確実に検出するが、
  補償付き加算のあらゆる手順誤り（±Infinityフォールバックの欠落等）を検出するものではない**
  （指示§11によりInfinity / NaNを主題とする教材・検証ケースは対象外としたため）

**照合結果: PASS（完全一致）**。指示§8の見込み値と実測値の差異はなかった。

### 12.2 unordered結果の比較正規化

順序意味論を持たないSet / Mapは、Simulation Core側・Java Oracle側の双方で
要素・キーの表示文字列の辞書順へsortした正規化表現へ変換してから照合した。
TreeMapは正規化せず実順序のまま照合した（JSONキー`groupingByTreeMapOrdered`）。
正規化がJDKのiteration order保証を意味しないことは`oracle/OracleP5.java`のクラスコメントと
`artifacts/phase-5/oracle-result.md`へ明記した。

### 12.3 P5-O02の判定

| 判定項目 | 結果 |
|---|---|
| 必須5 suite（P1-O01 / P2-O01 / P3-O01 / P4-O01 / P5-O01）が各1件存在 | PASS |
| 証跡書込みは現行Phase（P5）のみ・書込み先は`artifacts/phase-5/oracle-result.md`だけ | PASS |
| 実行前後で`artifacts/phase-1`〜`phase-4`のSHA-256が不変 | PASS |

### 12.4 過去Phase suiteの回帰

| suite / ID | 結果 |
|---|---|
| P1-O01 | PASS（照合のみ・証跡書込みなし） |
| P2-O01 | PASS（照合のみ・証跡書込みなし） |
| P3-O01 | PASS（照合のみ・証跡書込みなし） |
| P4-O01 | PASS（照合のみ・証跡書込みなし） |
| P4-O02（Long境界値の損失なし照合をP4 suiteへ適用） | PASS |

観測記録（厳密比較の対象外・JDKの保証として扱わない）:
`groupingByMapClass=HashMap` / `toSetClass=HashSet` / `collectorsToListMutable=true`。

## 13. teeing代表snapshot列（標準・空Stream）の構造比較結果

### 13.1 標準（`tmpl-collect-teeing`、Employee 4件、22 snapshot）

```
INITIAL
SOURCE_EMIT, NODE_ARRIVAL, TEE_BRANCH_ACCUMULATED(LEFT), TEE_BRANCH_ACCUMULATED(RIGHT)   ← 佐藤
SOURCE_EMIT, NODE_ARRIVAL, TEE_BRANCH_ACCUMULATED(LEFT), TEE_BRANCH_ACCUMULATED(RIGHT)   ← 鈴木
SOURCE_EMIT, NODE_ARRIVAL, TEE_BRANCH_ACCUMULATED(LEFT), TEE_BRANCH_ACCUMULATED(RIGHT)   ← 高橋
SOURCE_EMIT, NODE_ARRIVAL, TEE_BRANCH_ACCUMULATED(LEFT), TEE_BRANCH_ACCUMULATED(RIGHT)   ← 田中
TEE_BRANCH_FINISHED(LEFT)    ← R1 = 4（Long）
TEE_BRANCH_FINISHED(RIGHT)   ← R2 = 5425000.0（Double）
TEE_MERGER_APPLIED           ← R = SalarySummary[employeeCount=4, averageSalary=5425000.0]
RESULT_CONFIRMED
STREAM_CONSUMED
```

- `docs/phase-5-decisions.md` §4の順（到着 → 左蓄積 → 右蓄積）と一致。左右は別snapshot。
- 左右で同じ安定`elementId`を参照（要素の複製・別ID付与なし）。
- `TEE_BRANCH_FINISHED`は左右それぞれ1件、`TEE_MERGER_APPLIED`は正確に1件。
- merger snapshotは`currentElementId === null`・PROCESSING 0件・`activeBranch: NONE`。
- teeing branch rootへ`COLLECTOR_FINISHED`は発行していない（§9.1規則4）。

### 13.2 空Stream（`emptySource`、6 snapshot）

```
INITIAL
TEE_BRANCH_FINISHED(LEFT)    ← R1 = 0
TEE_BRANCH_FINISHED(RIGHT)   ← R2 = 0.0
TEE_MERGER_APPLIED           ← R = SalarySummary[employeeCount=0, averageSalary=0.0]
RESULT_CONFIRMED
STREAM_CONSUMED
```

`docs/phase-5-decisions.md` §7の手順どおり、蓄積snapshotは0件でも
`TEE_BRANCH_FINISHED`×2 → merger 1回が発行される（mergerを省略しない）。

### 13.3 途中0件（`tmpl-collect-teeing-midempty`、22 snapshot）

filterで全件除外されるため`TEE_BRANCH_ACCUMULATED`は0件。
`TEE_BRANCH_FINISHED`×2 → `TEE_MERGER_APPLIED`×1で結果は`employeeCount=0, averageSalary=0.0`。

## 14. 結果TypeRef連鎖（指示§7.3）の比較結果

`PipelineDefinition.resultType`・終端ノードの`outputType`・出力パネルの`resultTypeLabel`・
Collector ASTルートノードの`resultTypeLabel`の4者が全て一致することをP5-D25で検証した。

| Pipeline | 結果TypeRef |
|---|---|
| `collect(toList())` | `List<Employee>` |
| `map(Employee::region) + collect(toSet())` | `Set<String>` |
| `map(Employee::name) + collect(joining())` | `String` |
| `collect(counting())` | `Long` |
| `collect(summingInt(age))` / `summingLong(salary)` / `summingDouble(evaluation)` | `Integer` / `Long` / `Double` |
| `collect(averagingInt/Long/Double(...))` | `Double` |
| `collect(summarizingInt/Long/Double(...))` | `IntSummaryStatistics` / `LongSummaryStatistics` / `DoubleSummaryStatistics` |
| `collect(minBy(...))` / `maxBy(...)` | `Optional<Employee>` |
| `collect(groupingBy(Employee::department))` | `Map<Department, List<Employee>>` |
| `collect(groupingBy(Employee::region, TreeMap::new, toList()))` | `Map<String, List<Employee>>` |
| `collect(groupingBy(Employee::region, counting()))` | `Map<String, Long>` |
| nested `groupingBy`（department → region） | `Map<Department, Map<String, List<Employee>>>` |
| `collect(partitioningBy(e -> e.age() >= 30))` | `Map<Boolean, List<Employee>>`（キーはwrapper Boolean） |
| `collect(teeing(counting(), averagingLong(salary), SalarySummary::new))` | `SalarySummary` |
| 3引数`collect(ArrayList::new, ArrayList::add, ArrayList::addAll)` | `List<Employee>` |

`groupingBy` + downstreamではdownstreamの結果型がMapのvalue型になることをASTノード単位で表現している。
partitioningByのキーは`{kind:'object', name:'Boolean'}`（primitive `boolean`と混同しない）。

## 15. PC幅 / 狭幅キャプチャと視覚回帰画像の保存先

### 15.1 証跡キャプチャ: `artifacts/phase-5/`（17枚）

- PC幅（13枚）: `capture-pc-groupingby.png` / `capture-pc-groupingby-nested.png` /
  `capture-pc-groupingby-treemap.png` / `capture-pc-partitioningby.png` /
  `capture-pc-partitioning-empty.png` / `capture-pc-collecting-and-then.png` /
  `capture-pc-teeing-merger.png` / `capture-pc-teeing-empty.png` / `capture-pc-toset.png` /
  `capture-pc-filtering.png` / `capture-pc-collect-triple.png` /
  `capture-pc-takewhile-employee.png` / `capture-pc-dropwhile-employee.png`
- 狭幅375px（4枚）: `capture-narrow-groupingby-nested.png` / `capture-narrow-teeing-merger.png` /
  `capture-narrow-partitioning-empty.png` / `capture-narrow-collecting-and-then.png`

### 15.2 視覚回帰の期待画像

- Phase 5新規: `e2e/__screenshots__/phase5.spec.ts/`（`p5-e10-groupingby.png` /
  `p5-e10-partitioning-empty.png` / `p5-e10-collecting-and-then.png` / `p5-e10-teeing-merger.png`）
- 意図的更新: `e2e/__screenshots__/phase1.spec.ts/`（4枚）/ `phase2.spec.ts/`（4枚）/
  `phase3.spec.ts/`（4枚）/ `phase4.spec.ts/`（4枚）

### 15.3 PC幅 / 狭幅の目視確認（指示§13項目4）

groupingBy・partitioningBy（空partition含む）・collectingAndThen・teeing（merger）について、
PC幅（1280×900）と狭幅（375×812）の両方でキャプチャを確認した。
狭幅では構造ツリーが自身のコンテナ内で横スクロールし、ページ全体は横スクロールしないこと、
stickyバーが本文を隠さないことをP5-E10-narrowで機械検証している。

## 16. 仕様との差異と実装判断

Draft v0.8・`docs/phase-5-decisions.md` §1〜§12・Phase 5実装指示書の間に、
**実装結果を変える矛盾は検出していない**。Draft v0.8は無編集。

実装判断は`docs/phase-5-decisions.md` §13〜§21へ追記した（既存§1〜§12は無変更）。主な項目:

- §13: Collector AST DSLの構成（明示null方式、IDホワイトリスト実装値、入れ子上限4、
  flatMappingの展開規則、Collector内部Predicateのホワイトリスト検証、Predicate DSLへのlong定数追加）
- §14: 新設SnapshotKind 8種と既存kind再利用（flatMappingは`MAPPED_STREAM_CREATED`/`CHILD_EMITTED`を再利用）、
  `CONTAINER_CREATED`のtoCollectionへの適用、teeingの「収集完了」に独立snapshotを設けない判断、
  branch状態の遷移タイミング
- §15: TypeRefの新kindを追加しない判断、コンテナ実装名（ArrayList / TreeMap）を表示メタ情報として持つ判断、
  `SimValue`を拡張せずCollector固有contextへ蓄積を保持する判断、Setの要素ID規則、
  Department recordキーの値等価判定
- §16: double集計の補償付き加算（P5-O01実測で見込み値と一致。差異なし）
- §17: bucket確定順の決定的順序
- §18: UIの表示順projection（Engine確定順とUI表示順は独立）
- §19: 教材template・fixtureの構成判断（ファイル分離、mode構成、nested teeingはテストローカル）
- §20: Oracle suite構成の変更とunordered正規化
- §21: 指示§3.3と§14/§18の運用上の衝突（一時worktreeでの変更前基準取得）

### 16.1 特記事項: Predicate DSLへのlong定数の加算的追加

指示§8の基準Pipeline例`e.salary() >= 5_000_000L`は、Phase 4までのPredicate DSL
（int定数 × `age`のみ）では表現できなかった。表示用Javaコードを指示どおりにするため、
`ast.ts` / `validate.ts` / `evaluate.ts` / `javaCode.ts` / `explanation.ts`へ
**非破壊で**long定数サポートを追加した。既存P1〜P4テスト311件は無変更で全通過している。

### 16.2 特記事項: double集計の補償付き加算（第1回レビューで是正）

当初は最終値を`sum + compensation`としていたが、**codexレビュー指摘を受けJDK 25で実測し、
`sum - compensation`が正しいことを確認して是正した**（補償値は各入力から減算して累積するため）。

| 入力 | JDK 25実測 | `sum - compensation` | `sum + compensation`（誤） |
|---|---|---|---|
| `[0.001, 0.01]` | `0.011000000000000001` | `0.011000000000000001` | `0.010999999999999998` |

教材fixture（4.2 / 3.8 / 4.6 / 4.0）では補償が残らず両符号が一致するため、当初のOracleケースでは
検出できなかった。補償が効く3列をP5-O01とP5-D07へ追加し、単純合計との相違も同時に固定した。
`DoubleSummaryStatistics.getSum()`も同じ規約であることをJDK実測で確認している。
**この項目に未確認事項は残っていない。**

## 17. 500 snapshot上限と全templateの実測件数

- 実測ファイル: `artifacts/phase-5/snapshot-budget.txt`（TSV: templateId / mode / snapshot件数、
  最終行に`# max`）
- 全211組（template × mode）を実測し、**最大53件**（上限500）。
- Phase 5 templateの主な実測値: `tmpl-collect-flatmapping` standard 39 /
  `tmpl-collect-groupingby-nested` standard 31 / `tmpl-collect-joining` standard 28 /
  `tmpl-collect-groupingby-averaging` standard 26 / `tmpl-collect-teeing` standard 22 /
  `tmpl-collect-teeing` emptySource 6
- `def.snapshotCount`と実snapshot件数の一致、および全P5 templateが500以内であることをP5-D28で検証。
- nested teeingのテストローカルtemplateも500以内（P5-D22で検証）。

## 18. 既知の問題とPhase 6への持越し

### 18.1 既知の問題

- `Collectors.toMap()`はDraft v0.8 付録A.4の対象外のため未実装（仕様どおり）。
- `groupingBy`のmapFactoryは`TreeMap::new`のみ、collectingAndThenのfinisherは`List::copyOf`のみ。
  教材として必要な範囲へ限定した（`docs/phase-5-decisions.md` §13.3）。
- production bundleが504 kBとなり、Viteのチャンクサイズ警告（500 kB）が出る。
  動作への影響はないが、Phase 6のレスポンシブ最終調整とあわせてcode-splittingを検討する余地がある。

### 18.2 Phase 6への持越し

- サーバーAPI、AI adapter、`RemoteScenarioProvider`、実AI接続、AI候補検証
- レスポンシブ最終調整、総合試験
- parallelStream実行シミュレーション（combinerの実実行）は初版対象外のまま

## 19. 最終 `git diff --stat` / `git status --short` と、commit・push・PRを行っていないことの確認

### 19.1 変更規模

- `git diff --stat`（追跡ファイル）: **50 files changed, 2651 insertions(+), 180 deletions(-)**
  （本報告書と`artifacts/phase-5/`等は未追跡ファイルのため`git diff --stat`には含まれない。
  第1回レビュー時点は2515 insertions、第2回レビュー時点は2642 insertions）
  （うち16ファイルは視覚回帰基準画像の意図的更新）
- 新規（未追跡）ファイル・ディレクトリ: **24件**（`git status --short`の`??`行）
  - Domain / UI: `src/domain/dsl/collectorAst.ts` / `src/domain/dsl/validateCollector.ts` /
    `src/domain/engine/collectorRuntime.ts` / `src/domain/template/templatesP5.ts` /
    `src/ui/displayOrderProjection.ts` / `src/ui/components/CollectorStructurePanel.tsx`
  - テスト: `tests/domain/p5-catalog-dsl.test.ts` / `p5-collectors.test.ts` / `p5-teeing.test.ts` /
    `p5-invariants.test.ts` / `p5-oracleSync.test.ts` / `p5-review.test.ts` /
    `tests/application/p5-session.test.ts` / `tests/react/p5-app.test.tsx` /
    `tests/p5-helpers.ts` / `tests/p5-oracle-expected.ts`
  - E2E: `e2e/phase5.spec.ts` / `e2e/p5-capture.spec.ts` / `e2e/p5-narrow.spec.ts` /
    `e2e/__screenshots__/phase5.spec.ts/`
  - Oracle: `oracle/OracleP5.java` / `oracle/expected-p5-from-core.json`
  - 証跡: `artifacts/phase-5/`
  - 本報告書: `docs/phase-5-completion-report.md`
- `git diff --check`: 出力なし（whitespaceエラーなし）
- `artifacts/phase-1`〜`artifacts/phase-4`: **無変更**（`git status`で確認）
- `docs/phase-1〜4-completion-report.md` / `docs/phase-1〜4-decisions.md`: **無変更**
- `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`: **無変更**

### 19.2 指示§13の追加確認10項目

| # | 確認項目 | 結果 |
|---|---|---|
| 1 | 既存P1〜P4テストID（41+52+60+72と各Oracle ID）が全成功 | OK |
| 2 | P5必須59 IDが全実装・成功 | OK |
| 3 | `docs/phase-5-decisions.md` §10の24条件に対応テストが存在 | OK（§10の対応表） |
| 4 | PC幅と狭幅でgroupingBy / partitioningBy / collectingAndThen / teeingを目視確認 | OK（§15.3） |
| 5 | 視覚回帰の期待画像を意図せず一括更新していない | OK（差分内容を確認のうえ16枚を意図的更新。§11.3） |
| 6 | `eval` / `new Function` / 動的コード生成 / AI SDK / HTTP AI接続の混入なし | OK（P5-D29が`src`全ファイルを走査） |
| 7 | Phase 6の機能が先行実装されていない | OK（§5） |
| 8 | 全P5 fixtureのsnapshotBudgetが500以内 | OK（最大53件。§17） |
| 9 | E2Eキャプチャの書込み対象Phaseが5のみで`artifacts/phase-1`〜`phase-4`が変更されない | OK（`CAPTURE_TARGET_PHASE = 5`の1か所のみ変更） |
| 10 | `git diff --check` / `git diff --stat` / `git status --short`で変更範囲を確認 | OK（§19.1） |

### 19.3 commit / push / PR / merge を行っていないことの確認

指示§18に従い、**commit・push・Pull Request作成・`main`へのmergeはいずれも行っていない**。
すべての変更は`phase-5`ブランチの作業ツリー上の未コミット変更として残している
（`git log`のHEADは開始時と同じ`639efb900c3e49911146f71cfbde9b78867396ec`）。
ユーザーの既存変更を削除・stash・reset・checkoutで破棄していない。

## 20. 第1回codexレビュー対応（2026-08-12）

codexへ実装レビューを依頼し、**Blocker 0件 / Major 4件 / Minor 1件 / Nit 1件**の指摘を受けた。
総合判定は「是正後に再レビュー」であり、**6件すべてを是正した**。
判断の詳細は`docs/phase-5-decisions.md` §22。

| # | 深刻度 | 指摘 | 是正内容 | 追加した検証 |
|---|---|---|---|---|
| 1 | Major | double補償付き加算の最終符号がOpenJDKと逆（`sum + compensation`） | `finalCompensatedSum`を`sum - compensation`へ是正。JDK 25実測で確認 | P5-D07（補償3列）、P5-O01（`compensatedSums` / `naiveSums` / `compensatedAverages` / `compensatedStatsSums`） |
| 2 | Major | Collector内の埋込みDSL（mapper / predicate / literal / comparator / comparator key）がclosed schemaでなかった | `validateCollector.ts`へ各階層の許可キー集合を追加し`STRUCTURE_INVALID`で拒否。Phase 1〜4のslot検証は変更せず | P5-D02（負例9件: `functionBody` / `evalExpr` / `javaCode` / `extra`を各階層で拒否）、P5-A05 |
| 3 | Major | minBy / maxByが適用不能なnatural Comparatorを型検証で受理し、Engineで例外になっていた | `resolveCollectorType`へComparatorと入力要素型の適合検証を追加（`TYPE_MISMATCH`） | P5-D02（正例・負例）、P5-A05（instantiateで拒否されEngineへ入らないこと） |
| 4 | Major | §9.1規則7の必須テストが宣言どおり実装されていなかった（finisher非発行のdownstreamで検証していた） | 発行対象downstreamを持つテストローカルtemplateで確定処理順を検証 | P5-D15（TreeMap実キー順）、P5-D18（false → true固定順）、P5-D14（nested内部finisher）、P5-D22（teeing branch内部finisher） |
| 5 | Minor | 構造ツリー（bucket生成順）と最終結果（辞書順 / 実キー順）で順序説明が食い違っていた | ツリー側へ「bucket生成履歴順」「蓄積の追加順」の注記を追加し、一律の「学習用の順序」表示をやめた | P5-R07（ツリー順・結果順・両注記を同時検証） |
| 6 | Nit | テスト名・報告の項目数が実際と一致していなかった | IDを維持したままテスト名を現状へ更新。P5-D32の項目数を14→15へ訂正 | — |

### 20.1 レビューで確認できなかった検証への対応

codex環境ではPlaywrightの全体実行がtimeoutし、`npm run test:e2e`のexit 0が再現できなかったと
報告された（各テストの成功表示自体は確認済み）。実装側の環境では是正後に再実行し、
**63件全成功・exit 0**を確認した。

構造ツリーの注記追加（#5）によりP5-E10の基準画像4枚を再更新した。
更新前にdiff画像を確認し、**差分がCollector構造ツリー領域の注記追加とそれに伴う縦シフトに限られ、
ヘッダー・Pipeline・入力・出力・再生バーに予期しない差分がない**ことを確認している。
過去Phase（P1-E11 / P2-E10 / P3-E10 / P4-E10）の基準画像は再更新していない。

### 20.2 レビュー中に発見した副次的な問題

フルスイート同時実行時に`tests/react/p5-app.test.tsx`が既定5秒のtestTimeoutへ達して
flakyになる問題を発見した（単独実行では成功）。ファイル単位で
`vi.setConfig({ testTimeout: 60_000 })`を設定して解消した
（skip・期待値緩和・テスト削除はしていない。実行時間の確保のみ）。

### 20.3 是正後の再検証結果

| コマンド | 結果 |
|---|---|
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | **44ファイル / 392件 全成功**（是正前383件 → 追加9件） |
| `npm run build` | exit 0 |
| `npm run test:e2e` | **63件 全成功** |
| `npm run test:oracle` | **P5-O01 PASSED / P5-O02 PASSED / P4-O01・P4-O02 REGRESSION PASSED** |
| `git diff --check` | 出力なし |
| `artifacts/phase-1`〜`phase-4` | 無変更 |

commit・push・PR・mergeは引き続き行っていない（HEADは`639efb900c3e49911146f71cfbde9b78867396ec`のまま）。

## 21. 第2回codexレビュー対応（2026-08-12）

第1回指摘6件の是正確認として再レビューを依頼した。結果は次のとおり。

- **総合判定: Phase 5完了として承認可**
- 前回6件はすべて「是正済み」判定
- 新規: Blocker 0件 / Major 0件 / Minor 0件 / **Nit 3件**

Nit 3件はいずれも文書記述の精度に関する指摘であり、すべて是正した。

| # | 指摘 | 是正内容 |
|---|---|---|
| 1 | `docs/phase-5-completion-report.md` §12.1の見出しが「63キー」のまま（実際は67キー。補償4キー追加が未反映） | 「67キー」へ訂正 |
| 2 | `docs/phase-5-decisions.md` §22.4の「いずれも`currentElementId === null`・`PROCESSING` 0件も併せて検証」が、P5-D14には直接アサートがないため記述が広すぎる（P5-D27の横断検証はテストローカルtemplateを含まない） | **P5-D14へ2条件の直接アサートを追加**し、あわせて§22.4へ「P5-D27の対象外なので各テストで直接検証する」旨を明記（記述を狭めるのではなく検証を強める方向で解消） |
| 3 | 「符号や手順を誤ると必ずFAIL」は過大（追加3ケースは有限値のみで、±Infinityフォールバック欠落は検出しない） | 検出能力を「旧実装の逆符号および単純加算への退行を確実に検出する」範囲へ限定し、Infinity / NaNを検証ケースに含めない理由（指示§11）を明記 |

### 21.1 Nit #3の対応方針

検証ケースへ±Infinityを追加して検出能力を上げる案も検討したが、指示§11が
「null、NaN、Infinity、overflow、例外を主題とする教材」を対象外としているため、
**検証ケースは有限値に限り、検出能力の限界を文書へ明示する**方針を採った
（`docs/phase-5-decisions.md` §16.2「検出能力の範囲」）。

### 21.2 `npm run test:e2e`のexit 0について

第1回・第2回ともcodex環境では、63件の列挙とキャプチャ生成までは確認できたが、
Windows上でVite子プロセスの終了待ちが残りコマンドのexit 0を取得できなかったと報告された
（失敗artifactは生成されていない）。

実装側の環境では**63件全成功・exit 0を取得済み**である（§7.2・§20.3）。
両環境の結果を併記して残す。

### 21.3 第2回レビューでの実行結果（codex環境）

| 検証 | 結果 |
|---|---|
| `npm run lint` / `typecheck` / `build` | exit 0（buildは既知のchunk-size警告のみ） |
| `npm run test:unit` | 44ファイル / 392件成功 |
| P5 React単独 | 11件成功、最長約3.5秒 |
| `npm run test:oracle` | P1〜P5・P5-O02・P4境界値回帰すべて成功 |
| `git diff --check` | 問題なし |
| HEAD / 追跡変更50件 / 未追跡24件 | 検証前後で不変 |
| Draft v0.8・過去Phase文書・過去artifacts | 差分なし |
| `docs/phase-5-decisions.md` §1〜§12 | 削除なし |

`vi.setConfig({ testTimeout: 60_000 })`（§20.2）については、単独時の最長が約3.5秒・
フルUnitも約21秒で成功しており、**失敗を隠した証拠はない**と判定された。

### 21.4 Nit是正後の再検証（実装側）

| コマンド | 結果 |
|---|---|
| `npm run lint` / `typecheck` / `build` | exit 0 |
| `npm run test:unit` | **44ファイル / 392件 全成功** |
| `npm run test:e2e` | **63件 全成功・exit 0** |
| `npm run test:oracle` | **P5-O01 PASSED / P5-O02 PASSED / P4-O01・P4-O02 REGRESSION PASSED** |

Nit #2でP5-D14へアサートを追加したが、テスト件数は変わらない（既存itへの追加のため）。
commit・push・PR・mergeは引き続き行っていない（HEADは`639efb900c3e49911146f71cfbde9b78867396ec`）。

## 22. 第3回codexレビュー対応（2026-08-12）

第2回のNit 3件の是正確認として最終レビューを依頼した。結果は次のとおり。

- **総合判定: Phase 5完了として承認可**
- Blocker 0件 / Major 0件 / Minor 0件 / **Nit 1件**
- 第2回のNit 3件はすべて是正済みと確認された

| # | 指摘 | 是正内容 |
|---|---|---|
| 1 | §19.1の`git diff --stat`が旧値「2642 insertions」のまま（実測は2651。第2回のNit対応で9行増加） | 「2651 insertions」へ訂正し、本報告書等が未追跡ファイルのため`git diff --stat`に含まれない旨と、各レビュー時点の値（第1回2515 / 第2回2642）を併記した |

本報告書は未追跡ファイル（`git status --short`の`??`）であるため、この訂正自体は
`git diff --stat`の値を変えない（訂正後も`50 files changed, 2651 insertions(+), 180 deletions(-)`で一致）。

### 22.1 第3回レビューでの検証結果（codex環境）

| 検証 | 結果 |
|---|---|
| `npm run lint` / `typecheck` / `build` | exit 0（buildは既知のchunk-size警告のみ） |
| `npm run test:unit` | 44ファイル / 392件成功 |
| `npm run test:oracle` | P1〜P5・P5-O02・P4境界値回帰すべてPASS |
| `npm run test:e2e` | 63件を確認・全PC / 狭幅キャプチャ生成・失敗artifact 0件（exit 0はVite子プロセス終了待ちにより未取得。§21.2と同じ既知事象） |
| `git diff --check` | 問題なし |
| HEAD / 追跡変更50件 / 未追跡24件 | 不変 |
| Draft v0.8・過去Phase文書・`artifacts/phase-1`〜`phase-4` | 差分なし |
| `docs/phase-5-decisions.md` §1〜§12 | 削除行なし |

### 22.2 レビュー範囲外の補足

codexから「`memory/phase-status.md`はリポジトリ内に存在しないためレビュー範囲で未確認」と
報告された。これは意図どおりである（Claude Code側のセッション横断メモリであり、
リポジトリの成果物ではない）。Phase 5の成果物・証跡はすべてリポジトリ内にある。

### 22.3 レビュー累計

| 回 | 判定 | 指摘 |
|---|---|---|
| 第1回 | 是正後に再レビュー | Major 4 / Minor 1 / Nit 1（計6件） |
| 第2回 | **承認可** | Nit 3件 |
| 第3回 | **承認可** | Nit 1件 |

累計10件すべて是正済み。commit・push・PR・mergeは引き続き未実施
（HEADは`639efb900c3e49911146f71cfbde9b78867396ec`）。
