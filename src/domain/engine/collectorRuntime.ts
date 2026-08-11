import type { CollectTripleDsl, CollectorDsl } from '../dsl/collectorAst'
import {
  COLLECTOR_MAP_FACTORY_META,
  COLLECTOR_SUPPLIER_CONTAINER_NAMES,
  COLLECT_TRIPLE_ID_COMBINATIONS,
  TEEING_MERGER_RECORDS,
  joiningArity,
  numericKindPrimitive,
} from '../dsl/collectorAst'
import type { ClassifierDsl } from '../dsl/collectorAst'
import type { MapperDsl } from '../dsl/mapperAst'
import {
  classifierToJavaExpr,
  collectorToJavaExpr,
  comparatorToJavaExpr,
  predicateToJavaExpr,
} from '../dsl/javaCode'
import { evaluateValuePredicate } from '../dsl/evaluate'
import { compareByComparator } from '../dsl/evaluateComparator'
import { evaluateMapper } from '../dsl/evaluateMapper'
import { applyReduction } from '../dsl/evaluateReduction'
import { resolveCollectorType } from '../dsl/validateCollector'
import { resolveMapperOutputType } from '../dsl/validateMapper'
import type { EmployeeValue } from '../model/employee'
import type { SimValue } from '../model/value'
import { formatDoubleLiteral, formatLongLiteral, formatSimValue } from '../model/value'
import type { TypeRef } from '../types/typeRef'
import { formatTypeRef } from '../types/typeRef'
import type { ElementId, NodeId } from '../types/ids'
import { distinctKeyOf } from './distinctKey'
import type {
  CollectorAccumulationView,
  CollectorBucketView,
  CollectorFinisherView,
  CollectorMapEntryView,
  CollectorNodeView,
  CollectorTeeingView,
  OperationContextView,
  ProcessingView,
  SnapshotKind,
  SnapshotOutputItem,
  TerminalResultView,
} from './snapshot'

/**
 * Phase 5 Collector Engine（指示§6.2・§9）。
 *
 * Phase 3のSTATEFUL共通バッファ（nodeId 1階層 + 固定フィールドのフラット構造）にも、
 * Phase 4の`TerminalRuntime`（全terminalを合併した平坦な単一構造体）にも押し込めないため、
 * **Collector ASTに対応する再帰的なCollectorRuntime**として別建てする。
 *
 * - container生成 / bucket決定 / 蓄積更新 / finisher適用 / merger適用をASTノード単位で表現する。
 * - snapshotの発行はStep Engine側（`emit`コールバック）へ委譲し、「1事象 = 1 snapshot」を守る。
 * - runtime内部では`Map` / `Set`を使うが、**viewはプレーンな木のみ**（`structuredClone` /
 *   `deepFreeze`可能。Map / Set / 関数 / 循環参照を含めない）。
 */

/** Step Engineへsnapshot 1件の発行を依頼する入力 */
export interface CollectorEmitInput {
  readonly kind: SnapshotKind
  readonly currentElementId: ElementId | null
  readonly processing: ProcessingView
  readonly currentText: string
  readonly jdkNote?: string | null
}

export type CollectorEmit = (input: CollectorEmitInput) => void

type BranchState = 'PENDING' | 'ACCUMULATING' | 'ACCUMULATED' | 'FINISHED'

interface TeeRuntime {
  activeBranch: 'NONE' | 'LEFT' | 'RIGHT'
  leftState: BranchState
  rightState: BranchState
  currentElementId: ElementId | null
  mergerApplied: boolean
  finalFields: { name: string; typeLabel: string; valueLabel: string }[] | null
}

interface BucketRuntime {
  readonly keyRef: string
  readonly keyLabel: string
  readonly createdSeq: number
  readonly node: CollectorRuntimeNode
}

interface ElementEntry {
  readonly id: ElementId
  readonly label: string
  readonly key: string
}

/** Collector ASTノード1つ分の実行時状態 */
interface CollectorRuntimeNode {
  readonly nodeKey: string
  readonly dsl: CollectorDsl
  readonly inputType: TypeRef
  readonly resultType: TypeRef
  readonly label: string
  /** コンテナ表示名（toList / toSet / toCollection / 3引数collect） */
  readonly containerLabel: string
  // ---- 蓄積状態 ----
  elements: ElementEntry[]
  elementKeys: Set<string>
  changedByLast: boolean | null
  containerCreated: boolean
  text: string
  count: number
  sum: number
  sumCompensation: number
  simpleSum: number
  min: number | null
  max: number | null
  candidate: { id: ElementId; value: SimValue } | null
  acc: SimValue | null
  updateCount: number
  // ---- 合成 ----
  downstream: CollectorRuntimeNode | null
  left: CollectorRuntimeNode | null
  right: CollectorRuntimeNode | null
  buckets: BucketRuntime[]
  bucketIndex: Map<string, BucketRuntime>
  bucketCreatedByLast: boolean
  // ---- finisher ----
  finished: boolean
  finisherBefore: string | null
  finisherAfter: string | null
  // ---- teeing ----
  tee: TeeRuntime | null
}

export interface CollectorRuntime {
  readonly nodeId: NodeId
  readonly op: 'collect' | 'collectTriple'
  readonly root: CollectorRuntimeNode
  readonly triple: CollectTripleDsl | null
  currentPath: string[]
  currentPathLabel: string | null
}

// ---- 生成 ----

function nodeContainerLabel(dsl: CollectorDsl): string {
  switch (dsl.kind) {
    case 'toList':
      return 'List'
    case 'toSet':
      return 'Set'
    case 'toCollection':
      return COLLECTOR_SUPPLIER_CONTAINER_NAMES[dsl.supplierId]
    default:
      return ''
  }
}

function createNode(dsl: CollectorDsl, inputType: TypeRef, nodeKey: string): CollectorRuntimeNode {
  const resolved = resolveCollectorType(dsl, inputType)
  if (!resolved.ok) {
    throw new Error(
      `Collector結果型を解決できません: ${resolved.issues.map((i) => i.message).join(' / ')}`,
    )
  }
  const node: CollectorRuntimeNode = {
    nodeKey,
    dsl,
    inputType,
    resultType: resolved.value,
    label: collectorToJavaExpr(dsl),
    containerLabel: nodeContainerLabel(dsl),
    elements: [],
    elementKeys: new Set<string>(),
    changedByLast: null,
    containerCreated: false,
    text: '',
    count: 0,
    sum: 0,
    sumCompensation: 0,
    simpleSum: 0,
    min: null,
    max: null,
    candidate: null,
    acc: null,
    updateCount: 0,
    downstream: null,
    left: null,
    right: null,
    buckets: [],
    bucketIndex: new Map<string, BucketRuntime>(),
    bucketCreatedByLast: false,
    finished: false,
    finisherBefore: null,
    finisherAfter: null,
    tee: null,
  }
  switch (dsl.kind) {
    case 'mapping': {
      const mapped = mapperOutputType(dsl.mapper, inputType)
      node.downstream = createNode(dsl.downstream, mapped, `${nodeKey}.down`)
      break
    }
    case 'flatMapping': {
      const mapped = mapperOutputType(dsl.mapper, inputType)
      if (mapped.kind !== 'collection') throw new Error('flatMappingのmapperはコンテナが必要です')
      node.downstream = createNode(dsl.downstream, mapped.elementType, `${nodeKey}.down`)
      break
    }
    case 'filtering':
    case 'collectingAndThen':
      node.downstream = createNode(dsl.downstream, inputType, `${nodeKey}.down`)
      break
    case 'groupingBy':
      node.downstream = createNode(
        dsl.downstream ?? { kind: 'toList' },
        inputType,
        `${nodeKey}.down`,
      )
      break
    case 'partitioningBy': {
      node.downstream = createNode(
        dsl.downstream ?? { kind: 'toList' },
        inputType,
        `${nodeKey}.down`,
      )
      // true / falseの2分岐を固定表示する（空ソースでも両キーを保持。§9.2）
      for (const key of ['false', 'true']) {
        addBucket(node, key, key, inputType)
      }
      break
    }
    case 'teeing':
      node.left = createNode(dsl.left, inputType, `${nodeKey}.left`)
      node.right = createNode(dsl.right, inputType, `${nodeKey}.right`)
      node.tee = {
        activeBranch: 'NONE',
        leftState: 'PENDING',
        rightState: 'PENDING',
        currentElementId: null,
        mergerApplied: false,
        finalFields: null,
      }
      break
    default:
      break
  }
  return node
}

