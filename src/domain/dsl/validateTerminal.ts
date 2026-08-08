import type { Result, ValidationIssue } from '../types/result'
import { fail, issue, ok } from '../types/result'
import type { ArrayGeneratorDsl, ReductionDsl, ReductionIdentity } from './terminalAst'
import {
  ARRAY_GENERATOR_TYPE_WHITELIST,
  REDUCTION_DSL_KINDS,
  REDUCTION_FIELD_WHITELIST,
} from './terminalAst'

/**
 * Phase 4 terminal DSLの構造検証（指示§8、レビュー対応でclosed schema化）。
 * 未知kind・許可外field・任意コード文字列・範囲外literalに加え、
 * variantごとに許可されていない追加フィールドを拒否する（Draft v0.8 §9.1:
 * 任意Javaコード文字列・関数本文は追加フィールドとしても混入させない）。
 */
const INT32_MAX = 2_147_483_647
const INT32_MIN = -2_147_483_648

/** variantごとの許可キー集合（closed schema） */
const REDUCTION_ALLOWED_KEYS: Readonly<Record<string, readonly string[]>> = {
  numericSum: ['kind'],
  stringConcat: ['kind'],
  employeeFieldSum: ['kind', 'field'],
}
const IDENTITY_ALLOWED_KEYS: readonly string[] = ['type', 'value']
const ARRAY_GENERATOR_ALLOWED_KEYS: readonly string[] = ['kind', 'elementTypeName']

/**
 * closed schema検証の共通処理: 許可キー集合に含まれない実入力キーを
 * ValidationIssueとして返す（例外は送出しない）。パスは `reduction.functionBody` の形式。
 */
function unknownFieldIssues(
  obj: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
): ValidationIssue[] {
  return Object.keys(obj)
    .filter((key) => !allowedKeys.includes(key))
    .map((key) =>
      issue('STRUCTURE_INVALID', `許可されていないフィールドです: ${key}`, `${path}.${key}`),
    )
}

export function validateReductionStructure(input: unknown, path = 'reduction'): Result<ReductionDsl> {
  if (typeof input !== 'object' || input === null) {
    return fail([issue('STRUCTURE_INVALID', 'reductionはオブジェクトが必要です', path)])
  }
  const obj = input as Record<string, unknown>
  const kind = obj['kind']
  if (!(REDUCTION_DSL_KINDS as readonly string[]).includes(String(kind))) {
    return fail([
      issue('STRUCTURE_UNKNOWN_KIND', `未知のreduction kindです: ${String(kind)}`, `${path}.kind`),
    ])
  }
  // closed schema: variantごとの許可キー以外を拒否する
  const issues = unknownFieldIssues(obj, REDUCTION_ALLOWED_KEYS[String(kind)] ?? ['kind'], path)
  if (kind === 'employeeFieldSum') {
    if (!(REDUCTION_FIELD_WHITELIST as readonly string[]).includes(String(obj['field']))) {
      issues.push(
        issue(
          'WHITELIST_FIELD',
          `reductionで許可されていないfieldです: ${String(obj['field'])}`,
          `${path}.field`,
        ),
      )
    }
  }
  if (issues.length > 0) return fail(issues)
  return ok(input as ReductionDsl)
}

export function validateReductionIdentity(input: unknown, path = 'identity'): Result<ReductionIdentity> {
  if (typeof input !== 'object' || input === null) {
    return fail([issue('STRUCTURE_INVALID', 'identityはオブジェクトが必要です', path)])
  }
  const obj = input as Record<string, unknown>
  const type = obj['type']
  const value = obj['value']
  // closed schema: type / value以外のフィールドを拒否する
  const unknownIssues = unknownFieldIssues(obj, IDENTITY_ALLOWED_KEYS, path)
  if (unknownIssues.length > 0) return fail(unknownIssues)
  if (type === 'string') {
    if (typeof value !== 'string') {
      return fail([issue('STRUCTURE_INVALID', 'string identityのvalueは文字列が必要です', `${path}.value`)])
    }
    return ok(input as ReductionIdentity)
  }
  if (type === 'int' || type === 'long' || type === 'double') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return fail([issue('STRUCTURE_INVALID', `${type} identityのvalueは数値が必要です`, `${path}.value`)])
    }
    if (type !== 'double' && !Number.isInteger(value)) {
      return fail([issue('TYPE_MISMATCH', `${type} identityのvalueは整数が必要です`, `${path}.value`)])
    }
    if (type === 'int' && (value > INT32_MAX || value < INT32_MIN)) {
      return fail([
        issue('TYPE_MISMATCH', `int identityはJava intの範囲が必要です: ${value}`, `${path}.value`),
      ])
    }
    if (type === 'long' && !Number.isSafeInteger(value)) {
      return fail([
        issue('TYPE_MISMATCH', `long identityはsafe integer範囲が必要です: ${value}`, `${path}.value`),
      ])
    }
    return ok(input as ReductionIdentity)
  }
  return fail([issue('STRUCTURE_UNKNOWN_KIND', `未知のidentity型です: ${String(type)}`, `${path}.type`)])
}

export function validateArrayGenerator(input: unknown, path = 'arrayGenerator'): Result<ArrayGeneratorDsl> {
  if (typeof input !== 'object' || input === null) {
    return fail([issue('STRUCTURE_INVALID', 'arrayGeneratorはオブジェクトが必要です', path)])
  }
  const obj = input as Record<string, unknown>
  if (obj['kind'] !== 'arrayGenerator') {
    return fail([
      issue('STRUCTURE_UNKNOWN_KIND', `未知のgenerator kindです: ${String(obj['kind'])}`, `${path}.kind`),
    ])
  }
  // closed schema: kind / elementTypeName以外のフィールドを拒否する
  const issues = unknownFieldIssues(obj, ARRAY_GENERATOR_ALLOWED_KEYS, path)
  if (!(ARRAY_GENERATOR_TYPE_WHITELIST as readonly string[]).includes(String(obj['elementTypeName']))) {
    issues.push(
      issue(
        'STRUCTURE_UNKNOWN_KIND',
        `許可されていないgenerator要素型です: ${String(obj['elementTypeName'])}`,
        `${path}.elementTypeName`,
      ),
    )
  }
  if (issues.length > 0) return fail(issues)
  return ok(input as ArrayGeneratorDsl)
}
