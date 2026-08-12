# Phase 7 判断記録（Gatherers）

Phase 7実装で行った、仕様本文（v0.8 / v0.9 / v0.10）を変更しない範囲の実装判断を記録する。
根拠の正は `docs/Java_Stream_API_Visualization_Spec_v0.9_Gatherers.md`（v0.9）と
`docs/Claude_Code_Phase7_Implementation_Instructions.md`（Phase 7指示）である。

- 基準コミット: `7664dad00a55095f018bf1f1abd79faa958bde72`（PR #7 merge commit）
- 作業ブランチ: `phase-7`
- 実装日: 2026-08-12

---

## 1. 累積評価を `evaluateReduction.ts` と独立実装した判断（指示§7.4-4、v0.9 §8.3）

**判断**: Gatherer専用の `src/domain/dsl/evaluateGather.ts` を新設し、Terminal DSL用の
`evaluateReduction.ts` は**呼ばず・変更もしない**。

**理由**:

- 既存 `identityToSimValue` / `applyReduction` は **primitive kind**（`int` / `long` / `double`）で
  累積する。これはPhase 4のreduce（primitive Stream・3引数reduce）の意味論に合わせた設計である。
- `Stream.gather` は `Stream<T>` にのみ存在し、型引数T / Rは**参照型（boxed型）**である（v0.9 §2.2・§8.3）。
  gatherの累積値は `boxedInt` / `boxedLong` / `boxedDouble` でなければ、TypeRefが
  `Integer` / `Long` / `Double` にならず、型遷移表示とJavaコード表示が食い違う。
- 共通化して `applyReduction` の kind 分岐へ boxed を足すと、Phase 4の既存受理範囲・表示
  （primitive名とwrapper名を混同しない規律）を変えるリスクがある。v0.9 §1.2「完了済みPhaseの
  契約は変更しない」に反する。

**実装**: `GATHER_BOXED_KIND_BY_IDENTITY_TYPE`（`int → boxedInt` / `long → boxedLong` /
`double → boxedDouble` / `string → string`）を boxed変換契約として明示し、
`gatherInitialToSimValue` / `applyGatherAccumulation` で累積する。
Java Stringは元から参照型のため boxed 相当のvariantを設けない。

**検証**: P7-D07（boxed変換契約・累積後のTypeRefが `Long` になること）、
P7-D03（`REDUCTION_FIELD_WHITELIST` が `['salary', 'age']` のまま不変であること）。

---

## 2. `stringList` と `list` の並存と役割分担（指示§7.2、v0.9 §6.3-1）

**判断**: `SimValue` へ `list` variant を追加し、既存 `stringList` は**不変のまま並存**させる。
既存経路の `stringList` を `list` へ移行しない。

**役割分担**:

| variant | 役割 | 生成箇所 | 表示 |
|---|---|---|---|
| `stringList` | Phase 2からの `List<String>` 専用値。`listStream` mapperの入力、`nestedStringList` sourceの要素 | `materializeSource.ts` / `evaluateMapper.ts` | `[Java, SQL]`（要素をクォートせずjoin） |
| `list` | Phase 7の**合成List値**。gatherのwindow系が生成する窓 | `stepEngine.ts` の `emitGatherWindow` | `["Java", "SQL"]`（要素を `formatSimValue` で再帰整形） |

**理由**: 既存経路の表示・型・テストを一切変えないため。`stringList` を `list` へ置換すると
`formatSimValue` の出力が変わり（クォートの有無）、Phase 2〜6のfixture表示・視覚回帰基準画像・
`distinctKey` が影響を受ける。v0.9 §1.2の「完了済みPhaseの契約は変更しない」に反する。

`list` は要素0件でも型が確定するよう `elementType` を**自己保持**する（復元契約の頑健性）。
Phase 7では窓が空になることはないが、`typeOfSimValue` が値だけから型を返せる状態を保つ。

**検証**: P7-D07（`list` の整形・型解決、既存 `stringList` の表示・型・distinctKeyの不変）。

---

## 3. SimValue網羅switchの棚卸しと `EngineInvariantError` 化（指示§5.2、P7-D07）

