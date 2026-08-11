import type { ReductionDsl, ReductionIdentity } from './terminalAst'
import type { SimValue } from '../model/value'

/**
 * 検証済みReduction DSLの安全な評価（Phase 4指示 §8）。
 * eval / new Function / 動的コード生成は使用しない。
 * accumulatorは結合則を満たす許可済み演算のみ。
 */

/** identityからaccumulator初期値のSimValueを作る（要素型はinstantiateで検証済み） */
export function identityToSimValue(
  identity: ReductionIdentity,
  reduction: ReductionDsl,
  elementKind: SimValue['kind'],
): SimValue {
  if (identity.type === 'string') {
    return { kind: 'string', value: String(identity.value) }
  }
  if (reduction.kind === 'employeeFieldSum') {
    // 3引数reduceの累積値型はidentityの型（salary: long / age: int）
    return identity.type === 'long'
      ? { kind: 'long', value: Number(identity.value) }
      : identity.type === 'double'
        ? { kind: 'double', value: Number(identity.value) }
        : { kind: 'int', value: Number(identity.value) }
  }
  // numericSum: 要素と同じkindで累積する
  if (elementKind === 'int' || elementKind === 'long' || elementKind === 'double') {
    return { kind: elementKind, value: Number(identity.value) }
  }
  throw new Error(`identityを${elementKind}要素へ適用できません`)
}

/** accumulator 1回分の適用（acc op value → 新しいacc） */
export function applyReduction(reduction: ReductionDsl, acc: SimValue, value: SimValue): SimValue {
  switch (reduction.kind) {
    case 'numericSum': {
      if (
        (acc.kind === 'int' || acc.kind === 'long' || acc.kind === 'double') &&
        (value.kind === 'int' || value.kind === 'long' || value.kind === 'double')
      ) {
        return { kind: acc.kind, value: acc.value + value.value }
      }
      throw new Error(`numericSumへ${acc.kind} / ${value.kind}は適用できません`)
    }
    case 'stringConcat': {
      if (acc.kind === 'string' && value.kind === 'string') {
        return { kind: 'string', value: acc.value + value.value }
      }
      throw new Error(`stringConcatへ${acc.kind} / ${value.kind}は適用できません`)
    }
    case 'employeeFieldSum': {
      if (value.kind !== 'employee') {
        throw new Error('employeeFieldSumはEmployee要素が必要です')
      }
      if (acc.kind !== 'long' && acc.kind !== 'int') {
        throw new Error(`employeeFieldSumの累積値は数値が必要です: ${acc.kind}`)
      }
      const fieldValue = reduction.field === 'salary' ? value.value.salary : value.value.age
      return { kind: acc.kind, value: acc.value + fieldValue }
    }
  }
}

/** 要素から取り出す値の表示（employeeFieldSumではfield値、それ以外は要素自身） */
export function reductionInputLabel(reduction: ReductionDsl, value: SimValue): string {
  if (reduction.kind === 'employeeFieldSum' && value.kind === 'employee') {
    const fieldValue = reduction.field === 'salary' ? value.value.salary : value.value.age
    return `${value.value.name}.${reduction.field}() → ${
      reduction.field === 'salary' ? `${fieldValue}` : fieldValue
    }`
  }
  return ''
}
