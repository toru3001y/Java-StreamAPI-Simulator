# Phase 5 判断記録（J-2 `Collectors.teeing` 仕様確定）

- 判断日: 2026-08-09
- 対象: Draft v0.8 §21.5 **J-2** のうち、Phase 5着手前が期限の `Collectors.teeing`
  左右2系統と「1つの確定snapshotに処理中要素は原則1件」（§12.6）の関係
- 状態: **J-2（teeing）確定済み。Phase 5本体は未着手**（今回は仕様確定と判断記録のみ。
  実装・テスト・fixture・Oracleは作成していない）

## 1. 基準仕様と参照資料

- `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`（Draft v0.8、無編集）
  - §12.2: snapshotの定義（「入力要素1件と同義ではない。要素を処理しない構造処理も
    独立snapshotになり得る」）
  - §12.6: 「1つの確定snapshotに処理中要素は原則1件だけとする」
  - §12.7: 1実行最大500 snapshot
  - §13.2: 独立snapshotになる処理に「Collectorのbucket / コンテナ更新」
    「Collector finisher、collectingAndThen finisher、teeing merger」を含む
  - §15: Collector可視化仕様（構造ツリー・現在経路・ノード別蓄積・内側から外側へ
    組み上がる結果TypeRef・finisher / mergerの独立snapshot）。§15.2のteeing行:
    「1要素を左右Collectorへ送り、最後にmergerを独立snapshotで適用」
  - §20: Phase 5の範囲（3引数collect、Collector AST、単純Collector、downstream、
    grouping、partitioning、collectingAndThen、teeing）と完了条件
    （構造ツリー、蓄積、結果型、空partition、finisher / merger snapshotが正しい）
  - §21.5 J-2: teeingの判断期限はPhase 5着手前
  - 付録B: teeingの0件時は「左右の空結果をmergerへ渡した結果」
  - 付録C: teeingは「Collector入れ子型」の可視化パターン
- `docs/phase-2-decisions.md` §2: flatMap親子でもJ-2の例外を設けなかった判断
- `docs/phase-3-decisions.md` §1〜§7: J-2 `sorted` の確定内容
  （並べ替え確定は処理中0件の構造snapshot、`PROCESSING`は全snapshotで最大1件）、
  §6: teeingのPhase 5着手前への持越し
- `docs/phase-4-decisions.md` §8: J-2 teeingを未決定のままPhase 5着手前へ持ち越した記録
- `docs/phase-4-completion-report.md` §13: Phase 5への持越し事項
- Java SE 25 公式仕様（2026-08-09取得・確認済み）
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html#teeing(java.util.stream.Collector,java.util.stream.Collector,java.util.function.BiFunction)
    - "Returns a Collector that is a composite of two downstream collectors.
      Every element passed to the resulting collector is processed by both downstream
      collectors, then their results are merged using the specified merge function
      into the final result."
    - "accumulator: calls each collector's accumulator with its result container
      and the input element"
    - "finisher: calls each collector's finisher with its result container,
      then calls the supplied merger and returns its result."
    - "The resulting collector is Collector.Characteristics.UNORDERED if both downstream
      collectors are unordered and Collector.Characteristics.CONCURRENT if both downstream
      collectors are concurrent."
  - 同ページ `counting()`: "If no elements are present, the result is 0."
  - 同ページ `averagingLong(ToLongFunction)`: "If no elements are present, the result is 0."

## 2. J-2の判断対象

§12.6「1つの確定snapshotに処理中要素は原則1件」に対し、`teeing` の左右2系統
（同じ入力要素が両downstream Collectorで処理される構造）を例外として、
複数要素の同時「処理中」を認めるか。

## 3. 結論: teeingでも複数PROCESSINGの例外なし

**`teeing` でも、複数要素を同時に `PROCESSING` とする例外は設けない。**

左右のdownstream Collectorへ渡されるのは**同じ入力要素**である
（Java SE 25: "Every element passed to the resulting collector is processed by both
downstream collectors"）。左右に別の要素が存在するわけではないため、
「左右で2件が同時に処理中」という状況はそもそも要素モデル上発生しない。

したがって次を不変条件とする。

