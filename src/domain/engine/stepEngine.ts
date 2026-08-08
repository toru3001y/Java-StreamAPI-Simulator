import type { PipelineDefinition, PipelineNodeDef } from '../pipeline/pipelineDefinition'
import type { ElementStateKind } from '../catalog/operationCatalog'
import { evaluatePredicate } from '../dsl/evaluate'
import { comparisonExpr, describePredicate, fieldValueFlow } from '../dsl/explanation'
import { predicateToJavaExpr } from '../dsl/javaCode'
import type { DatasetElement } from '../model/employee'
import { formatTypeRef } from '../types/typeRef'
import type { ElementId, NodeId } from '../types/ids'
import { snapshotIdFor } from '../types/ids'
import { deepFreeze } from '../util/deepFreeze'
import type { ProcessingView, Snapshot, SnapshotKind, SnapshotProgress } from './snapshot'

/**
 * Step Engine（§13）。
 * next(currentSnapshot, pipelineDefinition)は次の確定snapshotを決定的に生成する純粋なDomain処理。
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

function filterNodes(def: PipelineDefinition): readonly PipelineNodeDef[] {
  return def.nodes.filter((n) => n.role === 'intermediate')
}

function sourceNode(def: PipelineDefinition): PipelineNodeDef {
  const node = def.nodes.find((n) => n.role === 'source')
  if (!node) throw new EngineInvariantError('source nodeが存在しません')
  return node
}

function sinkNode(def: PipelineDefinition): PipelineNodeDef {
  const node = def.nodes.find((n) => n.role === 'terminal')
  if (!node) throw new EngineInvariantError('terminal nodeが存在しません')
  return node
}

function elementAt(def: PipelineDefinition, index: number): DatasetElement {
  const element = def.dataset[index]
  if (!element) throw new EngineInvariantError(`要素index ${index} が範囲外です`)
  return element
}

function predicateOf(node: PipelineNodeDef) {
  if (!node.predicate) {
    throw new EngineInvariantError(`filter node ${node.nodeId} にPredicateがありません`)
  }
  return node.predicate
}

/** 要素が最後に到達するfilter位置と最終通過可否（決定的） */
function elementOutcome(
  def: PipelineDefinition,
  elementIndex: number,
): { readonly rejectedAt: number | null } {
  const element = elementAt(def, elementIndex)
  const filters = filterNodes(def)
  for (let j = 0; j < filters.length; j++) {
    const node = filters[j]
    if (!node) throw new EngineInvariantError(`filter index ${j} が不正です`)
    if (!evaluatePredicate(predicateOf(node), element.value)) {
      return { rejectedAt: j }
    }
  }
  return { rejectedAt: null }
}

/** 現在位置から次の実行位置を決定的に導出する（§13.2の独立snapshot列） */
function nextProgress(def: PipelineDefinition, progress: SnapshotProgress): SnapshotProgress | null {
  const filters = filterNodes(def)
  const elementCount = def.dataset.length
  const advanceToNextElement = (elementIndex: number): SnapshotProgress =>
    elementIndex + 1 < elementCount
      ? { phase: 'ELEMENT', elementIndex: elementIndex + 1, stage: { kind: 'EMITTED' } }
      : { phase: 'RESULT' }

  switch (progress.phase) {
    case 'INITIAL':
      return elementCount === 0
        ? { phase: 'RESULT' }
        : { phase: 'ELEMENT', elementIndex: 0, stage: { kind: 'EMITTED' } }
    case 'ELEMENT': {
      const { elementIndex, stage } = progress
      if (elementIndex < 0 || elementIndex >= elementCount) {
        throw new EngineInvariantError(`要素index ${elementIndex} が範囲外です`)
      }
      switch (stage.kind) {
        case 'EMITTED':
          if (filters.length === 0) {
            return { phase: 'ELEMENT', elementIndex, stage: { kind: 'APPENDED' } }
          }
          return { phase: 'ELEMENT', elementIndex, stage: { kind: 'ARRIVED', filterIndex: 0 } }
        case 'ARRIVED': {
          const node = filters[stage.filterIndex]
          if (!node) throw new EngineInvariantError(`filter index ${stage.filterIndex} が不正です`)
          const result = evaluatePredicate(predicateOf(node), elementAt(def, elementIndex).value)
          return {
            phase: 'ELEMENT',
            elementIndex,
            stage: { kind: 'EVALUATED', filterIndex: stage.filterIndex, result },
          }
        }
        case 'EVALUATED':
          return {
            phase: 'ELEMENT',
            elementIndex,
            stage: { kind: 'RESOLVED', filterIndex: stage.filterIndex, passed: stage.result },
          }
        case 'RESOLVED':
          if (!stage.passed) {
            return advanceToNextElement(elementIndex)
          }
          if (stage.filterIndex + 1 < filters.length) {
            return {
              phase: 'ELEMENT',
              elementIndex,
              stage: { kind: 'ARRIVED', filterIndex: stage.filterIndex + 1 },
            }
          }
          return { phase: 'ELEMENT', elementIndex, stage: { kind: 'APPENDED' } }
        case 'APPENDED':
          return advanceToNextElement(elementIndex)
      }
      throw new EngineInvariantError('未知のelement stageです')
    }
    case 'RESULT':
      return { phase: 'CONSUMED' }
    case 'CONSUMED':
      return null
    default:
      throw new EngineInvariantError('未知のprogress phaseです')
  }
}

