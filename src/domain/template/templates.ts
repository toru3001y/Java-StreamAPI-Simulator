import type { ParameterSlot, PipelineTemplate, PipelineTemplateNode } from './pipelineTemplate'
import { TemplateRegistry } from './templateRegistry'
import {
  OP_BOXED,
  OP_FILTER,
  OP_FLAT_MAP,
  OP_FLAT_MAP_TO_DOUBLE,
  OP_FLAT_MAP_TO_INT,
  OP_FLAT_MAP_TO_LONG,
  OP_MAP,
  OP_MAP_TO_DOUBLE,
  OP_MAP_TO_INT,
  OP_MAP_TO_LONG,
  OP_MAP_TO_OBJ,
  OP_SOURCE_ARRAYS_STREAM,
  OP_SOURCE_COLLECTION_STREAM,
  OP_SOURCE_EMPTY,
  OP_SOURCE_GENERATE,
  OP_SOURCE_ITERATE2,
  OP_SOURCE_ITERATE3,
  OP_SOURCE_RANGE,
  OP_SOURCE_RANGE_CLOSED,
  OP_SOURCE_STREAM_OF,
  OP_TO_LIST,
} from '../catalog/operations'

/**
 * Phase 2までの定義済み教材template（§8、Phase 2指示 §8）。
 * template ID、version、node ID、line IDは安定させる。
 * 1操作へ複数templateを登録できるRegistry構造を使用する。
 */

const PHASE3_LIMIT_REASON =
  '無限Streamのため実行できません。Phase 3の有限化操作（limit()）の実装後に実行可能になります。'

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
]

export function createDefaultTemplateRegistry(): TemplateRegistry {
  const registry = new TemplateRegistry()
  for (const template of ALL_TEMPLATES) registry.register(template)
  return registry
}