function addBucket(
  node: CollectorRuntimeNode,
  keyRef: string,
  keyLabel: string,
  inputType: TypeRef,
): BucketRuntime {
  const dsl = node.dsl
  if (dsl.kind !== 'groupingBy' && dsl.kind !== 'partitioningBy') {
    throw new Error(`bucketを持たないCollectorです: ${dsl.kind}`)
  }
  const createdSeq = node.buckets.length + 1
  const bucket: BucketRuntime = {
    keyRef,
    keyLabel,
    createdSeq,
    node: createNode(
      dsl.downstream ?? { kind: 'toList' },
      inputType,
      `${node.nodeKey}.bucket#${createdSeq}`,
    ),
  }
  node.buckets.push(bucket)
  node.bucketIndex.set(keyRef, bucket)
  return bucket
}

/** mapperの出力要素型（検証済みASTのためここでは失敗しない） */
function mapperOutputType(mapper: MapperDsl, inputType: TypeRef): TypeRef {
  const result = resolveMapperOutputType(mapper, inputType)
  if (!result.ok) throw new Error('mapperの出力型を解決できません')
  return result.value
}

export function createCollectorRuntime(
  nodeId: NodeId,
  elementType: TypeRef,
  collector: CollectorDsl | null,
  triple: CollectTripleDsl | null,
): CollectorRuntime {
  if (collector) {
    return {
      nodeId,
      op: 'collect',
      root: createNode(collector, elementType, 'c0'),
      triple: null,
      currentPath: [],
      currentPathLabel: null,
    }
  }
  if (!triple) throw new Error('collectorもcollectTripleもありません')
  const combo = COLLECT_TRIPLE_ID_COMBINATIONS.find(
    (c) =>
      c.supplierId === triple.supplierId &&
      c.accumulatorId === triple.accumulatorId &&
      c.combinerId === triple.combinerId,
  )
  if (!combo) throw new Error('許可されていない3引数collectのID組合せです')
  // 3引数collectは「裸の可変リダクション」。コンテナ = 結果（toList相当の蓄積）
  const root = createNode({ kind: 'toList' }, elementType, 'c0')
  const named: CollectorRuntimeNode = { ...root, containerLabel: combo.containerName }
  return {
    nodeId,
    op: 'collectTriple',
    root: named,
    triple,
    currentPath: [],
    currentPathLabel: null,
  }
}

// ---- 値ユーティリティ ----

function shortLabel(value: SimValue): string {
  return value.kind === 'employee' ? value.value.name : formatSimValue(value)
}

function employeeOf(value: SimValue): EmployeeValue {
  if (value.kind !== 'employee') throw new Error('Employee要素が必要です')
  return value.value
}

function numericFieldValue(value: SimValue, field: string): number {
  const employee = employeeOf(value)
  switch (field) {
    case 'age':
      return employee.age
    case 'salary':
      return employee.salary
    case 'evaluation':
      return employee.evaluation
    default:
      throw new Error(`Collector数値集計で未対応のfieldです: ${field}`)
  }
}

function stringOf(value: SimValue): string {
  if (value.kind !== 'string') throw new Error('String要素が必要です')
  return value.value
}

/**
 * 補償付き加算（JDKの`Collectors.sumWithCompensation`と同じ手順）。
 *
 * 補償値`sumCompensation`は各入力から**減算**して累積するため（`tmp = value - compensation`）、
 * 最終値は`sum - compensation`となる（`finalCompensatedSum`参照）。
 * JDK 25実測で確認済み: `Collectors.summingDouble`で[0.001, 0.01]は0.011000000000000001
 * （`sum + compensation`では0.010999999999999998となり不一致）。
 */
function addWithCompensation(state: CompensatedSumState, value: number): void {
  const tmp = value - state.sumCompensation
  const velvel = state.sum + tmp
  state.sumCompensation = velvel - state.sum - tmp
  state.sum = velvel
  state.simpleSum += value
}

/** 補償付き加算の途中状態（`CollectorRuntimeNode`が構造的に満たす） */
interface CompensatedSumState {
  sum: number
  sumCompensation: number
  simpleSum: number
}

/**
 * 補償付き加算の最終値（JDKの`computeFinalSum`と同じ判定）。
 * 補償値は減算して累積されているため`sum - compensation`を返す。
 * 合算がNaNかつ単純合計が無限大のときは単純合計を返す（JDKと同じフォールバック）。
 */
function finalCompensatedSum(state: CompensatedSumState): number {
  const tmp = state.sum - state.sumCompensation
  if (Number.isNaN(tmp) && !Number.isFinite(state.simpleSum) && !Number.isNaN(state.simpleSum)) {
    return state.simpleSum
  }
  return tmp
}

function finalDoubleSum(node: CollectorRuntimeNode): number {
  return finalCompensatedSum(node)
}

/**
 * double列の補償付き合計（`Collectors.summingDouble`相当）。
 * Simulation Coreのdouble集計アルゴリズムをJDKと照合するため、Oracle期待値の生成と
 * Domainテストから直接呼べる純関数として公開する。
 */
export function compensatedSum(values: readonly number[]): number {
  const state: CompensatedSumState = { sum: 0, sumCompensation: 0, simpleSum: 0 }
  for (const value of values) addWithCompensation(state, value)
  return finalCompensatedSum(state)
}

const INT_MAX = 2_147_483_647
const INT_MIN = -2_147_483_648
/** Long.MAX_VALUE / MIN_VALUEは10進文字列で保持する（JavaScript numberでは正確に表せない） */
const LONG_MAX_STRING = '9223372036854775807'
const LONG_MIN_STRING = '-9223372036854775808'

/** 数値種別に応じた値ラベル */
function numericLabel(primitive: 'Int' | 'Long' | 'Double', n: number): string {
  if (primitive === 'Int') return String(n)
  if (primitive === 'Long') return formatLongLiteral(n)
  return formatDoubleLiteral(n)
}

// ---- 蓄積 ----

interface WalkCtx {
  readonly emit: CollectorEmit
  readonly rt: CollectorRuntime
  readonly elementId: ElementId
  readonly path: string[]
  readonly pathLabels: string[]
}

function enter(ctx: WalkCtx, node: CollectorRuntimeNode, label: string): void {
  // bucket決定時に既に経路へ入っている場合は重複させない（enterBucket参照）
  if (ctx.path[ctx.path.length - 1] !== node.nodeKey) {
    ctx.path.push(node.nodeKey)
    ctx.pathLabels.push(label)
  }
  ctx.rt.currentPath = [...ctx.path]
  ctx.rt.currentPathLabel = ctx.pathLabels.join(' → ')
}

function pathLabelOnly(ctx: WalkCtx, label: string): void {
  ctx.pathLabels.push(label)
  ctx.rt.currentPathLabel = ctx.pathLabels.join(' → ')
}

/** bucket決定時に、そのbucketのdownstreamノードを現在経路へ含める */
function enterBucket(ctx: WalkCtx, bucketNodeKey: string, label: string): void {
  ctx.path.push(bucketNodeKey)
  ctx.pathLabels.push(label)
  ctx.rt.currentPath = [...ctx.path]
  ctx.rt.currentPathLabel = ctx.pathLabels.join(' → ')
}

/** 蓄積を持つ末端Collectorか（teeing branch rootの発行kind判定に使う） */
function isLeafAccumulator(dsl: CollectorDsl): boolean {
  switch (dsl.kind) {
    case 'mapping':
    case 'filtering':
    case 'flatMapping':
    case 'collectingAndThen':
    case 'groupingBy':
    case 'partitioningBy':
    case 'teeing':
      return false
    default:
      return true
  }
}

/**
 * 1要素をCollectorツリーへ流し込む。
 * `overrideKind`はteeing branch rootの蓄積更新を`TEE_BRANCH_ACCUMULATED`にするための指定。
 */
