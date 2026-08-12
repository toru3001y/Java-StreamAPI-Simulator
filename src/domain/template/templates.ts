import type { ParameterSlot, PipelineTemplate, PipelineTemplateNode } from './pipelineTemplate'
import { TemplateRegistry } from './templateRegistry'
import {
  OP_ALL_MATCH,
  OP_ANY_MATCH,
  OP_AVERAGE,
  OP_BOXED,
  OP_COUNT,
  OP_DISTINCT,
  OP_DROP_WHILE,
  OP_FILTER,
  OP_FIND_ANY,
  OP_FIND_FIRST,
  OP_FLAT_MAP,
  OP_FLAT_MAP_TO_DOUBLE,
  OP_FLAT_MAP_TO_INT,
  OP_FLAT_MAP_TO_LONG,
  OP_FOR_EACH,
  OP_FOR_EACH_ORDERED,
  OP_LIMIT,
  OP_MAP,
  OP_MAP_TO_DOUBLE,
  OP_MAP_TO_INT,
  OP_MAP_TO_LONG,
  OP_MAP_TO_OBJ,
  OP_MAX,
  OP_MIN,
  OP_NONE_MATCH,
  OP_PEEK,
  OP_REDUCE,
  OP_SKIP,
  OP_SORTED,
  OP_SOURCE_ARRAYS_STREAM,
  OP_SOURCE_COLLECTION_STREAM,
  OP_SOURCE_EMPTY,
  OP_SOURCE_GENERATE,
  OP_SOURCE_ITERATE2,
  OP_SOURCE_ITERATE3,
  OP_SOURCE_RANGE,
  OP_SOURCE_RANGE_CLOSED,
  OP_SOURCE_STREAM_OF,
  OP_SUM,
  OP_SUMMARY_STATISTICS,
  OP_TAKE_WHILE,
  OP_TO_ARRAY,
  OP_TO_LIST,
} from '../catalog/operations'
import { CONSUMER_ALLOWED_FIELDS } from '../dsl/consumerAst'
import { EMPLOYEE_COMPARATOR_FIELDS } from '../dsl/comparatorAst'
import { P5_TEMPLATES } from './templatesP5'
import { P7_TEMPLATES } from './templatesP7'

/**
 * Phase 2までの定義済み教材template（§8、Phase 2指示 §8）。
 * template ID、version、node ID、line IDは安定させる。
 * 1操作へ複数templateを登録できるRegistry構造を使用する。
 */

const PHASE3_LIMIT_REASON =
  '無限Streamのため、limit()を含まないこのtemplateは実行できません。limit付きtemplateを使用してください。'

function srcNode(operationId: string): PipelineTemplateNode {
  return { nodeId: 'node-src', operationId, role: 'source', slotId: 'slot-source' }
}

function sinkNode(): PipelineTemplateNode {
  return { nodeId: 'node-sink', operationId: OP_TO_LIST, role: 'terminal', slotId: null }
}

function mapperSlot(
  slotId: string,
  targetNodeId: string,
  allowedMapperKinds: readonly string[],
): ParameterSlot {
  return { slotId, targetNodeId, kind: 'mapper', required: true, allowedMapperKinds }
}

function sourceSlotDef(allowedSourceKinds: readonly string[]) {
  return { slotId: 'slot-source', defaultDsl: null, allowedSourceKinds }
}

// ---- Phase 1テンプレート（sourceは既定のemployees collection） ----

export const FILTER_BASIC_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-filter-basic',
  version: 1,
  targetOperationId: OP_FILTER,
  targetNodeId: 'node-filter-1',
  title: 'filterの基本（年齢での絞り込み）',
  sourceDefinition: {
    slotId: null,
    defaultDsl: { kind: 'collection', collectionId: 'employees' },
    allowedSourceKinds: ['collection'],
  },
  nodes: [
    { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
    { nodeId: 'node-filter-1', operationId: OP_FILTER, role: 'intermediate', slotId: 'slot-predicate-1' },
    sinkNode(),
  ],
  parameterSlots: [
    {
      slotId: 'slot-predicate-1',
      targetNodeId: 'node-filter-1',
      kind: 'predicate',
      required: true,
      allowedFields: ['age'],
      allowedOperators: ['GTE'],
    },
  ],
  allowedDslProfile: { predicateKinds: ['fieldCompare'] },
  supportedModes: ['standard', 'midEmpty', 'emptySource'],
  jdkNotes: ['filterは遅延評価であり、toList()の実行時に初めて要素が流れる。'],
  snapshotBudget: { limit: 500, estimatedMax: 30 },
}

export const FILTER_CHAIN_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-filter-chain',
  version: 1,
  targetOperationId: OP_FILTER,
  targetNodeId: 'node-filter-5',
  title: 'filterチェーン（横スクロール検証）',
  sourceDefinition: {
    slotId: null,
    defaultDsl: { kind: 'collection', collectionId: 'employees' },
    allowedSourceKinds: ['collection'],
  },
  nodes: [
    { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
    ...[1, 2, 3, 4, 5].map((n): PipelineTemplateNode => ({
      nodeId: `node-filter-${n}`,
      operationId: OP_FILTER,
      role: 'intermediate',
      slotId: `slot-predicate-${n}`,
    })),
    sinkNode(),
  ],
  parameterSlots: [1, 2, 3, 4, 5].map(
    (n): ParameterSlot => ({
      slotId: `slot-predicate-${n}`,
      targetNodeId: `node-filter-${n}`,
      kind: 'predicate',
      required: true,
      allowedFields: ['age'],
      allowedOperators: ['GTE'],
    }),
  ),
  allowedDslProfile: { predicateKinds: ['fieldCompare'] },
  supportedModes: ['standard'],
  jdkNotes: ['複数のfilterは記述順に適用され、前段を通過した要素だけが後段へ到達する。'],
  snapshotBudget: { limit: 500, estimatedMax: 60 },
}

// ---- Phase 2: Stream生成template（§8） ----

export const SRC_COLLECTION_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-src-collection',
  version: 1,
  targetOperationId: OP_SOURCE_COLLECTION_STREAM,
  targetNodeId: 'node-src',
  title: 'Collection.stream()（社員名の取り出し）',
  sourceDefinition: {
    slotId: null,
    defaultDsl: { kind: 'collection', collectionId: 'employees' },
    allowedSourceKinds: ['collection'],
  },
  nodes: [
    { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
    { nodeId: 'node-map', operationId: OP_MAP, role: 'intermediate', slotId: 'slot-mapper-1' },
    sinkNode(),
  ],
  parameterSlots: [mapperSlot('slot-mapper-1', 'node-map', ['fieldAccess'])],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard', 'emptySource'],
  jdkNotes: ['Collection.stream()はorderedに要素を送出する。'],
  snapshotBudget: { limit: 500, estimatedMax: 30 },
}

export const SRC_ARRAYS_OBJECT_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-src-arrays-object',
  version: 1,
  targetOperationId: OP_SOURCE_ARRAYS_STREAM,
  targetNodeId: 'node-src',
  title: 'Arrays.stream()（String配列）',
  sourceDefinition: sourceSlotDef(['arrayObject']),
  nodes: [
    srcNode(OP_SOURCE_ARRAYS_STREAM),
    { nodeId: 'node-map', operationId: OP_MAP, role: 'intermediate', slotId: 'slot-mapper-1' },
    sinkNode(),
  ],
  parameterSlots: [mapperSlot('slot-mapper-1', 'node-map', ['toUpper'])],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard', 'emptySource'],
  jdkNotes: ['Arrays.stream()はindex順に要素を送出する。'],
  snapshotBudget: { limit: 500, estimatedMax: 30 },
}

