# Phase 3 判断記録

- 判断日: 2026-08-08（J-2 sorted確定）/ 2026-08-08（Phase 3本体実装判断を§8以降へ追記）
- 対象: Draft v0.8 §21.5 **J-2** のうち、Phase 3着手前が期限の `sorted` の例外規定、
  およびPhase 3本体実装（distinct / sorted / limit / skip / takeWhile / dropWhile / peek）で
  必要になった実装判断
- 状態: **J-2（sorted）確定済み（§1〜§7、無変更で保持）。Phase 3本体は実装済み**
  （実装判断は§8以降。完了報告は `docs/phase-3-completion-report.md`）

## 1. 基準仕様と参照節

- `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`（Draft v0.8、無編集）
  - §12.5: `sorted` の操作固有状態は「buffer、並べ替え済み順序、放出位置」
  - §12.6: 「1つの確定snapshotに処理中要素は原則1件だけとする」
  - §13.2: 「sortedの蓄積、並べ替え確定、1要素放出」を独立snapshotとする
  - §14.1: 「全入力をbuffer → 並べ替え確定 → 1件ずつ放出。Comparatorキーを表示」
  - §20: Phase 3完了条件に「sorted構造snapshot」の正しさを含む
  - §21.5: J-2の判断期限（sorted: Phase 3着手前、teeing: Phase 5着手前）
- Java SE 25 公式仕様（2026-08-08取得・確認済み）
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html
    - `sorted()` / `sorted(Comparator)`: "This is a stateful intermediate operation."
    - "For ordered streams, the sort is stable. For unordered streams, no stability guarantees are made."
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html
    - "Stateful operations may need to process the entire input before producing a result.
      For example, one cannot produce any results from sorting a stream until one has seen
      all elements of the stream."

## 2. J-2の判断対象

§12.6「1つの確定snapshotに処理中要素は原則1件」に対し、`sorted` の一括並べ替え確定
（buffer全体を同時に扱う処理）を例外として複数要素の同時「処理中」を認めるか。

## 3. 結論

**`sorted` について、複数要素を同時に「処理中」とする例外は設けない。**

並べ替え確定は「要素1件の処理」ではなく、`sorted` ノードが**buffer全体の順序を確定した
操作固有状態**として表現する。したがって並べ替え確定snapshotでは処理中要素を**0件**とし、
既存の「原則1件」を維持する。

**全snapshotにおいて、`elementLatestStates` が `PROCESSING` である要素は最大1件とする。**

（参考: Phase 2のflatMapも同じ方針で例外なしに成立している。`docs/phase-2-decisions.md` §2）

## 4. Phase 3実装で守るsnapshot契約

### 4.1 snapshot種別（推奨名。実装時に揺れさせない）

| 名称 | 意味 |
|---|---|
| `NODE_ARRIVAL`（既存） | 要素が `sorted` ノードへ到着し、その要素だけが `PROCESSING` になる |
| `SORT_BUFFERED` | 現在要素のbuffer追加が確定（当該要素は `BUFFERED` へ） |
| `SORT_ORDER_CONFIRMED` | 全bufferの並べ替え順序が確定（1シナリオにつき1件） |
| `SORT_EMITTED` | 確定順序から1要素を後段へ放出（その要素だけが現在の処理対象） |

既存命名規約（`SOURCE_EMIT` / `MAPPED_STREAM_CREATED` 等の「対象_事象」形式）と両立しており、
矛盾は見つからなかった。

### 4.2 A. buffer蓄積

- upstreamから `sorted` へ到着した**現在要素だけ**を `PROCESSING` にする（`NODE_ARRIVAL`）。
- 要素をbufferへ追加した確定時点（`SORT_BUFFERED`）では、その要素を `BUFFERED` として保持する。
- すでにbuffer済みの別要素を同時に `PROCESSING` へ戻さない。
- bufferは元のencounter orderと安定した要素IDを保持する。
- `sorted` から後段への出力は、**全入力の蓄積が完了するまで0件**とする
  （Java 25: "one cannot produce any results from sorting a stream until one has seen all elements"）。

