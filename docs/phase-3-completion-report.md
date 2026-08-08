# Phase 3 完了報告

- 報告日: 2026-08-08
- 基準仕様: `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`（Draft v0.8、無編集）
- 確定済みJ-2: `docs/phase-3-decisions.md` §1〜§7（無変更で保持）
- 実装指示: Phase 3実装指示（`docs/Claude_Code_Phase3_Implementation_Instructions.md`、未追跡のまま）

## 1. 完了 / 未完了判定

**Phase 3 完了**と判定する。

§16の完了条件をすべて満たした。ただし、実装指示の内部で矛盾する2点
（P2-R01テストとgenerate / iterate2実行可能化、P1/P2視覚回帰基準画像とUI変更）について、
指示§2の優先順位と過去Phaseの前例に基づいて解消した。解消内容は§20「仕様との差異と実装判断」に
明示しており、Draft v0.8および確定済みJ-2との差異はゼロである。

## 2. 基準コミット・作業ブランチ・最終commit

- 作業ブランチ: `phase-3`（`main` = `0185e64` を基点。新ブランチは作成していない）
- 基準コミットの祖先確認: `0185e64f0e673546c2a3bcacb4472c4bc1fc492b`（Phase 2 mainマージ）、
  `908dbc2b6a81c989d8c8ce661f2b3e30da50b9e5`（J-2確定）ともにHEADの祖先であることを
  `git merge-base --is-ancestor` で確認済み
- `origin/main...HEAD`: 0 behind / 2 ahead（作業開始時点）。`main..phase-3` の既存差分は
  承認済みの `README.md` と `docs/phase-3-decisions.md` のみであることを確認済み
- 最終commit SHA: 本報告を含むPhase 3本体一式のcommit後、追記commitで本欄に記載する
- `08d365f` / `908dbc2` のamend・squash・rebaseは行っていない

## 3. 実装した7操作と対応Stream種別

| 操作 | traits | 対応Stream | 備考 |
|---|---|---|---|
| `distinct()` | INTERMEDIATE, STATEFUL | `Stream<T>` / Int / Long / DoubleStream（型維持） | seen照合。DoubleはDouble.compare準拠の等価判定 |
| `sorted()` | INTERMEDIATE, STATEFUL | primitive Streamすべて + object Streamは自然順序対応型（String / Integer / Long / Double / LocalDate）のみ | `Stream<Employee>.sorted()`は生成前拒否 |
| `sorted(Comparator)` | INTERMEDIATE, STATEFUL | `Stream<Employee>`のみ（primitive Streamへの指定は拒否） | 許可8キーのASC/DESC・複合キー |
| `limit(long)` | INTERMEDIATE, STATEFUL, SHORT_CIRCUITING | 全Stream種別（型維持） | 引数はsafe integer・0以上 |
| `skip(long)` | INTERMEDIATE, STATEFUL | 全Stream種別（型維持） | 非短絡 |
| `takeWhile(Predicate)` | INTERMEDIATE, STATEFUL, SHORT_CIRCUITING | 数値要素（currentValueCompare）/ Employee（fieldCompare） | sequential + ordered限定。unordered候補は`UNORDERED_WHILE`で拒否 |
| `dropWhile(Predicate)` | INTERMEDIATE, STATEFUL | 同上 | SHORT_CIRCUITINGは付けない（指示§5.1） |
| `peek(Consumer)` | INTERMEDIATE, STATELESS | 全Stream種別（型維持） | PRINT_VALUE / PRINT_FIELD |

`sorted()`と`sorted(Comparator)`は同一target operation（`sorted`）へ複数template
（`tmpl-sorted-natural` / `tmpl-sorted-midempty` / `tmpl-sorted-comparator`）として登録し、
DSL・Javaコード・説明・操作固有状態で両者を識別している。

## 4. generate / iterate2の実行可能化（Phase 2持越しの解消）

- 新template `tmpl-limit-generate`（`Stream.generate(counter::incrementAndGet).limit(3).toList()` → `[1, 2, 3]`）、
  `tmpl-limit-iterate2`（`Stream.iterate(1, n -> n + 1).limit(5).toList()` → `[1, 2, 3, 4, 5]`）を追加し、
  **template自体にlimitノードを含めて**`source.generate` / `source.iterate2`を操作選択UIから実行可能にした。
