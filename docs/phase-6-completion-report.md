# Phase 6 完了報告（手動連携）

## 1. 判定

**Phase 6 完了**（Phase 6実装指示 §15の全条件を満たす）。

| §15の完了条件 | 判定 | 根拠 |
|---|---|---|
| v0.10 §9のPhase 6実装内容と完了条件を満たす | 満たす | §3・§9・§12（取込候補の検証・実行、Javaコード表示の正当性と実データ一致、失敗時の理由表示とシナリオ維持） |
| Import Contract / Prompt Generator / Candidate Import / 取込UI / `Result`エラー表示経路 / Javaコード表示のリテラル契約 / provider種別`IMPORTED`がApplication → React UIまで縦断実装 | 満たす | §3・§6 |
| `AI_CAPABILITY`・AIボタンが廃止され、AI関連の残存参照がない | 満たす | §4・§7-3（grep結果） |
| fixture経路（Provider・`instantiateTemplate`・throw経路）の挙動が完全不変 | 満たす | P6-A05・P6-D17-③、`instantiateTemplate` / `FixtureScenarioProvider` 無変更（§6の変更ファイル一覧） |
| 取込前段検証がv0.10 §6・§7の全規則を実装 | 満たす | P6-D05〜D16・D21 |
| Contract同期保証（互換性・整合）が成立 | 満たす | P6-D02（fixture 211組合せ受理）・P6-D03（全slot variantの代表形状） |
| P6必須39 IDがすべて実装・成功、既存P1〜P5テストIDが許可範囲を除き変更なく成功 | 満たす | §9・§10 |
| lint・型検査・production buildが成功 | 満たす | §7 |
| Playwright E2E・視覚回帰・PC / 狭幅確認・§10.1総点検が完了 | 満たす | §7・§12・§13 |
| P6-O01・P6-O02がJDK 25で成功し、`artifacts/phase-1`〜`phase-5`が不変 | 満たす | §11 |
| レスポンシブ最終調整とbundle分割検討の判断・記録が完了 | 満たす | §13・§14 |
| Phase 7（Gatherers）を先行実装していない | 満たす | gather DSL・Gatherer関連コードは一切追加していない（§6の変更ファイル一覧） |
| ユーザーの既存変更を破棄していない | 満たす | §18（未追跡2件は開始時のまま保持） |

## 2. 基準コミットと作業ブランチ

- 基準コミット: `ad7f37c0b9403bf29633ec9348a17a64c1033a22`（`main`。Phase 5完了 + v0.9 / v0.10仕様書 + 統合docx）
- 作業ブランチ: `phase-6`（開始時HEAD `d5c63da`。基準コミットの子孫であることを `git merge-base --is-ancestor` で確認）
- **commit / push / Pull Request / mainへのmergeは行っていない**（§18）

### 変更前の基準結果（§3.3）

作業worktreeでは `npm ci` / `lint` / `typecheck` / `test:unit` / `build` のみを実行し、
`test:e2e` / `test:oracle` は Phase 5証跡を書き換えないよう、
**基準コミットの一時git worktreeをプロジェクトディレクトリ外へ作成**して取得した
（`git worktree add C:\...\Temp\...\scratchpad\baseline-wt ad7f37c` → 実行 → `git worktree remove --force`）。

| 検証 | 変更前の結果 |
|---|---|
| `npm run lint` | 成功（警告なし） |
| `npm run typecheck` | 成功 |
| `npm run test:unit` | **392件 / 44ファイル 全成功** |
| `npm run build` | 成功。単一chunk **518.89 kB**（gzip 133.99 kB）でchunk size警告あり |
| `npm run test:e2e`（一時worktree） | **63件 全成功** |
| `npm run test:oracle`（一時worktree） | P1-O01 / P2-O01 / P3-O01 / P4-O01 / P5-O01 / P4-O02 / P5-O02 **全PASS** |

- 変更前から失敗しているテストは**なかった**。
- 指示書§3.3の「約504kB」に対し実測は518.89 kBだった（Phase 5完了報告以降の差分。失敗ではなく§10.3で扱った）。
- 作業worktreeの `artifacts/phase-1`〜`phase-5` へは一切書き込んでいない（§11・§18で実測確認）。

## 3. 実装した手動連携の構成

```
React UI
  → Application
      ├─ Import Contract  (src/application/importContract.ts)   … 許可DSLの単一定義源
      ├─ Prompt Generator (src/application/promptGenerator.ts)   … Contractを言語化した生成依頼文
      └─ Candidate Import (src/application/candidateImport.ts)   … 6手順の前段検証 + candidate組み立て
            → buildScenario (既存・無変更) → instantiateTemplate (既存・無変更、手順1〜7)
  → ScenarioProvider（fixture用契約として存続。FixtureScenarioProviderは無変更）
```

### 3.1 Import Contract

許可DSLを**宣言的なspec木**（`SpecNode`）で表現する単一定義源。
`buildTemplateContract(template)` が既存 `ParameterSlot.allowed*` と `sourceDefinition` から導出し、
不足分（schema nodeごとの許可キー集合・値域・件数上限・組合せ規則）だけを補う。

`TemplateContract` はスロットのspecに加えて、**トップレベルのキー集合（`topLevelKeys`）と
キー型（`topLevelTypes`）、予約キー（`reservedTopLevelKeys` / `reservedDatasetKeys`）、
`datasetSpec` / `titleSpec` / `descriptionSpec` / `textMaxLength`** も保持する。
Prompt Generator（`describeSpec`）とCandidate Import（`validateCandidateShape`）は
**同一のspecノードを走査**しており、フィールド構造・値域・キー集合を別経路で組み立てる箇所はない。

dataset要否は `sourceDefinition` が `collection` を使うかで機械的に決まる
（Employee系 = 必須 / source slot型 = 禁止）。`datasetSpec` はsource slot型templateでは `null` で、
`topLevelKeys` からも `dataset` が除かれる。

単一定義源であることの検証:

| 検証 | 内容 |
|---|---|
| P6-D01 | Contractがトップレベル・dataset・title・descriptionのspecを保持する。`promptGenerator.ts` / `candidateImport.ts` に許可値リテラル（`'fieldCompare'` / `'TreeMap::new'` 等）とdataset field名（`hireDate` / `evaluation` / `department` / `skills`）が存在しない（ソースのgrep検証） |
| P6-A03 | プロンプト本文にContractの `describeSpec` 出力（dataset・title・description・全slot）がそのまま含まれる。`topLevelKeys` / `topLevelTypes` / 予約キー / `textMaxLength` もContractの値がそのまま載る |
| P6-A03 | **slot定義を変えた仮想template**で記述が実際に追随する（`allowedConsumerKinds` を狭める → `"printField"` が消える／`allowedFields` を狭める → field列挙が減る／`sourceDefinition` を差し替える → dataset契約セクションが消え `topLevelKeys` から `dataset` が外れる） |

### 3.2 Prompt Generator

§8の1〜8をすべて含む生成依頼文を組み立てる。許可DSLの記述はspec木からの導出であり、
slot定義を変えればプロンプトも自動追随する。出力例は現在のtemplate × modeのfixtureを素材に組み立て、
**そのまま貼り戻せば必ず取込が成立する**（P6-A03が全実行可能template × modeで検証）。

### 3.3 Candidate Import

`ScenarioProvider` を実装しない独立サービス（v0.10 §3.2）。v0.10 §7.2の6手順で処理し、
途中で失敗した場合それ以降の手順を実行しない。

| 手順 | 内容 | 失敗時のcode |
|---|---|---|
| 1 | サイズ上限（65,536 UTF-16 code unit。`string.length`でparse前判定） | `IMPORT_SIZE_LIMIT` |
| 2 | 前処理（前後空白trim → 先頭/末尾1組のコードフェンス除去） | — |
| 3 | `JSON.parse`（`eval` / `Function` 不使用。重複キーは後勝ちに委ねる） | `IMPORT_PARSE` |
| 4 | candidate schema検証（Import Contract） | `IMPORT_SCHEMA` / `IMPORT_CONTEXT_MISMATCH` |
| 5 | ScenarioCandidate組み立て（providerKind / provenance / revision / elementId の付与） | — |
| 6 | 既存検証パイプライン（`buildScenario` → `instantiateTemplate` 手順1〜7を無変更で通す） | 既存code（`TEACHING_CONSTRAINT` / `SNAPSHOT_BUDGET` 等） |

アプリ側が付与する項目（§7.6の確定値どおり）:
`providerKind = 'IMPORTED'` / `provenance = { providerKind, generatedAt（UTC ISO 8601）, dslVersion }` /
`revision = ${templateId}:${mode}:imp${counter}`（現revisionと一致する場合は再採番）/
`elementId = imp-001`〜`imp-008`（出現順）。

### 3.4 取込UI

`src/ui/components/ImportPanel.tsx`。**常設パネル**（v0.10 §8が許す2形式のうちパネルを選択。
理由は `docs/phase-6-decisions.md` §4）。モーダルダイアログは未使用。

- 「プロンプトをコピー」: `navigator.clipboard.writeText`。失敗時は全文を `<textarea readOnly>` で表示
- 「候補を貼り付け」: 合格時はシナリオ切替（タイマー停止・新revision・history初期化）、
  不合格時は現在のシナリオを維持し理由（code・path・message）を貼付欄近傍に表示
- 失敗理由は `aria-live="polite"` で通知。状態は色以外（`✓` / `!` / `×` と文言）でも識別可能
- provenanceバッジ: `FIXTURE` = 「固定サンプル」 / `IMPORTED` = 「取込サンプル」（「AI生成」表示なし）
- UI一時状態（貼付テキスト・コピー成否・取込結果）は `useState` のみで保持し、snapshot履歴の復元対象にしない

### 3.5 `Result` エラー表示経路

`AppInstance.importCandidate(templateId, mode, text): Result<Scenario>` を新設。
合格時のみ内部で `session.switchScenario` を呼び、不合格時は `issues` を返して**セッションへ触れない**。
fixture経路の `makeScenario` はthrowのまま（検証済みfixtureの失敗は異常系）で不変（P6-A05）。

## 4. 廃止したAI関連コードの一覧

| 種別 | 対象 | 対応 |
|---|---|---|
| 定数 | `AI_CAPABILITY`（`src/providers/scenarioProvider.ts`） | 削除 |
| 型 | `ScenarioCandidate.providerKind`: `'FIXTURE' \| 'AI'` | `ProviderKind = 'FIXTURE' \| 'IMPORTED'` へ変更 |
| 型 | `ScenarioProvenance.providerKind`: `'FIXTURE' \| 'AI'` | `'FIXTURE' \| 'IMPORTED'` へ変更 |
| API | `AppInstance.aiCapability`（`src/ui/appInstance.ts`） | 削除 |
| UI | disabled AIボタン（`data-testid="ai-button"`） | 削除 |
| UI | disabled理由表示（`data-testid="ai-reason"`、`#ai-unavailable-reason`） | 削除 |
| UI | provenanceバッジの `'AI生成'` 表示 | `PROVIDER_KIND_LABELS`（固定サンプル / 取込サンプル）へ置換 |
| CSS | `.ai-control` / `.ai-reason`（`src/ui/styles.css`） | 削除 |
| コメント | `UNIMPLEMENTED_OPERATIONS`「Phase 6のAI機能は…既存のAI capability disabled理由表示で扱う」 | 手動連携の記述へ修正 |
| コメント | `SourceDefinition`「fixture / AIがsource DSLを設定する」 | 「fixture / 取込候補が」（v0.10 §1.2の§8.1読み替え） |
| コメント | `OperationCatalog`「TemplateやAI候補はtraitsを上書きできない」 | 「Templateや取込候補は」（同 §7読み替え） |
| コメント | `operations.ts`「Phase 6のAI関連操作は登録しない」 | 「手動連携はStream操作ではない」旨へ修正 |
| コメント | `ScenarioProvenance`「fixtureをAI生成として表示しない」 | 「fixtureを取込サンプルと表示せず、取込サンプルを固定サンプルと表示しない」 |
| コメント | `FixtureScenarioProvider`「AI生成とは表示しない」 | 「取込サンプルとは表示しない」 |
| コメント | `ScenarioControls`「fixtureは固定サンプルと表示し、AI生成とは表示しない」 | 取込サンプルを含む記述へ修正 |

**存続させたもの**（v0.10 §3.2）: `ScenarioProvider` interface（`capability()` / `generate()`）、
`ProviderCapability`、`GenerateRequest`、`FixtureScenarioProvider` の実装・挙動・revision形式。

