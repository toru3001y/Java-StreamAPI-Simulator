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

**確定記録**: codexレビュー第2回（2026-08-13）で指摘なし承認。実装コミットは`phase-9`ブランチの
`89dd241`、Pull Requestは https://github.com/toru3001y/Java-StreamAPI-Simulator/pull/12 。
PR #12は2026-08-13にmainへマージされた（merge commit **`c994e43`**）。これによりPhase 8必須39 IDは
すべて完全成功となった。

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

## 17. 数値加算mergeファミリーの実装（2026-08-13、Phase 10 / v0.13）

v0.11 §2.2で将来拡張とされた数値加算merge（`Long::sum`等）を、Phase 10（ブランチ`phase-10`、
仕様v0.13差分`docs/Java_Stream_API_Visualization_Spec_v0.13_NumericMerge.md`）として実装した。
スコープ（3 ID + 教材template 3本）と統合docxの版運用（v0.13.docxを新規生成）はユーザー決定。

### 17.1 設計判断

- **型付きファミリーとしての設計**（v0.11 §2.2の条件）: `sumInt` / `sumLong` / `sumDouble`の
  3 IDを`TO_MAP_MERGE_IDS`へ追加し、Java表示は3引数`reduce`のcombiner表記と同一の
  メソッド参照（`Integer::sum` / `Long::sum` / `Double::sum`）とした。
- **型制約の一般化**: `TO_MAP_MERGE_META`の`requiresString: boolean`を
  `requiredValueWrapper: 'String' | 'Integer' | 'Long' | 'Double' | null`へ置換した。
  既存concatの受理・拒否結果は不変（`'String'`指定が旧`requiresString: true`と同値）で、
  `validateCollector.ts`のTYPE_MISMATCH生成をwrapper名比較へ一般化した（P8-D03へsum系
  ×不一致値型4種の拒否テストを追加）。
- **実行時range checkを追加しない**（v0.13 §3.5）: toMapは手動連携の取込対象外で外部入力経路が
  ないため、値域保証は固定fixture契約で完結する（int=int32検証+age値設計、long=safe integer
  検証+salary合計15,700,000、double=IEEE 754で両側一致）。
- **`Double::sum`はOracle照合対象**（v0.13 §3.4）: `Double.sum`は+演算子の素朴な加算であり、
  補償付き加算（`Collectors.summingDouble`系）をDoubleStream照合対象外としたPhase 6判断
  （`docs/phase-6-decisions.md` §7.2）とは非対称に、照合可能側へ倒れる。
  `(4.1 + 4.4) + 3.9`は丸め誤差が相殺されてちょうど`12.4`になる（JS/JDK両側実測一致）。
- **snapshot列は既存機構のまま**: 新SnapshotKindなし。sum系templateの列はmerge-first / lastと
  同形（32件）で、EXPECTED_SNAPSHOT_COUNTSへ3行追加のみ。
- **対象外注記の反転**: `TO_MAP_OUT_OF_SCOPE_NOTES`から数値加算merge項を削除し、
  sum系3 templateのjdkNotesへ意味論注記（intラップ〔JLS 15.18.2〕・safe integer限定・
  doubleの丸め）を新設した。P8-R04の該当assertを書き換え、sum系表示の新テストを追加した。

### 17.2 実施記録

- 新template: `tmpl-collect-tomap-merge-sumint / sumlong / sumdouble`（standardのみ、
  employeesMergeDemo・regionKeyMapper共通、titleは既存最長〔toMap identity〕以下）。
  template総数127→130 / 実行可能125→128 / mode組合せ233→236 / P8_TEMPLATE_MODES 11→14。
- oracle: P8-O01へ`toMapSumIntByRegion` / `toMapSumLongByRegion` / `toMapSumDoubleByRegion`を
  追加し、JDK 25実測（Docker gradle:9.6.1-jdk25）と完全一致（PASS）。doubleの表記は
  OracleP8.javaへ`doubleLiteral`（BigDecimal正規化。OracleP6のcoreDoubleと同規則）を追加して
  両側を揃えた。
