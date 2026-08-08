import type { ElementStateKind } from '../catalog/operationCatalog'
import type { ElementId, LineId, NodeId, ScenarioRevision, SnapshotId } from '../types/ids'

/**
 * Snapshot（§12）。
 * 学習上意味があり、全画面が同一時点を示し、「戻る」で完全に復元できる1つの確定状態。
 * 確定snapshotに未完了アニメーション状態を含めない（§12.6）。
 */
export type SnapshotKind =
  | 'INITIAL'
  | 'SOURCE_CANDIDATE'
  | 'SOURCE_PREDICATE_EVALUATED'
  | 'SOURCE_EMIT'
  | 'NODE_ARRIVAL'
  | 'PREDICATE_EVALUATED'
  | 'ELEMENT_PASSED'
  | 'ELEMENT_REJECTED'
  | 'MAPPING_APPLIED'
  | 'MAPPED_EMITTED'
  | 'MAPPED_STREAM_CREATED'
  | 'CHILD_EMITTED'
  | 'SINK_APPENDED'
  | 'RESULT_CONFIRMED'
  | 'STREAM_CONSUMED'

/** 処理中パネルの表示内容（§12.3 処理中）。UIはこの確定値を描画するだけで独自計算しない。 */
export interface ProcessingView {
  readonly title: string
  /** 値取得・値遷移の流れ（例: 佐藤.age() → 35。視覚フローはUnicode矢印） */
  readonly inputLabel: string | null
  /** Java式（例: e -> e.age() >= 30、Employee::name。ASCII構文） */
  readonly expression: string | null
  /** 実値の評価・変換（例: 35 >= 30 → true、佐藤（age=35） → "佐藤"） */
  readonly evaluation: string | null
  /** 通過 / 除外 / 追加 等の確定結果 */
  readonly outcome: string | null
}

/** flatMap親子文脈（§12.3 実行位置、Phase 2指示 §6.2・§9.3） */
export interface FlatMapContextView {
  readonly nodeId: NodeId
  readonly parentElementId: ElementId
  readonly parentLabel: string
  readonly children: readonly { readonly id: ElementId; readonly label: string }[]
  /** これまでに送出済みの子要素数 */
  readonly emittedCount: number
  /** mapped Streamのclose状態（独立snapshotにせず詳細として保持する） */
  readonly closed: boolean
}

/** source処理の文脈（Phase 2指示 §9.1） */
export interface SourceContextView {
  /** Arrays.stream等のindex */
  readonly index: number | null
  /** iterateの候補値ラベル */
  readonly candidateLabel: string | null
  /** iterate predicate式（ASCII） */
  readonly predicateText: string | null
  readonly predicateResult: boolean | null
  /** range境界等の補足 */
  readonly note: string | null
}

export interface SnapshotOutputItem {
  readonly id: ElementId
  readonly label: string
}

export interface SnapshotOutput {
  readonly elementIds: readonly ElementId[]
  readonly items: readonly SnapshotOutputItem[]
  readonly count: number
  readonly confirmed: boolean
  readonly resultTypeLabel: string
}

export interface Snapshot {
  readonly snapshotId: SnapshotId
  readonly index: number
  readonly revision: ScenarioRevision
  readonly kind: SnapshotKind
  readonly activeNodeId: NodeId | null
  readonly activeLineId: LineId | null
  readonly currentElementId: ElementId | null
  /** flatMap子要素処理中の親要素（§6.2: 親は文脈情報として保持し、処理中は1件のみ） */
  readonly parentElementId: ElementId | null
  readonly flatMapContext: FlatMapContextView | null
  readonly sourceContext: SourceContextView | null
  /** 型区間の変化（例: Stream<Employee> → IntStream。該当snapshotのみ） */
  readonly typeTransition: string | null
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