サーバーAPI・`AiScenarioAdapter`・`RemoteScenarioProvider` は元々未実装のため削除対象なし（v0.10 §1.3）。

## 5. Javaコード表示リテラル契約の実装内容

### 5.1 エスケープ適用箇所の棚卸し（`src/domain/dsl/javaCode.ts`）

改修前に**未エスケープ**で埋め込んでいた箇所と、`javaStringLiteral` を適用した結果:

| # | 箇所 | 改修前 | 改修後 |
|---|---|---|---|
| 1 | `employeeConstructorLines` の `name` | `"${value.name}"` | `javaStringLiteral(value.name)` |
| 2 | `employeeConstructorLines` の `region` | `"${value.region}"` | `javaStringLiteral(value.region)` |
| 3 | `formatStringList`（skills・nestedStringListの内側） | `` `"${s}"` `` | `javaStringLiteral(s)` |
| 4 | `sourceDeclLines` collection の Department宣言 `name` | `"${deptName}"` | `javaStringLiteral(department.name)` |
| 5 | `sourceDeclLines` collection の Department宣言 `division` | `"${division}"` | `javaStringLiteral(department.division)` |
| 6 | `sourceDeclLines` `arrayObject` の values | `` `"${s}"` `` | `javaStringLiteral(s)` |
| 7 | `sourceToJavaExpr` `streamOf` の values | `` `"${s}"` `` | `javaStringLiteral(s)` |
| 8 | `mapperToJavaExpr` `prefix` | `` `n -> "${mapper.prefix}" + n` `` | `` `n -> ${javaStringLiteral(mapper.prefix)} + n` `` |

改修前から適用済みだった箇所（変更なし）: string identity（`identityToJavaLiteral`）、
joiningの delimiter / prefix / suffix（`collectorToJavaExpr`）。

### 5.2 部署変数名の規則

`assignDepartmentVarNames(dataset)` を新設。部署の同一性を **`name` + `division` の組**で判定する。

- 固定対応表（不変）: `(開発部, 技術本部)` → `development`、`(営業部, 営業本部)` → `sales`
- 固定表にない組: datasetの**組の初出順**に `dept1`, `dept2`, …（採番は未対応組のみを数える）
- 表示名（`new Department("...", "...")` のリテラル）とJava変数名を分離。
  dataset内の全部署に変数名を割り当てるため、**Department引数に `null` は現れない**

同名部署でdivisionが異なる場合は別変数になる（P6-D19で検証）。

### 5.3 fixture出力不変の確認結果

基準コミット `ad7f37c` の一時worktreeで、**全fixture（template × supportedModes、211組合せ）の
Javaコード行**を採取し、`tests/fixtures/fixture-javacode-before-p6.json` としてリポジトリへ固定した。
改修後の再生成結果とキー集合・全行が**完全一致**する（P6-D18）。

### 5.4 数値リテラル契約

`formatDoubleLiteral` / `formatLongLiteral`（`src/domain/model/value.ts`）は**無改修**。
「Contractが受理する値 ⊆ formatterが正当に変換できる値」の包含関係を P6-D20 が境界値で実証する。

なお `limit` / `skip` の引数は、包含関係を保つために Contract側を **0〜int32最大**へ厳格化した
（formatterを拡張せずContractを狭める方向。`docs/phase-6-decisions.md` §2）。

## 6. 主な変更ファイルとアーキテクチャ上の役割

### 新規

| ファイル | 役割 |
|---|---|
| `src/application/importContract.ts` | Import Contract（許可DSLのspec木・値域・closed schema検証・candidate schema検証） |
| `src/application/promptGenerator.ts` | Prompt Generator（Contract木の言語化・出力例の生成） |
| `src/application/candidateImport.ts` | Candidate Import（6手順の前段検証・candidate組み立て・`Result`返却） |
| `src/ui/components/ImportPanel.tsx` | 取込UI（コピー / 貼付 / 失敗理由 / フォールバック表示） |
| `oracle/OracleP6.java`, `oracle/expected-p6-from-core.json` | P6-O01のJDK 25照合 |
| `tests/p6-helpers.ts`, `tests/p6-oracle-expected.ts` | Phase 6テスト共通helper・Oracle期待値ビルダー |
| `tests/domain/p6-contract.test.ts` | P6-D01〜D03 |
| `tests/domain/p6-import.test.ts` | P6-D04〜D17・D21 |
| `tests/domain/p6-javacode.test.ts` | P6-D18〜D20 |
| `tests/domain/p6-fullcheck.test.ts` | P6-D22（§10.1総点検の機械検証） |
| `tests/domain/p6-oracleSync.test.ts` | P6-O01(sync) |
| `tests/domain/p6-review.test.ts` | P6-O02 |
| `tests/application/p6-session.test.ts` | P6-A01〜A05 |
| `tests/react/p6-app.test.tsx` | P6-R01〜R06 |
| `tests/fixtures/fixture-javacode-before-p6.json` | 改修前のfixture Javaコード出力（P6-D18のgolden） |
| `e2e/phase6.spec.ts`, `e2e/p6-capture.spec.ts`, `e2e/p6-narrow.spec.ts`, `e2e/p6-utils.ts` | P6-E01〜E05・証跡キャプチャ |
| `artifacts/phase-6/` | PC幅 / 狭幅キャプチャ11枚 + `oracle-result.md` |
| `docs/phase-6-decisions.md` | Phase 6判断記録 |

### 変更

| ファイル | 変更内容 |
|---|---|
| `src/providers/scenarioProvider.ts` | `AI_CAPABILITY`削除、`ProviderKind`型追加（`FIXTURE` / `IMPORTED`） |
| `src/domain/scenario/scenario.ts` | provenance種別変更、`PROVIDER_KIND_LABELS`追加 |
| `src/domain/types/result.ts` | `ValidationCode`へ`IMPORT_*` 4件追加 |
| `src/domain/dsl/javaCode.ts` | エスケープ必須化・部署変数名の一般化（§5） |
| `src/ui/appInstance.ts` | `aiCapability`削除、`importabilityOf` / `generatePrompt` / `importCandidate` 追加 |
| `src/ui/components/ScenarioControls.tsx` | AIボタン・理由削除、provenanceバッジのラベル化 |
| `src/ui/App.tsx` | `ImportPanel` 組込み、副題をPhase 6へ更新 |
| `src/ui/styles.css` | `.ai-*` 削除、取込UIのスタイル追加 |
| `vite.config.ts` | bundle分割（React vendor chunk） |
| `oracle/oracle-lib.mjs`, `oracle/run-oracle.mjs` | P6-O01追加、P5-O01書込停止、必須suite / 過去artifacts対象の更新、セクション生成のパラメータ化 |
| `e2e/capture-helper.ts` | `CAPTURE_TARGET_PHASE = 6` |
| `README.md` | Phase 6完了・手動連携の説明・テスト結果・ドキュメント一覧 |
| 既存テスト5ファイル | §10の意図的更新（許可範囲のみ） |
| `e2e/__screenshots__/` 20枚 | 視覚回帰基準画像の意図的更新（§13） |

