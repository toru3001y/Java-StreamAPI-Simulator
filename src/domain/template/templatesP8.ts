import type { ParameterSlot, PipelineTemplate, PipelineTemplateNode } from './pipelineTemplate'
import { OP_COLLECT, OP_SOURCE_COLLECTION_STREAM } from '../catalog/operations'

/**
 * Phase 8 toMap教材template（指示§7.6、v0.11 §8.6）。
 *
 * v0.11 §8.6の基準template 6形に、同一データのgroupingBy比較template（§8.6末尾の追補）を
 * 加えた8件。**新しいoperationIdは追加しない**——toMapは既存`collect` operationの
 * Collector AST kindとして扱う（v0.11 §9）。
 *
 * 教材の中核は次の2点（v0.11 §4）:
 *   1. groupingBy（1キー多値）との対比。toMapは1キー1値であり、衝突はmergeか例外になる。
 *   2. 本シミュレーター初の「正常完了しないPipeline」。2引数版の重複キーをvalidationで隠さず
 *      実行で体験させる（`expectedCompletion: 'EXECUTION_FAILED'`）。
 *
 * duplicate / merge-first / merge-last / merge-concatの4 templateは**同一fixture
 * （employeesMergeDemo）・同一keyMapper（region）**とし、「mergeがないとどうなるか」と
 * first / last / concatの結果差を同一データで直接比較できるようにする（v0.11 §8.6-4・追補）。
 * `tmpl-collect-groupby-mergedemo`は同じデータでgroupingBy(region)を実行する比較templateである。
 *
 * ファイルはtemplates.tsから分離した（`templatesP5.ts` / `templatesP7.ts`の前例。
 * 登録は`ALL_TEMPLATES`へ`...P8_TEMPLATES`として集約する）。
 */

const SRC: PipelineTemplateNode = {
  nodeId: 'node-src',
  operationId: OP_SOURCE_COLLECTION_STREAM,
  role: 'source',
  slotId: null,
}

const COLLECT_SINK: PipelineTemplateNode = {
  nodeId: 'node-sink',
  operationId: OP_COLLECT,
  role: 'terminal',
  slotId: 'slot-collector',
}

const collectorSlot = (kinds: readonly string[]): ParameterSlot => ({
  slotId: 'slot-collector',
  targetNodeId: 'node-sink',
  kind: 'collector',
  required: true,
  allowedCollectorKinds: kinds,
})

/** 基準4件データ（既存fixtureと同一） */
const EMPLOYEES_SOURCE = {
  slotId: null,
  defaultDsl: { kind: 'collection', collectionId: 'employees' } as const,
  allowedSourceKinds: ['collection'],
}

/** merge実演用の補助データ5件（関東3件。指示§7.6） */
const MERGE_DEMO_SOURCE = {
  slotId: null,
  defaultDsl: { kind: 'collection', collectionId: 'employeesMergeDemo' } as const,
  allowedSourceKinds: ['collection'],
}

/**
 * §8.2の実測列は最大32件。余裕を持たせた概算最大値を設定する
 * （実件数はinstantiateの事前実行で厳密検証される）。
 */
const TO_MAP_BUDGET = { limit: 500, estimatedMax: 45 } as const

// ---- 教材規約の共通jdkNote（v0.11 §4の7・§6.2の8・§8.4、指示§7.8） ----

const NOTE_TO_MAP_BASE =
  'Collectors.toMapは1つのキーに1つの値を対応づける。同じキーが複数回現れたときの扱いがgroupingBy（1キーに値のList）との最大の違いである。'

const NOTE_MAP_TYPE_UNSPECIFIED =
  'toMapが返すMapの型・可変性・serializability・thread-safetyはJDKの保証対象ではない（型が必要なら4引数版のmapFactoryを指定する）。'

const NOTE_DISPLAY_ORDER_CONVENTION =
  '画面上の「キー評価 → 値評価 → 重複検出」という表示順は教材上の規約であり、JDK内部でのkeyMapper / valueMapper評価と例外送出の実際の順序を示すものではない。'

const NOTE_ENCOUNTER_ORDER =
  'toMapは結果をencounter orderでMapへ挿入する（JavadocのImplementation Note区分）。返却Mapのentry反復順序そのものは一般には保証されない。'

const NOTE_MERGE_ARG_ORDER =
  'mergeFunctionの引数順は（Map内の既存値, 新しい値）である。根拠はtoMapのmergeFunctionが「as supplied to Map.merge(Object, Object, BiFunction)」と定義されていることである。'

