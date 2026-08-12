# Java Stream API 可視化シミュレーター 仕様書 v0.10（Phase 6手動連携差分版）

## 1. 版管理（Draft v0.8 §1.2の変更管理に基づく）

- 版番号: **v0.10**（第6版ドラフト。codexレビュー第1回指摘10件〔高5・中3・低2〕・第2回指摘7件〔高1・中4・低2〕・第3回指摘2件〔高1・中1〕・第4回指摘1件〔高1〕・第5回指摘2件〔高1・低1〕を反映）
- 本書の構成: **v0.10 = Draft v0.8（`docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`、無編集のまま保持）+ v0.9差分（`docs/Java_Stream_API_Visualization_Spec_v0.9_Gatherers.md`、無編集のまま保持）+ 本差分文書**。全文転記は行わない。
- 変更理由: Phase 6で予定していたAI API接続（サーバーAPI + AiScenarioAdapter + RemoteScenarioProvider）を廃止し、**手動連携方式**（アプリがプロンプトを生成し、ユーザーが任意のAIチャットへ貼り付け、応答JSONをアプリへ貼り戻して検証・取込する方式）へ置き換えるため。動機はAPIキー管理と従量課金の回避である。
- 作成日: 2026-08-12

### 1.1 優先順位

**本書の明示的な手動連携固有規定だけがv0.8・v0.9に優先する。**本書が明示的に変更していない一般原則・不変条件・検証順序・UI原則はすべてv0.8（およびv0.9のGatherer固有規定）を適用する。v0.8のAI関連記述の**全対応表**を§1.2に示す。§1.2に挙がっていないAI関連記述が実装中に見つかった場合は、コードを暗黙の正とせず（v0.8 §1.2）、本書へ扱いを追記してから進める。

### 1.2 v0.8のAI関連記述の全対応表

扱いは4区分とする。**置換**=本書の規定へ差し替える。**読み替え**=主体・語句を置き換えて存続する。**歴史的**=当時の記録・契約として不変のまま保持し、現行仕様としては本書を適用する。**不変**=そのまま現行仕様として成立し続ける。

| v0.8箇所 | 記述の要旨 | 扱い | 本書 |
|---|---|---|---|
| §1・§1.1（改訂履歴） | 「初版のAI接続」等、v0.8自身の改訂経緯 | 歴史的 | — |
| §2 設計原則「AIと実評価を分離する」 | AIは検証前候補を生成、結果はSimulation Core | 置換（一般化） | §4.3 |
| §3.1「Phase 6のサーバー側AI adapterとRemoteScenarioProvider。」 | 初版スコープ | 置換 | §3.1 |
| §3.2「AI生成Javaコード、JavaScript eval、Function、動的関数生成、任意コード実行。」 | 禁止事項 | 不変 | §7.2 |
| §3.2「フロントエンドからAI事業者APIを直接呼ぶ構成。」 | 禁止事項 | 不変（本方式はAI事業者APIを一切呼ばない） | — |
| §3.3「このガイドラインはPhase 6のAI生成制約への流用を想定する」 | ノード数ガイドライン | 読み替え: 「取込候補の制約への流用」。取込はtemplateId固定のためノード数はtemplate定義が担う | §4.2 |
| §5.1・§5.2 Server AI Adapter系統 | レイヤー構成・責務 | 置換 | §3 |
| §5.3「Providerが返す値：検証前の候補であり、正解ではない。」 | Source of Truth | 不変（取込候補にも適用） | §4.3 |
| §7「TemplateやAI候補はtraitsを上書きできない」 | OperationCatalog | 読み替え: 「Templateや取込候補は」 | — |
| §8.1「fixture / AIが設定可能なDSLパラメータ」 | DSLスロット | 読み替え: 「fixture / 取込候補が」 | — |
| §8.4「AIが変更できる範囲」 | 候補が持ち込める範囲 | 置換（主体の置換） | §4.2 |
| §9.3「AI返却のコード文字列は表示にも評価にも使用せず…」 | 検証順序 | 置換（主体の置換） | §7.2 |
| §10.1（capability / generate）・§10.2（GenerateRequest） | ScenarioProvider契約 | **不変（fixture用契約として存続）**。取込経路はProvider実装ではない | §3.2 |
| §10.3（ScenarioCandidate） | provider種別FIXTUREまたはAI | 置換（種別変更） | §4.1 |
| §10.4（Provider構成）・§10.5（AI利用不能時） | Phase 6構成・利用不能時規定 | 置換 | §5 |
| §11.1 provenance「FIXTURE / AI、生成時刻、DSL version」 | Scenario項目 | 置換（種別変更） | §4.1 |
| §12.1等のApplication「Provider選択」 | Application責務 | 読み替え: 「候補入手経路（fixture提示 / 取込受理)の選択」として存続 | §3.2 |
| §17.1「固定またはAIサンプル」 | 画面領域 | 置換 | §8 |
| §18「AIで別サンプル」 | 操作一覧 | 置換 | §8 |
| §19「任意コード実行なし。DSLホワイトリスト。AIキーはサーバーのみ」 | 安全性 | 置換（改訂） | §7.1 |
| §20 Phase 6行 | Phase別実装計画 | 置換 | §9 |
| §21.2「AI capabilityはdisabled理由を返す」・§21.4「実AI接続、サーバーAPI、RemoteScenarioProvider。AIボタンは利用不能理由を表示する。」 | Phase 1実装契約 | 歴史的 | §1.3 |
| §22.1「fixtureがAI生成として表示されない。AI capability不可の場合はボタンと理由が一致する。」 | Phase 1受入条件 | 歴史的（現行UIは§8） | §1.3 |
| §22.4「AI生成コード実行が存在しない」「Simulation CoreがReact、DOM、タイマー、AI SDKに依存しない」 | Phase 1受入条件 | 不変（引き続き成立） | — |
| §23.2 P1-A08・§23.3 P1-R07 | Phase 1テスト項目 | 歴史的（テスト表・当時の結果は不変。現行回帰suiteは§1.3の表で意図的更新） | §1.3 |