function arraysPrimitiveTemplate(templateId: string, title: string): PipelineTemplate {
  return {
    templateId,
    version: 1,
    targetOperationId: OP_SOURCE_ARRAYS_STREAM,
    targetNodeId: 'node-src',
    title,
    sourceDefinition: sourceSlotDef(['arrayPrimitive']),
    nodes: [
      srcNode(OP_SOURCE_ARRAYS_STREAM),
      { nodeId: 'node-boxed', operationId: OP_BOXED, role: 'intermediate', slotId: null },
      sinkNode(),
    ],
    parameterSlots: [],
    allowedDslProfile: { predicateKinds: [] },
    supportedModes: ['standard', 'emptySource'],
    jdkNotes: ['primitive配列のArrays.stream()はInt/Long/DoubleStreamを返す。'],
    snapshotBudget: { limit: 500, estimatedMax: 30 },
  }
}

export const SRC_ARRAYS_PRIMITIVE_TEMPLATE = arraysPrimitiveTemplate(
  'tmpl-src-arrays-int',
  'Arrays.stream()（int配列 → IntStream）',
)
export const SRC_ARRAYS_LONG_TEMPLATE = arraysPrimitiveTemplate(
  'tmpl-src-arrays-long',
  'Arrays.stream()（long配列 → LongStream）',
)
export const SRC_ARRAYS_DOUBLE_TEMPLATE = arraysPrimitiveTemplate(
  'tmpl-src-arrays-double',
  'Arrays.stream()（double配列 → DoubleStream）',
)

export const SRC_STREAM_OF_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-src-of',
  version: 1,
  targetOperationId: OP_SOURCE_STREAM_OF,
  targetNodeId: 'node-src',
  title: 'Stream.of()（引数の要素化）',
  sourceDefinition: sourceSlotDef(['streamOf']),
  nodes: [
    srcNode(OP_SOURCE_STREAM_OF),
    { nodeId: 'node-map', operationId: OP_MAP, role: 'intermediate', slotId: 'slot-mapper-1' },
    sinkNode(),
  ],
  parameterSlots: [mapperSlot('slot-mapper-1', 'node-map', ['toUpper'])],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard', 'emptySource'],
  jdkNotes: ['Stream.of()は引数値を記述順にStream要素化する。'],
  snapshotBudget: { limit: 500, estimatedMax: 30 },
}

export const SRC_ITERATE3_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-src-iterate3',
  version: 1,
  targetOperationId: OP_SOURCE_ITERATE3,
  targetNodeId: 'node-src',
  title: 'Stream.iterate(seed, predicate, operator)',
  sourceDefinition: sourceSlotDef(['iterate3']),
  nodes: [srcNode(OP_SOURCE_ITERATE3), sinkNode()],
  parameterSlots: [],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard', 'emptySource'],
  jdkNotes: ['生成候補をpredicateで判定し、falseになった時点で生成を終了する。'],
  snapshotBudget: { limit: 500, estimatedMax: 40 },
}

export const SRC_RANGE_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-src-range',
  version: 1,
  targetOperationId: OP_SOURCE_RANGE,
  targetNodeId: 'node-src',
  title: 'IntStream.range()（上端を含まない）',
  sourceDefinition: sourceSlotDef(['range']),
  nodes: [
    srcNode(OP_SOURCE_RANGE),
    { nodeId: 'node-boxed', operationId: OP_BOXED, role: 'intermediate', slotId: null },
    sinkNode(),
  ],
  parameterSlots: [],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard', 'emptySource'],
  jdkNotes: ['range(start, end)はstart <= n && n < endを満たすintを送出する。'],
  snapshotBudget: { limit: 500, estimatedMax: 30 },
}

export const SRC_RANGE_CLOSED_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-src-range-closed',
  version: 1,
  targetOperationId: OP_SOURCE_RANGE_CLOSED,
  targetNodeId: 'node-src',
  title: 'IntStream.rangeClosed()（上端を含む）',
  sourceDefinition: sourceSlotDef(['rangeClosed']),
  nodes: [
    srcNode(OP_SOURCE_RANGE_CLOSED),
    { nodeId: 'node-boxed', operationId: OP_BOXED, role: 'intermediate', slotId: null },
    sinkNode(),
  ],
  parameterSlots: [],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard', 'emptySource'],
  jdkNotes: ['rangeClosed(start, end)はstart <= n && n <= endを満たすintを送出する。'],
  snapshotBudget: { limit: 500, estimatedMax: 35 },
}

function emptyTemplate(
  templateId: string,
  title: string,
  withBoxed: boolean,
): PipelineTemplate {
  return {
    templateId,
    version: 1,
    targetOperationId: OP_SOURCE_EMPTY,
    targetNodeId: 'node-src',
    title,
    sourceDefinition: sourceSlotDef(['empty']),
    nodes: withBoxed
      ? [
          srcNode(OP_SOURCE_EMPTY),
          { nodeId: 'node-boxed', operationId: OP_BOXED, role: 'intermediate', slotId: null },
          sinkNode(),
        ]
      : [srcNode(OP_SOURCE_EMPTY), sinkNode()],
    parameterSlots: [],
    allowedDslProfile: { predicateKinds: [] },
    supportedModes: ['emptySource'],
    jdkNotes: ['空Streamは要素を送出せず、正しい型の空結果を返す。空はnullと同義ではない。'],
    snapshotBudget: { limit: 500, estimatedMax: 5 },
  }
}

export const SRC_EMPTY_OBJECT_TEMPLATE = emptyTemplate(
  'tmpl-src-empty-object',
  'Stream.empty()（object）',
  false,
)
export const SRC_EMPTY_INT_TEMPLATE = emptyTemplate(
  'tmpl-src-empty-int',
  'IntStream.empty()',
  true,
)
export const SRC_EMPTY_LONG_TEMPLATE = emptyTemplate(
  'tmpl-src-empty-long',
  'LongStream.empty()',
  true,
)
export const SRC_EMPTY_DOUBLE_TEMPLATE = emptyTemplate(
  'tmpl-src-empty-double',
  'DoubleStream.empty()',
  true,
)

/** generate / 2引数iterate: 表現・検証まで実装するが、Phase 2では実行不能（指示§6.1） */
export const SRC_GENERATE_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-src-generate',
  version: 1,
  targetOperationId: OP_SOURCE_GENERATE,
  targetNodeId: 'node-src',
  title: 'Stream.generate()（無限・unordered）',
  sourceDefinition: {
    slotId: 'slot-source',
    defaultDsl: { kind: 'generate', ruleId: 'supplier-counter' },
    allowedSourceKinds: ['generate'],
  },
  nodes: [srcNode(OP_SOURCE_GENERATE), sinkNode()],
  parameterSlots: [],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard'],
  jdkNotes: ['Stream.generate()は無限・unorderedなStreamを返す。'],
  snapshotBudget: { limit: 500, estimatedMax: 0 },
  executable: false,
  disabledReason: PHASE3_LIMIT_REASON,
}

