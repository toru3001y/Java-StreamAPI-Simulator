import type { DslPredicate } from '../dsl/ast'
import type { JavaCodeLine } from '../dsl/javaCode'
import type { DatasetElement } from '../model/employee'
import type {
  ElementStateKind,
  OperationTrait,
} from '../catalog/operationCatalog'
import type { LineId, NodeId, OperationId, ScenarioRevision, TemplateId } from '../types/ids'
import type { TypeRef } from '../types/typeRef'
import type { ScenarioMode } from '../scenario/scenario'

/**
 * PipelineDefinition（§8.3）。
 * 型と制約の検証を通過した不変定義であり、Step Engineが実行する唯一の入力。
 */
export interface PipelineNodeDef {
  readonly nodeId: NodeId
  readonly operationId: OperationId
  readonly role: 'source' | 'intermediate' | 'terminal'
  readonly traits: readonly OperationTrait[]
  readonly displayName: string
  readonly predicate: DslPredicate | null
  readonly inputType: TypeRef | null
  readonly outputType: TypeRef
  readonly lineId: LineId
  readonly legendStates: readonly ElementStateKind[]
  readonly visualizationKind: string
  readonly handlerId: string
  readonly jdkNotes: readonly string[]
}

export interface PipelineDefinition {
  readonly definitionId: string
  readonly templateId: TemplateId
  readonly templateVersion: number
  readonly mode: ScenarioMode
  readonly revision: ScenarioRevision
  readonly nodes: readonly PipelineNodeDef[]
  readonly dataset: readonly DatasetElement[]
  readonly resultType: TypeRef
  readonly javaCode: readonly JavaCodeLine[]
  /** 事前実行で確定した正確なsnapshot件数（§9.3 手順6） */
  readonly snapshotCount: number
}
