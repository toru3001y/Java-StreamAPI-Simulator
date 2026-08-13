# Java Stream API 可視化シミュレーター 仕様書 v0.14（unmodifiable系差分版）

## 1. 版管理（Draft v0.8 §1.2の変更管理に基づく）

- 版番号: **v0.14**（第10版ドラフト）
- 本書の構成: **v0.14 = v0.13（Draft v0.8 + v0.9〜v0.13差分、いずれも無編集のまま保持）+ 本差分文書**。全文転記は行わない。
- 変更理由: v0.11 §2.2で「将来のunmodifiable系一括Phaseへ持越す」とされた`Collectors.toUnmodifiableList` / `toUnmodifiableSet` / `toUnmodifiableMap`を、同節が一括Phaseの内容として挙げた4点——(1) toUnmodifiableList / toUnmodifiableSetを含む一括追加、(2) finisher可視化、(3) 変更操作が`UnsupportedOperationException`になることのOracle確認、(4) nullキー・null値禁止の扱い——とあわせて実装する。Phase 8完了報告§17の持越し事項3番の解消。
- 作成日: 2026-08-14

### 1.1 優先順位

**本書の明示的なunmodifiable系固有規定だけがv0.8〜v0.13に優先する。**本書が明示的に変更していない一般原則・不変条件・検証順序・UI原則はすべて先行版を適用する。既存Collector（toList / toSet / toCollection / toMap等）の意味論・snapshot列・表示は変更しない。

### 1.2 影響するPhase

- **Phase 11（新設）のみ。**Phase 1〜10の意味論・受入条件・完了報告は変更しない（Phase 8完了報告§17の持越し事項の解消記録を追記する）。
- 既存templateのsnapshot列・視覚回帰基準画像への影響はない（新規template 3件の追加のみ。新template titleは既存最長〔toMap identity template〕以下に抑え、教材Pipeline selectの内在幅を変えない。v0.12 §5と同じ制約）。
- 例外として、Phase 5のfinisher発行表（Phase 5実装指示書§9.1）を本書§3.2で**加算的に拡張**する（既存Collectorの発行有無は不変）。

## 2. Collector kindの追加（v0.8 §9.1 / v0.11 §8への追加）

### 2.1 追加する3 kindと結果型

| kind | Java表示 | 結果型（TypeRef） | overload |
|---|---|---|---|
| `toUnmodifiableList` | `Collectors.toUnmodifiableList()` | `List<T>` | 引数なしのみ |
| `toUnmodifiableSet` | `Collectors.toUnmodifiableSet()` | `Set<T>` | 引数なしのみ |
| `toUnmodifiableMap` | `Collectors.toUnmodifiableMap(keyMapper, valueMapper[, mergeFunction])` | `Map<K, U>` | **2引数 / 3引数の2形のみ** |

- 3 kindとも子を持たない**leaf Collector**であり、`downstream` / `left` / `right`への配置を許可する（toMapと同じ。v0.11 §8.6の位置規則を流用）。`COLLECTOR_MAX_DEPTH = 4`は変更しない。
- **結果型のTypeRefは既存の`List<T>` / `Set<T>` / `Map<K, U>`のまま**とし、不変性の軸をTypeRefへ追加しない。Javaの静的型が`List<T>`等である事実と一致し、コンテナ実装の性質はTypeRefではなく表示ラベルで持つ（toCollectionが`ArrayList`をTypeRefに入れず表示ラベルで持つ既存方針の踏襲）。不変性の表示は§3.3。
- 新しいoperationは登録しない（Collectors各種を`collect`操作へ集約する既存方針。操作総数46は不変）。

### 2.2 DSL構造と検証（closed schema）

- AST: `{ kind: 'toUnmodifiableList' }` / `{ kind: 'toUnmodifiableSet' }` /
  `{ kind: 'toUnmodifiableMap', keyMapper, valueMapper, mergeFunctionId }`。
