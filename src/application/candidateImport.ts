import type { OperationCatalog } from '../domain/catalog/operationCatalog'
import type { TemplateRegistry } from '../domain/template/templateRegistry'
import type { PipelineTemplate } from '../domain/template/pipelineTemplate'
import type { ScenarioMode, Scenario } from '../domain/scenario/scenario'
import type { DatasetElement } from '../domain/model/employee'
import type { ScenarioCandidate } from '../providers/scenarioProvider'
import type { Result, ValidationIssue } from '../domain/types/result'
import { fail, issue, ok } from '../domain/types/result'
import { DSL_VERSION } from '../domain/dsl/ast'
import { buildScenario } from './scenarioFactory'
import {
  IMPORT_TEXT_MAX_LENGTH,
  buildTemplateContract,
  validateCandidateShape,
  type CandidateShape,
  type ImportContext,
} from './importContract'

/**
 * Candidate Import（v0.10 §5.2・§7.2、Phase 6指示 §7.2・§7.6）。
 *
 * 貼付テキストをuntrusted入力として次の順で処理する。途中で失敗した場合、それ以降は実行しない。
 *   1. サイズ上限検証 → 2. 前処理（trim・コードフェンス除去） → 3. JSON.parse
 *   → 4. candidate schema検証（Import Contract） → 5. ScenarioCandidateの組み立て
 *   → 6. 既存の検証パイプライン（buildScenario → instantiateTemplate手順1〜7）
 *
 * `ScenarioProvider`は実装しない独立サービスである（v0.10 §3.2）。
 * 検証失敗は正常系のため`Result`で返し、throwしない（v0.10 §7.4）。
 * `eval` / `Function` / 動的コード生成は使用しない（v0.10 §7.2）。
 */

/** 先頭・末尾の1組のコードフェンス（```json 等）だけを除去する */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const lines = trimmed.split('\n')
  if (lines.length < 2) return trimmed
  const first = (lines[0] ?? '').trim()
  const last = (lines[lines.length - 1] ?? '').trim()
  // 先頭行が「```」+任意の英字ラベルのみ、かつ最終行が「```」のみのときに限る
  if (!/^```[A-Za-z]*$/.test(first)) return trimmed
  if (last !== '```') return trimmed
  return lines.slice(1, -1).join('\n').trim()
}

/** datasetのelementIdをimp-001〜の形式で出現順に再付番する（v0.10 §6.5） */
export function renumberDataset(shape: CandidateShape): readonly DatasetElement[] {
  return shape.dataset.map((value, index) => ({
    elementId: `imp-${String(index + 1).padStart(3, '0')}`,
    value,
  }))
}

export interface ImportRequest {
  readonly template: PipelineTemplate
  readonly mode: ScenarioMode
  readonly text: string
  readonly currentScenarioRevision: string | null
}

/** テスト用に差し替え可能な時刻源（既定は実時刻） */
export type Clock = () => Date

export class CandidateImportService {
  private revisionCounter = 0
  private readonly registry: TemplateRegistry
  private readonly catalog: OperationCatalog
  private readonly clock: Clock

  constructor(registry: TemplateRegistry, catalog: OperationCatalog, clock?: Clock) {
    this.registry = registry
    this.catalog = catalog
    this.clock = clock ?? (() => new Date())
  }

  /**
   * revisionの発行（Phase 6指示 §7.6で確定）。
   * `${templateId}:${mode}:imp${counter}`。現在のrevisionと一致する場合は再採番する。
   * 接頭辞`imp`によりfixture系`r${counter}`とは構造的に衝突しない。
   */
  private nextRevision(
    templateId: string,
    mode: ScenarioMode,
    currentScenarioRevision: string | null,
  ): string {
    let revision: string
    do {
      this.revisionCounter += 1
      revision = `${templateId}:${mode}:imp${this.revisionCounter}`
    } while (revision === currentScenarioRevision)
    return revision
  }

  /** 取込可否（実行不能templateは取込対象外。v0.10 §5.1） */
  importability(template: PipelineTemplate): { importable: boolean; reason: string | null } {
    const contract = buildTemplateContract(template)
    return { importable: contract.importable, reason: contract.disabledReason }
  }

  /**
   * 貼付テキストを検証し、成立した場合だけ確定Scenarioを返す。
   * 不成立の候補はStep Engineへ渡さない（v0.10 §7.2手順6）。
   */
  import(request: ImportRequest): Result<Scenario> {
    const { template, mode, text } = request
    const importability = this.importability(template)
    if (!importability.importable) {
      return fail([
        issue(
          'IMPORT_SCHEMA',
          importability.reason ?? `template ${template.templateId} は取込対象外です`,
          'templateId',
        ),
      ])
    }

    // 手順1: サイズ上限（string.lengthで判定し、parse前に拒否する）
    if (text.length > IMPORT_TEXT_MAX_LENGTH) {
      return fail([
        issue(
          'IMPORT_SIZE_LIMIT',
          `貼付テキストは${IMPORT_TEXT_MAX_LENGTH} UTF-16 code unit以内にしてください（実際: ${text.length}）`,
          '',
        ),
      ])
    }

    // 手順2 / 3: 前処理とJSON.parse（eval / Functionは使用しない）
    const source = stripCodeFence(text)
    let parsed: unknown
    try {
      parsed = JSON.parse(source)
    } catch (error) {
      return fail([
        issue(
          'IMPORT_PARSE',
          `JSONとして解釈できません: ${error instanceof Error ? error.message : String(error)}`,
          '',
        ),
      ])
    }

    // 手順4: candidate schema検証
    const contract = buildTemplateContract(template)
    const context: ImportContext = {
      dslVersion: DSL_VERSION,
      templateId: template.templateId,
      templateVersion: template.version,
      mode,
    }
    const shapeResult = validateCandidateShape(contract, context, parsed)
    if (!shapeResult.ok) return fail(shapeResult.issues)

    // 手順5: ScenarioCandidateの組み立て（アプリ側が付与する項目。v0.10 §6.5）
    const candidate: ScenarioCandidate = {
      providerKind: 'IMPORTED',
      templateId: template.templateId,
      templateVersion: template.version,
      mode,
      dataset: renumberDataset(shapeResult.value),
      dslParameters: shapeResult.value.dslParameters,
      title: shapeResult.value.title,
      description: shapeResult.value.description,
      provenance: {
        providerKind: 'IMPORTED',
        generatedAt: this.clock().toISOString(),
        dslVersion: DSL_VERSION,
      },
      revision: this.nextRevision(template.templateId, mode, request.currentScenarioRevision),
    }

    // 手順6: 既存の検証パイプライン（instantiateTemplateの手順1〜7を無変更で通す）
    const result = buildScenario(this.registry, this.catalog, candidate)
    if (!result.ok) {
      const issues: readonly ValidationIssue[] =
        result.issues.length > 0
          ? result.issues
          : [issue('STRUCTURE_INVALID', '候補の検証に失敗しました', '')]
      return fail(issues)
    }
    return ok(result.value)
  }
}
