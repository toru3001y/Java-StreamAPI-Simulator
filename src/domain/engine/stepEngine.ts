import type { PipelineDefinition, PipelineNodeDef } from '../pipeline/pipelineDefinition'
import type { ElementStateKind } from '../catalog/operationCatalog'
import { evaluatePredicate } from '../dsl/evaluate'
import { evaluateFlatMapper, evaluateMapper } from '../dsl/evaluateMapper'
import {
  comparisonExpr,
  describeMapper,
  describePredicate,
  fieldValueFlow,
} from '../dsl/explanation'
import { mapperToJavaExpr, predicateToJavaExpr } from '../dsl/javaCode'
import { formatSimValue, type SimValue } from '../model/value'
import { formatTypeRef } from '../types/typeRef'
import type { ElementId } from '../types/ids'
import { snapshotIdFor } from '../types/ids'
import { deepFreeze } from '../util/deepFreeze'
import type {
  FlatMapContextView,
  ProcessingView,
  Snapshot,
  SnapshotKind,
  SnapshotOutputItem,
  SourceContextView,
} from './snapshot'

/**
 * Step Engine（§13）。
 * PipelineDefinitionから決定的なsnapshot列（timeline）を純粋に導出する。
 * next(currentSnapshot, def)は保存済みtimelineの次要素を返すだけであり、
 * 同じrevisionからは常に同じsnapshot列が得られる（§12.6、§19）。
 * DOM、タイマー、アニメーションへ依存しない。
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
  perNode: Record<ElementId, Record<string, ElementStateKind>>
  latest: Record<ElementId, ElementStateKind>
  outputItems: SnapshotOutputItem[]
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
  private flatMapCtx: MutableFlatMapCtx | null = null

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
      perNode: structuredClone(this.perNode),
      latest: structuredClone(this.latest),
      outputItems: [...this.outputItems],
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
    throw new EngineInvariantError(`filter node ${node.nodeId} にPredicateがありません`)
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

function buildTimeline(def: PipelineDefinition): Snapshot[] {
  const b = new TimelineBuilder(def)
  const { src, chain, sink } = nodesOf(def)

  for (const element of def.dataset) b.registerElement(element.elementId)

  b.push({
    kind: 'INITIAL',
    activeNode: null,
    currentText: '初期状態です。まだ要素は処理されていません。',
  })

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
        if (children.length === 0) {
          b.setState(elementId, node.nodeId, 'PASSED')
          b.setLatest(elementId, 'PASSED')
        }
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
        childValues.forEach((childValue, ci) => {
          const child = children[ci]
          if (!child) throw new EngineInvariantError(`child index ${ci} が不正です`)
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
          if (ci === children.length - 1) {
            // 最後の子の処理完了後、mapped Streamのclose状態を該当snapshotの詳細へ反映する（§9.3）
            ctx.closed = true
            b.setState(elementId, node.nodeId, 'PASSED')
            b.setLatest(elementId, 'PASSED')
            b.patchLastDraft()
          }
        })
        // 親要素自身は後段へ渡らない（子がflattenされて流れる）
        return false
      }

      throw new EngineInvariantError(`未対応のoperationです: ${node.operationId}`)
    }

    // 終端（toList）へ到達
    const finalLabel = formatSimValue(value)
    const finalName = shortLabel(value)
    b.setState(elementId, sink.nodeId, 'PASSED')
    b.setLatest(elementId, 'PASSED')
    b.addOutput(elementId, finalLabel)
    b.push({
      kind: 'SINK_APPENDED',
      activeNode: sink,
      currentElementId: elementId,
      parentElementId,
      processing: {
        title: 'toListへの要素追加',
        inputLabel: `${finalName} → List`,
        expression: null,
        evaluation: null,
        outcome: 'Listへ追加されました',
      },
      currentText: `${finalName}がtoListのListへ追加されます。`,
    })
    return true
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
  }

  const sourceDsl = def.sourceDsl
  if (sourceDsl.kind === 'iterate3') {
    if (!def.iterateTrace) throw new EngineInvariantError('iterate3のtraceがありません')
    const predicateText = `n -> n ${sourceDsl.predicate.operator === 'LTE' ? '<=' : '<'} ${sourceDsl.predicate.value}`
    let elementIdx = 0
    def.iterateTrace.forEach((candidate, ci) => {
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
    })
  } else {
    for (const element of def.dataset) {
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

  b.clearFlatMapCtx()
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
      output: {
        elementIds: draft.outputItems.map((item) => item.id),
        items: draft.outputItems,
        count: draft.outputItems.length,
        confirmed: draft.confirmed,
        resultTypeLabel: formatTypeRef(def.resultType),
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
        output: {
          elementIds: [],
          items: [],
          count: 0,
          confirmed: false,
          resultTypeLabel: formatTypeRef(def.resultType),
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