`list` variant追加に対し、SimValueを kind で分岐している全箇所を棚卸しした結果は次のとおり。
Phase 7範囲（gatherの下流はtoList / findFirstのみ。v0.9 §8.4）で `list` が到達しない箇所は
**`EngineInvariantError`** で塞ぎ、silentな誤動作を起こさない。

### 3.1 例外型がフェイルセーフ契約である理由

例外型の統一は名前の問題ではない。`SimulationSession.step`（`src/application/session.ts`）は
**`EngineInvariantError` だけを捕捉**してタイマーを解除し、最後の確定snapshotとhistoryを保持したまま
`ERROR` へ遷移する（J-3のフェイルセーフ）。plain `Error` は再送出されるため、同じ内部不整合でも
復帰可能性が変わる。したがって棚卸し箇所は例外型まで揃える必要がある。

### 3.2 棚卸し結果（14箇所）

| # | 箇所 | 分岐形式 | `list` の扱い |
|---|---|---|---|
| 1 | `src/domain/model/value.ts` `formatSimValue` | 網羅switch | **実装**（要素を再帰整形し `[要素1, 要素2]`） |
| 2 | `src/domain/model/value.ts` `typeOfSimValue` | 網羅switch | **実装**（値が自己保持する `elementType` から `collection(List, T)`） |
| 3 | `src/domain/engine/distinctKey.ts` `distinctKeyOf` | 網羅switch | **`EngineInvariantError`**（`case 'list'` で `assertNotCompositeList`） |
| 4 | `src/domain/engine/stepEngine.ts` `boxValue` | switch + `default` throw | 既存の **`EngineInvariantError`**（`default` が `list` も捕捉。変更なし） |
| 5 | `src/domain/dsl/evaluate.ts` `numericValueOf` / `predicateComparisonValue` / `evaluateValuePredicate` | switch + `default` throw / 型ガード | **`EngineInvariantError`**（関数先頭の `list` 専用ガードを追加） |
| 6 | `src/domain/dsl/evaluateMapper.ts` `evaluateMapper` / `evaluateFlatMapper` | variantごとの型ガード | **`EngineInvariantError`**（同上。`listStream` は `stringList` 限定のまま） |
| 7 | `src/domain/dsl/evaluateComparator.ts` `compareNatural` / `compareByComparator` / `comparatorKeyLabel` | 型ガード | **`EngineInvariantError`**（同上） |
| 8 | `src/domain/dsl/evaluateConsumer.ts` `evaluateConsumerMessage` | 型ガード | **`EngineInvariantError`**（同上） |
| 9 | `src/domain/dsl/evaluateReduction.ts` `applyReduction`（acc / value 両方）/ `reductionInputLabel` | 型ガード | **`EngineInvariantError`**（同上。Terminal DSLの**受理範囲・既存kindの挙動は不変**） |
| 10 | `src/domain/dsl/evaluateGather.ts` `applyGatherAccumulation`（acc / element 両方）/ `gatherAccumulationInputLabel` | 型ガード | **`EngineInvariantError`**（同上。Gatherer DSLの累積は`evaluateReduction.ts`と別実装のため個別に塞ぐ。window系は`emitGatherWindow`側で処理され本関数を通らない） |
| 11 | `src/domain/engine/collectorRuntime.ts` `shortLabel` / `employeeOf` / `stringOf` / `classifierKey` | 型ガード | **`EngineInvariantError`**（同上） |
| 12 | `src/domain/dsl/materializeSource.ts` | 生成側のみ | `list` を生成しない（該当なし） |
| 13 | `src/domain/dsl/javaCode.ts` のリテラル生成 | — | SimValueを受け取らない（`DatasetElement` / `EmployeeValue` 経由）ため該当なし |
| 14 | `src/ui/components/*` の `formatSimValue` 呼出し | — | #1の実装結果を描画するのみ（該当なし） |

### 3.3 実装方式