- 許可キー集合（closed schema）: list / set = `['kind']`、map = `['kind', 'keyMapper', 'valueMapper', 'mergeFunctionId']`。**`mapFactoryId`キーは許可キー集合に含めず、存在すれば構造検証で拒否する**（JavaのtoUnmodifiableMapにmapFactory版のoverloadは存在しないため。v0.11 §5の「Javaに存在しない形の事前拒否」と同じ原則）。
- toUnmodifiableMapのkeyMapper（`ClassifierDsl`）/ valueMapper（`ToMapValueDsl`）/ mergeFunctionId（6種IDホワイトリスト + `requiredValueWrapper`型制約）の検証は、**既存toMapの検証を変更なしで流用**する。入力要素型がEmployeeであるslotに限られる制約（v0.11 §8.6）も同一。
- 2引数版は`mergeFunctionId: null`。重複キーの実行失敗契約は§2.3。

### 2.3 実行意味論

- **toUnmodifiableList / toUnmodifiableSet**: 蓄積は既存toList / toSetと同一の意味論（Setの重複判定は既存の等価判定を共有し、重複時は「追加しても変化しません」の既存表示を流用）。結果確定時にfinisher（§3.2）で不変コンテナへの確定を表す。蓄積中と確定後のコンテナラベルは§3.3で分離して規定する。
- **toUnmodifiableMap**: 蓄積・キー評価・値評価・重複キー検出・merge適用は既存toMapのsnapshot列（`TO_MAP_KEY_EVALUATED` → `TO_MAP_VALUE_EVALUATED` → 重複時`DUPLICATE_KEY_DETECTED` → `MERGE_FUNCTION_APPLIED` → Map更新）を**そのまま**使う。新しいSnapshotKindは追加しない。
- **2引数版の重複キー実行失敗**: 意味論はtoMap 2引数版と同一（§3.1の公式仕様どおり`IllegalStateException`）。既存の実行失敗契約（v0.11 §6.2の`COLLECT_FAILED`終端・`ExecutionFailureView`・FAILED遷移）を**構造変更なしで流用**する（`ExecutionFailureView.kind = 'DUPLICATE_TO_MAP_KEY'` / `exceptionType = 'IllegalStateException'`は「toMapファミリーの重複キー」の意味で共用）。`COLLECT_FAILED`の説明文言のみkindに応じて「mergeFunctionのないtoUnmodifiableMap…」へ分岐する。
- NullPointerException（null禁止）は実行対象外（§4）。

## 3. 不変性の可視化（v0.11 §2.2の論点(2)への回答）

### 3.1 Java SE 25仕様（一次情報。2026-08-13〜14取得）

- **`toUnmodifiableList()`**: "Returns a `Collector` that accumulates the input elements into an unmodifiable List in encounter order. The returned Collector disallows null values and will throw `NullPointerException` if it is presented with a null value."（Since: 10）
- **`toUnmodifiableSet()`**: "Returns a `Collector` that accumulates the input elements into an unmodifiable Set. The returned Collector disallows null values and will throw `NullPointerException` if it is presented with a null value. If the input contains duplicate elements, an arbitrary element of the duplicates is preserved. This is an `unordered` Collector."（Since: 10）
- **`toUnmodifiableMap(keyMapper, valueMapper)`**: "If the mapped keys contain duplicates (according to `Object.equals(Object)`), an `IllegalStateException` is thrown when the collection operation is performed." / "The returned Collector disallows null keys and values. If either mapping function returns null, `NullPointerException` will be thrown."（Since: 10）
- **`toUnmodifiableMap(keyMapper, valueMapper, mergeFunction)`**: mergeFunctionは "as supplied to `Map.merge(Object, Object, BiFunction)`"（引数順の根拠はv0.11 §3.2と同一。既存merge 6種のIDホワイトリストをそのまま適用する）。
- **unmodifiable Listの定義**（java.util.List「Unmodifiable Lists」）: "They are unmodifiable. Elements cannot be added, removed, or replaced. Calling any mutator method on the List will always cause `UnsupportedOperationException` to be thrown." / "They disallow null elements."
- **unmodifiable Setの定義**（java.util.Set「Unmodifiable Sets」）: "Calling any mutator method on the Set will always cause `UnsupportedOperationException` to be thrown." / "They disallow `null` elements."
- **unmodifiable Mapの定義**（java.util.Map「Unmodifiable Maps」）: "Calling any mutator method on the Map will always cause `UnsupportedOperationException` to be thrown." / "They disallow `null` keys and values."
- **`Stream.toList()`**（対比用）: "The returned List is unmodifiable; calls to any mutator method will always cause `UnsupportedOperationException` to be thrown."（Since: 16）。**null禁止の規定はない**（`Collectors.toUnmodifiableList()`との差。§5.1の対比導線で使う）。

