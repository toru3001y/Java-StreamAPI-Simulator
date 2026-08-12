# Phase 6 判断記録（手動連携）

Phase 6実装中に行った、仕様本文を変更しない範囲の実装判断を記録する（Phase 6指示 §14、v0.10 §10）。
仕様の正は `docs/Java_Stream_API_Visualization_Spec_v0.10_Phase6_ManualLink.md`（v0.10）と
`docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`（v0.8）であり、本書はそれらを変更しない。

基準コミット: `ad7f37c0b9403bf29633ec9348a17a64c1033a22`（`main`）
作業ブランチ: `phase-6`

---

## 1. Import Contractの実装配置と既存slot定義との統合方法（v0.10 §10-4）

**配置**: `src/application/importContract.ts`（Application層）。Simulation Coreへ依存し、依存されない。

**方式**: スロットごとの許可DSLを**宣言的なspec木**（`SpecNode`）として表現し、これを単一定義源とする。

| spec node | 用途 |
|---|---|
| `const` / `enum` | 固定値・許可値の列挙（`collectionId`、operator、field等） |
| `string` | 自由文字列（min / max UTF-16 code unit、制御文字・双方向制御文字の拒否を含む） |
| `identifier` | Java変数名として埋め込まれる文字列（変数識別子契約） |
| `int` / `long` / `double` / `count` / `numberByPrimitive` | 数値の値域（§7.5の確定値） |
| `boundedInt` / `boundedDouble` / `isoDate` | datasetのage / salary / evaluation / hireDate |
| `array` | 件数範囲・重複禁止（`unique: 'value' \| 'field'`） |
| `object` | `kind`を持たない正規object（literal、iterateのoperator / predicate、Comparator key、identity、StringConst、department、dataset要素） |
| `unionByKind` / `unionByType` | `kind` / `type`で判別するUnion |
| `nullable` | 明示nullの許可（joining delimiter、groupingByのmapFactoryId / downstream等） |
| `collector` | Collector ASTの再帰参照（許可kindと深さ上限4を伴う） |

**既存slot定義との統合**: `buildTemplateContract(template)` が `PipelineTemplate.parameterSlots` の
`allowed*`（`allowedMapperKinds` / `allowedComparatorKinds` / `allowedFields` / `allowedOperators` /
`allowedCollectorKinds` / `allowedElementTypeNames` / `allowedReductionKinds` / `allowedConsumerKinds`）と
`sourceDefinition.allowedSourceKinds` から**導出**する。Contract側で新しい許可範囲を発明せず、
既存定義に無い部分（schema nodeごとの許可キー集合・値域・件数上限・組合せ規則）だけを補う。

**dataset要否の導出**: `sourceDefinition` が `collection` を使うtemplate（`usesEmployeeDataset`）は
`datasetPolicy: 'required'`、それ以外は `'forbidden'`。v0.10 §5.1の「Employee系は必須 / source slot型は禁止」を
template定義から機械的に決める（一覧をハードコードしない）。

**`TemplateContract`が持つspecの範囲**: スロットのspecだけでなく、
**トップレベルのキー集合（`topLevelKeys`）とキー型（`topLevelTypes`）、予約キー
（`reservedTopLevelKeys` / `reservedDatasetKeys`）、`datasetSpec`、`titleSpec`、`descriptionSpec`、
`textMaxLength`** もContractへ含める。
これにより、プロンプト生成と前段検証が**同一のspecノードを走査する**構造になり、
片方だけがフィールド構造・値域・キー集合を別経路で組み立てることがない。
`datasetSpec` はEmployee系templateでのみ非nullで、`topLevelKeys` も `datasetPolicy` を反映済みである。

**参照箇所は2つだけ**: `promptGenerator.ts`（`describeSpec`でContractのspecノードを自然文へ言語化）と
`candidateImport.ts` → `validateCandidateShape`（同じspecノードで検証）。
機械可読な許可範囲はこの1モジュールにしか存在しない。
P6-D01が、①Contractがこれらのspecを保持すること、
②`promptGenerator.ts` / `candidateImport.ts` に許可値リテラルやdataset fieldの再記述が存在しないこと
（ソースのgrep検証）を機械検証する。
P6-A03が、③プロンプト本文にContractの `describeSpec` 出力がそのまま含まれること、
④**slot定義を変えた仮想template**（`allowedConsumerKinds` / `allowedFields` / `sourceDefinition` を差し替え）で
プロンプトの記述が実際に追随することを検証する。