const NOTE_FIRST_LAST_MEANING =
  'first（既存値を保持 / 先勝ち）・last（新しい値で置換 / 後勝ち）の「先 / 後」は、現在の決定的な逐次実行における入力順を指す。'

/** 対象外機能の補助説明（v0.11 §2.2。UNIMPLEMENTED_OPERATIONS機構は使わない。指示§9） */
export const TO_MAP_OUT_OF_SCOPE_NOTES: readonly string[] = [
  'Collectors.toConcurrentMap系はunordered Collectorであり、並列実行での性能最適化が存在意義である。決定的な逐次Step Engineでは意味論を正確に可視化できないため、この教材では実行対象外とする（説明のみ）。',
  'Collectors.toUnmodifiableMap系はnullキー・null値を禁止し（いずれかのmapping functionがnullを返すとNullPointerException）、変更不可能なMapを返す。toUnmodifiableList / toUnmodifiableSetとあわせて将来のPhaseで一括して扱うため、この教材では実行対象外とする（説明のみ）。',
  '数値加算merge（Long::sum等）は、オーバーフロー・safe integer範囲・doubleの丸めを整理したうえで型付きの数値mergeファミリーとして設計する必要があるため、この教材のmergeFunctionホワイトリスト（first / last / concat）には含めない（説明のみ）。',
  'key側のFunction.identity()（Employee自身をキーにする形）は、recordのequalsによるキー等価とTreeMap不可（EmployeeはComparableではない）という別論点を伴うため、この教材ではvalue側identityのみを実行する（key側は説明のみ）。',
]

/** merge対比・実行失敗・groupingBy比較の4+1 templateを相互参照させる文言（v0.11 §8.6追補） */
const NOTE_COMPARE_GROUPING_BY =
  '同じデータ（employeesMergeDemo・関東3件）を「collect（groupingBy(Employee::region)）— toMapとの対比」で実行すると、groupingByは同じキーの値をListへ蓄積する。toMapはキーが衝突するためmergeFunctionで解決するか、mergeFunctionがなければIllegalStateExceptionになる。'

const NOTE_COMPARE_TO_MAP =
  '同じデータを「collect（toMap・重複キーで実行失敗）」「collect（toMap + mergeFunction: first / last / concat）」で実行すると、toMapは1キー1値のため衝突し、mergeFunctionで解決するか例外になる。groupingByは同じキーの値をListへ蓄積するため衝突しない。'

const NOTE_EXISTING_GROUPING_BY_TEMPLATES =
  '基準4件データ（employees）に対するgroupingBy教材は「collect（groupingBy(Employee::region) + counting()）」等で引き続き参照できる。'

function p8Template(input: {
  readonly templateId: string
  readonly title: string
  readonly source: typeof EMPLOYEES_SOURCE | typeof MERGE_DEMO_SOURCE
  readonly allowedCollectorKinds: readonly string[]
  readonly supportedModes: PipelineTemplate['supportedModes']
  readonly jdkNotes: readonly string[]
  readonly expectedCompletion?: 'STREAM_CONSUMED' | 'EXECUTION_FAILED'
}): PipelineTemplate {
  return {
    templateId: input.templateId,
    version: 1,
    targetOperationId: OP_COLLECT,
    targetNodeId: 'node-sink',
    title: input.title,
    sourceDefinition: input.source,
    nodes: [SRC, COLLECT_SINK],
    parameterSlots: [collectorSlot(input.allowedCollectorKinds)],
    allowedDslProfile: { predicateKinds: [] },
    supportedModes: input.supportedModes,
    jdkNotes: input.jdkNotes,
    snapshotBudget: TO_MAP_BUDGET,
    ...(input.expectedCompletion ? { expectedCompletion: input.expectedCompletion } : {}),
  }
}

/**
 * 1. 2引数版・全キー一意・value側identity（v0.11 §4の5の必須教材）。
 *    `toMap(Employee::name, Function.identity())` → `Map<String, Employee>` 全4 entry。
 */
