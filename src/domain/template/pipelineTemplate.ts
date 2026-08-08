import type { NodeId, OperationId, SlotId, TemplateId } from '../types/ids'
import type { ScenarioMode } from '../scenario/scenario'
import type { SourceDsl } from '../dsl/sourceAst'

/**
 * Pipelineテンプレートモデル（§8）。
 * 1つの学習対象操作に複数のテンプレートを登録できる。
 */
export type ParameterSlot =
  | {
      readonly slotId: SlotId
      readonly targetNodeId: NodeId
      readonly kind: 'predicate'
      readonly required: boolean
      readonly allowedFields: readonly string[]
      readonly allowedOperators: readonly string[]
    }
  | {
      readonly slotId: SlotId
      readonly targetNodeId: NodeId
      readonly kind: 'mapper'
      readonly required: boolean
      readonly allowedMapperKinds: readonly string[]
    }
  | {
      readonly slotId: SlotId
      readonly targetNodeId: NodeId
      readonly kind: 'source'
      readonly required: boolean
      readonly allowedSourceKinds: readonly string[]
    }

export interface PipelineTemplateNode {
  readonly nodeId: NodeId
  readonly operationId: OperationId
  readonly role: 'source' | 'intermediate' | 'terminal'
  readonly slotId: SlotId | null
}

/**
 * SourceDefinition（Phase 2指示 §4）。
 * slotIdが指定されている場合はfixture / AIがsource DSLを設定する。
 * defaultDslはslot未指定時の既定source。
 */
export interface SourceDefinition {
  readonly slotId: SlotId | null
  readonly defaultDsl: SourceDsl | null
  readonly allowedSourceKinds: readonly string[]
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
  /**
   * 実行可能template（既定true）。generate / 2引数iterateは有限化操作（Phase 3のlimit）が
   * ないため実行不能とし、理由をUIで表示する（Phase 2指示 §6.1）。
   */
  readonly executable?: boolean
  readonly disabledReason?: string
}