```text
全snapshotで、elementLatestStatesがPROCESSINGの要素は0件または1件。
2件以上にはならない。
```

- 同じ要素を画面上の左右両方へ表示する場合も、**同じ安定`elementId`を参照する
  表示projection**とする。要素を複製して別IDを付与してはならない。
- 左右を同時にactive表示せず、そのsnapshotで処理しているbranchだけをactiveにする。

（参考: flatMap親子（`phase-2-decisions.md` §2）・sorted一括確定
（`phase-3-decisions.md` §3）も同じ方針で例外なしに成立しており、
J-2の3対象すべてが「例外なし」で確定したことになる。）

## 4. 左右branchのsnapshot順

1つの入力要素について、次の順で可視化する。

1. teeingノードへの要素到着（`NODE_ARRIVAL`、既存）
2. 左downstreamの処理・蓄積更新
3. 右downstreamの処理・蓄積更新
4. 両branchの更新完了後、その入力要素の収集完了

左branchの処理を確定させてから、右branchを処理する。

左branchと右branchの蓄積更新は**同じ確定snapshotへまとめない**（§13.2の
「Collectorのbucket / コンテナ更新」を左右それぞれの独立snapshotとして扱う）。

### 4.1 採用するsnapshot種別（最終採用名）

既存のSnapshotKind 34種（`SOURCE_EMIT` / `SORT_BUFFERED` / `PEEK_ACTION_PERFORMED` 等の
「対象_事象」形式）と照合し、衝突がないことを確認したうえで次を最終採用名とする。

| snapshot | 内容 |
|---|---|
| `NODE_ARRIVAL`（既存） | 1要素がteeingノードへ到着 |
| `TEE_BRANCH_ACCUMULATED`（`activeBranch: LEFT`） | 左downstreamの当該要素に対する蓄積更新が確定 |
| `TEE_BRANCH_ACCUMULATED`（`activeBranch: RIGHT`） | 右downstreamの当該要素に対する蓄積更新が確定 |
| `TEE_BRANCH_FINISHED`（`activeBranch: LEFT` / `RIGHT`） | 左右それぞれのdownstream finisher適用が確定し、結果`R1` / `R2`を確定 |
| `TEE_MERGER_APPLIED` | `R1`・`R2`から最終結果`R`を生成 |
| `RESULT_CONFIRMED`（既存） | teeing全体の終端結果を確定 |
| `STREAM_CONSUMED`（既存） | Stream消費済みを確定 |

- `TEE_BRANCH_ACCUMULATED`では、左右で**同じ`currentElementId`**を使用する。
- downstream内部がさらに合成Collector（mapping / collectingAndThen / nested teeing等）を
  持つ場合の内部snapshot種別は、Phase 5本体実装指示で汎用Collector snapshotとして確定する。
  その場合も本記録の不変条件（`PROCESSING`最大1件・merger 1回・依存順）に従う。

### 4.2 「左→右」は教材上の表示順である（JDK保証ではない）

この「左→右」は、Step Engineのsnapshot列を決定的にするための**教材上の表示順**である。
JDKがdownstream Collector間の観測可能な呼出し順を保証する、という説明にしてはならない
（詳細は§11）。

## 5. merger / finisherの独立snapshot

### 5.1 downstream finisher（`TEE_BRANCH_FINISHED`）

mergerは、左右の蓄積途中コンテナではなく、**各downstream Collectorのfinisher適用後の
結果**を受け取る（Java SE 25: "finisher: calls each collector's finisher with its result
container, then calls the supplied merger and returns its result."）。

- 左downstreamのfinisher結果を`R1`、右downstreamのfinisher結果を`R2`とする。
- 両結果が確定してからmergerを**1回だけ**適用する。
- `collectingAndThen`などのdownstream finisherが存在する場合、その完了前に
  teeing mergerを実行しない。
- identity finish相当のdownstreamでも、画面上で結果が確定した時点を識別できるよう
  `TEE_BRANCH_FINISHED`を生成する。
- 初版はsequential実行のみのため、combinerを実行済みのように表示しない
  （Phase 4のreduce 3引数combiner表示と同じ方針）。

### 5.2 merger snapshot（`TEE_MERGER_APPLIED`）