§5.3のUnsupportedOperationException契約キー3件（List / Set / Map）は、上記のList / Set / Mapそれぞれの「Calling any mutator method … will always cause `UnsupportedOperationException`」の規定を根拠とする。

### 3.2 finisher可視化（Phase 5発行表の加算的拡張）

- 3 kindを`COLLECTOR_FINISHED`の**発行対象へ追加**する。Phase 5実装指示書§9.1の発行表は「表示上コンテナ = 結果なら発行しない」を原則とするが、unmodifiable系は**「蓄積は蓄積中コンテナの表示、結果は不変コンテナ」という表示上の変換がある**（§3.3のラベル分離）ため発行側に置く（発行表の原則自体は変えない。既存toList / toSet / toCollectionの「発行しない」は不変）。
- finisher snapshotの表示は既存`COLLECTOR_FINISHED`の構造（適用前の値・型 → 適用後の値・型）を流用する。finisherの表示ラベルは**JDK内部実装を断定しないため、Javaコード表記ではなく意味ラベル**とする（例:「unmodifiableへのラップ」。確定文言はPhase 11実装時にdecisionsへ記録）。既存のjdkNote「この教材モデルでは、蓄積表現と最終結果の間に表示上の変換があるときだけfinisher snapshotを発行します。JDKが当該Collectorでfinisherを実行するかどうかの主張ではありません。」を**そのまま**適用する。
- **変換の識別**: unmodifiable系のfinisherは適用前後で**値とTypeRefが同一**である（要素・entryは変わらず、静的型もList<T>等のまま）。したがってfinisher snapshotの前後識別は**コンテナラベルの遷移**で行う——適用前は蓄積ラベル（例`List（蓄積中）`）、適用後は結果ラベル（例`List（unmodifiable）`）を表示へ含め、`List（蓄積中） → List（unmodifiable）`の形で変換を示す（§3.3）。
- **空入力**: 要素がないため**蓄積snapshotは発行されない**（先行版の空入力契約どおり）。**配置別の発行契約（下表）に従うfinisher確定snapshot**——通常root / bucket downstream / branch内部nestedでは`COLLECTOR_FINISHED`、**teeing branch直下では`TEE_BRANCH_FINISHED`**——を発行し、そのbefore表示が0件の蓄積状態（`List（蓄積中）`・0件）、after表示が空の`List（unmodifiable）`等となることで、同じラベル遷移により確定を識別する（emptySource template・0件bucket・0件branchすべてに適用）。

**配置別の発行契約**（既存のfinisher発行規則・v0.12 §6のteeing排他との整合を一意化する）:

| 配置 | 発行契約 |
|---|---|
| 通常root | `COLLECTOR_FINISHED`を**1件**発行する |
| groupingBy / partitioningBy downstream | **bucketごと**に既存のbucket順序規則で`COLLECTOR_FINISHED`を発行する |
| teeing branch直下 | **`COLLECTOR_FINISHED`を発行しない**。既存のbranch root抑止規則（Phase 5指示§9.1）どおり`TEE_BRANCH_FINISHED`だけで不変コンテナへの確定を表し、その確定表示（after側）に結果ラベル（unmodifiable）を含める |
| teeing branch内部のnested unmodifiable Collector | 内部ノードは通常の`COLLECTOR_FINISHED`規則に従い、branch確定（`TEE_BRANCH_FINISHED`）とは**別事象**として発行する |
| （共通） | 同一finisherについて`COLLECTOR_FINISHED`と`TEE_BRANCH_FINISHED`を**二重発行しない**。0件bucket / 0件branchでも不変コンテナへの確定が表示される |

### 3.3 表示ラベル・注記（蓄積ラベルと結果ラベルの分離）