function kindOf(progress: SnapshotProgress): SnapshotKind {
  switch (progress.phase) {
    case 'INITIAL':
      return 'INITIAL'
    case 'ELEMENT':
      switch (progress.stage.kind) {
        case 'EMITTED':
          return 'SOURCE_EMIT'
        case 'ARRIVED':
          return 'NODE_ARRIVAL'
        case 'EVALUATED':
          return 'PREDICATE_EVALUATED'
        case 'RESOLVED':
          return progress.stage.passed ? 'ELEMENT_PASSED' : 'ELEMENT_REJECTED'
        case 'APPENDED':
          return 'SINK_APPENDED'
      }
      throw new EngineInvariantError('未知のelement stageです')
    case 'RESULT':
      return 'RESULT_CONFIRMED'
    case 'CONSUMED':
      return 'STREAM_CONSUMED'
  }
}

interface ComputedStates {
  readonly perNode: Record<ElementId, Record<NodeId, ElementStateKind>>
  readonly latest: Record<ElementId, ElementStateKind>
  readonly outputIds: ElementId[]
}

/**
 * 実行位置から全要素の状態履歴を決定的に再構成する。
 * snapshotは常にdef + progressの純粋関数であり、同一revisionから同一snapshot列を生成する（§12.6）。
 */
function computeStates(def: PipelineDefinition, progress: SnapshotProgress): ComputedStates {
  const filters = filterNodes(def)
  const src = sourceNode(def)
  const sink = sinkNode(def)
  const perNode: Record<ElementId, Record<NodeId, ElementStateKind>> = {}
  const latest: Record<ElementId, ElementStateKind> = {}
  const outputIds: ElementId[] = []

  const initStates = (): Record<NodeId, ElementStateKind> => {
    const states: Record<NodeId, ElementStateKind> = { [src.nodeId]: 'UNEVALUATED' }
    for (const f of filters) states[f.nodeId] = 'UNEVALUATED'
    states[sink.nodeId] = 'UNEVALUATED'
    return states
  }

  const applyFinalOutcome = (elementIndex: number, states: Record<NodeId, ElementStateKind>) => {
    const { rejectedAt } = elementOutcome(def, elementIndex)
    states[src.nodeId] = 'PASSED'
    const lastIndex = rejectedAt ?? filters.length
    for (let j = 0; j < filters.length; j++) {
      const node = filters[j]
      if (!node) continue
      if (j < lastIndex) states[node.nodeId] = 'PASSED'
      else if (j === rejectedAt) states[node.nodeId] = 'REJECTED'
      else states[node.nodeId] = 'UNEVALUATED'
    }
    if (rejectedAt === null) {
      states[sink.nodeId] = 'PASSED'
      return 'PASSED' as ElementStateKind
    }
    return 'REJECTED' as ElementStateKind
  }

  const currentElementIndex = progress.phase === 'ELEMENT' ? progress.elementIndex : null
  const processedUpTo =
    progress.phase === 'INITIAL'
      ? -1
      : progress.phase === 'ELEMENT'
        ? progress.elementIndex - 1
        : def.dataset.length - 1

  def.dataset.forEach((element, i) => {
    const states = initStates()
    if (i <= processedUpTo) {
      const finalState = applyFinalOutcome(i, states)
      latest[element.elementId] = finalState
      if (finalState === 'PASSED') outputIds.push(element.elementId)
    } else if (i === currentElementIndex && progress.phase === 'ELEMENT') {
      const stage = progress.stage
      switch (stage.kind) {
        case 'EMITTED':
          states[src.nodeId] = 'PROCESSING'
          latest[element.elementId] = 'PROCESSING'
          break
        case 'ARRIVED':
        case 'EVALUATED': {
          states[src.nodeId] = 'PASSED'
          for (let j = 0; j < stage.filterIndex; j++) {
            const node = filters[j]
            if (node) states[node.nodeId] = 'PASSED'
          }
          const node = filters[stage.filterIndex]
          if (!node) throw new EngineInvariantError(`filter index ${stage.filterIndex} が不正です`)
          states[node.nodeId] = 'PROCESSING'
          latest[element.elementId] = 'PROCESSING'
          break
        }
        case 'RESOLVED': {
          states[src.nodeId] = 'PASSED'
          for (let j = 0; j < stage.filterIndex; j++) {
            const node = filters[j]
            if (node) states[node.nodeId] = 'PASSED'
          }
          const node = filters[stage.filterIndex]
          if (!node) throw new EngineInvariantError(`filter index ${stage.filterIndex} が不正です`)
          states[node.nodeId] = stage.passed ? 'PASSED' : 'REJECTED'
          latest[element.elementId] = stage.passed ? 'PASSED' : 'REJECTED'
          break
        }
        case 'APPENDED': {
          states[src.nodeId] = 'PASSED'
          for (const f of filters) states[f.nodeId] = 'PASSED'
          states[sink.nodeId] = 'PASSED'
          latest[element.elementId] = 'PASSED'
          outputIds.push(element.elementId)
          break
        }
      }
    } else {
      latest[element.elementId] = 'UNEVALUATED'
    }
    perNode[element.elementId] = states
  })

  return { perNode, latest, outputIds }
}