export const TO_MAP_IDENTITY_TEMPLATE = p8Template({
  templateId: 'tmpl-collect-tomap-identity',
  title: 'collect（Collectors.toMap(Employee::name, Function.identity())）',
  source: EMPLOYEES_SOURCE,
  allowedCollectorKinds: ['toMap'],
  supportedModes: ['standard', 'emptySource'],
  jdkNotes: [
    NOTE_TO_MAP_BASE,
    'キーか値のどちらかを入力要素そのものにするのは典型的な使い方であり、公式API NoteはFunction.identity()の利用を示している（例: toMap(Student::getId, Function.identity())）。',
    NOTE_MAP_TYPE_UNSPECIFIED,
    NOTE_ENCOUNTER_ORDER,
    ...TO_MAP_OUT_OF_SCOPE_NOTES,
  ],
})

/**
 * 2. 2引数版・重複キー（実行失敗形）。教材の中核。
 *    merge系3 templateと**同一データ・同一keyMapper**で「mergeがないとどうなるか」を比較する。
 */
export const TO_MAP_DUPLICATE_TEMPLATE = p8Template({
  templateId: 'tmpl-collect-tomap-duplicate',
  title: 'collect（toMap・重複キーで実行失敗）',
  source: MERGE_DEMO_SOURCE,
  allowedCollectorKinds: ['toMap'],
  supportedModes: ['standard'],
  expectedCompletion: 'EXECUTION_FAILED',
  jdkNotes: [
    NOTE_TO_MAP_BASE,
    '2引数版のtoMapでキーが重複した場合、収集の実行時にIllegalStateExceptionが送出される（"If the mapped keys contain duplicates (according to Object.equals(Object)), an IllegalStateException is thrown when the collection operation is performed."）。この教材では例外型のみを契約とし、例外メッセージ全文はJDK実装詳細として扱わない。',
    NOTE_DISPLAY_ORDER_CONVENTION,
    NOTE_COMPARE_GROUPING_BY,
    NOTE_EXISTING_GROUPING_BY_TEMPLATES,
    ...TO_MAP_OUT_OF_SCOPE_NOTES,
  ],
})

/** 3. 3引数版・first（既存値を保持 / 先勝ち）。関東=伊藤。 */
export const TO_MAP_MERGE_FIRST_TEMPLATE = p8Template({
  templateId: 'tmpl-collect-tomap-merge-first',
  title: 'collect（toMap + mergeFunction: first — 既存値を保持）',
  source: MERGE_DEMO_SOURCE,
  allowedCollectorKinds: ['toMap'],
  supportedModes: ['standard'],
  jdkNotes: [
    NOTE_TO_MAP_BASE,
    '3引数版では、キーが重複したときvalue mapping functionを各要素へ適用し、その結果をmerging functionで統合する。',
    NOTE_MERGE_ARG_ORDER,
    NOTE_FIRST_LAST_MEANING,
    NOTE_COMPARE_GROUPING_BY,
    ...TO_MAP_OUT_OF_SCOPE_NOTES,
  ],
})

/** 4. 3引数版・last（新しい値で置換 / 後勝ち）。関東=山本。 */
export const TO_MAP_MERGE_LAST_TEMPLATE = p8Template({
  templateId: 'tmpl-collect-tomap-merge-last',
  title: 'collect（toMap + mergeFunction: last — 新しい値で置換）',
  source: MERGE_DEMO_SOURCE,
  allowedCollectorKinds: ['toMap'],
  supportedModes: ['standard'],
  jdkNotes: [
    NOTE_TO_MAP_BASE,
    'mergeFunctionは「なし（例外）/ 既存値を保持（先勝ち）/ 新しい値で置換（後勝ち）/ 両方を合成（連結）」の4択で衝突の扱いを決める。',
    NOTE_MERGE_ARG_ORDER,
    NOTE_FIRST_LAST_MEANING,
    NOTE_COMPARE_GROUPING_BY,
    ...TO_MAP_OUT_OF_SCOPE_NOTES,
  ],
})

/** 5. 3引数版・concat・同一キーへ3件衝突（mergeの順次適用）。関東=`伊藤, 渡辺, 山本`。 */
export const TO_MAP_MERGE_CONCAT_TEMPLATE = p8Template({
  templateId: 'tmpl-collect-tomap-merge-concat',
  title: 'collect（toMap + mergeFunction: concat — 3件衝突の順次適用）',
  source: MERGE_DEMO_SOURCE,
  allowedCollectorKinds: ['toMap'],
  supportedModes: ['standard'],
  jdkNotes: [
    NOTE_TO_MAP_BASE,
    '同じキーへ3件以上が衝突する場合、mergeFunctionは「現在Mapにある値」へ順次適用される。公式API Noteは電話帳の例としてtoMap(Person::getName, Person::getAddress, (s, a) -> s + ", " + a)を示している。',
    NOTE_MERGE_ARG_ORDER,
    NOTE_ENCOUNTER_ORDER,
    NOTE_COMPARE_GROUPING_BY,
    ...TO_MAP_OUT_OF_SCOPE_NOTES,
  ],
})

