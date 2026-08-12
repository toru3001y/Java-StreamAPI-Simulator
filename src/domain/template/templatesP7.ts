import type { ParameterSlot, PipelineTemplate, PipelineTemplateNode } from './pipelineTemplate'
import {
  OP_BOXED,
  OP_FIND_FIRST,
  OP_GATHER,
  OP_SOURCE_ARRAYS_STREAM,
  OP_SOURCE_COLLECTION_STREAM,
  OP_SOURCE_STREAM_OF,
  OP_TO_LIST,
} from '../catalog/operations'
import { GATHERER_DSL_KINDS } from '../dsl/gatherAst'

/**
 * Phase 7 Gatherer教材template（指示§7.6、v0.9 §8.4）。
 *
 * v0.9 §8.4の基準必須4形（windowFixed / windowSliding / scan → toList、fold → findFirst）に、
 * 教材目標（v0.9 §4）の全実演に必要な3形（倍数ケース・入力件数<窓サイズ・stringConcat）を加えた7件。
 *
 * §8.4の合成制約を全templateで満たす:
 *   - gatherノードは1 Pipelineに1つまで
 *   - gatherノードより下流に短絡を生じる操作を置かない（fold → findFirstのみ例外）
 *
 * ファイルはtemplates.tsから分離した（`templatesP5.ts`の前例。登録は`ALL_TEMPLATES`へ
 * `...P7_TEMPLATES`として集約する）。
 */

/** gatherノードのnodeIdは全template共通（既存のnode-src / node-map / node-boxed等の命名規約に整合） */
const GATHER_NODE_ID = 'node-gather'
const GATHER_SLOT_ID = 'slot-gatherer'

const GATHER_NODE: PipelineTemplateNode = {
  nodeId: GATHER_NODE_ID,
  operationId: OP_GATHER,
  role: 'intermediate',
  slotId: GATHER_SLOT_ID,
}

/** gatherer slot。許可kindはtemplateごとに1種へ絞り、fixtureが値を供給する */
const gathererSlot = (kinds: readonly string[]): ParameterSlot => ({
  slotId: GATHER_SLOT_ID,
  targetNodeId: GATHER_NODE_ID,
  kind: 'gatherer',
  required: true,
  allowedGathererKinds: kinds,
})

const employeeSource = {
  slotId: null,
  defaultDsl: { kind: 'collection', collectionId: 'employees' } as const,
  allowedSourceKinds: ['collection'],
}

const EMPLOYEE_SRC: PipelineTemplateNode = {
  nodeId: 'node-src',
  operationId: OP_SOURCE_COLLECTION_STREAM,
  role: 'source',
  slotId: null,
}

/** source DSLをfixtureが供給するsource（streamOf / arrayPrimitive） */
function slotSource(allowedSourceKinds: readonly string[]) {
  return { slotId: 'slot-source', defaultDsl: null, allowedSourceKinds }
}

function slotSrcNode(operationId: string): PipelineTemplateNode {
  return { nodeId: 'node-src', operationId, role: 'source', slotId: 'slot-source' }
}

const TO_LIST_SINK: PipelineTemplateNode = {
  nodeId: 'node-sink',
  operationId: OP_TO_LIST,
  role: 'terminal',
  slotId: null,
}

const FIND_FIRST_SINK: PipelineTemplateNode = {
  nodeId: 'node-sink',
  operationId: OP_FIND_FIRST,
  role: 'terminal',
  slotId: null,
}

const BOXED_NODE: PipelineTemplateNode = {
  nodeId: 'node-boxed',
  operationId: OP_BOXED,
  role: 'intermediate',
  slotId: null,
}

/**
 * §8.2の実測列は最大28件だが、余裕を持たせた概算最大値を設定する
 * （実件数はinstantiateの事前実行で厳密検証される）。
 */
const GATHER_BUDGET = { limit: 500, estimatedMax: 40 } as const

const WINDOW_JDK_NOTES = [
  'windowFixed / windowSlidingが産出する窓はunmodifiable Listであり、mutatorメソッドは常にUnsupportedOperationExceptionを送出する。',
  'windowSizeが1未満のときIllegalArgumentExceptionになる。この教材ではさらに上限16の教材制約を設ける。',
] as const

const GATHER_COMMON_NOTES = [
  'Stream.gather(Gatherer)はstateful intermediate operationであり、終端の収集戦略であるCollectorに対して「中間操作の収集戦略」を差し替える拡張ポイントである。',
] as const

