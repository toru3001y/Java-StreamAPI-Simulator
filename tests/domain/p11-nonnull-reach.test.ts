import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultCatalog } from '../../src/domain/catalog/operations'
import {
  OP_BOXED,
  OP_COLLECT,
  OP_GATHER,
  OP_LIMIT,
  OP_MAP,
  OP_TO_LIST,
} from '../../src/domain/catalog/operations'
import type {
  ParameterSlot,
  PipelineTemplate,
  PipelineTemplateNode,
} from '../../src/domain/template/pipelineTemplate'
import type { SourceDsl } from '../../src/domain/dsl/sourceAst'
import type { MapperDsl } from '../../src/domain/dsl/mapperAst'
import type { ClassifierDsl, ToMapMergeId, ToMapValueDsl } from '../../src/domain/dsl/collectorAst'
import type { GathererDsl } from '../../src/domain/dsl/gatherAst'
import type { SimValue } from '../../src/domain/model/value'
import type { TypeRef } from '../../src/domain/types/typeRef'
import { materializeSource } from '../../src/domain/dsl/materializeSource'
import { evaluateFlatMapper, evaluateMapper } from '../../src/domain/dsl/evaluateMapper'
import { applyGatherAccumulation, gatherInitialToSimValue } from '../../src/domain/dsl/evaluateGather'
import { boxValue } from '../../src/domain/engine/stepEngine'
import {
  applyToMapMerge,
  classifierKey,
  collectorAccumulate,
  createCollectorRuntime,
  evaluateToMapValue,
} from '../../src/domain/engine/collectorRuntime'
import {
  setCollectorBoundaryTap,
  setGatherEmissionTap,
} from '../../src/domain/engine/boundaryTap'
import { EngineInvariantError } from '../../src/domain/types/invariantError'
import { STANDARD_EMPLOYEES } from '../../src/domain/fixtures/employees'
import { MERGE_DEMO_EMPLOYEES } from '../../src/domain/fixtures/mergeDemoEmployees'
import { TYPE_EMPLOYEE } from '../../src/domain/types/typeRef'
import { makeCustomDefinition } from '../p3-helpers'
import { makeDefinition, runAllSnapshots } from '../helpers'
import { EXECUTABLE_TEMPLATES } from '../p6-helpers'
import {
  ProducerLedger,
  checkMeaningValue,
  classifyOperations,
  deriveProducers,
  expectedStateOf,
  isInvariantBlockedProducer,
  type Producer,
} from '../p11-nonnull-helpers'

/**
 * P11-D17: v0.14 §4 非null不変条件の**1層目（評価器単位の列挙評価）**と
 * **2層目（境界到達の実行検証）**。
 *
 * 1層目は互換入力型ごとの互換fixture値と組み合わせた全数走査、
 * 2層目(a)は全template × supported modeの実走査、
 * 2層目(b)は登録済み各producerの到達検証——boxed / scan / foldを含む各producerを
 * unmodifiable Collector境界まで到達させる。**window系は境界到達の対象外**であり、
 * gather放出点での全窓値検査と、collector accumulate経路への直接供給が
 * `EngineInvariantError`で遮断される負例の2点で検証する（完了状態は`INVARIANT_BLOCKED`）。
 */

const catalog = createDefaultCatalog()
const PRODUCERS = deriveProducers(catalog)
const ledger = new ProducerLedger()

/** 境界で捕捉した値をすべて検査する（テスト専用seamのタップ経由） */
function captureBoundary(run: () => void): number {
  let captured = 0
  setCollectorBoundaryTap((value, origin) => {
    captured += 1
    checkMeaningValue(value, `boundary(${origin})`)
  })
  try {
    run()
  } finally {
    setCollectorBoundaryTap(null)
  }
  return captured
}

/** gather放出点で捕捉した値をすべて検査する（合成List値の最終観測点） */
function captureGatherEmission(run: () => void): number {
  let captured = 0
  setGatherEmissionTap((value, kind) => {
    captured += 1
    checkMeaningValue(value, `gatherEmission(${kind})`)
  })
  try {
    run()
  } finally {
    setGatherEmissionTap(null)
  }
  return captured
}

afterEach(() => {
  setCollectorBoundaryTap(null)
  setGatherEmissionTap(null)
})

// ---- local Pipelineの組み立て ----

const SRC_NODE_ID = 'node-src'
const SINK_NODE_ID = 'node-sink'

interface LocalChainNode {
  readonly nodeId: string
  readonly operationId: string
  readonly slotId: string | null
  readonly dsl?: unknown
}

/**
 * 到達実行が実際にカバーした**検証対象operationId**の集合。
 *
 * 「分類（`OPERATION_CLASSIFICATION`）→ 展開（`Producer.operationId`）→ 到達実行」の3点が
 * 同じoperationIdで結ばれていることを、この集合と`valueProducing`の完全一致でassertする
 * （v0.14 §4-3）。前処理nodeのoperationIdはここへ入れない——入れてしまうと、検証対象nodeが
 * 固定値のままでも集合が成立してしまい、変更感知型の保証にならない。
 *
 * 記録は`runAllSnapshots()`が**成功した後**に行う（失敗したoperationIdを「実行済み」として
 * 残さない）。
 */
const executedTargetOperationIds = new Set<string>()

/**
 * producer単位の到達実行台帳（`producer.id → operationId / targetNodeId`）。
 * 集合一致だけではproducer単位の付け替え（別producerが同じoperationIdをカバーしている場合）を
 * 検出できないため、対応そのものを記録して照合する。
 */
const executedTargetsByProducer = new Map<string, { operationId: string; targetNodeId: string }>()

function markExecutedTarget(
  producerId: string,
  targetNodeId: string,
  targetOperationId: string,
): void {
  executedTargetOperationIds.add(targetOperationId)
  executedTargetsByProducer.set(producerId, {
    operationId: targetOperationId,
    targetNodeId,
  })
}

