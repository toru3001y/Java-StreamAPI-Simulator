/**
 * DSLモデル（Draft v0.8 §9）。型付きの識別可能Union / 再帰AST。
 * 任意Javaコード文字列、JavaScript式、関数本文は受け付けない。
 * Phase 1の許可範囲: Employeeの許可済みfield参照、int定数、比較GTE、filter Predicate。
 */
export const DSL_VERSION = '1'

export interface DslIntLiteral {
  readonly type: 'int'
  readonly value: number
}

export interface DslStringLiteral {
  readonly type: 'string'
  readonly value: string
}

/** 構造としては複数型を受理し、型検証（§9.3手順4）で許可範囲へ絞る。 */
export type DslLiteral = DslIntLiteral | DslStringLiteral

export interface FieldComparePredicate {
  readonly kind: 'fieldCompare'
  readonly field: string
  readonly operator: string
  readonly value: DslLiteral
}

export type DslPredicate = FieldComparePredicate

/** Phase 1で許可する比較演算子 */
export const ALLOWED_OPERATORS = ['GTE'] as const

export interface DslProfile {
  readonly predicateKinds: readonly string[]
  readonly allowedFields: readonly string[]
  readonly allowedOperators: readonly string[]
}