- **蓄積表示と結果表示のコンテナラベルを分離する**（単一ラベルの状態切替ではなく、発行点ごとに使うラベルを静的に定める。既存Collectorは両ラベルが同一値のため影響しない）:
  - **蓄積ラベル**（`CONTAINER_CREATED` / `CONTAINER_UPDATED`・蓄積view・重複キー検出等、finisher適用**前**のすべての表示）: **`List（蓄積中）` / `Set（蓄積中）` / `Map（蓄積中）`**。「蓄積中」はunmodifiable確定前であることを示す**教材モデル上の状態表示**であり、JDK内部の具体的な中間コンテナ型・finisher実装を断定するものではない（この旨を注記する）。
  - **結果ラベル**（`COLLECTOR_FINISHED`のafter側・終端結果view・`RESULT_CONFIRMED`）: **`List（unmodifiable）` / `Set（unmodifiable）` / `Map（unmodifiable）`**。
- 分離方式を採る理由: snapshotはemit時に確定viewを捕捉し「戻る」は再計算なしで復元する契約のため、単一ラベルの状態切替は発行タイミングへの依存を生む。分離なら各発行点のラベルが静的に定まり、機械検証（§6）も一意になる。
- TypeRef（§2.1）は変えず、不変性・蓄積状態は表示ラベルだけで示す。
- root配置のtoUnmodifiableListは、既存toListのroot特例（`LIST` view）には**乗せず**、`COLLECTION` view（containerLabel付き）で表示する（ラベルを構造で持てるviewへ寄せる。toCollectionと同じ経路）。
- toUnmodifiableSetの表示順は既存Setと同じ**DisplayOrderProjection**（学習用の安定順序。JDKのiteration order保証とは別物）を適用し、既存の表示順注記・要素ID注記を流用する。§3.1のとおりtoUnmodifiableSetはunordered Collectorであり、この注記の意味論はtoSetと同一である。
- toUnmodifiableMapの構造表示は既存toMapの**常設4行**を流用し、mapFactory行は「なし（unmodifiable Mapを返す。mapFactory版のoverloadは存在しない）」の意味論表示とする（v0.11 §5の省略overload表示と同じ方式）。
- `RESULT_CONFIRMED`のjdkNoteへunmodifiable分岐を追加する:「返却されたコンテナはunmodifiableであり、変更操作（add / remove / put等）は`UnsupportedOperationException`を送出する（§3.1）。実測はOracleで確認する（§5.3）」の趣旨。既存文言（toList等の「可変性は無保証」）は不変。

### 3.4 変更操作の実演はしない（ユーザー決定）

- v0.11 §2.2の「収集後の変更操作を実演しない限り画面上のラベルに留まる」という論点に対し、本書は**実演を採用しない**。理由: (1) Step Engineの契約はStream実行の終端（`STREAM_CONSUMED` / `EXECUTION_FAILED`）までであり、収集後のコレクション操作は教材Pipelineの範囲外、(2) v0.8 §3.2「例外を主題とする教材は対象外」の原則（toMap重複キーはv0.11で実行失敗契約として正式化した例外だが、UOEはStream実行の失敗ではない）、(3) 不変性の実挙動は§5.3のOracle実測（JDK 25でadd / putがUOEになることの照合）で担保できる。
- 画面上は§3.2のfinisher・§3.3のラベルと注記で「不変コンテナが返ること」を表し、実挙動の根拠はOracle証跡を参照する。

## 4. null禁止の扱いと非null不変条件の明文化

- §3.1のとおり3 kindはnull値（Mapはnullキー・null値）を禁止し、違反時は`NullPointerException`を送出する。**本教材ではNPEを実行対象にしない**（v0.11 §2.2の判断の維持）。存在と意味は補助説明（jdkNote）で示す。
- その前提となる不変条件を、次の契約として明文化する:

**非null不変条件**: **unmodifiable Collectorへ到達し得るすべての有効経路**（source → pass-through / mapping / flatMapping / boxed / gather等の中間操作 → collector入力、およびcollector内部のkeyMapper / valueMapper / classifier / merge評価）において、null / undefinedの値が到達しない。

**検査対象の定義**: 検査するのはSimValueオブジェクトの存在ではなく、**SimValueが保持するJavaの意味上の実値**である。すなわち各variantの`value`本体（`{ kind: 'string', value: … }`の`value`等）を検査し、合成List・stringList・Map entry等の複合値は**再帰的に全要素**を検査する。keyMapper / valueMapper / classifier / mergeの返却値も同様に**返却値本体**を検査する。

**値生成経路カタログ**（この契約が対象とする、Collector到達値を生成し得る全経路。producer IDは「値生成operation（またはcollector内部評価器）× その**識別可能unionの全下位軸**」の互換直積の1要素を指す。本表は説明用であり、テスト上の登録集合は後述の機械導出で定義する）:

| producer | 下位軸（識別可能unionの実軸） | 単一定義源 |
|---|---|---|
| source: `collection` | collectionId | `SOURCE_COLLECTION_IDS` |
| source: `array` / `streamOf` / `nestedList` | 検証済みvaluesの要素型 | validateSourceの許可要素型 |
| source: `arrayPrimitive` / `streamOfPrimitiveArrays` | **primitive（int / long / double）** | primitive軸の定数 |
| source: `generate` | rule | `ALLOWED_GENERATE_RULES` |
| source: `iterate2` / `iterate3` | operator（iterate3はpredicate operatorも） | `ALLOWED_ITERATE_OPERATORS` 等 |
| source: `empty` | streamType | streamType軸 |
| 共有mapper | kind × 対象field × **primitive（fieldToPrimitive / arrayStream）** | `MAPPER_DSL_KINDS` × `EMPLOYEE_FIELDS` × primitive軸 |
| boxed | 値生成handler（`boxValue`。MapperDslを経由しない） | **値生成handlerの閉じた定数集合** |
| gather | kind × accumulation kind × initial type × 対象field × **型適合関係** | kind定数 × `GATHER_ACCUMULATION_KINDS` × `GATHER_FIELD_WHITELIST` × 型適合表 |
| keyMapper / classifier | 3形 × 対象field | `CLASSIFIER_DSL_KINDS` × `CLASSIFIER_EMPLOYEE_FIELDS` / `CLASSIFIER_DEPARTMENT_FIELDS` |
| toMapのvalueMapper | 2形 × 対象field | `TO_MAP_VALUE_KINDS` × `EMPLOYEE_FIELDS` |
| mergeFunction | 6種 | `TO_MAP_MERGE_IDS` |

下位軸を実軸で分解するため、例えば`arrayPrimitive(int)`と`arrayPrimitive(double)`は**別のproducer**であり、片方の未実行は網羅性assertで検出される。

