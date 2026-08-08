# Phase 3 判断記録

- 判断日: 2026-08-08
- 対象: Draft v0.8 §21.5 **J-2** のうち、Phase 3着手前が期限の `sorted` の例外規定
- 状態: **J-2（sorted）確定済み。Phase 3の実装は未着手**（本判断はPhase 3実装開始指示ではない）

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
