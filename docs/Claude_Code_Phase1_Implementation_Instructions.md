# Java Stream API 可視化シミュレーター

## ローカルClaude Code向け Phase 1実装指示

以下の指示を、対象プロジェクトのルートディレクトリで起動したClaude Codeへ、そのまま渡してください。

---

# Phase 1実装指示

Java Stream API 可視化シミュレーターのPhase 1を実装してください。

本指示を、`Java Stream API 可視化シミュレーター 実装基準仕様書 Draft v0.8` §25で定めた「Phase 1開始の明示的な指示」とします。ここからPhase 1の実装を開始してください。

## 1. 最優先の実装基準

実装・テスト・完了判定の唯一の基準は、次の仕様書です。

`Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`

最初にリポジトリ内からこのファイルを探し、全文を読んでください。想定配置は `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx` ですが、ファイル名が同じであれば実際の配置を優先してください。

- Draft v0.8を読み終えるまで、アプリコードを変更しないでください。
- Draft v0.8は確定済みの実装基準です。再設計、要件の削減、要件の追加は行わないでください。
- Draft v0.8を編集しないでください。実装中の判断は別の判断記録へ残してください。
- 旧Draft、過去の会話、画面モック、既存コードとDraft v0.8に差異がある場合はDraft v0.8を正とします。
- ただし、リポジトリの `CLAUDE.md`、`AGENTS.md`、README、既存の開発規約も確認してください。これらとDraft v0.8が実質的に矛盾する場合は、独断で一方を採用せず、変更前に矛盾箇所と影響を報告して停止してください。
- 仕様書が存在しない、破損している、または全文を読めない場合は、実装を開始せず不足を報告してください。

## 2. 作業上の原則

1. 最初に `git status`、リポジトリ構成、使用中のパッケージマネージャー、Node.js環境、既存設定・テストを確認してください。
2. ユーザーの既存変更を保持してください。無関係なファイルを変更せず、`git reset --hard`、既存変更の破棄、無断の大規模置換を行わないでください。
3. リポジトリが空に近い場合は、React + TypeScript + Viteのプロジェクトを構築してください。既存プロジェクトがある場合は、その構成とパッケージマネージャーを尊重してください。
4. テスト基盤が未導入の場合は、原則としてVitest、React Testing Library、Playwrightを使用してください。同等の既存基盤がある場合は重複導入せず再利用してください。
5. Draft v0.8の依存方向を守り、Simulation CoreをReact、DOM、タイマー、HTTP、AI SDKから分離してください。
6. UIに結果、型、active node、短絡位置等を独自計算させず、現在の確定snapshotから描画してください。
7. 任意コード実行につながる `eval`、`new Function`、動的JavaScript関数生成、AI生成コード実行を導入しないでください。
8. 作業途中で仕様上の重大な曖昧さや実装不能な矛盾を発見した場合は、推測で埋めず、対象節、影響、選択肢、推奨案を報告して停止してください。
9. 通常の実装詳細は自律的に判断し、細かな確認待ちで作業を止めないでください。
10. コミット、push、Pull Request作成は、この指示の対象外です。別途指示されるまで行わないでください。

## 3. 最初に提示する実装計画

Draft v0.8とリポジトリを確認した後、コード変更前に、次を簡潔に提示してください。

- 現在のリポジトリ状態と再利用できる構成
- Phase 1の実装単位と実装順序
- 追加・変更予定の主なファイル
- テスト戦略と実行コマンド
- J-1とJ-3を判断・記録するタイミング
- 既知のリスクまたはブロッカー

計画提示後、ブロッカーがなければ確認待ちで停止せず、Phase 1の実装、テスト、画面確認、完了報告まで続けてください。

## 4. Phase 1の目的

`filter`の縦断fixtureを使い、次の最小完全経路を成立させてください。

`FixtureScenarioProvider → PipelineTemplate → DSL → TypeRef → Step Engine → Snapshot History → React UI`

