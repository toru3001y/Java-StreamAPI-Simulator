import type { PipelineTemplate } from './pipelineTemplate'
import { TemplateRegistry } from './templateRegistry'
import { OP_FILTER, OP_SOURCE_COLLECTION_STREAM, OP_TO_LIST } from '../catalog/operations'

/**
 * Phase 1の定義済み教材template（§21.2）。
 * 1操作（filter）へ複数templateを登録し、Registryの複数登録を実地で使用する。
 */

/** 基準template: stream() → filter(age >= 30) → toList()（§21.3） */
export const FILTER_BASIC_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-filter-basic',
  version: 1,
  targetOperationId: OP_FILTER,
  targetNodeId: 'node-filter-1',
  title: 'filterの基本（年齢での絞り込み）',
  sourceDefinition: {
    kind: 'collectionStream',
    elementTypeName: 'Employee',
    ordered: true,
    finite: true,
  },
  nodes: [
    { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
    { nodeId: 'node-filter-1', operationId: OP_FILTER, role: 'intermediate', slotId: 'slot-predicate-1' },
    { nodeId: 'node-sink', operationId: OP_TO_LIST, role: 'terminal', slotId: null },
  ],
  parameterSlots: [
    {
      slotId: 'slot-predicate-1',
      targetNodeId: 'node-filter-1',
      kind: 'predicate',
      required: true,
      allowedFields: ['age'],
      allowedOperators: ['GTE'],
    },
  ],
  allowedDslProfile: { predicateKinds: ['fieldCompare'] },
  supportedModes: ['standard', 'midEmpty', 'emptySource'],
  jdkNotes: ['filterは遅延評価であり、toList()の実行時に初めて要素が流れる。'],
  snapshotBudget: { limit: 500, estimatedMax: 30 },
}

/**
 * 横スクロール検証template（§21.2、M-1）:
 * stream() → filter(age >= 25) → filter(age >= 28) → filter(age >= 30)
 *          → filter(age >= 35) → filter(age >= 40) → toList()
 * filterノード5個をそれぞれ安定nodeIdで区別する。期待結果は高橋1件。
 * snapshotBudget: 4要素 × 5ノード ≒ 60前後、500上限内。
 */
export const FILTER_CHAIN_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-filter-chain',
  version: 1,
  targetOperationId: OP_FILTER,
  targetNodeId: 'node-filter-5',
  title: 'filterチェーン（横スクロール検証）',
  sourceDefinition: {
    kind: 'collectionStream',
    elementTypeName: 'Employee',
    ordered: true,
    finite: true,
  },
  nodes: [
    { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
    { nodeId: 'node-filter-1', operationId: OP_FILTER, role: 'intermediate', slotId: 'slot-predicate-1' },
    { nodeId: 'node-filter-2', operationId: OP_FILTER, role: 'intermediate', slotId: 'slot-predicate-2' },
    { nodeId: 'node-filter-3', operationId: OP_FILTER, role: 'intermediate', slotId: 'slot-predicate-3' },
    { nodeId: 'node-filter-4', operationId: OP_FILTER, role: 'intermediate', slotId: 'slot-predicate-4' },
    { nodeId: 'node-filter-5', operationId: OP_FILTER, role: 'intermediate', slotId: 'slot-predicate-5' },
    { nodeId: 'node-sink', operationId: OP_TO_LIST, role: 'terminal', slotId: null },
  ],
  parameterSlots: [1, 2, 3, 4, 5].map((n) => ({
    slotId: `slot-predicate-${n}`,
    targetNodeId: `node-filter-${n}`,
    kind: 'predicate' as const,
    required: true,
    allowedFields: ['age'],
    allowedOperators: ['GTE'],
  })),
  allowedDslProfile: { predicateKinds: ['fieldCompare'] },
  supportedModes: ['standard'],
  jdkNotes: ['複数のfilterは記述順に適用され、前段を通過した要素だけが後段へ到達する。'],
  snapshotBudget: { limit: 500, estimatedMax: 60 },
}

export function createDefaultTemplateRegistry(): TemplateRegistry {
  const registry = new TemplateRegistry()
  registry.register(FILTER_BASIC_TEMPLATE)
  registry.register(FILTER_CHAIN_TEMPLATE)
  return registry
}
