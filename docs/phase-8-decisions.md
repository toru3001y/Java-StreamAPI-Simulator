# Phase 8 判断記録（Collectors.toMap）

対象: `docs/Java_Stream_API_Visualization_Spec_v0.11_toMap.md`（v0.11）と
`docs/Claude_Code_Phase8_Implementation_Instructions.md`（Phase 8実装指示書）が
仕様本文を変更せずに実装側へ委ねた事項の確定内容。

基準コミット: `4575628`（Phase 7完了・運用ファイル整理済みの`main`。PR #9のmerge commit）
作業ブランチ: `phase-8`

---

## 1. `employeesMergeDemo`データセット新設とSource DSLへの加算的追加（指示§7.6）

**判断**: merge実演用の補助Employeeデータセット（5件）を`src/domain/fixtures/mergeDemoEmployees.ts`へ
新設し、`collection` sourceの`collectionId`へ`'employeesMergeDemo'`を**加算的に追加**した。

**理由**:

- v0.11 §8.6-4は「同一キーへ3件以上が衝突するデータ」を要求するが、基準4件（`STANDARD_EMPLOYEES`）
  では同一regionの衝突が最大2件（関東×2）にとどまり、concatの順次適用（`伊藤, 渡辺, 山本`）を
  実演できない。
- 既存`STANDARD_EMPLOYEES`の値・順序・elementIdは Phase 1〜7の全証跡・全期待値の基準であり、
  変更は禁止（指示§6.2）。したがって別データセットの新設が唯一の選択肢となる。
- Source DSLへの加算的追加は、Phase 5のPredicate DSLへのlong定数加算的追加
  （`docs/phase-5-decisions.md` §13.7）の前例に従う。既存`'employees'`の挙動・表示は不変
  （P8-D20で機械検証）。

**設計**:

- elementIdは`emp-101`〜`emp-105`（既存`emp-001`〜`emp-004`と衝突しない）。
- 部署recordは既存fixtureと同形（開発部 / 技術本部、営業部 / 営業本部）とし、Javaコード表示の
  部署変数名が既存規約（`development` / `sales`）のまま解決されるようにした。
- 関東3件（伊藤・渡辺・山本）で3件以上の衝突を成立させる。

## 2. データ選択の単一定義源（指示§5.2）

**判断**: **データ選択の単一定義源は`FixtureScenarioProvider`のdataset**とし、
`collectionId`は検証・表示・Javaコード上の識別子に限定した。

**理由**: 現行`materializeSource`は外部から渡された`employeeDataset`を具現化する構造であり、
`collectionId`でデータを選択していない。この構造を変更すると Phase 1〜7 の全fixture経路
（取込経路を含む）へ影響が及ぶ。指示§6.2の「`FixtureScenarioProvider`のrevision形式・
fixture経路の挙動は不変」と両立させるため、`collectionId`は識別子のままとした。

**担保**: `collectionId`とtemplate / fixtureのdataset対応が崩れていないこと
（= fixtureのelementIdが`collectionId`の示すデータセットの部分集合であること、
Phase 8のmergeDemo系5 templateは補助データセット5件をそのまま使うこと）をP8-D20で機械検証する。
`midEmpty`等の一部fixtureは基準データセットの部分集合を用いるため、対応検証は完全一致ではなく
部分集合＋Phase 8 templateの完全一致とした。

**Javaコード表示**: `collectionId`をそのままJava変数名として用いる
（`employees.stream()` / `employeesMergeDemo.stream()`、宣言行も`List<Employee> employeesMergeDemo = List.of(`）。
既存`'employees'`の表示は完全に不変。

## 3. merge結果値へ独立IDを付与しない判断（指示§7.5-6、v0.11 §6.4）

**判断**: merge結果値へ独立の値ID（ElementId・`<nodeId>-merge-<n>`形式の合成ID）は**付与しない**。

**理由**:

- Map entryはPipelineを流れる要素ではなく、Collectorの内部蓄積値である。
- 既存Collectorの蓄積値（counting / summing / joining等）もElementIdを持たない前例がある。
- 復元契約・決定性（P8-D17）は、entryの`keyRef`（安定キー文字列）と`valueLabel`、および
  `ExecutionFailureView`だけで満たせる（P8-D17が機械検証済み）。