- **共有ガード**: `assertNotCompositeList(value, where)`（`src/domain/types/invariantError.ts`）を
  各関数の**先頭**で呼ぶ。`list` だけを判定し、それ以外のkindは従来どおりの検証・例外へ進むため、
  **既存kindの例外型・メッセージ・挙動は一切変わらない**（P7-D07が「既存kindに対する例外型・挙動は
  変更されていない」ことを回帰検証する）。
- **`EngineInvariantError` の配置**: `src/domain/types/invariantError.ts`（依存を持たない中立モジュール）
  へ置いた。`src/domain/dsl` と `src/domain/engine` の双方から参照するためであり、
  `distinctKey.ts` → `stepEngine.ts` の循環依存も避けられる。
  `stepEngine.ts` からの再エクスポートを残しているので、`session.ts` / `stepEngine.test.ts` の
  既存import経路は無変更である。
- **検証**: P7-D07は、棚卸し表の到達不能箇所のうち**公開関数から直接叩ける17経路**
  （`UNREACHABLE_PATHS`）について `EngineInvariantError` の送出を個別にassertする。
  残る次の2箇所は公開経路の性質上、直接assertではなく別の形で検証している
  （テスト名と実体を一致させるための明示）:
  - **#4 `boxValue`**: private関数で `list` を渡す公開経路がないため `UNREACHABLE_PATHS` に含めない。
    既存の `default` が変更前から `EngineInvariantError` を送出しているため実装変更は不要であり、
    `boxed` の入力がinstantiate手順4で `primitiveStream` に限定される（`boxedWrapper` ruleが
    それ以外を `TYPE_MISMATCH` で拒否）ため `list` が到達しないことを**Pipeline構造検証**で確認する。
  - **#11 `collectorRuntime.ts`**: 公開入口 `collectorAccumulate` は先頭で `shortLabel(value)` を
    評価するため、**どのCollector種別でもここが入口ガードになる**。
    `employeeOf` / `stringOf` / `classifierKey` のガードはその内側の**多層防御**であり、
    入口を通過した合成List値が存在しない以上、単体では到達しない。
    したがって `UNREACHABLE_PATHS` には入口 `collectorAccumulate` の1経路だけを載せ、
    P7-D07は別途その入口ガードを toList / joining / summingInt / groupingBy の4種別で検証する。

> **経緯**: 初回実装では #5〜#11 を「既存のplain Error型ガードが `list` も throw するため対応不要」と
> 判断したが、codexレビュー第1回で `session.ts` のフェイルセーフ契約に差が生じる点を指摘され、
> 上記の方針へ修正した。第2回レビューでは修正が **#10 `evaluateGather.ts` に及んでいない**
> （棚卸し表にも載っていない）ことを指摘され、同ファイルの3経路を追加した。
> Gatherer DSLの累積は既存Terminal DSLと共通化せず独立実装とした判断（§1）の裏返しであり、
> 「`evaluateReduction.ts` を塞げば累積経路は塞がる」という前提が成り立たなかったことが原因である。

---

## 4. midEmpty非対応とgather固有教材制約を追加しない判断（指示§7.6）

**判断**: 全gather template（7件）で `supportedModes` を `standard` / `emptySource` に限り、
`midEmpty` を**非対応**とする。gather固有の教材制約（mode別手続き検証）も追加しない。

**理由**:

- **fold**: midEmptyの教材趣旨は「終端への入力が0件になる」ことだが、foldは空上流でも
  identityの1件が終端へ届く（v0.9 §3.2「only ever produces a single element」）。
  原理的に趣旨を満たせない。
- **window系 / scan**: gatherノード視点ではmidEmptyとemptySourceの列が同一になり
  （上流filterで0件になるか、sourceが0件かの違いだけで、gatherノードの
  `GATHER_INITIALIZED` → `GATHER_FINISHED` の列は変わらない）、教材価値が重複する。
- **教材制約**: `instantiateTemplate` 手順5の教材制約は operationId 別の分岐であり、gatherは
  該当しない。gather templateは取込対象外（§7.8）でfixture固定のため、fixture値の教材適合
  （残余あり / 倍数 / 入力<窓サイズ）は**P7-Dテストが直接検証する**方が確実である。

