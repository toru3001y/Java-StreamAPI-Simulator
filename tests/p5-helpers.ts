import type { ScenarioMode } from '../src/domain/scenario/scenario'
import type { Snapshot, SnapshotKind } from '../src/domain/engine/snapshot'
import type { OperationContextView } from '../src/domain/engine/snapshot'
import type { PipelineDefinition } from '../src/domain/pipeline/pipelineDefinition'
import type { PipelineTemplate } from '../src/domain/template/pipelineTemplate'
import type { DatasetElement } from '../src/domain/model/employee'
import { OP_COLLECT, OP_SOURCE_COLLECTION_STREAM } from '../src/domain/catalog/operations'
import { STANDARD_EMPLOYEES } from '../src/domain/fixtures/employees'
import { P5_TEMPLATES } from '../src/domain/template/templatesP5'
import { makeDefinition, runAllSnapshots } from './helpers'
import { makeCustomDefinition } from './p3-helpers'

/** Phase 5テスト共通ヘルパー */

/** P5 template × supportedModeの全組合せ（横断不変条件テスト用） */
export const P5_TEMPLATE_MODES: readonly { templateId: string; mode: ScenarioMode }[] =
  P5_TEMPLATES.flatMap((template) =>
    template.supportedModes.map((mode) => ({ templateId: template.templateId, mode })),
  )

/** Collector教材templateだけ（持越しのtakeWhile / dropWhileを除く） */
export const P5_COLLECTOR_TEMPLATE_MODES: readonly { templateId: string; mode: ScenarioMode }[] =
  P5_TEMPLATE_MODES.filter((entry) => entry.templateId.startsWith('tmpl-collect-'))

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

export function definitionOf(templateId: string, mode: ScenarioMode = 'standard'): PipelineDefinition {
  return makeDefinition(templateId, mode)
}

/** Collector固有contextを取り出す（存在しなければthrow） */
export function collectorContextOf(snapshot: Snapshot): Extract<
  OperationContextView,
  { kind: 'collector' }
> {
  const ctx = Object.values(snapshot.operationContexts).find((c) => c.kind === 'collector')
  if (!ctx || ctx.kind !== 'collector') {
    throw new Error(`snapshot ${snapshot.snapshotId} にcollector contextがありません`)
  }
  return ctx
}

/** teeing contextを再帰的に探す */
export function findTeeingView(
  node: Extract<OperationContextView, { kind: 'collector' }>['root'],
): NonNullable<Extract<OperationContextView, { kind: 'collector' }>['root']['teeing']> | null {
  if (node.teeing) return node.teeing
  for (const child of [node.downstream, node.left, node.right]) {
    if (!child) continue
    const found = findTeeingView(child)
    if (found) return found
  }
  for (const bucket of node.buckets) {
    const found = findTeeingView(bucket.node)
    if (found) return found
  }
  return null
}

/** PROCESSING要素数 */
export function processingCount(snapshot: Snapshot): number {
  return Object.values(snapshot.elementLatestStates).filter((s) => s === 'PROCESSING').length
}

/**
 * テストローカルCollector template（教材templateとして登録しない構成の機械検証用）。
 * 本番registryを使わず、この1件だけを登録した新規registryでinstantiateする。
 */
export function localCollectTemplate(
  templateId: string,
  allowedCollectorKinds: readonly string[],
): PipelineTemplate {
  return {
    templateId,
    version: 1,
    targetOperationId: OP_COLLECT,
    targetNodeId: 'node-sink',
    title: templateId,
    sourceDefinition: {
      slotId: null,
      defaultDsl: { kind: 'collection', collectionId: 'employees' },
      allowedSourceKinds: ['collection'],
    },
    nodes: [
      { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
      { nodeId: 'node-sink', operationId: OP_COLLECT, role: 'terminal', slotId: 'slot-collector' },
    ],
    parameterSlots: [
      {
        slotId: 'slot-collector',
        targetNodeId: 'node-sink',
        kind: 'collector',
        required: true,
        allowedCollectorKinds,
      },
    ],
    allowedDslProfile: { predicateKinds: [] },
    supportedModes: ['standard'],
    jdkNotes: [],
    snapshotBudget: { limit: 500, estimatedMax: 200 },
  }
}

/** テストローカルCollector templateのsnapshot列を得る */
export function localCollectSnapshots(
  templateId: string,
  allowedCollectorKinds: readonly string[],
  collector: unknown,
  dataset: readonly DatasetElement[] = STANDARD_EMPLOYEES,
): { snapshots: Snapshot[]; definition: PipelineDefinition } {
  const definition = makeCustomDefinition(
    localCollectTemplate(templateId, allowedCollectorKinds),
    { 'slot-collector': collector },
    'standard',
    dataset,
    `${templateId}:r1`,
  )
  return { snapshots: runAllSnapshots(definition), definition }
}