/**
 * producerを境界まで到達させるlocal Pipelineを組み立てて実行する。
 * 教材templateに存在しない経路（boxed / gather → Collector等）を補うための検証用。
 *
 * `targetNodeId` / `targetOperationId`は**そのproducerを体現するnode**を指し、
 * `targetOperationId`には必ず`producer.operationId`を渡す。組み立てに必要なだけの
 * 前処理node（boxing・field取得等）は`chain`側に固定値で置き、検証対象とは区別する。
 *
 * 構造assertは**`targetNodeId`でnodeを特定してから**そのnodeのoperationIdを照合する。
 * 「同じoperationIdを持つ任意のnode」で判定すると、前処理nodeのoperationIdが偶然一致した場合に
 * 検証対象nodeが別operationへ固定化されていても通過してしまう（例: numericSum gatherの
 * 前処理`node-boxed`=`boxed`と、検証対象`node-gather`=`gather`）。
 */
function runLocalPipeline(input: {
  readonly source: SourceDsl
  readonly sourceOperationId: string
  readonly dataset: readonly DatasetElementLike[]
  readonly chain: readonly LocalChainNode[]
  readonly collector: unknown
  readonly mode?: 'standard' | 'emptySource'
  /** 検証対象nodeのoperationId（producer.operationId）。省略時はsource nodeが検証対象 */
  readonly targetOperationId?: string
  /** 検証対象nodeのnodeId。省略時はsource node */
  readonly targetNodeId?: string
  /** 台帳へ記録するproducer ID（省略時は記録しない） */
  readonly producerId?: string
}): number {
  const nodes: PipelineTemplateNode[] = [
    { nodeId: SRC_NODE_ID, operationId: input.sourceOperationId, role: 'source', slotId: null },
    ...input.chain.map(
      (node): PipelineTemplateNode => ({
        nodeId: node.nodeId,
        operationId: node.operationId,
        role: 'intermediate',
        slotId: node.slotId,
      }),
    ),
    { nodeId: SINK_NODE_ID, operationId: OP_COLLECT, role: 'terminal', slotId: 'slot-collector' },
  ]
  const slots: ParameterSlot[] = []
  const dslParameters: Record<string, unknown> = { 'slot-collector': input.collector }
  for (const node of input.chain) {
    if (node.slotId === null) continue
    slots.push(localSlotFor(node))
    dslParameters[node.slotId] = node.dsl
  }
  slots.push({
    slotId: 'slot-collector',
    targetNodeId: SINK_NODE_ID,
    kind: 'collector',
    required: true,
    allowedCollectorKinds: ['toUnmodifiableList', 'toUnmodifiableSet', 'toUnmodifiableMap'],
  })
  const template: PipelineTemplate = {
    templateId: 'p11-nonnull-local',
    version: 1,
    targetOperationId: OP_COLLECT,
    targetNodeId: SINK_NODE_ID,
    title: 'p11-nonnull-local',
    sourceDefinition: {
      slotId: null,
      defaultDsl: input.source,
      allowedSourceKinds: [input.source.kind],
    },
    nodes,
    parameterSlots: slots,
    allowedDslProfile: { predicateKinds: [] },
    supportedModes: ['standard', 'emptySource'],
    jdkNotes: [],
    snapshotBudget: { limit: 500, estimatedMax: 400 },
  }
  // 検証対象nodeを**nodeIdで特定**し、そのnodeのoperationIdが検証対象operationIdと
  // 一致することを確認する。前処理nodeの一致では通過しない（偽陽性経路を塞ぐ）
  const targetOperationId = input.targetOperationId ?? input.sourceOperationId
  const targetNodeId = input.targetNodeId ?? SRC_NODE_ID
  const targetNode = nodes.find((node) => node.nodeId === targetNodeId)
  if (!targetNode) {
    throw new Error(
      `検証対象nodeがPipelineに存在しません: ${targetNodeId}（nodes=${nodes.map((n) => n.nodeId).join(', ')}）`,
    )
  }
  if (targetNode.operationId !== targetOperationId) {
    throw new Error(
      `検証対象node（${targetNodeId}）のoperationIdが検証対象operationIdと一致しません: ` +
        `node=${targetNode.operationId} / target=${targetOperationId}`,
    )
  }
  const definition = makeCustomDefinition(
    template,
    dslParameters,
    input.mode ?? 'standard',
    input.dataset as never,
    'p11-nonnull:r1',
  )
  const captured = captureBoundary(() => {
    runAllSnapshots(definition)
  })
  // 実行が成功した後にだけ台帳へ記録する
  if (input.producerId !== undefined) {
    markExecutedTarget(input.producerId, targetNodeId, targetOperationId)
  } else {
    executedTargetOperationIds.add(targetOperationId)
  }
  return captured
}

type DatasetElementLike = (typeof STANDARD_EMPLOYEES)[number]

function localSlotFor(node: LocalChainNode): ParameterSlot {
  const slotId = node.slotId!
  if (node.operationId === OP_LIMIT) {
    return { slotId, targetNodeId: node.nodeId, kind: 'count', required: true }
  }
  if (node.operationId === OP_GATHER) {
    return {
      slotId,
      targetNodeId: node.nodeId,
      kind: 'gatherer',
      required: true,
      allowedGathererKinds: [(node.dsl as { kind: string }).kind],
    }
  }
  return {
    slotId,
    targetNodeId: node.nodeId,
    kind: 'mapper',
    required: true,
    allowedMapperKinds: [(node.dsl as { kind: string }).kind],
  }
}

// ---- 1層目: 評価器単位の列挙評価（互換直積） ----

