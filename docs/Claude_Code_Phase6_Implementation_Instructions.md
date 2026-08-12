# ローカルClaude Code向け Phase 6実装指示

以下を、そのまま対象リポジトリのプロジェクトルートで起動したClaude Codeへ渡してください。

---

# Java Stream API 可視化シミュレーター Phase 6実装指示

## 1. 実装開始の宣言

Draft v0.8に基づくPhase 1〜5は、GitHubの`main`へマージ済みです。Phase 6の仕様は`docs/Java_Stream_API_Visualization_Spec_v0.10_Phase6_ManualLink.md`（第6版。codexレビュー6回・承認済み）で、AI API接続を廃止した**手動連携方式**へ確定済みです。

**本指示をもってPhase 6の実装開始を明示的に許可します。**

Phase 6の実装、テスト、画面確認、JDK 25 Oracle照合、総合試験、証跡作成、完了報告まで行ってください。Phase 7（Gatherers）は実装しないでください。

## 2. 唯一の仕様基準と優先順位

実装判断の優先順位は次のとおりです。

1. `docs/Java_Stream_API_Visualization_Spec_v0.10_Phase6_ManualLink.md`（以下「v0.10」。**手動連携固有規定の最上位基準**）
2. `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`（v0.10 §1.1の優先順位と§1.2の全対応表〔置換 / 読み替え / 歴史的 / 不変〕を適用した上で、一般原則・不変条件・検証順序・UI原則の正）
3. 本Phase 6実装指示（上記2つを実装可能な粒度へ具体化する。v0.10が「Phase 6実装指示書で確定する」と委譲した事項は本指示§7の確定値を正とする）
4. `docs/Java_Stream_API_Visualization_Spec_v0.9_Gatherers.md`（Phase 7範囲。Phase 6にはv0.10 §1.3の読み替え3点のみ関与する。gather DSLは未実装のため取込対象外）
5. `docs/phase-5-decisions.md` / `docs/phase-5-completion-report.md`
6. 現在の`main`上の実装・テスト・README

v0.10と本指示が矛盾する場合はv0.10を正とし、コードを変更する前に矛盾箇所を報告して停止してください。v0.8のAI関連記述でv0.10 §1.2の対応表に現れないものを実装中に発見した場合は、コードを暗黙の正とせず、扱いを勝手に決めずに停止して報告してください（v0.10 §1.1。仕様書への追記はユーザーの承認事項です）。

v0.8・v0.9・v0.10の各仕様書は編集しないでください。`docs/Java_Stream_API_Visualization_Spec_v0.10.docx`は3文書の統合ビルド（`tools/build_spec_docx.py`）による閲覧用であり、正は各原本です。統合docxも編集しないでください。本指示で定義する`P6-*`はPhase 6の追跡用テストIDであり、仕様書本文へテストIDを追記するものではありません。

## 3. Gitと作業開始前の確認

### 3.1 基準コミット

- Phase 5完了・v0.9 / v0.10仕様書・統合docxをすべて含む`main`: `ad7f37c0b9403bf29633ec9348a17a64c1033a22`
- 本指示書作成時点で、`phase-6`・`origin/phase-6`・`main`・`origin/main`はすべて上記コミットで一致しています。

### 3.2 作業ブランチ

Phase 6の作業ブランチ`phase-6`は既に存在します。作業前に次を確認してください。

```bash
git fetch origin
git switch phase-6
git merge-base --is-ancestor ad7f37c0b9403bf29633ec9348a17a64c1033a22 HEAD
git status --short
```

- `phase-6`のHEADが基準コミットの子孫（または一致）であること。
- worktreeがcleanであること。ただし次の2つは運用ファイルであり、未コミット・未追跡のまま存在してよい（停止条件に該当しない）: 本指示書ファイル自身、およびcodexレビュー依頼文（`docs/codex_review_request_P6_Implementation_Instructions.md`。前例によりコミットしない作業ファイル）。
- `docs/Java_Stream_API_Visualization_Spec_v0.10_Phase6_ManualLink.md`が存在すること。

未追跡・未コミットのユーザー変更がある場合は、stash、削除、上書きをせず停止して報告してください。**本指示だけを根拠にcommit、push、Pull Request作成、mainへのmergeは行わないでください。**

### 3.3 Phase 1〜5回帰基準

変更前に少なくとも次を実行し、基準結果を記録してください。