- 統合docx: `build_spec_docx.py` / `verify_spec_docx.py`へ`--v13`（第30章）対応を追加し、
  v0.13.docxを生成・verify合格（v0.12参照の`§29.x`変換は章番号`>= 30`ガードで第26〜29章の
  出力を不変に保つ。JLSの節番号は`§`を付けない表記にして本書の節参照と区別した）。
  Phase 9で更新漏れだったビルダーdocstringもv0.13まで更新した。
- 検証: Vitest 796（+5）/ lint / typecheck / production build / Playwright E2E 93件成功。
  視覚回帰基準画像（`e2e/__screenshots__`）の更新ゼロ。E2E実行により現行Phase証跡
  `artifacts/phase-8/`のキャプチャ11枚が再生成された（toMap系ページは対象外注記の削除を反映。
  寸法・レイアウトは不変で、groupby比較ページ等の差分はフォント描画レベルの揺れのみ。
  capture-helperが現行Phaseの証跡を上書きする既存運用どおり）。
- codexレビュー第1回（2026-08-13）: **承認**（高0・中0・低1）。低1は`PREFACE_30`の
  「本章への参照行のみを追加」がv0.13の実態（v0.8本文へのポインタ追加なし・第30章の追加のみ）と
  不一致という指摘で、修正案どおり文言を反映しv0.13.docxを再生成・verify合格を確認した。
  数値意味論（v0.13 §3）はJavadoc / JLSの一次情報と一致、型制約・実行・Oracle照合方式も
  問題なしと確認された。

**確定記録**: 実装コミットは`phase-10`ブランチの`77f39ce`、Pull Requestは
https://github.com/toru3001y/Java-StreamAPI-Simulator/pull/15 。
PR #15は2026-08-13にmainへマージされた（merge commit **`8e68d75`**）。これによりPhase 8完了報告
§17の持越し事項のうち機能追加を要するもの（teeing×toMap・数値加算merge）はすべて解消となった。

## 18. unmodifiable系Collectorの実装（2026-08-14、Phase 11 / v0.14）

v0.11 §2.2で「将来のunmodifiable系一括Phaseへ持越す」とされた`Collectors.toUnmodifiableList` /
`toUnmodifiableSet` / `toUnmodifiableMap`を、Phase 11（ブランチ`phase-11`、仕様v0.14差分
`docs/Java_Stream_API_Visualization_Spec_v0.14_Unmodifiable.md`）として一括実装した。
仕様書はcodexレビュー第5回で承認済み（高0・中0・低0）。

### 18.1 設計判断

- **蓄積ラベルと結果ラベルの静的分離**（v0.14 §3.3）: 単一ラベルの状態切替ではなく、発行点ごとに
  使うラベルを静的に定めた。蓄積側は既存`nodeContainerLabel` / `mapContainerLabel`へcaseを足して
  `List（蓄積中）`等を返し、結果側は新関数`resultContainerLabelOf`を結果発行点
  （`nodeResultView`・`finisherAfterLabel`・`TEE_BRANCH_FINISHED`）でのみ使う。
  snapshotはemit時に確定viewを捕捉し「戻る」は再計算なしで復元する契約のため、状態切替方式は
  発行タイミングへの依存を生む。分離なら各発行点のラベルが静的に定まり機械検証も一意になる。
- **finisher発行契約は既存機構がそのまま実現する**: `emitsFinisher`へ3 kindを足すだけで、
  通常root（1件）/ bucketごと（`finishWithBucketContext`）/ teeing branch直下の抑止
  （`finishTeeing`の`finishNode(child, ctx, true)`）/ branch内部nested（再帰）の4配置が
  v0.14 §3.2の表どおりに成立した。追加実装はゼロで、P11-D09が発行kind・順序・回数・
  二重発行なしを機械検証している。
- **finisherの表示ラベルは意味ラベル**（v0.14 §3.2）: JDK内部実装を断定しないため
  Javaコード表記（`List::copyOf`等）ではなく**`unmodifiableへのラップ`**を確定文言とした。
  既存jdkNote（「表示上の変換があるときだけfinisher snapshotを発行します。JDKが当該Collectorで
  finisherを実行するかどうかの主張ではありません」）をそのまま適用する。
