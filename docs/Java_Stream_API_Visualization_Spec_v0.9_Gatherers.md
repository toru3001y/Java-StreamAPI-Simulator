# Java Stream API 可視化シミュレーター 仕様書 v0.9（Gatherers差分版）

## 1. 版管理（Draft v0.8 §1.2の変更管理に基づく）

- 版番号: **v0.9**（第4版ドラフト。codexレビュー第1回指摘10件・第2回7件・第3回3件を反映）
- 本書の構成: **v0.9 = Draft v0.8（`docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`、無編集のまま保持）+ 本差分文書**。v0.8の全文転記は行わない。
- 変更理由: Java 24で導入されJava SE 25に収録された`Stream.gather` / `Gatherers`を教材対象へ追加するため。
- 作成日: 2026-08-12

### 1.1 優先順位

**本書の明示的なGatherer固有規定だけがv0.8に優先する。**本書が明示的に変更していない一般原則・不変条件・検証順序・UI原則はすべてv0.8を適用する。v0.8を上書き・追加する**主要な追加箇所**は次のとおり。これに加え、Gatherer追加に伴う横断的な追加（OperationCatalog登録・template / fixture・UI・テスト・Oracle等）も、本書の明示規定がv0.8の該当章（§7 OperationCatalog、§8 Pipelineテンプレートモデル、§24 全体テスト戦略等）への追加としてv0.8に優先する。

1. 付録A（実装対象メソッド一覧）への追加: §2.1
2. §3.2（初版に含めないもの）への追加: §2.2
3. §13.2（独立snapshotになる処理）への追加: §6
4. §12.3（Snapshot構造）・§12.4（要素状態）・§12.5（操作固有状態）への追加: §6（Gatherer専用context・合成要素・要素状態遷移）
5. §6.1（Java表示モデル）・§6.2（補助データ）に対する実行値モデルの一般化: §6.3（合成値）
6. 付録B（0件時の結果）への追加: §7
7. 付録C（可視化パターン）への追加: 窓束ね型（window系）・累積放出型（scan）・累積確定型（fold）
8. §14（操作別可視化仕様）・§15（構造表示）への追加: §5
9. §7（OperationCatalog）・§8（Pipelineテンプレート）・§9.1（DSL許可構造）への追加: §8
10. §20（Phase別実装計画）へのPhase 7行の追加、§24（全体テスト戦略）へのP7系列の追加: §9

### 1.2 影響するPhase

- **Phase 7（新設）のみ。**
- **完了済みのPhase 1〜5**: 意味論・受入条件・必須テストID・判断記録・完了報告は一切変更しない。ただし、**共通UI（操作選択等）・視覚回帰基準画像・Oracle suite構成は、Phase 7実装時の意図的更新対象になり得る**（前例: Phase 5で操作選択UIへのカテゴリ追加によりPhase 1〜4の視覚回帰基準画像16枚を意図的に更新。`docs/phase-5-completion-report.md`参照）。意図的更新は理由つきでPhase 7完了報告へ記録する。
- **Phase 6（未着手・持越し状態）**: Phase 6の定義・完了条件は変更しない。Phase 7はPhase 6完了後に実施し、Phase 6成果（総合試験・AI候補検証を含む）を回帰として再実行する。
- 既存テストID（P1〜P6）は変更しない。Phase 7の必須テストID（`P7-*`）はPhase 7実装指示書で確定する。

## 2. 追加する実装対象メソッド（v0.8 付録Aへの追加）

### 2.1 対象

| メソッド | 分類 | 優先度 |
|---|---|---|
| `Stream.gather(Gatherer)` | 中間操作（**STATEFUL**。§3.1のとおり公式に "stateful intermediate operation"） | 高 |
| `Gatherers.windowFixed(int)` | 組み込みGatherer | 高 |
| `Gatherers.windowSliding(int)` | 組み込みGatherer | 中 |
| `Gatherers.scan(Supplier, BiFunction)` | 組み込みGatherer | 高 |
| `Gatherers.fold(Supplier, BiFunction)` | 組み込みGatherer | 中 |

### 2.2 対象外（v0.8 §3.2への追加）

