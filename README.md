# Java Stream API 可視化シミュレーター

Java Stream API の処理の流れ（要素の通過・除外、型遷移、遅延評価）を1ステップずつ可視化する学習教材アプリ。

- 基準仕様: `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`（Draft v0.8 / Java SE 25基準）
  + `docs/Java_Stream_API_Visualization_Spec_v0.10_Phase6_ManualLink.md`（v0.10 / Phase 6手動連携差分）
  + `docs/Java_Stream_API_Visualization_Spec_v0.9_Gatherers.md`（v0.9 / Phase 7 Gatherers差分）
  + `docs/Java_Stream_API_Visualization_Spec_v0.11_toMap.md`（v0.11 / Phase 8 Collectors.toMap差分）
  + `docs/Java_Stream_API_Visualization_Spec_v0.12_TeeingToMap.md`（v0.12 / Phase 9 teeing×toMap差分）
  + `docs/Java_Stream_API_Visualization_Spec_v0.12.docx`（上記5文書の統合ビルド。閲覧用。正は各原本）
- 実装状況: **Phase 9（teeing×toMap）まで実装済み**。Phase 8で唯一未達だったteeing branchへの
  toMap配置はPhase 9（v0.12）で解消し、**P8必須39 IDを含む全Phaseの必須IDが完全成功**
  （詳細は `docs/phase-8-completion-report.md` §17-1追記・`docs/phase-8-decisions.md` §9.2）
- J-2（`Collectors.teeing` の左右2系統と処理中要素数の関係）は Phase 5着手前に仕様確定し、本体へ実装済み
  （`docs/phase-5-decisions.md`。teeingでも「処理中要素は最大1件」の例外なし）
- Phase 6でAI API接続（サーバーAPI・AI adapter・RemoteScenarioProvider）は**廃止**し、**手動連携方式**へ置換した
  （v0.10。アプリがプロンプトを生成 → ユーザーが任意のAIチャット等で候補JSONを作成 → 貼り戻して検証・取込）
- 実装指示: `docs/Claude_Code_Phase1_Implementation_Instructions.md` /
  `docs/Claude_Code_Phase2_Implementation_Instructions.md` /
  `docs/Claude_Code_Phase5_Implementation_Instructions.md` /
  `docs/Claude_Code_Phase6_Implementation_Instructions.md` /
  `docs/Claude_Code_Phase7_Implementation_Instructions.md` /
  `docs/Claude_Code_Phase8_Implementation_Instructions.md`
  （Phase 3 / Phase 4の指示書は、指示書自身の複製禁止規定によりリポジトリへ含めていない。
  Phase 9は独立の指示書を作らず、仕様v0.12差分と `docs/phase-8-decisions.md` §9.1のA案を直接実装した）

## 実装済み操作（Phase 9時点）

- **Stream生成**: `Collection.stream()` / `Arrays.stream()`（object・int[]・long[]・double[]）/ `Stream.of()` /
  `Stream.generate()` / `Stream.iterate(seed, operator)` / `Stream.iterate(seed, predicate, operator)` /
  `IntStream.range()` / `IntStream.rangeClosed()` / 各種 `empty()`
  - `Stream.generate()` と2引数 `iterate()` は無限sourceのまま、`limit()` を含むtemplateで実行可能
    （必要source要求件数を事前導出し、supplier / operatorは必要回数だけ実行。limitなし候補は
    `UNBOUNDED_SOURCE` として事前拒否）
- **中間操作（stateless）**: `filter` / `map` / `mapToInt` / `mapToLong` / `mapToDouble` / `boxed` / `mapToObj` /
  `flatMap` / `flatMapToInt` / `flatMapToLong` / `flatMapToDouble` / `peek`
- **中間操作（stateful）**: `distinct` / `sorted()` / `sorted(Comparator)` / `limit` / `skip` /
  `takeWhile` / `dropWhile`（takeWhile / dropWhileはsequential + ordered限定）
  - sortedはJ-2契約どおり「全入力buffer → 順序確定（処理中0件・1回のみ）→ 1件ずつ放出」
  - limit / takeWhileの短絡後は残りを未評価（`UNEVALUATED`）として保持
  - peekのConsumer実行履歴は通常結果と分離した不変のSide Effect履歴としてsnapshotへ保持
  - takeWhile / dropWhileはEmployee `fieldCompare`（`salary >= 5_000_000L`）の教材templateも提供
