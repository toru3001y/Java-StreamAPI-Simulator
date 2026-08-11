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

---

# Phase 5 本体実装の判断記録（§13以降）

- 判断日: 2026-08-12
- 対象: Phase 5本体実装（`docs/Claude_Code_Phase5_Implementation_Instructions.md`）で
  「実装判断として記録する」と指示された事項、および実装中に決めた仕様本文を変更しない範囲の判断
- 状態: **Phase 5本体実装済み**（§1〜§12のJ-2確定事項は無変更）

## 13. Collector AST DSLの構成

### 13.1 型とファイル

- `src/domain/dsl/collectorAst.ts`: `CollectorDsl`（再帰的な識別可能Union）、`ClassifierDsl`、
  `CollectTripleDsl`、IDホワイトリスト定数、`collectorDepth` / `collectorKindsOf`等の導出関数。
- `src/domain/dsl/validateCollector.ts`: closed schema構造検証（`validateCollectorStructure`）、
  3引数collect検証（`validateCollectTriple`）、結果TypeRefの再帰導出（`resolveCollectorType`）。
- Phase 4の`terminalAst.ts` / `validateTerminal.ts`と同じ方式（variantごとの許可キー集合、
  未知kind・未知ID・許可外キー・型不一致を構造化issueで返す、例外を投げない）を踏襲した。

### 13.2 引数の有無はoptional keyではなく明示nullで表す

closed schema検証は実入力のキー集合だけを見るため、overloadの表現にoptional keyを使わず
**明示`null`**を要求する（既存`PipelineNodeDef.predicate: … | null`と同じ方針）。

- `joining`: `delimiter` / `prefix` / `suffix`の3フィールドで、引数なし（全null）/
  delimiter単独 / 3引数の3形を表現する。組合せ違反（prefixのみ等）は`TYPE_MISMATCH`で拒否する。
- `groupingBy`: `classifier` + `mapFactoryId: string | null` + `downstream: CollectorDsl | null`の
  1 variantで3 overloadを表現する（Javaコード生成はnullの有無で引数を切り替える）。
- `partitioningBy`: `predicate` + `downstream: CollectorDsl | null`。

### 13.3 定義済みIDホワイトリスト（実装値）

| 用途 | 定数 | 値 |
|---|---|---|
| toCollectionのコンテナsupplier | `COLLECTOR_SUPPLIER_IDS` | `ArrayList::new` / `LinkedList::new` |
| groupingByのmapFactory | `COLLECTOR_MAP_FACTORY_IDS` | `TreeMap::new` |
| collectingAndThenのfinisher | `COLLECTOR_FINISHER_IDS` | `List::copyOf` |
| teeingのmerger | `TEEING_MERGER_IDS` | `SalarySummary::new` |
| 3引数collectのID組合せ | `COLLECT_TRIPLE_ID_COMBINATIONS` | `ArrayList::new` / `ArrayList::add` / `ArrayList::addAll` |
| classifierのEmployee Stringフィールド | `CLASSIFIER_EMPLOYEE_FIELDS` | `region` / `name` |
| classifierのDepartmentフィールド | `CLASSIFIER_DEPARTMENT_FIELDS` | `name` / `division` |
| 数値集計のEmployeeフィールド | `COLLECTOR_NUMERIC_FIELDS` | `age`（int）/ `salary`（long）/ `evaluation`（double） |

- mapFactoryは`TreeMap::new`のみとした。指示§8が要求する教材（TreeMapの順序意味論）に必要な範囲へ限定し、
  Oracle照合の対象も最小に保つ。`LinkedHashMap`等の追加は将来Phaseの判断とする。
- finisherは`List::copyOf`のみとした。downstreamの結果型との整合（List結果にのみ適用可）を
  `resolveCollectorType`が`TYPE_MISMATCH`で検証する。