- **`Gatherers.mapConcurrent(int, Function)`**: 仮想スレッドによる並行タスク実行・タスクのキャンセル・例外の`RuntimeException`再送出という並行実行の意味論を含み（§3.2引用）、決定的な逐次Step Engine（同一revisionから同一snapshot列）の初版範囲では正確に可視化できないため対象外とする。存在と意味（最大並行度・stream順序保持）は補助説明でのみ扱う。v0.8 §3.2のparallelStreamと**同種の「実行せず補助説明のみ」区分**へ置く（parallelStreamと同一の機能だという意味ではない）。
- **カスタムGathererの自由記述**: v0.8 §3.2（任意コード実行なし・DSLホワイトリスト）を維持する。
- **short-circuitするGathererの実行**: 「integratorがfalseを返すと短絡する」仕組み（§3.1引用）は説明・jdkNoteでのみ扱い、実行教材は提供しない（教材スコープの判断）。組み込み4種の実行で短絡は発生しない前提のsnapshot契約とする（§6）。なお「組み込み4種のintegratorがGreedy実装か」はAPI仕様に明示がないため断定せず、Phase 7のOracle観測項目とする（§10）。Gatherer自身が短絡しないことと、`limit`等によるPipeline短絡は別概念であり、**既存教材（gatherを含まないPipeline）の短絡意味論はこれまでどおり維持する**。ただし`limit`等の短絡操作を**gatherの下流へ置く合成**は、次項のとおりPhase 7対象外である。
- **`Gatherer.andThen`による合成Gatherer**: 対象外。
- **複数gatherノードの連結**（`gather(g1).gather(g2)`）および**gatherノードより下流に短絡を生じる操作を置く合成**: Phase 7では対象外とする（将来拡張）。下流短絡がgather上流の評価打切り・バッファ・finisher・未評価要素の状態とどう合成されるかのsnapshot契約が本書では未確定のため、実行可能templateを§8.4の範囲に限定する。例外として`fold → findFirst`は、foldが全入力処理後に単一要素を放出する（§3.2）ため下流短絡による上流評価の打切りが生じず、基準templateに含める。
- **`Stream.gather`のprimitive特化Stream版**: JDKに存在しない（`gather`は`Stream<T>`のみ。型引数T / Rは参照型＝boxed型）。IntStream等からは`boxed()`経由とする。

## 3. Java SE 25仕様（一次情報。2026-08-12取得）

### 3.1 Stream.gather / Gatherer<T, A, R>

出典: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html#gather(java.util.stream.Gatherer) / https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Gatherer.html（いずれも@since 24）

- `Stream.gather(Gatherer)`は **"stateful intermediate operation"** であり、拡張ポイント（extension point）。`Stream<R>`を返す。
- 型パラメータ: T=入力要素型、A=（可変になり得る）中間状態型、R=出力要素型。
- 構成要素:
  - `initializer()` — 中間状態の生成。省略可（defaultならstateless扱い）
  - `integrator()` — **必須**。要素を処理し、状態を更新し、`Downstream.push`で出力
  - `combiner()` — 2状態の結合。省略可。"Gatherers whose combiner is defaultCombiner() may only be evaluated sequentially."
  - `finisher()` — stream終端時の処理（end-of-stream hook）。省略可
- 短絡: "When the integrator function returns false, it shall be interpreted just as if there were no more elements to pass it."
- Greedy（一般則）: "Gatherers whose integrator is an instance of Gatherer.Integrator.Greedy can be assumed not to short-circuit"（個々の組み込みGathererがGreedy実装かどうかはAPI仕様に明示されていない）

### 3.2 組み込みGatherers

出典: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Gatherers.html（@since 24）

