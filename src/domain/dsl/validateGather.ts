import type { Result, ValidationIssue } from '../types/result'
import { fail, issue, ok } from '../types/result'
import type { GatherAccumulationRule, GathererDsl } from './gatherAst'
import {
  GATHERER_DSL_KINDS,
  GATHER_ACCUMULATION_KINDS,
  GATHER_FIELD_PRIMITIVE,
  GATHER_FIELD_WHITELIST,
  GATHER_WINDOW_SIZE_MAX,
  GATHER_WINDOW_SIZE_MIN,
} from './gatherAst'
import { validateReductionIdentity } from './validateTerminal'
import type { TypeRef } from '../types/typeRef'
import { formatTypeRef, listOf } from '../types/typeRef'
import type { ReductionIdentity } from './terminalAst'

/**
 * Gatherer DSLの構造検証・ホワイトリスト検証・出力型解決（Phase 7指示 §7.4・§7.5）。
 *
 * Phase 4 terminal DSL（`validateTerminal.ts`）・Phase 5 Collector AST（`validateCollector.ts`）と
 * 同じclosed schema方式（kind → 許可キー集合 → ホワイトリスト → 型・値域）。
 * 任意Javaコード文字列・関数本文文字列は追加フィールドとしても受け付けない。
 *
 * `<Identity>`の値検証は既存`validateReductionIdentity`へ委譲する（挙動を変えない共通化。
 * `terminalAst.ts`は無変更で、型はtype-only importのみ。v0.9 §8.2の許容範囲）。
 */

/** variantごとの許可キー集合（closed schema） */
const GATHERER_ALLOWED_KEYS: Readonly<Record<string, readonly string[]>> = {
  windowFixed: ['kind', 'size'],
  windowSliding: ['kind', 'size'],
  scan: ['kind', 'initial', 'accumulation'],
  fold: ['kind', 'initial', 'accumulation'],
}

const ACCUMULATION_ALLOWED_KEYS: Readonly<Record<string, readonly string[]>> = {
  numericSum: ['kind'],
  stringConcat: ['kind'],
  employeeFieldSum: ['kind', 'field'],
}

/** closed schema検証の共通処理: 許可キー集合に含まれない実入力キーをissue化する */
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

export function validateGatherAccumulation(
  input: unknown,
  path = 'accumulation',
): Result<GatherAccumulationRule> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail([issue('STRUCTURE_INVALID', 'accumulationはオブジェクトが必要です', path)])
  }
  const obj = input as Record<string, unknown>
  const kind = String(obj['kind'])
  if (!(GATHER_ACCUMULATION_KINDS as readonly string[]).includes(kind)) {
    return fail([
      issue('STRUCTURE_UNKNOWN_KIND', `未知のaccumulation kindです: ${kind}`, `${path}.kind`),
    ])
  }
  const issues = unknownFieldIssues(obj, ACCUMULATION_ALLOWED_KEYS[kind] ?? ['kind'], path)
  if (kind === 'employeeFieldSum') {
    const field = String(obj['field'])
    // Gatherer専用のfieldホワイトリスト（Terminal DSL側は参照も変更もしない）
    if (!(GATHER_FIELD_WHITELIST as readonly string[]).includes(field)) {
      issues.push(
        issue(
          'WHITELIST_FIELD',
          `Gathererで許可されていないfieldです: ${field}`,
          `${path}.field`,
        ),
      )
    }
  }
  if (issues.length > 0) return fail(issues)
  return ok(input as GatherAccumulationRule)
}

/** windowSizeの構造・値域検証（§7.4-3。上限超過だけをGATHER_SIZE_LIMITへ分離する） */
function validateWindowSize(value: unknown, path: string): ValidationIssue[] {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return [issue('STRUCTURE_INVALID', 'window sizeは有限の数値が必要です', path)]
  }
  if (!Number.isInteger(value)) {
    return [issue('STRUCTURE_INVALID', `window sizeはint定数が必要です: ${value}`, path)]
  }
  if (value < GATHER_WINDOW_SIZE_MIN) {
    // JDK実仕様: windowSizeが1未満のときIllegalArgumentException（v0.9 §3.2）
    return [
      issue(
        'STRUCTURE_INVALID',
        `window sizeは${GATHER_WINDOW_SIZE_MIN}以上が必要です: ${value}（JDKでもIllegalArgumentExceptionになります）`,
        path,
      ),
    ]
  }
  if (value > GATHER_WINDOW_SIZE_MAX) {
    return [
      issue(
        'GATHER_SIZE_LIMIT',
        `window sizeは教材上限の${GATHER_WINDOW_SIZE_MAX}以下が必要です: ${value}`,
        path,
      ),
    ]
  }
  return []
}

export function validateGathererStructure(input: unknown, path = 'gatherer'): Result<GathererDsl> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail([issue('STRUCTURE_INVALID', 'gathererはオブジェクトが必要です', path)])
  }
  const obj = input as Record<string, unknown>
  const kind = String(obj['kind'])
  if (!(GATHERER_DSL_KINDS as readonly string[]).includes(kind)) {
    return fail([
      issue('STRUCTURE_UNKNOWN_KIND', `未知のgatherer kindです: ${kind}`, `${path}.kind`),
    ])
  }
  const issues = unknownFieldIssues(obj, GATHERER_ALLOWED_KEYS[kind] ?? ['kind'], path)
  if (kind === 'windowFixed' || kind === 'windowSliding') {
    if (!('size' in obj)) {
      issues.push(issue('STRUCTURE_INVALID', `${kind}にはsizeが必要です`, `${path}.size`))
    } else {
      issues.push(...validateWindowSize(obj['size'], `${path}.size`))
    }
  } else {
    if (!('initial' in obj)) {
      issues.push(issue('STRUCTURE_INVALID', `${kind}にはinitialが必要です`, `${path}.initial`))
    } else {
      // identityの値検証は既存実装へ委譲する（受理範囲を変えない）
      const identity = validateReductionIdentity(obj['initial'], `${path}.initial`)
      if (!identity.ok) issues.push(...identity.issues)
    }
    if (!('accumulation' in obj)) {
      issues.push(
        issue('STRUCTURE_INVALID', `${kind}にはaccumulationが必要です`, `${path}.accumulation`),
      )
    } else {
      const rule = validateGatherAccumulation(obj['accumulation'], `${path}.accumulation`)
      if (!rule.ok) issues.push(...rule.issues)
    }
  }
  if (issues.length > 0) return fail(issues)
  return ok(input as GathererDsl)
}