- 旧template（`tmpl-src-generate` / `tmpl-src-iterate2`、limitなし）は削除せず実行不能のまま保持し、
  `UNBOUNDED_SOURCE`事前拒否のP2回帰検証対象として残した（disabled理由の文言は現状に合わせて更新）。
- sourceの表示は「無限source（unordered / ordered）をlimitで有限化したPipeline」であり、
  `scenario.source.finite === false`のまま「sourceが有限」とは表示しない（§5.3）。

## 5. 無限source有限性解析の許可 / 拒否規則

`analyzeBoundedness`（`src/domain/pipeline/boundedness.ts`）がPipelineDefinition生成前に実施:

- **許可**: 無限source → （1→1操作: map / mapToX / boxed / mapToObj / peek、有限skip）* → limit。
  必要source要求件数 = limit(N) + limit前のskip(n)合計。`limit(0)`は0件（supplier / operator非実行）。
  `generate → skip(2) → limit(3)`は5件を上限として扱う。
- **拒否（UNBOUNDED_SOURCE）**: limitノードなし（メッセージに`limit()`を含む）、
  sorted-before-limit（無限入力の全bufferは完了しないため）。
- **拒否（UNSAFE_BOUNDEDNESS）**: filter / distinct / flatMap / takeWhile / dropWhile等が
  最初のlimitより前にあり、有限なsource要求件数を構造的に保証できない候補（保守的拒否）。
- **拒否（TYPE_MISMATCH）**: iterate2の最終候補値がJava int範囲を超える場合。
- 500 snapshot制限は「正常な要素打ち切り」として使用していない（事前導出した正確な件数で
  timelineを構築し、500超は`SNAPSHOT_BUDGET`で事前拒否）。内部不整合ガードは例外
  （`EngineInvariantError` → playbackState ERROR）であり正常結果として返さない。

## 6. 未実装のPhase 4以降の操作一覧

- Phase 4: `reduce`、`count`、`min` / `max`、`findFirst` / `findAny`、`anyMatch` / `allMatch` / `noneMatch`、
  `sum`、`average`、`summaryStatistics`、`toArray`、`forEach` / `forEachOrdered`
- Phase 5: 3引数`collect`、Collector AST、`Collectors`（grouping / partitioning / downstream /
  `collectingAndThen` / `teeing`）
- Phase 6: サーバーAPI、AI adapter、RemoteScenarioProvider、実AI接続
- UIでは上記をPhase表記付きの選択不能項目として表示し、実装済みには見せていない。
- そのほか非対象: 任意Pipelineビルダー、自由入力、parallelStream実行、再生速度変更UI、
  null / NaN / Infinity / overflow / 例外教材、primitive Stream 3引数collect、本番デプロイ構成、
  依存ライブラリ更新（依存は一切追加・更新していない）

## 7. 主な変更ファイルとアーキテクチャ上の役割

| ファイル | 役割 |
|---|---|
| `src/domain/catalog/operations.ts` | 7操作のCatalog登録（traits・型規則・凡例・jdkNotes） |
| `src/domain/catalog/operationCatalog.ts` | `anyStreamLike` TypeRule追加（object / primitive両Stream） |
| `src/domain/dsl/ast.ts` / `validate.ts` / `evaluate.ts` | Predicate DSLの型一般化（currentValueCompare、LT） |
| `src/domain/dsl/comparatorAst.ts` / `validateComparator.ts` / `evaluateComparator.ts` | Comparator DSL（natural / employeeKeys、安定sort、キー表示） |
| `src/domain/dsl/consumerAst.ts` / `validateConsumer.ts` / `evaluateConsumer.ts` | Consumer DSL（PRINT_VALUE / PRINT_FIELD）とlimit / skip引数検証 |
| `src/domain/dsl/javaCode.ts` / `explanation.ts` | 7操作のJavaコード・自然文説明生成（同一AST起点） |
| `src/domain/pipeline/boundedness.ts` | 有限性解析（新規） |
| `src/domain/pipeline/pipelineDefinition.ts` | comparator / consumer / countノード属性、orderMeta / boundedness |
| `src/domain/engine/stepEngine.ts` | node runtime + finish cascade + 短絡キャンセルの合成構造（§10） |
| `src/domain/engine/snapshot.ts` | Phase 3 snapshot種別・OperationContextView・SideEffectEntry |
| `src/domain/engine/distinctKey.ts` | distinct等価判定キー（新規） |
| `src/domain/template/templates.ts` / `instantiate.ts` | 13の新template・新slot種別・型検証・教材制約 |
| `src/providers/fixtureScenarioProvider.ts` | Phase 3 fixture（§9の全mode） |
| `src/ui/components/OperationStatePanel.tsx` / `SideEffectPanel.tsx` | 操作固有状態表示・Side Effectビュー（新規） |
| `src/ui/components/MainSimulation.tsx` / `PipelineViewport.tsx` / `App.tsx` / `appInstance.ts` | 無限source表示・ノード引数表示・操作選択更新 |
| `oracle/OracleP3.java` / `expected-p3-from-core.json` / `run-oracle.mjs` | P3-O01照合 |

