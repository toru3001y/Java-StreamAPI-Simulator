import type { PipelineDefinition } from '../src/domain/pipeline/pipelineDefinition'
import type { OperationContextView, Snapshot, SnapshotKind } from '../src/domain/engine/snapshot'
import type { ScenarioMode } from '../src/domain/scenario/scenario'
import { makeDefinition, runAllSnapshots } from './helpers'
import { P7_TEMPLATES } from '../src/domain/template/templatesP7'

/** Phase 7テスト共通helper */

export type GatherContext = Extract<OperationContextView, { kind: 'gather' }>

/** 全gather templateのnodeIdは共通（templatesP7.ts） */
export const GATHER_NODE_ID = 'node-gather'

export interface GatherRun {
  readonly def: PipelineDefinition
  readonly snapshots: readonly Snapshot[]
  readonly kinds: readonly SnapshotKind[]
}

export function runGather(templateId: string, mode: ScenarioMode = 'standard'): GatherRun {
  const def = makeDefinition(templateId, mode)
  const snapshots = runAllSnapshots(def)
  return { def, snapshots, kinds: snapshots.map((s) => s.kind) }
}

/** gather専用contextを取り出す（未設定はエラーにする） */
export function gatherCtxOf(snapshot: Snapshot, nodeId = GATHER_NODE_ID): GatherContext {
  const ctx = snapshot.operationContexts[nodeId]
  if (!ctx || ctx.kind !== 'gather') {
    throw new Error(`gather contextがありません: ${nodeId} @ ${snapshot.snapshotId}`)
  }
  return ctx
}

/** 最終snapshotのgather context */
export function lastGatherCtx(run: GatherRun): GatherContext {
  const last = run.snapshots[run.snapshots.length - 1]
  if (!last) throw new Error('snapshotがありません')
  return gatherCtxOf(last)
}

/** 出力アイテムのラベル列（toList終端） */
export function outputLabels(run: GatherRun): string[] {
  const last = run.snapshots[run.snapshots.length - 1]
  if (!last) throw new Error('snapshotがありません')
  return last.output.items.map((item) => item.label)
}

/** 全gather template × supportedModesの組 */
export function gatherTemplateModes(): { templateId: string; mode: ScenarioMode }[] {
  return P7_TEMPLATES.flatMap((t) => t.supportedModes.map((mode) => ({ templateId: t.templateId, mode })))
}

/** 指定kindのsnapshot（順序どおり） */
export function snapshotsOfKind(run: GatherRun, kind: SnapshotKind): readonly Snapshot[] {
  return run.snapshots.filter((s) => s.kind === kind)
}