- 合成IDを導入すると、mergeが順次適用されるたびにIDが変わるか、あるいは初回IDを保持するかの
  追加規約が必要になり、教材上の価値に対して契約が増えすぎる。

**代替の担保**: `ToMapEntryView`は`keyLabel` / `keyRef` / `valueLabel` / `valueTypeLabel`の4項目を持ち、
`ExecutionFailureView`は値参照を「表示ラベル + 安定キー文字列」のペアで保持する
（既存`CollectorMapEntryView`の`keyLabel` / `keyRef`前例）。SimValueを直接保持しないため
`structuredClone` / `deepFreeze`可能なプレーンな木のままである。

## 4. midEmpty非対応の判断（指示§7.6）

**判断**: `midEmpty`（途中0件）は**全Phase 8 templateで非対応**とした。

**理由**:

1. 空Map成立の教材価値は`emptySource`と重複する（toMapの空入力結果は全overloadで空Map）。
2. 失敗template（`tmpl-collect-tomap-duplicate`）では、midEmptyのfilterで全件除外されると
   重複キーへ到達する前に要素が尽き、`expectedCompletion: 'EXECUTION_FAILED'`と矛盾する
   （終端が`STREAM_CONSUMED`になる）。
3. Phase 7（Gatherer）でも同じ理由でmidEmptyを非対応とした前例がある
   （`docs/phase-7-decisions.md`）。

**担保**: P8-D20が全Phase 8 templateの`supportedModes`に`midEmpty`が含まれないことを検証する。

## 5. `expectedCompletion`フィールドの設計（指示§5.2、v0.11 §1.2）

**判断**: `PipelineTemplate`へ**任意フィールド**`expectedCompletion?: 'STREAM_CONSUMED' | 'EXECUTION_FAILED'`
を追加し、未指定は`'STREAM_CONSUMED'`とした。導出は`expectedCompletionOf(template)`へ一元化した。

**理由**:

- 既存125 templateのうち124件は正常完了であり、必須フィールドにすると全templateの書き換えが
  必要になる（既存templateの意味を変えない加算的変更にしたい）。
- 走査系テスト（P8-D22）が単一の導出関数を通すことで、「未指定 = STREAM_CONSUMED」の規約が
  1か所に閉じる。

**担保**: P8-D22が「`expectedCompletion`を明示しているtemplateは`tmpl-collect-tomap-duplicate`
の1件だけ」「未指定templateの導出値は全件`STREAM_CONSUMED`」を機械検証する。

## 6. 取込対象外の実装方式（指示§7.7）

**判断**: toMapは手動連携の取込候補へ**開放しない**（ユーザー決定 2026-08-13。gatherの前例に従う）。
実装は`src/application/importContract.ts`への**1点のみ**とした。

- `hasToMapCollectorSlot(template)`: collector slotの`allowedCollectorKinds`に`'toMap'`を含むか
  （template定義由来の導出。新規template属性は追加しない）。
- `buildTemplateContract`のimportable導出へ上記条件を追加し、`disabledReason`へ
  `TO_MAP_NOT_IMPORTABLE_REASON`を設定する。

**collectorVariantsへtoMap variantを追加していない**ため、仮に取込へ到達しても
Contract検証が「未定義kind」として拒否する（二重の防御）。`slotSpecOf`への追加は不要
（gatherのような新slot kindは増えないため）。

**`tmpl-collect-groupby-mergedemo`はtoMap非含有**（既存`groupingBy` kindのみ）であり、
通常どおり`importable: true`である。既存Contract機構（groupingBy variant）が受理する。

**担保**: P8-D21（7 templateのimportable:false・理由文言・Contract拒否・非toMap templateの
importability / Contract内容 / プロンプト文面の不変）とP8-A04 / P8-R05。

**プロンプト文面の不変検証の粒度**: `tmpl-collect-groupby-mergedemo`のtitleは教材上の相互参照として
「toMapとの対比」に言及するため、プロンプト全文の「toMap非含有」では検証できない。
**許可範囲の言語化**（`"toMap"`というkind列挙、`Collectors.toMap`、`mergeFunctionId`、`valueMapper`）
が現れないことで検証する形とした。