### 1.1 Contractが既存検証より厳しくした点（§7.3「同等または厳しい」に該当）

いずれも既存の**構造**検証（手順1）の受理範囲を狭める方向であり、Contract受理 ⇒ 構造検証受理は
P6-D03（全実行可能template × 全slot variantの代表形状）で機械検証している。

1. `fieldCompare`のリテラル型をfieldで固定する（`age` = int、`salary` = long）。既存では
   `validateTypes`（手順4）が拒否するが、前段で拒否した方が理由が具体的になる。
2. `fieldCompare`で扱えるEmployee fieldをint / long fieldに限る。`evaluation`（double）は
   DSLリテラルにdouble型が無く既存型検証で必ず失敗するため、Contractでは許可しない。
3. `reducing`のreductionを `numericSum` / `stringConcat` に限る（`employeeFieldSum`は
   1引数reducingでは成立せず、既存の型解決で必ず失敗するため）。
4. `fieldToPrimitive`のfieldとprimitiveの対応（age = int / salary = long / evaluation = double）を
   前段で強制する。
5. `mapper.fieldAccess`のfieldをEmployeeの8フィールドに限る（既存は非空文字列なら構造検証を通る）。
6. `empty`ソースの `streamType` / `elementTypeName` を固定4組に限る（v0.10 §6.3）。
7. `limit` / `skip` の引数を **0〜2,147,483,647** に限る（下記§2）。

---

## 2. limit / skip引数をint32範囲へ制限した判断

v0.10 §6.4のDSL数値値域は `int` / `long` / `double` 要素を定めるが、`count` slot（limit / skip引数）の
上限は明示していない。既存検証（`validateCount`）は「safe integerかつ0以上」である。

生成Javaコードは `.limit(${count})` の形で**サフィックスなしの整数リテラル**を出力する。
Javaの整数リテラルはint範囲を超えると `L` サフィックスが必須（超過は "integer number too large" の
コンパイルエラー）であるため、safe integerをそのまま受理すると
「Contractが受理する値 ⊆ formatterが正当に変換できる値」（v0.10 §7.3-4）が破れる。

**判断**: formatter（`javaCode.ts`）を拡張せず、Contract側を **0〜int32最大** へ厳格化した。
Phase 6指示 §17の停止条件（包含関係を満たせない値の発見）には該当させず、
「Contractは既存検証と同等または厳しい範囲に限る」（v0.10 §5.2）の範囲内で解決している。
全fixtureのcountは0〜5であり、互換性テスト（P6-D02）に影響しない。

---

## 3. 変数識別子契約へ「生成コードが使う識別子」を追加した判断

v0.10 §6.3の変数識別子契約は `^[a-z][A-Za-z0-9]{0,19}$` ＋ Java予約語・リテラルの拒否である。
これだけでは、生成Javaコードが常に使う識別子と衝突する候補を受理してしまう。

| 衝突する識別子 | 生成コードでの用途 | 衝突時に起きること |
|---|---|---|
| `result` | `List<X> result = ...` | 同一スコープでの変数重複宣言 |
| `employees` | `List<Employee> employees = List.of(...)` | 同上 |
| `counter` | `AtomicInteger counter = new AtomicInteger(0)` | 同上 |
| `e` / `n` / `a` / `b` / `acc` | lambda引数（`e -> e.age() >= 30` 等） | ローカル変数を隠すlambda引数はJavaでコンパイルエラー |

**判断**: `GENERATED_CODE_IDENTIFIERS` としてこれらを追加拒否する。
v0.10 §9の完了条件「Javaコード表示が構文的に正当で実データと一致」を満たすための、
Contract側での厳格化（許可範囲を狭める方向）であり、仕様の変更ではない。
Java予約語リストには文脈キーワード（`var` / `yield` / `record` / `sealed` / `permits`）も安全側で含めた。

---

## 4. 取込UIの具体形式とReact状態管理方式（v0.10 §10-1）

