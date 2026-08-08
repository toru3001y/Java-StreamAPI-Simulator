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
  | 'TYPE_MISMATCH'
  | 'TEACHING_CONSTRAINT'
  | 'SNAPSHOT_BUDGET'

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
