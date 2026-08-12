# Java Stream API 可視化シミュレーター 仕様書 v0.11（Collectors.toMap差分版）

## 1. 版管理（Draft v0.8 §1.2の変更管理に基づく）

- 版番号: **v0.11**（第7版ドラフト。初稿。codexレビュー未実施）
- 本書の構成: **v0.11 = Draft v0.8（`docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`、無編集のまま保持）+ v0.9差分（`docs/Java_Stream_API_Visualization_Spec_v0.9_Gatherers.md`、無編集のまま保持）+ v0.10差分（`docs/Java_Stream_API_Visualization_Spec_v0.10_Phase6_ManualLink.md`、無編集のまま保持）+ 本差分文書**。全文転記は行わない。
- 変更理由: Draft v0.8 付録A.4の対象外として未実装だった`Collectors.toMap`を教材対象へ追加するため（Phase 8）。toMapは「groupingBy = 1キー多値」に対する「toMap = 1キー1値。衝突はmergeか例外」という対比を担う、Collector教材の欠落部分である。
- 作成日: 2026-08-13

### 1.1 優先順位

**本書の明示的なtoMap固有規定だけがv0.8〜v0.10に優先する。**本書が明示的に変更していない一般原則・不変条件・検証順序・UI原則はすべて先行版を適用する。v0.8〜v0.10を上書き・追加する主要な追加箇所は次のとおり。これに加え、toMap追加に伴う横断的な追加（OperationCatalog登録・template / fixture・UI・テスト・Oracle等）も、本書の明示規定が先行版該当章への追加として優先する。

1. 付録A.4（Collector / Collectors実装対象）への追加: §2.1
2. §3.2（初版に含めないもの）への追加: §2.2
3. §12〜§13（snapshot契約）への追加、および**実行失敗契約の新設**: §6
4. 付録B（0件時の結果）への追加: §7
5. §9.1（Collector DSL許可構造）への追加: §8
6. §14〜§15（可視化・構造表示）への追加: §5
7. §20（Phase別実装計画）へのPhase 8行の追加、§24（全体テスト戦略）へのP8系列の追加: §9

### 1.2 影響するPhase

- **Phase 8（新設）のみ。**
- **完了済みのPhase 1〜7**: 意味論・受入条件・必須テストID・判断記録・完了報告は一切変更しない。ただし、共通UI（操作選択等）・視覚回帰基準画像・Oracle suite構成は、Phase 8実装時の意図的更新対象になり得る（前例: Phase 5・Phase 7。意図的更新は理由つきでPhase 8完了報告へ記録する）。
- **実行失敗契約（§6.2）はsnapshot契約への追加**であり、既存操作の正常完了列は変更しない。`completion`・再生状態への新値追加が既存P1〜P7テストへ回帰影響しないことをPhase 8で機械検証する。
- 既存テストID（P1〜P7）は変更しない。Phase 8の必須テストID（`P8-*`）はPhase 8実装指示書で確定する。

## 2. 追加する実装対象メソッド（v0.8 付録A.4への追加）

### 2.1 対象

| メソッド | 分類 | 優先度 |
|---|---|---|
| `Collectors.toMap(Function keyMapper, Function valueMapper)` | Collector（終端`collect`引数） | 高 |
| `Collectors.toMap(Function, Function, BinaryOperator mergeFunction)` | Collector | 高 |
| `Collectors.toMap(Function, Function, BinaryOperator, Supplier mapFactory)` | Collector | 中 |

JavaのtoMapのoverloadは上記3形のみである（§3.1）。`toMap(keyMapper, valueMapper, mapFactory)`という2引数+mapFactoryの形は存在しない。

### 2.2 対象外（v0.8 §3.2への追加）

