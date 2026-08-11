/**
 * Phase 4 terminal DSL（指示§8、Draft v0.8 §9.1）。
 * Reduction / identity / Array Generatorを型付きの識別可能Unionで表現する。
 * 任意Javaコード文字列・関数本文文字列は受け付けない。
 */

/** 許可済みReduction（§8）。評価・TypeRef・Javaコード・説明を同一ASTから生成する */
export type ReductionDsl =
  | { readonly kind: 'numericSum' }
  | { readonly kind: 'stringConcat' }
  | {
      readonly kind: 'employeeFieldSum'
      /** 3引数reduce用の許可済みfield加算 */
      readonly field: 'salary' | 'age'
    }

export const REDUCTION_DSL_KINDS = ['numericSum', 'stringConcat', 'employeeFieldSum'] as const
export const REDUCTION_FIELD_WHITELIST = ['salary', 'age'] as const

/** reduceの型付きidentity（§8）。型検証はinstantiateで要素型と突き合わせる */
export interface ReductionIdentity {
  readonly type: 'int' | 'long' | 'double' | 'string'
  readonly value: number | string
}

/** toArray(generator)の許可済みgenerator（§8）。任意コードは受け付けない */
export interface ArrayGeneratorDsl {
  readonly kind: 'arrayGenerator'
  readonly elementTypeName: 'String' | 'Employee' | 'Object'
}

export const ARRAY_GENERATOR_TYPE_WHITELIST = ['String', 'Employee', 'Object'] as const