- 数値集計はkindの数値種別（Int / Long / Double）とfieldのJava primitive型が一致することを要求する
  （`summingLong` + `age`は`TYPE_MISMATCH`）。Phase 4の`REDUCTION_FIELD_WHITELIST`（salary / age）では
  double集計のevaluationを表現できないため、Collector専用のホワイトリストを新設した。

### 13.4 Collector ASTの入れ子上限は4（root=1）

`COLLECTOR_MAX_DEPTH = 4`。根拠は、指示が要求する構造の最大深度が3であること
（nested groupingBy、teeing branch内のnested Collector、groupingBy配下のteeing）。
1段の余裕を持たせつつ、無制限の入れ子によるsnapshot数の膨張を教材制約として抑える。
超過は新`ValidationCode` `'COLLECTOR_DEPTH'`（`src/domain/types/result.ts`）で拒否する。

### 13.5 flatMappingの展開規則

`flatMapping`のmapperは**コンテナ（`List<T>`）を返す既存mapper**（`fieldAccess: skills`）を再利用し、
平坦化はflatMapping自身が担う設計とした。downstreamの入力型はコンテナの要素型になる。
表示用Javaコードは`e -> e.skills().stream()`を生成する。
新しいmapper kindを追加せず、Draft v0.8 §9.1の「既存のskills展開等、許可済み規則を再利用」に沿う。

### 13.6 Collector内部Predicateのホワイトリスト検証

`filtering` / `partitioningBy`のPredicateはtemplate slotではないため`allowedDslProfile`では絞られない。
そのため`validateCollector.ts`側で`validateWhitelist`を明示的に適用し、
kind（`fieldCompare` / `currentValueCompare`）・field（`age` / `salary` / `evaluation`）・
operator（`GTE` / `LT`）をホワイトリスト検証する。任意operatorの混入を構造検証段階で拒否する。

### 13.7 Predicate DSLへのlong定数の加算的追加

指示§8の基準Pipeline例`e.salary() >= 5_000_000L`（filtering・takeWhile / dropWhile持越し）は、
Phase 4までのPredicate DSL（int定数 × `age`のみ）では表現できなかった。
表示用Javaコードを指示どおりにするため、既存DSLへ**非破壊で**次を追加した。

- `ast.ts`: `DslLongLiteral`（`type: 'long'`）を`DslLiteral`へ追加
- `validate.ts`: long定数の構造検証（整数・safe integer範囲）と、long fieldとの型整合検証
- `evaluate.ts`: 数値field読み出しを`age` / `salary` / `evaluation`へ拡張
- `javaCode.ts` / `explanation.ts`: long定数を`5_000_000L`形式で表示

既存P1〜P4テスト311件は無変更で全通過した（long定数の拒否を前提とするテストは存在しなかった）。

## 14. 新設SnapshotKindと既存kind再利用の判断

### 14.1 新設（8種。既存34種 → 42種）

`CONTAINER_CREATED` / `CLASSIFIER_EVALUATED` / `BUCKET_SELECTED` / `CONTAINER_UPDATED` /
`COLLECTOR_FINISHED` / `TEE_BRANCH_ACCUMULATED` / `TEE_BRANCH_FINISHED` / `TEE_MERGER_APPLIED`。
いずれも既存kindと衝突せず、「対象_事象（過去形）」形式に従う。

### 14.2 既存kindの再利用（二重発行しない）

| 事象 | 使用するkind | 理由 |
|---|---|---|
| collectノードへの要素到着 | `NODE_ARRIVAL`（既存） | 指示§9.1項目1 |
| partitioningByのpredicate評価 | `PREDICATE_EVALUATED`（既存） | 指示§9.1規則1（`CLASSIFIER_EVALUATED`はgroupingBy専用） |
| filteringのpredicate評価 | `PREDICATE_EVALUATED`（既存） | 同上 |
| mappingのmapper適用 | `MAPPING_APPLIED`（既存） | 指示§9.1規則2 |
| **flatMappingの展開・子要素送出** | `MAPPED_STREAM_CREATED` / `CHILD_EMITTED`（既存） | **実装判断**: 展開 → flatten → downstreamはflatMapと同じ事象であり、専用kindを新設しない |
| 終端結果確定・Stream消費 | `RESULT_CONFIRMED` / `STREAM_CONSUMED`（既存） | 指示§9.1項目7 |