/**
 * 1. windowFixed（残余あり）: 窓[佐藤,鈴木,高橋]の成立push + 残余[田中]のfinisher flush。
 *    空ソースでは放出0件（v0.9 §3.2「空streamでは窓を生成しない」）。
 */
export const GATHER_WINDOW_FIXED_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-gather-window-fixed',
  version: 1,
  targetOperationId: OP_GATHER,
  targetNodeId: GATHER_NODE_ID,
  title: 'gather（Gatherers.windowFixed）— 固定サイズの窓',
  sourceDefinition: employeeSource,
  nodes: [EMPLOYEE_SRC, GATHER_NODE, TO_LIST_SINK],
  parameterSlots: [gathererSlot(['windowFixed'])],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard', 'emptySource'],
  jdkNotes: [
    ...GATHER_COMMON_NOTES,
    'windowFixedは固定サイズの窓を産出する。最後の窓は窓サイズより少ない要素数になり得る。',
    ...WINDOW_JDK_NOTES,
  ],
  snapshotBudget: GATHER_BUDGET,
}

/**
 * 2. windowFixed（入力件数が窓サイズの正確な倍数）: 窓2つ放出後、
 *    GATHER_FINISHEDは「残余なし・追加放出なし」を明示する1件のみ（v0.9 §6.2）。
 */
export const GATHER_WINDOW_FIXED_EXACT_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-gather-window-fixed-exact',
  version: 1,
  targetOperationId: OP_GATHER,
  targetNodeId: GATHER_NODE_ID,
  title: 'gather（windowFixed・倍数ケース）— 残余のない窓',
  sourceDefinition: employeeSource,
  nodes: [EMPLOYEE_SRC, GATHER_NODE, TO_LIST_SINK],
  parameterSlots: [gathererSlot(['windowFixed'])],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard'],
  jdkNotes: [
    ...GATHER_COMMON_NOTES,
    '入力件数が窓サイズの正確な倍数のとき、最後の窓も窓サイズちょうどになり、不完全窓は生じない。',
    ...WINDOW_JDK_NOTES,
  ],
  snapshotBudget: GATHER_BUDGET,
}

/**
 * 3. windowSliding（入力件数 ≥ 窓サイズ）: evict + appendの1回更新と3窓の放出。
 */
export const GATHER_WINDOW_SLIDING_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-gather-window-sliding',
  version: 1,
  targetOperationId: OP_GATHER,
  targetNodeId: GATHER_NODE_ID,
  title: 'gather（Gatherers.windowSliding）— スライドする窓',
  sourceDefinition: slotSource(['streamOf']),
  nodes: [slotSrcNode(OP_SOURCE_STREAM_OF), GATHER_NODE, TO_LIST_SINK],
  parameterSlots: [gathererSlot(['windowSliding'])],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard', 'emptySource'],
  jdkNotes: [
    ...GATHER_COMMON_NOTES,
    'windowSlidingの各窓は、直前の窓から最も古い要素を除き、次の要素を加えたものである。',
    ...WINDOW_JDK_NOTES,
  ],
  snapshotBudget: GATHER_BUDGET,
}

/**
 * 4. windowSliding（0 < 入力件数 < 窓サイズ）: 窓成立0回 → 終端finisherで全要素の1窓flush
 *    （v0.9 §3.2「If the size of the stream is smaller than the window size then only one
 *    window will be produced, containing all elements in the stream.」）。
 */
export const GATHER_WINDOW_SLIDING_SHORT_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-gather-window-sliding-short',
  version: 1,
  targetOperationId: OP_GATHER,
  targetNodeId: GATHER_NODE_ID,
  title: 'gather（windowSliding・入力 < 窓サイズ）— 終端で1窓だけ',
  sourceDefinition: slotSource(['streamOf']),
  nodes: [slotSrcNode(OP_SOURCE_STREAM_OF), GATHER_NODE, TO_LIST_SINK],
  parameterSlots: [gathererSlot(['windowSliding'])],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard'],
  jdkNotes: [
    ...GATHER_COMMON_NOTES,
    'streamの要素数が窓サイズより小さい場合、全要素を含む窓が1つだけ産出される。',
    ...WINDOW_JDK_NOTES,
  ],
  snapshotBudget: GATHER_BUDGET,
}

/**
 * 5. scan（1入力→1出力の逐次push）。gatherはStream<T>にのみ存在するため、
 *    IntStreamからはboxed()でStream<Integer>にしてからgatherへ渡す（v0.9 §2.2）。
 */
