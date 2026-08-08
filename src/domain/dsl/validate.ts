import type { DslPredicate, DslProfile } from './ast'
import type { Result, ValidationIssue } from '../types/result'
import { fail, issue, ok } from '../types/result'
import { EMPLOYEE_FIELDS } from '../model/employee'
import { typeRefEquals, TYPE_INT } from '../types/typeRef'

/**
 * DSL検証（§9.3の手順1・3・4に対応）。
 * 手順2（template / slot許可範囲）と手順5以降はtemplate/instantiate側で行う。
 */

/** 手順1: JSON Schema相当の構造検証 */
export function validateStructure(input: unknown, path = 'predicate'): Result<DslPredicate> {
  if (typeof input !== 'object' || input === null) {
    return fail([issue('STRUCTURE_INVALID', 'Predicateはオブジェクトである必要があります', path)])
  }
  const obj = input as Record<string, unknown>
  if (obj['kind'] !== 'fieldCompare') {
    return fail([
      issue('STRUCTURE_UNKNOWN_KIND', `未知のkindです: ${String(obj['kind'])}`, `${path}.kind`),
    ])
  }
  const issues: ValidationIssue[] = []
  if (typeof obj['field'] !== 'string' || obj['field'] === '') {
    issues.push(issue('STRUCTURE_INVALID', 'fieldは文字列で必須です', `${path}.field`))
  }
  if (typeof obj['operator'] !== 'string' || obj['operator'] === '') {
    issues.push(issue('STRUCTURE_INVALID', 'operatorは文字列で必須です', `${path}.operator`))
  }
  const value = obj['value']
  if (typeof value !== 'object' || value === null) {
    issues.push(issue('STRUCTURE_INVALID', 'valueはオブジェクトで必須です', `${path}.value`))
  } else {
    const v = value as Record<string, unknown>
    if (v['type'] === 'int') {
      if (typeof v['value'] !== 'number' || !Number.isInteger(v['value'])) {
        issues.push(issue('STRUCTURE_INVALID', 'int定数のvalueは整数が必要です', `${path}.value.value`))
      }
    } else if (v['type'] === 'string') {
      if (typeof v['value'] !== 'string') {
        issues.push(issue('STRUCTURE_INVALID', 'string定数のvalueは文字列が必要です', `${path}.value.value`))
      }
    } else {
      issues.push(
        issue('STRUCTURE_UNKNOWN_KIND', `未知の定数型です: ${String(v['type'])}`, `${path}.value.type`),
      )
    }
  }
  if (issues.length > 0) return fail(issues)
  return ok(input as DslPredicate)
}

/** 手順3: DSLホワイトリスト検証 */
export function validateWhitelist(
  predicate: DslPredicate,
  profile: DslProfile,
  path = 'predicate',
): Result<DslPredicate> {
  const issues: ValidationIssue[] = []
  if (!profile.predicateKinds.includes(predicate.kind)) {
    issues.push(issue('STRUCTURE_UNKNOWN_KIND', `許可されていないkindです: ${predicate.kind}`, `${path}.kind`))
  }
  if (!profile.allowedFields.includes(predicate.field)) {
    issues.push(
      issue('WHITELIST_FIELD', `許可されていないfieldです: ${predicate.field}`, `${path}.field`),
    )
  }
  if (!profile.allowedOperators.includes(predicate.operator)) {
    issues.push(
      issue(
        'WHITELIST_OPERATOR',
        `許可されていないoperatorです: ${predicate.operator}`,
        `${path}.operator`,
      ),
    )
  }
  if (issues.length > 0) return fail(issues)
  return ok(predicate)
}

/** 手順4: TypeRefによる型検証 */
export function validateTypes(predicate: DslPredicate, path = 'predicate'): Result<DslPredicate> {
  const fieldInfo = EMPLOYEE_FIELDS[predicate.field]
  if (!fieldInfo) {
    return fail([
      issue('WHITELIST_FIELD', `Employeeに存在しないfieldです: ${predicate.field}`, `${path}.field`),
    ])
  }
  if (predicate.value.type === 'int') {
    if (!typeRefEquals(fieldInfo.javaType, TYPE_INT)) {
      return fail([
        issue(
          'TYPE_MISMATCH',
          `field ${predicate.field}（${fieldInfo.javaType.kind === 'primitive' ? fieldInfo.javaType.name : 'object'}型）とint定数は比較できません`,
          `${path}.value`,
        ),
      ])
    }
    return ok(predicate)
  }
  return fail([
    issue(
      'TYPE_MISMATCH',
      `field ${predicate.field}と${predicate.value.type}定数の比較は型不一致です`,
      `${path}.value`,
    ),
  ])
}