### 14.3 CONTAINER_CREATEDの適用範囲

3引数collectでは必須（指示§9.1規則6）。**toCollectionにも発行する**判断とした
（コンテナsupplier IDの可視化が指示§8の教材ポイントであるため）。
bucket内のコンテナ生成には発行せず、`BUCKET_SELECTED`が新規生成を表す
（1事象1 snapshotを保ち、bucket数ぶんの重複snapshotを避ける）。
発行はroot levelのコンテナに限り、要素処理の前（`INITIAL`直後）に1回だけ行う。

### 14.4 teeingの「その入力要素の収集完了」に独立snapshotを設けない

§4の手順4「両branchの更新完了後、その入力要素の収集完了」に対応するSnapshotKindは
§4.1の採用種別表に存在せず、指示§9.1の必須snapshot 7項目にもper-elementの収集完了は含まれない。
そのため**独立snapshotを新設せず**、右branchの`TEE_BRANCH_ACCUMULATED`の確定をもって
その入力要素の収集完了とする。§4の「左→右」順・別snapshot・`PROCESSING`最大1件はすべて満たす。

### 14.5 teeing branch状態の遷移タイミング

`TEE_BRANCH_ACCUMULATED`は確定snapshotであるため、そのsnapshot時点のbranch状態は
`ACCUMULATED`（蓄積確定済み）とする。branch rootが合成Collectorの場合は、
内部snapshot（`CONTAINER_UPDATED`等）の間は`ACCUMULATING`とし、
branch単位の`TEE_BRANCH_ACCUMULATED`で`ACCUMULATED`へ遷移させる。
finish段階では`currentElementId`をnullへ戻し、merger snapshotの
`currentElementId === null`・`PROCESSING` 0件・`activeBranch: NONE`（§5.2）を満たす。

## 15. TypeRef・蓄積値の表現（指示§6.3）

### 15.1 TypeRefの新kindは追加しない

既存`collection`（`List` | `Set`）と`map`（keyType / valueType）で表現する。

- partitioningByのキーは`{kind:'object', name:'Boolean'}`（wrapper Boolean）。
  primitiveの`boolean`とは混同しない（`TYPE_BOOLEAN_WRAPPER`として定数化）。
- `Collector<T, A, R>`自体のTypeRef kindは新設せず、Collector ASTの各ノードが
  入力型と結果型を保持する（`CollectorNodeView.inputTypeLabel` / `resultTypeLabel`）。
  teeingでは`R1`・`R2`・`R`を`CollectorTeeingView`で区別する。
- ヘルパー`setOf` / `mapOf` / `optionalOf` / `TYPE_LONG` / `TYPE_DOUBLE` / `TYPE_BOOLEAN_WRAPPER`を
  `typeRef.ts`へ追加した（既存`listOf`と同じ流儀）。

### 15.2 コンテナ実装名（ArrayList / TreeMap）はTypeRefで表現しない

既存TypeRefの`collection.container`は`List` | `Set`、`map`はキー型・値型のみで、
`ArrayList` / `TreeMap`等のMap / コンテナ容器名を表現できない。
**TypeRefは変更せず**、容器名と順序意味論は表示用のメタ情報として保持する判断とした。

- `TerminalResultView.COLLECTION.containerLabel`（`Set` / `ArrayList` / `List`）
- `TerminalResultView.MAP.containerLabel`（`Map` / `TreeMap`）と`jdkOrdered: boolean`
- `CollectorNodeView.accumulation`（`ELEMENTS.containerLabel` / `MAP.containerLabel`）

