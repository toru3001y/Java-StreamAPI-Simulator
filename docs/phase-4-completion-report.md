# Phase 4 完了報告

- 報告日: 2026-08-08
- 基準仕様: `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`（Draft v0.8、無編集）
- 実装指示: Phase 4実装指示（リポジトリへは保存・複製していない）
- 判断記録: `docs/phase-4-decisions.md`（Phase 3以前のdecisions / completion-reportは無変更）

## 1. 完了 / 未完了判定

**Phase 4 完了**と判定する（再レビュー対応後の再判定。§16参照）。
全検証（lint / typecheck / unit / build / E2E / Oracle / git diff --check）が成功し、
再レビューで追加された4 IDを含む**P4必須72 ID**をすべて実装・成功させた。§5の完了条件
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

### 再レビュー追加分（P4-D41 / D42 / O02 / O03）: すべて成功

| ID | 実装テスト（`tests/domain/p4-review.test.ts`） | 検証内容 |
|---|---|---|
| P4-D41 | `P4-D41 Terminal DSLのclosed schema検証`（it 2件） | 未知追加フィールド（functionBody / javaCode / evalExpr等）の拒否とパス報告、正常variant受理、既存検証の非退行 |
| P4-D42 | `P4-D42 string identityのJava文字列リテラル生成`（it 2件） | 引用符・バックスラッシュ・LF / CR / タブ / backspace / form feed / 制御文字のエスケープ、生改行非混入、元文字列との同値復元 |
| P4-O02 | `P4-O02 Long境界値の損失なしOracle照合`（it 4件） | expected JSONの境界値がstringで正確な10進値、近接誤値（±1）の不一致判定、parse / stringify不変、Coreラベルとの意味一致 |
| P4-O03 | `P4-O03 Oracle証跡の書込み対象`（it 2件） | P1〜P4全件が照合対象、書込みはP4のみ（P1〜P3はwriteReportPath null）、任意1件の失敗で全体失敗 |

**Domain 42 + Application 7 + React 10 + E2E 10 + Oracle 3 = 72 ID、すべて実装・成功。**

## 5. 全Vitest件数

**308件 全成功**（36ファイル。P1 + P2 + P3 + P4 + 再レビュー対応。
失敗0・skip 0・todo 0・未実行0）。

## 6. 全Playwright件数

**50件 全成功**（chromium-pc + chromium-narrow。P1-E01〜11 + P2-E01〜10 + P3-E01〜10 +
P4-E01〜10 + キャプチャspec。失敗0・skip 0）。

## 7. P1〜P4 Oracle結果

`npm run test:oracle`で4 suiteを一括実行し、**P1-O01 / P2-O01 / P3-O01 / P4-O01 すべてPASS**。
再レビュー対応後の実行方式（詳細は§16）:

- **Long境界値の損失なし比較**: 空`LongSummaryStatistics`のmin / max
  （`9223372036854775807` / `-9223372036854775808`）は期待値・実測値の双方で
  **10進文字列**として保持し、JavaScript numberへ変換せず文字列完全一致で比較する。
  近接誤値（±1）は不一致と判定される（P4-O02で機械検証）。
- **証跡書込みはP4のみ**: P1〜P3は照合と標準出力表示だけを行い、
  `artifacts/phase-1〜3`へ書き込まない（P4-O03で機械検証。実行前後のSHA-256一致を確認済み）。

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

1. **P1-E11 / P2-E10 / P3-E10基準画像の意図的更新**: Phase 4のUI変更が全画面基準に写るため。
   実際に確認された差分範囲（再レビューでの訂正を反映）は次のとおり:
   - 全画像共通: ヘッダー副題（Phase 4表記）と操作選択行（終端optgroup追加による
     selectレイアウト変化）。
   - **P3のpeek画像（`p3-e10-peek-action.png`）は上記に加え、Side Effectビューの
     説明文の一般化も差分に含まれていた**（forEach対応に伴い、見出しの対象操作表示と
     説明文「peekのConsumerによる…」→「ConsumerによるSystem.out出力の履歴です」への変更が
     写っている）。当初の「差分が副題と操作選択行だけ」という記載は不正確だったため訂正する。
   - Pipeline・シミュレーション本体・コード・再生バー領域に、上記以外の予期しない差分はない。
   thresholdは緩和せず、画像テストの削除・skipもしていない。画像更新自体は維持する。
