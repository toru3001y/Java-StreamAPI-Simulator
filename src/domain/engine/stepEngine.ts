import type { PipelineDefinition, PipelineNodeDef } from '../pipeline/pipelineDefinition'
import type { ElementStateKind } from '../catalog/operationCatalog'
import {
  evaluatePredicate,
  evaluateValuePredicate,
  predicateComparisonValue,
} from '../dsl/evaluate'
import { evaluateFlatMapper, evaluateMapper } from '../dsl/evaluateMapper'
import { compareByComparator, comparatorKeyLabel, sortBuffer } from '../dsl/evaluateComparator'
import { evaluateConsumerMessage } from '../dsl/evaluateConsumer'
import { consumerActionLabel } from '../dsl/consumerAst'
import { applyReduction, identityToSimValue } from '../dsl/evaluateReduction'
import {
  comparisonExpr,
  describeComparator,
  describeConsumer,
  describeMapper,
  describePredicate,
  fieldValueFlow,
} from '../dsl/explanation'
import {
  comparatorToJavaExpr,
  consumerToJavaExpr,
  identityToJavaLiteral,
  mapperToJavaExpr,
  predicateToJavaExpr,
  reductionToJavaExpr,
} from '../dsl/javaCode'
import { distinctKeyOf } from './distinctKey'
import type { CollectorRuntime } from './collectorRuntime'
import {
  collectorAccumulate,
  collectorAtRootPath,
  collectorContextView,
  collectorCreateContainer,
  collectorFinalLabel,
  collectorFinish,
  collectorNeedsContainerCreated,
  collectorResultView,
  collectorUsesOutputItems,
  createCollectorRuntime,
} from './collectorRuntime'
import {
  formatDoubleLiteral,
  formatLongLiteral,
  formatSimValue,
  type SimValue,
} from '../model/value'
import { formatTypeRef } from '../types/typeRef'
import type { ElementId, NodeId } from '../types/ids'
import { snapshotIdFor } from '../types/ids'
import { deepFreeze } from '../util/deepFreeze'
import type {
  FlatMapContextView,
  OperationContextView,
  ProcessingView,
  SideEffectEntry,
  Snapshot,
  SnapshotKind,
  SnapshotOutputItem,
  SortedOrderEntry,
  SourceContextView,
  TerminalResultView,
} from './snapshot'

/**
 * Step Engine（§13、Phase 3指示 §7・§10）。
 * PipelineDefinitionから決定的なsnapshot列（timeline）を純粋に導出する。
 * next(currentSnapshot, def)は保存済みtimelineの次要素を返すだけであり、
 * 同じrevisionからは常に同じsnapshot列が得られる（§12.6、§19）。
 * DOM、タイマー、アニメーションへ依存しない。
 *
 * Phase 3では要素1件のdepth-first規則を維持しつつ、次の3種の処理を合成する（§10）:
 *   1. 即時通過 / 除外（filter、map系、distinct、skip、takeWhile、dropWhile、peek）
 *   2. 保持してupstream完了後にflush（sorted）
 *   3. 確定後にupstreamへ追加要求しない（limit、takeWhile）
 * これらはtarget operation専用の固定分岐ではなく、検証済みノード列に対する
 * node handler + finish / flush / cancel伝播として実装する。
 *
 * J-3: 検証はPipelineDefinition生成前に完了しているため、実行時のEngineInvariantErrorは
 * エンジン内部の不整合を検知した場合のフェイルセーフに限る（docs/phase-1-decisions.md）。
 */
export class EngineInvariantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineInvariantError'
  }
}

/** 説明文用の短い要素名（Employeeは氏名、その他は表示ラベル） */
function shortLabel(value: SimValue): string {
  return value.kind === 'employee' ? value.value.name : formatSimValue(value)
}

function boxValue(value: SimValue): SimValue {
  switch (value.kind) {
    case 'int':
      return { kind: 'boxedInt', value: value.value }
    case 'long':
      return { kind: 'boxedLong', value: value.value }
    case 'double':
      return { kind: 'boxedDouble', value: value.value }
    default:
      throw new EngineInvariantError(`boxedはprimitive要素が必要です: ${value.kind}`)
  }
}

interface MutableFlatMapCtx {
  nodeId: string
  parentElementId: ElementId
  parentLabel: string
  children: { id: ElementId; label: string }[]
  emittedCount: number
  closed: boolean
}

// ---- Phase 3 node runtime（操作固有状態。node単位で保持し混同しない。§7.1） ----

interface DistinctRuntime {
  readonly kind: 'distinct'
  readonly node: PipelineNodeDef
  readonly seenKeys: Set<string>
  readonly seen: { key: string; label: string }[]
  currentLabel: string | null
  verdict: 'FIRST' | 'DUPLICATE' | null
}

interface SortedBufferEntry {
  readonly id: ElementId
  readonly label: string
  readonly keyLabel: string
  readonly value: SimValue
}

interface SortedRuntime {
  readonly kind: 'sorted'
  readonly node: PipelineNodeDef
  readonly buffer: SortedBufferEntry[]
  confirmed: SortedBufferEntry[] | null
  phase: 'BUFFERING' | 'ORDER_CONFIRMED' | 'EMITTING'
  emittedCount: number
}

interface LimitRuntime {
  readonly kind: 'limit'
  readonly node: PipelineNodeDef
  readonly maxSize: number
  passedCount: number
  reached: boolean
  pendingShortCircuit: boolean
  upstreamStopped: boolean
}

interface SkipRuntime {
  readonly kind: 'skip'
  readonly node: PipelineNodeDef
  readonly n: number
  skippedCount: number
}

interface TakeWhileRuntime {
  readonly kind: 'takeWhile'
  readonly node: PipelineNodeDef
  stopped: boolean
  boundaryElementId: ElementId | null
  boundaryLabel: string | null
}

interface DropWhileRuntime {
  readonly kind: 'dropWhile'
  readonly node: PipelineNodeDef
  dropping: boolean
  boundaryElementId: ElementId | null
  boundaryLabel: string | null
}

interface PeekRuntime {
  readonly kind: 'peek'
  readonly node: PipelineNodeDef
  callCount: number
}

type NodeRuntime =
  | DistinctRuntime
  | SortedRuntime
  | LimitRuntime
  | SkipRuntime
  | TakeWhileRuntime
  | DropWhileRuntime
  | PeekRuntime

interface Draft {
  kind: SnapshotKind
  activeNode: PipelineNodeDef | null
  currentElementId: ElementId | null
  parentElementId: ElementId | null
  processing: ProcessingView | null
  currentText: string
  jdkNote: string | null
  typeTransition: string | null
  flatMapContext: FlatMapContextView | null
  sourceContext: SourceContextView | null
  operationContexts: Record<NodeId, OperationContextView>
  sideEffects: SideEffectEntry[]
  perNode: Record<ElementId, Record<string, ElementStateKind>>
  latest: Record<ElementId, ElementStateKind>
  outputItems: SnapshotOutputItem[]
  terminalResult: TerminalResultView
  confirmed: boolean
  completion: 'NONE' | 'STREAM_CONSUMED'
}

interface PushInput {
  kind: SnapshotKind
  activeNode: PipelineNodeDef | null
  currentElementId?: ElementId | null
  parentElementId?: ElementId | null
  processing?: ProcessingView | null
  currentText: string
  jdkNote?: string | null
  typeTransition?: string | null
  sourceContext?: SourceContextView | null
  confirmed?: boolean
  completion?: 'NONE' | 'STREAM_CONSUMED'
}

class TimelineBuilder {
  readonly drafts: Draft[] = []
  private readonly def: PipelineDefinition
  private readonly perNode: Record<ElementId, Record<string, ElementStateKind>> = {}
  private readonly latest: Record<ElementId, ElementStateKind> = {}
  private readonly outputItems: SnapshotOutputItem[] = []
  private readonly contexts: Record<NodeId, OperationContextView> = {}
  private readonly sideEffects: SideEffectEntry[] = []
  /** 終端結果の現在view（Phase 4指示 §7。terminal runtimeが更新する） */
  terminalResult: TerminalResultView = { kind: 'LIST' }
  private flatMapCtx: MutableFlatMapCtx | null = null
  /** 短絡確定により入力を受け付けなくなったchain index（上流はこれ以上要素を送らない） */
  cancelIdx: number | null = null

  constructor(def: PipelineDefinition) {
    this.def = def
  }

  registerElement(elementId: ElementId): void {
    const states: Record<string, ElementStateKind> = {}
    for (const node of this.def.nodes) states[node.nodeId] = 'UNEVALUATED'
    this.perNode[elementId] = states
    this.latest[elementId] = 'UNEVALUATED'
  }

  setState(elementId: ElementId, nodeId: string, state: ElementStateKind): void {
    const states = this.perNode[elementId]
    if (!states) throw new EngineInvariantError(`未登録の要素です: ${elementId}`)
    states[nodeId] = state
  }

  setLatest(elementId: ElementId, state: ElementStateKind): void {
    if (!(elementId in this.latest)) {
      throw new EngineInvariantError(`未登録の要素です: ${elementId}`)
    }
    this.latest[elementId] = state
  }

  addOutput(elementId: ElementId, label: string): void {
    this.outputItems.push({ id: elementId, label })
  }

  get outputCount(): number {
    return this.outputItems.length
  }

  setContext(nodeId: NodeId, view: OperationContextView): void {
    this.contexts[nodeId] = view
  }

  addSideEffect(entry: Omit<SideEffectEntry, 'seq'>): SideEffectEntry {
    const withSeq: SideEffectEntry = { ...entry, seq: this.sideEffects.length + 1 }
    this.sideEffects.push(withSeq)
    return withSeq
  }

  cancelAt(chainIdx: number): void {
    this.cancelIdx = this.cancelIdx === null ? chainIdx : Math.min(this.cancelIdx, chainIdx)
  }

  /** emitter（source: -1）から見て下流に短絡確定ノードがあるか */
  cancelledBeyond(emitterIdx: number): boolean {
    return this.cancelIdx !== null && this.cancelIdx > emitterIdx
  }

  openFlatMapCtx(ctx: MutableFlatMapCtx): void {
    this.flatMapCtx = ctx
  }

  get currentFlatMapCtx(): MutableFlatMapCtx | null {
    return this.flatMapCtx
  }

  clearFlatMapCtx(): void {
    this.flatMapCtx = null
  }

  push(input: PushInput): void {
    this.drafts.push({
      kind: input.kind,
      activeNode: input.activeNode,
      currentElementId: input.currentElementId ?? null,
      parentElementId: input.parentElementId ?? null,
      processing: input.processing ?? null,
      currentText: input.currentText,
      jdkNote: input.jdkNote ?? null,
      typeTransition: input.typeTransition ?? null,
      flatMapContext: this.flatMapCtx ? structuredClone(this.flatMapCtx) : null,
      sourceContext: input.sourceContext ?? null,
      operationContexts: structuredClone(this.contexts),
      sideEffects: [...this.sideEffects],
      perNode: structuredClone(this.perNode),
      latest: structuredClone(this.latest),
      outputItems: [...this.outputItems],
      terminalResult: structuredClone(this.terminalResult),
      confirmed: input.confirmed ?? false,
      completion: input.completion ?? 'NONE',
    })
  }

  /** 直近のdraftの状態・flatMap文脈を現在値で更新する（close詳細の反映用） */
  patchLastDraft(): void {
    const last = this.drafts[this.drafts.length - 1]
    if (!last) throw new EngineInvariantError('patch対象のsnapshotがありません')
    last.perNode = structuredClone(this.perNode)
    last.latest = structuredClone(this.latest)
    last.flatMapContext = this.flatMapCtx ? structuredClone(this.flatMapCtx) : null
  }
}

function nodesOf(def: PipelineDefinition): {
  src: PipelineNodeDef
  chain: readonly PipelineNodeDef[]
  sink: PipelineNodeDef
} {
  const src = def.nodes.find((n) => n.role === 'source')
  const sink = def.nodes.find((n) => n.role === 'terminal')
  if (!src || !sink) throw new EngineInvariantError('source / terminal nodeが存在しません')
  return { src, chain: def.nodes.filter((n) => n.role === 'intermediate'), sink }
}