- Phase 11で**機械検証テストを新設**する。走査は3層:
  1. **評価器単位の列挙評価**: カタログ各行を「kind × 下位ホワイトリスト」の**互換直積**として単一定義源から列挙し、**互換入力型（TypeRef）ごとに互換なfixture要素・中間値**と組み合わせて評価し、意味上の実値が非null / 非undefinedであることを検証する（DSLごとに要求入力型が異なるため「全DSL × 全fixture要素」の全直積は実行不能であり、互換組合せに限定した全数走査とする）。
  2. **境界到達の実行検証**: (a) **全template × supported modeの実走査**で、collectorへ到達するすべての値とcollector内部のkeyMapper / valueMapper / classifier / merge評価結果の意味値非nullを検証する。(b) 既存templateに存在しない経路（boxed / gather → Collector等）を補うため、**登録済みの各producerをunmodifiable Collector境界まで到達させる検証**を行う——検証済みlocal PipelineDefinitionによる到達、またはproducer評価器の出力値を検証済みcollector accumulate経路へ直接供給する合成テストのいずれかとし、**boxed・scan・foldを明示的に含める**。
     - **window系（`windowFixed` / `windowSliding`）は境界到達の対象から外す**。これらが生成する合成List値は既存の構造的不変条件（`assertNotCompositeList`。「Phase 7範囲ではgatherの下流はtoList / findFirstのみ」）によりCollector境界へ**構造的に到達できない**ためである。この構成はPipeline検証を通過し**実行時に`EngineInvariantError`となる**ため、事前拒否される構成（UNBOUNDED_SOURCE等）とは区別する。window系は代わりに次の2点で検証し、完了状態を`INVARIANT_BLOCKED`とする（下記の完了状態を参照）:
       - **gather放出点で放出された全窓値を再帰的に検査**する（当該producerの値がCollector方向へ出る最後の観測点）。
       - 合成List値を**collector accumulate経路へ直接供給すると`EngineInvariantError`で遮断される**ことを負例で実証する（Phase 7の不変条件が現に効いていることの確認）。
  3. **網羅性（漏れ検出）**。次の契約で構成する:
     - **値variant網羅性**: `SimValue`の**全variant（kind）**に対して意味値検査器（再帰検査）が定義されていることをassertする（variant一覧との一致。未対応variantの追加で失敗）。
     - **producer登録集合の機械導出**: 登録集合は手作業の一覧ではなく、**実装上閉じた構造から導出**する。(i) **OperationCatalogの全operationを「値生成 / 非値生成（pass-through・検査・終端）」へ全域分類**し、**未分類のoperationが1件でもあればassert失敗**とする（boxed等のDSL外生成も当該operationの値生成handlerとしてここへ紐づき、handlerは閉じた定数集合を単一定義源とする）。(ii) 各値生成operationのproducer IDを、対応するDSLの識別可能union全下位軸（上表）との互換直積で導出する。**導出した各producerは起点となるoperationIdを保持し、「`VALUE_PRODUCING`へ分類されたoperationの集合」と「producer展開がカバーしたoperationの集合」が完全一致しないとき導出は失敗する**（分類済みだがproducer展開が未定義のoperation、および非値生成operationを参照する展開の双方向検出）。(iii) collector内部（keyMapper / valueMapper / classifier / merge）はOperationCatalogのoperationではないためclosed DSL定数から導出し、**operation由来producerとは区分する**（起点operationIdを持たない）。新しいoperation・値生成runtime・kind・下位定数の追加は、導出集合の拡大＝分類・展開・検査の未定義として**機械的に失敗**する——**カタログにもテストにも登録し忘れた場合を含めて**、OperationCatalog / DSL定数への追加自体が検出の起点になる。
     - **producer完了状態**: 登録済みの各producerは、次の3状態のいずれかの検証済み状態を持ち、**未実行・未分類が0件**であることをassertする。
       - **`VALUE_REACHED`**: 1件以上の意味値が**Collector境界へ到達**し、全件を検査した。
       - **`ZERO_EMISSION`**: 有効なPipelineで実行したが、仕様どおり0件を放出した（`empty`系のみ想定）。
       - **`INVARIANT_BLOCKED`**: 値生成と意味値の全件検査は完了したが、**既存の構造的不変条件によりCollector境界への到達が禁止される**（window系のみ想定。`assertNotCompositeList`。検証方法は上記2(b)）。

       producerごとの**期待状態の対応表**（`empty`系→`ZERO_EMISSION`、**window系→`INVARIANT_BLOCKED`**、それ以外→`VALUE_REACHED`）自体もassertする。0件放出は非null契約への違反ではなく、検査対象値が存在しない正常結果である。`INVARIANT_BLOCKED`も違反ではなく、**Phase 7の教材不変条件が現に到達を禁止していること自体を検証済みとして固定する状態**である（`VALUE_REACHED`の定義は「実際にCollector境界へ到達したproducer」に限定したままとし、両者を混同しない）。有限性検証で事前拒否される構成（UNBOUNDED_SOURCE等）は「Collector到達可能な有効経路」に含まれない（既存契約どおり。全producerはlimit付き等の有効Pipelineで実行可能）。
     - **変更感知型の負例テスト**: 導出元集合へ**仮想要素（架空のoperationId・仮想kind等）を注入した複製**に対して導出を実行し、登録差分がassert失敗として検出されることを確認するメタテストを置く（文字列検索ではなく、集合導出の実行で確認する）。**架空のoperationをOperationCatalogにだけ加えた場合（未分類として失敗）と、OperationCatalogと分類表の双方へ`VALUE_PRODUCING`として加えた場合（分類済みだが展開未定義として失敗）の両方**を含める。
- **運用規定（機械検出の補助）**: 上記の機械導出が漏れ検出の主であり、レビュー規定は従とする。この不変条件が破れる変更（null許容フィールドの追加、nullを返し得るDSL kind・値生成runtimeの追加等）は、unmodifiable系のNPE意味論の再設計（`ExecutionFailureView`のNPE拡張等）を伴わない限り行えない。

## 5. template / fixture / oracle

### 5.1 教材template（3件）

| templateId | 内容 | modes |
|---|---|---|
| `tmpl-collect-tounmod-list` | `collect(Collectors.toUnmodifiableList())` × employees 4件 | standard / emptySource |
| `tmpl-collect-tounmod-set` | `map(Employee::region)` + `toUnmodifiableSet`（重複除去。既存toSet教材と同型） | standard / emptySource |
| `tmpl-collect-tounmod-map` | `toUnmodifiableMap(Employee::region, Employee::name, (a, b) -> a)` × employeesMergeDemo 5件 | standard |