## 7. `SnapshotOutput.result` null許容化の棚卸し（指示§7.5-2）

**判断**: `SnapshotOutput.result`を`TerminalResultView | null`へ変更し、**nullになるのは
`COLLECT_FAILED`のみ**とした。

**棚卸し結果（`result`を消費する全箇所）**:

| 箇所 | 対応 |
|---|---|
| `src/domain/engine/stepEngine.ts`（`TimelineBuilder.push` / `materialize`） | `executionFailure`が非nullのときだけ`terminalResult`をnullにする単一の分岐を`push`へ集約した。他の生成経路は変更なし |
| `src/ui/components/MainSimulation.tsx`（`TerminalResultOutput`） | 冒頭で`result === null`を判定し、`ExecutionFailureResult`へ委譲する**null分岐1か所**を追加 |
| `src/ui/components/MainSimulation.tsx`（`NestedResult`・`MapResult`・`CollectionResult`） | Map値・コンテナ値は`TerminalResultView`（非null）のままであり変更なし |
| `tests/p5-oracle-expected.ts` / `p6` / `p7` / `p8-oracle-expected.ts` | 対象templateが正常完了のみのため実質影響なし。P8側は`result`のnullチェックを明示的に書いた |
| 既存テスト（P1〜P7） | `output.result`の参照はすべて正常完了snapshotに対するものであり、型エラー・実行時エラーとも発生しなかった（`npm run typecheck`・`npm run test:unit`で確認） |

`COLLECT_FAILED`以外へnullが波及していないことは**P8-D16が全実行可能template × 全modeを走査して
機械検証**する（現在のtemplate集合ではnullは1件のみ）。

## 8. Javaコード表記の細部（指示§7.4）

**判断**:

- `identity` → `Function.identity()`（公式API Note の表記）。
- `fieldAccess` → `Employee::<field>`（既存mapperのJava表記を流用）。
- mergeFunction → `first`: `(a, b) -> a` / `last`: `(a, b) -> b` / `concat`: `(s, a) -> s + ", " + a`。
- 4引数版の第4引数 → `TreeMap::new`。
- 省略引数は表示しない（overload形がそのまま読める）。

**`Function.identity()`の`import`表示について**: 生成Javaコードには元々`import`文を一切表示していない
（`Collectors` / `List` / `LocalDate`等もすべて非修飾で表示する既存規約）。`Function.identity()`も
同じ規約に従い`import`行を追加しない。**既存の表示規約を変更しないこと**を優先した判断であり、
Javaコードパネルの見た目は他のCollector templateと完全に揃う。

**担保**: P8-D19が8 templateの`.collect(...)`行を文字列完全一致で検証し、Unicode矢印の混入なし
（ASCII構文）も検証する。実データとの一致はP8-O01がJDK 25実測と照合する。

## 9. teeing branchへのtoMap配置（Phase 8未実装事項）

**状況**: 指示§8.1-5・§12.1（P8-D18、P8-D15のteeing部分）は teeing branch直下・branch内部への
toMap配置の実行と列検証を要求している。

**判明した制約**: `resolveCollectorType`の`teeing`分岐は、merger recordの型契約に従い
**左branch = `Long` / 右branch = `Double`** の結果型を要求する。`TEEING_MERGER_IDS`は
`'SalarySummary::new'`（`record SalarySummary(long employeeCount, double averageSalary)`）の
**1件のみ**である。toMapの結果型は`Map<K, U>`（TypeRef kind = `map`）であるため、
`teeing(toMap(…), …)` / `teeing(…, toMap(…))` は**どう構築しても`TYPE_MISMATCH`で検証に落ち、
Step Engineへ到達できない**（`createNode`が`resolveCollectorType`の失敗でthrowする）。

**判断**: 指示§11「既存ホワイトリストの変更をしない」を守り、**teeing merger IDを追加しない**
（ユーザー決定 2026-08-13）。teeing branch配置の実行検証は本Phaseでは実施できないため、
**Phase 8未実装事項**として完了報告へ記載する。

**必須IDの扱い**: **P8-D18は未実装ID、P8-D15は部分実装ID**とし、いずれも成功件数に数えない
（P8必須39 IDのうち完全成功は37）。P8-D15はv0.11 §6.2の9が要求する6配置のうち
teeing branchの1配置が未検証である。

