import { createDefaultCatalog } from '../domain/catalog/operations'
import type { OperationCategory } from '../domain/catalog/operationCatalog'
import { createDefaultTemplateRegistry } from '../domain/template/templates'
import type { PipelineTemplate } from '../domain/template/pipelineTemplate'
import { FixtureScenarioProvider } from '../providers/fixtureScenarioProvider'
import { buildScenario } from '../application/scenarioFactory'
import {
  createTimeoutScheduler,
  SimulationSession,
  type Scheduler,
} from '../application/session'
import type { Scenario, ScenarioMode } from '../domain/scenario/scenario'
import type { OperationId, TemplateId } from '../domain/types/ids'
import type { Result } from '../domain/types/result'
import { fail, issue, ok } from '../domain/types/result'
import { DSL_VERSION } from '../domain/dsl/ast'
import { CandidateImportService, type Clock } from '../application/candidateImport'
import { buildImportPrompt } from '../application/promptGenerator'

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

/**
 * 未実装操作（選択不能として理由を表示する）。
 * Phase 5でcollect / 3引数collect / Collectors各種が実装済みとなったため0件（Phase 5指示 §10.1）。
 * Phase 6の手動連携はStream操作ではないためこのリストの対象外であり、取込UI（§8）で扱う。
 * 空のときUIは「未実装」optgroupを描画しない。
 */
export const UNIMPLEMENTED_OPERATIONS: readonly { name: string; phase: number }[] = []

/** 取込可否（実行不能templateは「プロンプトをコピー」「候補を貼り付け」を無効化する。v0.10 §5.1） */
export interface Importability {
  readonly importable: boolean
  readonly reason: string | null
}

export interface AppInstance {
  readonly session: SimulationSession
  readonly templates: readonly PipelineTemplate[]
  readonly operations: readonly OperationChoice[]
  templatesFor(operationId: OperationId): readonly PipelineTemplate[]
  selectScenario(templateId: TemplateId, mode: ScenarioMode): void
  /** 取込対象かどうかと、対象外の理由（v0.10 §5.1） */
  importabilityOf(templateId: TemplateId): Importability
  /** 選択中の操作・モード・templateに対する生成依頼文（v0.10 §5.2、Phase 6指示 §8） */
  generatePrompt(templateId: TemplateId, mode: ScenarioMode): Result<string>
  /**
   * 貼付テキストを検証し、合格時だけシナリオ切替として取込サンプルを反映する（v0.10 §8）。
   * 不合格時は現在のシナリオ・履歴・再生状態を一切変更せず、理由をissuesで返す。
   */
  importCandidate(templateId: TemplateId, mode: ScenarioMode, text: string): Result<Scenario>
}

export function createApp(options?: { scheduler?: Scheduler; clock?: Clock }): AppInstance {
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

  const importService = new CandidateImportService(registry, catalog, options?.clock)
  // プロンプトの出力例に使うfixture。表示用シナリオのrevision採番へ影響させないため別インスタンスにする
  const exampleProvider = new FixtureScenarioProvider()

  const templateOf = (templateId: TemplateId): PipelineTemplate | undefined =>
    templates.find((t) => t.templateId === templateId)

  return {
    session,
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
    importabilityOf(templateId: TemplateId): Importability {
      const template = templateOf(templateId)
      if (!template) return { importable: false, reason: `未登録のtemplateです: ${templateId}` }
      return importService.importability(template)
    },
    generatePrompt(templateId: TemplateId, mode: ScenarioMode): Result<string> {
      const template = templateOf(templateId)
      if (!template) {
        return fail([issue('IMPORT_SCHEMA', `未登録のtemplateです: ${templateId}`, 'templateId')])
      }
      const importability = importService.importability(template)
      if (!importability.importable) {
        return fail([
          issue(
            'IMPORT_SCHEMA',
            importability.reason ?? `template ${templateId} は取込対象外です`,
            'templateId',
          ),
        ])
      }
      const example = exampleProvider.generate({
        targetOperationId: template.targetOperationId,
        mode,
        allowedTemplateIds,
        templateId,
        dslVersion: DSL_VERSION,
        currentScenarioRevision: null,
      })
      return ok(
        buildImportPrompt({
          template,
          mode,
          dslVersion: DSL_VERSION,
          example: {
            dataset: example.dataset.map((element) => element.value),
            dslParameters: example.dslParameters,
            title: example.title,
            description: example.description,
          },
        }),
      )
    },
    importCandidate(
      templateId: TemplateId,
      mode: ScenarioMode,
      text: string,
    ): Result<Scenario> {
      const template = templateOf(templateId)
      if (!template) {
        return fail([issue('IMPORT_SCHEMA', `未登録のtemplateです: ${templateId}`, 'templateId')])
      }
      const result = importService.import({
        template,
        mode,
        text,
        currentScenarioRevision: session.getState().scenario.revision,
      })
      // 不合格時は現在のシナリオを変更しない（v0.10 §5.3・§8）
      if (!result.ok) return result
      session.switchScenario(result.value)
      return result
    },
  }
}