- **`DUPLICATE_KEY_DETECTED`の説明文言もkind分岐した**: v0.14 §2.3は`COLLECT_FAILED`の説明分岐
  のみを明示するが、重複キー検出の`currentText`は「2引数版の**toMap**には…」と主語を名指しする
  ため、toUnmodifiableMapでそのまま流すと誤記になる。`collectorDisplayName`で分岐し、
  既存toMapの出力は1バイトも変えていない（P11-D11が両方を固定）。
  `ExecutionFailureView`の`kind` / `exceptionType`はtoMapファミリー共用のまま構造変更なし。
- **window Gathererの完了状態に第三状態`INVARIANT_BLOCKED`を新設した**（v0.14 §4-2b・§4-3を改訂）:
  `windowFixed` / `windowSliding`が生成する合成List値は`assertNotCompositeList`によりCollectorへ
  **構造的に到達できない**（Phase 7の教材不変条件「gatherの下流はtoList / findFirstのみ」）。
  一方で改訂前の§4-2bは「登録済みの各producerをCollector境界まで到達させる検証を行う——
  windowFixed・windowSlidingを明示的に含める」と規定しており、**仕様として実行不能な要求**だった。
  当初実装は「放出点を最終観測点とみなす」解釈で`VALUE_REACHED`を記録したが、
  §4-3の定義（「Collector境界へ到達し」）を満たしておらず、codex実装レビューで高指摘となった。
  - **仕様側を改訂**して整合させた。`VALUE_REACHED`の定義は「実際にCollector境界へ到達した
    producer」に限定したまま、`INVARIANT_BLOCKED`（値生成と意味値の全件検査は完了したが、
    既存の構造的不変条件によりCollector境界への到達が禁止される）を追加し、期待状態の対応表を
    「`empty`系→`ZERO_EMISSION`、window系→`INVARIANT_BLOCKED`、それ以外→`VALUE_REACHED`」とした。
  - window系の検証内容自体は変えていない（gather放出点での全窓値の再帰検査 +
    `collectorAccumulate`への直接供給が`EngineInvariantError`で遮断される負例）。
  - **事前拒否される構成（UNBOUNDED_SOURCE等）とは区別する**: window → collectは
    Pipeline検証を**通過**し、実行時に`EngineInvariantError`となる（実測で確認）。
    したがって既存の「有効経路に含まれない」条項では説明できず、第三状態が必要だった。
- **テスト専用seamの新設**（`src/domain/engine/boundaryTap.ts`）: 非null不変条件の境界観測は
  null-guardedなモジュールフックで行う。本番実行ではフックがnullのままでコスト0であり、
  観測は読み取りに限り値・snapshot列・表示へ影響しない。あわせて`classifierKey` /
  `evaluateToMapValue` / `applyToMapMerge` / `boxValue`を**実装を変えずにexport化**した
  （評価器単位の列挙評価のため）。`classifierKey`は返却へ`value: SimValue`を追加したが、
  既存の`ref` / `label`の値・利用箇所は不変。
- **producer登録集合は機械導出**（v0.14 §4-3）: 手作業の一覧を置かず、
  (i) OperationCatalog全46 operationの全域分類（未分類1件でthrow）、
  (ii) 識別可能unionの実軸の互換直積（`arrayPrimitive(int)`と`(double)`は別producer）、
  (iii) collector内部評価器のclosed DSL定数、から導出する。導出元へ仮想operationId / 仮想kindを
  注入した複製で導出が失敗することを負例メタテストで確認している（文字列検索ではなく導出の実行）。
- **分類結果とproducer展開を双方向で突き合わせる**（codex実装レビュー中指摘への対応）:
  当初実装は`classifyOperations()`を**例外送出の副作用のためだけ**に呼び、戻り値の
  `valueProducing`を捨てていた。producer展開は`expand*`関数の固定連結でoperationIdとの接続が
  なく、「OperationCatalogにも分類表にも`VALUE_PRODUCING`として登録したが、producer展開を
  書き忘れた」場合を検出できなかった（v0.14 §4-3が要求する「カタログにもテストにも登録し
  忘れた場合を含めて機械的に失敗する」を満たしていない実装上の欠落。**仕様変更は不要**）。
  各`Producer`へ起点`operationId`を持たせ（collector内部評価器は`null`で区分）、
  「値生成として分類されたoperationの集合」と「producer展開がカバーしたoperationの集合」の
  **双方向完全一致**を`deriveProducers`で検証する形へ改めた。
  `sourceOperationIdOf` / `mapToPrimitiveOperationId` / `flatMapToPrimitiveOperationId`は
  reachテスト側の重複定義を廃してhelper側の単一定義源へ寄せた。
