import { createDefaultCatalog } from '../src/domain/catalog/operations'
import { createDefaultTemplateRegistry, ALL_TEMPLATES } from '../src/domain/template/templates'
import { FixtureScenarioProvider } from '../src/providers/fixtureScenarioProvider'
import { buildScenario } from '../src/application/scenarioFactory'
import { DSL_VERSION } from '../src/domain/dsl/ast'
import type { Scenario } from '../src/domain/scenario/scenario'
import type { PipelineTemplate } from '../src/domain/template/pipelineTemplate'
import { CandidateImportService } from '../src/application/candidateImport'

/** Phase 6テスト共通helper */

export const EXECUTABLE_TEMPLATES: readonly PipelineTemplate[] = ALL_TEMPLATES.filter(
  (t) => t.executable !== false,
)

export function templateById(templateId: string): PipelineTemplate {
  const template = ALL_TEMPLATES.find((t) => t.templateId === templateId)
  if (!template) throw new Error(`未登録のtemplateです: ${templateId}`)
  return template
}

/**
 * 全fixture（template × supportedModes）のJavaコード表示を採取する。
 * 改修前後の不変確認（P6-D18）で使用する。
 */
export function collectFixtureJavaCode(): Record<string, string[]> {
  const catalog = createDefaultCatalog()
  const registry = createDefaultTemplateRegistry()
  const provider = new FixtureScenarioProvider()
  const allowedTemplateIds = ALL_TEMPLATES.map((t) => t.templateId)
  const out: Record<string, string[]> = {}
  for (const template of ALL_TEMPLATES) {
    for (const mode of template.supportedModes) {
      const key = `${template.templateId}:${mode}`
      let candidate
      try {
        candidate = provider.generate({
          targetOperationId: template.targetOperationId,
          mode,
          allowedTemplateIds,
          templateId: template.templateId,
          dslVersion: DSL_VERSION,
          currentScenarioRevision: null,
        })
      } catch (e) {
        out[key] = [`__NO_FIXTURE__ ${(e as Error).message}`]
        continue
      }
      const result = buildScenario(registry, catalog, candidate)
      if (!result.ok) {
        out[key] = [`__INVALID__ ${result.issues.map((i) => i.code).join(',')}`]
        continue
      }
      out[key] = result.value.pipeline.javaCode.map((line) => line.text)
    }
  }
  return out
}

/** 取込経路で1件のScenarioを組み立てる（テスト用の薄いラッパー） */
export function importScenario(
  templateId: string,
  mode: Scenario['mode'],
  text: string,
  options?: { currentScenarioRevision?: string | null; clock?: () => Date },
) {
  const catalog = createDefaultCatalog()
  const registry = createDefaultTemplateRegistry()
  const service = new CandidateImportService(registry, catalog, options?.clock)
  return service.import({
    template: templateById(templateId),
    mode,
    text,
    currentScenarioRevision: options?.currentScenarioRevision ?? null,
  })
}