2. **過去Phaseテスト本文の変更: なし**。P2-R01 / P3-R01の未実装操作アサーションは
   UNIMPLEMENTED一覧のPhase 5更新（9項目）後もそのまま成立している（削除・skip・緩和なし）。
3. `artifacts/phase-1`〜`phase-3`は変更なし。Oracle実行はP1〜P3へ書き込まない方式へ修正済み
   （§16修正4）。なお`npm run test:e2e`にはPhase 1〜3のキャプチャspec（過去Phaseテスト本文の
   ため変更禁止）が含まれ、実行時にPhase 4 UIでの再キャプチャが発生する。今回はHEADの
   内容をファイル書き戻しで復元し、開始時とのSHA-256完全一致を確認した（§16参照。
   キャプチャspecのPhase分離は範囲外のため既知の課題として記録）。

## 12. 仕様との差異と既知の問題

- Draft v0.8・Phase 4実装指示・確定済みJ-2との差異: **なし**。
- 既知の問題（再レビュー対応時に記録）: `npm run test:e2e`に含まれるPhase 1〜3の
  キャプチャspec（過去Phaseテスト本文のため変更禁止）が、実行時に`artifacts/phase-1〜3`の
  キャプチャPNGをPhase 4 UIで再生成する。Oracle側は書込みをP4へ限定済みだが、
  E2E側のキャプチャspecのPhase分離（書込み先の限定または実行条件化）は今回の修正範囲外の
  ため未対応であり、次回対応候補として持ち越す。今回は実行後にHEAD内容へ書き戻し、
  SHA-256で不変性を確認した。
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
- 本体SHA追記commit: `02b4f99`
- 再レビュー是正commit: `2c6a864`（§16の修正1〜4 + 追加テストP4-D41 / D42 / O02 / O03 +
  判断記録§9 + P4 Oracle証跡。9ファイル・+615 / -75行）
- 最終テスト件数: Vitest 308件（36ファイル）/ Playwright 50件 / Oracle 4 suite PASS
- 最終HEADは本欄を追記したreport-only commit（`git log`先頭）

## 15. push・PR・mergeの状態

次の事実を区別して記載する。

- 独立レビュー時点で、`origin/phase-4`は`02b4f99`を指していた
  （`c17704c` / `02b4f99`はpush済みの状態でレビューが行われた）。
- **今回の是正作業ではpushしていない**（是正commitはローカルのみ）。
- Pull Requestは作成していない。
- `main`へのmergeは行っていない。
- force push / amend / squash / rebase / reset / stashは行っていない。

## 16. 再レビュー対応（2026-08-08、HEAD `02b4f99`時点の指摘4件）

判断の詳細は`docs/phase-4-decisions.md` §9。既存のP4必須68 IDと過去Phaseのテスト・
証跡は変更していない。修正範囲は指摘4件のみで、Phase 5の先行実装は行っていない。

### 修正1: Terminal DSLが未知の追加フィールドを拒否しない

- 原因: `validateReductionStructure` / `validateReductionIdentity` / `validateArrayGenerator`が
  必須フィールドとホワイトリスト値だけを検証し、closed schemaではなかったため、
  `{ kind: "numericSum", functionBody: "return evil()" }`のような任意コード文字列の
  追加フィールドが通過した（Draft v0.8 §9.1違反の混入経路）。
- 修正: 共通処理`unknownFieldIssues`を`validateTerminal.ts`へ追加し、variantごとの
  許可キー集合（numericSum / stringConcat: kindのみ、employeeFieldSum: kind / field、
  identity: type / value、arrayGenerator: kind / elementTypeName）以外の実入力キーを
  `STRUCTURE_INVALID`のValidationIssue（パス例: `reduction.functionBody`）として拒否する。
  例外は送出しない。3関数への重複実装はしていない。既存の正常fixtureは引き続き受理。
- 変更ファイル: `src/domain/dsl/validateTerminal.ts`
- 検証: **P4-D41 成功**（`instantiate.ts`は既存の検証呼出しが正しいことを確認したのみで無変更）。

### 修正2: string identityから不正なJava文字列リテラルが生成される

- 原因: `identityToJavaLiteral`がstring identityを単純に`"${value}"`で囲んでおり、
  値に引用符・バックスラッシュ・改行等が含まれると表示Javaコードが構文不正になった
  （例: `a"b` → `"a"b"`）。