function predicateOf(node: PipelineNodeDef) {
  if (!node.predicate) {
    throw new EngineInvariantError(`node ${node.nodeId} にPredicateがありません`)
  }
  return node.predicate
}

function mapperOf(node: PipelineNodeDef) {
  if (!node.mapper) {
    throw new EngineInvariantError(`node ${node.nodeId} にmapperがありません`)
  }
  return node.mapper
}

function typeTransitionOf(node: PipelineNodeDef): string {
  return `${node.inputType ? formatTypeRef(node.inputType) : '?'} → ${formatTypeRef(node.outputType)}`
}

const MAP_FAMILY = ['map', 'mapToInt', 'mapToLong', 'mapToDouble', 'boxed', 'mapToObj'] as const
const FLAT_MAP_FAMILY = ['flatMap', 'flatMapToInt', 'flatMapToLong', 'flatMapToDouble'] as const

function isMapFamily(operationId: string): boolean {
  return (MAP_FAMILY as readonly string[]).includes(operationId)
}

function isFlatMapFamily(operationId: string): boolean {
  return (FLAT_MAP_FAMILY as readonly string[]).includes(operationId)
}

function countOf(node: PipelineNodeDef): number {
  if (node.count === null) {
    throw new EngineInvariantError(`node ${node.nodeId} にcountがありません`)
  }
  return node.count
}

/** sorted固有contextのview（§7.3の6項目） */
function sortedContextView(rt: SortedRuntime, def: PipelineDefinition): OperationContextView {
  const toEntry = (e: SortedBufferEntry): SortedOrderEntry => ({
    id: e.id,
    label: e.label,
    keyLabel: e.keyLabel,
  })
  return {
    kind: 'sorted',
    nodeId: rt.node.nodeId,
    phase: rt.phase,
    comparatorLabel: rt.node.comparator
      ? comparatorToJavaExpr(rt.node.comparator)
      : 'natural order（Comparable）',
    keyDescription: describeComparator(rt.node.comparator),
    bufferOrder: rt.buffer.map(toEntry),
    confirmedOrder: rt.confirmed ? rt.confirmed.map(toEntry) : null,
    emittedCount: rt.emittedCount,
    // unordered Streamではstableを保証する説明を出さない（§7.3）
    stableNote: def.orderMeta.sourceOrdered
      ? '同値キーの要素は元のencounter orderを維持します（stable sort）'
      : null,
  }
}

function contextViewOf(rt: NodeRuntime, def: PipelineDefinition): OperationContextView {
  switch (rt.kind) {
    case 'distinct':
      return {
        kind: 'distinct',
        nodeId: rt.node.nodeId,
        seen: rt.seen.map((s) => ({ ...s })),
        currentLabel: rt.currentLabel,
        verdict: rt.verdict,
      }
    case 'sorted':
      return sortedContextView(rt, def)
    case 'limit':
      return {
        kind: 'limit',
        nodeId: rt.node.nodeId,
        maxSize: rt.maxSize,
        passedCount: rt.passedCount,
        reached: rt.reached,
        upstreamStopped: rt.upstreamStopped,
      }
    case 'skip':
      return {
        kind: 'skip',
        nodeId: rt.node.nodeId,
        n: rt.n,
        skippedCount: rt.skippedCount,
        passMode: rt.skippedCount >= rt.n,
      }
    case 'takeWhile':
      return {
        kind: 'takeWhile',
        nodeId: rt.node.nodeId,
        predicateText: predicateToJavaExpr(predicateOf(rt.node)),
        stopped: rt.stopped,
        boundaryElementId: rt.boundaryElementId,
        boundaryLabel: rt.boundaryLabel,
      }
    case 'dropWhile':
      return {
        kind: 'dropWhile',
        nodeId: rt.node.nodeId,
        predicateText: predicateToJavaExpr(predicateOf(rt.node)),
        mode: rt.dropping ? 'DROPPING' : 'PASSING',
        boundaryElementId: rt.boundaryElementId,
        boundaryLabel: rt.boundaryLabel,
      }
    case 'peek':
      return {
        kind: 'peek',
        nodeId: rt.node.nodeId,
        consumerText: rt.node.consumer ? consumerToJavaExpr(rt.node.consumer) : '',
        callCount: rt.callCount,
      }
  }
}

// ---- Phase 4: terminal runtime（指示§10）。終端は1 Pipelineに1つ ----

interface TerminalRuntime {
  readonly node: PipelineNodeDef
  /** 入力primitive Streamの要素型（object Streamではnull） */
  readonly primitive: 'int' | 'long' | 'double' | null
  // reduce
  acc: SimValue | null
  stepCount: number
  readonly history: {
    seq: number
    inputLabel: string
    beforeLabel: string | null
    afterLabel: string
  }[]
  // count
  count: number
  // min / max
  candidate: { id: ElementId; value: SimValue } | null
  updateCount: number
  // match / find
  decided: boolean
  resultValue: boolean | null
  evaluatedCount: number
  selected: { id: ElementId; label: string } | null
  // sum / average / statistics
  aggCount: number
  aggSum: number
  aggMin: number | null
  aggMax: number | null
  // toArray
  readonly stored: { index: number; label: string }[]
  // forEach系
  callCount: number
  // short-circuit（find / match）
  pendingShortCircuit: boolean
  upstreamStopped: boolean
}

function createTerminalRuntime(node: PipelineNodeDef): TerminalRuntime {
  const primitive =
    node.inputType?.kind === 'primitiveStream'
      ? node.inputType.name === 'IntStream'
        ? 'int'
        : node.inputType.name === 'LongStream'
          ? 'long'
          : 'double'
      : null
  return {
    node,
    primitive,
    acc: null,
    stepCount: 0,
    history: [],
    count: 0,
    candidate: null,
    updateCount: 0,
    decided: false,
    resultValue: null,
    evaluatedCount: 0,
    selected: null,
    aggCount: 0,
    aggSum: 0,
    aggMin: null,
    aggMax: null,
    stored: [],
    callCount: 0,
    pendingShortCircuit: false,
    upstreamStopped: false,
  }
}

function primitiveValueLabel(primitive: 'int' | 'long' | 'double', n: number): string {
  return primitive === 'int' ? String(n) : primitive === 'long' ? formatLongLiteral(n) : formatDoubleLiteral(n)
}

const COUNT_ELISION_NOTE =
  'JDKは結果を直接算出できる場合、Pipeline（peek等）の評価を省略することがあります。常に省略される保証も、必ず評価される保証もありません。'

const FIND_ANY_NOTE =
  '教材fixtureでは毎回同じ要素を選択しますが、JDKはfindAnyでどの要素が返るかを保証しません（特にparallel実行）。'

const FIND_FIRST_UNORDERED_NOTE =
  'このsourceにはencounter orderがないため、findFirstでも任意の要素になり得ます。'

/** reduceのJava式表示（identity / combinerを含む） */
function reduceExpression(node: PipelineNodeDef): string {
  if (!node.reduction) throw new EngineInvariantError(`node ${node.nodeId} にreductionがありません`)
  const parts: string[] = []
  if (node.identity) parts.push(identityToJavaLiteral(node.identity))
  parts.push(reductionToJavaExpr(node.reduction))
  if (node.hasCombiner && node.identity) {
    parts.push(
      node.identity.type === 'int'
        ? 'Integer::sum'
        : node.identity.type === 'long'
          ? 'Long::sum'
          : node.identity.type === 'double'
            ? 'Double::sum'
            : 'String::concat',
    )
  }
  return `.reduce(${parts.join(', ')})`
}

/** terminal固有contextのview（§12） */
function terminalContextView(rt: TerminalRuntime, def: PipelineDefinition): OperationContextView | null {
  const node = rt.node
  switch (node.operationId) {
    case 'reduce':
      return {
        kind: 'reduce',
        nodeId: node.nodeId,
        expression: reduceExpression(node),
        identityLabel: node.identity ? identityToJavaLiteral(node.identity) : null,
        hasCombiner: node.hasCombiner,
        combinerCallCount: 0,
        accumulatorLabel: rt.acc ? formatSimValue(rt.acc) : null,
        stepCount: rt.stepCount,
        history: rt.history.map((h) => ({ ...h })),
      }
    case 'count':
      return { kind: 'count', nodeId: node.nodeId, currentCount: rt.count, elisionNote: COUNT_ELISION_NOTE }
    case 'min':
    case 'max':
      return {
        kind: 'minmax',
        nodeId: node.nodeId,
        op: node.operationId,
        comparatorLabel: node.comparator
          ? comparatorToJavaExpr(node.comparator)
          : 'primitive比較（数値の大小）',
        candidateLabel: rt.candidate ? formatSimValue(rt.candidate.value) : null,
        candidateElementId: rt.candidate?.id ?? null,
        updateCount: rt.updateCount,
      }
    case 'anyMatch':
    case 'allMatch':
    case 'noneMatch':
      return {
        kind: 'match',
        nodeId: node.nodeId,
        op: node.operationId,
        predicateText: node.predicate ? predicateToJavaExpr(node.predicate) : '',
        evaluatedCount: rt.evaluatedCount,
        decided: rt.decided,
        resultValue: rt.resultValue,
        vacuousNote:
          rt.evaluatedCount === 0 && rt.resultValue === true
            ? node.operationId === 'allMatch'
              ? '空Streamでは反例が存在しないため、allMatchはtrueです（vacuous truth）。Predicateは一度も評価されていません。'
              : '空Streamでは該当が存在しないため、noneMatchはtrueです（vacuous truth）。Predicateは一度も評価されていません。'
            : null,
      }
    case 'findFirst':
    case 'findAny':
      return {
        kind: 'find',
        nodeId: node.nodeId,
        op: node.operationId,
        decided: rt.decided,
        selectedLabel: rt.selected?.label ?? null,
        selectedElementId: rt.selected?.id ?? null,
        nondeterminismNote:
          node.operationId === 'findAny'
            ? FIND_ANY_NOTE
            : def.orderMeta.sourceOrdered
              ? null
              : FIND_FIRST_UNORDERED_NOTE,
      }
    case 'sum':
    case 'average':
    case 'summaryStatistics': {
      const primitive = rt.primitive ?? 'int'
      return {
        kind: 'aggregate',
        nodeId: node.nodeId,
        op: node.operationId,
        primitive,
        count: rt.aggCount,
        sumLabel:
          node.operationId === 'summaryStatistics' && primitive === 'int'
            ? formatLongLiteral(rt.aggSum)
            : primitiveValueLabel(primitive, rt.aggSum),
        minLabel: rt.aggMin === null ? null : primitiveValueLabel(primitive, rt.aggMin),
        maxLabel: rt.aggMax === null ? null : primitiveValueLabel(primitive, rt.aggMax),
        averageLabel: rt.aggCount === 0 ? null : formatDoubleLiteral(rt.aggSum / rt.aggCount),
      }
    }
    case 'toArray':
      return {
        kind: 'array',
        nodeId: node.nodeId,
        componentTypeLabel:
          def.resultType.kind === 'array' ? formatTypeRef(def.resultType.elementType) : '?',
        storedCount: rt.stored.length,
      }
    case 'forEach':
    case 'forEachOrdered':
      return {
        kind: 'forEach',
        nodeId: node.nodeId,
        op: node.operationId,
        consumerText: node.consumer ? consumerToJavaExpr(node.consumer) : '',
        callCount: rt.callCount,
        orderingNote:
          node.operationId === 'forEach'
            ? 'parallel StreamのforEachは実行順序を保証しません。sequential実行（初版）では記述順に実行されます。'
            : 'forEachOrderedはparallelでもencounter orderを保証します。sequential実行（初版）ではforEachと同じ順序です。',
      }
    default:
      return null
  }
}