/** 互換入力型ごとの互換fixture要素・中間値（全DSL × 全fixtureの全直積は実行不能なため） */
const EMPLOYEE_VALUES: readonly SimValue[] = [...STANDARD_EMPLOYEES, ...MERGE_DEMO_EMPLOYEES].map(
  (e) => ({ kind: 'employee', value: e.value }),
)
const STRING_VALUES: readonly SimValue[] = ['佐藤', '関東', '', 'Java'].map((value) => ({
  kind: 'string',
  value,
}))
const PRIMITIVE_VALUES: Readonly<Record<string, readonly SimValue[]>> = {
  int: [
    { kind: 'int', value: 0 },
    { kind: 'int', value: 42 },
  ],
  long: [
    { kind: 'long', value: 0 },
    { kind: 'long', value: 5_000_000 },
  ],
  double: [
    { kind: 'double', value: 0 },
    { kind: 'double', value: 4.25 },
  ],
}
const BOXED_VALUES: Readonly<Record<string, readonly SimValue[]>> = {
  int: [{ kind: 'boxedInt', value: 7 }],
  long: [{ kind: 'boxedLong', value: 7 }],
  double: [{ kind: 'boxedDouble', value: 7.5 }],
}
const STRING_LIST_VALUES: readonly SimValue[] = [
  { kind: 'stringList', value: ['Java', 'SQL'] },
  { kind: 'stringList', value: [] },
]
const PRIMITIVE_ARRAY_VALUES: Readonly<Record<string, readonly SimValue[]>> = {
  int: [{ kind: 'intArray', value: [1, 2] }],
  long: [{ kind: 'longArray', value: [3, 4] }],
  double: [{ kind: 'doubleArray', value: [1.5] }],
}

describe('P11-D17 1層目: 評価器単位の列挙評価（§4-1）', () => {
  it('P11-D17: 全source producerの具現化値が非null / 非undefinedである', () => {
    const sources = PRODUCERS.filter((p) => p.family === 'source')
    expect(sources.length).toBeGreaterThan(0)
    for (const producer of sources) {
      const dsl = producer.dsl as SourceDsl
      if (producer.unbounded) {
        // 無限source（generate / iterate2）は単体では具現化できない既存契約
        // （UNBOUNDED_SOURCE）。値の検査はlimit付きの有効Pipelineで行う（2層目(b)）
        expect(() => materializeSource(dsl, [] as never), producer.id).toThrow(/UNBOUNDED_SOURCE/)
        continue
      }
      const materialized = materializeSource(dsl, (producer.dataset ?? []) as never)
      for (const [i, element] of materialized.elements.entries()) {
        checkMeaningValue(element.value, `${producer.id}[${i}]`)
      }
      if (producer.zeroEmission) {
        expect(materialized.elements, producer.id).toHaveLength(0)
      } else {
        expect(materialized.elements.length, producer.id).toBeGreaterThan(0)
      }
    }
  })

  it('P11-D17: 全mapper / flatMapper producerの評価結果が非nullである', () => {
    const mappers = PRODUCERS.filter((p) => p.family === 'mapper' || p.family === 'flatMapper')
    expect(mappers.length).toBeGreaterThan(0)
    for (const producer of mappers) {
      const dsl = producer.dsl as MapperDsl
      const inputs = compatibleInputsForMapper(dsl)
      expect(inputs.length, producer.id).toBeGreaterThan(0)
      for (const input of inputs) {
        if (producer.family === 'flatMapper') {
          const children = evaluateFlatMapper(dsl, input)
          children.forEach((child, i) => checkMeaningValue(child, `${producer.id}.child[${i}]`))
        } else {
          checkMeaningValue(evaluateMapper(dsl, input), producer.id)
        }
      }
    }
  })

  it('P11-D17: boxed producer（DSL外の値生成handler）の評価結果が非nullである', () => {
    const boxedProducers = PRODUCERS.filter((p) => p.family === 'boxed')
    expect(boxedProducers).toHaveLength(3)
    for (const producer of boxedProducers) {
      const primitive = (producer.dsl as { primitive: string }).primitive
      const inputs = PRIMITIVE_VALUES[primitive]
      expect(inputs, producer.id).toBeDefined()
      for (const input of inputs!) checkMeaningValue(boxValue(input), producer.id)
    }
  })

  it('P11-D17: 全gather producerの累積・初期値が非nullである', () => {
    const gathers = PRODUCERS.filter((p) => p.family === 'gather')
    expect(gathers.length).toBeGreaterThan(0)
    for (const producer of gathers) {
      const dsl = producer.dsl as GathererDsl
      if (dsl.kind === 'windowFixed' || dsl.kind === 'windowSliding') {
        // 窓は放出点で検査する（2層目(b)）。ここでは構成値の非nullのみ確認する
        expect(dsl.size, producer.id).toBeGreaterThan(0)
        continue
      }
      const initial = gatherInitialToSimValue(dsl.initial)
      checkMeaningValue(initial, `${producer.id}.initial`)
      for (const input of compatibleInputsForGather(dsl)) {
        checkMeaningValue(applyGatherAccumulation(dsl.accumulation, initial, input), producer.id)
      }
    }
  })

  it('P11-D17: collector内部評価器（classifier / valueMapper / merge）の結果が非nullである', () => {
    const classifiers = PRODUCERS.filter((p) => p.family === 'classifier')
    expect(classifiers.length).toBeGreaterThan(0)
    for (const producer of classifiers) {
      for (const employee of EMPLOYEE_VALUES) {
        const key = classifierKey(producer.dsl as ClassifierDsl, employee)
        checkMeaningValue(key.value, `${producer.id}.key`)
        expect(typeof key.ref, producer.id).toBe('string')
        expect(typeof key.label, producer.id).toBe('string')
      }
    }
    const valueMappers = PRODUCERS.filter((p) => p.family === 'toMapValue')
    expect(valueMappers.length).toBeGreaterThan(0)
    for (const producer of valueMappers) {
      for (const employee of EMPLOYEE_VALUES) {
        checkMeaningValue(
          evaluateToMapValue(producer.dsl as ToMapValueDsl, employee),
          producer.id,
        )
      }
    }
    const merges = PRODUCERS.filter((p) => p.family === 'merge')
    expect(merges).toHaveLength(6)
    for (const producer of merges) {
      const mergeId = (producer.dsl as { mergeId: ToMapMergeId }).mergeId
      for (const [existing, incoming] of compatibleMergeInputs(mergeId)) {
        checkMeaningValue(applyToMapMerge(mergeId, existing, incoming), producer.id)
      }
    }
  })
})