`groupingBy(classifier, TreeMap::new, downstream)`の結果TypeRefは`Map<String, List<Employee>>`のまま、
順序意味論は`jdkOrdered: true`で表す（Draft v0.8 §16.3の「順序意味論を優先して表示する」に対応）。

### 15.3 蓄積値はSimValueを拡張せずCollector固有contextへ保持する

`SimValue`にMap / コンテナ相当のkindを追加せず、Collectorの蓄積状態は
snapshotのCollector固有context（`OperationContextView`の`collector` variant）へ
**表示用の構造化されたプレーンな木**として保持する。

- `CollectorAccumulationView`: `NONE` / `ELEMENTS` / `TEXT` / `NUMBER` / `AVERAGE` /
  `STATISTICS` / `CANDIDATE` / `MAP`
- 終端結果の表示は`TerminalResultView`のvariant追加（`COLLECTION` / `MAP` / `RECORD`）で行う。
  Map entryの値は`TerminalResultView`を再帰的に持つ（nested groupingByはvalueが`MAP`）。
- runtime内部では`Map` / `Set`を使うが、**viewはプレーンなobject / 配列のみ**とする
  （`TimelineBuilder.push`が`structuredClone`し、`materialize`が`deepFreeze`するため。
  `deepFreeze`は`getOwnPropertyNames`ベースでMap / Setの中身を凍結できない）。

### 15.4 Setの要素ID規則

等価値が複数の入力要素から集約される場合（例: 関東×2件）、
**最初に受理した入力要素の`elementId`を保持し、後続の等価値追加では置換しない**。
`TerminalResultView.COLLECTION.elementIdNote`へ、これが表示・履歴復元用の教材規約であり
JDKのSet内部動作やiteration order保証ではないことを明記する。

### 15.5 Department recordキーの値等価判定

groupingByのbucketキーは既存`src/domain/engine/distinctKey.ts`の`distinctKeyOf`を再利用し、
Java recordのequals相当（全フィールド比較）の**値等価キー文字列**で決定する。
JavaScriptのオブジェクト参照同一性へは依存しない（教材fixtureがDepartmentインスタンスを
共有していても、共有していなくても同じbucketになる）。

## 16. double集計の補償付き加算

`summingDouble` / `averagingDouble` / `summarizingDouble`は、JDKの
`Collectors.sumWithCompensation` / `computeFinalSum`と同じ手順の補償付き加算で実装した
（`src/domain/engine/collectorRuntime.ts`の`addWithCompensation` / `finalCompensatedSum`）。

### 16.1 最終値は `sum - compensation`（JDK 25実測で確定）

補償値は各入力から**減算**して累積する（`tmp = value - compensation`）ため、
最終値は`sum - compensation`である。

当初は`sum + compensation`で実装していたが、**codexレビュー指摘を受けJDK 25実測で誤りを確認し是正した**。
根拠（Docker `gradle:9.6.1-jdk25` / Temurin OpenJDK 25.0.3+9で実測）:

| 入力 | JDK 25 `Collectors.summingDouble` | `sum - compensation` | `sum + compensation`（誤） | 単純合計 |
|---|---|---|---|---|
| `[0.001, 0.01]` | `0.011000000000000001` | `0.011000000000000001` | `0.010999999999999998` | `0.011` |
| `[1e16, 1, 1, 1, -1e16]` | `4.0` | `4.0` | `4.0` | `0.0` |
| `[0.1, 0.2, 0.3]` | `0.6` | `0.6` | `0.6` | `0.6000000000000001` |

教材fixture（evaluation 4.2 / 3.8 / 4.6 / 4.0）では補償が残らず両符号が一致するため、
当初のOracleケースでは誤りを検出できなかった。

### 16.2 補償が効くケースをP5-O01へ追加した