/**
 * 型適合表（v0.9 §8.3）に基づく入力型検証と出力要素型の解決。
 *
 * `Stream.gather`は`Stream<T>`にのみ存在し、型引数T / Rは参照型（boxed型）である。
 * primitive Stream（IntStream等）を入力とするgatherは拒否し、boxed()経由を促す。
 *
 * @param inputStreamType gatherノードへの入力Stream型
 * @returns gatherの**出力要素型**（Streamで包む前）
 */
export function resolveGathererOutputElementType(
  dsl: GathererDsl,
  inputStreamType: TypeRef,
  path = 'gatherer',
): Result<TypeRef> {
  if (inputStreamType.kind === 'primitiveStream') {
    return fail([
      issue(
        'TYPE_MISMATCH',
        `Stream.gatherはobject Streamにのみ存在します（型引数T / Rは参照型）。${formatTypeRef(inputStreamType)}からはboxed()で変換してください`,
        path,
      ),
    ])
  }
  if (inputStreamType.kind !== 'stream') {
    return fail([
      issue('TYPE_MISMATCH', `gatherはStreamの入力が必要です: ${formatTypeRef(inputStreamType)}`, path),
    ])
  }
  const elementType = inputStreamType.elementType
  if (dsl.kind === 'windowFixed' || dsl.kind === 'windowSliding') {
    // window系のRはList<T>（unmodifiable List。v0.9 §3.2）
    return ok(listOf(elementType))
  }
  return resolveAccumulationType(dsl.initial, dsl.accumulation, elementType, path)
}

/** 累積系（scan / fold）の型適合検証と出力要素型（boxed型）の解決 */
function resolveAccumulationType(
  initial: ReductionIdentity,
  accumulation: GatherAccumulationRule,
  elementType: TypeRef,
  path: string,
): Result<TypeRef> {
  const elementLabel = formatTypeRef(elementType)
  switch (accumulation.kind) {
    case 'stringConcat': {
      if (!(elementType.kind === 'object' && elementType.name === 'String')) {
        return fail([
          issue(
            'TYPE_MISMATCH',
            `stringConcatはStream<String>にのみ適用できます（実際: ${elementLabel}）`,
            path,
          ),
        ])
      }
      if (initial.type !== 'string') {
        return fail([
          issue(
            'TYPE_MISMATCH',
            `stringConcatのinitial.typeはstringが必要です（実際: ${initial.type}）`,
            `${path}.initial.type`,
          ),
        ])
      }
      return ok({ kind: 'object', name: 'String' })
    }
    case 'numericSum': {
      // T / RはInteger / Long / Doubleのいずれか（primitiveは§8.3の対象外）
      const expected = NUMERIC_INITIAL_BY_WRAPPER[wrapperNameOf(elementType) ?? '']
      if (!expected) {
        return fail([
          issue(
            'TYPE_MISMATCH',
            `numericSumはStream<Integer> / Stream<Long> / Stream<Double>にのみ適用できます（実際: ${elementLabel}）`,
            path,
          ),
        ])
      }
      if (initial.type !== expected) {
        return fail([
          issue(
            'TYPE_MISMATCH',
            `${elementLabel}要素のnumericSumではinitial.typeは${expected}が必要です（実際: ${initial.type}）`,
            `${path}.initial.type`,
          ),
        ])
      }
      // Rは入力Tと同じboxed型
      return ok(elementType)
    }
    case 'employeeFieldSum': {
      if (!(elementType.kind === 'object' && elementType.name === 'Employee')) {
        return fail([
          issue(
            'TYPE_MISMATCH',
            `employeeFieldSumはStream<Employee>にのみ適用できます（実際: ${elementLabel}）`,
            path,
          ),
        ])
      }
      const primitive = GATHER_FIELD_PRIMITIVE[accumulation.field]
      if (initial.type !== primitive) {
        return fail([
          issue(
            'TYPE_MISMATCH',
            `${accumulation.field}のemployeeFieldSumではinitial.typeは${primitive}が必要です（実際: ${initial.type}）`,
            `${path}.initial.type`,
          ),
        ])
      }
      // Rはfieldに対応するboxed型（age → Integer、salary → Long、evaluation → Double）
      return ok({ kind: 'object', name: WRAPPER_BY_PRIMITIVE[primitive] })
    }
  }
}

const WRAPPER_BY_PRIMITIVE: Readonly<Record<'int' | 'long' | 'double', string>> = {
  int: 'Integer',
  long: 'Long',
  double: 'Double',
}

/** wrapper型名 → 対応するinitial.typeタグ（v0.9 §8.3） */
const NUMERIC_INITIAL_BY_WRAPPER: Readonly<Record<string, 'int' | 'long' | 'double' | undefined>> = {
  Integer: 'int',
  Long: 'long',
  Double: 'double',
}

function wrapperNameOf(type: TypeRef): string | null {
  return type.kind === 'object' ? type.name : null
}