/** 空SummaryStatisticsの正規初期値ラベル（§6.4） */
function emptyStatsLabels(primitive: 'int' | 'long' | 'double'): {
  min: string
  max: string
  sum: string
} {
  if (primitive === 'int') return { min: 'Integer.MAX_VALUE', max: 'Integer.MIN_VALUE', sum: '0L' }
  if (primitive === 'long') return { min: 'Long.MAX_VALUE', max: 'Long.MIN_VALUE', sum: '0L' }
  return { min: 'Double.POSITIVE_INFINITY', max: 'Double.NEGATIVE_INFINITY', sum: '0.0' }
}

/** 終端結果の構造化view（§7）。UIはこの確定値だけを描画する */
function terminalResultView(rt: TerminalRuntime, def: PipelineDefinition): TerminalResultView {
  const node = rt.node
  const resultType = def.resultType
  const optionalView = (
    present: boolean,
    valueLabel: string | null,
    valueElementId: ElementId | null,
  ): TerminalResultView => ({
    kind: 'OPTIONAL',
    optionalTypeLabel: resultType.kind === 'primitiveOptional' ? resultType.name : 'Optional',
    elementTypeLabel:
      resultType.kind === 'optional' ? formatTypeRef(resultType.elementType) : null,
    present,
    valueLabel,
    valueElementId,
  })
  switch (node.operationId) {
    case 'count':
      return { kind: 'SCALAR', typeLabel: 'long', valueLabel: formatLongLiteral(rt.count) }
    case 'reduce':
      if (node.identity) {
        return {
          kind: 'SCALAR',
          typeLabel: formatTypeRef(resultType),
          valueLabel: rt.acc ? formatSimValue(rt.acc) : identityToJavaLiteral(node.identity),
        }
      }
      return optionalView(rt.acc !== null, rt.acc ? formatSimValue(rt.acc) : null, null)
    case 'min':
    case 'max':
      return optionalView(
        rt.candidate !== null,
        rt.candidate ? formatSimValue(rt.candidate.value) : null,
        rt.candidate?.id ?? null,
      )
    case 'findFirst':
    case 'findAny':
      return optionalView(rt.selected !== null, rt.selected?.label ?? null, rt.selected?.id ?? null)
    case 'anyMatch':
    case 'allMatch':
    case 'noneMatch':
      return {
        kind: 'SCALAR',
        typeLabel: 'boolean',
        valueLabel: rt.resultValue === null ? '未確定' : String(rt.resultValue),
      }
    case 'sum': {
      const primitive = rt.primitive ?? 'int'
      return {
        kind: 'SCALAR',
        typeLabel: primitive,
        valueLabel: primitiveValueLabel(primitive, rt.aggSum),
      }
    }
    case 'average':
      return optionalView(
        rt.aggCount > 0,
        rt.aggCount > 0 ? formatDoubleLiteral(rt.aggSum / rt.aggCount) : null,
        null,
      )
    case 'summaryStatistics': {
      const primitive = rt.primitive ?? 'int'
      const empty = rt.aggCount === 0
      const labels = emptyStatsLabels(primitive)
      return {
        kind: 'STATISTICS',
        statisticsTypeLabel: formatTypeRef(resultType),
        countLabel: String(rt.aggCount),
        sumLabel: empty
          ? labels.sum
          : primitive === 'int'
            ? formatLongLiteral(rt.aggSum)
            : primitiveValueLabel(primitive, rt.aggSum),
        minLabel: empty ? labels.min : primitiveValueLabel(primitive, rt.aggMin ?? 0),
        maxLabel: empty ? labels.max : primitiveValueLabel(primitive, rt.aggMax ?? 0),
        averageLabel: empty ? '0.0' : formatDoubleLiteral(rt.aggSum / rt.aggCount),
        emptyNote: empty
          ? '空Streamの正規初期値です（min / maxは型のMAX_VALUE / MIN_VALUE、doubleは正負Infinity）。'
          : null,
      }
    }
    case 'toArray':
      return {
        kind: 'ARRAY',
        componentTypeLabel:
          resultType.kind === 'array' ? formatTypeRef(resultType.elementType) : '?',
        length: rt.stored.length,
        items: rt.stored.map((s) => ({ index: s.index, label: s.label })),
      }
    case 'forEach':
    case 'forEachOrdered':
      return { kind: 'VOID' }
    default:
      return { kind: 'LIST' }
  }
}

function createRuntime(node: PipelineNodeDef): NodeRuntime | null {
  switch (node.operationId) {
    case 'distinct':
      return { kind: 'distinct', node, seenKeys: new Set(), seen: [], currentLabel: null, verdict: null }
    case 'sorted':
      return { kind: 'sorted', node, buffer: [], confirmed: null, phase: 'BUFFERING', emittedCount: 0 }
    case 'limit':
      return {
        kind: 'limit',
        node,
        maxSize: countOf(node),
        passedCount: 0,
        reached: false,
        pendingShortCircuit: false,
        upstreamStopped: false,
      }
    case 'skip':
      return { kind: 'skip', node, n: countOf(node), skippedCount: 0 }
    case 'takeWhile':
      return { kind: 'takeWhile', node, stopped: false, boundaryElementId: null, boundaryLabel: null }
    case 'dropWhile':
      return { kind: 'dropWhile', node, dropping: true, boundaryElementId: null, boundaryLabel: null }
    case 'peek':
      return { kind: 'peek', node, callCount: 0 }
    default:
      return null
  }
}

