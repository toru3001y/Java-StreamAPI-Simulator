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

/**
 * primitive値またはwrapper値自身の比較（Phase 3指示 §6.2）。
 * 例: n -> n < 5 は { kind: 'currentValueCompare', operator: 'LT', value: { type: 'int', value: 5 } }
 */
export interface CurrentValueComparePredicate {
  readonly kind: 'currentValueCompare'
  readonly operator: string
  readonly value: DslLiteral
}

export type DslPredicate = FieldComparePredicate | CurrentValueComparePredicate

/** 許可する比較演算子（Phase 1: GTE、Phase 3で LT を追加。§6.2） */
export const ALLOWED_OPERATORS = ['GTE', 'LT'] as const

export interface DslProfile {
  readonly predicateKinds: readonly string[]
  readonly allowedFields: readonly string[]
  readonly allowedOperators: readonly string[]
}