### 1.3 影響するPhase

- **Phase 6のみ。**Phase 6は未着手のため、廃止対象の実装（サーバーAPI・AiScenarioAdapter・RemoteScenarioProvider）は存在せず、コードの削除は発生しない。廃止されるコードは`AI_CAPABILITY`定数とdisabled AIボタン（存在する）のみである。
- **完了済みPhase 1〜5の保護は次の2層に分離する。**
  1. **歴史的証跡（不変)**: 各Phaseの完了報告・当時の受入条件・テスト項目表・判断記録・テスト結果は一切変更しない。v0.8 §21〜§23のAI関連記述は§1.2のとおり「歴史的」として保持する。
  2. **現行回帰テストスイート（意図的更新）**: AIボタン・AI capabilityを検証対象とする現行テストは、capability廃止に伴い**旧目的をそのまま維持できない**ため、次の表のとおり更新する。更新は理由つきでPhase 6完了報告へ記録する。

| 現行テスト | 旧契約 | 新契約 | 維持する不変条件 |
|---|---|---|---|
| P1-A08（`tests/application/session.test.ts`） | `AI_CAPABILITY`がavailable: false・理由文言を返し、UI状態と一致させられる | **廃止**し、P6-A系の新IDで「取込検証の結果（合格 / 不合格理由）とUI表示の一致」を検証する | 「利用者へ示す理由とUI状態の一致」という目的はP6系が継承する |
| P1-R07（`tests/react/app.test.tsx`） | AIボタンがdisabledで理由が読め、fixtureへ自動切替しない | **廃止**し、P6-R系の新IDで「取込失敗時に現行シナリオを維持し理由を表示する」を検証する | 「ユーザー操作なしにシナリオが切り替わらない」「fixtureは固定サンプルと表示する」はP6系とP2-A02が継承する |
| P2-A02（`tests/application/p2-session.test.ts`）の末尾assertion | `app.aiCapability.available === false` | 当該assertionのみ削除。「fixture / 取込サンプル表示を混同しない」という本体は不変 | provider種別の表示を混同しない |
| P5-R01（`tests/react/p5-app.test.tsx`）の末尾assertion | 「AI理由はPhase 6のまま維持される」 | 当該assertionを**削除のみ**行い、テスト名からも「AI理由はPhase 6のまま維持される」を除去する。Collector optgroup検証の本体は不変。**取込UIの検証はP6-R系のみで行い、Phase 5のIDへPhase 6機能の検証を混在させない** | Phase 5 IDの検証対象はPhase 5機能のみ |
| 視覚回帰基準画像 | AIボタン領域を含む | 取込UI領域を含む基準へ意図的更新（diff画像で差分領域を確認、threshold緩和なし。Phase 5の前例に従う） | — |

- **v0.9（Gatherers差分・Phase 7）との整合**: v0.9 §1.2の「Phase 6の定義・完了条件は変更しない」「既存テストID（P1〜P6）は変更しない」はv0.9自身の変更範囲の宣言であり、本書による変更を妨げない。本書適用後は、v0.9の次の記述を読み替える。
  1. v0.9 §1.2「Phase 6成果（総合試験・AI候補検証を含む）を回帰として再実行する」→「総合試験・**手動連携の取込検証**を含む」。
  2. v0.9 §8.4・§10-6「AI生成候補（Phase 6のRemoteScenarioProvider）へgather DSLを開放するか」→「**手動連携の取込候補**へgather DSLを開放するか」。判断時期がPhase 7中であることは変更しない（Phase 6時点ではgather DSLは未実装のため取込対象外）。
  3. v0.9 §9「Phase 6（サーバーAPI・AI・総合試験）の完了後に実施する」→「Phase 6（**手動連携**・総合試験）の完了後に実施する」。Phase 6 → Phase 7の実施順序は不変。

## 2. 変更の背景と決定

- v0.8のPhase 6構成 `RemoteScenarioProvider → 自アプリのサーバーAPI → AiScenarioAdapter`（§5.1・§10.4）は、AI事業者のAPIキーをサーバー側に保持し（§10.4「AI APIキー、モデル呼び出し、再試行はサーバー側だけに置く」）、呼び出しごとに従量課金が発生する。
- 本教材はfixtureのみで完結する設計であり（§10.5「fixtureへ自動フォールバックしない」＝AI経路とfixture経路の完全分離、§22.1「AI capability不可の場合はボタンと理由が一致する」＝AIなしで受入成立）、AIの役割は「同じ操作・同じtemplateで別の学習データを見る」ためのバリエーション生成に限られる（§8.4）。
- この役割は、**AI呼び出しの実行者を人間に置き換えても成立する**。アプリは生成に必要な制約をプロンプトとして提示でき、応答の正しさは検証パイプラインが保証するため、生成者が誰か（どのAIか、人間の手書きか）に依存しない。
- 決定（2026-08-12）:
  1. サーバーAPI・AiScenarioAdapter・RemoteScenarioProviderを**廃止**する。Phase 6は純フロントエンド構成とする。
  2. 入力方式は**クリップボード貼付**とする（プロンプトのコピーと応答JSONの貼付）。
  3. 本変更は新規差分仕様書（本書）として文書化し、v0.8・v0.9は無編集のまま保持する。