**検証**: P7-D20（全gather templateに `midEmpty` が含まれないこと、
snapshotCount実測が§8.2の計と一致すること）。

---

## 5. `tmpl-gather-scan-concat` を追加した判断（指示§7.6）

**判断**: v0.9 §8.4の基準必須4形と境界2形に加え、`scan × stringConcat` のtemplateを1件追加する。

**理由**: v0.9 §8.2で確定した `AccumulationRule` 3 kind のうち、`stringConcat` を**実行する**
fixtureが基準4形＋境界2形に存在しない（基準4形のscanはnumericSum、foldはemployeeFieldSum）。
DSL kindが死蔵になり、「検証は通るが一度も実行されない経路」が残る。

Pipelineは `streamOf(String) → gather → toList`（v0.9 §8.4の制約内: gatherノード1つ・下流短絡なし）。
期待結果は `["Java", "JavaSQL", "JavaSQLGit"]`。

**検証**: P7-D22（§8.2 #9の確定列との完全一致、string累積のboxed変換契約、
空文字initialの表示、出力IDの継承）。

---

## 6. 取込対象外の実装方式（指示§7.8、v0.9 §10-6）

**判断（ユーザー決定）**: gather DSLは手動連携の取込候補へ**開放しない**。将来拡張として持越す。
Import Contract・Prompt Generator・Candidate Importの仕様は不変のまま、
`src/application/importContract.ts` へ次の**2点のみ**を実装した。

1. **importable導出**: `buildTemplateContract` の `importable` 条件へ
   `!hasGatherNode(template)` を追加。`hasGatherNode` は `template.nodes` の
   `operationId === 'gather'` から導出し、**新規template属性を追加しない**。
   `disabledReason` には固定文言 `GATHER_NOT_IMPORTABLE_REASON` を設定する。
   実行不能template（`tmpl-src-generate` / `tmpl-src-iterate2`）の理由は従来どおり優先する。
2. **`slotSpecOf` の `case 'gatherer'`**: 全拒否spec
   `{ node: 'enum', values: [], label: 'gatherer（取込対象外）' }` を返す。
   許可値0件の列挙は、いかなる値も受理しない。既存 `SpecNode` の `enum` variantで表現し、
   専用variantは追加しない。

**caseを必須とする理由**: 取込UIは選択中templateのContractを毎render構築するため、
caseがないと `slotSpecOf` が `undefined` を返し、specが未定義のままContractへ入る
runtime穴になる（`importable: false` で実際には取込へ到達しないが、防御として必須）。

**開放していないことの根拠**: gather DSLを**受理する**spec（許可値を持つspec）は追加していない。
P7-D21が、正規4 kindの正しいGatherer DSL値を含む任意値がすべて拒否されることを検証する。

既存機構（ImportPanelのdisabled＋理由表示、`generatePrompt` のガード、
`CandidateImportService.import` の先頭ガード）がそのまま機能し、UI・Application両層で取込不能になる。

---

## 7. Javaコード表記の細部（指示§7.4-6）

**判断**: `gathererToJavaExpr`（`src/domain/dsl/javaCode.ts`）で検証済みDSLから決定的に生成する。

| Gatherer kind | 生成される式 |
|---|---|
| `windowFixed` | `Gatherers.windowFixed(<size>)` |
| `windowSliding` | `Gatherers.windowSliding(<size>)` |
| `scan` | `Gatherers.scan(() -> <initial>, <accumulation>)` |
| `fold` | `Gatherers.fold(() -> <initial>, <accumulation>)` |

- 初期値は既存 `identityToJavaLiteral` をそのまま使う（`0` / `0L` / `0.0` / `""`）。
  SupplierはJDK APIの引数型であるため `() -> <literal>` のlambdaで表す。
- 累積lambdaは既存reduce（`reductionToJavaExpr`）の表記規約と同形とし、
  lambda引数は既存の予約識別子の範囲から選ぶ:

| AccumulationRule | 生成される式 | 対応する既存reduce表記 |
|---|---|---|
| `numericSum` | `(acc, n) -> acc + n` | `(a, b) -> a + b` |
| `stringConcat` | `(acc, s) -> acc + s` | `(a, b) -> a + b` |
| `employeeFieldSum` | `(acc, e) -> acc + e.<field>()` | `(acc, e) -> acc + e.<field>()`（同一） |

reduceの2引数版は両辺が同型のため `(a, b)`、gatherは累積値と入力要素で役割が異なるため
`(acc, n)` / `(acc, s)` とし、`employeeFieldSum` は既存表記と完全に一致させた。

- `import` 行は生成しない（既存のJavaコード表示は `Collectors` 等も import 行を出さない規約）。
- Unicode矢印は混入させない（ASCII `->` のみ。v0.8 §17.4）。

**検証**: P7-D19（7 templateの式が構文的に正当で実データ・評価結果と一致すること、
既存fixture（非gather）のJavaコード出力が改修前後で不変であること）。

---

## 8. legend絞り込み（指示§7.5）

**判断**: OperationCatalogの `gather` 定義は `legendStates: ['UNEVALUATED', 'PROCESSING', 'PASSED', 'BUFFERED']`
（4状態）のまま変更せず、**node単位の `legendStates`** を `instantiateTemplate` で
Gatherer kindに応じて絞り込む。

- window系（`windowFixed` / `windowSliding`）: 4状態のまま（`BUFFERED` が発生する）
- scan / fold: `BUFFERED` を除いた3状態（バッファを持たないため発生しない）

**理由**: 既存のlegend機構（`PipelineNodeDef.legendStates` → `legendOf(def)`）の範囲内で完結し、
OperationCatalogの定義（操作の意味論）とnode単位の表示（このPipelineで発生し得る状態）を
分離できる。v0.8 §12.3「現操作で発生可能な状態だけ」に整合する。

**実装**: `instantiate.ts` の `gatherLegendStates()`。

**検証**: P7-D20（window系は `BUFFERED` を含み、scan / foldは含まないこと）。

---

## 9. Oracle照合の表記整合の選定判断（指示§12.5）

**判断**: 照合はJSON文字列厳密照合を維持し、Java側の出力表記をSimulation Coreの
`formatSimValue` / `formatLongLiteral` へ**両側で揃える**（Phase 5〜6で確立した方式の踏襲）。

| 対象 | Core表記 | Java側の整形関数（`OracleP7.java`） |
|---|---|---|
| Employee要素 | `佐藤（age=35）` | `employeeLabel(Employee)` |
| String要素 | `"Java"` | `stringLabel(String)` |
| 窓（List） | `[要素1, 要素2]`（再帰整形） | `listLabel(List<T>, Function<T,String>)` |
| long値 | `21_700_000L`（3桁区切り + L） | `longLiteral(long)` |
| 出力要素のboxed型名 | TypeRefから `Integer` / `Long` | `getClass().getSimpleName()` |

**照合対象に含めなかったもの**:

- **JDK内部実装の観測**（`integrator() instanceof Gatherer.Integrator.Greedy` /
  `combiner() == defaultCombiner()` / `finisher() == defaultFinisher()`）:
  Simulation Core側に対応する計算がなく、期待値を手書きすることになる。
  v0.9 §10-3のとおり `OBSERVATION:` 行として厳密比較の対象外に置いた。
- **窓のunmodifiable性**: 同上の理由でOBSERVATION行とした
  （Coreは固定のjdkNote文言として表示するのみで、値を計算しない）。
- **DoubleStreamのsum / average**: Phase 6と同じ理由（JDKは補償付き加算、Coreのprimitive Stream
  集計は素朴加算）で照合対象に含めない。Phase 7のgatherはdouble集計を実行しないため該当なし。

照合方式の注記は `P7_MATCH_NOTES`（`oracle/oracle-lib.mjs`）としてレポートへ出力する。

---

## 10. OBSERVATION観測結果と表示文言への反映（指示§9・§12.5、v0.9 §10-3）

### 観測環境

- JDKベンダー / バージョン: **OpenJDK Temurin 25.0.3+9**
  （`OpenJDK Runtime Environment Temurin-25.0.3+9 (build 25.0.3+9-LTS)`）