- titleは既存最長（toMap identity template）以下に抑える（§1.2）。
- emptySourceでは空のunmodifiableコンテナが確定する（finisher snapshotは0件蓄積からの確定として発行する）。
- jdkNotesへ§3.1の一次情報（null禁止・unordered・since 10）、§3.3の不変性注記、既存教材への対比導線を付す:
  - toUnmodifiableList ↔ 既存toList教材（「`Collectors.toList()`は型・可変性を保証しない / `toUnmodifiableList()`は不変を保証する」の対比。既存注記`COLLECT_NOTE_TOLIST`の発展）。`Stream.toList()`との対比は範囲を限定する:「**変更操作が常に`UnsupportedOperationException`となるunmodifiableという点では同じ**だが、**null禁止は`Collectors.toUnmodifiableList()`に明示された別の契約**であり、`Stream.toList()`の仕様にはnull禁止の規定がない」（§3.1）
  - toUnmodifiableSet ↔ 既存toSet教材（unordered・表示順注記は同一、違いは不変性のみ）
  - toUnmodifiableMap ↔ 既存toMap merge教材（同一データ・同一keyMapper・同一merge。違いは不変性とmapFactory版の不存在）。**2引数版の重複キー実行失敗は意味論がtoMap 2引数版と同一のため、専用templateは設けず既存`tmpl-collect-tomap-duplicate`への参照注記で扱う**（ユーザー決定）。
- 既存の対象外注記（`TO_MAP_OUT_OF_SCOPE_NOTES`のtoUnmodifiableMap項）は削除する。他の対象外注記（toConcurrentMap / key側identity）は不変。

### 5.2 手動連携（LLM取込）

- unmodifiable系kindを含むtemplateは**取込対象外**（gather / toMapと同じ扱い。将来拡張として持越し）。防御は2段: (1) 取込契約のCollector variantへ3 kindを追加しない（未定義kindは前段検証で拒否）、(2) template単位の取込無効化（toMapの`hasToMapCollectorSlot`方式と同型の判定 + 理由文言）。プロンプト生成の許可範囲言語化にunmodifiable系が現れないことをテストで固定する。

### 5.3 oracle照合（P8-O01への追加）

- **結果キー3件**: `unmodifiableList`（encounter orderのまま） / `unmodifiableSet`（表示文字列の辞書順へ正規化。iteration orderは契約にしない） / `unmodifiableMapMergeFirst`（同・正規化）。表記は既存整合規約（Employee要素・String値・正規化方式）を流用。
- **UnsupportedOperationException契約キー3件**: JDK 25実測で、返却されたList / Set / Mapへ変更操作（`add` / `add` / `put`）を実行し、**送出された例外の型名のみ**を契約として照合する（`uoeOnListAdd` / `uoeOnSetAdd` / `uoeOnMapPut` = `"UnsupportedOperationException"`）。例外が送出されなかった場合は`NO_EXCEPTION(...)`形式の文字列で必ず値化し、見逃しを防ぐ（toMap重複キーのIllegalStateException照合と同じ方式）。例外メッセージと返却実装クラス名（`ImmutableCollections.*`等）は`OBSERVATION:`行として観測記録に残し、厳密比較の対象にしない（JDK内部実装を断定しない）。
- **Simulation Core側の期待値**: 結果キー3件はCore実走行から導出する。**UOE契約キー3件はCoreが変更操作を実行しないため、§3.1の公式仕様を根拠とする固定リテラルとして期待値へ置く**。この区分（Core導出値 / 仕様由来リテラル）をsyncテストのコメントで明示する。

## 6. 完了条件

- 新3 kindのDSL検証（closed schema・mapFactoryIdキー拒否・merge型制約流用）・実行（snapshot列）・表示（蓄積 / 結果ラベルの分離・finisher snapshot・常設4行のmapFactory意味論表示・RESULT_CONFIRMED注記）のテストが成功すること。
- **finisher前後の機械検証**（§3.2〜§3.3）: 適用前の蓄積ラベル（`List（蓄積中）`等）→ 適用後の結果ラベル（`List（unmodifiable）`等）の遷移、**値の不変**（要素・entry列が前後で同一）、**TypeRefの不変**を、**各確定snapshot（`COLLECTOR_FINISHED`、teeing branch直下では`TEE_BRANCH_FINISHED`）のbefore / after表示**で検証すること。期待snapshot kind列は**入力件数 × 配置**の2軸で定める:

| 配置 \ 入力 | 要素あり | 要素なし |
|---|---|---|
| 通常root / bucket downstream / branch内部nested | 蓄積snapshot 1件以上 → `COLLECTOR_FINISHED` | 蓄積snapshot 0件 → `COLLECTOR_FINISHED` |
| teeing branch直下 | `TEE_BRANCH_ACCUMULATED` 1件以上 → `TEE_BRANCH_FINISHED`（branch root自身の`COLLECTOR_FINISHED`は**0件**） | `TEE_BRANCH_ACCUMULATED` 0件 → `TEE_BRANCH_FINISHED`（同**0件**） |

- 上表の補足: branch確定後は「左右branch → `TEE_MERGER_APPLIED` → teeing全体の終端結果」という既存順序を維持し、**branch単体の確定を直接`RESULT_CONFIRMED`へ接続しない**。通常root配置では確定snapshotの後に`RESULT_CONFIRMED`が続く。検証対象は、`toUnmodifiableList` / `toUnmodifiableSet` = 各templateのstandard・emptySource、`toUnmodifiableMap` = templateのstandard + local collectorの空入力成功形とし、teeing直下・nested・bucket配置はtemplate外のlocal collectorテストで固定してよい。
- **配置別のfinisher発行契約の検証**（§3.2の表）: 通常root（1件）/ groupingBy・partitioningBy downstream（bucketごと既存順）/ **teeing branch直下（`COLLECTOR_FINISHED`不発行・`TEE_BRANCH_FINISHED`のみで確定表示）** / teeing branch内部のnested（通常規則・branch確定と別事象）/ 空入力（0件bucket・0件branchを含む）の各配置について、発行kind・順序・回数・前後表示を検証すること。二重発行がないことを含む。teeing直下・nested・**toUnmodifiableMap空入力成功形**はtemplate外のlocal collectorテストで固定してよい。
- toUnmodifiableMap 2引数版の実行失敗経路（`COLLECT_FAILED`・`ExecutionFailureView`・FAILED遷移）のテストが成功すること。
- §4の非null不変条件の機械検証テストが成功すること。3層構成: (1) 識別可能union実軸の互換直積による列挙評価、(2) 境界到達の実行検証（全template × mode実走査 + boxed / scan / foldを含む各producerのlocal到達検証。**window系は境界到達の対象外**とし、gather放出点の全窓値再帰検査と、collector accumulate経路への直接供給が`EngineInvariantError`で遮断される負例の2点で検証する）、(3) 網羅性assert——**値variant網羅性**（`SimValue`全variantへの意味値検査器の定義）、**producer登録集合の機械導出**（OperationCatalog全operationの全域分類〔未分類で失敗〕+ union実軸の互換直積展開 + **値生成operation集合とproducer展開カバー集合の双方向一致**〔分類済みだが展開未定義で失敗〕）、**producer完了状態**（各producerが`VALUE_REACHED` / `ZERO_EMISSION` / `INVARIANT_BLOCKED`のいずれかで検証済み・未実行未分類0件・期待状態対応表の一致）、**変更感知型負例テスト**（導出元集合への仮想要素注入で登録差分の検出を確認。架空operationのCatalog単独追加と、Catalog + 分類表への`VALUE_PRODUCING`追加の両方を含む）のすべて。
- oracle照合（P8-O01への結果3キー + UOE契約3キー追加）がJDK 25実測と完全一致すること。
- **`docs/phase-8-completion-report.md` §17の持越し事項3番へ、Phase 11での解消内容・仕様版・検証結果を、歴史的記述を消さない追記形式で記録すること**（追記の実施はPhase 11実装・検証完了時。Phase 9 / 10と同じフォーマット）。
- 既存P1〜P10テストの削除・緩和・skipなし（template総数・mode組合せ等の意図的なassert更新、および対象外注記の削除に伴うP8-R04の書換えを除く）。
- 視覚回帰基準画像の更新ゼロ。
- 統合docx（第31章）のビルド・verify合格。