**形式**: **常設パネル**（`src/ui/components/ImportPanel.tsx`）。v0.10 §8が許す2形式
（`<details>` 折りたたみ / 常設パネル）のうち後者を選択した。

**理由**: `<details>` にすると画面内の `<summary>` が2つになり、既存の
P1-E08（`page.locator('summary').click()`）がstrict mode violationで成立しなくなる。
Phase 6指示 §12冒頭が許可する既存テスト更新は「providerKind型変更・AIボタン削除に伴い
成立しなくなるassertion」に限られており、取込UIの**追加**に伴う変更は許可範囲外である。
仕様が明示的に許す常設パネルを選ぶことで、Phase 1〜5テストへ一切影響させずに実装した。
配置は `ScenarioControls` の直下（v0.8 §17.1の「操作選択・シナリオ」領域の直後）。

**状態管理**: 現行UIは `useState` 未使用だが、v0.10 §10-1が許可する標準手段として `useState` を新設した。
保持するのは次の3つのUI一時状態だけで、いずれもsnapshot履歴の復元対象にしない。

- `pastedText`: 貼付テキスト
- `copyState`: コピー成否フィードバック（`idle` / `copied` / `fallback`＋全文）
- `importState`: 取込結果（`idle` / `accepted`＋title / `rejected`＋issues）

既存のセッション購読（`useSyncExternalStore`）と描画方式は変更していない。
結果・型・蓄積状態はUIで独自計算せず、Applicationが返す `Result` をそのまま表示する。

**a11y**: 失敗理由は `aria-live="polite"` の領域に出し、状態は色だけでなく記号（`✓` / `!` / `×`）と
文言でも識別できるようにした（v0.8 §17.5）。モーダルダイアログは使用していない。

---

## 5. プロンプト文面の設計（v0.10 §10-2）

- **言語・文体**: 日本語・Markdown。見出しで「対象の教材Pipeline」「JSONのトップレベル」
  「dataset契約」「スロットごとの許可DSL」「教材制約」「snapshot予算」「出力形式」「出力例」を分ける。
- **許可DSLの言語化**: `describeSpec` がImport Contractのspec木を再帰的に自然文へ変換する。
  Contract以外に許可範囲を書かないため、slot定義を変えればプロンプトも自動的に追随する。
- **教材制約の説明**: mode別（standard / midEmpty / emptySource）と対象操作別（filter / map / distinct /
  sorted / limit / takeWhile / dropWhile / peek / flatMap系）の補助的な自然文。
  検証の正は `instantiateTemplate` の手続き検証であり、この文面は説明のみ（v0.10 §5.2）。
- **出力例（§8-8）**: 現在選択中のtemplate × modeの**fixtureを素材**に、貼付JSONの形へ組み立てる
  （`providerKind` / `provenance` / `revision` / `elementId` は含めず、`dslVersion` 等を明記）。
  実在の検証済みデータなので、例をそのまま貼り戻しても必ず取込が成立する。
  この性質は P6-A03 が全実行可能template × modeで機械検証している。
- **titleの例外処理**: 一部fixtureのtitle（例: `collect(teeing(...)...)標準` = 72文字）はContractの
  上限60文字を超える。例が貼り付け不能になるのを避けるため、上限を超える場合だけ
  `${templateId}の取込サンプル（${modeラベル}）` へ差し替える。
- 例に使うfixtureは、表示中シナリオのrevision採番へ影響させないため
  **専用の`FixtureScenarioProvider`インスタンス**から取得する。

---

## 6. E2Eクリップボード検証方式（Phase 6指示 §12.4）

`e2e/p6-utils.ts` の `copyPrompt` は次の順で全文を取得する。

1. Playwrightの `context.grantPermissions(['clipboard-read', 'clipboard-write'])` を試みる。
2. 「プロンプトをコピー」クリック後、フォールバック表示（`copy-fallback-text`）があればその値を使う。
3. なければ `navigator.clipboard.readText()` を読む。
4. 読取り結果にプロンプト見出しが含まれない（権限なし・非フォーカス等）場合は、
   ページ側の `navigator.clipboard.writeText` を失敗させて**フォールバック表示経路**を発生させ、
   `<textarea readOnly>` から全文を取得する。