Simulation CoreはReact / DOM / タイマー / HTTP / AI SDKへ依存せず、UIは結果・並べ替え・seen・
短絡・Side Effectを再計算せずsnapshotの確定値だけを描画する。

## 8. 実行した全コマンドと終了結果

変更前（回帰基準、§3.3）:

| コマンド | 結果 |
|---|---|
| `npm ci` | 成功（脆弱性0） |
| `npm run lint` | 成功 |
| `npm run typecheck` | 成功 |
| `npm run test:unit` | 成功（17 files / 139 tests） |
| `npm run build` | 成功 |
| `npm run test:e2e` | 成功（25 passed） |
| `npm run test:oracle` | P1-O01 / P2-O01 PASSED |

変更後（完了判定、§14）:

| コマンド | 結果 |
|---|---|
| `npm ci` | 成功（脆弱性0） |
| `npm run lint` | 成功 |
| `npm run typecheck` | 成功 |
| `npm run test:unit` | 成功（26 files / **225 tests**、全成功・skip 0） |
| `npm run build` | 成功（production build） |
| `npm run test:e2e` | 成功（**37 passed**、chromium-pc + chromium-narrow） |
| `npm run test:oracle` | **P1-O01 / P2-O01 / P3-O01 すべてPASSED** |
| `git diff --check` / `--cached --check` / `--check origin/main..HEAD` | 問題なし |

## 9. テスト種別ごとの件数

| 種別 | 総数 | 成功 | 失敗 | skip | 未実行 |
|---|---|---|---|---|---|
| Vitest（Domain / Application / React、P1 + P2 + P3） | 225 | 225 | 0 | 0 | 0 |
| Playwright E2E・視覚回帰（P1 + P2 + P3 + キャプチャ） | 37 | 37 | 0 | 0 | 0 |
| JDK 25 Oracle（P1-O01 / P2-O01 / P3-O01） | 3 | 3 | 0 | 0 | 0 |

## 10. P3必須60 ID対応表

### Domain（32 ID）