- **終端**: `toList()` / `reduce()`（1・2・3引数、primitive版含む） / `count()` /
  `min` / `max`（Comparator・primitive版） / `findFirst` / `findAny` /
  `anyMatch` / `allMatch` / `noneMatch` / `sum` / `average` / `summaryStatistics`（int・long・double） /
  `toArray()` / `toArray(generator)` / `forEach` / `forEachOrdered`
  - find / matchはshort-circuiting。確定後の残り（source・flatMap子・sorted未放出）は未評価のまま
  - `findAny`の非決定性・`count`の評価省略可能性は常設注記（fixtureは決定的、JDK保証とは区別）
- **Collector（Phase 5）**: `collect(Collector)` / 3引数 `collect(Supplier, BiConsumer, BiConsumer)`
  - 単純Collector: `toList` / `toSet` / `toCollection` / `joining`（引数なし・delimiter・3引数）/
    `counting` / `summingInt|Long|Double` / `averagingInt|Long|Double` /
    `summarizingInt|Long|Double` / `minBy` / `maxBy` / `reducing`
  - downstream合成: `mapping` / `filtering` / `flatMapping` / `collectingAndThen`
  - 分類ツリー: `groupingBy`（classifier / +downstream / +mapFactory）/ nested `groupingBy` /
    `partitioningBy`（+downstream）
  - Collector入れ子: `teeing`（merger record: `SalarySummary`。Phase 9で `RegionIndex` を追加）
  - Collectorは再帰的なCollector AST（DSL）として表現し、構造ツリー・現在経路・ノード別蓄積・
    内側から外側へ組み上がる結果TypeRef・finisher / mergerの独立snapshotを可視化する
  - 結果はtagged union（LIST / SCALAR / OPTIONAL / ARRAY / STATISTICS / VOID / COLLECTION / MAP / RECORD）
    として構造化し、Set / Mapの表示順はUIの純粋なDisplayOrderProjectionで安定化する（JDKのiteration
    order保証とは区別して注記）