- `fold(Supplier initial, BiFunction folder)`: "an ordered, reduction-like, transformation"。`initial`は "the identity value for the fold operation"。"If no exceptions are thrown during processing, then this operation only ever produces a single element."
- `scan(Supplier initial, BiFunction scanner)`: "a Prefix Scan -- an incremental accumulation"。"Starting with an initial value obtained from the Supplier, each subsequent value is obtained by applying the BiFunction to the current value and the next input element, after which the resulting value is produced downstream."（入力要素ごとに結果を下流へ産出）
- `windowFixed(int windowSize)`: 固定サイズの窓。"The last window may contain fewer elements than the supplied window size."。空streamでは窓を生成しない。
- `windowSliding(int windowSize)`: "each subsequent window includes all elements of the previous window except for the least recent, and adds the next element in the stream"。**"If the stream is empty then no window will be produced. If the size of the stream is smaller than the window size then only one window will be produced, containing all elements in the stream."**
- window系共通: "Each window produced is an unmodifiable List; calls to any mutator method will always cause UnsupportedOperationException to be thrown."。`windowSize`が1未満のとき`IllegalArgumentException`。API Note: **"For efficiency reasons, windows may be allocated contiguously and eagerly. This means that choosing large window sizes for small streams may use excessive memory for the duration of evaluation of this operation."**（§8.2のwindowSize上限の根拠）
- `mapConcurrent(int, Function)`: 仮想スレッドで並行実行、"This operation preserves the ordering of the stream."。mapperが例外で完了した場合は`RuntimeException`として再送出され、残タスクはキャンセルされる（対象外の根拠。§2.2）

## 4. 教材目標（Phase 7で学習者が押さえる最低限のポイント）

1. `Stream.gather`は**STATEFULな中間操作**であり、Gathererという「収集戦略」を差し替えられる（終端の収集戦略であるCollectorとの対比）。
2. Gatherer<T,A,R>の構造: 入力T・中間状態A・出力R。
3. **4構成要素すべて**（initializer / integrator / combiner / finisher）の役割。組み込み4種の実行で次を実演する:
   - initializer（状態の生成）: 4種すべて。各gatherノードの初期状態生成を独立snapshot（`GATHER_INITIALIZED`。§6.1）で表示し、空ソースでも実演できるようにする
   - integratorによる状態更新と逐次push: scan（1入力→1出力）、windowFixed / windowSliding（窓成立時のpush）
   - finisher（end-of-stream hook）: foldの最終1件push、windowFixedの最後の不完全窓flush、**windowSlidingの入力件数が窓サイズ未満のときの1窓flush**
   - combiner: 本実行では呼ばれない。構造表示に**combiner行を常設**し、「逐次実行のため呼出し0回。並列実行時に2つの中間状態を結合する役割」という**意味論のみ**を表示する。組み込み4種のcombiner / finisherがJDK実装上default実装と同一かはAPI仕様に明示がないため断定せず（§4末尾の原則）、Phase 7のOracle観測項目とする（§10）
4. 「途中で止める」仕組み: integratorがfalseを返すとstream終端と同じ扱いになる（§3.1引用）。実行教材では扱わないことを明示し、limit / takeWhileの短絡（実装済み教材）との対比を補助説明で行う。
5. mapConcurrentの存在と、実行対象外の理由（並行実行の意味論。§2.2）。

なお「どのsnapshotをどの構成要素の動作として表示するか」（§5・§6）は**教材モデル上の割当て**であり、JDK内部実装の構成（各組み込みGathererが内部でどう実装されているか）を断定する説明にはしない（Phase 5のCOLLECTOR_FINISHED発行表と同じ分離手法）。

## 5. 可視化仕様（v0.8 §15相当の追加）

全体骨格「入力 → 処理中 → 出力」を維持し、gatherノードでは中央にGatherer構造（**initializer / integrator / combiner / finisherの4行**と現在状態）を表示する。

- 表示の実装は、Phase 5のCollector構造ツリーの**CSS・ツリー描画パターンのみを流用**する。Collector AST・CollectorContext・CollectorStructurePanel等のCollector専用の型契約へGathererを押し込めず、**Gatherer専用のcontextと表示コンポーネント**を新設する（v0.8「操作固有状態は専用contextへ」の原則）。
- 4行（initializer / integrator / combiner / finisher）は**常設**とする。combiner行は「逐次実行のため呼出し0回」の意味論表示（§4）。scanのfinisher行は「終端での追加産出なし」の意味論表示とし、「finisherが無い」というJDK実装同一性の断定はしない。

| Gatherer | 表示方針 |
|---|---|
| windowFixed | 構築中の窓バッファへ要素を追加 → 窓サイズ到達で窓を確定・放出（unmodifiable List）→ 終端で残要素があれば不完全窓をfinisher表示でflush |
| windowSliding | 窓バッファへ追加。窓サイズ到達後は「最古を除き次を追加」を1回の状態更新として表示（除かれた要素をcontextで明示）→ 窓成立ごとに放出。入力件数が窓サイズ未満なら終端でfinisher表示により全要素の1窓を放出 |
| scan | 初期値 → 要素ごとに累積値を更新し、更新後の累積値を放出（1入力→1出力）。finisher行は「終端での追加産出なし」の意味論表示（§5冒頭） |
| fold | 初期値 → 要素ごとに累積値を更新（放出なし）→ 終端でfinisher表示により最終値1件だけを放出 |

