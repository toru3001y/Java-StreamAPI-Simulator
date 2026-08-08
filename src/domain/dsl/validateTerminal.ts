import type { Result } from '../types/result'
import { fail, issue, ok } from '../types/result'
import type { ArrayGeneratorDsl, ReductionDsl, ReductionIdentity } from './terminalAst'
import {
  ARRAY_GENERATOR_TYPE_WHITELIST,
  REDUCTION_DSL_KINDS,
  REDUCTION_FIELD_WHITELIST,
} from './terminalAst'

/**
 * Phase 4 terminal DSLの構造検証（指示§8）。
 * 未知kind・許可外field・任意コード文字列・範囲外literalを拒否する。
 */
const INT32_MAX = 2_147_483_647
const INT32_MIN = -2_147_483_648

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
  if (kind === 'employeeFieldSum') {
    if (!(REDUCTION_FIELD_WHITELIST as readonly string[]).includes(String(obj['field']))) {
      return fail([
        issue(
          'WHITELIST_FIELD',
          `reductionで許可されていないfieldです: ${String(obj['field'])}`,
          `${path}.field`,
        ),
      ])
    }
  }
  return ok(input as ReductionDsl)
}

export function validateReductionIdentity(input: unknown, path = 'identity'): Result<ReductionIdentity> {
  if (typeof input !== 'object' || input === null) {
    return fail([issue('STRUCTURE_INVALID', 'identityはオブジェクトが必要です', path)])
  }
  const obj = input as Record<string, unknown>
  const type = obj['type']
  const value = obj['value']
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
  if (!(ARRAY_GENERATOR_TYPE_WHITELIST as readonly string[]).includes(String(obj['elementTypeName']))) {
    return fail([
      issue(
        'STRUCTURE_UNKNOWN_KIND',
        `許可されていないgenerator要素型です: ${String(obj['elementTypeName'])}`,
        `${path}.elementTypeName`,
      ),
    ])
  }
  return ok(input as ArrayGeneratorDsl)
}