**無変更**（fixture経路の不変性の根拠）: `src/domain/template/instantiate.ts`、
`src/providers/fixtureScenarioProvider.ts`（doc comment 1行のみ）、`src/application/scenarioFactory.ts`、
`src/application/session.ts`、`src/domain/engine/*`、`src/domain/dsl/validate*.ts`。

## 7. 実行した全コマンドと終了結果

| コマンド | 結果 |
|---|---|
| `git fetch origin` / `git switch phase-6` / `git merge-base --is-ancestor ad7f37c HEAD` / `git status --short` | 成功（基準コミットはHEADの祖先。未追跡は許可済み2件のみ） |
| `npm ci` | 成功（0 vulnerabilities） |
| `npm run lint`（変更前 / 最終） | 成功 / 成功（警告0件） |
| `npm run typecheck`（変更前 / 最終） | 成功 / 成功 |
| `npm run test:unit`（変更前 / 最終） | 392件全成功 / **515件全成功（52ファイル）** |
| `npm run build`（変更前 / 最終） | 成功（518.89 kB・chunk警告あり） / **成功（189.60 + 365.08 kB・警告なし）** |
| `git worktree add <プロジェクト外> ad7f37c` → 一時worktreeで `npm ci` / `test:e2e` / `test:oracle` → `git worktree remove --force` | 成功（E2E 63件全成功、Oracle全PASS） |
| `npm run test:e2e`（最終） | **72件全成功** |
| `npx playwright test --update-snapshots=changed` | 成功（既存20枚を意図的更新、新規7枚を作成） |
| `npm run test:oracle`（最終） | **P6-O01 PASSED / P6-O02 PASSED / P4-O01・P4-O02 REGRESSION PASSED** |
| `git diff --check` / `git diff --stat` / `git status --short` | 成功（§18） |

skip・未実行のテストは**ない**。

## 8. テスト種別ごとの件数

| 種別 | 総数 | 成功 | 失敗 | skip | 未実行 |
|---|---|---|---|---|---|
| Vitest（Domain / Application / React） | 515（52ファイル） | 515 | 0 | 0 | 0 |
| Playwright E2E・視覚回帰（PC幅 + 狭幅） | 72（18ファイル） | 72 | 0 | 0 | 0 |
| JDK 25 Oracle suite | 6（P1-O01〜P6-O01） | 6 | 0 | 0 | 0 |

変更前（392 / 63 / 5 suite）からの増分は Vitest +123件、E2E +9件、Oracle +1 suite。

## 9. P6必須39 IDの対応表

### 9.1 取込検証・契約テスト（P6-D）— `tests/domain/`

| ID | テストファイル | v0.10 §9の必須観点 | 結果 |
|---|---|---|---|
| P6-D01 | `p6-contract.test.ts` | Import Contract同期保証の前提（Contract定義の存在、slot定義・トップレベル・dataset・title/descriptionのspec保持、許可範囲の重複定義がないことのgrep検証） | 成功 |
| P6-D02 | `p6-contract.test.ts` | Import Contract同期保証（互換性テスト） | 成功 |
| P6-D03 | `p6-contract.test.ts` | Import Contract同期保証（整合テスト） | 成功 |
| P6-D04 | `p6-import.test.ts` | 貼付JSONの受理（Employee系・source slot型の双方）、source slot型のdataset禁止 | 成功 |
| P6-D05 | `p6-import.test.ts` | サイズ超過（closed schema拒否のうちサイズ） | 成功 |
| P6-D06 | `p6-import.test.ts` | 前処理・構文（重複キー後勝ち・`eval`/`Function`不使用） | 成功 |
| P6-D07 | `p6-import.test.ts` | トップレベル未知キー、`providerKind`/`provenance`/`revision`の持込み | 成功 |
| P6-D08 | `p6-import.test.ts` | context不一致（templateId / mode / version / dslVersion） | 成功 |
| P6-D09 | `p6-import.test.ts` | dataset未知キー・`elementId`の持込み | 成功 |
| P6-D10 | `p6-import.test.ts` | 文字列規則違反（制御文字・双方向制御文字・空白のみ・長さ） | 成功 |
| P6-D11 | `p6-import.test.ts` | 数値値域（`evaluation: -0` の拒否を含む）・実在日 | 成功 |
| P6-D12 | `p6-import.test.ts` | dslParameters内の未知kind・未知type・親フィールド文脈不一致・未知キー | 成功 |
| P6-D13 | `p6-import.test.ts` | 識別子パターン違反 | 成功 |
| P6-D14 | `p6-import.test.ts` | Java型名契約（`empty`の固定表・Java構文を壊す値の拒否） | 成功 |
| P6-D15 | `p6-import.test.ts` | DSL文字列 / 配列上限（`streamOfPrimitiveArrays`外側/内側・`employeeKeys`件数/field重複） | 成功 |
| P6-D16 | `p6-import.test.ts` | 数値値域（int32境界・long safe integer境界・double 1e-6/1e15・0受理・-0拒否） | 成功 |
| P6-D17 | `p6-import.test.ts` | 既存検証パイプラインへの委譲（ホワイトリスト違反・教材制約違反・snapshot予算超過） | 成功 |
| P6-D18 | `p6-javacode.test.ts` | Javaコード表示（引用符・バックスラッシュのエスケープ） | 成功 |
| P6-D19 | `p6-javacode.test.ts` | Javaコード表示（任意部署名の変数割当・同名部署でdivision違い） | 成功 |
| P6-D20 | `p6-javacode.test.ts` | 受理された全境界値のJavaコード表示が正当なリテラルで指数表記が現れない | 成功 |
| P6-D21 | `p6-import.test.ts` | elementId再付番・provenanceの決定性 | 成功 |