- 型遷移: `Stream<T> → Stream<R>`をTypeRefで表示する。window系は`Stream<Employee> → Stream<List<Employee>>`のように要素型がListになることを強調する（TypeRefは既存の`stream` + `collection`の合成で表現可能）。
- 窓のunmodifiable性を注記する（§3.2引用）。
- foldとreduce、scanとreduceの対比（中間操作か終端操作か、逐次放出の有無）を補助説明で行う。

## 6. snapshot契約（v0.8 §12〜§13への追加)

既存原則を変更なしで継続する: 1確定snapshotに処理中要素は最大1件、初期含め最大500 snapshot、決定性（同一revision同一列）、戻る→進むの完全復元、UIは確定snapshotのみ描画。

### 6.1 SnapshotKind（候補名。最終確定はPhase 7実装指示書。既存全kindとの衝突なきこと）

**状態の更新と後段への放出は別snapshotとする**（既存のMAPPING_APPLIED / MAPPED_EMITTED、SORT_ORDER_CONFIRMED / SORT_EMITTEDの分離と同じ原則）。

| SnapshotKind候補 | 内容 |
|---|---|
| `GATHER_INITIALIZED` | initializerによる初期状態（空バッファ / 初期値）の生成確定。**各gatherノードにつき正確に1件**、最初の要素処理前（空ソースでは終端処理前）に発行する。空ソースでもinitializerを実演できる |
| `WINDOW_BUFFER_UPDATED` | 窓バッファの状態更新確定。windowFixedは追加。windowSlidingの「最古を除き次を追加」（evict + append）は**1回の状態更新**とし、除かれた要素はcontextで表示する |
| `SCAN_ACCUMULATED` | scan累積値の更新確定（放出は含まない） |
| `FOLD_ACCUMULATED` | fold累積値の更新確定（放出しない） |
| `GATHER_FINISHED` | finisher相当の終端処理の確定（最終出力の内容確定。放出は含まない） |
| `GATHER_EMITTED` | gather出力要素1件の後段送出確定（窓・scan累積値・fold最終値に共通。既存のSOURCE_EMIT / MAPPED_EMITTED等と同一の更新へ二重発行しない） |

**`GATHER_FINISHED`の統一発行規則**: 終端での追加産出があり得る操作（windowFixed / windowSliding / fold）は、**実際の放出・残余の有無にかかわらず終端で正確に1件**発行する（残余なし・放出なしの場合はその旨をcontextで明示）。終端産出が定義上ない操作（scan。§3.2「入力要素ごとに産出」）は発行しない。これは教材規約であり、JDK内部のfinisher実装の有無・呼出しを断定する説明にはしない。

### 6.2 操作別の確定snapshot列

（下記は要素到着`NODE_ARRIVAL`・下流処理・`RESULT_CONFIRMED`・`STREAM_CONSUMED`等の既存kindと組み合わせた、gatherノード視点の規定順序。全列の厳密な合成はPhase 7実装指示書で確定）

すべての列は、当該gatherノードの`GATHER_INITIALIZED`（1件）から始まる。

