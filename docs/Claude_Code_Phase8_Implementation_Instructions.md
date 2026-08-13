# ローカルClaude Code向け Phase 8実装指示

以下を、そのまま対象リポジトリのプロジェクトルートで起動したClaude Codeへ渡してください。

---

# Java Stream API 可視化シミュレーター Phase 8実装指示

## 1. 実装開始の宣言

Draft v0.8に基づくPhase 1〜5、v0.10に基づくPhase 6、v0.9に基づくPhase 7は、GitHubの`main`へマージ済みです。Phase 8（Collectors.toMap）の仕様は`docs/Java_Stream_API_Visualization_Spec_v0.11_toMap.md`（第7版ドラフト。codexレビュー4回・承認済み）で確定済みです。

**本指示をもってPhase 8の実装開始を明示的に許可します。**

Phase 8の実装、テスト、画面確認、JDK 25 Oracle照合、総点検、証跡作成、完了報告まで行ってください。`toConcurrentMap`・`toUnmodifiableMap`の実行・数値加算merge・key側identityの実行・toMapの手動連携取込開放・Phase 9以降の機能は実装しないでください。

## 2. 唯一の仕様基準と優先順位

実装判断の優先順位は次のとおりです。

1. `docs/Java_Stream_API_Visualization_Spec_v0.11_toMap.md`（以下「v0.11」。**toMap固有規定の最上位基準**）
2. `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`（v0.11 §1.1の優先順位を適用した上で、一般原則・不変条件・検証順序・UI原則の正。v0.9・v0.10の各差分規定も従来どおり有効）
3. 本Phase 8実装指示（上記を実装可能な粒度へ具体化する。v0.11が「Phase 8実装指示書で確定する」「Phase 8中に判断する」と委譲した事項〔v0.11 §10の8件〕は本指示§7・§8の確定値を正とする）
4. `docs/phase-5-decisions.md`（Collector基盤の既存判断）・`docs/phase-7-decisions.md` / `docs/phase-7-completion-report.md`
5. 現在の`main`上の実装・テスト・README

v0.11と本指示が矛盾する場合はv0.11を正とし、コードを変更する前に矛盾箇所を報告して停止してください。v0.8・v0.9・v0.10・v0.11の各仕様書と統合docx（`docs/Java_Stream_API_Visualization_Spec_v0.10.docx`）は編集しないでください（統合docxのv0.11対応は§14の`tools/build_spec_docx.py`更新で行う）。本指示で定義する`P8-*`はPhase 8の追跡用テストIDであり、仕様書本文へテストIDを追記するものではありません。

## 3. Gitと作業開始前の確認

### 3.1 基準コミット

- Phase 7完了・運用ファイル整理済みの`main`: `4575628`（PR #9のmerge commit）

### 3.2 作業ブランチ

Phase 8の作業ブランチ`phase-8`は既に存在し、v0.11仕様書のコミット（初稿+レビュー反映4件、承認時点=`e8f03a2`）を含みます。作業前に次を確認してください。

```bash
git fetch origin
git switch phase-8
git merge-base --is-ancestor 4575628 HEAD
git status --short
```

- `phase-8`のHEADが基準コミットの子孫であること。
- worktreeがcleanであること。ただし次の未追跡ファイルは運用ファイルであり、未コミットのまま存在してよい（停止条件に該当しない）: 本指示書ファイル自身（未コミットの場合）、codexレビュー依頼文（`docs/codex_review_request_*.md`）、実装開始依頼文（`docs/*_start_request.md`）。
- `docs/Java_Stream_API_Visualization_Spec_v0.11_toMap.md`が存在し、§1の版管理に「第4回で承認」と記載されていること。

上記以外の未追跡・未コミットのユーザー変更がある場合は、stash、削除、上書きをせず停止して報告してください。**本指示だけを根拠にcommit、push、Pull Request作成、mainへのmergeは行わないでください。**

### 3.3 Phase 1〜7回帰基準

変更前に少なくとも次を実行し、基準結果を記録してください。