### 9.2 Applicationテスト（P6-A）— `tests/application/p6-session.test.ts`

| ID | v0.10 §9の必須観点 | 結果 |
|---|---|---|
| P6-A01 | 取込成立時のシナリオ切替意味論 | 成功 |
| P6-A02 | 失敗時の現行シナリオ維持と理由の取得（P1-A08の目的継承） | 成功 |
| P6-A03 | プロンプト生成（§8の1〜8・一致検証値・dataset省略・実行不能templateでの不可・出力例のround-trip・**Contract変更への追随**） | 成功 |
| P6-A04 | revision発行の決定性 | 成功 |
| P6-A05 | 経路分離（取込は`Result`、fixtureは異常系throwのまま挙動不変） | 成功 |

### 9.3 React統合テスト（P6-R）— `tests/react/p6-app.test.tsx`

| ID | v0.10 §9の必須観点 | 結果 |
|---|---|---|
| P6-R01 | 取込UI構成・provenanceバッジ（fixtureと取込サンプルを混同しない） | 成功 |
| P6-R02 | コピー機能のフォールバック | 成功 |
| P6-R03 | 失敗時の理由表示と現行シナリオ維持（P1-R07の目的継承） | 成功 |
| P6-R04 | 取込成立表示（HTMLとして解釈しない・history初期化） | 成功 |
| P6-R05 | 実行不能templateでの無効化 | 成功 |
| P6-R06 | a11y・responsive | 成功 |

### 9.4 E2E・視覚テスト（P6-E）— `e2e/`

| ID | ファイル | v0.10 §9の必須観点 | 結果 |
|---|---|---|---|
| P6-E01 | `phase6.spec.ts` | 全体フロー（コピー → 貼付 → 合格 → 実行 → 履歴復元。Employee系・source slot型） | 成功 |
| P6-E02 | `phase6.spec.ts` | 不合格時の理由表示と現行シナリオ維持、修正後の再貼付 | 成功 |
| P6-E03 | `phase6.spec.ts` | 生成コードが実データと一致し構文的に正当 | 成功 |
| P6-E04 | `phase6.spec.ts` | 総点検回帰（既存E2E全件成功・AIボタン非存在・全Phase代表シナリオ） | 成功 |
| P6-E05 | `p6-capture.spec.ts` / `p6-narrow.spec.ts` | PC幅・狭幅の表示と基準画像の意図的更新 | 成功 |

### 9.5 JDK 25 Oracle Test（P6-O）

| ID | ファイル | v0.10 §9の必須観点 | 結果 |
|---|---|---|---|
| P6-O01 | `oracle/OracleP6.java` + `tests/domain/p6-oracleSync.test.ts` | 取込境界値のJDK 25照合 | PASS（完全一致） |
| P6-O02 | `tests/domain/p6-review.test.ts` + `oracle/run-oracle.mjs` | Oracle運用検証（必須suite・現行Phase単独書込み・過去artifacts不変） | PASS |

### 9.6 追加ID

| ID | 内容 | 理由 |
|---|---|---|
| P6-D22 | 全実行可能template × modeの総点検（終端到達・snapshot予算・Javaコード生成） | §10.1の総点検を常設の機械検証にするため、§12が許す末尾連番で追加（必須39 IDとは別） |

## 10. 既存P1〜P5必須IDの回帰結果と意図的更新

**回帰結果**: P1必須41 ID + P1-O01、P2必須52 ID、P3必須60 ID、P4必須72 ID（P4-O02 / P4-O03含む）、
P5必須59 ID は、下記の意図的更新を除き**変更なしで全成功**。

### 10.1 §12冒頭の表で許可された更新（6件）

| 現行テスト | 実施内容 | 理由 |
|---|---|---|
| P1-A08（`tests/application/session.test.ts`） | **廃止**（テスト本体を削除し、継承先を示すコメントを残置） | `AI_CAPABILITY`廃止により旧目的を維持できない。「利用者へ示す理由とUI状態の一致」はP6-A02が継承 |
| P1-R07（`tests/react/app.test.tsx`） | **廃止**（同上） | AIボタン廃止により旧目的を維持できない。「取込失敗時に現行シナリオを維持し理由を表示」はP6-R03、「ユーザー操作なしにシナリオが切り替わらない」「fixtureは固定サンプルと表示」はP6-R系とP2-A02が継承 |
| P2-A02（`tests/application/p2-session.test.ts`） | 末尾 `expect(app.aiCapability.available).toBe(false)` の**1行のみ削除**。テスト名の「fixture/AI表示」を「fixture/取込サンプル表示」へ | `aiCapability` 廃止。本体（provider種別を混同しない）は不変 |
| P5-R01（`tests/react/p5-app.test.tsx`） | AI理由の2 assertionを削除し、テスト名から「AI理由はPhase 6のまま維持される」を除去 | 取込UIの検証はP6-R系のみで行う（Phase 5 IDへPhase 6機能を混在させない） |
| 視覚回帰基準画像（`e2e/__screenshots__/`） | 既存20枚を取込UIを含む基準へ意図的更新 | §13 |
| P5-O02関連（`tests/domain/p5-review.test.ts`） | Phase 5時点のsuite構成を `P5_SUITES_FIXTURE` として固定するリファクタリング | P6-O01追加でライブ構成が変わったため。P4-O02 / P4-O03の前例に従い検証意味を保存。ライブ構成の検証はP6-O02が担当 |

### 10.2 上記以外の既存テスト変更

**なし**。「コンパイル不能または対象UI消滅で成立しなくなる既存assertion」は上記4件（P1-A08 / P1-R07 /
P2-A02 / P5-R01）以外に発見されなかった。

なお P1-E08（`page.locator('summary').click()`）は、取込UIを `<details>` で実装すると
strict mode violationで成立しなくなることが判明したが、これは**AI廃止に伴う破綻ではなく取込UIの追加**によるもので
§12の許可範囲外である。そのため**テストを変更せず**、v0.10 §8が許すもう一方の形式（常設パネル）を
選択して回避した（`docs/phase-6-decisions.md` §4）。P1-E08は無変更のまま成功している。

## 11. P6-O01 / P6-O02 の結果

- **JDKベンダー / バージョン**: Eclipse Temurin **OpenJDK 25.0.3+9-LTS**
  （Dockerイメージ `gradle:9.6.1-jdk25`。`java -version` 出力は `artifacts/phase-6/oracle-result.md`）
