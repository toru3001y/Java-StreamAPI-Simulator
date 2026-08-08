import type { Result, ValidationIssue } from '../types/result'
import { fail, issue, ok } from '../types/result'
import type { MapperDsl } from './mapperAst'
import type { TypeRef } from '../types/typeRef'
import { EMPLOYEE_FIELDS } from '../model/employee'
import { WRAPPER_NAMES, type PrimitiveName } from '../model/value'

/**
 * Mapper DSLの構造・型検証（Phase 2指示 §7.2）。
 * 未知kind、許可外field、型不一致、任意コードを拒否する。
 */
const PRIMITIVES = ['int', 'long', 'double'] as const

export function validateMapperStructure(input: unknown, path = 'mapper'): Result<MapperDsl> {
  if (typeof input !== 'object' || input === null) {
    return fail([issue('STRUCTURE_INVALID', 'mapperはオブジェクトが必要です', path)])
  }
  const obj = input as Record<string, unknown>
  const issues: ValidationIssue[] = []
  switch (obj['kind']) {
    case 'fieldAccess':
      if (typeof obj['field'] !== 'string' || obj['field'] === '') {
        issues.push(issue('STRUCTURE_INVALID', 'fieldは文字列で必須です', `${path}.field`))
      }
      break
    case 'toUpper':
      break
    case 'prefix':
      if (typeof obj['prefix'] !== 'string') {
        issues.push(issue('STRUCTURE_INVALID', 'prefixは文字列が必要です', `${path}.prefix`))
      }
      break
    case 'fieldToPrimitive':
      if (typeof obj['field'] !== 'string' || obj['field'] === '') {
        issues.push(issue('STRUCTURE_INVALID', 'fieldは文字列で必須です', `${path}.field`))
      }
      if (!(PRIMITIVES as readonly string[]).includes(String(obj['primitive']))) {
        issues.push(
          issue('STRUCTURE_UNKNOWN_KIND', `未知のprimitiveです: ${String(obj['primitive'])}`, `${path}.primitive`),
        )
      }
      break
    case 'listStream':
      break
    case 'arrayStream':
      if (!(PRIMITIVES as readonly string[]).includes(String(obj['primitive']))) {
        issues.push(
          issue('STRUCTURE_UNKNOWN_KIND', `未知のprimitiveです: ${String(obj['primitive'])}`, `${path}.primitive`),
        )
      }
      break
    default:
      return fail([issue('STRUCTURE_UNKNOWN_KIND', `未知のmapper kindです: ${String(obj['kind'])}`, `${path}.kind`)])
  }
  if (issues.length > 0) return fail(issues)
  return ok(input as MapperDsl)
}

function isEmployee(t: TypeRef): boolean {
  return t.kind === 'object' && t.name === 'Employee'
}

function isString(t: TypeRef): boolean {
  return t.kind === 'object' && t.name === 'String'
}

/** primitiveをwrapperのobject型へ変換（map(Employee::age)等のboxing） */
function boxIfPrimitive(t: TypeRef): TypeRef {
  if (t.kind === 'primitive' && t.name !== 'boolean') {
    return { kind: 'object', name: WRAPPER_NAMES[t.name as PrimitiveName] }
  }
  return t
}

/**
 * mapperの入力要素型から出力要素型を解決する。
 * flatMap系mapper（listStream / arrayStream）の出力はmapped Streamの要素型。
 */
export function resolveMapperOutputType(
  mapper: MapperDsl,
  inputType: TypeRef,
  path = 'mapper',
): Result<TypeRef> {
  switch (mapper.kind) {
    case 'fieldAccess': {
      if (!isEmployee(inputType)) {
        return fail([issue('TYPE_MISMATCH', 'fieldAccessはEmployee要素にのみ適用できます', path)])
      }
      const field = EMPLOYEE_FIELDS[mapper.field]
      if (!field) {
        return fail([issue('WHITELIST_FIELD', `Employeeに存在しないfieldです: ${mapper.field}`, `${path}.field`)])
      }
      return ok(boxIfPrimitive(field.javaType))
    }
    case 'toUpper':
      if (!isString(inputType)) {
        return fail([issue('TYPE_MISMATCH', 'toUpperはString要素にのみ適用できます', path)])
      }
      return ok(inputType)
    case 'prefix':
      if (inputType.kind !== 'primitive') {
        return fail([issue('TYPE_MISMATCH', 'prefixはprimitive要素にのみ適用できます', path)])
      }
      return ok({ kind: 'object', name: 'String' })
    case 'fieldToPrimitive': {
      if (!isEmployee(inputType)) {
        return fail([issue('TYPE_MISMATCH', 'fieldToPrimitiveはEmployee要素にのみ適用できます', path)])
      }
      const field = EMPLOYEE_FIELDS[mapper.field]
      if (!field) {
        return fail([issue('WHITELIST_FIELD', `Employeeに存在しないfieldです: ${mapper.field}`, `${path}.field`)])
      }
      if (!(field.javaType.kind === 'primitive' && field.javaType.name === mapper.primitive)) {
        return fail([
          issue('TYPE_MISMATCH', `field ${mapper.field}は${mapper.primitive}へ変換できません`, `${path}.field`),
        ])
      }
      return ok({ kind: 'primitive', name: mapper.primitive })
    }
    case 'listStream':
      if (!(inputType.kind === 'collection' && inputType.container === 'List')) {
        return fail([issue('TYPE_MISMATCH', 'listStreamはList要素にのみ適用できます', path)])
      }
      return ok(inputType.elementType)
    case 'arrayStream':
      if (
        !(
          inputType.kind === 'array' &&
          inputType.elementType.kind === 'primitive' &&
          inputType.elementType.name === mapper.primitive
        )
      ) {
        return fail([
          issue('TYPE_MISMATCH', `arrayStreamは${mapper.primitive}[]要素にのみ適用できます`, path),
        ])
      }
      return ok({ kind: 'primitive', name: mapper.primitive })
  }
}