- Dockerイメージ: `gradle:9.6.1-jdk25`
- 観測記録: `artifacts/phase-7/oracle-result.md`

### 観測結果（12行 + 補足1行）

| Gatherer | `integrator() instanceof Greedy` | `combiner() == defaultCombiner()` | `finisher() == defaultFinisher()` |
|---|---|---|---|
| `windowFixed` | **true** | **true** | **false** |
| `windowSliding` | **true** | **true** | **false** |
| `scan` | **true** | **true** | **true** |
| `fold` | **true** | **true** | **false** |

補足: `windowFixed.windowIsUnmodifiable=true`（v0.9 §3.2「Each window produced is an
unmodifiable List」の裏取り）。

### 教材モデルとの整合

- **combiner**: 4種すべてで `defaultCombiner()` と同一だった。v0.9 §3.1の
  「Gatherers whose combiner is defaultCombiner() may only be evaluated sequentially」と整合し、
  教材の「逐次実行のため呼出し0回」表示の裏付けになる。
- **finisher**: 終端で産出し得る3種（windowFixed / windowSliding / fold）は default とは
  別の実装であり、終端産出のないscanだけが `defaultFinisher()` と同一だった。
  v0.9 §6.1の `GATHER_FINISHED` 統一発行規則（scanのみ不発行）と教材モデルが一致する。
- **integrator**: 4種すべてGreedyだった。v0.9 §2.2「組み込み4種の実行で短絡は発生しない前提の
  snapshot契約」の裏付けになる（v0.9執筆時点では「API仕様に明示がないため断定せず観測項目とする」
  としていた点が、実測で確認できた）。

### 表示文言への反映

`GathererStructurePanel.tsx` の補助説明へ `OBSERVATION_NOTE_BY_KIND` を追加し、
Gatherer kindごとに観測結果を表示する。**JDK内部実装を断定せず**、次を必ず明示する。

- 「**OpenJDK Temurin 25.0.3+9での観測では**」という観測環境の明示
- 「これは観測結果であり、**JDKの保証ではありません**」という断定回避

4構成要素の常設4行の文言自体は「教材モデル上の割当て」のままとし、観測結果で置き換えていない
（`gatherer-model-note` に「JDK内部でどの構成要素をどう実装しているかを断定するものではありません」を常設）。

**検証**: P7-R01（観測注記に観測環境とJDK非保証の明示があること、
scanのfinisherが `defaultFinisher()` と同一・他3種は別実装と表示されること）。

---

## 11. 視覚回帰更新の有無と理由（指示§10）

**既存27枚は据え置き（更新0枚）**。gather操作の追加は既存templateの表示に影響せず、
`npm run test:e2e` の全件実行で既存基準画像との差分は発生しなかった
（`git diff -- e2e/__screenshots__` が空であることを確認済み）。
threshold緩和は行っていない。

**Phase 7基準画像を8枚新設**:

| ファイル | 内容 |
|---|---|
| `p7-capture.spec.ts/p7-e05-window-fixed-emitted.png` | windowFixedの窓成立・放出時（PC幅） |
| `p7-capture.spec.ts/p7-e05-window-sliding-evicted.png` | windowSlidingのevict表示（PC幅） |
| `p7-capture.spec.ts/p7-e05-scan-completed.png` | scanの累積履歴つき完了状態（PC幅） |
| `p7-capture.spec.ts/p7-e05-fold-completed.png` | foldのOptional結果（PC幅） |
| `p7-capture.spec.ts/p7-e05-empty-initialized.png` | 空ソースの `GATHER_INITIALIZED` 表示（PC幅） |
| `p7-narrow.spec.ts/p7-e05-narrow-window-fixed.png` | 狭幅のGathererパネル縦積み |
| `p7-narrow.spec.ts/p7-e05-narrow-scan.png` | 狭幅のscan累積表示 |
| `p7-narrow.spec.ts/p7-e05-narrow-import-disabled.png` | 狭幅の取込UI無効化状態 |

---