- **判定**: P6-O01 **PASS（完全一致）** / P6-O02 **PASS**
- 過去Phase suiteの回帰: P1-O01 / P2-O01 / P3-O01 / P4-O01 / P5-O01 すべてPASS（照合のみ・証跡書込みなし）、
  P4-O02（Long境界値の損失なし照合）PASS
- 実行前後で `artifacts/phase-1`〜`phase-5` のSHA-256が**不変**（run-oracle.mjsの実測）

### 11.1 照合ケース（取込相当candidateの実行結果）

| 区分 | 入力 | 照合値 |
|---|---|---|
| int32境界 | `arrayPrimitive` int `[2147483647, -2147483648]` | sum `-1` / average `-0.5` / stats count 2・sum `-1L`・min `-2147483648`・max `2147483647`・average `-0.5` |
| long safe integer境界 | `arrayPrimitive` long `[±9007199254740991]` | sum `0L` / stats count 2・sum `0L`・min `-9_007_199_254_740_991L`・max `9_007_199_254_740_991L`・average `0.0` |
| double境界 | `arrayPrimitive` double `[0, 1e-6, 1e15]` | boxed値 `0.0` / `0.000001` / `1000000000000000.0`、stats count 3・min `0.0`・max `1000000000000000.0` |
| Employee境界dataset | age 15・80、salary 0・99,999,999、evaluation 0.0・5.0 | counting 2 / summingInt 95 / averagingInt `47.5` / summingLong 99999999 / averagingLong `49999999.5` / summingDouble `5.0` / averagingDouble `2.5` |

### 11.2 境界値選定の判断

1. **double表記**: Javaの `Double.toString` は1e-3未満・1e7以上で指数表記になるため、
   1e-6 / 1e15をそのまま比較すると偽装不一致になる。値域を狭めるのではなく、
   Java側に `coreDouble()`（`BigDecimal(Double.toString(v)).stripTrailingZeros().toPlainString()` +
   小数点がなければ `.0`）を実装し、Simulation Coreの `formatDoubleLiteral` と**同一表記**へ揃えた。
   longも `longLiteral()`（3桁区切り + `L`）でCoreの `formatLongLiteral` に揃えた。
   比較方式は既存どおりJSON文字列の厳密照合のままである。
2. **DoubleStreamのsum / averageは照合対象外**: JDKは補償付き加算、Simulation Coreのprimitive Stream集計は
   素朴加算のため。double集計の照合は両側とも補償付きのCollectors側で行い、
   primitive Stream側は加算を伴わないcount / min / maxと値表示だけを照合する。
   この除外は `tests/domain/p6-oracleSync.test.ts` が機械検証している。
3. **int sumの組合せ**: `2147483647 + (-2147483648) = -1` と桁あふれしない組を選定した
   （Javaのint加算は桁あふれでラップするがJavaScriptはしないため、あふれる組は照合に使えない）。

詳細は `docs/phase-6-decisions.md` §7。

## 12. §10.1 総点検チェックリスト

**全実行可能template（109件） × supportedModes = 211組合せ**すべてで、
fixture経路の終端到達と取込経路の成立を確認した（結果は全件OK）。

| 検証項目 | 結果 |
|---|---|
| 初期snapshotから終端（`STREAM_CONSUMED`）まで到達 | 211 / 211 OK |
| snapshot件数が安全上限500以内（実測最大53件: `tmpl-filter-chain:standard`） | 211 / 211 OK |
| Javaコード表示が生成される | 211 / 211 OK |
| 取込経路（プロンプト生成 → 出力例の貼付 → 検証 → Scenario成立） | 211 / 211 OK |

- 機械検証: `tests/domain/p6-fullcheck.test.ts`（P6-D22、fixture経路）と
  `tests/application/p6-session.test.ts`（P6-A03、取込経路）
- 画面での代表確認: `e2e/phase6.spec.ts` の P6-E04（全Phase代表シナリオ9件の終端到達とAIボタン非存在）
- 取込経路の全経路確認（プロンプト生成 → 貼付 → 検証 → 実行 → 履歴復元）は
  Employee系（`tmpl-filter-basic`）とsource slot型（`tmpl-src-arrays-int`）の双方で P6-E01 が実施

実行不能template（`tmpl-src-generate` / `tmpl-src-iterate2`）は取込対象外であり、
`importabilityOf` が理由つきで `importable: false` を返すこと、
UIの教材Pipeline選択に現れないことを P6-R05 が確認している。

## 13. レスポンシブ最終調整と視覚回帰基準画像の意図的更新

### 13.1 レスポンシブ最終調整

- 取込UIのボタン行は `flex-wrap` で折り返し、貼付欄・フォールバック表示は `width: 100%` /
  `max-width: 100%` で親幅に収める。失敗理由リストは `overflow-wrap: anywhere` で長いpathを折り返す。
- 狭幅（375px）で **ページ全体の横スクロールが発生しない**ことを実測で確認（P6-E05-narrow）。
  取込UI表示時・検証失敗表示時・取込成立後・終端到達後の4状態すべてで確認。
- Pipelineは狭幅でも専用の横スクロールを維持（`pipeline-scroll`）。
- sticky再生バーが本文末尾（`details-disclosure`）を遮蔽しないことを実測で確認。
- キーボード操作: コピー / 貼付ボタン・貼付欄はnativeコントロールで `tabindex` を追加せず、
  Tab移動と Enter 実行で取込まで完了できる（P6-R06）。focus-visibleは既存の共通スタイルが適用される。
- reduced motion: 既存の `@media (prefers-reduced-motion: reduce)` が全要素へ適用される。
  reduced motion環境でも取込が成立することを P6-R06 で確認。

### 13.2 視覚回帰基準画像の意図的更新

**更新前に差分画像を生成して確認**し、変化領域が意図した3点（副題テキスト・AIボタン削除・取込パネル追加と
それに伴う下方シフト）だけであることを確認したうえで `--update-snapshots=changed` で更新した。
**thresholdの緩和は行っていない**（`playwright.config.ts` の `expect.toHaveScreenshot` は無変更）。

