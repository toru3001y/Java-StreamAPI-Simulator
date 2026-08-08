import type { DslPredicate } from '../dsl/ast'
import type { ComparatorDsl } from '../dsl/comparatorAst'
import type { ConsumerDsl } from '../dsl/consumerAst'
import type { MapperDsl } from '../dsl/mapperAst'
import type { SourceDsl } from '../dsl/sourceAst'
import type { BoundednessMeta } from './boundedness'
import type { IterateCandidate, SourceElement } from '../dsl/materializeSource'
import type { JavaCodeLine } from '../dsl/javaCode'
import type { DatasetElement } from '../model/employee'
import type { ElementStateKind, OperationTrait } from '../catalog/operationCatalog'
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
  readonly mapper: MapperDsl | null
  /** sorted(Comparator)の検証済みComparator DSL（Phase 3指示 §6.3） */
  readonly comparator: ComparatorDsl | null
  /** peekの検証済みConsumer DSL（Phase 3指示 §6.5） */
  readonly consumer: ConsumerDsl | null
  /** limit / skipの検証済み引数（Phase 3指示 §6.4。Java APIの引数型はlong） */
  readonly count: number | null
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
  /** 教材上の主対象ノード（凡例・教材制約の基準） */
  readonly targetNodeId: NodeId
  readonly nodes: readonly PipelineNodeDef[]
  /** 検証済みsource DSL */
  readonly sourceDsl: SourceDsl
  /** 具現化済みのsource送出要素（安定ID付き） */
  readonly dataset: readonly SourceElement[]
  /** iterate 3引数の候補判定トレース（該当sourceのみ） */
  readonly iterateTrace: readonly IterateCandidate[] | null
  /** Javaコード生成に使用したEmployee dataset（collection source時のみ非空） */
  readonly employeeDataset: readonly DatasetElement[]
  readonly resultType: TypeRef
  readonly javaCode: readonly JavaCodeLine[]
  /** 事前実行で確定した正確なsnapshot件数（§9.3 手順6） */
  readonly snapshotCount: number
  /** 順序メタデータ（Phase 3指示 §5.3）。encounter orderの扱いは各操作が維持する */
  readonly orderMeta: {
    readonly sourceOrdered: boolean
    /** Pipeline結果のencounter orderが定義されるか（unordered sourceでは未定義のまま） */
    readonly resultOrdered: boolean
  }
  /** 有限性メタデータ（Phase 3指示 §5.3・§8.2） */
  readonly boundedness: BoundednessMeta
}