## 12. その他の実装判断

### 12.0 `EngineInvariantError` を `src/domain/types/` へ置いた

指示書§5.1の新設ファイル一覧にはないファイル（`src/domain/types/invariantError.ts`）を追加した。
§5.2が `distinctKey.ts` 等の到達不能経路を `EngineInvariantError` とすることを要求しており、
`stepEngine.ts` から直接importすると循環依存になるため、実体を依存のない中立モジュールへ抽出した。
`src/domain/dsl` と `src/domain/engine` の双方が参照するため `types/` 配下を選んだ
（両者とも既に `types/result` / `types/ids` へ依存している）。
`stepEngine.ts` の再エクスポートにより既存import経路は無変更。

### 12.1 gatherランタイムを `stepEngine.ts` 内へ実装した

Phase 5はCollectorの再帰的な蓄積構造のため `collectorRuntime.ts` を別建てしたが、
Gathererは**再帰を持たない**（v0.9 §8冒頭）ため、Phase 3のnode runtime（`NodeRuntime` union）へ
`GatherRuntime` を追加する形が既存構造に最も素直に収まる。指示§5.2も
`stepEngine.ts` を変更ファイルとして挙げており、新設ファイル一覧（§5.1）に
gatherRuntime相当を含めていない。

### 12.2 window放出後のバッファ初期化タイミング

指示§8.1-2の順序（`GATHER_EMITTED` → 下流再帰 → バッファ初期化 → `return false`）に従い、
windowFixedのバッファ初期化は**下流再帰の後**に行う。窓が下流を流れている間、gather contextには
放出直前のバッファが残る（「いま放出した窓の中身」が見える）。
windowSlidingはバッファを保持したままにする。

### 12.3 `GATHER_INITIALIZED` の発行位置

`buildTimeline` の実行開始ブロック（Collectorコンテナ生成・identityありreduce初期化と同じ位置）の
**先頭**へ置いた。gather templateにはCollector / identityありreduce / limit(0) が存在しないため
相互の順序に影響はないが、§8.2の全11ケースで `INITIAL` の直後になることを
P7-D08が機械検証している。

### 12.4 finish cascadeの一般化方式

現在sorted専用だったcascadeループ（chain順に走査してflushする構造）へ、
`rt.kind === 'gather'` の分岐を追加する形で一般化した。cascadeで新規放出する合成要素
（windowFixedの残余窓・windowSlidingの1窓・foldの最終値）も
`registerElement` → 要素状態設定 → `GATHER_EMITTED` → 下流再帰 → `confirmPendingShortCircuits()`
の順で処理し、sorted flushと同じ規則（depth-first・短絡確定後は放出しない）に従う。

`fold → findFirst` は、既存findFirstの `pendingShortCircuit` 機構がそのまま働き、
`FIND_SELECTED` → `SHORT_CIRCUIT_CONFIRMED` の順で発行される（§8.2 #10 / #11の確定列と一致）。
上流は既に消費済みのため、実際の評価打切りは発生しない（v0.9 §2.2の許容根拠と整合）。

### 12.5 `<details>` 要素の追加について

Gathererパネルの補助説明を `<details>` / `<summary>` で折りたたんだ。
既存 `tests/react/p6-app.test.tsx` は「document全体で `<summary>` は1個」を検証しているが、
これは非gather templateを選択した既定状態での検証であり、gatherパネルは描画されないため
影響しない（回帰テストは全件成功）。E2Eでも `locator('summary')` は非gather画面でのみ使われている。
Phase 7のE2Eは testid で要素を特定しており、曖昧さを生じさせていない。

### 12.6 E2E webServerの停止方式を変更しなかった判断（codexレビュー第2〜4回）

**判断**: `playwright.config.ts` の `webServer` 設定を**変更しない**。

**経緯**: codexレビュー第2回・第3回で「81件すべて成功するがコマンドが終了しない
（`Terminating the WebServer` から進まず、時間超過で124）」と報告された。
当環境（Windows 11ネイティブ）では、作業ツリー4回＋作業ツリー外の一時コピー
（`node_modules`込み・cold build・4173未使用）1回の**計6回すべて exit 0**で再現しなかった。