## 3. アーキテクチャ変更（v0.8 §5.1・§5.2の置換）

### 3.1 レイヤーと依存方向

§5.1のレイヤー図を次のとおり置換する。

```
React UI
  → Application（セッション、履歴、再生、候補入手経路の選択、Candidate Import、Prompt Generator）
    → Simulation Core（型、DSL、Step Engine、Collector Engine）
    → ScenarioProvider
        └─ FixtureScenarioProvider（Phase 1〜5。変更なし）
```

- **削除**: `RemoteScenarioProvider → 自アプリのサーバーAPI → AiScenarioAdapter`の系統、および§5.2のServer AI Adapter行（責務「AI呼び出し、構造化応答、秘密情報、再試行」、禁止「APIキーをフロントへ渡さない」）。保護すべきAPIキー・秘密情報そのものが存在しなくなる。
- §3.1「初版に含めるもの」の「Phase 6のサーバー側AI adapterとRemoteScenarioProvider。」は「Phase 6の手動連携（Prompt GeneratorとCandidate Import）。」へ置換する。
- 依存方向の原則（§5.1「Simulation CoreはReact、ブラウザDOM、AI SDK、HTTPクライアントへ依存しない」）は不変。新設2責務はApplication層に置き、Simulation Coreへは依存しても依存されない。

§5.2のレイヤー責務表へ次の2行を追加する。

| レイヤー / モジュール | 主な責務 | 禁止事項 |
|---|---|---|
| Prompt Generator | 選択中の操作・モード・templateに対する生成依頼文の組み立て（§5.2）、クリップボードへのコピー | 機械可読な許可範囲（スロット・kind・許可キー・値域）をImport Contract（§5.2）以外に重複定義しない |
| Candidate Import | 貼付テキストの受付、前段検証（サイズ・構文・candidate schema・全階層closed schema。§7.2）、ScenarioCandidateの組み立て（provenance・revision・elementIdの付与）、検証結果の`Result`報告 | 貼付内容のコード文字列を表示にも評価にも使用しない。検証を通らない候補をStep Engineへ渡さない。ScenarioProviderを実装しない（§3.2） |

### 3.2 ScenarioProvider境界の存続範囲と取込経路の位置づけ

- **`ScenarioProvider` interface（`capability()` / `generate(request)`）とGenerateRequest（v0.8 §10.1・§10.2）は、fixture用契約として無変更で存続する。**`FixtureScenarioProvider`の実装・挙動も不変。
- **Candidate ImportはScenarioProviderを実装しない独立したApplicationサービスとする。**理由: `generate(request)`はアプリ主導のpull型契約（要求すると候補が返る）だが、取込はユーザー主導のpush型（貼付されて初めて候補が生じる）であり、interfaceを共有すると不自然な状態保持（貼付テキストの事前セット等）が必要になるため。
- ただし**境界契約は共有する**: v0.8 §10.1後段「Providerが返すのは候補データであり、snapshot、途中状態、期待結果、Javaコード全文ではない」と§5.3「Providerが返す値：検証前の候補であり、正解ではない」は、Candidate Importが組み立てるScenarioCandidateにもそのまま適用する。
- 廃止するのは`AI_CAPABILITY`定数（`src/providers/scenarioProvider.ts`）とそれを表示するdisabled AIボタンのみ。`ScenarioProvider.capability()`自体は存続する（fixture providerが実装済み）。
- Applicationの「Provider選択」責務は「**候補入手経路の選択**（fixture提示 / 取込受理）」として存続する。取込候補はGenerateRequestを経由しない。GenerateRequestが担っていた文脈整合（対象操作・mode・template・DSL version・現revision）は、取込では§6.1の一致検証と§6.5のrevision発行が担う。

## 4. 候補モデル・用語の変更

### 4.1 provider種別（v0.8 §10.3・§11.1の変更）

- provider種別を `FIXTURE | AI` から **`FIXTURE | IMPORTED`** へ変更する（`ScenarioCandidate.providerKind`・`ScenarioProvenance.providerKind`）。
- 表示名は「固定サンプル」（FIXTURE。不変）と「**取込サンプル**」（IMPORTED）とする。
- 表示規則: 「fixtureをAI生成と表示しない」（§10.5）は「**fixtureを取込サンプルと表示せず、取込サンプルを固定サンプルと表示しない**」へ読み替える。取込サンプルは、AIが生成したか人間が手書きしたかをアプリは判別できないため、「AI生成」という表示は使用しない。
- provenanceの内容（§11.1「生成時刻、DSL version」＋revision）は維持する。取込候補のprovenance・revisionは**アプリ側が取込時に付与**する（§6.5）。

### 4.2 生成者が変更できる範囲（v0.8 §8.4の主体置換）

§8.4「AIが変更できる範囲」の規定を、主体を「取込候補」に置き換えてそのまま適用する: 取込候補が持ち込めるのは、**選択中の操作に許可されたtemplateId、dataset、公開されたDSLスロットの値、限定された教材メタデータだけ**である。許可外のノード、操作、コード文字列、schema versionは拒否する。自由なPipeline構造は持ち込めない。v0.8 §3.3のノード数ガイドラインの「AI生成制約への流用」は「取込候補の制約への流用」と読み替えるが、取込はtemplateId固定であるためノード数は実質的にtemplate定義が拘束する。

### 4.3 設計原則の一般化（v0.8 §2の1行変更）

