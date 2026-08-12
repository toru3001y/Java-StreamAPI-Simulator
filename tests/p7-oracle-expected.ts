import { formatTypeRef } from '../src/domain/types/typeRef'
import { makeDefinition, runAllSnapshots } from './helpers'
import type { ScenarioMode } from '../src/domain/scenario/scenario'
import type { Snapshot } from '../src/domain/engine/snapshot'

/**
 * P7-O01の期待値をSimulation Coreから導出する（Phase 7指示 §12.5）。
 *
 * §8.2の11ケース（standard 7 + emptySource 4）の実行結果を、
 * 固定Java 25コード（oracle/OracleP7.java）と**JSON文字列厳密照合**する。
 * v0.9 §7の空入力表4行（windowFixed空 / windowSliding空 / scan空 / fold空）を
 * すべて含む。「導出」区分2件（scan空・fold空）は導出と実測が食い違えば照合がFAILになる。
 *
 * 表記整合の選定判断（docs/phase-7-decisions.md）:
 * - 窓・要素のラベルはSimulation Coreの`formatSimValue`表記をそのまま用いる
 *   （Employee要素は`佐藤（age=35）`、String要素は`"Java"`、Listは`[要素1, 要素2]`の再帰整形）。
 *   Java側は同じ規則の整形関数（employeeLabel / stringLabel / listLabel）で表記を揃える。
 * - longは`formatLongLiteral`（3桁区切り + L）表記で保持し、Java側も同じ規則で出力する
 *   （Phase 5〜6で確立した方式の踏襲。numberへ変換しない）。
 * - gather出力要素のboxed型名（Integer / Long）はCoreのTypeRefから導出し、
 *   Java側は実値の`getClass().getSimpleName()`と照合する（v0.9 §8.3の裏取り）。
 * - JDK内部実装の観測（Greedy / defaultCombiner / defaultFinisher）は
 *   OBSERVATION行として厳密比較の対象外に置く（v0.9 §10-3）。
 */

function lastSnapshotOf(templateId: string, mode: ScenarioMode): Snapshot {
  const snapshots = runAllSnapshots(makeDefinition(templateId, mode))
  const last = snapshots[snapshots.length - 1]
  if (!last) throw new Error(`snapshotがありません: ${templateId}:${mode}`)
  return last
}

/** toList終端の出力ラベル列 */
function listLabelsOf(templateId: string, mode: ScenarioMode): string[] {
  return lastSnapshotOf(templateId, mode).output.items.map((item) => item.label)
}

/** findFirst終端のOptional結果 */
function optionalOf(templateId: string, mode: ScenarioMode): {
  present: boolean
  valueLabel: string
} {
  const result = lastSnapshotOf(templateId, mode).output.result
  if (result.kind !== 'OPTIONAL') {
    throw new Error(`OPTIONAL結果ではありません: ${templateId}:${mode} (${result.kind})`)
  }
  return { present: result.present, valueLabel: result.valueLabel ?? '' }
}

/** gatherノードの出力要素型名（boxed型。v0.9 §8.3） */
function gatherElementTypeName(templateId: string): string {
  const def = makeDefinition(templateId, 'standard')
  const node = def.nodes.find((n) => n.nodeId === 'node-gather')
  if (!node || node.outputType.kind !== 'stream') {
    throw new Error(`gatherノードの出力型を取得できません: ${templateId}`)
  }
  return formatTypeRef(node.outputType.elementType)
}

export function buildP7ExpectedFromCore(): Record<string, unknown> {
  const foldSalary = optionalOf('tmpl-gather-fold', 'standard')
  const foldEmpty = optionalOf('tmpl-gather-fold', 'emptySource')
  return {
    // ---- §8.2 #1 / #2 / #3: windowFixed ----
    windowFixed3: listLabelsOf('tmpl-gather-window-fixed', 'standard'),
    windowFixed2: listLabelsOf('tmpl-gather-window-fixed-exact', 'standard'),
    windowFixedEmpty: listLabelsOf('tmpl-gather-window-fixed', 'emptySource'),
    // ---- §8.2 #4 / #5 / #6: windowSliding ----
    windowSliding2: listLabelsOf('tmpl-gather-window-sliding', 'standard'),
    windowSlidingShort: listLabelsOf('tmpl-gather-window-sliding-short', 'standard'),
    windowSlidingEmpty: listLabelsOf('tmpl-gather-window-sliding', 'emptySource'),
    // ---- §8.2 #7 / #8 / #9: scan ----
    scanSum: listLabelsOf('tmpl-gather-scan', 'standard'),
    scanEmpty: listLabelsOf('tmpl-gather-scan', 'emptySource'),
    scanConcat: listLabelsOf('tmpl-gather-scan-concat', 'standard'),
    // ---- §8.2 #10 / #11: fold → findFirst ----
    foldSalaryPresent: foldSalary.present,
    foldSalary: foldSalary.valueLabel,
    foldEmptyPresent: foldEmpty.present,
    foldEmpty: foldEmpty.valueLabel,
    // ---- 出力要素のboxed型（v0.9 §8.3の型適合表） ----
    scanElementClass: gatherElementTypeName('tmpl-gather-scan'),
    foldElementClass: gatherElementTypeName('tmpl-gather-fold'),
  }
}
