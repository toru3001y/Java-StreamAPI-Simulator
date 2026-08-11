# ローカルClaude Code向け Phase 5実装指示

以下を、そのまま対象リポジトリのプロジェクトルートで起動したClaude Codeへ渡してください。

---

# Java Stream API 可視化シミュレーター Phase 5実装指示

## 1. 実装開始の宣言

Draft v0.8に基づくPhase 4は、GitHubの`main`へマージ済みです。J-2（teeing左右2系統）の仕様は`docs/phase-5-decisions.md`で確定済みです。

**本指示をもってPhase 5の実装開始を明示的に許可します。**

Phase 5の実装、テスト、画面確認、JDK 25 Oracle照合、証跡作成、完了報告まで行ってください。Phase 6（サーバーAPI、AI adapter、実AI接続）は実装しないでください。

## 2. 唯一の仕様基準と優先順位

実装判断の優先順位は次のとおりです。

1. `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`
2. `docs/phase-5-decisions.md`（J-2 teeing確定事項。承認済みの確定判断であり変更不可。本指示§6.1参照）
3. 本Phase 5実装指示（上記2つを実装可能な粒度へ具体化する）
4. `docs/phase-4-decisions.md`
5. `docs/phase-4-completion-report.md`
6. 現在の`main`上の実装・テスト・README

Draft v0.8と本指示が矛盾する場合はDraft v0.8を正とし、コードを変更する前に矛盾箇所を報告して停止してください。`docs/phase-5-decisions.md`の確定事項（§3〜§11）と本指示が矛盾する場合も、同様に停止して報告してください。過去の会話、旧Draft、一般論を理由にDraft v0.8を上書きしないでください。

Draft v0.8自体は編集しないでください。本指示で定義する`P5-*`はPhase 5の追跡用テストIDであり、Draft v0.8本文へテストIDを追記するものではありません。

## 3. Gitと作業開始前の確認

### 3.1 基準コミット

- Phase 4の正式承認コミット: `58f28e29083a9a10f6c2eeba935a87d9bfdfacaa`
- Phase 4を`main`へ統合したマージコミット: `ae1094cbaab93bcfd61cdf27234c3ae6081fbe01`
- J-2（teeing）仕様確定コミット: `7f3ea840b05ca113c5b4f4d8ae516ed33ee1524e`（`docs/phase-5-decisions.md`新規 + README最小更新）

### 3.2 作業ブランチ

Phase 5の作業ブランチ`phase-5`は既に存在します。本指示書作成時点の状態は次のとおりです。

- ローカル`phase-5`のHEAD: `823640395f0fb38950e0ac73afc2070ef4e9bfb4`（`origin/main`のマージコミット。Phase 4マージコミットを含む）
- `origin/phase-5`のHEAD: `7f3ea840b05ca113c5b4f4d8ae516ed33ee1524e`（teeing仕様確定コミット。**上記マージコミットは未push**）

別cloneから開始する場合、`git switch phase-5`だけではPhase 4マージコミットを含みません。下記の`git merge-base --is-ancestor`検証が通らない場合は、`origin/main`を`phase-5`へマージしてから着手してください。

作業前に次を確認してください。

```bash
git fetch origin
git switch phase-5
git merge-base --is-ancestor ae1094cbaab93bcfd61cdf27234c3ae6081fbe01 HEAD
git merge-base --is-ancestor 7f3ea840b05ca113c5b4f4d8ae516ed33ee1524e HEAD
git status --short
```

- `phase-5`のHEADが両コミットの子孫であること。
- worktreeがcleanであること（本指示書ファイル自身の未コミット分を除く）。
- `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`と`docs/phase-5-decisions.md`が存在すること。

未追跡・未コミットのユーザー変更がある場合は、stash、削除、上書きをせず停止して報告してください。**本指示だけを根拠にcommit、push、Pull Request作成、mainへのmergeは行わないでください。**

### 3.3 Phase 1〜4回帰基準

変更前に少なくとも次を実行し、基準結果を記録してください。

```bash
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

実行可能な環境では、変更前の`npm run test:e2e`と`npm run test:oracle`も実行してください。

Phase 4完了時点の基準値は、Vitest 311件（36ファイル）、Playwright 50件、Oracle 4 suite（P1-O01 / P2-O01 / P3-O01 / P4-O01、P4-O02 / P4-O03判定を含む）全成功です。変更前から失敗がある場合はPhase 5実装で隠さず、原因と再現手順を報告して停止してください。

## 4. Phase 5の目的と完了範囲

Draft v0.8 §20に従い、Phase 1〜4で成立した次の経路を壊さず拡張します。

```text
FixtureScenarioProvider
  → PipelineTemplate / TemplateInstance
  → 検証済みDSL / TypeRef
  → PipelineDefinition
  → Step Engine / Snapshot History
  → React UI