§2の設計原則「AIと実評価を分離する」を「**外部生成と実評価を分離する**」へ一般化する。仕様欄は「外部の生成者（AIチャットを使う人間を含む）は検証前のScenarioCandidateを生成し、結果と途中状態はSimulation Coreが算出する」、理由欄は「生成誤差を結果の正しさへ持ち込まないため」とする。

## 5. 手動連携フロー仕様（v0.8 §10.4・§10.5の置換）

### 5.1 全体フロー

```
[アプリ]                          [ユーザー]                 [任意のAIチャット等]
①「プロンプトをコピー」 ─────→ 貼り付け ─────→ claude.ai / ローカルLLM / 手書きでも可
②「候補を貼り付け」欄    ←───── コピー   ←───── 応答JSON
③ 取込検証（§6・§7.2）→ 合格: 取込サンプルとして確定 / 不合格: 理由を表示
```

- 対象は**現在選択中の操作・モード・template**とする。プロンプトは選択中のtemplate 1件に限定して生成し、取込候補のtemplateId・modeが選択中と一致しない場合は拒否する（§18「操作・モードを維持して検証済み候補へ切替」の意味論を維持）。
- **取込対象templateの範囲（確定）**: 全templateを取込対象とする。ただし**実行不能template**（limitなし無限sourceの`tmpl-src-generate`・`tmpl-src-iterate2`のような、fixtureでも実行不能と表示されるtemplate）は取込対象外とし、選択中は「プロンプトをコピー」「候補を貼り付け」の両方を無効化して理由を表示する。datasetを使わないsource slot型templateは取込対象であり、バリエーションは`dslParameters`のsource slot値で表現する（§6.1のdataset禁止規定と対応）。
- 取込の成立はシナリオ切替として扱う（v0.8 §18: タイマー停止、新revision、historyとcursorの初期化）。

### 5.2 プロンプト生成（Prompt Generator）とImport Contract

**Import Contract（新設）**: スロットごとの許可DSLの機械可読定義（許可kind、kind別の許可キー集合、許可field・operator、値の型・値域、§6の値域・上限）を、**宣言的な単一定義源**として新設する。既存のtemplate slot定義（`allowed*Kinds` / `allowedFields` / `allowedOperators`等）から構成できる部分は再利用し、不足分（kind別許可キー集合・値域）をContractへ定義する。Import Contractは次の2箇所から参照され、これ以外の場所に機械可読な許可範囲を重複定義しない。

1. **プロンプト生成**（本節）: 許可範囲の言語化。
2. **取込前段検証**（§7.2手順4）: candidate schemaと全階層closed schema検証。

**Import Contractと既存DSL検証の優先関係・同期保証**:

- Import Contractは「取込前段・プロンプト」における単一定義源であり、**既存DSL検証（`instantiateTemplate`の手順1〜7）が評価可能性・型適合の最終判定である**。両者が食い違う場合は既存DSL検証が正となる。
- Contractの許可範囲は**既存DSL検証と同等または厳しい範囲に限る**（Contractが受理して既存検証が拒否する形状は、安全性は損なわないが利用者に無駄な失敗を見せるため、Contract側の不具合として厳格化する）。
- 同期保証として次の2種のテストをP6必須観点に含める（§9）:
  1. **互換性テスト**: 全実行可能templateの既存fixtureのdslParametersをContract検証へ通した場合に、すべて受理されること（Contractが既存の正規値を狭めていないこと）。
  2. **整合テスト**: Contract受理後に既存構造検証だけが失敗する形状が代表ケースで存在しないこと（発見された場合はContractを厳格化して解消する）。
- fixture実行経路へ前段検証は挿入しない（fixture経路の挙動は完全不変。§6.3）。

現行の教材制約検証（`instantiateTemplate`内のmode別の手続き的検証）には宣言的メタデータが存在しないため、**教材制約の正は従来どおり手続き的検証とする**。プロンプトに含める教材制約の説明（下記5）は検証と同内容を目指した**補助的な自然文**であり、Import Contractの二重定義禁止の対象外とする。説明文と検証がズレても検証が優先し、ズレは安全性に影響しない（不合格理由の表示で回復できる）。

プロンプトには次を含める。

1. 依頼の説明: 「Java Stream API学習教材の入力データ候補を、下記のJSONだけで返す」旨。
2. 選択中のtemplateの構造説明（ノード列・スロット一覧）と、templateId・templateVersion・mode・dslVersion（取込時の一致検証に使う値をそのまま明記）。
3. スロットごとの許可DSL（Import Contractから導出）。
4. dataset契約（§6.2）: フィールド・型・値域・件数範囲。datasetを使わないtemplateでは省略する。
5. モード別の教材制約の説明（標準=判定のtrue / false双方を含む等）。
6. snapshot予算への注意（データ件数を小さく保つ）。
7. 出力形式の指定: 本書§6.1のJSONのみを返す。説明文・コードフェンスは不要と指示する（ただし取込側はフェンス付き応答を許容する。§7.2）。
8. 出力JSONの具体例1件。

コピーは`navigator.clipboard.writeText`を用い、失敗時はプロンプト全文を選択可能なテキストとして表示するフォールバックを備える。コピー成否はUIでフィードバックする。

### 5.3 利用可否（v0.8 §10.5の置換）