**実装側の状態（未検証であることの明示）**: teeing branch経路のtoMap実装は**到達不能なため
一度も実行されておらず、動作は未検証**である。「実装済み・検証済み」とは記載しない。

| 箇所 | 状態 |
|---|---|
| `isLeafAccumulator`がtoMapをleafと判定（default分岐） | コード上そうなるが**未実行・未検証** |
| `overrideKind = 'TEE_BRANCH_ACCUMULATED'`による`CONTAINER_UPDATED`置換 | 既存機構に乗るはずだが**未実行・未検証** |
| 失敗要素で`TEE_BRANCH_ACCUMULATED`を発行しないガード（teeing分岐へ追加） | **未実行・未検証** |
| 左右branch間の`ctx.path`復元 | **未実装**（下記残作業(1)） |
| 初回`TEE_BRANCH_ACCUMULATED` / 0件branchの`TEE_BRANCH_FINISHED`へのTreeMap生成context | **未実装**（下記残作業(3)） |

**代替の担保（契約の充足ではない）**: P8-D06 / P8-D15 / P8-D18が「teeing × toMapが
`TYPE_MISMATCH`で拒否される」ことを機械検証し、制約自体を記録として固定する。あわせてP8-D18が
既存teeing templateのsnapshot列（`TEE_BRANCH_ACCUMULATED` 8件・`TEE_BRANCH_FINISHED` 2件・
`TEE_MERGER_APPLIED` 1件）がPhase 8で変化していないことを回帰検証する。
**これらはP8-D15 / P8-D18の契約を検証するものではない。**

**残作業（将来merger IDを追加して到達可能にする場合に必要）**:

1. **左右branch間の`ctx.path`復元**: `accumulateNode`のteeing分岐は`ctx.pathLabels`の長さのみ
   戻し、`ctx.path`を戻していない。そのため右branch処理時の経路は`['c0','c0.left','c0.right']`
   になる。v0.11 §6.2の9が右branch失敗に期待する`['c0','c0.right']`と一致しないため、
   `ctx.path`の復元が必要。**ただしこの経路はPhase 5の既存teeing snapshot（`currentPath`）契約
   でもあるため、変更時は既存P5テスト・視覚回帰基準画像への影響評価が必須**（Phase 8では
   既存列を変えない方針を優先し、変更していない）。現状は
   `tests/domain/p8-failure.test.ts`の「P8-D18(残作業の固定)」が既存挙動を機械的に固定している。
2. **branch直下 / branch内部（adapter経由）の更新kind排他のtoMapでの実行検証**:
   branch直下は`CONTAINER_UPDATED` → `TEE_BRANCH_ACCUMULATED`置換、branch内部は内部
   `CONTAINER_UPDATED`＋branch確定の別事象、失敗要素は`TEE_BRANCH_ACCUMULATED`不発行、の3分岐。
3. **初回`TEE_BRANCH_ACCUMULATED` / 0件branchの`TEE_BRANCH_FINISHED`へのTreeMap生成context**:
   v0.11 §6.3の親種別表（teeing行）が要求する「branchのdownstream Map生成表示」は**未実装**。
   現状は生成表示を持たないことをテストで固定している。

**持越し**: toMapをteeing branchへ配置可能にするには、Map結果を受け取れるmerger record
（例: `record RegionIndex(Map<String, String> byRegion, long count)`）の追加が必要であり、
教材データ定義の拡張として将来Phaseで扱う。

### 9.1 再検討: 本件に限り制約を外せるか（2026-08-13、Phase 8締め直前）

「teeing × toMapの1点に限って制約を外し、実装・検証を通せないか」を再評価した。
次の3案を比較し、**結論は現状維持（将来Phaseで扱う）**である。