- **Collector: `toMap`（Phase 8）**: `Collectors.toMap` の3 overloadを縦断実装
  - 2引数版 `toMap(keyMapper, valueMapper)` / 3引数版 `+ mergeFunction` /
    4引数版 `+ mapFactory`（`TreeMap::new`）。`mapFactory`のみ指定する形はJavaに存在しないため
    構造検証で拒否する
  - keyMapperは既存 `ClassifierDsl` を変更なしで流用。valueMapperはtoMap専用の `ToMapValueDsl`
    （`identity`（`Function.identity()`）/ `fieldAccess`）を新設し、共有 `MapperDsl` は変更しない
  - mergeFunctionは3種のIDホワイトリスト: `first`（`(a, b) -> a` / 既存値を保持・先勝ち）/
    `last`（`(a, b) -> b` / 新しい値で置換・後勝ち）/ `concat`（`(s, a) -> s + ", " + a`。値型U=Stringのみ）。
    引数順は（Map内の既存値, 新しい値）で、根拠は `Map.merge` 契約
  - toMapノードは **keyMapper / valueMapper / mergeFunction / mapFactory の常設4行**で表示し、
    省略overloadの行は意味論（「なし（重複キーで`IllegalStateException`）」「なし（Map実装型は無保証）」）を示す
  - **本シミュレーター初の「正常完了しないPipeline」**: 2引数版の重複キーをvalidationで隠さず実行で
    体験させる。Step Engineは**TypeScript例外を投げず**、`COLLECT_FAILED` 終端の正規snapshot列
    （`completion: 'EXECUTION_FAILED'` / `output.result: null`）を生成し、再生状態は `FAILED`
    （エンジン内部不整合の `ERROR` とは別区分）へ遷移する
  - 失敗内容は構造化view `ExecutionFailureView`（例外型 / Collector経路 / bucketキー / 重複キー /
    衝突した2値）として保持し、UIは表示文言ではなくこのviewから描画する。
    **例外メッセージ全文は表示・照合の契約に含めない**（型のみ）
  - 新しいSnapshotKind 5種: `TO_MAP_KEY_EVALUATED` / `TO_MAP_VALUE_EVALUATED` /
    `DUPLICATE_KEY_DETECTED` / `MERGE_FUNCTION_APPLIED` / `COLLECT_FAILED`
    （groupingBy専用の `CLASSIFIER_EVALUATED`・mapping系専用の `MAPPING_APPLIED` は再利用しない）
  - 教材データとして merge実演用の補助データセット `employeesMergeDemo`（関東3件）を追加し、
    「重複キーで失敗」「first / last / concat」「同一データの `groupingBy(region)` 比較」を
    **同一データ・同一keyMapper**で直接比較できる導線を設けた
  - `toConcurrentMap` / `toUnmodifiableMap` / 数値加算merge（`Long::sum`等）/ key側identity は
    **実行対象外**（存在と理由を補助説明で表示）。toMapを含むtemplateは**手動連携の取込対象外**
    （v0.11 §10-6のユーザー決定。将来拡張として持越し）
  - **teeing branchへのtoMap配置（Phase 9 / v0.12）**: teeing merger whitelistへ `RegionIndex::new`
    （`record RegionIndex(Map<String, String> byRegion, long count)`）を追加して解消。
    branch直下は `CONTAINER_UPDATED` → `TEE_BRANCH_ACCUMULATED` 置換、branch内部（adapter経由）は
    内部 `CONTAINER_UPDATED` + branch確定の別事象、失敗要素は `TEE_BRANCH_ACCUMULATED` 不発行、の
    更新kind排他を実行検証。branchのdownstream Map生成注記は `TeeRuntime` の独立フラグで管理し、
    全snapshot列で正確に1回発行する。右branch失敗時の経路は `['c0','c0.right']`（`ctx.path` 復元）。
    教材template `tmpl-collect-teeing-tomap`（standard、snapshot実測40件）を追加
    （`docs/phase-8-decisions.md` §9.2）
- **Gatherer（Phase 7）**: `gather(Gatherer)`（STATEFUL中間操作）
  - 組み込みGatherer: `Gatherers.windowFixed` / `windowSliding` / `scan` / `fold`
  - Gatherer<T, A, R>の4構成要素（initializer / integrator / combiner / finisher）を**常設4行**で表示し、
    combinerは「逐次実行のため呼出し0回」、scanのfinisherは「終端での追加産出なし」の意味論のみを示す
    （JDK内部実装の構成は断定せず、Oracle観測を反映する場合は観測環境を明示する）
  - 窓は合成要素（`<nodeId>-win-N`）として安定IDを持ち、メンバーの入力ElementId列をcontextで追跡できる。
    foldの最終値は `<nodeId>-result`。scan出力は入力要素のIDを継承する（map系1→1変換と同一規則）
  - 実行値モデルへ合成List値（`SimValue` の `list` variant）を追加。既存 `stringList` は不変のまま並存
  - `Gatherers.mapConcurrent` は並行実行の意味論のため**実行対象外**（存在と理由を補助説明で表示）。
    カスタムGatherer・`Gatherer.andThen`・複数gatherノードの連結・gather下流の短絡合成も対象外
    （`fold → findFirst` のみ例外）
  - gatherを含むtemplateは**手動連携の取込対象外**（v0.9 §10-6のユーザー決定。将来拡張として持越し）

## 手動連携（Phase 6）

固定サンプル（fixture）に加えて、**任意のAIチャット（または手書き）で作った候補JSONを取り込んで実行**できる。
アプリからAI事業者APIを呼ぶ経路は存在しない（サーバーAPI・AI SDK・HTTPクライアント依存なし）。

1. **プロンプトをコピー**: 選択中の操作・モード・templateに対する生成依頼文をクリップボードへコピーする
   （許可DSL・dataset契約・教材制約・出力例を含む）。コピーできない環境では全文を選択可能なテキストで表示する。
