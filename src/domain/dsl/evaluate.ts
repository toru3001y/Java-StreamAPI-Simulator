import type { DslPredicate } from './ast'
import type { EmployeeValue } from '../model/employee'
import type { SimValue } from '../model/value'

/**
 * 検証済みDSLの安全な評価（§9.1）。
 * eval / new Function / 動的コード生成は使用しない。
 */
function compareByOperator(operator: string, left: number, right: number): boolean {
  switch (operator) {
    case 'GTE':
      return left >= right
    case 'LT':
      return left < right
    default:
      throw new Error(`unsupported operator: ${operator}`)
  }
}

export function evaluatePredicate(predicate: DslPredicate, employee: EmployeeValue): boolean {
  if (predicate.kind !== 'fieldCompare') {
    throw new Error(`unsupported predicate kind: ${predicate.kind}`)
  }
  const fieldValue = readIntField(predicate.field, employee)
  if (predicate.value.type !== 'int') {
    throw new Error(`unsupported literal type: ${predicate.value.type}`)
  }
  return compareByOperator(predicate.operator, fieldValue, predicate.value.value)
}

/** currentValueCompareで比較可能な数値SimValueを取り出す（Phase 3指示 §6.2） */
export function numericValueOf(value: SimValue): number {
  switch (value.kind) {
    case 'int':
    case 'long':
    case 'double':
    case 'boxedInt':
    case 'boxedLong':
    case 'boxedDouble':
      return value.value
    default:
      throw new Error(`currentValueCompareへ${value.kind}要素は適用できません`)
  }
}

/**
 * 現在要素のSimValueに対するPredicate評価（Phase 3指示 §6.2）。
 * fieldCompareはEmployee要素、currentValueCompareはprimitive / wrapper要素へ適用する。
 */
export function evaluateValuePredicate(predicate: DslPredicate, value: SimValue): boolean {
  if (predicate.kind === 'fieldCompare') {
    if (value.kind !== 'employee') {
      throw new Error('fieldCompareはEmployee要素が必要です')
    }
    return evaluatePredicate(predicate, value.value)
  }
  if (predicate.value.type !== 'int') {
    throw new Error(`unsupported literal type: ${predicate.value.type}`)
  }
  return compareByOperator(predicate.operator, numericValueOf(value), predicate.value.value)
}

function readIntField(field: string, employee: EmployeeValue): number {
  switch (field) {
    case 'age':
      return employee.age
    default:
      throw new Error(`unsupported int field: ${field}`)
  }
}