`TEE_MERGER_APPLIED`は、入力要素の処理snapshotとは分離し、
**teeingノードごとに正確に1件**生成する。このsnapshotは次を満たす。

- 左downstreamの結果`R1`が確定済み
- 右downstreamの結果`R2`が確定済み
- `currentElementId === null`
- `PROCESSING`要素が0件
- `activeBranch`はなし（`NONE`）
- 左結果、右結果、merger定義、最終結果を同時に表示する
- `R1`・`R2`・`R`のTypeRefを区別して表示する
- merger適用前に最終結果を先行表示しない
- merger適用後も`RESULT_CONFIRMED`と`STREAM_CONSUMED`を別の意味のsnapshotとして扱う
- 「戻る→進む」で左右の結果とmerger結果を完全復元できる
- 同じscenario revisionから同一snapshot列を再現できる

## 6. element stateとteeing context

branchごとの進行状態は、`elementLatestStates`へ左右分の要素を追加するのではなく、
**teeing固有context**へ保持する（sortedの`sortedContext`・flatMapの`flatMapContext`と
同じ「操作固有状態はSnapshotの専用contextへ、共通bufferへ押し込めない」方針）。

Phase 5実装時のteeing固有contextは、少なくとも次を表現できる契約とする
（今回は型・コードを実装しない）。

- teeing node ID
- 左右downstream Collectorのnode ID
- 左右downstreamのCollector AST
- 現在の入力`elementId`
- `activeBranch`: `NONE | LEFT | RIGHT`
- 左右branchの状態: `PENDING | ACCUMULATING | ACCUMULATED | FINISHED`
- 左右の現在蓄積状態
- 左右の結果値
- 左右の結果TypeRef（`R1`・`R2`）
- merger DSL / 識別子
- merger適用済みか
- 最終結果値
- 最終結果TypeRef（`R`）
- 教材上のbranch表示順が左→右であること
- 左→右がJDKの呼出し順保証ではない旨の注記

## 7. 空Stream

**空Streamでもmergerを省略しない**（Draft v0.8 付録B:
teeingの0件時は「左右の空結果をmergerへ渡した結果」）。

空Streamでは次の構造とする。

1. 要素到着・branch蓄積snapshot（`NODE_ARRIVAL` / `TEE_BRANCH_ACCUMULATED`）は0件
2. 左downstreamの空結果を確定（`TEE_BRANCH_FINISHED`、LEFT）
3. 右downstreamの空結果を確定（`TEE_BRANCH_FINISHED`、RIGHT）
4. 左右の空結果をmergerへ渡す
5. `TEE_MERGER_APPLIED`を1件生成
6. 最終結果を確定（`RESULT_CONFIRMED`）
7. `STREAM_CONSUMED`

`TEE_MERGER_APPLIED`では空Streamでも`currentElementId === null`かつ
`PROCESSING`要素0件とする。

## 8. nested teeing

teeingのdownstreamに、別の合成Collectorまたはteeingを含められる構造を維持する
（Draft v0.8 付録C「Collector入れ子型」）。

- Collector ASTを再帰的にたどる。
- 外側・内側の各teeingノードが**独立したcontextとmerger snapshot**を持つ。
- 1要素について、選択中のbranchをdepth-firstで処理する
  （flatMap子要素・sorted放出と同じdepth-first規則の適用）。
- nested構造でもグローバルな`PROCESSING`要素数は最大1件。
- 内側の結果が確定する前に外側mergerを適用しない。
- 各mergerは対応するteeingノードにつき1回だけ。
- 同じsnapshotからCollectorツリー、active path、蓄積状態、結果を一意に導出できる。

## 9. 基準教材fixture

Phase 5実装時のteeing基準fixtureとして次を採用する（今回は実装しない）。

```java
record SalarySummary(long employeeCount, double averageSalary) {}

SalarySummary result = employees.stream()
        .collect(Collectors.teeing(
                Collectors.counting(),
                Collectors.averagingLong(Employee::salary),
                SalarySummary::new));
```

- Draft v0.8の基準Employeeデータ4件（salary合計21,700,000）での期待結果:

```text
SalarySummary[employeeCount=4, averageSalary=5425000.0]
```