- **`ITERATE_PREDICATE_OPERATORS`を`sourceAst.ts`へ加算的に追加**した。iterate3のpredicate
  operator（`LTE` / `LT`）が型注釈にしか存在せず、producer導出の実軸として参照できる
  単一定義源がなかったため。`IteratePredicate.operator`の型はこの定数から導出する形へ変えており、
  受理・拒否範囲は不変。
- **`SIM_VALUE_KINDS`を`value.ts`へ追加**した（値variant網羅性の単一定義源）。
  `satisfies readonly SimValue['kind'][]`と型レベルの網羅assertにより、`SimValue`へvariantを
  足してここへ足し忘れるとコンパイルエラー、意味値検査器へ足し忘れるとP11-D16が失敗する。

### 18.2 テスト命名の線引き

Phase 9 / 10は新規テストファイルを作らずp8-\*へ追記したが、Phase 11は**ハイブリッド**とした。

- **p11-\*を新設**: `p11-dsl` / `p11-engine` / `p11-catalog` / `p11-nonnull-catalog` /
  `p11-nonnull-reach`（tests/domain）、`p11-app.test.tsx`（tests/react）、
  `tests/p11-helpers.ts` / `tests/p11-nonnull-helpers.ts`。理由は(1) unmodifiable系はtoMapの
  拡張ではなく新kind族（Phase 7→p7・Phase 8→p8の前例と同型）、(2) §4の非null検証は
  OperationCatalog全域を走る横断機構でありp8の名に収まらない、(3) p8-engine.test.tsは既に
  大型でPhase 9 / 10の追記済み。describe IDは`P11-D01`〜`P11-D17` / `P11-R01`〜`P11-R04`。
- **p8-\*へ追記**: oracle同期（v0.14 §5.3が「P8-O01への追加」と明記）、template総数等の
  ハードコード値、対象外注記の削除に伴うP8-R04の書換え。

### 18.3 既存テストのassert更新（v0.14 §6が許容する範囲）

- 件数: `ALL_TEMPLATES` 130→**133** / 実行可能 128→**131** / mode組合せ 236→**241** /
  `P8_TEMPLATES` 12→**15** / `P8_TEMPLATE_MODES` 14→**19**（standard 15・emptySource 4）。
- **P8-D21の等式を和集合形へ書き換えた**: 従来の
  「`TO_MAP_TEMPLATES` = `P8_TEMPLATE_IDS` − groupby比較template」はunmodifiable系3件が
  `P8_TEMPLATES`へ加わったことで成立しない。「P8 template群の取込対象外 = toMap含有 ∪
  unmodifiable含有」の**和集合等式 + 両者の排他**へ書き換え、意味（導出がtemplate定義由来である
  こと）は保っている。
- **`IMPORTABLE_TEMPLATES`（tests/p6-helpers.ts）の除外条件へunmodifiable系を追加**した。
  Phase 8がtoMapで行った更新と同型で、`EXECUTABLE_TEMPLATES`の意味・値は変更していない。
  これによりP6-D01〜D03 / P6-A03 / P7-D21 / P8-D21の「非対象外templateは全てimportable」
  assertが従来の意味のまま通る。
- **P8-R04の書換え**（§6が明示的に許可する唯一のP8 UI書換え）: 対象外注記からtoUnmodifiableMap項が
  消えたため、「対象外注記は`TO_MAP_OUT_OF_SCOPE_NOTES`の2件だけである」ことを検証する形へ変えた。
- P8-A04 / P8-R05は取込対象外である点は同じで、理由文言だけがkindごとに分かれる形へ更新した。