function accumulateNode(
  node: CollectorRuntimeNode,
  value: SimValue,
  ctx: WalkCtx,
  overrideKind: SnapshotKind | null,
  overrideBranch: 'LEFT' | 'RIGHT' | null = null,
): void {
  const dsl = node.dsl
  const name = shortLabel(value)
  const branchText = overrideBranch === 'LEFT' ? '左branch' : overrideBranch === 'RIGHT' ? '右branch' : null
  const emitAccumulated = (
    inputLabel: string,
    evaluation: string,
    outcome: string,
    currentText: string,
    jdkNote?: string | null,
  ): void => {
    ctx.emit({
      kind: overrideKind ?? 'CONTAINER_UPDATED',
      currentElementId: ctx.elementId,
      processing: {
        title:
          branchText !== null
            ? `teeing branch蓄積更新（${overrideBranch}）`
            : overrideKind === 'TEE_BRANCH_ACCUMULATED'
              ? 'teeing branch蓄積更新'
              : 'Collector蓄積更新',
        inputLabel,
        expression: node.label,
        evaluation,
        outcome,
      },
      // teeing branchの蓄積では、どちらのbranchの蓄積が確定したかを説明へ含める
      currentText: branchText !== null ? `${branchText}の蓄積が確定しました。${currentText}` : currentText,
      jdkNote: jdkNote ?? null,
    })
  }

  switch (dsl.kind) {
    case 'toList':
    case 'toSet':
    case 'toCollection': {
      enter(ctx, node, node.containerLabel)
      const key = distinctKeyOf(value, ctx.elementId)
      const label = formatSimValue(value)
      if (dsl.kind === 'toSet' && node.elementKeys.has(key)) {
        // 重複は追加されず状態が変化しない（既存要素のelementIdは置換しない。§9.5）
        node.changedByLast = false
        emitAccumulated(
          `${name} → ${node.containerLabel}`,
          `${node.containerLabel}に同値の要素が既に存在します`,
          `追加しても変化しません（size=${node.elements.length}）`,
          `${name}はSetへ追加されますが、同値の要素が既にあるため状態は変化しません（size=${node.elements.length}）。`,
          'Setは重複を保持しません。最初に受理した要素が残るという表示規約は教材上の規約であり、JDKのSet内部動作やiteration order保証ではありません。',
        )
        return
      }
      node.elements.push({ id: ctx.elementId, label, key })
      node.elementKeys.add(key)
      node.changedByLast = true
      emitAccumulated(
        `${name} → ${node.containerLabel}`,
        `${node.containerLabel}へ追加します`,
        `${node.containerLabel}のsizeが${node.elements.length}になりました`,
        `${name}が${node.containerLabel}へ追加されました（size=${node.elements.length}）。`,
      )
      return
    }
    case 'joining': {
      enter(ctx, node, 'joining')
      const text = stringOf(value)
      const before = node.text
      const delimiter = dsl.delimiter?.value ?? ''
      node.text = node.count === 0 ? text : `${before}${delimiter}${text}`
      node.count += 1
      emitAccumulated(
        `"${text}" → 連結`,
        `"${before}" + "${text}" → "${node.text}"`,
        `現在の連結文字列は"${node.text}"です`,
        `"${text}"を連結しました。現在の連結文字列は"${node.text}"です。`,
      )
      return
    }
    case 'counting': {
      enter(ctx, node, 'counting')
      const before = node.count
      node.count += 1
      emitAccumulated(
        `${name} → 件数`,
        `${before} + 1 → ${node.count}`,
        `件数が${node.count}になりました`,
        `${name}を数えました。件数は${node.count}です。`,
      )
      return
    }
    case 'summingInt':
    case 'summingLong':
    case 'summingDouble': {
      enter(ctx, node, dsl.kind)
      const primitive = numericKindPrimitive(dsl.kind)
      const fieldValue = numericFieldValue(value, dsl.field)
      const before = primitive === 'Double' ? finalDoubleSum(node) : node.sum
      if (primitive === 'Double') addWithCompensation(node, fieldValue)
      else node.sum += fieldValue
      node.count += 1
      const after = primitive === 'Double' ? finalDoubleSum(node) : node.sum
      emitAccumulated(
        `${name}.${dsl.field}() → ${numericLabel(primitive, fieldValue)}`,
        `${numericLabel(primitive, before)} + ${numericLabel(primitive, fieldValue)} → ${numericLabel(primitive, after)}`,
        `合計が${numericLabel(primitive, after)}になりました`,
        `${name}の${dsl.field}を加算しました。合計は${numericLabel(primitive, after)}です。`,
      )
      return
    }
    case 'averagingInt':
    case 'averagingLong':
    case 'averagingDouble': {
      enter(ctx, node, dsl.kind)
      const primitive = numericKindPrimitive(dsl.kind)
      const fieldValue = numericFieldValue(value, dsl.field)
      if (primitive === 'Double') addWithCompensation(node, fieldValue)
      else node.sum += fieldValue
      node.count += 1
      const sumLabel = primitive === 'Double' ? formatDoubleLiteral(finalDoubleSum(node)) : String(node.sum)
      emitAccumulated(
        `${name}.${dsl.field}() → ${numericLabel(primitive, fieldValue)}`,
        `合計 ${sumLabel} / 件数 ${node.count}`,
        `平均は全要素の処理後にfinisherで確定します`,
        `${name}の${dsl.field}を蓄積しました（合計 ${sumLabel}、件数 ${node.count}）。平均はfinisherで確定します。`,
      )
      return
    }
    case 'summarizingInt':
    case 'summarizingLong':
    case 'summarizingDouble': {
      enter(ctx, node, dsl.kind)
      const primitive = numericKindPrimitive(dsl.kind)
      const fieldValue = numericFieldValue(value, dsl.field)
      if (primitive === 'Double') addWithCompensation(node, fieldValue)
      else node.sum += fieldValue
      node.count += 1
      node.min = node.min === null ? fieldValue : Math.min(node.min, fieldValue)
      node.max = node.max === null ? fieldValue : Math.max(node.max, fieldValue)
      const stats = statisticsLabels(node, primitive)
      emitAccumulated(
        `${name}.${dsl.field}() → ${numericLabel(primitive, fieldValue)}`,
        `count=${stats.countLabel}, sum=${stats.sumLabel}, min=${stats.minLabel}, max=${stats.maxLabel}`,
        `統計コンテナが更新されました`,
        `${name}の${dsl.field}を統計へ取り込みました（count=${stats.countLabel}, sum=${stats.sumLabel}）。`,
      )
      return
    }
    case 'minBy':
    case 'maxBy': {
      enter(ctx, node, dsl.kind)
      const beforeLabel = node.candidate ? shortLabel(node.candidate.value) : null
      let replaced = false
      if (!node.candidate) {
        node.candidate = { id: ctx.elementId, value }
        replaced = true
      } else {
        const cmp = compareByComparator(dsl.comparator, value, node.candidate.value)
        // BinaryOperator.minBy / maxBy相当。同値では先の候補を保持する
        if ((dsl.kind === 'minBy' && cmp < 0) || (dsl.kind === 'maxBy' && cmp > 0)) {
          node.candidate = { id: ctx.elementId, value }
          replaced = true
        }
      }
      if (replaced) node.updateCount += 1
      const afterLabel = node.candidate ? shortLabel(node.candidate.value) : null
      emitAccumulated(
        `${name} と 現在候補${beforeLabel === null ? 'なし' : `（${beforeLabel}）`}を比較`,
        `${comparatorToJavaExpr(dsl.comparator)}`,
        replaced ? `候補が${afterLabel}へ更新されました` : `候補は${afterLabel}のまま変わりません`,
        replaced
          ? `${name}が新しい候補になりました。`
          : `${name}は候補を更新しません（候補は${afterLabel}のままです）。`,
      )
      return
    }
    case 'reducing': {
      enter(ctx, node, 'reducing')
      const beforeLabel = node.acc ? formatSimValue(node.acc) : null
      node.acc = node.acc === null ? value : applyReduction(dsl.reduction, node.acc, value)
      node.updateCount += 1
      emitAccumulated(
        `${name} → accumulator`,
        `${beforeLabel === null ? '（初回）' : beforeLabel} → ${formatSimValue(node.acc)}`,
        `accumulatorが${formatSimValue(node.acc)}になりました`,
        `accumulatorを更新しました。現在値は${formatSimValue(node.acc)}です。`,
      )
      return
    }
    case 'mapping': {
      enter(ctx, node, 'mapping')
      const mapped = evaluateMapper(dsl.mapper, value)
      ctx.emit({
        kind: 'MAPPING_APPLIED',
        currentElementId: ctx.elementId,
        processing: {
          title: 'Collector mapper適用',
          inputLabel: `${name} → ${formatSimValue(mapped)}`,
          expression: node.label,
          evaluation: `${formatTypeRef(node.inputType)} → ${formatTypeRef(
            node.downstream?.inputType ?? node.inputType,
          )}`,
          outcome: 'mapper適用後の値をdownstreamへ渡します',
        },
        currentText: `Collectors.mappingのmapperを適用し、${formatSimValue(mapped)}をdownstreamへ渡します。`,
      })
      if (!node.downstream) throw new Error('mappingにdownstreamがありません')
      accumulateNode(node.downstream, mapped, ctx, null)
      return
    }
    case 'filtering': {
      enter(ctx, node, 'filtering')
      const passed = evaluateValuePredicate(dsl.predicate, value)
      ctx.emit({
        kind: 'PREDICATE_EVALUATED',
        currentElementId: ctx.elementId,
        processing: {
          title: 'Collector filtering判定',
          inputLabel: name,
          expression: predicateToJavaExpr(dsl.predicate),
          evaluation: `${passed}`,
          outcome: passed ? 'downstreamへ渡します' : 'downstreamへ渡しません（bucketは残ります）',
        },
        currentText: passed
          ? `${name}はCollectors.filteringの条件を満たすため、downstreamへ渡されます。`
          : `${name}はCollectors.filteringの条件を満たさないため、downstreamへ渡されません。bucket自体はキーとして残ります（Stream.filterとの差）。`,
        jdkNote:
          'Collectors.filteringはbucket決定後にPredicateを評価するため、全要素が除外されたキーも空のdownstream結果として残ります。Stream.filterで先に除外するとキー自体が生成されません。',
      })
      if (!passed) return
      if (!node.downstream) throw new Error('filteringにdownstreamがありません')
      accumulateNode(node.downstream, value, ctx, null)
      return
    }
    case 'flatMapping': {
      enter(ctx, node, 'flatMapping')
      const container = evaluateMapper(dsl.mapper, value)
      if (container.kind !== 'stringList') {
        throw new Error(`flatMappingで未対応のコンテナです: ${container.kind}`)
      }
      const children = container.value
      ctx.emit({
        kind: 'MAPPED_STREAM_CREATED',
        currentElementId: ctx.elementId,
        processing: {
          title: 'Collector flatMapping展開',
          inputLabel: `${name} → [${children.join(', ')}]`,
          expression: node.label,
          evaluation: `子要素${children.length}件`,
          outcome: '展開した子要素を順にdownstreamへ渡します',
        },
        currentText: `Collectors.flatMappingが${name}を${children.length}件へ展開しました。`,
      })
      if (!node.downstream) throw new Error('flatMappingにdownstreamがありません')
      for (const child of children) {
        const childValue: SimValue = { kind: 'string', value: child }
        ctx.emit({
          kind: 'CHILD_EMITTED',
          currentElementId: ctx.elementId,
          processing: {
            title: 'flatMapping子要素',
            inputLabel: `"${child}"`,
            expression: node.label,
            evaluation: null,
            outcome: 'flattenしてdownstreamへ渡します',
          },
          currentText: `展開された"${child}"をdownstreamへ渡します。`,
        })
        accumulateNode(node.downstream, childValue, ctx, null)
      }
      return
    }
    case 'collectingAndThen': {
      enter(ctx, node, 'collectingAndThen')
      if (!node.downstream) throw new Error('collectingAndThenにdownstreamがありません')
      accumulateNode(node.downstream, value, ctx, null)
      return
    }
    case 'groupingBy': {
      enter(ctx, node, 'groupingBy')
      const key = classifierKey(dsl.classifier, value)
      ctx.emit({
        kind: 'CLASSIFIER_EVALUATED',
        currentElementId: ctx.elementId,
        processing: {
          title: 'classifier評価',
          inputLabel: `${name} → ${key.label}`,
          expression: classifierToJavaExpr(dsl.classifier),
          evaluation: `キー = ${key.label}`,
          outcome: 'このキーのbucketへ振り分けます',
        },
        currentText: `classifierを評価しました。${name}のキーは${key.label}です。`,
      })
      const existing = node.bucketIndex.get(key.ref)
      const bucket = existing ?? addBucket(node, key.ref, key.label, node.inputType)
      node.bucketCreatedByLast = existing === undefined
      enterBucket(ctx, bucket.node.nodeKey, `bucket ${key.label}`)
      ctx.emit({
        kind: 'BUCKET_SELECTED',
        currentElementId: ctx.elementId,
        processing: {
          title: existing ? 'bucket決定（既存）' : 'bucket決定（新規生成）',
          inputLabel: `キー ${key.label}`,
          expression: node.label,
          evaluation: existing ? '既存bucketを使用します' : '新しいbucketを生成しました',
          outcome: `Mapのbucket数は${node.buckets.length}です`,
        },
        currentText: existing
          ? `キー${key.label}の既存bucketが選ばれました（bucket数 ${node.buckets.length}）。`
          : `キー${key.label}のbucketを新規生成しました。Mapが成長し、bucket数は${node.buckets.length}です。`,
        jdkNote: dsl.mapFactoryId
          ? `${COLLECTOR_MAP_FACTORY_META[dsl.mapFactoryId].containerName}はキーの順序性を持つMapです。`
          : 'groupingByが返すMapの型・可変性・iteration orderはJDKの保証対象ではありません。',
      })
      accumulateNode(bucket.node, value, ctx, null)
      return
    }
    case 'partitioningBy': {
      enter(ctx, node, 'partitioningBy')
      const passed = evaluateValuePredicate(dsl.predicate, value)
      ctx.emit({
        kind: 'PREDICATE_EVALUATED',
        currentElementId: ctx.elementId,
        processing: {
          title: 'partitioningBy判定',
          inputLabel: name,
          expression: predicateToJavaExpr(dsl.predicate),
          evaluation: `${passed}`,
          outcome: `${passed}のpartitionへ振り分けます`,
        },
        currentText: `partitioningByのPredicateを評価しました。${name}は${passed}のpartitionです。`,
      })
      const keyRef = passed ? 'true' : 'false'
      const bucket = node.bucketIndex.get(keyRef)
      if (!bucket) throw new Error('partitioningByのbucketがありません')
      node.bucketCreatedByLast = false
      enterBucket(ctx, bucket.node.nodeKey, `partition ${keyRef}`)
      ctx.emit({
        kind: 'BUCKET_SELECTED',
        currentElementId: ctx.elementId,
        processing: {
          title: 'partition決定（固定2分岐）',
          inputLabel: `キー ${keyRef}`,
          expression: node.label,
          evaluation: 'true / falseの2キーは最初から固定で存在します',
          outcome: `${keyRef}のdownstreamへ渡します`,
        },
        currentText: `${keyRef}のpartitionが選ばれました。partitioningByはtrue / falseの2キーを常に保持します。`,
        jdkNote:
          'partitioningByの結果Mapはtrue / false両キーを必ず含みます（該当要素が0件でも空のdownstream結果を保持）。キーはwrapper Booleanです。',
      })
      accumulateNode(bucket.node, value, ctx, null)
      return
    }
    case 'teeing': {
      enter(ctx, node, 'teeing')
      const tee = node.tee
      if (!tee || !node.left || !node.right) throw new Error('teeingの構造が不正です')
      tee.currentElementId = ctx.elementId
      const branches: readonly ['LEFT' | 'RIGHT', CollectorRuntimeNode][] = [
        ['LEFT', node.left],
        ['RIGHT', node.right],
      ]
      for (const [branch, child] of branches) {
        tee.activeBranch = branch
        const setState = (state: BranchState): void => {
          if (branch === 'LEFT') tee.leftState = state
          else tee.rightState = state
        }
        setState('ACCUMULATING')
        const branchLabelIndex = ctx.pathLabels.length
        pathLabelOnly(ctx, branch === 'LEFT' ? '左branch' : '右branch')
        if (isLeafAccumulator(child.dsl)) {
          // branch rootの蓄積更新はTEE_BRANCH_ACCUMULATEDのみ（CONTAINER_UPDATEDと二重発行しない）。
          // 確定snapshotなので、その1件が「このbranchの蓄積確定」を表す
          setState('ACCUMULATED')
          accumulateNode(child, value, ctx, 'TEE_BRANCH_ACCUMULATED', branch)
        } else {
          // branch内部の蓄積更新は汎用Collector snapshot（この間はACCUMULATING）。
          // branch単位の確定を1件だけ発行する
          accumulateNode(child, value, ctx, null)
          setState('ACCUMULATED')
          ctx.emit({
            kind: 'TEE_BRANCH_ACCUMULATED',
            currentElementId: ctx.elementId,
            processing: {
              title: `teeing branch蓄積更新（${branch}）`,
              inputLabel: name,
              expression: child.label,
              evaluation: accumulationSummary(child),
              outcome: `${branch} branchの蓄積が確定しました`,
            },
            currentText: `${name}に対する${branch === 'LEFT' ? '左' : '右'}branchの蓄積が確定しました。`,
          })
        }
        ctx.pathLabels.length = branchLabelIndex
      }
      tee.activeBranch = 'NONE'
      return
    }
  }
}

