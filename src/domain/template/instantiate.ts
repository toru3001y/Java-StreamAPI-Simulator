import type { TemplateRegistry } from './templateRegistry'
import type { ParameterSlot, PipelineTemplate } from './pipelineTemplate'
import type { OperationCatalog } from '../catalog/operationCatalog'
import { resolveTypeRule } from '../catalog/operationCatalog'
import type { DslPredicate } from '../dsl/ast'
import { validateStructure, validateTypes, validateWhitelist } from '../dsl/validate'
import { evaluatePredicate } from '../dsl/evaluate'
import { generateJavaCode } from '../dsl/javaCode'
import type { DatasetElement } from '../model/employee'
import type { PipelineDefinition, PipelineNodeDef } from '../pipeline/pipelineDefinition'
import type { Result, ValidationIssue } from '../types/result'
import { fail, issue, ok } from '../types/result'
import type { ScenarioMode } from '../scenario/scenario'
import type { ScenarioRevision, SlotId, TemplateId } from '../types/ids'
import type { TypeRef } from '../types/typeRef'
import { lineIdForNode } from '../types/ids'
import { deepFreeze } from '../util/deepFreeze'

/**
 * TemplateInstance → PipelineDefinition（§8.3）。
 * 検証はDraft v0.8 §9.3の順序で行い、不成立の候補はStep Engineへ渡さない。
 *   1. 構造検証 → 2. template / slot許可範囲 → 3. DSLホワイトリスト
 *   → 4. TypeRef型検証 → 5. 教材制約 → 6. snapshot予算の事前実行 → 7. PipelineDefinition生成
 */
export interface TemplateInstanceInput {
  readonly templateId: TemplateId
  readonly templateVersion: number
  readonly dataset: readonly DatasetElement[]
  readonly dslParameters: Readonly<Record<SlotId, unknown>>
  readonly mode: ScenarioMode
  readonly revision: ScenarioRevision
}

export const SNAPSHOT_LIMIT = 500

interface PrerunStats {
  readonly snapshotCount: number
  readonly resultCount: number
  readonly targetTrue: number
  readonly targetFalse: number
}

/** 事前実行（§9.3 手順6）。Step Engineと同一の決定的順序で件数と教材特徴を数える。 */
function prerun(
  template: PipelineTemplate,
  predicates: ReadonlyMap<string, DslPredicate>,
  dataset: readonly DatasetElement[],
): PrerunStats {
  const filterNodes = template.nodes.filter((n) => n.role === 'intermediate')
  let count = 1 // INITIAL
  let resultCount = 0
  let targetTrue = 0
  let targetFalse = 0
  for (const element of dataset) {
    count += 1 // SOURCE_EMIT
    let passedAll = true
    for (const node of filterNodes) {
      const predicate = predicates.get(node.nodeId)
      if (!predicate) throw new Error(`predicate not bound: ${node.nodeId}`)
      const result = evaluatePredicate(predicate, element.value)
      count += 3 // NODE_ARRIVAL / PREDICATE_EVALUATED / ELEMENT_PASSED or ELEMENT_REJECTED
      if (node.nodeId === template.targetNodeId) {
        if (result) targetTrue += 1
        else targetFalse += 1
      }
      if (!result) {
        passedAll = false
        break
      }
    }
    if (passedAll) {
      count += 1 // SINK_APPENDED
      resultCount += 1
    }
  }
  count += 2 // RESULT_CONFIRMED / STREAM_CONSUMED
  return { snapshotCount: count, resultCount, targetTrue, targetFalse }
}