function activeNodeOf(def: PipelineDefinition, progress: SnapshotProgress): PipelineNodeDef | null {
  const filters = filterNodes(def)
  switch (progress.phase) {
    case 'INITIAL':
      return null
    case 'ELEMENT':
      switch (progress.stage.kind) {
        case 'EMITTED':
          return sourceNode(def)
        case 'ARRIVED':
        case 'EVALUATED':
        case 'RESOLVED': {
          const node = filters[progress.stage.filterIndex]
          if (!node) {
            throw new EngineInvariantError(`filter index ${progress.stage.filterIndex} が不正です`)
          }
          return node
        }
        case 'APPENDED':
          return sinkNode(def)
      }
      throw new EngineInvariantError('未知のelement stageです')
    case 'RESULT':
    case 'CONSUMED':
      return sinkNode(def)
  }
}

function processingOf(def: PipelineDefinition, progress: SnapshotProgress): ProcessingView | null {
  if (progress.phase === 'INITIAL') return null
  if (progress.phase === 'RESULT') {
    return {
      title: '終端結果確定',
      inputLabel: null,
      expression: null,
      evaluation: null,
      outcome: `結果のList（${formatTypeRef(def.resultType)}）が確定しました`,
    }
  }
  if (progress.phase === 'CONSUMED') {
    return {
      title: 'STREAM CONSUMED',
      inputLabel: null,
      expression: null,
      evaluation: null,
      outcome: 'Streamは消費済みです',
    }
  }
  const element = elementAt(def, progress.elementIndex)
  const name = element.value.name
  const filters = filterNodes(def)
  const stage = progress.stage
  switch (stage.kind) {
    case 'EMITTED':
      return {
        title: 'sourceからの要素送出',
        inputLabel: `${name}（age=${element.value.age}） → Pipeline`,
        expression: null,
        evaluation: null,
        outcome: null,
      }
    case 'ARRIVED': {
      const node = filters[stage.filterIndex]
      if (!node) throw new EngineInvariantError(`filter index ${stage.filterIndex} が不正です`)
      return {
        title: `${node.displayName}への要素到着`,
        inputLabel: `${name}（age=${element.value.age}）`,
        expression: predicateToJavaExpr(predicateOf(node)),
        evaluation: null,
        outcome: null,
      }
    }
    case 'EVALUATED': {
      const node = filters[stage.filterIndex]
      if (!node) throw new EngineInvariantError(`filter index ${stage.filterIndex} が不正です`)
      const predicate = predicateOf(node)
      return {
        title: 'Predicate評価確定',
        inputLabel: fieldValueFlow(predicate, name, element.value.age),
        expression: predicateToJavaExpr(predicate),
        evaluation: `${comparisonExpr(predicate, element.value.age)} → ${stage.result}`,
        outcome: null,
      }
    }
    case 'RESOLVED': {
      const node = filters[stage.filterIndex]
      if (!node) throw new EngineInvariantError(`filter index ${stage.filterIndex} が不正です`)
      const predicate = predicateOf(node)
      return {
        title: stage.passed ? '通過確定' : '除外確定',
        inputLabel: `${name}（age=${element.value.age}）`,
        expression: predicateToJavaExpr(predicate),
        evaluation: `${comparisonExpr(predicate, element.value.age)} → ${stage.passed}`,
        outcome: stage.passed ? '通過（後段へ渡されます）' : '除外（後段へは渡されません）',
      }
    }
    case 'APPENDED':
      return {
        title: 'toListへの要素追加',
        inputLabel: `${name} → List`,
        expression: null,
        evaluation: null,
        outcome: `Listへ追加されました`,
      }
  }
  throw new EngineInvariantError('未知のelement stageです')
}