Phase 1は操作数を増やす段階ではありません。後続Phaseで操作を追加できる基盤が正しく分離され、決定的かつテスト可能であることを優先してください。

## 5. Phase 1で実装する範囲

Draft v0.8 §21〜§23を漏れなく実装してください。最低限、次を含みます。

### 5.1 プロジェクトと共通基盤

- React + TypeScript + Vite
- 開発、型検査、build、単体・統合テスト、E2Eテストの実行設定
- `TypeRef`
- `OperationDefinition`と拡張可能な`OperationCatalog`
- `PipelineTemplate`、`TemplateInstance`、`PipelineDefinition`
- `Scenario`、`Snapshot`、`SimulationSession`
- 同一target operationへ複数templateを登録できる`TemplateRegistry`
- 外部から破壊的変更されないDomainモデルと確定snapshot

### 5.2 Phase 1の最小Operation Catalog

- source
- `filter`：`INTERMEDIATE / STATELESS`
- `toList`：`TERMINAL`

sourceと`toList`は、Phase 1の縦断fixtureに必要な最小実装だけにしてください。

### 5.3 Template、fixture、ScenarioProvider

- `ScenarioProvider` interface
- `FixtureScenarioProvider`
- 標準、途中0件、空ソースの3モード
- 安定したelement ID、template ID/version、scenario revision、provenance
- fixtureをAI生成として表示しないこと
- AI機能は利用不能とし、ボタンのdisabled状態と利用不能理由を一致させること
- AI利用不能時にfixtureへ自動フォールバックしないこと

基準fixtureはDraft v0.8 §21.3のEmployee 4件を、その値・順序のまま使用してください。

- 佐藤：35歳
- 鈴木：27歳
- 高橋：42歳
- 田中：29歳
- 標準条件：`age >= 30`
- 標準期待結果：佐藤、高橋
- 途中0件：全件falseとなる条件
- 空ソース：入力0件

横スクロール検証templateは、同じ4件のEmployeeデータセットを使い、次のPipelineを実装してください。

```text
stream()
→ filter(age >= 25)
→ filter(age >= 28)
→ filter(age >= 30)
→ filter(age >= 35)
→ filter(age >= 40)
→ toList()
```

- filterノード5個をそれぞれ安定した`nodeId`で区別してください。
- DSLはfield参照、int定数、GTEだけを使用してください。
- 期待結果は高橋1件です。
- `snapshotBudget`は「4要素 × 5ノード ≒ 60前後、500上限内」を保持してください。

### 5.4 DSLと一貫した生成物

Phase 1のDSLは、次だけを許可してください。

- Employeeの許可済みfield参照
- int定数
- 比較演算子GTE
- `filter` Predicate

JSON／構造、templateの許可範囲、型、教材制約、snapshot予算を、Draft v0.8の順序に従って検証してください。未知kind、許可外field、許可外operator、型不一致、必須slot欠落、version不一致を拒否してください。

同じ検証済みDSL / ASTから、次を生成し、互いに食い違わないようにしてください。

- 安全なPredicate評価
- Pipelineの型遷移
- コンパイル可能なJava表示コード
- 現在処理の自然文説明

Java表示では`Employee`と`Department`をrecordとして生成し、Predicateは `e -> e.age() >= 30` のようにアクセサー形式を使用してください。JavaコードにはASCIIの `->` と `>=` を使い、Unicode矢印を混入させないでください。コード行にはactive nodeと対応する安定したline IDを持たせてください。

### 5.5 Step Engine、snapshot、履歴

Step Engineは純粋かつ決定的にし、現snapshotから次の確定snapshotを1件ずつ生成してください。Phase 1では最低限、次の状態・処理を表現してください。

- INITIAL
- sourceからの要素送出
- nodeへの要素到着
- Predicate評価確定
- 通過または除外
- `toList`への要素追加
- 終端結果確定
- STREAM CONSUMED

次を厳守してください。

