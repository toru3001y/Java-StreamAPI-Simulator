import { createDefaultCatalog, OP_FILTER } from '../domain/catalog/operations'
import { createDefaultTemplateRegistry } from '../domain/template/templates'
import { FixtureScenarioProvider } from '../providers/fixtureScenarioProvider'
import { AI_CAPABILITY, type ProviderCapability } from '../providers/scenarioProvider'
import { buildScenario } from '../application/scenarioFactory'
import {
  createTimeoutScheduler,
  SimulationSession,
  type Scheduler,
} from '../application/session'
import type { ScenarioMode } from '../domain/scenario/scenario'
import type { TemplateId } from '../domain/types/ids'
import { DSL_VERSION } from '../domain/dsl/ast'
import type { PipelineTemplate } from '../domain/template/pipelineTemplate'

/**
 * アプリ全体の組み立て。
 * UIは確定snapshotの描画と操作受付だけを行い、結果・型・active nodeを独自計算しない（§5.2）。
 */
export interface AppInstance {
  readonly session: SimulationSession
  readonly aiCapability: ProviderCapability
  readonly templates: readonly PipelineTemplate[]
  selectScenario(templateId: TemplateId, mode: ScenarioMode): void
}

export function createApp(options?: { scheduler?: Scheduler }): AppInstance {
  const catalog = createDefaultCatalog()
  const registry = createDefaultTemplateRegistry()
  const provider = new FixtureScenarioProvider()
  const scheduler = options?.scheduler ?? createTimeoutScheduler()
  const templates = registry.listByTargetOperation(OP_FILTER)
  const allowedTemplateIds = templates.map((t) => t.templateId)

  const makeScenario = (
    templateId: TemplateId,
    mode: ScenarioMode,
    currentScenarioRevision: string | null,
  ) => {
    const candidate = provider.generate({
      targetOperationId: OP_FILTER,
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
    selectScenario(templateId: TemplateId, mode: ScenarioMode): void {
      // §10.2: 現在のrevisionを渡し、切替のたびに新しいrevisionを発行させる
      const currentRevision = session.getState().scenario.revision
      session.switchScenario(makeScenario(templateId, mode, currentRevision))
    },
  }
}
