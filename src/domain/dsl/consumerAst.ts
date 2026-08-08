/**
 * Consumer DSL（Phase 3指示 §6.5、Draft v0.8 §9.1）。
 * peekの許可済みactionだけを表現し、任意Consumer文字列は受け付けない。
 * 同じASTから評価、Java式、説明、Side Effect表示メッセージを生成する。
 */
export type ConsumerDsl =
  | { readonly kind: 'printValue' }
  | { readonly kind: 'printField'; readonly field: string }

export const CONSUMER_DSL_KINDS = ['printValue', 'printField'] as const

/** Side Effect履歴に表示するactionラベル（§6.5） */
export function consumerActionLabel(consumer: ConsumerDsl): 'PRINT_VALUE' | 'PRINT_FIELD' {
  return consumer.kind === 'printValue' ? 'PRINT_VALUE' : 'PRINT_FIELD'
}

/** printFieldで許可するEmployee field（表示可能な単純値のみ） */
export const CONSUMER_ALLOWED_FIELDS = [
  'name',
  'age',
  'salary',
  'evaluation',
  'region',
  'hireDate',
] as const
