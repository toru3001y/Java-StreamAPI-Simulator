# Phase 4 判断記録

- 判断日: 2026-08-08
- 対象: Phase 4本体実装（終端操作）で必要になった実装判断
- 基準: Draft v0.8（無編集）、Phase 4実装指示、`docs/phase-3-decisions.md`（無変更で保持）

## 1. tagged terminal resultモデル（指示§7）

- `SnapshotOutput`へ識別可能Union `TerminalResultView` を追加した:
  `LIST / SCALAR / OPTIONAL / ARRAY / STATISTICS / VOID`。
- 既存のtoList向けフィールド（`items` / `count` / `elementIds` / `confirmed` /
  `resultTypeLabel`）は破壊的変更せず、toListは`{ kind: 'LIST' }` + 既存itemsで表現する
  （P1〜P3の既存テストは無修正で通過）。
- OPTIONALは`optionalTypeLabel`（Optional / OptionalInt / OptionalLong / OptionalDouble）と
  `present` / `valueLabel` / `valueElementId`を構造として保持し、primitive Optionalと
  object Optionalを混同しない。ARRAYは`componentTypeLabel` / `length` / index付きitemsを、
  STATISTICSは5項目のラベルと空初期値注記を保持する。
- 結果viewはStep Engineが集計の進行に合わせて更新し（countの現在件数等）、
  `output.confirmed`が最終確定を示す。UIはこの確定値だけを描画し独自計算しない。
- 空`DoubleSummaryStatistics`のmin / maxは正規初期値`Double.POSITIVE_INFINITY` /
  `Double.NEGATIVE_INFINITY`をラベルとして表示する（int / longはMAX_VALUE / MIN_VALUE表記 +
  空初期値注記。JDK側はOracleで±Infinity・境界値を数値照合）。

## 2. terminal runtimeとStep Engine（指示§10）

- Phase 3のnode runtime + finish cascade + 短絡キャンセル構造を維持し、
  終端は`TerminalRuntime`（1 Pipelineに1つ）として合成した。target operationごとの
  固定Pipeline分岐は追加していない（任意の既存中間操作列の後ろへ接続可能。
  P4-D40でsorted → findFirst、flatMap → anyMatch、limit → findFirstを検証）。
- terminal短絡（find / match）は`cancelAt(chain.length)`として全上流
  （source・sorted放出・flatMap子送出・limit）を停止する。limitとterminal短絡が
  組み合わさった場合、chain順で最初に確定した側から停止する（より早い確定位置）。
- `SHORT_CIRCUIT_CONFIRMED`は要素が終端で確定した後の独立snapshot
  （currentElementId null・PROCESSING 0件）として記録する。
- 新snapshot種別: REDUCTION_INITIALIZED / ACCUMULATOR_UPDATED / COUNT_UPDATED /
  CANDIDATE_UPDATED / MATCH_EVALUATED / FIND_SELECTED / STATISTICS_UPDATED /
  ARRAY_ELEMENT_STORED / CONSUMER_ACTION_PERFORMED。
  SHORT_CIRCUIT_CONFIRMED / RESULT_CONFIRMED / STREAM_CONSUMED / SINK_APPENDEDは既存を再利用。

## 3. reduce 3引数版のsequential combiner（指示§6.1）

- 3引数reduceはReduction DSL `employeeFieldSum`（累積型U ≠ 要素型TのためJava上
  3引数が必須）として実装し、`hasCombiner`はreduction種別から導出する。
- **sequential実行ではcombinerを一切実行せず、実行済みのようにも表示しない**
  （`combinerCallCount: 0`を明示表示）。combinerがparallel reductionで必要になることは
  jdkNotes・context・結果確定snapshotの補助説明で示す。
- JDK側もOracleでcombiner内にカウンタを仕込み、sequential実行の呼出し0回を実測照合した。
- accumulatorの結合則（associativity）要件は常設注記とした。
- identityありreduceは実行開始時（要素より前）に`REDUCTION_INITIALIZED`
  （currentElementId null）でidentityを常時表示し、空Streamではidentityが結果になる。
  identityなしは最初の要素で`REDUCTION_INITIALIZED`を発生させ、空Streamでは
  型に応じた空Optionalを返す。

## 4. findAnyの決定的fixtureとJDK非決定性の分離（指示§6.3）

- fixture実行では毎回同じ要素（encounter orderの最初の該当要素）を決定的に選択する。
- 画面には「JDKは特定要素を保証しない」を**常時**表示する（contextの
  `nondeterminismNote`は初期snapshotから設定。FIND_SELECTEDのjdkNoteにも表示）。