`oracle/OracleP5.java`へ上表の3列を追加し、`compensatedSums` / `naiveSums` /
`compensatedAverages` / `compensatedStatsSums`としてJDK 25と照合する。
単純合計と異なることも同時に固定する。
Simulation Core側の期待値は`compensatedSum`（`collectorRuntime.ts`のexport）から生成する。
Domain側はP5-D07で同じ列を検証する。

**検出能力の範囲**: 追加した3ケースはいずれも有限値であり、旧実装の逆符号
（`sum + compensation`）および単純加算への退行は確実に検出するが、
補償付き加算のあらゆる手順誤り（`computeFinalSum`の±Infinityフォールバック欠落等）を
検出するものではない。Infinity / NaNは指示§11で主題としない範囲のため、
検証ケースも有限値に限っている。

### 16.3 実測結果

- 教材fixture: `summingDouble` = `16.6`、`averagingDouble` = `4.15`、
  `summarizingDouble` = `count=4, sum=16.6, min=3.8, max=4.6, average=4.15`。
  指示§8の見込み値と一致（差異なし）。
- 補償ケース: `compensatedSums` = `["0.011000000000000001", "4.0", "0.6"]`、
  `compensatedAverages` = `["0.0055000000000000005", "0.8", "0.19999999999999998"]`、
  `compensatedStatsSums` = `["0.011000000000000001", "4.0", "0.6"]`。
  いずれもJDK 25実測と完全一致（`DoubleSummaryStatistics.getSum()`も同じ規約であることを確認）。
- Simulation Core・Oracle・画面表示の三者一致が成立している
  （`artifacts/phase-5/oracle-result.md`参照）。
- `averagingInt` / `averagingLong`はJDK同様に「long合計 / 件数」で算出し、補償付き加算は使わない。

## 17. bucket確定順の決定的順序（指示§9.1規則7）

Step Engineのfinish段階でのbucket確定・finisher発行順は次のとおり。
いずれも**教材上の規約**であり、JDKのMap iteration order保証ではないことをjdkNote・説明文へ明記する。
Step EngineはUI専用のDisplayOrderProjectionへ依存しない（独立に決定的である）。

| 対象 | 順序 | 実装 |
|---|---|---|
| 順序保証のないgroupingBy | bucket生成順 | runtime内のbucket配列順（生成時にpush） |
| TreeMap mapFactory | 実際のキー順 | keyLabelのUTF-16コード単位順でsort（Java Stringのnatural ordering） |
| partitioningBy | false → true の固定順 | 構築時にfalse / trueをこの順で生成し、確定時も同順 |

## 18. UIの表示順projection

`src/ui/displayOrderProjection.ts`（純粋なUI projection。Domain / Step Engineから参照しない）。

- 順序意味論を持たないSet / Mapは、要素ラベル / キーラベルのUTF-16コード単位順へ安定ソートする。
  同じsnapshotから常に同じ順序を導出する。
- `jdkOrdered: true`（TreeMap等）は並べ替えず実順序を優先する。
- 注記: 順序保証のない結果には「表示を安定させるための学習用の順序です（JDKのiteration order
  保証とは別物です）」、順序性を持つ結果には「実際の順序をそのまま表示します」を表示する。
- Step Engine側のbucket確定順（§17）とUI表示順は独立であり、両者が一致することを要求しない
  （groupingBy(region)の例では、Engine確定順は生成順「関東 → 関西 → 中部」、
  UI表示順は辞書順「中部 → 関東 → 関西」となる）。

## 19. 教材template・fixtureの構成判断

- **ファイル分離**: Phase 5のtemplateは`src/domain/template/templatesP5.ts`へ分離した
  （`templates.ts`がPhase 4までで1466行に達しており、可読性・レビュー性のため）。
  登録は`ALL_TEMPLATES`へ`...P5_TEMPLATES`として集約する。