- snapshotは「学習上意味があり、全画面が同一時点を示し、戻る操作で完全復元できる1つの確定状態」です。
- 全パネルが同じsnapshot IDを描画します。
- active node、Javaコードline ID、TypeRef、要素状態、出力が同じ時点を表します。
- 確定snapshotへ未完了アニメーションを保存しません。
- 同じscenario revisionから同じsnapshot列を生成します。
- `戻る`は再計算せず、historyのcursorを戻して保存済みsnapshotを復元します。
- 戻った後の`進む`は、既存historyがある限り保存済みsnapshotを再利用します。
- 初期snapshotを含め最大500件とし、501件目は作成しません。500件目を保持したまま`LIMIT_REACHED`へ遷移し、理由を表示します。

### 5.6 再生制御

次の操作を実装してください。

- 最初から
- 戻る
- 進む
- 自動
- 停止

自動再生は1000ms固定です。速度変更UIは作りません。

- 自動は現在位置の次のsnapshotから開始します。
- 停止時はタイマーを解除し、最後の確定snapshotとcursorを保持します。
- 再開時は現在snapshotの次から続けます。
- timerが遅延しても複数snapshotをまとめて追い越し実行しません。
- 完了、`LIMIT_REACHED`、`ERROR`、scenario切替で自動再生を停止します。
- scenario切替時はタイマーを止め、新revisionでhistoryを初期化します。

### 5.7 React UI

Draft v0.8 §17、§21、§22に従い、次を実装してください。

- `ScenarioControls`
- `PipelineViewport`
- Input / Processing / Output
- JavaCode
- Explanation
- Details
- StickyPlaybackBar

UI要件：

- ライトテーマを基本とし、十分なコントラストを確保すること
- PCではPipeline、全幅の入力 → 処理中 → 出力、下段のJavaコード / 説明、sticky操作バーを仕様順に配置すること
- 狭幅ではコード / 説明を縦積みにすること
- Pipelineノードは左詰め、非折返しとし、短い場合は右余白を残すこと
- 長い場合はページ全体ではなくPipeline専用の横スクロールにすること
- active node変更時に該当ノードを可視位置へ追従させること
- Pipelineは`min-height + auto height`とし、型やバッジを欠けさせないこと
- sticky操作バーが本文末尾を隠さないこと
- filterの凡例には、この操作で発生する4状態だけを表示し、「□ バッファ済み」を表示しないこと
- Java式は `->` / `>=`、視覚フローは `→` を使い分けること
- 状態を色だけでなく、記号、文言、適切な読み上げ名でも識別可能にすること
- キーボード操作と可視フォーカスを実装すること
- `prefers-reduced-motion`時は移動アニメーションを抑制すること

## 6. Phase 1で実装しないもの

次を実装しないでください。スタブや見た目だけで実装済みに見せることも禁止します。

- filter以外の本実装
- Phase 1の縦断fixtureに必要な範囲を超えるsource / toList
- primitive特化Stream
- map、flatMap、distinct、sorted、limit、skip、takeWhile、dropWhile、peek
- 短絡終端、reduce、数値集計、Optional系終端
- Collector Engine、Collector ASTの本実装
- 実AI接続、サーバーAPI、RemoteScenarioProvider
- 自由Pipelineビルダー、自由式編集、任意コード実行
- parallelStreamの実行シミュレーション
- 自動再生速度変更UI
- null、NaN、Infinity、overflow、例外を主題とする教材
- 全操作向けの最終視覚調整
- 本番デプロイ構成

未実装操作は、選択不能または明示的に「未実装」と表示してください。

## 7. Phase 1中の判断事項

Draft v0.8自体は編集せず、リポジトリの規約に適合する場所へ判断記録を作成してください。既存のADR方式があれば従い、なければ `docs/phase-1-decisions.md` を作成してください。

### J-1：JDK 25 Oracle Tests

Phase 1完了報告を作る前に、環境と再現性を確認して次のどちらかを選び、理由と実行方法を記録してください。