```

Phase 5の目的は次の4点です。

1. `collect(Collector)`と3引数`collect(Supplier, BiConsumer, BiConsumer)`を終端操作として追加する。
2. Collectorを再帰的なCollector AST（DSL）として表現し、構造ツリー、現在経路、ノード別蓄積、内側から外側へ組み上がる結果TypeRef、finisher / mergerの独立snapshotを可視化する（Draft v0.8 §15）。
3. Phase 4のterminal runtime（単一accumulator構造）を、Collectorのcontainer / bucket / finisher構造へ一般化する（Phase 3のSTATEFUL共通バッファ、Phase 4の`TerminalRuntime`平坦構造へ押し込めない）。
4. `docs/phase-5-decisions.md`で確定したteeing仕様を実装する。

Phase 5の完了条件は、Draft v0.8 §20の「構造ツリー、蓄積、結果型、空partition、finisher / merger snapshotが正しい」を、Domain、Application、React、E2E、JDK 25 Oracle Testで実証することです。

## 5. Phase 5で実装する操作

### 5.1 collect本体

- `collect(Collector)`（付録A.3 優先度高）
- `collect(Supplier, BiConsumer, BiConsumer)`（付録A.3 優先度中）

3引数collectはDraft v0.8 §15.1に従い、supplier → accumulator → combinerを「裸の可変リダクション」として示すCollector導入教材とします。supplier / accumulator / combinerは定義済みIDのホワイトリストで表現し、任意コードを受け付けないでください。初版はsequential実行のみのため、combinerを実行済みのように表示しないでください（Phase 4のreduce 3引数combiner表示、および`docs/phase-5-decisions.md` §5.1と同じ方針）。primitive特化Streamの3引数collectは対象外です（Draft v0.8 §15.1）。

### 5.2 Collector（Draft v0.8 付録A.4の全項目）

次をすべて実装してください（括弧内は付録A.4の優先度）。

単純Collector:

- `Collectors.toList()` / `toSet()`（高）
- `Collectors.toCollection()`（中）— コンテナsupplierは定義済みID
- `Collectors.joining()`（高）— 実装必須overloadは**`joining()`（引数なし。付録A.4の明示対象）、`joining(delimiter)`、`joining(delimiter, prefix, suffix)`の3つ**。delimiter / prefix / suffixは型付きString定数。空Streamの結果は、引数なし版が空文字列`""`（0要素の連結からの導出値。Java SE 25公式APIドキュメントのjoining説明に空入力結果の明示記述はない — 2026-08-12確認）、3引数版が`prefix + suffix`（Draft v0.8 付録F.1: `Stream.<String>empty().collect(Collectors.joining(",", "[", "]"))` = `"[]"`、JDK 25実測記録）。いずれもP5-O01のJDK 25照合で実測確定する
- `Collectors.counting()`（高）
- `Collectors.summingInt/Long/Double()`（高 / 中 / 中）
- `Collectors.averagingInt/Long/Double()`（高 / 中 / 中）
- `Collectors.summarizingInt/Long/Double()`（高 / 中 / 中）
- `Collectors.minBy()` / `maxBy()` / `reducing()`（中）

downstream合成:

- `Collectors.mapping()` / `filtering()`（高）
- `Collectors.flatMapping()` / `collectingAndThen()`（中）

分類ツリー:

- `Collectors.groupingBy(classifier)`（高）
- `Collectors.groupingBy(classifier, downstream)`（高）
- `Collectors.groupingBy(classifier, mapFactory, downstream)`（低）— mapFactoryは定義済みID
- `Collectors.partitioningBy(predicate)`（高）
- `Collectors.partitioningBy(predicate, downstream)`（高）
- nested groupingBy（外側classifier → 内側groupingBy → 最終コンテナ）

Collector入れ子:

- `Collectors.teeing()`（低。ただしJ-2確定済みのため必須。§6.1）

各Collectorの表示方針はDraft v0.8 §15.2の表に従ってください（例: toSetは重複で変化しない状態も表示、joiningは現在文字列を順次連結、filteringはStream.filterとの差を示す、partitioningByはtrue / falseの2分岐を固定表示）。

`Collectors.toMap()`は付録A.4に含まれないため実装しないでください。

### 5.3 持越し対応: takeWhile / dropWhileのEmployee fieldCompare template

Phase 3から持ち越されている次を、Phase 5で完了してください。

- `takeWhile` / `dropWhile`のEmployee `fieldCompare`教材templateとfixtureの登録。

DSL・型規則・Step Engine実行はPhase 3レビュー修正で対応済みであり（`docs/phase-3-completion-report.md` §26）、残作業はtemplate・fixtureの登録のみです。takeWhileが標準modeで「境界到達までの通過と短絡後の未評価」を示せるデータ順を持つfixtureにしてください。

## 6. 重要なPhase境界

### 6.1 teeingは`docs/phase-5-decisions.md`の確定事項に従う

teeingの実装は`docs/phase-5-decisions.md` §3〜§11の確定事項をそのまま実装してください。要点は次のとおりです（詳細・根拠は同記録を正とする）。

- 全snapshotで`PROCESSING`要素は0件または1件。teeingでも例外なし（§3）。
- 左右のdownstreamへ渡るのは同じ入力要素であり、画面上左右へ表示する場合も同じ安定`elementId`を参照する表示projectionとする。要素を複製して別IDを付与しない（§3）。
- snapshot順は「到着 → 左蓄積 → 右蓄積 → 収集完了」。左右の蓄積更新は別snapshot（§4）。
- SnapshotKindは`TEE_BRANCH_ACCUMULATED`（`activeBranch: LEFT | RIGHT`）、`TEE_BRANCH_FINISHED`、`TEE_MERGER_APPLIED`を採用（§4.1）。
- mergerは両downstreamのfinisher完了後に、teeingノードごとに正確に1回。merger snapshotは`currentElementId === null`かつ`PROCESSING` 0件、`activeBranch: NONE`（§5）。
- branch状態は`elementLatestStates`へ要素を追加せず、teeing固有contextへ保持する。contextが表現すべき項目は§6の契約に従う。
- 空Streamでもmergerを省略しない（§7）。
- nested teeingはdepth-first、各mergerは対応ノードにつき1回（§8）。
- 「左→右」は教材上の表示順であり、JDKがdownstream間の呼出し順を保証するという説明にしない。jdkNotesで明示する（§11）。

実装上、これらを満たせないことが判明した場合は、例外を勝手に決めず停止して報告してください。

### 6.2 terminal runtimeのCollector構造への一般化

Phase 4完了報告§13の持越しに従い、Collector Engineは次の境界で実装してください。

- Collectorの蓄積は、Phase 3のSTATEFUL共通バッファにも、Phase 4の`TerminalRuntime`（平坦な単一構造体）にも押し込めず、Collector ASTに対応する**再帰的なCollectorRuntime**として別建てする。
- container生成、bucket決定、蓄積更新、finisher適用、merger適用を、Collector ASTのノード単位で表現する。
- finisher / mergerは「全要素処理後の構造snapshot」フェーズ（既存のfinish cascade。sortedのbuffer flushと同じ段階）に載せる。
- Phase 4の既存終端操作（reduce、count、min/max、find、match、sum、average、statistics、toList、toArray、forEach系）の挙動・snapshot列・テストを壊さない。一般化リファクタリングを行う場合も、既存P1〜P4テストIDの削除・緩和・skipをしない。

### 6.3 TypeRef・SimValueの拡張判断

既存実装とのギャップが3点あります。次の方針で実装し、判断を`docs/phase-5-decisions.md`へ追記してください（§14参照）。

1. **partitioningByのキー型**: 結果は`Map<Boolean, ...>`でありキーはwrapper Boolean。既存TypeRefの`{kind: 'primitive', name: 'boolean'}`は`boolean`と表示されるため使用せず、`{kind: 'object', name: 'Boolean'}`を使用する。primitive名とwrapper名を混同しない（Phase 2 §7.3と同じ規律）。
2. **Collector型の表現**: `Collector<T, A, R>`自体のTypeRef kindは新設せず、Collector ASTの各ノードへ入力型と結果型（RのTypeRef）を保持させ、「内側から外側へ組み上がる結果TypeRef」（Draft v0.8 §15.2）をASTノード単位で表現する。teeingでは`R1`・`R2`・`R`を区別する（`docs/phase-5-decisions.md` §5.2）。
3. **蓄積値の表現**: `SimValue`にMap / コンテナ相当のkindが無い。Collectorの蓄積状態はsnapshotのCollector固有context（§9.1）へ、構造化された表示用の値（キー、要素ID列、集計値ラベル等のプレーンな木）として保持し、`SimValue`の安易な拡張で代用しない。終端結果の表示は`TerminalResultView`のvariant追加（§9.5）で行う。

`groupingBy(classifier, mapFactory, downstream)`のTreeMap等、順序性を持つMapの結果は、その順序意味論を優先して表示する（Draft v0.8 §16.3）。既存TypeRefの`map` kindでMap容器名（TreeMap等）を表現できない場合は、表現方法を実装判断として`docs/phase-5-decisions.md`へ記録してください。

### 6.4 Set / Map表示順

Domain層は論理値とJDK上の順序性を保持し、学習用の決定的表示順はUIの純粋なDisplayOrderProjectionで生成してください（Draft v0.8 §16.3）。

- 同じsnapshotから常に同じ順序を導出する。
- 「表示を安定させるための順序」であることを注記し、JDKのiteration order保証とは分ける。
- TreeMap等、実際に順序性を持つ結果はその意味論を優先する。

## 7. DSL・型・コード生成

### 7.1 Collector AST DSL

Draft v0.8 §9.1の許可構造「Collector: collectorKind、引数、downstream、left / right Collector」に従い、Collectorを**再帰的な識別可能Union**として表現してください。

- Phase 4のTerminal DSL（`src/domain/dsl/terminalAst.ts` + `src/domain/dsl/validateTerminal.ts`）と同じclosed schema方式とする: variantごとの許可キー集合、kind・ID・fieldのホワイトリスト、許可外キーの`STRUCTURE_INVALID`拒否（例外を投げず構造化issueで返す）、再帰ノードの再帰検証。
- 少なくとも次を型付きで表現する:
  - collectorKind（§5.2の全Collector）
  - 数値集計・mapping対象のEmployeeフィールド参照（既存フィールドホワイトリスト）
  - classifier: 次の3形を許可する（Draft v0.8 §6.1のフィールド主用途表と§9.1の値参照に対応）。
    1. EmployeeのStringフィールド参照（`region`等）
    2. `Employee::department`（Department record自体をMapキーとする。Draft §6.1で`department`の主用途は「groupingBy、nested groupingBy」）
    3. Departmentフィールド参照（`e.department().name()`等。Draft §6.1で`Department.name`の主用途は「部署単位のgroupingBy」）
  - Department recordをMapキーとするgroupingByでは、Simulation CoreのキーはJava record相当の**値等価性**（`name`と`division`の一致）で判定し、JavaScriptのオブジェクト参照同一性へ依存しない。
  - **ComparatorなしのTreeMap mapFactoryと非Comparableキー（Department等）の組合せだけを禁止する**。TreeMap mapFactoryのtemplateはStringキー（`region`等）と組み合わせる。根拠（Java SE 25公式仕様、2026-08-12取得）:
    - `Collectors.groupingBy(Function)`のシグネチャは`<T,K>`で型パラメータ`K`に制約がなく（通常のgroupingByキーにComparable制約はない）、返却Mapは "There are no guarantees on the type, mutability, serializability, or thread-safety of the Map or List objects returned."
      https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html#groupingBy(java.util.function.Function)
    - `TreeMap()`（引数なし）は "using the natural ordering of its keys. All keys inserted into the map must implement the Comparable interface. (...) the put(Object key, Object value) call will throw a ClassCastException."
      https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/TreeMap.html
  - partitioningByのPredicate（既存Predicate DSLを再利用）
  - filteringのPredicate（既存Predicate DSLを再利用）
  - mappingのmapper（既存Mapper DSLを再利用）
  - flatMappingの展開規則（既存のskills展開等、許可済み規則を再利用）
  - minBy / maxByのComparator（既存Comparator DSLを再利用）
  - reducingのBinaryOperator（既存Reduction DSL IDを再利用）
  - joiningのdelimiter / prefix / suffix（型付きString定数。引数なし・delimiter単独・3引数の3形を表現できること）
  - toCollectionのコンテナsupplier ID、groupingByのmapFactory ID（定義済みIDホワイトリスト。Draft v0.8 §9.1のSupplier / MapFactory）
  - collectingAndThenのfinisher ID（定義済みIDホワイトリスト。Draft v0.8 §9.1のFinisher）
  - teeingのleft / right Collectorとmerger（許可済み結果record構造。Draft v0.8 §9.1のTeeing merger。基準は`SalarySummary`）
- downstream / left / rightには許可されたCollector ASTを再帰的に指定できる。再帰深さは教材制約として上限を設け、上限値と根拠を`docs/phase-5-decisions.md`へ記録する。
- snapshotへ含めるCollector ASTおよびCollector contextは`structuredClone`可能なプレーンな木とする（Map / Set / 関数 / 循環参照を含めない。既存のTimelineBuilderが`structuredClone`でsnapshotを複製するため）。
- 型不一致、未知kind、未知ID、許可外field、許可外の入れ子、任意コード文字列を拒否する。JavaScriptの`eval`、`new Function`、関数本文文字列、任意Javaコード文字列を受け付けない。

3引数collect用には、supplier / accumulator / combinerの定義済みID組合せ（例: `ArrayList::new` / `ArrayList::add` / `ArrayList::addAll`相当）をホワイトリストとして表現してください。

### 7.2 検証順序とslot

既存のinstantiate 7手順（構造検証 → template / slot許可範囲 → DSLホワイトリスト → TypeRef型検証 → 教材制約 → 事前実行と500 snapshot予算 → PipelineDefinition生成）へCollectorを組み込んでください。

- `ParameterSlot`へ`collector` slot（および3引数collect用slot）を追加し、slotの`allowedCollectorKinds`等でtemplateごとの許可範囲を宣言する。
- terminal nodeの結果TypeRef導出（既存`resolveTerminalNode`相当）を、Collector ASTを再帰的にたどって内側から外側へ結果型を組み上げる形へ拡張する。
- OperationCatalogへ`collect`系操作を登録する。既存の`collector`カテゴリと`fromTerminal`型規則の前例に合わせ、必要なら`fromCollector`型規則を追加する。

### 7.3 TypeRef

少なくとも次の結果型を構造化TypeRefで扱ってください。

```text
Stream<Employee> → List<Employee>（collect(toList())）
Stream<Employee> → Stream<String> → Set<String>（map + toSet）
Stream<Employee> → Stream<String> → String（map + joining）
Stream<Employee> → Long（counting）
Stream<Employee> → Integer / Long / Double（summing系）
Stream<Employee> → Double（averaging系）
Stream<Employee> → Int/Long/DoubleSummaryStatistics（summarizing系）
Stream<Employee> → Optional<Employee>（minBy / maxBy）
Stream<Employee> → Map<Department, List<Employee>>（groupingBy(Employee::department)）
Stream<Employee> → Map<String, List<Employee>>（groupingBy(region)）
Stream<Employee> → Map<String, Long>（groupingBy(region) + counting）
Stream<Employee> → Map<Department, Map<String, List<Employee>>>（nested groupingBy: department → region）
Stream<Employee> → Map<Boolean, List<Employee>>（partitioningBy。キーはwrapper Boolean）
Stream<Employee> → SalarySummary（teeing）
Stream<Employee> → List<Employee>（3引数collect。中間変換なしでEmployeeを直接収集）
```

groupingByのMapキー型はclassifierの結果型（String / Department）です。BooleanはgroupingByのclassifier結果型ではなく、partitioningByの固定キー型（wrapper Boolean）です。TreeMap mapFactoryとの組合せだけキーをComparable（String）に限定します（§7.1）。groupingBy + downstreamでは、downstreamの結果型がMapのvalue型になることをASTノード単位で表現してください。

### 7.4 Javaコード生成

- 表示用JavaコードはすべてCollector AST / DSLから生成し、任意Javaコード文字列を実行・表示ソースにしない。
- `Collectors.groupingBy(Employee::region, Collectors.counting())`や`Collectors.groupingBy(e -> e.department().name(), ...)`のような入れ子式を正当なJava 25構文で生成する。
- teeing教材では`SalarySummary` recordの宣言をJavaコード表示またはDetailsのrecord定義へ含める（既存のEmployee / Department record表示と同じ規約）。
- 生成コードの各行の安定line IDとactive nodeの一致（既存規約）を維持する。collectノードの行が長くなる場合も、行とノードの対応を崩さない。
- Java式はASCII（`->`、`::`）、視覚フローと型遷移だけUnicode`→`を使用する（既存規約）。

## 8. 必須fixture / template

TemplateRegistryへ、**§5.2の各Collector variant（summing / averaging / summarizingのInt / Long / Double、minBy / maxByを含む）につき最低1つの実行可能template**を登録してください。§5の操作は「Domain → Application → React UIまで縦断実装」が完了条件であり、templateのない操作はUIから実行できないため、代表実装での省略は認めません。template ID、version、node ID、line IDは安定させてください。

下表の基準Pipeline例は意味を固定するためのものであり、既存のAST / Template設計に合わせて表現してください。期待結果は標準Employeeデータ4件（佐藤: 35歳 / 5,500,000 / 関東 / 開発部、鈴木: 27歳 / 4,200,000 / 関西 / 営業部、高橋: 42歳 / 7,200,000 / 関東 / 開発部、田中: 29歳 / 4,800,000 / 中部 / 営業部。evaluation: 4.2 / 3.8 / 4.6 / 4.0）に基づきます。

| 主対象 | 基準Pipeline例 | 標準modeの期待結果 / 教材ポイント |
|---|---|---|
| `collect(toList())` | `employees.stream().collect(Collectors.toList())` | `List<Employee>` 4件。`Stream.toList()`との保証差を注記（Draft §16.4） |
| `collect(toSet())` | `employees.stream().map(Employee::region).collect(Collectors.toSet())` | `Set<String>` {関東, 関西, 中部}。関東の2件目で「追加しても変化しない」snapshot |
| `toCollection` | `employees.stream().collect(Collectors.toCollection(ArrayList::new))` | コンテナsupplier IDの可視化。`List<Employee>` 4件 |
| `joining()` | `employees.stream().map(Employee::name).collect(Collectors.joining())` | `"佐藤鈴木高橋田中"`。**空ソースmodeで`""`** |
| `joining(delimiter)` | `employees.stream().map(Employee::name).collect(Collectors.joining(", "))` | `"佐藤, 鈴木, 高橋, 田中"`。連結途中文字列の遷移 |
| `joining(delimiter, prefix, suffix)` | `map(Employee::name).collect(Collectors.joining(", ", "[", "]"))` | `"[佐藤, 鈴木, 高橋, 田中]"`。**空ソースmodeで`"[]"`**（Draft付録F.1） |
| `counting` | `employees.stream().collect(Collectors.counting())` | `4L`。空Streamで`0L` |
| `summingInt` | `collect(Collectors.summingInt(Employee::age))` | `133`（35+27+42+29） |
| `summingLong` | `collect(Collectors.summingLong(Employee::salary))` | `21700000L` |
| `summingDouble` | `collect(Collectors.summingDouble(Employee::evaluation))` | `16.6` |
| `averagingInt` | `collect(Collectors.averagingInt(Employee::age))` | `33.25` |
| `averagingLong` | `collect(Collectors.averagingLong(Employee::salary))` | `5425000.0`。空Streamで`0.0` |
| `averagingDouble` | `collect(Collectors.averagingDouble(Employee::evaluation))` | `4.15` |
| `summarizingInt` | `collect(Collectors.summarizingInt(Employee::age))` | count=4, sum=133, min=27, max=42, average=33.25 |
| `summarizingLong` | `collect(Collectors.summarizingLong(Employee::salary))` | count=4, sum=21700000, min=4200000, max=7200000, average=5425000.0 |
| `summarizingDouble` | `collect(Collectors.summarizingDouble(Employee::evaluation))` | count=4, sum=16.6, min=3.8, max=4.6, average=4.15 |
| `minBy` | `collect(Collectors.minBy(Comparator.comparingInt(Employee::age)))` | `Optional[鈴木]`。空でOptional.empty() |
| `maxBy` | `collect(Collectors.maxBy(Comparator.comparingLong(Employee::salary)))` | `Optional[高橋]`。候補更新表示 |
| `reducing` | `map(Employee::name).collect(Collectors.reducing((a, b) -> a + b))`相当 | `Optional[佐藤鈴木高橋田中]`。accumulator表示、空でOptional.empty() |
| `mapping` | `groupingBy(e -> e.department().name(), Collectors.mapping(Employee::name, Collectors.toList()))` | `{開発部=[佐藤, 高橋], 営業部=[鈴木, 田中]}`。mapper後にdownstreamへ |
| `filtering` | `groupingBy(e -> e.department().name(), Collectors.filtering(e -> e.salary() >= 5_000_000L, Collectors.toList()))` | `{開発部=[佐藤, 高橋], 営業部=[]}`。**営業部が空bucketとして残る**ことがStream.filterとの差 |
| `flatMapping` | `groupingBy(e -> e.department().name(), Collectors.flatMapping(skills展開, Collectors.toList()))` | bucket内で展開 → flatten → downstream |
| `collectingAndThen` | `collect(Collectors.collectingAndThen(Collectors.toList(), List::copyOf))` | downstream完了後にfinisherを独立snapshotで適用 |
| `groupingBy` | `employees.stream().collect(Collectors.groupingBy(Employee::department))` | `Map<Department, List<Employee>>`: 開発部=[佐藤, 高橋]、営業部=[鈴木, 田中]。キーはDepartment record（値等価。§7.1）。bucketへ追加しMapが成長 |
| `groupingBy` + downstream | `groupingBy(Employee::region, Collectors.counting())` | `{関東=2, 関西=1, 中部=1}`。bucket決定後にdownstreamを実行 |
| `groupingBy` + mapFactory | `groupingBy(Employee::region, TreeMap::new, Collectors.toList())` | classifier / mapFactory / downstreamの分離表示。キーはString（Comparable）でTreeMapの順序意味論を表示 |
| nested `groupingBy` | `groupingBy(Employee::department, Collectors.groupingBy(Employee::region))` | `Map<Department, Map<String, List<Employee>>>`: 開発部={関東=[佐藤, 高橋]}、営業部={関西=[鈴木], 中部=[田中]}（Draft §6.1のdepartment主用途どおり） |
| `partitioningBy` | `collect(Collectors.partitioningBy(e -> e.age() >= 30))` | `{false=[鈴木, 田中], true=[佐藤, 高橋]}`。true / false固定2分岐 |
| `partitioningBy` + downstream | `partitioningBy(e -> e.age() >= 30, Collectors.counting())` | `{false=2, true=2}` |
| `teeing` | `collect(Collectors.teeing(Collectors.counting(), Collectors.averagingLong(Employee::salary), SalarySummary::new))` | `docs/phase-5-decisions.md` §9の基準fixture。標準で`SalarySummary[employeeCount=4, averageSalary=5425000.0]`、空で`SalarySummary[employeeCount=0, averageSalary=0.0]` |
| 3引数`collect` | `employees.stream().collect(ArrayList::new, ArrayList::add, ArrayList::addAll)` | `List<Employee>` 4件をEmployeeのまま直接収集（§7.3の型連鎖と一致させる）。supplier → accumulator。combinerは定義表示のみ（sequential） |
| `takeWhile`（持越し） | `employees.stream().takeWhile(e -> e.salary() >= 5_000_000L).toList()`相当 | `[佐藤]`。鈴木（4,200,000）で境界到達し、高橋・田中は未評価 |
| `dropWhile`（持越し） | `employees.stream().dropWhile(e -> e.salary() >= 5_000_000L).toList()`相当 | `[鈴木, 高橋, 田中]`。佐藤をdropし、鈴木で通過モードへ遷移 |

上表のうちdouble集計（summingDouble / averagingDouble / summarizingDoubleのsum・average）の期待値は10進表示の見込み値です。倍精度浮動小数点の表現・JDKの加算方式（補償付き加算）により表示が異なり得るため、最終期待値は**JDK 25 Oracle実測で確定**し、Simulation Core・Oracle・画面表示の三者一致を成立させてください。実測が見込み値と異なる場合は差異を`docs/phase-5-decisions.md`へ記録してください。

**ComparatorなしのTreeMap mapFactoryを非Comparableキー（Department等）と組み合わせるtemplateを作らないでください**（実JavaでClassCastExceptionとなる。§7.1）。通常のgroupingBy / nested groupingByではDepartment recordキーを許可し、値等価性で判定します。

nested teeing（teeingのdownstreamに合成Collectorまたはteeingを含む構造）は、Engine・AST・検証が対応していることをテストローカルtemplateで機械検証すれば足り、教材templateとしての登録は必須ではありません。登録する場合は500 snapshot予算に収まることを確認してください。

### 8.1 シナリオモード

実行可能な各主対象操作について、原則として標準 / 途中0件 / 空ソースを用意してください（既存規約）。特に次を教材制約として検証してください。

- groupingByの標準は2つ以上のbucketが生成される。
- partitioningByは空ソースでもtrue / false両キーを保持する（空partition。Draft v0.8 付録B）。
- toSetの標準は重複によって「追加しても変化しない」snapshotを1件以上含む。
- joining 3引数版の空ソースは`prefix + suffix`（`"[]"`。Draft v0.8 付録F.1）となる。
- teeingの空ソースは`docs/phase-5-decisions.md` §7の手順（蓄積0件でも`TEE_BRANCH_FINISHED`×2 → merger 1回）に従う。

意味の成立しないmodeは`supportedModes`へ含めず、UIで選択不能理由を表示してください（既存規約）。

### 8.2 データと安定ID

- Phase 1〜4のEmployee / Department基準fixtureを再利用し、必要な補助データだけ追加する。
- 標準Employeeデータ4件のsalary合計は21,700,000であり、teeing基準fixtureの期待値（平均5425000.0）の根拠となる（`docs/phase-5-decisions.md` §9）。変更しない。
- groupingBy / partitioningByのbucketキー、bucket内要素、joiningの連結途中文字列に、履歴復元可能な安定した表現を与える。
- `SalarySummary` recordを教材データ定義へ追加する（`record SalarySummary(long employeeCount, double averageSalary) {}`）。

## 9. Step Engineとsnapshot

### 9.1 Collector共通のsnapshotとcontext

Draft v0.8 §12.3、§12.5、§13.2、§15.2に従い、少なくとも次を確定snapshotとして表現してください。

1. 終端collectノードへの要素到着（既存`NODE_ARRIVAL`）
2. classifier / partitioningBy predicateの評価確定
3. bucket決定（新規bucket生成を含む）
4. コンテナ / bucketへの蓄積更新確定
5. Collector finisher適用確定（collectingAndThen finisherを含む）
6. teeingの3種（§6.1）
7. 終端結果確定（既存`RESULT_CONFIRMED`）とSTREAM CONSUMED（既存`STREAM_CONSUMED`）

新設SnapshotKindは既存34種（および`docs/phase-5-decisions.md` §4.1のteeing 3種）と衝突しない「対象_事象（過去形）」形式とし、少なくとも次を採用してください。

| SnapshotKind | 内容 |
|---|---|
| `CONTAINER_CREATED` | supplier適用によるコンテナ生成確定 |
| `CLASSIFIER_EVALUATED` | groupingBy classifierの評価確定 |
| `BUCKET_SELECTED` | bucket決定確定（新規生成か既存かを区別して表示） |
| `CONTAINER_UPDATED` | コンテナ / bucketへの蓄積更新確定 |
| `COLLECTOR_FINISHED` | Collector finisher適用確定 |
| `TEE_BRANCH_ACCUMULATED` / `TEE_BRANCH_FINISHED` / `TEE_MERGER_APPLIED` | `docs/phase-5-decisions.md` §4.1の確定どおり |

**発行規則（排他）**。同一の事象へ複数のkindを二重発行しないでください。

1. `CLASSIFIER_EVALUATED`は**groupingBy classifier専用**とする。partitioningByのpredicate評価と`Collectors.filtering`のpredicate評価は、既存`PREDICATE_EVALUATED`をCollector経路contextつきで再利用する（意味の重複したkindを併存させない）。
2. `Collectors.mapping`のmapper適用は既存`MAPPING_APPLIED`をCollector経路contextつきで再利用する。
3. teeingノード直下（左右branchのroot Collector）の蓄積更新は`TEE_BRANCH_ACCUMULATED`**のみ**とし、同じ更新へ`CONTAINER_UPDATED`を発行しない。branch内部にさらに合成Collectorがある場合、その内部ノードの蓄積更新は`CONTAINER_UPDATED`とする（`docs/phase-5-decisions.md` §4.1の「内部snapshot種別は汎用Collector snapshotとして確定」に対応）。
4. teeingの左右branch完了は`TEE_BRANCH_FINISHED`**のみ**とし、同じ完了へ`COLLECTOR_FINISHED`を発行しない。
5. `COLLECTOR_FINISHED`の発行有無は下の**発行表**でvariantごとに確定する。この表は**教材モデル上の発行規約**であり、JDKの`Collector.Characteristics`（IDENTITY_FINISH）の有無やJDK内部実装のfinisher構成（例: countingの内部委譲）に関する主張ではない。画面・説明・jdkNotesでも「JDKがこのCollectorでfinisherを実行する / しない」という断定をしない。教材モデルは「シミュレーターが表示用の蓄積状態を直接保持し、蓄積表現と最終結果の間に表示上の変換があるときだけfinisher snapshotを発行する」という規約で統一する。

   | Collector | `COLLECTOR_FINISHED`発行 | 理由（教材モデル） |
   |---|---|---|
   | toList / toSet / toCollection | 発行しない | 表示上コンテナ = 結果 |
   | joining（全overload） | **発行する** | 連結途中状態 → 最終String（prefix / suffix付与を含む） |
   | counting / summing系 | 発行しない | 表示用集約値を直接保持し、蓄積値 = 結果 |
   | averaging系 | **発行する** | 蓄積（合計・件数） → 平均Doubleへの変換 |
   | summarizing系 | 発行しない | 統計コンテナ = 結果 |
   | minBy / maxBy / reducing(BinaryOperator) | **発行する** | 候補 / 累積 → Optional結果への確定 |
   | mapping / filtering / flatMapping | 自身は発行しない | downstreamの規則に従う |
   | groupingBy / partitioningBy | Map自身には発行しない | 各bucketのdownstreamが発行対象variantの場合、**bucketごとに**finish cascade段階で発行する（例: `groupingBy(region, averagingLong(salary))`はbucket数ぶんの`COLLECTOR_FINISHED`） |
   | collectingAndThen | **発行する（必須）** | downstream完了後のfinisher独立snapshot（Draft §13.2・§15.2） |
   | teeingの左右branch root | 発行しない | `TEE_BRANCH_FINISHED`のみ（規則4）。本表で「発行しない」に該当するbranch（counting等）でも`TEE_BRANCH_FINISHED`は必ず発行する（`docs/phase-5-decisions.md` §5.1）。branch内部のnested Collectorは本表に従う |
   | teeingノード自身 | 発行しない | mergerは`TEE_MERGER_APPLIED`を使用する。nested teeingでも各teeingノードにつき正確に1回（`docs/phase-5-decisions.md` §5.2・§8）。`COLLECTOR_FINISHED`と二重発行しない |
   | 3引数collect | 発行しない | コンテナ = 結果 |

6. `CONTAINER_CREATED`は3引数collectのsupplier適用で必須とする。toCollection等のコンテナ生成にも発行するかは実装判断とし、`docs/phase-5-decisions.md`へ記録する。
7. **bucketごとの`COLLECTOR_FINISHED`（および finish cascade でのbucket確定処理）の発行順**は、次の決定的順序とする。
   - 順序保証のないgroupingBy: **bucket生成順**（各bucketが最初に生成されたsnapshotの順）。これはStep Engine上の教材規約であり、JDKのMap iteration order保証ではないことをjdkNote等で注記する。Step EngineはUI専用のDisplayOrderProjection（§6.4）へ依存してはならない。
   - TreeMap mapFactory: TreeMapの**実際のキー順**（順序意味論を優先。§6.4）。
   - partitioningBy: **false → true**の固定順（教材規約として注記）。

上記以外のkind追加・既存kind再利用の判断は`docs/phase-5-decisions.md`へ記録してください。

snapshotのCollector固有contextには、少なくとも次を保持してください（Draft v0.8 §12.3「Collector: AST、現在経路、ノード別蓄積、finisher状態」）。

- Collector AST（構造ツリー）
- 現在経路（現在要素がどのノード・bucketを通っているか。例: Employee → classifier → bucket → downstream）
- ノード別の現在蓄積状態
- ノード別の結果TypeRefとfinisher状態
- teeingでは`docs/phase-5-decisions.md` §6の契約項目

### 9.2 groupingBy / partitioningBy snapshot

- 1要素につき、到着 → classifier評価（またはpredicate評価）→ bucket決定 → downstream蓄積更新、の順を確定snapshotで表現する。
- nested groupingByでは外側→内側の経路を現在経路として表示し、深いノードの蓄積更新もそのノードの独立snapshotとする。
- partitioningByはtrue / false両キーを最初から固定表示し、空ソースでも両キーとdownstreamの空結果を保持する。

### 9.3 finisher snapshot

- collectingAndThenは、downstream完了後にfinisherを独立snapshot（`COLLECTOR_FINISHED`）で適用する（Draft v0.8 §13.2、§15.2）。
- finisher snapshotではfinisher適用前後の値と型を区別して表示する。
- bucketごとのfinisher・確定処理の発行順は§9.1規則7の決定的順序（bucket生成順 / TreeMap実キー順 / false → true）に従う。
- teeingのfinisher / mergerは`docs/phase-5-decisions.md` §5に従う。

### 9.4 3引数collect snapshot

- supplier適用（`CONTAINER_CREATED`）、要素ごとのaccumulator適用（`CONTAINER_UPDATED`）、結果確定を確定snapshotで表現する。
- combinerは定義の表示のみとし、実行済みのように表示しない（§5.1）。

### 9.5 終端結果の表現

終端結果は既存のtagged terminal result（識別可能Union）の方式を維持してください。既存variantを再利用できる結果は再利用します。

- `SCALAR`: counting、summing系、averaging系、joining（結果はLong / Integer / Double / String）
- `OPTIONAL`: minBy / maxBy / reducing(BinaryOperator)
- `STATISTICS`: summarizing系
- `LIST`（既存のtoList用）: `collect(toList())`、3引数collectで再利用可

Collector用に少なくとも次のvariantを新設してください（構造は既存variantの命名・粒度に合わせる）。

- `COLLECTION`: toSet / toCollection用。コンテナ表示名（`Set` / `ArrayList`等）、要素（安定`elementId`参照 + 表示ラベル）の列、表示順が学習用projectionである旨のメタ情報を持つ。toSetを`LIST`扱いにしない（重複排除と表示順注記を構造で保持するため）。**Setの要素ID規則**: 等価値が複数の入力要素から集約される場合（例: 関東×2件）、**最初に受理した入力要素の`elementId`を保持し、後続の等価値追加では置換しない**。この規則は表示・履歴復元用の教材規約であり、JDKのSet内部動作やiteration order保証の主張ではないことを注記する。
- `MAP`: groupingBy / partitioningBy用。Map表示型（`Map` / `TreeMap`）、キー型・値型ラベル、entry列（キーラベル + 値。値はdownstream結果として入れ子のresult view構造または要素ID列）、順序性メタ情報（TreeMap等のJDK順序意味論を持つか、学習用表示順か）を持つ。
- `RECORD`: teeing用。record名（`SalarySummary`）、fieldの列（field名、型ラベル、値ラベル）を持つ。

entry・要素は表示文字列だけでなく安定ID・構造化された値を保持し、「戻る→進む」で完全復元できるようにしてください。React UIは確定snapshotの値だけを描画し、結果・型・順序を独自計算しないでください（既存規約）。

### 9.6 共通不変条件

Phase 1〜4から次を継続してください。

- 全パネルが同じsnapshot IDを描画する。
- active nodeとJavaコードline IDが一致する。
- TypeRefとPipeline上の入出力型表示が一致する。
- Collectorツリー、蓄積状態、最終結果が同じ時点を表す（Draft v0.8 §12.6）。
- 全snapshotで`PROCESSING`要素は0件または1件（teeing含む。`docs/phase-5-decisions.md` §3）。
- snapshot、Scenario、PipelineDefinitionは外部から破壊的変更できない（deepFreeze）。
- 同じscenario revisionと操作列から同じsnapshot列を生成する。
- 戻る→進むは保存済みsnapshotを再利用し、再計算しない。
- 初期snapshotを含め最大500件とし、501件目を追加しない。

## 10. UI要件

### 10.1 操作・template選択

- 操作選択へ`Collector`カテゴリ（既存`CATEGORY_LABELS`に定義済み）のoptgroupを追加し、Phase 5で実行可能になった操作を選択できるようにする。
- 現在「未実装（Phase 5以降）」として表示している9項目（`collect`、3引数`collect`、`Collectors.*`）を実装済み・選択可能へ移行する。移行後は次のとおり確定する:
  - `UNIMPLEMENTED_OPERATIONS`のPhase 5項目は0件（リストは空になる）。
  - 未実装リストが空のとき「未実装」optgroupを描画しない（空のoptgroupを残さない）。
  - Phase 6のAI機能は未実装操作リストへ移さず、既存のAI capability disabled理由表示（別UI）をそのまま維持する。
  - 過去PhaseのReactテストの期待値更新は§12冒頭の許可範囲で行う。
- 操作またはtemplate切替時の新revision初期化、自動再生停止、READY初期化は既存仕様を維持する。
- AI capabilityのdisabled理由表示（Phase 6まで不変）を維持する。

### 10.2 表示

- 中央領域をCollector構造ツリー、現在経路、蓄積状態へ切り替える（Draft v0.8 §15冒頭。入力 → 処理中 → 出力の全体骨格は維持）。
- 構造ツリーは、ノード、蓄積状態、結果TypeRefを内側から外側へ区別して表示する。
- groupingByではbucketの成長、partitioningByではtrue / false固定2分岐を表示する。
- teeingでは左右branch、active branch、R1 / R2 / R、merger定義を`docs/phase-5-decisions.md` §5・§6の要件どおり表示する。
- Set / Mapの表示順はDisplayOrderProjectionで決定的にし、「表示を安定させるための順序」であることを注記する（§6.4）。
- findAny / countの注記と同様に、teeingの「左→右は教材上の表示順」注記をjdkNoteへ表示する。
- `SalarySummary`のrecord定義をDetailsへ表示する。
- 状態は色だけでなく記号と文言で識別し、PC幅 / 狭幅レイアウト、キーボード操作、focus-visible、reduced motionの既存要件を維持する。

## 11. Phase 5で実装しないもの

次は実装しないでください。

- Phase 6: サーバーAPI、AI adapter、RemoteScenarioProvider、実AI接続、AI候補検証、レスポンシブ最終調整、総合試験
- `Collectors.toMap()`（付録A.4対象外）
- primitive Streamの3引数collect（Draft v0.8 §15.1）
- parallelStream実行シミュレーション（combinerの実実行を含む）
- 任意Pipelineビルダー、ノード追加・削除・並べ替えUI
- Predicate / mapper / Collector / Javaコードの自由入力
- 自動再生速度変更UI
- null、NaN、Infinity、overflow、例外を主題とする教材
- 本番デプロイ構成、依存ライブラリの不要な更新

未実装操作のスタブを、実装済み・選択可能・動作可能に見せないでください。

## 12. 必須テストID

以下の`P5-*`をすべて実装し、テスト名へIDを含めて追跡可能にしてください。`docs/phase-5-decisions.md` §10の機械検証条件24項目は、各表の必須検証欄の対応注記（「§10条件n」）のIDが担当します。全24項目が漏れなく実装されることを完了報告で対応表として示してください。

既存P1〜P4テストIDを削除・緩和・skipしてはなりません。ただし、次の既存テストは「Phase 5未実装」または「Phase 4が最新Phase」を前提とした内容のため、**IDと検証意味を維持したまま**、以下の限定された方法で更新してください。更新内容と理由を完了報告へ記載してください。

- `tests/domain/p4-catalog-dsl.test.ts`の`collect`未登録アサート — 現状（登録済み）に合わせて反転する。
- `tests/domain/p4-invariants.test.ts`のP4-D40（collect / Collectors未実装の検証） — 現状に合わせて更新する。
- `tests/react/p4-app.test.tsx`のP4-R01（「Phase 5で実装予定」文言） — 移行後のUI（§10.1）に合わせて更新する。
- `tests/react/p2-app.test.tsx` / `p3-app.test.tsx`の未実装操作件数・文言のアサート — 未実装リストが空になった状態（§10.1）に合わせて更新する。
- `tests/domain/p4-review.test.ts`のP4-O02 / P4-O03関連テスト — **検証意味（Phase 4時点のsuite構成契約: 必須4 suite各1件・P4のみが`artifacts/phase-4/oracle-result.md`へ書込む）を変更・緩和してはならない**。oracle判定関数をライブ構成定数への直接依存からパラメータ化する場合、Phase 4時点の構成をfixtureとして固定し、同じ契約を検証し続ける形へのリファクタリングのみを許可する。ライブ構成（5 suite・P5単独書込み・phase-1〜4不変）の検証は新規P5-O02系テストが担う（§12.5）。

レビュー等でIDを追加する場合は、各系列の末尾連番で採番してください。

### 12.1 Domain単体テスト

P5-D03〜P5-D18の各テストには、対象Collectorの**snapshot列が§9.1の発行規則・発行表と一致すること**の検証を含めてください。groupingBy / partitioningByのfinisher発行対象downstream（averaging等）でのbucketごとの`COLLECTOR_FINISHED`、nested Collector内部、teeing branch内部のnested Collectorのfinisherも対象です。

| ID | 対象 | 必須検証 |
|---|---|---|
| P5-D01 | Collector Catalog | collect / 3引数collect / 全Collectorのcategory、traits、型規則、handlerが正しい |
| P5-D02 | Collector AST検証 | closed schema: 正常ASTを受理し、未知kind、未知ID、許可外キー・field、型不一致、深すぎる入れ子、任意コードを構造化issueで拒否する |
| P5-D03 | 3引数collect | supplier / accumulator / combinerの定義済みID、supplier→accumulator→結果のsnapshot列、combiner非実行表示が正しい |
| P5-D04 | toList / toSet / toCollection | 可変コンテナへの追加、Setの重複無変化snapshot、重複追加時に既存要素の`elementId`が置換されないこと（§9.5の規則）、コンテナsupplier IDが正しい |
| P5-D05 | joining | 引数なし版・delimiter版・3引数版の連結途中文字列の遷移と最終結果、空Streamでの引数なし版`""`と3引数版`prefix + suffix`（`"[]"`）が正しい |
| P5-D06 | counting / summing系 | 蓄積遷移と結果、結果型（Long / Integer / Double）が正しい |
| P5-D07 | averaging / summarizing系 | 蓄積遷移、結果、統計値の各fieldが正しい |
| P5-D08 | minBy / maxBy / reducing | 候補 / accumulator表示、結果、空でOptional.empty()が正しい |
| P5-D09 | mapping | mapper適用後にdownstreamへ渡る経路と結果が正しい |
| P5-D10 | filtering | bucket決定後のPredicate評価、除外要素の扱い、Stream.filterとの差の説明が正しい |
| P5-D11 | flatMapping | bucket内での展開 → flatten → downstreamの経路と結果が正しい |
| P5-D12 | collectingAndThen | downstream完了後のfinisher独立snapshot、適用前後の値と型区別が正しい |
| P5-D13 | groupingBy | classifier評価、bucket決定・生成、Map成長、Department recordキーの値等価判定（参照同一性へ非依存。§7.1）、結果が正しい |
| P5-D14 | groupingBy + downstream | bucket決定後のdownstream実行と結果型（Map<K, downstream結果>）が正しい。発行対象downstream（`averagingLong`等。テストローカルtemplate可）でbucketごとの`COLLECTOR_FINISHED`が**bucket生成順**に発行され、教材順である旨の注記を持つ（§9.1規則7） |
| P5-D15 | groupingBy + mapFactory | classifier / mapFactory / downstreamの分離とTreeMapの順序意味論（finisher発行・確定処理も実際のキー順）が正しい。対照テスト: `groupingBy(Employee::department, TreeMap::new, ...)`相当のASTを構造化issueで拒否し、`groupingBy(Employee::region, TreeMap::new, ...)`相当を受理する（§7.1の禁止組合せの負例検証） |
| P5-D16 | nested groupingBy | 外側→内側の経路、深いノードの蓄積snapshot、最終コンテナが正しい |
| P5-D17 | partitioningBy | true / false固定2分岐、両キー保持、結果`Map<Boolean, ...>`（wrapper Boolean）が正しい |
| P5-D18 | partitioningBy + downstream | 各partitionのdownstream実行と結果が正しい。partition確定・finisher発行順が**false → true**の固定順で、教材順である旨の注記を持つ（§9.1規則7） |
| P5-D19 | teeing蓄積 | 左右に同じ安定elementId、入力1件につき左右各1回の蓄積、左右別snapshot、左→右の決定的順序、右branch完了前に次入力を処理しない（§10条件2〜7） |
| P5-D20 | teeing merger | 全蓄積・両finisher完了後にmerger、ノードごと正確に1件、`currentElementId === null`、`PROCESSING` 0件、R1 / R2 / RのTypeRefがASTと一致（§10条件8〜13） |
| P5-D21 | teeing空Stream | 蓄積0件でも`TEE_BRANCH_FINISHED`×2 → merger 1回、結果`employeeCount=0, averageSalary=0.0`（§10条件15、16） |
| P5-D22 | nested teeing | depth-first、各merger 1回、依存順、`PROCESSING`最大1件（§10条件17、18） |
| P5-D23 | teeing標準結果 | 基準fixtureで`employeeCount=4, averageSalary=5425000.0`（§10条件14） |
| P5-D24 | 空入力 | 付録Bどおり: 各Collectorの空結果（空コンテナ、0L、型別0、0.0、Optional.empty()、空Map、両キー空partition）、およびjoiningの空結果（引数なし`""` / 3引数`"[]"`） |
| P5-D25 | 結果TypeRef連鎖 | §7.3の全結果型が内側から外側へ正しく組み上がり、全パネル表示値と一致する |
| P5-D26 | Collector context不変条件 | AST、現在経路、蓄積、finisher状態が同一時点を表し、structuredClone可能なプレーン構造で、deepFreezeされる |
| P5-D27 | PROCESSING最大1件 | 全P5 template × modeの全snapshotで`PROCESSING`が0件または1件（§10条件1） |
| P5-D28 | 決定性・予算 | 同revisionで同一snapshot列（bucketごとのfinisher発行順・§9.1規則7の決定性を含む）、全P5 templateが500以内、snapshotCountと実件数が一致（§10条件20、22） |
| P5-D29 | Source of Truth | 評価結果、TypeRef、Javaコード、説明が同一Collector ASTから一致して生成され、任意Javaコード文字列を実行しない（§10条件24） |
| P5-D30 | takeWhile / dropWhile持越し | Employee fieldCompare templateの3mode、境界到達、短絡後未評価、drop→通過遷移が正しい |
| P5-D31 | 終端回帰 | terminal runtime一般化後もPhase 4終端の代表snapshot列・結果が変わらない |
| P5-D32 | teeing context契約 | teeing固有contextが`docs/phase-5-decisions.md` §6の契約項目（teeing node ID、左右downstreamのnode ID、左右Collector AST、現在入力elementId、activeBranch 3値、左右branch状態4値、左右の現在蓄積、左右の結果値、R1・R2のTypeRef、merger DSL / 識別子、merger適用済みフラグ、最終結果値、RのTypeRef、左→右の教材上表示順、JDK呼出し順保証でない旨の注記）を**1項目ずつ**保持し、状態遷移と履歴復元が正しい |

### 12.2 Applicationテスト

| ID | 対象 | 必須検証 |
|---|---|---|
| P5-A01 | 操作切替 | Collectorカテゴリの操作選択でtimer停止、新revision、history 1件、cursor 0、READY |
| P5-A02 | template / mode切替 | supportedModesだけ選択でき、同じmodeへ戻ってもrevisionを再利用しない |
| P5-A03 | 履歴復元 | bucket、蓄積、finisher、merger結果、Set要素の保持`elementId`を含むsnapshotを戻る→進むで完全復元し、再計算しない（§10条件19） |
| P5-A04 | 自動再生 | Collector教材でも1000msごとに1 snapshotだけ進み、merger / finisher snapshotを飛ばさない（§10条件21） |
| P5-A05 | 検証エラー | 許可外Collector AST、型不一致、深すぎる入れ子を実行セッションへ入れず、理由を保持する |

### 12.3 React統合テスト

| ID | 対象 | 必須検証 |
|---|---|---|
| P5-R01 | 操作 / template UI | Collectorカテゴリのoptgroupが表示され、実装済み操作だけ選択可能で、未実装リストのPhase 5項目が0件、空の「未実装」optgroupが描画されず、AI capabilityのdisabled理由がPhase 6のまま維持される |
| P5-R02 | 構造ツリー表示 | Collector AST、現在経路、active bucket / branchをsnapshotから描画する |
| P5-R03 | 蓄積表示 | bucket成長、Setの無変化、joining連結、統計値をノード別に表示する |
| P5-R04 | 結果TypeRef表示 | 内側から外側の結果型、Map / SalarySummary型が全パネルで一致する |
| P5-R05 | finisher / merger表示 | collectingAndThen finisherの前後、teeing mergerの左結果・右結果・merger定義・最終結果の同時表示が正しい |
| P5-R06 | 空結果表示 | 空partitionの両キー、各Collectorの空結果を正しく表示する |
| P5-R07 | 表示順projection | Set / Mapの決定的表示順と「表示上の順序」注記、TreeMapの意味論優先を表示する |
| P5-R08 | コード・説明同期 | collect行のline ID強調、説明、jdkNote（左→右注記等）が同じsnapshotを示す |
| P5-R09 | record表示 | SalarySummaryのrecord定義と結果値の表示が正しい |
| P5-R10 | a11y・responsive | 状態文言、keyboard、focus、reduced motion、狭幅縦積みを維持する |

### 12.4 E2E・視覚テスト

| ID | 対象 | 必須検証 |
|---|---|---|
| P5-E01 | 単純Collector | toList / toSet / joining / counting等を切替えて正しい結果へ到達する |
| P5-E02 | 3引数collect | supplier→accumulator→結果を進む / 戻る / 自動で確認する |
| P5-E03 | groupingBy系 | bucket成長、downstream、nested、mapFactoryの経路を確認する |
| P5-E04 | partitioningBy | true / false固定2分岐と空partitionを確認する |
| P5-E05 | downstream合成 | mapping / filtering / flatMappingの**downstream経路**（これら自身はfinisher snapshotを発行しない。§9.1発行表）と、collectingAndThenの`COLLECTOR_FINISHED` snapshotを確認する |
| P5-E06 | teeing標準 | 左右蓄積 → finisher×2 → merger → `SalarySummary[employeeCount=4, averageSalary=5425000.0]`を確認する |
| P5-E07 | teeing空Stream | 蓄積0件からmerger 1回、`SalarySummary[employeeCount=0, averageSalary=0.0]`を確認する |
| P5-E08 | mode / 操作切替 | timer停止、新revision、history初期化、表示全領域の切替を確認する |
| P5-E09 | 履歴・自動 | Collector途中から戻る→再進行、手動途中→自動完了を確認する |
| P5-E10 | 狭幅・視覚回帰 | 構造ツリーの狭幅表示、横スクロール、sticky非遮蔽を確認し、代表snapshotを基準画像化する |

### 12.5 JDK 25 Oracle Test

| ID | 対象 | 必須検証 |
|---|---|---|
| P5-O01 | JDK 25照合 | 全実装Collectorと3引数collectの代表結果（標準・空Stream）を、Simulation Coreと固定Java 25コードで照合する（§10条件23） |
| P5-O02 | Oracle運用検証 | 必須suite（P1-O01〜P5-O01）が各1件存在し、証跡書込みが現行Phaseのみで、実行前後に`artifacts/phase-1`〜`phase-4`のSHA-256が不変である |

P5-O01には少なくとも、teeing基準fixtureの標準（`employeeCount=4, averageSalary=5425000.0`）と空Stream（`employeeCount=0, averageSalary=0.0`）、groupingBy / partitioningByのMap結果（空partition含む）、counting / summing / averagingの空Stream結果、joining結果（引数なし版の空`""`と3引数版の空`"[]"`を含む）、double集計の実測値（§8注記）を含めてください。

**unordered結果の比較正規化**: 既存のJSON文字列完全一致を順序保証のないSet / Map結果へそのまま適用すると、JDKが保証しないiteration orderまで一致条件になります（§6.4と矛盾。groupingByの返却Mapは "There are no guarantees on the type, mutability, serializability, or thread-safety of the Map or List objects returned." — Java SE 25 Collectors#groupingBy、2026-08-12取得。URLは§7.1）。次の正規化を定義してください。

- 正規化の対象は**具象クラス名（HashMap等）ではなく、TerminalResultView / Collector ASTが保持する「JDK順序意味論の有無」のメタ情報（§9.5）で判定**する。順序意味論を持たないSet / Map全般が正規化対象となる。
- 正規化対象のSet要素とMapのentryは、Simulation Core側・Java Oracle側の双方で**安定キー（要素・キーの表示文字列の辞書順等）でsortした正規化表現**へ変換してから照合する。
- 正規化はあくまで比較のためであり、JDKのiteration order保証を意味しないことをOracleプログラムのコメントと`docs/phase-5-decisions.md`へ明記する。
- TreeMap等、実際に順序性を持つ結果は正規化せず、**実順序のまま**照合する（順序自体が検証対象）。
- 数値は表現差で偽装一致しないよう、正規化後もJSON文字列表現で厳密照合する。

Oracleランナーは既存構成（Docker + `gradle:9.6.1-jdk25`、`oracle/OracleP5.java` + `oracle/expected-p5-from-core.json`）を踏襲してください。suite追加に伴い、次を必ず更新してください。

- suite定義へ`P5-O01`を追加し、証跡書込み先を`artifacts/phase-5/oracle-result.md`とする。
- `P4-O01`の証跡書込みを停止する（`writeReportPath`をnull化）。`artifacts/phase-4/oracle-result.md`は過去証跡として保持し、上書きしない。P1〜P4 suiteの照合自体は回帰として継続実行する（P4-O02のLong境界値照合ロジックもP4 suiteへ適用し続ける。ID再定義はしない）。
- 必須suite ID一覧へ`P5-O01`を追加する。
- 「書込みは現行Phase（P5）のみ」「書込み先は`artifacts/phase-5/oracle-result.md`のみ」「実行前後で`artifacts/phase-1`〜`phase-4`のSHA-256不変」をP5-O02の実判定として実装し、過去artifacts不変検証の対象へ`artifacts/phase-4`を追加する。
- 既存のP4-O02 / P4-O03のVitest側テストは§12冒頭の条件（Phase 4時点構成のfixture化。検証意味の保存）に従って扱う。

## 13. 検証手順

現在の`package.json`に合わせ、少なくとも次を実行してください（`test`という名前のscriptは存在しません）。

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

1. 既存P1〜P4テストID（P1必須41 + P2必須52 + P3必須60 + P4必須72、および各Oracle ID）がすべて成功する。
2. P5必須テストID（12.1〜12.5の59 ID）がすべて実装され成功する。
3. `docs/phase-5-decisions.md` §10の24条件すべてに対応テストが存在する。
4. PC幅と狭幅で、groupingBy、partitioningBy、collectingAndThen、teeingを目視確認する。
5. 視覚回帰の期待画像を意図せず一括更新していない。
6. `eval`、`new Function`、動的コード生成、AI SDK、HTTP AI接続が混入していない。
7. Phase 6の機能が先行実装されていない。
8. 全P5 fixtureのsnapshotBudgetが500以内である。
9. E2Eキャプチャの書込み対象Phaseが5のみで、`artifacts/phase-1`〜`phase-4`が変更されない。
10. `git diff --check`、`git diff --stat`、`git status --short`で変更範囲を確認する。

テスト失敗をskip、期待値緩和、テスト削除、過度なmock、基準画像の無条件更新で隠さないでください。環境制約で未実行のテストがある場合は成功扱いせず、原因、試行内容、残作業、再実行コマンドを明記してください。

## 14. 成果物

既存規約を維持し、次を作成・更新してください。

- `docs/phase-5-decisions.md`
  - 既存の§1〜§12（J-2確定記録）は書き換えず、§13以降として実装判断を追記する。
  - 追記対象: Collector AST DSLのkind・ID・入れ子上限、新設SnapshotKindと既存kind再利用の判断、TypeRef・蓄積値表現の判断（§6.3）、TreeMap等の表現、教材templateの構成判断、その他仕様本文を変更しない範囲の実装判断。
- `docs/phase-5-completion-report.md`
- `artifacts/phase-5/`
  - PC幅 / 狭幅キャプチャ
  - Oracle結果（`oracle-result.md`）
  - snapshot予算実測（`snapshot-budget.txt`、既存のTSV形式）
- `e2e/__screenshots__/`配下のPhase 5視覚回帰基準画像
- E2Eキャプチャ対象Phaseの更新: `e2e/capture-helper.ts`の`CAPTURE_TARGET_PHASE`を`5`へ変更する（この1か所のみ。過去Phaseのcapture specは変更しない）。
- `README.md` — Phase 5完了時のみ更新。あわせて次の既知の不整合を修正する:
  1. 存在しない`docs/Claude_Code_Phase3_Implementation_Instructions.md`への参照を実在する指示書（Phase 1 / 2 / 5）の一覧へ修正
  2. `test:oracle`の説明へP4-O01 / P5-O01を反映
  3. テスト結果の見出しと表をPhase 5最終の実測値へ更新（現在はPhase 3時点の値のまま）
  4. 必須テストID実績へP4（必須72 ID）とP5を追加
  5. `artifacts/phase-4/`・`artifacts/phase-5/`を成果物一覧へ追加
  6. ドキュメント一覧へ`docs/phase-4-decisions.md`・`docs/phase-4-completion-report.md`・`docs/phase-5-*.md`を追加
  7. ブランチ構成の説明を実運用（`phase-N`ブランチ + PR merge）に合わせて更新
- 実装対象コメントの整合: OperationCatalog登録ファイルの「Phase 4以降の操作は登録しない」という古いヘッダコメントを現状に合わせて修正する。

`docs/phase-1〜4-completion-report.md`、`docs/phase-1〜4-decisions.md`、`artifacts/phase-1`〜`phase-4`は過去の記録として保持し、書き換えないでください。

## 15. Phase 5完了条件

次をすべて満たした場合だけ「Phase 5完了」と判定してください。

- Draft v0.8 §20のPhase 5実装内容と完了条件（構造ツリー、蓄積、結果型、空partition、finisher / merger snapshot）を満たす。
- §5の全操作がDomain → Application → React UIまで縦断実装される。
- teeingが`docs/phase-5-decisions.md` §3〜§11の確定事項どおり成立する。
- Collector蓄積がcontainer / bucket / finisher構造で表現され、STATEFUL共通バッファ・平坦なTerminalRuntimeへ押し込められていない。
- 結果TypeRefが内側から外側へ組み上がり、全パネルとJavaコードで一致する。
- 空Stream・空partition・Setの重複無変化を含む空・特殊ケースが付録Bどおり成立する。
- takeWhile / dropWhileのEmployee fieldCompare templateが登録され成立する。
- 既存P1〜P4テストIDと各Oracle IDがすべて成功する（§12冒頭で許可した期待値更新を除き、変更なし）。
- P5必須59 テストIDがすべて実装・成功し、`docs/phase-5-decisions.md` §10の24条件が漏れなく対応づく。
- lint、型検査、production buildが成功する。
- Playwright E2E、視覚回帰、PC / 狭幅確認が完了する。
- P5-O01・P5-O02がJDK 25で成功し、`artifacts/phase-1`〜`phase-4`が不変である。
- 全P5 templateが500 snapshot上限を満たす。
- Phase 6を先行実装していない。
- ユーザーの既存変更を破棄していない。

1項目でも満たせない場合は「Phase 5未完了」とし、残作業、影響、再現手順を具体的に報告してください。

## 16. 完了報告の必須項目

`docs/phase-5-completion-report.md`とチャット報告へ、次を必ず含めてください。

1. Phase 5の完了 / 未完了判定
2. 基準コミット（§3.1）と作業ブランチ
3. 実装済み操作（collect本体、全Collector、持越しtemplate）
4. Collector Engine一般化の設計概要（runtime構造、新設SnapshotKind、context構造）
5. 未実装のPhase 6機能一覧
6. 主な変更ファイルとアーキテクチャ上の役割
7. 実行した全コマンドと終了結果
8. テスト種別ごとの総数、成功、失敗、skip、未実行
9. P5必須59 IDを1件ずつ記載した対応表
10. `docs/phase-5-decisions.md` §10の24条件と担当テストIDの対応表
11. 既存P1〜P4必須IDの回帰結果と、§12冒頭で許可した既存テスト期待値更新の一覧・理由
12. P5-O01 / P5-O02のJDKベンダー / バージョン、ケース、照合結果
13. teeing代表snapshot列（標準・空Stream）の構造比較結果
14. 結果TypeRef連鎖（§7.3）の比較結果
15. PC幅 / 狭幅キャプチャと視覚回帰画像の保存先
16. 仕様との差異と実装判断（`docs/phase-5-decisions.md`追記分への参照を含む）
17. 500 snapshot上限と全templateの実測件数（`snapshot-budget.txt`）
18. 既知の問題と次Phase（Phase 6）への持越し
19. 最終`git diff --stat`と`git status --short`、およびcommit、push、PRを行っていないことの確認

「全テスト成功」「仕様準拠」だけで済ませず、コマンド、件数、ID、成果物パスを根拠として記載してください。

## 17. 停止条件

次の場合は推測で進めず、変更前または問題判明時点で停止して報告してください。

- Draft v0.8と本指示、または`docs/phase-5-decisions.md`と本指示に、実装結果を変える矛盾がある。
- Phase 4マージコミットが現在の`phase-5`の祖先でない。
- worktreeに未確認のユーザー変更がある。
- Phase 1〜4回帰テストが変更前から失敗する。
- teeingで`PROCESSING`最大1件・merger 1回・依存順のいずれかを満たせない実装上の問題が判明した。
- Collector教材templateが500 snapshot以内へ収まらない。
- 既存TypeRef / SimValue / snapshot構造の破壊的変更や、大量の既存テスト書き換えが必要になる（§12冒頭で許可した範囲を除く）。
- 仕様にない依存追加、API、AI接続、任意コード実行が必要になる。

## 18. 最終禁止事項

- Draft v0.8を変更しない。
- Phase 6を実装しない。
- Phase 1〜4の完了報告・判断記録・証跡（`artifacts/phase-1`〜`phase-4`）をPhase 5用に書き換えない。
- `docs/phase-5-decisions.md`の既存§1〜§12を書き換えない（追記のみ）。
- AIを接続しない。fixtureをAI生成と表示しない。
- 任意コード文字列を評価・表示ソースにしない。表示用Javaコードは必ずDSL / Collector ASTから生成する。
- UIで結果、型、蓄積状態、表示順を独自計算しない（DisplayOrderProjectionは純粋なUI projectionとして実装する）。
- teeingで要素を複製して別IDを付与しない。複数要素を同時に`PROCESSING`にしない。
- 未実装操作を実装済みに見せない。
- 失敗、skip、未実行、仕様差異を隠さない。
- ユーザーの変更を削除、stash、reset、checkoutで破棄しない。
- 別途指示なしにcommit、push、PR、mergeを行わない。

Phase 5の実装、検証、証跡作成、完了報告まで実行してください。

---

## 使用方法

1. ローカルPCで対象リポジトリを最新化し、`phase-5`ブランチへ切り替えます。
2. プロジェクトルートでClaude Codeを起動します。
3. この文書の「Java Stream API 可視化シミュレーター Phase 5実装指示」以降を渡します。
4. Claude Codeの完了報告後、コード、テスト、キャプチャ、`docs/phase-5-completion-report.md`をレビューします。
