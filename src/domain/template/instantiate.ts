import type { TemplateRegistry } from './templateRegistry'
import type { ParameterSlot } from './pipelineTemplate'
import type { OperationCatalog } from '../catalog/operationCatalog'
import { resolveTypeRule } from '../catalog/operationCatalog'
import type { DslPredicate } from '../dsl/ast'
import type { MapperDsl } from '../dsl/mapperAst'
import type { SourceDsl } from '../dsl/sourceAst'
import { UNBOUNDED_SOURCE_KINDS } from '../dsl/sourceAst'
import { validateStructure, validateTypes, validateWhitelist } from '../dsl/validate'
import { validateMapperStructure, resolveMapperOutputType } from '../dsl/validateMapper'
import { validateSourceStructure, sourceStreamType } from '../dsl/validateSource'
import { evaluateIteratePredicate, materializeSource } from '../dsl/materializeSource'
import { evaluateFlatMapper, evaluateMapper } from '../dsl/evaluateMapper'
import { evaluatePredicate } from '../dsl/evaluate'
import { generateJavaCode } from '../dsl/javaCode'
import { formatSimValue, WRAPPER_NAMES } from '../model/value'
import type { DatasetElement } from '../model/employee'
import type { PipelineDefinition, PipelineNodeDef } from '../pipeline/pipelineDefinition'
import type { Result, ValidationIssue } from '../types/result'
import { fail, issue, ok } from '../types/result'
import type { ScenarioMode } from '../scenario/scenario'
import type { ScenarioRevision, SlotId, TemplateId } from '../types/ids'
import type { TypeRef } from '../types/typeRef'
import { formatTypeRef, streamOf } from '../types/typeRef'
import { lineIdForNode } from '../types/ids'
import { deepFreeze } from '../util/deepFreeze'
import { getTimeline } from '../engine/stepEngine'

