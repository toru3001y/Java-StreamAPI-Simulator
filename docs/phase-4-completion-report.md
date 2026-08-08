# Phase 4 完了報告

- 報告日: 2026-08-08
- 基準仕様: `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`（Draft v0.8、無編集）
- 実装指示: Phase 4実装指示（リポジトリへは保存・複製していない）
- 判断記録: `docs/phase-4-decisions.md`（Phase 3以前のdecisions / completion-reportは無変更）

## 1. 完了 / 未完了判定

**Phase 4 完了**と判定する。§17の全検証（lint / typecheck / unit / build / E2E / Oracle /
git diff --check）が成功し、P4必須68 IDをすべて実装・成功させた。§5の完了条件
（Optional型付き表示、空Stream一致、vacuous truth、短絡後未評価、findAny分離、count注記、
型付き結果、STREAM CONSUMED、既存Phase非破壊）をすべて満たす。

## 2. 実装内容

Draft v0.8 §20 Phase 4の終端操作をDomain → Application → React UIまで縦断実装した。

- **reduce**: `reduce(BinaryOperator)` / `reduce(identity, BinaryOperator)` /
  `reduce(identity, accumulator, combiner)`（Int / Long / DoubleStream版含む）。
  identityなしは最初の要素を初期累積値として独立表示（`REDUCTION_INITIALIZED`）、
  空Streamは型別の空Optional。identityありは開始時にidentityを常時表示し空Streamでidentityを返す。
  3引数版（salary合計、U=long）はsequential実行でcombiner呼出し0回（実行済み表示なし）。
- **count / min / max**: countは概念上の寄与（`COUNT_UPDATED`）と現在件数 +
  評価省略可能性の常設注記。min / maxはComparator（object）/ primitive比較の
  候補更新・維持（`CANDIDATE_UPDATED`）と最終Optional。
- **find / match**: findFirst / findAny / anyMatch / allMatch / noneMatch。
  結果確定時に`SHORT_CIRCUIT_CONFIRMED`を独立snapshotとして記録し、確定後の
  source要素・flatMap子要素・sorted未放出要素は未評価のまま。空Streamは
  false / true / true（vacuous truth説明、Predicate評価0回）。findAnyはfixture決定的選択 +
  「JDKは特定要素を保証しない」常時表示。
- **primitive集計**: sum / average / summaryStatistics（int / long / double）。
  空Streamは0 / 0L / 0.0、OptionalDouble.empty()、統計の正規初期値
  （MAX_VALUE / MIN_VALUE、doubleは正負Infinity）。
- **結果化・副作用**: toList（既存を非破壊維持・unmodifiable注記）、toArray() /
  toArray(String[]::new) / primitive toArray（component type・length・index表示、
  空でも正しいcomponent typeの長さ0配列）、forEach / forEachOrdered
  （void結果、Side Effect履歴、順序保証差の補助説明、初版sequentialのみ）。
- **結果モデル**: `SnapshotOutput`へtagged union `TerminalResultView`
  （LIST / SCALAR / OPTIONAL / ARRAY / STATISTICS / VOID）を追加（既存フィールド非破壊）。
- **DSL**: Reduction DSL（numericSum / stringConcat / employeeFieldSum + 型付きidentity）、
  Array Generator DSL（String / Employee / Object）。match / min・max / forEach系は
  既存Predicate / Comparator / Consumer DSLを再利用（primitive対応済み）。
  同一ASTから評価・TypeRef・Java 25コード・説明・処理中表示を生成。
- **Catalog**: 終端15操作を`terminal` / `TERMINAL`で登録。SHORT_CIRCUITINGは
  find / match系のみ。STATEFULは付けない。Phase 5のcollect / Collectorsは未登録。
- **Step Engine**: Phase 3のnode runtime + finish cascade + 短絡キャンセルを維持し、
  terminal runtimeを合成（固定Pipeline分岐なし）。terminal短絡は全上流を停止し、
  limitとの組合せではより早い確定位置で停止（P4-D40でsorted / flatMap / limit合成を検証）。

## 3. 変更ファイル概要

