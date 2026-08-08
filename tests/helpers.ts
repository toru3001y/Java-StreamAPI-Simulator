import { createDefaultCatalog } from '../src/domain/catalog/operations'
import { createDefaultTemplateRegistry } from '../src/domain/template/templates'
import { FixtureScenarioProvider } from '../src/providers/fixtureScenarioProvider'
import { buildScenario } from '../src/application/scenarioFactory'
import { DSL_VERSION } from '../src/domain/dsl/ast'
import type { Scenario, ScenarioMode } from '../src/domain/scenario/scenario'
import type { PipelineDefinition } from '../src/domain/pipeline/pipelineDefinition'
import type { Snapshot } from '../src/domain/engine/snapshot'
import { createInitialSnapshot, nextSnapshot } from '../src/domain/engine/stepEngine'
import type { Scheduler } from '../src/application/session'
import type { TemplateId } from '../src/domain/types/ids'

export function makeScenario(
  templateId: TemplateId = 'tmpl-filter-basic',
  mode: ScenarioMode = 'standard',
): Scenario {
  const catalog = createDefaultCatalog()
  const registry = createDefaultTemplateRegistry()
  const provider = new FixtureScenarioProvider()
  const template = registry.listAll().find((t) => t.templateId === templateId)
  if (!template) throw new Error(`unknown template: ${templateId}`)
  const candidate = provider.generate({
    targetOperationId: template.targetOperationId,
    mode,
    allowedTemplateIds: [templateId],
    templateId,
    dslVersion: DSL_VERSION,
    currentScenarioRevision: null,
  })
  const result = buildScenario(registry, catalog, candidate)
  if (!result.ok) {
    throw new Error(`scenario build failed: ${result.issues.map((i) => i.message).join(' / ')}`)
  }
  return result.value
}

/** 実行可能な全template × supportedModes の組（横断検証用） */
export function executableTemplateModes(): readonly {
  templateId: TemplateId
  mode: ScenarioMode
}[] {
  const registry = createDefaultTemplateRegistry()
  return registry
    .listAll()
    .filter((t) => t.executable !== false)
    .flatMap((t) => t.supportedModes.map((mode) => ({ templateId: t.templateId, mode })))
}

export function makeDefinition(
  templateId: TemplateId = 'tmpl-filter-basic',
  mode: ScenarioMode = 'standard',
): PipelineDefinition {
  return makeScenario(templateId, mode).pipeline
}

/** 初期snapshotから最終snapshotまでエンジンで実行し全snapshotを返す */
export function runAllSnapshots(def: PipelineDefinition): Snapshot[] {
  const snapshots: Snapshot[] = [createInitialSnapshot(def)]
  for (;;) {
    const current = snapshots[snapshots.length - 1]
    if (!current) throw new Error('unreachable')
    const next = nextSnapshot(def, current)
    if (next === null) return snapshots
    snapshots.push(next)
    if (snapshots.length > 1000) throw new Error('snapshot列が終了しません')
  }
}

/** 手動flush式のfake scheduler（React統合テスト用） */
export class FakeScheduler implements Scheduler {
  private seq = 0
  readonly pending = new Map<number, () => void>()

  schedule(callback: () => void, _ms: number): unknown {
    this.seq += 1
    this.pending.set(this.seq, callback)
    return this.seq
  }

  cancel(handle: unknown): void {
    this.pending.delete(handle as number)
  }

  /** 期限到来した1 tickを実行する */
  flushOne(): void {
    const first = this.pending.entries().next()
    if (first.done) return
    const [id, callback] = first.value
    this.pending.delete(id)
    callback()
  }
}