export const SRC_ITERATE2_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-src-iterate2',
  version: 1,
  targetOperationId: OP_SOURCE_ITERATE2,
  targetNodeId: 'node-src',
  title: 'Stream.iterate(seed, operator)（無限）',
  sourceDefinition: {
    slotId: 'slot-source',
    defaultDsl: { kind: 'iterate2', seed: 1, operator: { ruleId: 'increment', step: 1 } },
    allowedSourceKinds: ['iterate2'],
  },
  nodes: [srcNode(OP_SOURCE_ITERATE2), sinkNode()],
  parameterSlots: [],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard'],
  jdkNotes: ['2引数iterateはseedへoperatorを繰り返し適用する無限Streamである。'],
  snapshotBudget: { limit: 500, estimatedMax: 0 },
  executable: false,
  disabledReason: PHASE3_LIMIT_REASON,
}

// ---- Phase 2: 中間操作template（§8） ----

export const MAP_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-map',
  version: 1,
  targetOperationId: OP_MAP,
  targetNodeId: 'node-map',
  title: 'map（Employee → 名前のString）',
  sourceDefinition: {
    slotId: null,
    defaultDsl: { kind: 'collection', collectionId: 'employees' },
    allowedSourceKinds: ['collection'],
  },
  nodes: [
    { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
    { nodeId: 'node-map', operationId: OP_MAP, role: 'intermediate', slotId: 'slot-mapper-1' },
    sinkNode(),
  ],
  parameterSlots: [mapperSlot('slot-mapper-1', 'node-map', ['fieldAccess'])],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard', 'emptySource'],
  jdkNotes: ['mapは各要素を1対1変換し、要素数は変わらない。'],
  snapshotBudget: { limit: 500, estimatedMax: 30 },
}

export const MAP_MID_EMPTY_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-map-midempty',
  version: 1,
  targetOperationId: OP_MAP,
  targetNodeId: 'node-map',
  title: 'map（途中0件: filter併用）',
  sourceDefinition: {
    slotId: null,
    defaultDsl: { kind: 'collection', collectionId: 'employees' },
    allowedSourceKinds: ['collection'],
  },
  nodes: [
    { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
    { nodeId: 'node-filter-1', operationId: OP_FILTER, role: 'intermediate', slotId: 'slot-predicate-1' },
    { nodeId: 'node-map', operationId: OP_MAP, role: 'intermediate', slotId: 'slot-mapper-1' },
    sinkNode(),
  ],
  parameterSlots: [
    {
      slotId: 'slot-predicate-1',
      targetNodeId: 'node-filter-1',
      kind: 'predicate',
      required: true,
      allowedFields: ['age'],
      allowedOperators: ['GTE'],
    },
    mapperSlot('slot-mapper-1', 'node-map', ['fieldAccess']),
  ],
  allowedDslProfile: { predicateKinds: ['fieldCompare'] },
  supportedModes: ['midEmpty'],
  jdkNotes: ['前段のfilterで全件除外されると、mapは一度も適用されない。'],
  snapshotBudget: { limit: 500, estimatedMax: 25 },
}

function mapToPrimitiveTemplate(
  templateId: string,
  operationId: string,
  title: string,
  jdkNote: string,
): PipelineTemplate {
  return {
    templateId,
    version: 1,
    targetOperationId: operationId,
    targetNodeId: 'node-mapto',
    title,
    sourceDefinition: {
      slotId: null,
      defaultDsl: { kind: 'collection', collectionId: 'employees' },
      allowedSourceKinds: ['collection'],
    },
    nodes: [
      { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
      { nodeId: 'node-mapto', operationId: operationId, role: 'intermediate', slotId: 'slot-mapper-1' },
      { nodeId: 'node-boxed', operationId: OP_BOXED, role: 'intermediate', slotId: null },
      sinkNode(),
    ],
    parameterSlots: [mapperSlot('slot-mapper-1', 'node-mapto', ['fieldToPrimitive'])],
    allowedDslProfile: { predicateKinds: [] },
    supportedModes: ['standard', 'emptySource'],
    jdkNotes: [jdkNote],
    snapshotBudget: { limit: 500, estimatedMax: 40 },
  }
}

export const MAP_TO_INT_TEMPLATE = mapToPrimitiveTemplate(
  'tmpl-maptoint',
  OP_MAP_TO_INT,
  'mapToInt（Employee.age → IntStream）',
  'mapToIntはStream<T>をIntStreamへ変換する。',
)
export const MAP_TO_LONG_TEMPLATE = mapToPrimitiveTemplate(
  'tmpl-maptolong',
  OP_MAP_TO_LONG,
  'mapToLong（Employee.salary → LongStream）',
  'mapToLongはStream<T>をLongStreamへ変換する。',
)
export const MAP_TO_DOUBLE_TEMPLATE = mapToPrimitiveTemplate(
  'tmpl-maptodouble',
  OP_MAP_TO_DOUBLE,
  'mapToDouble（Employee.evaluation → DoubleStream）',
  'mapToDoubleはStream<T>をDoubleStreamへ変換する。',
)

export const BOXED_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-boxed',
  version: 1,
  targetOperationId: OP_BOXED,
  targetNodeId: 'node-boxed',
  title: 'boxed（int → Integer）',
  sourceDefinition: sourceSlotDef(['range']),
  nodes: [
    srcNode(OP_SOURCE_RANGE),
    { nodeId: 'node-boxed', operationId: OP_BOXED, role: 'intermediate', slotId: null },
    sinkNode(),
  ],
  parameterSlots: [],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard', 'emptySource'],
  jdkNotes: ['boxedはprimitive値を対応するwrapperへboxingし、object Streamを返す。'],
  snapshotBudget: { limit: 500, estimatedMax: 25 },
}

export const MAP_TO_OBJ_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-maptoobj',
  version: 1,
  targetOperationId: OP_MAP_TO_OBJ,
  targetNodeId: 'node-maptoobj',
  title: 'mapToObj（int → 任意のString）',
  sourceDefinition: sourceSlotDef(['range']),
  nodes: [
    srcNode(OP_SOURCE_RANGE),
    { nodeId: 'node-maptoobj', operationId: OP_MAP_TO_OBJ, role: 'intermediate', slotId: 'slot-mapper-1' },
    sinkNode(),
  ],
  parameterSlots: [mapperSlot('slot-mapper-1', 'node-maptoobj', ['prefix'])],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard', 'emptySource'],
  jdkNotes: ['mapToObjはmapperで任意のobjectへ変換する。boxed（wrapperへのboxing）とは異なる。'],
  snapshotBudget: { limit: 500, estimatedMax: 25 },
}

export const FLAT_MAP_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-flatmap',
  version: 1,
  targetOperationId: OP_FLAT_MAP,
  targetNodeId: 'node-flatmap',
  title: 'flatMap（List<List<String>>の平坦化）',
  sourceDefinition: sourceSlotDef(['nestedStringList']),
  nodes: [
    srcNode(OP_SOURCE_COLLECTION_STREAM),
    { nodeId: 'node-flatmap', operationId: OP_FLAT_MAP, role: 'intermediate', slotId: 'slot-mapper-1' },
    sinkNode(),
  ],
  parameterSlots: [mapperSlot('slot-mapper-1', 'node-flatmap', ['listStream'])],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard', 'midEmpty', 'emptySource'],
  jdkNotes: ['flatMapは各親要素からmapped Streamを生成し、子要素をencounter orderでflattenする。'],
  snapshotBudget: { limit: 500, estimatedMax: 40 },
}

