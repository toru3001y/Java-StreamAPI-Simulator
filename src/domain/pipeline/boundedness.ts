import type { SourceDsl } from '../dsl/sourceAst'
import type { OperationId } from '../types/ids'
import type { Result } from '../types/result'
import { fail, issue, ok } from '../types/result'

/**
 * Pipeline有限性解析（Phase 3指示 §8.2、P3-D08）。
 * source自体の有限性と「Pipelineとして有限化済みか」を区別し、
 * 無限sourceに対しては有限化に必要な最大source要求件数をノード順から事前に導出する。
 * 500 snapshot制限を「正常な要素打ち切り」として利用しない。
 */
export interface BoundednessMeta {
  /** source自体の有限性。generateはlimitで有限化してもinfiniteのまま（§5.3） */
  readonly sourceBounded: 'finite' | 'infinite' | 'conditionallyFinite'
  /** Pipeline走査が構造的に有限化済みか */
  readonly pipelineFinitized: boolean
  /** 無限sourceの有限化に必要な最大source要求件数（有限sourceではnull） */
  readonly maxSourceDemand: number | null
}

export interface BoundednessNodeInput {
  readonly operationId: OperationId
  readonly count: number | null
}

/** 1→1を保証しsource要求件数を変えない操作（§8.2） */
const ONE_TO_ONE_OPERATIONS: readonly string[] = [
  'map',
  'mapToInt',
  'mapToLong',
  'mapToDouble',
  'boxed',
  'mapToObj',
  'peek',
]

const INFINITE_SOURCE_KINDS: readonly SourceDsl['kind'][] = ['generate', 'iterate2']

const INT32_MAX = 2_147_483_647
const INT32_MIN = -2_147_483_648

function sourceDisplay(kind: SourceDsl['kind']): string {
  return kind === 'generate' ? 'Stream.generate()' : 'Stream.iterate(seed, operator)'
}

/**
 * 無限sourceのPipelineについて、最初の有限化limitまでのノード列から
 * 必要なsource要求件数を構造的に導出する。保証できない候補は保守的に拒否する。
 */
export function analyzeBoundedness(
  sourceDsl: SourceDsl,
  sourceBounded: 'finite' | 'infinite' | 'conditionallyFinite',
  intermediates: readonly BoundednessNodeInput[],
): Result<BoundednessMeta> {
  if (!INFINITE_SOURCE_KINDS.includes(sourceDsl.kind)) {
    return ok({ sourceBounded, pipelineFinitized: true, maxSourceDemand: null })
  }

  let skippedBeforeLimit = 0
  for (const node of intermediates) {
    if (node.operationId === 'limit') {
      if (node.count === null) {
        return fail([
          issue('UNSAFE_BOUNDEDNESS', 'limitノードの引数が確定していません', 'nodes'),
        ])
      }
      // limit(0)はsource要素を1件も要求しない（§8.2）
      const demand = node.count === 0 ? 0 : node.count + skippedBeforeLimit
      // iterate2は最終候補値がJava int範囲に収まることを検証する
      if (sourceDsl.kind === 'iterate2' && demand > 0) {
        const last = sourceDsl.seed + (demand - 1) * sourceDsl.operator.step
        if (last > INT32_MAX || last < INT32_MIN) {
          return fail([
            issue(
              'TYPE_MISMATCH',
              `iterateの候補値がJava intの範囲を超えます（${demand}件目の候補 ${last}）`,
              'source',
            ),
          ])
        }
      }
      return ok({ sourceBounded, pipelineFinitized: true, maxSourceDemand: demand })
    }
    if (node.operationId === 'skip') {
      if (node.count === null) {
        return fail([
          issue('UNSAFE_BOUNDEDNESS', 'skipノードの引数が確定していません', 'nodes'),
        ])
      }
      skippedBeforeLimit += node.count
      continue
    }
    if (ONE_TO_ONE_OPERATIONS.includes(node.operationId)) continue
    if (node.operationId === 'sorted') {
      // 無限入力の全bufferは完了しないため、最初の有限化limitより前のsortedは拒否する（§8.2）
      return fail([
        issue(
          'UNBOUNDED_SOURCE',
          `${sourceDisplay(sourceDsl.kind)} は無限Streamであり、sortedを最初の有限化limit()より前に置くと全入力のbufferが完了しません`,
          'nodes',
        ),
      ])
    }
    // filter / distinct / takeWhile / dropWhile / flatMap等は
    // 有限なsource要求件数を構造的に保証できないため保守的に拒否する（§8.2）
    return fail([
      issue(
        'UNSAFE_BOUNDEDNESS',
        `${sourceDisplay(sourceDsl.kind)} は無限Streamであり、${node.operationId} を最初の有限化limit()より前に置くと必要なsource要求件数を構造的に保証できません`,
        'nodes',
      ),
    ])
  }

  // 有限化limitが存在しない
  return fail([
    issue(
      'UNBOUNDED_SOURCE',
      `${sourceDisplay(sourceDsl.kind)} は無限Streamであり、有限化するlimit()ノードがなければ実行できません`,
      'source',
    ),
  ])
}