| 区分 | ファイル |
|---|---|
| 結果モデル | `src/domain/engine/snapshot.ts`（新kind 9種・TerminalResultView・terminal context 8種） |
| DSL | `src/domain/dsl/terminalAst.ts` / `validateTerminal.ts` / `evaluateReduction.ts`（新規）、`javaCode.ts` / `explanation.ts`（terminal対応） |
| Catalog | `src/domain/catalog/operations.ts`（終端15操作）、`operationCatalog.ts`（fromTerminal） |
| Pipeline | `src/domain/pipeline/pipelineDefinition.ts`（reduction / identity / hasCombiner / arrayGenerator） |
| 検証 | `src/domain/template/instantiate.ts`（terminal型検証・結果型導出・midEmpty一般化）、`pipelineTemplate.ts`（3 slot種別） |
| Engine | `src/domain/engine/stepEngine.ts`（terminal runtime・handler・finalize・短絡拡張） |
| template / fixture | `src/domain/template/templates.ts`（P4 33template）、`src/providers/fixtureScenarioProvider.ts`（P4 65 fixture） |
| UI | `MainSimulation.tsx`（TerminalResultOutput）、`OperationStatePanel.tsx`（terminal 8 context）、`SideEffectPanel.tsx`（forEach対応）、`ScenarioControls.tsx`（終端optgroup）、`App.tsx` / `appInstance.ts` / `styles.css` |
| テスト | `tests/domain/p4-*.test.ts`（6ファイル）、`tests/application/p4-session.test.ts`、`tests/react/p4-app.test.tsx` |
| E2E | `e2e/phase4.spec.ts` / `p4-narrow.spec.ts` / `p4-capture.spec.ts`、`e2e/__screenshots__/phase4.spec.ts/`（4枚） |
| Oracle | `oracle/OracleP4.java` / `expected-p4-from-core.json`、`run-oracle.mjs`（P4 suite + 観測記録欄） |
| docs / 証跡 | `docs/phase-4-decisions.md` / 本報告 / `README.md` / `artifacts/phase-4/` |

## 4. P4必須68 IDの結果

### Domain（P4-D01〜D40）: すべて成功

| ID | 実装テスト |
|---|---|
| D01〜D08 | `tests/domain/p4-catalog-dsl.test.ts`（Catalog / TypeRef導出 / Reduction / identity / generator / 既存DSL再利用型検証 / Javaコード / template構造） |
| D09〜D16 | `tests/domain/p4-reduce.test.ts`（identityなし基本・空Optional、identityあり・空identity、3引数salary、combiner 0回、accumulator履歴、Long / Double reduce） |
| D17〜D29 | `tests/domain/p4-terminals.test.ts`（count標準・空・省略注記、min / max候補・空・primitive・更新snapshot、findFirst / findAny、any / all / none短絡、空match、Predicate 0回、短絡後未評価） |
| D30〜D37 | `tests/domain/p4-results.test.ts`（sum / average / statisticsと空結果・正規初期値、toList非破壊、toArray全種、forEach / forEachOrdered） |
| D38〜D40 | `tests/domain/p4-invariants.test.ts`（RESULT_CONFIRMED → STREAM_CONSUMED・履歴再現、PROCESSING最大1件・deep freeze・500以内、sorted / flatMap / limit短絡合成、Phase 5未実装） |
| O01同期 | `tests/domain/p4-oracleSync.test.ts`（expected JSONとCoreの一致保証） |

### Application（P4-A01〜A07）: すべて成功

`tests/application/p4-session.test.ts` — scenario初期化 / terminal状態の完全復元 /
history再利用 / 自動再生開始位置 / 短絡完了時の自動停止 / 結果の不変性 / 切替初期化。

### React（P4-R01〜R10）: すべて成功

`tests/react/p4-app.test.tsx` — 操作選択（Phase 5のみ未実装表示）/ Optional present・empty /
reduce accumulator / min・max候補 / match・find STOPと未評価 / vacuous truth /
sum・average・statistics / 配列型・length・index / forEach Side Effect /
findAny・count注記・traits・凡例・STREAM CONSUMED。

### E2E（P4-E01〜E10）: すべて成功

`e2e/phase4.spec.ts`（E01〜E10）+ `e2e/p4-narrow.spec.ts`（E10狭幅確認）。
視覚回帰の新規基準4枚: `e2e/__screenshots__/phase4.spec.ts/p4-e10-reduce-accumulator.png` /
`p4-e10-statistics.png` / `p4-e10-anymatch-stop.png` / `p4-e10-optional-empty.png`。

### Oracle（P4-O01）: PASS（完全一致）

**Domain 40 + Application 7 + React 10 + E2E 10 + Oracle 1 = 68 ID、すべて実装・成功。**

## 5. 全Vitest件数

**298件 全成功**（35ファイル。P1 + P2 + P3 + P4。失敗0・skip 0・todo 0）。

## 6. 全Playwright件数

**50件 全成功**（chromium-pc + chromium-narrow。P1-E01〜11 + P2-E01〜10 + P3-E01〜10 +
P4-E01〜10 + キャプチャspec。失敗0・skip 0）。

## 7. P1〜P4 Oracle結果

`npm run test:oracle`で4 suiteを一括実行し、**P1-O01 / P2-O01 / P3-O01 / P4-O01 すべてPASS**。

- JDK: Eclipse Temurin **25.0.3+9-LTS**（`gradle:9.6.1-jdk25` Dockerイメージ）。
  証跡に`java -version`全文・実行日・期待値 / 実測値・比較方法（JSON文字列完全一致）を記録。
- P4の照合対象: reduce全形式と空結果、sequential 3引数reduceのcombiner呼出し回数（0）、
  countと空結果、object / primitive min・max、findFirst、match系結果とPredicate呼出し回数
  （3 / 2 / 3、空0）、sum / average、3種のsummaryStatisticsと空初期値
  （int / longは境界値、doubleは±Infinityをbooleanで照合）、Object[] / String[] / int[] /
  空String[]、forEach / forEachOrderedのConsumer履歴、`Stream.toList()`のunmodifiable性
  （UnsupportedOperationExceptionを実測）。
