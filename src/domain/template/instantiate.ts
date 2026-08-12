import type { TemplateRegistry } from './templateRegistry'
import type { ParameterSlot } from './pipelineTemplate'
import type { ElementStateKind, OperationCatalog } from '../catalog/operationCatalog'
import { resolveTypeRule } from '../catalog/operationCatalog'
import type { DslPredicate } from '../dsl/ast'
import type { CollectTripleDsl, CollectorDsl } from '../dsl/collectorAst'
import { collectorKindsOf } from '../dsl/collectorAst'
import {
  resolveCollectTripleType,
  resolveCollectorType,
  validateCollectTriple,
  validateCollectorStructure,
} from '../dsl/validateCollector'
import type { ComparatorDsl } from '../dsl/comparatorAst'
import type { GathererDsl } from '../dsl/gatherAst'
import { isWindowGatherer } from '../dsl/gatherAst'
import {
  resolveGathererOutputElementType,
  validateGathererStructure,
} from '../dsl/validateGather'
import type { ConsumerDsl } from '../dsl/consumerAst'
import type { MapperDsl } from '../dsl/mapperAst'
import type { SourceDsl } from '../dsl/sourceAst'
import type { ArrayGeneratorDsl, ReductionDsl, ReductionIdentity } from '../dsl/terminalAst'
import { validateStructure, validateTypes, validateWhitelist } from '../dsl/validate'
import { validateComparatorStructure } from '../dsl/validateComparator'
import { validateConsumerStructure, validateCount } from '../dsl/validateConsumer'
import {
  validateArrayGenerator,
  validateReductionIdentity,
  validateReductionStructure,
} from '../dsl/validateTerminal'
import { validateMapperStructure, resolveMapperOutputType } from '../dsl/validateMapper'
import { validateSourceStructure, sourceStreamType } from '../dsl/validateSource'
import {
  evaluateIteratePredicate,
  materializeInfiniteSource,
  materializeSource,
} from '../dsl/materializeSource'
import { evaluateFlatMapper, evaluateMapper } from '../dsl/evaluateMapper'
import { evaluatePredicate, evaluateValuePredicate } from '../dsl/evaluate'
import { comparatorKeyLabel, sortBuffer } from '../dsl/evaluateComparator'
import { distinctKeyOf } from '../engine/distinctKey'
import { generateJavaCode } from '../dsl/javaCode'
import { formatSimValue, WRAPPER_NAMES } from '../model/value'
import { analyzeBoundedness } from '../pipeline/boundedness'
import type { BoundednessMeta } from '../pipeline/boundedness'
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

/**
 * gatherノードの凡例をGatherer kindに応じて絞り込む（Phase 7指示 §7.5）。
 * `BUFFERED`はwindow系だけで発生し、scan / foldでは発生しないため凡例から除く。
 * OperationCatalogの定義（4状態）は変更せず、node単位のlegendStatesで絞る
 * （既存legend機構の範囲内。判断は docs/phase-7-decisions.md）。
 */
function gatherLegendStates(
  catalogStates: readonly ElementStateKind[],
  gatherer: GathererDsl,
): readonly ElementStateKind[] {
  if (isWindowGatherer(gatherer)) return catalogStates
  return catalogStates.filter((state) => state !== 'BUFFERED')
}

function elementTypeOf(streamType: TypeRef): TypeRef {
  if (streamType.kind === 'stream') return streamType.elementType
  if (streamType.kind === 'primitiveStream') {
    const name =
      streamType.name === 'IntStream' ? 'int' : streamType.name === 'LongStream' ? 'long' : 'double'
    return { kind: 'primitive', name }
  }
  throw new Error(`Stream型ではありません: ${formatTypeRef(streamType)}`)
}

function primitiveNameOf(streamType: TypeRef): 'int' | 'long' | 'double' | null {
  if (streamType.kind !== 'primitiveStream') return null
  return streamType.name === 'IntStream' ? 'int' : streamType.name === 'LongStream' ? 'long' : 'double'
}

function primitiveOptionalOf(primitive: 'int' | 'long' | 'double'): TypeRef {
  return {
    kind: 'primitiveOptional',
    name: primitive === 'int' ? 'OptionalInt' : primitive === 'long' ? 'OptionalLong' : 'OptionalDouble',
  }
}

interface TerminalNodeConfig {
  readonly operationId: string
  readonly nodeId: string
  readonly streamType: TypeRef
  readonly reduction: ReductionDsl | null
  readonly identity: ReductionIdentity | null
  readonly comparator: ComparatorDsl | null
  readonly predicate: DslPredicate | null
  readonly consumer: ConsumerDsl | null
  readonly arrayGenerator: ArrayGeneratorDsl | null
}

/**
 * Phase 4 terminalの型検証と結果型導出（指示§7・§9）。
 * operationIdだけで型検証を迂回せず、入力Stream型・DSL構成から結果TypeRefを導出する。
 */