- **`Collectors.toConcurrentMap`系（3 overload）**: unordered Collectorであり並列実行での性能最適化が存在意義（§3.1のImplementation Note引用参照）。決定的な逐次Step Engineの範囲では意味論を正確に可視化できないため、v0.9のmapConcurrentと同種の「実行せず補助説明のみ」区分へ置く。
- **`Collectors.toUnmodifiableMap`系（2 overload）**: 重複キー意味論はtoMapと同一だが、次の追加論点を持つ——(1) nullキー・null値の禁止（公式仕様: "The returned Collector disallows null keys and values. If either mapping function returns null, `NullPointerException` will be thrown."）、(2) 変更不可能なMap（"unmodifiable Map"）の可視化。現行の許可mapperはnullを生成しないため(1)は補助説明にしかならず、(2)は収集後の変更操作を実演しない限り画面上のラベルに留まる。`toUnmodifiableList` / `toUnmodifiableSet` / finisher可視化 / 変更操作が`UnsupportedOperationException`になることのOracle確認とあわせて、将来Phaseで一括して扱う方が教材としてまとまるため対象外とする。
- **`Map.merge`の「remapping結果がnullならentryを削除」という意味論**: §8.4の許可mergeFunction 3種はいずれもnullを返さないため、本教材の実行では発生しない。存在は補助説明でのみ扱う。
- **数値加算merge（`Long::sum`等）**: 対象外（将来拡張）。追加する場合はJavaのオーバーフロー・safe integer範囲・doubleの丸めを整理したうえで、型付きの数値mergeファミリーとして設計する（Phase 8中の場当たり追加はしない）。
- **keyMapper / valueMapper / mergeFunctionの自由記述**: v0.8 §3.2（任意コード実行なし・DSLホワイトリスト）を維持する。

## 3. Java SE 25仕様（一次情報。2026-08-13取得）

### 3.1 Collectors.toMap（3 overload）

出典: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html

- **2引数版の重複キー**: "If the mapped keys contain duplicates (according to `Object.equals(Object)`), an **`IllegalStateException`** is thrown when the collection operation is performed."
- **3引数版の重複キー**: "If the mapped keys contain duplicates (according to `Object.equals(Object)`), the value mapping function is applied to each equal element, and the results are merged using the provided merging function."
- **mergeFunctionパラメータ**: "a merge function, used to resolve collisions between values associated with the same key, **as supplied to `Map.merge(Object, Object, BiFunction)`**"
- **返却Mapの型**: "There are no guarantees on the type, mutability, serializability, or thread-safety of the `Map` returned"（型が必要なら4引数版のmapFactoryを使う、と明記）
- **挿入順**（Implementation Note）: "If it is not required that results are inserted into the `Map` in **encounter order**, using `toConcurrentMap(Function, Function)` may offer better parallel performance."（= 本Collectorは結果をencounter orderでMapへ挿入する。並列時の性能面でtoConcurrentMapが対比される）
- **API Note（identity）**: "It is common for either the key or the value to be the input elements. In this case, the utility method `Function.identity()` may be helpful."（`toMap(Student::getId, Function.identity())`の例）
- **API Note（衝突処理の例）**: "The other forms of `toMap` simply use a merge function that throws unconditionally, but you can easily write more flexible merge policies." 電話帳の例として `toMap(Person::getName, Person::getAddress, (s, a) -> s + ", " + a)` が示される。

### 3.2 Map.merge（mergeFunctionの適用順の根拠）

出典: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html#merge(K,V,java.util.function.BiFunction)

- 本文: "If the specified key is not already associated with a value or is associated with null, associates it with the given non-null value. Otherwise, replaces the associated value with the results of the given remapping function"
- default implementationとして次の擬似コードが示される:

```java
V oldValue = map.get(key);
V newValue = (oldValue == null) ? value :
             remappingFunction.apply(oldValue, value);
```

- すなわちremappingFunction（= toMapのmergeFunction）は**第1引数=Map内の既存値、第2引数=新しい値**の順で適用される。この引数順は§8.4のfirst / lastの意味の根拠である。上記はMap.mergeのdefault implementation節の記述であるため、教材上の断定は「Map.merge契約に沿った適用順」とし、**Phase 8のOracleで実測照合する**（§9）。

## 4. 教材目標（Phase 8で学習者が押さえる最低限のポイント）

1. **groupingByとの対比**: groupingByは1キーに値のList（多値）、toMapは1キーに値1件。この違いが「衝突をどう扱うか」という問題を生む。
2. **2引数版の重複キー例外**: toMap最大の落とし穴。重複キーで`IllegalStateException`になることを、validationで隠さず**実行で体験**する（§6.2）。
3. **mergeFunctionの選択肢**: なし（例外）/ 既存値を保持（先勝ち）/ 新しい値で置換（後勝ち）/ 両方を合成（連結）、の4択で衝突対処を整理する。引数順は（既存値, 新しい値）。
4. **同一キーへの3件以上の衝突**: mergeFunctionは「現在Mapにある値」へ順次適用される（first→A、last→C、concat→"A, B, C"）。
5. **`Function.identity()`**: キーか値のどちらかを要素そのものにする典型形（公式API Note）。
6. **返却Mapの型は無保証**: 型・可変性が必要なら4引数版でmapFactory（教材ではTreeMap）を指定する。
7. **断定回避**: Mapのentry反復順序の一般保証は説明しない。挿入がencounter orderであること（§3.1のImplementation Noteの範囲）と、表示上の蓄積順を混同させない。first / lastの「先勝ち / 後勝ち」は**現在の決定的な逐次実行における入力順**を指すとUIで明示する。

