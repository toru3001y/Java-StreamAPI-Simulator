import type { NodeId, OperationId, ScenarioRevision } from '../types/ids'
import type { PipelineDefinition } from '../pipeline/pipelineDefinition'

/** シナリオモード（§11.2） */
export type ScenarioMode = 'standard' | 'midEmpty' | 'emptySource'

export const SCENARIO_MODE_LABELS: Readonly<Record<ScenarioMode, string>> = {
  standard: '標準',
  midEmpty: '途中0件',
  emptySource: '空ソース',
}

/** provenance（§11.1）。fixtureをAI生成として表示しないための根拠情報。 */
export interface ScenarioProvenance {
  readonly providerKind: 'FIXTURE' | 'AI'
  /** 決定性維持のためfixtureでは固定値を使用する */
  readonly generatedAt: string
  readonly dslVersion: string
}

export interface ScenarioSourceInfo {
  readonly kind: 'collectionStream'
  readonly ordered: boolean
  readonly finite: boolean
}

/** Scenario（§11.1）。pipelineは検証済みPipelineDefinition。 */
export interface Scenario {
  readonly scenarioId: string
  readonly title: string
  readonly description: string
  readonly targetOperationId: OperationId
  readonly mode: ScenarioMode
  readonly source: ScenarioSourceInfo
  /** 教材上の主対象ノード */
  readonly targetNodeId: NodeId
  readonly pipeline: PipelineDefinition
  readonly jdkNotes: readonly string[]
  readonly provenance: ScenarioProvenance
  readonly revision: ScenarioRevision
}