/**
 * 6. 同一データのgroupingBy(region)比較template（v0.11 §8.6追補）。
 *    toMap非含有（既存groupingBy kindのみ）のため、取込対象性は通常どおり（importable: true）。
 */
export const GROUPING_BY_MERGE_DEMO_TEMPLATE = p8Template({
  templateId: 'tmpl-collect-groupby-mergedemo',
  title: 'collect（groupingBy(Employee::region)）— toMapとの対比',
  source: MERGE_DEMO_SOURCE,
  allowedCollectorKinds: ['groupingBy'],
  supportedModes: ['standard'],
  jdkNotes: [
    'groupingByは1つのキーに対して値のListを蓄積する（1キー多値）。同じキーの要素が何件現れてもListが伸びるだけで衝突は起きない。',
    NOTE_COMPARE_TO_MAP,
    NOTE_EXISTING_GROUPING_BY_TEMPLATES,
    'groupingByが返すMapの型・可変性・iteration orderはJDKの保証対象ではない。',
  ],
})

/** 7. 4引数版・TreeMap（キーの昇順整列）。空ソースでも空TreeMapが確定する。 */
export const TO_MAP_TREEMAP_TEMPLATE = p8Template({
  templateId: 'tmpl-collect-tomap-treemap',
  title: 'collect（toMap 4引数版 + TreeMap::new — キー昇順）',
  source: EMPLOYEES_SOURCE,
  allowedCollectorKinds: ['toMap'],
  supportedModes: ['standard', 'emptySource'],
  jdkNotes: [
    NOTE_TO_MAP_BASE,
    'Mapの実装型が必要な場合は4引数版でmapFactory（ここではTreeMap::new）を指定する。TreeMapはキーのnatural orderingで並び、Comparatorなしのコンストラクタへ入れるキーはComparableでなければならない。',
    'JavaのtoMapのoverloadは2引数 / 3引数 / 4引数の3形だけであり、mergeFunctionを省略してmapFactoryだけを指定する形は存在しない。',
    NOTE_MERGE_ARG_ORDER,
    ...TO_MAP_OUT_OF_SCOPE_NOTES,
  ],
})

/** 8. downstream形 `groupingBy(region, toMap(name, salary))`（nested Map・bucketごとの重複判定）。 */
export const TO_MAP_GROUPED_TEMPLATE = p8Template({
  templateId: 'tmpl-collect-tomap-grouped',
  title: 'collect（groupingBy(Employee::region) + toMap）— downstream形',
  source: EMPLOYEES_SOURCE,
  allowedCollectorKinds: ['groupingBy', 'toMap'],
  supportedModes: ['standard'],
  jdkNotes: [
    NOTE_TO_MAP_BASE,
    'downstreamへ置いたtoMapでは、重複キーの判定はbucketごとのMapに対して行われる。結果はMap<K1, Map<K2, U>>の入れ子になる。',
    'downstreamのtoMapで重複キーが発生した場合、そのbucketだけでなくcollect全体が失敗する。',
    NOTE_ENCOUNTER_ORDER,
    ...TO_MAP_OUT_OF_SCOPE_NOTES,
  ],
})

export const P8_TEMPLATES: readonly PipelineTemplate[] = [
  TO_MAP_IDENTITY_TEMPLATE,
  TO_MAP_DUPLICATE_TEMPLATE,
  TO_MAP_MERGE_FIRST_TEMPLATE,
  TO_MAP_MERGE_LAST_TEMPLATE,
  TO_MAP_MERGE_CONCAT_TEMPLATE,
  GROUPING_BY_MERGE_DEMO_TEMPLATE,
  TO_MAP_TREEMAP_TEMPLATE,
  TO_MAP_GROUPED_TEMPLATE,
]

/** Phase 8で追加したtemplate ID（既存走査母集団をPhase 7完了時点へ固定する際の除外集合） */
export const P8_TEMPLATE_IDS: readonly string[] = P8_TEMPLATES.map((t) => t.templateId)