| 案 | 内容 | 評価 |
|---|---|---|
| A | Map結果を受け取れるmerger recordを追加する | 筋は通るが**独立Phase規模**（下記の影響範囲）。v0.11に定義がないため仕様追補が必要 |
| B | teeing × toMapのときだけ型検証をスキップする | **却下**。`javaCode.ts`のrecord定義行は`record ${recordName}(${javaType} ${name})`を機械生成するため、`long`のフィールドへ`Map<K, U>`を渡す**コンパイル不能なJavaコード**が画面へ表示される。P8-D19（Javaコード表示の構文的正当性）およびJDK 25実測照合（P8-O01）と正面衝突し、教材の根幹契約を壊す |
| C | テスト専用に型検証をバイパスしてStep Engineへ直接流す | `createNode`が`resolveCollectorType`の失敗でthrowするため、production側へ検証を飛ばす入口を設ける必要がある。アプリ操作から到達できない経路の検証となり、productionへ裏口が残る |

**A案の影響範囲（見積もり）**: merger record 1件の追加では閉じない。

| 箇所 | 必要な作業 |
|---|---|
| `collectorAst.ts` | `TEEING_MERGER_RECORDS`のフィールド型が`javaType: 'long' \| 'double'`固定であり、**Map型を表現できない**。型表現の拡張が必要 |
| `validateCollector.ts` | teeing分岐の照合が`'Long'` / `'Double'`決め打ち（`branch.kind === 'object'`前提）。TypeRefベースへの書き換えが必要 |
| `javaCode.ts` / `DetailsDisclosure.tsx` | record定義行の生成をジェネリクス型へ対応（2箇所） |
| `snapshot.ts` | `TerminalResultView`の`RECORD` variantは`valueLabel: string`の単一文字列。Map値を1行へ潰すか、view型を拡張するかの判断が要る |
| `collectorRuntime.ts` | merger適用時のMap branch値ラベル生成 |
| `oracle/OracleP8.java` | 新recordを用いたJDK 25実測の取得と照合 |
| 仕様書 | v0.11に定義がないため追補・統合docx再ビルド・codexレビュー |

**A案でも自動解決しない点**: 上記の残作業(1)（`ctx.path`復元）と(3)（TreeMap生成context）は、
merger IDを追加して到達可能にしても**未実装のまま残る**。とくに(1)は
**Phase 5の既存teeing snapshot契約（`currentPath`）の修正**を伴い、既存P5テストと
視覚回帰基準画像への波及評価が必要である。したがって「制約を外せばテストを書くだけで済む」
という関係にはなく、teeingを主題とするPhaseで残作業(1)〜(3)とあわせて扱うほうが
回帰リスクを制御しやすい。

**決定（2026-08-13、ユーザー決定）**: Phase 8は現状のまま締める（完了判定は
`docs/phase-8-completion-report.md` §1のとおり**未完了を維持**する）。teeing × toMapはA案を
独立Phaseとして扱い、その際に残作業(1)〜(3)を同時に解消する。

### 9.2 実施記録: A案の実施（2026-08-13、Phase 9）

§9.1のA案をPhase 9（ブランチ`phase-9`、仕様v0.12差分
`docs/Java_Stream_API_Visualization_Spec_v0.12_TeeingToMap.md`）として実施した。

- `TEEING_MERGER_IDS`へ`'RegionIndex::new'`（`record RegionIndex(Map<String, String> byRegion, long count)`）
  を追加し、merger fieldの型表現を表示用Java表記（`javaType: string`）+ 検証用`expected: TypeRef`
  （`typeRefEquals`による構造比較）へ拡張した。新mergerも2フィールドrecordとし、
  左=fields[0] / 右=fields[1]の位置対応は変更していない。
- 残作業(1)（`ctx.path`復元）・(2)（更新kind排他の実行検証: branch直下の成功put / merge /
  重複キー失敗、およびbranch内部〔adapter経由〕の内部`CONTAINER_UPDATED` + branch確定の
  別事象発行）・(3)（branch Map生成表示）を同時に解消した。(1)のPhase 5波及は実測ゼロ
  （P5テストに右branch経路のassertなし、視覚回帰基準画像はmerger適用時点のみで画素不変）。
- codexレビュー第1回（高-1）で、branch内部（adapter経由）の検証欠落と、生成注記の「初回」判定を
  Mapのentry有無から導出していたことによる**注記の重複発行バグ**（filter除外でMapが空のまま
  次要素へ進むケース）の指摘を受けた。注記の発行済み管理を`TeeRuntime`の独立フラグ
  （`leftCreationNoted` / `rightCreationNoted`）へ変更し、adapter経由の排他列・
  注記が全snapshot列で正確に1回であること（初回要素除外・全要素除外の両ケース）を
  テストへ追加して解消した（v0.12 §3・§6・§7へ反映）。