- **windowFixed（標準・残余あり）**: `GATHER_INITIALIZED` → 要素ごとに `NODE_ARRIVAL → WINDOW_BUFFER_UPDATED`。窓サイズ到達時に `GATHER_EMITTED`（窓を合成要素として放出）→ 下流処理。全要素処理後 `GATHER_FINISHED`（不完全窓の確定）→ `GATHER_EMITTED` → 下流処理。
- **windowFixed（入力件数が窓サイズの正確な倍数）**: 同上だが、全要素処理後の `GATHER_FINISHED` は「残余なし・追加放出なし」を明示する1件のみ発行し、後続の`GATHER_EMITTED`はない。
- **windowFixed（空ソース）**: `GATHER_INITIALIZED` → `GATHER_FINISHED`（放出0件を明示）→ 終端の空結果確定。
- **windowSliding（入力件数 ≥ 窓サイズ）**: `GATHER_INITIALIZED` → 要素ごとに `NODE_ARRIVAL → WINDOW_BUFFER_UPDATED`。窓成立ごとに `GATHER_EMITTED`。終端で `GATHER_FINISHED`（「追加放出なし」を明示する1件のみ）。
- **windowSliding（0 < 入力件数 < 窓サイズ）**: `GATHER_INITIALIZED` → 全要素をバッファ → `GATHER_FINISHED`（全要素の1窓を確定）→ `GATHER_EMITTED` → 下流処理。
- **windowSliding（空ソース）**: `GATHER_INITIALIZED` → `GATHER_FINISHED`（放出0件）→ 終端の空結果確定。
- **scan（標準）**: `GATHER_INITIALIZED`（初期値の生成を表示）→ 要素ごとに `NODE_ARRIVAL → SCAN_ACCUMULATED → GATHER_EMITTED` → 下流処理。`GATHER_FINISHED`は発行しない（§6.1の統一規則）。
- **scan（空ソース）**: `GATHER_INITIALIZED`（初期値の生成のみ実演）→ 終端の空結果確定。
- **fold（標準）**: `GATHER_INITIALIZED` → 要素ごとに `NODE_ARRIVAL → FOLD_ACCUMULATED`（放出なし）。全要素処理後 `GATHER_FINISHED`（最終値の確定）→ `GATHER_EMITTED`（1件放出）→ 下流処理。
- **fold（空ソース）**: `GATHER_INITIALIZED` → `GATHER_FINISHED`（初期値を最終値として確定）→ `GATHER_EMITTED`（初期値1件）→ 下流処理。

空ソースでも`GATHER_INITIALIZED`・`GATHER_FINISHED`（scan除く）を発行するのは、initializer / finisherの存在を画面で識別するための**教材規約**であり、JDK内部の呼出しを断定する説明にはしない（§4末尾）。

### 6.3 実行値と安定IDの契約

Pipelineを流れる値と要素IDについて、次を契約とする（実装型の詳細はPhase 7実装指示書で確定）。

1. **合成値モデル**: 実行値モデル（SimValue）を、窓値=「要素値のList」を保持できる形へ一般化する（現行のstring専用List値の一般化。任意型のList<T>を表現し、TypeRefの`collection`と対応させる）。
2. **窓の安定ID**: 窓は複数入力から生成される**合成要素**であり、既存入力のElementIdを流用しない。**合成IDにはgatherノードのnodeIdを必ず含め**、ノードごとの生成順連番と組み合わせてPipeline全体（ElementIdをグローバルキーとする既存Snapshot構造）で一意な決定的IDとする（例: `<nodeId>-win-1`, `<nodeId>-win-2`…）。**メンバー参照はgatherノードへの入力要素のElementId列**（直前ノードが放出した時点のID。合成要素が入力ならその合成ID）としてGatherer専用contextへ保持する（表示・履歴復元・「窓の中身はどの入力要素か」の追跡用。source由来の末端IDへの展開が必要な場合は既存の要素追跡に委ねる）。
3. **scan出力のID**: 1入力→1出力の対応であり、既存のmap系1→1変換と同じID規則（入力要素のIDを継承）に従う。既存実装の規則と差異が見つかった場合はPhase 7実装指示書で整合させる。
4. **fold最終値のID**: finisher相当の終端処理が生成する単一の合成要素として、nodeIdを含む決定的な新規ID（例: `<nodeId>-result`）を付与する。
5. **元入力要素の状態遷移**: window系では`WINDOW_BUFFER_UPDATED`で「バッファ済み」、**その要素を含む最初の窓の放出**で「通過済み」へ遷移する。windowSlidingでは放出後も要素がバッファに残り複数の窓に属し得るが、`elementLatestStates`上の最新状態は「通過済み」のままとし、**現在のバッファ所属・窓所属はGatherer専用contextのみで表す**（状態と所属の分離）。foldでは`FOLD_ACCUMULATED`で既存reduceの要素状態遷移に倣う。
6. **復元契約**: 合成ID・メンバー参照・累積値はすべてsnapshot（専用context）から完全復元でき、同一revisionの再実行で同一のID列・snapshot列を生成する。

## 7. 空入力・特殊ケース（v0.8 付録B相当の追加）