**原因**（第4回で特定）: codexの管理サンドボックスが `taskkill` を `Access denied` で拒否する。
PlaywrightのwebServer teardownは、Windowsでは `spawnSync("taskkill /pid <pid> /T /F")` に依存し、
かつ**その終了コード（`.status`）を検査しない**（`playwright-core/lib/coreBundle.js:8988-8993`。
`spawnSync` は非ゼロ終了で例外を投げない）。唯一の報告先 `options.log` にも
webServerプラグインは no-op を渡している（`playwright/lib/runner/index.js:881-882`）。
その結果、kill失敗は検知も表示もされず、`waitForCleanup`（子プロセスの `close` イベントで
のみresolve。`coreBundle.js:8945-8953`）を無限に待つ。teardown側にタイムアウトはない。

サンドボックス外で同一設定・同一の一時コピーを実行すると 81 passed / exit 0（teardown 84ms、
実行後の4173 LISTENなし）であることをcodexが実測し、**リポジトリ側の修正は不要**と判定した。

**没にした対案**: `webServer.command` を
`npm run build && node node_modules/vite/bin/vite.js preview` へ変更し、
プロセスツリーを浅くする案（当環境で4→2プロセス、codex環境で8→6プロセスを実測）。
**採用しない**。`taskkill` 自体が拒否される以上生き残るプロセスは残り、
codexの制限環境では1件E2Eでも90秒でタイムアウトすることが実測された。
**根本原因に効かない変更**であり、Phase 1から不変の既存設定を動かす理由にならない。

**将来の選択肢**: 権限昇格なしの制限環境でE2Eを回す必要が生じた場合は、
Playwrightのtaskkill経路を使わず、ViteのNode APIでサーバーを起動して `server.close()` で
終了させる専用ランナーが必要になる。Phase 7の範囲では不要と判断した。

---

## 13. v0.9 §10の判断事項7件の結論

| # | 判断事項 | 結論 |
|---|---|---|
| 1 | window系templateの窓サイズと基準データ件数 | 指示§7.6で確定済み（windowFixed 3 / 2、windowSliding 2 / 3、Employee 4件・String 4件 / 2件）。実装との差異なし。snapshot最大28件（予算500以内） |
| 2 | Gatherer専用AccumulationRuleの実装上の配置 | `src/domain/dsl/gatherAst.ts` へ新設（§1の判断）。Terminal DSL・Collector DSLの許可範囲・検証挙動は一切変更していない。identityの**値検証のみ**既存 `validateReductionIdentity` へ委譲（受理範囲が同一であることをP7-D04が検証） |
| 3 | 組み込み4種の構成要素実装のOracle観測 | 実施（§10）。12行を観測し `artifacts/phase-7/oracle-result.md` へ保存、表示文言へ観測環境つきで反映 |
| 4 | SnapshotKind候補名の最終確定と衝突再確認 | 指示§7.1の6値をそのまま確定。Phase 6完了時点の42値と衝突なし（`GATHER` / `WINDOW` / `SCAN` / `FOLD` を含む既存kindは0件を実測確認）→ 48値 |
| 5 | 合成値モデルの具体型と既存SimValueとの統合方法 | `list` variantの追加と `stringList` との並存（§2の判断） |
| 6 | AI生成候補へのgather DSL開放の可否 | **開放しない**（ユーザー決定。§6）。Phase 6は手動連携方式（v0.10）であり、取込対象外化の2点のみ実装。将来拡張として持越し |
| 7 | 視覚回帰基準画像・共通UI・Oracle suite構成の意図的更新の範囲 | 視覚回帰: 既存27枚据え置き・P7 8枚新設（§11）。共通UI: 操作選択の「中間」optgroupへ `gather` が1行増えるのみで、optgroup新設・`CATEGORY_LABELS` 変更なし。Oracle suite: P7-O01追加・P6-O01の `writeReportPath` をnull化・`PAST_ARTIFACT_DIRS` へ `artifacts/phase-6` 追加（7 suite構成） |