### 18.4 実施記録

- 新template 3件: `tmpl-collect-tounmod-list`（standard / emptySource）/
  `tmpl-collect-tounmod-set`（同）/ `tmpl-collect-tounmod-map`（standard）。
  titleは40 / 42 / 47文字で既存最長（toMap identity template・62文字）以下に抑えた
  （P11-D13が「新titleの長さ ≤ 既存最長」を機械検証する）。fixtureは既存dataset
  （employees / employeesMergeDemo）を流用し、新規datasetは追加していない。
- 2引数版の重複キーは意味論がtoMap 2引数版と同一のため**専用templateを設けず**、
  `tmpl-collect-tomap-duplicate`への参照注記で扱った（ユーザー決定。v0.14 §5.1）。
  local collectorテスト（P11-D11）では実行失敗経路を機械検証している。
- snapshot件数: list standard 16 / list empty 4 / set standard 28 / set empty 4 /
  map standard 33。空入力は`INITIAL → COLLECTOR_FINISHED → RESULT_CONFIRMED → STREAM_CONSUMED`
  の4件で、蓄積snapshot 0件からの確定がラベル遷移で識別できる。
- oracle: P8-O01へ結果3キー（`unmodifiableList` / `unmodifiableSet` /
  `unmodifiableMapMergeFirst`）とUOE契約3キー（`uoeOnListAdd` / `uoeOnSetAdd` / `uoeOnMapPut`）を
  追加し、JDK 25実測（Docker gradle:9.6.1-jdk25）と完全一致（PASS）。UOE 3キーはCoreが変更操作を
  実行しないため**v0.14 §3.1の公式仕様を根拠とする固定リテラル**であり、この区分を
  `tests/p8-oracle-expected.ts`のコメントと`P8_MATCH_NOTES`で明示した。実測の返却実装クラスは
  `ListN` / `SetN` / `MapN`、UOEのメッセージは`null`で、いずれもOBSERVATION行に留めている。
- 統合docx: `build_spec_docx.py` / `verify_spec_docx.py`へ`--v14`（第31章）対応を追加し、
  v0.14.docxを生成・verify合格（第31章: 見出し18 / 表行30 / リスト80がmdと一致、§参照の未解決0件）。
- **外部文書への§参照判定を単一定義源へ集約した**（docx側codexレビュー第1回の中指摘への対応）:
  ビルダーは`EXC_V*`で外部文書（完了報告・判断記録・実装指示書）の§参照を章番号読み替えから
  保護していたが、verify側の除外条件は`'decisions.md' in ctx or ctx.endswith('Phase 5 ')`の
  2条件だけで、`EXC_V14`が保護した6件は**内部参照として集計**されていた（本書内に偶然§17・§9.1が
  存在するため「未解決なし」で合格していた）。`build_spec_docx.py`へ
  `EXTERNAL_DOC_REF_PREFIXES` / `is_external_doc_ref()`を新設して双方が参照する構造とし、
  verifyは内部参照（137種 / 延べ527件）と外部参照（8種 / 延べ19件）を分けて集計・出力する。
  あわせてビルダーへ`assert_external_refs_protected()`を追加し、外部参照が
  「`EXC_V*`で保護」「§11〜§25（`RefResolver`の素通し範囲）」のいずれでもない場合は
  ビルドを停止する。回帰テストは`tools/test_spec_docx_refs.py`（8観点）。
  - **保護済み判定は参照の出現位置で行う**（docx側レビュー第2回の中指摘への対応）。
    当初は「同じ節番号を含む例外文脈が文書のどこかにあるか」で判定していたため、
    保護済み`Phase 5実装指示書§9.1`と未登録`Phase 5指示§9.1`が併存すると後者を
    見逃し、`§31.9.1`へ誤変換されたまま通過した（実測で再現）。`exception_spans()`で
    例外文脈の占有区間を求め、参照がその区間に収まる場合だけ保護済みとする形へ改めた。
  - verify側の§参照分類・実在照合は`collect_valid_sections()` /
    `classify_section_refs()` / `unresolved_section_refs()`としてテスト可能に分離した
    （出力・合否判定は不変）。「存在しない内部参照でverifyが失敗する」ことを、
    分類結果ではなく**合否判定に使う関数そのもの**で検証するため。
  - 調査で判明: 過去章の`Phase 8完了報告§17`がEXC未登録でも誤変換されていなかったのは、
    §17が`§11〜§25`の素通し範囲に入るためであり、偶然の一致ではなく構造上の理由だった。
  v0.13参照の`§30.x`変換は章番号`>= 31`ガードで第26〜30章の出力を不変に保つ。Phase 5実装指示書・
  Phase 8完了報告への§参照は`EXC_V14`で本書の節番号への読み替えから除外した。