2. 任意のAIチャット等へ貼り付け、応答のJSONを受け取る（手書きでもよい）。
3. **候補を貼り付け**: 貼付テキストを検証し、合格時だけ「取込サンプル」としてシナリオを切り替える。
   不合格時は現在のシナリオを維持し、理由（code・対象path・message）を貼付欄の近傍に表示する。

- provenanceバッジは `FIXTURE` = 「固定サンプル」、`IMPORTED` = 「取込サンプル」（「AI生成」表示は使用しない）
- 検証は6手順（サイズ上限 → 前処理 → `JSON.parse` → Import Contract → candidate組み立て → 既存検証パイプライン）。
  `eval` / `new Function` / 動的コード生成は使用しない
- 許可範囲は **Import Contract**（`src/application/importContract.ts`）が単一定義源で、
  プロンプト生成と前段検証の双方がここだけを参照する
- 取込候補は保存しない（`localStorage`等は未使用。v0.10 §10-7）
- Javaコード表示は外部入力由来の文字列を必ずエスケープし、部署変数名は `name` + `division` の組で決定する
  （固定表 `development` / `sales` ＋ 出現順 `dept1`, `dept2`…）

## 技術構成

- React 19 + TypeScript 6 + Vite 8
- テスト: Vitest + React Testing Library / Playwright（E2E・視覚回帰）
- Oracle照合: Docker + Eclipse Temurin JDK 25

## アーキテクチャ

依存方向は外側 → 内側のみ。Simulation Core（`src/domain/`）は React / DOM / タイマー / HTTP / AI SDK に依存しない。

```
React UI (src/ui)
  → Application (src/application)   … SimulationSession・履歴cursor・1000ms自動再生・500上限
                                      Import Contract・Prompt Generator・Candidate Import（Phase 6）
    → Simulation Core (src/domain)  … TypeRef・OperationCatalog・DSL・Template・Step Engine・Snapshot
      → ScenarioProvider (src/providers) … FixtureScenarioProvider（Phase 6でも経路は無変更。Phase 7でfixtureを追加）
```

- Candidate Importは `ScenarioProvider` を実装しない独立サービス（pull型のprovider契約に対し取込はpush型）。
  最終検証は既存の `buildScenario` → `instantiateTemplate`（手順1〜7）を**無変更**で通す

- 検証済み DSL / AST（Predicate・Source・Mapper・Comparator・Consumer・Reduction・Collector）を単一の
  Source of Truthとし、評価・型遷移（TypeRef）・Java表示コード・自然文説明・操作固有状態表示を同一ASTから生成
- Step Engine は PipelineDefinition から決定的な確定snapshot列（timeline）を純粋に導出。Phase 3では要素1件の
  depth-first規則を維持したまま、node runtime（seen / buffer / count / 境界 / Side Effect）+ finish cascade
  （sorted flush）+ 短絡キャンセル（limit / takeWhile）を合成
- Phase 5では、Phase 3のSTATEFUL共通バッファにもPhase 4の平坦な `TerminalRuntime` にも押し込めない
  Collectorの蓄積を、**Collector ASTに対応する再帰的な CollectorRuntime**（`src/domain/engine/collectorRuntime.ts`）
  として別建てし、container生成 / bucket決定 / 蓄積更新 / finisher適用 / merger適用をASTノード単位で表現
- Phase 7では、Gathererが再帰構造を持たないため Collector のような別建てではなく、Phase 3のnode runtime
  （`NodeRuntime` union）へ `GatherRuntime` を追加する形で実装。sorted専用だった finish cascade を
  gather（残余窓のflush / 全要素1窓のflush / fold最終値の放出）へ一般化し、窓・fold最終値は
  **合成要素**として `registerElement` してから下流へ depth-first で流す
- 無限source（generate / iterate2）は有限性解析で必要source要求件数を事前導出し、必要な分だけ決定的に生成
  （`PipelineDefinition.boundedness` / `orderMeta`）
- Phase 8では、Collector Runtimeの走査へ**教材上想定された実行失敗**（toMap 2引数版の重複キー）の
  伝搬を追加。**TypeScript例外ではなく戻り値・状態**（`collectorAccumulate` の戻り値と `WalkCtx.failure`）で
  Step Engineへ伝え、Step Engineが `COLLECT_FAILED` を発行して上流を停止し、finish cascade・
  `RESULT_CONFIRMED`・`STREAM_CONSUMED` を発行せずにtimelineを終える。`EngineInvariantError` の
  catch経路（`session.ts`）とは完全に分離している