/**
 * TemplateInstance → PipelineDefinition（§8.3）。
 * 検証はDraft v0.8 §9.3の順序で行い、不成立の候補はStep Engineへ渡さない。
 *   1. 構造検証 → 2. template / slot許可範囲 → 3. DSLホワイトリスト
 *   → 4. TypeRef型検証 → 5. 教材制約 → 6. 有限化とsnapshot予算の事前実行
 *   → 7. PipelineDefinition生成
 * generate / 2引数iterateは手順6の有限性検証でUNBOUNDED_SOURCEとして拒否する（Phase 2指示 §6.1）。
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

const MAPPER_OPERATIONS = ['map', 'mapToInt', 'mapToLong', 'mapToDouble', 'mapToObj'] as const
const FLAT_MAP_OPERATIONS = ['flatMap', 'flatMapToInt', 'flatMapToLong', 'flatMapToDouble'] as const

function elementTypeOf(streamType: TypeRef): TypeRef {
  if (streamType.kind === 'stream') return streamType.elementType
  if (streamType.kind === 'primitiveStream') {
    const name =
      streamType.name === 'IntStream' ? 'int' : streamType.name === 'LongStream' ? 'long' : 'double'
    return { kind: 'primitive', name }
  }
  throw new Error(`Stream型ではありません: ${formatTypeRef(streamType)}`)
}

export function instantiateTemplate(
  registry: TemplateRegistry,
  catalog: OperationCatalog,
  input: TemplateInstanceInput,
): Result<PipelineDefinition> {
  // 手順2（前半）: template許可範囲の解決（slot種別が構造検証に必要なため先に引く）
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

  const slotById = new Map<SlotId, ParameterSlot>(template.parameterSlots.map((s) => [s.slotId, s]))
  const slotIssues: ValidationIssue[] = []
  for (const slotId of Object.keys(input.dslParameters)) {
    if (!slotById.has(slotId) && slotId !== template.sourceDefinition.slotId) {
      slotIssues.push(issue('SLOT_UNKNOWN', `未定義のslotです: ${slotId}`, `dslParameters.${slotId}`))
    }
  }
  for (const slot of template.parameterSlots) {
    if (slot.required && !(slot.slotId in input.dslParameters)) {
      slotIssues.push(
        issue('SLOT_MISSING', `必須slotが欠落しています: ${slot.slotId}`, `dslParameters.${slot.slotId}`),
      )
    }
  }
  if (slotIssues.length > 0) return fail(slotIssues)

  // 手順1: 構造検証（slot種別ごと）
  const structureIssues: ValidationIssue[] = []
  const predicates = new Map<SlotId, DslPredicate>()
  const mappers = new Map<SlotId, MapperDsl>()
  for (const slot of template.parameterSlots) {
    const raw = input.dslParameters[slot.slotId]
    if (raw === undefined) continue
    if (slot.kind === 'predicate') {
      const result = validateStructure(raw, `dslParameters.${slot.slotId}`)
      if (result.ok) predicates.set(slot.slotId, result.value)
      else structureIssues.push(...result.issues)
    } else if (slot.kind === 'mapper') {
      const result = validateMapperStructure(raw, `dslParameters.${slot.slotId}`)
      if (result.ok) mappers.set(slot.slotId, result.value)
      else structureIssues.push(...result.issues)
    }
  }
  let sourceDsl: SourceDsl | null = null
  const sourceSlotId = template.sourceDefinition.slotId
  const rawSource = sourceSlotId ? input.dslParameters[sourceSlotId] : undefined
  if (rawSource !== undefined) {
    const result = validateSourceStructure(rawSource, `dslParameters.${sourceSlotId}`)
    if (result.ok) sourceDsl = result.value
    else structureIssues.push(...result.issues)
  } else {
    sourceDsl = template.sourceDefinition.defaultDsl
  }
  if (structureIssues.length > 0) return fail(structureIssues)
  if (!sourceDsl) {
    return fail([issue('SLOT_MISSING', 'source DSLが指定されていません', `dslParameters.${sourceSlotId}`)])
  }

  // 手順3: DSLホワイトリスト検証
  const whitelistIssues: ValidationIssue[] = []
  if (!template.sourceDefinition.allowedSourceKinds.includes(sourceDsl.kind)) {
    whitelistIssues.push(
      issue('WHITELIST_KIND', `このtemplateで許可されていないsource kindです: ${sourceDsl.kind}`, 'source'),
    )
  }
  for (const slot of template.parameterSlots) {
    if (slot.kind === 'predicate') {
      const predicate = predicates.get(slot.slotId)
      if (!predicate) continue
      const result = validateWhitelist(
        predicate,
        {
          predicateKinds: template.allowedDslProfile.predicateKinds,
          allowedFields: slot.allowedFields,
          allowedOperators: slot.allowedOperators,
        },
        `dslParameters.${slot.slotId}`,
      )
      if (!result.ok) whitelistIssues.push(...result.issues)
    } else if (slot.kind === 'mapper') {
      const mapper = mappers.get(slot.slotId)
      if (!mapper) continue
      if (!slot.allowedMapperKinds.includes(mapper.kind)) {
        whitelistIssues.push(
          issue(
            'WHITELIST_KIND',
            `このslotで許可されていないmapper kindです: ${mapper.kind}`,
            `dslParameters.${slot.slotId}`,
          ),
        )
      }
    }
  }
  if (whitelistIssues.length > 0) return fail(whitelistIssues)

  // 手順4: TypeRefによる型検証（DSLリテラル型 + Pipeline型遷移）
  const typeIssues: ValidationIssue[] = []
  for (const [slotId, predicate] of predicates) {
    const result = validateTypes(predicate, `dslParameters.${slotId}`)
    if (!result.ok) typeIssues.push(...result.issues)
  }
  if (typeIssues.length > 0) return fail(typeIssues)

  const predicatesByNode = new Map<string, DslPredicate>()
  const mappersByNode = new Map<string, MapperDsl>()
  for (const slot of template.parameterSlots) {
    if (slot.kind === 'predicate') {
      const p = predicates.get(slot.slotId)
      if (p) predicatesByNode.set(slot.targetNodeId, p)
    } else if (slot.kind === 'mapper') {
      const m = mappers.get(slot.slotId)
      if (m) mappersByNode.set(slot.targetNodeId, m)
    }
  }

  let currentType: TypeRef | null = null
  const nodeDefs: PipelineNodeDef[] = []
  for (const node of template.nodes) {
    const op = catalog.get(node.operationId)
    // 入力規則
    if (op.inputTypeRule.kind === 'anyStream') {
      if (!currentType || currentType.kind !== 'stream') {
        return fail([
          issue(
            'TYPE_MISMATCH',
            `node ${node.nodeId}（${op.displayName}）はobject Streamの入力が必要です${
              currentType?.kind === 'primitiveStream' ? '。primitive Streamはboxed()で変換してください' : ''
            }`,
            `nodes.${node.nodeId}`,
          ),
        ])
      }
    } else if (op.inputTypeRule.kind === 'anyPrimitiveStream') {
      if (!currentType || currentType.kind !== 'primitiveStream') {
        return fail([
          issue(
            'TYPE_MISMATCH',
            `node ${node.nodeId}（${op.displayName}）はprimitive Streamの入力が必要です`,
            `nodes.${node.nodeId}`,
          ),
        ])
      }
    }
    // 出力規則
    let outputType: TypeRef
    switch (op.outputTypeRule.kind) {
      case 'fromSource':
        outputType = sourceStreamType(sourceDsl)
        break
      case 'fromMapper': {
        const mapper = mappersByNode.get(node.nodeId)
        if (!mapper) {
          return fail([issue('SLOT_MISSING', `node ${node.nodeId} のmapperがありません`, `nodes.${node.nodeId}`)])
        }
        if (!currentType) {
          return fail([issue('TYPE_MISMATCH', `node ${node.nodeId} に入力型がありません`, `nodes.${node.nodeId}`)])
        }
        const outResult = resolveMapperOutputType(mapper, elementTypeOf(currentType), `nodes.${node.nodeId}.mapper`)
        if (!outResult.ok) return fail(outResult.issues)
        outputType = streamOf(outResult.value)
        break
      }
      case 'fixedPrimitiveStream': {
        const mapper = mappersByNode.get(node.nodeId)
        if (!mapper) {
          return fail([issue('SLOT_MISSING', `node ${node.nodeId} のmapperがありません`, `nodes.${node.nodeId}`)])
        }
        if (!currentType) {
          return fail([issue('TYPE_MISMATCH', `node ${node.nodeId} に入力型がありません`, `nodes.${node.nodeId}`)])
        }
        const outResult = resolveMapperOutputType(mapper, elementTypeOf(currentType), `nodes.${node.nodeId}.mapper`)
        if (!outResult.ok) return fail(outResult.issues)
        const expected =
          op.outputTypeRule.name === 'IntStream' ? 'int' : op.outputTypeRule.name === 'LongStream' ? 'long' : 'double'
        if (!(outResult.value.kind === 'primitive' && outResult.value.name === expected)) {
          return fail([
            issue(
              'TYPE_MISMATCH',
              `node ${node.nodeId} のmapperは${expected}を返す必要があります（実際: ${formatTypeRef(outResult.value)}）`,
              `nodes.${node.nodeId}.mapper`,
            ),
          ])
        }
        outputType = { kind: 'primitiveStream', name: op.outputTypeRule.name }
        break
      }
      case 'boxedWrapper': {
        if (!currentType || currentType.kind !== 'primitiveStream') {
          return fail([issue('TYPE_MISMATCH', `node ${node.nodeId} はprimitive Streamの入力が必要です`, `nodes.${node.nodeId}`)])
        }
        const primitive =
          currentType.name === 'IntStream' ? 'int' : currentType.name === 'LongStream' ? 'long' : 'double'
        outputType = streamOf({ kind: 'object', name: WRAPPER_NAMES[primitive] })
        break
      }
      default:
        outputType = resolveTypeRule(op.outputTypeRule, currentType)
    }
    // filterはEmployee要素にのみ適用可能（Phase 2時点のDSL範囲）
    if (node.operationId === 'filter' && currentType) {
      const el = elementTypeOf(currentType)
      if (!(el.kind === 'object' && el.name === 'Employee')) {
        return fail([
          issue('TYPE_MISMATCH', `filterはEmployee要素にのみ適用できます（実際: ${formatTypeRef(el)}）`, `nodes.${node.nodeId}`),
        ])
      }
    }
    nodeDefs.push({
      nodeId: node.nodeId,
      operationId: node.operationId,
      role: node.role,
      traits: op.traits,
      displayName: op.displayName,
      predicate: predicatesByNode.get(node.nodeId) ?? null,
      mapper: mappersByNode.get(node.nodeId) ?? null,
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

  // 手順6（有限性の事前検証）: 無限sourceはPipelineDefinition生成前に拒否する（指示§6.1）。
  // fixture要素数や500上限で暗黙に打ち切らない。
  if (UNBOUNDED_SOURCE_KINDS.includes(sourceDsl.kind)) {
    return fail([
      issue(
        'UNBOUNDED_SOURCE',
        `${sourceDsl.kind === 'generate' ? 'Stream.generate()' : 'Stream.iterate(seed, operator)'} は無限Streamであり、有限化操作（Phase 3のlimit()）なしでは実行できません`,
        'source',
      ),
    ])
  }

  // 3引数iterateの有限性・int範囲・予算を、巨大timeline生成前に検証する（レビュー指摘2）
  const INT32_MAX = 2_147_483_647
  if (sourceDsl.kind === 'iterate3') {
    const { seed, predicate, operator } = sourceDsl
    const seedPasses = evaluateIteratePredicate(predicate, seed)
    if (seedPasses && operator.step < 1) {
      return fail([
        issue(
          'UNBOUNDED_SOURCE',
          `Stream.iterate(${seed}, n ${predicate.operator === 'LTE' ? '<=' : '<'} ${predicate.value}, n + ${operator.step}) はpredicateがfalseへ進まず終了しません（step >= 1 が必要です）`,
          'source',
        ),
      ])
    }
    if (seedPasses) {
      // 最終候補（predicateをfalseにする値）までJava int範囲に収まること
      if (predicate.value + operator.step > INT32_MAX) {
        return fail([
          issue('TYPE_MISMATCH', 'iterateの候補値がJava intの範囲を超えます', 'source'),
        ])
      }
      // 予算の下限見積り（候補 + 判定 + 送出 + 追加 + 初期/確定/消費）で事前検証
      const bound = predicate.operator === 'LTE' ? predicate.value : predicate.value - 1
      const passingCount = Math.floor((bound - seed) / operator.step) + 1
      if (4 * passingCount + 5 > SNAPSHOT_LIMIT) {
        return fail([
          issue(
            'SNAPSHOT_BUDGET',
            `iterateの生成要素数 ${passingCount} 件はsnapshot安全上限 ${SNAPSHOT_LIMIT} に収まりません`,
            'source',
          ),
        ])
      }
    }
  }
  // range / rangeClosedも同様に、具現化前に要素数の下限見積りで予算検証する
  if (sourceDsl.kind === 'range' || sourceDsl.kind === 'rangeClosed') {
    const count = Math.max(
      0,
      sourceDsl.to - sourceDsl.from + (sourceDsl.kind === 'rangeClosed' ? 1 : 0),
    )
    if (2 * count + 3 > SNAPSHOT_LIMIT) {
      return fail([
        issue(
          'SNAPSHOT_BUDGET',
          `rangeの生成要素数 ${count} 件はsnapshot安全上限 ${SNAPSHOT_LIMIT} に収まりません`,
          'source',
        ),
      ])
    }
  }

  const materialized = materializeSource(sourceDsl, input.dataset)

  // 手順5: 教材制約検証（§11.3、Phase 2指示 §8.1）
  const teachingIssues: ValidationIssue[] = []
  const targetNode = nodeDefs.find((n) => n.nodeId === template.targetNodeId)
  if (!targetNode) {
    return fail([issue('STRUCTURE_INVALID', `targetNodeId ${template.targetNodeId} が存在しません`, 'targetNodeId')])
  }
  if (input.mode === 'emptySource') {
    if (materialized.elements.length !== 0) {
      teachingIssues.push(issue('TEACHING_CONSTRAINT', '空ソースモードは入力0件である必要があります', 'source'))
    }
  } else if (materialized.elements.length === 0) {
    teachingIssues.push(issue('TEACHING_CONSTRAINT', `${input.mode}モードは入力データが必要です`, 'source'))
  }
  if (input.mode === 'standard' && materialized.elements.length > 0) {
    if (targetNode.operationId === 'filter' && targetNode.predicate) {
      // 標準はtrue / false双方を含む（対象filterへ到達する要素で判定）
      let t = 0
      let f = 0
      for (const el of materialized.elements) {
        if (el.value.kind !== 'employee') continue
        if (evaluatePredicate(targetNode.predicate, el.value.value)) t += 1
        else f += 1
      }
      if (t === 0 || f === 0) {
        teachingIssues.push(
          issue('TEACHING_CONSTRAINT', '標準モードは対象filterでtrue / false双方が発生する必要があります', 'dataset'),
        )
      }
    }
    if ((MAPPER_OPERATIONS as readonly string[]).includes(targetNode.operationId) && targetNode.mapper) {
      // map系の標準は変換前後が視覚的に異なる（§11.3）
      const sample = materialized.elements[0]
      if (sample) {
        const out = evaluateMapper(targetNode.mapper, sample.value)
        if (formatSimValue(out) === formatSimValue(sample.value)) {
          teachingIssues.push(
            issue('TEACHING_CONSTRAINT', 'map系の標準モードは変換前後が視覚的に異なる必要があります', 'dataset'),
          )
        }
      }
    }
    if ((FLAT_MAP_OPERATIONS as readonly string[]).includes(targetNode.operationId) && targetNode.mapper) {
      // flatMap系の標準は親から複数子を生成する（§11.3）
      const hasMultiChild = materialized.elements.some(
        (el) => targetNode.mapper && evaluateFlatMapper(targetNode.mapper, el.value).length >= 2,
      )
      if (!hasMultiChild) {
        teachingIssues.push(
          issue('TEACHING_CONSTRAINT', 'flatMap系の標準モードは複数子を生成する親が必要です', 'dataset'),
        )
      }
    }
  }
  if (teachingIssues.length > 0) return fail(teachingIssues)

  // 手順6（snapshot予算）: 事前実行（timeline構築）で正確な件数を検証する
  const javaCode = generateJavaCode({
    source: sourceDsl,
    employeeDataset: input.dataset,
    nodes: nodeDefs.map((n) => ({
      nodeId: n.nodeId,
      role: n.role,
      operationId: n.operationId,
      predicate: n.predicate,
      mapper: n.mapper,
    })),
    resultType: terminalNode.outputType,
  })
  const tempDef: PipelineDefinition = {
    definitionId: `${input.templateId}@${input.templateVersion}:${input.mode}:${input.revision}`,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    mode: input.mode,
    revision: input.revision,
    targetNodeId: template.targetNodeId,
    nodes: nodeDefs,
    sourceDsl,
    dataset: materialized.elements,
    iterateTrace: materialized.iterateTrace,
    employeeDataset: input.dataset,
    resultType: terminalNode.outputType,
    javaCode,
    snapshotCount: 0,
  }
  const timeline = getTimeline({ ...tempDef })
  if (timeline.length > SNAPSHOT_LIMIT) {
    return fail([
      issue(
        'SNAPSHOT_BUDGET',
        `snapshot件数 ${timeline.length} が安全上限 ${SNAPSHOT_LIMIT} を超えます`,
        'dataset',
      ),
    ])
  }

  // 途中0件モードは結果0件であること（事前実行結果で検証）
  if (input.mode === 'midEmpty') {
    const last = timeline[timeline.length - 1]
    if (last && last.output.count !== 0) {
      return fail([
        issue('TEACHING_CONSTRAINT', '途中0件モードは最終結果が0件である必要があります', 'dataset'),
      ])
    }
  }

  // 手順7: PipelineDefinition生成（不変）
  const definition: PipelineDefinition = { ...tempDef, snapshotCount: timeline.length }
  return ok(deepFreeze(definition))
}
