import { createDefaultCatalog } from '../domain/catalog/operations'
import type { OperationCategory } from '../domain/catalog/operationCatalog'
import { createDefaultTemplateRegistry } from '../domain/template/templates'
import type { PipelineTemplate } from '../domain/template/pipelineTemplate'
import { FixtureScenarioProvider } from '../providers/fixtureScenarioProvider'
import { AI_CAPABILITY, type ProviderCapability } from '../providers/scenarioProvider'
import { buildScenario } from '../application/scenarioFactory'
import {
  createTimeoutScheduler,
  SimulationSession,
  type Scheduler,
} from '../application/session'
import type { ScenarioMode } from '../domain/scenario/scenario'
import type { OperationId, TemplateId } from '../domain/types/ids'
import { DSL_VERSION } from '../domain/dsl/ast'

/**
 * アプリ全体の組み立て。
 * UIは確定snapshotの描画と操作受付だけを行い、結果・型・親子位置を独自計算しない（§5.2）。
 */
export interface OperationChoice {
  readonly operationId: OperationId
  readonly displayName: string
  readonly category: OperationCategory
  /** 実行可能templateが1つもない操作（generate / 2引数iterate）はfalse */
  readonly executable: boolean
  readonly disabledReason: string | null
}

/** Phase 4以降の未実装操作（選択不能として理由を表示する。Phase 3の7操作は実装済み） */
export const UNIMPLEMENTED_OPERATIONS: readonly { name: string; phase: number }[] = [
  { name: 'reduce', phase: 4 },
  { name: 'count', phase: 4 },
  { name: 'min / max', phase: 4 },
  { name: 'findFirst / findAny', phase: 4 },
  { name: 'anyMatch / allMatch / noneMatch', phase: 4 },
  { name: 'sum / average / summaryStatistics', phase: 4 },
  { name: 'toArray', phase: 4 },
  { name: 'forEach / forEachOrdered', phase: 4 },
  { name: 'collect（Collector）', phase: 5 },
  { name: 'groupingBy / partitioningBy', phase: 5 },
]

export interface AppInstance {
  readonly session: SimulationSession
  readonly aiCapability: ProviderCapability
  readonly templates: readonly PipelineTemplate[]
  readonly operations: readonly OperationChoice[]
  templatesFor(operationId: OperationId): readonly PipelineTemplate[]
  selectScenario(templateId: TemplateId, mode: ScenarioMode): void
}

export function createApp(options?: { scheduler?: Scheduler }): AppInstance {
  const catalog = createDefaultCatalog()
  const registry = createDefaultTemplateRegistry()
  const provider = new FixtureScenarioProvider()
  const scheduler = options?.scheduler ?? createTimeoutScheduler()
  const templates = registry.listAll()
  const allowedTemplateIds = templates.map((t) => t.templateId)

  const operationIds = [...new Set(templates.map((t) => t.targetOperationId))]
  const operations: OperationChoice[] = operationIds.map((operationId) => {
    const ownTemplates = templates.filter((t) => t.targetOperationId === operationId)
    const executable = ownTemplates.some((t) => t.executable !== false)
    const disabledReason = executable
      ? null
      : (ownTemplates.find((t) => t.disabledReason)?.disabledReason ?? null)
    const op = catalog.get(operationId)
    return {
      operationId,
      displayName: op.displayName,
      category: op.category,
      executable,
      disabledReason,
    }
  })

  const makeScenario = (
    templateId: TemplateId,
    mode: ScenarioMode,
    currentScenarioRevision: string | null,
  ) => {
    const template = templates.find((t) => t.templateId === templateId)
    if (!template) throw new Error(`未登録のtemplateです: ${templateId}`)
    if (template.executable === false) {
      throw new Error(template.disabledReason ?? `template ${templateId} は実行できません`)
    }
    const candidate = provider.generate({
      targetOperationId: template.targetOperationId,
      mode,
      allowedTemplateIds,
      templateId,
      dslVersion: DSL_VERSION,
      currentScenarioRevision,
    })
    const result = buildScenario(registry, catalog, candidate)
    if (!result.ok) {
      throw new Error(
        `fixture候補の検証に失敗しました: ${result.issues.map((i) => i.message).join(' / ')}`,
      )
    }
    return result.value
  }

  const session = new SimulationSession(
    makeScenario('tmpl-filter-basic', 'standard', null),
    scheduler,
  )

  return {
    session,
    aiCapability: AI_CAPABILITY,
    templates,
    operations,
    templatesFor(operationId: OperationId) {
      return templates.filter((t) => t.targetOperationId === operationId)
    },
    selectScenario(templateId: TemplateId, mode: ScenarioMode): void {
      // §10.2: 現在のrevisionを渡し、切替のたびに新しいrevisionを発行させる
      const currentRevision = session.getState().scenario.revision
      session.switchScenario(makeScenario(templateId, mode, currentRevision))
    },
  }
}
