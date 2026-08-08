import type { NodeId, OperationId, SlotId, TemplateId } from '../types/ids'
import type { ScenarioMode } from '../scenario/scenario'

/**
 * Pipelineテンプレートモデル（§8）。
 * 1つの学習対象操作に複数のテンプレートを登録できる。
 */
export interface ParameterSlot {
  readonly slotId: SlotId
  readonly targetNodeId: NodeId
  readonly kind: 'predicate'
  readonly required: boolean
  readonly allowedFields: readonly string[]
  readonly allowedOperators: readonly string[]
}

export interface PipelineTemplateNode {
  readonly nodeId: NodeId
  readonly operationId: OperationId
  readonly role: 'source' | 'intermediate' | 'terminal'
  readonly slotId: SlotId | null
}

export interface SourceDefinition {
  readonly kind: 'collectionStream'
  readonly elementTypeName: 'Employee'
  readonly ordered: boolean
  readonly finite: boolean
}

export interface SnapshotBudget {
  readonly limit: 500
  /** テンプレート設計時の概算最大値（実件数はinstantiate時に厳密検証） */
  readonly estimatedMax: number
}

export interface PipelineTemplate {
  readonly templateId: TemplateId
  readonly version: number
  readonly targetOperationId: OperationId
  /** 教材上の主対象ノード（教材制約の検証対象） */
  readonly targetNodeId: NodeId
  readonly title: string
  readonly sourceDefinition: SourceDefinition
  readonly nodes: readonly PipelineTemplateNode[]
  readonly parameterSlots: readonly ParameterSlot[]
  readonly allowedDslProfile: { readonly predicateKinds: readonly string[] }
  readonly supportedModes: readonly ScenarioMode[]
  readonly jdkNotes: readonly string[]
  readonly snapshotBudget: SnapshotBudget
}
