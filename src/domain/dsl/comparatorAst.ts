/**
 * Comparator DSL（Phase 3指示 §6.3、Draft v0.8 §9.1）。
 * natural order、Employeeの許可済みfieldによるASC / DESC、許可済み複合キーを
 * 型付きの識別可能Unionで表現する。任意コード文字列は受け付けない。
 * skillsはListでありComparatorキーに含めない（§6.3）。
 */
export type SortDirection = 'ASC' | 'DESC'

/** Employeeで許可する比較キー（§6.3。department配下はネスト表記） */
export const EMPLOYEE_COMPARATOR_FIELDS = [
  'name',
  'age',
  'salary',
  'evaluation',
  'region',
  'hireDate',
  'department.name',
  'department.division',
] as const

export type EmployeeComparatorField = (typeof EMPLOYEE_COMPARATOR_FIELDS)[number]

export interface ComparatorKey {
  readonly field: EmployeeComparatorField
  readonly direction: SortDirection
}

export type ComparatorDsl =
  | { readonly kind: 'natural' }
  | { readonly kind: 'employeeKeys'; readonly keys: readonly ComparatorKey[] }

export const COMPARATOR_DSL_KINDS = ['natural', 'employeeKeys'] as const

/** 比較キーのJava上の型分類（comparingInt / comparingLong / comparingDouble / comparing） */
export const COMPARATOR_FIELD_JAVA_KIND: Readonly<
  Record<EmployeeComparatorField, 'int' | 'long' | 'double' | 'object'>
> = {
  name: 'object',
  age: 'int',
  salary: 'long',
  evaluation: 'double',
  region: 'object',
  hireDate: 'object',
  'department.name': 'object',
  'department.division': 'object',
}