function flatMapToPrimitiveTemplate(
  templateId: string,
  operationId: string,
  title: string,
): PipelineTemplate {
  return {
    templateId,
    version: 1,
    targetOperationId: operationId,
    targetNodeId: 'node-flatmap',
    title,
    sourceDefinition: sourceSlotDef(['streamOfPrimitiveArrays']),
    nodes: [
      srcNode(OP_SOURCE_STREAM_OF),
      { nodeId: 'node-flatmap', operationId, role: 'intermediate', slotId: 'slot-mapper-1' },
      { nodeId: 'node-boxed', operationId: OP_BOXED, role: 'intermediate', slotId: null },
      sinkNode(),
    ],
    parameterSlots: [mapperSlot('slot-mapper-1', 'node-flatmap', ['arrayStream'])],
    allowedDslProfile: { predicateKinds: [] },
    supportedModes: ['standard', 'emptySource'],
    jdkNotes: ['primitive配列の子要素は対応するprimitive Streamとしてflattenされる。'],
    snapshotBudget: { limit: 500, estimatedMax: 45 },
  }
}

export const FLAT_MAP_TO_INT_TEMPLATE = flatMapToPrimitiveTemplate(
  'tmpl-flatmap-int',
  OP_FLAT_MAP_TO_INT,
  'flatMapToInt（int[] → IntStream）',
)
export const FLAT_MAP_TO_LONG_TEMPLATE = flatMapToPrimitiveTemplate(
  'tmpl-flatmap-long',
  OP_FLAT_MAP_TO_LONG,
  'flatMapToLong（long[] → LongStream）',
)
export const FLAT_MAP_TO_DOUBLE_TEMPLATE = flatMapToPrimitiveTemplate(
  'tmpl-flatmap-double',
  OP_FLAT_MAP_TO_DOUBLE,
  'flatMapToDouble（double[] → DoubleStream）',
)

// ---- Phase 3: stateful中間操作template（Phase 3指示 §9） ----

const agePredicateSlot: ParameterSlot = {
  slotId: 'slot-predicate-1',
  targetNodeId: 'node-filter-1',
  kind: 'predicate',
  required: true,
  allowedFields: ['age'],
  allowedOperators: ['GTE'],
}

function currentValueSlot(targetNodeId: string): ParameterSlot {
  return {
    slotId: 'slot-predicate-1',
    targetNodeId,
    kind: 'predicate',
    required: true,
    allowedFields: [],
    allowedOperators: ['LT'],
  }
}

function countSlot(targetNodeId: string): ParameterSlot {
  return { slotId: 'slot-count', targetNodeId, kind: 'count', required: true }
}

export const DISTINCT_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-distinct',
  version: 1,
  targetOperationId: OP_DISTINCT,
  targetNodeId: 'node-distinct',
  title: 'distinct（重複の除外）',
  sourceDefinition: sourceSlotDef(['streamOf']),
  nodes: [
    srcNode(OP_SOURCE_STREAM_OF),
    { nodeId: 'node-distinct', operationId: OP_DISTINCT, role: 'intermediate', slotId: null },
    sinkNode(),
  ],
  parameterSlots: [],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard', 'emptySource'],
  jdkNotes: [
    'distinctはequalsに基づき重複を除外する。ordered Streamでは最初の要素が保持される。',
  ],
  snapshotBudget: { limit: 500, estimatedMax: 40 },
}

export const DISTINCT_MID_EMPTY_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-distinct-midempty',
  version: 1,
  targetOperationId: OP_DISTINCT,
  targetNodeId: 'node-distinct',
  title: 'distinct（途中0件: filter併用）',
  sourceDefinition: {
    slotId: null,
    defaultDsl: { kind: 'collection', collectionId: 'employees' },
    allowedSourceKinds: ['collection'],
  },
  nodes: [
    { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
    { nodeId: 'node-filter-1', operationId: OP_FILTER, role: 'intermediate', slotId: 'slot-predicate-1' },
    { nodeId: 'node-distinct', operationId: OP_DISTINCT, role: 'intermediate', slotId: null },
    sinkNode(),
  ],
  parameterSlots: [agePredicateSlot],
  allowedDslProfile: { predicateKinds: ['fieldCompare'] },
  supportedModes: ['midEmpty'],
  jdkNotes: ['前段のfilterで全件除外されると、distinctのseenは一度も更新されない。'],
  snapshotBudget: { limit: 500, estimatedMax: 25 },
}

export const SORTED_NATURAL_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-sorted-natural',
  version: 1,
  targetOperationId: OP_SORTED,
  targetNodeId: 'node-sorted',
  title: 'sorted()（Stringの自然順序）',
  sourceDefinition: sourceSlotDef(['streamOf']),
  nodes: [
    srcNode(OP_SOURCE_STREAM_OF),
    { nodeId: 'node-sorted', operationId: OP_SORTED, role: 'intermediate', slotId: null },
    sinkNode(),
  ],
  parameterSlots: [],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard', 'emptySource'],
  jdkNotes: [
    'sortedは全入力をbufferしてから並べ替える。ordered Streamのsortはstableである。',
  ],
  snapshotBudget: { limit: 500, estimatedMax: 40 },
}

export const SORTED_MID_EMPTY_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-sorted-midempty',
  version: 1,
  targetOperationId: OP_SORTED,
  targetNodeId: 'node-sorted',
  title: 'sorted（途中0件: filter併用・空buffer）',
  sourceDefinition: {
    slotId: null,
    defaultDsl: { kind: 'collection', collectionId: 'employees' },
    allowedSourceKinds: ['collection'],
  },
  nodes: [
    { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
    { nodeId: 'node-filter-1', operationId: OP_FILTER, role: 'intermediate', slotId: 'slot-predicate-1' },
    { nodeId: 'node-map', operationId: OP_MAP, role: 'intermediate', slotId: 'slot-mapper-1' },
    { nodeId: 'node-sorted', operationId: OP_SORTED, role: 'intermediate', slotId: null },
    sinkNode(),
  ],
  parameterSlots: [agePredicateSlot, mapperSlot('slot-mapper-1', 'node-map', ['fieldAccess'])],
  allowedDslProfile: { predicateKinds: ['fieldCompare'] },
  supportedModes: ['midEmpty'],
  jdkNotes: ['前段が0件でも、sortedは空bufferの並べ替え確定を1回行う。'],
  snapshotBudget: { limit: 500, estimatedMax: 25 },
}