function resolveTerminalNode(cfg: TerminalNodeConfig): Result<TypeRef> {
  const { operationId, nodeId, streamType } = cfg
  const path = `nodes.${nodeId}`
  const element = elementTypeOf(streamType)
  const primitive = primitiveNameOf(streamType)
  const isEmployee = element.kind === 'object' && element.name === 'Employee'

  switch (operationId) {
    case 'count':
      return ok({ kind: 'primitive', name: 'long' })
    case 'reduce': {
      const reduction = cfg.reduction
      if (!reduction) return fail([issue('SLOT_MISSING', `node ${nodeId} のreductionがありません`, path)])
      if (reduction.kind === 'numericSum') {
        if (!primitive) {
          return fail([
            issue('TYPE_MISMATCH', `numericSumはprimitive Streamにのみ適用できます（実際: ${formatTypeRef(streamType)}）`, path),
          ])
        }
        if (cfg.identity && cfg.identity.type !== primitive) {
          return fail([
            issue('TYPE_MISMATCH', `identityの型${cfg.identity.type}は${primitive}要素と一致しません`, path),
          ])
        }
        return ok(cfg.identity ? { kind: 'primitive', name: primitive } : primitiveOptionalOf(primitive))
      }
      if (reduction.kind === 'stringConcat') {
        if (!(element.kind === 'object' && element.name === 'String')) {
          return fail([
            issue('TYPE_MISMATCH', `stringConcatはStream<String>にのみ適用できます（実際: ${formatTypeRef(element)}）`, path),
          ])
        }
        if (cfg.identity && cfg.identity.type !== 'string') {
          return fail([
            issue('TYPE_MISMATCH', `identityの型${cfg.identity.type}はString要素と一致しません`, path),
          ])
        }
        return ok(
          cfg.identity ? { kind: 'object', name: 'String' } : { kind: 'optional', elementType: element },
        )
      }
      // employeeFieldSum: 累積型がU（≠T）となるためJava上3引数reduceが必須（identity + combiner）
      if (!isEmployee) {
        return fail([
          issue('TYPE_MISMATCH', `employeeFieldSumはStream<Employee>にのみ適用できます（実際: ${formatTypeRef(element)}）`, path),
        ])
      }
      if (!cfg.identity) {
        return fail([
          issue('SLOT_MISSING', `3引数reduce（employeeFieldSum）にはidentityが必要です`, path),
        ])
      }
      const expectedType = reduction.field === 'salary' ? 'long' : 'int'
      if (cfg.identity.type !== expectedType) {
        return fail([
          issue('TYPE_MISMATCH', `${reduction.field}の合計のidentityは${expectedType}型が必要です（実際: ${cfg.identity.type}）`, path),
        ])
      }
      return ok({ kind: 'primitive', name: expectedType })
    }
    case 'min':
    case 'max': {
      if (primitive) {
        if (cfg.comparator) {
          return fail([
            issue('TYPE_MISMATCH', `primitive Streamの${operationId}()へComparatorは指定できません`, path),
          ])
        }
        return ok(primitiveOptionalOf(primitive))
      }
      // object StreamのStream.min / maxはComparatorが必須（Java API）
      if (!cfg.comparator) {
        return fail([
          issue('SLOT_MISSING', `Stream.${operationId}(Comparator)にはComparatorが必要です`, path),
        ])
      }
      if (cfg.comparator.kind === 'employeeKeys' && !isEmployee) {
        return fail([
          issue('TYPE_MISMATCH', `EmployeeキーのComparatorはStream<Employee>にのみ適用できます（実際: ${formatTypeRef(element)}）`, path),
        ])
      }
      if (cfg.comparator.kind === 'natural') {
        const comparable =
          element.kind === 'object' &&
          ['String', 'Integer', 'Long', 'Double', 'LocalDate'].includes(element.name)
        if (!comparable) {
          return fail([
            issue('TYPE_MISMATCH', `naturalOrder Comparatorは要素型がComparableである必要があります（実際: ${formatTypeRef(element)}）`, path),
          ])
        }
      }
      return ok({ kind: 'optional', elementType: element })
    }
    case 'findFirst':
    case 'findAny':
      return ok(primitive ? primitiveOptionalOf(primitive) : { kind: 'optional', elementType: element })
    case 'anyMatch':
    case 'allMatch':
    case 'noneMatch': {
      const predicate = cfg.predicate
      if (!predicate) return fail([issue('SLOT_MISSING', `node ${nodeId} のPredicateがありません`, path)])
      if (predicate.kind === 'currentValueCompare') {
        const numeric =
          element.kind === 'primitive' ||
          (element.kind === 'object' && ['Integer', 'Long', 'Double'].includes(element.name))
        if (!numeric) {
          return fail([
            issue('TYPE_MISMATCH', `currentValueCompareは数値要素にのみ適用できます（実際: ${formatTypeRef(element)}）`, path),
          ])
        }
      } else if (!isEmployee) {
        return fail([
          issue('TYPE_MISMATCH', `fieldCompareはEmployee要素にのみ適用できます（実際: ${formatTypeRef(element)}）`, path),
        ])
      }
      return ok({ kind: 'primitive', name: 'boolean' })
    }
    case 'sum':
      if (!primitive) {
        return fail([
          issue('TYPE_MISMATCH', `sum()はprimitive Streamにのみ適用できます（実際: ${formatTypeRef(streamType)}）`, path),
        ])
      }
      return ok({ kind: 'primitive', name: primitive })
    case 'average':
      if (!primitive) {
        return fail([
          issue('TYPE_MISMATCH', `average()はprimitive Streamにのみ適用できます（実際: ${formatTypeRef(streamType)}）`, path),
        ])
      }
      return ok({ kind: 'primitiveOptional', name: 'OptionalDouble' })
    case 'summaryStatistics': {
      if (!primitive) {
        return fail([
          issue('TYPE_MISMATCH', `summaryStatistics()はprimitive Streamにのみ適用できます（実際: ${formatTypeRef(streamType)}）`, path),
        ])
      }
      const name =
        primitive === 'int'
          ? 'IntSummaryStatistics'
          : primitive === 'long'
            ? 'LongSummaryStatistics'
            : 'DoubleSummaryStatistics'
      return ok({ kind: 'statistics', name })
    }
    case 'toArray': {
      if (primitive) {
        if (cfg.arrayGenerator) {
          return fail([
            issue('TYPE_MISMATCH', `primitive StreamのtoArray()へgeneratorは指定できません`, path),
          ])
        }
        return ok({ kind: 'array', elementType: { kind: 'primitive', name: primitive } })
      }
      const generator = cfg.arrayGenerator
      if (!generator) {
        // Stream.toArray()はObject[]を返す
        return ok({ kind: 'array', elementType: { kind: 'object', name: 'Object' } })
      }
      if (generator.elementTypeName !== 'Object') {
        const matches = element.kind === 'object' && element.name === generator.elementTypeName
        if (!matches) {
          return fail([
            issue(
              'TYPE_MISMATCH',
              `generator ${generator.elementTypeName}[]::new は要素型${formatTypeRef(element)}と一致しません`,
              path,
            ),
          ])
        }
      }
      return ok({ kind: 'array', elementType: { kind: 'object', name: generator.elementTypeName } })
    }
    case 'forEach':
    case 'forEachOrdered': {
      const consumer = cfg.consumer
      if (!consumer) return fail([issue('SLOT_MISSING', `node ${nodeId} のConsumerがありません`, path)])
      if (consumer.kind === 'printField' && !isEmployee) {
        return fail([
          issue('TYPE_MISMATCH', `PRINT_FIELDはEmployee要素にのみ適用できます（実際: ${formatTypeRef(element)}）`, path),
        ])
      }
      return ok({ kind: 'void' })
    }
    default:
      return fail([issue('STRUCTURE_INVALID', `未対応のterminal操作です: ${operationId}`, path)])
  }
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
  const comparators = new Map<SlotId, ComparatorDsl>()
  const consumers = new Map<SlotId, ConsumerDsl>()
  const counts = new Map<SlotId, number>()
  const reductions = new Map<SlotId, ReductionDsl>()
  const identities = new Map<SlotId, ReductionIdentity>()
  const arrayGenerators = new Map<SlotId, ArrayGeneratorDsl>()
  const collectors = new Map<SlotId, CollectorDsl>()
  const collectTriples = new Map<SlotId, CollectTripleDsl>()
  const gatherers = new Map<SlotId, GathererDsl>()
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
    } else if (slot.kind === 'comparator') {
      const result = validateComparatorStructure(raw, `dslParameters.${slot.slotId}`)
      if (result.ok) comparators.set(slot.slotId, result.value)
      else structureIssues.push(...result.issues)
    } else if (slot.kind === 'consumer') {
      const result = validateConsumerStructure(raw, `dslParameters.${slot.slotId}`)
      if (result.ok) consumers.set(slot.slotId, result.value)
      else structureIssues.push(...result.issues)
    } else if (slot.kind === 'count') {
      const result = validateCount(raw, `dslParameters.${slot.slotId}`)
      if (result.ok) counts.set(slot.slotId, result.value)
      else structureIssues.push(...result.issues)
    } else if (slot.kind === 'reduction') {
      const result = validateReductionStructure(raw, `dslParameters.${slot.slotId}`)
      if (result.ok) reductions.set(slot.slotId, result.value)
      else structureIssues.push(...result.issues)
    } else if (slot.kind === 'identity') {
      const result = validateReductionIdentity(raw, `dslParameters.${slot.slotId}`)
      if (result.ok) identities.set(slot.slotId, result.value)
      else structureIssues.push(...result.issues)
    } else if (slot.kind === 'arrayGenerator') {
      const result = validateArrayGenerator(raw, `dslParameters.${slot.slotId}`)
      if (result.ok) arrayGenerators.set(slot.slotId, result.value)
      else structureIssues.push(...result.issues)
    } else if (slot.kind === 'collector') {
      const result = validateCollectorStructure(raw, `dslParameters.${slot.slotId}`)
      if (result.ok) collectors.set(slot.slotId, result.value)
      else structureIssues.push(...result.issues)
    } else if (slot.kind === 'collectTriple') {
      const result = validateCollectTriple(raw, `dslParameters.${slot.slotId}`)
      if (result.ok) collectTriples.set(slot.slotId, result.value)
      else structureIssues.push(...result.issues)
    } else if (slot.kind === 'gatherer') {
      // Phase 7: Gatherer DSLのclosed schema構造検証（指示§7.4）
      const result = validateGathererStructure(raw, `dslParameters.${slot.slotId}`)
      if (result.ok) gatherers.set(slot.slotId, result.value)
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
    } else if (slot.kind === 'comparator') {
      const comparator = comparators.get(slot.slotId)
      if (!comparator) continue
      if (!slot.allowedComparatorKinds.includes(comparator.kind)) {
        whitelistIssues.push(
          issue(
            'WHITELIST_KIND',
            `このslotで許可されていないcomparator kindです: ${comparator.kind}`,
            `dslParameters.${slot.slotId}`,
          ),
        )
      } else if (comparator.kind === 'employeeKeys') {
        for (const key of comparator.keys) {
          if (!slot.allowedFields.includes(key.field)) {
            whitelistIssues.push(
              issue(
                'WHITELIST_FIELD',
                `このslotで許可されていないComparatorキーです: ${key.field}`,
                `dslParameters.${slot.slotId}`,
              ),
            )
          }
        }
      }
    } else if (slot.kind === 'consumer') {
      const consumer = consumers.get(slot.slotId)
      if (!consumer) continue
      if (!slot.allowedConsumerKinds.includes(consumer.kind)) {
        whitelistIssues.push(
          issue(
            'WHITELIST_KIND',
            `このslotで許可されていないconsumer kindです: ${consumer.kind}`,
            `dslParameters.${slot.slotId}`,
          ),
        )
      } else if (consumer.kind === 'printField' && !slot.allowedFields.includes(consumer.field)) {
        whitelistIssues.push(
          issue(
            'WHITELIST_FIELD',
            `このslotで許可されていないPRINT_FIELD fieldです: ${consumer.field}`,
            `dslParameters.${slot.slotId}`,
          ),
        )
      }
    } else if (slot.kind === 'reduction') {
      const reduction = reductions.get(slot.slotId)
      if (!reduction) continue
      if (!slot.allowedReductionKinds.includes(reduction.kind)) {
        whitelistIssues.push(
          issue(
            'WHITELIST_KIND',
            `このslotで許可されていないreduction kindです: ${reduction.kind}`,
            `dslParameters.${slot.slotId}`,
          ),
        )
      }
    } else if (slot.kind === 'arrayGenerator') {
      const generator = arrayGenerators.get(slot.slotId)
      if (!generator) continue
      if (!slot.allowedElementTypeNames.includes(generator.elementTypeName)) {
        whitelistIssues.push(
          issue(
            'WHITELIST_KIND',
            `このslotで許可されていないgenerator要素型です: ${generator.elementTypeName}`,
            `dslParameters.${slot.slotId}`,
          ),
        )
      }
    } else if (slot.kind === 'collector') {
      const collector = collectors.get(slot.slotId)
      if (!collector) continue
      // AST中の全ノードのcollectorKindがslotの許可範囲内であることを検証する（入れ子を含む）
      for (const kind of new Set(collectorKindsOf(collector))) {
        if (!slot.allowedCollectorKinds.includes(kind)) {
          whitelistIssues.push(
            issue(
              'WHITELIST_KIND',
              `このslotで許可されていないcollector kindです: ${kind}`,
              `dslParameters.${slot.slotId}`,
            ),
          )
        }
      }
    } else if (slot.kind === 'gatherer') {
      // Phase 7: Gatherer DSLに再帰はないためkindは1件（指示§7.4）
      const gatherer = gatherers.get(slot.slotId)
      if (!gatherer) continue
      if (!slot.allowedGathererKinds.includes(gatherer.kind)) {
        whitelistIssues.push(
          issue(
            'WHITELIST_KIND',
            `このslotで許可されていないgatherer kindです: ${gatherer.kind}`,
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
  const comparatorsByNode = new Map<string, ComparatorDsl>()
  const consumersByNode = new Map<string, ConsumerDsl>()
  const countsByNode = new Map<string, number>()
  const reductionsByNode = new Map<string, ReductionDsl>()
  const identitiesByNode = new Map<string, ReductionIdentity>()
  const arrayGeneratorsByNode = new Map<string, ArrayGeneratorDsl>()
  const collectorsByNode = new Map<string, CollectorDsl>()
  const collectTriplesByNode = new Map<string, CollectTripleDsl>()
  const gatherersByNode = new Map<string, GathererDsl>()
  for (const slot of template.parameterSlots) {
    if (slot.kind === 'predicate') {
      const p = predicates.get(slot.slotId)
      if (p) predicatesByNode.set(slot.targetNodeId, p)
    } else if (slot.kind === 'mapper') {
      const m = mappers.get(slot.slotId)
      if (m) mappersByNode.set(slot.targetNodeId, m)
    } else if (slot.kind === 'comparator') {
      const c = comparators.get(slot.slotId)
      if (c) comparatorsByNode.set(slot.targetNodeId, c)
    } else if (slot.kind === 'consumer') {
      const c = consumers.get(slot.slotId)
      if (c) consumersByNode.set(slot.targetNodeId, c)
    } else if (slot.kind === 'count') {
      const c = counts.get(slot.slotId)
      if (c !== undefined) countsByNode.set(slot.targetNodeId, c)
    } else if (slot.kind === 'reduction') {
      const r = reductions.get(slot.slotId)
      if (r) reductionsByNode.set(slot.targetNodeId, r)
    } else if (slot.kind === 'identity') {
      const i = identities.get(slot.slotId)
      if (i) identitiesByNode.set(slot.targetNodeId, i)
    } else if (slot.kind === 'arrayGenerator') {
      const g = arrayGenerators.get(slot.slotId)
      if (g) arrayGeneratorsByNode.set(slot.targetNodeId, g)
    } else if (slot.kind === 'collector') {
      const c = collectors.get(slot.slotId)
      if (c) collectorsByNode.set(slot.targetNodeId, c)
    } else if (slot.kind === 'collectTriple') {
      const c = collectTriples.get(slot.slotId)
      if (c) collectTriplesByNode.set(slot.targetNodeId, c)
    } else if (slot.kind === 'gatherer') {
      const g = gatherers.get(slot.slotId)
      if (g) gatherersByNode.set(slot.targetNodeId, g)
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
    } else if (op.inputTypeRule.kind === 'anyStreamLike') {
      // object / primitiveの両方のStreamを受理する明示的な型規則（Phase 3指示 §5.2）
      if (!currentType || (currentType.kind !== 'stream' && currentType.kind !== 'primitiveStream')) {
        return fail([
          issue(
            'TYPE_MISMATCH',
            `node ${node.nodeId}（${op.displayName}）はStreamの入力が必要です`,
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
      case 'fromTerminal': {
        if (!currentType || (currentType.kind !== 'stream' && currentType.kind !== 'primitiveStream')) {
          return fail([
            issue('TYPE_MISMATCH', `node ${node.nodeId}（${op.displayName}）はStreamの入力が必要です`, `nodes.${node.nodeId}`),
          ])
        }
        const resolved = resolveTerminalNode({
          operationId: node.operationId,
          nodeId: node.nodeId,
          streamType: currentType,
          reduction: reductionsByNode.get(node.nodeId) ?? null,
          identity: identitiesByNode.get(node.nodeId) ?? null,
          comparator: comparatorsByNode.get(node.nodeId) ?? null,
          predicate: predicatesByNode.get(node.nodeId) ?? null,
          consumer: consumersByNode.get(node.nodeId) ?? null,
          arrayGenerator: arrayGeneratorsByNode.get(node.nodeId) ?? null,
        })
        if (!resolved.ok) return fail(resolved.issues)
        outputType = resolved.value
        break
      }
      case 'fromCollector': {
        // Collector ASTを再帰的にたどり、内側から外側へ結果TypeRefを組み上げる（§7.2・§7.3）
        if (!currentType || currentType.kind !== 'stream') {
          return fail([
            issue(
              'TYPE_MISMATCH',
              `node ${node.nodeId}（${op.displayName}）はobject Streamの入力が必要です（primitive特化Streamのcollectは対象外）`,
              `nodes.${node.nodeId}`,
            ),
          ])
        }
        const collector = collectorsByNode.get(node.nodeId) ?? null
        const triple = collectTriplesByNode.get(node.nodeId) ?? null
        if (node.operationId === 'collect') {
          if (!collector) {
            return fail([
              issue('SLOT_MISSING', `node ${node.nodeId}にCollectorがありません`, `nodes.${node.nodeId}`),
            ])
          }
          const resolved = resolveCollectorType(
            collector,
            currentType.elementType,
            `nodes.${node.nodeId}.collector`,
          )
          if (!resolved.ok) return fail(resolved.issues)
          outputType = resolved.value
          break
        }
        if (!triple) {
          return fail([
            issue('SLOT_MISSING', `node ${node.nodeId}に3引数collectの定義がありません`, `nodes.${node.nodeId}`),
          ])
        }
        const resolved = resolveCollectTripleType(
          triple,
          currentType.elementType,
          `nodes.${node.nodeId}.collectTriple`,
        )
        if (!resolved.ok) return fail(resolved.issues)
        outputType = resolved.value
        break
      }
      case 'fromGatherer': {
        // Gatherer DSLから出力要素型を解決する（Phase 7指示 §7.5、v0.9 §8.3）
        if (!currentType) {
          return fail([
            issue('TYPE_MISMATCH', `node ${node.nodeId} に入力型がありません`, `nodes.${node.nodeId}`),
          ])
        }
        const gatherer = gatherersByNode.get(node.nodeId)
        if (!gatherer) {
          return fail([
            issue('SLOT_MISSING', `node ${node.nodeId} のGathererがありません`, `nodes.${node.nodeId}`),
          ])
        }
        const resolved = resolveGathererOutputElementType(
          gatherer,
          currentType,
          `nodes.${node.nodeId}.gatherer`,
        )
        if (!resolved.ok) return fail(resolved.issues)
        outputType = streamOf(resolved.value)
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
    // ---- Phase 3操作の型規則（指示§5.2） ----
    const comparator = comparatorsByNode.get(node.nodeId) ?? null
    const consumer = consumersByNode.get(node.nodeId) ?? null
    const count = countsByNode.get(node.nodeId) ?? null
    if (node.operationId === 'sorted' && currentType) {
      if (comparator && currentType.kind === 'primitiveStream') {
        // Comparatorをprimitive Streamへ指定する候補は拒否する（§5.2）
        return fail([
          issue(
            'TYPE_MISMATCH',
            `sorted(Comparator)はobject Streamだけを対象とします（primitive Stream ${formatTypeRef(currentType)} へは指定できません）`,
            `nodes.${node.nodeId}`,
          ),
        ])
      }
      if (comparator && comparator.kind === 'employeeKeys') {
        const el = elementTypeOf(currentType)
        if (!(el.kind === 'object' && el.name === 'Employee')) {
          return fail([
            issue(
              'TYPE_MISMATCH',
              `Employeeキー指定のComparatorはStream<Employee>にのみ適用できます（実際: ${formatTypeRef(el)}）`,
              `nodes.${node.nodeId}`,
            ),
          ])
        }
      }
      if ((!comparator || comparator.kind === 'natural') && currentType.kind === 'stream') {
        // object Streamの自然順序sortedは、許可済みの自然順序対応型に限る（§5.2）
        const el = elementTypeOf(currentType)
        const naturallyComparable =
          el.kind === 'object' &&
          ['String', 'Integer', 'Long', 'Double', 'LocalDate'].includes(el.name)
        if (!naturallyComparable) {
          return fail([
            issue(
              'TYPE_MISMATCH',
              `sorted()は要素型がComparableである必要があります。${formatTypeRef(el)}はComparableではないため、PipelineDefinition生成前に拒否します`,
              `nodes.${node.nodeId}`,
            ),
          ])
        }
      }
    }
    if ((node.operationId === 'takeWhile' || node.operationId === 'dropWhile') && currentType) {
      const predicate = predicatesByNode.get(node.nodeId)
      if (!predicate) {
        return fail([
          issue('SLOT_MISSING', `node ${node.nodeId} のPredicateがありません`, `nodes.${node.nodeId}`),
        ])
      }
      const el = elementTypeOf(currentType)
      if (predicate.kind === 'currentValueCompare') {
        const numeric =
          el.kind === 'primitive' ||
          (el.kind === 'object' && ['Integer', 'Long', 'Double'].includes(el.name))
        if (!numeric) {
          return fail([
            issue(
              'TYPE_MISMATCH',
              `currentValueCompareは数値要素にのみ適用できます（実際: ${formatTypeRef(el)}）`,
              `nodes.${node.nodeId}`,
            ),
          ])
        }
      } else if (!(el.kind === 'object' && el.name === 'Employee')) {
        return fail([
          issue(
            'TYPE_MISMATCH',
            `fieldCompareはEmployee要素にのみ適用できます（実際: ${formatTypeRef(el)}）`,
            `nodes.${node.nodeId}`,
          ),
        ])
      }
      // 初版実行はsequential + orderedに限定する（§7.6・§7.7）
      const sourceTplNode = template.nodes.find((n) => n.role === 'source')
      const sourceOrdered = sourceTplNode
        ? (catalog.get(sourceTplNode.operationId).sourceMeta?.ordered ?? true)
        : true
      if (!sourceOrdered) {
        return fail([
          issue(
            'UNORDERED_WHILE',
            `${op.displayName}の初版実行はsequential + orderedに限定されます。unordered source候補は実行可能Pipelineとして受理しません`,
            `nodes.${node.nodeId}`,
          ),
        ])
      }
    }
    if ((node.operationId === 'limit' || node.operationId === 'skip') && count === null) {
      return fail([
        issue('SLOT_MISSING', `node ${node.nodeId}（${op.displayName}）の引数がありません`, `nodes.${node.nodeId}`),
      ])
    }
    if (node.operationId === 'peek' && currentType) {
      if (!consumer) {
        return fail([
          issue('SLOT_MISSING', `node ${node.nodeId} のConsumerがありません`, `nodes.${node.nodeId}`),
        ])
      }
      if (consumer.kind === 'printField') {
        const el = elementTypeOf(currentType)
        if (!(el.kind === 'object' && el.name === 'Employee')) {
          return fail([
            issue(
              'TYPE_MISMATCH',
              `PRINT_FIELDはEmployee要素にのみ適用できます（実際: ${formatTypeRef(el)}）`,
              `nodes.${node.nodeId}`,
            ),
          ])
        }
      }
    }
    const reduction = reductionsByNode.get(node.nodeId) ?? null
    const gatherer = gatherersByNode.get(node.nodeId) ?? null
    nodeDefs.push({
      nodeId: node.nodeId,
      operationId: node.operationId,
      role: node.role,
      traits: op.traits,
      displayName: op.displayName,
      predicate: predicatesByNode.get(node.nodeId) ?? null,
      mapper: mappersByNode.get(node.nodeId) ?? null,
      comparator,
      consumer,
      count,
      reduction,
      identity: identitiesByNode.get(node.nodeId) ?? null,
      // employeeFieldSumは累積型がU（≠T）のためJava上3引数reduce（combinerあり）となる。
      // sequential実行ではcombinerは呼ばれない（§6.1）
      hasCombiner: reduction?.kind === 'employeeFieldSum',
      arrayGenerator: arrayGeneratorsByNode.get(node.nodeId) ?? null,
      collector: collectorsByNode.get(node.nodeId) ?? null,
      collectTriple: collectTriplesByNode.get(node.nodeId) ?? null,
      gatherer,
      inputType: currentType,
      outputType,
      lineId: lineIdForNode(node.nodeId),
      // gatherではGatherer kindごとに発生しない状態を凡例から除く（指示§7.5。既存legend機構の範囲）
      legendStates: gatherer ? gatherLegendStates(op.legendStates, gatherer) : op.legendStates,
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

  // 手順6（有限性の事前検証）: source有限性とPipeline有限化を区別し、
  // 無限sourceは必要なsource要求件数をノード順から事前に導出する（Phase 3指示 §8.2）。
  // 有限化limit()を持たない・構造的に保証できない候補はPipelineDefinition生成前に拒否する。
  const sourceTplNode = template.nodes.find((n) => n.role === 'source')
  const sourceMeta = sourceTplNode ? catalog.get(sourceTplNode.operationId).sourceMeta : undefined
  const boundednessResult = analyzeBoundedness(
    sourceDsl,
    sourceMeta?.bounded ?? 'finite',
    nodeDefs
      .filter((n) => n.role === 'intermediate')
      .map((n) => ({ operationId: n.operationId, count: n.count })),
  )
  if (!boundednessResult.ok) return fail(boundednessResult.issues)
  const boundedness: BoundednessMeta = boundednessResult.value

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
      // predicateを通過する正確な要素数
      const bound = predicate.operator === 'LTE' ? predicate.value : predicate.value - 1
      const passingCount = Math.floor((bound - seed) / operator.step) + 1
      // 最終候補（predicateをfalseにする値 = seed + passingCount * step）が
      // Java int範囲に収まること。predicate.value + stepではなく実際のfalse候補を基準にする
      const maxSafeIncrements = Math.floor((INT32_MAX - seed) / operator.step)
      if (passingCount > maxSafeIncrements) {
        return fail([
          issue(
            'TYPE_MISMATCH',
            `iterateの候補値がJava intの範囲を超えます（${passingCount}回目のoperator適用でoverflowします）`,
            'source',
          ),
        ])
      }
      // 予算の下限見積り（候補 + 判定 + 送出 + 追加 + 初期/確定/消費）で事前検証
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

  const materialized =
    sourceDsl.kind === 'generate' || sourceDsl.kind === 'iterate2'
      ? materializeInfiniteSource(sourceDsl, boundedness.maxSourceDemand ?? 0)
      : materializeSource(sourceDsl, input.dataset)

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
    // ---- Phase 3の教材制約（指示§9）。source要素が対象ノードへ直接到達するtemplateで検証する ----
    const targetIsFirstIntermediate = template.nodes[1]?.nodeId === template.targetNodeId
    if (targetIsFirstIntermediate) {
      const elements = materialized.elements
      if (targetNode.operationId === 'distinct') {
        // distinct標準は重複を含む
        const keys = elements.map((el) => distinctKeyOf(el.value, el.elementId))
        if (new Set(keys).size === keys.length) {
          teachingIssues.push(
            issue('TEACHING_CONSTRAINT', 'distinctの標準モードは重複を含む入力が必要です', 'dataset'),
          )
        }
      }
      if (targetNode.operationId === 'sorted') {
        // sorted標準は事前に整列済みではない（§11.3）
        const sortedOrder = sortBuffer(elements, targetNode.comparator)
        const alreadySorted = sortedOrder.every((el, i) => el === elements[i])
        if (alreadySorted) {
          teachingIssues.push(
            issue('TEACHING_CONSTRAINT', 'sortedの標準モードは事前に整列済みではない入力が必要です', 'dataset'),
          )
        }
        // Comparator標準は同値キーの別element IDを含む
        if (targetNode.comparator && targetNode.comparator.kind === 'employeeKeys') {
          const keyLabels = elements.map((el) => comparatorKeyLabel(targetNode.comparator, el.value))
          if (new Set(keyLabels).size === keyLabels.length) {
            teachingIssues.push(
              issue(
                'TEACHING_CONSTRAINT',
                'sorted(Comparator)の標準モードは同値キーを持つ別要素（同値キー・別ID）が必要です',
                'dataset',
              ),
            )
          }
        }
      }
      if (targetNode.operationId === 'limit' && targetNode.count !== null) {
        // limit標準は元要素数がlimit値より多い
        if (elements.length <= targetNode.count && boundedness.sourceBounded === 'finite') {
          teachingIssues.push(
            issue('TEACHING_CONSTRAINT', 'limitの標準モードは元要素数がlimit値より多い入力が必要です', 'dataset'),
          )
        }
      }
      if (
        (targetNode.operationId === 'takeWhile' || targetNode.operationId === 'dropWhile') &&
        targetNode.predicate
      ) {
        const predicate = targetNode.predicate
        const results = elements.map((el) => evaluateValuePredicate(predicate, el.value))
        const firstFalse = results.indexOf(false)
        // takeWhile標準は最初のfalse後にPredicateならtrueとなる未評価値を含む。
        // dropWhile標準は最初のfalse後にtrueとなる値を含む（§9・§11.3）
        const hasTrueAfterFalse = firstFalse >= 0 && results.slice(firstFalse + 1).includes(true)
        if (!hasTrueAfterFalse) {
          teachingIssues.push(
            issue(
              'TEACHING_CONSTRAINT',
              `${targetNode.displayName}の標準モードは最初のfalseの後にtrueとなる値を含む入力が必要です`,
              'dataset',
            ),
          )
        }
      }
      if (targetNode.operationId === 'peek' && elements.length === 0) {
        // peek標準はConsumer呼出しが1件以上発生する
        teachingIssues.push(
          issue('TEACHING_CONSTRAINT', 'peekの標準モードはConsumer呼出しが1件以上必要です', 'dataset'),
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
      comparator: n.comparator,
      consumer: n.consumer,
      count: n.count,
      reduction: n.reduction,
      identity: n.identity,
      hasCombiner: n.hasCombiner,
      arrayGenerator: n.arrayGenerator,
      collector: n.collector,
      collectTriple: n.collectTriple,
      gatherer: n.gatherer,
    })),
    resultType: terminalNode.outputType,
  })
  const sourceOrdered = sourceMeta?.ordered ?? true
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
    // Phase 3の中間操作はいずれもencounter orderを維持する（§5.3）。
    // unordered sourceでは結果のencounter orderも未定義のまま
    orderMeta: { sourceOrdered, resultOrdered: sourceOrdered },
    boundedness,
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

  // 途中0件モードはterminalへの入力が0件であること（事前実行結果で検証。
  // scalar / Optional等の非List結果も含めて、terminalへ到達した要素の有無で判定する）
  if (input.mode === 'midEmpty') {
    const last = timeline[timeline.length - 1]
    if (last) {
      const reachedTerminal = Object.values(last.elementNodeStates).some(
        (states) => states[terminalNode.nodeId] === 'PASSED',
      )
      if (last.output.count !== 0 || reachedTerminal) {
        return fail([
          issue('TEACHING_CONSTRAINT', '途中0件モードはterminalへの入力が0件である必要があります', 'dataset'),
        ])
      }
    }
  }

  // 手順7: PipelineDefinition生成（不変）
  const definition: PipelineDefinition = { ...tempDef, snapshotCount: timeline.length }
  return ok(deepFreeze(definition))
}