- Phase 9では、teeing走査の `ctx.path` 復元（右branch経路 `['c0','c0.right']`）と、branch Map生成注記の
  発行済み管理（`TeeRuntime` の独立フラグで全snapshot列に正確に1回）を追加し、teeing branchへの
  toMap配置（成功put / merge / 重複キー失敗の3分岐）を既存機構の拡張のみで実現
- 「戻る」は再計算せず保存済みsnapshotを復元（seen・buffer・count・Side Effect履歴・Collectorのbucket /
  蓄積 / finisher / merger結果、toMapのentry蓄積・`ExecutionFailureView` も完全復元）。
  全パネルが同一snapshot IDを描画

## 実行方法

```bash
npm install
npm run dev          # 開発サーバー
npm run typecheck    # 型検査（strict）
npm run lint         # oxlint
npm run test:unit    # Domain/Application/Reactテスト（Vitest）
npm run build        # production build
npm run test:e2e     # Playwright E2E + 視覚回帰（要: npx playwright install chromium）
npm run test:oracle  # JDK 25照合 P1-O01〜P8-O01（要: Docker + gradle:9.6.1-jdk25イメージ）
                     # 証跡を書き込むのは現行Phase（P8-O01 → artifacts/phase-8/oracle-result.md）のみ。
                     # P1〜P7は照合のみで、実行前後に artifacts/phase-1〜phase-7 のSHA-256不変を検証する
```

## テスト結果（Phase 9 最終）

| 種別 | 件数 | 結果 |
|---|---|---|
| Vitest（Domain / Application / React、P1 + P2 + P3 + P4 + P5 + P6 + P7 + P8） | 791（67ファイル） | 全成功 |
| E2E・視覚回帰（P1-E01〜11 + P2-E01〜10 + P3-E01〜10 + P4-E01〜10 + P5-E01〜10 + P6-E01〜05 + P7-E01〜05 + P8-E01〜05） | 93 | 全成功 |
| JDK 25 Oracle（P1-O01 / P2-O01 / P3-O01 / P4-O01 / P5-O01 / P6-O01 / P7-O01 / P8-O01 + P4-O02 / P8-O02） | 8 suite | 完全一致 |

- P1必須41 ID + P1-O01、P2必須52 ID、P3必須60 ID、P4必須72 ID、P5必須59 ID、P6必須39 ID、
  P7必須39 ID をすべて実装・成功（対応表: 各completion-report）
- P8必須39 IDは、Phase 8終了時点では37 ID完全成功・1 ID部分実装（P8-D15）・1 ID未実装（P8-D18）
  （いずれもteeing branch配置）だったが、**Phase 9（v0.12）で解消し39 IDすべて完全成功**
  （`docs/phase-8-completion-report.md` §17-1追記）
- P8-O01はPhase 9で `teeingToMapByRegion` / `teeingToMapCount` キーを追加し、JDK 25実測と完全一致
- 画面キャプチャ・Oracle結果・snapshot予算実測: `artifacts/phase-1/`〜`artifacts/phase-8/`
  （Phase 9のOracle証跡は `artifacts/phase-8/oracle-result.md` を更新）
- 視覚回帰の期待画像: `e2e/__screenshots__/`（Phase 8では既存35枚を据え置き、toMap表示・FAILED表示の
  新規8枚を追加。新規8枚は最下部`DetailsDisclosure`のみマスクして安定化。thresholdは緩和なし。
  Phase 9では基準画像の追加・更新なし〔43枚のまま〕）
- 全実行可能template（125件） × modeの233組合せで、`expectedCompletion`どおりの終端
  （`STREAM_CONSUMED` / `EXECUTION_FAILED`）・snapshot予算内・Javaコード生成を機械検証（P8-D22）
- production bundleはReact vendor chunkを分離し、各chunk 500 kB未満（`vite.config.ts`）

## ドキュメント