1. filterの標準・途中0件・空ソースをJDK 25で照合する`P1-O01`をPhase 1へ追加する。
2. Oracle TestsはPhase 2から開始し、Phase 1完了報告で対象外と明記する。

同時に、JDK 25ランタイムの調達方法を決めてください。

- Eclipse Temurin 25をローカルへ導入する
- CI上で取得する

GitHub Releasesからの取得・実行は検証済みという仕様上の前提を保持してください。ローカル環境やネットワーク制約により実行できない場合は、実行済みと偽らず、選択、試行内容、ブロッカー、再実行手順を報告してください。

### J-3：`playbackState.ERROR`

history / engine実装時に、`ERROR`への遷移条件、保持する状態、タイマー停止、ユーザー向け表示、テスト方法を決めて記録してください。

PipelineDefinition生成前に入力検証が完了する設計を崩さず、実行時`ERROR`はエンジン内部の不整合を検知した場合のフェイルセーフに限定する想定を守ってください。通常の入力不正を実行時`ERROR`へ流さないでください。

### J-2：将来判断として保持

J-2はPhase 1で決定しません。次の期限と論点を完了報告の持越し事項へ残してください。

- sortedの例外規定：Phase 3着手前
- teeingの例外規定：Phase 5着手前
- 論点：1つの確定snapshotに処理中要素は原則1件とする規定に対する、flatMap親子、sorted一括並べ替え、teeing左右2系統の例外

## 8. 必須テスト

Draft v0.8 §23の次の41 IDをすべて実装・実行してください。テストIDをテスト名または対応表で追跡可能にしてください。1 IDを複数のテストケースへ分けても構いませんが、IDを省略しないでください。

### 8.1 Domain単体テスト（14 ID）

- `P1-D01` TypeRef
- `P1-D02` OperationCatalog
- `P1-D03` TemplateRegistry
- `P1-D04` TemplateInstantiation
- `P1-D05` DSL構造
- `P1-D06` DSL型
- `P1-D07` DSL評価
- `P1-D08` Javaコード生成
- `P1-D09` 説明生成
- `P1-D10` 教材制約
- `P1-D11` Step Engine
- `P1-D12` snapshot不変条件
- `P1-D13` 空ソース
- `P1-D14` 安全上限

### 8.2 履歴・Applicationテスト（8 ID）

- `P1-A01` 進む / 戻る
- `P1-A02` 戻る / 再進行
- `P1-A03` 最初から
- `P1-A04` 自動
- `P1-A05` 停止 / 再開
- `P1-A06` timer遅延
- `P1-A07` scenario切替
- `P1-A08` capability

timer関連はfake timer等を使い、1000ms、停止、再開、追い越しなしを決定的に検証してください。

### 8.3 React統合テスト（8 ID）

- `P1-R01` 全パネル同期
- `P1-R02` コード同期
- `P1-R03` 凡例
- `P1-R04` 入力状態
- `P1-R05` 出力
- `P1-R06` 操作ボタン
- `P1-R07` AIボタン
- `P1-R08` reduced motion

### 8.4 E2E・視覚テスト（11 ID）

- `P1-E01` 標準filter
- `P1-E02` 途中0件
- `P1-E03` 空ソース
- `P1-E04` 戻る
- `P1-E05` 手動途中からの自動再生
- `P1-E06` filterチェーンtemplateの横スクロールとactive node追従
- `P1-E07` Pipelineの`min-height + auto height`
- `P1-E08` sticky操作バーと本文下部余白
- `P1-E09` 狭幅レイアウト
- `P1-E10` キーボード、focus、状態名のアクセシビリティ
- `P1-E11` 初期、通過、除外、完了の代表snapshotによる視覚回帰

`P1-E11`の期待画像はDraft v0.8 §21.3の4要素fixtureを正としてください。5要素の図1モックを正解画像にしないでください。

J-1で`P1-O01`を追加すると判断した場合だけ、41 IDに加えて実装・実行・報告してください。

## 9. 検証手順