function buildTimeline(def: PipelineDefinition): Snapshot[] {
  const b = new TimelineBuilder(def)
  const { src, chain, sink } = nodesOf(def)

  // Phase 3 node runtime（node単位。同一操作の複数ノードも混同しない。§7.1）
  const runtimes = new Map<NodeId, NodeRuntime>()
  for (const node of chain) {
    const rt = createRuntime(node)
    if (rt) {
      runtimes.set(node.nodeId, rt)
      b.setContext(node.nodeId, contextViewOf(rt, def))
    }
  }

  for (const element of def.dataset) b.registerElement(element.elementId)

  // Phase 5 Collector runtime（collect / 3引数collect。§9）
  const isCollect = sink.operationId === 'collect' || sink.operationId === 'collectTriple'
  let collectorRt: CollectorRuntime | null = null
  if (isCollect) {
    if (!sink.inputType || sink.inputType.kind !== 'stream') {
      throw new EngineInvariantError(`node ${sink.nodeId} はobject Streamの入力が必要です`)
    }
    collectorRt = createCollectorRuntime(
      sink.nodeId,
      sink.inputType.elementType,
      sink.collector,
      sink.collectTriple,
    )
  }
  const syncCollector = (): void => {
    if (!collectorRt) return
    b.setContext(sink.nodeId, collectorContextView(collectorRt))
    b.terminalResult = collectorResultView(collectorRt)
  }
  syncCollector()

  // Phase 4 terminal runtime（toList・collect系以外の終端。§10）
  const terminalRt =
    sink.operationId === 'toList' || isCollect ? null : createTerminalRuntime(sink)
  const syncTerminal = (): void => {
    if (!terminalRt) return
    const ctx = terminalContextView(terminalRt, def)
    if (ctx) b.setContext(sink.nodeId, ctx)
    b.terminalResult = terminalResultView(terminalRt, def)
  }
  syncTerminal()

  b.push({
    kind: 'INITIAL',
    activeNode: null,
    currentText: '初期状態です。まだ要素は処理されていません。',
  })

  const syncContext = (rt: NodeRuntime): void => {
    b.setContext(rt.node.nodeId, contextViewOf(rt, def))
  }

  /**
   * 短絡が確定したlimitノード / terminal（find・match）のSHORT_CIRCUIT_CONFIRMEDを
   * 独立snapshotとして確定し、上流への追加要求を停止する（§7.4、Phase 4指示§10）。
   * 要素が後段を流れ切った後に呼ぶ。limitとterminal短絡が組み合わさった場合は、
   * より早い確定位置（chain順で最初のpending）から停止する。
   */
  const confirmPendingShortCircuits = (): void => {
    if (terminalRt?.pendingShortCircuit && !terminalRt.upstreamStopped) {
      terminalRt.pendingShortCircuit = false
      terminalRt.upstreamStopped = true
      syncTerminal()
      b.push({
        kind: 'SHORT_CIRCUIT_CONFIRMED',
        activeNode: sink,
        currentElementId: null,
        processing: {
          title: `short-circuit確定（${sink.displayName}）`,
          inputLabel: null,
          expression: null,
          evaluation: null,
          outcome: '終端結果が確定したため、上流への要素要求を停止します',
        },
        currentText: `${sink.displayName}の結果が確定しました。これ以上の要素は要求されず、残りは未評価のままです。`,
        jdkNote: `${sink.displayName}はshort-circuiting終端操作であり、結果確定後の残り要素は評価されません。`,
      })
      // terminalの短絡は全上流（source・sorted放出・flatMap子送出）を停止する
      b.cancelAt(chain.length)
    }
    chain.forEach((node, i) => {
      const rt = runtimes.get(node.nodeId)
      if (rt?.kind === 'limit' && rt.pendingShortCircuit && !rt.upstreamStopped) {
        rt.pendingShortCircuit = false
        rt.upstreamStopped = true
        syncContext(rt)
        b.push({
          kind: 'SHORT_CIRCUIT_CONFIRMED',
          activeNode: node,
          currentElementId: null,
          processing: {
            title: 'short-circuit確定（limit上限到達）',
            inputLabel: `通過数 ${rt.passedCount}/${rt.maxSize}`,
            expression: `.limit(${rt.maxSize})`,
            evaluation: null,
            outcome: '上限に到達したため、上流への要素要求を停止します',
          },
          currentText: `limit(${rt.maxSize})の上限に到達しました。これ以上の要素は要求されず、残りは未評価のままです。`,
          jdkNote: 'limitはshort-circuiting操作であり、上限到達後の残り要素は評価されません（除外ではなく未評価）。',
        })
        b.cancelAt(i)
      }
    })
  }

  /**
   * 終端へ到達した1要素の処理（Phase 4指示§6・§10）。
   * terminal内部状態を更新し、対応する独立snapshotを1件確定する。
   */
  const handleTerminalElement = (
    elementId: ElementId,
    value: SimValue,
    parentElementId: ElementId | null,
  ): boolean => {
    const label = formatSimValue(value)
    const name = shortLabel(value)
    b.setState(elementId, sink.nodeId, 'PASSED')
    b.setLatest(elementId, 'PASSED')

    // Phase 5 Collector: 到着 → 経路・蓄積の確定snapshot列（§9.1）
    if (collectorRt) {
      const rt = collectorRt
      b.push({
        kind: 'NODE_ARRIVAL',
        activeNode: sink,
        currentElementId: elementId,
        parentElementId,
        processing: {
          title: `${sink.displayName}への要素到着`,
          inputLabel: `${name} → collect`,
          expression: null,
          evaluation: null,
          outcome: 'Collectorへ渡されます',
        },
        currentText: `${name}が${sink.displayName}へ到着しました。`,
      })
      collectorAccumulate(rt, elementId, value, (input) => {
        // rootがLIST variantのときだけ既存のSnapshotOutput.itemsへ追加する（非破壊の再利用）
        if (
          collectorUsesOutputItems(rt) &&
          input.kind === 'CONTAINER_UPDATED' &&
          collectorAtRootPath(rt)
        ) {
          b.addOutput(elementId, label)
        }
        syncCollector()
        b.push({
          kind: input.kind,
          activeNode: sink,
          currentElementId: input.currentElementId,
          parentElementId,
          processing: input.processing,
          currentText: input.currentText,
          jdkNote: input.jdkNote ?? null,
        })
      })
      return true
    }

    // toList: Phase 1からの既存動作を維持
    if (!terminalRt) {
      b.addOutput(elementId, label)
      b.push({
        kind: 'SINK_APPENDED',
        activeNode: sink,
        currentElementId: elementId,
        parentElementId,
        processing: {
          title: 'toListへの要素追加',
          inputLabel: `${name} → List`,
          expression: null,
          evaluation: null,
          outcome: 'Listへ追加されました',
        },
        currentText: `${name}がtoListのListへ追加されます。`,
      })
      return true
    }

    const rt = terminalRt
    switch (sink.operationId) {
      case 'reduce': {
        const reduction = sink.reduction
        if (!reduction) throw new EngineInvariantError('reduceにreductionがありません')
        const expression = reduceExpression(sink)
        const contribution =
          reduction.kind === 'employeeFieldSum' && value.kind === 'employee'
            ? reduction.field === 'salary'
              ? formatLongLiteral(value.value.salary)
              : String(value.value.age)
            : label
        const inputLabel =
          reduction.kind === 'employeeFieldSum' && value.kind === 'employee'
            ? `${name}.${reduction.field}() → ${contribution}`
            : label
        if (rt.acc === null) {
          // identityなし: 最初の要素を初期累積値として独立して表示する（§6.1）
          rt.acc = value
          rt.stepCount += 1
          rt.history.push({ seq: rt.stepCount, inputLabel, beforeLabel: null, afterLabel: label })
          syncTerminal()
          b.push({
            kind: 'REDUCTION_INITIALIZED',
            activeNode: sink,
            currentElementId: elementId,
            parentElementId,
            processing: {
              title: '累積値の初期化（最初の要素）',
              inputLabel,
              expression,
              evaluation: `accumulator初期値 = ${label}`,
              outcome: 'identityがないため、最初の要素が初期累積値になります',
            },
            currentText: `identityなしのreduceでは最初の要素${name}がそのまま初期累積値になります。`,
            jdkNote: 'accumulatorは結合則（associativity）を満たす必要があります。',
          })
          return true
        }
        const beforeLabel = formatSimValue(rt.acc)
        rt.acc = applyReduction(reduction, rt.acc, value)
        const afterLabel = formatSimValue(rt.acc)
        rt.stepCount += 1
        rt.history.push({ seq: rt.stepCount, inputLabel, beforeLabel, afterLabel })
        syncTerminal()
        b.push({
          kind: 'ACCUMULATOR_UPDATED',
          activeNode: sink,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: 'accumulator更新確定',
            inputLabel,
            expression,
            evaluation: `${beforeLabel} + ${contribution} → ${afterLabel}`,
            outcome: `累積値が${afterLabel}になりました`,
          },
          currentText: `accumulatorが${beforeLabel}と${contribution}から新しい累積値${afterLabel}を作りました。`,
          jdkNote: 'accumulatorは結合則（associativity）を満たす必要があります。',
        })
        return true
      }
      case 'count': {
        rt.count += 1
        syncTerminal()
        b.push({
          kind: 'COUNT_UPDATED',
          activeNode: sink,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: '件数の更新確定（概念上の寄与）',
            inputLabel: label,
            expression: '.count()',
            evaluation: `現在件数 ${rt.count}`,
            outcome: `${name}が1件として数えられました`,
          },
          currentText: `${name}が数えられ、現在件数は${rt.count}です。`,
          jdkNote: COUNT_ELISION_NOTE,
        })
        return true
      }
      case 'min':
      case 'max': {
        const op = sink.operationId
        const expression = sink.comparator
          ? `.${op}(${comparatorToJavaExpr(sink.comparator)})`
          : `.${op}()`
        if (rt.candidate === null) {
          rt.candidate = { id: elementId, value }
          rt.updateCount += 1
          syncTerminal()
          b.push({
            kind: 'CANDIDATE_UPDATED',
            activeNode: sink,
            currentElementId: elementId,
            parentElementId,
            processing: {
              title: '候補の初期化',
              inputLabel: label,
              expression,
              evaluation: `現在候補 = ${label}`,
              outcome: '最初の要素が現在候補になります',
            },
            currentText: `最初の要素${name}が${op}の現在候補になります。`,
          })
          return true
        }
        const cmp = sink.comparator
          ? compareByComparator(sink.comparator, value, rt.candidate.value)
          : (() => {
              const a = value as { value: number }
              const candidate = rt.candidate.value as { value: number }
              return a.value < candidate.value ? -1 : a.value > candidate.value ? 1 : 0
            })()
        const better = op === 'min' ? cmp < 0 : cmp > 0
        const candidateLabel = formatSimValue(rt.candidate.value)
        const comparisonText = sink.comparator
          ? `Comparator比較: ${comparatorKeyLabel(sink.comparator, value)} vs ${comparatorKeyLabel(sink.comparator, rt.candidate.value)}`
          : `${label} ${cmp < 0 ? '<' : cmp > 0 ? '>' : '=='} ${candidateLabel}`
        if (better) {
          rt.candidate = { id: elementId, value }
          rt.updateCount += 1
        }
        syncTerminal()
        b.push({
          kind: 'CANDIDATE_UPDATED',
          activeNode: sink,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: better ? '候補の更新確定' : '候補の維持確定',
            inputLabel: `${label}（現在候補: ${candidateLabel}）`,
            expression,
            evaluation: comparisonText,
            outcome: better
              ? `候補が${label}へ更新されました`
              : `候補${candidateLabel}を維持します`,
          },
          currentText: better
            ? `${name}が現在候補より${op === 'min' ? '小さい' : '大きい'}ため、候補が更新されました。`
            : `${name}は現在候補を上回らないため、候補は維持されます。`,
        })
        return true
      }
      case 'anyMatch':
      case 'allMatch':
      case 'noneMatch': {
        const op = sink.operationId
        const predicate = sink.predicate
        if (!predicate) throw new EngineInvariantError('match系にPredicateがありません')
        const predicateExpr = predicateToJavaExpr(predicate)
        const numeric = predicateComparisonValue(predicate, value)
        const matched = evaluateValuePredicate(predicate, value)
        rt.evaluatedCount += 1
        // 決定条件: any→true / all→false / none→true
        const decisive = op === 'anyMatch' ? matched : op === 'allMatch' ? !matched : matched
        if (decisive) {
          rt.decided = true
          rt.resultValue = op === 'anyMatch' ? true : false
          rt.pendingShortCircuit = true
        }
        syncTerminal()
        b.push({
          kind: 'MATCH_EVALUATED',
          activeNode: sink,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: `Predicate評価確定（${op}）`,
            inputLabel: fieldValueFlow(predicate, name, numeric),
            expression: predicateExpr,
            evaluation: `${comparisonExpr(predicate, numeric)} → ${matched}`,
            outcome: decisive
              ? `結果が${rt.resultValue}に確定しました（この要素で決定）`
              : '結果は未確定のため、次の要素を評価します',
          },
          currentText: decisive
            ? `${name}の評価が${matched}となり、${op}の結果が${rt.resultValue}に確定しました。`
            : `${name}の評価は${matched}です。${op}の結果はまだ確定しません。`,
        })
        return true
      }
      case 'findFirst':
      case 'findAny': {
        const op = sink.operationId
        rt.decided = true
        rt.selected = { id: elementId, label }
        rt.pendingShortCircuit = true
        syncTerminal()
        b.push({
          kind: 'FIND_SELECTED',
          activeNode: sink,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: `要素の選択確定（${op}）`,
            inputLabel: label,
            expression: `.${op}()`,
            evaluation: null,
            outcome: `${label}が結果として選択されました`,
          },
          currentText:
            op === 'findFirst'
              ? `${name}が最初の要素として選択され、findFirstの結果が確定しました。`
              : `${name}が選択され、findAnyの結果が確定しました（このfixtureでは決定的に同じ要素を選択します）。`,
          jdkNote: op === 'findAny' ? FIND_ANY_NOTE : def.orderMeta.sourceOrdered ? null : FIND_FIRST_UNORDERED_NOTE,
        })
        return true
      }
      case 'sum': {
        const primitive = rt.primitive
        if (!primitive || (value.kind !== 'int' && value.kind !== 'long' && value.kind !== 'double')) {
          throw new EngineInvariantError('sumはprimitive要素が必要です')
        }
        rt.aggCount += 1
        rt.aggSum += value.value
        syncTerminal()
        b.push({
          kind: 'ACCUMULATOR_UPDATED',
          activeNode: sink,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: '累積合計の更新確定',
            inputLabel: label,
            expression: '.sum()',
            evaluation: `累積合計 → ${primitiveValueLabel(primitive, rt.aggSum)}`,
            outcome: `合計が${primitiveValueLabel(primitive, rt.aggSum)}になりました`,
          },
          currentText: `${label}が加算され、累積合計は${primitiveValueLabel(primitive, rt.aggSum)}です。`,
        })
        return true
      }
      case 'average':
      case 'summaryStatistics': {
        const primitive = rt.primitive
        if (!primitive || (value.kind !== 'int' && value.kind !== 'long' && value.kind !== 'double')) {
          throw new EngineInvariantError(`${sink.operationId}はprimitive要素が必要です`)
        }
        rt.aggCount += 1
        rt.aggSum += value.value
        rt.aggMin = rt.aggMin === null ? value.value : Math.min(rt.aggMin, value.value)
        rt.aggMax = rt.aggMax === null ? value.value : Math.max(rt.aggMax, value.value)
        syncTerminal()
        const avgLabel = formatDoubleLiteral(rt.aggSum / rt.aggCount)
        b.push({
          kind: 'STATISTICS_UPDATED',
          activeNode: sink,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: sink.operationId === 'average' ? '合計・件数の更新確定' : '統計値の更新確定',
            inputLabel: label,
            expression: `.${sink.operationId}()`,
            evaluation:
              sink.operationId === 'average'
                ? `合計 ${primitiveValueLabel(primitive, rt.aggSum)} / 件数 ${rt.aggCount} → 平均 ${avgLabel}`
                : `count=${rt.aggCount}, sum=${primitiveValueLabel(primitive, rt.aggSum)}, min=${primitiveValueLabel(primitive, rt.aggMin ?? 0)}, max=${primitiveValueLabel(primitive, rt.aggMax ?? 0)}, average=${avgLabel}`,
            outcome: null,
          },
          currentText:
            sink.operationId === 'average'
              ? `${label}が加算されました。現在の平均は${avgLabel}（合計${primitiveValueLabel(primitive, rt.aggSum)} / ${rt.aggCount}件）です。`
              : `${label}を取り込み、count / sum / min / average / maxを同時に更新しました。`,
        })
        return true
      }
      case 'toArray': {
        const index = rt.stored.length
        rt.stored.push({ index, label })
        syncTerminal()
        const componentLabel =
          def.resultType.kind === 'array' ? formatTypeRef(def.resultType.elementType) : '?'
        b.push({
          kind: 'ARRAY_ELEMENT_STORED',
          activeNode: sink,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: '配列への格納確定',
            inputLabel: `${label} → [${index}]`,
            expression: sink.arrayGenerator
              ? `.toArray(${sink.arrayGenerator.elementTypeName}[]::new)`
              : '.toArray()',
            evaluation: `${componentLabel}[] の index ${index} へ格納`,
            outcome: `配列の要素数は${rt.stored.length}になりました`,
          },
          currentText: `${name}が${componentLabel}[]のindex ${index}へ格納されました。`,
        })
        return true
      }
      case 'forEach':
      case 'forEachOrdered': {
        const consumer = sink.consumer
        if (!consumer) throw new EngineInvariantError('forEach系にConsumerがありません')
        const consumerExpr = consumerToJavaExpr(consumer)
        const message = evaluateConsumerMessage(consumer, value)
        const entry = b.addSideEffect({
          nodeId: sink.nodeId,
          elementId,
          inputLabel: label,
          actionExpr: consumerExpr,
          actionLabel: consumerActionLabel(consumer),
          message,
        })
        rt.callCount += 1
        syncTerminal()
        b.push({
          kind: 'CONSUMER_ACTION_PERFORMED',
          activeNode: sink,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: `Consumer実行確定（${sink.displayName}）`,
            inputLabel: label,
            expression: consumerExpr,
            evaluation: `Side Effect出力: ${message}`,
            outcome: '戻り値はvoidで、Consumerの副作用だけが残ります',
          },
          currentText: `${sink.displayName}のConsumerを実行しました（${entry.seq}回目。出力: ${message}）。`,
        })
        return true
      }
      default:
        throw new EngineInvariantError(`未対応のterminal操作です: ${sink.operationId}`)
    }
  }

  /** 中間チェーンを chainIdx から処理し、要素が終端まで到達したらtrueを返す */
  const processThroughChain = (
    elementId: ElementId,
    startValue: SimValue,
    chainIdx: number,
    parentElementId: ElementId | null,
  ): boolean => {
    let value = startValue
    for (let i = chainIdx; i < chain.length; i++) {
      const node = chain[i]
      if (!node) throw new EngineInvariantError(`chain index ${i} が不正です`)
      const label = formatSimValue(value)
      const name = shortLabel(value)

      if (node.operationId === 'filter') {
        if (value.kind !== 'employee') {
          throw new EngineInvariantError('filterはEmployee要素にのみ適用できます')
        }
        const predicate = predicateOf(node)
        const employee = value.value
        b.setState(elementId, node.nodeId, 'PROCESSING')
        b.setLatest(elementId, 'PROCESSING')
        b.push({
          kind: 'NODE_ARRIVAL',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: `${node.displayName}への要素到着`,
            inputLabel: `${name}（age=${employee.age}）`,
            expression: predicateToJavaExpr(predicate),
            evaluation: null,
            outcome: null,
          },
          currentText: `${name}が${node.displayName}（${predicateToJavaExpr(predicate)}）へ到着しました。${describePredicate(predicate)}。`,
        })
        const result = evaluatePredicate(predicate, employee)
        b.push({
          kind: 'PREDICATE_EVALUATED',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: 'Predicate評価確定',
            inputLabel: fieldValueFlow(predicate, name, employee.age),
            expression: predicateToJavaExpr(predicate),
            evaluation: `${comparisonExpr(predicate, employee.age)} → ${result}`,
            outcome: null,
          },
          currentText: `${name}のage() ${employee.age}を評価します。${comparisonExpr(predicate, employee.age)} は ${result} です。`,
        })
        b.setState(elementId, node.nodeId, result ? 'PASSED' : 'REJECTED')
        b.setLatest(elementId, result ? 'PASSED' : 'REJECTED')
        b.push({
          kind: result ? 'ELEMENT_PASSED' : 'ELEMENT_REJECTED',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: result ? '通過確定' : '除外確定',
            inputLabel: `${name}（age=${employee.age}）`,
            expression: predicateToJavaExpr(predicate),
            evaluation: `${comparisonExpr(predicate, employee.age)} → ${result}`,
            outcome: result ? '通過（後段へ渡されます）' : '除外（後段へは渡されません）',
          },
          currentText: result
            ? `${name}はPredicateがtrueのため通過し、後段へ渡されます。`
            : `${name}はPredicateがfalseのため除外されます。`,
        })
        if (!result) return false
        continue
      }

      if (isMapFamily(node.operationId)) {
        const mapper = node.operationId === 'boxed' ? null : mapperOf(node)
        const expression = mapper ? mapperToJavaExpr(mapper) : '.boxed()'
        b.setState(elementId, node.nodeId, 'PROCESSING')
        b.setLatest(elementId, 'PROCESSING')
        b.push({
          kind: 'NODE_ARRIVAL',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: `${node.displayName}への要素到着`,
            inputLabel: label,
            expression,
            evaluation: null,
            outcome: null,
          },
          currentText: `${name}が${node.displayName}へ到着しました。${
            mapper ? describeMapper(mapper) : '対応するwrapperへboxingします'
          }。`,
        })
        const newValue = mapper ? evaluateMapper(mapper, value) : boxValue(value)
        const newLabel = formatSimValue(newValue)
        b.push({
          kind: 'MAPPING_APPLIED',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: '変換確定',
            inputLabel: `${label} → ${newLabel}`,
            expression,
            evaluation: `${label} → ${newLabel}`,
            outcome: null,
          },
          typeTransition: typeTransitionOf(node),
          currentText: `${node.displayName}が${label}を${newLabel}へ変換しました。`,
          jdkNote: node.operationId === 'boxed' ? node.jdkNotes[0] ?? null : null,
        })
        b.setState(elementId, node.nodeId, 'PASSED')
        b.setLatest(elementId, 'PASSED')
        b.push({
          kind: 'MAPPED_EMITTED',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: '変換後要素の送出',
            inputLabel: `${newLabel} → 後段`,
            expression,
            evaluation: null,
            outcome: '変換後の要素を後段へ送出しました',
          },
          typeTransition: typeTransitionOf(node),
          currentText: `変換後の${newLabel}を後段へ送出します。`,
        })
        value = newValue
        continue
      }

      if (isFlatMapFamily(node.operationId)) {
        const mapper = mapperOf(node)
        const expression = mapperToJavaExpr(mapper)
        b.setState(elementId, node.nodeId, 'PROCESSING')
        b.setLatest(elementId, 'PROCESSING')
        b.push({
          kind: 'NODE_ARRIVAL',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: `${node.displayName}への要素到着`,
            inputLabel: label,
            expression,
            evaluation: null,
            outcome: null,
          },
          currentText: `親要素${name}が${node.displayName}へ到着しました。${describeMapper(mapper)}。`,
        })
        const childValues = evaluateFlatMapper(mapper, value)
        const children = childValues.map((childValue, ci) => ({
          id: `${elementId}-c${ci + 1}`,
          label: formatSimValue(childValue),
        }))
        b.openFlatMapCtx({
          nodeId: node.nodeId,
          parentElementId: elementId,
          parentLabel: label,
          children,
          emittedCount: 0,
          closed: children.length === 0,
        })
        for (const child of children) b.registerElement(child.id)
        // 親のflatMap評価はmapped Stream生成で確定する。以降、親はparentElementIdの
        // 文脈情報としてのみ保持し、子と同時に「処理中」2件にはしない（§6.2、§12.6）
        b.setState(elementId, node.nodeId, 'PASSED')
        b.setLatest(elementId, 'PASSED')
        b.push({
          kind: 'MAPPED_STREAM_CREATED',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: 'mapped Stream生成',
            inputLabel: label,
            expression,
            evaluation: null,
            outcome:
              children.length === 0
                ? '子要素0件のmapped Streamを生成しました（内容がないためcloseされます）'
                : `子要素${children.length}件のmapped Streamを生成しました`,
          },
          typeTransition: typeTransitionOf(node),
          currentText:
            children.length === 0
              ? `${name}のmapped Streamは子要素0件です。closeされ、次へ進みます。`
              : `${name}から子要素${children.length}件のmapped Streamを生成しました。encounter order順に1件ずつ送出します。`,
        })
        const ctx = b.currentFlatMapCtx
        if (!ctx) throw new EngineInvariantError('flatMap文脈がありません')
        for (let ci = 0; ci < childValues.length; ci++) {
          // 後段の短絡確定後は、mapped Streamの残り子要素を評価しない（§8.3）
          if (b.cancelledBeyond(i)) break
          const childValue = childValues[ci]
          const child = children[ci]
          if (!child || childValue === undefined) {
            throw new EngineInvariantError(`child index ${ci} が不正です`)
          }
          ctx.emittedCount = ci + 1
          b.setState(child.id, node.nodeId, 'PASSED')
          b.setLatest(child.id, 'PROCESSING')
          b.push({
            kind: 'CHILD_EMITTED',
            activeNode: node,
            currentElementId: child.id,
            parentElementId: elementId,
            processing: {
              title: '子要素の送出（flatten）',
              inputLabel: `${child.label}（親: ${name}）`,
              expression,
              evaluation: null,
              outcome: 'mapped Streamから子要素を送出し、flattenして後段へ渡します',
            },
            currentText: `mapped Streamから子要素${child.label}を送出し、flattenします。`,
          })
          // 子要素はencounter orderどおり1件ずつ後段を流れ切る（§6.2）
          processThroughChain(child.id, childValue, i + 1, elementId)
          confirmPendingShortCircuits()
          if (ci === children.length - 1 || b.cancelledBeyond(i)) {
            // 最後の子の処理完了後（または短絡確定後）、mapped Streamのclose状態を
            // 該当snapshotの詳細へ反映する（§9.3）
            ctx.closed = true
            b.patchLastDraft()
          }
        }
        // 親要素自身は後段へ渡らない（子がflattenされて流れる）
        return false
      }

      // ---- Phase 3: distinct（§7.2） ----
      if (node.operationId === 'distinct') {
        const rt = runtimes.get(node.nodeId)
        if (rt?.kind !== 'distinct') throw new EngineInvariantError('distinct runtimeがありません')
        b.setState(elementId, node.nodeId, 'PROCESSING')
        b.setLatest(elementId, 'PROCESSING')
        rt.currentLabel = label
        rt.verdict = null
        syncContext(rt)
        b.push({
          kind: 'NODE_ARRIVAL',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: 'distinctへの要素到着',
            inputLabel: label,
            expression: '.distinct()',
            evaluation: null,
            outcome: null,
          },
          currentText: `${name}がdistinctへ到着しました。既出値（seen）と照合し、初登場か重複かを判定します。`,
        })
        const key = distinctKeyOf(value, elementId)
        const isFirst = !rt.seenKeys.has(key)
        rt.verdict = isFirst ? 'FIRST' : 'DUPLICATE'
        syncContext(rt)
        b.push({
          kind: 'DISTINCT_CHECKED',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: 'seenとの照合確定',
            inputLabel: label,
            expression: '.distinct()',
            evaluation: `seenとの照合 → ${isFirst ? '初登場' : '重複'}`,
            outcome: null,
          },
          currentText: isFirst
            ? `${name}はまだseenに存在しないため初登場です。`
            : `${name}はseenに既出のため重複です。`,
          jdkNote: def.orderMeta.sourceOrdered
            ? 'ordered Streamでは、重複要素のうちencounter orderで最初の要素が保持されます。'
            : 'unordered Streamでは、どの重複要素が保持されるかは保証されません。',
        })
        if (isFirst) {
          rt.seenKeys.add(key)
          rt.seen.push({ key, label })
          b.setState(elementId, node.nodeId, 'PASSED')
          b.setLatest(elementId, 'PASSED')
          syncContext(rt)
          b.push({
            kind: 'DISTINCT_SEEN_UPDATED',
            activeNode: node,
            currentElementId: elementId,
            parentElementId,
            processing: {
              title: 'seen更新',
              inputLabel: `${label} → seen`,
              expression: '.distinct()',
              evaluation: null,
              outcome: 'seenへ追加し、要素は後段へ通過します',
            },
            currentText: `${name}をseenへ追加しました。初登場のため後段へ通過します。`,
          })
          continue
        }
        b.setState(elementId, node.nodeId, 'REJECTED')
        b.setLatest(elementId, 'REJECTED')
        syncContext(rt)
        b.push({
          kind: 'ELEMENT_REJECTED',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: '重複除外確定',
            inputLabel: label,
            expression: '.distinct()',
            evaluation: 'seenとの照合 → 重複',
            outcome: '除外（後段へは渡されません）',
          },
          currentText: `${name}は重複のため除外されます。最初に登場した同値要素だけが残ります。`,
        })
        return false
      }

      // ---- Phase 3: sorted（§7.3、確定済みJ-2） ----
      if (node.operationId === 'sorted') {
        const rt = runtimes.get(node.nodeId)
        if (rt?.kind !== 'sorted') throw new EngineInvariantError('sorted runtimeがありません')
        b.setState(elementId, node.nodeId, 'PROCESSING')
        b.setLatest(elementId, 'PROCESSING')
        const sortedExpr = node.comparator
          ? `.sorted(${comparatorToJavaExpr(node.comparator)})`
          : '.sorted()'
        b.push({
          kind: 'NODE_ARRIVAL',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: 'sortedへの要素到着',
            inputLabel: label,
            expression: sortedExpr,
            evaluation: null,
            outcome: null,
          },
          currentText: `${name}がsortedへ到着しました。全入力が揃うまでbufferへ取り込みます。`,
          jdkNote: 'sortedは全要素を見るまで1件も結果を生成できません（stateful操作）。',
        })
        rt.buffer.push({
          id: elementId,
          label,
          keyLabel: comparatorKeyLabel(node.comparator, value),
          value,
        })
        b.setState(elementId, node.nodeId, 'BUFFERED')
        b.setLatest(elementId, 'BUFFERED')
        syncContext(rt)
        b.push({
          kind: 'SORT_BUFFERED',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: 'bufferへの取り込み確定',
            inputLabel: `${label} → buffer（${rt.buffer.length}件目）`,
            expression: sortedExpr,
            evaluation: null,
            outcome: 'bufferへ取り込みました（後段への出力は全入力の蓄積後）',
          },
          currentText: `${name}をbufferへ取り込みました（現在${rt.buffer.length}件）。全入力が揃うまで後段へは0件です。`,
        })
        // 要素はbufferに保持され、upstream完了後のflushで放出される
        return false
      }

      // ---- Phase 3: limit（§7.4） ----
      if (node.operationId === 'limit') {
        const rt = runtimes.get(node.nodeId)
        if (rt?.kind !== 'limit') throw new EngineInvariantError('limit runtimeがありません')
        b.setState(elementId, node.nodeId, 'PROCESSING')
        b.setLatest(elementId, 'PROCESSING')
        b.push({
          kind: 'NODE_ARRIVAL',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: 'limitへの要素到着',
            inputLabel: label,
            expression: `.limit(${rt.maxSize})`,
            evaluation: null,
            outcome: null,
          },
          currentText: `${name}がlimit(${rt.maxSize})へ到着しました。現在の通過数は${rt.passedCount}/${rt.maxSize}です。`,
          jdkNote: 'limitの引数maxSizeの型はlongです。',
        })
        rt.passedCount += 1
        if (rt.passedCount >= rt.maxSize) {
          rt.reached = true
          rt.pendingShortCircuit = true
        }
        b.setState(elementId, node.nodeId, 'PASSED')
        b.setLatest(elementId, 'PASSED')
        syncContext(rt)
        b.push({
          kind: 'LIMIT_COUNT_UPDATED',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: '通過数の更新確定',
            inputLabel: label,
            expression: `.limit(${rt.maxSize})`,
            evaluation: `通過数 ${rt.passedCount}/${rt.maxSize}`,
            outcome: rt.reached
              ? '通過しました（上限到達。この要素が最後の通過要素です）'
              : '通過しました',
          },
          currentText: rt.reached
            ? `${name}が通過し、通過数が${rt.passedCount}/${rt.maxSize}になりました。上限に到達したため、この要素が後段を流れ切った後に短絡が確定します。`
            : `${name}が通過し、通過数が${rt.passedCount}/${rt.maxSize}になりました。`,
        })
        continue
      }

      // ---- Phase 3: skip（§7.5） ----
      if (node.operationId === 'skip') {
        const rt = runtimes.get(node.nodeId)
        if (rt?.kind !== 'skip') throw new EngineInvariantError('skip runtimeがありません')
        b.setState(elementId, node.nodeId, 'PROCESSING')
        b.setLatest(elementId, 'PROCESSING')
        b.push({
          kind: 'NODE_ARRIVAL',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: 'skipへの要素到着',
            inputLabel: label,
            expression: `.skip(${rt.n})`,
            evaluation: null,
            outcome: null,
          },
          currentText: `${name}がskip(${rt.n})へ到着しました。現在のスキップ数は${rt.skippedCount}/${rt.n}です。`,
          jdkNote: 'skipの引数nの型はlongです。skipはStream全体を短絡終了しません。',
        })
        if (rt.skippedCount < rt.n) {
          rt.skippedCount += 1
          b.setState(elementId, node.nodeId, 'REJECTED')
          b.setLatest(elementId, 'REJECTED')
          syncContext(rt)
          b.push({
            kind: 'SKIP_COUNT_UPDATED',
            activeNode: node,
            currentElementId: elementId,
            parentElementId,
            processing: {
              title: 'スキップ数の更新確定',
              inputLabel: label,
              expression: `.skip(${rt.n})`,
              evaluation: `スキップ数 ${rt.skippedCount}/${rt.n}`,
              outcome: '除外（skip対象のため後段へは渡されません）',
            },
            currentText: `${name}をスキップしました（${rt.skippedCount}/${rt.n}）。skip対象のため除外されます。`,
          })
          return false
        }
        b.setState(elementId, node.nodeId, 'PASSED')
        b.setLatest(elementId, 'PASSED')
        syncContext(rt)
        b.push({
          kind: 'ELEMENT_PASSED',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: '通過確定（通過モード）',
            inputLabel: label,
            expression: `.skip(${rt.n})`,
            evaluation: `スキップ済み ${rt.skippedCount}/${rt.n}`,
            outcome: '通過（skip完了後の要素は判定なしで順次通過します）',
          },
          currentText: `${rt.n}件のスキップが完了しているため、${name}は判定なしで通過します。`,
        })
        continue
      }

      // ---- Phase 3: takeWhile（§7.6） ----
      if (node.operationId === 'takeWhile') {
        const rt = runtimes.get(node.nodeId)
        if (rt?.kind !== 'takeWhile') throw new EngineInvariantError('takeWhile runtimeがありません')
        const predicate = predicateOf(node)
        const predicateExpr = predicateToJavaExpr(predicate)
        b.setState(elementId, node.nodeId, 'PROCESSING')
        b.setLatest(elementId, 'PROCESSING')
        b.push({
          kind: 'NODE_ARRIVAL',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: 'takeWhileへの要素到着',
            inputLabel: label,
            expression: predicateExpr,
            evaluation: null,
            outcome: null,
          },
          currentText: `${name}がtakeWhile（${predicateExpr}）へ到着しました。${describePredicate(predicate)}。`,
          jdkNote: '初版のtakeWhile実行はsequential + orderedに限定しています。',
        })
        // Predicate種別に応じた比較対象値（評価・表示とも同じ値を参照。レビュー修正1）
        const numeric = predicateComparisonValue(predicate, value)
        const result = evaluateValuePredicate(predicate, value)
        b.push({
          kind: 'PREDICATE_EVALUATED',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: 'Predicate評価確定',
            inputLabel: fieldValueFlow(predicate, name, numeric),
            expression: predicateExpr,
            evaluation: `${comparisonExpr(predicate, numeric)} → ${result}`,
            outcome: null,
          },
          currentText: `${name}を評価します。${comparisonExpr(predicate, numeric)} は ${result} です。`,
        })
        if (result) {
          b.setState(elementId, node.nodeId, 'PASSED')
          b.setLatest(elementId, 'PASSED')
          b.push({
            kind: 'ELEMENT_PASSED',
            activeNode: node,
            currentElementId: elementId,
            parentElementId,
            processing: {
              title: '通過確定',
              inputLabel: label,
              expression: predicateExpr,
              evaluation: `${comparisonExpr(predicate, numeric)} → true`,
              outcome: '通過（trueのprefixに含まれます）',
            },
            currentText: `${name}はPredicateがtrueのため通過します。`,
          })
          continue
        }
        rt.stopped = true
        rt.boundaryElementId = elementId
        rt.boundaryLabel = label
        b.setState(elementId, node.nodeId, 'REJECTED')
        b.setLatest(elementId, 'REJECTED')
        syncContext(rt)
        b.push({
          kind: 'ELEMENT_REJECTED',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: '境界要素の除外確定',
            inputLabel: label,
            expression: predicateExpr,
            evaluation: `${comparisonExpr(predicate, numeric)} → false`,
            outcome: '除外（最初のfalseとなる境界要素です）',
          },
          currentText: `${name}は最初にfalseとなった境界要素であり、除外されます。`,
        })
        b.push({
          kind: 'SHORT_CIRCUIT_CONFIRMED',
          activeNode: node,
          currentElementId: null,
          processing: {
            title: 'short-circuit確定（takeWhile STOP）',
            inputLabel: `境界要素: ${label}`,
            expression: predicateExpr,
            evaluation: null,
            outcome: '最初のfalseで短絡が確定し、上流への要素要求を停止します',
          },
          currentText:
            '最初のfalseによりtakeWhileの短絡が確定しました。後続の要素はPredicateを評価されず、未評価のままです。',
          jdkNote:
            'takeWhileはshort-circuiting操作です。後続にPredicateならtrueとなる値があっても、実際には評価されません。',
        })
        b.cancelAt(i)
        return false
      }

      // ---- Phase 3: dropWhile（§7.7） ----
      if (node.operationId === 'dropWhile') {
        const rt = runtimes.get(node.nodeId)
        if (rt?.kind !== 'dropWhile') throw new EngineInvariantError('dropWhile runtimeがありません')
        const predicate = predicateOf(node)
        const predicateExpr = predicateToJavaExpr(predicate)
        b.setState(elementId, node.nodeId, 'PROCESSING')
        b.setLatest(elementId, 'PROCESSING')
        b.push({
          kind: 'NODE_ARRIVAL',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: 'dropWhileへの要素到着',
            inputLabel: label,
            expression: predicateExpr,
            evaluation: null,
            outcome: null,
          },
          currentText: rt.dropping
            ? `${name}がdropWhile（${predicateExpr}）へ到着しました。drop中のためPredicateを評価します。`
            : `${name}がdropWhileへ到着しました。すでに通過モードです。`,
          jdkNote: '初版のdropWhile実行はsequential + orderedに限定しています。',
        })
        if (rt.dropping) {
          const numeric = predicateComparisonValue(predicate, value)
          const result = evaluateValuePredicate(predicate, value)
          b.push({
            kind: 'PREDICATE_EVALUATED',
            activeNode: node,
            currentElementId: elementId,
            parentElementId,
            processing: {
              title: 'Predicate評価確定',
              inputLabel: fieldValueFlow(predicate, name, numeric),
              expression: predicateExpr,
              evaluation: `${comparisonExpr(predicate, numeric)} → ${result}`,
              outcome: null,
            },
            currentText: `${name}を評価します。${comparisonExpr(predicate, numeric)} は ${result} です。`,
          })
          if (result) {
            b.setState(elementId, node.nodeId, 'REJECTED')
            b.setLatest(elementId, 'REJECTED')
            syncContext(rt)
            b.push({
              kind: 'ELEMENT_REJECTED',
              activeNode: node,
              currentElementId: elementId,
              parentElementId,
              processing: {
                title: 'drop確定',
                inputLabel: label,
                expression: predicateExpr,
                evaluation: `${comparisonExpr(predicate, numeric)} → true`,
                outcome: '除外（trueのprefixとしてdropされます）',
              },
              currentText: `${name}はPredicateがtrueのためdropされ、除外されます。`,
            })
            return false
          }
          rt.dropping = false
          rt.boundaryElementId = elementId
          rt.boundaryLabel = label
          b.setState(elementId, node.nodeId, 'PASSED')
          b.setLatest(elementId, 'PASSED')
          syncContext(rt)
          b.push({
            kind: 'DROP_MODE_ENTERED',
            activeNode: node,
            currentElementId: elementId,
            parentElementId,
            processing: {
              title: '通過モードへの移行確定',
              inputLabel: `境界要素: ${label}`,
              expression: predicateExpr,
              evaluation: `${comparisonExpr(predicate, numeric)} → false`,
              outcome: '境界要素は除外されず後段へ通過し、以後はPredicateを再評価しません',
            },
            currentText: `${name}で最初のfalseとなり、dropWhileは通過モードへ移行しました。境界要素${name}は後段へ通過します。`,
            jdkNote:
              '通過モード移行後の要素は、Predicateならtrueとなる値でも再評価されずに通過します。',
          })
          continue
        }
        b.setState(elementId, node.nodeId, 'PASSED')
        b.setLatest(elementId, 'PASSED')
        b.push({
          kind: 'ELEMENT_PASSED',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: '通過確定（通過モード）',
            inputLabel: label,
            expression: predicateExpr,
            evaluation: null,
            outcome: '通過（通過モードのためPredicateは評価されません）',
          },
          currentText: `${name}は通過モードのため、Predicateを評価せずに通過します。`,
        })
        continue
      }

      // ---- Phase 3: peek（§7.8） ----
      if (node.operationId === 'peek') {
        const rt = runtimes.get(node.nodeId)
        if (rt?.kind !== 'peek') throw new EngineInvariantError('peek runtimeがありません')
        const consumer = node.consumer
        if (!consumer) throw new EngineInvariantError(`node ${node.nodeId} にConsumerがありません`)
        const consumerExpr = consumerToJavaExpr(consumer)
        b.setState(elementId, node.nodeId, 'PROCESSING')
        b.setLatest(elementId, 'PROCESSING')
        b.push({
          kind: 'NODE_ARRIVAL',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: 'peekへの要素到着',
            inputLabel: label,
            expression: consumerExpr,
            evaluation: null,
            outcome: null,
          },
          currentText: `${name}がpeekへ到着しました。${describeConsumer(consumer)}。`,
        })
        const message = evaluateConsumerMessage(consumer, value)
        const entry = b.addSideEffect({
          nodeId: node.nodeId,
          elementId,
          inputLabel: label,
          actionExpr: consumerExpr,
          actionLabel: consumerActionLabel(consumer),
          message,
        })
        rt.callCount += 1
        b.setState(elementId, node.nodeId, 'PASSED')
        b.setLatest(elementId, 'PASSED')
        syncContext(rt)
        b.push({
          kind: 'PEEK_ACTION_PERFORMED',
          activeNode: node,
          currentElementId: elementId,
          parentElementId,
          processing: {
            title: 'Consumer実行確定（Side Effect）',
            inputLabel: label,
            expression: consumerExpr,
            evaluation: `Side Effect出力: ${message}`,
            outcome: '値と型を変更せず、同じ要素を後段へ通過させます',
          },
          currentText: `peekのConsumerを実行しました（${entry.seq}回目。出力: ${message}）。値は変更されず後段へ渡されます。`,
          jdkNote:
            'JDKでは最適化や短絡により、peekのactionが呼ばれない要素があり得ます（count最適化等）。',
        })
        continue
      }

      throw new EngineInvariantError(`未対応のoperationです: ${node.operationId}`)
    }

    // 終端へ到達
    return handleTerminalElement(elementId, value, parentElementId)
  }

  const emitAndProcess = (
    element: { elementId: ElementId; index: number; value: SimValue },
    sourceContext: SourceContextView | null,
  ): void => {
    b.clearFlatMapCtx()
    const name = shortLabel(element.value)
    b.setState(element.elementId, src.nodeId, 'PROCESSING')
    b.setLatest(element.elementId, 'PROCESSING')
    b.push({
      kind: 'SOURCE_EMIT',
      activeNode: src,
      currentElementId: element.elementId,
      processing: {
        title: 'sourceからの要素送出',
        inputLabel: `${formatSimValue(element.value)} → Pipeline`,
        expression: null,
        evaluation: null,
        outcome: null,
      },
      sourceContext,
      currentText: `sourceが${name}を送出します。`,
      jdkNote: '中間操作は遅延評価であり、終端操作の実行時に初めて要素が流れます。',
    })
    b.setState(element.elementId, src.nodeId, 'PASSED')
    processThroughChain(element.elementId, element.value, 0, null)
    confirmPendingShortCircuits()
  }

  // ---- Collector: supplier適用によるコンテナ生成（3引数collectは必須。§9.1規則6・§9.4） ----
  if (collectorRt && collectorNeedsContainerCreated(collectorRt)) {
    const rt = collectorRt
    collectorCreateContainer(rt, (input) => {
      syncCollector()
      b.push({
        kind: input.kind,
        activeNode: sink,
        currentElementId: input.currentElementId,
        processing: input.processing,
        currentText: input.currentText,
        jdkNote: input.jdkNote ?? null,
      })
    })
  }

  // ---- identityありreduce: 実行開始時にidentityを累積初期値として常時表示する（§6.1） ----
  if (terminalRt && sink.operationId === 'reduce' && sink.identity && sink.reduction) {
    terminalRt.acc = identityToSimValue(
      sink.identity,
      sink.reduction,
      (terminalRt.primitive ?? 'string') as SimValue['kind'],
    )
    syncTerminal()
    const identityLiteral = identityToJavaLiteral(sink.identity)
    b.push({
      kind: 'REDUCTION_INITIALIZED',
      activeNode: sink,
      currentElementId: null,
      processing: {
        title: '累積値の初期化（identity）',
        inputLabel: `identity = ${identityLiteral}`,
        expression: reduceExpression(sink),
        evaluation: `accumulator初期値 = ${identityLiteral}`,
        outcome: sink.hasCombiner
          ? 'identityが初期累積値です。combinerはparallel reductionで必要となり、sequential実行では呼ばれません'
          : 'identityが初期累積値です。空Streamの結果はidentityになります',
      },
      currentText: `identity ${identityLiteral} が初期累積値になります。空Streamの場合、結果はidentityです。`,
      jdkNote: sink.hasCombiner
        ? 'combinerはparallel reductionで部分結果を結合するために必要です。sequential実行では呼ばれません。'
        : 'accumulatorは結合則（associativity）を満たす必要があります。',
    })
  }

  // ---- limit(0): source要素を1件も要求せず、処理中要素0件で短絡を確定する（§7.4） ----
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i]
    if (!node) continue
    const rt = runtimes.get(node.nodeId)
    if (rt?.kind === 'limit' && rt.maxSize === 0) {
      rt.reached = true
      rt.upstreamStopped = true
      syncContext(rt)
      b.push({
        kind: 'SHORT_CIRCUIT_CONFIRMED',
        activeNode: node,
        currentElementId: null,
        processing: {
          title: 'short-circuit確定（limit(0)）',
          inputLabel: '通過数 0/0',
          expression: '.limit(0)',
          evaluation: null,
          outcome: 'limit(0)のため、source要素を1件も要求せずに短絡が確定します',
        },
        currentText:
          'limit(0)のため後段へ渡せる要素は0件です。source要素は1件も要求されず、すべて未評価のままです。',
        jdkNote: 'limitはshort-circuiting操作であり、必要のない上流評価を行いません。',
      })
      b.cancelAt(i)
      break
    }
  }

  const sourceDsl = def.sourceDsl
  if (sourceDsl.kind === 'iterate3') {
    if (!def.iterateTrace) throw new EngineInvariantError('iterate3のtraceがありません')
    const predicateText = `n -> n ${sourceDsl.predicate.operator === 'LTE' ? '<=' : '<'} ${sourceDsl.predicate.value}`
    let elementIdx = 0
    for (let ci = 0; ci < def.iterateTrace.length; ci++) {
      // 短絡確定後はsource候補生成を追加実行しない（§7.4）
      if (b.cancelIdx !== null) break
      const candidate = def.iterateTrace[ci]
      if (!candidate) throw new EngineInvariantError(`iterate候補index ${ci} が不正です`)
      const originText =
        ci === 0
          ? `seed ${candidate.value} を最初の候補とします。`
          : `operator（n -> n + ${sourceDsl.operator.step}）が次候補 ${candidate.value} を生成しました。`
      b.push({
        kind: 'SOURCE_CANDIDATE',
        activeNode: src,
        processing: {
          title: '生成候補',
          inputLabel: `候補 n = ${candidate.value}`,
          expression:
            ci === 0 ? String(sourceDsl.seed) : `n -> n + ${sourceDsl.operator.step}`,
          evaluation: null,
          outcome: null,
        },
        sourceContext: {
          index: null,
          candidateLabel: String(candidate.value),
          predicateText,
          predicateResult: null,
          note: null,
        },
        currentText: `${originText}次にpredicateで判定します。`,
      })
      const cmp = sourceDsl.predicate.operator === 'LTE' ? '<=' : '<'
      b.push({
        kind: 'SOURCE_PREDICATE_EVALUATED',
        activeNode: src,
        processing: {
          title: '生成条件の判定',
          inputLabel: `候補 n = ${candidate.value}`,
          expression: predicateText,
          evaluation: `${candidate.value} ${cmp} ${sourceDsl.predicate.value} → ${candidate.passed}`,
          outcome: candidate.passed ? '候補を送出します' : 'falseのため生成を終了します',
        },
        sourceContext: {
          index: null,
          candidateLabel: String(candidate.value),
          predicateText,
          predicateResult: candidate.passed,
          note: null,
        },
        currentText: `${candidate.value} ${cmp} ${sourceDsl.predicate.value} は ${candidate.passed} です。${
          candidate.passed ? '候補を要素として送出します。' : '生成を終了します。'
        }`,
      })
      if (candidate.passed) {
        const element = def.dataset[elementIdx]
        if (!element) throw new EngineInvariantError(`iterate要素index ${elementIdx} が不正です`)
        elementIdx += 1
        emitAndProcess(element, {
          index: null,
          candidateLabel: String(candidate.value),
          predicateText,
          predicateResult: true,
          note: null,
        })
      }
    }
  } else {
    for (const element of def.dataset) {
      // 短絡確定後は上流（source）への追加要求を行わない（§7.4・§8.2）
      if (b.cancelIdx !== null) break
      const withIndex =
        sourceDsl.kind === 'arrayObject' ||
        sourceDsl.kind === 'arrayPrimitive' ||
        sourceDsl.kind === 'streamOf' ||
        sourceDsl.kind === 'streamOfPrimitiveArrays' ||
        sourceDsl.kind === 'nestedStringList'
      const note =
        sourceDsl.kind === 'range'
          ? `${sourceDsl.from} <= n && n < ${sourceDsl.to}`
          : sourceDsl.kind === 'rangeClosed'
            ? `${sourceDsl.from} <= n && n <= ${sourceDsl.to}`
            : sourceDsl.kind === 'generate'
              ? `Supplier呼び出し${element.index + 1}回目: counter.incrementAndGet() → ${formatSimValue(element.value)}`
              : sourceDsl.kind === 'iterate2'
                ? element.index === 0
                  ? `seed ${sourceDsl.seed} を送出`
                  : `operator（n -> n + ${sourceDsl.operator.step}）適用 → ${formatSimValue(element.value)}`
                : null
      emitAndProcess(element, {
        index: withIndex ? element.index : null,
        candidateLabel: null,
        predicateText: null,
        predicateResult: null,
        note,
      })
    }
  }

  // ---- finish cascade: upstream完了をchain順に伝播し、sortedのbufferをflushする（§10） ----
  b.clearFlatMapCtx()
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i]
    if (!node) continue
    const rt = runtimes.get(node.nodeId)
    if (rt?.kind !== 'sorted' || rt.phase !== 'BUFFERING') continue
    // 並べ替え確定（SORT_ORDER_CONFIRMED）: 1シナリオにつき1件。空bufferでも生成する。
    // currentElementIdはnull、PROCESSINGは0件（J-2確定事項）
    const confirmedEntries = sortBuffer(rt.buffer, node.comparator)
    rt.confirmed = confirmedEntries
    rt.phase = 'ORDER_CONFIRMED'
    syncContext(rt)
    const sortedExpr = node.comparator
      ? `.sorted(${comparatorToJavaExpr(node.comparator)})`
      : '.sorted()'
    b.push({
      kind: 'SORT_ORDER_CONFIRMED',
      activeNode: node,
      currentElementId: null,
      processing: {
        title: '並べ替え確定（buffer全体）',
        inputLabel:
          rt.buffer.length === 0
            ? '空のbuffer（0件）の順序が確定しました'
            : `buffer全体（${rt.buffer.length}件）の順序を一括確定`,
        expression: sortedExpr,
        evaluation:
          rt.buffer.length === 0
            ? null
            : `確定順序: ${confirmedEntries.map((e) => e.label).join(' → ')}`,
        outcome:
          '個別要素ではなくbuffer全体の順序確定です（処理中要素は0件）。確定順序から1件ずつ放出します',
      },
      currentText:
        rt.buffer.length === 0
          ? '空のbufferの並べ替えが確定しました。放出する要素はありません。'
          : `upstreamの全入力（${rt.buffer.length}件）が揃ったため、並べ替えを一括確定しました。確定順序から1件ずつ後段へ放出します。`,
      jdkNote: def.orderMeta.sourceOrdered
        ? 'ordered Streamのsortはstableです（同値キーはencounter orderを維持）。'
        : 'unordered Streamではsortの安定性（同値キーの順序維持）は保証されません。',
    })
    rt.phase = 'EMITTING'
    for (const entry of confirmedEntries) {
      // 後段の短絡確定後は残りbufferを放出しない（BUFFEREDのまま保持）
      if (b.cancelledBeyond(i)) break
      rt.emittedCount += 1
      b.setState(entry.id, node.nodeId, 'PASSED')
      b.setLatest(entry.id, 'PROCESSING')
      syncContext(rt)
      b.push({
        kind: 'SORT_EMITTED',
        activeNode: node,
        currentElementId: entry.id,
        processing: {
          title: '確定順序からの放出',
          inputLabel: `${entry.label}（確定順序の${rt.emittedCount}件目）`,
          expression: sortedExpr,
          evaluation: `放出位置 ${rt.emittedCount}/${confirmedEntries.length}`,
          outcome: '確定順序から1件だけ後段へ放出します',
        },
        currentText: `確定順序の${rt.emittedCount}件目として${entry.label}を後段へ放出します。`,
      })
      // 放出された1要素は後段を流れ切ってから次を放出する（depth-first、J-2）
      processThroughChain(entry.id, entry.value, i + 1, null)
      confirmPendingShortCircuits()
    }
  }

  b.clearFlatMapCtx()

  // ---- Collector finish stage（全要素処理後の構造snapshot。§6.2・§9.1・§9.3） ----
  if (collectorRt) {
    const rt = collectorRt
    collectorFinish(rt, (input) => {
      syncCollector()
      b.push({
        kind: input.kind,
        activeNode: sink,
        currentElementId: input.currentElementId,
        processing: input.processing,
        currentText: input.currentText,
        jdkNote: input.jdkNote ?? null,
      })
    })
    syncCollector()
    const finalLabel = collectorFinalLabel(rt)
    b.push({
      kind: 'RESULT_CONFIRMED',
      activeNode: sink,
      processing: {
        title: '終端結果確定',
        inputLabel: null,
        expression: null,
        evaluation: null,
        outcome: `結果（${formatTypeRef(def.resultType)}）が確定しました: ${finalLabel}`,
      },
      currentText: `終端結果が確定しました。結果は${formatTypeRef(def.resultType)} = ${finalLabel}です。`,
      jdkNote:
        rt.op === 'collectTriple'
          ? 'sequential実行のためcombinerは呼ばれませんでした（呼出し0回）。combinerはparallel reductionで必要になります。'
          : 'Collectors.toList()等が返すコンテナの型・可変性・iteration orderはJDKの保証対象ではありません（Stream.toList()のunmodifiableとは異なります）。',
      confirmed: true,
    })
  } else if (!terminalRt) {
    b.push({
      kind: 'RESULT_CONFIRMED',
      activeNode: sink,
      processing: {
        title: '終端結果確定',
        inputLabel: null,
        expression: null,
        evaluation: null,
        outcome: `結果のList（${formatTypeRef(def.resultType)}）が確定しました`,
      },
      currentText: `終端結果が確定しました。結果は${formatTypeRef(def.resultType)}（${b.outputCount}件）です。`,
      jdkNote: 'Stream.toList()が返すListはunmodifiableです。',
      confirmed: true,
    })
  } else {
    // ---- terminal結果の最終確定（空Stream結果を含む。§6） ----
    const rt = terminalRt
    let resultLabel: string
    let extraText = ''
    let jdkNote: string | null = null
    const op = sink.operationId
    if ((op === 'anyMatch' || op === 'allMatch' || op === 'noneMatch') && !rt.decided) {
      // 全要素評価またはPredicate 0回（空Stream）で決定要素が現れなかった場合の結果
      rt.resultValue = op === 'anyMatch' ? false : true
      rt.decided = true
      if (rt.evaluatedCount === 0 && rt.resultValue) {
        extraText =
          op === 'allMatch'
            ? '空Streamでは反例が存在しないため、allMatchはtrue（vacuous truth）です。Predicateは一度も評価されていません。'
            : '空Streamでは該当が存在しないため、noneMatchはtrue（vacuous truth）です。Predicateは一度も評価されていません。'
        jdkNote = 'anyMatchの空Stream結果はfalse、allMatch / noneMatchの空Stream結果はtrue（vacuous truth）です。'
      }
    }
    syncTerminal()
    const view = b.terminalResult
    switch (view.kind) {
      case 'SCALAR':
        resultLabel = `${view.typeLabel} = ${view.valueLabel}`
        break
      case 'OPTIONAL':
        resultLabel = view.present
          ? `${view.optionalTypeLabel}[${view.valueLabel}]`
          : `${view.optionalTypeLabel}.empty()`
        break
      case 'ARRAY':
        resultLabel = `${view.componentTypeLabel}[]（length=${view.length}）`
        break
      case 'STATISTICS':
        resultLabel = `${view.statisticsTypeLabel}（count=${view.countLabel}, sum=${view.sumLabel}, min=${view.minLabel}, average=${view.averageLabel}, max=${view.maxLabel}）`
        break
      case 'VOID':
        resultLabel = `void（Consumer呼出し${rt.callCount}回）`
        break
      default:
        resultLabel = formatTypeRef(def.resultType)
    }
    if (op === 'count') {
      jdkNote = COUNT_ELISION_NOTE
    } else if (op === 'findAny') {
      jdkNote = FIND_ANY_NOTE
    } else if (op === 'summaryStatistics' && rt.aggCount === 0) {
      jdkNote =
        '空Streamのmin / maxは型の正規初期値（MAX_VALUE / MIN_VALUE、doubleは正負Infinity）です。'
    } else if (op === 'average' && rt.aggCount === 0) {
      jdkNote = '空Streamのaverage()はOptionalDouble.empty()を返します。'
    } else if (op === 'reduce' && !sink.identity && rt.acc === null) {
      jdkNote = 'identityなしのreduceは、空Streamで型に応じた空Optionalを返します。'
    } else if (op === 'reduce' && sink.hasCombiner) {
      jdkNote = `sequential実行のためcombinerは呼ばれませんでした（呼出し0回）。combinerはparallel reductionで必要になります。`
    }
    b.push({
      kind: 'RESULT_CONFIRMED',
      activeNode: sink,
      processing: {
        title: '終端結果確定',
        inputLabel: null,
        expression: null,
        evaluation: null,
        outcome: `結果（${formatTypeRef(def.resultType)}）が確定しました: ${resultLabel}`,
      },
      currentText: `終端結果が確定しました。結果は${resultLabel}です。${extraText}`,
      jdkNote,
      confirmed: true,
    })
  }
  b.push({
    kind: 'STREAM_CONSUMED',
    activeNode: sink,
    processing: {
      title: 'STREAM CONSUMED',
      inputLabel: null,
      expression: null,
      evaluation: null,
      outcome: 'Streamは消費済みです',
    },
    currentText: 'Streamは消費済み（STREAM CONSUMED）です。再実行するには最初からやり直します。',
    jdkNote:
      '終端操作の後、Streamは消費済みになります。再利用するとIllegalStateExceptionになる場合があります。',
    confirmed: true,
    completion: 'STREAM_CONSUMED',
  })

  return materialize(def, b.drafts)
}