```bash
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

実行可能な環境では、変更前の`npm run test:e2e`と`npm run test:oracle`も実行してください。ただし、**この2つを現状コードのまま作業worktreeで実行してはいけません**。追跡済みのPhase 7証跡を書き換えるためです（`e2e/capture-helper.ts`の`CAPTURE_TARGET_PHASE = 7`が`artifacts/phase-7/*.png`を上書きし、P7-O01 suiteの`writeReportPath`が`artifacts/phase-7/oracle-result.md`を更新する）。Phase 5〜7の前例に従い、**基準コミットの一時git worktreeをプロジェクトディレクトリの外へ作成し、そこで変更前のE2E・Oracle基準を取得**してください。

```bash
git worktree add <プロジェクト外の一時パス> 4575628
# 一時worktree内で npm ci を実行し、変更前の test:e2e / test:oracle の結果を記録する
git worktree remove --force <プロジェクト外の一時パス>
```

作業worktreeの`artifacts/phase-1`〜`phase-7`には一切書き込まないでください。作業worktreeで`npm run test:e2e` / `npm run test:oracle`を初めて実行する前に、必ず`CAPTURE_TARGET_PHASE = 8`への変更（§14）とOracle書込み先の変更（§12.5: P8-O01追加・P7-O01の`writeReportPath` null化）を先に済ませてください。

Phase 7完了時点の基準値は、Vitest 651件（59ファイル）、Playwright 81件、Oracle 7 suite（P1-O01〜P7-O01）全成功です。変更前から失敗がある場合はPhase 8実装で隠さず、原因と再現手順を報告して停止してください。

## 4. Phase 8の目的と完了範囲

v0.11 §9に従い、Phase 1〜7で成立した経路（FixtureScenarioProvider → template → 検証済みDSL / TypeRef → PipelineDefinition → Step Engine / Snapshot History → React UI）を壊さず、`Collectors.toMap`を縦断実装します。

Phase 8の目的は、v0.11 §4の教材目標7点の実現です。特に次の2点が中核です。

1. **groupingBy（1キー多値）との対比**: toMapは1キー1値であり、衝突は「mergeFunctionで解決」か「`IllegalStateException`」になる。
2. **本シミュレーター初の「正常完了しないPipeline」**: 2引数版の重複キーを、validationで隠さず実行で体験させる。TypeScript例外は投げず、Step Engineが実行失敗を正規のsnapshot列（`COLLECT_FAILED`終端）として生成する（v0.11 §6.2）。

実装範囲は、v0.11 §2.1の3 overloadをCollector AST・validate・Collector Runtime・Step Engine・セッション状態・template / fixture・UI・テスト・Oracleまで縦断することです。**新しいoperationIdは追加しません**（既存`collect` operationのCollector AST kindとして扱う。v0.11 §9）。完了条件は§15で判定します。

## 5. Phase 8で実装するもの

### 5.1 新設ファイル

| ファイル | 責務 |
|---|---|
| `src/domain/fixtures/mergeDemoEmployees.ts` | merge実演用の補助Employeeデータセット5件（§7.6。関東3件で3件以上衝突を実演） |
| `src/domain/template/templatesP8.ts` | Phase 8 template 8件（§7.6。toMap 7件＋同一データgroupingBy比較1件）。`templates.ts`の`ALL_TEMPLATES`へ集約（`templatesP5.ts` / `templatesP7.ts`の分離前例） |
| `oracle/OracleP8.java` / `oracle/expected-p8-from-core.json` | P8-O01（§12.5） |
| `tests/p8-oracle-expected.ts` / `tests/domain/p8-oracleSync.test.ts` | Oracle期待値のCore同期保証（P2〜P7前例） |
| `tests/domain/p8-*.test.ts` / `tests/application/p8-session.test.ts` / `tests/react/p8-app.test.tsx` | P8-D / P8-A / P8-R（§12） |
| `tests/domain/p8-review.test.ts` | P8-O02のライブ構成検証（§12.5） |
| `e2e/phase8.spec.ts` / `e2e/p8-narrow.spec.ts` / `e2e/p8-capture.spec.ts` | P8-E（§12.4）とPhase 8証跡キャプチャ |

### 5.2 変更ファイル

| ファイル | 変更点 |
|---|---|
| `src/domain/dsl/collectorAst.ts` | `CollectorDsl`へ`toMap` kind追加（v0.11 §8.1）、`ToMapValueDsl`・`TO_MAP_VALUE_KINDS`・`ToMapMergeId`・`TO_MAP_MERGE_IDS`と表示metaの新設（§7.3）。`COLLECTOR_DSL_KINDS`へ追加。`collectorDepth` / `collectorKindsOf`はleafのためdefault分岐のまま（変更不要なことを確認） |
| `src/domain/dsl/validateCollector.ts` | toMapの構造検証（closed schema・overload組合せ）・型検証（concat×String、TreeMap×Comparableキー、Employee入力slot制約）・`resolveCollectorType`のtoMap分岐（`Map<K, U>`） |
| `src/domain/dsl/javaCode.ts` / `src/domain/dsl/explanation.ts` | toMapのJavaコード式・自然文説明の生成（§7.4） |
| `src/domain/engine/snapshot.ts` | `SnapshotKind`へ5値追加（§7.1）、`completion`へ`'EXECUTION_FAILED'`追加、`Snapshot.executionFailure: ExecutionFailureView \| null`新設、`SnapshotOutput.result`のnull許容化、`CollectorAccumulationView`へtoMap entries variant追加、`CollectorNodeView`へtoMap構造4行view追加（§7.5） |
| `src/domain/engine/collectorRuntime.ts` | toMapの蓄積実装（キー評価→値評価→put / merge / 重複失敗）、teeing branch root判定（`isLeafAccumulator`へのtoMap組込み）、失敗情報（`ExecutionFailureView`素材）のStep Engineへの伝搬（§8.1） |
| `src/domain/engine/stepEngine.ts` | `COLLECT_FAILED`の発行と`completion: 'EXECUTION_FAILED'`、失敗後に後続snapshotを生成しない終端化、`executionFailure`の設定（§8.1） |
| `src/application/session.ts` | `PlaybackState`へ`'FAILED'`追加（7値目）と遷移表の実装（§7.2） |
| `src/domain/dsl/sourceAst.ts` / `validateSource.ts` / `javaCode.ts` | `collection` sourceの`collectionId`へ`'employeesMergeDemo'`を**加算的追加**（§7.6。Phase 5のPredicate DSLへのlong定数加算的追加〔phase-5-decisions §13.7〕の前例に従い、既存`'employees'`の挙動・表示は不変）。**データ選択の単一定義源はFixtureScenarioProviderのdatasetとし、`collectionId`は検証・表示・Javaコード上の識別子とする**（現行`materializeSource`は外部から渡された`employeeDataset`を具現化し`collectionId`でデータ選択しない構造のため、この構造を変更しない。`collectionId`とtemplate / fixtureのdataset対応はP8-D20で機械検証する。判断を`docs/phase-8-decisions.md`へ記録） |
| `src/providers/fixtureScenarioProvider.ts` | Phase 8 fixture 10件追加（§7.6） |
| `src/domain/template/pipelineTemplate.ts` | `PipelineTemplate`へ任意フィールド`expectedCompletion?: 'STREAM_CONSUMED' \| 'EXECUTION_FAILED'`追加（未指定は`'STREAM_CONSUMED'`。v0.11 §1.2） |
| `src/application/importContract.ts` | **§7.7の1点のみ**（collector slotの`allowedCollectorKinds`に`'toMap'`を含むtemplateの`importable: false`化＋`disabledReason`） |
| `src/ui/components/CollectorStructurePanel.tsx`等 | toMap構造4行・entry蓄積・重複 / merge・実行失敗の表示（§9） |
| `src/ui/`のセッション表示系 | `FAILED`状態の表示区分（§9。ERRORと混同しない文言） |
| `oracle/oracle-lib.mjs` / `oracle/run-oracle.mjs` | P8-O01 suite追加・現行Phase切替（§12.5） |
| `e2e/capture-helper.ts` | `CAPTURE_TARGET_PHASE`を`7`→`8`（この1か所のみ） |
| `tools/build_spec_docx.py` | v0.11差分の統合docxビルドへの取込（§14） |
| `README.md` | Phase 8完了時のみ更新（§14） |

`SnapshotOutput.result`を消費している全箇所（UI・テスト・Oracle期待値生成等）を棚卸しし、null分岐（`COLLECT_FAILED`のみ）を追加してください。棚卸し一覧は完了報告へ記載してください（P8-D16）。

## 6. 重要な境界

### 6.1 完了済みPhase 1〜7の保護

1. **歴史的証跡（不変）**: `docs/phase-1〜7-completion-report.md`、`docs/phase-1〜7-decisions.md`、`artifacts/phase-1`〜`phase-7`は一切変更しない。
2. **現行回帰テストスイート（意図的更新）**: §12冒頭の表に列挙した箇所**だけ**を許可する。それ以外の既存P1〜P7テストIDの削除・緩和・skipをしない。更新は理由つきで完了報告へ記録する。

### 6.2 既存DSL・既存契約の不変

- **共有`MapperDsl`（`mapperAst.ts`）・`ClassifierDsl`（`collectorAst.ts`の既存定義）・Terminal DSL・Gatherer DSLは一切変更しない**。toMapのvalueMapperは専用`ToMapValueDsl`として新設する（v0.11 §8.3）。keyMapperは既存`ClassifierDsl`を変更なしで流用する（v0.11 §8.2）。
- **`CLASSIFIER_EVALUATED`（groupingBy専用）・`MAPPING_APPLIED`（mapping系専用）をtoMapで再利用しない**（v0.11 §6.1。phase-5-decisions §14.2の専用化判断を維持）。
- **`CONTAINER_CREATED`の発行対象を拡げない**: root配置かつ4引数版（`TreeMap::new`指定）のtoMapのみ追加発行する（v0.11 §6.1・§6.3。`collectorNeedsContainerCreated`の現行対象=3引数collect・toCollectionへの加算）。
- 既存の全SnapshotKindの発行規則・既存Collector（toList〜teeing）のsnapshot列は変更しない。
- `instantiateTemplate`の7手順の枠組み・順序は変更しない。
- Import Contract・Prompt Generator・Candidate Importの仕様（v0.10 §5〜§7）は変更しない。コード変更は§7.7の1点のみ。**`collectorVariants`へtoMap variantを追加しない**（それは取込開放になる）。
- 既存`'employees'`データセット（`STANDARD_EMPLOYEES`）の値・順序・elementIdは不変。
- `FixtureScenarioProvider`のrevision形式・fixture経路の挙動は不変。

### 6.3 Phase 8の対象外（v0.11 §2.2）

- `toConcurrentMap`系（補助説明のみ。unordered Collector・並列意味論）。
- `toUnmodifiableMap`系（将来のunmodifiable系一括Phaseへ。null禁止・不変Mapは補助説明のみ）。
- `Map.merge`の「remapping結果がnullならentry削除」意味論（許可merge 3種はnullを返さない）。
- 数値加算merge（`Long::sum`等。将来の型付き数値ファミリー）。
- key側identity（Employeeキー）の実行（補助説明のみ。v0.11 §4の5）。
- toMapの手動連携取込開放（§7.7。**ユーザー決定〔2026-08-13〕により見送り**）。

## 7. 確定値（v0.11 §10がPhase 8へ委譲した事項）

本節はv0.11 §10の判断事項8件の**確定値**です。規則の根拠はv0.11を正とします。

### 7.1 SnapshotKind（確定。v0.11 §10-1）

v0.11 §6.1の新設候補5種を**そのまま確定**します: `TO_MAP_KEY_EVALUATED` / `TO_MAP_VALUE_EVALUATED` / `DUPLICATE_KEY_DETECTED` / `MERGE_FUNCTION_APPLIED` / `COLLECT_FAILED`。

- 既存`SnapshotKind`は48値（Phase 7完了時点）で、上記5値との衝突がないことを確認済み（`TO_MAP` / `DUPLICATE` / `MERGE` / `COLLECT_FAILED`を含む既存kindは0件）。追加後は53値。
- 再利用は`CONTAINER_CREATED`（root 4引数版のみ）・`CONTAINER_UPDATED`・`NODE_ARRIVAL`等、v0.11 §6.1の表のとおり。

### 7.2 実行失敗の状態モデル（確定。v0.11 §10-2）

- `Snapshot.completion`: `'NONE' | 'STREAM_CONSUMED' | 'EXECUTION_FAILED'`（3値目として確定）。
- `PlaybackState`: 現行6値（`READY` / `PLAYING` / `PAUSED` / `COMPLETED` / `LIMIT_REACHED` / `ERROR`）へ`'FAILED'`を追加し7値とする。
- 遷移はv0.11 §6.2の4の表のとおり実装する（`COLLECT_FAILED`到達で`FAILED`＋タイマー停止 / 進む・自動再生はno-op / 戻るは`PAUSED` / 保存済み失敗snapshotへの再前進は履歴復元で`FAILED` / restart・シナリオ切替は`READY`）。
- **`FAILED`は`ERROR`の機構を使わない**: `EngineInvariantError`のcatch経路（`session.ts`）・`stopReason`のERROR文言を流用せず、`FAILED`専用の表示情報（§9）を持つ。失敗はStep Engineが正規のsnapshotとして返すため、例外catchでは遷移しない。

### 7.3 Collector DSL（確定）

`collectorAst.ts`へ次を追加します（v0.11 §8.1〜§8.5の実装形）。

```ts
| {
    readonly kind: 'toMap'
    readonly keyMapper: ClassifierDsl          // 既存型を変更なしで流用
    readonly valueMapper: ToMapValueDsl        // 新設
    readonly mergeFunctionId: ToMapMergeId | null
    readonly mapFactoryId: CollectorMapFactoryId | null   // 既存TreeMap::newのみ
  }

export type ToMapValueDsl =
  | { readonly kind: 'identity' }
  | { readonly kind: 'fieldAccess'; readonly field: string }   // 既存MapperDslのfieldAccessと同形・同ホワイトリスト

export const TO_MAP_MERGE_IDS = ['first', 'last', 'concat'] as const
export type ToMapMergeId = (typeof TO_MAP_MERGE_IDS)[number]
```

検証（`validateCollector.ts`）:

1. closed schema: kind → 許可キー集合（5キー厳密）→ ホワイトリスト → 型検証（既存方式）。
2. **overload組合せ**: `mapFactoryId`非null かつ `mergeFunctionId`null は`STRUCTURE_INVALID`で拒否（対応するJava overloadが存在しない。v0.11 §8.1）。
3. `concat`は値型U=Stringのときのみ受理。違反は`TYPE_MISMATCH`。
4. `mapFactoryId: 'TreeMap::new'`のとき、keyMapperのkindが`COMPARABLE_CLASSIFIER_KINDS`に含まれること（既存規則の流用。`employeeDepartment`×TreeMapは`TYPE_MISMATCH`）。
5. toMapを配置できるslotは入力要素型がEmployeeの位置に限る（`mapping`配下等は`TYPE_MISMATCH`。v0.11 §8.6）。
6. `resolveCollectorType`: `Map<K, U>`（Kは既存classifierのキー型導出を流用、Uは`identity`→Employee / `fieldAccess`→既存`resolveMapperOutputType`流用〔boxing済み。`salary`→`Long`等〕）。4引数版の表示コンテナ名はTreeMap（既存`COLLECTOR_MAP_FACTORY_META`流用）。
7. `ToMapValueDsl`の検証は専用実装とし、**`validateMapper.ts`の許可範囲を変更しない**。`fieldAccess`のfieldホワイトリストは既存`EMPLOYEE_FIELDS`参照と同一範囲。

新しい`ValidationCode`は追加しません（既存`STRUCTURE_INVALID` / `TYPE_MISMATCH`等で表現できることを確認済み）。

### 7.4 Javaコード表記（確定）

- 2引数版: `Collectors.toMap(<keyMapper式>, <valueMapper式>)`。keyMapper式は既存`classifierToJavaExpr`を流用。valueMapper式は`identity`→`Function.identity()`、`fieldAccess`→既存mapperのJava表記を流用。
- 3引数版merge式（v0.11 §8.4の表のとおり確定）: `first`→`(a, b) -> a`、`last`→`(a, b) -> b`、`concat`→`(s, a) -> s + ", " + a`。
- 4引数版: 第4引数`TreeMap::new`。
- `Function.identity()`の`import`表示等の細部は既存javaCode生成規約の範囲での実装判断とし、`docs/phase-8-decisions.md`へ記録。構文的正当性と実データ一致はP8-D19で検証する。

### 7.5 view契約（確定。v0.11 §10-3・§10-5）

1. **`ExecutionFailureView`**（`snapshot.ts`へ新設。v0.11 §6.2の9）: 値参照の具体型は**「表示ラベル＋安定キー文字列」のペア**とする（既存`CollectorMapEntryView`の`keyLabel` / `keyRef`前例。SimValueを直接保持しない）。

   ```ts
   export interface ExecutionFailureView {
     readonly kind: 'DUPLICATE_TO_MAP_KEY'
     readonly exceptionType: 'IllegalStateException'
     readonly collectorPath: readonly string[]            // currentPathと同一の値・規約（c0 / .down / .left / .right / .bucket#<n>）
     readonly bucketPath: readonly { readonly collectorNodeKey: string; readonly keyLabel: string; readonly keyRef: string }[]
     readonly duplicateKeyLabel: string
     readonly duplicateKeyRef: string
     readonly existingValueLabel: string
     readonly incomingValueLabel: string
   }
   ```

   `Snapshot.executionFailure: ExecutionFailureView | null`（`COLLECT_FAILED`で必須・その他はnull）。
2. **`SnapshotOutput.result`のnull許容化**: `TerminalResultView | null`へ変更し、nullは`COLLECT_FAILED`のみ。`COLLECT_FAILED`では`confirmed: false`。消費箇所の棚卸しと null分岐追加は§5.2末尾のとおり。
3. **toMapの蓄積view**: `CollectorAccumulationView`へtoMap専用variantを追加する（既存`MAP` variantはgroupingBy / partitioningBy専用のまま不変）。

   ```ts
   | {
       readonly kind: 'TO_MAP'
       readonly containerLabel: string    // Map（無保証）/ TreeMap
       readonly entries: readonly {
         readonly keyLabel: string
         readonly keyRef: string
         readonly valueLabel: string
         readonly valueTypeLabel: string
       }[]
     }
   ```

   entriesは蓄積順（encounter orderの挿入順。TreeMapはキー順）で保持し、UIは並べ替えない。
4. **toMap構造4行view**: `CollectorNodeView`へ`toMap: { keyMapperLabel; valueMapperLabel; mergeFunctionLabel; mapFactoryLabel } | null`を追加する（toMapノードのみ非null）。省略overloadの行は意味論表示の文言を確定値として含める（mergeFunctionなし→「なし（重複キーでIllegalStateException）」、mapFactoryなし→「なし（Map実装型は無保証）」。v0.11 §5）。フィールド名の細部は実装判断としてよいが、上記の情報がすべて載っていることを契約とする。
5. 重複検出・merge適用のcontext（重複キー・既存値・新しい値・merge結果）は`ProcessingView`の確定値と上記viewで表現し、UIで独自計算しない。
6. **merge結果値のID（確定。v0.11 §6.4・§10-5の残項目）**: merge結果へ独立の値ID（ElementId・合成ID）は**付与しない**。Map entryはPipelineを流れる要素ではなく、既存Collector蓄積値（counting等）もElementIdを持たない前例に従う。entryの`keyRef`・`valueLabel`（§7.5-3）と`ExecutionFailureView`だけで復元契約・決定性（P8-D17）を満たすことを契約とし、判断理由を`docs/phase-8-decisions.md`へ記録する。

### 7.6 templateとfixture（確定。v0.11 §10-4）

**補助データセット**（`mergeDemoEmployees.ts`。`collectionId: 'employeesMergeDemo'`）。基準4件では最大2件衝突（関東×2）のため、v0.11 §8.6-4「同一キーへ3件以上が衝突するデータ」を満たす5件を新設します。部署recordは既存と同形（開発部/技術本部、営業部/営業本部）。

| elementId | name | age | salary | evaluation | region | department | hireDate | skills |
|---|---|---|---|---|---|---|---|---|
| emp-101 | 伊藤 | 31 | 5_000_000 | 4.1 | 関東 | 開発部 | 2020-04-01 | Java, AWS |
| emp-102 | 渡辺 | 38 | 6_100_000 | 4.4 | 関東 | 開発部 | 2016-10-01 | 設計, SQL |
| emp-103 | 山本 | 26 | 4_600_000 | 3.9 | 関東 | 営業部 | 2024-04-01 | 営業, SQL |
| emp-104 | 中村 | 33 | 5_200_000 | 4.0 | 関西 | 営業部 | 2019-07-01 | 営業, 英語 |
| emp-105 | 小林 | 30 | 4_900_000 | 3.7 | 中部 | 開発部 | 2021-10-01 | Java, 分析 |

**template 8件**（`templatesP8.ts`。sourceは`collection`・collectノードは既存`node-sink` / `slot-collector`規約、`allowedCollectorKinds`は各templateの使用kindに限定）。v0.11 §8.6末尾（追補）のとおり、**実行失敗・first / last・concatの4 templateは互いに同一fixture（employeesMergeDemo）・同一keyMapper（region）**とし、**同一データのgroupingBy(region)比較template**を新設します。

| templateId | Pipeline / collector fixture値 | dataset | supportedModes | expectedCompletion | 実演内容 |
|---|---|---|---|---|---|
| `tmpl-collect-tomap-identity` | `toMap(name, identity)` | employees | standard / emptySource | STREAM_CONSUMED | value側identity（v0.11 §4の5の必須教材）。`Map<String, Employee>`全4 entry。空: `{}` |
| `tmpl-collect-tomap-duplicate` | `toMap(region, fieldAccess name)` | employeesMergeDemo | standard | **EXECUTION_FAILED** | emp-102（渡辺・関東）で重複検出→実行失敗。教材の中核。merge系と同一データで「mergeがないとどうなるか」を直接比較 |
| `tmpl-collect-tomap-merge-first` | `toMap(region, fieldAccess name, first)` | employeesMergeDemo | standard | STREAM_CONSUMED | 既存値を保持（先勝ち）。関東=伊藤 |
| `tmpl-collect-tomap-merge-last` | `toMap(region, fieldAccess name, last)` | employeesMergeDemo | standard | STREAM_CONSUMED | 新しい値で置換（後勝ち）。関東=山本 |
| `tmpl-collect-tomap-merge-concat` | `toMap(region, fieldAccess name, concat)` | employeesMergeDemo | standard | STREAM_CONSUMED | 3件衝突の順次適用。関東=`伊藤, 渡辺, 山本` |
| `tmpl-collect-groupby-mergedemo` | `groupingBy(region)`（1引数・暗黙toList） | employeesMergeDemo | standard | STREAM_CONSUMED | **同一データのgroupingBy比較**（v0.11 §8.6追補）。関東=`[伊藤, 渡辺, 山本]`。「groupingByは同じキーの値をListへ蓄積 / toMapは衝突してmergeまたは例外」の直接比較 |
| `tmpl-collect-tomap-treemap` | `toMap(region, fieldAccess salary, first, TreeMap::new)` | employees | standard / emptySource | STREAM_CONSUMED | 4引数版・TreeMapキー昇順。空: 空TreeMap |
| `tmpl-collect-tomap-grouped` | `groupingBy(region, toMap(name, fieldAccess salary))` | employees | standard | STREAM_CONSUMED | downstream形。`Map<String, Map<String, Long>>`・bucketごとの重複判定 |

- fixture は**10件**（standard 8 + emptySource 2）。
- duplicate / first / last / concatの4 templateが**同一データセット・同一keyMapper**であることが、v0.11 §8.6-4「first→最初の値 / last→最後の値 / concat→全値の連結を同一データで照合」と§8.6末尾（追補）の実装形。`tmpl-collect-groupby-mergedemo`はこの4 templateとtitle / description / jdkNotesで相互参照し、既存P5の`groupingBy(region)`系template（基準4件データ）への参照も維持する。
- `tmpl-collect-groupby-mergedemo`は既存`groupingBy` kindのみを使う（toMap非含有。取込対象性は§7.7参照）。
- **midEmptyは全Phase 8 templateで非対応**とする。midEmpty（途中0件）は空Map成立の教材価値がemptySourceと重複し、失敗templateでは重複キー到達前に要素が尽きて`expectedCompletion`と矛盾するため。判断を`docs/phase-8-decisions.md`へ記録する。
- `expectedCompletion`はtemplate単位の任意フィールド（§5.2）。`tmpl-collect-tomap-duplicate`のみ`'EXECUTION_FAILED'`。
- `snapshotBudget`は`{ limit: 500, estimatedMax: 45 }`（§8.2の実測列は最大32件）。
- template総数は118→**126**、実行可能templateは116→**124**、実行可能template×supportedModesの組合せは222→**232**になる（現行値はPhase 7完了報告で実測済み）。
- ExecutionFailureViewの配置別必須テスト（多段groupingBy / partitioningBy / adapter系 / teeing branch。v0.11 §6.2の9）は**templateを追加せず**、P8-D14 / D15がDSLを直接構築して検証する。

### 7.7 toMap templateの取込対象外（確定。v0.11 §10-6の判断結果）

**toMapは手動連携の取込候補へ開放しません**（ユーザー決定2026-08-13。gatherの前例〔Phase 7指示§7.8〕に従う。将来拡張として持越し）。Import Contract・Prompt Generator・Candidate Importの仕様は不変のまま、次の**1点のみ**を`src/application/importContract.ts`へ実装します。

1. `buildTemplateContract`のimportable導出へ、**collector slotの`allowedCollectorKinds`に`'toMap'`を含むtemplateは`importable: false`**とする条件を追加し、`disabledReason`へ固定文言（「toMapを含むtemplateは手動連携の取込対象外です」の趣旨）を設定する。template定義（slot許可kind）由来の導出とし、新規template属性は追加しない。

gatherのような新slot kindは増えないため、`slotSpecOf`への追加は不要です。**`collectorVariants`へtoMap variantを追加してはならず**、既存の防御（variant未定義kindはContract検証が拒否する）とimportable:falseの二重で取込不能になります（P8-D21）。非toMap templateのimportability・Contract内容・プロンプト文面が不変であることをテストで保証してください。

なお`tmpl-collect-groupby-mergedemo`はtoMap非含有（既存`groupingBy` kindのみ）のため**通常どおり`importable: true`**であり、既存のContract機構（groupingBy variant）で受理されます（P8-D21で確認）。

### 7.8 表示文言の教材規約（確定。v0.11 §10-8）

- キー評価→値評価→重複検出の表示順について、jdkNote等で次の趣旨を明示する: 「この表示順は教材上の規約であり、JDK内部でのkeyMapper / valueMapper評価と例外送出の実際の順序を示すものではありません」（v0.11 §6.2の8）。
- first / lastの意味は「既存値を保持（先勝ち）」「新しい値で置換（後勝ち）」を併記し、「現在の決定的な逐次実行における入力順」を指すことを明示する（v0.11 §8.4）。
- mergeFunctionの引数順は「(Map内の既存値, 新しい値)」であり、根拠が`Map.merge`契約であることをjdkNoteで示す（v0.11 §3.2）。
- Mapのentry反復順序の一般保証は説明しない。挿入がencounter orderであることはJavadoc Implementation Note区分として扱う（v0.11 §4の7・§7）。

## 8. snapshot列の確定（v0.11 §6.3「厳密な合成」）

### 8.1 発行位置の合成規則

1. **`CONTAINER_CREATED`**: root配置の4引数版toMapのみ、実行開始ブロック（`INITIAL`直後・source送出前）で1回発行する。2・3引数版のroot・bucket / branch内のすべてのdownstream配置では発行しない。**判定の注意**: 現行`collectorNeedsContainerCreated`は`rt.root.dsl.kind`だけを見るため、単純に`'toMap'`を条件へ加えるだけでは`filtering(…, toMap(…, TreeMap::new))`等の**root adapter経由**を取り逃す。v0.11 §6.3の「adapter系はコンテナ・bucketを持たず外側の配置へ委譲する（rootに達する場合はroot規則）」に従い、adapter系（mapping / flatMapping / filtering / collectingAndThen）の連なりを辿った**実効rootコンテナ**が4引数版toMapかどうかで判定すること（P8-D11で検証）。
2. **要素到着**: collectノードへの要素到着は既存どおり`NODE_ARRIVAL`。toMapノードの蓄積（`collectorRuntime.ts`の`accumulateNode`分岐へ`case 'toMap'`を追加）は、`TO_MAP_KEY_EVALUATED`（キー確定）→ `TO_MAP_VALUE_EVALUATED`（値確定）→ 初回キーなら`CONTAINER_UPDATED`（新規put）。
3. **重複キー**: `DUPLICATE_KEY_DETECTED`（キー・既存値・新しい値をcontext表示）→
   - mergeFunctionあり: `MERGE_FUNCTION_APPLIED`（`mergeFunction(既存値, 新しい値) → 結果`の計算確定）→ `CONTAINER_UPDATED`（置換。3件以上衝突では「現在Mapにある値」へ順次適用）。
   - mergeFunctionなし（2引数版）: **失敗をStep Engineへ返し**、Step Engineが`COLLECT_FAILED`（`executionFailure`必須・`completion: 'EXECUTION_FAILED'`・`output.confirmed: false`・`output.result: null`）を発行して列を終える。以降のsnapshot（未処理要素の`SOURCE_EMIT`・`RESULT_CONFIRMED`・`STREAM_CONSUMED`）は生成しない。`nextSnapshot`は`COLLECT_FAILED`の次にnullを返す。
   - 失敗の伝搬はTypeScript例外ではなく戻り値・状態で行う（`EngineInvariantError`経路と分離。v0.11 §6.2の2）。
4. **downstream配置**: 生成表示はv0.11 §6.3の親種別表のとおり（groupingBy=新規`BUCKET_SELECTED`のcontext / partitioningBy=事前生成の初期表示context＋空partitionは空Mapが値 / adapter系=外側へ委譲 / teeing branch=初回`TEE_BRANCH_ACCUMULATED`、0件branchは`TEE_BRANCH_FINISHED`のcontext）。bucket内toMapの蓄積列は`TO_MAP_KEY_EVALUATED`以降を適用する。
5. **teeing branch rootのtoMap**: `CONTAINER_UPDATED`を`TEE_BRANCH_ACCUMULATED`へ置換する（既存`isLeafAccumulator`機構。成功時`… → TO_MAP_VALUE_EVALUATED → TEE_BRANCH_ACCUMULATED`、merge時`… → MERGE_FUNCTION_APPLIED → TEE_BRANCH_ACCUMULATED`）。失敗要素では`COLLECT_FAILED`が終端となり`TEE_BRANCH_ACCUMULATED`を発行しない（v0.11 §6.3）。
6. **空ソース**: 2・3引数版root=`RESULT_CONFIRMED`（空Map）→`STREAM_CONSUMED`のみ。4引数版root=`CONTAINER_CREATED`→`RESULT_CONFIRMED`→`STREAM_CONSUMED`。

### 8.2 10 fixture全ケースの確定snapshot列

以下のkind列を確定とします（`INITIAL`から終端まで。要素表記「×5」は`SOURCE_EMIT → NODE_ARRIVAL → TO_MAP_KEY_EVALUATED → TO_MAP_VALUE_EVALUATED → CONTAINER_UPDATED`の5件）。実装した列がこの表と一致することをP8-D07〜D12で検証してください。

| # | template × mode | 確定列 | 計 |
|---|---|---|---|
| 1 | tomap-identity × standard | `INITIAL` → emp-001〜004: ×5ずつ（全キー一意・全て新規put） → `RESULT_CONFIRMED` → `STREAM_CONSUMED` | 23 |
| 2 | tomap-identity × emptySource | `INITIAL` → `RESULT_CONFIRMED`（空Map）→ `STREAM_CONSUMED` | 3 |
| 3 | tomap-duplicate × standard | `INITIAL` → emp-101: ×5 → emp-102: `SOURCE_EMIT` → `NODE_ARRIVAL` → `TO_MAP_KEY_EVALUATED`(関東) → `TO_MAP_VALUE_EVALUATED`(渡辺) → `DUPLICATE_KEY_DETECTED`(関東: 伊藤 vs 渡辺) → `COLLECT_FAILED`（終端。emp-103〜105は`SOURCE_EMIT`されない） | 12 |
| 4 | tomap-merge-first × standard | `INITIAL` → emp-101: ×5 → emp-102: `SOURCE_EMIT`→`NODE_ARRIVAL`→KEY→VALUE→`DUPLICATE_KEY_DETECTED`→`MERGE_FUNCTION_APPLIED`→`CONTAINER_UPDATED`（7件）→ emp-103: 同7件 → emp-104: ×5 → emp-105: ×5 → `RESULT_CONFIRMED` → `STREAM_CONSUMED` | 32 |
| 5 | tomap-merge-last × standard | #4と同列（merge結果のみ異なる） | 32 |
| 6 | tomap-merge-concat × standard | #4と同列（merge結果のみ異なる） | 32 |
| 7 | tomap-treemap × standard | `INITIAL` → `CONTAINER_CREATED`(TreeMap) → emp-001: ×5 → emp-002: ×5 → emp-003: 7件（関東でDUP→first→既存値保持の`CONTAINER_UPDATED`） → emp-004: ×5 → `RESULT_CONFIRMED` → `STREAM_CONSUMED` | 26 |
| 8 | tomap-treemap × emptySource | `INITIAL` → `CONTAINER_CREATED` → `RESULT_CONFIRMED`（空TreeMap）→ `STREAM_CONSUMED` | 4 |
| 9 | tomap-grouped × standard | `INITIAL` → emp-001〜004: (`SOURCE_EMIT` → `NODE_ARRIVAL` → `CLASSIFIER_EVALUATED` → `BUCKET_SELECTED` → `TO_MAP_KEY_EVALUATED` → `TO_MAP_VALUE_EVALUATED` → `CONTAINER_UPDATED`)×4 → `RESULT_CONFIRMED` → `STREAM_CONSUMED` | 31 |
| 10 | groupby-mergedemo × standard | `INITIAL` → emp-101〜105: (`SOURCE_EMIT` → `NODE_ARRIVAL` → `CLASSIFIER_EVALUATED` → `BUCKET_SELECTED` → `CONTAINER_UPDATED`)×5 → `RESULT_CONFIRMED` → `STREAM_CONSUMED`（**既存P5の`groupingBy(region)`標準templateと同一のkind列構成**。データのみemployeesMergeDemo） | 28 |

- 期待結果値（表記は`formatSimValue` / 既存long表記に従う。意味上の省略表記）: #1 `{佐藤=Employee佐藤, 鈴木=Employee鈴木, 高橋=Employee高橋, 田中=Employee田中}`、#3 実行失敗（`IllegalStateException` / 重複キー`関東` / 既存値`伊藤` / 新しい値`渡辺`）、#4 `{関東=伊藤, 関西=中村, 中部=小林}`、#5 `{関東=山本, 関西=中村, 中部=小林}`、#6 `{関東=伊藤, 渡辺, 山本, 関西=中村, 中部=小林}`、#7 TreeMapキー昇順で`{中部=4_800_000L, 関東=5_500_000L, 関西=4_200_000L}`（firstにより関東は佐藤の5_500_000L）、#9 `{関東={佐藤=5_500_000L, 高橋=7_200_000L}, 関西={鈴木=4_200_000L}, 中部={田中=4_800_000L}}`、#10 `{関東=[伊藤, 渡辺, 山本], 関西=[中村], 中部=[小林]}`、#2 / #8 空Map。
- **#7のTreeMapキー順（中部 → 関東 → 関西）は`String.compareTo`（UTF-16コード単位）による導出**であり、既存Phase 5のTreeMap template（`groupingBy(region, TreeMap::new, toList())`）の実測順と一致すること、およびP8-O01のJDK実測と一致することを確認する。食い違う場合は停止して報告する（§17）。
- #3の`DUPLICATE_KEY_DETECTED`と#4〜#7のそれは同一kind（後続が失敗かmergeかはcontextで区別）。
- 実装時に既存機構の発行条件（collect sinkの`NODE_ARRIVAL`・`RESULT_CONFIRMED`の位置等）がこの表と一致しない場合は、**列を勝手に変えず停止して報告**すること（§17）。

### 8.3 復元契約・決定性

- 失敗列を含む全列で、任意cursorへの移動（戻る→進む）が完全復元されること（P8-D17）。`COLLECT_FAILED`の`executionFailure`・toMap蓄積view・重複 / mergeのcontextはsnapshotのみから復元できること。
- 同一revisionの再実行で同一のID列・snapshot列を生成すること（決定性）。
- ExecutionFailureViewの配置別検証（P8-D13〜D15）は、`collectorPath` / `bucketPath`を**配列の完全一致**で検証する（v0.11 §6.2の9。root / 単段groupingBy / 多段groupingBy / partitioningBy / adapter系経由 / teeing branchの6配置）。

## 9. UI要件

- **toMap構造4行**（CollectorStructurePanelのtoMapノード表示）: keyMapper / valueMapper / mergeFunction / mapFactoryを常設4行で表示する（v0.11 §5）。省略行は§7.5-4の意味論文言。
- **蓄積表示**: toMapのentry（キー→値1件）を蓄積順で表示する。groupingByのbucket（キー→List）との視覚差を明確にする。
- **重複検出**: 重複キー・既存値・新しい値の3点を明示する。
- **merge適用**: `mergeFunction(既存値, 新しい値) → 結果`のフローと、「既存値を保持（先勝ち）」「新しい値で置換（後勝ち）」の併記（§7.8）。
- **実行失敗表示**: (1) 教材上想定された実行失敗であること、(2) 例外型`IllegalStateException`（メッセージ全文は表示しない）、(3) 原因キーと衝突した2値、(4) downstream配置ではCollector経路とbucketキー、を`executionFailure`から表示する。`ERROR`（エンジン内部不整合）と明確に異なる表示区分・文言とし、「JDKで実行した場合ここで例外が送出される」ことを学習点として提示する。`FAILED`状態では進む・自動再生が無効化され、戻るは有効。
- **型遷移**: `Stream<Employee> → Map<String, Employee>`等。downstream形は`Map<String, Map<String, Long>>`。
- 対象外の補助説明: `toConcurrentMap`・`toUnmodifiableMap`・数値加算merge・key側identityの存在と対象外理由（v0.11 §2.2。`UNIMPLEMENTED_OPERATIONS`機構は使わない）。
- 表示はsnapshot（view・context）のみから導出し、UIで結果・型・蓄積状態・表示順を独自計算しない。
- キーボード操作・focus-visible・reduced motion・狭幅縦積み等の既存a11y / responsive要件をtoMap表示・FAILED表示にも適用する（P8-R06）。

## 10. 総点検・回帰

- 全実行可能template（124件）×`supportedModes`の全組合せ（232組合せ）で、`expectedCompletion`どおりの終端（`STREAM_CONSUMED`または`EXECUTION_FAILED`）・snapshot予算内・Javaコード生成を機械検証する（P8-D22。P6-D22の後継となる常設総点検）。
- 既存P1〜P7の全テストID（Vitest 651件・Playwright 81件・Oracle 7 suiteに対応）が、§12冒頭の許可範囲を除き変更なく成功すること。
- 視覚回帰基準画像は**原則据え置き**とする。差分が出た場合はdiff画像で差分領域を確認した上での意図的更新のみ許可し（threshold緩和なし）、理由を完了報告へ記録する。Phase 8の基準画像（`e2e/phase8.spec.ts`・`p8-narrow.spec.ts`配下）は新設する。

## 11. Phase 8で実装しないもの

- `toConcurrentMap`・`toUnmodifiableMap`系の実行（補助説明のみ）
- 数値加算merge（`Long::sum`等）・`Map.merge`のnull削除意味論
- key側identity（Employeeキー）の実行
- **toMapの手動連携取込開放**（`collectorVariants`へのtoMap variant追加、プロンプト生成のtoMap言語化。§7.7のimportable:false化は開放ではなく対象外化のための必須実装）
- 共有`MapperDsl`・`ClassifierDsl`・Terminal DSL・Gatherer DSL・既存ホワイトリストの変更
- `fieldToPrimitive` / `toUpper` / `prefix` / flattening系のvalueMapper許可
- 新しいoperationIdの登録（toMapは`collect`のCollector AST kind）
- `CLASSIFIER_EVALUATED` / `MAPPING_APPLIED`のtoMapでの再利用
- 例外メッセージ全文への依存（表示・テスト・Oracle照合とも型のみ）
- 取込候補の保存・再利用、任意Pipelineビルダー、ノード編集UI、本番デプロイ構成、依存ライブラリの不要な更新

## 12. 必須テストID

以下の`P8-*`（39 ID: D22 / A4 / R6 / E5 / O2）をすべて実装し、テスト名へIDを含めて追跡可能にしてください。追加する場合は各系列の末尾連番で採番してください。

**既存テストの意図的更新（これ以外の既存P1〜P7テストIDの削除・緩和・skipは禁止。v0.11 §1.2の「走査母集団の意図的更新」の実装形）**:

| 現行対象 | 更新内容 |
|---|---|
| `tests/domain/p6-fullcheck.test.ts`（P6-D22） | 走査母集団を**Phase 7完了時点のtemplate集合**へ固定する最小更新のみ許可。固定方法は「`ALL_TEMPLATES`から`P8_TEMPLATES`（`templatesP8.ts`のexport）全件を除外」とする。**「toMap非含有」での抽出は不可**——新設`tmpl-collect-groupby-mergedemo`はtoMap非含有のため、その抽出ではPhase 7時点集合と一致しない。固定後も既存全templateへの検証意味（`STREAM_CONSUMED`終端・予算内・Javaコード生成）を保存する。全template（Phase 8分含む）の総点検はP8-D22が`expectedCompletion`対応で引き継ぐ |
| `tests/domain/p7-catalog.test.ts`（P7-D20） | template総数118 / 実行可能116 / 組合せ222の固定値検証を、**Phase 7完了時点集合へのスコープ固定**とする最小更新のみ許可。固定方法はP6-D22と同じ「`P8_TEMPLATES`全件を除外」（「toMap非含有」抽出では119 / 117 / 223になり失敗する）。P8の件数検証はP8-D20が担う |
| `tests/domain/p6-contract.test.ts`（P6-D01〜D03）・`tests/application/p6-session.test.ts`（P6-A03）・`tests/domain/p7-*.test.ts`のうち取込対象templateを走査するもの（P7-D21等） | 「取込対象template」導出（現行: gatherノード非含有）を「gatherノード非含有**かつ**collector slotに`'toMap'`を含まない」へ拡張する最小更新のみ許可（`tests/p6-helpers.ts`のヘルパ更新で一元化）。既存の非gather・非toMap templateへの検証意味を保存する。toMap templateの拒否検証はP8-D21が担う |
| `tests/domain/p7-review.test.ts`（P7-O02） | Phase 7時点のOracle suite構成をfixtureとして固定する形へのリファクタリングのみ許可（P6-O02前例）。ライブ構成の検証は新規`tests/domain/p8-review.test.ts`（P8-O02）が担う |
| `tests/domain/p6-javacode.test.ts`（P6-D18） | Phase 6 goldenの既存キー・出力の不変検証はそのまま保持し、**追加キーの許可集合**（現行: Phase 7 gatherのtemplate×modeのみ）を「Phase 7 gather 11件＋Phase 8で確定した10 fixture」へ拡張する最小更新のみ許可。golden JSON自体は書き換えない |
| `e2e/capture-helper.ts` | `CAPTURE_TARGET_PHASE`を`7`→`8`（この1か所のみ） |
| 視覚回帰基準画像（`e2e/__screenshots__/`） | 原則据え置き。差分発生時のみdiff確認つき意図的更新（§10） |

上記のほか、template / kind追加に伴い件数前提・一覧前提が壊れる既存assertionが見つかった場合は、検証意味を変えない最小の更新に限り許可し、1件ずつ理由を完了報告へ記載してください。判断に迷う場合は停止して報告してください。

### 12.1 DSL・engine契約テスト（P8-D）

| ID | 対象 | 必須検証 |
|---|---|---|
| P8-D01 | toMap DSL構造検証 | closed schema受理（3 overload）、未知kind・許可外キー・必須キー欠落の拒否、**`mapFactoryId`非null∧`mergeFunctionId`nullの拒否**（`STRUCTURE_INVALID`） |
| P8-D02 | ToMapValueDsl | `identity` / `fieldAccess`の受理、`fieldToPrimitive` / `toUpper` / `prefix` / `listStream` / `arrayStream`相当の値の拒否、**共有`MapperDsl`・`validateMapper`の許可範囲が不変**であること |
| P8-D03 | mergeFunction whitelist | 3 ID受理、未知IDの拒否、`concat`×非String値型（identity=Employee / salary=Long）の`TYPE_MISMATCH` |
| P8-D04 | keyMapper・TreeMap制約 | `ClassifierDsl` 3形の流用受理、`employeeDepartment`×`TreeMap::new`の拒否、`ClassifierDsl`定義・既存`COMPARABLE_CLASSIFIER_KINDS`の不変 |
| P8-D05 | 結果型導出 | `Map<String, Employee>` / `Map<String, Long>`（boxing: salary→Long）/ TreeMap表示名 / nested `Map<String, Map<String, Long>>` |
| P8-D06 | 配置制約 | toMapのdownstream / left / right配置の受理（深さ4以内）、`mapping`配下等Employee入力でないslotの`TYPE_MISMATCH`、深さ超過の`COLLECTOR_DEPTH` |
| P8-D07 | snapshot列: identity | §8.2 #1 / #2との完全一致（kind列・currentElementId・entry蓄積順） |
| P8-D08 | snapshot列: 実行失敗 | §8.2 #3との完全一致。`COLLECT_FAILED`終端・emp-103〜105の`SOURCE_EMIT`不発行・`RESULT_CONFIRMED` / `STREAM_CONSUMED`不発行・`completion: 'EXECUTION_FAILED'` |
| P8-D09 | snapshot列: first / last | §8.2 #4 / #5との完全一致。`MERGE_FUNCTION_APPLIED`のcontextが（既存値, 新しい値）の順であること、first / lastの結果差 |
| P8-D10 | snapshot列: concat 3件衝突 | §8.2 #6との完全一致。2回のmergeが「現在Mapにある値」へ順次適用され`伊藤, 渡辺, 山本`になること |
| P8-D11 | snapshot列: TreeMap・CONTAINER_CREATED判定 | §8.2 #7 / #8との完全一致。`CONTAINER_CREATED`がroot 4引数版のみ・`INITIAL`直後1回であること（2・3引数版templateでの不発行を含む）、TreeMapキー昇順。加えてDSL直接構築で: **root adapter経由4引数版**（`filtering(…, toMap(…, TreeMap::new))`）でも`CONTAINER_CREATED`が`INITIAL`直後に正確に1回発行されること（§8.1-1の実効root判定） |
| P8-D12 | snapshot列: downstream形・配置別生成表示 | §8.2 #9 / #10との完全一致。bucketごとの独立蓄積（関東bucket内で佐藤・高橋のキーが衝突しないこと）、nested TypeRef。加えてDSL直接構築で: **groupingBy配下4引数版**（独立`CONTAINER_CREATED`なし・新規`BUCKET_SELECTED`のcontextにTreeMap生成が載る）、**partitioningBy配下4引数版**（false / true両partitionの初期downstream MapがTreeMapで、要素0件のpartitionも空TreeMapが値になる。v0.11 §3.3・§6.3） |
| P8-D13 | ExecutionFailureView: root | 全フィールドの厳密一致（`collectorPath = ['c0']`・`bucketPath = []`・exceptionType・キー / 値ラベル）。`executionFailure`が`COLLECT_FAILED`以外でnullであること |
| P8-D14 | ExecutionFailureView: bucket系 | 単段groupingBy（`['c0', 'c0.bucket#n']`）・多段groupingBy（bucketPath外側→内側2要素）の**配列完全一致**（DSL直接構築） |
| P8-D15 | ExecutionFailureView: その他配置 | partitioningBy（bucketPath=partitionキー1要素）・adapter系経由（`['c0', 'c0.down']`・bucketPath空）・teeing branch（失敗要素の`TEE_BRANCH_ACCUMULATED`不発行を含む）の配列完全一致 |
| P8-D16 | 実行失敗の出力契約 | `COLLECT_FAILED`で`output.confirmed === false`・`output.result === null`、他snapshotで`result`非null。TypeScript例外の不送出（`nextSnapshot`が正常return）・`EngineInvariantError`経路の不使用。`result`消費箇所の棚卸しとnull分岐の網羅 |
| P8-D17 | 決定性・復元 | 同一revision再実行の同一列（失敗列含む）、任意cursor移動での`executionFailure`・toMap蓄積view・contextの完全復元 |
| P8-D18 | teeing排他・branch生成表示 | branch直下toMapの`CONTAINER_UPDATED`→`TEE_BRANCH_ACCUMULATED`置換列（成功・merge両方）、branch内部（adapter経由）での`CONTAINER_UPDATED`＋branch確定別事象の列（DSL直接構築）。加えて**branch直下4引数版**: 独立`CONTAINER_CREATED`なし・初回`TEE_BRANCH_ACCUMULATED`（branchへ要素が来ない場合は`TEE_BRANCH_FINISHED`）のcontextにTreeMap生成が載ること |
| P8-D19 | Javaコード表示 | 8 templateの`Collectors.toMap(…)` / `groupingBy(…)`式が構文的に正当で実データ・評価結果と一致。既存fixture（非Phase 8）のJavaコード出力が改修前後で不変 |
| P8-D20 | catalog / template / source不変条件 | 操作総数46のまま（新operationIdなし）・`collect`のtraits不変、template総数126 / 実行可能124 / 組合せ232、全template×modeのfixture存在、toMap全ケースのsnapshotCount実測が§8.2の計と一致・予算内。**source契約**: `collectionId: 'employeesMergeDemo'`の受理と未知collectionIdの拒否（validateSource）、standardでemp-101〜105が定義順に具現化・emptySourceで0件、既存`'employees'`の値・順序・Javaコード表示の不変、全templateの`collectionId`とfixture datasetの対応一致（§5.2の単一定義源判断の機械検証） |
| P8-D21 | 取込対象外 | toMapを含む7 templateの`importable: false`＋理由文言、正規のtoMap DSL値がContract検証で受理されないこと、`tmpl-collect-groupby-mergedemo`は`importable: true`で既存Contract機構が受理すること、**非toMap templateのimportability・Contract内容・プロンプト文面の不変**、toMap template選択中の取込系操作が`buildScenario`へ到達しないこと |
| P8-D22 | expectedCompletion総点検 | 全実行可能template（124件）×mode（232組合せ）で、`expectedCompletion`（既定`STREAM_CONSUMED` / 失敗template`EXECUTION_FAILED`）どおりの終端・予算内・Javaコード生成（P6-D22の後継常設） |

### 12.2 Applicationテスト（P8-A）

| ID | 対象 | 必須検証 |
|---|---|---|
| P8-A01 | シナリオ切替 | toMap templateの選択がシナリオ切替意味論（タイマー停止・新revision・history初期化・READY）で成立する |
| P8-A02 | 再生・復元 | 全8 template×全modeで期待終端へ到達し、cursor移動の完全復元・snapshotCount一致 |
| P8-A03 | FAILED状態遷移 | §7.2の遷移表の全行（`COLLECT_FAILED`到達→`FAILED`＋タイマー停止 / 進む・自動再生no-op / 戻る→`PAUSED` / 再前進→履歴復元で`FAILED` / restart・シナリオ切替→`READY`）、`ERROR`用stopReason・catch経路の不使用 |
| P8-A04 | 既存経路回帰・取込Result経路 | 既存操作・既存templateのfixture経路の挙動不変、toMap template選択中の取込系操作がthrowせず失敗理由を返すこと |

### 12.3 React統合テスト（P8-R）

| ID | 対象 | 必須検証 |
|---|---|---|
| P8-R01 | toMap構造4行 | keyMapper / valueMapper / mergeFunction / mapFactoryの常設4行、省略行の意味論文言（§7.5-4） |
| P8-R02 | 蓄積・重複・merge表示 | entry蓄積順表示、重複3点表示、merge適用フロー、「既存値を保持（先勝ち）」「新しい値で置換（後勝ち）」併記、（既存値, 新しい値）の引数順 |
| P8-R03 | 実行失敗表示 | 教材上想定された実行失敗の区分表示・`IllegalStateException`・原因キー・ERRORとの文言区別、`FAILED`での進む / 自動再生の無効化と戻るの有効性。**downstream配置の失敗時に、Collector経路とbucketキーが`executionFailure`（`collectorPath` / `bucketPath`）から表示されること** |
| P8-R04 | 操作選択・補助説明・比較導線 | 操作一覧が不変（新operationIdなし）、対象外の補助説明（toConcurrentMap / toUnmodifiableMap / **数値加算merge** / key側identity）、§7.8の教材規約文言。**groupingBy比較導線**: `tmpl-collect-groupby-mergedemo`とtoMap 4 template（duplicate / first / last / concat）の相互参照文言（title / description / jdkNotes由来）が画面に表示されること（v0.11 §8.6追補・§4の1読み替え） |
| P8-R05 | 取込UI無効化 | toMap template選択中はコピー・貼付の両方が無効化され理由が表示される。非toMap templateへ戻すと復帰する |
| P8-R06 | a11y・responsive | toMap表示・FAILED表示を含むキーボード操作・focus-visible・reduced motion・狭幅縦積み |

### 12.4 E2E・視覚テスト（P8-E）

| ID | 対象 | 必須検証 |
|---|---|---|
| P8-E01 | identity成功E2E | standard実行で`Map<String, Employee>` 4 entryへ到達し、entry蓄積表示と履歴復元を確認する |
| P8-E02 | 実行失敗E2E | 重複キーで`COLLECT_FAILED`まで到達し、失敗表示（例外型・原因キー）・進む不可・戻る→再前進の復元を確認する |
| P8-E03 | merge / TreeMap / 比較導線E2E | first / last / concatの結果差（同一データ）、concatの3件連結、TreeMapのキー昇順表示を確認する。**`tmpl-collect-groupby-mergedemo`を実行して関東=`[伊藤, 渡辺, 山本]`（List蓄積）へ到達し、同一データのtoMap結果（衝突→merge / 例外）との直接比較と相互参照文言の表示を確認する** |
| P8-E04 | 総点検回帰 | 既存E2E全件が成功し、全toMap template×modeの到達チェックリスト（§10）と対応する |
| P8-E05 | 狭幅・視覚回帰 | toMap表示・FAILED表示を含むPC幅 / 狭幅・横スクロール・sticky非遮蔽を確認し、P8基準画像を新設する。既存基準画像に差分が出た場合はdiff確認の上でのみ意図的更新 |

### 12.5 JDK 25 Oracle Test（P8-O）

| ID | 対象 | 必須検証 |
|---|---|---|
| P8-O01 | toMap実行のJDK 25照合 | §8.2の10ケース（8 standard＋2 emptySource）を、Simulation Coreと固定Java 25コードでJSON文字列厳密照合する。**#3の実行失敗は`assertThrows(IllegalStateException.class, …)`相当の例外型のみを契約として照合**し、実測の例外メッセージは`OBSERVATION:`接頭辞で観測記録として保存する（メッセージ全文は照合対象にしない。v0.11 §6.2の5）。**Map結果の照合方式（既存P5方式を踏襲）**: (1) 順序保証のないMap（2・3引数版toMap・groupingBy）はキーの表示文字列の辞書順へ**正規化**して比較する（返却Mapのentry反復順序はJDKの保証対象外であり、照合契約にしない。正規化は比較のためだけでiteration order保証を意味しない）。(2) **TreeMap（#7 / #8）だけは実entry順**（中部→関東→関西）を厳密比較する（順序自体が検証対象）。(3) **encounter order・mergeの適用順は返却Mapの反復順ではなく結果値で検証する**: first / lastの結果差（伊藤 / 山本）が「(既存値, 新しい値)」の適用順を、concatの連結順（`伊藤, 渡辺, 山本`）が順次適用のencounter orderを実証する。Java側でmergeFunction呼出し順をログし`OBSERVATION:`として保存してよい（照合対象にはしない）。**追加照合**: partitioningBy空partitionの空Map（v0.11 §7の表。DSL直接構築の追加ケース） |
| P8-O02 | Oracle運用検証 | 必須suite（P1-O01〜P8-O01の8件）が各1件存在し、証跡書込みが現行Phase（`artifacts/phase-8/oracle-result.md`）のみで、実行前後に`artifacts/phase-1`〜`phase-7`のSHA-256が不変である |

Oracleランナーは既存構成（Docker + gradle + JDK 25）を踏襲し、次を必ず更新してください。

- `oracle/oracle-lib.mjs`: `SUITES`へ`P8-O01`（`writeReportPath: ['artifacts', 'phase-8', 'oracle-result.md']`）を追加。`P7-O01`の`writeReportPath`をnull化（照合は回帰として継続）。`REQUIRED_SUITE_IDS`・`CURRENT_PHASE_SUITE_ID`・`CURRENT_PHASE_REPORT_PATH`をP8へ更新。`PAST_ARTIFACT_DIRS`へ`artifacts/phase-7`追加。`p7-review.test.ts`のfixture固定化に必要なPhase 7時点構成の定数化。
- `oracle/run-oracle.mjs`: `P7` / Phase 7表記のハードコード箇所を現行Phaseへ更新。
- long値表記（`5_500_000L`等）・Map結果のJSON表現はPhase 5〜7で確立したCore表記との整合方式を踏襲し、選定判断を`docs/phase-8-decisions.md`へ記録する。

## 13. 検証手順

現在の`package.json`に合わせ、少なくとも次を実行してください。

```bash
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run test:e2e
npm run test:oracle
```

完了判定前には全件を再実行してください。追加で次を確認してください。

1. 既存P1〜P7テストIDが、§12冒頭で許可した意図的更新を除きすべて成功する。
2. P8必須テストID（39 ID）がすべて実装され成功する。
3. grep確認: `mapperAst.ts`・`validateMapper.ts`の許可範囲、`ClassifierDsl`定義、`terminalAst.ts`、`gatherAst.ts`が無変更（`git diff`で確認）。`eval` / `new Function` / 動的コード生成が追加コードに存在しない。`importContract.ts`の変更が§7.7の1点に限られ、`collectorVariants`にtoMap variantが存在しない。
4. §8.2の10ケースすべてで、実測snapshot列が確定列と一致する（P8-D07〜D12の成功で判定）。
5. toMap template選択時のUI（構造4行・失敗表示・取込無効化・補助説明）をPC幅・狭幅で目視確認する。
6. §10の総点検（124 template×232組合せ・expectedCompletion対応）が成功している。
7. 視覚回帰の期待画像の更新がすべて意図的（diff確認済み）である。
8. E2E・Oracleの書込み対象が`artifacts/phase-8`のみで、`artifacts/phase-1`〜`phase-7`が変更されない。
9. `git diff --check`、`git diff --stat`、`git status --short`で変更範囲を確認する。

テスト失敗をskip、期待値緩和、テスト削除、過度なmock、基準画像の無条件更新で隠さないでください。環境制約で未実行のテストがある場合は成功扱いせず、原因、試行内容、残作業、再実行コマンドを明記してください。

## 14. 成果物

- `docs/phase-8-decisions.md`（新規）
  - 記録対象: `employeesMergeDemo`データセット新設とSource DSL加算的追加の判断（§7.6）、データ選択の単一定義源をFixtureScenarioProviderのdatasetとした判断（§5.2）、merge結果値へ独立IDを付与しない判断（§7.5-6）、midEmpty非対応の判断（§7.6）、`expectedCompletion`フィールドの設計（§5.2）、取込対象外の実装方式（§7.7）、`SnapshotOutput.result` null許容化の棚卸し結果（§7.5）、Javaコード表記の細部（§7.4）、FAILED表示のUI設計（§9）、Oracle照合の表記整合（§12.5）、視覚回帰更新の有無と理由（§10）、その他仕様本文を変更しない範囲の実装判断。
- `docs/phase-8-completion-report.md`
- `artifacts/phase-8/`
  - PC幅 / 狭幅キャプチャ（identity成功・実行失敗・merge対比・**同一データのgroupingBy比較**・TreeMap・downstream形・取込UI無効化を含む）
  - Oracle結果（`oracle-result.md`。例外メッセージのOBSERVATION行を含む）
- `e2e/__screenshots__/`配下のPhase 8視覚回帰基準画像（新設）
- `e2e/capture-helper.ts`の`CAPTURE_TARGET_PHASE`を`8`へ変更（この1か所のみ）
- `tools/build_spec_docx.py`のv0.11対応と統合docxの再ビルド（v0.11 §9。差分mdの§参照読み替えに注意し、ビルド結果の目視確認を完了報告へ記載）
- `README.md` — Phase 8完了時のみ更新: 実装済みCollectorへtoMap 3 overloadを追加、テスト結果をPhase 8最終実測値へ、必須テストID実績へP8を追加、`test:oracle`説明（suite一覧・書込み先・SHA-256対象）の更新、総点検件数（124件×232組合せ）更新、ドキュメント一覧へ本指示書とv0.11・`docs/phase-8-*.md`を追加、`artifacts/phase-8/`を成果物一覧へ追加、ブランチ構成へ`phase-8`を追記。

`docs/phase-1〜7-completion-report.md`、`docs/phase-1〜7-decisions.md`、`artifacts/phase-1`〜`phase-7`は過去の記録として保持し、書き換えないでください。

## 15. Phase 8完了条件

次をすべて満たした場合だけ「Phase 8完了」と判定してください。

- v0.11 §9の完了条件（構造4行表示・§6のsnapshot列・実行失敗契約・決定性・§7の特殊ケース・§8のDSL検証がJDK 25実測回帰照合〔例外は型のみ〕を含めて成立し、既存P1〜P7テストが全件成功〔§12冒頭の意図的更新を含む〕）を満たす。
- v0.11 §2.1の3 overloadがCollector AST→validate→Runtime→Step Engine→セッション→template / fixture→UI→テスト→Oracleまで縦断実装されている。新operationIdが追加されていない。
- 本指示§7の確定値（SnapshotKind 5値・completion / PlaybackState新値・ExecutionFailureView / TO_MAP view・DSL / merge whitelist・mergeDemoデータセット・template 8形 / fixture 10件・取込対象外・教材規約文言）がすべて実装されている。
- §8.2の10ケースの実測snapshot列が確定列と一致し、ExecutionFailureViewの6配置検証（P8-D13〜D15）が配列完全一致で成功する。
- P8必須39 テストIDがすべて実装・成功し、既存P1〜P7テストIDが§12冒頭の許可範囲を除き変更なく成功する。
- lint、型検査、production buildが成功する。
- Playwright E2E、視覚回帰、PC / 狭幅確認、§10の総点検（expectedCompletion対応）が完了する。
- P8-O01・P8-O02がJDK 25で成功し（例外型照合・メッセージOBSERVATION保存・merge適用順 / TreeMap順 / encounter order / 空partitionの照合を含む）、`artifacts/phase-1`〜`phase-7`が不変である。
- 共有MapperDsl・ClassifierDsl・Terminal DSL・Gatherer DSL・Import Contract仕様（§7.7の1点を除く）・既存fixture経路が不変である。
- toConcurrentMap / toUnmodifiableMap実行・数値加算merge・key側identity実行・toMap取込開放を実装していない。
- 統合docx（build_spec_docx.py）へv0.11が取り込まれている。
- ユーザーの既存変更を破棄していない。

1項目でも満たせない場合は「Phase 8未完了」とし、残作業、影響、再現手順を具体的に報告してください。

## 16. 完了報告の必須項目

`docs/phase-8-completion-report.md`とチャット報告へ、次を必ず含めてください。

1. Phase 8の完了 / 未完了判定
2. 基準コミット（§3.1）と作業ブランチ
3. 実行失敗契約の実装設計概要（COLLECT_FAILEDの生成経路・FAILED遷移・EngineInvariantErrorとの分離方法）
4. `SnapshotOutput.result`null許容化の消費箇所棚卸し一覧（§5.2）
5. §8.2の10ケースの実測snapshot列と確定列の一致確認結果
6. 主な変更ファイルとアーキテクチャ上の役割
7. 実行した全コマンドと終了結果
8. テスト種別ごとの総数、成功、失敗、skip、未実行
9. P8必須39 IDを1件ずつ記載した対応表（v0.11 §9・§10の観点との対応を含む）
10. 既存P1〜P7必須IDの回帰結果と、§12冒頭で許可した意図的更新の一覧・理由
11. P8-O01 / P8-O02のJDKベンダー / バージョン、10ケース＋追加照合（partitioningBy空partition）の結果、Map結果のキー順正規化とTreeMap実順序比較の区別、merge適用順・encounter orderの結果値検証、例外メッセージ・merge呼出し順のOBSERVATION内容
12. §10の総点検（124 template×232組合せ）の結果
13. 視覚回帰基準画像の新設一覧と、既存画像を更新した場合はdiff確認結果・理由
14. PC幅 / 狭幅キャプチャの保存先
15. 統合docxビルドの実行結果と目視確認内容
16. 仕様との差異と実装判断（`docs/phase-8-decisions.md`への参照を含む）
17. 既知の問題と持越し事項（toMap取込開放・toUnmodifiableMap系・数値加算mergeの持越しを含む）
18. 最終`git diff --stat`と`git status --short`、およびcommit、push、PRを行っていないことの確認
19. v0.11 §10の判断事項8件それぞれの結論（本指示で確定済みの項目は実装との差異が生じた場合のみ記録）

「全テスト成功」「仕様準拠」だけで済ませず、コマンド、件数、ID、成果物パスを根拠として記載してください。

## 17. 停止条件

次の場合は推測で進めず、変更前または問題判明時点で停止して報告してください。

- v0.11と本指示、またはv0.8〜v0.10（v0.11 §1.1適用後）とv0.11に、実装結果を変える矛盾がある。
- §8.2の確定snapshot列を、既存engineの発行機構（collect sinkのNODE_ARRIVAL・RESULT_CONFIRMED位置・teeing排他等）と両立させられない（列を勝手に変えない）。
- **TreeMapのキー順（中部→関東→関西）またはmergeFunctionの適用順（既存値が第1引数）が、JDK 25実測と食い違った**（P8-O01）。
- v0.11 §7の「導出」区分（空stream→空Map）で、導出と実測が食い違った。
- 基準コミットが現在の`phase-8`の祖先でない。
- worktreeに§3.2の例外以外の未確認ユーザー変更がある。
- Phase 1〜7回帰テストが変更前から失敗する。
- SnapshotKind・SimValue・TypeRef・`instantiateTemplate`・共有DSL（Mapper / Classifier / Terminal / Gatherer）・Import Contract（§7.7の1点を除く）の破壊的変更が必要になる。
- `SnapshotOutput.result`のnull許容化が、`COLLECT_FAILED`以外のsnapshotへ波及する設計になってしまう。
- §12冒頭の許可範囲を超える既存テスト書き換えが必要になる。
- 仕様にない依存追加、サーバー、AI接続、任意コード実行が必要になる。

## 18. 最終禁止事項

- v0.8・v0.9・v0.10・v0.11の各仕様書を変更しない（統合docxは`tools/build_spec_docx.py`経由の再ビルドのみ）。
- Phase 1〜7の完了報告・判断記録・証跡（`artifacts/phase-1`〜`phase-7`）を書き換えない。
- toMapを取込対象にしない。手動連携の仕様を変更しない。
- toConcurrentMap / toUnmodifiableMapを実行しない。任意コードを実行しない。`eval`・`Function`を使用しない。
- 共有MapperDsl・ClassifierDsl・Terminal DSL・Gatherer DSLのホワイトリスト・許可範囲を変更しない。
- TypeScript例外で実行失敗を表現しない（失敗は正規のsnapshot列。`EngineInvariantError`はエンジン内部不整合専用のまま）。
- 例外メッセージ全文を表示・照合の契約にしない（型のみ。実測はOBSERVATION保存）。
- 検証を通らないDSL・templateをStep Engineへ渡さない。
- UIで結果、型、蓄積状態、表示順を独自計算しない。
- JDK内部の評価順・例外送出タイミングを断定表示しない（§7.8の教材規約文言を使う）。
- 失敗、skip、未実行、仕様差異を隠さない。
- ユーザーの変更を削除、stash、reset、checkoutで破棄しない。
- 別途指示なしにcommit、push、PR、mergeを行わない。

Phase 8の実装、検証、証跡作成、完了報告まで実行してください。

---

## 使用方法

1. ローカルPCで対象リポジトリを最新化し、`phase-8`ブランチへ切り替えます。
2. プロジェクトルートでClaude Codeを起動します。
3. この文書の「Java Stream API 可視化シミュレーター Phase 8実装指示」以降を渡します。
4. Claude Codeの完了報告後、コード、テスト、キャプチャ、`docs/phase-8-completion-report.md`をレビューします。