/** mapper DSLへ適用できる互換入力（型適合しない組合せは実行不能なため列挙しない） */
function compatibleInputsForMapper(dsl: MapperDsl): readonly SimValue[] {
  switch (dsl.kind) {
    case 'fieldAccess':
    case 'fieldToPrimitive':
      return EMPLOYEE_VALUES
    case 'toUpper':
      return STRING_VALUES
    case 'prefix':
      // prefixはprimitive入力にのみ適用できる（resolveMapperOutputType）
      return [...PRIMITIVE_VALUES['int']!, ...PRIMITIVE_VALUES['long']!, ...PRIMITIVE_VALUES['double']!]
    case 'listStream':
      return STRING_LIST_VALUES
    case 'arrayStream':
      return PRIMITIVE_ARRAY_VALUES[dsl.primitive] ?? []
  }
}

/** gather accumulationへ適用できる互換入力 */
function compatibleInputsForGather(dsl: GathererDsl): readonly SimValue[] {
  if (dsl.kind === 'windowFixed' || dsl.kind === 'windowSliding') return []
  switch (dsl.accumulation.kind) {
    case 'numericSum':
      return BOXED_VALUES[dsl.initial.type] ?? []
    case 'stringConcat':
      return STRING_VALUES
    case 'employeeFieldSum':
      return EMPLOYEE_VALUES
  }
}

/** mergeFunctionの値型制約（requiredValueWrapper）に適合する入力の組 */
function compatibleMergeInputs(mergeId: ToMapMergeId): readonly (readonly [SimValue, SimValue])[] {
  switch (mergeId) {
    case 'concat':
      return [[STRING_VALUES[0]!, STRING_VALUES[1]!]]
    case 'sumInt':
      return [[BOXED_VALUES['int']![0]!, BOXED_VALUES['int']![0]!]]
    case 'sumLong':
      return [[BOXED_VALUES['long']![0]!, BOXED_VALUES['long']![0]!]]
    case 'sumDouble':
      return [[BOXED_VALUES['double']![0]!, BOXED_VALUES['double']![0]!]]
    case 'first':
    case 'last':
      // 任意の同一型Uを受けるため、代表としてString / Employee / boxedを与える
      return [
        [STRING_VALUES[0]!, STRING_VALUES[1]!],
        [EMPLOYEE_VALUES[0]!, EMPLOYEE_VALUES[1]!],
        [BOXED_VALUES['int']![0]!, BOXED_VALUES['int']![0]!],
      ]
  }
}

// ---- 2層目(a): 全template × supported modeの実走査 ----

describe('P11-D17 2層目(a): 全template × modeの境界到達値（§4-2a）', () => {
  it('P11-D17: 全実行可能template × modeでcollector到達値と内部評価結果が非nullである', () => {
    let combos = 0
    let captured = 0
    for (const template of EXECUTABLE_TEMPLATES) {
      for (const mode of template.supportedModes) {
        combos += 1
        const definition = makeDefinition(template.templateId, mode)
        captured += captureBoundary(() => {
          runAllSnapshots(definition)
        })
      }
    }
    expect(combos).toBe(241)
    // collectorを持たないtemplateもあるため、到達値0件のケースは正常
    expect(captured).toBeGreaterThan(0)
  })
})

// ---- 2層目(b): producer別の境界到達検証 ----