4の経路は v0.10 §5.2 が要求する「コピー失敗時のフォールバック表示」そのものであり、
権限が使えない環境でも検証を継続でき、かつフォールバック経路の成立も同時に確認できる。

**Windowsの改行正規化**: クリップボード経由で取得したテキストは改行がCRLFへ正規化されるため、
`normalizeNewlines` でLFへ戻してから比較・抽出する（実測で確認）。

---

## 7. Oracle境界値の選定判断（Phase 6指示 §12.5）

### 7.1 double表記の揃え方

JavaScriptの `String()` は絶対値1e-6以上1e21未満で指数表記へ切り替わらないが、
Javaの `Double.toString` は **1e-3未満・1e7以上**で指数表記（`1.0E15`）になる。
v0.10 §6.4のdouble値域（0 または 1e-6〜1e15）の境界をそのまま10進文字列で比較すると、
値が一致していても表記差で**偽装不一致**になる。

**判断**: 値域を狭めるのではなく、**両側の表記を揃える**。

- Simulation Core側: 既存の `formatDoubleLiteral`（`Number.isInteger(n) ? \`${n}.0\` : String(n)`）の出力を使う。
- Java側（`OracleP6.java`）: `coreDouble(double)` =
  `new BigDecimal(Double.toString(v)).stripTrailingZeros().toPlainString()` に小数点が無ければ `.0` を付す。

JDK 19以降の `Double.toString` は最短往復表記を返すため、BigDecimalで指数部を平坦化すると
JavaScriptの `String()` と同じ数字列になる。実測での対応:

| 値 | Core（formatDoubleLiteral） | Java（coreDouble） |
|---|---|---|
| 0 | `0.0` | `0.0` |
| 1e-6 | `0.000001` | `0.000001` |
| 1e15 | `1000000000000000.0` | `1000000000000000.0` |
| -0.5 | `-0.5` | `-0.5` |
| 49999999.5 | `49999999.5` | `49999999.5` |

longも同様に、Coreの `formatLongLiteral`（3桁区切り + `L`）へJava側の `longLiteral(long)` を合わせた。
比較方式そのものは既存どおり **JSON文字列の厳密照合**である（numberへ変換しない）。

### 7.2 DoubleStreamのsum / averageを照合対象から外した判断

JDKの `DoubleStream.sum()` / `average()` と `Collectors.summingDouble` / `averagingDouble` は
**補償付き加算**（Kahan相当）を使う。Simulation Core側は、Collector経路は補償付き
（`collectorRuntime.ts` の `compensatedSum`）だが、primitive Stream集計（`stepEngine.ts`）は
**素朴加算**である。この差は値域境界の照合とは無関係なノイズになるため、

- `DoubleStream` の `sum` / `average`（および `summaryStatistics` の sum / average）は照合対象に含めない。
- doubleの境界値（0 / 1e-6 / 1e15）は `boxed().toList()` の値表示と
  `summaryStatistics()` の **count / min / max**（加算を伴わない）で照合する。
- double集計の照合は、両側とも補償付きである **Collectors側**（`summingDouble` / `averagingDouble`）で行う。

この除外は `tests/domain/p6-oracleSync.test.ts` が機械検証している（該当キーが存在しないこと）。

### 7.3 照合ケース

| 区分 | 入力（取込相当candidate） | 照合する値 |
|---|---|---|
| int32境界 | `arrayPrimitive` int `[2147483647, -2147483648]` | sum（-1、桁あふれなし）/ average（-0.5）/ count / sum / min / max / average（stats） |
| long safe integer境界 | `arrayPrimitive` long `[±9007199254740991]` | sum（0）/ count / sum / min / max / average（stats） |
| double境界 | `arrayPrimitive` double `[0, 1e-6, 1e15]` | boxed値の表示3件 / count / min / max |
| Employee境界dataset | age 15・80、salary 0・99,999,999、evaluation 0.0・5.0 | counting / summingInt / averagingInt / summingLong / averagingLong / summingDouble / averagingDouble |

int境界のsumは `2147483647 + (-2147483648) = -1` で**桁あふれしない**組合せを選んだ
（Javaのint加算は桁あふれ時にラップするが、JavaScriptはしないため、あふれる組合せは照合に使えない）。