export const GATHER_SCAN_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-gather-scan',
  version: 1,
  targetOperationId: OP_GATHER,
  targetNodeId: GATHER_NODE_ID,
  title: 'gather（Gatherers.scan）— 累積値の逐次放出',
  sourceDefinition: slotSource(['arrayPrimitive']),
  nodes: [slotSrcNode(OP_SOURCE_ARRAYS_STREAM), BOXED_NODE, GATHER_NODE, TO_LIST_SINK],
  parameterSlots: [gathererSlot(['scan'])],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard', 'emptySource'],
  jdkNotes: [
    ...GATHER_COMMON_NOTES,
    'scanはPrefix Scan（incremental accumulation）であり、初期値から始めて入力要素ごとに結果を下流へ産出する。',
    'Stream.gatherはStream<T>にのみ存在し、primitive特化Stream版はJDKに存在しない。IntStream等からはboxed()経由で使用する。',
  ],
  snapshotBudget: GATHER_BUDGET,
}

/**
 * 6. scan × stringConcat: v0.9 §8.2で確定した3 kindのうちstringConcatを実行する形。
 *    基準4形＋境界2形にはstringConcatを実行するfixtureが存在せずDSL kindが死蔵になるため追加した
 *    （指示§7.6の追加判断。docs/phase-7-decisions.md）。
 */
export const GATHER_SCAN_CONCAT_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-gather-scan-concat',
  version: 1,
  targetOperationId: OP_GATHER,
  targetNodeId: GATHER_NODE_ID,
  title: 'gather（scan × 文字列連結）— String累積',
  sourceDefinition: slotSource(['streamOf']),
  nodes: [slotSrcNode(OP_SOURCE_STREAM_OF), GATHER_NODE, TO_LIST_SINK],
  parameterSlots: [gathererSlot(['scan'])],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard'],
  jdkNotes: [
    ...GATHER_COMMON_NOTES,
    'scanのBiFunctionは現在の累積値と次の入力要素から新しい累積値を作り、その値がそのまま下流へ産出される。',
  ],
  snapshotBudget: GATHER_BUDGET,
}

/**
 * 7. fold（放出なし累積 → 終端finisherで1件push）→ findFirst。
 *    fold → findFirstはv0.9 §2.2の明示的な例外（foldは全入力処理後に単一要素を放出するため、
 *    下流短絡によるgather上流の評価打切りが生じない）。Phase 4 reduceとの対比教材。
 */
export const GATHER_FOLD_TEMPLATE: PipelineTemplate = {
  templateId: 'tmpl-gather-fold',
  version: 1,
  targetOperationId: OP_GATHER,
  targetNodeId: GATHER_NODE_ID,
  title: 'gather（Gatherers.fold）— 終端で1件だけ放出',
  sourceDefinition: employeeSource,
  nodes: [EMPLOYEE_SRC, GATHER_NODE, FIND_FIRST_SINK],
  parameterSlots: [gathererSlot(['fold'])],
  allowedDslProfile: { predicateKinds: [] },
  supportedModes: ['standard', 'emptySource'],
  jdkNotes: [
    ...GATHER_COMMON_NOTES,
    'foldは "an ordered, reduction-like, transformation" であり、例外がなければ産出する要素は常に1件だけである。initialはfold操作のidentity値である。',
    'foldは中間操作であり、終端操作のreduceとは異なりStreamを返す（結果を後段の中間操作・終端操作へ渡せる）。',
  ],
  snapshotBudget: GATHER_BUDGET,
}

export const P7_TEMPLATES: readonly PipelineTemplate[] = [
  GATHER_WINDOW_FIXED_TEMPLATE,
  GATHER_WINDOW_FIXED_EXACT_TEMPLATE,
  GATHER_WINDOW_SLIDING_TEMPLATE,
  GATHER_WINDOW_SLIDING_SHORT_TEMPLATE,
  GATHER_SCAN_TEMPLATE,
  GATHER_SCAN_CONCAT_TEMPLATE,
  GATHER_FOLD_TEMPLATE,
]

/** gatherノードを含むtemplate ID（テスト・取込対象外判定の参照用） */
export const P7_TEMPLATE_IDS: readonly string[] = P7_TEMPLATES.map((t) => t.templateId)

/** 全Gatherer kindがいずれかのtemplateで実行されることを保証するための参照 */
export const P7_COVERED_GATHERER_KINDS: readonly string[] = GATHERER_DSL_KINDS