- 修正: private関数`javaStringLiteral`（`javaCode.ts`）を新設し、`\\` `"` LF CR タブ
  backspace form feedをJavaエスケープへ、その他の制御文字（C0 / DEL / C1）を`\uXXXX`へ
  変換する。元の`ReductionIdentity.value`は変更せず、エスケープはコード生成時のみ。
  通常のASCII文字列の表示は不変。適用範囲はstring identityのみ。
- 変更ファイル: `src/domain/dsl/javaCode.ts`
- 検証: **P4-D42 成功**（生改行の非混入・エスケープ解釈での同値復元を含む）。

### 修正3: LongSummaryStatisticsのOracleが64bit境界値を厳密比較できない

- 原因: 空`LongSummaryStatistics`のmin / maxをJSON数値として出力していたため、
  JSON.parseでIEEE 754へ丸められ、`9223372036854775807`と近接誤値が同一視され得た。
  従来の「PASS（完全一致）」は64bit境界値の厳密一致を証明していなかった。
- 修正: `OracleP4.java`と`expected-p4-from-core.json`の双方で当該2値を**10進文字列**として
  保持し、`verifyLongBoundaryStrings`（`oracle-lib.mjs`）がJSON.parse後もstring型かつ
  正確な10進値であることを検証する（失敗時はsuite FAIL）。Number変換は行わない。
  Longの通常値（safe integer内）は変更せず、findAny観測要素・peek呼出し回数は
  引き続き厳密比較へ追加していない。
- 変更ファイル: `oracle/OracleP4.java` / `oracle/expected-p4-from-core.json` /
  `oracle/oracle-lib.mjs`（新規） / `oracle/run-oracle.mjs`
- 検証: **P4-O02 成功**（境界値の正確一致、±1の近接誤値の不一致判定、round-trip不変、
  Coreの`Long.MAX_VALUE` / `Long.MIN_VALUE`ラベルとの意味一致）。P1〜P4 Oracleは引き続きPASS。

### 修正4: Oracle実行がP1〜P3の証跡を上書きする

- 原因: `run-oracle.mjs`が全suiteの`oracle-result.md`を無条件に書き込み、
  P1〜P3の証跡が実行のたびに再生成され、Gitでの復元運用に依存していた。
- 修正: suite定義を`oracle-lib.mjs`へ抽出し、`writeReportPath`で書込み対象を明示
  （P1〜P3: null = 照合のみ・標準出力表示のみ、P4: `artifacts/phase-4/oracle-result.md`）。
  「書き換えてからrestore」方式は廃止。いずれかのsuite失敗で`allSuitesPassed`により
  コマンド全体が失敗する。一時ファイルは追跡対象に残していない。
- 変更ファイル: `oracle/run-oracle.mjs` / `oracle/oracle-lib.mjs`（新規）
- 検証: **P4-O03 成功**。Oracle実行前後で`artifacts/phase-1〜3`（26ファイル）の
  SHA-256完全一致を確認（コマンド:
  `find artifacts/phase-1 artifacts/phase-2 artifacts/phase-3 -type f | sort | xargs sha256sum`
  を実行前後で取得しdiff → 差分なし）。`git diff` / `git status`でも変更なし。

### 再検証結果（是正後）

| コマンド | 結果 |
|---|---|
| `npm run lint` / `npm run typecheck` | 成功（警告0） |
| `npm run test:unit` | 成功（**36ファイル / 308件**、失敗・skip・todo 0） |
| `npm run build` | 成功 |
| `npm run test:e2e` | 成功（**50件**、失敗・skip 0。Phase 4のUI・視覚回帰画像は無変更） |
| `npm run test:oracle` | P1-O01 / P2-O01 / P3-O01 / P4-O01 すべてPASS |
| `git diff --check` | 問題なし |

- 全template / mode 500 snapshot以内・PROCESSING最大1件（P4-D39 / P3-D28横断検証、無変更のまま成功）。
- Draft v0.8は無変更（`docs/`に同一内容の複製docx
  `01-Java_Stream_API_Visualization_Spec_Draft_v0.8-2-.docx`が未追跡で存在するが、
  正本とSHA-256完全一致の複製であり、削除・変更・コミットはしていない）。