---

## 8. bundle分割の判断（Phase 5持越し。Phase 6指示 §10.3）

**実施する**（判断: 実施）。

- 変更前: 単一chunk **555.19 kB**（gzip 144.52 kB）でViteのchunk size警告あり。
- 変更後: `react-vendor` **189.60 kB**（gzip 59.60 kB）+ `index` **365.08 kB**（gzip 84.85 kB）。
  両chunkとも500 kB未満となり警告は消えた。

`vite.config.ts` の `build.rolldownOptions.output.codeSplitting.groups` で
`react` / `react-dom` / `scheduler` を静的な別chunkへ切り出した
（Viteの警告メッセージが案内する `codeSplitting` を使用。`advancedChunks` は非推奨警告が出ることを実測で確認）。

**挙動不変の根拠**: `dynamic import()` は使っていない。ビルド後の `dist/index.html` は
entry chunkを `<script type="module">`、vendor chunkを `<link rel="modulepreload">` として
どちらも初回に読み込むため、遅延ロードは発生せず初回描画のタイミングは変わらない。
E2E 72件（視覚回帰20件の意図的更新後の基準画像を含む）が分割後も全成功する。

---

## 9. 取込候補の保存・再利用（v0.10 §10-7）

**本Phaseの対象外**。取込候補は**保存しない**。

`localStorage` / `sessionStorage` / IndexedDB / Cookieのいずれも使用していない。
貼付テキストはReactの `useState` にのみ保持し、リロードで失われる。
取込が成立した候補データはScenario / snapshotの一部としてセッション内の履歴復元対象になるが、
セッションを越えて永続化しない。

---

## 10. §7で確定済みの項目（実装との差異なし）

Phase 6指示 §7で確定済みの次の項目は、確定値のまま実装しており差異はない。

- ValidationCode 4件: `IMPORT_SIZE_LIMIT` / `IMPORT_PARSE` / `IMPORT_SCHEMA` / `IMPORT_CONTEXT_MISMATCH`
- revision形式: `${templateId}:${mode}:imp${counter}`（セッション内1始まりの単調増加。
  現在のrevisionと一致する場合は再採番）
- 部署変数名: `name` + `division` の組で同一性判定。固定表（`(開発部, 技術本部)` → `development`、
  `(営業部, 営業本部)` → `sales`）＋未対応組は出現順 `dept1`, `dept2`…（採番は未対応組のみ）
- `elementId` 再付番: `imp-001`〜`imp-008`
- provenance: `{ providerKind: 'IMPORTED', generatedAt: UTC ISO 8601, dslVersion: DSL_VERSION }`

---

## 11. その他の実装判断

### 11.1 ヘッダー副題の更新

`src/ui/App.tsx` の副題を「Phase 5: Collectorと可変リダクション（Java SE 25基準）」から
「Phase 6: 手動連携による候補の取込（Java SE 25基準）」へ更新した。
表示テキストのみの変更で、機能・検証には影響しない（視覚回帰の意図的更新に含まれる）。

### 11.2 テスト側の判断

- **改修前goldenの固定**: P6-D18の「全fixtureのJavaコード出力が改修前後で不変」を実証するため、
  基準コミット `ad7f37c` の一時worktreeで全fixture（template × supportedModes）のJavaコード行を採取し、
  `tests/fixtures/fixture-javacode-before-p6.json`（約139 KB）としてリポジトリへ固定した。
- **P6-D22の追加**: §10.1の総点検（全実行可能template × modeの終端到達・snapshot予算・Javaコード生成）を
  機械検証として常設化するため、§12が許す末尾連番でP6-D22を追加した（必須39 IDとは別の追加1件）。
- **P5-O02のfixture化**: Oracle suite構成がPhase 6で変わったため、`tests/domain/p5-review.test.ts` を
  Phase 5時点の構成（`P5_SUITES_FIXTURE`）を渡して同じ契約を検証し続ける形へ変更した
  （P4-O02 / P4-O03の前例。検証意味は変更・緩和していない）。
  Phaseラベル・ID名・注記は `buildCurrentPhaseOracleIdSection` の引数として切り出し、
  現行Phase（P6）とfixture（P5）の双方が同じ関数を使う。