- Oracle Testでは観測された要素を`OBSERVATION:`行として証跡へ記録するだけとし、
  **厳密比較の対象はpresentのみ**。特定要素の一致を移植可能な保証として固定しない。
- encounter orderのないsource（generate）ではfindFirstにも任意要素になり得る注記を出す。

## 5. countの概念シミュレーションと評価省略注記の分離（指示§6.2）

- 通常の可視化は概念的な逐次評価（要素ごとの`COUNT_UPDATED`と現在件数）とし、
  汎用的なJDK最適化エンジンは実装しない。
- 「JDKは結果を直接算出できる場合にPipeline（peek等）の評価を省略することがある。
  常に省略される保証も、必ず評価される保証もない」を常設注記
  （contextの`elisionNote`・COUNT_UPDATED / RESULT_CONFIRMEDのjdkNote）とした。
- `peek + count`の評価省略はOracleの観測記録（`peekCallsDuringCount=0`、
  今回のJDK 25での観測であり保証ではない旨を付記）として証跡化し、
  厳密比較にはcount結果（2）だけを含めた。

## 6. forEach系の初版sequential範囲（指示§6.5）

- 初版はsequential実行のみ。`forEach` / `forEachOrdered`はともに実際の処理順
  （encounter order）でConsumerを実行し、Side Effect履歴（seq・element・式・出力）を
  snapshotへ保存する（実ブラウザconsoleへは依存しない）。
- parallel時の順序保証の差（forEach非保証 / forEachOrdered保証）は
  contextの`orderingNote`とjdkNotesの補助説明だけで示す。parallelStreamは実行しない。
- 戻り値voidは`TerminalResultView.VOID`として構造化し、Javaコードは代入文にしない
  （`employees.stream()`から始まる式文として生成）。

## 7. 過去Phaseテスト・画像の更新（指示§12・§16）

- **P2-R01 / P3-R01（未実装操作アサーション）**: Phase 4操作の選択可能化により
  「未実装リスト」がPhase 5以降のみとなった。両テストは削除せず、
  未実装リストの件数・Phase表記アサーションはそのまま成立している
  （UNIMPLEMENTed一覧をPhase 5の9項目へ更新。P2-R01の正規表現
  `/Phase [3-5]で実装予定/`・P3-R01の`/Phase [4-5]で実装予定/`はPhase 5表記に合致し、
  ≥7件の件数条件も満たすため、**今回はテスト本文の変更なしで通過**）。
- **視覚回帰基準画像の意図的更新**: Phase 4のUI変更（副題「Phase 4: 終端操作とリダクション」、
  操作選択への終端optgroup追加による選択行のレイアウト変化）が全画面基準画像に写るため、
  P1-E11 / P2-E10 / P3-E10の基準画像を意図的に更新した（Phase 2・Phase 3と同じ扱い）。
  - 更新前にPlaywrightのdiff画像を確認し、**差分がヘッダー副題と操作選択行に限られ、
    Pipeline・シミュレーション・コード・説明・再生バー領域に予期しない差分がない**ことを
    確認済み。
  - thresholdは緩和していない。画像テストの削除・skipもしていない。
  - P4-E10の基準画像4枚（reduce accumulator / statistics / anyMatch STOP / Optional.empty)は
    代表snapshotのみを新規基準化した。
- `artifacts/phase-1`〜`phase-3`は変更していない（検証実行で再生成された分はHEADへ復元）。

## 8. J-2 teeingの持越し

- J-2のうち`teeing`左右2系統の例外規定は**未決定のまま維持**し、Phase 5着手前に判断する
  （`docs/phase-3-decisions.md` §6を無変更で保持）。Phase 4では判断・実装していない。

## 9. Phase 4再レビュー対応（2026-08-08追記）

再レビュー指摘4件への修正判断。§1〜§8の承認済み判断は変更していない。
修正範囲は指摘4件に限定し、Phase 5の先行実装・推測によるリファクタリングは行っていない。

### 9.1 Terminal DSLのclosed schema検証（指摘1）

- ReductionDsl / ReductionIdentity / ArrayGeneratorDslを**closed schema**として検証する。
  variantごとの許可キー以外の追加フィールドは、Draft v0.8 §9.1が禁止する
  任意Javaコード文字列・関数本文の混入経路になり得るため拒否する。