describe('P11-D17 2層目(b): producer別の境界到達（§4-2b）', () => {
  it('P11-D17: 全source producerがunmodifiable Collector境界へ到達する（empty系は0件放出）', () => {
    for (const producer of PRODUCERS.filter((p) => p.family === 'source')) {
      const dsl = producer.dsl as SourceDsl
      const chain: LocalChainNode[] = []
      if (producer.unbounded) {
        chain.push({ nodeId: 'node-limit', operationId: OP_LIMIT, slotId: 'slot-count', dsl: 3 })
      }
      if (isPrimitiveElement(producer.elementType)) {
        chain.push({ nodeId: 'node-boxed', operationId: OP_BOXED, slotId: null })
      }
      const captured = runLocalPipeline({
        source: dsl,
        sourceOperationId: producer.operationId!,
        dataset: producer.dataset ?? [],
        chain,
        collector: { kind: 'toUnmodifiableList' },
        mode: producer.zeroEmission ? 'emptySource' : 'standard',
        // sourceが検証対象（node-src）
        targetNodeId: 'node-src',
        targetOperationId: producer.operationId!,
        producerId: producer.id,
      })
      if (producer.zeroEmission) {
        // 有効なPipelineで実行したが仕様どおり0件を放出した（非null契約への違反ではない）
        expect(captured, producer.id).toBe(0)
        ledger.mark(producer.id, 'ZERO_EMISSION')
      } else {
        expect(captured, producer.id).toBeGreaterThan(0)
        ledger.mark(producer.id, 'VALUE_REACHED')
      }
    }
  })

  it('P11-D17: 全mapper / flatMapper producerが境界へ到達する', () => {
    for (const producer of PRODUCERS.filter(
      (p) => p.family === 'mapper' || p.family === 'flatMapper',
    )) {
      const captured = runMapperPipeline(producer)
      expect(captured, producer.id).toBeGreaterThan(0)
      ledger.mark(producer.id, 'VALUE_REACHED')
    }
  })

  it('P11-D17: boxed producerが境界へ到達する（明示的に含める）', () => {
    for (const producer of PRODUCERS.filter((p) => p.family === 'boxed')) {
      const primitive = (producer.dsl as { primitive: 'int' | 'long' | 'double' }).primitive
      const captured = runLocalPipeline({
        source: { kind: 'arrayPrimitive', arrayId: 'nums', primitive, values: [1, 2] },
        sourceOperationId: 'source.arraysStream',
        dataset: [],
        chain: [
          { nodeId: 'node-boxed', operationId: producer.operationId!, slotId: null },
        ],
        collector: { kind: 'toUnmodifiableList' },
        targetNodeId: 'node-boxed',
        targetOperationId: producer.operationId!,
        producerId: producer.id,
      })
      expect(captured, producer.id).toBeGreaterThan(0)
      ledger.mark(producer.id, 'VALUE_REACHED')
    }
  })

  it('P11-D17: scan / fold producerが境界へ到達する（明示的に含める）', () => {
    for (const producer of PRODUCERS.filter(
      (p) => p.family === 'gather' && !isInvariantBlockedProducer(p),
    )) {
      const captured = runGatherPipeline(producer)
      expect(captured, producer.id).toBeGreaterThan(0)
      ledger.mark(producer.id, 'VALUE_REACHED')
    }
  })

  it('P11-D17: windowFixed / windowSliding producerはINVARIANT_BLOCKEDとして検証される', () => {
    // 合成List値は`assertNotCompositeList`によりCollectorへ構造的に到達できない
    // （Phase 7の教材不変条件。「gatherの下流はtoList / findFirstのみ」）。この構成は
    // Pipeline検証を通過し実行時にEngineInvariantErrorとなるため、事前拒否される
    // UNBOUNDED_SOURCE等とは区別する。境界到達ではなく次の2点で検証する（v0.14 §4-2b）:
    //   (1) gather放出点で放出された全窓値を再帰的に検査する
    //   (2) collector accumulate経路への直接供給がEngineInvariantErrorで遮断される
    for (const producer of PRODUCERS.filter(isInvariantBlockedProducer)) {
      const gatherer = producer.dsl as GathererDsl
      const targetOperationId = producer.operationId!
      const template = windowToListTemplate(gatherer, targetOperationId)
      const definition = makeCustomDefinition(
        template,
        {
          'slot-mapper-1': { kind: 'fieldAccess', field: 'name' },
          'slot-gatherer': gatherer,
        },
        'standard',
        STANDARD_EMPLOYEES as never,
        'p11-window:r1',
      )
      // 検証対象node（node-gather）のoperationIdが producer.operationId と一致することを
      // nodeIdで特定して確認する（前処理node-mapの一致では通過しない）
      const gatherNode = template.nodes.find((node) => node.nodeId === 'node-gather')
      expect(gatherNode, producer.id).toBeDefined()
      expect(gatherNode?.operationId, producer.id).toBe(targetOperationId)

      const emitted = captureGatherEmission(() => {
        runAllSnapshots(definition)
      })
      expect(emitted, producer.id).toBeGreaterThan(0)
      // 実行が成功した後に台帳へ記録する
      markExecutedTarget(producer.id, 'node-gather', targetOperationId)

      // 負例: 窓（合成List値）をcollector accumulate経路へ直接供給すると遮断される
      const runtime = createCollectorRuntime(
        'node-sink',
        { kind: 'object', name: 'String' },
        { kind: 'toUnmodifiableList' },
        null,
      )
      const windowValue: SimValue = {
        kind: 'list',
        elementType: { kind: 'object', name: 'String' },
        value: [{ kind: 'string', value: 'a' }],
      }
      expect(() =>
        collectorAccumulate(runtime, 'win-1', windowValue, () => {}),
        producer.id,
      ).toThrow(EngineInvariantError)

      // Collector境界へは到達していないため、VALUE_REACHEDではなくINVARIANT_BLOCKED
      ledger.mark(producer.id, 'INVARIANT_BLOCKED')
    }
  })

  it('P11-D17: collector内部producerが境界へ到達する', () => {
    for (const producer of PRODUCERS.filter((p) => p.family === 'classifier')) {
      const captured = runLocalPipeline({
        source: { kind: 'collection', collectionId: 'employees' },
        sourceOperationId: 'source.collectionStream',
        dataset: STANDARD_EMPLOYEES,
        chain: [],
        collector: {
          kind: 'toUnmodifiableMap',
          keyMapper: producer.dsl,
          valueMapper: { kind: 'fieldAccess', field: 'name' },
          mergeFunctionId: 'first',
        },
      })
      expect(captured, producer.id).toBeGreaterThan(0)
      ledger.mark(producer.id, 'VALUE_REACHED')
    }
    for (const producer of PRODUCERS.filter((p) => p.family === 'toMapValue')) {
      const captured = runLocalPipeline({
        source: { kind: 'collection', collectionId: 'employees' },
        sourceOperationId: 'source.collectionStream',
        dataset: STANDARD_EMPLOYEES,
        chain: [],
        collector: {
          kind: 'toUnmodifiableMap',
          keyMapper: { kind: 'employeeField', field: 'name' },
          valueMapper: producer.dsl,
          mergeFunctionId: null,
        },
      })
      expect(captured, producer.id).toBeGreaterThan(0)
      ledger.mark(producer.id, 'VALUE_REACHED')
    }
    for (const producer of PRODUCERS.filter((p) => p.family === 'merge')) {
      const mergeId = (producer.dsl as { mergeId: ToMapMergeId }).mergeId
      const captured = runLocalPipeline({
        source: { kind: 'collection', collectionId: 'employeesMergeDemo' },
        sourceOperationId: 'source.collectionStream',
        dataset: MERGE_DEMO_EMPLOYEES,
        chain: [],
        collector: {
          kind: 'toUnmodifiableMap',
          keyMapper: { kind: 'employeeField', field: 'region' },
          valueMapper: valueMapperForMerge(mergeId),
          mergeFunctionId: mergeId,
        },
      })
      expect(captured, producer.id).toBeGreaterThan(0)
      ledger.mark(producer.id, 'VALUE_REACHED')
    }
  })
})

// ---- 3層目の一部: producer完了状態（§4-3） ----

