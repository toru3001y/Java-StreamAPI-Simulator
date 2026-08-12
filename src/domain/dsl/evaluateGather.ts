import type { GatherAccumulationRule } from './gatherAst'
import type { ReductionIdentity } from './terminalAst'
import type { SimValue } from '../model/value'
import { formatDoubleLiteral, formatLongLiteral } from '../model/value'
import { assertNotCompositeList } from '../types/invariantError'

/**
 * 検証済みGatherer DSLの安全な累積評価（Phase 7指示 §7.4-4、v0.9 §8.3）。
 * eval / new Function / 動的コード生成は使用しない。
 *
 * **`evaluateReduction.ts`は呼ばない**（Gatherer専用の独立実装）。
 * 既存Terminal DSLの累積はprimitive kind（int / long / double）で行うのに対し、
 * gatherは型引数T / Rが参照型であるため**boxed kind**（boxedInt / boxedLong / boxedDouble）で
 * 累積する。共通化すると既存の受理範囲・表示（primitive名とwrapper名の区別）を変える
 * リスクがあるため、独立実装として分離した（判断は docs/phase-7-decisions.md）。
 */

/** boxed変換契約（§7.4-4）: initial.typeのタグ → 累積値のSimValue kind */
export const GATHER_BOXED_KIND_BY_IDENTITY_TYPE: Readonly<
  Record<ReductionIdentity['type'], SimValue['kind']>
> = {
  int: 'boxedInt',
  long: 'boxedLong',
  double: 'boxedDouble',
  // Java Stringは元から参照型のため、boxed相当のvariantは存在しない
  string: 'string',
}

/**
 * initialからGatherer累積値の初期SimValueを作る。
 * 型適合はinstantiate（`resolveGathererOutputElementType`）で検証済み。
 */
export function gatherInitialToSimValue(initial: ReductionIdentity): SimValue {
  switch (initial.type) {
    case 'string':
      return { kind: 'string', value: String(initial.value) }
    case 'int':
      return { kind: 'boxedInt', value: Number(initial.value) }
    case 'long':
      return { kind: 'boxedLong', value: Number(initial.value) }
    case 'double':
      return { kind: 'boxedDouble', value: Number(initial.value) }
  }
}

/**
 * accumulator 1回分の適用（acc op element → 新しいacc）。累積値のkindは不変。
 *
 * 先頭の`list`ガードは棚卸し（docs/phase-7-decisions.md §3）と同じ扱い。
 * accは`gatherInitialToSimValue`が返すboxed / stringのみであり、elementはgather上流の要素だが、
 * v0.9 §8.4のPipeline合成の限定によりgatherノードは1本で上流にgatherが来ないため、
 * 合成List値は到達しない（1本であることはP7-D19がgatherノードとJavaコード行の
 * 1対1対応として全template×modeで検証している）。
 * 到達した場合はJ-3のフェイルセーフへ乗せるため`EngineInvariantError`で停止する。
 * window系（`emitGatherWindow`）はこの関数を通らないため影響はない。
 */
export function applyGatherAccumulation(
  rule: GatherAccumulationRule,
  acc: SimValue,
  element: SimValue,
): SimValue {
  assertNotCompositeList(acc, 'gatherの累積値')
  assertNotCompositeList(element, 'gatherの累積入力')
  switch (rule.kind) {
    case 'numericSum': {
      if (!isBoxedNumeric(acc)) {
        throw new Error(`numericSumの累積値はboxed数値が必要です: ${acc.kind}`)
      }
      if (!isBoxedNumeric(element)) {
        throw new Error(`numericSumへ${element.kind}要素は適用できません`)
      }
      return { kind: acc.kind, value: acc.value + element.value }
    }
    case 'stringConcat': {
      if (acc.kind !== 'string' || element.kind !== 'string') {
        throw new Error(`stringConcatへ${acc.kind} / ${element.kind}は適用できません`)
      }
      return { kind: 'string', value: acc.value + element.value }
    }
    case 'employeeFieldSum': {
      if (element.kind !== 'employee') {
        throw new Error('employeeFieldSumはEmployee要素が必要です')
      }
      if (!isBoxedNumeric(acc)) {
        throw new Error(`employeeFieldSumの累積値はboxed数値が必要です: ${acc.kind}`)
      }
      return { kind: acc.kind, value: acc.value + employeeFieldValue(rule.field, element.value) }
    }
  }
}

type BoxedNumeric = Extract<SimValue, { kind: 'boxedInt' | 'boxedLong' | 'boxedDouble' }>

function isBoxedNumeric(value: SimValue): value is BoxedNumeric {
  return value.kind === 'boxedInt' || value.kind === 'boxedLong' || value.kind === 'boxedDouble'
}

function employeeFieldValue(
  field: 'age' | 'salary' | 'evaluation',
  employee: Extract<SimValue, { kind: 'employee' }>['value'],
): number {
  switch (field) {
    case 'age':
      return employee.age
    case 'salary':
      return employee.salary
    case 'evaluation':
      return employee.evaluation
  }
}

/**
 * 累積履歴に表示する「要素から取り出した値」のラベル（既存reduce contextのinputLabel様式）。
 * employeeFieldSumはfieldアクセスの流れを、それ以外は要素自身の表示ラベルを返す。
 */
export function gatherAccumulationInputLabel(
  rule: GatherAccumulationRule,
  element: SimValue,
): string {
  assertNotCompositeList(element, 'gather累積の入力表示')
  if (rule.kind === 'employeeFieldSum' && element.kind === 'employee') {
    const raw = employeeFieldValue(rule.field, element.value)
    return `${element.value.name}.${rule.field}() → ${formatFieldValue(rule.field, raw)}`
  }
  return ''
}

function formatFieldValue(field: 'age' | 'salary' | 'evaluation', value: number): string {
  switch (field) {
    case 'age':
      return String(value)
    case 'salary':
      return formatLongLiteral(value)
    case 'evaluation':
      return formatDoubleLiteral(value)
  }
}