export const SORTED_COMPARATOR_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-sorted-comparator',
  version: 1,
  targetOperationId: OP_SORTED,
  targetNodeId: 'node-sorted',
  title: 'sorted(Comparator)（Employeeのregion昇順）',
  sourceDefinition: {
    slotId: null,
    defaultDsl: { kind: 'collection', collectionId: 'employees' },
    allowedSourceKinds: ['collection'],
  },
  nodes: [
    { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
    { nodeId: 'node-sorted', operationId: OP_SORTED, role: 'intermediate', slotId: 'slot-comparator' },
    sinkNode(),
  ],
  parameterSlots: [
    {
      slotId: 'slot-comparator',
      targetNodeId: 'node-sorted',
      kind: 'comparator',
      required: true,
      allowedComparatorKinds: ['employeeKeys'],
      allowedFields: EMPLOYEE_COMPARATOR_FIELDS,
    },
  ],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard', 'emptySource'],
  jdkNotes: [
    'sorted(Comparator)は指定キーで並べ替える。ordered Streamでは同値キーの要素は元の順序を維持する（stable）。',
  ],
  snapshotBudget: { limit: 500, estimatedMax: 40 },
}

export const LIMIT_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-limit',
  version: 1,
  targetOperationId: OP_LIMIT,
  targetNodeId: 'node-limit',
  title: 'limit（有限source・最初のN件）',
  sourceDefinition: sourceSlotDef(['rangeClosed']),
  nodes: [
    srcNode(OP_SOURCE_RANGE_CLOSED),
    { nodeId: 'node-limit', operationId: OP_LIMIT, role: 'intermediate', slotId: 'slot-count' },
    { nodeId: 'node-boxed', operationId: OP_BOXED, role: 'intermediate', slotId: null },
    sinkNode(),
  ],
  parameterSlots: [countSlot('node-limit')],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard', 'midEmpty', 'emptySource'],
  jdkNotes: [
    'limitは最初のmaxSize件だけを通す。上限到達後の残り要素は評価されない（未評価のまま）。',
  ],
  snapshotBudget: { limit: 500, estimatedMax: 35 },
}

export const LIMIT_GENERATE_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-limit-generate',
  version: 1,
  targetOperationId: OP_SOURCE_GENERATE,
  targetNodeId: 'node-src',
  title: 'Stream.generate() + limit（無限sourceの有限化）',
  sourceDefinition: {
    slotId: 'slot-source',
    defaultDsl: { kind: 'generate', ruleId: 'supplier-counter' },
    allowedSourceKinds: ['generate'],
  },
  nodes: [
    srcNode(OP_SOURCE_GENERATE),
    { nodeId: 'node-limit', operationId: OP_LIMIT, role: 'intermediate', slotId: 'slot-count' },
    sinkNode(),
  ],
  parameterSlots: [countSlot('node-limit')],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard'],
  jdkNotes: [
    'Stream.generate()のsource自体は無限・unorderedのままであり、limitがPipelineを有限化している。',
    'supplierは有限化に必要な回数だけ呼び出される。',
  ],
  snapshotBudget: { limit: 500, estimatedMax: 20 },
}

export const LIMIT_ITERATE2_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-limit-iterate2',
  version: 1,
  targetOperationId: OP_SOURCE_ITERATE2,
  targetNodeId: 'node-src',
  title: 'Stream.iterate(seed, operator) + limit（無限sourceの有限化）',
  sourceDefinition: {
    slotId: 'slot-source',
    defaultDsl: { kind: 'iterate2', seed: 1, operator: { ruleId: 'increment', step: 1 } },
    allowedSourceKinds: ['iterate2'],
  },
  nodes: [
    srcNode(OP_SOURCE_ITERATE2),
    { nodeId: 'node-limit', operationId: OP_LIMIT, role: 'intermediate', slotId: 'slot-count' },
    sinkNode(),
  ],
  parameterSlots: [countSlot('node-limit')],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard'],
  jdkNotes: [
    '2引数iterateのsource自体は無限のままであり、limitがPipelineを有限化している。',
    'operatorは有限化に必要な範囲だけ適用される。',
  ],
  snapshotBudget: { limit: 500, estimatedMax: 30 },
}

export const SKIP_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-skip',
  version: 1,
  targetOperationId: OP_SKIP,
  targetNodeId: 'node-skip',
  title: 'skip（最初のn件の除外）',
  sourceDefinition: sourceSlotDef(['arrayPrimitive']),
  nodes: [
    srcNode(OP_SOURCE_ARRAYS_STREAM),
    { nodeId: 'node-skip', operationId: OP_SKIP, role: 'intermediate', slotId: 'slot-count' },
    { nodeId: 'node-boxed', operationId: OP_BOXED, role: 'intermediate', slotId: null },
    sinkNode(),
  ],
  parameterSlots: [countSlot('node-skip')],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard', 'midEmpty', 'emptySource'],
  jdkNotes: [
    'skipは最初のn件を除外し、その後の要素を判定なしで通す。skip自体は短絡終了しない。',
  ],
  snapshotBudget: { limit: 500, estimatedMax: 35 },
}

export const TAKE_WHILE_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-takewhile',
  version: 1,
  targetOperationId: OP_TAKE_WHILE,
  targetNodeId: 'node-takewhile',
  title: 'takeWhile（trueのprefixと短絡）',
  sourceDefinition: sourceSlotDef(['arrayPrimitive']),
  nodes: [
    srcNode(OP_SOURCE_ARRAYS_STREAM),
    { nodeId: 'node-takewhile', operationId: OP_TAKE_WHILE, role: 'intermediate', slotId: 'slot-predicate-1' },
    { nodeId: 'node-boxed', operationId: OP_BOXED, role: 'intermediate', slotId: null },
    sinkNode(),
  ],
  parameterSlots: [currentValueSlot('node-takewhile')],
  allowedDslProfile: { predicateKinds: ['currentValueCompare'] },
  supportedModes: ['standard', 'midEmpty', 'emptySource'],
  jdkNotes: [
    '初版実行はsequential + orderedに限定する。unorderedの意味論は補助説明のみ。',
    '最初のfalseで短絡し、後続はPredicateならtrueとなる値でも評価されない。',
  ],
  snapshotBudget: { limit: 500, estimatedMax: 35 },
}

export const DROP_WHILE_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-dropwhile',
  version: 1,
  targetOperationId: OP_DROP_WHILE,
  targetNodeId: 'node-dropwhile',
  title: 'dropWhile（trueのprefix除外と通過モード）',
  sourceDefinition: sourceSlotDef(['arrayPrimitive']),
  nodes: [
    srcNode(OP_SOURCE_ARRAYS_STREAM),
    { nodeId: 'node-dropwhile', operationId: OP_DROP_WHILE, role: 'intermediate', slotId: 'slot-predicate-1' },
    { nodeId: 'node-boxed', operationId: OP_BOXED, role: 'intermediate', slotId: null },
    sinkNode(),
  ],
  parameterSlots: [currentValueSlot('node-dropwhile')],
  allowedDslProfile: { predicateKinds: ['currentValueCompare'] },
  supportedModes: ['standard', 'midEmpty', 'emptySource'],
  jdkNotes: [
    '初版実行はsequential + orderedに限定する。',
    '最初のfalse以降は通過モードとなり、Predicateを再評価しない。',
  ],
  snapshotBudget: { limit: 500, estimatedMax: 40 },
}

