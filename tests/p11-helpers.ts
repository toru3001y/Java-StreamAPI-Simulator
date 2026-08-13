import type { CollectorNodeView, Snapshot, SnapshotKind } from '../src/domain/engine/snapshot'
import type { PipelineDefinition } from '../src/domain/pipeline/pipelineDefinition'
import { runAllSnapshots } from './helpers'
import { makeCustomDefinition } from './p3-helpers'
import { localCollectTemplate } from './p5-helpers'
import { NAME_VALUE, REGION_KEY } from './p8-helpers'

/**
 * Phase 11（unmodifiable系Collector。v0.14）テスト共通helper。
 *
 * DSL断片・ビルダーはPhase 8のtoMap系（`p8-helpers.ts`）と同じ形式。
 * §4非null不変条件の機械検証機構（意味値検査器・producer導出）は本ファイル後半に置く。
 */

/** toUnmodifiableList（引数なしのみ。v0.14 §2.1） */
export function toUnmodList(): Record<string, unknown> {
  return { kind: 'toUnmodifiableList' }
}

/** toUnmodifiableSet（引数なしのみ。v0.14 §2.1） */
export function toUnmodSet(): Record<string, unknown> {
  return { kind: 'toUnmodifiableSet' }
}

/** 2引数版toUnmodifiableMap（重複キーで実行失敗する。v0.14 §2.3） */
export function toUnmodMap2(
  keyMapper: unknown = REGION_KEY,
  valueMapper: unknown = NAME_VALUE,
): Record<string, unknown> {
  return { kind: 'toUnmodifiableMap', keyMapper, valueMapper, mergeFunctionId: null }
}

/** 3引数版toUnmodifiableMap */
export function toUnmodMap3(
  mergeFunctionId: string,
  keyMapper: unknown = REGION_KEY,
  valueMapper: unknown = NAME_VALUE,
): Record<string, unknown> {
  return { kind: 'toUnmodifiableMap', keyMapper, valueMapper, mergeFunctionId }
}

/**
 * 空入力（0件）でlocal Collectorを実行する（v0.14 §6の「要素なし」列）。
 * standardモードは入力データを要求するため、空入力は`emptySource`モードで組み立てる。
 */
export function runLocalCollectorEmpty(
  templateId: string,
  allowedCollectorKinds: readonly string[],
  collector: unknown,
): { definition: PipelineDefinition; snapshots: Snapshot[]; kinds: SnapshotKind[] } {
  const base = localCollectTemplate(templateId, allowedCollectorKinds)
  const definition = makeCustomDefinition(
    { ...base, supportedModes: ['standard', 'emptySource'] },
    { 'slot-collector': collector },
    'emptySource',
    [],
    `${templateId}:r1`,
  )
  const snapshots = runAllSnapshots(definition)
  return { definition, snapshots, kinds: snapshots.map((s) => s.kind) }
}

/**
 * Collector構造ツリーから指定kindのノードを深さ優先で探す（bucket内も辿る）。
 * `findToMapNode`（p8-helpers）のkind一般化版。
 */
export function findCollectorNode(
  node: CollectorNodeView,
  kind: string,
): CollectorNodeView | null {
  if (node.collectorKind === kind) return node
  for (const child of [node.downstream, node.left, node.right]) {
    if (!child) continue
    const found = findCollectorNode(child, kind)
    if (found) return found
  }
  for (const bucket of node.buckets) {
    const found = findCollectorNode(bucket.node, kind)
    if (found) return found
  }
  return null
}