/** 現在処理の短文説明（説明パネルのcurrent、および直前snapshotのnextに使用） */
function describeProgress(def: PipelineDefinition, progress: SnapshotProgress): string {
  switch (progress.phase) {
    case 'INITIAL':
      return '初期状態です。まだ要素は処理されていません。'
    case 'RESULT': {
      const stats = computeStates(def, progress)
      return `終端結果が確定しました。結果は${formatTypeRef(def.resultType)}（${stats.outputIds.length}件）です。`
    }
    case 'CONSUMED':
      return 'Streamは消費済み（STREAM CONSUMED）です。再実行するには最初からやり直します。'
    case 'ELEMENT': {
      const element = elementAt(def, progress.elementIndex)
      const name = element.value.name
      const filters = filterNodes(def)
      const stage = progress.stage
      switch (stage.kind) {
        case 'EMITTED':
          return `sourceが${name}を送出します。`
        case 'ARRIVED': {
          const node = filters[stage.filterIndex]
          if (!node) throw new EngineInvariantError(`filter index ${stage.filterIndex} が不正です`)
          const predicate = predicateOf(node)
          return `${name}が${node.displayName}（${predicateToJavaExpr(predicate)}）へ到着しました。${describePredicate(predicate)}。`
        }
        case 'EVALUATED': {
          const node = filters[stage.filterIndex]
          if (!node) throw new EngineInvariantError(`filter index ${stage.filterIndex} が不正です`)
          const predicate = predicateOf(node)
          return `${name}のage() ${element.value.age}を評価します。${comparisonExpr(predicate, element.value.age)} は ${stage.result} です。`
        }
        case 'RESOLVED':
          return stage.passed
            ? `${name}はPredicateがtrueのため通過し、後段へ渡されます。`
            : `${name}はPredicateがfalseのため除外されます。`
        case 'APPENDED':
          return `${name}がtoListのListへ追加されます。`
      }
      throw new EngineInvariantError('未知のelement stageです')
    }
  }
}

function jdkNoteOf(progress: SnapshotProgress): string | null {
  if (progress.phase === 'CONSUMED') {
    return '終端操作の後、Streamは消費済みになります。再利用するとIllegalStateExceptionになる場合があります。'
  }
  if (progress.phase === 'RESULT') {
    return 'Stream.toList()が返すListはunmodifiableです。'
  }
  if (progress.phase === 'ELEMENT' && progress.stage.kind === 'EMITTED') {
    return '中間操作は遅延評価であり、終端操作の実行時に初めて要素が流れます。'
  }
  return null
}

function legendOf(def: PipelineDefinition): readonly ElementStateKind[] {
  // 凡例は選択操作（Phase 1ではfilter）で発生し得る状態だけを表示する（§12.3、§22.3）
  const firstFilter = def.nodes.find((n) => n.role === 'intermediate')
  return firstFilter ? firstFilter.legendStates : ['UNEVALUATED', 'PROCESSING', 'PASSED']
}

function buildSnapshot(def: PipelineDefinition, index: number, progress: SnapshotProgress): Snapshot {
  const active = activeNodeOf(def, progress)
  const states = computeStates(def, progress)
  const next = nextProgress(def, progress)
  const confirmed = progress.phase === 'RESULT' || progress.phase === 'CONSUMED'
  const snapshot: Snapshot = {
    snapshotId: snapshotIdFor(def.revision, index),
    index,
    revision: def.revision,
    kind: kindOf(progress),
    progress,
    activeNodeId: active?.nodeId ?? null,
    activeLineId: active?.lineId ?? null,
    currentElementId:
      progress.phase === 'ELEMENT' ? elementAt(def, progress.elementIndex).elementId : null,
    elementNodeStates: states.perNode,
    elementLatestStates: states.latest,
    output: {
      elementIds: states.outputIds,
      count: states.outputIds.length,
      confirmed,
      resultTypeLabel: formatTypeRef(def.resultType),
    },
    processing: processingOf(def, progress),
    explanation: {
      current: describeProgress(def, progress),
      next: next ? `次: ${describeProgress(def, next)}` : '次のsnapshotはありません。',
      jdkNote: jdkNoteOf(progress),
    },
    legend: legendOf(def),
    completion: progress.phase === 'CONSUMED' ? 'STREAM_CONSUMED' : 'NONE',
  }
  return deepFreeze(snapshot)
}

/** 初期snapshot（INITIAL）を生成する。 */
export function createInitialSnapshot(def: PipelineDefinition): Snapshot {
  return buildSnapshot(def, 0, { phase: 'INITIAL' })
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
  const next = nextProgress(def, current.progress)
  if (next === null) return null
  return buildSnapshot(def, current.index + 1, next)
}