### 4.3 B. 並べ替え確定（`SORT_ORDER_CONFIRMED`）

- upstream完了後に、buffer全体の並べ替え確定を**1つの確定snapshot**として記録する。
- このsnapshotでは `currentElementId === null` とする。
- `elementLatestStates` に `PROCESSING` を残さない。buffer内要素は `BUFFERED` のままとする。
- 処理中パネルは個別要素ではなく、`sorted` ノードの一括処理（buffer全体の順序確定）であることを示す。
- 操作固有状態（sorted固有state）には少なくとも次を保持する:
  1. 元のbuffer順序（要素IDと表示値の列）
  2. natural orderまたはComparatorの識別可能な定義（許可済みComparator DSL）
  3. Comparatorキーまたは比較対象（§14.1「Comparatorキーを表示」）
  4. 並べ替え確定後の順序（要素IDと表示値の列）
  5. 放出済み件数または次の放出位置
  6. `BUFFERING` / `ORDER_CONFIRMED` / `EMITTING` を区別できるphase
- 同値キーの要素は、**ordered Streamでは元のencounter orderを維持**する（stable sort）。
- **unordered Streamではstableであると表示・保証しない**（Java 25: "no stability guarantees are made"）。

### 4.4 C. 1要素ずつ放出（`SORT_EMITTED`）

- 並べ替え確定後、確定済み順序から1要素ずつ後段へ放出する。
- 放出対象の1要素だけを現在の処理対象とする。
- 放出位置を操作固有状態で更新し、未放出要素と放出済み要素を区別する。
- 1要素は後段（後続の中間操作・終端）を流れ切ってから、次の要素を放出する
  （Phase 2のflatMap子要素と同じdepth-first方式）。
- 「戻る → 進む」でbuffer、確定順序、放出位置、要素状態が完全に再現されること
  （snapshotは保存済みを再利用し、再計算しない）。

### 4.5 D. 空・1件・同値キー

- **空Stream**でも、空bufferの並べ替えが確定したことを示す `SORT_ORDER_CONFIRMED` を1件生成する。
- **1件Stream**でも、buffer蓄積 → 順序確定 → 1件放出の構造を維持する。
- 標準教材データには**未整列入力**を使う（§11.3「入力が事前に整列済みではない」）。
- ordered Streamの安定性を検証できるよう、**同じsortキーを持つ別要素**（同値キー・別ID）を
  含むケースをPhase 3テスト計画へ入れる。

### 4.6 `currentElementId` / `elementLatestStates` / 操作固有状態の関係

- `currentElementId`: `NODE_ARRIVAL` / `SORT_BUFFERED` / `SORT_EMITTED` では対象の1要素、
  `SORT_ORDER_CONFIRMED` では `null`。
- `elementLatestStates`: `PROCESSING` は常に最大1件。buffer内要素は `BUFFERED`、
  放出され後段を通過した要素は後段での状態（`PASSED` 等）に従う。
- 操作固有状態（4.3の6項目）はSnapshotの `sorted` 固有コンテキスト（Phase 2の
  `flatMapContext` に相当する新フィールド）として保持し、共通bufferへ押し込めない（§5.2）。

## 5. Phase 3実装時の受入条件・機械検証項目

Phase 3実装では少なくとも次を機械検証する（テストIDはPhase 3実装指示で確定する）:

1. 全snapshotで `PROCESSING` 要素数が0または1であり、2以上にならない。
2. 最初の `SORT_EMITTED` より前に、全入力要素がbufferへ蓄積済みである。
3. `SORT_ORDER_CONFIRMED` は1シナリオにつき1件である。
4. `SORT_ORDER_CONFIRMED` では `currentElementId === null` である。
5. `SORT_ORDER_CONFIRMED` では `PROCESSING` 要素が0件である。
6. 並べ替え確定前の後段出力は0件である。
7. 放出順序がnatural orderまたは許可済みComparatorと一致する。
8. ordered Streamで同値キーのencounter orderが維持される。
9. 1回の `SORT_EMITTED` で放出位置が1だけ進む。
10. 戻る→進む、同一revision再実行で同一snapshot列を再現する。
11. 空Stream、1件、未整列、同値キー、Comparator指定を検証する。
12. 全教材templateが500 snapshot以内である。

