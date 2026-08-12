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
  /** 貼付テキストがサイズ上限を超える（parse前に拒否。v0.10 §6.4、Phase 6指示 §7.1） */
  | 'IMPORT_SIZE_LIMIT'
  /** 貼付テキストをJSONとして解釈できない（v0.10 §7.2手順3） */
  | 'IMPORT_PARSE'
  /** 取込候補がImport Contract（closed schema・値域・文字列規則）に違反する（v0.10 §6） */
  | 'IMPORT_SCHEMA'
  /** 取込候補のtemplateId / templateVersion / mode / dslVersionが選択中と一致しない（v0.10 §6.1） */
  | 'IMPORT_CONTEXT_MISMATCH'
  /**
   * Gathererのwindow sizeが教材上限（16）を超える（v0.9 §8.2、Phase 7指示 §7.4-3）。
   * 1未満はJDK実仕様（IllegalArgumentException）に対応する`STRUCTURE_INVALID`で拒否し、
   * 教材上限超過だけをこのcodeへ分離する（`COLLECTOR_DEPTH`の前例）。
   */
  | 'GATHER_SIZE_LIMIT'

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