function classifierKey(classifier: ClassifierDsl, value: SimValue): { ref: string; label: string } {
  const employee = employeeOf(value)
  switch (classifier.kind) {
    case 'employeeField': {
      const raw = classifier.field === 'region' ? employee.region : employee.name
      return { ref: `str:${raw}`, label: raw }
    }
    case 'employeeDepartment': {
      const dept: SimValue = { kind: 'department', value: employee.department }
      return { ref: distinctKeyOf(dept), label: formatSimValue(dept) }
    }
    case 'departmentField': {
      const raw =
        classifier.field === 'name' ? employee.department.name : employee.department.division
      return { ref: `str:${raw}`, label: raw }
    }
  }
}

function statisticsLabels(
  node: CollectorRuntimeNode,
  primitive: 'Int' | 'Long' | 'Double',
): {
  countLabel: string
  sumLabel: string
  minLabel: string
  maxLabel: string
  averageLabel: string
} {
  const count = node.count
  if (primitive === 'Double') {
    const sum = finalDoubleSum(node)
    return {
      countLabel: String(count),
      sumLabel: formatDoubleLiteral(count === 0 ? 0 : sum),
      minLabel: count === 0 ? 'Infinity' : formatDoubleLiteral(node.min ?? 0),
      maxLabel: count === 0 ? '-Infinity' : formatDoubleLiteral(node.max ?? 0),
      averageLabel: formatDoubleLiteral(count === 0 ? 0 : sum / count),
    }
  }
  const emptyMin = primitive === 'Int' ? String(INT_MAX) : LONG_MAX_STRING
  const emptyMax = primitive === 'Int' ? String(INT_MIN) : LONG_MIN_STRING
  return {
    countLabel: String(count),
    sumLabel: String(node.sum),
    minLabel: count === 0 ? emptyMin : String(node.min ?? 0),
    maxLabel: count === 0 ? emptyMax : String(node.max ?? 0),
    averageLabel: formatDoubleLiteral(count === 0 ? 0 : node.sum / count),
  }
}