| ID | 実装テスト | 結果 |
|---|---|---|
| P3-D01 | `tests/domain/p3-catalog.test.ts`（Catalog 7操作） | 成功 |
| P3-D02 | `tests/domain/p3-catalog.test.ts`（anyStreamLike・型維持・sorted拒否・ordered） | 成功 |
| P3-D03 | `tests/domain/p3-dsl.test.ts`（currentValueCompare） | 成功 |
| P3-D04 | `tests/domain/p3-dsl.test.ts`（Comparator DSL） | 成功 |
| P3-D05 | `tests/domain/p3-dsl.test.ts`（limit / skip引数） | 成功 |
| P3-D06 | `tests/domain/p3-dsl.test.ts`（Consumer DSL） | 成功 |
| P3-D07 | `tests/domain/p3-dsl.test.ts`（Source of Truth一致） | 成功 |
| P3-D08 | `tests/domain/p3-boundedness.test.ts`（有限性解析・事前導出） | 成功 |
| P3-D09 | `tests/domain/p3-boundedness.test.ts`（generate + limit） | 成功 |
| P3-D10 | `tests/domain/p3-boundedness.test.ts`（iterate2 + limit） | 成功 |
| P3-D11 | `tests/domain/p3-boundedness.test.ts`（unsafe無限Pipeline拒否） | 成功 |
| P3-D12 | `tests/domain/p3-ops.test.ts`（distinct基本） | 成功 |
| P3-D13 | `tests/domain/p3-ops.test.ts`（distinct型・安定性） | 成功 |
| P3-D14 | `tests/domain/p3-ops.test.ts`（sorted natural・Int/Long/Double） | 成功 |
| P3-D15 | `tests/domain/p3-ops.test.ts`（sorted Comparator ASC/DESC・複合） | 成功 |
| P3-D16 | `tests/domain/p3-ops.test.ts`（sorted J-2 invariant） | 成功 |
| P3-D17 | `tests/domain/p3-ops.test.ts`（sorted境界・stable・unordered注記） | 成功 |
| P3-D18 | `tests/domain/p3-ops.test.ts`（limit基本） | 成功 |
| P3-D19 | `tests/domain/p3-ops.test.ts`（limit境界） | 成功 |
| P3-D20 | `tests/domain/p3-ops.test.ts`（skip） | 成功 |
| P3-D21 | `tests/domain/p3-ops.test.ts`（takeWhile・unordered拒否） | 成功 |
| P3-D22 | `tests/domain/p3-ops.test.ts`（dropWhile） | 成功 |
| P3-D23 | `tests/domain/p3-ops.test.ts`（peek・短絡後非実行） | 成功 |
| P3-D24 | `tests/domain/p3-ops.test.ts`（Side Effect履歴） | 成功 |
| P3-D25 | `tests/domain/p3-invariants.test.ts`（stateful合成4種） | 成功 |
| P3-D26 | `tests/domain/p3-invariants.test.ts`（finish / cancel伝播） | 成功 |
| P3-D27 | `tests/domain/p3-invariants.test.ts`（short-circuit不変条件） | 成功 |
| P3-D28 | `tests/domain/p3-invariants.test.ts`（PROCESSING 0/1件） | 成功 |
| P3-D29 | `tests/domain/p3-invariants.test.ts`（snapshot同期） | 成功 |
| P3-D30 | `tests/domain/p3-invariants.test.ts`（複数template・教材制約） | 成功 |
| P3-D31 | `tests/domain/p3-invariants.test.ts`（決定性・予算・不変性） | 成功 |
| P3-D32 | `tests/domain/p3-regression.test.ts`（P1/P2回帰） | 成功 |

### Application（7 ID）

| ID | 実装テスト | 結果 |
|---|---|---|
| P3-A01〜A07 | `tests/application/p3-session.test.ts`（切替 / mode / sorted履歴 / 短絡履歴 / peek履歴 / 自動・停止 / 検証エラー） | すべて成功 |

### React統合（10 ID）

| ID | 実装テスト | 結果 |
|---|---|---|
| P3-R01〜R10 | `tests/react/p3-app.test.tsx`（操作・template UI / distinct / sorted / limit・skip / take・drop / peek・Side Effect / 無限source / コード同期 / 凡例・traits / a11y） | すべて成功 |

### E2E・視覚（10 ID）

| ID | 実装テスト | 結果 |
|---|---|---|
| P3-E01〜E08, E10 | `e2e/phase3.spec.ts` | すべて成功 |
| P3-E09 | `e2e/p3-narrow.spec.ts`（狭幅375px） | 成功 |

### Oracle（1 ID）

| ID | 実装 | 結果 |
|---|---|---|
| P3-O01 | `oracle/OracleP3.java` + `oracle/expected-p3-from-core.json` + 同期テスト`tests/domain/p3-oracleSync.test.ts` | PASS（完全一致） |

**合計: Domain 32 + Application 7 + React 10 + E2E 10 + Oracle 1 = 60 ID、すべて実装・成功。**

## 11. P1 / P2回帰結果

- P1必須41 ID（D01〜14 / A01〜08 / R01〜08 / E01〜11）+ P1-O01: すべて成功。
- P2必須52 ID + P2-O01: すべて成功。
- 既存P1/P2テストの削除・skipは行っていない。P2-R01のみ、Phase 3指示§8.1（generate / iterate2の
  実行可能化）と直接矛盾する4アサーションを新仕様の検証へ更新した（§20参照。緩和ではなく
  検証対象の置き換えであり、意図＝「実装済みだけ選択可能・未実装は理由表示」は維持）。
- P1-E11 / P2-E10の視覚回帰基準画像は、Phase 3のUI変更（副題・操作選択リスト）に伴い
  意図的に更新した（Phase 2時のP1-E11更新と同じ扱い。§20参照）。それ以外の一括無条件更新はない。

## 12. P3-O01のJDK・ケース・照合結果