describe('P11-D17 producer完了状態（§4-3）', () => {
  it('P11-D17: 全producerがVALUE_REACHED / ZERO_EMISSION / INVARIANT_BLOCKEDで検証済みである（未実行・未分類0件）', () => {
    expect(ledger.missing(PRODUCERS)).toEqual([])
    expect(ledger.mismatched(PRODUCERS)).toEqual([])
    // 期待状態の対応表自体もassertする
    for (const producer of PRODUCERS) {
      const expected = expectedStateOf(producer)
      expect(ledger.stateOf(producer.id), producer.id).toBe(expected)
    }
    // 3状態すべてが実際に使われている（表が形骸化していないこと）
    const states = new Set(PRODUCERS.map((p) => ledger.stateOf(p.id)))
    expect([...states].sort()).toEqual(['INVARIANT_BLOCKED', 'VALUE_REACHED', 'ZERO_EMISSION'])
  })

  it('P11-D17: 分類・展開・到達実行が同じoperationIdで結ばれている', () => {
    // 「値生成として分類されたoperation」＝「producer展開がカバーしたoperation」は
    // deriveProducersが保証する。ここではさらに「到達実行が実際に走らせたoperation」まで
    // 一致することをassertし、展開だけ付け替えても実行は旧operationのまま、という
    // 乖離を検出する（v0.14 §4-3）
    const { valueProducing } = classifyOperations(catalog)
    expect([...executedTargetOperationIds].sort()).toEqual([...valueProducing].sort())
    // operation由来producerのカバー集合とも一致する
    const covered = [
      ...new Set(PRODUCERS.map((p) => p.operationId).filter((id): id is string => id !== null)),
    ]
    expect([...executedTargetOperationIds].sort()).toEqual(covered.sort())
    // 集合一致だけでは、別producerが同じoperationIdをカバーしている場合の
    // producer単位の付け替えを検出できない。producerごとの対応も照合する
    const operationDerived = PRODUCERS.filter((p) => p.operationId !== null)
    expect(
      operationDerived.filter((p) => !executedTargetsByProducer.has(p.id)).map((p) => p.id),
    ).toEqual([])
    const mismatched = operationDerived
      .filter((p) => executedTargetsByProducer.get(p.id)?.operationId !== p.operationId)
      .map(
        (p) =>
          `${p.id}: producer=${String(p.operationId)} executed=${String(
            executedTargetsByProducer.get(p.id)?.operationId,
          )}`,
      )
    expect(mismatched).toEqual([])
    // collector内部producerは到達実行の台帳を持たない（operationId: nullの区分）
    for (const producer of PRODUCERS.filter((p) => p.operationId === null)) {
      expect(executedTargetsByProducer.has(producer.id), producer.id).toBe(false)
    }
  })

  it('P11-D17: 前処理nodeと同じoperationIdでは構造assertを通過しない（偽陽性経路の遮断）', () => {
    // 検証対象nodeを「同じoperationIdを持つ任意のnode」で探すと、前処理nodeが偶然一致した場合に
    // 検証対象nodeが別operationへ固定化されていても通過してしまう。nodeIdで特定することで塞ぐ。

    // (1) numericSum相当: 前処理node-boxed=boxed / 検証対象node-gather=gather のまま
    //     targetOperationId=boxed を指定すると失敗する
    expect(() =>
      runLocalPipeline({
        source: { kind: 'arrayPrimitive', arrayId: 'nums', primitive: 'int', values: [1, 2, 3] },
        sourceOperationId: 'source.arraysStream',
        dataset: [],
        chain: [
          { nodeId: 'node-boxed', operationId: OP_BOXED, slotId: null },
          {
            nodeId: 'node-gather',
            operationId: OP_GATHER,
            slotId: 'slot-gatherer',
            dsl: {
              kind: 'scan',
              initial: { type: 'int', value: 0 },
              accumulation: { kind: 'numericSum' },
            },
          },
        ],
        collector: { kind: 'toUnmodifiableList' },
        targetNodeId: 'node-gather',
        targetOperationId: OP_BOXED,
      }),
    ).toThrow(/検証対象node（node-gather）のoperationIdが検証対象operationIdと一致しません/)

    // (2) listStream相当: 前処理node-map=map でも、検証対象node-flatと不一致なら失敗する
    expect(() =>
      runLocalPipeline({
        source: { kind: 'collection', collectionId: 'employees' },
        sourceOperationId: 'source.collectionStream',
        dataset: STANDARD_EMPLOYEES,
        chain: [
          {
            nodeId: 'node-map',
            operationId: OP_MAP,
            slotId: 'slot-mapper-1',
            dsl: { kind: 'fieldAccess', field: 'skills' },
          },
          {
            nodeId: 'node-flat',
            operationId: 'flatMap',
            slotId: 'slot-mapper-2',
            dsl: { kind: 'listStream' },
          },
        ],
        collector: { kind: 'toUnmodifiableList' },
        targetNodeId: 'node-flat',
        targetOperationId: OP_MAP,
      }),
    ).toThrow(/検証対象node（node-flat）のoperationIdが検証対象operationIdと一致しません/)

    // (3) 存在しないnodeIdを指定しても通過しない
    expect(() =>
      runLocalPipeline({
        source: { kind: 'collection', collectionId: 'employees' },
        sourceOperationId: 'source.collectionStream',
        dataset: STANDARD_EMPLOYEES,
        chain: [],
        collector: { kind: 'toUnmodifiableList' },
        targetNodeId: 'node-missing',
        targetOperationId: 'source.collectionStream',
      }),
    ).toThrow(/検証対象nodeがPipelineに存在しません/)
  })

  it('P11-D17: 実行に失敗したoperationIdは実行済み台帳へ記録されない', () => {
    const marker = 'p11-probe-not-executed'
    expect(executedTargetsByProducer.has(marker)).toBe(false)
    const before = new Set(executedTargetOperationIds)
    // 合成List値をcollectorへ渡す構成で失敗させる。この失敗はsnapshot予算の事前実行を行う
    // instantiate段階で送出されるため、記録が「definition構築より後・実行成功後」に
    // 置かれていることまで含めて検証できる（記録を前へ動かすとこのテストが落ちる）
    expect(() =>
      runLocalPipeline({
        source: { kind: 'collection', collectionId: 'employees' },
        sourceOperationId: 'source.collectionStream',
        dataset: STANDARD_EMPLOYEES,
        chain: [
          {
            nodeId: 'node-map',
            operationId: OP_MAP,
            slotId: 'slot-mapper-1',
            dsl: { kind: 'fieldAccess', field: 'name' },
          },
          {
            nodeId: 'node-gather',
            operationId: OP_GATHER,
            slotId: 'slot-gatherer',
            dsl: { kind: 'windowFixed', size: 2 },
          },
        ],
        collector: { kind: 'toUnmodifiableList' },
        targetNodeId: 'node-gather',
        targetOperationId: OP_GATHER,
        producerId: marker,
      }),
    ).toThrow(EngineInvariantError)
    // 記録はrunAllSnapshots成功後に行うため、失敗した実行は台帳へ残らない
    expect(executedTargetsByProducer.has(marker)).toBe(false)
    expect([...executedTargetOperationIds].sort()).toEqual([...before].sort())
  })

  it('P11-D17: producer.operationIdを付け替えると到達実行が失敗する（固定値への退行検出）', () => {
    // 検証対象nodeのoperationIdが`producer.operationId`から取られていなければ、
    // 架空operationへ付け替えてもpipelineは旧operationで成立してしまう。
    // 実際にはtemplate検証が未知operationを拒否するため、ここで失敗する
    const cases: readonly { producerId: string; run: (p: Producer) => number }[] = [
      { producerId: 'mapper.fieldAccess:name', run: runMapperPipeline },
      { producerId: 'mapper.fieldToPrimitive:age:int', run: runMapperPipeline },
      { producerId: 'mapper.listStream', run: runMapperPipeline },
      { producerId: 'mapper.arrayStream:int', run: runMapperPipeline },
      { producerId: 'gather.scan:numericSum:int', run: runGatherPipeline },
    ]
    for (const { producerId, run } of cases) {
      const producer = PRODUCERS.find((p) => p.id === producerId)
      expect(producer, producerId).toBeDefined()
      if (!producer) continue
      const tampered: Producer = { ...producer, operationId: 'virtual.valueProducing' }
      expect(() => run(tampered), producerId).toThrow()
    }
    // boxedも同様（到達検証がproducer.operationIdを使っていることの確認）
    const boxed = PRODUCERS.find((p) => p.id === 'boxed:int')!
    expect(() =>
      runLocalPipeline({
        source: { kind: 'arrayPrimitive', arrayId: 'nums', primitive: 'int', values: [1, 2] },
        sourceOperationId: 'source.arraysStream',
        dataset: [],
        chain: [{ nodeId: 'node-boxed', operationId: 'virtual.valueProducing', slotId: null }],
        collector: { kind: 'toUnmodifiableList' },
        targetOperationId: 'virtual.valueProducing',
      }),
    ).toThrow()
    expect(boxed.operationId).toBe('boxed')
  })
})