- 空Streamでの期待結果（`counting()` / `averagingLong()`とも空入力は0 —
  Java SE 25 "If no elements are present, the result is 0."）:

```text
SalarySummary[employeeCount=0, averageSalary=0.0]
```

この例で教材として示す内容:

- 同じEmployeeが左の`counting()`と右の`averagingLong()`の両方へ渡る
- 左右で蓄積状態と結果型が異なる（`Long`と`Double`）
- mergerが`Long`と`Double`の結果を`SalarySummary`へ変換する
- 空Streamでも左右の空結果にmergerが適用される
- mergerは単なるcombinerではなく、左右の**完成結果**を最終型へ統合する処理である

## 10. Phase 5実装時の機械検証条件

Phase 5本体で少なくとも次を機械検証する（テストIDはPhase 5本体実装指示で
既存IDと重複しないよう確定する）。

1. 全snapshotで`PROCESSING`要素数が0件または1件
2. 左右に表示される入力要素が同じ安定`elementId`
3. 入力1件につき左downstreamの蓄積が正確に1回
4. 入力1件につき右downstreamの蓄積が正確に1回
5. 左右の蓄積更新が別snapshot
6. 教材上のsnapshot順が左→右で決定的
7. 右branch完了前に次の入力要素を処理しない
8. 全入力の左右蓄積完了前にmergerを適用しない
9. 両downstreamのfinisher完了前にmergerを適用しない
10. `TEE_MERGER_APPLIED`がteeingノードごとに正確に1件
11. merger snapshotで`currentElementId === null`
12. merger snapshotで`PROCESSING`要素が0件
13. `R1`・`R2`・`R`のTypeRefがCollector ASTと一致
14. 標準fixtureの結果が`employeeCount=4`、`averageSalary=5425000.0`
15. 空Streamの結果が`employeeCount=0`、`averageSalary=0.0`
16. empty時にもmergerが1回適用される
17. nested teeingでも各mergerの依存順が正しい
18. nested teeingでも`PROCESSING`要素数が最大1件
19. 戻る→進むで同じsnapshotを完全復元
20. 同一revisionの再実行で同一snapshot列
21. 自動再生でも1回に1 snapshotだけ進む
22. 基準templateが500 snapshot以内
23. JDK 25 Oracle Testで標準・空Streamの最終結果が一致
24. Java表示コードがDSL / Collector ASTから生成され、任意Javaコード文字列を実行しない

## 11. JDK仕様と教材上の決定的表示順の区別

Java SE 25が`teeing`について保証する意味論は次である。

- 全入力要素が**両方**のdownstream Collectorで処理される
- 各downstreamのfinisherから結果`R1`・`R2`を得る
- mergerへ`R1`と`R2`を渡して最終結果`R`を得る
- Characteristicsは「両downstreamがunorderedのときUNORDERED、
  両downstreamがconcurrentのときCONCURRENT」

本記録の「左→右」処理順は、snapshot列を決定的にし教材の再現性を保つための
**教材上の表示順**であり、JDKがdownstream間の観測可能な呼出し順を保証するという
説明にしてはならない。画面・説明文・jdkNotesでは、findAnyの非決定性注記・countの
評価省略注記と同様に、「表示順は教材上の規約であり、JDKの保証と区別する」ことを
明示する（teeing固有contextの注記フィールド、§6参照）。

## 12. 今回の作業範囲と未実装事項

- 今回はJ-2（teeing）の**仕様確定と判断記録のみ**を行った。
- 変更ファイルは本記録（`docs/phase-5-decisions.md`、新規）と`README.md`
  （最小更新: J-2確定の追記とドキュメント一覧への追加）の2件だけである。
- **Phase 5本体は未着手**: Collector Engine / Collector AST / DSL / TypeRefの実装変更、
  fixture・template・テスト（Vitest / Playwright）・Oracleプログラムの追加、
  UI変更は一切行っていない。
- npm / Vitest / Playwright / Docker Oracleは実行していない
  （実装変更がないため対象外）。
- 過去Phaseの判断記録（`phase-2-decisions.md`〜`phase-4-decisions.md`）にある
  「teeingは未決定・持越し」という記載は、その時点の履歴として正しいため
  書き換えていない。
- Draft v0.8は無編集。