export const PEEK_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-peek',
  version: 1,
  targetOperationId: OP_PEEK,
  targetNodeId: 'node-peek',
  title: 'peek（Side Effectの観察）',
  sourceDefinition: {
    slotId: null,
    defaultDsl: { kind: 'collection', collectionId: 'employees' },
    allowedSourceKinds: ['collection'],
  },
  nodes: [
    { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
    { nodeId: 'node-peek', operationId: OP_PEEK, role: 'intermediate', slotId: 'slot-consumer' },
    sinkNode(),
  ],
  parameterSlots: [
    {
      slotId: 'slot-consumer',
      targetNodeId: 'node-peek',
      kind: 'consumer',
      required: true,
      allowedConsumerKinds: ['printValue', 'printField'],
      allowedFields: CONSUMER_ALLOWED_FIELDS,
    },
  ],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard', 'emptySource'],
  jdkNotes: [
    'peekは値・型を変更せず、Consumer実行の履歴だけをSide Effectビューへ残す。',
    'JDKでは最適化や短絡により、peekのactionが呼ばれない要素があり得る。',
  ],
  snapshotBudget: { limit: 500, estimatedMax: 30 },
}

export const PEEK_MID_EMPTY_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-peek-midempty',
  version: 1,
  targetOperationId: OP_PEEK,
  targetNodeId: 'node-peek',
  title: 'peek（途中0件: Consumer呼出し0回）',
  sourceDefinition: {
    slotId: null,
    defaultDsl: { kind: 'collection', collectionId: 'employees' },
    allowedSourceKinds: ['collection'],
  },
  nodes: [
    { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
    { nodeId: 'node-filter-1', operationId: OP_FILTER, role: 'intermediate', slotId: 'slot-predicate-1' },
    { nodeId: 'node-peek', operationId: OP_PEEK, role: 'intermediate', slotId: 'slot-consumer' },
    sinkNode(),
  ],
  parameterSlots: [
    agePredicateSlot,
    {
      slotId: 'slot-consumer',
      targetNodeId: 'node-peek',
      kind: 'consumer',
      required: true,
      allowedConsumerKinds: ['printValue', 'printField'],
      allowedFields: CONSUMER_ALLOWED_FIELDS,
    },
  ],
  allowedDslProfile: { predicateKinds: ['fieldCompare'] },
  supportedModes: ['midEmpty'],
  jdkNotes: ['前段のfilterで全件除外されると、peekのConsumerは一度も呼ばれない。'],
  snapshotBudget: { limit: 500, estimatedMax: 25 },
}

// ---- Phase 4: 終端操作template（Phase 4指示 §11） ----

/** terminalノード（Phase 4）。nodeIdはtoListと同じ'node-sink'で安定させる */
function termNode(operationId: string, slotId: string | null = null) {
  return { nodeId: 'node-sink', operationId, role: 'terminal' as const, slotId }
}

const employeeSource = {
  slotId: null,
  defaultDsl: { kind: 'collection', collectionId: 'employees' } as const,
  allowedSourceKinds: ['collection'],
}

function p4Template(
  templateId: string,
  targetOperationId: string,
  title: string,
  sourceDefinition: PipelineTemplate['sourceDefinition'],
  nodes: PipelineTemplate['nodes'],
  parameterSlots: PipelineTemplate['parameterSlots'],
  supportedModes: PipelineTemplate['supportedModes'],
  jdkNotes: readonly string[],
  predicateKinds: readonly string[] = [],
): PipelineTemplate {
  return {
    templateId,
    version: 1,
    targetOperationId,
    targetNodeId: 'node-sink',
    title,
    sourceDefinition,
    nodes,
    parameterSlots,
    allowedDslProfile: { predicateKinds },
    supportedModes,
    jdkNotes,
    snapshotBudget: { limit: 500, estimatedMax: 40 },
  }
}

const reductionSlot = (kinds: readonly string[]): ParameterSlot => ({
  slotId: 'slot-reduction',
  targetNodeId: 'node-sink',
  kind: 'reduction',
  required: true,
  allowedReductionKinds: kinds,
})

const identitySlot: ParameterSlot = {
  slotId: 'slot-identity',
  targetNodeId: 'node-sink',
  kind: 'identity',
  required: true,
}

const terminalComparatorSlot: ParameterSlot = {
  slotId: 'slot-comparator',
  targetNodeId: 'node-sink',
  kind: 'comparator',
  required: true,
  allowedComparatorKinds: ['employeeKeys'],
  allowedFields: EMPLOYEE_COMPARATOR_FIELDS,
}

const matchPredicateSlot: ParameterSlot = {
  slotId: 'slot-predicate-1',
  targetNodeId: 'node-sink',
  kind: 'predicate',
  required: true,
  allowedFields: ['age'],
  allowedOperators: ['GTE'],
}

const terminalConsumerSlot: ParameterSlot = {
  slotId: 'slot-consumer',
  targetNodeId: 'node-sink',
  kind: 'consumer',
  required: true,
  allowedConsumerKinds: ['printValue', 'printField'],
  allowedFields: CONSUMER_ALLOWED_FIELDS,
}

