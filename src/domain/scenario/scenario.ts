import type { NodeId, OperationId, ScenarioRevision } from '../types/ids'
import type { PipelineDefinition } from '../pipeline/pipelineDefinition'

/** シナリオモード（§11.2） */
export type ScenarioMode = 'standard' | 'midEmpty' | 'emptySource'

export const SCENARIO_MODE_LABELS: Readonly<Record<ScenarioMode, string>> = {
  standard: '標準',
  midEmpty: '途中0件',
  emptySource: '空ソース',
}

/**
 * provenance（§11.1、v0.10 §4.1で種別を変更）。
 * fixtureを取込サンプルと表示せず、取込サンプルを固定サンプルと表示しないための根拠情報。
 */
export interface ScenarioProvenance {
  readonly providerKind: 'FIXTURE' | 'IMPORTED'
  /** 決定性維持のためfixtureでは固定値を使用する。取込候補は取込時刻（UTC ISO 8601） */
  readonly generatedAt: string
  readonly dslVersion: string
}

/** provider種別の表示名（v0.10 §4.1）。「AI生成」という表示は使用しない。 */
export const PROVIDER_KIND_LABELS: Readonly<Record<ScenarioProvenance['providerKind'], string>> = {
  FIXTURE: '固定サンプル',
  IMPORTED: '取込サンプル',
}

export interface ScenarioSourceInfo {
  /** source操作のoperationId */
  readonly kind: string
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