```bash
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

実行可能な環境では、変更前の`npm run test:e2e`と`npm run test:oracle`も実行してください。ただし、**この2つを現状コードのまま作業worktreeで実行してはいけません**。追跡済みのPhase 5証跡を書き換えるためです（`e2e/capture-helper.ts`の`CAPTURE_TARGET_PHASE = 5`が`artifacts/phase-5/*.png`を上書きし、`oracle/oracle-lib.mjs`のP5-O01 suiteの`writeReportPath`と実行日時埋め込みが`artifacts/phase-5/oracle-result.md`を確実に更新する）。これは§6.2・§14・§18の「Phase 1〜5証跡は一切変更しない」と衝突します。

Phase 5の前例（`docs/phase-5-decisions.md` §21）に従い、**基準コミットの一時git worktreeをプロジェクトディレクトリの外へ作成し、そこで変更前のE2E・Oracle基準を取得**してください。

```bash
git worktree add <プロジェクト外の一時パス> ad7f37c0b9403bf29633ec9348a17a64c1033a22
# 一時worktree内で npm ci を実行し、変更前の test:e2e / test:oracle の結果を記録する
git worktree remove --force <プロジェクト外の一時パス>
```

作業worktreeの`artifacts/phase-5`には一切書き込まないでください。また、作業worktreeで`npm run test:e2e` / `npm run test:oracle`を初めて実行する前に、必ず`CAPTURE_TARGET_PHASE = 6`への変更（§14）とOracle書込み先の変更（§12.5: P6-O01追加・P5-O01の`writeReportPath` null化）を先に済ませてください。

Phase 5完了時点の基準値は、Vitest 392件（44ファイル）、Playwright 63件、Oracle 5 suite（P1-O01 / P2-O01 / P3-O01 / P4-O01 / P5-O01。P4-O02 / P5-O02判定を含む）全成功です。変更前から失敗がある場合はPhase 6実装で隠さず、原因と再現手順を報告して停止してください。

`npm run build`はproduction bundleが約504kBでViteのchunk size警告を出します（Phase 5完了報告の既知事項。動作影響なし）。これは失敗ではありません。§10.3で扱います。

## 4. Phase 6の目的と完了範囲

v0.10 §9（v0.8 §20のPhase 6行の書き換え）に従い、Phase 1〜5で成立した次の経路を壊さず完成させます。

```text
FixtureScenarioProvider
  → PipelineTemplate / TemplateInstance
  → 検証済みDSL / TypeRef
  → PipelineDefinition
  → Step Engine / Snapshot History
  → React UI
```

Phase 6の目的は次の4点です。

1. **手動連携**（Prompt Generator + Candidate Import + Import Contract + 取込UI）を実装し、ユーザーが任意のAIチャット（または手書き）で作った候補JSONを、検証パイプラインを通して「取込サンプル」として実行できるようにする（v0.10 §3〜§8）。
2. `AI_CAPABILITY`定数とdisabled AIボタンを廃止し、provider種別を`FIXTURE | IMPORTED`へ変更する（v0.10 §3.2・§4.1）。サーバーAPI・AI adapter・RemoteScenarioProviderは実装せず、純フロントエンド構成を維持する。
3. **Javaコード表示のリテラル契約**（エスケープ必須化・部署変数名の一般化・数値リテラル契約）を実装し、外部入力由来の値でも構文的に正当で実データと一致するJavaコード表示を保証する(v0.10 §7.3）。
4. 全シナリオ種別の総点検、レスポンシブ最終調整、総合試験を実施し、完成要件として成立させる（v0.10 §9）。

Phase 6の完了条件は、v0.10 §9の「手動連携で取り込んだ候補がtemplate / DSL制約内で検証・実行され、Javaコード表示が構文的に正当で実データと一致し、取込失敗時は理由が表示され現在のシナリオが維持されること。完成要件として成立」を、Application、React、E2E、JDK 25 Oracle Testで実証することです。

## 5. Phase 6で実装するもの

### 5.1 廃止（コード削除）

- `AI_CAPABILITY`定数（`src/providers/scenarioProvider.ts`）と、`AppInstance.aiCapability`の公開（`src/ui/appInstance.ts`）、それを表示するdisabled AIボタンとdisabled理由表示（`src/ui/components/ScenarioControls.tsx`）。
- `ScenarioCandidate.providerKind`（`src/providers/scenarioProvider.ts`）と`ScenarioProvenance.providerKind`（`src/domain/scenario/scenario.ts`）の型を`'FIXTURE' | 'AI'`から`'FIXTURE' | 'IMPORTED'`へ変更する。
- 削除後、`src`・`tests`・`e2e`から`AI_CAPABILITY` / `aiCapability`の参照が消えていることをgrepで確認する（テスト側の扱いは§12冒頭の許可範囲に限る）。`UNIMPLEMENTED_OPERATIONS`のdocコメント（`src/ui/appInstance.ts`）等、「AI capability表示で扱う」と述べる古いコメントも現状に合わせて修正する。

サーバーAPI・AiScenarioAdapter・RemoteScenarioProviderは未実装のため、削除対象は上記のみです（v0.10 §1.3）。

### 5.2 新設（Application層。v0.10 §3.1）

| モジュール | 責務 | 実装位置の提案 |
|---|---|---|
| Import Contract | スロットごとの許可DSLの機械可読定義（許可kind、schema nodeごとの許可キー集合、許可field / operator、値の型・値域、§7.5の上限）。プロンプト生成と取込前段検証の**単一定義源** | `src/application/importContract.ts`（配置は実装判断。単一定義源の原則を満たす限り変更可。判断を`docs/phase-6-decisions.md`へ記録） |
| Prompt Generator | 選択中の操作・モード・templateに対する生成依頼文の組み立て（§8）、クリップボードへのコピー | `src/application/promptGenerator.ts` |
| Candidate Import | 貼付テキストの受付、前段検証（§7.2手順1〜4）、ScenarioCandidateの組み立て（§7.6の付与）、既存検証パイプラインへの委譲、検証結果の`Result`報告 | `src/application/candidateImport.ts` |

- 3モジュールはApplication層に置き、Simulation Coreへ依存しても依存されないこと（v0.8 §5.1の依存方向）。
- Candidate Importは`ScenarioProvider`を**実装しない**独立サービスとする（v0.10 §3.2）。`ScenarioProvider` interface・`GenerateRequest`・`FixtureScenarioProvider`はfixture用契約として無変更で存続させる。
- 取込経路の最終検証は既存`buildScenario`（`src/application/scenarioFactory.ts`。`Result<Scenario>`を返す）をそのまま再利用する。`appInstance.makeScenario`のthrow経路（`src/ui/appInstance.ts`）はfixture用として不変とし、取込経路はthrowを経由せず`Result`をUIへ返す（v0.10 §7.4）。

### 5.3 取込UI（v0.10 §8）

「プロンプトをコピー」「候補を貼り付け」の2操作、検証失敗理由の表示、provenanceバッジ（固定サンプル / 取込サンプル）。詳細は§9。

### 5.4 Javaコード表示のリテラル契約（v0.10 §7.3）

`src/domain/dsl/javaCode.ts`の改修。詳細は§7.7。

### 5.5 総点検・最終調整・総合試験

全シナリオ種別の総点検、レスポンシブ最終調整、bundle分割検討。詳細は§10。

## 6. 重要な境界

### 6.1 fixture経路は完全不変

- `instantiateTemplate`の7手順（構造検証 → template / slot許可範囲 → DSLホワイトリスト → TypeRef型検証 → 教材制約 → 事前実行と500 snapshot予算 → PipelineDefinition生成。`src/domain/template/instantiate.ts`）は**無変更**とする。取込前段検証（§7.2手順1〜4）はこの**前**に置き、fixture経路には挿入しない（v0.10 §6.3）。
- `FixtureScenarioProvider`の実装・挙動・revision形式（`${templateId}:${mode}:r${counter}`）は不変。
- 検証済みfixtureの検証失敗は従来どおり異常系（throw）のまま変更しない（v0.10 §7.4）。

### 6.2 完了済みPhase 1〜5の保護（v0.10 §1.3の2層分離）

1. **歴史的証跡（不変）**: `docs/phase-1〜5-completion-report.md`、`docs/phase-1〜5-decisions.md`、`artifacts/phase-1`〜`phase-5`は一切変更しない。
2. **現行回帰テストスイート（意図的更新）**: AIボタン・AI capabilityを検証対象とする現行テストの更新は、§12冒頭の表に列挙した箇所**だけ**を許可する。それ以外の既存P1〜P5テストIDの削除・緩和・skipをしない。更新は理由つきで完了報告へ記録する。

### 6.3 Phase 7（Gatherers）を先行実装しない

v0.9はPhase 7の仕様であり、Phase 6では実装しない。gather DSLは未実装のため取込対象外である（v0.10 §1.3。「取込候補へgather DSLを開放するか」の判断はPhase 7中）。

## 7. 取込検証仕様と確定値

v0.10 §6・§7の規定をすべて実装してください。本節はv0.10が本指示へ委譲した事項の**確定値**と、実装上の割付を定めます。値・規則そのものの根拠はv0.10を正とします。

### 7.1 ValidationCode（確定）

`src/domain/types/result.ts`の`ValidationCode`へ次の4つを追加します（v0.10 §7.2の候補名をそのまま確定。既存17 code〔`STRUCTURE_UNKNOWN_KIND`〜`COLLECTOR_DEPTH`〕と衝突しないことを確認済み）。

| ValidationCode | 発行箇所（§7.2の手順） | 対象 |
|---|---|---|
| `IMPORT_SIZE_LIMIT` | 手順1 | 貼付テキスト全体の65,536 UTF-16 code unit超過（parse前に拒否） |
| `IMPORT_PARSE` | 手順3 | `JSON.parse`失敗（前処理で救済されないコードフェンス・フェンス外テキストを含む） |
| `IMPORT_SCHEMA` | 手順4 | closed schema違反（トップレベル・dataset・dslParameters全階層）、予約キー（`providerKind`・`provenance`・`revision`・`elementId`）の持込み、Contractの許可kind・field・operator等のホワイトリスト違反、型不一致、値域・文字列規則・上限違反、変数識別子契約・Java型名契約違反 |
| `IMPORT_CONTEXT_MISMATCH` | 手順4 | 選択中との不一致（`templateId` / `templateVersion` / `mode` / `dslVersion`）。`templateVersion`の非整数・1未満もここに含める |

- 検証エラーは既存`ValidationIssue`（code・message・path）形式で報告する。`path`はJSONパス風の表記（例: `dataset[2].salary`、`dslParameters.<slotId>.values[0]`）とし、ユーザーがAIチャットへの修正依頼にそのまま使える具体性（対象スロット・code・message）を持たせる（v0.10 §5.3）。
- 手順6（既存検証パイプライン）で発生するissueは既存codeのまま使用し、`IMPORT_*`へ付け替えない。

### 7.2 検証手順（v0.10 §7.2の6手順の実装割付）

貼付テキストはuntrusted入力として次の順で処理し、途中で失敗した場合それ以降の手順は実行しません。

1. サイズ上限検証（`string.length`で判定）→ `IMPORT_SIZE_LIMIT`
2. 前処理: 先頭・末尾の空白除去。その後、先頭行が「```」+任意の英字ラベル（大小文字不問）のみ、かつ最終行が「```」のみの場合に限り、その2行を除去する（1組のみ。片側だけ・フェンス外に他テキストが残る応答は救済しない）
3. `JSON.parse` → 失敗は`IMPORT_PARSE`。`eval`・`Function`等は使用しない。重複キーは`JSON.parse`の後勝ち挙動に委ね、独自検出しない（後勝ちで採用された値が以降の検証を通常どおり通過すること）
4. candidate schema検証（v0.10 §6.1〜§6.4の全規則）→ `IMPORT_SCHEMA` / `IMPORT_CONTEXT_MISMATCH`
5. ScenarioCandidateの組み立て（§7.6の付与）
6. 既存の検証パイプライン: `buildScenario`経由で`instantiateTemplate`の手順1〜7を**無変更**で通す。不成立の候補はStep Engineへ渡さない

- `title` / `description`は検証前にtrimし、trim後の値を採用・保存する。表示はReactの標準テキストレンダリングのみ（`dangerouslySetInnerHTML`不使用）。
- 手順4の検証項目の完全な列挙はv0.10 §6.1（トップレベルclosed schema）、§6.2（dataset契約）、§6.3（dslParameters全階層closed schema・変数識別子契約・Java型名契約）、§6.4（サイズ・文字列規則・DSL上限・数値値域。負のゼロの`Object.is(value, -0)`拒否を`evaluation`とDSL double要素の双方へ適用）を正とします。

### 7.3 Import Contract（v0.10 §5.2）

- 既存のtemplate slot定義（`src/domain/template/pipelineTemplate.ts`の`ParameterSlot` 11種: `predicate` / `mapper` / `source` / `comparator` / `consumer` / `count` / `reduction` / `identity` / `arrayGenerator` / `collector` / `collectTriple`と、各slotの`allowed*`宣言）から構成できる部分は再利用し、不足分（schema nodeごとの許可キー集合・値域・§7.5の上限）をContractへ定義する。
- 許可キー集合は**schema nodeごとに`kind`・`type`・親フィールドの文脈のいずれかで決定**する。`kind`を持たない正規のobject（Predicateのliteral `{ type, value }`、iterateの`operator` / `predicate`、Comparatorのkey `{ field, direction }`、reduction identity、joiningのStringConst等）は親フィールド文脈で判定し、未知kind・未知type・文脈に合わない形状は未知キーと同様に拒否する。
- 対象となるDSL形状の正は既存AST定義（`src/domain/dsl/sourceAst.ts`・`mapperAst.ts`・`comparatorAst.ts`・`consumerAst.ts`・`terminalAst.ts`・`collectorAst.ts`・`ast.ts`）です。Contractが既存検証（`validate*.ts`）の受理範囲と**同等または厳しい**ことを、次の2テストで保証する（§12: P6-D02 / P6-D03）。
  1. **互換性テスト**: 全実行可能templateの既存fixtureの`dslParameters`をContract検証へ通した場合に、すべて受理されること。
  2. **整合テスト**: Contract受理後に既存構造検証だけが失敗する形状が代表ケースで存在しないこと（発見された場合はContractを厳格化して解消する）。
- 教材制約（`instantiateTemplate`内のmode別手続き検証）の正は従来どおり手続き検証とする。プロンプトに含める教材制約の説明は補助的な自然文であり、二重定義禁止の対象外（v0.10 §5.2）。
- Contractと既存DSL検証が食い違う場合は既存DSL検証が最終判定（v0.10 §5.2）。

### 7.4 取込対象template（v0.10 §5.1）

- 全templateを取込対象とする。ただし`executable: false`の実行不能template（`tmpl-src-generate`・`tmpl-src-iterate2`）は取込対象外とし、選択中は「プロンプトをコピー」「候補を貼り付け」の両方を無効化して理由を表示する。
- `dataset`はEmployee系template（`collection` source、`employees`データセットを使うもの）で必須、source slot型template（`arrayPrimitive`・`streamOf`・`range`等、datasetを使わないもの）で**禁止**（含まれていたら未知キーとして拒否）。必須 / 禁止の判定はtemplate定義（`sourceDefinition`とslot構成）から導出し、Contractに定義する。
- 取込候補のバリエーションは、Employee系では`dataset`＋公開スロット値、source slot型では`dslParameters`のsource slot値で表現する。

### 7.5 dataset・dslParametersの値域（v0.10 §6.2・§6.4の確定値の再掲）

実装対象の値域はすべてv0.10で確定済みです。実装時は次を漏れなくContract / 前段検証に載せてください（詳細・根拠はv0.10）。

- dataset: 0〜8件。`name`・`region`・`department.name`・`department.division` 1〜30文字、`skills` 0〜5件・各1〜20文字・重複禁止、`age` 15〜80、`salary` 0〜99,999,999、`evaluation` 0.0〜5.0（NaN / Infinity / -0拒否）、`hireDate` `^\d{4}-\d{2}-\d{2}$`かつ実在日（うるう年検証）・1970-01-01〜2100-12-31。
- 文字列共通: UTF-16 code unit数で計数。制御文字（U+0000〜U+001F・U+007F）・双方向制御文字（U+061C・U+200E・U+200F・U+202A〜U+202E・U+2066〜U+2069）拒否。dataset文字列fieldは空白のみ拒否（trim後1文字以上。値自体は原文保存）。
- dslParameters: 一般DSL文字列0〜20 code unit、source配列0〜8件、nested string list 外0〜4・内0〜5、`streamOfPrimitiveArrays.arrays` 外0〜4・内0〜5、`employeeKeys.keys` 1〜3件・同一field重複禁止。
- DSL数値: `int` = int32範囲、`long` = `Number.isSafeInteger`、`double` = 有限かつ0（正のゼロのみ）または絶対値1e-6〜1e15（-0は`Object.is`で拒否）。適用対象は`arrayPrimitive.values`・`streamOfPrimitiveArrays.arrays`の各要素、および同じprimitive型を受けるすべてのDSL数値値。
- 変数識別子契約: `arrayId`・`listId`等は`^[a-z][A-Za-z0-9]{0,19}$`＋Java予約語・リテラル（`int`・`class`・`true`等）拒否。
- Java型名契約: `empty`ソースの`streamType` / `elementTypeName`は固定表（`object`→`String`・`int`→`int`・`long`→`long`・`double`→`double`）のみ。`arrayObject`・`streamOf`の`elementTypeName`は既存検証の`'String'`固定と同値。`ArrayGeneratorDsl.elementTypeName`は既存ホワイトリストをそのまま使用。

### 7.6 アプリ側が付与する項目とrevision形式（確定）

- `providerKind` = `'IMPORTED'`。表示名は「取込サンプル」（v0.10 §4.1）。
- `provenance` = `{ providerKind: 'IMPORTED', generatedAt: 取込時刻（UTCのISO 8601、YYYY-MM-DDTHH:mm:ss.sssZ）, dslVersion: DSL_VERSION }`。fixtureの固定`generatedAt`規則は取込候補には適用しない（v0.10 §6.5）。
- datasetの`elementId`はアプリが`imp-001`〜`imp-008`の形式で出現順に再付番する（fixtureの`emp-001`系と接頭辞で区別される）。
- **revision形式（本指示で確定）**: `${templateId}:${mode}:imp${counter}`。`counter`はCandidate Importサービスがセッション内で保持する1始まりの単調増加連番とする。発行時に現在のrevisionと一致する場合は再採番する（`FixtureScenarioProvider.nextRevision`のdo / while前例。接頭辞`imp`によりfixture系`r${counter}`とは構造的に衝突しない）。`scenarioId`は既存規則`${templateId}:${mode}:${revision}`（`src/application/scenarioFactory.ts`）のままで一意性が成立する。

### 7.7 Javaコード表示のリテラル契約（v0.10 §7.3。命名規則を本指示で確定）

対象は`src/domain/dsl/javaCode.ts`です。表示生成のみの契約であり、DSL評価・Step Engineの挙動には影響させないでください。

1. **エスケープの必須化**: 既存の`javaStringLiteral`（`\"`・`\\`・制御文字のunicode escape対応済み）を共通経路とし、外部入力由来の文字列をJavaコードの文字列リテラルへ埋め込む**全箇所**へ適用する。現行で未エスケープ埋込みになっている箇所（`employeeConstructorLines`の`name` / `region`、`formatStringList`のskills、Department宣言行の`name` / `division`を含む）を棚卸しし、一覧を完了報告へ記載する。fixture値は安全な文字だけを含むため、適用後もfixtureのJavaコード出力が不変であることをテストで確認する（P6-D18）。
2. **Department変数名の一般化（本指示で確定）**: 部署の同一性は`name`+`division`の組で判定する（現行の`departmentVarName`はname単独判定のため改修する）。
   - 固定対応表: `(開発部, 技術本部)` → `development`、`(営業部, 営業本部)` → `sales`（`src/domain/fixtures/employees.ts`の既存fixture組。不変）。
   - 固定対応表にない組は、datasetの**出現順（組の初出順）**に`dept1`, `dept2`, …を割り当てる。採番は未対応組のみを数える。`deptN`は`development` / `sales`と衝突せず、Java予約語でもない。
   - 表示名（`new Department("...", "...")`のリテラル）とJava変数名を分離し、変数名衝突・`null`化を起こさない（一般化後、Department引数に`null`が現れるケースはなくなる）。
3. **識別子の制限**: Javaコードへ識別子として埋め込まれるDSL値は§7.5の変数識別子契約・Java型名契約で取込前段が拒否する（javaCode側の変更は不要。防御の重複実装はしない）。
4. **数値リテラル契約**: `formatDoubleLiteral` / `formatLongLiteral`（`src/domain/model/value.ts`）は、§7.5で受理される外部入力由来のすべての数値を正当なJavaリテラルへ決定的に変換できる（値域が指数表記化する値・-0を排除している）ため、**変換規則自体の拡張は不要**とする。「Contractが受理する値 ⊆ formatterが正当に変換できる値」の包含関係を境界値テスト（P6-D20）で実証する。

## 8. プロンプト生成（v0.10 §5.2）

プロンプトには次を含めてください。

1. 依頼の説明: 「Java Stream API学習教材の入力データ候補を、下記のJSONだけで返す」旨。
2. 選択中templateの構造説明（ノード列・スロット一覧）と、`templateId`・`templateVersion`・`mode`・`dslVersion`（取込時の一致検証に使う値をそのまま明記）。
3. スロットごとの許可DSL（Import Contractから導出する。Contract以外に機械可読な許可範囲を重複定義しない）。
4. dataset契約（§7.5）: フィールド・型・値域・件数範囲。datasetを使わないtemplateでは省略する。
5. モード別の教材制約の説明（標準 = 判定のtrue / false双方を含む等。検証と同内容を目指した補助的な自然文）。
6. snapshot予算への注意（データ件数を小さく保つ）。
7. 出力形式の指定: v0.10 §6.1のJSONのみを返し、説明文・コードフェンスは不要と指示する（取込側はフェンス付き応答を許容する）。
8. 出力JSONの具体例1件。

- コピーは`navigator.clipboard.writeText`を用い、失敗時はプロンプト全文を選択可能なテキストとして表示するフォールバックを備える。コピー成否はUIでフィードバックする。
- プロンプト文面の詳細（文体・例の数・言語）は実装判断とし、`docs/phase-6-decisions.md`へ記録する。教材制約を満たしやすい表現への実測ベースの調整は仕様変更に当たらない（v0.10 §10-2）。

## 9. UI要件（v0.10 §8）

- §5.3の2操作を実装する。

| 操作 | 仕様 |
|---|---|
| プロンプトをコピー | 選択中の操作・モード・templateに対する生成依頼文をクリップボードへコピーする。コピー成否をフィードバック表示する。シナリオ・履歴・再生状態は変更しない。実行不能templateの選択中は無効化し理由を表示する |
| 候補を貼り付け | 貼付テキストを§7.2の順で検証する。合格時はシナリオ切替（タイマー停止、新revision、history初期化。v0.8 §18の既存意味論）として取込サンプルを表示する。不合格時は現在のシナリオを維持し、理由（code・対象path・message）を貼付欄の近傍に表示する。実行不能templateの選択中は無効化し理由を表示する |

- 取込UIは常設の折りたたみ領域（既存`DetailsDisclosure`の`<details>`流儀）またはパネルとし、モーダルダイアログは使用しない。具体形式は実装判断とし、`docs/phase-6-decisions.md`へ記録する（v0.10 §10-1）。
- 検証失敗理由は`aria-live`で通知し、状態は色以外（記号・文言）でも識別できるようにする（v0.8 §17.5）。
- provenanceバッジは`FIXTURE` = 「固定サンプル」、`IMPORTED` = 「取込サンプル」。fixtureを取込サンプルと表示せず、取込サンプルを固定サンプルと表示しない。「AI生成」という表示は使用しない（v0.10 §4.1）。
- 貼付テキスト・取込パネルの開閉状態・コピー成否フィードバックはUI一時状態であり、snapshot履歴の復元対象にしない。取込が成立した候補データ自体はScenario / snapshotの一部として通常どおり復元対象になる。
- 自動再生中に取込が成立した場合は、シナリオ切替の既存規則に従いタイマーを停止する。
- React側の状態管理: 現行`src/ui`は`useState`未使用のため、取込UIの一時状態管理は新設になる。`useState`等の標準手段を許可する。既存のセッション購読・描画方式を壊さないこと。方式の判断を`docs/phase-6-decisions.md`へ記録する（v0.10 §10-1）。

## 10. 総点検・レスポンシブ最終調整・bundle分割検討

### 10.1 全シナリオ種別の総点検（総合試験）

- 全実行可能template × `supportedModes`の全組合せを実行し、初期snapshotから終端まで到達すること・表示破綻がないことを確認する（E2Eの代表確認＋一覧チェックリスト。結果を完了報告へ記載する）。
- 取込経路について、Employee系・source slot型の双方の代表templateで、プロンプト生成 → 貼付 → 検証 → 実行 → 履歴復元の全経路を確認する。

### 10.2 レスポンシブ最終調整

- PC幅 / 狭幅で全パネル（取込UIを含む）のレイアウト、横スクロール、sticky再生バーの非遮蔽、キーボード操作、focus-visible、reduced motionを最終確認し、必要な調整を行う（v0.8 §17.5の既存要件の総仕上げ。Phase 5持越し）。
- 視覚回帰基準画像は取込UIを含む基準へ**意図的更新**する。diff画像で差分領域を確認し、threshold緩和をしない（Phase 5の前例。v0.10 §1.3）。

### 10.3 bundle分割検討（Phase 5持越し）

- production bundle約504kBのVite警告への対応（code-splitting等）の実施可否を判断し、判断と根拠を完了報告へ記録する（v0.10 §9）。
- 実施する場合: 挙動不変・全テスト成功を条件とし、チャンク構成を完了報告へ記載する。見送る場合: 根拠（教材アプリとしての影響評価）を記録すれば完了条件を満たす。

## 11. Phase 6で実装しないもの

次は実装しないでください。

- サーバーAPI、AiScenarioAdapter、RemoteScenarioProvider、AI事業者APIの呼び出し（フロント直接・サーバー経由とも）、AI SDK・HTTPクライアント依存の追加
- 取込候補の保存・再利用（localStorage等。保存しないことをdecisionsへ明記する。v0.10 §10-7）
- gather DSLの取込開放、Phase 7（Gatherers）の一切（v0.9はPhase 7で実装）
- 取込失敗時のアプリ側自動再試行（修正はユーザーがAIチャット側で行い再貼付する。v0.10 §5.3）
- JSONの独自パーサ・重複キー独自検出（v0.10 §7.2）
- モーダルダイアログ（v0.10 §8）
- 貼付内容のコード文字列の実行・表示（表示用Javaコードは必ずDSLから再生成する。v0.8 §9.3）
- 任意Pipelineビルダー、ノード編集UI、Predicate / mapper / Collector / Javaコードの自由入力、自動再生速度変更UI（従来からの継続禁止事項）
- 本番デプロイ構成、依存ライブラリの不要な更新

## 12. 必須テストID

以下の`P6-*`をすべて実装し、テスト名へIDを含めて追跡可能にしてください。v0.10 §9の必須観点はすべて下表のIDへ割り付けてあります。レビュー等でIDを追加する場合は、各系列の末尾連番で採番してください。

**既存テストの意図的更新（v0.10 §1.3の表。これ以外の既存P1〜P5テストIDの削除・緩和・skipは禁止）**:

| 現行テスト | 更新内容 |
|---|---|
| P1-A08（`tests/application/session.test.ts`） | **廃止**する。「利用者へ示す理由とUI状態の一致」の目的はP6-A02が継承する |
| P1-R07（`tests/react/app.test.tsx`） | **廃止**する。「取込失敗時に現行シナリオを維持し理由を表示する」の目的はP6-R03が継承する。「ユーザー操作なしにシナリオが切り替わらない」「fixtureは固定サンプルと表示する」はP6系とP2-A02が継承する |
| P2-A02（`tests/application/p2-session.test.ts`）の末尾assertion | `app.aiCapability.available === false`の当該assertionのみ削除する。「fixture / 取込サンプル表示を混同しない」という本体は不変 |
| P5-R01（`tests/react/p5-app.test.tsx`）の末尾assertion | 「AI理由はPhase 6のまま維持される」のassertionを削除し、テスト名からも当該文言を除去する。Collector optgroup検証の本体は不変。取込UIの検証はP6-R系のみで行う |
| 視覚回帰基準画像（`e2e/__screenshots__/`） | 取込UI領域を含む基準へ意図的更新（§10.2） |
| P5-O02関連（`tests/domain/p5-review.test.ts`） | P6-O01 suite追加に伴い、**P4-O02 / P4-O03の前例**（Phase 4時点構成のfixture化。検証意味の保存）に従い、Phase 5時点のsuite構成をfixtureとして固定する形へのリファクタリングのみ許可する。ライブ構成の検証は新規P6-O02が担う |

上記のほか、providerKind型変更（`'AI'` → `'IMPORTED'`）・AIボタン削除に伴い**コンパイル不能または対象UI消滅で成立しなくなる既存assertion**が見つかった場合は、検証意味を変えない最小の更新に限り許可し、1件ずつ理由を完了報告へ記載してください。判断に迷う場合は停止して報告してください。

### 12.1 取込検証・契約テスト（P6-D）

Vitest（`tests/`配下。配置は既存の`tests/application` / `tests/domain`流儀に合わせる）。

| ID | 対象 | 必須検証 |
|---|---|---|
| P6-D01 | Import Contract定義 | 全実行可能templateにContractが存在し、template slot定義（`allowed*`）と整合し、プロンプト生成・前段検証の双方がContractだけを参照する（機械可読な許可範囲の重複定義がない） |
| P6-D02 | Contract互換性 | 全実行可能templateの既存fixtureの`dslParameters`がContract検証ですべて受理される（v0.10 §5.2同期保証1） |
| P6-D03 | Contract整合 | Contract受理後に既存構造検証だけが失敗する代表形状が存在しない（v0.10 §5.2同期保証2） |
| P6-D04 | 正常系受理 | Employee系templateとsource slot型templateの双方で、正当な貼付JSONが検証を通過しScenarioが成立する。source slot型で`dataset`キーが禁止（持込みは拒否）、Employee系で必須 |
| P6-D05 | サイズ上限 | 65,536 code unitちょうどの受理と1超過の`IMPORT_SIZE_LIMIT`拒否。拒否がparse前に起きる |
| P6-D06 | 前処理・構文 | 前後空白trim、ラベル付き / 大小文字混在フェンス1組の除去、片側フェンス・フェンス外テキストの`IMPORT_PARSE`、不正JSONの`IMPORT_PARSE`、重複キーの後勝ち受理（後勝ち値が以降の検証を通過する）、`eval` / `Function`不使用（実装のgrep検証） |
| P6-D07 | トップレベルclosed schema | 未知キー拒否、`providerKind` / `provenance` / `revision`の持込み拒否、必須キー欠落、キー型不一致がすべて`IMPORT_SCHEMA` |
| P6-D08 | context一致 | `dslVersion` / `templateId` / `templateVersion` / `mode`の各不一致が`IMPORT_CONTEXT_MISMATCH`。`templateVersion`の非整数・0以下の拒否 |
| P6-D09 | dataset schema | 要素のclosed schema（未知キー・`elementId`持込み拒否）、`department`のclosed schema、フィールド型検査、件数0 / 8境界の受理と9件拒否 |
| P6-D10 | dataset文字列規則 | 長さ境界（1〜30、skills 1〜20・0〜5件・重複拒否）、空白のみ拒否（値は原文保存）、制御文字・双方向制御文字拒否、title / descriptionのtrim採用と1〜60 / 1〜300境界 |
| P6-D11 | dataset数値・日付 | `age` 15 / 80境界、`salary` 0 / 99,999,999境界、`evaluation` 0.0 / 5.0境界とNaN / Infinity / `-0`拒否（`Object.is`判定）、`hireDate`の形式・実在日（2月30日・非うるう年2月29日の拒否、うるう年2月29日の受理）・範囲境界 |
| P6-D12 | dslParameters全階層closed schema | 未知kind・未知type・親フィールド文脈不一致・未知キーの拒否。kindなし正規object（literal、iterateのoperator / predicate、comparator key、identity等）の受理 |
| P6-D13 | 変数識別子契約 | パターン適合の受理、パターン違反（大文字開始・21文字・記号）とJava予約語・リテラルの拒否 |
| P6-D14 | Java型名契約 | `empty`の固定表4組の受理、固定表にない組・任意型名・Java構文を壊す値の拒否 |
| P6-D15 | DSL文字列・配列上限 | 一般DSL文字列0 / 20境界（空文字・空白のみの許可を含む）、source配列0 / 8境界、nested外0〜4内0〜5境界、`streamOfPrimitiveArrays`の外側 / 内側件数境界、`employeeKeys`の1 / 3境界と同一field重複拒否 |
| P6-D16 | DSL数値値域 | int32境界（±の受理と1超過の拒否）、long safe integer境界、doubleの1e-6 / 1e15境界・0（正のゼロ）受理・`-0`拒否（`arrayPrimitive`・`streamOfPrimitiveArrays`の双方）、範囲外・非有限値の拒否 |
| P6-D17 | 前段拒否と既存検証委譲の分離 | ①DSLホワイトリスト違反（許可kind・field・operator等）はImport Contractが`IMPORT_SCHEMA`として前段で拒否し、`buildScenario`へ到達しない（Contractは既存検証と同等以上に厳しいため〔§7.3〕、ホワイトリスト違反が既存検証まで到達することはない）。②Contractが扱わない教材制約違反・snapshot予算超過は、Contract通過後に既存の`TEACHING_CONSTRAINT`・`SNAPSHOT_BUDGET`で拒否される（v0.10 §9の「取込経路でも拒否される」観点は①②で充足する）。③fixture経路（`FixtureScenarioProvider` → `makeScenario`）は前段検証を通らず、挙動が完全不変 |
| P6-D18 | 文字列エスケープ契約 | 引用符・バックスラッシュを含む取込文字列のJavaコード表示が正当なエスケープ済みリテラルになる。全fixtureのJavaコード出力が改修前後で不変 |
| P6-D19 | 部署変数名の一般化 | `name`+`division`組での同一性判定、固定対応表（development / sales）の維持、未対応組への出現順`dept1`, `dept2`…割当、同名部署でdivisionが異なる場合の別変数化、`null`が現れないこと |
| P6-D20 | 数値リテラル契約 | §7.5で受理される全境界値（int32境界・safe integer境界・1e-6 / 1e15・0、および`age` / `salary` / `evaluation`の境界）のJavaコード表示が正当なJavaリテラルで、指数表記が現れない（Contract受理値 ⊆ formatter正当変換値） |
| P6-D21 | candidate組み立て | `providerKind: 'IMPORTED'`付与、provenance（UTC ISO 8601形式・`dslVersion`）、`elementId`の`imp-001`〜出現順再付番、貼付側`elementId`非依存 |

### 12.2 Applicationテスト（P6-A）

| ID | 対象 | 必須検証 |
|---|---|---|
| P6-A01 | 取込成立 | シナリオ切替意味論（タイマー停止、新revision、history 1件、cursor 0、READY）で取込サンプルへ切り替わる |
| P6-A02 | 取込失敗 | 現行シナリオ・履歴・再生状態が一切変化せず、`Result`のissues（code・path・message）が取得でき、UI状態と一致させられる（P1-A08の目的継承） |
| P6-A03 | プロンプト生成 | §8の1〜8がすべて含まれ、`templateId` / `templateVersion` / `mode` / `dslVersion`が選択中の実値と一致し、datasetを使わないtemplateでdataset契約が省略され、実行不能templateでは生成できない |
| P6-A04 | revision決定性 | 連続取込でrevisionが`imp`連番で単調増加し、fixture切替と交互に行っても衝突せず、現revisionと必ず異なる |
| P6-A05 | 経路分離 | 取込経路が`Result`を返しthrowしない。fixture経路は従来どおり（検証済みfixtureの失敗は異常系throw）で挙動不変 |

### 12.3 React統合テスト（P6-R）

| ID | 対象 | 必須検証 |
|---|---|---|
| P6-R01 | 取込UI構成 | 取込UI（コピー / 貼付）が表示され、AIボタン・AI理由表示が存在せず、provenanceバッジが「固定サンプル」 / 「取込サンプル」を正しく表示する |
| P6-R02 | コピー操作 | クリップボードコピーの成否フィードバック、失敗時の全文フォールバック表示、コピー操作でシナリオ・履歴・再生状態が変化しない |
| P6-R03 | 失敗理由表示 | 検証失敗理由（code・対象・message）が貼付欄近傍に表示され、`aria-live`で通知され、色以外でも識別でき、現行シナリオの表示が維持される（P1-R07の目的継承） |
| P6-R04 | 取込成立表示 | 取込サンプルバッジ、title / descriptionの表示（HTMLとして解釈されない）、history初期化後の初期snapshot表示 |
| P6-R05 | 実行不能template | 選択中はコピー・貼付の両方が無効化され理由が表示される |
| P6-R06 | a11y・responsive | 取込UIを含めキーボード操作、focus-visible、reduced motion、狭幅縦積みを維持する |

### 12.4 E2E・視覚テスト（P6-E）

| ID | 対象 | 必須検証 |
|---|---|---|
| P6-E01 | 取込成功フロー | プロンプトコピー → 応答JSON貼付 → 取込サンプル成立 → 実行 → 正しい結果へ到達、provenanceバッジと履歴復元を確認する（Employee系・source slot型の双方） |
| P6-E02 | 取込失敗フロー | 不正な貼付で理由が表示され現行シナリオが維持されること、修正後の再貼付で成功することを確認する |
| P6-E03 | 取込データのJavaコード表示 | 引用符・バックスラッシュを含む文字列と任意部署名を含む取込candidateのJavaコード表示が構文的に正当で、実データと一致する |
| P6-E04 | 総点検回帰 | 既存E2E全件が成功し、AIボタンが存在せず、全Phase代表シナリオが従来どおり動作する（§10.1のチェックリストと対応させる） |
| P6-E05 | 狭幅・視覚回帰 | 取込UIを含むPC幅 / 狭幅の表示、横スクロール、sticky非遮蔽を確認し、基準画像を意図的更新する（diff確認・threshold緩和なし） |

E2Eのクリップボード検証はPlaywrightのclipboard権限付与を許可します。権限が使えない環境向けの検証方法（フォールバック表示経路の検証等）は実装判断とし、`docs/phase-6-decisions.md`へ記録してください。

### 12.5 JDK 25 Oracle Test（P6-O）

| ID | 対象 | 必須検証 |
|---|---|---|
| P6-O01 | 取込境界値のJDK 25照合 | §7.5の数値値域の代表境界値（int32境界・long safe integer境界・doubleの1e-6 / 1e15・0、salary / age / evaluationの境界）を含む取込相当candidateの実行結果を、Simulation Coreと固定Java 25コードで照合する。対象operationは既存実装範囲から選ぶ（例: `arrayPrimitive`のsum / average、Employee境界datasetのsummingLong / averagingLong） |
| P6-O02 | Oracle運用検証 | 必須suite（P1-O01〜P5-O01・P6-O01）が各1件存在し、証跡書込みが現行Phase（`artifacts/phase-6/oracle-result.md`）のみで、実行前後に`artifacts/phase-1`〜`phase-5`のSHA-256が不変である |

Oracleランナーは既存構成（Docker + `gradle:9.6.1-jdk25`、`oracle/OracleP6.java` + `oracle/expected-p6-from-core.json`）を踏襲し、次を必ず更新してください。

- suite定義へ`P6-O01`を追加し、証跡書込み先を`artifacts/phase-6/oracle-result.md`とする。
- `P5-O01`の証跡書込みを停止する（`writeReportPath`のnull化）。`artifacts/phase-5/oracle-result.md`は過去証跡として保持し、上書きしない。P1〜P5 suiteの照合自体は回帰として継続実行する。
- 必須suite ID一覧へ`P6-O01`を追加し、過去artifacts不変検証の対象へ`artifacts/phase-5`を追加する。
- 数値の照合は既存のJSON文字列厳密照合を維持する。JS / Javaの数値表記差により偽装一致・偽装不一致が生じる境界値は、双方で決定的な10進表記が得られる値を選定し、選定判断を`docs/phase-6-decisions.md`へ記録する（doubleの1e-6〜1e15制約はこの決定的表記のための値域である。v0.10 §6.4）。

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

1. 既存P1〜P5テストID（P1必須41 + P2必須52 + P3必須60 + P4必須72 + P5必須59、および各Oracle ID）が、§12冒頭で許可した意図的更新を除きすべて成功する。
2. P6必須テストID（§12.1〜§12.5の39 ID）がすべて実装され成功する。
3. `src`・`tests`・`e2e`に`AI_CAPABILITY` / `aiCapability` / `RemoteScenarioProvider` / AI SDK / AI向けHTTP接続が存在しない（grepで確認）。
4. `eval`、`new Function`、動的コード生成が取込経路にも存在しない。
5. 取込UIからv0.10 §5.1の全体フロー（コピー → 貼付 → 合格 / 不合格）をPC幅・狭幅で目視確認する。
6. §10.1の総点検チェックリスト（全実行可能template × mode）が完了している。
7. 視覚回帰の期待画像の更新がすべて意図的（diff確認済み）である。
8. E2E・Oracleの書込み対象が`artifacts/phase-6`のみで、`artifacts/phase-1`〜`phase-5`が変更されない。
9. bundle分割の判断（実施 / 見送り）と根拠が記録されている。
10. `git diff --check`、`git diff --stat`、`git status --short`で変更範囲を確認する。

テスト失敗をskip、期待値緩和、テスト削除、過度なmock、基準画像の無条件更新で隠さないでください。環境制約で未実行のテストがある場合は成功扱いせず、原因、試行内容、残作業、再実行コマンドを明記してください。

## 14. 成果物

既存規約を維持し、次を作成・更新してください。

- `docs/phase-6-decisions.md`（新規）
  - 記録対象: Import Contractの実装配置と既存slot定義との統合方法、取込UIの具体形式とReact状態管理方式、プロンプト文面の設計、E2Eクリップボード検証方式、Oracle境界値の選定判断、bundle分割の判断、その他仕様本文を変更しない範囲の実装判断（v0.10 §10の判断事項のうち、§7で本指示が確定済みの項目〔ValidationCode・revision形式・部署変数名〕は、実装と確定値に差異が生じた場合のみ記録する）。
- `docs/phase-6-completion-report.md`
- `artifacts/phase-6/`
  - PC幅 / 狭幅キャプチャ（取込UI・取込サンプル実行中・検証失敗表示を含む）
  - Oracle結果（`oracle-result.md`）
- `e2e/__screenshots__/`配下の視覚回帰基準画像（取込UIを含む意図的更新）
- E2Eキャプチャ対象Phaseの更新: `e2e/capture-helper.ts`の`CAPTURE_TARGET_PHASE`を`6`へ変更する（この1か所のみ。過去Phaseのcapture specは変更しない）。
- `README.md` — Phase 6完了時のみ更新: テスト結果の見出しと表をPhase 6最終の実測値へ、必須テストID実績へP6を追加、指示書一覧へ本指示書を追加、ドキュメント一覧へ`docs/phase-6-*.md`とv0.9 / v0.10仕様書を追加、`artifacts/phase-6/`を成果物一覧へ追加、機能説明を手動連携方式（AIボタン廃止・取込サンプル）に合わせて更新。

`docs/phase-1〜5-completion-report.md`、`docs/phase-1〜5-decisions.md`、`artifacts/phase-1`〜`phase-5`は過去の記録として保持し、書き換えないでください。

## 15. Phase 6完了条件

次をすべて満たした場合だけ「Phase 6完了」と判定してください。

- v0.10 §9のPhase 6実装内容と完了条件（取込候補の検証・実行、Javaコード表示の構文的正当性と実データ一致、失敗時の理由表示とシナリオ維持、完成要件として成立）を満たす。
- Import Contract、Prompt Generator、Candidate Import、取込UI、`Result`エラー表示経路、Javaコード表示のリテラル契約、provider種別`IMPORTED`がApplication → React UIまで縦断実装される。
- `AI_CAPABILITY`・AIボタンが廃止され、AI関連の残存参照がない。
- fixture経路（Provider・`instantiateTemplate`・throw経路）の挙動が完全不変である。
- 取込前段検証がv0.10 §6・§7の全規則（closed schema・値域・文字列規則・識別子 / 型名契約・-0拒否）を実装している。
- Contract同期保証（互換性・整合）が成立している。
- P6必須39 テストIDがすべて実装・成功し、既存P1〜P5テストIDが§12冒頭の許可範囲を除き変更なく成功する。
- lint、型検査、production buildが成功する。
- Playwright E2E、視覚回帰、PC / 狭幅確認、§10.1の総点検が完了する。
- P6-O01・P6-O02がJDK 25で成功し、`artifacts/phase-1`〜`phase-5`が不変である。
- レスポンシブ最終調整とbundle分割検討の判断・記録が完了している。
- Phase 7（Gatherers）を先行実装していない。
- ユーザーの既存変更を破棄していない。

1項目でも満たせない場合は「Phase 6未完了」とし、残作業、影響、再現手順を具体的に報告してください。

## 16. 完了報告の必須項目

`docs/phase-6-completion-report.md`とチャット報告へ、次を必ず含めてください。

1. Phase 6の完了 / 未完了判定
2. 基準コミット（§3.1）と作業ブランチ
3. 実装した手動連携の構成（Import Contract・Prompt Generator・Candidate Import・取込UI・Result経路の設計概要）
4. 廃止したAI関連コードの一覧（定数・型・UI・コメント）
5. Javaコード表示リテラル契約の実装内容（エスケープ適用箇所の棚卸し一覧・部署変数名規則・fixture出力不変の確認結果）
6. 主な変更ファイルとアーキテクチャ上の役割
7. 実行した全コマンドと終了結果
8. テスト種別ごとの総数、成功、失敗、skip、未実行
9. P6必須39 IDを1件ずつ記載した対応表（v0.10 §9の必須観点との対応を含む）
10. 既存P1〜P5必須IDの回帰結果と、§12冒頭で許可した意図的更新の一覧・理由
11. P6-O01 / P6-O02のJDKベンダー / バージョン、ケース、照合結果、境界値選定の判断
12. §10.1の総点検チェックリスト（全実行可能template × mode）の結果
13. レスポンシブ最終調整の内容と、視覚回帰基準画像の意図的更新の一覧（diff確認結果）
14. bundle分割検討の判断・根拠・（実施時は）チャンク構成
15. PC幅 / 狭幅キャプチャの保存先
16. 仕様との差異と実装判断（`docs/phase-6-decisions.md`への参照を含む）
17. 既知の問題と持越し事項（残る場合）
18. 最終`git diff --stat`と`git status --short`、およびcommit、push、PRを行っていないことの確認

「全テスト成功」「仕様準拠」だけで済ませず、コマンド、件数、ID、成果物パスを根拠として記載してください。

## 17. 停止条件

次の場合は推測で進めず、変更前または問題判明時点で停止して報告してください。

- v0.10と本指示、またはv0.8（§1.2対応表適用後）とv0.10に、実装結果を変える矛盾がある。
- v0.10 §1.2の対応表に現れないAI関連記述をv0.8で発見した（扱いを勝手に決めない。v0.10 §1.1）。
- 基準コミットが現在の`phase-6`の祖先でない。
- worktreeに未確認のユーザー変更がある。
- Phase 1〜5回帰テストが変更前から失敗する。
- Contract同期保証（互換性・整合）を満たせない形状が解消できない。
- 「Contractが受理する値 ⊆ formatterが正当に変換できる値」の包含関係を満たせない値が見つかった（formatterの独自拡張で対処せず、報告する）。
- 既存TypeRef / SimValue / snapshot構造・`instantiateTemplate`の破壊的変更や、§12冒頭の許可範囲を超える既存テスト書き換えが必要になる。
- 仕様にない依存追加、サーバー、AI接続、任意コード実行が必要になる。

## 18. 最終禁止事項

- v0.8・v0.9・v0.10の各仕様書と統合docxを変更しない。
- Phase 7（Gatherers）を実装しない。gather DSLを取込対象にしない。
- Phase 1〜5の完了報告・判断記録・証跡（`artifacts/phase-1`〜`phase-5`）を書き換えない。
- サーバーAPI・AI接続を実装しない。AI事業者APIを呼ばない。
- 貼付内容のコード文字列を表示にも評価にも使用しない。`eval`・`Function`を使用しない。表示用Javaコードは必ずDSL / ASTから再生成する。
- 検証を通らない候補をStep Engineへ渡さない。
- fixtureを取込サンプルと表示せず、取込サンプルを固定サンプルと表示しない。「AI生成」表示を使用しない。
- 取込失敗時にfixtureへ自動フォールバックしない。現在のシナリオを変更しない。
- 機械可読な許可範囲をImport Contract以外に重複定義しない。
- UIで結果、型、蓄積状態、表示順を独自計算しない。
- 失敗、skip、未実行、仕様差異を隠さない。
- ユーザーの変更を削除、stash、reset、checkoutで破棄しない。
- 別途指示なしにcommit、push、PR、mergeを行わない。

Phase 6の実装、検証、証跡作成、完了報告まで実行してください。

---

## 使用方法

1. ローカルPCで対象リポジトリを最新化し、`phase-6`ブランチへ切り替えます。
2. プロジェクトルートでClaude Codeを起動します。
3. この文書の「Java Stream API 可視化シミュレーター Phase 6実装指示」以降を渡します。
4. Claude Codeの完了報告後、コード、テスト、キャプチャ、`docs/phase-6-completion-report.md`をレビューします。
