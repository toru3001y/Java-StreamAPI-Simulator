import type { PrimitiveName } from '../model/value'

/**
 * Mapper DSL（Phase 2指示 §7.2、Draft v0.8 §9.1）。
 * 同じASTから安全な評価、入出力TypeRef、Javaコード、自然文説明を生成する。
 * 関数本文文字列・任意Javaコード文字列は受け付けない。
 */
export type MapperDsl =
  | { readonly kind: 'fieldAccess'; readonly field: string }
  | { readonly kind: 'toUpper' }
  | { readonly kind: 'prefix'; readonly prefix: string }
  | {
      readonly kind: 'fieldToPrimitive'
      readonly field: string
      readonly primitive: PrimitiveName
    }
  | { readonly kind: 'listStream' }
  | { readonly kind: 'arrayStream'; readonly primitive: PrimitiveName }

export const MAPPER_DSL_KINDS = [
  'fieldAccess',
  'toUpper',
  'prefix',
  'fieldToPrimitive',
  'listStream',
  'arrayStream',
] as const

/** flatMap系で使用するmapper kind（1要素→mapped Stream） */
export const FLATTENING_MAPPER_KINDS: readonly MapperDsl['kind'][] = ['listStream', 'arrayStream']
