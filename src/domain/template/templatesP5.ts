import type { ParameterSlot, PipelineTemplate, PipelineTemplateNode } from './pipelineTemplate'
import {
  OP_COLLECT,
  OP_COLLECT_TRIPLE,
  OP_DROP_WHILE,
  OP_FILTER,
  OP_MAP,
  OP_SOURCE_COLLECTION_STREAM,
  OP_TAKE_WHILE,
  OP_TO_LIST,
} from '../catalog/operations'

/**
 * Phase 5 Collector教材template（指示§8）。
 * §5.2の各Collector variantごとに最低1つの実行可能templateを登録する。
 * template ID / version / node ID / line IDは安定させる。
 *
 * ファイルはtemplates.tsから分離した（Phase 4までで1466行に達しており、
 * Phase 5分を同一ファイルへ追加すると可読性・レビュー性が損なわれるため。
 * 登録は`ALL_TEMPLATES`へ`...P5_TEMPLATES`として集約する）。
 */

const employeeSource = {
  slotId: null,
  defaultDsl: { kind: 'collection', collectionId: 'employees' } as const,
  allowedSourceKinds: ['collection'],
}

const SRC: PipelineTemplateNode = {
  nodeId: 'node-src',
  operationId: OP_SOURCE_COLLECTION_STREAM,
  role: 'source',
  slotId: null,
}

/** 途中0件（midEmpty）用のfilterノード。全件falseのPredicateをfixtureが与える */
const FILTER_NODE: PipelineTemplateNode = {
  nodeId: 'node-filter-f',
  operationId: OP_FILTER,
  role: 'intermediate',
  slotId: 'slot-predicate-f',
}

const MAP_NODE: PipelineTemplateNode = {
  nodeId: 'node-map',
  operationId: OP_MAP,
  role: 'intermediate',
  slotId: 'slot-mapper-1',
}

function collectNode(operationId: string = OP_COLLECT, slotId = 'slot-collector'): PipelineTemplateNode {
  return { nodeId: 'node-sink', operationId, role: 'terminal', slotId }
}

const collectorSlot = (kinds: readonly string[]): ParameterSlot => ({
  slotId: 'slot-collector',
  targetNodeId: 'node-sink',
  kind: 'collector',
  required: true,
  allowedCollectorKinds: kinds,
})

const collectTripleSlot: ParameterSlot = {
  slotId: 'slot-collect-triple',
  targetNodeId: 'node-sink',
  kind: 'collectTriple',
  required: true,
}

const nameMapperSlot: ParameterSlot = {
  slotId: 'slot-mapper-1',
  targetNodeId: 'node-map',
  kind: 'mapper',
  required: true,
  allowedMapperKinds: ['fieldAccess'],
}

/** midEmpty用のfilter Predicate slot（age GTE） */
const midEmptyFilterSlot: ParameterSlot = {
  slotId: 'slot-predicate-f',
  targetNodeId: 'node-filter-f',
  kind: 'predicate',
  required: true,
  allowedFields: ['age'],
  allowedOperators: ['GTE'],
}

function p5Template(
  templateId: string,
  title: string,
  nodes: readonly PipelineTemplateNode[],
  parameterSlots: readonly ParameterSlot[],
  supportedModes: PipelineTemplate['supportedModes'],
  jdkNotes: readonly string[],
  options: {
    readonly targetOperationId?: string
    readonly predicateKinds?: readonly string[]
    readonly estimatedMax?: number
  } = {},
): PipelineTemplate {
  return {
    templateId,
    version: 1,
    targetOperationId: options.targetOperationId ?? OP_COLLECT,
    targetNodeId: 'node-sink',
    title,
    sourceDefinition: employeeSource,
    nodes,
    parameterSlots,
    allowedDslProfile: { predicateKinds: options.predicateKinds ?? [] },
    supportedModes,
    jdkNotes,
    snapshotBudget: { limit: 500, estimatedMax: options.estimatedMax ?? 60 },
  }
}

const COLLECT_NOTE_TOLIST =
  'Collectors.toList()が返すListは型・可変性・thread-safetyを保証しない。Stream.toList()のunmodifiableとは別物である。'
const COLLECT_NOTE_UNORDERED =
  'toSet / groupingByが返すSet / Mapのiteration orderはJDKの保証対象ではない（画面の表示順は学習用の安定順序）。'

