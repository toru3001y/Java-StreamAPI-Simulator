import type { Result, ValidationIssue } from '../types/result'
import { fail, issue, ok } from '../types/result'
import type { ComparatorDsl } from './comparatorAst'
import { COMPARATOR_DSL_KINDS, EMPLOYEE_COMPARATOR_FIELDS } from './comparatorAst'

/**
 * Comparator DSLの構造検証（Phase 3指示 §6.3）。
 * 未知kind、許可外field、未知direction、空キー列を拒否する。
 * 型検証（Employee要素限定・primitive Stream拒否）はinstantiate側の型遷移検証で行う。
 */
export function validateComparatorStructure(
  input: unknown,
  path = 'comparator',
): Result<ComparatorDsl> {
  if (typeof input !== 'object' || input === null) {
    return fail([issue('STRUCTURE_INVALID', 'comparatorはオブジェクトが必要です', path)])
  }
  const obj = input as Record<string, unknown>
  const kind = obj['kind']
  if (!(COMPARATOR_DSL_KINDS as readonly string[]).includes(String(kind))) {
    return fail([
      issue('STRUCTURE_UNKNOWN_KIND', `未知のcomparator kindです: ${String(kind)}`, `${path}.kind`),
    ])
  }
  if (kind === 'natural') return ok(input as ComparatorDsl)

  const keys = obj['keys']
  const issues: ValidationIssue[] = []
  if (!Array.isArray(keys) || keys.length === 0) {
    return fail([
      issue('STRUCTURE_INVALID', 'employeeKeysは1件以上のkeysが必要です', `${path}.keys`),
    ])
  }
  keys.forEach((key, i) => {
    if (typeof key !== 'object' || key === null) {
      issues.push(issue('STRUCTURE_INVALID', 'keyはオブジェクトが必要です', `${path}.keys.${i}`))
      return
    }
    const k = key as Record<string, unknown>
    if (!(EMPLOYEE_COMPARATOR_FIELDS as readonly string[]).includes(String(k['field']))) {
      issues.push(
        issue(
          'WHITELIST_FIELD',
          `Comparatorキーとして許可されていないfieldです: ${String(k['field'])}`,
          `${path}.keys.${i}.field`,
        ),
      )
    }
    if (k['direction'] !== 'ASC' && k['direction'] !== 'DESC') {
      issues.push(
        issue(
          'STRUCTURE_UNKNOWN_KIND',
          `未知のdirectionです: ${String(k['direction'])}`,
          `${path}.keys.${i}.direction`,
        ),
      )
    }
  })
  if (issues.length > 0) return fail(issues)
  return ok(input as ComparatorDsl)
}
