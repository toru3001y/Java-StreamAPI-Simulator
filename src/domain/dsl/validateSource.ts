import type { Result, ValidationIssue } from '../types/result'
import { fail, issue, ok } from '../types/result'
import type { SourceDsl } from './sourceAst'
import { ALLOWED_GENERATE_RULES, ALLOWED_ITERATE_OPERATORS } from './sourceAst'
import type { TypeRef } from '../types/typeRef'
import { streamOf } from '../types/typeRef'
import { PRIMITIVE_STREAM_NAMES, WRAPPER_NAMES } from '../model/value'

/**
 * Source DSLの構造・型検証（Phase 2指示 §7.1）。
 * 型不一致、未知kind、未知rule ID、範囲値の型不一致を拒否する。
 */
const PRIMITIVES = ['int', 'long', 'double'] as const

function isPrimitive(v: unknown): v is 'int' | 'long' | 'double' {
  return typeof v === 'string' && (PRIMITIVES as readonly string[]).includes(v)
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

function isNumberArray(v: unknown, integer: boolean): v is number[] {
  return (
    Array.isArray(v) &&
    v.every((x) => typeof x === 'number' && Number.isFinite(x) && (!integer || Number.isInteger(x)))
  )
}

function checkOperator(op: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (typeof op !== 'object' || op === null) {
    issues.push(issue('STRUCTURE_INVALID', 'operatorはオブジェクトが必要です', path))
    return issues
  }
  const o = op as Record<string, unknown>
  if (!(ALLOWED_ITERATE_OPERATORS as readonly string[]).includes(String(o['ruleId']))) {
    issues.push(
      issue('STRUCTURE_UNKNOWN_KIND', `未知のoperator rule IDです: ${String(o['ruleId'])}`, `${path}.ruleId`),
    )
  }
  if (typeof o['step'] !== 'number' || !Number.isInteger(o['step'])) {
    issues.push(issue('TYPE_MISMATCH', 'operator.stepはint定数が必要です', `${path}.step`))
  }
  return issues
}

export function validateSourceStructure(input: unknown, path = 'source'): Result<SourceDsl> {
  if (typeof input !== 'object' || input === null) {
    return fail([issue('STRUCTURE_INVALID', 'sourceはオブジェクトが必要です', path)])
  }
  const obj = input as Record<string, unknown>
  const kind = obj['kind']
  const issues: ValidationIssue[] = []
  switch (kind) {
    case 'collection':
      if (obj['collectionId'] !== 'employees') {
        issues.push(
          issue('STRUCTURE_UNKNOWN_KIND', `未知のcollectionです: ${String(obj['collectionId'])}`, `${path}.collectionId`),
        )
      }
      break
    case 'arrayObject':
      if (typeof obj['arrayId'] !== 'string' || obj['arrayId'] === '') {
        issues.push(issue('STRUCTURE_INVALID', 'arrayIdは文字列で必須です', `${path}.arrayId`))
      }
      if (obj['elementTypeName'] !== 'String') {
        issues.push(
          issue('TYPE_MISMATCH', `object配列の要素型はStringのみ許可されます: ${String(obj['elementTypeName'])}`, `${path}.elementTypeName`),
        )
      }
      if (!isStringArray(obj['values'])) {
        issues.push(issue('TYPE_MISMATCH', 'valuesはString配列と一致する必要があります', `${path}.values`))
      }
      break
    case 'arrayPrimitive':
      if (typeof obj['arrayId'] !== 'string' || obj['arrayId'] === '') {
        issues.push(issue('STRUCTURE_INVALID', 'arrayIdは文字列で必須です', `${path}.arrayId`))
      }
      if (!isPrimitive(obj['primitive'])) {
        issues.push(issue('STRUCTURE_UNKNOWN_KIND', `未知のprimitiveです: ${String(obj['primitive'])}`, `${path}.primitive`))
      } else if (!isNumberArray(obj['values'], obj['primitive'] !== 'double')) {
        issues.push(
          issue('TYPE_MISMATCH', `valuesは${String(obj['primitive'])}配列と一致する必要があります`, `${path}.values`),
        )
      }
      break
    case 'streamOf':
      if (obj['elementTypeName'] !== 'String') {
        issues.push(
          issue('TYPE_MISMATCH', `Stream.ofの宣言型はStringのみ許可されます: ${String(obj['elementTypeName'])}`, `${path}.elementTypeName`),
        )
      }
      if (!isStringArray(obj['values'])) {
        issues.push(
          issue('TYPE_MISMATCH', '宣言したTypeRef（String）と一致しない値が含まれています', `${path}.values`),
        )
      }
      break
    case 'streamOfPrimitiveArrays': {
      if (!isPrimitive(obj['primitive'])) {
        issues.push(issue('STRUCTURE_UNKNOWN_KIND', `未知のprimitiveです: ${String(obj['primitive'])}`, `${path}.primitive`))
        break
      }
      const arrays = obj['arrays']
      const integer = obj['primitive'] !== 'double'
      if (!Array.isArray(arrays) || !arrays.every((a) => isNumberArray(a, integer))) {
        issues.push(
          issue('TYPE_MISMATCH', `arraysは${String(obj['primitive'])}[]の配列と一致する必要があります`, `${path}.arrays`),
        )
      }
      break
    }
    case 'nestedStringList':
      if (typeof obj['listId'] !== 'string' || obj['listId'] === '') {
        issues.push(issue('STRUCTURE_INVALID', 'listIdは文字列で必須です', `${path}.listId`))
      }
      if (!Array.isArray(obj['values']) || !(obj['values'] as unknown[]).every(isStringArray)) {
        issues.push(issue('TYPE_MISMATCH', 'valuesはList<List<String>>と一致する必要があります', `${path}.values`))
      }
      break
    case 'generate':
      if (!(ALLOWED_GENERATE_RULES as readonly string[]).includes(String(obj['ruleId']))) {
        issues.push(
          issue('STRUCTURE_UNKNOWN_KIND', `未知のgenerate rule IDです: ${String(obj['ruleId'])}`, `${path}.ruleId`),
        )
      }
      break
    case 'iterate2':
      if (typeof obj['seed'] !== 'number' || !Number.isInteger(obj['seed'])) {
        issues.push(issue('TYPE_MISMATCH', 'seedはint定数が必要です', `${path}.seed`))
      }
      issues.push(...checkOperator(obj['operator'], `${path}.operator`))
      break
    case 'iterate3': {
      if (typeof obj['seed'] !== 'number' || !Number.isInteger(obj['seed'])) {
        issues.push(issue('TYPE_MISMATCH', 'seedはint定数が必要です', `${path}.seed`))
      }
      const pred = obj['predicate']
      if (typeof pred !== 'object' || pred === null) {
        issues.push(issue('STRUCTURE_INVALID', 'predicateはオブジェクトが必要です', `${path}.predicate`))
      } else {
        const p = pred as Record<string, unknown>
        if (p['operator'] !== 'LTE' && p['operator'] !== 'LT') {
          issues.push(
            issue('STRUCTURE_UNKNOWN_KIND', `未知のpredicate operatorです: ${String(p['operator'])}`, `${path}.predicate.operator`),
          )
        }
        if (typeof p['value'] !== 'number' || !Number.isInteger(p['value'])) {
          issues.push(issue('TYPE_MISMATCH', 'predicate.valueはint定数が必要です', `${path}.predicate.value`))
        }
      }
      issues.push(...checkOperator(obj['operator'], `${path}.operator`))
      break
    }
    case 'range':
    case 'rangeClosed':
      if (typeof obj['from'] !== 'number' || !Number.isInteger(obj['from'])) {
        issues.push(issue('TYPE_MISMATCH', 'range境界fromはint定数が必要です', `${path}.from`))
      }
      if (typeof obj['to'] !== 'number' || !Number.isInteger(obj['to'])) {
        issues.push(issue('TYPE_MISMATCH', 'range境界toはint定数が必要です', `${path}.to`))
      }
      break
    case 'empty':
      if (obj['streamType'] !== 'object' && !isPrimitive(obj['streamType'])) {
        issues.push(
          issue('STRUCTURE_UNKNOWN_KIND', `未知のstreamTypeです: ${String(obj['streamType'])}`, `${path}.streamType`),
        )
      }
      if (typeof obj['elementTypeName'] !== 'string' || obj['elementTypeName'] === '') {
        issues.push(issue('STRUCTURE_INVALID', 'elementTypeNameは文字列で必須です', `${path}.elementTypeName`))
      }
      break
    default:
      return fail([issue('STRUCTURE_UNKNOWN_KIND', `未知のsource kindです: ${String(kind)}`, `${path}.kind`)])
  }
  if (issues.length > 0) return fail(issues)
  return ok(input as SourceDsl)
}

/** sourceが送出する要素のTypeRef */
export function sourceElementType(dsl: SourceDsl): TypeRef {
  switch (dsl.kind) {
    case 'collection':
      return { kind: 'object', name: 'Employee' }
    case 'arrayObject':
    case 'streamOf':
      return { kind: 'object', name: 'String' }
    case 'arrayPrimitive':
      return { kind: 'primitive', name: dsl.primitive }
    case 'streamOfPrimitiveArrays':
      return { kind: 'array', elementType: { kind: 'primitive', name: dsl.primitive } }
    case 'nestedStringList':
      return { kind: 'collection', container: 'List', elementType: { kind: 'object', name: 'String' } }
    case 'generate':
    case 'iterate2':
    case 'iterate3':
      return { kind: 'object', name: 'Integer' }
    case 'range':
    case 'rangeClosed':
      return { kind: 'primitive', name: 'int' }
    case 'empty':
      return dsl.streamType === 'object'
        ? { kind: 'object', name: dsl.elementTypeName }
        : { kind: 'primitive', name: dsl.streamType }
  }
}

/** sourceが返すStreamのTypeRef */
export function sourceStreamType(dsl: SourceDsl): TypeRef {
  switch (dsl.kind) {
    case 'arrayPrimitive':
      return { kind: 'primitiveStream', name: PRIMITIVE_STREAM_NAMES[dsl.primitive] }
    case 'range':
    case 'rangeClosed':
      return { kind: 'primitiveStream', name: 'IntStream' }
    case 'empty':
      return dsl.streamType === 'object'
        ? streamOf({ kind: 'object', name: dsl.elementTypeName })
        : { kind: 'primitiveStream', name: PRIMITIVE_STREAM_NAMES[dsl.streamType] }
    default:
      return streamOf(sourceElementType(dsl))
  }
}

export { WRAPPER_NAMES }
