import type { ComparatorDsl, ComparatorKey, EmployeeComparatorField } from './comparatorAst'
import type { EmployeeValue } from '../model/employee'
import type { SimValue } from '../model/value'
import { formatDoubleLiteral, formatSimValue } from '../model/value'

/**
 * 検証済みComparator DSLの安全な評価（Phase 3指示 §6.3）。
 * - natural order: String / wrapper / LocalDate（ISO文字列）の自然順序。
 *   DoubleStream / boxedDoubleはJava 25のDouble.compare(double, double)と一致させる
 *   （教材データはNaN / -0.0を含まないため数値比較と一致する）。
 * - employeeKeys: 許可済みfieldのASC / DESC複合キー。
 * 並べ替え自体は安定sort（Array.prototype.sort）で行い、ordered Streamの
 * 同値キーはencounter orderを維持する。
 */
function compareNumbers(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Java String.compareTo（UTF-16コード単位）と一致する文字列比較 */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** natural orderの比較（要素自身がComparableな型のみ） */
export function compareNatural(a: SimValue, b: SimValue): number {
  if (a.kind !== b.kind) {
    throw new Error(`natural orderで異なる型は比較できません: ${a.kind} / ${b.kind}`)
  }
  switch (a.kind) {
    case 'string':
    case 'localDate':
      return compareStrings(a.value as string, b.value as string)
    case 'int':
    case 'long':
    case 'double':
    case 'boxedInt':
    case 'boxedLong':
    case 'boxedDouble':
      return compareNumbers(a.value, (b as { value: number }).value)
    default:
      throw new Error(`natural orderで比較できない型です: ${a.kind}`)
  }
}

function keyValueOf(field: EmployeeComparatorField, e: EmployeeValue): string | number {
  switch (field) {
    case 'name':
      return e.name
    case 'age':
      return e.age
    case 'salary':
      return e.salary
    case 'evaluation':
      return e.evaluation
    case 'region':
      return e.region
    case 'hireDate':
      return e.hireDate
    case 'department.name':
      return e.department.name
    case 'department.division':
      return e.department.division
  }
}

function compareByKey(key: ComparatorKey, a: EmployeeValue, b: EmployeeValue): number {
  const av = keyValueOf(key.field, a)
  const bv = keyValueOf(key.field, b)
  const base =
    typeof av === 'number' ? compareNumbers(av, bv as number) : compareStrings(av, bv as string)
  return key.direction === 'DESC' ? -base : base
}

/** Comparator DSLによる2要素の比較 */
export function compareByComparator(comparator: ComparatorDsl, a: SimValue, b: SimValue): number {
  if (comparator.kind === 'natural') return compareNatural(a, b)
  if (a.kind !== 'employee' || b.kind !== 'employee') {
    throw new Error('employeeKeys ComparatorはEmployee要素が必要です')
  }
  for (const key of comparator.keys) {
    const result = compareByKey(key, a.value, b.value)
    if (result !== 0) return result
  }
  return 0
}

/** 要素の比較キー表示（sorted固有状態の「Comparatorキー / 比較対象」） */
export function comparatorKeyLabel(comparator: ComparatorDsl | null, value: SimValue): string {
  if (!comparator || comparator.kind === 'natural') return formatSimValue(value)
  if (value.kind !== 'employee') {
    throw new Error('employeeKeys ComparatorはEmployee要素が必要です')
  }
  return comparator.keys
    .map((key) => {
      const v = keyValueOf(key.field, value.value)
      const label =
        typeof v === 'number'
          ? key.field === 'evaluation'
            ? formatDoubleLiteral(v)
            : String(v)
          : `"${v}"`
      return `${key.field}=${label}`
    })
    .join(', ')
}

/**
 * bufferの安定sort。ordered Streamの同値キーは元のencounter orderを維持する
 * （Array.prototype.sortはECMAScript仕様上stable）。
 */
export function sortBuffer<T extends { readonly value: SimValue }>(
  entries: readonly T[],
  comparator: ComparatorDsl | null,
): T[] {
  const effective: ComparatorDsl = comparator ?? { kind: 'natural' }
  return [...entries].sort((a, b) => compareByComparator(effective, a.value, b.value))
}
