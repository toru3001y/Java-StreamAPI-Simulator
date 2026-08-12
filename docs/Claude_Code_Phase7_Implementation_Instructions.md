# ローカルClaude Code向け Phase 7実装指示

以下を、そのまま対象リポジトリのプロジェクトルートで起動したClaude Codeへ渡してください。

---

# Java Stream API 可視化シミュレーター Phase 7実装指示

## 1. 実装開始の宣言

Draft v0.8に基づくPhase 1〜5、v0.10に基づくPhase 6は、GitHubの`main`へマージ済みです。Phase 7（Gatherers）の仕様は`docs/Java_Stream_API_Visualization_Spec_v0.9_Gatherers.md`（第4版。codexレビュー4回・承認済み）で確定済みです。

**本指示をもってPhase 7の実装開始を明示的に許可します。**

Phase 7の実装、テスト、画面確認、JDK 25 Oracle照合、総点検、証跡作成、完了報告まで行ってください。`Gatherers.mapConcurrent`の実行・カスタムGathererの実行・`Gatherer.andThen`合成・Phase 8以降の機能は実装しないでください。

## 2. 唯一の仕様基準と優先順位

実装判断の優先順位は次のとおりです。

1. `docs/Java_Stream_API_Visualization_Spec_v0.9_Gatherers.md`（以下「v0.9」。**Gatherer固有規定の最上位基準**）
2. `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`（v0.9 §1.1の優先順位を適用した上で、一般原則・不変条件・検証順序・UI原則の正）
3. 本Phase 7実装指示（上記2つを実装可能な粒度へ具体化する。v0.9が「Phase 7実装指示書で確定する」「Phase 7中に判断する」と委譲した事項は本指示§7・§8の確定値を正とする）
4. `docs/Java_Stream_API_Visualization_Spec_v0.10_Phase6_ManualLink.md`（手動連携の正。Phase 7では手動連携の仕様を変更しない。gather templateの取込対象外化は本指示§7.8の確定値）
5. `docs/phase-6-decisions.md` / `docs/phase-6-completion-report.md`
6. 現在の`main`上の実装・テスト・README

v0.9と本指示が矛盾する場合はv0.9を正とし、コードを変更する前に矛盾箇所を報告して停止してください。v0.8・v0.9・v0.10の各仕様書と統合docx（`docs/Java_Stream_API_Visualization_Spec_v0.10.docx`）は編集しないでください。本指示で定義する`P7-*`はPhase 7の追跡用テストIDであり、仕様書本文へテストIDを追記するものではありません。

## 3. Gitと作業開始前の確認

### 3.1 基準コミット

- Phase 6完了・v0.9 / v0.10仕様書をすべて含む`main`: `7664dad00a55095f018bf1f1abd79faa958bde72`（PR #7のmerge commit）

### 3.2 作業ブランチ

Phase 7の作業ブランチ`phase-7`は既に存在します。作業前に次を確認してください。

```bash
git fetch origin
git switch phase-7
git merge-base --is-ancestor 7664dad00a55095f018bf1f1abd79faa958bde72 HEAD
git status --short
```

- `phase-7`のHEADが基準コミットの子孫（または一致）であること。
- worktreeがcleanであること。ただし次の未追跡ファイルは運用ファイルであり、未コミットのまま存在してよい（停止条件に該当しない）: 本指示書ファイル自身（未コミットの場合）、codexレビュー依頼文（`docs/codex_review_request_P7_Implementation_Instructions.md`）、実装開始依頼文、およびPhase 6運用ファイルの残置分（`docs/phase6_start_request.md`・`docs/codex_review_request_P6_Implementation_Instructions.md`。前例によりコミットしない作業ファイル）。
- `docs/Java_Stream_API_Visualization_Spec_v0.9_Gatherers.md`が存在すること。

上記以外の未追跡・未コミットのユーザー変更がある場合は、stash、削除、上書きをせず停止して報告してください。**本指示だけを根拠にcommit、push、Pull Request作成、mainへのmergeは行わないでください。**

### 3.3 Phase 1〜6回帰基準

変更前に少なくとも次を実行し、基準結果を記録してください。