## 5. 可視化仕様（v0.8 §15相当の追加）

全体骨格「入力 → 処理中 → 出力」を維持し、Phase 5のCollector構造ツリーへtoMapノードを追加する。

- **構造表示**: toMapノードは**keyMapper / valueMapper / mergeFunction / mapFactoryの4行**を常設表示する。省略overloadの行は意味論表示とする（mergeFunction行:「なし（重複キーで`IllegalStateException`）」、mapFactory行:「なし（Map実装型は無保証）」）。
- **蓄積表示**: Mapのentry蓄積は既存groupingByのMap entry表示パターンを流用する（キー → 値1件。groupingByのようなbucket Listではない点が対比の核）。
- **重複検出時**: 重複キー・既存値・新しい値の3点を明示する（§6.1 `DUPLICATE_KEY_DETECTED`）。
- **merge適用時**: `mergeFunction(既存値, 新しい値) → 結果`のフローを表示する。UIラベルは「先勝ち」「後勝ち」だけでなく**「既存値を保持（先勝ち）」「新しい値で置換（後勝ち）」を併記**する。
- **実行失敗時**: (1) 教材上想定された実行失敗であること、(2) 例外型`IllegalStateException`（メッセージ全文は表示契約に含めない。§6.2）、(3) 原因キーと衝突した2値、を表示する。エンジン内部不整合（`EngineInvariantError`→ERROR）とは**明確に異なる表示区分**とし、「JDKで実行した場合にここで例外が送出される」ことを学習点として提示する。
- **型遷移**: `Stream<Employee> → Map<K, U>`をTypeRefで表示する。downstream配置時は`Map<K1, Map<K2, U>>`の入れ子を表示する（§8.6）。

## 6. snapshot契約（v0.8 §12〜§13への追加）

既存原則を変更なしで継続する: 1確定snapshotに処理中要素は最大1件、初期含め最大500 snapshot、決定性（同一revision同一列）、戻る→進むの完全復元、UIは確定snapshotのみ描画。

### 6.1 SnapshotKind（候補名。最終確定はPhase 8実装指示書。既存全kindとの衝突なきこと）

**再利用**（partitioningByがPREDICATE_EVALUATEDを再利用した前例に従う）:

| 既存kind | toMapでの用途 |
|---|---|
| `CONTAINER_CREATED` | Mapコンテナ生成の確定（4引数版はTreeMap生成を表示） |
| `CLASSIFIER_EVALUATED` | keyMapper評価の確定（ClassifierDsl流用に伴うkind再利用） |
| `CONTAINER_UPDATED` | Mapへの蓄積更新の確定（新規put / merge結果による置換の両方。新規か置換かはcontextで区別） |

valueMapper評価のkindは、既存mapping系kindの再利用可否をPhase 8実装指示書で確定する（候補: `MAPPING_APPLIED`再利用、または新設）。

**新設候補**:

| SnapshotKind候補 | 内容 |
|---|---|
| `DUPLICATE_KEY_DETECTED` | 重複キー検出の確定。キー・既存値・新しい値をcontextで表示する。2引数版（この後失敗）・3引数版（この後merge）で共通 |
| `MERGE_FUNCTION_APPLIED` | mergeFunction適用結果の**計算**確定（Map更新は含まない。更新は後続の`CONTAINER_UPDATED`。既存のMAPPING_APPLIED / MAPPED_EMITTED分離と同じ原則） |
| `COLLECT_FAILED` | 教材上想定された実行失敗の確定。**timelineの最終snapshot**となる（§6.2） |

### 6.2 実行失敗契約（新設。v0.8 §12の完了契約への追加）

toMap 2引数版の重複キーは、本シミュレーターで初めて「正常完了しないPipeline」を教材化する。次を契約とする。