- §9.1の影響範囲見積もりのうち`snapshot.ts`のview型拡張は**不要**だった（Map値は既存の
  `{k=v, …}`1行ラベル生成を流用し、`RECORD` variantの`valueLabel: string`のまま収まった）。
  それ以外の7ファイル + 仕様追補 + JDK実測は見積もりどおり。
- B案（型検証スキップ）・C案（テスト用バイパス）の却下判断は維持した。JDK 25実測（P8-O01への
  `teeingToMapByRegion` / `teeingToMapCount`キー追加）が、RegionIndex入り生成Javaコードの
  コンパイル可能性（B案却下理由の前提）の裏取りを兼ねる。

詳細はv0.12差分の§2〜§6と`docs/phase-8-completion-report.md` §17-1の追記。

## 10. FAILED状態のstopReason（指示§7.2、v0.11 §6.2の3・4）

**判断**: `PlaybackState`へ`'FAILED'`を追加し、**`stopReason`は設定しない**（nullのまま）。

**理由**: 指示§7.2は「`FAILED`は`ERROR`の機構を使わない。`stopReason`のERROR文言を流用せず、
`FAILED`専用の表示情報（§9）を持つ」と定める。`stopReason`は`SessionState`上で
「LIMIT_REACHED / ERROR の停止理由」と定義された既存フィールドであり、これを再利用すると
区分が曖昧になる。FAILED専用の表示情報は**`Snapshot.executionFailure`（構造化view）**が持ち、
UIはそこからのみ描画する。

**遷移の実装**（v0.11 §6.2の4の表と1対1）:

| 事象 | 実装 |
|---|---|
| `COLLECT_FAILED`到達（手動・自動再生とも） | `stepForwardOnce`で`next.completion === 'EXECUTION_FAILED'` → `finishAuto('FAILED')`（タイマー停止） |
| `FAILED`で進む / 自動再生開始 | `stepForwardOnce`冒頭・`play()`冒頭のガードでno-op |
| `FAILED`で戻る | `stepBack`は`ERROR`のみ拒否。`derivePassiveState()`が1件前で`PAUSED`を返す |
| 保存済み`COLLECT_FAILED`へ再前進 | 履歴内移動で`atFailedSnapshot()` → `finishAuto('FAILED')`（再計算しない） |
| restart / シナリオ切替 | 既存どおり`READY`（`stopReason`もnullへ） |

**担保**: P8-A03が上記の全行と「ERROR用stopReason・catch経路の不使用」を機械検証する。

## 11. 実行失敗の伝搬設計（指示§16-3、v0.11 §6.2の2）

**判断**: 失敗は**TypeScript例外ではなく戻り値・状態**で伝搬する。

- `collectorAccumulate`の戻り値を`ExecutionFailureView | null`へ変更した。
- 内部走査では`WalkCtx.failure`（可変フィールド）へ格納し、composite Collector
  （flatMappingの子要素ループ・teeingのbranchループ）は`ctx.failure !== null`で走査を打ち切る。
- Step Engine（`buildTimeline`）は`collectFailure`変数へ受け、`COLLECT_FAILED`を発行して
  `b.cancelAt(chain.length)`で上流を停止し、finish cascade・`RESULT_CONFIRMED`・`STREAM_CONSUMED`を
  発行せずに`materialize`へ抜ける。
- `EngineInvariantError`の送出・catch経路（`session.ts`）は一切使用しない。

**担保**: P8-D16が「`nextSnapshot`が全ステップで正常return（throwしない）」「`COLLECT_FAILED`の次は
`null`を返す」を機械検証する。P8-A03が「`playbackState`が`ERROR`にならない・`stopReason`がnullのまま」
を検証する。

## 12. `CONTAINER_CREATED`の実効root判定（指示§8.1-1）

**判断**: toMapの`CONTAINER_CREATED`判定は、adapter系（mapping / flatMapping / filtering /
collectingAndThen）の連なりを辿った**実効rootコンテナ**が4引数版toMapかどうかで行う
（`effectiveContainerNode`）。