- JDK: Eclipse Temurin **25.0.3+9-LTS**（`gradle:9.6.1-jdk25` Dockerイメージ、openjdk 25.0.3 2026-04-21 LTS）
- ケース（32キー）: distinct結果 + ordered先頭保持（equalsをキーだけで判定するTagクラスで
  保持インスタンスのindexを検証: `[0, 1, 3]`）、String natural sort、Employee `region`
  Comparator + 同値キーstable順（`[田中, 佐藤, 高橋, 鈴木]`、関東の佐藤→高橋の元順序維持）、
  limit / skipの0・一部・全件・超過境界、takeWhile / dropWhile基準入力、generate + limit
  （supplier呼出し回数3を含む）、iterate2 + limit、peekのaction呼出し順と最終結果不変、
  Int / Long / DoubleStreamのsorted / distinct（Double.compare準拠）、全操作の空入力。
- 判定: **PASS（完全一致）**。Oracleはリポジトリ固定のJava 25コードのみを実行し、
  AI生成コードは実行していない。expected JSONとSimulation Coreの一致は
  `tests/domain/p3-oracleSync.test.ts`（P3-O01(sync)）で機械検証している。
- 証跡: `artifacts/phase-3/oracle-result.md`

## 13. distinct代表snapshotの構造比較

`tmpl-distinct`標準（`["Java", "SQL", "Java", "Git", "SQL"]`）:

- 要素ごとに `SOURCE_EMIT → NODE_ARRIVAL → DISTINCT_CHECKED →`
  初登場: `DISTINCT_SEEN_UPDATED（独立snapshot・seen追加・PASSED）→ SINK_APPENDED` /
  重複: `ELEMENT_REJECTED`。
- DISTINCT_CHECKED時点のseen件数列は `0 → 1 → 2 → 2 → 3`、verdict列は
  `FIRST, FIRST, DUPLICATE, FIRST, DUPLICATE`（P3-D12で構造検証）。
- 同表示値の`"Java"`はelement ID（of-001 / of-003）で区別され、encounter orderで最初の
  of-001だけがPASSED・出力入りし、of-003はREJECTED（P3-D13、P3-E01）。

## 14. sortedのbuffer → order confirmed → emit構造とJ-2不変条件

`tmpl-sorted-comparator`標準（region ASC）: snapshot列は
`INITIAL → 4 ×（SOURCE_EMIT → NODE_ARRIVAL → SORT_BUFFERED）→ SORT_ORDER_CONFIRMED →
4 ×（SORT_EMITTED → SINK_APPENDED）→ RESULT_CONFIRMED → STREAM_CONSUMED`（計24件）。

J-2不変条件の機械検証結果（P3-D16 / D17 / D28）:

1. 全snapshotで`PROCESSING`要素は最大1件（全template × 全mode横断で検証）
2. 最初の`SORT_EMITTED`前に全入力がbuffer済み
3. `SORT_ORDER_CONFIRMED`は1シナリオ1件（空Stream・途中0件でも空bufferで1件生成）
4. 確定snapshotで`currentElementId === null`かつ`PROCESSING` 0件、処理中パネルは
   「個別要素ではなくbuffer全体の順序確定」を表示
5. 確定前の後段出力0件、1回の`SORT_EMITTED`で放出位置が1だけ前進
6. ordered Streamの同値キー（関東: 佐藤 / 高橋）はencounter order維持（stable）。
   unordered（generate由来）ではstableNoteを出さず「保証されません」を注記

## 15. limit / takeWhileの短絡後未評価比較

- `tmpl-limit`標準（rangeClosed(1,5) + limit(3)）: `LIMIT_COUNT_UPDATED`が1/3 → 2/3 → 3/3、
  3件目が後段を流れ切った後に`SHORT_CIRCUIT_CONFIRMED`（独立snapshot）。`SOURCE_EMIT`は
  3件のみで、n-004 / n-005は最終snapshotまで`UNEVALUATED`（REJECTEDにしない）。
- `limit(0)`（midEmpty）: `SOURCE_EMIT` 0件、処理中要素0件のまま`SHORT_CIRCUIT_CONFIRMED`。
- `tmpl-takewhile`標準（[1,2,6,3,7]）: Predicate評価は3回（1, 2, 6）のみ。6は評価されて
  falseの境界要素として`REJECTED`、`SHORT_CIRCUIT_CONFIRMED`後の追加評価snapshotはゼロ
  （P3-D27で短絡確定以降にSOURCE_EMIT / PREDICATE_EVALUATED / MAPPING_APPLIED /
  PEEK_ACTION_PERFORMED / NODE_ARRIVALが存在しないことを検証）。3・7は`UNEVALUATED`のまま、
  UIは「Predicateならtrueとなる値でも、実際には評価されません」を明示。

