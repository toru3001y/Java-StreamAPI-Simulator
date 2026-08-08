import { createDefaultCatalog } from '../src/domain/catalog/operations'
import { TemplateRegistry } from '../src/domain/template/templateRegistry'
import { instantiateTemplate } from '../src/domain/template/instantiate'
import type { PipelineTemplate } from '../src/domain/template/pipelineTemplate'
import type { PipelineDefinition } from '../src/domain/pipeline/pipelineDefinition'
import type { DatasetElement } from '../src/domain/model/employee'
import type { Result } from '../src/domain/types/result'
import type { ScenarioMode } from '../src/domain/scenario/scenario'
import type { Snapshot } from '../src/domain/engine/snapshot'
import { runAllSnapshots } from './helpers'

/**
 * Phase 3テスト用ヘルパー。
 * 本番registryにないPipeline構成（primitive sorted、stateful合成等）を
 * テストローカルのtemplateとして検証済みPipelineDefinitionへ変換する。
 */
export function instantiateCustom(
  template: PipelineTemplate,
  dslParameters: Readonly<Record<string, unknown>>,
  mode: ScenarioMode = 'standard',
  dataset: readonly DatasetElement[] = [],
  revision = 'p3-test:r1',
): Result<PipelineDefinition> {
  const registry = new TemplateRegistry()
  registry.register(template)
  const catalog = createDefaultCatalog()
  return instantiateTemplate(registry, catalog, {
    templateId: template.templateId,
    templateVersion: template.version,
    dataset,
    dslParameters,
    mode,
    revision,
  })
}

export function makeCustomDefinition(
  template: PipelineTemplate,
  dslParameters: Readonly<Record<string, unknown>>,
  mode: ScenarioMode = 'standard',
  dataset: readonly DatasetElement[] = [],
  revision = 'p3-test:r1',
): PipelineDefinition {
  const result = instantiateCustom(template, dslParameters, mode, dataset, revision)
  if (!result.ok) {
    throw new Error(
      `custom template instantiation failed: ${result.issues.map((i) => `${i.code}:${i.message}`).join(' / ')}`,
    )
  }
  return result.value
}

/** 最終snapshotのoutputラベル列 */
export function finalOutputLabels(def: PipelineDefinition): string[] {
  const snapshots = runAllSnapshots(def)
  const last = snapshots[snapshots.length - 1]
  if (!last) throw new Error('snapshotがありません')
  return last.output.items.map((item) => item.label)
}

export function finalSnapshot(def: PipelineDefinition): Snapshot {
  const snapshots = runAllSnapshots(def)
  const last = snapshots[snapshots.length - 1]
  if (!last) throw new Error('snapshotがありません')
  return last
}

/** 全snapshotでPROCESSING要素数が0または1であることを検証する（J-2） */
export function assertProcessingAtMostOne(snapshots: readonly Snapshot[], label: string): void {
  for (const snapshot of snapshots) {
    const processing = Object.values(snapshot.elementLatestStates).filter(
      (state) => state === 'PROCESSING',
    )
    if (processing.length > 1) {
      throw new Error(
        `${label}#${snapshot.index}（${snapshot.kind}）でPROCESSINGが${processing.length}件あります`,
      )
    }
  }
}

// ---- テストローカルtemplate定義用の小道具 ----

export function tplSrc(operationId: string) {
  return { nodeId: 'node-src', operationId, role: 'source' as const, slotId: 'slot-source' }
}

export function tplSink() {
  return { nodeId: 'node-sink', operationId: 'toList', role: 'terminal' as const, slotId: null }
}

export function intArraySource(values: readonly number[]) {
  return { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values }
}

export function lt(value: number) {
  return { kind: 'currentValueCompare', operator: 'LT', value: { type: 'int', value } }
}

export function streamOfSource(values: readonly string[]) {
  return { kind: 'streamOf', elementTypeName: 'String', values }
}