export function instantiateTemplate(
  registry: TemplateRegistry,
  catalog: OperationCatalog,
  input: TemplateInstanceInput,
): Result<PipelineDefinition> {
  // 手順1: 構造検証（全パラメータ）
  const structureIssues: ValidationIssue[] = []
  const structured = new Map<SlotId, DslPredicate>()
  for (const [slotId, raw] of Object.entries(input.dslParameters)) {
    const result = validateStructure(raw, `dslParameters.${slotId}`)
    if (result.ok) structured.set(slotId, result.value)
    else structureIssues.push(...result.issues)
  }
  if (structureIssues.length > 0) return fail(structureIssues)

  // 手順2: template / slot許可範囲検証
  const template = registry.get(input.templateId, input.templateVersion)
  if (!template) {
    if (registry.hasTemplateId(input.templateId)) {
      return fail([
        issue(
          'TEMPLATE_VERSION_MISMATCH',
          `template ${input.templateId} のversion ${input.templateVersion} は登録されていません`,
          'templateVersion',
        ),
      ])
    }
    return fail([
      issue('TEMPLATE_NOT_FOUND', `許可されていないtemplateです: ${input.templateId}`, 'templateId'),
    ])
  }
  if (!template.supportedModes.includes(input.mode)) {
    return fail([
      issue(
        'TEMPLATE_MODE_UNSUPPORTED',
        `template ${input.templateId} はモード ${input.mode} をサポートしません`,
        'mode',
      ),
    ])
  }
  const slotIssues: ValidationIssue[] = []
  const slotById = new Map<SlotId, ParameterSlot>(template.parameterSlots.map((s) => [s.slotId, s]))
  for (const slotId of structured.keys()) {
    if (!slotById.has(slotId)) {
      slotIssues.push(issue('SLOT_UNKNOWN', `未定義のslotです: ${slotId}`, `dslParameters.${slotId}`))
    }
  }
  for (const slot of template.parameterSlots) {
    if (slot.required && !structured.has(slot.slotId)) {
      slotIssues.push(issue('SLOT_MISSING', `必須slotが欠落しています: ${slot.slotId}`, `dslParameters.${slot.slotId}`))
    }
  }
  if (slotIssues.length > 0) return fail(slotIssues)

  // 手順3: DSLホワイトリスト検証（template許可プロファイル + slot許可範囲）
  const whitelistIssues: ValidationIssue[] = []
  for (const [slotId, predicate] of structured) {
    const slot = slotById.get(slotId)
    if (!slot) continue
    const result = validateWhitelist(
      predicate,
      {
        predicateKinds: template.allowedDslProfile.predicateKinds,
        allowedFields: slot.allowedFields,
        allowedOperators: slot.allowedOperators,
      },
      `dslParameters.${slotId}`,
    )
    if (!result.ok) whitelistIssues.push(...result.issues)
  }
  if (whitelistIssues.length > 0) return fail(whitelistIssues)

  // 手順4: TypeRefによる型検証（DSLリテラル型 + Pipeline型遷移）
  const typeIssues: ValidationIssue[] = []
  for (const [slotId, predicate] of structured) {
    const result = validateTypes(predicate, `dslParameters.${slotId}`)
    if (!result.ok) typeIssues.push(...result.issues)
  }
  if (typeIssues.length > 0) return fail(typeIssues)

  const predicatesByNode = new Map<string, DslPredicate>()
  for (const [slotId, predicate] of structured) {
    const slot = slotById.get(slotId)
    if (slot) predicatesByNode.set(slot.targetNodeId, predicate)
  }

  let currentType: TypeRef | null = null
  const nodeDefs: PipelineNodeDef[] = []
  for (const node of template.nodes) {
    const op = catalog.get(node.operationId)
    if (op.inputTypeRule.kind === 'anyStream') {
      if (!currentType || currentType.kind !== 'stream') {
        return fail([
          issue('TYPE_MISMATCH', `node ${node.nodeId} はStream入力が必要です`, `nodes.${node.nodeId}`),
        ])
      }
    }
    const outputType = resolveTypeRule(op.outputTypeRule, currentType)
    nodeDefs.push({
      nodeId: node.nodeId,
      operationId: node.operationId,
      role: node.role,
      traits: op.traits,
      displayName: op.displayName,
      predicate: predicatesByNode.get(node.nodeId) ?? null,
      inputType: currentType,
      outputType,
      lineId: lineIdForNode(node.nodeId),
      legendStates: op.legendStates,
      visualizationKind: op.visualizationKind,
      handlerId: op.handlerId,
      jdkNotes: op.jdkNotes,
    })
    currentType = outputType
  }
  const terminalNode = nodeDefs[nodeDefs.length - 1]
  if (!terminalNode || terminalNode.role !== 'terminal') {
    return fail([issue('STRUCTURE_INVALID', 'Pipelineは終端操作で終わる必要があります', 'nodes')])
  }

  // 手順5: 教材制約検証（§11.3）
  const stats = prerun(template, predicatesByNode, input.dataset)
  const teachingIssues: ValidationIssue[] = []
  if (input.mode === 'standard') {
    if (input.dataset.length === 0) {
      teachingIssues.push(issue('TEACHING_CONSTRAINT', '標準モードは入力データが必要です', 'dataset'))
    } else if (stats.targetTrue === 0 || stats.targetFalse === 0) {
      teachingIssues.push(
        issue(
          'TEACHING_CONSTRAINT',
          '標準モードは対象filterでtrue / false双方が発生する必要があります',
          'dataset',
        ),
      )
    }
  } else if (input.mode === 'midEmpty') {
    if (input.dataset.length === 0) {
      teachingIssues.push(issue('TEACHING_CONSTRAINT', '途中0件モードは入力データが必要です', 'dataset'))
    } else if (stats.resultCount !== 0) {
      teachingIssues.push(
        issue('TEACHING_CONSTRAINT', '途中0件モードは全件がfilterで除外される必要があります', 'dataset'),
      )
    }
  } else if (input.dataset.length !== 0) {
    teachingIssues.push(issue('TEACHING_CONSTRAINT', '空ソースモードは入力0件である必要があります', 'dataset'))
  }
  if (teachingIssues.length > 0) return fail(teachingIssues)

  // 手順6: 有限化と500 snapshot以内の事前実行
  if (stats.snapshotCount > SNAPSHOT_LIMIT) {
    return fail([
      issue(
        'SNAPSHOT_BUDGET',
        `snapshot件数 ${stats.snapshotCount} が安全上限 ${SNAPSHOT_LIMIT} を超えます`,
        'dataset',
      ),
    ])
  }

  // 手順7: PipelineDefinition生成（不変）
  const javaCode = generateJavaCode(
    nodeDefs.map((n) => ({ nodeId: n.nodeId, role: n.role, predicate: n.predicate })),
    input.dataset,
  )
  const definition: PipelineDefinition = {
    definitionId: `${input.templateId}@${input.templateVersion}:${input.mode}:${input.revision}`,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    mode: input.mode,
    revision: input.revision,
    nodes: nodeDefs,
    dataset: input.dataset,
    resultType: terminalNode.outputType,
    javaCode,
    snapshotCount: stats.snapshotCount,
  }
  return ok(deepFreeze(definition))
}