## 16. dropWhileの通過モードとPredicate非評価比較

`tmpl-dropwhile`標準（[1,2,6,3,7]）: 1・2はPredicate評価true → `ELEMENT_REJECTED`（drop）。
6で最初のfalseとなり`DROP_MODE_ENTERED`（独立snapshot・境界要素は除外せず後段へ通過）。
以後の3・7は`PREDICATE_EVALUATED`なしの`ELEMENT_PASSED`（Predicate評価は合計3回のみ、
P3-D22で検証）。dropWhileは短絡せず全5件がsourceから送出され、`SHORT_CIRCUIT_CONFIRMED`は
発生しない。結果は`[6, 3, 7]`（3はPredicateならtrueでも通過することを説明表示）。

## 17. peekのSide Effect履歴比較

- `tmpl-peek`標準: `PEEK_ACTION_PERFORMED`ごとに不変のSideEffectEntry
  （seq 1〜4連番、nodeId=node-peek、elementId=emp-001〜004、actionExpr =
  `e -> System.out.println(e.name())`、actionLabel=PRINT_FIELD、message=氏名）が1件ずつ増える。
- snapshot k時点の履歴はその時点まで（2回目のaction snapshotでは2件）。戻ると履歴が減り、
  再進行では**同一の保存済みsnapshot（同一オブジェクト）**が復元され、実actionは再実行されない
  （P3-A05でオブジェクト同一性まで検証）。
- 通常出力（List<Employee>、4件不変）とSide Effectビューは別領域で描画し、
  ブラウザconsoleは読み取らない。入力0件 / 途中0件ではConsumer呼出し0回（0回状態を表示）。
- 短絡後の未評価要素にはSide Effectを追加しない（takeWhile → peek合成で検証、P3-D23）。

## 18. object / primitiveのTypeRefと順序メタデータ比較

- limit / skip / takeWhile / dropWhileのIntStream上の入出力TypeRefは`IntStream → IntStream`、
  distinct / sortedのStream<String>上は`Stream<String> → Stream<String>`（型維持、P3-D02）。
- primitive sorted: IntStream / LongStream / DoubleStreamで型維持し、DoubleはDouble.compare
  と一致（P3-D14、Oracle intSorted / longSorted / doubleSorted / doubleDistinct）。
- `orderMeta`: collection / arrayPrimitive / iterate2はordered、generateはunordered。
  `boundedness`: generate / iterate2は`sourceBounded: 'infinite'`のまま
  `pipelineFinitized: true`・`maxSourceDemand: 3 / 5`（source有限性とPipeline有限化を区別）。

## 19. キャプチャ・視覚回帰画像の保存先

- PC幅キャプチャ: `artifacts/phase-3/capture-pc-distinct.png` / `capture-pc-sorted-confirmed.png` /
  `capture-pc-takewhile-stop.png` / `capture-pc-peek.png` / `capture-pc-generate-limit.png` /
  `capture-pc-limit.png`
- 狭幅（375px）キャプチャ: `artifacts/phase-3/capture-narrow-sorted.png` /
  `capture-narrow-peek.png` / `capture-narrow-takewhile.png`
- 視覚回帰基準画像（P3-E10、代表snapshotのみ新規基準化）:
  `e2e/__screenshots__/phase3.spec.ts/p3-e10-distinct-duplicate.png` /
  `p3-e10-sorted-order-confirmed.png` / `p3-e10-takewhile-stop.png` / `p3-e10-peek-action.png`
- PC幅 / 狭幅でdistinct・sorted・takeWhile・peek・generate + limitのキャプチャを取得し
  レイアウト（横スクロール・sticky・Side Effect分離）を確認した（P3-E09 / キャプチャspec）。

## 20. 仕様との差異と実装判断

Draft v0.8および確定済みJ-2（`docs/phase-3-decisions.md` §1〜§7）との差異: **ゼロ**。

Phase 3実装指示の内部で矛盾した2点を、次のとおり解消した（詳細判断は
`docs/phase-3-decisions.md` §12・§13）:

1. **P2-R01テストの更新**: 指示§13は「既存P1/P2テストを削除、緩和、skipしてはいけません」と
   定める一方、§8.1・§11.1・P3-R01 / R07は`source.generate` / `source.iterate2`の
   操作選択UIからの実行可能化を必須とする。P2-R01は「generate / iterate2がdisabledであること」を
   検証しており両立不能。§2の優先順位内で後者（Phase 3の明示的な機能要求）を正とし、
   P2-R01の該当4アサーションを新仕様の検証（選択可能・実行不能操作なし）へ更新した。
   テストの削除・skipはしておらず、その他のアサーション（実装済み操作の選択可否・
   未実装操作の理由表示）は維持・強化している。
2. **P1-E11 / P2-E10視覚回帰基準画像の意図的更新**: Phase 3のUI変更（副題・操作選択リスト）が
   全画面基準画像に写るため、そのままではP1/P2視覚回帰が成立しない。Phase 2で同じ理由により
   P1-E11基準を更新した前例（commit 3356ef6「P1-E11基準画像は操作選択UI追加に伴い意図的に更新」）に
   従い、意図的更新として再生成した。§14の「意図せず更新していない」に対し、意図と理由を本報告で明示する。

その他の実装判断（矛盾ではない）:

- 教材制約の機械検証（distinct重複・sorted未整列・同値キー・limit超過・境界後true・peek 1回以上）は
  対象ノードがsource直後にあるtemplateの標準モードで適用する。テスト用の合成Pipeline検証は
  targetを終端に設定して制約対象外とした。
- `SHORT_CIRCUIT_CONFIRMED`（limit）は上限到達要素が後段を流れ切った後に確定する
  （Javaのdemand-driven評価と同じ順序。到達要素自身の後段処理は短絡前の正当な評価）。

## 21. 500 snapshot上限と実測件数

全template / modeの正確な実測件数は `artifacts/phase-3/snapshot-budget.txt`（P1〜P3全78組）。
Phase 3分の抜粋（初期snapshot含む・すべて500以内、最大33件）:

| template | standard | midEmpty | emptySource |
|---|---|---|---|
| tmpl-distinct（+ midempty） | 26 | 19 | 3 |
| tmpl-sorted-natural（+ midempty） | 24 | 20 | 4 |
| tmpl-sorted-comparator | 24 | - | 4 |
| tmpl-limit | 25 | 4 | 3 |
| tmpl-limit-generate / iterate2 | 16 / 24 | - | - |
| tmpl-skip | 23 | 15 | 3 |
| tmpl-takewhile | 24 | 8 | 3 |
| tmpl-dropwhile | 33 | 15 | 3 |
| tmpl-peek（+ midempty） | 19 | 19 | 3 |

`snapshotCount`（事前実行値）と実測の一致、および500以内であることをP3-D31で機械検証している。

## 22. 既知の問題とPhase 4への持越し

- 既知の問題: なし（全テスト成功・仕様差異は§20の2点のみで解消済み）。
- Phase 4への持越し:
  - 終端操作（reduce / count / min / max / find / match / sum / average / statistics /
    toArray / forEach系）の実装。現在の終端はtoListのみ。
  - takeWhile / dropWhileのfieldCompare（Employee）template（DSL・型規則は対応済みだが
    教材templateは数値のみ）。
  - Phase 4の短絡終端（find / match）実装時は、Phase 3で導入した短絡キャンセル構造
    （cancelIdx + confirmPendingShortCircuits）を終端起点へ一般化する。

## 23. J-2 teeing

J-2のうち`teeing`左右2系統の例外規定は**未決定のまま維持**し、Phase 5着手前に判断する
（`docs/phase-3-decisions.md` §6を無変更で保持）。

## 24. 最終git検査

- `git diff --check` / `git diff --cached --check` / `git diff --check origin/main..HEAD`: 問題なし
- `git status --short`: commit後は未追跡の`docs/Claude_Code_Phase3_Implementation_Instructions.md`のみ
  （指示書は複製・commitしない）
- `git diff --stat` / `--name-status`: 変更はPhase 3本体（src / tests / e2e / oracle /
  artifacts/phase-3 / docs/phase-3-* / README）に限られる
- `artifacts/phase-1/` / `artifacts/phase-2/`の過去Phase証跡は変更なし（検証実行で
  再生成された分はHEADへ復元済み）。Draft v0.8・過去Phaseのdecisions / completion-reportも無変更。

## 25. push・PR・mergeについて

**push、Pull Request作成、mainへのmergeは行っていない。** Phase 3本体の変更はローカルの
`phase-3`ブランチへのcommitのみである。
