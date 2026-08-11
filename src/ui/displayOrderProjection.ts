import type { CollectorMapEntryView, SnapshotOutputItem } from '../domain/engine/snapshot'

/**
 * Set / Mapの学習用表示順projection（Draft v0.8 §16.3、Phase 5指示 §6.4・§10.2）。
 *
 * - Domain層は論理値とJDK上の順序性を保持し、この関数は**純粋なUI projection**である
 *   （Domain / Step Engineからは参照しない。Step Engineのbucket確定順とは独立）。
 * - 同じsnapshotから常に同じ順序を導出する（安定ソート）。
 * - TreeMap等、実際に順序性を持つ結果はその意味論を優先し、並べ替えない。
 */

/** 表示順の注記（JDKのiteration order保証とは別物であることを明示する） */
export const DISPLAY_ORDER_NOTICE =
  '表示を安定させるための学習用の順序です（JDKのiteration order保証とは別物です）。'

/** JDKの順序意味論を持つ結果の注記 */
export const JDK_ORDER_NOTICE = 'この結果はJDK上の順序性を持つため、実際の順序をそのまま表示します。'

function compareLabel(a: string, b: string): number {
  // Java StringのnaturalOrderingと同じUTF-16コード単位順で安定させる
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Setやコンテナ要素の表示順。JDK順序意味論を持つ場合は元の順序を維持する。
 */
export function projectItemOrder(
  items: readonly SnapshotOutputItem[],
  jdkOrdered: boolean,
): readonly SnapshotOutputItem[] {
  if (jdkOrdered) return items
  return [...items].sort((a, b) => compareLabel(a.label, b.label) || compareLabel(a.id, b.id))
}

/**
 * Mapのentry表示順。JDK順序意味論を持つ場合（TreeMap等）は実順序を優先する。
 */
export function projectEntryOrder(
  entries: readonly CollectorMapEntryView[],
  jdkOrdered: boolean,
): readonly CollectorMapEntryView[] {
  if (jdkOrdered) return entries
  return [...entries].sort((a, b) => compareLabel(a.keyLabel, b.keyLabel) || compareLabel(a.keyRef, b.keyRef))
}