| ファイル | 内容 |
|---|---|
| `docs/Java_Stream_API_Visualization_Spec_v0.10_Phase6_ManualLink.md` | v0.10 仕様（Phase 6手動連携差分。AI API接続の廃止と取込方式） |
| `docs/Java_Stream_API_Visualization_Spec_v0.9_Gatherers.md` | v0.9 仕様（Phase 7 Gatherers差分） |
| `docs/Java_Stream_API_Visualization_Spec_v0.11_toMap.md` | v0.11 仕様（Phase 8 Collectors.toMap差分） |
| `docs/Java_Stream_API_Visualization_Spec_v0.12_TeeingToMap.md` | v0.12 仕様（Phase 9 teeing×toMap差分） |
| `docs/Claude_Code_Phase8_Implementation_Instructions.md` | Phase 8実装指示書（確定値・snapshot列・必須テストID） |
| `docs/phase-8-completion-report.md` | Phase 8完了報告（判定・証跡・必須39 ID対応表・総点検・Oracle結果。§17-1にPhase 9での解消を追記） |
| `docs/phase-8-decisions.md` | Phase 8判断記録（補助データセット・実行失敗の伝搬設計・FAILED区分・取込対象外方式・teeing制約。§9.2にPhase 9実施記録） |
| `docs/Claude_Code_Phase7_Implementation_Instructions.md` | Phase 7実装指示書（確定値・snapshot列・必須テストID） |
| `docs/phase-7-completion-report.md` | Phase 7完了報告（判定・証跡・必須39 ID対応表・総点検・Oracle結果・差異記録） |
| `docs/phase-7-decisions.md` | Phase 7判断記録（累積評価の独立実装・list / stringList並存・取込対象外方式・OBSERVATION反映） |
| `docs/phase-6-completion-report.md` | Phase 6完了報告（判定・証跡・必須39 ID対応表・総点検・Oracle結果・差異記録） |
| `docs/phase-6-decisions.md` | Phase 6判断記録（Import Contract配置・取込UI形式・プロンプト設計・Oracle境界値・bundle分割） |
| `docs/phase-5-completion-report.md` | Phase 5完了報告（判定・証跡・必須59 ID対応表・24条件対応表・Oracle結果・差異記録） |
| `docs/phase-5-decisions.md` | Phase 5判断記録（§1〜§12: J-2 `Collectors.teeing`確定 / §13以降: 本体実装の判断） |
| `docs/phase-4-completion-report.md` | Phase 4完了報告（判定・証跡・72 ID対応表・Oracle結果） |
| `docs/phase-4-decisions.md` | Phase 4判断記録（terminal結果のtagged union・closed schema・証跡書込み範囲） |
| `docs/phase-3-completion-report.md` | Phase 3完了報告（判定・証跡・60 ID対応表・J-2不変条件・Oracle結果・差異記録） |
| `docs/phase-3-decisions.md` | Phase 3判断記録（J-2 `sorted`確定 + Phase 3本体の実装判断） |
| `docs/phase-2-completion-report.md` | Phase 2完了報告（判定・証跡・52 ID対応表・TypeRef連鎖・Oracle結果） |
| `docs/phase-2-decisions.md` | generate/iterate2境界・flatMap親子とJ-2・実装判断の記録 |
| `docs/phase-1-completion-report.md` | Phase 1完了報告（判定・証跡・テスト対応表・仕様差異） |
| `docs/phase-1-decisions.md` | J-1（JDK 25 Oracle Tests）/ J-3（playbackState ERROR）の判断記録 |

## ブランチ構成

工程別ブランチで作業し、Pull Request経由で `main` へマージする運用。
Phase 1は積み上げ式の細分ブランチ（`phase1/00-spec` 〜 `phase1/12-reports`）で進め、
Phase 2以降は各Phaseにつき1本のブランチ（`phase-2` / `phase-3` / `phase-4` / `phase-5` / `phase-6` /
`phase-7` / `phase-8` / `phase-9`）を
`main` から分岐させ、レビュー後にPull Requestでマージしている。
各Phaseで作成したファイルは、対応するブランチのコミット（またはmainのマージコミット）の差分で確認できる。
