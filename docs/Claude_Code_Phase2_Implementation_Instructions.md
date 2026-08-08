# ローカルClaude Code向け Phase 2実装指示

以下を、そのまま対象リポジトリのプロジェクトルートで起動したClaude Codeへ渡してください。

---

# Java Stream API 可視化シミュレーター Phase 2実装指示

## 1. 実装開始の宣言

Draft v0.8に基づくPhase 1は、GitHubの`main`へマージ済みです。

**本指示をもってPhase 2の実装開始を明示的に許可します。**

Phase 2の実装、テスト、画面確認、JDK 25 Oracle照合、証跡作成、完了報告まで行ってください。Phase 3以降は実装しないでください。

## 2. 唯一の仕様基準と優先順位

実装判断の優先順位は次のとおりです。

1. `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`
2. 本Phase 2実装指示
3. `docs/phase-1-decisions.md`
4. `docs/phase-1-completion-report.md`
5. 現在の`main`上の実装・テスト・README

Draft v0.8と本指示が矛盾する場合はDraft v0.8を正とし、コードを変更する前に矛盾箇所を報告して停止してください。過去の会話、旧Draft、画面モック、一般論を理由にDraft v0.8を上書きしないでください。

Draft v0.8自体は編集しないでください。本指示で定義する`P2-*`はPhase 2の追跡用テストIDであり、Draft v0.8本文へテストIDを追記するものではありません。

## 3. Gitと作業開始前の確認

### 3.1 基準コミット

Phase 1の正式承認コミットは`94b42219edd565b725575018579a0f24598660c1`、Phase 1を`main`へ統合したマージコミットは`7cf874687884c4dd48a199dd5155d525f492efd3`です。

作業前に次を確認してください。

```bash
git fetch origin
git switch main
git pull --ff-only
git merge-base --is-ancestor 7cf874687884c4dd48a199dd5155d525f492efd3 HEAD
git status --short
```

- `main`のHEADが上記マージコミット自身、またはその子孫であること。
- worktreeがcleanであること。
- `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`が存在すること。
- Phase 1の65件のVitest、13件のPlaywright、P1-O01が追跡可能な状態であること。

未追跡・未コミットのユーザー変更がある場合は、stash、削除、上書きをせず停止して報告してください。

### 3.2 作業ブランチ

`main`へ直接実装しないでください。別途指定されたPhase 2ブランチがなければ、cleanな最新`main`からローカルブランチ`phase-2`を作成してください。

```bash
git switch -c phase-2
```

すでに同名ブランチがある場合は上書き・削除・resetをせず、そのブランチが最新`main`を基点としているか確認してください。**本指示だけを根拠にcommit、push、Pull Request作成、mainへのmergeは行わないでください。**

### 3.3 Phase 1回帰基準

変更前に少なくとも次を実行し、基準結果を記録してください。

```bash
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

実行可能な環境では、変更前の`npm run test:e2e`と`npm run test:oracle`も実行してください。Phase 1の失敗が先に存在する場合はPhase 2実装で隠さず、原因と再現手順を報告して停止してください。

## 4. Phase 2の目的と完了範囲

Draft v0.8 §20に従い、Phase 1で成立した次の最小完全経路を壊さず拡張します。

```text
FixtureScenarioProvider
  → PipelineTemplate / TemplateInstance
  → 検証済みDSL / TypeRef
  → PipelineDefinition
  → Step Engine / Snapshot History
  → React UI