/** ノードの蓄積状態の1行要約（teeing branch表示等） */
function accumulationSummary(node: CollectorRuntimeNode): string {
  const view = accumulationView(node)
  switch (view.kind) {
    case 'NONE':
      return '—'
    case 'ELEMENTS':
      return `${view.containerLabel}（${view.items.length}件）`
    case 'TEXT':
      return `"${view.valueLabel}"`
    case 'NUMBER':
      return view.valueLabel
    case 'AVERAGE':
      return `合計 ${view.sumLabel} / 件数 ${view.countLabel}`
    case 'STATISTICS':
      return `count=${view.countLabel}, sum=${view.sumLabel}`
    case 'CANDIDATE':
      return view.candidateLabel ?? '候補なし'
    case 'MAP':
      return `${view.containerLabel}（${view.size}件）`
  }
}

/**
 * 要素1件をCollectorへ流し込む（Step Engineから呼ぶ）。
 * NODE_ARRIVALはStep Engine側で発行し、ここでは経路・蓄積のsnapshotを発行する。
 */
export function collectorAccumulate(
  rt: CollectorRuntime,
  elementId: ElementId,
  value: SimValue,
  emit: CollectorEmit,
): void {
  const ctx: WalkCtx = { emit, rt, elementId, path: [], pathLabels: [shortLabel(value)] }
  accumulateNode(rt.root, value, ctx, null)
}

// ---- finisher / merger（finish cascade段階。指示§9.1発行表・§9.3） ----

/** このvariantが`COLLECTOR_FINISHED`を発行するか（指示§9.1の発行表） */
function emitsFinisher(dsl: CollectorDsl): boolean {
  switch (dsl.kind) {
    case 'joining':
    case 'averagingInt':
    case 'averagingLong':
    case 'averagingDouble':
    case 'minBy':
    case 'maxBy':
    case 'reducing':
    case 'collectingAndThen':
      return true
    default:
      return false
  }
}

/** finisher適用前の蓄積表現ラベル（finisher snapshotの「前」表示） */
function beforeFinisherLabel(node: CollectorRuntimeNode): string {
  const dsl = node.dsl
  switch (dsl.kind) {
    case 'joining':
      return `"${node.text}"`
    case 'averagingInt':
    case 'averagingLong':
      return `合計 ${node.sum} / 件数 ${node.count}`
    case 'averagingDouble':
      return `合計 ${formatDoubleLiteral(finalDoubleSum(node))} / 件数 ${node.count}`
    case 'minBy':
    case 'maxBy':
      return node.candidate ? shortLabel(node.candidate.value) : '候補なし'
    case 'reducing':
      return node.acc ? formatSimValue(node.acc) : 'accumulatorなし'
    case 'collectingAndThen':
      return node.downstream ? resultLabelOf(node.downstream) : '—'
    default:
      return accumulationSummary(node)
  }
}

/** finisher適用前の型ラベル */
function beforeFinisherTypeLabel(node: CollectorRuntimeNode): string {
  const dsl = node.dsl
  switch (dsl.kind) {
    case 'joining':
      return 'String（連結途中）'
    case 'averagingInt':
    case 'averagingLong':
    case 'averagingDouble':
      return '合計と件数の蓄積'
    case 'minBy':
    case 'maxBy':
      return `${formatTypeRef(node.inputType)}（候補）`
    case 'reducing':
      return `${formatTypeRef(node.inputType)}（accumulator）`
    case 'collectingAndThen':
      return node.downstream ? formatTypeRef(node.downstream.resultType) : '—'
    default:
      return formatTypeRef(node.resultType)
  }
}

/** finisher表示ラベル */
function finisherLabel(node: CollectorRuntimeNode): string {
  const dsl = node.dsl
  switch (dsl.kind) {
    case 'joining': {
      const arity = joiningArity(dsl)
      return arity === 'full' ? 'prefix + 連結結果 + suffix' : '連結結果の確定'
    }
    case 'averagingInt':
    case 'averagingLong':
    case 'averagingDouble':
      return '合計 / 件数 → 平均（Double）'
    case 'minBy':
    case 'maxBy':
      return '候補 → Optional'
    case 'reducing':
      return 'accumulator → Optional'
    case 'collectingAndThen':
      return dsl.finisherId
    default:
      return ''
  }
}

/** bucketの確定処理順（§9.1規則7）。教材上の決定的順序であり、JDKのiteration order保証ではない。 */
function orderedBuckets(node: CollectorRuntimeNode): readonly BucketRuntime[] {
  const dsl = node.dsl
  if (dsl.kind === 'partitioningBy') {
    // false → trueの固定順
    return [...node.buckets].sort((a, b) => (a.keyRef === b.keyRef ? 0 : a.keyRef === 'false' ? -1 : 1))
  }
  if (dsl.kind === 'groupingBy' && dsl.mapFactoryId !== null) {
    // TreeMapは実際のキー順（順序意味論を優先）
    return [...node.buckets].sort((a, b) => (a.keyLabel < b.keyLabel ? -1 : a.keyLabel > b.keyLabel ? 1 : 0))
  }
  // 順序保証のないMapはbucket生成順（Step Engine上の教材規約）
  return node.buckets
}