| 対象 | 枚数 | 区分 |
|---|---|---|
| `e2e/__screenshots__/phase1.spec.ts/`（p1-e11-initial / passed / rejected / completed） | 4 | 意図的更新 |
| `e2e/__screenshots__/phase2.spec.ts/`（p2-e10-map-applied / maptoint-applied / flatmap-child / empty-completed） | 4 | 意図的更新 |
| `e2e/__screenshots__/phase3.spec.ts/`（p3-e10-distinct-duplicate / sorted-order-confirmed / takewhile-stop / peek-action） | 4 | 意図的更新 |
| `e2e/__screenshots__/phase4.spec.ts/`（p4-e10-reduce-accumulator / statistics / anymatch-stop / optional-empty） | 4 | 意図的更新 |
| `e2e/__screenshots__/phase5.spec.ts/`（p5-e10-groupingby / partitioning-empty / collecting-and-then / teeing-merger） | 4 | 意図的更新 |
| `e2e/__screenshots__/p6-capture.spec.ts/`（p6-e05-import-panel / import-rejected / import-accepted / imported-completed） | 4 | 新規 |
| `e2e/__screenshots__/p6-narrow.spec.ts/`（p6-e05-narrow-import-panel / import-rejected / import-accepted） | 3 | 新規 |

既存**20枚**すべてが更新対象になった（全画面キャプチャのため、常設パネル追加でページ全体がシフトする）。
新規は**7枚**。

## 14. bundle分割検討の判断

**判断: 実施**。

| 項目 | 変更前 | 変更後 |
|---|---|---|
| chunk構成 | `index.js` 単一 | `react-vendor.js` + `index.js` |
| サイズ | 555.19 kB（gzip 144.52 kB）※取込UI追加後の実測 | 189.60 kB（gzip 59.60 kB）+ 365.08 kB（gzip 84.85 kB） |
| chunk size警告 | あり | **なし**（各chunkが500 kB未満） |

- 実装: `vite.config.ts` の `build.rolldownOptions.output.codeSplitting.groups` で
  `react` / `react-dom` / `scheduler` を静的な別chunkへ分離
  （Viteの警告が案内する `codeSplitting` を使用。`advancedChunks` は非推奨警告が出ることを実測で確認）。
- **挙動不変の根拠**: `dynamic import()` は使用しない。`dist/index.html` は entry chunkを
  `<script type="module">`、vendor chunkを `<link rel="modulepreload">` として両方初回に読み込むため、
  遅延ロードは発生せず初回描画のタイミングは変わらない。分割後もE2E 72件が全成功する。

## 15. PC幅 / 狭幅キャプチャの保存先

`artifacts/phase-6/`（`e2e/capture-helper.ts` の `CAPTURE_TARGET_PHASE = 6` により、
現行Phaseだけが書き込む。過去Phaseのcapture specは無変更）。

| ファイル | 内容 |
|---|---|
| `capture-pc-import-panel.png` | PC幅・取込UI初期状態 |
| `capture-pc-copy-feedback.png` | PC幅・プロンプトコピーのフィードバック |
| `capture-pc-import-rejected.png` | PC幅・検証失敗表示（code / path / message） |
| `capture-pc-import-accepted.png` | PC幅・取込サンプル成立 |
| `capture-pc-imported-completed.png` | PC幅・取込サンプル実行完了 |
| `capture-pc-imported-source-slot.png` | PC幅・source slot型templateの取込サンプル実行完了 |
| `capture-narrow-import-panel.png` | 狭幅・取込UI初期状態 |
| `capture-narrow-import-rejected.png` | 狭幅・検証失敗表示 |
| `capture-narrow-import-accepted.png` | 狭幅・取込サンプル成立 |
| `capture-narrow-imported-completed.png` | 狭幅・取込サンプル実行完了 |
| `capture-narrow-source-slot.png` | 狭幅・source slot型templateの取込UI |
| `oracle-result.md` | P6-O01 / P6-O02のJDK 25照合結果 |

## 16. 仕様との差異と実装判断

**仕様（v0.10・v0.8）との差異はない。** 仕様書（v0.8 / v0.9 / v0.10 / 統合docx）は一切編集していない。

v0.10が実装判断へ委譲した事項と、Contractを仕様より厳しくした箇所は
`docs/phase-6-decisions.md` に記録した（主な項目）:

| # | 判断 | 参照 |
|---|---|---|
| 1 | Import Contractの配置とspec木方式・既存slot定義からの導出 | decisions §1 |
| 2 | `limit` / `skip` 引数をint32範囲へ厳格化（包含関係の維持） | decisions §2 |
| 3 | 変数識別子契約へ生成コードの予約識別子（`result` / `employees` / `counter` / `e` / `n` / `a` / `b` / `acc`）を追加 | decisions §3 |
| 4 | 取込UIを常設パネルにした理由（P1-E08への非影響） | decisions §4 |
| 5 | プロンプト文面の設計と出力例のfixture素材化・title上限の例外処理 | decisions §5 |
| 6 | E2Eクリップボード検証方式（フォールバック経路の活用・CRLF正規化） | decisions §6 |
| 7 | Oracle境界値の選定（double / long表記の揃え方、DoubleStream sumの除外） | decisions §7 |
| 8 | bundle分割の実施判断 | decisions §8 |
| 9 | 取込候補を保存しない（localStorage等の不使用） | decisions §9 |
| 10 | ヘッダー副題の更新・改修前goldenの固定・P6-D22追加・P5-O02のfixture化 | decisions §11 |

`evaluation` の値域について: v0.10 §6.2は `0.0〜5.0`（NaN / Infinity / -0拒否）と定めており、
DSL double要素の下限1e-6は適用されない。1e-6未満の正の値（例 `1e-7`）はContractが受理し、
`formatDoubleLiteral` は `1e-7` を出力する。これはJavaのfloating literal文法
（`Digits ExponentPart`）として**正当なdoubleリテラル**であり、
「Contractが受理する値 ⊆ formatterが正当に変換できる値」は保たれている（P6-D20で明示的に検証）。

## 17. 既知の問題と持越し事項

- **既知の問題**: なし。
- **持越し**（Phase 7以降）:
  - Phase 7（Gatherers、v0.9）は未着手。gather DSLは未実装のため取込対象外のまま。
    「取込候補へgather DSLを開放するか」の判断はPhase 7中に行う（v0.10 §1.3）。
  - 取込候補の保存・再利用（localStorage等）は将来拡張（v0.10 §10-7）。本Phaseでは保存しない。
  - `Collectors.toMap()` はDraft v0.8 付録A.4の対象外のため未実装（Phase 5からの継続）。

