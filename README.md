# Java Stream API 可視化シミュレーター

Java Stream API の処理の流れ（要素の通過・除外、型遷移、遅延評価）を1ステップずつ可視化する学習教材アプリ。

- 基準仕様: `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`（Draft v0.8 / Java SE 25基準）
  + `docs/Java_Stream_API_Visualization_Spec_v0.10_Phase6_ManualLink.md`（v0.10 / Phase 6手動連携差分）
  + `docs/Java_Stream_API_Visualization_Spec_v0.9_Gatherers.md`（v0.9 / Phase 7 Gatherers差分）
  + `docs/Java_Stream_API_Visualization_Spec_v0.10.docx`（上記3文書の統合ビルド。閲覧用。正は各原本）
- 実装状況: **Phase 6 完了**（手動連携。Import Contract / Prompt Generator / Candidate Import / 取込UI。
  詳細は `docs/phase-6-completion-report.md`）
- J-2（`Collectors.teeing` の左右2系統と処理中要素数の関係）は Phase 5着手前に仕様確定し、本体へ実装済み
  （`docs/phase-5-decisions.md`。teeingでも「処理中要素は最大1件」の例外なし）
- Phase 6でAI API接続（サーバーAPI・AI adapter・RemoteScenarioProvider）は**廃止**し、**手動連携方式**へ置換した
  （v0.10。アプリがプロンプトを生成 → ユーザーが任意のAIチャット等で候補JSONを作成 → 貼り戻して検証・取込）
- **Phase 7（Gatherers、`docs/Java_Stream_API_Visualization_Spec_v0.9_Gatherers.md`）は未着手**
- 実装指示: `docs/Claude_Code_Phase1_Implementation_Instructions.md` /
  `docs/Claude_Code_Phase2_Implementation_Instructions.md` /
  `docs/Claude_Code_Phase5_Implementation_Instructions.md` /
  `docs/Claude_Code_Phase6_Implementation_Instructions.md`
  （Phase 3 / Phase 4の指示書は、指示書自身の複製禁止規定によりリポジトリへ含めていない）

## 実装済み操作（Phase 6時点）

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
  - Collector入れ子: `teeing`（`SalarySummary` merger）
  - Collectorは再帰的なCollector AST（DSL）として表現し、構造ツリー・現在経路・ノード別蓄積・
    内側から外側へ組み上がる結果TypeRef・finisher / mergerの独立snapshotを可視化する
  - 結果はtagged union（LIST / SCALAR / OPTIONAL / ARRAY / STATISTICS / VOID / COLLECTION / MAP / RECORD）
    として構造化し、Set / Mapの表示順はUIの純粋なDisplayOrderProjectionで安定化する（JDKのiteration
    order保証とは区別して注記）
  - `Collectors.toMap()` は Draft v0.8 付録A.4の対象外のため未実装

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
      → ScenarioProvider (src/providers) … FixtureScenarioProvider（Phase 1〜5。Phase 6でも無変更）
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
- 無限source（generate / iterate2）は有限性解析で必要source要求件数を事前導出し、必要な分だけ決定的に生成
  （`PipelineDefinition.boundedness` / `orderMeta`）
- 「戻る」は再計算せず保存済みsnapshotを復元（seen・buffer・count・Side Effect履歴・Collectorのbucket /
  蓄積 / finisher / merger結果も完全復元）。全パネルが同一snapshot IDを描画

## 実行方法

```bash
npm install
npm run dev          # 開発サーバー
npm run typecheck    # 型検査（strict）
npm run lint         # oxlint
npm run test:unit    # Domain/Application/Reactテスト（Vitest）
npm run build        # production build
npm run test:e2e     # Playwright E2E + 視覚回帰（要: npx playwright install chromium）
npm run test:oracle  # JDK 25照合 P1-O01〜P6-O01（要: Docker + gradle:9.6.1-jdk25イメージ）
                     # 証跡を書き込むのは現行Phase（P6-O01 → artifacts/phase-6/oracle-result.md）のみ。
                     # P1〜P5は照合のみで、実行前後に artifacts/phase-1〜phase-5 のSHA-256不変を検証する
```

## テスト結果（Phase 6 最終）

| 種別 | 件数 | 結果 |
|---|---|---|
| Vitest（Domain / Application / React、P1 + P2 + P3 + P4 + P5 + P6） | 515（52ファイル） | 全成功 |
| E2E・視覚回帰（P1-E01〜11 + P2-E01〜10 + P3-E01〜10 + P4-E01〜10 + P5-E01〜10 + P6-E01〜05） | 72 | 全成功 |
| JDK 25 Oracle（P1-O01 / P2-O01 / P3-O01 / P4-O01 / P5-O01 / P6-O01 + P4-O02 / P6-O02） | 6 suite | 完全一致 |

- P1必須41 ID + P1-O01、P2必須52 ID、P3必須60 ID、P4必須72 ID、P5必須59 ID、P6必須39 ID を
  すべて実装・成功（対応表: 各completion-report）
- 画面キャプチャ・Oracle結果・snapshot予算実測: `artifacts/phase-1/`〜`artifacts/phase-6/`
- 視覚回帰の期待画像: `e2e/__screenshots__/`（Phase 6で取込UIを含む基準へ意図的更新。既存20枚＋新規7枚）
- 全実行可能template（109件） × modeの211組合せで終端到達・snapshot予算内・Javaコード生成を機械検証（P6-D22）
- production bundleはReact vendor chunkを分離し、各chunk 500 kB未満（`vite.config.ts`）

## ドキュメント

| ファイル | 内容 |
|---|---|
| `docs/Java_Stream_API_Visualization_Spec_v0.10_Phase6_ManualLink.md` | v0.10 仕様（Phase 6手動連携差分。AI API接続の廃止と取込方式） |
| `docs/Java_Stream_API_Visualization_Spec_v0.9_Gatherers.md` | v0.9 仕様（Phase 7 Gatherers差分。未着手） |
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
Phase 2以降は各Phaseにつき1本のブランチ（`phase-2` / `phase-3` / `phase-4` / `phase-5` / `phase-6`）を
`main` から分岐させ、レビュー後にPull Requestでマージしている。
各Phaseで作成したファイルは、対応するブランチのコミット（またはmainのマージコミット）の差分で確認できる。