export const P4_TEMPLATES: readonly PipelineTemplate[] = [
  // ---- reduce（§6.1） ----
  p4Template(
    'tmpl-reduce-concat',
    OP_REDUCE,
    'reduce（String連結・identityなし）',
    sourceSlotDef(['streamOf']),
    [srcNode(OP_SOURCE_STREAM_OF), termNode(OP_REDUCE, 'slot-reduction')],
    [reductionSlot(['stringConcat'])],
    ['standard', 'emptySource'],
    ['identityなしのreduceは最初の要素を初期累積値とし、空StreamではOptional.empty()を返す。'],
  ),
  p4Template(
    'tmpl-reduce-concat-midempty',
    OP_REDUCE,
    'reduce（途中0件: filter併用でOptional.empty）',
    employeeSource,
    [
      { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
      { nodeId: 'node-filter-1', operationId: OP_FILTER, role: 'intermediate', slotId: 'slot-predicate-f' },
      { nodeId: 'node-map', operationId: OP_MAP, role: 'intermediate', slotId: 'slot-mapper-1' },
      termNode(OP_REDUCE, 'slot-reduction'),
    ],
    [
      {
        slotId: 'slot-predicate-f',
        targetNodeId: 'node-filter-1',
        kind: 'predicate',
        required: true,
        allowedFields: ['age'],
        allowedOperators: ['GTE'],
      },
      mapperSlot('slot-mapper-1', 'node-map', ['fieldAccess']),
      reductionSlot(['stringConcat']),
    ],
    ['midEmpty'],
    ['途中0件では要素が1件も到達せず、identityなしreduceの結果はOptional.empty()になる。'],
    ['fieldCompare'],
  ),
  p4Template(
    'tmpl-reduce-int',
    OP_REDUCE,
    'IntStream.reduce（加算・identityなし）',
    sourceSlotDef(['arrayPrimitive']),
    [srcNode(OP_SOURCE_ARRAYS_STREAM), termNode(OP_REDUCE, 'slot-reduction')],
    [reductionSlot(['numericSum'])],
    ['standard', 'emptySource'],
    ['identityなしのIntStream.reduceは空StreamでOptionalInt.empty()を返す。'],
  ),
  p4Template(
    'tmpl-reduce-int-identity',
    OP_REDUCE,
    'IntStream.reduce（加算・identityあり）',
    sourceSlotDef(['arrayPrimitive']),
    [srcNode(OP_SOURCE_ARRAYS_STREAM), termNode(OP_REDUCE, 'slot-reduction')],
    [reductionSlot(['numericSum']), identitySlot],
    ['standard', 'emptySource'],
    ['identityありのreduceは空Streamでidentityを返す。'],
  ),
  p4Template(
    'tmpl-reduce-salary',
    OP_REDUCE,
    '3引数reduce（Employeeのsalary合計）',
    employeeSource,
    [
      { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
      termNode(OP_REDUCE, 'slot-reduction'),
    ],
    [reductionSlot(['employeeFieldSum']), identitySlot],
    ['standard', 'emptySource'],
    [
      '3引数reduceは累積型U（long）が要素型T（Employee）と異なる場合に使う。',
      'combinerはparallel reductionで必要となる。sequential実行では呼ばれない（呼出し0回）。',
    ],
  ),
  // ---- count・min・max（§6.2） ----
  p4Template(
    'tmpl-count',
    OP_COUNT,
    'count（要素数の集計）',
    employeeSource,
    [
      { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
      termNode(OP_COUNT),
    ],
    [],
    ['standard', 'emptySource'],
    ['JDKは結果を直接算出できる場合、Pipeline（peek等）の評価を省略することがある。'],
  ),
  p4Template(
    'tmpl-count-midempty',
    OP_COUNT,
    'count（途中0件: filter併用で0L）',
    employeeSource,
    [
      { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
      { nodeId: 'node-filter-1', operationId: OP_FILTER, role: 'intermediate', slotId: 'slot-predicate-f' },
      termNode(OP_COUNT),
    ],
    [
      {
        slotId: 'slot-predicate-f',
        targetNodeId: 'node-filter-1',
        kind: 'predicate',
        required: true,
        allowedFields: ['age'],
        allowedOperators: ['GTE'],
      },
    ],
    ['midEmpty'],
    ['途中0件のcountは0Lを返す。'],
    ['fieldCompare'],
  ),
  p4Template(
    'tmpl-min-age',
    OP_MIN,
    'Stream.min（Employeeのage Comparator）',
    employeeSource,
    [
      { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
      termNode(OP_MIN, 'slot-comparator'),
    ],
    [terminalComparatorSlot],
    ['standard', 'emptySource'],
    ['Stream.min(Comparator)は空StreamでOptional.empty()を返す。'],
  ),
  p4Template(
    'tmpl-max-age',
    OP_MAX,
    'Stream.max（Employeeのage Comparator）',
    employeeSource,
    [
      { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
      termNode(OP_MAX, 'slot-comparator'),
    ],
    [terminalComparatorSlot],
    ['standard', 'emptySource'],
    ['Stream.max(Comparator)は空StreamでOptional.empty()を返す。'],
  ),
  p4Template(
    'tmpl-min-int',
    OP_MIN,
    'IntStream.min()',
    sourceSlotDef(['arrayPrimitive']),
    [srcNode(OP_SOURCE_ARRAYS_STREAM), termNode(OP_MIN)],
    [],
    ['standard', 'emptySource'],
    ['IntStream.min()は空StreamでOptionalInt.empty()を返す。'],
  ),
  p4Template(
    'tmpl-max-long',
    OP_MAX,
    'LongStream.max()',
    sourceSlotDef(['arrayPrimitive']),
    [srcNode(OP_SOURCE_ARRAYS_STREAM), termNode(OP_MAX)],
    [],
    ['standard', 'emptySource'],
    ['LongStream.max()は空StreamでOptionalLong.empty()を返す。'],
  ),
  p4Template(
    'tmpl-min-double',
    OP_MIN,
    'DoubleStream.min()',
    sourceSlotDef(['arrayPrimitive']),
    [srcNode(OP_SOURCE_ARRAYS_STREAM), termNode(OP_MIN)],
    [],
    ['standard', 'emptySource'],
    ['DoubleStream.min()は空StreamでOptionalDouble.empty()を返す。'],
  ),
  // ---- find・match（§6.3） ----
  p4Template(
    'tmpl-findfirst',
    OP_FIND_FIRST,
    'findFirst（最初の該当で短絡）',
    employeeSource,
    [
      { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
      { nodeId: 'node-filter-1', operationId: OP_FILTER, role: 'intermediate', slotId: 'slot-predicate-f' },
      termNode(OP_FIND_FIRST),
    ],
    [
      {
        slotId: 'slot-predicate-f',
        targetNodeId: 'node-filter-1',
        kind: 'predicate',
        required: true,
        allowedFields: ['age'],
        allowedOperators: ['GTE'],
      },
    ],
    ['standard', 'midEmpty', 'emptySource'],
    ['findFirstはordered Streamで最初の要素を返し、結果確定後の残りは評価されない。'],
    ['fieldCompare'],
  ),
  p4Template(
    'tmpl-findany',
    OP_FIND_ANY,
    'findAny（決定的fixtureと非保証注記）',
    employeeSource,
    [
      { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
      { nodeId: 'node-filter-1', operationId: OP_FILTER, role: 'intermediate', slotId: 'slot-predicate-f' },
      termNode(OP_FIND_ANY),
    ],
    [
      {
        slotId: 'slot-predicate-f',
        targetNodeId: 'node-filter-1',
        kind: 'predicate',
        required: true,
        allowedFields: ['age'],
        allowedOperators: ['GTE'],
      },
    ],
    ['standard', 'emptySource'],
    ['findAnyはどの要素が返るかをJDKが保証しない。fixtureの選択は再現可能だが移植可能な保証ではない。'],
    ['fieldCompare'],
  ),
  p4Template(
    'tmpl-anymatch',
    OP_ANY_MATCH,
    'anyMatch（最初のtrueで停止）',
    employeeSource,
    [
      { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
      termNode(OP_ANY_MATCH, 'slot-predicate-1'),
    ],
    [matchPredicateSlot],
    ['standard', 'emptySource'],
    ['anyMatchは最初のtrueで結果確定する。空Streamの結果はfalse。'],
    ['fieldCompare'],
  ),
  p4Template(
    'tmpl-allmatch',
    OP_ALL_MATCH,
    'allMatch（最初のfalseで停止・vacuous truth）',
    employeeSource,
    [
      { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
      termNode(OP_ALL_MATCH, 'slot-predicate-1'),
    ],
    [matchPredicateSlot],
    ['standard', 'emptySource'],
    ['allMatchは最初のfalseで結果確定する。空Streamの結果はtrue（vacuous truth）。'],
    ['fieldCompare'],
  ),
  p4Template(
    'tmpl-nonematch',
    OP_NONE_MATCH,
    'noneMatch（最初のtrueで停止・vacuous truth）',
    employeeSource,
    [
      { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
      termNode(OP_NONE_MATCH, 'slot-predicate-1'),
    ],
    [matchPredicateSlot],
    ['standard', 'emptySource'],
    ['noneMatchは最初のtrueで結果確定する（結果false）。空Streamの結果はtrue（vacuous truth）。'],
    ['fieldCompare'],
  ),
  // ---- primitive集計（§6.4） ----
  ...(['int', 'long', 'double'] as const).flatMap((primitive) => [
    p4Template(
      `tmpl-sum-${primitive}`,
      OP_SUM,
      `${primitive === 'int' ? 'IntStream' : primitive === 'long' ? 'LongStream' : 'DoubleStream'}.sum()`,
      sourceSlotDef(['arrayPrimitive']),
      [srcNode(OP_SOURCE_ARRAYS_STREAM), termNode(OP_SUM)],
      [],
      ['standard', 'emptySource'],
      [`空Streamのsum()は${primitive === 'int' ? '0' : primitive === 'long' ? '0L' : '0.0'}を返す。`],
    ),
    p4Template(
      `tmpl-average-${primitive}`,
      OP_AVERAGE,
      `${primitive === 'int' ? 'IntStream' : primitive === 'long' ? 'LongStream' : 'DoubleStream'}.average()`,
      sourceSlotDef(['arrayPrimitive']),
      [srcNode(OP_SOURCE_ARRAYS_STREAM), termNode(OP_AVERAGE)],
      [],
      ['standard', 'emptySource'],
      ['空Streamのaverage()はOptionalDouble.empty()を返す。'],
    ),
    p4Template(
      `tmpl-stats-${primitive}`,
      OP_SUMMARY_STATISTICS,
      `${primitive === 'int' ? 'IntStream' : primitive === 'long' ? 'LongStream' : 'DoubleStream'}.summaryStatistics()`,
      sourceSlotDef(['arrayPrimitive']),
      [srcNode(OP_SOURCE_ARRAYS_STREAM), termNode(OP_SUMMARY_STATISTICS)],
      [],
      ['standard', 'emptySource'],
      ['空Streamのmin / maxは型の正規初期値（MAX_VALUE / MIN_VALUE、doubleは正負Infinity）になる。'],
    ),
  ]),
  // ---- 結果化・副作用（§6.5） ----
  p4Template(
    'tmpl-toarray-object',
    OP_TO_ARRAY,
    'Stream.toArray()（Object[]）',
    employeeSource,
    [
      { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
      termNode(OP_TO_ARRAY),
    ],
    [],
    ['standard', 'emptySource'],
    ['Stream.toArray()はObject[]を返す。空Streamは長さ0のObject[]。'],
  ),
  ...(['int', 'long', 'double'] as const).map((primitive) =>
    p4Template(
      `tmpl-toarray-${primitive}`,
      OP_TO_ARRAY,
      `${primitive === 'int' ? 'IntStream' : primitive === 'long' ? 'LongStream' : 'DoubleStream'}.toArray()（${primitive}[]）`,
      sourceSlotDef(['arrayPrimitive']),
      [srcNode(OP_SOURCE_ARRAYS_STREAM), termNode(OP_TO_ARRAY)],
      [],
      ['standard', 'emptySource'],
      [`primitive StreamのtoArray()は${primitive}[]を返す。`],
    ),
  ),
  p4Template(
    'tmpl-toarray-generator',
    OP_TO_ARRAY,
    'Stream.toArray(String[]::new)（型付き配列）',
    sourceSlotDef(['streamOf']),
    [srcNode(OP_SOURCE_STREAM_OF), termNode(OP_TO_ARRAY, 'slot-generator')],
    [
      {
        slotId: 'slot-generator',
        targetNodeId: 'node-sink',
        kind: 'arrayGenerator',
        required: true,
        allowedElementTypeNames: ['String'],
      },
    ],
    ['standard', 'emptySource'],
    ['toArray(generator)は指定した型の配列（String[]等）を返す。空Streamでも正しいcomponent typeを持つ。'],
  ),
  p4Template(
    'tmpl-foreach',
    OP_FOR_EACH,
    'forEach（Side Effectとvoid）',
    employeeSource,
    [
      { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
      termNode(OP_FOR_EACH, 'slot-consumer'),
    ],
    [terminalConsumerSlot],
    ['standard', 'emptySource'],
    ['forEachの戻り値はvoid。parallel実行では順序を保証しない（初版はsequentialのみ）。'],
  ),
  p4Template(
    'tmpl-foreachordered',
    OP_FOR_EACH_ORDERED,
    'forEachOrdered（encounter order保証）',
    sourceSlotDef(['arrayPrimitive']),
    [srcNode(OP_SOURCE_ARRAYS_STREAM), termNode(OP_FOR_EACH_ORDERED, 'slot-consumer')],
    [
      {
        slotId: 'slot-consumer',
        targetNodeId: 'node-sink',
        kind: 'consumer',
        required: true,
        allowedConsumerKinds: ['printValue'],
        allowedFields: [],
      },
    ],
    ['standard', 'emptySource'],
    ['forEachOrderedはparallelでもencounter orderを保証する。sequential実行ではforEachと同順。'],
  ),
]

export const ALL_TEMPLATES: readonly PipelineTemplate[] = [
  FILTER_BASIC_TEMPLATE,
  FILTER_CHAIN_TEMPLATE,
  SRC_COLLECTION_TEMPLATE,
  SRC_ARRAYS_OBJECT_TEMPLATE,
  SRC_ARRAYS_PRIMITIVE_TEMPLATE,
  SRC_ARRAYS_LONG_TEMPLATE,
  SRC_ARRAYS_DOUBLE_TEMPLATE,
  SRC_STREAM_OF_TEMPLATE,
  SRC_ITERATE3_TEMPLATE,
  SRC_RANGE_TEMPLATE,
  SRC_RANGE_CLOSED_TEMPLATE,
  SRC_EMPTY_OBJECT_TEMPLATE,
  SRC_EMPTY_INT_TEMPLATE,
  SRC_EMPTY_LONG_TEMPLATE,
  SRC_EMPTY_DOUBLE_TEMPLATE,
  SRC_GENERATE_TEMPLATE,
  SRC_ITERATE2_TEMPLATE,
  MAP_TEMPLATE,
  MAP_MID_EMPTY_TEMPLATE,
  MAP_TO_INT_TEMPLATE,
  MAP_TO_LONG_TEMPLATE,
  MAP_TO_DOUBLE_TEMPLATE,
  BOXED_TEMPLATE,
  MAP_TO_OBJ_TEMPLATE,
  FLAT_MAP_TEMPLATE,
  FLAT_MAP_TO_INT_TEMPLATE,
  FLAT_MAP_TO_LONG_TEMPLATE,
  FLAT_MAP_TO_DOUBLE_TEMPLATE,
  // ---- Phase 3 ----
  DISTINCT_TEMPLATE,
  DISTINCT_MID_EMPTY_TEMPLATE,
  SORTED_NATURAL_TEMPLATE,
  SORTED_MID_EMPTY_TEMPLATE,
  SORTED_COMPARATOR_TEMPLATE,
  LIMIT_TEMPLATE,
  LIMIT_GENERATE_TEMPLATE,
  LIMIT_ITERATE2_TEMPLATE,
  SKIP_TEMPLATE,
  TAKE_WHILE_TEMPLATE,
  DROP_WHILE_TEMPLATE,
  PEEK_TEMPLATE,
  PEEK_MID_EMPTY_TEMPLATE,
  // ---- Phase 4 ----
  ...P4_TEMPLATES,
  // ---- Phase 5（Collector・持越しtemplate） ----
  ...P5_TEMPLATES,
  // ---- Phase 7（Gatherer） ----
  ...P7_TEMPLATES,
]

export function createDefaultTemplateRegistry(): TemplateRegistry {
  const registry = new TemplateRegistry()
  for (const template of ALL_TEMPLATES) registry.register(template)
  return registry
}