| 操作 | 空streamでの結果 | 根拠区分 |
|---|---|---|
| windowFixed → toList | 窓0件 → `[]` | **公式仕様で確定**（§3.2「空streamでは窓を生成しない」） |
| windowSliding → toList | 窓0件 → `[]` | **公式仕様で確定**（§3.2 "If the stream is empty then no window will be produced."） |
| scan → toList | 出力0件 → `[]` | **公式定義から導出**（「入力要素ごとに結果を下流へ産出」→ 入力0件なら産出0件。空入力の明示例はない） |
| fold → findFirst | `Optional[初期値]` | **公式定義から導出**（`initial`は "the identity value"、"only ever produces a single element" → 入力0件でもidentityの単一要素。空入力の明示例はない） |

- Phase 7のOracle（P7-O01）は、上表を**仕様との回帰照合**として実測確認する（実測が仕様を決めるのではなく、仕様どおりであることを照合する）。「導出」区分の2件は、導出と実測が食い違った場合に停止して報告する。

## 8. DSL契約（v0.8 §9への追加)

Gathererは型付き識別可能Unionとして表現する。任意コード文字列・関数本文は受け付けない。closed schema検証（kind → 許可キー集合 → ホワイトリスト → 型検証）はPhase 4 Terminal DSL / Phase 5 Collector ASTと同じ方式とする。Gatherer DSLに再帰（入れ子）はない。

### 8.1 構造

- `{ kind: 'windowFixed', size: <int定数> }`
- `{ kind: 'windowSliding', size: <int定数> }`
- `{ kind: 'scan', initial: <Identity>, accumulation: <AccumulationRule> }`
- `{ kind: 'fold', initial: <Identity>, accumulation: <AccumulationRule> }`

### 8.2 引数の型

- `<Identity>`: 既存Terminal DSLの`ReductionIdentity`と同じ構造（`{ type: 'int' | 'long' | 'double' | 'string', value }`）とする。null禁止・intのint32範囲・数値のsafe integer範囲などの検証規則も既存に準拠する（型構造・検証規則の踏襲であり、Terminal DSL側の型・実装を変更しない）。
- `<AccumulationRule>`: **Gatherer専用の識別可能Unionとして新設**する（`numericSum` / `stringConcat` / `employeeFieldSum { field }`。既存`ReductionDsl`と同形式）。**fieldホワイトリストはGatherer専用に`age` / `salary` / `evaluation`と定める**。既存Terminal DSLの`ReductionDsl`・`REDUCTION_FIELD_WHITELIST`（`salary` / `age`のみ）は**変更しない**——共有DSLへのfield追加はPhase 4 Terminal DSLの許可範囲を変え、§1.2「完了済みPhaseの契約は変更しない」と衝突するため。Phase 5が同じ理由でCollector専用のfieldホワイトリストを新設した前例（`docs/phase-5-decisions.md`のCollector AST判断）に従う。
- `size`: int定数・**1以上かつ16以下**（教材上の固定安全上限）。1未満はJDK実仕様（`IllegalArgumentException`。§3.2）に合わせて拒否し、16超は教材制約として構造化issueで拒否する。上限16の根拠: (1) snapshot予算だけでは入力が少ない場合に巨大なwindowSizeを検出できない、(2) 公式API Note "For efficiency reasons, windows may be allocated contiguously and eagerly. This means that choosing large window sizes for small streams may use excessive memory..."（§3.2）、(3) 教材データ規模（基準4件・補助データ）と画面表示の可読性。この上限はDSL候補全体の検証契約であり、既存の500 snapshot予算検証（事前実行）も従来どおり併用する。

### 8.3 型適合表（T=gather入力要素型、R=出力要素型）

`Stream.gather`は`Stream<T>`にのみ存在し、**型引数T / Rは参照型（boxed型）**である（§2.2）。したがって数値の累積では、T / RはInteger / Long / Doubleとなる。

| accumulation | 許可されるT | initial.type | R |
|---|---|---|---|
| `stringConcat` | String | string | String |
| `numericSum` | **Integer / Long / Double** | それぞれ int / long / double | **Tと同じboxed型** |
| `employeeFieldSum { field }` | Employee | fieldのprimitive型（age → int、salary → long、evaluation → double） | **fieldに対応するboxed型（age → Integer、salary → Long、evaluation → Double）** |

