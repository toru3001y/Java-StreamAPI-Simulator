import type { TypeRef } from '../types/typeRef'
import {
  TYPE_DEPARTMENT,
  TYPE_STRING,
} from '../types/typeRef'
import type { ElementId } from '../types/ids'

/**
 * Java表示モデル（§6.1）。EmployeeとDepartmentはJava recordとして表示する。
 * 画面内部用の安定ID（elementId）は業務フィールドと分離する。
 */
export interface DepartmentValue {
  readonly name: string
  readonly division: string
}

export interface EmployeeValue {
  readonly name: string
  readonly age: number
  readonly salary: number
  readonly evaluation: number
  readonly region: string
  /** ISO日付文字列（表示用） */
  readonly hireDate: string
  readonly department: DepartmentValue
  readonly skills: readonly string[]
}

export interface DatasetElement {
  readonly elementId: ElementId
  readonly value: EmployeeValue
}

export interface EmployeeFieldInfo {
  readonly fieldName: string
  readonly javaType: TypeRef
  /** recordアクセサー表記（例: age()） */
  readonly accessor: string
}

/** Employee recordの全フィールド（§6.1）。DSLの許可範囲はtemplate側のslotで絞る。 */
export const EMPLOYEE_FIELDS: Readonly<Record<string, EmployeeFieldInfo>> = {
  name: { fieldName: 'name', javaType: TYPE_STRING, accessor: 'name()' },
  age: { fieldName: 'age', javaType: { kind: 'primitive', name: 'int' }, accessor: 'age()' },
  salary: {
    fieldName: 'salary',
    javaType: { kind: 'primitive', name: 'long' },
    accessor: 'salary()',
  },
  evaluation: {
    fieldName: 'evaluation',
    javaType: { kind: 'primitive', name: 'double' },
    accessor: 'evaluation()',
  },
  region: { fieldName: 'region', javaType: TYPE_STRING, accessor: 'region()' },
  hireDate: {
    fieldName: 'hireDate',
    javaType: { kind: 'object', name: 'LocalDate' },
    accessor: 'hireDate()',
  },
  department: {
    fieldName: 'department',
    javaType: TYPE_DEPARTMENT,
    accessor: 'department()',
  },
  skills: {
    fieldName: 'skills',
    javaType: { kind: 'collection', container: 'List', elementType: TYPE_STRING },
    accessor: 'skills()',
  },
}