function legendOf(def: PipelineDefinition) {
  const target = def.nodes.find((n) => n.nodeId === def.targetNodeId)
  if (target) return target.legendStates
  const firstIntermediate = def.nodes.find((n) => n.role === 'intermediate')
  return firstIntermediate
    ? firstIntermediate.legendStates
    : (['UNEVALUATED', 'PROCESSING', 'PASSED'] as const)
}

function materialize(def: PipelineDefinition, drafts: readonly Draft[]): Snapshot[] {
  const legend = legendOf(def)
  return drafts.map((draft, index) => {
    const next = drafts[index + 1]
    const snapshot: Snapshot = {
      snapshotId: snapshotIdFor(def.revision, index),
      index,
      revision: def.revision,
      kind: draft.kind,
      activeNodeId: draft.activeNode?.nodeId ?? null,
      activeLineId: draft.activeNode?.lineId ?? null,
      currentElementId: draft.currentElementId,
      parentElementId: draft.parentElementId,
      flatMapContext: draft.flatMapContext,
      sourceContext: draft.sourceContext,
      typeTransition: draft.typeTransition,
      elementNodeStates: draft.perNode,
      elementLatestStates: draft.latest,
      operationContexts: draft.operationContexts,
      sideEffects: draft.sideEffects,
      output: {
        elementIds: draft.outputItems.map((item) => item.id),
        items: draft.outputItems,
        count: draft.outputItems.length,
        confirmed: draft.confirmed,
        resultTypeLabel: formatTypeRef(def.resultType),
        result: draft.terminalResult,
      },
      processing: draft.processing,
      explanation: {
        current: draft.currentText,
        next: next ? `次: ${next.currentText}` : '次のsnapshotはありません。',
        jdkNote: draft.jdkNote,
      },
      legend,
      completion: draft.completion,
    }
    return deepFreeze(snapshot)
  })
}