/** 数値集計（summing / averaging / summarizing）のInt / Long / Double variantを一括生成する */
const NUMERIC_VARIANTS: readonly {
  readonly family: 'summing' | 'averaging' | 'summarizing'
  readonly primitive: 'Int' | 'Long' | 'Double'
  readonly field: 'age' | 'salary' | 'evaluation'
  readonly expected: string
}[] = [
  { family: 'summing', primitive: 'Int', field: 'age', expected: '133' },
  { family: 'summing', primitive: 'Long', field: 'salary', expected: '21700000' },
  { family: 'summing', primitive: 'Double', field: 'evaluation', expected: '16.6' },
  { family: 'averaging', primitive: 'Int', field: 'age', expected: '33.25' },
  { family: 'averaging', primitive: 'Long', field: 'salary', expected: '5425000.0' },
  { family: 'averaging', primitive: 'Double', field: 'evaluation', expected: '4.15' },
  { family: 'summarizing', primitive: 'Int', field: 'age', expected: 'count=4, sum=133' },
  { family: 'summarizing', primitive: 'Long', field: 'salary', expected: 'count=4, sum=21700000' },
  { family: 'summarizing', primitive: 'Double', field: 'evaluation', expected: 'count=4, sum=16.6' },
]

export const NUMERIC_COLLECTOR_TEMPLATE_IDS: readonly {
  readonly templateId: string
  readonly kind: string
  readonly field: string
}[] = NUMERIC_VARIANTS.map((v) => ({
  templateId: `tmpl-collect-${v.family.toLowerCase()}-${v.primitive.toLowerCase()}`,
  kind: `${v.family}${v.primitive}`,
  field: v.field,
}))

const numericTemplates: readonly PipelineTemplate[] = NUMERIC_VARIANTS.map((variant) => {
  const kind = `${variant.family}${variant.primitive}`
  const templateId = `tmpl-collect-${variant.family.toLowerCase()}-${variant.primitive.toLowerCase()}`
  return p5Template(
    templateId,
    `collect（Collectors.${kind}(Employee::${variant.field})）`,
    [SRC, collectNode()],
    [collectorSlot([kind])],
    ['standard', 'emptySource'],
    variant.family === 'averaging'
      ? [
          `${kind}の空入力結果は0である（Java SE 25: "If no elements are present, the result is 0."）。`,
          '平均は合計と件数の蓄積から、全要素処理後のfinisherで確定する。',
        ]
      : variant.family === 'summarizing'
        ? [
            `空入力の${variant.primitive}SummaryStatisticsはcount=0, sum=0で、min / maxは型の正規初期値になる。`,
          ]
        : [`${kind}の空入力結果は型別の0である。`],
    { estimatedMax: 40 },
  )
})

