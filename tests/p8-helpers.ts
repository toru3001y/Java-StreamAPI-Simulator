import type { ScenarioMode } from '../src/domain/scenario/scenario'
import type {
  CollectorNodeView,
  ExecutionFailureView,
  OperationContextView,
  Snapshot,
  SnapshotKind,
} from '../src/domain/engine/snapshot'
import type { PipelineDefinition } from '../src/domain/pipeline/pipelineDefinition'
import type { DatasetElement } from '../src/domain/model/employee'
import { STANDARD_EMPLOYEES } from '../src/domain/fixtures/employees'
import { MERGE_DEMO_EMPLOYEES } from '../src/domain/fixtures/mergeDemoEmployees'
import { P8_TEMPLATES } from '../src/domain/template/templatesP8'
import { makeDefinition, runAllSnapshots } from './helpers'
import { makeCustomDefinition } from './p3-helpers'
import { localCollectTemplate } from './p5-helpers'

/** Phase 8（Collectors.toMap）テスト共通helper */

export type CollectorContext = Extract<OperationContextView, { kind: 'collector' }>

/** P8 template × supportedModeの全組合せ（10件。指示§8.2の10ケースと1対1） */
export const P8_TEMPLATE_MODES: readonly { templateId: string; mode: ScenarioMode }[] =
  P8_TEMPLATES.flatMap((t) => t.supportedModes.map((mode) => ({ templateId: t.templateId, mode })))

export function snapshotsOf(templateId: string, mode: ScenarioMode = 'standard'): Snapshot[] {
  return runAllSnapshots(makeDefinition(templateId, mode))
}

export function kindsOf(templateId: string, mode: ScenarioMode = 'standard'): SnapshotKind[] {
  return snapshotsOf(templateId, mode).map((s) => s.kind)
}

export function lastOf(templateId: string, mode: ScenarioMode = 'standard'): Snapshot {
  const snapshots = snapshotsOf(templateId, mode)
  const last = snapshots[snapshots.length - 1]
  if (!last) throw new Error(`snapshotがありません: ${templateId}:${mode}`)
  return last
}

/** kind + currentElementIdの列（§8.2の確定列との完全一致検証に使う） */
export function kindElementPairs(snapshots: readonly Snapshot[]): string[] {
  return snapshots.map((s) => `${s.kind}${s.currentElementId ? `(${s.currentElementId})` : ''}`)
}

/** Collector固有contextを取り出す（存在しなければthrow） */
export function collectorCtxOf(snapshot: Snapshot): CollectorContext {
  const ctx = Object.values(snapshot.operationContexts).find((c) => c.kind === 'collector')
  if (!ctx || ctx.kind !== 'collector') {
    throw new Error(`snapshot ${snapshot.snapshotId} にcollector contextがありません`)
  }
  return ctx
}

/** Collector構造ツリーからtoMapノードを深さ優先で探す（bucket内も辿る） */
export function findToMapNode(node: CollectorNodeView): CollectorNodeView | null {
  if (node.collectorKind === 'toMap') return node
  for (const child of [node.downstream, node.left, node.right]) {
    if (!child) continue
    const found = findToMapNode(child)
    if (found) return found
  }
  for (const bucket of node.buckets) {
    const found = findToMapNode(bucket.node)
    if (found) return found
  }
  return null
}

/** toMapの蓄積entry（`keyLabel=valueLabel`の列）。順序はview確定順のまま */
export function toMapEntryPairs(node: CollectorNodeView): string[] {
  const acc = node.accumulation
  if (acc.kind !== 'TO_MAP') throw new Error(`TO_MAP蓄積viewではありません: ${acc.kind}`)
  return acc.entries.map((e) => `${e.keyLabel}=${e.valueLabel}`)
}

/** DSLを直接構築してtoMapを実行する（templateを追加せず配置別を検証するための経路） */
export function runLocalCollector(
  templateId: string,
  allowedCollectorKinds: readonly string[],
  collector: unknown,
  dataset: readonly DatasetElement[] = MERGE_DEMO_EMPLOYEES,
): { definition: PipelineDefinition; snapshots: Snapshot[]; kinds: SnapshotKind[] } {
  const definition = makeCustomDefinition(
    localCollectTemplate(templateId, allowedCollectorKinds),
    { 'slot-collector': collector },
    'standard',
    dataset,
    `${templateId}:r1`,
  )
  const snapshots = runAllSnapshots(definition)
  return { definition, snapshots, kinds: snapshots.map((s) => s.kind) }
}

/** 最終snapshotのExecutionFailureView（失敗していなければthrow） */
export function failureOf(snapshots: readonly Snapshot[]): ExecutionFailureView {
  const last = snapshots[snapshots.length - 1]
  if (!last) throw new Error('snapshotがありません')
  if (last.kind !== 'COLLECT_FAILED' || last.executionFailure === null) {
    throw new Error(`COLLECT_FAILEDで終端していません: ${last.kind}`)
  }
  return last.executionFailure
}

// ---- 検証で共有するDSL断片 ----

export const REGION_KEY = { kind: 'employeeField', field: 'region' } as const
export const NAME_KEY = { kind: 'employeeField', field: 'name' } as const
export const NAME_VALUE = { kind: 'fieldAccess', field: 'name' } as const
export const SALARY_VALUE = { kind: 'fieldAccess', field: 'salary' } as const
export const IDENTITY_VALUE = { kind: 'identity' } as const

/** 2引数版toMap（重複キーで実行失敗する） */
export function toMap2(
  keyMapper: unknown = REGION_KEY,
  valueMapper: unknown = NAME_VALUE,
): Record<string, unknown> {
  return { kind: 'toMap', keyMapper, valueMapper, mergeFunctionId: null, mapFactoryId: null }
}

/** 3引数版toMap */
export function toMap3(
  mergeFunctionId: string,
  keyMapper: unknown = REGION_KEY,
  valueMapper: unknown = NAME_VALUE,
): Record<string, unknown> {
  return { kind: 'toMap', keyMapper, valueMapper, mergeFunctionId, mapFactoryId: null }
}

/** 4引数版toMap（TreeMap::new） */
export function toMap4(
  mergeFunctionId: string,
  keyMapper: unknown = REGION_KEY,
  valueMapper: unknown = NAME_VALUE,
): Record<string, unknown> {
  return {
    kind: 'toMap',
    keyMapper,
    valueMapper,
    mergeFunctionId,
    mapFactoryId: 'TreeMap::new',
  }
}

export { MERGE_DEMO_EMPLOYEES, STANDARD_EMPLOYEES }