- 手動連携は、実行不能templateの選択中（§5.1）を除き**常時利用可能**とする。ネットワーク・外部サービスへの依存がないため、旧§10.5の「AI利用不能時」の状態は存在しない。`AI_CAPABILITY`定数とdisabled AIボタンは廃止する（§3.2）。
- 「fixtureへ自動フォールバックしない」は「**取込の検証が失敗しても、現在表示中のシナリオを変更せず、失敗理由を表示するのみとする**」へ読み替えて維持する。
- 旧§10.5「構造検証・型検証・教材制約検証に失敗した候補は再試行し、最終失敗時は理由を示す」の「再試行」は、本方式では**ユーザーがAIチャット側で修正させて再貼付する**ことに置き換わる。アプリ側の自動再試行は行わない。失敗理由の表示は、修正依頼にそのまま使える具体性（対象スロット・コード・メッセージ）で示す（§8）。

## 6. 取込候補のJSON契約

### 6.1 貼付JSONのトップレベル（closed schema）

貼付JSONのトップレベルは次のキー**のみ**を許可する。未知キーは拒否する。

| キー | 型 | 必須 | 検証 |
|---|---|---|---|
| `dslVersion` | string | 必須 | 現在の`DSL_VERSION`と完全一致 |
| `templateId` | string | 必須 | 選択中のtemplateIdと一致 |
| `templateVersion` | number | 必須 | **1以上の整数**かつ選択中のtemplateのversionと一致 |
| `mode` | string | 必須 | 選択中のScenarioMode（`standard` / `midEmpty` / `emptySource`）と一致 |
| `dataset` | array | 必須（Employee系template） / **禁止**（source slot型template） | §6.2の契約 |
| `dslParameters` | object | 必須 | キーはtemplateの公開スロットIDのみ。値は§6.3の全階層closed schema検証の後、既存DSL検証へ渡す |
| `title` | string | 必須 | §6.4の文字列規則。1〜60文字 |
| `description` | string | 必須 | §6.4の文字列規則。1〜300文字 |

**貼付JSONに含めてはならないもの（含まれていたら未知キーとして拒否）**: `providerKind`・`provenance`・`revision`・datasetの`elementId`。これらは決定性と表示の信頼性を守るため**アプリ側が取込時に付与**する（§6.5）。

### 6.2 dataset契約（Employee系template）

- 要素はEmployeeの業務フィールドのみを持つobjectとする（closed schema・未知キー拒否）: `name`(string)・`age`(int)・`salary`(long)・`evaluation`(double)・`region`(string)・`hireDate`(string)・`department`(object: `name`・`division`の2 stringのみ)・`skills`(string配列)。
- 値域（**確定値**）:
  - 件数: 0〜8件（基準fixtureは4件。snapshot予算500の事前実行検証は従来どおり併用する）
  - `name`・`region`・`department.name`・`department.division`: §6.4の文字列規則。各1〜30文字
  - `skills`: 0〜5件。各要素は§6.4の文字列規則で1〜20文字。**配列内の重複禁止**
  - `age`: 15〜80の整数、`salary`: 0〜99,999,999の整数、`evaluation`: 0.0〜5.0（NaN / Infinity禁止。**負のゼロは`Object.is(value, -0)`で拒否する**——JavaScriptでは`-0 >= 0`がtrueのため範囲条件だけでは通過する。根拠は§6.4のdouble要素と同じ）
  - `hireDate`: `YYYY-MM-DD`の厳密形式（正規表現`^\d{4}-\d{2}-\d{2}$`）かつ**実在日**（月の日数・うるう年を検証）。範囲は1970-01-01〜2100-12-31
  - 数値はDSL既存規則（int32範囲・safe integer範囲）に準拠
- モードとの整合（空ソースは0件、途中0件・標準は1件以上）は既存の教材制約検証が担うため、dataset契約では件数範囲のみを検証する。

### 6.3 dslParametersの全階層closed schema検証（新設）

- 既存のDSL構造検証は、Terminal DSL / Collector ASTが未知キーを拒否する一方、**Predicate / Mapper / Source等は未知キーを拒否しない実装が存在する**（例: Source DSL検証は既知の制約のみ検査し、余分なキーの有無を検査しない）。
- そのため取込経路では、`dslParameters`配下の**全schema nodeに対するclosed schema検証**（許可キー集合外の拒否・型検査）を、既存検証へ委譲する**前**にImport Contract（§5.2）に基づいて行う。許可キー集合は**schema nodeごとに、`kind`・`type`・親フィールドの文脈のいずれかで決定する**。DSL配下には`kind`を持たないobjectが正規に存在する（Predicateのliteral `{ type, value }`、iterateの`operator` / `predicate`、Comparatorのkey `{ field, direction }`、reduction identity、joiningのStringConst等）ため、「kind別」だけでは全形状を表現できない。**未知kind・未知type・親フィールド文脈に合わない形状は、未知キーと同様に拒否する。**
- **変数識別子契約**: Javaコード表示に**変数識別子**としてそのまま埋め込まれるDSL値（`arrayId`・`listId`等）は、エスケープでは対処できないため（§7.3）、Import Contractでパターンを`^[a-z][A-Za-z0-9]{0,19}$`に制限し、Java予約語・リテラル（`int`・`class`・`true`等）を拒否する。
- **Java型名契約**（変数識別子契約とは別契約とする。型名は大文字開始のため同一パターンを適用できない）: Javaコード表示に**型名**として埋め込まれるDSL値は、パターンではなく**ホワイトリスト固定**で検証する。
  - `empty`ソースの`streamType` / `elementTypeName`は次の組のみ許可する: `object`→`String`、`int`→`int`、`long`→`long`、`double`→`double`（既存fixtureの組と同一。現行DSL上は任意stringだが、取込前段で固定表により拒否する）。
  - `arrayObject`・`streamOf`の`elementTypeName`は既存検証が`'String'`固定を強制しており（変更なし）、Contractも同値のみ許可する。
  - `ArrayGeneratorDsl.elementTypeName`は既存の`String | Employee | Object`ホワイトリスト（closed schema検証済み）をそのまま使用する。