// ---- pipeline構築ヘルパー（未知familyはthrowする全域関数） ----

function isPrimitiveElement(type: TypeRef | undefined): boolean {
  return type?.kind === 'primitive'
}

/**
 * mapper producerを境界へ到達させるlocal Pipeline（未対応kindはthrow）。
 *
 * **検証対象nodeのoperationIdは必ず`producer.operationId`から取る**。
 * 固定値を使ってよいのは、そのDSLを適用可能にするための前処理node
 * （skills取得のmap・primitive stream化のためのboxed）だけである。
 */
function runMapperPipeline(producer: Producer): number {
  const dsl = producer.dsl as MapperDsl
  const targetOperationId = producer.operationId!
  switch (dsl.kind) {
    case 'fieldAccess':
      return runLocalPipeline({
        source: { kind: 'collection', collectionId: 'employees' },
        sourceOperationId: 'source.collectionStream',
        dataset: STANDARD_EMPLOYEES,
        chain: [{ nodeId: 'node-map', operationId: targetOperationId, slotId: 'slot-mapper-1', dsl }],
        collector: { kind: 'toUnmodifiableList' },
        targetNodeId: 'node-map',
        targetOperationId,
        producerId: producer.id,
      })
    case 'fieldToPrimitive':
      return runLocalPipeline({
        source: { kind: 'collection', collectionId: 'employees' },
        sourceOperationId: 'source.collectionStream',
        dataset: STANDARD_EMPLOYEES,
        chain: [
          {
            nodeId: 'node-map',
            operationId: targetOperationId,
            slotId: 'slot-mapper-1',
            dsl,
          },
          // 前処理: primitive streamをobject streamへ戻してcollectorへ渡す
          { nodeId: 'node-boxed', operationId: OP_BOXED, slotId: null },
        ],
        collector: { kind: 'toUnmodifiableList' },
        targetNodeId: 'node-map',
        targetOperationId,
        producerId: producer.id,
      })
    case 'toUpper':
      return runLocalPipeline({
        source: { kind: 'streamOf', elementTypeName: 'String', values: ['java', 'sql'] },
        sourceOperationId: 'source.streamOf',
        dataset: [],
        chain: [{ nodeId: 'node-map', operationId: targetOperationId, slotId: 'slot-mapper-1', dsl }],
        collector: { kind: 'toUnmodifiableList' },
        targetNodeId: 'node-map',
        targetOperationId,
        producerId: producer.id,
      })
    case 'prefix':
      return runLocalPipeline({
        source: { kind: 'range', from: 1, to: 4 },
        sourceOperationId: 'source.range',
        dataset: [],
        chain: [
          { nodeId: 'node-map', operationId: targetOperationId, slotId: 'slot-mapper-1', dsl },
        ],
        collector: { kind: 'toUnmodifiableList' },
        targetNodeId: 'node-map',
        targetOperationId,
        producerId: producer.id,
      })
    case 'listStream':
      return runLocalPipeline({
        source: { kind: 'collection', collectionId: 'employees' },
        sourceOperationId: 'source.collectionStream',
        dataset: STANDARD_EMPLOYEES,
        chain: [
          // 前処理: flatMapへ渡すList<String>（skills）を取り出す
          {
            nodeId: 'node-map',
            operationId: OP_MAP,
            slotId: 'slot-mapper-1',
            dsl: { kind: 'fieldAccess', field: 'skills' },
          },
          { nodeId: 'node-flat', operationId: targetOperationId, slotId: 'slot-mapper-2', dsl },
        ],
        collector: { kind: 'toUnmodifiableList' },
        targetNodeId: 'node-flat',
        targetOperationId,
        producerId: producer.id,
      })
    case 'arrayStream':
      return runLocalPipeline({
        source: {
          kind: 'streamOfPrimitiveArrays',
          primitive: dsl.primitive,
          arrays: [
            [1, 2],
            [3, 4],
          ],
        },
        sourceOperationId: 'source.streamOf',
        dataset: [],
        chain: [
          {
            nodeId: 'node-flat',
            operationId: targetOperationId,
            slotId: 'slot-mapper-1',
            dsl,
          },
          // 前処理: primitive streamをobject streamへ戻してcollectorへ渡す
          { nodeId: 'node-boxed', operationId: OP_BOXED, slotId: null },
        ],
        collector: { kind: 'toUnmodifiableList' },
        targetNodeId: 'node-flat',
        targetOperationId,
        producerId: producer.id,
      })
  }
}

