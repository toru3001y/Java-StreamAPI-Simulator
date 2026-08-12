import type { SimValue } from '../model/value'

/**
 * Step Engineの不変条件違反（検証済みDefinitionでは到達しないはずの状態）。
 *
 * この例外型は単なる名前の違いではなく、**J-3のフェイルセーフ契約**そのものである:
 * `SimulationSession.step`（`src/application/session.ts`）は`EngineInvariantError`だけを捕捉して
 * タイマーを解除し、最後の確定snapshotとhistoryを保持したまま`ERROR`へ遷移する。
 * plain `Error`は再送出されるため、同じ内部不整合でも復帰可能性が変わる。
 *
 * `src/domain/dsl`（DSL評価）と`src/domain/engine`（Step Engine / Collector runtime）の双方から
 * 参照するため、依存を持たない`src/domain/types`へ置く（型importのみで循環は生じない）。
 */
export class EngineInvariantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineInvariantError'
  }
}

/**
 * 合成List値（`SimValue`の`list` variant）の到達不能経路を塞ぐ共通ガード
 * （Phase 7指示 §5.2、P7-D07）。
 *
 * Phase 7の実行範囲ではgatherの下流はtoList / findFirstのみ（v0.9 §8.4のPipeline合成の限定）であり、
 * 合成List値がDSL評価・Comparator・Consumer・Reduction・Collectorへ到達することはない。
 * 到達した場合はエンジン内部の不整合であるため、`EngineInvariantError`で停止させる。
 *
 * **既存kindの例外型は変更しない**: 各関数の先頭で`list`だけを判定し、
 * それ以外のkindは従来どおりの検証・例外へ進む。
 */
export function assertNotCompositeList(value: SimValue, where: string): void {
  if (value.kind === 'list') {
    throw new EngineInvariantError(
      `${where}は合成List値を扱えません（Phase 7範囲ではgatherの下流はtoList / findFirstのみです）`,
    )
  }
}