- 既存の`instantiateTemplate`（構造検証 → slot許可 → DSLホワイトリスト → 型検証 → 有限性 → 教材制約 → 500 snapshot事前実行）は**無変更**で、この前段検証の後にそのまま適用する。fixture経路は前段検証を通らず、挙動は完全に不変である。

### 6.4 サイズ・文字列規則（確定値）

- 貼付テキスト全体: **65,536 UTF-16 code unit以内**（JavaScriptの`string.length`で判定）。超過時はparse前に拒否する。
- 文字列長はすべて**UTF-16 code unit数**で数える（code point・graphemeは用いない。サロゲートペアを含む文字は2と数える）。
- `title`・`description`は**検証前にtrimし、trim後の値を採用・保存する**。trim後に最小長を満たすこと（**空白のみは拒否**）。
- **dataset内の文字列field**（`name`・`region`・`department.name`・`department.division`・`skills`各要素）も空白のみを拒否する（trim後1文字以上。値自体はtrimせず原文を保存する）。
- すべての文字列fieldで次を拒否する: **制御文字**（U+0000〜U+001F・U+007F）、**双方向制御文字**（U+061C・U+200E・U+200F・U+202A〜U+202E・U+2066〜U+2069）。
- **dslParameters内の自由文字列・配列の上限（確定値。Import Contractに定義する）**:
  - 一般DSL文字列1件（`streamOf`のvalues各要素、joiningのdelimiter / prefix / suffix、string identity等）: **0〜20 UTF-16 code unit**（空文字はdelimiter等で意味を持つため許可。空白のみも許可）
  - source文字列配列（`streamOf`・`arrayObject`のvalues）およびsource数値配列（`arrayPrimitive`のvalues）: **0〜8件**（datasetの件数上限と同値）
  - nested string list: 外側**0〜4件**・内側**0〜5件**
  - `streamOfPrimitiveArrays`の`arrays`: 外側**0〜4件**・内側**0〜5件**（nested string listと同値）
  - `employeeKeys`の`keys`: **1〜3件**、**同一fieldの重複禁止**（現行検証は下限1件のみのため、上限・重複はContractが検証する）
- **dslParameters内の数値要素の値域（確定値。Import Contractに定義する）**: 現行の数値配列検証は「有限であること（整数型はさらに整数であること）」しか確認せず、Java int範囲外・safe integer範囲外・指数表記化する値が既存構造検証を通過してJavaコード生成へ渡り得る。そこで取込前段で次を検証する。適用対象は`arrayPrimitive.values`・`streamOfPrimitiveArrays.arrays`の各要素、および同じprimitive型を受けるすべてのDSL数値値とする。
  - `int`要素: **Java int32範囲**（-2,147,483,648〜2,147,483,647）の整数
  - `long`要素: **`Number.isSafeInteger`を満たす範囲**の整数
  - `double`要素: **有限、かつ0（正のゼロのみ）または絶対値が1e-6以上1e15以下**（JavaScriptの`String()`が指数表記へ切り替わらず、決定的な10進表記が得られる範囲。§7.3の数値リテラル契約の前提）。**負のゼロは取込前段で拒否する**（`Object.is(value, -0)`で判定。`JSON.parse("-0")`は-0を生成するが、現行のJavaコード表示は-0を`0.0`と表示し、Simulation Coreのdistinct等価判定・自然順比較も-0.0と0.0を区別しない「教材データは-0.0を含まない」前提のため、受理すると生成コード・実行結果がJavaと乖離する）
- 上限・規則違反はすべて構造化された検証エラー（§7.2）として報告する。

### 6.5 アプリ側が付与する項目

- `providerKind` = `IMPORTED`。
- `provenance` = { providerKind: 'IMPORTED', generatedAt: 取込時刻, dslVersion: DSL_VERSION }。`generatedAt`は**UTCのISO 8601形式（`YYYY-MM-DDTHH:mm:ss.sssZ`）**とする。fixtureの固定値規則はfixtureの決定性維持のためであり、取込候補には適用しない（同一revision内の再現性はsnapshot履歴が保証する）。
- `revision`は既存規則（§10.2: 現在のrevisionと異なる新しい値を発行）に従いアプリが発行する。セッション内で単調増加する連番を含み、fixture系revisionと衝突しない決定的形式とする（最終形式はPhase 6実装指示書で確定）。
- datasetの`elementId`はアプリが`imp-001`, `imp-002`…の形式で**出現順に再付番**する。`DatasetElement.elementId`は画面内部用の安定IDでありJava教材コードの業務フィールドと分離済み（v0.8 §6.1）のため、貼付側に付番させる必要がない。

## 7. 安全性（v0.8 §19の改訂と追補）

### 7.1 §19安全性行の改訂

§19の安全性行「任意コード実行なし。DSLホワイトリスト。AIキーはサーバーのみ」を「**任意コード実行なし。DSLホワイトリスト。貼付JSONはデータとしてのみ扱い、秘密情報を保持しない**」へ改訂する。APIキーという保護対象自体が存在しなくなる。

### 7.2 貼付テキストの取り扱い

貼付テキストはuntrusted入力として次の順で処理する。途中で失敗した場合、それ以降の手順は実行しない。