/**
 * scan / fold producerを境界へ到達させるlocal Pipeline。
 * gather nodeのoperationIdは`producer.operationId`から取る（前処理のboxedのみ固定値）。
 */
function runGatherPipeline(producer: Producer): number {
  const gatherer = producer.dsl as Extract<GathererDsl, { kind: 'scan' | 'fold' }>
  const accumulation = gatherer.accumulation
  const targetOperationId = producer.operationId!
  if (accumulation.kind === 'employeeFieldSum') {
    return runLocalPipeline({
      source: { kind: 'collection', collectionId: 'employees' },
      sourceOperationId: 'source.collectionStream',
      dataset: STANDARD_EMPLOYEES,
      chain: [
        {
          nodeId: 'node-gather',
          operationId: targetOperationId,
          slotId: 'slot-gatherer',
          dsl: gatherer,
        },
      ],
      collector: { kind: 'toUnmodifiableList' },
      targetNodeId: 'node-gather',
      targetOperationId,
      producerId: producer.id,
    })
  }
  if (accumulation.kind === 'stringConcat') {
    return runLocalPipeline({
      source: { kind: 'streamOf', elementTypeName: 'String', values: ['a', 'b', 'c'] },
      sourceOperationId: 'source.streamOf',
      dataset: [],
      chain: [
        {
          nodeId: 'node-gather',
          operationId: targetOperationId,
          slotId: 'slot-gatherer',
          dsl: gatherer,
        },
      ],
      collector: { kind: 'toUnmodifiableList' },
      targetNodeId: 'node-gather',
      targetOperationId,
      producerId: producer.id,
    })
  }
  // numericSum: initial typeに適合するprimitive sourceをboxedして流す
  const primitive = gatherer.initial.type as 'int' | 'long' | 'double'
  return runLocalPipeline({
    source: { kind: 'arrayPrimitive', arrayId: 'nums', primitive, values: [1, 2, 3] },
    sourceOperationId: 'source.arraysStream',
    dataset: [],
    chain: [
      // 前処理: gatherの累積入力をboxed数値にする
      { nodeId: 'node-boxed', operationId: OP_BOXED, slotId: null },
      {
        nodeId: 'node-gather',
        operationId: targetOperationId,
        slotId: 'slot-gatherer',
        dsl: gatherer,
      },
    ],
    collector: { kind: 'toUnmodifiableList' },
    targetNodeId: 'node-gather',
    targetOperationId,
    producerId: producer.id,
  })
}

/**
 * window Gathererの放出を観測するためのlocal template（下流はtoList。v0.9 §8.4の許可範囲）。
 * gather nodeのoperationIdは`producer.operationId`から取る。
 */
function windowToListTemplate(gatherer: GathererDsl, targetOperationId: string): PipelineTemplate {
  return {
    templateId: 'p11-nonnull-window',
    version: 1,
    targetOperationId: OP_GATHER,
    targetNodeId: 'node-gather',
    title: 'p11-nonnull-window',
    sourceDefinition: {
      slotId: null,
      defaultDsl: { kind: 'collection', collectionId: 'employees' },
      allowedSourceKinds: ['collection'],
    },
    nodes: [
      { nodeId: SRC_NODE_ID, operationId: 'source.collectionStream', role: 'source', slotId: null },
      {
        nodeId: 'node-map',
        operationId: OP_MAP,
        role: 'intermediate',
        slotId: 'slot-mapper-1',
      },
      {
        nodeId: 'node-gather',
        operationId: targetOperationId,
        role: 'intermediate',
        slotId: 'slot-gatherer',
      },
      { nodeId: SINK_NODE_ID, operationId: OP_TO_LIST, role: 'terminal', slotId: null },
    ],
    parameterSlots: [
      {
        slotId: 'slot-mapper-1',
        targetNodeId: 'node-map',
        kind: 'mapper',
        required: true,
        allowedMapperKinds: ['fieldAccess'],
      },
      {
        slotId: 'slot-gatherer',
        targetNodeId: 'node-gather',
        kind: 'gatherer',
        required: true,
        allowedGathererKinds: [gatherer.kind],
      },
    ],
    allowedDslProfile: { predicateKinds: [] },
    supportedModes: ['standard'],
    jdkNotes: [],
    snapshotBudget: { limit: 500, estimatedMax: 400 },
  }
}

function valueMapperForMerge(mergeId: ToMapMergeId): ToMapValueDsl {
  switch (mergeId) {
    case 'sumInt':
      return { kind: 'fieldAccess', field: 'age' }
    case 'sumLong':
      return { kind: 'fieldAccess', field: 'salary' }
    case 'sumDouble':
      return { kind: 'fieldAccess', field: 'evaluation' }
    default:
      return { kind: 'fieldAccess', field: 'name' }
  }
}

void TYPE_EMPLOYEE
