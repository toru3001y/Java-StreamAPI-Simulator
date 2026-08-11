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

/** 数値比較に使えるliteral型（int / long。型整合はvalidateTypesで保証済み） */
function numericLiteralValue(predicate: DslPredicate): number {
  if (predicate.value.type !== 'int' && predicate.value.type !== 'long') {
    throw new Error(`unsupported literal type: ${predicate.value.type}`)
  }
  return predicate.value.value
}

export function evaluatePredicate(predicate: DslPredicate, employee: EmployeeValue): boolean {
  if (predicate.kind !== 'fieldCompare') {
    throw new Error(`unsupported predicate kind: ${predicate.kind}`)
  }
  const fieldValue = readNumericField(predicate.field, employee)
  return compareByOperator(predicate.operator, fieldValue, numericLiteralValue(predicate))
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
 * Predicateが比較する対象値をPredicate種別に応じて取得する（Phase 3レビュー修正1）。
 * - currentValueCompare: primitive / wrapper要素自身の数値
 * - fieldCompare: Employeeの許可済みfield値（現在の許可範囲ではage）
 * 評価・fieldValueFlow・comparisonExpr・処理中表示はすべてこの同じ値を参照する。
 */
export function predicateComparisonValue(predicate: DslPredicate, value: SimValue): number {
  if (predicate.kind === 'fieldCompare') {
    if (value.kind !== 'employee') {
      throw new Error('fieldCompareはEmployee要素が必要です')
    }
    return readNumericField(predicate.field, value.value)
  }
  return numericValueOf(value)
}

/**
 * 現在要素のSimValueに対するPredicate評価（Phase 3指示 §6.2）。
 * fieldCompareはEmployee要素、currentValueCompareはprimitive / wrapper要素へ適用する。
 */
export function evaluateValuePredicate(predicate: DslPredicate, value: SimValue): boolean {
  return compareByOperator(
    predicate.operator,
    predicateComparisonValue(predicate, value),
    numericLiteralValue(predicate),
  )
}

/**
 * Predicateが比較するEmployeeの数値field（Phase 5でsalary / evaluationへ拡張）。
 * field型とliteral型の整合はvalidateTypes（§9.3手順4）で事前に保証される。
 */
function readNumericField(field: string, employee: EmployeeValue): number {
  switch (field) {
    case 'age':
      return employee.age
    case 'salary':
      return employee.salary
    case 'evaluation':
      return employee.evaluation
    default:
      throw new Error(`unsupported numeric field: ${field}`)
  }
}