/** bucket確定順の教材規約注記 */
function bucketOrderNote(node: CollectorRuntimeNode): string {
  const dsl = node.dsl
  if (dsl.kind === 'partitioningBy') {
    return 'partitionの確定順はfalse → trueの固定順です（教材上の規約。JDKのMap iteration order保証ではありません）。'
  }
  if (dsl.kind === 'groupingBy' && dsl.mapFactoryId !== null) {
    return `${COLLECTOR_MAP_FACTORY_META[dsl.mapFactoryId].containerName}の実際のキー順で確定します（順序意味論を優先）。`
  }
  return 'bucketの確定順はbucket生成順です（教材上の規約。JDKのMap iteration order保証ではありません）。'
}

function finishNode(node: CollectorRuntimeNode, ctx: FinishCtx, suppressOwn: boolean): void {
  const dsl = node.dsl
  switch (dsl.kind) {
    case 'mapping':
    case 'filtering':
    case 'flatMapping':
      if (node.downstream) finishNode(node.downstream, ctx, false)
      node.finished = true
      return
    case 'collectingAndThen': {
      if (node.downstream) finishNode(node.downstream, ctx, false)
      break
    }
    case 'groupingBy':
    case 'partitioningBy': {
      for (const bucket of orderedBuckets(node)) {
        finishNode(bucket.node, ctx, false)
      }
      node.finished = true
      return
    }
    case 'teeing': {
      finishTeeing(node, ctx)
      return
    }
    default:
      break
  }
  node.finisherBefore = beforeFinisherLabel(node)
  node.finished = true
  node.finisherAfter = resultLabelOf(node)
  if (!emitsFinisher(dsl) || suppressOwn) return
  const parentNote =
    ctx.bucketNote !== null ? ` ${ctx.bucketNote}` : ''
  ctx.emit({
    kind: 'COLLECTOR_FINISHED',
    currentElementId: null,
    processing: {
      title: `Collector finisher適用${ctx.bucketLabel === null ? '' : `（bucket ${ctx.bucketLabel}）`}`,
      inputLabel: `${node.finisherBefore}（${beforeFinisherTypeLabel(node)}）`,
      expression: finisherLabel(node),
      evaluation: `${node.finisherBefore} → ${node.finisherAfter}`,
      outcome: `${formatTypeRef(node.resultType)} = ${node.finisherAfter}`,
    },
    currentText: `finisherを適用しました。${node.finisherBefore}から${node.finisherAfter}（${formatTypeRef(node.resultType)}）へ確定します。${parentNote}`,
    jdkNote:
      'この教材モデルでは、蓄積表現と最終結果の間に表示上の変換があるときだけfinisher snapshotを発行します。JDKが当該Collectorでfinisherを実行するかどうかの主張ではありません。',
  })
}

function finishTeeing(node: CollectorRuntimeNode, ctx: FinishCtx): void {
  const tee = node.tee
  if (!tee || !node.left || !node.right) throw new Error('teeingの構造が不正です')
  // finish段階は要素処理snapshotと分離する（merger snapshotはcurrentElementId null・PROCESSING 0件）
  tee.currentElementId = null
  const branches: readonly ['LEFT' | 'RIGHT', CollectorRuntimeNode][] = [
    ['LEFT', node.left],
    ['RIGHT', node.right],
  ]
  for (const [branch, child] of branches) {
    tee.activeBranch = branch
    // branch root自身のCOLLECTOR_FINISHEDは発行せず、TEE_BRANCH_FINISHEDのみとする（§9.1規則4）
    finishNode(child, ctx, true)
    if (branch === 'LEFT') tee.leftState = 'FINISHED'
    else tee.rightState = 'FINISHED'
    ctx.emit({
      kind: 'TEE_BRANCH_FINISHED',
      currentElementId: null,
      processing: {
        title: `teeing branch finisher適用（${branch}）`,
        inputLabel: accumulationSummary(child),
        expression: child.label,
        evaluation: `${branch === 'LEFT' ? 'R1' : 'R2'} = ${resultLabelOf(child)}`,
        outcome: `${formatTypeRef(child.resultType)} = ${resultLabelOf(child)}`,
      },
      currentText: `${branch === 'LEFT' ? '左' : '右'}downstreamのfinisherが適用され、${branch === 'LEFT' ? 'R1' : 'R2'}は${resultLabelOf(child)}（${formatTypeRef(child.resultType)}）に確定しました。`,
      jdkNote:
        branch === 'LEFT'
          ? '教材上の表示順は左→右です。JDKはdownstream Collector間の観測可能な呼出し順を保証しません。'
          : null,
    })
  }
  tee.activeBranch = 'NONE'
  // mergerは両downstreamのfinisher完了後に、teeingノードごとに正確に1回だけ適用する
  const record = TEEING_MERGER_RECORDS[(node.dsl as Extract<CollectorDsl, { kind: 'teeing' }>).mergerId]
  const leftLabel = resultLabelOf(node.left)
  const rightLabel = resultLabelOf(node.right)
  tee.finalFields = record.fields.map((field, i) => ({
    name: field.name,
    typeLabel: field.javaType,
    valueLabel: i === 0 ? leftLabel : rightLabel,
  }))
  tee.mergerApplied = true
  node.finished = true
  ctx.emit({
    kind: 'TEE_MERGER_APPLIED',
    currentElementId: null,
    processing: {
      title: 'teeing merger適用',
      inputLabel: `R1 = ${leftLabel}（${formatTypeRef(node.left.resultType)}） / R2 = ${rightLabel}（${formatTypeRef(node.right.resultType)}）`,
      expression: (node.dsl as Extract<CollectorDsl, { kind: 'teeing' }>).mergerId,
      evaluation: `R1・R2 → ${resultLabelOf(node)}`,
      outcome: `${formatTypeRef(node.resultType)} = ${resultLabelOf(node)}`,
    },
    currentText: `mergerを適用しました。左結果R1（${leftLabel}）と右結果R2（${rightLabel}）から最終結果R（${resultLabelOf(node)}）を生成します。`,
    jdkNote:
      'mergerは左右のcombinerではなく、両downstreamのfinisher完了後の「完成結果」を最終型へ統合する処理です。空Streamでも省略されません。',
  })
}

interface FinishCtx {
  readonly emit: CollectorEmit
  bucketLabel: string | null
  bucketNote: string | null
}

/**
 * 全要素処理後の構造snapshotフェーズ（finish cascade）。
 * bucketごとのfinisher・collectingAndThen finisher・teeingのfinisher / mergerを
 * 決定的順序で発行する。
 */
export function collectorFinish(rt: CollectorRuntime, emit: CollectorEmit): void {
  rt.currentPath = []
  rt.currentPathLabel = null
  const ctx: FinishCtx = { emit, bucketLabel: null, bucketNote: null }
  finishWithBucketContext(rt.root, ctx)
}

/** bucketごとの確定処理でbucketラベル・順序注記をfinisher snapshotへ伝える */
function finishWithBucketContext(node: CollectorRuntimeNode, ctx: FinishCtx): void {
  const dsl = node.dsl
  if (dsl.kind === 'groupingBy' || dsl.kind === 'partitioningBy') {
    const note = bucketOrderNote(node)
    for (const bucket of orderedBuckets(node)) {
      ctx.bucketLabel = bucket.keyLabel
      ctx.bucketNote = note
      finishWithBucketContext(bucket.node, ctx)
    }
    ctx.bucketLabel = null
    ctx.bucketNote = null
    node.finished = true
    return
  }
  finishNode(node, ctx, false)
}

// ---- view構築 ----