- **modeの構成**: 主対象templateは標準 / 空ソースを提供し、途中0件はPhase 4の前例
  （`tmpl-reduce-concat-midempty`等）に倣い専用templateを別登録した
  （`tmpl-collect-tolist-midempty` / `tmpl-collect-groupingby-midempty` /
  `tmpl-collect-teeing-midempty`）。filterノードを前置しないtemplateでは
  途中0件が構造的に成立しないため`supportedModes`へ含めない（UIは選択不能理由を表示する）。
- **nested teeing**: 教材templateとしては登録せず、テストローカルtemplate
  （`tests/p3-helpers.ts`の`instantiateCustom`）で機械検証した（指示§8の許可どおり）。
  検証構成は`groupingBy(region, teeing(counting, averagingLong, SalarySummary::new))`
  （bucketごとに独立したteeingノード・merger 3回）と、
  `teeing(filtering(salary >= 5_000_000L, counting()), averagingLong(salary), SalarySummary::new)`
  （branchが合成Collectorの場合の内部snapshot種別）。
- **持越しtemplate**: `tmpl-takewhile-employee` / `tmpl-dropwhile-employee`を
  `salary >= 5_000_000L`のEmployee `fieldCompare`として登録した（3mode）。
  標準modeは境界到達（鈴木）後にPredicateならtrueとなる未評価値（高橋）を含む。

## 20. Oracle suite構成の変更（指示§12.5）

- `SUITES`へ`P5-O01`（`OracleP5.java` / `expected-p5-from-core.json` /
  書込み先`artifacts/phase-5/oracle-result.md`）を追加し、`P4-O01`の`writeReportPath`を`null`化した。
  `artifacts/phase-4/oracle-result.md`は過去証跡として保持し、上書きしない。
- P1〜P4 suiteの照合は回帰として継続実行する。P4-O02のLong境界値照合ロジックは
  `BOUNDARY_SUITE_ID = 'P4-O01'`としてP4 suiteへ適用し続ける（ID再定義はしない）。
- 過去artifacts不変検証の対象（`PAST_ARTIFACT_DIRS`）へ`artifacts/phase-4`を追加した。
- `evaluateOracleIds`（Phase 4契約）は`suites` / `requiredSuiteIds` / `writerSuiteId` /
  `writerReportPath`をパラメータ化し、Phase 4時点の構成をfixtureとして渡して同じ契約を
  検証し続ける形へリファクタした（`tests/domain/p4-review.test.ts`の`P4_SUITES_FIXTURE`）。
  ライブ構成の検証は新設`evaluateCurrentPhaseOracleIds`（P5-O02、`tests/domain/p5-review.test.ts`）が担う。

### 20.1 unordered結果の比較正規化

- 正規化対象の判定は具象クラス名（HashMap等）ではなく、
  result view / Collector ASTが保持する**JDK順序意味論の有無**（`MAP.jdkOrdered` /
  `COLLECTION.displayOrderNote`）で行う。
- 順序意味論を持たないSet / Mapは、Simulation Core側・Java Oracle側の双方で
  **要素・キーの表示文字列の辞書順**へsortした正規化表現へ変換してから照合する。
- TreeMapは正規化せず**実順序のまま**照合する（順序自体が検証対象。JSONキー
  `groupingByTreeMapOrdered`）。
- 数値は正規化後もJSON文字列表現で厳密照合する（64bit境界値と±Infinityは10進文字列のまま）。
- **この正規化は比較のためだけであり、JDKのiteration order保証を意味しない**。
  `oracle/OracleP5.java`のクラスコメントと`artifacts/phase-5/oracle-result.md`へ明記した。

## 21. 仕様との差異

Draft v0.8・`docs/phase-5-decisions.md` §1〜§12・Phase 5実装指示書の間に、
実装結果を変える矛盾は検出していない。仕様本文の変更も行っていない。