**既存対象（`toCollection`）の判定は変更していない**（`rt.root.dsl.kind === 'toCollection'`のまま）。
指示§8.1-1がtoMapについてのみ実効root判定を要求しており、既存SnapshotKindの発行規則を
変更しない（指示§6.2）ためである。現行templateに`filtering(…, toCollection(…))`は存在せず、
挙動差は生じない。

**担保**: P8-D11が`filtering(…, toMap(…, TreeMap::new))`でも`CONTAINER_CREATED`が`INITIAL`直後に
正確に1回発行されること、adapter経由の3引数版では発行しないこと、2・3引数版のroot・downstream配置で
発行しないことを機械検証する。

## 13. bucket内downstream Mapの生成表示（指示§8.1-4、v0.11 §6.3）

**判断**: groupingBy配下にtoMapがある場合、**新規bucket生成時の`BUCKET_SELECTED`のjdkNote**へ
downstream Map（TreeMap等）の生成表示を加算する（`bucketDownstreamCreationNote`）。
既存bucket選択時・downstreamがtoMapでない場合は**既存の文言をそのまま返す**（1文字も変えない）。

partitioningByについては、2 bucketが実行開始時に事前生成される既存実装により、
**`INITIAL`時点からCollector構造viewへ両partitionのdownstream Map（`TO_MAP`蓄積view・
containerLabel = TreeMap）が現れる**。これが v0.11 §6.3の「partitioningBy構造の初期表示context」に
相当するため、`BUCKET_SELECTED`のjdkNoteは変更しなかった。

**担保**: P8-D12が両方（groupingBy配下の新規bucket時のみ生成表示・既存bucket時は非表示、
partitioningByの初期表示と0件partitionの空TreeMap）を機械検証する。

## 14. Oracle照合の表記整合（指示§12.5）

**判断**: Phase 5〜7で確立した方式を踏襲し、次の形で照合する。

| 対象 | 方式 |
|---|---|
| 順序保証のないMap（2・3引数版toMap・groupingBy・nested Map） | `キー=値`文字列の**辞書順へ正規化**して比較（正規化は比較のためだけであり、iteration order保証を意味しない） |
| TreeMap（4引数版・partitioningBy配下） | **実entry順のまま**厳密比較（順序自体が検証対象） |
| encounter order・mergeの適用順 | 反復順ではなく**結果値**で検証（first→伊藤 / last→山本 / concat→`伊藤, 渡辺, 山本`） |
| 2引数版の重複キー | **例外型のみ**（`IllegalStateException`）。衝突キー・2値は固定Javaコード側でencounter orderから独立に導出して照合する。**例外メッセージ全文は照合対象外**（`OBSERVATION:`行として観測記録に保存） |
| mergeFunctionの呼出し順 | `OBSERVATION:`行として記録（厳密比較の対象外） |
| 値の表記 | Coreの`formatSimValue` / `formatLongLiteral`へ両側で揃える（Employee = `氏名（age=NN）`、String = クォート付き、long = 3桁区切り + L） |

**JDK 25実測OBSERVATION（2026-08-13。openjdk 25.0.3 Temurin-25.0.3+9）**:

- `toMap2Arg.exceptionMessage=Duplicate key 関東 (attempted merging values 伊藤 and 渡辺)`
- `toMap3Arg.mergeCallOrder=merge(伊藤, 渡辺) | merge(伊藤, 渡辺, 山本)`
  → mergeFunctionの第1引数が**Map内の既存値**（前回merge結果）であることを実測で確認した（v0.11 §3.2）。
- `toMap2Arg.returnedMapClass=HashMap` / `toMap4Arg.returnedMapClass=TreeMap`
  → 2引数版の返却Map型はJDKの保証対象外であり、教材では型名を断定表示しない。
- `partitioningBy.keySet=[false, true]`

## 15. 視覚回帰基準画像の更新とPhase 8基準画像の安定化（指示§10）

**判断**: 既存（P1〜P7）の視覚回帰基準画像は**1件も更新していない**（`git status`で
`e2e/__screenshots__/`配下の既存ファイルに変更なし）。Phase 8分の基準画像は
`e2e/__screenshots__/p8-capture.spec.ts/`および`p8-narrow.spec.ts/`配下へ**新設**した
（PC幅6件・狭幅2件）。**色比較のthreshold・`maxDiffPixels`は緩和していない**
（`playwright.config.ts`は無変更）。

