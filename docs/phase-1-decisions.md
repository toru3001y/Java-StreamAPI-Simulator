# Phase 1 判断記録

Draft v0.8 §21.5 で定められた Phase 1 中の判断事項（J-1 / J-3）の記録。
Draft v0.8 本体は編集せず、判断はこのファイルへ記録する。

## J-3: playbackState `ERROR` の扱い

**判断日**: 2026-08-08（history / engine 実装時）

### 遷移条件

- 入力検証（構造 → template/slot → ホワイトリスト → 型 → 教材制約 → snapshot予算）は
  `PipelineDefinition` 生成前に `instantiateTemplate`（`src/domain/template/instantiate.ts`）で完了する。
  通常の入力不正は `Result` の検証エラーとして拒否され、実行時 `ERROR` へは流れない。
- 実行時 `ERROR` は、Step Engine が `EngineInvariantError`（`src/domain/engine/stepEngine.ts`）を
  送出した場合に限るフェイルセーフとする。具体的な検知条件:
  - snapshot の revision が PipelineDefinition の revision と一致しない
  - 実行位置（progress）の要素 index / filter index が範囲外
  - filter ノードに Predicate が束縛されていない
  - 未知の progress phase / element stage

### 遷移時の動作

- `SimulationSession.stepForwardOnce`（`src/application/session.ts`）が `EngineInvariantError` を捕捉し、
  1. 自動再生タイマーを解除する
  2. 最後の確定 snapshot・history・cursor を保持する（破棄しない）
  3. `playbackState` を `ERROR` へ変更し、`stopReason` に検知内容を設定する
- `ERROR` 中は「進む」「戻る」「自動」を受け付けない。「最初から」または scenario 切替で復帰する
  （保存済み history は正常な確定 snapshot のみなので再利用可能）。

### ユーザー向け表示

- StickyPlaybackBar に `stopReason`（「エンジン内部の不整合を検知したため停止しました: …」）を表示する。
- 操作ボタンの disabled 状態を `ERROR` に連動させる。

### テスト方法

- 単体テスト: revision の食い違う snapshot を `nextSnapshot` へ渡し `EngineInvariantError` を確認する。
- Application テスト: 不整合 snapshot を注入した session で `ERROR` 遷移・タイマー解除・
  history 保持・stopReason 設定を確認する。

## J-1: JDK 25 Oracle Tests の Phase 1 での扱い

**判断日**: 2026-08-08（Phase 1 完了報告の作成前）

### 判断

**選択肢1を採用する: filter の標準・途中0件・空ソースの3モードを JDK 25 で照合する `P1-O01` を Phase 1 へ追加する。**

理由:

- 実行環境に Docker（29.6.2）と JDK 25 入りイメージ `gradle:9.6.1-jdk25` が存在し、
  Phase 1 の時点で再現可能に実行できるため、Phase 2 へ先送りする理由がない。
- filter 3モードの期待結果（佐藤・高橋 / 空 / 空）を Simulation Core と固定 Java コードの
  双方から得て突き合わせることで、§24.4 の照合方式を最小構成で確立できる。

### JDK 25 ランタイムの調達方法

- ローカルの Docker イメージ `gradle:9.6.1-jdk25` を使用する（Eclipse Temurin 25 ローカル導入の変形。
  ベンダー・バージョンは実行時に `java -version` で採取し、下記の実行結果に記録する）。
- 再実行手順: `npm run test:oracle`（`oracle/run-oracle.mjs` が Docker 経由で
  `oracle/OracleP1.java` をコンパイル・実行し、`oracle/expected-p1.json` と照合する）。

### 実行結果

- 実行日: 2026-08-08（JST）
- 実行コマンド: `npm run test:oracle`（exit code 0）
- JDKベンダー・バージョン（`java -version` 実測）:
  - `openjdk version "25.0.3" 2026-04-21 LTS`
  - `OpenJDK Runtime Environment Temurin-25.0.3+9`（**Eclipse Temurin 25** であることを確認）
- 照合対象と結果（すべて完全一致 / PASS）:
  - 標準（age >= 30）: `["佐藤","高橋"]`
  - 途中0件（age >= 100）: `[]`
  - 空ソース: `[]`
  - filterチェーン（25/28/30/35/40）: `["高橋"]`
  - `Stream.toList()` のunmodifiable性: `true`（`add`で`UnsupportedOperationException`）
- 期待値ファイル `oracle/expected-from-core.json` と Simulation Core の一致は
  `tests/domain/oracleSync.test.ts`（P1-O01(sync)）で保証している。
- 結果レポート: `artifacts/phase-1/oracle-result.md`