const timelineCache = new WeakMap<PipelineDefinition, readonly Snapshot[]>()

/** defから決定的timelineを取得する（キャッシュ付き・純粋） */
export function getTimeline(def: PipelineDefinition): readonly Snapshot[] {
  const cached = timelineCache.get(def)
  if (cached) return cached
  const timeline = buildTimeline(def)
  timelineCache.set(def, timeline)
  return timeline
}

/** 初期snapshot（INITIAL）を生成する。 */
export function createInitialSnapshot(def: PipelineDefinition): Snapshot {
  try {
    const timeline = getTimeline(def)
    const first = timeline[0]
    if (!first) throw new EngineInvariantError('timelineが空です')
    return first
  } catch (e) {
    if (e instanceof EngineInvariantError) {
      // defに不整合がある場合もINITIAL自体は返し、進行時にERRORへ遷移させる（J-3）
      return deepFreeze({
        snapshotId: snapshotIdFor(def.revision, 0),
        index: 0,
        revision: def.revision,
        kind: 'INITIAL',
        activeNodeId: null,
        activeLineId: null,
        currentElementId: null,
        parentElementId: null,
        flatMapContext: null,
        sourceContext: null,
        typeTransition: null,
        elementNodeStates: {},
        elementLatestStates: {},
        operationContexts: {},
        sideEffects: [],
        output: {
          elementIds: [],
          items: [],
          count: 0,
          confirmed: false,
          resultTypeLabel: formatTypeRef(def.resultType),
          result: { kind: 'LIST' },
        },
        processing: null,
        explanation: {
          current: '初期状態です。まだ要素は処理されていません。',
          next: '次のsnapshotを導出できません。',
          jdkNote: null,
        },
        legend: legendOf(def),
        completion: 'NONE',
      } satisfies Snapshot)
    }
    throw e
  }
}

/**
 * 次の確定snapshotを1件だけ生成する（§13.1）。
 * 最終snapshot（STREAM_CONSUMED）の後はnullを返す。
 * currentのrevisionがdefと一致しない場合はEngineInvariantError（J-3フェイルセーフ）。
 */
export function nextSnapshot(def: PipelineDefinition, current: Snapshot): Snapshot | null {
  if (current.revision !== def.revision) {
    throw new EngineInvariantError(
      `snapshotのrevision ${current.revision} がPipelineDefinition ${def.revision} と一致しません`,
    )
  }
  const timeline = getTimeline(def)
  const own = timeline[current.index]
  if (!own || own.snapshotId !== current.snapshotId) {
    throw new EngineInvariantError(`snapshot ${current.snapshotId} はこのPipelineDefinitionの実行位置と一致しません`)
  }
  return timeline[current.index + 1] ?? null
}