function accumulationView(node: CollectorRuntimeNode): CollectorAccumulationView {
  const dsl = node.dsl
  switch (dsl.kind) {
    case 'toList':
    case 'toSet':
    case 'toCollection':
      return {
        kind: 'ELEMENTS',
        containerLabel: node.containerLabel,
        items: node.elements.map((e) => ({ id: e.id, label: e.label })),
        changedByLast: node.changedByLast,
      }
    case 'joining':
      return { kind: 'TEXT', valueLabel: node.text }
    case 'counting':
      return { kind: 'NUMBER', valueLabel: String(node.count) }
    case 'summingInt':
    case 'summingLong':
    case 'summingDouble': {
      const primitive = numericKindPrimitive(dsl.kind)
      const sum = primitive === 'Double' ? finalDoubleSum(node) : node.sum
      return { kind: 'NUMBER', valueLabel: numericLabel(primitive, sum) }
    }
    case 'averagingInt':
    case 'averagingLong':
    case 'averagingDouble': {
      const primitive = numericKindPrimitive(dsl.kind)
      const sum = primitive === 'Double' ? finalDoubleSum(node) : node.sum
      return {
        kind: 'AVERAGE',
        sumLabel: primitive === 'Double' ? formatDoubleLiteral(sum) : String(sum),
        countLabel: String(node.count),
        averageLabel: node.finished ? resultLabelOf(node) : null,
      }
    }
    case 'summarizingInt':
    case 'summarizingLong':
    case 'summarizingDouble':
      return { kind: 'STATISTICS', ...statisticsLabels(node, numericKindPrimitive(dsl.kind)) }
    case 'minBy':
    case 'maxBy':
      return {
        kind: 'CANDIDATE',
        candidateLabel: node.candidate ? shortLabel(node.candidate.value) : null,
        candidateElementId: node.candidate?.id ?? null,
        updateCount: node.updateCount,
      }
    case 'reducing':
      return {
        kind: 'CANDIDATE',
        candidateLabel: node.acc ? formatSimValue(node.acc) : null,
        candidateElementId: null,
        updateCount: node.updateCount,
      }
    case 'groupingBy':
    case 'partitioningBy':
      return { kind: 'MAP', containerLabel: mapContainerLabel(node), size: node.buckets.length }
    default:
      return { kind: 'NONE' }
  }
}

function mapContainerLabel(node: CollectorRuntimeNode): string {
  const dsl = node.dsl
  if (dsl.kind === 'groupingBy' && dsl.mapFactoryId !== null) {
    return COLLECTOR_MAP_FACTORY_META[dsl.mapFactoryId].containerName
  }
  return 'Map'
}

function mapIsJdkOrdered(node: CollectorRuntimeNode): boolean {
  const dsl = node.dsl
  return dsl.kind === 'groupingBy' && dsl.mapFactoryId !== null
    ? COLLECTOR_MAP_FACTORY_META[dsl.mapFactoryId].jdkOrdered
    : false
}

/** ノードの現在（または確定）結果の表示ラベル */
function resultLabelOf(node: CollectorRuntimeNode): string {
  const dsl = node.dsl
  switch (dsl.kind) {
    case 'toList':
    case 'toCollection':
      return `[${node.elements.map((e) => shortLabelOfEntry(e)).join(', ')}]`
    case 'toSet':
      return `[${node.elements.map((e) => shortLabelOfEntry(e)).join(', ')}]`
    case 'joining': {
      const prefix = dsl.prefix?.value ?? ''
      const suffix = dsl.suffix?.value ?? ''
      return `"${prefix}${node.text}${suffix}"`
    }
    case 'counting':
      return String(node.count)
    case 'summingInt':
      return String(node.sum)
    case 'summingLong':
      return String(node.sum)
    case 'summingDouble':
      return formatDoubleLiteral(finalDoubleSum(node))
    case 'averagingInt':
    case 'averagingLong':
      return formatDoubleLiteral(node.count === 0 ? 0 : node.sum / node.count)
    case 'averagingDouble':
      return formatDoubleLiteral(node.count === 0 ? 0 : finalDoubleSum(node) / node.count)
    case 'summarizingInt':
    case 'summarizingLong':
    case 'summarizingDouble': {
      const s = statisticsLabels(node, numericKindPrimitive(dsl.kind))
      return `${formatTypeRef(node.resultType)}{count=${s.countLabel}, sum=${s.sumLabel}, min=${s.minLabel}, average=${s.averageLabel}, max=${s.maxLabel}}`
    }
    case 'minBy':
    case 'maxBy':
      return node.candidate ? `Optional[${shortLabel(node.candidate.value)}]` : 'Optional.empty'
    case 'reducing':
      return node.acc ? `Optional[${formatSimValue(node.acc)}]` : 'Optional.empty'
    case 'mapping':
    case 'filtering':
    case 'flatMapping':
      return node.downstream ? resultLabelOf(node.downstream) : '—'
    case 'collectingAndThen':
      return node.downstream ? resultLabelOf(node.downstream) : '—'
    case 'groupingBy':
    case 'partitioningBy': {
      const entries = orderedBuckets(node).map(
        (bucket) => `${bucket.keyLabel}=${resultLabelOf(bucket.node)}`,
      )
      return `{${entries.join(', ')}}`
    }
    case 'teeing': {
      const record = TEEING_MERGER_RECORDS[dsl.mergerId]
      const fields = node.tee?.finalFields
      if (!fields) return `${record.recordName}（merger未適用）`
      return `${record.recordName}[${fields.map((f) => `${f.name}=${f.valueLabel}`).join(', ')}]`
    }
  }
}

function shortLabelOfEntry(entry: ElementEntry): string {
  // Employeeのラベルは「佐藤（age=35）」形式。Map / Listの列挙では名前だけを表示する
  const paren = entry.label.indexOf('（')
  return paren > 0 ? entry.label.slice(0, paren) : entry.label
}

function finisherView(node: CollectorRuntimeNode): CollectorFinisherView | null {
  if (!emitsFinisher(node.dsl)) return null
  return {
    label: finisherLabel(node),
    state: node.finished ? 'APPLIED' : 'PENDING',
    beforeLabel: node.finisherBefore,
    beforeTypeLabel: node.finished ? beforeFinisherTypeLabel(node) : null,
    afterLabel: node.finisherAfter,
    afterTypeLabel: node.finished ? formatTypeRef(node.resultType) : null,
  }
}

function teeingView(node: CollectorRuntimeNode): CollectorTeeingView | null {
  const tee = node.tee
  if (!tee || !node.left || !node.right) return null
  const dsl = node.dsl as Extract<CollectorDsl, { kind: 'teeing' }>
  return {
    teeingNodeKey: node.nodeKey,
    leftNodeKey: node.left.nodeKey,
    rightNodeKey: node.right.nodeKey,
    currentElementId: tee.currentElementId,
    activeBranch: tee.activeBranch,
    leftState: tee.leftState,
    rightState: tee.rightState,
    leftAccumulationLabel: accumulationSummary(node.left),
    rightAccumulationLabel: accumulationSummary(node.right),
    leftResultLabel: tee.leftState === 'FINISHED' ? resultLabelOf(node.left) : null,
    rightResultLabel: tee.rightState === 'FINISHED' ? resultLabelOf(node.right) : null,
    leftResultTypeLabel: formatTypeRef(node.left.resultType),
    rightResultTypeLabel: formatTypeRef(node.right.resultType),
    mergerLabel: dsl.mergerId,
    mergerApplied: tee.mergerApplied,
    finalResultLabel: tee.mergerApplied ? resultLabelOf(node) : null,
    resultTypeLabel: formatTypeRef(node.resultType),
    branchDisplayOrderNote: '教材上のbranch表示順は左→右です。',
    jdkOrderNote:
      '左→右はsnapshot列を決定的にするための教材上の表示順であり、JDKがdownstream Collector間の観測可能な呼出し順を保証するものではありません。',
  }
}

function nodeView(node: CollectorRuntimeNode, activeKeys: ReadonlySet<string>): CollectorNodeView {
  return {
    nodeKey: node.nodeKey,
    collectorKind: node.dsl.kind,
    label: node.label,
    inputTypeLabel: formatTypeRef(node.inputType),
    resultTypeLabel: formatTypeRef(node.resultType),
    active: activeKeys.has(node.nodeKey),
    accumulation: accumulationView(node),
    finisher: finisherView(node),
    downstream: node.downstream ? nodeView(node.downstream, activeKeys) : null,
    left: node.left ? nodeView(node.left, activeKeys) : null,
    right: node.right ? nodeView(node.right, activeKeys) : null,
    buckets: node.buckets.map(
      (bucket): CollectorBucketView => ({
        keyLabel: bucket.keyLabel,
        keyRef: bucket.keyRef,
        createdSeq: bucket.createdSeq,
        createdByLast: node.bucketCreatedByLast && bucket.createdSeq === node.buckets.length,
        active: activeKeys.has(bucket.node.nodeKey),
        node: nodeView(bucket.node, activeKeys),
      }),
    ),
    teeing: teeingView(node),
  }
}

