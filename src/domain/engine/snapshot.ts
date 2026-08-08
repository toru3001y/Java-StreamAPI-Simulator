import type { ElementStateKind } from '../catalog/operationCatalog'
import type { ElementId, LineId, NodeId, ScenarioRevision, SnapshotId } from '../types/ids'

/**
 * Snapshot（§12）。
 * 学習上意味があり、全画面が同一時点を示し、「戻る」で完全に復元できる1つの確定状態。
 * 確定snapshotに未完了アニメーション状態を含めない（§12.6）。
 */
export type SnapshotKind =
  | 'INITIAL'
  | 'SOURCE_EMIT'
  | 'NODE_ARRIVAL'
  | 'PREDICATE_EVALUATED'
  | 'ELEMENT_PASSED'
  | 'ELEMENT_REJECTED'
  | 'SINK_APPENDED'
  | 'RESULT_CONFIRMED'
  | 'STREAM_CONSUMED'

/** 実行位置（§12.3）。Step Engineはここから次の確定snapshotを決定的に導出する。 */
export type ElementStage =
  | { readonly kind: 'EMITTED' }
  | { readonly kind: 'ARRIVED'; readonly filterIndex: number }
  | { readonly kind: 'EVALUATED'; readonly filterIndex: number; readonly result: boolean }
  | { readonly kind: 'RESOLVED'; readonly filterIndex: number; readonly passed: boolean }
  | { readonly kind: 'APPENDED' }

export type SnapshotProgress =
  | { readonly phase: 'INITIAL' }
  | { readonly phase: 'ELEMENT'; readonly elementIndex: number; readonly stage: ElementStage }
  | { readonly phase: 'RESULT' }
  | { readonly phase: 'CONSUMED' }

/** 処理中パネルの表示内容（§12.3 処理中）。UIはこの確定値を描画するだけで独自計算しない。 */
export interface ProcessingView {
  readonly title: string
  /** 値取得の流れ（例: 佐藤.age() → 35。視覚フローはUnicode矢印） */
  readonly inputLabel: string | null
  /** Java式（例: e -> e.age() >= 30。ASCII構文） */
  readonly expression: string | null
  /** 実値比較（例: 35 >= 30 → true） */
  readonly evaluation: string | null
  /** 通過 / 除外 等の確定結果 */
  readonly outcome: string | null
}

export interface SnapshotOutput {
  readonly elementIds: readonly ElementId[]
  readonly count: number
  readonly confirmed: boolean
  readonly resultTypeLabel: string
}

export interface Snapshot {
  readonly snapshotId: SnapshotId
  readonly index: number
  readonly revision: ScenarioRevision
  readonly kind: SnapshotKind
  readonly progress: SnapshotProgress
  readonly activeNodeId: NodeId | null
  readonly activeLineId: LineId | null
  readonly currentElementId: ElementId | null
  /** 要素 × 操作ノードごとの状態履歴（§12.4） */
  readonly elementNodeStates: Readonly<
    Record<ElementId, Readonly<Record<NodeId, ElementStateKind>>>
  >
  /** 入力パネル用: 各要素の最新状態（§12.4） */
  readonly elementLatestStates: Readonly<Record<ElementId, ElementStateKind>>
  readonly output: SnapshotOutput
  readonly processing: ProcessingView | null
  readonly explanation: {
    readonly current: string
    readonly next: string
    readonly jdkNote: string | null
  }
  /** 現操作で発生可能な状態だけ（§12.3 凡例） */
  readonly legend: readonly ElementStateKind[]
  readonly completion: 'NONE' | 'STREAM_CONSUMED'
}

export const ELEMENT_STATE_LABELS: Readonly<Record<ElementStateKind, string>> = {
  UNEVALUATED: '未評価',
  PROCESSING: '処理中',
  PASSED: '通過済み',
  REJECTED: '除外済み',
  BUFFERED: 'バッファ済み',
}

export const ELEMENT_STATE_SYMBOLS: Readonly<Record<ElementStateKind, string>> = {
  UNEVALUATED: '－',
  PROCESSING: '▶',
  PASSED: '○',
  REJECTED: '×',
  BUFFERED: '□',
}
