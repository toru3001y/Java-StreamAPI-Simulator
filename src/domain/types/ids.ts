/**
 * 安定ID群（Draft v0.8 §8.2, §10.3, §12.3）。
 * 画面内部用の安定IDはJava教材コードの業務フィールドと分離する（§6.1）。
 */
export type NodeId = string
export type ElementId = string
export type LineId = string
export type SnapshotId = string
export type TemplateId = string
export type ScenarioRevision = string
export type SlotId = string
export type OperationId = string

/** PipelineノードのJavaコード行ID（§8.2）。nodeIdから決定的に導出する。 */
export function lineIdForNode(nodeId: NodeId): LineId {
  return `line-${nodeId}`
}

export function snapshotIdFor(revision: ScenarioRevision, index: number): SnapshotId {
  return `${revision}#${index}`
}