- **観測記録（厳密比較の対象外、`artifacts/phase-4/oracle-result.md`の観測記録欄）**:
  - `findAnyObservedElement=佐藤` — JDKは特定要素を保証しないため、presentのみを厳密比較し、
    観測要素は保証として扱わない。
  - `peekCallsDuringCount=0（count結果=2）` — `peek + count`の評価省略は仕様上可能だが
    必須の動作ではなく、今回のJDKでの観測結果である（Coreは概念的逐次評価であり、
    この観測値を照合対象にしない）。

## 8. snapshot予算

全実行可能template / mode **138組**の正確な実測: `artifacts/phase-4/snapshot-budget.txt`。
**最大53件**（tmpl-filter-chain）、Phase 4分の最大は21件（tmpl-stats-int標準ほか）。
全組が500以内で、`snapshotCount`（事前実行値）との一致をP4-D39で機械検証。

## 9. PROCESSING最大件数

全snapshotで**最大1件**（J-2契約維持）。P4-D39が全P4 template × modeを横断検証し、
P4-D40が短絡合成（sorted → findFirst / flatMap → anyMatch / limit → findFirst）でも
維持されることを検証。P3-D28（Phase 3横断）も引き続き成功。

## 10. PC / 狭幅・視覚回帰結果

- PC幅キャプチャ（8枚）: `artifacts/phase-4/capture-pc-reduce.png` / `capture-pc-count.png` /
  `capture-pc-min.png` / `capture-pc-anymatch.png` / `capture-pc-statistics.png` /
  `capture-pc-toarray.png` / `capture-pc-foreach.png` / `capture-pc-optional-empty.png`
- 狭幅キャプチャ（3枚）: `capture-narrow-statistics.png` / `capture-narrow-reduce.png` /
  `capture-narrow-findfirst.png`
- 狭幅ではstatistics表・Side Effect・stickyバー非遮蔽・ページ非横スクロールを検証（P4-E10-narrow）。
- 視覚回帰: P4-E10の4基準を新規作成。P1〜P3の視覚回帰もすべて成功（§11の意図的更新後）。

## 11. 過去Phaseテスト・画像の更新理由

詳細は`docs/phase-4-decisions.md` §7。

1. **P1-E11 / P2-E10 / P3-E10基準画像の意図的更新**: Phase 4のUI変更（副題・操作選択への
   終端optgroup追加）が全画面基準に写るため。更新前にdiff画像で**差分がヘッダー副題と
   操作選択行に限られる**ことを確認した（Pipeline・シミュレーション・コード・再生バーに
   予期しない差分なし）。thresholdは緩和せず、画像テストの削除・skipもしていない。
   Phase 2（P1-E11更新）・Phase 3と同じ運用。
2. **過去Phaseテスト本文の変更: なし**。P2-R01 / P3-R01の未実装操作アサーションは
   UNIMPLEMENTED一覧のPhase 5更新（9項目）後もそのまま成立している（削除・skip・緩和なし）。
3. `artifacts/phase-1`〜`phase-3`は変更なし（検証実行で再生成された分はHEADへ復元済み）。

## 12. 仕様との差異と既知の問題

- Draft v0.8・Phase 4実装指示・確定済みJ-2との差異: **なし**。
- 既知の問題: なし。
- 補足（実装判断であり差異ではない）:
  - `toList`は他templateの終端として全Pipelineで使用されており、操作選択の独立項目には
    していない（Phase 1からの既存構造を維持。§6.5「既存toList」の非破壊要件を満たす）。
  - 空`IntSummaryStatistics`等のmin / max表示は教材上`Integer.MAX_VALUE`等のラベルとし、
    JDK側は境界値（2147483647等）で数値照合した。

## 13. Phase 5への持越し事項

- **J-2 teeing左右2系統の例外規定（未決定のまま維持。Phase 5着手前に判断）**。
- 3引数`collect`、Collector AST、Collectors（grouping / partitioning / downstream /
  collectingAndThen / teeing）の実装（Draft v0.8 §15・§20 Phase 5）。
- Collector Engine導入時、terminal runtimeのaccumulator構造をCollectorのcontainer /
  bucket / finisher構造へ一般化する（STATEFUL共通バッファへ押し込めない。§5.2）。
- takeWhile / dropWhileのEmployee fieldCompare教材template（Phase 3から継続持越し。
  DSL・型規則・Engine実行は対応済み）。

## 14. commit SHA

- Phase 4本体commit: `c17704c`（feat(p4): Phase 4本体実装。67ファイル・+6039行）
- 最終commitは本SHA追記のdocs commit（`git log`先頭）

## 15. push・PR・mergeについて

**`git push`、Pull Request作成、`main`へのmerge、force push、amend、squash、rebaseは
行っていない。** Phase 4の変更はローカルの`phase-4`ブランチへのcommitのみである。
