/** 検証結果の共通表現。不成立の候補はStep Engineへ渡さない（§9.3）。 */
export type ValidationCode =
  | 'STRUCTURE_UNKNOWN_KIND'
  | 'STRUCTURE_INVALID'
  | 'TEMPLATE_NOT_FOUND'
  | 'TEMPLATE_VERSION_MISMATCH'
  | 'TEMPLATE_MODE_UNSUPPORTED'
  | 'SLOT_UNKNOWN'
  | 'SLOT_MISSING'
  | 'WHITELIST_FIELD'
  | 'WHITELIST_OPERATOR'
  | 'WHITELIST_KIND'
  | 'TYPE_MISMATCH'
  | 'TEACHING_CONSTRAINT'
  | 'SNAPSHOT_BUDGET'
  | 'UNBOUNDED_SOURCE'
  /** 無限sourceの必要要求件数を構造的に保証できない候補（Phase 3指示 §8.2） */
  | 'UNSAFE_BOUNDEDNESS'
  /** unordered sourceへのtakeWhile / dropWhile（Phase 3指示 §7.6・§7.7） */
  | 'UNORDERED_WHILE'
  /** Collector ASTの入れ子が教材制約の上限を超える（Phase 5指示 §7.1） */
  | 'COLLECTOR_DEPTH'

export interface ValidationIssue {
  readonly code: ValidationCode
  readonly message: string
  readonly path: string
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] }

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function fail<T>(issues: readonly ValidationIssue[]): Result<T> {
  return { ok: false, issues }
}

export function issue(code: ValidationCode, message: string, path = ''): ValidationIssue {
  return { code, message, path }
}