運用上の衝突として、指示§3.3が要求する「変更前の`npm run test:e2e` / `npm run test:oracle`」を
現状コードのまま実行すると、追跡ファイルであるPhase 4証跡を書き換えてしまう点を検出した
（`e2e/capture-helper.ts`の`CAPTURE_TARGET_PHASE = 4`、`oracle/oracle-lib.mjs`の
レポートへの実行日時埋め込み）。§14・§18・§13項目9との衝突を避けるため、
**HEAD（`639efb9`）の一時git worktreeを作業ディレクトリ外へ作成し、そこで変更前基準を取得**した
（実プロジェクトの`artifacts/phase-4`には一切書き込まない。取得後worktreeは削除）。

## 22. 第1回codexレビュー対応（2026-08-12）

codexへ実装レビューを依頼し、Blocker 0件 / Major 4件 / Minor 1件 / Nit 1件の指摘を受けた。
6件すべてを是正した（総合判定は「是正後に再レビュー」）。

### 22.1 [Major] double補償付き加算の最終符号がJDKと逆だった

§16.1のとおり、`sum + compensation`から`sum - compensation`へ是正した。
JDK 25実測（`[0.001, 0.01]` → `0.011000000000000001`）で誤りを確認し、
補償が効く3列をP5-O01（`compensatedSums` / `naiveSums` / `compensatedAverages` /
`compensatedStatsSums`）とP5-D07へ追加して回帰を固定した。
指摘どおり「一次情報未確認」を既知問題として持ち越さず、実測で決着させた。

### 22.2 [Major] Collector内の埋込みDSLがclosed schemaになっていなかった

`validateMapperStructure` / `validateStructure`（Predicate）/ `validateComparatorStructure`は
余分なキーを拒否しないため、Collector AST内の`mapper.functionBody`・`predicate.javaCode`・
`predicate.value.javaCode`・`comparator.evalExpr`・`comparator.keys[i].functionBody`等が
受理されていた（実行はされないが「受け付けない」という§7.1の契約を満たさない）。

`validateCollector.ts`へ埋込みDSL用の許可キー集合を追加し、
mapper / predicate / literal / comparator / comparator keyの各階層で`STRUCTURE_INVALID`拒否するようにした。

- Phase 1〜4のslot検証（`validateMapperStructure`等の既存呼び出し）は変更していない。
  Collector AST内に埋め込まれるDSLに対してのみ、Collector側で追加検証する構成とした
  （既存Phaseの受理範囲を変えず、§17の「既存構造の破壊的変更」を避けるため）。
- `reducing`のreductionはPhase 4の`REDUCTION_ALLOWED_KEYS`が既にclosedであり、変更不要。
- joiningのString定数（`delimiter` / `prefix` / `suffix`）も同様に許可キーを検証する。
- P5-D02へ各階層の負例（9件）を追加した。

### 22.3 [Major] minBy / maxByがComparatorの適用可能性を検証していなかった

`{kind:'minBy', comparator:{kind:'natural'}}`はEmployee要素でもinstantiateを通過し、
2件目の比較時に`compareNatural`が例外を投げていた（「不成立の候補はStep Engineへ渡さない」に反する）。

`resolveCollectorType`へComparatorと入力要素型の適合検証を追加した。

- `employeeKeys` ComparatorはEmployee要素にのみ適用できる。
- `natural` Comparatorは`compareNatural`が受け付ける型
  （String / LocalDate / 数値wrapper / primitive数値）にのみ適用できる。Employee・Departmentは不可。
- 不適合は`TYPE_MISMATCH`（path `collector.comparator`）で拒否し、EmployeeにはemployeeKeysを使う旨を
  メッセージへ含める。
- P5-D02（型解決の正例・負例）とP5-A05（instantiateで拒否されEngineへ入らないこと）へ負例を追加した。

### 22.4 [Major] §9.1規則7の必須テストが宣言どおり実装されていなかった

P5-D15（TreeMap）とP5-D18（partitioningBy）は、downstreamがfinisher非発行のCollector
（toList / counting）だったため、finisherの**確定処理順**が未検証だった。
またnested Collector内部・teeing branch内部の汎用`COLLECTOR_FINISHED`のケースもなかった。