1. サイズ上限検証（§6.4）。
2. 前処理: 先頭・末尾の空白を除去する。その後、**先頭行が「` ``` `」+任意の英字ラベル（`json`等。大小文字不問）のみ、かつ最終行が「` ``` `」のみ**である場合に限り、その2行を除去する（フェンスは1組のみ許容）。フェンスの外側に説明文などの他のテキストが残る応答・フェンスが片側だけの応答は、この前処理では救済せず次手順の構文エラーに委ねる。
3. `JSON.parse`。失敗時は構文エラーとして報告する。**`eval`・`Function`等は使用しない**（§3.2の禁止事項は貼付経路にも適用）。同名キーが重複するJSONは`JSON.parse`の後勝ち挙動により決定的に解決されるため、**重複キーの独自検出は行わない**（独自パーサを導入しないことを優先する。後勝ちで採用された値は以降の検証を通常どおり通過する必要がある）。
4. candidate schema検証（§6.1〜§6.4。closed schema・選択中template / mode / versionとの一致・全階層closed schema）。
5. ScenarioCandidateの組み立て（§6.5の付与）。
6. 既存の検証パイプライン: `instantiateTemplate`の手順1〜7を**無変更で**通す。§9.3「不成立の候補はStep Engineへ渡さない」「返却のコード文字列は表示にも評価にも使用せず、表示用Javaコードは必ずDSLから再生成する」は取込候補にそのまま適用する。
- 手順1〜4の検証エラーは既存`ValidationIssue`（code・message・path）の形式で報告する。追加する`ValidationCode`の候補名は`IMPORT_SIZE_LIMIT` / `IMPORT_PARSE` / `IMPORT_SCHEMA` / `IMPORT_CONTEXT_MISMATCH`とする（最終確定はPhase 6実装指示書。既存codeとの衝突なきこと）。
- `title` / `description`は表示時にReactの標準テキストレンダリングで扱い、HTMLとして解釈しない（`dangerouslySetInnerHTML`等の不使用）。

### 7.3 Javaコード表示のリテラル契約（新設。文字列・数値の両リテラルを包含する）

現行のJavaコード生成は、fixture値が安全な文字だけを含む前提で文字列を**未エスケープ**でJavaリテラルへ埋め込み、Department変数名を既知の部署名（「開発部」→`development`・「営業部」→`sales`、それ以外は`null`）に固定している。取込candidateの値をそのまま埋め込むと、引用符・バックスラッシュを含む正規の文字列や任意の部署名が、**構文不正または実データと異なるJavaコード**を生成する。そこで次を契約とする。

1. **エスケープの必須化**: 外部入力由来の文字列（dataset内の全string field、`dslParameters`内のstring値〔`streamOf`のvalues・joiningのdelimiter等〕）をJavaコード表示の文字列リテラルへ埋め込む際は、**Java文字列リテラルのエスケープ**（`\"`・`\\`を最低限含む。制御文字は§6.4で拒否済み）を必ず適用する。fixture値へ同じエスケープを適用しても出力は不変であるため、実装はエスケープを共通経路に置いてよい。
2. **Department変数名の一般化**: 部署の同一性は`name`+`division`の組で判定し、取込datasetの部署には**出現順に決定的なJava変数名**（例: `dept1`, `dept2`…。最終命名規則はPhase 6実装指示書で確定）を割り当てる。既存fixtureの対応（開発部→`development`・営業部→`sales`）は不変とする。部署の**表示名とJava変数名を分離**し、変数名衝突・`null`化を起こさない。
3. **識別子の制限**: Javaコードへ識別子として埋め込まれるDSL値（`arrayId`・`listId`等）はエスケープで守れないため、§6.3のパターン制限で取込前段が拒否する。
4. **数値リテラル契約**: Javaコード表示の数値リテラル変換（long桁区切り・doubleの`.0`付与等）は、**§6.2・§6.4で受理される外部入力由来のすべての数値**（datasetの`age` / `salary` / `evaluation`と、dslParameters内の数値要素の双方）を**正当なJavaリテラルへ決定的に変換する**契約とする。現行の変換は指数表記化する値（例: `1e21`）や負のゼロで不正・不一致なリテラルを生成し得るが、当該値は§6.2・§6.4のContract検証が拒否するため、変換規則の拡張は要しない。値域とformatterのどちらを先に直すかではなく、**「Contractが受理する値 ⊆ formatterが正当に変換できる値」の包含関係を維持する**ことを契約とする（P6テストで境界値を検証する。§9）。
5. 上記1〜2・4は表示生成の契約であり、DSL評価・Step Engineの挙動には影響しない。

### 7.4 エラー経路の設計変更

現行実装では候補検証の失敗を例外（throw）へ変換しており、UIへのエラー表示経路がない（fixtureは事前検証済みで失敗が異常系のため）。取込候補は**検証失敗が正常系**であるため、Phase 6で取込経路の検証結果を`Result`（ok / issues）としてUIへ返す経路を設ける。既存fixture経路の挙動（検証済みfixtureの失敗は異常系）は変更しない。

## 8. UI仕様（v0.8 §17.1・§18の変更）

- §17.1「操作選択・シナリオ」行の「固定またはAIサンプル」は「固定または**取込**サンプル」へ置換する。
- §18の操作一覧の「AIで別サンプル」行を削除し、次の2操作を追加する。

| 操作 | 仕様 |
|---|---|
| プロンプトをコピー | 選択中の操作・モード・templateに対する生成依頼文（§5.2）をクリップボードへコピーする。コピー成否をフィードバック表示する。シナリオ・履歴・再生状態は変更しない。実行不能templateの選択中は無効化し理由を表示する（§5.1） |
| 候補を貼り付け | 貼付テキストを§7.2の順で検証する。合格時はシナリオ切替（タイマー停止、新revision、history初期化）として取込サンプルを表示する。不合格時は現在のシナリオを維持し、理由（code・対象・message）を貼付欄の近傍に表示する。実行不能templateの選択中は無効化し理由を表示する |