- **boxed変換契約**: `initial.type`のタグ（`'int' | 'long' | 'double' | 'string'`）はDSL上の値種別であり、gatherの累積値・出力値としては対応するboxed型（Integer / Long / Double / String）の値として扱う。累積の評価は**Gatherer専用実装**とし（既存Terminal DSL用の累積評価実装は変更しない。挙動を変えない内部共通化のみ実装判断として許容）、boxed値とprimitive演算の間の変換契約を設ける（実装方法はPhase 7実装指示書で確定。primitive名とwrapper名を混同して表示しない既存規律を維持する）。
- window系のRは`List<T>`（TypeRef: `collection(List, T)`）。適合しない組合せ（型不一致・未知kind・未知field・許可外キー）は構造化issueで拒否する。

### 8.4 Pipeline合成の許可範囲

- 本節の型規則は**定義済みtemplateを作成するとき（およびtemplate内slotの候補検証）の規則**であり、ユーザーによる任意Pipeline構築を許可するものではない（v0.8 §3.2「任意Pipelineビルダーは対象外」を維持）。
- Phase 7で実行可能にするtemplateは次に**限定**する:
  1. **基準必須template 4形**: `windowFixed → toList` / `windowSliding → toList` / `scan → toList` / `fold → findFirst`（fold → findFirstの許容根拠は§2.2）
  2. 追加templateを定義する場合も、**gatherノードは1 Pipelineに1つまで**とし、**gatherノードより下流に短絡を生じる操作（limit / takeWhile / find系 / match系等）を置かない**（fold → findFirstの形だけを例外とする）。gatherの上流に既存の中間操作（filter / map等）を置くことは一般型規則の範囲で許可する。
- 複数gatherノードの連結、gather下流の短絡合成はPhase 7対象外（§2.2。snapshot契約が未確定のため将来拡張とする）。
- AI生成候補（Phase 6のRemoteScenarioProvider）へgather DSLを開放するかはPhase 7中の判断事項とする（§10）。開放する場合も上記の限定（1ノード・下流短絡なし・windowSize 1〜16）を候補検証の契約とする。

## 9. Phase 7実装契約の概要

- 位置づけ: Phase 6（サーバーAPI・AI・総合試験）の完了後に実施する追加Phase（v0.8 §20のPhase表へPhase 7行を追加）。
- 実装範囲: §2.1の5メソッドをOperationCatalog（gatherはINTERMEDIATE + STATEFUL）・DSL・Step Engine・template / fixture・UI・テスト・Oracleまで縦断実装する。
- 完了条件（概要）: Gatherer構造表示（4構成要素）、状態遷移、§6.2のsnapshot列、§6.3のID契約、§7の空入力、型遷移がJDK 25実測との回帰照合を含めて成立し、既存P1〜P6テストが全件成功すること。
- テストIDは`P7-*`（P7-D / A / R / E / O）。必須ID表・件数・fixture値はPhase 7実装指示書で確定する。

## 10. Phase 7中に判断する事項

1. window系templateの窓サイズと基準データ件数（500 snapshot予算との両立。基準Employee 4件で窓サイズ2〜3が候補）
2. Gatherer専用AccumulationRule（§8.2で確定済み）の実装上の配置。Terminal DSL / Collector DSLの類似構造との内部的な実装共通化は、Terminal DSL・Collector DSLの許可範囲・検証挙動を一切変えない限りで実装判断としてよい（判断はPhase 7判断記録へ）
3. 組み込み4種の構成要素実装のOracle観測（`integrator() instanceof Gatherer.Integrator.Greedy`、`combiner() == Gatherer.defaultCombiner()`、`finisher() == Gatherer.defaultFinisher()`。§2.2・§4・§5の断定回避の裏取り。観測結果はjdkNote・表示文言に反映し、観測記録として保存する）
4. SnapshotKind候補名（§6.1）の最終確定と、Phase 6完了時点の全kindとの衝突再確認
5. 合成値モデル（§6.3の1）の具体型と、既存SimValueとの統合方法
6. AI生成候補へのgather DSL開放の可否（Phase 6の候補検証と整合させる）
7. 視覚回帰基準画像・共通UI・Oracle suite構成の意図的更新の範囲（§1.2。理由つきで完了報告へ記録）
