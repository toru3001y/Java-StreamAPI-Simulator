import type { SimValue } from '../model/value'

/**
 * 値の境界観測フック（v0.14 §4の非null不変条件の機械検証用）。
 *
 * **テスト専用のseam**であり、本番実行ではフックがnullのままで一切のコストを持たない
 * （呼出し側はnullチェックのみ）。観測は読み取りに限り、値・snapshot列・表示へは影響しない。
 *
 * 検証の主対象はunmodifiable Collector境界へ到達する値（§4「検査対象の定義」）であり、
 * collector内部の評価器（keyMapper / valueMapper / classifier / merge）の返却値も含む。
 * gatherの放出値は、合成List値が`assertNotCompositeList`によりCollectorへ構造的に
 * 到達できないため、放出点を当該producerの最終観測点として別フックで捕捉する。
 */

/** collector境界で観測する値の由来 */
export type CollectorBoundaryOrigin =
  /** accumulateNodeへ到達した入力値（mapping / flatMapping / bucket経由後を含む） */
  | 'accumulateInput'
  /** keyMapper / classifierの評価結果 */
  | 'keyResult'
  /** valueMapperの評価結果 */
  | 'valueResult'
  /** mergeFunctionの適用結果 */
  | 'mergeResult'

export type CollectorBoundaryTap = (value: SimValue, origin: CollectorBoundaryOrigin) => void

export type GatherEmissionTap = (value: SimValue, kind: string) => void

let collectorBoundaryTap: CollectorBoundaryTap | null = null
let gatherEmissionTap: GatherEmissionTap | null = null

export function setCollectorBoundaryTap(tap: CollectorBoundaryTap | null): void {
  collectorBoundaryTap = tap
}

export function setGatherEmissionTap(tap: GatherEmissionTap | null): void {
  gatherEmissionTap = tap
}

export function notifyCollectorBoundary(value: SimValue, origin: CollectorBoundaryOrigin): void {
  if (collectorBoundaryTap !== null) collectorBoundaryTap(value, origin)
}

export function notifyGatherEmission(value: SimValue, kind: string): void {
  if (gatherEmissionTap !== null) gatherEmissionTap(value, kind)
}