```bash
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

実行可能な環境では、変更前の`npm run test:e2e`と`npm run test:oracle`も実行してください。ただし、**この2つを現状コードのまま作業worktreeで実行してはいけません**。追跡済みのPhase 6証跡を書き換えるためです（`e2e/capture-helper.ts`の`CAPTURE_TARGET_PHASE = 6`が`artifacts/phase-6/*.png`を上書きし、`oracle/oracle-lib.mjs`のP6-O01 suiteの`writeReportPath`と実行日時埋め込みが`artifacts/phase-6/oracle-result.md`を確実に更新する）。これは§6.1・§14・§18の「Phase 1〜6証跡は一切変更しない」と衝突します。

Phase 5・Phase 6の前例（`docs/phase-5-decisions.md` §21、Phase 6指示§3.3）に従い、**基準コミットの一時git worktreeをプロジェクトディレクトリの外へ作成し、そこで変更前のE2E・Oracle基準を取得**してください。

```bash
git worktree add <プロジェクト外の一時パス> 7664dad00a55095f018bf1f1abd79faa958bde72
# 一時worktree内で npm ci を実行し、変更前の test:e2e / test:oracle の結果を記録する
git worktree remove --force <プロジェクト外の一時パス>
```

作業worktreeの`artifacts/phase-1`〜`phase-6`には一切書き込まないでください。また、作業worktreeで`npm run test:e2e` / `npm run test:oracle`を初めて実行する前に、必ず`CAPTURE_TARGET_PHASE = 7`への変更（§14）とOracle書込み先の変更（§12.5: P7-O01追加・P6-O01の`writeReportPath` null化）を先に済ませてください。

Phase 6完了時点の基準値は、Vitest 515件（52ファイル）、Playwright 72件、Oracle 6 suite（P1-O01〜P6-O01。P4-O02 / P6-O02判定を含む）全成功です。変更前から失敗がある場合はPhase 7実装で隠さず、原因と再現手順を報告して停止してください。

## 4. Phase 7の目的と完了範囲

v0.9 §9に従い、Phase 1〜6で成立した次の経路を壊さず、Gathererを縦断実装します。

```text
FixtureScenarioProvider
  → PipelineTemplate / TemplateInstance
  → 検証済みDSL / TypeRef
  → PipelineDefinition
  → Step Engine / Snapshot History
  → React UI
```

Phase 7の目的は、v0.9 §4の教材目標5点の実現です。

1. `Stream.gather`が**STATEFULな中間操作**であり、Gathererという収集戦略を差し替えられること（終端のCollectorとの対比）。
2. Gatherer<T,A,R>の構造（入力T・中間状態A・出力R）。
3. **4構成要素**（initializer / integrator / combiner / finisher）の役割を、組み込み4種（windowFixed / windowSliding / scan / fold）の実行で実演すること。
4. integratorがfalseを返す短絡の仕組みは説明のみで扱い、limit / takeWhileの短絡との対比を補助説明で行うこと。
5. mapConcurrentの存在と実行対象外の理由（並行実行の意味論）の補助説明。

実装範囲は、v0.9 §2.1の5メソッドをOperationCatalog・DSL・instantiate・Step Engine・template / fixture・UI・テスト・Oracleまで縦断することです。完了条件は§15で判定します。

## 5. Phase 7で実装するもの

### 5.1 新設ファイル

| ファイル | 責務 |
|---|---|
| `src/domain/dsl/gatherAst.ts` | `GathererDsl` union（§7.4）、`GatherAccumulationRule` union、`GATHER_FIELD_WHITELIST`、windowSize境界定数 |
| `src/domain/dsl/validateGather.ts` | Gatherer DSLのclosed schema構造検証・ホワイトリスト検証、出力型解決（§7.4・§7.5） |
| `src/domain/dsl/evaluateGather.ts` | 初期値のSimValue化（boxed変換契約）と累積評価（§7.4。Gatherer専用の独立実装） |
| `src/domain/template/templatesP7.ts` | Phase 7 template 7件（§7.6）。`templates.ts`の`ALL_TEMPLATES`へ集約（`templatesP5.ts`の分離前例） |
| `src/ui/components/GathererStructurePanel.tsx` | Gatherer構造パネル（§9）。CollectorStructurePanelのCSS・ツリー描画パターンのみ流用し、型契約は独立 |
| `oracle/OracleP7.java` / `oracle/expected-p7-from-core.json` | P7-O01（§12.5） |
| `tests/p7-oracle-expected.ts` / `tests/domain/p7-oracleSync.test.ts` | Oracle期待値のCore同期保証（P2〜P6前例） |
| `tests/domain/p7-*.test.ts` / `tests/application/p7-session.test.ts` / `tests/react/p7-app.test.tsx` | P7-D / P7-A / P7-R（§12） |
| `tests/domain/p7-review.test.ts` | P7-O02のライブ構成検証（§12.5） |
| `e2e/phase7.spec.ts` / `e2e/p7-narrow.spec.ts` / `e2e/p7-capture.spec.ts` | P7-E（§12.4）とPhase 7証跡キャプチャ |

### 5.2 変更ファイル

| ファイル | 変更点 |
|---|---|
| `src/domain/engine/snapshot.ts` | `SnapshotKind`へ6値追加（§7.1）、`OperationContextView`へ`kind: 'gather'`のvariant追加（§7.7） |
| `src/domain/engine/stepEngine.ts` | Gatherランタイム（`NodeRuntime` unionへの追加・`createRuntime`・context同期）、`processThroughChain`へのgather分岐、実行開始ブロックでの`GATHER_INITIALIZED`発行、finish cascadeの一般化（§8.1） |
| `src/domain/catalog/operationCatalog.ts` | `TypeRule`へ`{ kind: 'fromGatherer' }`追加（§7.5） |
| `src/domain/catalog/operations.ts` | `gather`操作の登録（§7.5。46操作目） |
| `src/domain/template/pipelineTemplate.ts` | `ParameterSlot`へ`gatherer` variant追加（12種目。§7.5） |
| `src/domain/pipeline/pipelineDefinition.ts` | `PipelineNodeDef`へ`gatherer`フィールド追加 |
| `src/domain/template/instantiate.ts` | gatherer slotの構造検証（手順1）・ホワイトリスト検証（手順3）・`fromGatherer`型解決（手順4）・nodeDef組立。7手順の枠組み・順序は変更しない |
| `src/domain/model/value.ts` | `SimValue`へ`list` variant追加（§7.2）と`formatSimValue` / `typeOfSimValue`対応 |
| `src/providers/fixtureScenarioProvider.ts` | Phase 7 fixture 11件追加（§7.6） |
| `src/domain/dsl/javaCode.ts` | gatherノードのJavaコード式生成（§7.4の表記契約） |
| `src/ui/components/OperationStatePanel.tsx` | `case 'gather'`の分配追加（17種目） |
| `src/application/importContract.ts` | **§7.8の2点のみ**（gather templateのimportable:false化・`slotSpecOf`の`case 'gatherer'`全拒否spec） |
| `src/domain/types/result.ts` | `ValidationCode`へ`GATHER_SIZE_LIMIT`追加（22個目。§7.4） |
| `oracle/oracle-lib.mjs` / `oracle/run-oracle.mjs` | P7-O01 suite追加・現行Phase切替（§12.5） |
| `e2e/capture-helper.ts` | `CAPTURE_TARGET_PHASE`を`6`→`7`（この1か所のみ） |
| `README.md` | Phase 7完了時のみ更新（§14） |

SimValueの`kind`を網羅的にswitchしている全箇所（`value.ts`の2関数、`stepEngine.ts`の`boxValue`、`distinctKey.ts`、javaCodeのリテラル生成、mapper評価等）を棚卸しし、`list` variantの追加に対して、Phase 7範囲（gatherの下流はtoList / findFirstのみ）で到達しない箇所は`EngineInvariantError`のthrowとしてください（P7-D07）。棚卸し一覧は完了報告へ記載してください。

## 6. 重要な境界

### 6.1 完了済みPhase 1〜6の保護

1. **歴史的証跡（不変）**: `docs/phase-1〜6-completion-report.md`、`docs/phase-1〜6-decisions.md`、`artifacts/phase-1`〜`phase-6`は一切変更しない。
2. **現行回帰テストスイート（意図的更新）**: §12冒頭の表に列挙した箇所**だけ**を許可する。それ以外の既存P1〜P6テストIDの削除・緩和・skipをしない。更新は理由つきで完了報告へ記録する。

### 6.2 既存DSL・既存契約の不変

- Terminal DSL（`src/domain/dsl/terminalAst.ts`の`ReductionDsl`・`ReductionIdentity`・`REDUCTION_FIELD_WHITELIST = ['salary', 'age']`）は**一切変更しない**（v0.9 §8.2）。Gatherer側のfield許可は`gatherAst.ts`の専用ホワイトリストで定義する（Phase 5の`COLLECTOR_NUMERIC_FIELDS`分離前例）。
- Collector DSL（`collectorAst.ts`）・Collector runtime・既存の全SnapshotKindの発行規則は変更しない。
- 既存SimValueの`stringList` variantは**不変のまま並存**させる（§7.2）。既存経路の`stringList`を新`list`へ移行しない。
- `instantiateTemplate`の7手順の枠組み・順序は変更しない。gatherer対応は各手順内への分岐追加に限る。
- Import Contract・Prompt Generator・Candidate Importの仕様（v0.10 §5〜§7）は変更しない。コード変更は§7.8の2点のみ。
- `FixtureScenarioProvider`のrevision形式`${templateId}:${mode}:r${counter}`・fixture経路の挙動は不変。

### 6.3 Phase 7の対象外（v0.9 §2.2）

- `Gatherers.mapConcurrent`の実行（存在と対象外理由の補助説明のみ）。
- カスタムGathererの自由記述・任意コード実行。
- short-circuitするGathererの実行（説明・jdkNoteのみ）。
- `Gatherer.andThen`合成、複数gatherノードの連結、gatherノード下流に短絡を生じる操作を置く合成（`fold → findFirst`のみ例外）。
- `Stream.gather`のprimitive特化Stream版（JDKに存在しない。IntStream等からは既存`boxed()`経由）。
- gather DSLの手動連携（取込候補）への開放（§7.8。**ユーザー決定により見送り**）。

## 7. 確定値（v0.9が本指示へ委譲した事項）

本節はv0.9 §1.2・§6.1・§6.2・§6.3・§8.2・§8.3・§9・§10の委譲事項の**確定値**です。規則の根拠はv0.9を正とします。

### 7.1 SnapshotKind（確定）

v0.9 §6.1の候補名6種を**そのまま確定**します: `GATHER_INITIALIZED` / `WINDOW_BUFFER_UPDATED` / `SCAN_ACCUMULATED` / `FOLD_ACCUMULATED` / `GATHER_FINISHED` / `GATHER_EMITTED`。

- 既存`SnapshotKind`は42値（`src/domain/engine/snapshot.ts`）で、上記6値との衝突がないことを確認済み（`GATHER` / `WINDOW` / `SCAN` / `FOLD`を含む既存kindは0件）。追加後は48値。
- 各kindの意味・発行規則はv0.9 §6.1（`GATHER_FINISHED`の統一発行規則を含む）を正とし、全発行列は本指示§8.2で確定する。

### 7.2 SimValueの合成値モデル（確定）

`src/domain/model/value.ts`の`SimValue`へ、次の1 variantを追加します。

```ts
| { readonly kind: 'list'; readonly elementType: TypeRef; readonly value: readonly SimValue[] }
```

- `typeOfSimValue`: `{ kind: 'collection', container: 'List', elementType }`を返す（要素0件でも型が確定するよう`elementType`を自己保持する。Phase 7で窓が空になることはないが、復元契約の頑健性のため）。
- `formatSimValue`: 要素を再帰整形し`[要素1, 要素2, ...]`とする。
- **既存`stringList` variantは不変のまま並存**させる。既存経路（listStream mapper等）の表示・型・テストを一切変えないためであり、両variantの役割分担を`docs/phase-7-decisions.md`へ記録する。
- プレーンな構造化データのみで構成し、`structuredClone` / `deepFreeze`可能であること（既存snapshot契約）。

### 7.3 ElementIdと要素状態遷移（確定）

v0.9 §6.3のとおり。実装上の確定は次です。

1. **窓の合成ID**: `<nodeId>-win-<N>`（Nはノードごとの生成順1始まり連番。例: `node-gather-win-1`）。
2. **fold最終値のID**: `<nodeId>-result`（例: `node-gather-result`）。
3. **合成要素の登録（窓・fold最終値に共通）**: 合成要素は生成時（`GATHER_EMITTED`発行前）に`TimelineBuilder.registerElement`で登録し、gatherノードでの要素状態を設定してから下流へ渡すこと（flatMap子要素`${elementId}-c${ci+1}`が生成直後に`registerElement`する前例に従う）。既存engineは未登録IDへの状態設定を`EngineInvariantError`にし、終端処理は要素状態の設定を前提とするため、登録漏れは実行時例外になる。処理中要素として発行される合成要素（cascade中の窓・fold最終値を含む）はすべてこの手順を踏む。
4. **scan出力のID**: 入力要素のIDを継承する（map系1→1変換と同一規則。`stepEngine.ts`のmap familyは同一elementIdのまま値を差し替える方式であり、これに合わせる）。
5. **メンバー参照**: 窓のメンバーはgatherノードへの入力要素のElementId列としてgather専用context（§7.7の`memberIds`）へ保持する。
6. **要素状態遷移**: window系は`WINDOW_BUFFER_UPDATED`で`BUFFERED`、その要素を含む**最初の窓**の`GATHER_EMITTED`で`PASSED`。windowSlidingで放出後もバッファに残る要素の`elementLatestStates`は`PASSED`のまま維持し、現在のバッファ所属・窓所属はgather専用contextのみで表す。scanはmap系（`PROCESSING`→`PASSED`）、foldは既存reduceの遷移（`FOLD_ACCUMULATED`で`PASSED`）に倣う。`REJECTED`はgatherノードでは発生しない。

### 7.4 Gatherer DSL（確定）

構造はv0.9 §8.1のとおり（`windowFixed { size }` / `windowSliding { size }` / `scan { initial, accumulation }` / `fold { initial, accumulation }`）。`gatherAst.ts`へ定義し、検証は`validateGather.ts`のclosed schema（kind → 許可キー集合 → ホワイトリスト → 型・値域）で行います。

1. **`<Identity>`**: 既存`ReductionIdentity`の型構造を**type-only importで再利用**する（`terminalAst.ts`は無変更）。値検証は既存`validateReductionIdentity`（`validateTerminal.ts`）へ委譲してよい（挙動を変えない共通化。v0.9 §8.2の許容範囲）。
2. **`<AccumulationRule>`**: Gatherer専用union `GatherAccumulationRule`（`numericSum` / `stringConcat` / `employeeFieldSum { field }`）。fieldホワイトリストは`GATHER_FIELD_WHITELIST = ['age', 'salary', 'evaluation']`（v0.9 §8.2で確定済み）。
3. **windowSize**: int定数・1以上16以下。1未満は`STRUCTURE_INVALID`（JDK実仕様の`IllegalArgumentException`に対応）、16超は**新設ValidationCode `GATHER_SIZE_LIMIT`**で拒否する（教材上限専用codeとして分離。`COLLECTOR_DEPTH`の前例。`src/domain/types/result.ts`の既存21 codeと衝突しないことを確認済み→22個目）。非整数・非有限値は`STRUCTURE_INVALID`。
4. **boxed変換契約**（v0.9 §8.3）: `initial.type`のタグと累積値のSimValue kindの対応を `int → boxedInt`・`long → boxedLong`・`double → boxedDouble`・`string → string` と確定する。累積評価は`evaluateGather.ts`のGatherer専用実装とし、**`evaluateReduction.ts`は呼ばない**（既存はprimitive kindで累積・gatherはboxed kindで累積するため、共通化は既存挙動の変更リスクになる。判断を`docs/phase-7-decisions.md`へ記録）。primitive名とwrapper名を混同して表示しない既存規律を維持する。
5. **型適合表**: v0.9 §8.3のとおり（stringConcat×String、numericSum×Integer/Long/Double、employeeFieldSum×Employee。window系のRは`List<T>`）。不適合は`TYPE_MISMATCH`。primitive Stream（IntStream等）を入力とするgatherは型検証で拒否し、`boxed()`経由を促すメッセージとする。
6. **Javaコード表記**: `.gather(Gatherers.windowFixed(3))`のようにDSLから決定的に生成する。scan / foldの初期値は既存`identityToJavaLiteral`、累積lambdaは既存reduce（`ReductionDsl`）のlambda表記規約と同形とし、lambda引数は既存の予約識別子（`acc`・`e`・`n`等）の範囲で選ぶ。表記の細部は実装判断とし`docs/phase-7-decisions.md`へ記録、構文的正当性と実データ一致はP7-D19で検証する。

### 7.5 OperationCatalog登録と型規則（確定）

- `gather`を1操作として登録する: `category: 'intermediate'`、`traits: ['INTERMEDIATE', 'STATEFUL']`（v0.9 §2.1・§9）、`inputTypeRule`は参照型Streamのみ（boxed型。§7.4の5）、`outputTypeRule: { kind: 'fromGatherer' }`（`TypeRule`へ新設し、instantiate手順4でGatherer DSLから出力要素型を解決する）、`legendStates: ['UNEVALUATED', 'PROCESSING', 'PASSED', 'BUFFERED']`、`visualizationKind`は窓束ね型 / 累積放出型 / 累積確定型（v0.9 §1.1の7）を代表する値、`jdkNotes`にstateful引用・integrator false短絡は説明のみ・mapConcurrent対象外の説明を含める。
- **組み込み4種（windowFixed等）は操作として登録しない**。Gatherer DSLのkindとtemplateで表現する（Phase 5がCollectors各種を登録せず`collect` / `collectTriple`の2操作へ集約した前例）。操作選択の「中間」optgroupへ`gather`が1行増えるのみで、optgroupの新設・`CATEGORY_LABELS`の変更はしない。
- scan / foldノードで`BUFFERED`凡例が不要な場合の絞り込みは、既存legend機構の範囲での実装判断とし、`docs/phase-7-decisions.md`へ記録する。

### 7.6 templateとfixture（確定）

Phase 7のtemplateは次の**7件**とします（v0.9 §8.4の基準必須4形＋教材目標の全実演に必要な3形。gatherノードは1 Pipelineに1つ・下流短絡なし・`fold → findFirst`のみ例外、の制約内）。gatherノードのnodeIdは全template共通で`node-gather`（既存の`node-src` / `node-map` / `node-boxed`等の命名規約に整合）、gatherer DSLは新設gatherer slot（slotId `slot-gatherer`・required）でfixtureが供給します。

| templateId | Pipeline | gatherer fixture値 | supportedModes | 実演内容 |
|---|---|---|---|---|
| `tmpl-gather-window-fixed` | collection(Employee 4件) → gather → toList | `{ kind: 'windowFixed', size: 3 }` | standard / emptySource | 窓[佐藤,鈴木,高橋]の成立push＋残余[田中]のfinisher flush。空: 放出0件 |
| `tmpl-gather-window-fixed-exact` | collection(Employee 4件) → gather → toList | `{ kind: 'windowFixed', size: 2 }` | standard | **倍数ケース**: 窓2つ放出後、`GATHER_FINISHED`は「残余なし・追加放出なし」明示の1件のみ |
| `tmpl-gather-window-sliding` | streamOf(String) → gather → toList | `{ kind: 'windowSliding', size: 2 }`・source `["Java","SQL","Git","AWS"]` | standard / emptySource | evict+appendの1回更新（除外要素をcontext明示）・3窓放出。空: 放出0件 |
| `tmpl-gather-window-sliding-short` | streamOf(String) → gather → toList | `{ kind: 'windowSliding', size: 3 }`・source `["Java","SQL"]` | standard | **入力件数<窓サイズ**: 窓成立0回→終端finisherで全要素の1窓flush |
| `tmpl-gather-scan` | arrayPrimitive(int) → boxed → gather → toList | `{ kind: 'scan', initial: { type: 'int', value: 0 }, accumulation: { kind: 'numericSum' } }`・source `[3, 1, 4]`（既存`numbers`前例値） | standard / emptySource | 1入力→1出力の逐次push（結果`[3, 4, 8]`）・`GATHER_FINISHED`不発行。空: 初期値生成のみ実演 |
| `tmpl-gather-scan-concat` | streamOf(String) → gather → toList | `{ kind: 'scan', initial: { type: 'string', value: '' }, accumulation: { kind: 'stringConcat' } }`・source `["Java","SQL","Git"]` | standard | stringConcat累積の実行実演（結果`["Java","JavaSQL","JavaSQLGit"]`） |
| `tmpl-gather-fold` | collection(Employee 4件) → gather → findFirst | `{ kind: 'fold', initial: { type: 'long', value: 0 }, accumulation: { kind: 'employeeFieldSum', field: 'salary' } }` | standard / emptySource | 放出なし累積→終端finisherで1件push→`Optional[21_700_000L]`。空: `Optional[0L]`（identity放出。v0.9 §7「導出」区分の実演）。Phase 4 reduceとの対比 |

- fixtureは**11件**（standard 7 + emptySource 4）。emptySourceは既存前例どおり同一source種の空値（collection=`EMPTY_EMPLOYEES`、streamOf / arrayPrimitiveは`values: []`）で構成する。
- `tmpl-gather-scan-concat`を加える理由: v0.9 §8.2で確定した`AccumulationRule` 3 kindのうち`stringConcat`を実行するfixtureが基準4形＋境界2形には存在せず、DSL kindが死蔵になるため（本指示の追加判断。`docs/phase-7-decisions.md`へ記録）。
- **midEmptyは全gather templateで非対応**とする。foldはmidEmptyの教材制約（終端への入力0件）を原理的に満たせない（空上流でもidentity 1件が終端へ届く）。window系 / scanのmidEmptyはgatherノード視点でemptySourceと同一列になり教材価値が重複する。判断を`docs/phase-7-decisions.md`へ記録する。
- gather固有の教材制約（mode別手続き検証）は追加しない。gather templateは取込対象外（§7.8）でfixture固定のため、fixture値の教材適合（残余あり / 倍数 / 入力<窓サイズ）はP7-Dテストが直接検証する。
- `snapshotBudget`は`{ limit: 500, estimatedMax: 40 }`とする（§8.2の実測列は最大28件）。
- template総数は111→**118**、実行可能templateは109→**116**、実行可能template×supportedModesの組合せは211→**222**になる（現行値は基準コミットで実測済み）。
- fixtureのtitle / descriptionの文言は実装判断（教材目標§4を反映し、既存fixtureの文体に合わせる）。

### 7.7 GatherContextView契約（確定）

`OperationContextView`へ`kind: 'gather'`のvariantを追加します。含めるフィールド（すべてプレーンデータ）:

- `nodeId`、`gathererKind`（4種）、`gathererLabel`（Javaコード式）、入力型・出力型ラベル
- **4構成要素の常設4行**: `initializer { stateLabel, note }` / `integrator { callCount, note }` / `combiner { callCount: 0固定, note }` / `finisher { stateLabel, note }`（§9の文言契約）
- window系: `windowSize`、`buffer`（要素ID+ラベルの列）、`evictedLast`（直近evict要素。なければnull）
- scan / fold: `initialLabel`、`accumulatorLabel`、`history`（既存reduce contextの`history`様式: seq / inputLabel / beforeLabel / afterLabel）
- 共通: `emitted`（放出済み出力の列。各項目は合成ID or 継承ID＋ラベル＋窓の場合は`memberIds`）、`emittedCount`

v0.9 §6.3-6の復元契約（合成ID・メンバー参照・累積値のsnapshotからの完全復元・同一revision同一列）は、このcontextの内容だけで満たすこと（P7-D18）。フィールド名の細部は実装判断としてよいが、上記の情報がすべて載っていることを契約とします。

### 7.8 gather templateの取込対象外（確定。v0.9 §10-6の判断結果）

**gather DSLは手動連携の取込候補へ開放しません**（ユーザー決定。将来拡張として持越し）。Import Contract・Prompt Generator・Candidate Importの仕様は不変のまま、次の**2点のみ**を`src/application/importContract.ts`へ実装します。

1. `buildTemplateContract`のimportable導出（現行は`template.executable !== false`のみ）へ、**gatherノードを含むtemplateは`importable: false`**とする条件を追加し、`disabledReason`へ固定文言（「gatherを含むtemplateは手動連携の取込対象外です」の趣旨）を設定する。ノード構成（`operationId === 'gather'`）由来の導出とし、新規template属性は追加しない。
2. `slotSpecOf`（ParameterSlot kindのswitch）へ`case 'gatherer'`を追加し、**全拒否spec**を返す。全拒否specは既存`SpecNode`の`enum` variantで表現し、専用variantは追加しない: `{ node: 'enum', values: [], label: 'gatherer（取込対象外）' }`（許可値0件の列挙＝いかなる値も受理しない）。理由: 取込UIは選択中templateのContractを毎render構築するため、caseがないとspecが`undefined`のままContractへ入るruntime穴になる（`importable: false`で実際には取込へ到達しないが、防御として必須とする）。**gather DSLを受理するContract spec（許可値を持つspec）を追加してはならない**（それは取込開放になる）。

これにより既存機構（ImportPanelのdisabled＋理由表示・`generatePrompt`のガード・`CandidateImportService.import`の先頭ガード）がそのまま機能し、UI・Application両層で取込不能になります（P7-D21 / P7-A04 / P7-R05）。非gather templateのimportability・Contract内容・プロンプト文面が不変であることをテストで保証してください。

## 8. snapshot列の確定（v0.9 §6.2「全列の厳密な合成」）

### 8.1 発行位置の合成規則

1. **`GATHER_INITIALIZED`**: `buildTimeline`の実行開始ブロック（既存のCollectorコンテナ生成・identityありreduce初期化と同じ位置）で、source要素の送出前に発行する。各gatherノードにつき正確に1件（Phase 7は1 Pipeline 1ノード限定）。空ソースでも無条件発行（v0.9 §6.1・§6.2）。
2. **要素到着処理**: `processThroughChain`のoperationId分岐（distinct / sorted等と並ぶ位置）へgatherブロックを追加する。
   - windowFixed: `NODE_ARRIVAL`（PROCESSING）→ バッファ追加＋`WINDOW_BUFFER_UPDATED`（BUFFERED）。窓サイズ到達時: 窓SimValue合成・合成IDの登録と状態設定（§7.3の3）・メンバーの状態確定（§7.3の6）→ `GATHER_EMITTED`（currentElementId=合成ID）→ **その場で下流へ`processThroughChain`を再帰呼出し**（sorted flush・flatMap子のdepth-first前例）→ バッファ初期化 → `return false`（元要素はgatherで消費）。
   - windowSliding: バッファ満杯時は「最古evict＋末尾append」を**1回の`WINDOW_BUFFER_UPDATED`**とし、evict要素をcontextへ記録。窓成立ごとに`GATHER_EMITTED`→下流再帰。バッファは保持し`return false`。
   - scan: `NODE_ARRIVAL` → 累積値更新＋`SCAN_ACCUMULATED` → `GATHER_EMITTED`（同一elementId継承）→ 値を差し替えてループ継続（`continue`。map系と同じ合成で下流へ流す）。
   - fold: `NODE_ARRIVAL` → `FOLD_ACCUMULATED`（放出なし・PASSED）→ `return false`。
3. **finish cascade**: 現在sorted専用のfinish cascade（全source送出後にchain順で走査し確定順に下流へ流す構造）を、gatherノードにも対応するよう一般化する。gather分の発行は次のとおり。
   - windowFixed: 残余あり → `GATHER_FINISHED`（不完全窓の確定）→ `GATHER_EMITTED` → 下流再帰。残余なし → `GATHER_FINISHED`（「残余なし・追加放出なし」明示）のみ。空ソース → `GATHER_FINISHED`（放出0件明示）のみ。
   - windowSliding: 放出済みあり → `GATHER_FINISHED`（「追加放出なし」明示）のみ。0<バッファ<窓サイズ → `GATHER_FINISHED`（全要素の1窓確定）→ `GATHER_EMITTED` → 下流再帰。空ソース → `GATHER_FINISHED`（放出0件明示）のみ。
   - scan: 発行なし（v0.9 §6.1の統一規則）。
   - fold: 空ソース含め常に `GATHER_FINISHED`（最終値=累積値またはidentityの確定）→ `GATHER_EMITTED`（`<nodeId>-result`）→ 下流再帰。
   - **cascadeで新たに放出する合成要素**（windowFixedの残余窓・windowSlidingの1窓・foldの最終値）も、§7.3の3に従い`GATHER_EMITTED`発行前に`registerElement`と要素状態の設定を行ってから下流再帰へ渡す（未登録IDへの状態設定は既存engineが例外にするため）。
4. **下流終端との合成**: toListは既存どおり`SINK_APPENDED`のみ（NODE_ARRIVALなし）。findFirstは既存どおり`FIND_SELECTED`→（pendingShortCircuit経由で）`SHORT_CIRCUIT_CONFIRMED`。fold→findFirstでは上流は既に消費済みのため実際の評価打切りは発生しない（v0.9 §2.2の許容根拠と整合）。cascade終了後、既存の終端最終確定で`RESULT_CONFIRMED`→`STREAM_CONSUMED`。

### 8.2 11 fixture全ケースの確定snapshot列

以下のkind列を確定とします（`INITIAL`から`STREAM_CONSUMED`まで。( )は補足）。実装した列がこの表と一致することをP7-D08〜D15・D22で検証してください。

| # | template × mode | 確定列 | 計 |
|---|---|---|---|
| 1 | window-fixed × standard | `INITIAL` → `GATHER_INITIALIZED` → emp-001〜002: (`SOURCE_EMIT` → `NODE_ARRIVAL` → `WINDOW_BUFFER_UPDATED`)×2 → emp-003: `SOURCE_EMIT` → `NODE_ARRIVAL` → `WINDOW_BUFFER_UPDATED` → `GATHER_EMITTED`(win-1) → `SINK_APPENDED` → emp-004: `SOURCE_EMIT` → `NODE_ARRIVAL` → `WINDOW_BUFFER_UPDATED` → `GATHER_FINISHED`(不完全窓確定) → `GATHER_EMITTED`(win-2) → `SINK_APPENDED` → `RESULT_CONFIRMED` → `STREAM_CONSUMED` | 21 |
| 2 | window-fixed-exact × standard | `INITIAL` → `GATHER_INITIALIZED` → emp-001: ×3 → emp-002: ×3＋`GATHER_EMITTED`(win-1)＋`SINK_APPENDED` → emp-003: ×3 → emp-004: ×3＋`GATHER_EMITTED`(win-2)＋`SINK_APPENDED` → `GATHER_FINISHED`(残余なし・追加放出なし) → `RESULT_CONFIRMED` → `STREAM_CONSUMED` | 21 |
| 3 | window-fixed × emptySource | `INITIAL` → `GATHER_INITIALIZED` → `GATHER_FINISHED`(放出0件) → `RESULT_CONFIRMED` → `STREAM_CONSUMED` | 5 |
| 4 | window-sliding × standard | `INITIAL` → `GATHER_INITIALIZED` → of-001: ×3 → of-002: ×3＋`GATHER_EMITTED`(win-1)＋`SINK_APPENDED` → of-003: ×3(evict "Java")＋`GATHER_EMITTED`(win-2)＋`SINK_APPENDED` → of-004: ×3(evict "SQL")＋`GATHER_EMITTED`(win-3)＋`SINK_APPENDED` → `GATHER_FINISHED`(追加放出なし) → `RESULT_CONFIRMED` → `STREAM_CONSUMED` | 23 |
| 5 | window-sliding-short × standard | `INITIAL` → `GATHER_INITIALIZED` → of-001: ×3 → of-002: ×3 → `GATHER_FINISHED`(全要素の1窓確定) → `GATHER_EMITTED`(win-1) → `SINK_APPENDED` → `RESULT_CONFIRMED` → `STREAM_CONSUMED` | 13 |
| 6 | window-sliding × emptySource | #3と同列 | 5 |
| 7 | scan × standard | `INITIAL` → `GATHER_INITIALIZED` → numbers-001〜003: (`SOURCE_EMIT` → `NODE_ARRIVAL`(boxed) → `MAPPING_APPLIED` → `MAPPED_EMITTED` → `NODE_ARRIVAL`(gather) → `SCAN_ACCUMULATED` → `GATHER_EMITTED` → `SINK_APPENDED`)×3 → `RESULT_CONFIRMED` → `STREAM_CONSUMED`（`GATHER_FINISHED`なし） | 28 |
| 8 | scan × emptySource | `INITIAL` → `GATHER_INITIALIZED`(初期値生成のみ実演) → `RESULT_CONFIRMED` → `STREAM_CONSUMED` | 4 |
| 9 | scan-concat × standard | `INITIAL` → `GATHER_INITIALIZED` → of-001〜003: (`SOURCE_EMIT` → `NODE_ARRIVAL` → `SCAN_ACCUMULATED` → `GATHER_EMITTED` → `SINK_APPENDED`)×3 → `RESULT_CONFIRMED` → `STREAM_CONSUMED` | 19 |
| 10 | fold × standard | `INITIAL` → `GATHER_INITIALIZED` → emp-001〜004: (`SOURCE_EMIT` → `NODE_ARRIVAL` → `FOLD_ACCUMULATED`)×4 → `GATHER_FINISHED`(最終値確定) → `GATHER_EMITTED`(result) → `FIND_SELECTED` → `SHORT_CIRCUIT_CONFIRMED` → `RESULT_CONFIRMED` → `STREAM_CONSUMED` | 20 |
| 11 | fold × emptySource | `INITIAL` → `GATHER_INITIALIZED` → `GATHER_FINISHED`(identityを最終値として確定) → `GATHER_EMITTED`(result) → `FIND_SELECTED` → `SHORT_CIRCUIT_CONFIRMED` → `RESULT_CONFIRMED` → `STREAM_CONSUMED` | 8 |

- 表の要素表記「×3」は各要素の`SOURCE_EMIT` → `NODE_ARRIVAL` → 状態更新kind（`WINDOW_BUFFER_UPDATED`等）の3件を指す。
- #10 / #11の`SHORT_CIRCUIT_CONFIRMED`は、既存findFirstの発行規則（`FIND_SELECTED`後のpendingShortCircuitを`confirmPendingShortCircuits`が確定する）に従う前提で確定している。実装時に既存機構の発行条件がこの列と一致しない場合は、**列を勝手に変えず停止して報告**すること（§17）。
- 期待結果値: #1 `[[佐藤,鈴木,高橋], [田中]]`、#2 `[[佐藤,鈴木], [高橋,田中]]`、#4 `[[Java,SQL], [SQL,Git], [Git,AWS]]`、#5 `[[Java,SQL]]`、#7 `List<Integer> [3, 4, 8]`、#9 `["Java", "JavaSQL", "JavaSQLGit"]`、#10 `Optional[21_700_000L]`、#11 `Optional[0L]`、空window系 `[]`、#8 `[]`。
- **表記の注記**: 本表およびP7-E01〜E03で参照する期待結果は**意味上の省略表記**であり、UI・snapshot labelの厳密期待値は`formatSimValue`の再帰整形（§7.2）に従う（Employee要素は`佐藤（age=35）`等の既存要素ラベル、String要素は`"Java"`等のクォート付き表記）。テストの厳密なassertionは実装後の`formatSimValue`出力を正とする。

### 8.3 復元契約

- gather専用context（§7.7）の内容はすべてsnapshotから完全復元でき、任意cursorへの移動（戻る→進む）で全フィールドが一致すること（P7-D18）。
- 同一revisionの再実行で同一のID列・snapshot列を生成すること（決定性。P7-D16）。

## 9. UI要件

- Gatherer構造パネル（`GathererStructurePanel.tsx`）に**initializer / integrator / combiner / finisherの4行を常設**する（v0.9 §5）。
  - combiner行: 「逐次実行のため呼出し0回。並列実行時に2つの中間状態を結合する役割」の意味論のみ表示。
  - scanのfinisher行: 「終端での追加産出なし」の意味論表示とし、「finisherが無い」というJDK実装同一性の断定はしない。
  - 各行の文言は「教材モデル上の割当て」であり、JDK内部実装の構成を断定しない（v0.9 §4末尾。Oracle観測結果〔§12.5〕を反映する場合は「JDK <vendor/version>での観測」と明示する）。
- window系: バッファ内容・evict要素・窓メンバー（memberIds由来）・窓のunmodifiable性の注記（v0.9 §3.2引用）を表示する。
- scan / fold: 初期値・累積履歴（既存reduce表示の様式）・foldの「放出なし累積」とscanの「逐次放出」の区別を表示する。foldとreduce、scanとreduceの対比の補助説明を含める（v0.9 §5）。
- 型遷移: `Stream<Employee> → Stream<List<Employee>>`等をTypeRefで表示し、window系で要素型がListになることを強調する。
- mapConcurrentの存在と実行対象外の理由の補助説明を表示する（配置は実装判断。`UNIMPLEMENTED_OPERATIONS`（「実装予定」表示の機構）は使わない）。
- 表示はsnapshot（専用context）のみから導出し、UIで結果・型・蓄積状態・表示順を独自計算しない（既存原則）。
- キーボード操作・focus-visible・reduced motion・狭幅縦積み等の既存a11y / responsive要件（v0.8 §17.5）をgatherパネルにも適用する（P7-R06）。

## 10. 総点検・回帰

- 全実行可能template（116件）×`supportedModes`の全組合せ（222組合せ）で、終端到達・snapshot予算内・Javaコード生成を機械検証する既存の総点検テスト（P6-D22の常設化分）が、gather template追加後も全件成功すること。
- 既存P1〜P6の全テストID（Vitest 515件・Playwright 72件・Oracle 6 suiteに対応）が、§12冒頭の許可範囲を除き変更なく成功すること。
- 視覚回帰基準画像（既存27枚）は**原則据え置き**とする。gather操作の追加は既存テンプレートの表示に影響しない見込みだが、差分が出た場合はdiff画像で差分領域を確認した上での意図的更新のみ許可し（threshold緩和なし）、理由を完了報告へ記録する。Phase 7の基準画像（`e2e/phase7.spec.ts`・`p7-narrow.spec.ts`配下）は新設する。

## 11. Phase 7で実装しないもの

次は実装しないでください。

- `Gatherers.mapConcurrent`の実行（補助説明のみ）
- カスタムGathererの自由記述・任意コード実行・`eval` / `Function`の使用
- short-circuitするGathererの実行（説明のみ）
- `Gatherer.andThen`、複数gatherノードの連結、gatherノード下流の短絡合成（`fold → findFirst`を除く）
- **gather DSLの手動連携取込への開放**（§7.8。取込UI・プロンプト生成のgather対応、**gather DSLを受理するContract spec**の追加。§7.8の全拒否spec・importable導出の2点は開放ではなく取込対象外化のための必須実装）
- Terminal DSL・Collector DSLへのfield / kind追加、既存ホワイトリストの変更
- primitive特化Stream版gather（JDKに存在しない）
- 取込候補の保存・再利用、任意Pipelineビルダー、ノード編集UI（従来からの継続禁止事項）
- 本番デプロイ構成、依存ライブラリの不要な更新

## 12. 必須テストID

以下の`P7-*`（39 ID: D22 / A4 / R6 / E5 / O2）をすべて実装し、テスト名へIDを含めて追跡可能にしてください。レビュー等でIDを追加する場合は、各系列の末尾連番で採番してください。

**既存テストの意図的更新（これ以外の既存P1〜P6テストIDの削除・緩和・skipは禁止）**:

| 現行対象 | 更新内容 |
|---|---|
| `tests/domain/p6-contract.test.ts`（P6-D01〜P6-D03） | 走査対象を「**取込対象の実行可能template（＝gatherノードを含まない実行可能template）**」へ限定する最小更新のみ許可。gather templateは`importable: false`（§7.8）のため、現行の「全実行可能templateで`importable === true`」（P6-D01）・「全実行可能fixtureのContract受理」（P6-D02）・「全slotにContract specと既存構造validatorがある」（P6-D03）はgather追加後に必ず失敗する。限定後も**既存の非gather実行可能template全件**に対する検証意味（importable・fixture受理・Contract整合）を保存すること。gather templateの拒否検証はP7-D21が担う |
| `tests/application/p6-session.test.ts`（P6-A03） | 同様に「プロンプト出力例の全実行可能template×mode往復」の走査対象を取込対象templateへ限定する最小更新のみ許可。実行不能template（`tmpl-src-generate` / `tmpl-src-iterate2`）の検証は不変 |
| `tests/p6-helpers.ts` | 上記の限定に必要な場合に限り、「取込対象template」を導出するヘルパの追加を許可（`EXECUTABLE_TEMPLATES`の意味・値は変えない） |
| `tests/domain/p6-review.test.ts` | Phase 6時点のOracle suite構成を**fixtureとして固定**する形へのリファクタリングのみ許可（P4-O02 / P5-O02の前例。検証意味の保存）。ライブ構成の検証は新規`tests/domain/p7-review.test.ts`（P7-O02）が担う |
| `e2e/capture-helper.ts` | `CAPTURE_TARGET_PHASE`を`6`→`7`（この1か所のみ。過去Phaseのcapture specは変更しない） |
| 視覚回帰基準画像（`e2e/__screenshots__/`） | 原則据え置き。差分発生時のみdiff確認つき意図的更新（§10） |

**P6-D22（`tests/domain/p6-fullcheck.test.ts`）の全実行可能template総点検からgather templateを除外してはいけません**（importabilityに依存しない実行総点検であり、gather templateも通過対象。§10の116件×222組合せと一致させる）。

上記のほか、template / 操作の追加に伴い**件数前提・一覧前提が壊れる既存assertion**（例: 操作数・template数を数える不変条件テスト）が見つかった場合は、検証意味を変えない最小の更新に限り許可し、1件ずつ理由を完了報告へ記載してください。判断に迷う場合は停止して報告してください。

### 12.1 DSL・engine契約テスト（P7-D）

Vitest（`tests/domain`配下）。

| ID | 対象 | 必須検証 |
|---|---|---|
| P7-D01 | Gatherer DSL構造検証 | 4 kindのclosed schema受理。未知kind・許可外キー・必須キー欠落・非objectの拒否（`STRUCTURE_UNKNOWN_KIND` / `STRUCTURE_INVALID`） |
| P7-D02 | windowSize境界 | 1 / 16の受理、0以下の拒否（`STRUCTURE_INVALID`）、17の拒否（`GATHER_SIZE_LIMIT`）、非整数・非有限値の拒否 |
| P7-D03 | AccumulationRule whitelist | 3 kind受理、未知kind・未知field（`name`等）の拒否、**`REDUCTION_FIELD_WHITELIST`が`['salary', 'age']`のまま不変**であること（import参照＋値検証） |
| P7-D04 | identity検証 | 4 typeの受理・null拒否・int32 / safe integer範囲。既存`validateReductionIdentity`と同一の受理範囲で、Terminal DSL側が無変更であること |
| P7-D05 | 型適合表 | v0.9 §8.3全行（stringConcat×String / numericSum×Integer・Long・Double / employeeFieldSum×Employee＋initial.typeの対応）。不適合の`TYPE_MISMATCH`、primitive Stream直結の拒否（boxed経由の誘導メッセージ） |
| P7-D06 | 型遷移 | window系`Stream<T> → Stream<List<T>>`（collection合成TypeRef）、scan / foldの`Stream<T> → Stream<boxed R>`、resultType（`List<List<Employee>>` / `Optional<Long>`等）の導出 |
| P7-D07 | SimValue合成値 | `list` variantの`formatSimValue` / `typeOfSimValue`、**既存`stringList`の表示・型の不変**、deepFreeze / structuredClone可能性、SimValue網羅switch棚卸し箇所の到達不能時`EngineInvariantError` |
| P7-D08 | GATHER_INITIALIZED | 全template×全modeで正確に1件、source要素送出前（空ソースでは終端処理前）の位置 |
| P7-D09 | windowFixed標準列 | §8.2 #1との完全一致（kind列・currentElementId・窓成立時の`GATHER_EMITTED`→`SINK_APPENDED`順序・残余flush） |
| P7-D10 | windowFixed倍数 | §8.2 #2との完全一致。`GATHER_FINISHED`後に`GATHER_EMITTED`が存在しないこと・「残余なし」のcontext明示 |
| P7-D11 | windowFixed空ソース | §8.2 #3との完全一致・放出0件のcontext明示 |
| P7-D12 | windowSliding標準 | §8.2 #4との完全一致。evict+appendが1回の`WINDOW_BUFFER_UPDATED`でevict要素がcontextに載ること |
| P7-D13 | windowSliding入力<窓・空 | §8.2 #5 / #6との完全一致。全要素1窓のメンバー構成 |
| P7-D14 | scan | §8.2 #7 / #8との完全一致。`SCAN_ACCUMULATED`と`GATHER_EMITTED`の分離、出力IDの継承（入力と同一elementId）、`GATHER_FINISHED`不発行 |
| P7-D15 | fold | §8.2 #10 / #11との完全一致。`FOLD_ACCUMULATED`が放出を伴わないこと、空ソースの`Optional[identity]` |
| P7-D16 | 合成ID契約 | `node-gather-win-N`の生成順採番・`node-gather-result`、`memberIds`が入力ElementId列と一致、Pipeline全体でのID一意性、同一revision再実行の決定性 |
| P7-D17 | 要素状態遷移 | §7.3の6のとおり（BUFFERED→最初の窓放出でPASSED、sliding放出後のlatest維持、scan=map系、fold=reduce系、REJECTED不発生） |
| P7-D18 | 復元契約 | 任意cursorのsnapshotからgather contextの全フィールド（バッファ・evict・累積値・emitted・memberIds）が復元でき、戻る→進むで一致 |
| P7-D19 | Javaコード表示 | 7 templateの`.gather(Gatherers.…)`式が構文的に正当で実データ・評価結果と一致。既存fixture（非gather）のJavaコード出力が改修前後で不変 |
| P7-D20 | catalog / template不変条件 | `gather`登録（category intermediate・traits INTERMEDIATE+STATEFUL・46操作目）、既存45操作の定義不変、template総数118 / 実行可能116、全template×modeのfixture存在、gather全ケースのsnapshotCount実測が予算内（§8.2の計と一致） |
| P7-D21 | 取込対象外 | gather 7 templateの`importable: false`＋理由文言、gatherer slotの全拒否specが**正規4 kind（正しいGatherer DSL値）を含む任意値をすべて拒否**すること、**非gather templateのimportability・Contract内容・プロンプト文面の不変**、gather template選択中の取込系操作が`buildScenario`へ到達しないこと |
| P7-D22 | scan×stringConcat実行契約 | §8.2 #9との完全一致。string累積のboxed変換契約（string→string）・空文字initialの表示・出力IDの継承 |

### 12.2 Applicationテスト（P7-A）

| ID | 対象 | 必須検証 |
|---|---|---|
| P7-A01 | シナリオ切替 | gather templateの選択がシナリオ切替意味論（タイマー停止・新revision `${templateId}:${mode}:r${counter}`・history初期化・READY）で成立する |
| P7-A02 | 再生・復元 | 全7 template×全modeで初期snapshotから終端まで到達し、cursor移動の完全復元・snapshotCount一致 |
| P7-A03 | 既存経路回帰 | 操作一覧へ`gather`が中間categoryで追加され、既存操作・既存templateのfixture経路の挙動が不変 |
| P7-A04 | 取込Result経路 | gather template選択中の取込系操作（プロンプト生成・取込）がthrowせず失敗理由を返し、シナリオ・履歴・再生状態が不変 |

### 12.3 React統合テスト（P7-R）

| ID | 対象 | 必須検証 |
|---|---|---|
| P7-R01 | Gatherer構造パネル | 4行常設、combiner「呼出し0回」意味論、scanのfinisher「終端での追加産出なし」意味論、JDK実装同一性を断定しない文言 |
| P7-R02 | window表示 | バッファ内容・evict要素・窓メンバー・unmodifiable注記・型遷移表示 |
| P7-R03 | scan / fold累積表示 | 初期値・累積履歴・foldの放出なし累積とscanの逐次放出の区別表示 |
| P7-R04 | 操作選択・補助説明 | 「中間」optgroupへの`gather`追加、既存optgroup構成の不変、mapConcurrent対象外の補助説明表示 |
| P7-R05 | 取込UI無効化 | gather template選択中はコピー・貼付の両方が無効化され理由が表示される（P6-R05様式）。非gather templateへ戻すと復帰する |
| P7-R06 | a11y・responsive | gatherパネルを含むキーボード操作・focus-visible・reduced motion・狭幅縦積み |

### 12.4 E2E・視覚テスト（P7-E）

| ID | 対象 | 必須検証 |
|---|---|---|
| P7-E01 | windowFixed E2E | standard実行で`[[佐藤,鈴木,高橋], [田中]]`へ到達し、残余flushの表示と履歴復元を確認する |
| P7-E02 | scan / fold E2E | scanの逐次出力`[3, 4, 8]`、foldの`Optional[21_700_000L]`、空ソースの`GATHER_INITIALIZED`表示を確認する |
| P7-E03 | windowSliding E2E | evict表示と、入力<窓サイズの1窓flushを確認する |
| P7-E04 | 総点検回帰 | 既存E2E全件が成功し、全gather template×modeの到達チェックリスト（§10）と対応する |
| P7-E05 | 狭幅・視覚回帰 | gatherパネルを含むPC幅 / 狭幅表示・横スクロール・sticky非遮蔽を確認し、P7基準画像を新設する。既存基準画像に差分が出た場合はdiff確認の上でのみ意図的更新（threshold緩和なし） |

### 12.5 JDK 25 Oracle Test（P7-O）

| ID | 対象 | 必須検証 |
|---|---|---|
| P7-O01 | Gatherer実行のJDK 25照合 | §8.2の11ケース（7 standard＋4 emptySource）の実行結果を、Simulation Coreと固定Java 25コードでJSON文字列厳密照合する。**v0.9 §7の空入力表4行を全て含み、「導出」区分2件（scan空・fold空）で導出と実測が食い違った場合は停止して報告する**。あわせて**OBSERVATION観測**: 組み込み4種それぞれの`integrator() instanceof Gatherer.Integrator.Greedy` / `combiner() == Gatherer.defaultCombiner()` / `finisher() == Gatherer.defaultFinisher()`の計12行を`OBSERVATION:`接頭辞で出力する（既存機構により厳密比較外・観測記録としてoracle-result.mdへ保存される。v0.9 §10-3） |
| P7-O02 | Oracle運用検証 | 必須suite（P1-O01〜P7-O01の7件）が各1件存在し、証跡書込みが現行Phase（`artifacts/phase-7/oracle-result.md`）のみで、実行前後に`artifacts/phase-1`〜`phase-6`のSHA-256が不変である |

Oracleランナーは既存構成（Docker + `gradle:9.6.1-jdk25`）を踏襲し、次を必ず更新してください。

- `oracle/oracle-lib.mjs`: `SUITES`へ`P7-O01`（`oracle/OracleP7.java` / `oracle/expected-p7-from-core.json`、`writeReportPath: ['artifacts', 'phase-7', 'oracle-result.md']`）を追加。`P6-O01`の`writeReportPath`をnull化（`artifacts/phase-6/oracle-result.md`は過去証跡として保持・上書きしない。照合自体は回帰として継続）。`REQUIRED_SUITE_IDS`へ`P7-O01`追加。`CURRENT_PHASE_SUITE_ID` / `CURRENT_PHASE_REPORT_PATH`をP7へ更新。`PAST_ARTIFACT_DIRS`へ`artifacts/phase-6`追加。`p6-review.test.ts`のfixture固定化に必要なPhase 6時点構成の定数化。`P7_MATCH_NOTES`（照合方式注記）の追加。
- `oracle/run-oracle.mjs`: コメント・出力ラベル・「関連する機械検証」のテストファイルパス等、`P6` / Phase 6表記のハードコード箇所を現行Phaseへ更新。
- 数値の照合は既存のJSON文字列厳密照合を維持する。long値の表記（`21_700_000L`等）はPhase 5〜6で確立したCore表記との整合方式を踏襲し、境界・表記の選定判断を`docs/phase-7-decisions.md`へ記録する。

## 13. 検証手順

現在の`package.json`に合わせ、少なくとも次を実行してください（`test`という名前のscriptは存在しません）。

```bash
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run test:e2e
npm run test:oracle
```

必要に応じて対象テストを先に実行して構いませんが、完了判定前には全件を再実行してください。

追加で次を確認してください。

1. 既存P1〜P6テストIDが、§12冒頭で許可した意図的更新を除きすべて成功する。
2. P7必須テストID（39 ID）がすべて実装され成功する。
3. grep確認: `terminalAst.ts`の`REDUCTION_FIELD_WHITELIST`と`ReductionDsl`が無変更（`git diff`で確認）、`eval` / `new Function` / 動的コード生成が追加コードに存在しない、`importContract.ts`の変更が§7.8の2点に限られる。
4. §8.2の11ケースすべてで、実測snapshot列が確定列と一致する（P7-D08〜D15・D22の成功で判定）。
5. gather template選択時のUI（構造パネル・取込無効化・補助説明）をPC幅・狭幅で目視確認する。
6. §10の総点検（116 template×222組合せ）が成功している。
7. 視覚回帰の期待画像の更新がすべて意図的（diff確認済み）である。
8. E2E・Oracleの書込み対象が`artifacts/phase-7`のみで、`artifacts/phase-1`〜`phase-6`が変更されない。
9. `git diff --check`、`git diff --stat`、`git status --short`で変更範囲を確認する。

テスト失敗をskip、期待値緩和、テスト削除、過度なmock、基準画像の無条件更新で隠さないでください。環境制約で未実行のテストがある場合は成功扱いせず、原因、試行内容、残作業、再実行コマンドを明記してください。

## 14. 成果物

既存規約を維持し、次を作成・更新してください。

- `docs/phase-7-decisions.md`（新規）
  - 記録対象: 累積評価を`evaluateReduction.ts`と独立実装した判断（§7.4）、`stringList` / `list`並存の役割分担（§7.2）、midEmpty非対応とgather教材制約を追加しない判断（§7.6）、`tmpl-gather-scan-concat`追加の判断（§7.6）、取込対象外の実装方式（§7.8）、Javaコード表記の細部（§7.4の6）、legend絞り込み（§7.5）、Oracle照合の表記整合の選定判断（§12.5）、OBSERVATION観測結果と表示文言への反映内容（§9）、視覚回帰更新の有無と理由（§10）、その他仕様本文を変更しない範囲の実装判断。
- `docs/phase-7-completion-report.md`
- `artifacts/phase-7/`
  - PC幅 / 狭幅キャプチャ（gather 4種の代表snapshot・空ソースの`GATHER_INITIALIZED`表示・取込UI無効化状態を含む）
  - Oracle結果（`oracle-result.md`）
- `e2e/__screenshots__/`配下のPhase 7視覚回帰基準画像（新設）
- `e2e/capture-helper.ts`の`CAPTURE_TARGET_PHASE`を`7`へ変更（この1か所のみ）
- `README.md` — Phase 7完了時のみ更新: 実装済み操作へgather / Gatherers 4種を追加、テスト結果の見出しと表をPhase 7最終の実測値へ、必須テストID実績へP7を追加、`test:oracle`説明（suite一覧・書込み先・SHA-256対象）の更新、総点検の件数（116件×222組合せ）更新、ドキュメント一覧へ本指示書と`docs/phase-7-*.md`を追加、`artifacts/phase-7/`を成果物一覧へ追加、ブランチ構成へ`phase-7`を追記。

`docs/phase-1〜6-completion-report.md`、`docs/phase-1〜6-decisions.md`、`artifacts/phase-1`〜`phase-6`は過去の記録として保持し、書き換えないでください。

## 15. Phase 7完了条件

次をすべて満たした場合だけ「Phase 7完了」と判定してください。

- v0.9 §9の完了条件（Gatherer構造表示・状態遷移・§6.2のsnapshot列・§6.3のID契約・§7の空入力・型遷移がJDK 25実測との回帰照合を含めて成立し、既存P1〜P6テストが全件成功）を満たす。
- v0.9 §2.1の5メソッドがOperationCatalog→DSL→instantiate→Step Engine→template / fixture→UI→テスト→Oracleまで縦断実装されている。
- 本指示§7の確定値（SnapshotKind 6値・SimValue `list`・ID規則・DSL契約・`GATHER_SIZE_LIMIT`・template 7形 / fixture 11件・GatherContextView・取込対象外2点）がすべて実装されている。
- §8.2の11ケースの実測snapshot列が確定列と一致する。
- P7必須39 テストIDがすべて実装・成功し、既存P1〜P6テストIDが§12冒頭の許可範囲を除き変更なく成功する。
- lint、型検査、production buildが成功する。
- Playwright E2E、視覚回帰、PC / 狭幅確認、§10の総点検が完了する。
- P7-O01・P7-O02がJDK 25で成功し（OBSERVATION 12行の記録を含む）、`artifacts/phase-1`〜`phase-6`が不変である。
- Terminal DSL・Collector DSL・Import Contract仕様（§7.8の2点を除く）・fixture経路が不変である。
- mapConcurrent実行・カスタムGatherer・gather取込開放を実装していない。
- ユーザーの既存変更を破棄していない。

1項目でも満たせない場合は「Phase 7未完了」とし、残作業、影響、再現手順を具体的に報告してください。

## 16. 完了報告の必須項目

`docs/phase-7-completion-report.md`とチャット報告へ、次を必ず含めてください。

1. Phase 7の完了 / 未完了判定
2. 基準コミット（§3.1）と作業ブランチ
3. 実装したGatherer縦断構成の設計概要（DSL・runtime・context・UIパネル）
4. SimValue `list` variant追加に伴う網羅switch棚卸し一覧（§5.2）
5. §8.2の11ケースの実測snapshot列と確定列の一致確認結果
6. 主な変更ファイルとアーキテクチャ上の役割
7. 実行した全コマンドと終了結果
8. テスト種別ごとの総数、成功、失敗、skip、未実行
9. P7必須39 IDを1件ずつ記載した対応表（v0.9 §9・§10の観点との対応を含む）
10. 既存P1〜P6必須IDの回帰結果と、§12冒頭で許可した意図的更新の一覧・理由
11. P7-O01 / P7-O02のJDKベンダー / バージョン、11ケースの照合結果、OBSERVATION 12行の観測結果と表示文言への反映内容
12. §10の総点検（116 template×222組合せ）の結果
13. 視覚回帰基準画像の新設一覧と、既存画像を更新した場合はdiff確認結果・理由
14. PC幅 / 狭幅キャプチャの保存先
15. 仕様との差異と実装判断（`docs/phase-7-decisions.md`への参照を含む）
16. 既知の問題と持越し事項（gather DSL取込開放の持越しを含む）
17. 最終`git diff --stat`と`git status --short`、およびcommit、push、PRを行っていないことの確認
18. v0.9 §10の判断事項7件それぞれの結論（本指示で確定済みの項目は実装との差異が生じた場合のみ記録）

「全テスト成功」「仕様準拠」だけで済ませず、コマンド、件数、ID、成果物パスを根拠として記載してください。

## 17. 停止条件

次の場合は推測で進めず、変更前または問題判明時点で停止して報告してください。

- v0.9と本指示、またはv0.8（v0.9 §1.1適用後）とv0.9に、実装結果を変える矛盾がある。
- **v0.9 §7の「導出」区分（scan空・fold空）で、導出と実測が食い違った**（P7-O01）。
- §8.2の確定snapshot列を、既存engineの発行機構（findFirstのpendingShortCircuit等）と両立させられない（列を勝手に変えない）。
- 基準コミットが現在の`phase-7`の祖先でない。
- worktreeに§3.2の例外以外の未確認ユーザー変更がある。
- Phase 1〜6回帰テストが変更前から失敗する。
- SnapshotKind・SimValue・TypeRef・`instantiateTemplate`・Terminal DSL・Collector DSL・Import Contract（§7.8の2点を除く）の破壊的変更が必要になる。
- §12冒頭の許可範囲を超える既存テスト書き換えが必要になる。
- 仕様にない依存追加、サーバー、AI接続、任意コード実行が必要になる。

## 18. 最終禁止事項

- v0.8・v0.9・v0.10の各仕様書と統合docxを変更しない。
- Phase 1〜6の完了報告・判断記録・証跡（`artifacts/phase-1`〜`phase-6`）を書き換えない。
- gather DSLを取込対象にしない。手動連携の仕様を変更しない。
- `Gatherers.mapConcurrent`を実行しない。カスタムGatherer・任意コードを実行しない。`eval`・`Function`を使用しない。
- Terminal DSL・Collector DSLのホワイトリスト・許可範囲を変更しない。
- 検証を通らないDSL・templateをStep Engineへ渡さない。
- UIで結果、型、蓄積状態、表示順を独自計算しない。
- JDK内部実装の構成（組み込みGathererのGreedy / combiner / finisher実装）を、Oracle観測の裏付けなく断定表示しない。観測結果を表示へ反映する場合は観測である旨を明示する。
- 失敗、skip、未実行、仕様差異を隠さない。
- ユーザーの変更を削除、stash、reset、checkoutで破棄しない。
- 別途指示なしにcommit、push、PR、mergeを行わない。

Phase 7の実装、検証、証跡作成、完了報告まで実行してください。

---

## 使用方法

1. ローカルPCで対象リポジトリを最新化し、`phase-7`ブランチへ切り替えます。
2. プロジェクトルートでClaude Codeを起動します。
3. この文書の「Java Stream API 可視化シミュレーター Phase 7実装指示」以降を渡します。
4. Claude Codeの完了報告後、コード、テスト、キャプチャ、`docs/phase-7-completion-report.md`をレビューします。