1. **失敗は正規のsnapshot列である**: 2引数版で重複キーを検出した場合、`DUPLICATE_KEY_DETECTED` → `COLLECT_FAILED`で列が終わる。`RESULT_CONFIRMED` / `STREAM_CONSUMED`は発行しない。
2. **TypeScript例外は投げない**: Step Engineは失敗を通常のsnapshot生成として扱う。`EngineInvariantError`（エンジン内部不整合のフェイルセーフ。`session.ts`のcatch経路）とは完全に分離し、失敗snapshotの生成が内部不整合経路へ乗らないことをテストで保証する。
3. **状態モデル**: `Snapshot.completion`へ新値候補`'EXECUTION_FAILED'`を追加する（現行`'NONE' | 'STREAM_CONSUMED'`）。再生状態へ新状態候補`'FAILED'`を追加する（`ERROR`=内部不整合フェイルセーフ、`FAILED`=教材上想定された実行失敗、と区分する）。最終名はPhase 8実装指示書で確定する。
4. **停止と復元**: `COLLECT_FAILED`から先へは進めない（LIMIT_REACHEDと同様に停止・履歴保持）。戻る→進むの完全復元は失敗列にも適用する。
5. **例外契約は型のみ**: 契約・表示・Oracle照合のいずれも`IllegalStateException`という**例外型だけ**に依存する。JDKの例外メッセージ全文（キー・値の文字列表現を含む）はJDK実装詳細として契約に含めない（Oracleでは`assertThrows(IllegalStateException.class, …)`相当の型照合のみ行い、実測メッセージは観測記録として保存してよい）。
6. **途中Mapの扱い**: 失敗時点までの蓄積Mapは内部蓄積状態としてのみ表示し、終端結果（TerminalResultView相当）には**しない**。
7. **downstream内での失敗**: groupingBy等のdownstreamに置かれたtoMapで重複キーが発生した場合、当該bucketだけでなく**collect全体が失敗**する。失敗snapshotのcontextに**Collector path（rootからの経路）とbucketキー**を保持し、どのbucketのどのキーで失敗したかを表示する。
8. **表示順の教材規約**: 1要素の処理は「キー評価 → 値評価 → 重複検出（→ merge or 失敗）」の順で表示する。これは教材規約であり、JDK内部でのkeyMapper / valueMapper評価と例外送出の実際の順序・タイミングを断定する説明にはしない。

### 6.3 操作別の確定snapshot列（toMapノード視点。全列の厳密な合成はPhase 8実装指示書で確定）

- **2引数版（全キー一意・成功）**: `CONTAINER_CREATED` → 要素ごとに 到着 → `CLASSIFIER_EVALUATED`（キー確定）→ valueMapper評価 → `CONTAINER_UPDATED`（新規put）。全要素処理後 `RESULT_CONFIRMED` → `STREAM_CONSUMED`。
- **2引数版（重複キー・失敗）**: 重複が発生する要素まで上記と同一 → `CLASSIFIER_EVALUATED` → valueMapper評価 → `DUPLICATE_KEY_DETECTED` → `COLLECT_FAILED`（終端。以降のsnapshotなし）。
- **3引数版（重複あり）**: 重複時は `DUPLICATE_KEY_DETECTED` → `MERGE_FUNCTION_APPLIED`（結果値の計算確定）→ `CONTAINER_UPDATED`（置換）。非重複時は2引数版と同じ。
- **同一キーへ3件以上の衝突**: 2件目以降の各要素で`DUPLICATE_KEY_DETECTED` → `MERGE_FUNCTION_APPLIED` → `CONTAINER_UPDATED`を繰り返す。`MERGE_FUNCTION_APPLIED`のcontextは「現在Mapにある値」（前回merge結果）を第1引数として表示し、mergeが順次適用であることを可視化する。
- **4引数版**: 列は3引数版と同一。`CONTAINER_CREATED`でTreeMap生成（既存mapFactory表示の流用）を表示する。
- **空ソース**: `CONTAINER_CREATED` → `RESULT_CONFIRMED`（空Map）→ `STREAM_CONSUMED`。
- **downstream配置（groupingBy配下等）**: 親のbucket決定（既存列）後、bucketごとのtoMap蓄積へ上記の要素単位列を適用する。既存downstream Collectorの列規則との厳密な合成はPhase 8実装指示書で確定する。

### 6.4 実行値とIDの契約