- variantごとの許可フィールド:
  - `numericSum`: `kind`のみ
  - `stringConcat`: `kind`のみ
  - `employeeFieldSum`: `kind` / `field`のみ
  - ReductionIdentity: `type` / `value`のみ
  - ArrayGeneratorDsl: `kind` / `elementTypeName`のみ
- 共通処理`unknownFieldIssues`（`validateTerminal.ts`）が実入力キーと許可キー集合を照合し、
  未知フィールドを`STRUCTURE_INVALID`のValidationIssue（パスは`reduction.functionBody`等）
  として返す。例外は送出しない。3つの検証関数へ重複実装していない。
- 既存の必須フィールド・型・ホワイトリスト検証と正規fixtureの受理は維持（P4-D41で検証）。

### 9.2 string identityのJava文字列リテラルエスケープ（指摘2）

- `identityToJavaLiteral`のstring caseを、単純な二重引用符囲みから
  `javaStringLiteral`（`javaCode.ts`のprivate関数）によるエスケープ生成へ変更した。
- エスケープ対象: `\\` `"` LF CR タブ backspace form feed、その他の制御文字
  （C0 / DEL / C1）は`\uXXXX`。通常のASCII / 非制御文字は変更しない。
- エスケープはJavaコード生成時だけに適用し、`ReductionIdentity.value`自体は変更しない。
- 適用範囲はPhase 4で確認されたstring identityのみ（他DSLへ推測で拡大しない）。
- P4-D42で、生成リテラルへ生の改行が混入しないこと・エスケープ解釈が元の文字列へ
  復元されることを検証。

### 9.3 Long境界値の10進文字列Oracle比較（指摘3）

- 空`LongSummaryStatistics`のmin / max（`Long.MAX_VALUE` = 9223372036854775807 /
  `Long.MIN_VALUE` = -9223372036854775808）はIEEE 754倍精度で表現できず、
  JSON数値のままではJSON.parse時に丸められ、近接誤値を同一視し得た。
- OracleP4.javaのJSON出力・`expected-p4-from-core.json`の双方で、この2値を
  **10進文字列**として保持し、JavaScript numberへ変換せず文字列のまま比較する。
- ランナーは`verifyLongBoundaryStrings`（`oracle-lib.mjs`）で期待値・実測値の双方が
  string型かつ正確な10進値であることを検証し、失敗時はsuiteをFAILにする。
- Longの通常値（60L等、safe integer内）は変更していない。findAnyの観測要素・
  peek + countの呼出し回数は引き続き厳密比較の対象外（観測記録のみ）。
- P4-O02で境界値の正確一致・近接誤値（±1）の不一致判定・round-trip不変を検証。

### 9.4 Oracle証跡の書込み対象をP4に限定（指摘4）

- suite定義を`oracle-lib.mjs`へ抽出し、証跡を書き込むPhaseを`writeReportPath`で
  **明示**する構造にした（P1〜P3は`null` = 照合のみ、P4だけ
  `artifacts/phase-4/oracle-result.md`）。配列位置への暗黙依存はない。
- P1〜P3は比較結果を標準出力へ表示するだけで、artifactsへ書き込まない。
  「一度書き換えてからgit restoreする」従来運用は廃止した。
- いずれかのsuiteが失敗した場合は`allSuitesPassed`によりコマンド全体を失敗させる。
- P4-O03でsuite構成（4件照合・書込みはP4のみ）と失敗集約を機械検証し、
  実行前後の`artifacts/phase-1〜3`のSHA-256一致も確認した。

### 9.5 追加テストID

- P4-D41 / P4-D42 / P4-O02 / P4-O03（`tests/domain/p4-review.test.ts`）。
  既存のP4必須68 IDは変更・削除せず、合計72 IDとなる。

### 9.6 既知の課題（今回の修正範囲外として記録）

- `npm run test:e2e`に含まれるPhase 1〜3のキャプチャspec（`e2e/capture.spec.ts` /
  `p2-capture.spec.ts`ほか。過去Phaseテスト本文のため今回の変更禁止範囲）は、
  実行時に`artifacts/phase-1〜3`のキャプチャPNGを現行UIで再生成する。
  Oracle側は書込みをP4へ限定済み（§9.4）だが、E2E側のPhase分離は未対応。
  今回はE2E実行後にHEADの内容をファイル書き戻しで復元し、開始時とのSHA-256
  完全一致を確認した。恒久対応（キャプチャspecの書込み先限定または実行条件化）は
  過去Phaseテスト本文の変更を伴うため、次回のレビュー判断へ持ち越す。