## 6. 持越し事項

- **J-2（teeing左右2系統）は未決定のまま**とし、**Phase 5着手前**に判断する。

## 7. 本判断のスコープ

- 今回は判断記録の作成のみであり、**Phase 3の実装（distinct / sorted / limit / skip /
  takeWhile / dropWhile / peekのDomain実装、Catalog登録、DSL追加、Step Engine変更、
  React UI変更、fixture・テスト追加）は開始していない**。
- 新しいVitest / Playwrightテストは作成していない（テストIDはPhase 3実装指示で確定）。

---

以下はPhase 3本体実装（Phase 3実装指示に基づく）で必要になった実装判断の追記である。
§1〜§7の確定済みJ-2は変更していない。

## 8. Step Engineの合成構造（指示§10）

- Phase 2の「要素1件をdepth-firstに流す」規則を維持したまま、Step Engine内部を
  **node runtime**（node単位の操作固有状態）+ **finish cascade** + **短絡キャンセル**の
  3要素で合成する構造へ拡張した。target operation専用の固定Pipeline分岐は持たない。
  1. 即時通過 / 除外: filter・map系・distinct・skip・takeWhile・dropWhile・peekは
     従来どおり要素到着時に処理する。
  2. 保持してflush: sortedは`SORT_BUFFERED`で要素を保持し、upstream完了後の
     finish cascade（chain順）で`SORT_ORDER_CONFIRMED` → `SORT_EMITTED`を実行する。
     複数のsortedがあってもchain順に順次flushされる。
  3. 上流キャンセル: limit / takeWhileの短絡確定は`cancelIdx`（受け付け停止した
     最小chain index）として保持し、source・flatMap子送出・sorted放出の各emitterは
     「自分より下流にキャンセルがあるか」で送出を停止する。
- `SHORT_CIRCUIT_CONFIRMED`の位置: limitは上限到達要素が**後段を流れ切った後**に
  独立snapshotとして確定する（到達要素自身の後段処理はJava同様に実行される）。
  takeWhileは境界要素の除外確定直後に確定する。`limit(0)`はsource要求前に確定する。
- P1 / P2のsnapshot列（種別・順序・文言）は変更していない（P3-D32・既存139テストで検証）。

## 9. 無限sourceの有限性解析（指示§8.2）

- `analyzeBoundedness`（`src/domain/pipeline/boundedness.ts`）が、source有限性
  （finite / infinite / conditionallyFinite）とPipeline有限化を区別して事前解析する。
- 無限source（generate / iterate2）は最初の`limit`まで走査し、
  必要source要求件数 = `limit(N)` + それ以前の`skip(n)`の合計（`limit(0)`は0件）とする。
  1→1保証（map・mapToX・boxed・mapToObj・peek）はlimit前でも件数を変えない。
- sorted-before-limitは`UNBOUNDED_SOURCE`、filter / distinct / flatMap /
  takeWhile / dropWhile等のbefore-limitは`UNSAFE_BOUNDEDNESS`として保守的に事前拒否する。
- 具現化（`materializeInfiniteSource`）は導出済み件数だけを決定的に生成し、
  supplier / operator相当の適用回数はこの件数を超えない（P3-O01の
  `generateSupplierCalls = 3`でJDK実測と照合済み）。
- `PipelineDefinition.boundedness`にsource有限性・有限化済みフラグ・最大要求件数を、
  `orderMeta`にordered / unorderedを保持し、UIは「無限sourceをlimitで有限化した
  Pipeline」であることをsource有限と区別して表示する（§5.3）。

## 10. DSL追加の設計（指示§6）

- Predicate: `currentValueCompare`（`n -> n < 5`）を追加。既存`fieldCompare` + GTEは無変更。
  演算子はGTE / LTのみをwhitelistする。