```

Phase 2の目的は次の3点です。

1. Stream生成操作を型付きSourceDefinitionとして追加する。
2. 1→1変換、object↔primitive変換、1→多→平坦化をStep EngineとUIで正しく可視化する。
3. 同一ASTから評価、TypeRef、Javaコード、説明を生成し、操作・templateを増やしてもPhase 1の履歴・再生・安全性を維持する。

Phase 2の完了条件は、Draft v0.8 §20の「型変化、flatMap親子snapshot、複数template登録が正しい」を、Domain、Application、React、E2E、JDK 25 Oracle Testで実証することです。

## 5. Phase 2で実装する操作

### 5.1 Stream生成

次をOperationCatalog、SourceDefinition、DSL/許可済みルール、TypeRef、Javaコード生成、説明生成、fixture provider、UIへ追加してください。

- `Collection.stream()`
- `Arrays.stream()`
  - object配列
  - `int[]`、`long[]`、`double[]`のprimitive配列
- `Stream.of()`
- `Stream.generate()`
- `Stream.iterate(seed, operator)`
- `Stream.iterate(seed, predicate, operator)`
- `IntStream.range()`
- `IntStream.rangeClosed()`
- `Stream.empty()`
- `IntStream.empty()`
- `LongStream.empty()`
- `DoubleStream.empty()`

`Collection.stream()`、`Arrays.stream()`、`Stream.of()`はorderedとして扱います。`Stream.generate()`はunorderedかつ無限、2引数`iterate()`はorderedかつ無限、3引数`iterate()`はpredicateにより有限化可能、`range`と`rangeClosed`はorderedかつ有限として扱ってください。

### 5.2 中間操作

Phase 1の`filter()`を型一般化したうえで、次を実装してください。

- `map()`
- `mapToInt()`
- `mapToLong()`
- `mapToDouble()`
- `boxed()`
- `mapToObj()`
- `flatMap()`
- `flatMapToInt()`
- `flatMapToLong()`
- `flatMapToDouble()`

Phase 2の変換操作はすべてINTERMEDIATEかつSTATELESSです。`flatMap`系には親子位置、mapped Stream、close情報という操作固有状態を持たせますが、Phase 3のstateful操作用共通bufferへ押し込めないでください。

### 5.3 終端操作の扱い

Phase 1で実装済みの`Stream.toList()`は、Phase 2のobject Streamを結果化する補助終端として継続使用します。

primitive Streamには`toList()`がないため、Phase 2では`boxed().toList()`で結果化するtemplateを使用してください。`sum`、`average`、`summaryStatistics`、`toArray`、`forEach`等のPhase 4終端を先行実装しないでください。

## 6. 重要なPhase境界

### 6.1 `generate()`と2引数`iterate()`の有限化

Draft v0.8 §9.3、§11.4は、無限Streamを必ず有限化し、事前実行で500 snapshot以内と検証するよう要求しています。一方、有限化に使う`limit()`はPhase 3の実装対象です。

この矛盾をPhase 3の先行実装や隠れた件数上限で回避しないでください。Phase 2では次の境界を採用します。

- `generate()`と2引数`iterate()`について、OperationCatalog、Source DSL、型検証、ホワイトリスト、Javaコード生成、説明生成、source metadataまでは実装する。
- これらを有限化操作なしで実行しようとする候補は、`PipelineDefinition`生成前の有限性検証で`UNBOUNDED_SOURCE`等の構造化エラーとして拒否する。
- UIで実行可能な教材templateとしては公開しない。操作一覧へ表示する場合はdisabledとし、「Phase 3の有限化操作が必要」等の理由を読める形で表示する。
- fixture側の要素数や500 snapshot上限で暗黙に打ち切らない。
- 表示Javaコードに、ASTに存在しない`.limit(...)`を勝手に追加しない。
- `limit()`のtraits、handler、snapshot、通過件数表示は実装しない。

この扱いを`docs/phase-2-decisions.md`とPhase 2完了報告へ明記してください。Phase 3で`limit()`を実装した後、実行可能templateへ昇格できる構造にしてください。

### 6.2 flatMap親子snapshotとJ-2

Phase 2のflatMapでは、Draft v0.8 §12.3、§12.5、§13.2、§14.1に従い、親位置、子位置、mapped Stream、close状態を保持します。

1つの確定snapshotに処理中要素を原則1件とする§12.6を維持するため、次の扱いとしてください。

- mapped Stream生成snapshotでは親要素だけを現在の処理対象とする。
- 子要素送出snapshotでは子要素だけを現在の処理対象とし、親は`parentElementId`等の文脈情報として保持する。
- 親と子を同時に2件の「処理中」として表示しない。
- mapped Streamのcloseは独立snapshotにせず、該当snapshotの詳細へ含める。
- 親が0件の子、1件の子、複数の子を生成するケースを表現できるようにする。
- すべての子をencounter orderどおり1件ずつflattenして後段へ送る。

この解釈を`docs/phase-2-decisions.md`へ記録してください。実装上、親と子を同時に処理中としなければ成立しないことが判明した場合は、J-2の例外を勝手に決めず停止し、仕様判断が必要な点として報告してください。

J-2のうち、sortedの一括並べ替え確定はPhase 3着手前、teeing左右2系統はPhase 5着手前という期限を変更しないでください。

## 7. DSL・型・コード生成

### 7.1 Source DSL

任意関数やコード文字列ではなく、識別可能Unionとして少なくとも次を表現してください。

- Collection参照
- object/primitive配列参照
- 型付き`Stream.of`値列
- 許可済みgenerate rule ID
- iterateのseed、predicate、operatorを表す許可済みrule IDまたは型付きAST
- range/rangeClosedのint境界
- 型付きempty source

型不一致、未知kind、未知rule ID、範囲値の型不一致、許可されていないsourceを拒否してください。

### 7.2 Mapper DSL

Draft v0.8 §9.1の許可範囲に従い、少なくとも次を型付きASTとして表現してください。

- Employeeフィールド参照：`name`、`age`、`salary`、`evaluation`、`region`、`hireDate`、`department`、`skills`
- `TO_UPPER`
- `PREFIX`
- object→`int`/`long`/`double`のprimitive変換
- primitive→object変換
- `skills`展開
- object/primitive配列または許可済みnested collectionのStream化

同じASTから次を生成してください。

1. 安全な評価
2. 入出力TypeRef
3. 正当なJava 25コード
4. 自然文説明

JavaScriptの`eval`、`new Function`、関数本文文字列、任意Javaコード文字列を受け付けないでください。Providerが評価済み結果、途中snapshot、Javaコード全文を返す構成にしないでください。

### 7.3 TypeRef

次の型遷移を構造化TypeRefで扱ってください。

```text
Stream<Employee> → Stream<String>
Stream<Employee> → IntStream
Stream<Employee> → LongStream
Stream<Employee> → DoubleStream
IntStream → Stream<Integer>
LongStream → Stream<Long>
DoubleStream → Stream<Double>
IntStream → Stream<String>
Stream<List<String>> → Stream<String>
Stream<int[]> → IntStream
Stream<long[]> → LongStream
Stream<double[]> → DoubleStream
```

primitive名とwrapper名を混同しないでください。`boxed()`と`mapToObj()`は同じものとして扱わず、前者は対応wrapperへのboxing、後者はmapperによる任意objectへの変換であることを表示・説明してください。

### 7.4 Javaコード生成

- EmployeeとDepartmentは引き続きJava `record`として表示する。
- record accessorは`e.name()`、`e.age()`等とする。
- Java式はASCIIの`->`、`>=`等を使用する。
- 視覚フローと型遷移だけUnicode`→`を使用する。
- object配列、primitive配列、nested collection、range、emptyを正当なJava 25構文で生成する。
- generatedコードの各行には安定line IDを付け、active nodeと一致させる。
- 同じDSL/ASTから生成したコードと説明が、評価内容と食い違わないことを構造テストする。

## 8. 必須fixture / template

TemplateRegistryへ、少なくとも次の実行可能templateを登録してください。template ID、version、node ID、line IDは安定させ、同一target operationへ複数templateを登録できる既存構造を使用してください。

| 主対象 | 基準Pipeline例 | 主な期待結果・教材ポイント |
|---|---|---|
| `Collection.stream` | `employees.stream().map(Employee::name).toList()` | Collectionからorderedに送出 |
| `Arrays.stream` object | `Arrays.stream(names).map(String::toUpperCase).toList()` | indexと要素、Stream<String> |
| `Arrays.stream` primitive | `Arrays.stream(numbers).boxed().toList()` | `int[]`からIntStream |
| `Stream.of` | `Stream.of("Java", "SQL").map(String::toUpperCase).toList()` | 引数順の要素化 |
| 3引数`iterate` | `Stream.iterate(1, n -> n <= 5, n -> n + 1).toList()` | 候補をpredicate判定しfalseで終了 |
| `range` | `IntStream.range(1, 5).boxed().toList()` | `[1,2,3,4]`、上端を含まない |
| `rangeClosed` | `IntStream.rangeClosed(1, 5).boxed().toList()` | `[1,2,3,4,5]`、上端を含む |
| object/primitive empty | 各`empty().boxed().toList()`または`Stream.empty().toList()` | 正しいStream型と空List |
| `map` | `employees.stream().map(Employee::name).toList()` | Employee→Stringの1→1変換 |
| `mapToInt` | `employees.stream().mapToInt(Employee::age).boxed().toList()` | Stream<Employee>→IntStream |
| `mapToLong` | `employees.stream().mapToLong(Employee::salary).boxed().toList()` | Stream<Employee>→LongStream |
| `mapToDouble` | `employees.stream().mapToDouble(Employee::evaluation).boxed().toList()` | Stream<Employee>→DoubleStream |
| `boxed` | `IntStream.range(1, 4).boxed().toList()` | int→Integer、primitive→object Stream |
| `mapToObj` | `IntStream.range(1, 4).mapToObj(n -> "No." + n).toList()` | boxedとの違いを示す |
| `flatMap` | `nested.stream().flatMap(List::stream).toList()` | 1親から0/1/複数子、親子位置 |
| `flatMapToInt` | `Stream.of(new int[]{1,2}, new int[]{3}).flatMapToInt(Arrays::stream).boxed().toList()` | primitive子を順にflatten |
| `flatMapToLong` | `Stream.of(new long[]{10L,20L}, new long[]{30L}).flatMapToLong(Arrays::stream).boxed().toList()` | LongStreamへの型変化 |
| `flatMapToDouble` | `Stream.of(new double[]{1.5,2.5}, new double[]{3.5}).flatMapToDouble(Arrays::stream).boxed().toList()` | DoubleStreamへの型変化 |

上表のコードは意味を固定するための基準です。既存のAST/Template設計に合わせて表現してください。コード文字列を実行する実装にはしないでください。

### 8.1 シナリオモード

実行可能な各主対象操作について、原則として次を用意してください。

- 標準：対象操作の特徴が見える。
- 途中0件：sourceは非空だが、対象操作またはその直前の検証済みfilter後に後段要素が0件となる。
- 空ソース：入力が最初から0件。

map系は標準で変換前後が視覚的に異なること、flatMap系は標準で親から複数子が生成されることを教材制約として検証してください。全modeを機械的に偽装せず、意味の成立しないmodeは`PipelineTemplate.supportedModes`に含めず、UIで選択不能理由を表示してください。

### 8.2 データと安定ID

- Phase 1のEmployee/Department基準fixtureを再利用し、必要な補助データだけ追加する。
- `List<List<String>>`には、0件、1件、複数件の子を持つ親を含める。
- object配列、`int[]`、`long[]`、`double[]`を用意する。
- 親、子、配列要素、生成要素には履歴復元可能な安定IDを付ける。
- 同値の子要素が複数あってもIDで区別できるようにする。
- scenario切替のたびに新revisionを発行し、「最初から」では現在のrevisionを維持するPhase 1仕様を変えない。

## 9. Step Engineとsnapshot

### 9.1 Source snapshot

各sourceについて、初期状態、source候補/要素の生成または取得、source送出、後段到着、結果確定を、学習上意味のある確定snapshotとして生成してください。

- Arrays.streamはindexを表示する。
- generateはsupplier呼び出し回数を保持できる構造にするが、Phase 2では有限化なしの実行を拒否する。
- iterateはseed、predicate判定、operatorによる次候補を区別する。
- range/rangeClosedは境界式を説明する。
- emptyは要素処理snapshotを生成せず、正しい型の空結果へ進む。

### 9.2 map / primitive変換 snapshot

少なくとも次を確定snapshotとして表現してください。

- 操作ノードへの要素到着
- mapper適用確定
- 変換後要素の後段送出
- 型区間の変化

元要素、mapper式、変換値、入力TypeRef、出力TypeRef、active node、line IDを同じsnapshotへ同期してください。

### 9.3 flatMap snapshot

少なくとも次を表現してください。

1. 親要素のflatMapノード到着
2. mapped Stream生成確定
3. 子要素をencounter orderで1件ずつ送出
4. 子要素のflattenと後段通過
5. mapped Streamのclose状態を詳細へ反映
6. 次の親へ進む

mapped Streamのcloseは独立snapshotにしないでください。子が0件でもmapped Stream生成と完了を説明できること、戻る/再進行で親位置・子位置・出力・close詳細が完全一致することを検証してください。

### 9.4 共通不変条件

Phase 1から次を継続してください。

- 全パネルが同じsnapshot IDを描画する。
- active nodeとJavaコードline IDが一致する。
- TypeRefとPipeline上の入出力型表示が一致する。
- 出力済み要素は必要な全操作を通過済みである。
- snapshot、Scenario、PipelineDefinitionは外部から破壊的変更できない。
- 同じscenario revisionと操作列から同じsnapshot列を生成する。
- 戻る→進むは保存済みsnapshotを再利用し、再計算しない。
- アニメーション進捗、タイマーID、実スクロール座標をsnapshotへ含めない。
- 初期snapshotを含め最大500件とし、501件目を追加しない。

## 10. UI要件

### 10.1 操作・template選択

- Phase 2で実行可能になったsource/intermediate操作を選択できるようにする。
- category、target operation、template、scenario modeの関係を明確にする。
- 操作またはtemplate切替時は自動再生を停止し、新revision、history 1件、cursor 0、READYで初期化する。
- 同じ操作へ戻した場合もrevisionを再利用しない。
- 未実装のPhase 3以降の操作を選択可能にしない。
- generate/2引数iterateは§6.1の理由を表示して実行不能とする。
- fixtureをAI生成として表示せず、AI capabilityのdisabled理由を維持する。

### 10.2 表示

- Pipeline node、型ラベル、traits badgeを一体で表示する。
- active nodeへの横スクロール追従、非折返し、min-height + auto heightを維持する。
- mapでは「元要素→mapper→新要素」を表示する。
- primitive変換では`Stream<T> → IntStream/LongStream/DoubleStream`を強調する。
- boxedとmapToObjの違いを説明する。
- flatMapでは親、mapped Stream、現在の子、flatten後の出力を区別して表示する。
- 状態は色だけでなく記号と文言で識別する。
- Javaコード、説明、Details、処理中、出力を同じsnapshotから描画する。
- PC幅と狭幅の既存レイアウト、stickyバー下余白、キーボード操作、focus-visible、reduced motionを維持する。

React UIでStream結果、型、親子位置を独自計算せず、現在snapshotから投影してください。

## 11. Phase 2で実装しないもの

次は実装しないでください。

- Phase 3：`distinct`、`sorted`、`limit`、`skip`、`takeWhile`、`dropWhile`、`peek`
- Phase 4：`reduce`、`count`、`min/max`、`find`、`match`、`sum`、`average`、`summaryStatistics`、`toArray`、`forEach`系
- Phase 5：3引数`collect`、Collector AST、Collectors、grouping、partitioning、downstream、collectingAndThen、teeing
- Phase 6：サーバーAPI、AI adapter、RemoteScenarioProvider、実AI接続
- 任意Pipelineビルダー、ノード追加・削除・並べ替えUI
- Predicate/mapper/Javaコードの自由入力
- parallelStream実行シミュレーション
- 自動再生速度変更UI
- null、NaN、Infinity、overflow、例外を主題とする教材
- primitive Streamの3引数collect
- 本番デプロイ構成
- 依存ライブラリの不要な更新

未実装操作のスタブを、実装済み・選択可能・動作可能に見せないでください。

## 12. 必須テストID

以下の`P2-*`をすべて実装し、テスト名へIDを含めて追跡可能にしてください。既存P1テストを削除・緩和・skipしてはなりません。

### 12.1 Domain単体テスト

| ID | 対象 | 必須検証 |
|---|---|---|
| P2-D01 | Source OperationCatalog | 全sourceのtraits、ordered/unordered、finite/infinite、入出力TypeRef、handlerが正しい |
| P2-D02 | Intermediate Catalog | map系/boxed/mapToObj/flatMap系がINTERMEDIATE・STATELESSで型規則とhandlerが正しい |
| P2-D03 | Collection.stream | orderedに全要素を安定ID付きで送出する |
| P2-D04 | Arrays.stream | object/int/long/double配列の型、index、順序が正しい |
| P2-D05 | Stream.of | 型付き引数を順に要素化し、templateが宣言したTypeRefと一致しない値を拒否する |
| P2-D06 | generate/iterate 2引数 | DSL/コード/説明は生成できるが、有限化なし候補をPipelineDefinition前に拒否する |
| P2-D07 | iterate 3引数 | seed→predicate→operatorの順で有限終了する |
| P2-D08 | range/rangeClosed | 半開区間/閉区間、空範囲、IntStream型が正しい |
| P2-D09 | empty source | object/int/long/doubleの空Stream型と空結果が正しい |
| P2-D10 | Mapper DSL検証 | 正常kind/field/ruleを受理し、未知kind、許可外field、型不一致、任意コードを拒否する |
| P2-D11 | map | 1→1変換、Stream型変化、評価/コード/説明が同一ASTと一致する |
| P2-D12 | mapToInt | Employee.age等をintへ変換しIntStreamとなる |
| P2-D13 | mapToLong | Employee.salary等をlongへ変換しLongStreamとなる |
| P2-D14 | mapToDouble | Employee.evaluation等をdoubleへ変換しDoubleStreamとなる |
| P2-D15 | boxed | int/long/doubleが対応wrapperのobject Streamになる |
| P2-D16 | mapToObj | primitiveから任意objectへ変換し、boxedとの差が型・コード・説明へ反映される |
| P2-D17 | flatMap | 0/1/複数子、親子位置、順序、flatten結果が正しい |
| P2-D18 | flatMapToX | int/long/doubleのmapped Streamとprimitive出力型が正しい |
| P2-D19 | mapped Stream close | closeは詳細へ含まれ、独立snapshotを生成しない |
| P2-D20 | TemplateRegistry | 同一target operationへ複数templateを登録・取得でき、ID/version/node IDが安定する |
| P2-D21 | 教材制約・mode | mapの変化、flatMapの複数子、標準/途中0件/空sourceを検証し、不成立候補を拒否する |
| P2-D22 | Source of Truth | 評価結果、TypeRef、Javaコード、説明が同一ASTから一致して生成される |
| P2-D23 | TypeRef連鎖 | object↔primitive、flatMap前後、boxed/toListまで全区間が正しい |
| P2-D24 | snapshot不変条件 | active node、line ID、親子位置、型、要素状態、出力が同一時点を表す |
| P2-D25 | 決定性・予算 | 同revisionで同じsnapshot列、全templateが500以内、無限sourceを事前拒否する |
| P2-D26 | filter回帰 | Phase 1 filterの3mode・filterチェーン・snapshot列が汎用化後も正しい |

### 12.2 Applicationテスト

| ID | 対象 | 必須検証 |
|---|---|---|
| P2-A01 | 操作切替 | timer停止、新revision、history 1件、cursor 0、READY、初期snapshot ID更新 |
| P2-A02 | template/固定sample切替 | 同一操作内の別templateへ切替え、fixture/AI表示を混同しない |
| P2-A03 | mode切替 | supportedModesだけを選択でき、同じmodeへ戻ってもrevisionを再利用しない |
| P2-A04 | flatMap履歴 | 親子位置を含むsnapshotを戻る/再進行で完全復元し、再計算しない |
| P2-A05 | 自動・停止 | 手動途中から1000msごとに1snapshotだけ進み、完了/切替/ERRORで停止する |
| P2-A06 | 検証エラー | 無限source・型不一致・許可外DSLを実行セッションへ入れず、理由を保持する |

### 12.3 React統合テスト

| ID | 対象 | 必須検証 |
|---|---|---|
| P2-R01 | 操作/template UI | 実装済み操作だけ選択可能で、非実行sourceと未実装操作の理由が読める |
| P2-R02 | TypeRef同期 | Pipeline、処理中、出力、説明の型表示が同じsnapshotと一致する |
| P2-R03 | Source表示 | 配列index、iterate候補、range境界、empty状態をsnapshotから描画する |
| P2-R04 | map表示 | 元値、mapper式、新値、要素状態を同期表示する |
| P2-R05 | primitive変換 | Int/Long/DoubleStreamとwrapper型を区別して表示する |
| P2-R06 | flatMap表示 | 親、mapped Stream、現在子、flatten出力、close詳細を区別する |
| P2-R07 | コード・説明同期 | active nodeで対応行だけを強調し、コード/説明が同じAST内容を示す |
| P2-R08 | recordコード生成 | Employee/Departmentがrecordで、accessorとdatasetコードが正しい |
| P2-R09 | a11y・responsive | 状態文言、keyboard、focus、reduced motion、狭幅縦積みを維持する |

### 12.4 E2E・視覚テスト

| ID | 対象 | 必須検証 |
|---|---|---|
| P2-E01 | finite source | Collection/Arrays/of/iterate3/range/rangeClosed/emptyを切替えて正しい結果へ到達する |
| P2-E02 | map | Employee→Stringの変換を進む/戻る/自動で確認する |
| P2-E03 | mapToX | int/long/doubleの型変化とboxed後の結果を確認する |
| P2-E04 | boxed/mapToObj | 両者の出力型・コード・説明の違いを確認する |
| P2-E05 | flatMap | 0/1/複数子の親を通過し、親子追跡とflatten順序を確認する |
| P2-E06 | flatMapToX | primitive子の型・順序・boxed後結果を確認する |
| P2-E07 | mode/操作切替 | timer停止、新revision、history初期化、表示全領域の切替を確認する |
| P2-E08 | 履歴・自動 | 型変化/flatMap途中から戻る→再進行、手動途中→自動完了を確認する |
| P2-E09 | 狭幅・Pipeline | 型ラベルを含む長いPipelineの横スクロール、active追従、sticky非遮蔽を確認する |
| P2-E10 | 視覚回帰 | map型変化、mapToInt、flatMap親子、emptyの代表snapshotを基準画像化する |

### 12.5 JDK 25 Oracle Test

| ID | 対象 | 必須検証 |
|---|---|---|
| P2-O01 | JDK 25照合 | finite source、map、mapToInt/Long/Double、boxed、mapToObj、flatMap/flatMapToX、object/primitive emptyの代表結果と型をSimulation Coreと固定Java 25コードで照合する |

P2-O01には少なくとも、`range(1,5)=[1,2,3,4]`、`rangeClosed(1,5)=[1,2,3,4,5]`、Employee各field変換、nested collectionのflatten、int/long/double配列のflatten、各emptyの空結果を含めてください。

`generate()`と2引数`iterate()`はPhase 2では実行可能Pipelineにしないため、P2-O01のCore結果照合対象へ含めず、有限性拒否をP2-D06/P2-D25で検証してください。

## 13. 検証手順

現在の`package.json`に合わせ、少なくとも次を実行してください。

```bash
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run test:e2e
npm run test:oracle
```

必要に応じて対象テストを先に実行して構いませんが、完了判定前には全件を再実行してください。

追加で次を確認してください。

1. 既存P1テストID 41件＋P1-O01がすべて成功する。
2. P2テストID 52件がすべて実装され成功する。
3. PC幅と狭幅で、map、primitive変換、flatMap、emptyを目視確認する。
4. 視覚回帰の期待画像を意図せず一括更新していない。
5. `eval`、`new Function`、動的コード生成、AI SDK、HTTP AI接続が混入していない。
6. Phase 3以降のoperation ID、handler、選択可能UI、教材templateが先行実装されていない。
7. 全fixtureのsnapshotBudgetが500以内で、無限source候補が事前拒否される。
8. `git diff --check`、`git diff --stat`、`git status --short`で変更範囲を確認する。

テスト失敗をskip、期待値緩和、テスト削除、過度なmock、基準画像の無条件更新で隠さないでください。環境制約で未実行のテストがある場合は成功扱いせず、原因、試行内容、残作業、再実行コマンドを明記してください。

## 14. 成果物

既存規約を維持し、次を作成・更新してください。

- `docs/phase-2-decisions.md`
  - generate/2引数iterateのPhase境界
  - flatMap親子snapshotとJ-2の扱い
  - その他、仕様本文を変更しない範囲の実装判断
- `docs/phase-2-completion-report.md`
- `artifacts/phase-2/`
  - PC幅/狭幅キャプチャ
  - Oracle結果
  - 必要な検証ログまたは要約
- `e2e/__screenshots__/`配下のPhase 2視覚回帰基準画像
- `README.md`
  - Phase 2完了時のみ実装状況、実行方法、テスト結果、ドキュメント一覧を更新

`docs/phase-1-completion-report.md`と`docs/phase-1-decisions.md`は過去のPhase 1記録として保持し、Phase 2の内容へ書き換えないでください。

## 15. Phase 2完了条件

次をすべて満たした場合だけ「Phase 2完了」と判定してください。

- Draft v0.8 §20のPhase 2実装内容と完了条件を満たす。
- §5の実行可能操作がDomain→Application→React UIまで縦断実装される。
- generate/2引数iterateが§6.1どおり安全に境界化され、Phase 3のlimitを先行実装していない。
- flatMap親子snapshotが§6.2、§9.3どおり成立する。
- object↔primitiveのTypeRefが全パネルとJavaコードで一致する。
- 既存P1テストとP1-O01がすべて成功する。
- P2必須52テストIDがすべて実装・成功する。
- lint、型検査、production buildが成功する。
- Playwright E2E、視覚回帰、PC/狭幅確認が完了する。
- P2-O01がJDK 25で成功する。
- 既知の仕様差異がゼロ、または未解決差異として明示されている。
- 全templateが500 snapshot上限を満たす。
- Phase 3以降を先行実装していない。
- ユーザーの既存変更を破棄していない。

1項目でも満たせない場合は「Phase 2未完了」とし、残作業、影響、再現手順を具体的に報告してください。

## 16. 完了報告の必須項目

`docs/phase-2-completion-report.md`とチャット報告へ、次を必ず含めてください。

1. Phase 2の完了/未完了判定
2. 基準`main`コミットと作業ブランチ
3. 実装済みsource/intermediate操作
4. generate/2引数iterateの実装済み部分と実行不能境界
5. 未実装のPhase 3以降の操作一覧
6. 主な変更ファイルとアーキテクチャ上の役割
7. 実行した全コマンドと終了結果
8. テスト種別ごとの総数、成功、失敗、skip、未実行
9. P2必須52 IDを1件ずつ記載した対応表
10. 既存P1 41 ID＋P1-O01の回帰結果
11. P2-O01のJDKベンダー/バージョン、ケース、照合結果
12. flatMap代表snapshotの構造比較結果
13. object↔primitiveのTypeRef連鎖比較結果
14. PC幅/狭幅キャプチャと視覚回帰画像の保存先
15. 仕様との差異と実装判断
16. 500 snapshot上限と全templateの実測件数
17. 既知の問題、J-2、次Phaseへの持越し
18. 最終`git diff --stat`と`git status --short`
19. commit、push、PRを行っていないことの確認

「全テスト成功」「仕様準拠」だけで済ませず、コマンド、件数、ID、成果物パスを根拠として記載してください。

## 17. 停止条件

次の場合は推測で進めず、変更前または問題判明時点で停止して報告してください。

- Draft v0.8と本指示に実装結果を変える矛盾がある。
- Phase 1マージコミットが現在の`main`の祖先でない。
- worktreeに未確認のユーザー変更がある。
- Phase 1回帰テストが変更前から失敗する。
- generate/2引数iterateを、Phase 3操作なしに正確かつ有限に実行する必要が生じた。
- flatMapで親子を同時に処理中としなければ仕様を満たせない。
- 500 snapshot以内へ収まらない必須templateがある。
- 仕様にない依存追加、API、AI接続、任意コード実行が必要になる。
- 既存設計の破壊的変更や大量のP1テスト書き換えが必要になる。

## 18. 最終禁止事項

- Draft v0.8を変更しない。
- Phase 3以降を実装しない。
- Phase 1の完了報告・判断記録をPhase 2用に書き換えない。
- AIを接続しない。
- fixtureをAI生成と表示しない。
- 任意コード文字列を評価・表示ソースにしない。
- UIで結果、型、親子位置を独自計算しない。
- 無限Streamを暗黙の要素数や500上限で打ち切らない。
- 未実装操作を実装済みに見せない。
- 失敗、skip、未実行、仕様差異を隠さない。
- ユーザーの変更を削除、stash、reset、checkoutで破棄しない。
- 別途指示なしにcommit、push、PR、mergeを行わない。

Phase 2の実装、検証、証跡作成、完了報告まで実行してください。

---

## 使用方法

1. ローカルPCで対象リポジトリを最新化します。
2. プロジェクトルートでClaude Codeを起動します。
3. この文書の「Java Stream API 可視化シミュレーター Phase 2実装指示」以降を渡します。
4. Claude Codeの完了報告後、コード、テスト、キャプチャ、`docs/phase-2-completion-report.md`をレビューします。
