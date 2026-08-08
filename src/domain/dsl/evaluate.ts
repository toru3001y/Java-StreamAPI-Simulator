import type { DslPredicate } from './ast'
import type { EmployeeValue } from '../model/employee'

/**
 * 検証済みDSLの安全な評価（§9.1）。
 * eval / new Function / 動的コード生成は使用しない。
 */
export function evaluatePredicate(predicate: DslPredicate, employee: EmployeeValue): boolean {
  if (predicate.kind !== 'fieldCompare') {
    throw new Error(`unsupported predicate kind: ${(predicate as { kind: string }).kind}`)
  }
  const fieldValue = readIntField(predicate.field, employee)
  if (predicate.value.type !== 'int') {
    throw new Error(`unsupported literal type: ${predicate.value.type}`)
  }
  switch (predicate.operator) {
    case 'GTE':
      return fieldValue >= predicate.value.value
    default:
      throw new Error(`unsupported operator: ${predicate.operator}`)
  }
}

function readIntField(field: string, employee: EmployeeValue): number {
  switch (field) {
    case 'age':
      return employee.age
    default:
      throw new Error(`unsupported int field: ${field}`)
  }
}