- Comparator: `{ kind: 'natural' }`と`{ kind: 'employeeKeys', keys: [{field, direction}] }`。
  許可キーは指示§6.3の8種（skillsは含めない）。Javaコードはキー型に応じて
  `comparing` / `comparingInt` / `comparingLong` / `comparingDouble`を使い分け、
  単一キーDESCは`.reversed()`、複合キーのDESCは`Comparator.reverseOrder()`第2引数で
  組み立てる（`.reversed()`が複合チェーン全体を反転してしまうのを避けるため）。
  `department.name` / `department.division`は先頭キーのみ明示型lambda
  （`(Employee e) -> e.department().name()`）で生成する（型推論のため）。
- Consumer: `printValue`（PRINT_VALUE） / `printField`（PRINT_FIELD、表示可能な
  単純値fieldのみ）。Side Effectメッセージ・Java式・説明を同一ASTから生成する。
- limit / skip引数: `Number.isSafeInteger`かつ0以上のみ受理（負数・小数・NaN・
  Infinity・safe integer外は`TYPE_MISMATCH`で事前拒否）。Java引数型がlongであることを
  検証メッセージ・jdkNotesへ反映する。表示コードは`.limit(3)`（int literalの
  自動拡大変換で正当なJava）とし、DSLにない値（L接尾辞等）を補わない。

## 11. 型規則（指示§5.2）

- object / primitive両Streamを表す`anyStreamLike` TypeRuleを追加し、7操作の入力規則に
  使用した（Phase 2の`anyStream`はobject Stream専用のまま無変更）。出力はidentity。
- sorted()（natural）: primitive Streamは常に受理。object Streamは要素型が
  String / Integer / Long / Double / LocalDateの場合のみ受理し、
  `Stream<Employee>.sorted()`はTYPE_MISMATCHで事前拒否する。
- sorted(Comparator): object Streamのみ。primitive Streamへの指定は拒否。
  employeeKeysはStream<Employee>のみ。
- takeWhile / dropWhile: 初版はsequential + ordered限定のため、unordered source
  （generate）との組合せを`UNORDERED_WHILE`として事前拒否する。
- distinctの等価判定キーは値種別ごとの構造キー（数値は数値等価 = Double.compare準拠、
  Employeeは全フィールド、配列は参照相当としてelementId）で導出する。

## 12. generate / iterate2の実行可能化とP2-R01の差異（指示§8.1）

- 旧template（`tmpl-src-generate` / `tmpl-src-iterate2`、limitなし・実行不能）は
  **削除せず保持**した。P2テスト（UNBOUNDED_SOURCE拒否の検証）の対象として残し、
  disabled理由の文言を「limit付きtemplateを使用」へ更新した。
- 実行可能化は新template `tmpl-limit-generate` / `tmpl-limit-iterate2`
  （template自体にlimitノードを含む）で行い、target operationを
  `source.generate` / `source.iterate2`として操作選択UIから実行可能にした。
- この結果、**P2-R01の一部アサーション（generate / iterate2がdisabledであること・
  disabled理由noteの存在）はPhase 3指示§8.1・§11.1・P3-R07と直接矛盾**するため、
  P2-R01を「generate / iterate2が選択可能・実行不能操作なし・Phase 4以降のみ未実装表示」
  へ更新した。テストの意図（実装済みだけ選択可能・未実装は理由表示）は維持・強化している。
  詳細は完了報告の「仕様との差異」を参照。

## 13. 視覚回帰基準画像の意図的更新

- Phase 3のUI変更（副題のPhase 3表記・操作選択リストへの7操作追加・未実装リスト更新）が
  全画面キャプチャに写るため、P1-E11 / P2-E10の基準画像を**意図的に更新**した。
  Phase 2でも同じ理由でP1-E11基準を更新した前例（commit 3356ef6）に従う。
- P3-E10の基準画像（distinct重複 / sorted order confirmed / takeWhile STOP /
  peek action）は代表snapshotだけを新規基準化した。
- `artifacts/phase-1/` / `artifacts/phase-2/`の過去Phase証跡は書き換えない
  （検証実行で再生成された分はHEADへ復元した）。