テストローカルtemplate（`tests/p5-helpers.ts`の`localCollectTemplate` /
`localCollectSnapshots`）で、発行対象downstreamを持つ構成を追加検証した。

| 追加検証 | 構成 | 検証内容 |
|---|---|---|
| P5-D15 | `groupingBy(region, TreeMap::new, averagingLong(salary))` | finisher 3件が**実キー順**（中部 → 関東 → 関西）で発行され、順序意味論優先の注記を持つ |
| P5-D18 | `partitioningBy(age >= 30, averagingLong(salary))` | finisher 2件が**false → trueの固定順**で発行され、教材規約の注記を持つ |
| P5-D14 | `groupingBy(部署名, mapping(name, joining("/")))` | nested Collector内部のjoiningがbucketごとに発行（mapping自身は非発行） |
| P5-D22 | `teeing(filtering(pred, counting()), filtering(pred, averagingLong(salary)), SalarySummary::new)` | branch内部のaveragingLongが汎用`COLLECTOR_FINISHED`を発行し、branch rootは`TEE_BRANCH_FINISHED`のみ（規則4） |

上記4件はいずれも、各finisher snapshotについて集合単位snapshotの
`currentElementId === null`・`PROCESSING` 0件を**そのテスト内で直接**アサートする
（P5-D27の横断検証は登録済みtemplate × modeのみを対象とし、これらのテストローカルtemplateは
含まないため、各テストで個別に検証する必要がある。第2回レビュー指摘によりP5-D14へも追加した）。

### 22.5 [Minor] 構造ツリーと最終結果で順序説明が食い違っていた

構造ツリーはbucket生成順で表示するのに、パネル末尾で一律に「学習用の順序」注記を出していたため、
同一snapshot内で「関東→関西→中部」（ツリー）と「中部→関東→関西」（結果）が説明なしに併存していた。

- 構造ツリーのbucket一覧へ「bucketはbucket生成履歴順で表示しています（最終結果パネルの
  表示順とは意味が異なります）」を明示した。
- パネル末尾の注記を「構造ツリーは蓄積の追加順で表示しています（最終結果パネルの表示順とは
  意味が異なります）」へ改め、ツリーに対して「学習用の順序」を主張しないようにした。
- 構造ツリーは**処理の進行そのもの**（Mapの成長・追加順）を示し、最終結果パネルは
  **結果の安定表示**（順序保証なしは学習用の辞書順 / TreeMapは実キー順）を示す、という役割分担を
  明文化した。
- P5-R07へ、ツリー順・結果順・両注記の文言を同時に検証するテストを追加した。

### 22.6 [Nit] テスト名・報告の項目数が実際と一致していなかった

- IDを維持したままテスト名を現状へ合わせた（P2-R01 / P3-R01 / P4-R01 /
  `describe('P4-D40 短絡合成とCatalog登録範囲')`）。
- 完了報告のP5-D32の項目数を「§6の14項目」→「15項目」へ訂正した（§6の箇条書きは15項目）。

### 22.7 レビューで確認できなかった検証への対応

codex環境ではPlaywrightの全体実行がtimeoutし`npm run test:e2e`のexit 0を再現できなかったと
報告された。実装側の環境では是正後に`npm run test:e2e`を再実行し、**63件全成功・exit 0**を確認した
（Collector構造ツリーの注記追加によりP5-E10の基準画像4枚を意図的に更新。diff画像で差分が
構造ツリー領域と縦シフトに限られることを確認済み。過去Phase基準画像は再更新していない）。

あわせて、フルスイート同時実行時に`tests/react/p5-app.test.tsx`が既定5秒のtimeoutへ達して
flakyになる問題を発見し、ファイル単位で`vi.setConfig({ testTimeout: 60_000 })`を設定した
（skipや期待値緩和ではなく実行時間の確保のみ）。