## 18. 最終的な変更範囲とcommit / push / PRの状況

### commit列

Phase 6実装指示 §18により、実装中はcommit / push / PR / mergeを行わなかった。
**ユーザーの明示指示（レビュー完了後）を受けて**、次のとおりcommitとpush、PR作成を実施した。
**`main`へのmergeは実施していない**（指示に含まれていないため）。

| commit | 内容 |
|---|---|
| `d5c63da` | （Phase 6着手前）Phase 6実装指示書の追加 |
| `8ea82c5` | Phase 6本体（82ファイル、+10544 / -216）。src / tests / e2e / oracle / artifacts/phase-6 / 視覚回帰基準画像 / README / vite.config.ts |
| `<docs-commit>` | Phase 6完了報告と判断記録（`docs/phase-6-completion-report.md` / `docs/phase-6-decisions.md`） |

Pull Request: `<pr-url>`（base `main` / head `phase-6`。**未merge**）

### commitに含めなかったファイル（意図的）

前例（Gatherers差分・Phase 6指示書）に従い、次の運用ファイルは未追跡のまま保持している。

- `docs/phase6_start_request.md`（実装開始依頼文）
- `docs/codex_review_request_P6_Implementation_Instructions.md`（codexレビュー依頼文）

### commit直前の変更範囲

### `git diff --check`

改行・空白の問題なし（CRLF変換の警告のみで、内容の問題ではない）。

### `git diff --stat`（追跡済みファイルの変更）

```
 README.md                                          |  73 +++++++---
 e2e/__screenshots__/... （既存基準画像20枚）        | Bin（意図的更新）
 e2e/capture-helper.ts                              |   2 +-
 oracle/oracle-lib.mjs                              |  85 +++++++++---
 oracle/run-oracle.mjs                              |  25 ++--
 src/domain/catalog/operationCatalog.ts             |   3 +-
 src/domain/catalog/operations.ts                   |   2 +-
 src/domain/dsl/javaCode.ts                         | 100 ++++++++++----
 src/domain/scenario/scenario.ts                    |  15 ++-
 src/domain/template/pipelineTemplate.ts            |   2 +-
 src/domain/types/result.ts                         |   8 ++
 src/providers/fixtureScenarioProvider.ts           |   2 +-
 src/providers/scenarioProvider.ts                  |  20 ++-
 src/ui/App.tsx                                     |   4 +-
 src/ui/appInstance.ts                              |  97 ++++++++++++-
 src/ui/components/ScenarioControls.tsx             |  29 ++--
 src/ui/styles.css                                  | 109 +++++++++++++--
 tests/application/p2-session.test.ts               |   5 +-
 tests/application/session.test.ts                  |  12 +-
 tests/domain/p5-review.test.ts                     | 150 +++++++++++++--------
 tests/react/app.test.tsx                           |  19 +--
 tests/react/p5-app.test.tsx                        |   6 +-
 vite.config.ts                                     |  20 +++
 42 files changed, 572 insertions(+), 216 deletions(-)
```

### `git status --short`（未追跡ファイル）

```
?? artifacts/phase-6/
?? docs/codex_review_request_P6_Implementation_Instructions.md   ← 開始時から存在（運用ファイル）
?? docs/phase6_start_request.md                                  ← 開始時から存在（運用ファイル）
?? docs/phase-6-completion-report.md
?? docs/phase-6-decisions.md
?? e2e/__screenshots__/p6-capture.spec.ts/
?? e2e/__screenshots__/p6-narrow.spec.ts/
?? e2e/p6-capture.spec.ts
?? e2e/p6-narrow.spec.ts
?? e2e/p6-utils.ts
?? e2e/phase6.spec.ts
?? oracle/OracleP6.java
?? oracle/expected-p6-from-core.json
?? src/application/candidateImport.ts
?? src/application/importContract.ts
?? src/application/promptGenerator.ts
?? src/ui/components/ImportPanel.tsx
?? tests/application/p6-session.test.ts
?? tests/domain/p6-contract.test.ts
?? tests/domain/p6-fullcheck.test.ts
?? tests/domain/p6-import.test.ts
?? tests/domain/p6-javacode.test.ts
?? tests/domain/p6-oracleSync.test.ts
?? tests/domain/p6-review.test.ts
?? tests/fixtures/
?? tests/p6-helpers.ts
?? tests/p6-oracle-expected.ts
?? tests/react/p6-app.test.tsx
```

### 実施していないこと

- **`main` へ merge していない**（ユーザー指示はcommit / push / PR作成までのため）
- `docs/phase-1〜5-completion-report.md` / `docs/phase-1〜5-decisions.md` /
  `artifacts/phase-1`〜`phase-5` を**変更していない**（`git status` に現れないことで確認）
- 仕様書（v0.8 docx / v0.9 md / v0.10 md / 統合docx）を**変更していない**
- 開始時から存在した未追跡2件（`docs/phase6_start_request.md` /
  `docs/codex_review_request_P6_Implementation_Instructions.md`）を stash / 削除 / 上書きしていない

### §13の追加確認項目

| # | 確認内容 | 結果 |
|---|---|---|
| 3 | `src`・`tests`・`e2e` に `AI_CAPABILITY` / `aiCapability` / `RemoteScenarioProvider` / AI SDK / AI向けHTTP接続が存在しない | grepで0件。`package.json` の依存もReact系とテスト基盤のみで追加なし |
| 4 | `eval`・`new Function`・動的コード生成が取込経路にも存在しない | grepで0件（`src` 全体）。`dangerouslySetInnerHTML` も0件 |
| 5 | 取込UIからv0.10 §5.1の全体フロー（コピー → 貼付 → 合格 / 不合格）をPC幅・狭幅で目視確認 | `artifacts/phase-6/` のPC幅6枚・狭幅5枚で確認 |
| 6 | §10.1の総点検チェックリスト完了 | §12（211組合せ全OK） |
| 7 | 視覚回帰の期待画像の更新がすべて意図的（diff確認済み） | §13.2 |
| 8 | E2E・Oracleの書込み対象が `artifacts/phase-6` のみ | `git status` で `artifacts/phase-1`〜`phase-5` に変更なし。Oracleランナーの実測でもSHA-256不変 |
| 9 | bundle分割の判断と根拠が記録されている | §14・decisions §8 |