/** Collector固有contextのview（§9.1） */
export function collectorContextView(rt: CollectorRuntime): OperationContextView {
  const activeKeys = new Set(rt.currentPath)
  return {
    kind: 'collector',
    nodeId: rt.nodeId,
    op: rt.op,
    root: nodeView(rt.root, activeKeys),
    currentPath: [...rt.currentPath],
    currentPathLabel: rt.currentPathLabel,
    triple: rt.triple
      ? {
          supplierId: rt.triple.supplierId,
          accumulatorId: rt.triple.accumulatorId,
          combinerId: rt.triple.combinerId,
          combinerCallCount: 0,
          combinerNote:
            'combinerはparallel reductionで必要となります。sequential実行では呼ばれません（呼出し0回）。',
        }
      : null,
  }
}

const SET_ELEMENT_ID_NOTE =
  '等価値が複数の入力要素から集約される場合、最初に受理した入力要素のIDを保持します（表示・履歴復元用の教材規約であり、JDKのSet内部動作やiteration order保証ではありません）。'

const DISPLAY_ORDER_NOTE =
  '表示を安定させるための順序です（JDKのiteration order保証とは別物です）。'

/** ノードの結果をTerminalResultViewへ変換する（Map entryの値は入れ子のresult view） */
function nodeResultView(node: CollectorRuntimeNode, isRoot: boolean): TerminalResultView {
  const dsl = node.dsl
  switch (dsl.kind) {
    case 'toList':
    case 'toCollection': {
      const items: SnapshotOutputItem[] = node.elements.map((e) => ({ id: e.id, label: e.label }))
      // rootのtoList / 3引数collectは既存LIST variantを再利用する（itemsはSnapshotOutput.items）
      if (isRoot && dsl.kind === 'toList') return { kind: 'LIST' }
      return {
        kind: 'COLLECTION',
        containerLabel: node.containerLabel,
        elementTypeLabel: formatTypeRef(node.inputType),
        size: items.length,
        items,
        displayOrderNote: null,
        elementIdNote: null,
      }
    }
    case 'toSet':
      return {
        kind: 'COLLECTION',
        containerLabel: 'Set',
        elementTypeLabel: formatTypeRef(node.inputType),
        size: node.elements.length,
        items: node.elements.map((e) => ({ id: e.id, label: e.label })),
        displayOrderNote: DISPLAY_ORDER_NOTE,
        elementIdNote: SET_ELEMENT_ID_NOTE,
      }
    case 'joining':
      return {
        kind: 'SCALAR',
        typeLabel: 'String',
        valueLabel: resultLabelOf(node),
      }
    case 'counting':
    case 'summingInt':
    case 'summingLong':
    case 'summingDouble':
    case 'averagingInt':
    case 'averagingLong':
    case 'averagingDouble':
      return {
        kind: 'SCALAR',
        typeLabel: formatTypeRef(node.resultType),
        valueLabel: resultLabelOf(node),
      }
    case 'summarizingInt':
    case 'summarizingLong':
    case 'summarizingDouble': {
      const s = statisticsLabels(node, numericKindPrimitive(dsl.kind))
      return {
        kind: 'STATISTICS',
        statisticsTypeLabel: formatTypeRef(node.resultType),
        countLabel: s.countLabel,
        sumLabel: s.sumLabel,
        minLabel: s.minLabel,
        maxLabel: s.maxLabel,
        averageLabel: s.averageLabel,
        emptyNote:
          node.count === 0
            ? '空Streamのmin / maxは型の正規初期値（MAX_VALUE / MIN_VALUE、doubleは正負Infinity）です。'
            : null,
      }
    }
    case 'minBy':
    case 'maxBy':
      return {
        kind: 'OPTIONAL',
        optionalTypeLabel: 'Optional',
        elementTypeLabel: formatTypeRef(node.inputType),
        present: node.candidate !== null,
        valueLabel: node.candidate ? formatSimValue(node.candidate.value) : null,
        valueElementId: node.candidate?.id ?? null,
      }
    case 'reducing':
      return {
        kind: 'OPTIONAL',
        optionalTypeLabel: 'Optional',
        elementTypeLabel: formatTypeRef(node.inputType),
        present: node.acc !== null,
        valueLabel: node.acc ? formatSimValue(node.acc) : null,
        valueElementId: null,
      }
    case 'mapping':
    case 'filtering':
    case 'flatMapping':
    case 'collectingAndThen':
      if (!node.downstream) throw new Error('downstreamがありません')
      return nodeResultView(node.downstream, false)
    case 'groupingBy':
    case 'partitioningBy': {
      const jdkOrdered = mapIsJdkOrdered(node)
      const entries: CollectorMapEntryView[] = orderedBuckets(node).map((bucket) => ({
        keyLabel: bucket.keyLabel,
        keyRef: bucket.keyRef,
        value: nodeResultView(bucket.node, false),
      }))
      const resultType = node.resultType
      return {
        kind: 'MAP',
        containerLabel: mapContainerLabel(node),
        keyTypeLabel: resultType.kind === 'map' ? formatTypeRef(resultType.keyType) : '',
        valueTypeLabel: resultType.kind === 'map' ? formatTypeRef(resultType.valueType) : '',
        size: entries.length,
        entries,
        jdkOrdered,
        displayOrderNote: jdkOrdered ? null : DISPLAY_ORDER_NOTE,
      }
    }
    case 'teeing': {
      const record = TEEING_MERGER_RECORDS[dsl.mergerId]
      const fields = node.tee?.finalFields ?? []
      return {
        kind: 'RECORD',
        recordName: record.recordName,
        fields: fields.map((f) => ({ name: f.name, typeLabel: f.typeLabel, valueLabel: f.valueLabel })),
      }
    }
  }
}

/** 終端結果view（§9.5） */
export function collectorResultView(rt: CollectorRuntime): TerminalResultView {
  if (rt.op === 'collectTriple') return { kind: 'LIST' }
  return nodeResultView(rt.root, true)
}

/** rootがLIST variant（SnapshotOutput.itemsを使う）かどうか */
export function collectorUsesOutputItems(rt: CollectorRuntime): boolean {
  return rt.op === 'collectTriple' || rt.root.dsl.kind === 'toList'
}

/**
 * `CONTAINER_CREATED`（supplier適用）を実行開始時に発行するか。
 * 3引数collectでは必須（§9.1規則6）。toCollectionもコンテナsupplier IDの可視化が
 * 教材ポイントであるため発行する（実装判断。docs/phase-5-decisions.md §13）。
 */
export function collectorNeedsContainerCreated(rt: CollectorRuntime): boolean {
  return rt.op === 'collectTriple' || rt.root.dsl.kind === 'toCollection'
}

/** Collector経路の深さ（rootのみを通っているか。root levelのコンテナ更新判定用） */
export function collectorAtRootPath(rt: CollectorRuntime): boolean {
  return rt.currentPath.length === 1
}

/** 最終結果の表示ラベル（RESULT_CONFIRMED用） */
export function collectorFinalLabel(rt: CollectorRuntime): string {
  return resultLabelOf(rt.root)
}

/** 3引数collectのsupplier適用（CONTAINER_CREATED）。root levelのコンテナ生成で使用する。 */
export function collectorCreateContainer(rt: CollectorRuntime, emit: CollectorEmit): void {
  const node = rt.root
  if (node.containerCreated) return
  node.containerCreated = true
  const supplierExpr =
    rt.op === 'collectTriple'
      ? (rt.triple?.supplierId ?? '')
      : node.dsl.kind === 'toCollection'
        ? node.dsl.supplierId
        : ''
  emit({
    kind: 'CONTAINER_CREATED',
    currentElementId: null,
    processing: {
      title: 'コンテナ生成（supplier適用）',
      inputLabel: null,
      expression: supplierExpr,
      evaluation: `空の${node.containerLabel}を生成しました`,
      outcome: 'ここへ要素を蓄積していきます',
    },
    currentText: `supplier（${supplierExpr}）を適用し、空の${node.containerLabel}を生成しました。`,
    jdkNote:
      rt.op === 'collectTriple'
        ? '3引数collectはsupplier / accumulator / combinerを直接渡す可変リダクションです。combinerはparallel実行で必要となり、sequential実行では呼ばれません。'
        : null,
  })
}