- Map entryのキー・値は既存のSimValue / ElementId参照で表現する。groupingByのMap entry表示（`CollectorMapEntryView`）の流用可否と、流用しない場合の新viewはPhase 8実装指示書で確定する。
- merge結果値は複数入力から計算される合成値である。IDが必要な場合はnodeIdを含む決定的ID（例: `<nodeId>-merge-<n>`。v0.9 §6.3の合成ID規約に準拠）とする。最終確定はPhase 8実装指示書。
- 失敗snapshot（`COLLECT_FAILED`）を含む列も、同一revisionの再実行で同一のID列・snapshot列を生成する（決定性の維持）。

## 7. 空入力・特殊ケース（v0.8 付録B相当の追加）

| ケース | 結果 | 根拠区分 |
|---|---|---|
| 空stream → toMap（全overload） | 空Map `{}` | **公式定義から導出**（蓄積対象0件。空入力の明示例はない） |
| 全キー一意 → toMap 2引数 | 全entryのMap。挿入はencounter order | **公式仕様で確定**（§3.1 Implementation Note） |
| 重複キー → toMap 2引数 | `IllegalStateException`（§6.2の実行失敗） | **公式仕様で確定**（§3.1） |
| 重複キー → toMap 3引数 / 4引数 | mergeFunctionで解決 | **公式仕様で確定**（§3.1） |
| 4引数TreeMap + 非Comparableキー | 発生させない（validationで禁止。既存`COMPARABLE_CLASSIFIER_KINDS`流用） | 既存契約（Phase 5）の流用 |

Phase 8のOracleは上表を**仕様との回帰照合**として実測確認する。「導出」区分は、導出と実測が食い違った場合に停止して報告する（v0.9 §7と同じ規約）。

## 8. DSL契約（v0.8 §9.1への追加）

closed schema検証（kind → 許可キー集合 → ホワイトリスト → 型検証）は既存Collector ASTと同じ方式とする。引数の省略はoptional keyではなく明示`null`で表す（既存方針）。

### 8.1 構造

`CollectorDsl`へ次のkindを追加する:

```
| { kind: 'toMap',
    keyMapper: ClassifierDsl,
    valueMapper: ToMapValueDsl,
    mergeFunctionId: ToMapMergeId | null,
    mapFactoryId: CollectorMapFactoryId | null }
```

- overload対応: 2引数版=`mergeFunctionId`・`mapFactoryId`とも`null` / 3引数版=`mergeFunctionId`のみ非null / 4引数版=両方非null。
- **`mapFactoryId`が非nullかつ`mergeFunctionId`がnullの組合せは構造検証で拒否する**（対応するJava overloadが存在しない。§2.1）。

### 8.2 keyMapper

既存`ClassifierDsl`を**変更なしで流用**する（`employeeField(region | name)` / `employeeDepartment` / `departmentField(name | division)`）。キー型Kの導出・TreeMap時のComparable制約（`COMPARABLE_CLASSIFIER_KINDS`。Department recordキー + TreeMapの禁止）も既存規則を流用する。

### 8.3 valueMapper（`ToMapValueDsl`新設）

```
ToMapValueDsl =
  | { kind: 'identity' }        // Function.identity()。U = 入力要素型
  | 既存MapperDslのうちflattening系を除くkind
```

- `identity`は**toMap専用のvalue DSLとして新設**し、共有`MapperDsl`は変更しない。理由: 完了済みPhaseの共有DSL許可範囲を変えない（v0.9 §8.2がTerminal DSLを変えずGatherer専用`AccumulationRule`を新設したのと同じ判断）。
- flattening系（`FLATTENING_MAPPER_KINDS`: `listStream` / `arrayStream`）は値mapperとして不適のため禁止する（1要素→1値の変換のみ許可）。
- 値型Uは既存`resolveMapperOutputType`で導出する（`identity`はU=入力要素型）。

### 8.4 mergeFunction（`ToMapMergeId`新設。IDホワイトリスト）

| ID | Java表示 | 意味（UI併記） | 型制約 |
|---|---|---|---|
| `first` | `(a, b) -> a` | 既存値を保持（先勝ち） | 任意の同一型U |
| `last` | `(a, b) -> b` | 新しい値で置換（後勝ち） | 任意の同一型U |
| `concat` | `(s, a) -> s + ", " + a` | 既存値と新しい値を文字列連結（§3.1電話帳例と同形） | **U=Stringのみ**。違反は`TYPE_MISMATCH`で実行前拒否 |

- 引数順は（Map内の既存値, 新しい値）。根拠は§3.2。
- first / lastの「先勝ち / 後勝ち」は現在の決定的な逐次実行における入力順を指す（§4の7）。
- 3種ともnullを返さないため、`Map.merge`のnull削除意味論は対象外（§2.2）。
- 数値加算系の追加は将来拡張（§2.2）。