- 取込UIは常設の折りたたみ領域（既存`DetailsDisclosure`の`<details>`流儀）またはパネルとし、モーダルダイアログは使用しない（既存実装にモーダルはなく、新設しない。具体形式は§10で判断）。
- 検証失敗理由の表示は`aria-live`で通知し、状態は色以外（記号・文言）でも識別できるようにする（v0.8 §17.5の既存原則）。
- provenanceバッジは`FIXTURE`=「固定サンプル」、`IMPORTED`=「取込サンプル」を表示する（§4.1）。
- 貼付テキスト・取込パネルの開閉状態はUI一時状態（v0.8 §18末尾）であり、snapshot履歴の復元対象にしない。取込が成立した候補データ自体はScenario / snapshotの一部として通常どおり復元対象になる。
- 自動再生中に取込が成立した場合はシナリオ切替の既存規則に従いタイマーを停止する。

## 9. Phase 6実装契約の概要（v0.8 §20のPhase 6行の書き換え）

§20のPhase 6行を次のとおり書き換える。

| Phase | 実装内容 | 完了条件 |
|---|---|---|
| 6 | 手動連携（Import Contract、Prompt Generator、Candidate Import、取込UI、`Result`によるエラー表示経路、Javaコード表示のリテラル契約）、provider種別`IMPORTED`、全シナリオ種別の総点検、レスポンシブ最終調整、総合試験 | 手動連携で取り込んだ候補がtemplate / DSL制約内で検証・実行され、Javaコード表示が構文的に正当で実データと一致し、取込失敗時は理由が表示され現在のシナリオが維持されること。完成要件として成立 |

- サーバーAPI・AI adapter・RemoteScenarioProvider・AI capabilityは実装対象から**削除**する。
- 必須テストIDは`P6-*`（P6-D / A / R / E。Oracleへの追加が必要な場合はP6-O）とし、必須ID表・件数はPhase 6実装指示書で確定する。少なくとも次の観点を含める:
  - 貼付JSONの受理（正常系。Employee系・source slot型の双方）
  - closed schema拒否: トップレベル未知キー、`providerKind` / `provenance` / `revision` / `elementId`の持込み、dataset未知キー、**dslParameters内の未知kind・未知type・親フィールド文脈不一致・未知キー**、識別子パターン違反、context不一致（templateId / mode / version / dslVersion）、サイズ超過、文字列規則違反（制御文字・双方向制御文字・空白のみ・長さ・DSL文字列/配列上限〔`streamOfPrimitiveArrays`の外側/内側件数・`employeeKeys`の件数/field重複を含む〕）
  - **数値値域**（§6.2・§6.4）: int32境界（±2,147,483,647 / -2,147,483,648の受理と1超過の拒否）、long safe integer境界、doubleの1e-6 / 1e15境界と**0（正のゼロ）の受理・-0の拒否**（`Object.is`判定。`arrayPrimitive`・`streamOfPrimitiveArrays`の双方、および**Employee datasetの`evaluation: -0`の拒否**）、範囲外・非有限値の拒否、**受理された全境界値のJavaコード表示が正当なリテラルになり指数表記が現れない**こと
  - **Java型名契約**: `empty`ソースの`streamType` / `elementTypeName`の許可された組の受理、固定表にない組・任意型名・Java構文を壊す値の拒否
  - **Import Contract同期保証**（§5.2）: 互換性テスト（全実行可能templateの既存fixtureのdslParametersがContract検証で受理される）、整合テスト（Contract受理後に既存構造検証だけが失敗する代表形状がないこと）
  - 既存検証パイプラインへの委譲: DSLホワイトリスト違反・教材制約違反・snapshot予算超過が取込経路でも拒否されること
  - **Javaコード表示**: 引用符・バックスラッシュを含む文字列のエスケープ、任意部署名の変数割当（同名部署でdivisionが異なる場合を含む）、生成コードが実データと一致すること
  - elementId再付番・revision発行の決定性、取込成立時のシナリオ切替意味論、失敗時の現行シナリオ維持、コピー機能のフォールバック、実行不能templateでの無効化
- 既存回帰テストの意図的更新（§1.3の表）とPhase 5持越しのbundle分割検討（production 504kB警告への対応。実施可否の判断を含む）はPhase 6完了報告へ記録する。

## 10. Phase 6中に判断する事項

1. 取込UIの具体形式（常設パネルか`<details>`折りたたみか）と、React側の状態管理方式（現行UIは`useState`未使用のため新設になる）。
2. プロンプト文面の詳細（文体・例示するJSONの数・言語）。プロンプトは教材制約を満たしやすい表現へ実測ベースで調整してよい（検証パイプラインが正しさを保証するため、プロンプトの調整は仕様変更に当たらない）。
3. `ValidationCode`追加名（§7.2の候補名）の最終確定と既存codeとの衝突確認。
4. Import Contractの実装上の配置（既存template slot定義との統合方法。§5.2の単一定義源の原則を満たす限り実装判断とする）。
5. 取込部署のJava変数名の命名規則（§7.3の2。決定性と衝突回避を満たす限り実装判断とする）。
6. revisionの最終形式（§6.5。既存と衝突しない決定的形式であること）。
7. 取込候補の保存・再利用（localStorage等）は本Phaseの対象外とする（将来拡張。保存しないことを明記する）。