- **codex実装レビュー（2026-08-14）: 第1〜3回が承認不可、第4回で承認**。指摘はすべて
  §4非null機械検証の**保証の強度**に関するもので、Collector本体の実装（DSL・finisher・
  ラベル分離・template・取込・Oracle）への指摘は全回を通じて0件だった。

  | 回 | 判定 | 指摘と対応 |
  |---|---|---|
  | 第1回 | 承認不可（高1・中1） | **高**: window Gathererの`VALUE_REACHED`判定が§4-3の定義と矛盾 → 仕様側を改訂し第三状態`INVARIANT_BLOCKED`を新設（§18.1）。v0.14 §4-2b・§4-3・§6を同時に改訂し第31章docxを再ビルド・verify合格。**中**: 値生成operationの分類結果がproducer導出へ接続されていない（`classifyOperations()`の戻り値を捨てていた）→ 起点operationIdによる双方向一致検証を追加（仕様変更は不要） |
  | 第2回 | 承認不可（中1・低2） | **中**: `operationId`のカバー集合と到達実行がsource系以外で接続されていない（mapper / boxed / gatherは固定値をハードコード）→ 検証対象nodeのoperationIdを`producer.operationId`から取得し、構造assertと3集合一致assertを追加。**低2**: 完了状態の説明が旧2状態のまま／docxリスト件数が旧値 |
  | 第3回 | 承認不可（中1・低1） | **中**: 構造assertが検証対象nodeを識別せず、前処理nodeが同じoperationIdを持つ場合に偽陽性となる → `targetNodeId`でnodeを特定してからoperationIdを照合する形へ変更し、台帳記録を実行成功後へ移動、producer単位の台帳照合を追加。**低1**: 依頼書の参照先不整合（→ 連番ファイル運用の廃止で構造的に解消） |
  | 第4回 | **承認**（高0・中0・低0） | 追加指摘なし |

  - 修正の実効性は毎回**ミューテーションテスト**で確認した——(a) `expandBoxedProducers`を
    導出から外すと「値生成として分類済みですがproducer展開が未定義のoperationです: boxed」で失敗、
    (b) window producerを`VALUE_REACHED`へ戻すと期待状態不一致で失敗、
    (c) 構造assertを「任意nodeのoperationId一致」へ戻すと前処理node衝突の負例が失敗、
    (d) 台帳記録をdefinition構築前へ移すと失敗実行の非記録テストが失敗。
  - **学び**: 「機械検証を書いた」だけでは保証にならず、**その検証自体が壊れたときに落ちるか**を
    ミューテーションで確かめる必要がある。第2・3回の指摘はいずれも「assertは通るが保証が
    成立していない」型で、通常のテスト実行では発見できなかった。
  - **依頼書の運用**（ユーザー指示 2026-08-14）: 回ごとに連番ファイル（`_r2.md`等）を作らず、
    1トピック1ファイルを毎回上書き更新し、回数はタイトルに書く。連番運用は
    「現行の参照先はどれか」の不整合を生み、第3回でその整合自体が指摘対象になった。
- 検証: Vitest **885**（+89）/ typecheck / Playwright E2E **93件**成功。
  視覚回帰基準画像（`e2e/__screenshots__`）の更新**ゼロ**（43枚のまま）。E2E実行により現行Phase証跡
  `artifacts/phase-8/`のキャプチャ12枚が再生成された（対象外注記の削除を反映。寸法・レイアウトは
  不変で、capture-helperが現行Phaseの証跡を上書きする既存運用どおり）。