### 8.5 mapFactory

既存`COLLECTOR_MAP_FACTORY_IDS`（`TreeMap::new`のみ）を**変更なしで流用**する。追加はしない。

### 8.6 合成の許可範囲

- toMapは子を持たない**leaf Collector**であり、`downstream` / `left` / `right`への配置を**許可**する（root専用の位置依存例外ルールを設けない）。
- `COLLECTOR_MAX_DEPTH = 4`は**変更しない**。toMapはleafのため、既存の根拠（要求最大深度3 + 余裕1。`docs/phase-5-decisions.md` §13.4）と整合する（例: groupingBy(depth 1) → toMap(depth 2)）。
- **重複キー判定はMapコンテナごと**（downstream配置時はbucketごと）に行う。失敗時の扱いは§6.2の7。
- keyMapper（`ClassifierDsl`）はEmployee入力を要求するため、toMapを配置できるのは**入力要素型がEmployeeであるslotに限る**（`mapping`配下など入力型が変わる位置は`TYPE_MISMATCH`で拒否）。
- 結果TypeRefは既存`resolveCollectorType`の再帰で導出する（downstream配置時は`Map<K1, Map<K2, U>>`）。
- **基準template（最低限。fixture値・template IDはPhase 8実装指示書で確定）**:
  1. 2引数版・全キー一意（成功形。例: `toMap(name系キー, salary系値)`）
  2. 2引数版・重複キー（実行失敗形。例: keyMapper=`region`）
  3. 3引数版・first / last対比（同一データで結果の違いを見せる）
  4. 3引数版・concat・**同一キーへ3件以上が衝突するデータ**（mergeの順次適用の可視化。first→最初の値、last→最後の値、concat→全値の連結、を同一データで照合する）
  5. 4引数版・TreeMap（キーの昇順整列を表示）
  6. **downstream形 `groupingBy(…, toMap(…))` を最低1件**（nested Map TypeRef・bucketごとの重複判定の機械検証）
- 手動連携取込候補（v0.10）へのtoMap開放可否はPhase 8中の判断事項とする（§10）。開放する場合も本節の制約を候補検証の契約とする。

## 9. Phase 8実装契約の概要

- 位置づけ: Phase 7完了後に実施する追加Phase（v0.8 §20のPhase表へPhase 8行を追加）。
- 実装範囲: §2.1の3 overloadを、OperationCatalog・Collector AST / validate・Collector Runtime・Step Engine（§6.2実行失敗契約）・セッション状態（FAILED区分）・template / fixture・UI・テスト・Oracleまで縦断実装する。
- 完了条件（概要）: §5の構造表示（4行）、§6のsnapshot列・実行失敗契約・決定性、§7の特殊ケース、§8のDSL検証が、JDK 25実測との回帰照合（例外は**型のみ**照合。§6.2の5）を含めて成立し、既存P1〜P7テストが全件成功すること。mergeFunctionの適用順（既存値が第1引数）はOracleで実測照合する（§3.2）。
- 統合版docx（`tools/build_spec_docx.py`）へのv0.11差分の取込みを完了条件へ含める。
- テストIDは`P8-*`（P8-D / A / R / E / O）。必須ID表・件数・fixture値はPhase 8実装指示書で確定する。

## 10. Phase 8中に判断する事項

1. SnapshotKind候補名（§6.1）の最終確定と、Phase 7完了時点の全kindとの衝突再確認
2. `completion`新値・再生状態新値（§6.2の3。`EXECUTION_FAILED` / `FAILED`候補）の最終名と、ERROR区分と混同しないUI表示
3. valueMapper評価のsnapshot kind（`MAPPING_APPLIED`再利用か新設か）
4. 重複キー・3件以上衝突を自然に含むfixture（基準Employee 4件で足りるか、補助データを追加するか。500 snapshot予算との両立を含む）
5. Map entry view・merge結果値ID（§6.4）の具体型（既存`CollectorMapEntryView`の流用可否）
6. 手動連携取込候補へのtoMap開放可否（v0.10の候補検証と整合させる）
7. 視覚回帰基準画像・共通UI・Oracle suite構成の意図的更新の範囲（§1.2。理由つきで完了報告へ記録）
8. §6.2の8（表示順の教材規約）の表示文言（JDK内部の評価順を断定しない言い回しの確定）