**Phase 8基準画像の安定化（codexレビュー中-3の調査中に発見）**: 新設した
`p8-e05-groupby-mergedemo.png`のfullPage比較が、**間欠的に**98ピクセル（全体の0.01%）の差分を
出した（6回中1回。worker数を1にしても発生）。差分ピクセルを集計すると閾値超過分は
**y=2295〜2307の13px帯に限局**しており、ページ最下部の`DetailsDisclosure`
（閉じた`<summary>`行）である。actual / expectedの当該領域を切り出して拡大比較した結果、
**表示内容は完全に同一**で、サブピクセルのレイアウト丸めによる1pxのゆらぎであった。

**対応**: thresholdを緩めず、**この1要素だけを比較対象から外す**方法を採った。
P8-E05の8枚へ`mask: [page.getByTestId('details-disclosure')]`を指定し
（`e2e/p8-capture.spec.ts` / `p8-narrow.spec.ts`の`stableShot()`）、マスク指定に伴い
Phase 8の8枚を再生成した。再生成後、P8 specを4回連続・全E2Eを3回連続で実行し、
すべて終了コード0で安定することを確認した。

**マスクによる検証範囲の変化（正確な表現）**: マスクした`details-disclosure`要素については、
**視覚回帰の範囲が除外される**（色・境界線・余白・折返し等の視覚差は検出できなくなる）。
一方、**P8-E05の主目的であるtoMap表示・FAILED表示・狭幅レイアウトはマスク外の領域で従来どおり
比較を維持**しており、マスクしたのは主対象外の「閉じた補助欄」1要素に限られる。
当該要素の**内容面**（対象外機能の補助説明・groupingBy比較導線の相互参照文言・record定義・元データ）は
**P8-R04がDOMレベルで補完**する。thresholdも緩和していない。

## 16. その他の実装判断

- **`ToMapValueDsl`の`fieldAccess`はEmployeeの全8フィールドを許可**した（既存`EMPLOYEE_FIELDS`と
  同一範囲。指示§7.3-7）。`skills`（`List<String>`）を値にすると`Map<String, List<String>>`となり
  Javaとして正当であるため許可範囲から外していない。`concat`との組合せは値型U = Stringの制約で
  拒否される。
- **toMapのentry値のTerminalResultViewは`SCALAR` variantを再利用**した（`typeLabel` = 値型U、
  `valueLabel` = `formatSimValue`表記）。値は常に1件のスカラー相当であり、groupingByのような
  List値ではないため、新variantを追加せず既存の`MAP` + `SCALAR`の組合せで表現できる。
- **`collectorDepth` / `collectorKindsOf`は変更していない**（toMapはleafのためdefault分岐で正しく
  扱われる。P8-D01が深さ1・kind列`['toMap']`を検証）。
- **新しい`ValidationCode`を追加していない**（`STRUCTURE_INVALID` / `TYPE_MISMATCH` /
  `WHITELIST_KIND` / `WHITELIST_FIELD` / `STRUCTURE_UNKNOWN_KIND` / `COLLECTOR_DEPTH`で表現できた）。
- **`nodeContainerLabel`へtoMap分岐を追加**した（codexレビュー中-2）。追加前は`toMap`が
  `default`分岐で空文字を返し、root配置の4引数版で`CONTAINER_CREATED`の説明が
  「空の**を生成しました**」と欠落していた。導出規則は`mapContainerLabel`と同一（4引数版は
  `TreeMap`、それ以外は`Map`）にそろえた。この値を使うのは`collectorCreateContainer`だけであり
  （蓄積view・結果viewは`mapContainerLabel`を使う）、既存Collectorの表示へは影響しない。
  P8-D11がroot直下・root adapter経由の両方で`processing.evaluation`と`explanation.current`に
  `TreeMap`が含まれ「空のを生成」にならないことを回帰検証する。
- **UIの`th`へ`scope="row"`を付与**した（toMap構造4行・実行失敗表）。既存の`stats-table`と同じ
  マークアップ規約に揃え、行見出しのアクセシビリティroleを正しくするための追加である。