export const P5_TEMPLATES: readonly PipelineTemplate[] = [
  // ---- 単純Collector ----
  p5Template(
    'tmpl-collect-tolist',
    'collect（Collectors.toList()）',
    [SRC, collectNode()],
    [collectorSlot(['toList'])],
    ['standard', 'emptySource'],
    [COLLECT_NOTE_TOLIST],
    { estimatedMax: 40 },
  ),
  p5Template(
    'tmpl-collect-tolist-midempty',
    'collect（toList・途中0件）',
    [SRC, FILTER_NODE, collectNode()],
    [midEmptyFilterSlot, collectorSlot(['toList'])],
    ['midEmpty'],
    [COLLECT_NOTE_TOLIST],
    { predicateKinds: ['fieldCompare'], estimatedMax: 40 },
  ),
  p5Template(
    'tmpl-collect-toset',
    'collect（map + Collectors.toSet()・重複で変化しない状態）',
    [SRC, MAP_NODE, collectNode()],
    [nameMapperSlot, collectorSlot(['toSet'])],
    ['standard', 'emptySource'],
    [
      'Setは重複を保持しない。同値の要素を追加しても状態は変化しない。',
      COLLECT_NOTE_UNORDERED,
    ],
    { estimatedMax: 50 },
  ),
  p5Template(
    'tmpl-collect-tocollection',
    'collect（Collectors.toCollection(ArrayList::new)）',
    [SRC, collectNode()],
    [collectorSlot(['toCollection'])],
    ['standard', 'emptySource'],
    ['toCollectionは結果コンテナのsupplierを明示的に指定する。'],
    { estimatedMax: 45 },
  ),
  p5Template(
    'tmpl-collect-joining',
    'collect（map + Collectors.joining()）',
    [SRC, MAP_NODE, collectNode()],
    [nameMapperSlot, collectorSlot(['joining'])],
    ['standard', 'emptySource'],
    ['引数なしのjoining()は区切り文字なしで連結する。空入力の結果は空文字列である。'],
    { estimatedMax: 50 },
  ),
  p5Template(
    'tmpl-collect-joining-delimiter',
    'collect（map + Collectors.joining(", ")）',
    [SRC, MAP_NODE, collectNode()],
    [nameMapperSlot, collectorSlot(['joining'])],
    ['standard', 'emptySource'],
    ['delimiterは要素間にのみ挿入される（末尾には付かない）。'],
    { estimatedMax: 50 },
  ),
  p5Template(
    'tmpl-collect-joining-full',
    'collect（map + Collectors.joining(", ", "[", "]")）',
    [SRC, MAP_NODE, collectNode()],
    [nameMapperSlot, collectorSlot(['joining'])],
    ['standard', 'emptySource'],
    [
      '3引数joiningの空入力結果はprefix + suffixである（JDK 25実測: Draft v0.8 付録F.1）。',
    ],
    { estimatedMax: 50 },
  ),
  p5Template(
    'tmpl-collect-counting',
    'collect（Collectors.counting()）',
    [SRC, collectNode()],
    [collectorSlot(['counting'])],
    ['standard', 'emptySource'],
    ['countingの空入力結果は0である（Java SE 25: "If no elements are present, the result is 0."）。'],
    { estimatedMax: 40 },
  ),
  ...numericTemplates,
  p5Template(
    'tmpl-collect-minby',
    'collect（Collectors.minBy(Comparator.comparingInt(Employee::age))）',
    [SRC, collectNode()],
    [collectorSlot(['minBy'])],
    ['standard', 'emptySource'],
    ['minByの結果はOptionalであり、空入力ではOptional.empty()になる。'],
    { estimatedMax: 40 },
  ),
  p5Template(
    'tmpl-collect-maxby',
    'collect（Collectors.maxBy(Comparator.comparingLong(Employee::salary))）',
    [SRC, collectNode()],
    [collectorSlot(['maxBy'])],
    ['standard', 'emptySource'],
    ['maxByは候補を更新しながら最大要素を保持する。同値では先の候補を保持する。'],
    { estimatedMax: 40 },
  ),
  p5Template(
    'tmpl-collect-reducing',
    'collect（map + Collectors.reducing((a, b) -> a + b)）',
    [SRC, MAP_NODE, collectNode()],
    [nameMapperSlot, collectorSlot(['reducing'])],
    ['standard', 'emptySource'],
    ['1引数reducingの結果はOptionalであり、空入力ではOptional.empty()になる。'],
    { estimatedMax: 50 },
  ),
  // ---- downstream合成 ----
  p5Template(
    'tmpl-collect-mapping',
    'collect（groupingBy + Collectors.mapping）',
    [SRC, collectNode()],
    [collectorSlot(['groupingBy', 'mapping', 'toList'])],
    ['standard', 'emptySource'],
    ['mappingはmapper適用後の値をdownstreamへ渡す。'],
    { estimatedMax: 60 },
  ),
  p5Template(
    'tmpl-collect-filtering',
    'collect（groupingBy + Collectors.filtering・空bucketが残る）',
    [SRC, collectNode()],
    [collectorSlot(['groupingBy', 'filtering', 'toList'])],
    ['standard', 'emptySource'],
    [
      'Collectors.filteringはbucket決定後にPredicateを評価するため、全要素が除外されたキーも空のdownstream結果として残る。Stream.filterで先に除外するとキー自体が生成されない。',
    ],
    { estimatedMax: 60 },
  ),
  p5Template(
    'tmpl-collect-flatmapping',
    'collect（groupingBy + Collectors.flatMapping・skills展開）',
    [SRC, collectNode()],
    [collectorSlot(['groupingBy', 'flatMapping', 'toList'])],
    ['standard', 'emptySource'],
    ['flatMappingはbucket内で展開 → flatten → downstreamの順に処理する。'],
    { estimatedMax: 90 },
  ),
  p5Template(
    'tmpl-collect-collectingandthen',
    'collect（Collectors.collectingAndThen(toList(), List::copyOf)）',
    [SRC, collectNode()],
    [collectorSlot(['collectingAndThen', 'toList'])],
    ['standard', 'emptySource'],
    ['collectingAndThenはdownstream完了後にfinisherを適用する。'],
    { estimatedMax: 45 },
  ),
  // ---- 分類ツリー ----
  p5Template(
    'tmpl-collect-groupingby',
    'collect（Collectors.groupingBy(Employee::department)）',
    [SRC, collectNode()],
    [collectorSlot(['groupingBy'])],
    ['standard', 'emptySource'],
    [
      'groupingByのキーにはDepartment recordを使える。キー等価はrecordのequals（全フィールド比較）で判定される。',
      COLLECT_NOTE_UNORDERED,
    ],
    { estimatedMax: 60 },
  ),
  p5Template(
    'tmpl-collect-groupingby-midempty',
    'collect（groupingBy・途中0件で空Map）',
    [SRC, FILTER_NODE, collectNode()],
    [midEmptyFilterSlot, collectorSlot(['groupingBy'])],
    ['midEmpty'],
    ['要素が0件のgroupingByの結果は空Mapである（bucketは生成されない）。'],
    { predicateKinds: ['fieldCompare'], estimatedMax: 45 },
  ),
  p5Template(
    'tmpl-collect-groupingby-counting',
    'collect（groupingBy(Employee::region) + counting()）',
    [SRC, collectNode()],
    [collectorSlot(['groupingBy', 'counting'])],
    ['standard', 'emptySource'],
    ['bucket決定後にdownstreamを実行する。bucketごとのdownstream結果がMapの値になる。'],
    { estimatedMax: 60 },
  ),
  p5Template(
    'tmpl-collect-groupingby-averaging',
    'collect（groupingBy(Employee::region) + averagingLong(Employee::salary)）',
    [SRC, collectNode()],
    [collectorSlot(['groupingBy', 'averagingLong'])],
    ['standard', 'emptySource'],
    [
      'bucketごとにaveragingのfinisherが適用される。確定順はbucket生成順（教材上の規約であり、JDKのMap iteration order保証ではない）。',
    ],
    { estimatedMax: 60 },
  ),
  p5Template(
    'tmpl-collect-groupingby-treemap',
    'collect（groupingBy(Employee::region, TreeMap::new, toList())）',
    [SRC, collectNode()],
    [collectorSlot(['groupingBy', 'toList'])],
    ['standard', 'emptySource'],
    [
      'TreeMapはキーのnatural orderingで並ぶ。TreeMap()（Comparatorなし）へ入れるキーはComparableでなければならない。',
    ],
    { estimatedMax: 60 },
  ),
  p5Template(
    'tmpl-collect-groupingby-nested',
    'collect（nested groupingBy: department → region）',
    [SRC, collectNode()],
    [collectorSlot(['groupingBy'])],
    ['standard', 'emptySource'],
    ['nested groupingByでは外側classifier → 内側groupingBy → 最終コンテナの順に経路が伸びる。'],
    { estimatedMax: 70 },
  ),
  p5Template(
    'tmpl-collect-partitioningby',
    'collect（Collectors.partitioningBy(e -> e.age() >= 30)）',
    [SRC, collectNode()],
    [collectorSlot(['partitioningBy'])],
    ['standard', 'emptySource'],
    [
      'partitioningByの結果Mapはtrue / false両キーを必ず含む（該当0件でも空のdownstream結果を保持）。キーはwrapper Booleanである。',
    ],
    { estimatedMax: 60 },
  ),
  p5Template(
    'tmpl-collect-partitioningby-counting',
    'collect（partitioningBy + counting()）',
    [SRC, collectNode()],
    [collectorSlot(['partitioningBy', 'counting'])],
    ['standard', 'emptySource'],
    ['partition確定・finisher発行順はfalse → trueの固定順である（教材上の規約）。'],
    { estimatedMax: 60 },
  ),
  // ---- Collector入れ子（teeing） ----
  p5Template(
    'tmpl-collect-teeing',
    'collect（Collectors.teeing(counting(), averagingLong(salary), SalarySummary::new)）',
    [SRC, collectNode()],
    [collectorSlot(['teeing', 'counting', 'averagingLong'])],
    ['standard', 'emptySource'],
    [
      '同じ入力要素が左右両方のdownstream Collectorで処理される。',
      'mergerは両downstreamのfinisher完了後の「完成結果」を最終型へ統合する。空Streamでも省略されない。',
      '左→右はsnapshot列を決定的にするための教材上の表示順であり、JDKがdownstream間の呼出し順を保証するものではない。',
    ],
    { estimatedMax: 50 },
  ),
  p5Template(
    'tmpl-collect-teeing-midempty',
    'collect（teeing・途中0件でもmergerを適用）',
    [SRC, FILTER_NODE, collectNode()],
    [midEmptyFilterSlot, collectorSlot(['teeing', 'counting', 'averagingLong'])],
    ['midEmpty'],
    ['蓄積0件でも左右のfinisherとmergerは適用される（付録B: 左右の空結果をmergerへ渡した結果）。'],
    { predicateKinds: ['fieldCompare'], estimatedMax: 45 },
  ),
  // ---- 3引数collect ----
  p5Template(
    'tmpl-collect-triple',
    'collect（ArrayList::new, ArrayList::add, ArrayList::addAll）',
    [SRC, collectNode(OP_COLLECT_TRIPLE, 'slot-collect-triple')],
    [collectTripleSlot],
    ['standard', 'emptySource'],
    [
      '3引数collectはsupplier / accumulator / combinerを直接渡す「裸の可変リダクション」であり、その抽象化がCollectorである。',
      'combinerはparallel reductionで必要となる。sequential実行では呼ばれない（呼出し0回）。',
    ],
    { targetOperationId: OP_COLLECT_TRIPLE, estimatedMax: 40 },
  ),
  // ---- Phase 3からの持越し: takeWhile / dropWhileのEmployee fieldCompare（指示§5.3） ----
  {
    templateId: 'tmpl-takewhile-employee',
    version: 1,
    targetOperationId: OP_TAKE_WHILE,
    targetNodeId: 'node-takewhile',
    title: 'takeWhile（Employeeのsalary境界と短絡）',
    sourceDefinition: employeeSource,
    nodes: [
      SRC,
      {
        nodeId: 'node-takewhile',
        operationId: OP_TAKE_WHILE,
        role: 'intermediate',
        slotId: 'slot-predicate-1',
      },
      { nodeId: 'node-sink', operationId: OP_TO_LIST, role: 'terminal', slotId: null },
    ],
    parameterSlots: [
      {
        slotId: 'slot-predicate-1',
        targetNodeId: 'node-takewhile',
        kind: 'predicate',
        required: true,
        allowedFields: ['salary'],
        allowedOperators: ['GTE'],
      },
    ],
    allowedDslProfile: { predicateKinds: ['fieldCompare'] },
    supportedModes: ['standard', 'midEmpty', 'emptySource'],
    jdkNotes: [
      '初版実行はsequential + orderedに限定する。unorderedの意味論は補助説明のみ。',
      '最初のfalseで短絡し、後続はPredicateならtrueとなる値でも評価されない。',
    ],
    snapshotBudget: { limit: 500, estimatedMax: 40 },
  },
  {
    templateId: 'tmpl-dropwhile-employee',
    version: 1,
    targetOperationId: OP_DROP_WHILE,
    targetNodeId: 'node-dropwhile',
    title: 'dropWhile（Employeeのsalary境界と通過モード）',
    sourceDefinition: employeeSource,
    nodes: [
      SRC,
      {
        nodeId: 'node-dropwhile',
        operationId: OP_DROP_WHILE,
        role: 'intermediate',
        slotId: 'slot-predicate-1',
      },
      { nodeId: 'node-sink', operationId: OP_TO_LIST, role: 'terminal', slotId: null },
    ],
    parameterSlots: [
      {
        slotId: 'slot-predicate-1',
        targetNodeId: 'node-dropwhile',
        kind: 'predicate',
        required: true,
        allowedFields: ['salary'],
        allowedOperators: ['GTE'],
      },
    ],
    allowedDslProfile: { predicateKinds: ['fieldCompare'] },
    supportedModes: ['standard', 'midEmpty', 'emptySource'],
    jdkNotes: [
      '初版実行はsequential + orderedに限定する。',
      '最初のfalse以降は通過モードとなり、Predicateを再評価しない。',
    ],
    snapshotBudget: { limit: 500, estimatedMax: 45 },
  },
]