少なくとも次を実行し、実際に成功したことを確認してください。コマンド名はリポジトリのpackage scriptsに合わせてください。

1. 依存関係の導入または整合確認
2. formatter / lint（設定されている場合）
3. TypeScript型検査
4. Domain・Application・Reactテスト
5. production build
6. Playwright E2E
7. 視覚回帰テスト
8. PC幅と狭幅での画面キャプチャ
9. `eval`、`new Function`、AI SDK、Phase 1対象外実装が混入していないことの確認
10. `git diff`と`git status`による変更範囲確認

テスト失敗をskip、期待値緩和、検証削除、過度なmockで隠さないでください。環境依存で実行できないテストがある場合は、未実行のまま成功扱いせず、原因、試行内容、残作業、再実行コマンドを明記してください。

代表snapshotは文字列だけでなく、snapshot ID、active node、line ID、TypeRef、要素状態、出力、playback stateを含む構造比較で検証してください。

スクリーンショットとテスト結果は、既存の成果物配置規約があれば従ってください。規約がなければ `artifacts/phase-1/` 配下へ保存してください。

## 10. Phase 1の完了条件

次をすべて満たした場合だけ、Phase 1完了と判定してください。

- Draft v0.8 §21の実装範囲が完了している
- Draft v0.8 §22の受入条件を満たしている
- 必須41テストIDがすべて実装され、成功している
- J-1の判断と結果が記録されている
- J-3の判断、実装、テストが記録されている
- J-2が期限付き持越し事項として残されている
- buildと型検査が成功している
- PC幅・狭幅の画面確認と代表snapshotの視覚回帰が完了している
- 既知の仕様差異がゼロ、または差異が明示されて未解決として報告されている
- Phase 2以降の機能を先行実装していない

1項目でも満たせない場合は「Phase 1未完了」とし、残作業を具体的に報告してください。

## 11. 完了報告

実装終了時に、既存の報告書配置規約があれば従い、なければ `docs/phase-1-completion-report.md` を作成してください。チャット上でも同じ要点を報告してください。

報告には次を必ず含めてください。

1. Phase 1の完了／未完了判定
2. 実装済み機能
3. 未実装機能と、Phase 1対象外の操作一覧
4. 主な変更ファイルとアーキテクチャ上の役割
5. 実行した全コマンドと終了結果
6. テスト種別ごとの総数、成功、失敗、skip
7. 41の必須テストIDごとの実装・成功対応表
8. J-1の判断、JDK 25ランタイム調達方法、Oracle Test結果または対象外理由
9. J-3の決定内容、実装箇所、テスト結果
10. J-2の持越し内容と期限
11. 代表snapshotの構造比較結果
12. PC幅・狭幅の画面キャプチャの保存先
13. P1-E11の視覚回帰結果
14. 仕様との差異
15. 500 snapshot上限への影響と検証結果
16. 既知の問題と次Phaseへの持越し事項
17. 最終`git status`と、コミットしていないことの確認

「テスト成功」「仕様準拠」などの結論だけでなく、コマンド、件数、結果、成果物パスを根拠として示してください。

## 12. 最終禁止事項

- Draft v0.8を変更しない
- Phase 2以降を先行実装しない
- AIを接続しない
- fixtureをAI生成と表示しない
- 未実装操作を実装済みに見せない
- 失敗・skip・未実行を隠さない
- 仕様差異を暗黙に正当化しない
- ユーザーの既存変更を破棄しない
- 別途指示なしにcommit、push、Pull Request作成を行わない

Phase 1の実装、検証、証跡作成、完了報告まで実行してください。

---

## 使用前の確認

Claude Codeを起動する前に、少なくとも次を対象リポジトリへ配置してください。

```text
<project-root>/
├── docs/
│   └── Java_Stream_API_Visualization_Spec_Draft_v0.8.docx
└── CLAUDE.md または AGENTS.md（存在する場合）
```

Claude Codeは対象プロジェクトのルートディレクトリで起動し、上の「Phase 1実装指示」全体を渡してください。
