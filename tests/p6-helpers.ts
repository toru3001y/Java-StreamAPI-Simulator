import { createDefaultCatalog } from '../src/domain/catalog/operations'
import { createDefaultTemplateRegistry, ALL_TEMPLATES } from '../src/domain/template/templates'
import { FixtureScenarioProvider } from '../src/providers/fixtureScenarioProvider'
import { buildScenario } from '../src/application/scenarioFactory'
import { DSL_VERSION } from '../src/domain/dsl/ast'
import type { Scenario } from '../src/domain/scenario/scenario'
import type { PipelineTemplate } from '../src/domain/template/pipelineTemplate'
import { CandidateImportService } from '../src/application/candidateImport'
import {
  hasGatherNode,
  hasToMapCollectorSlot,
  hasUnmodifiableCollectorSlot,
} from '../src/application/importContract'
import { P8_TEMPLATE_IDS } from '../src/domain/template/templatesP8'

/** Phase 6テスト共通helper */

export const EXECUTABLE_TEMPLATES: readonly PipelineTemplate[] = ALL_TEMPLATES.filter(
  (t) => t.executable !== false,
)

/**
 * 取込対象の実行可能template（Phase 7指示 §12冒頭・Phase 8指示 §12冒頭の意図的更新）。
 *
 * Phase 7でgather templateを追加した。gatherノードを含むtemplateは実行可能だが
 * 手動連携の取込対象外（`importable: false`。Phase 7指示 §7.8-1、v0.9 §10-6のユーザー決定）
 * のため、Import Contractの走査対象からは外す。
 * Phase 8では同じ理由でtoMapを含むtemplate（collector slotの許可kindに`'toMap'`を含む）も
 * 走査対象から外す（Phase 8指示 §7.7-1、v0.11 §10-6のユーザー決定）。
 * Phase 11ではunmodifiable系Collectorを含むtemplateも同じ理由で外す（v0.14 §5.2）。
 * `EXECUTABLE_TEMPLATES`の意味・値は変更していない。
 * gather / toMap / unmodifiable templateの取込拒否検証はP7-D21 / P8-D21 / P11-D09が担う。
 */
export const IMPORTABLE_TEMPLATES: readonly PipelineTemplate[] = EXECUTABLE_TEMPLATES.filter(
  (t) => !hasGatherNode(t) && !hasToMapCollectorSlot(t) && !hasUnmodifiableCollectorSlot(t),
)

/** 取込対象外（gatherノードを含む）の実行可能template */
export const GATHER_TEMPLATES: readonly PipelineTemplate[] = EXECUTABLE_TEMPLATES.filter((t) =>
  hasGatherNode(t),
)

/** 取込対象外（collector slotの許可kindに'toMap'を含む）の実行可能template（Phase 8） */
export const TO_MAP_TEMPLATES: readonly PipelineTemplate[] =
  EXECUTABLE_TEMPLATES.filter(hasToMapCollectorSlot)

/** 取込対象外（collector slotの許可kindがunmodifiable系）の実行可能template（Phase 11） */
export const UNMODIFIABLE_TEMPLATES: readonly PipelineTemplate[] = EXECUTABLE_TEMPLATES.filter(
  hasUnmodifiableCollectorSlot,
)

/**
 * Phase 7完了時点のtemplate集合（Phase 8指示 §12冒頭）。
 *
 * 走査母集団・固定件数を検証する既存テスト（P6-D22 / P7-D20）を、Phase 8のtemplate追加から
 * 保護するためのスコープ固定。固定方法は「`ALL_TEMPLATES`から`P8_TEMPLATES`全件を除外」とする。
 * **「toMap非含有」での抽出は不可**——新設`tmpl-collect-groupby-mergedemo`はtoMap非含有のため、
 * その抽出ではPhase 7時点集合と一致しない（119 / 117 / 223になる）。
 */
export const PHASE7_TEMPLATES: readonly PipelineTemplate[] = ALL_TEMPLATES.filter(
  (t) => !P8_TEMPLATE_IDS.includes(t.templateId),
)

export const PHASE7_EXECUTABLE_TEMPLATES: readonly PipelineTemplate[] = PHASE7_TEMPLATES.filter(
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
