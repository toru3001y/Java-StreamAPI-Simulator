import type { Result, ValidationIssue } from '../types/result'
import { fail, issue, ok } from '../types/result'
import type { DslPredicate } from './ast'
import type {
  ClassifierDsl,
  CollectTripleDsl,
  CollectorDsl,
  ToMapMergeValueWrapper,
  ToMapValueDsl,
} from './collectorAst'
import {
  TO_MAP_MERGE_IDS,
  TO_MAP_MERGE_META,
  TO_MAP_VALUE_KINDS,
  CLASSIFIER_DEPARTMENT_FIELDS,
  CLASSIFIER_DSL_KINDS,
  CLASSIFIER_EMPLOYEE_FIELDS,
  COLLECTOR_DSL_KINDS,
  COLLECTOR_FINISHER_IDS,
  COLLECTOR_MAP_FACTORY_IDS,
  COLLECTOR_MAP_FACTORY_META,
  COLLECTOR_MAX_DEPTH,
  COLLECTOR_NUMERIC_FIELDS,
  COLLECTOR_NUMERIC_FIELD_BY_PRIMITIVE,
  COLLECTOR_NUMERIC_KINDS,
  COLLECTOR_SUPPLIER_IDS,
  COLLECT_TRIPLE_ID_COMBINATIONS,
  COMPARABLE_CLASSIFIER_KINDS,
  TEEING_MERGER_IDS,
  TEEING_MERGER_RECORDS,
  numericKindFamily,
  numericKindPrimitive,
} from './collectorAst'
import { EMPLOYEE_FIELDS } from '../model/employee'
import { WRAPPER_NAMES, type PrimitiveName } from '../model/value'
import type { TypeRef } from '../types/typeRef'
import {
  formatTypeRef,
  listOf,
  mapOf,
  optionalOf,
  setOf,
  typeRefEquals,
  TYPE_BOOLEAN_WRAPPER,
  TYPE_DEPARTMENT,
  TYPE_STRING,
} from '../types/typeRef'
import { validateComparatorStructure } from './validateComparator'
import { resolveMapperOutputType, validateMapperStructure } from './validateMapper'
import { ALLOWED_OPERATORS } from './ast'
import { validateStructure, validateTypes, validateWhitelist } from './validate'
import { validateReductionStructure } from './validateTerminal'

/**
 * Collector DSLの構造検証（Phase 5指示 §7.1）。
 *
 * Phase 4 terminal DSL（`validateTerminal.ts`）と同じclosed schema方式:
 * variantごとの許可キー集合、kind / ID / fieldのホワイトリスト、許可外キーの
 * `STRUCTURE_INVALID`拒否（例外は送出せず構造化issueで返す）、再帰ノードの再帰検証。
 *
 * 任意Javaコード文字列・関数本文文字列・JavaScript式は追加フィールドとしても受け付けない。
 */

/** numeric集計variantの許可キー（kind + field） */
const NUMERIC_ALLOWED_KEYS: readonly string[] = ['kind', 'field']

/** variantごとの許可キー集合（closed schema） */
const COLLECTOR_ALLOWED_KEYS: Readonly<Record<string, readonly string[]>> = {
  toList: ['kind'],
  toSet: ['kind'],
  toCollection: ['kind', 'supplierId'],
  joining: ['kind', 'delimiter', 'prefix', 'suffix'],
  counting: ['kind'],
  ...Object.fromEntries(COLLECTOR_NUMERIC_KINDS.map((kind) => [kind, NUMERIC_ALLOWED_KEYS])),
  minBy: ['kind', 'comparator'],
  maxBy: ['kind', 'comparator'],
  reducing: ['kind', 'reduction'],
  mapping: ['kind', 'mapper', 'downstream'],
  filtering: ['kind', 'predicate', 'downstream'],
  flatMapping: ['kind', 'mapper', 'downstream'],
  collectingAndThen: ['kind', 'downstream', 'finisherId'],
  groupingBy: ['kind', 'classifier', 'mapFactoryId', 'downstream'],
  partitioningBy: ['kind', 'predicate', 'downstream'],
  teeing: ['kind', 'left', 'right', 'mergerId'],
  // Phase 8: toMapは5キー厳密（引数省略はoptional keyではなく明示nullで表す。v0.11 §8）
  toMap: ['kind', 'keyMapper', 'valueMapper', 'mergeFunctionId', 'mapFactoryId'],
  // Phase 11: unmodifiable系（v0.14 §2.2）。toUnmodifiableMapは`mapFactoryId`キーを許可集合に
  // 含めない（JavaにmapFactory版overloadが存在しないため、存在すれば構造検証で拒否する）
  toUnmodifiableList: ['kind'],
  toUnmodifiableSet: ['kind'],
  toUnmodifiableMap: ['kind', 'keyMapper', 'valueMapper', 'mergeFunctionId'],
}

/** ToMapValueDslのvariantごとの許可キー集合（closed schema。指示§7.3-1） */
const TO_MAP_VALUE_ALLOWED_KEYS: Readonly<Record<string, readonly string[]>> = {
  identity: ['kind'],
  fieldAccess: ['kind', 'field'],
}

const CLASSIFIER_ALLOWED_KEYS: Readonly<Record<string, readonly string[]>> = {
  employeeField: ['kind', 'field'],
  employeeDepartment: ['kind'],
  departmentField: ['kind', 'field'],
}

const STRING_CONST_ALLOWED_KEYS: readonly string[] = ['type', 'value']

const COLLECT_TRIPLE_ALLOWED_KEYS: readonly string[] = [
  'kind',
  'supplierId',
  'accumulatorId',
  'combinerId',
]

/**
 * closed schema検証の共通処理: 許可キー集合に含まれない実入力キーを
 * ValidationIssueとして返す（例外は送出しない）。パスは `collector.functionBody` の形式。
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

/** 型付きString定数（joiningのdelimiter / prefix / suffix）の検証 */
function stringConstIssues(input: unknown, path: string): ValidationIssue[] {
  if (typeof input !== 'object' || input === null) {
    return [issue('STRUCTURE_INVALID', 'String定数はオブジェクトが必要です', path)]
  }
  const obj = input as Record<string, unknown>
  const issues = unknownFieldIssues(obj, STRING_CONST_ALLOWED_KEYS, path)
  if (obj['type'] !== 'string') {
    issues.push(
      issue('STRUCTURE_UNKNOWN_KIND', `未知の定数型です: ${String(obj['type'])}`, `${path}.type`),
    )
  }
  if (typeof obj['value'] !== 'string') {
    issues.push(issue('STRUCTURE_INVALID', 'String定数のvalueは文字列が必要です', `${path}.value`))
  }
  return issues
}

/** groupingBy classifierの検証（許可3形） */
export function validateClassifierStructure(
  input: unknown,
  path = 'classifier',
): Result<ClassifierDsl> {
  if (typeof input !== 'object' || input === null) {
    return fail([issue('STRUCTURE_INVALID', 'classifierはオブジェクトが必要です', path)])
  }
  const obj = input as Record<string, unknown>
  const kind = String(obj['kind'])
  if (!(CLASSIFIER_DSL_KINDS as readonly string[]).includes(kind)) {
    return fail([
      issue('STRUCTURE_UNKNOWN_KIND', `未知のclassifier kindです: ${kind}`, `${path}.kind`),
    ])
  }
  const issues = unknownFieldIssues(obj, CLASSIFIER_ALLOWED_KEYS[kind] ?? ['kind'], path)
  if (kind === 'employeeField') {
    if (!(CLASSIFIER_EMPLOYEE_FIELDS as readonly string[]).includes(String(obj['field']))) {
      issues.push(
        issue(
          'WHITELIST_FIELD',
          `classifierで許可されていないEmployee fieldです: ${String(obj['field'])}`,
          `${path}.field`,
        ),
      )
    }
  }
  if (kind === 'departmentField') {
    if (!(CLASSIFIER_DEPARTMENT_FIELDS as readonly string[]).includes(String(obj['field']))) {
      issues.push(
        issue(
          'WHITELIST_FIELD',
          `classifierで許可されていないDepartment fieldです: ${String(obj['field'])}`,
          `${path}.field`,
        ),
      )
    }
  }
  if (issues.length > 0) return fail(issues)
  return ok(input as ClassifierDsl)
}

/**
 * toMapのvalueMapper（`ToMapValueDsl`）の構造検証（指示§7.3-7）。
 *
 * **専用実装**であり、`validateMapper.ts`の許可範囲は一切参照・変更しない。
 * `fieldAccess`のfieldホワイトリストは既存`EMPLOYEE_FIELDS`参照と同一範囲とする。
 */
export function validateToMapValueStructure(
  input: unknown,
  path = 'valueMapper',
): Result<ToMapValueDsl> {
  if (typeof input !== 'object' || input === null) {
    return fail([issue('STRUCTURE_INVALID', 'valueMapperはオブジェクトが必要です', path)])
  }
  const obj = input as Record<string, unknown>
  const kind = String(obj['kind'])
  if (!(TO_MAP_VALUE_KINDS as readonly string[]).includes(kind)) {
    return fail([
      issue(
        'STRUCTURE_UNKNOWN_KIND',
        `toMapのvalueMapperで許可されていないkindです: ${kind}（許可: ${TO_MAP_VALUE_KINDS.join(' / ')}）`,
        `${path}.kind`,
      ),
    ])
  }
  const issues = unknownFieldIssues(obj, TO_MAP_VALUE_ALLOWED_KEYS[kind] ?? ['kind'], path)
  if (kind === 'fieldAccess') {
    const field = String(obj['field'])
    if (!(field in EMPLOYEE_FIELDS)) {
      issues.push(
        issue('WHITELIST_FIELD', `Employeeに存在しないfieldです: ${field}`, `${path}.field`),
      )
    }
  }
  if (issues.length > 0) return fail(issues)
  return ok(input as ToMapValueDsl)
}

/**
 * toMapのvalueMapper出力型（値型U）を解決する（指示§7.3-6）。
 * `identity`はU = 入力要素型（Employee）。`fieldAccess`は既存`resolveMapperOutputType`を
 * 流用する（primitive fieldはwrapper型へboxing済み。`salary` → `Long`等）。
 */
export function resolveToMapValueType(
  dsl: ToMapValueDsl,
  inputType: TypeRef,
  path = 'valueMapper',
): Result<TypeRef> {
  if (dsl.kind === 'identity') return ok(inputType)
  return resolveMapperOutputType({ kind: 'fieldAccess', field: dsl.field }, inputType, path)
}

// ---- Collectorへ埋め込む既存DSLのclosed schema（指示§7.1） ----
//
// 既存の`validateMapperStructure` / `validateStructure` / `validateComparatorStructure`は
// 余分なキーを拒否しない（Phase 1〜4のslot検証の互換のため変更しない）。
// Collector AST内に埋め込まれるDSLについては、「任意Javaコード文字列・関数本文文字列を
// 追加フィールドとしても受け付けない」契約を満たすため、ここで許可キー集合を明示検証する。

const MAPPER_ALLOWED_KEYS: Readonly<Record<string, readonly string[]>> = {
  fieldAccess: ['kind', 'field'],
  toUpper: ['kind'],
  prefix: ['kind', 'prefix'],
  fieldToPrimitive: ['kind', 'field', 'primitive'],
  listStream: ['kind'],
  arrayStream: ['kind', 'primitive'],
}

const PREDICATE_ALLOWED_KEYS: Readonly<Record<string, readonly string[]>> = {
  fieldCompare: ['kind', 'field', 'operator', 'value'],
  currentValueCompare: ['kind', 'operator', 'value'],
}

const LITERAL_ALLOWED_KEYS: readonly string[] = ['type', 'value']

const COMPARATOR_ALLOWED_KEYS: Readonly<Record<string, readonly string[]>> = {
  natural: ['kind'],
  employeeKeys: ['kind', 'keys'],
}

const COMPARATOR_KEY_ALLOWED_KEYS: readonly string[] = ['field', 'direction']

/** kindを持つ埋込みDSLのclosed schema検証（kind不明の場合は委譲先の検証に任せる） */
function embeddedClosedSchemaIssues(
  input: unknown,
  allowedKeysByKind: Readonly<Record<string, readonly string[]>>,
  path: string,
): ValidationIssue[] {
  if (typeof input !== 'object' || input === null) return []
  const obj = input as Record<string, unknown>
  const allowed = allowedKeysByKind[String(obj['kind'])]
  if (!allowed) return []
  return unknownFieldIssues(obj, allowed, path)
}

/** Collector内部mapperのclosed schema検証 */
function collectorMapperIssues(input: unknown, path: string): ValidationIssue[] {
  return [
    ...delegateIssues(validateMapperStructure(input, path)),
    ...embeddedClosedSchemaIssues(input, MAPPER_ALLOWED_KEYS, path),
  ]
}

/** Collector内部Comparatorのclosed schema検証（keys要素も対象） */
function collectorComparatorIssues(input: unknown, path: string): ValidationIssue[] {
  const issues = [
    ...delegateIssues(validateComparatorStructure(input, path)),
    ...embeddedClosedSchemaIssues(input, COMPARATOR_ALLOWED_KEYS, path),
  ]
  if (typeof input === 'object' && input !== null) {
    const keys = (input as Record<string, unknown>)['keys']
    if (Array.isArray(keys)) {
      keys.forEach((key, i) => {
        if (typeof key !== 'object' || key === null) return
        issues.push(
          ...unknownFieldIssues(
            key as Record<string, unknown>,
            COMPARATOR_KEY_ALLOWED_KEYS,
            `${path}.keys.${i}`,
          ),
        )
      })
    }
  }
  return issues
}

/**
 * Collector内部Predicate（filtering / partitioningBy）の構造 + ホワイトリスト検証。
 * Collector内部のPredicateはtemplate slotではないため、`allowedDslProfile`では絞られない。
 * ここでkind / field / operatorを明示的にホワイトリスト検証する（任意operatorの混入を防ぐ）。
 */
function collectorPredicateIssues(input: unknown, path: string): ValidationIssue[] {
  const structure = validateStructure(input, path)
  if (!structure.ok) return [...structure.issues]
  const issues = [...embeddedClosedSchemaIssues(input, PREDICATE_ALLOWED_KEYS, path)]
  // literal（value）のclosed schemaも検証する（javaCode等の混入を拒否する）
  if (typeof input === 'object' && input !== null) {
    const value = (input as Record<string, unknown>)['value']
    if (typeof value === 'object' && value !== null) {
      issues.push(
        ...unknownFieldIssues(value as Record<string, unknown>, LITERAL_ALLOWED_KEYS, `${path}.value`),
      )
    }
  }
  const whitelisted = validateWhitelist(
    structure.value,
    {
      predicateKinds: COLLECTOR_PREDICATE_KINDS,
      allowedFields: COLLECTOR_PREDICATE_FIELDS,
      allowedOperators: ALLOWED_OPERATORS,
    },
    path,
  )
  if (!whitelisted.ok) issues.push(...whitelisted.issues)
  return issues
}

/** Collector内部Predicateで許可するPredicate kind */
const COLLECTOR_PREDICATE_KINDS: readonly string[] = ['fieldCompare', 'currentValueCompare']

/** Collector内部Predicateで許可するEmployee field（評価可能な数値field） */
const COLLECTOR_PREDICATE_FIELDS: readonly string[] = ['age', 'salary', 'evaluation']

/** 入れ子Collectorを再帰検証し、issueだけを返す（親が蓄積する） */
function nestedCollectorIssues(input: unknown, path: string, depth: number): ValidationIssue[] {
  const result = validateCollectorStructure(input, path, depth)
  return result.ok ? [] : [...result.issues]
}

/** 既存DSLの構造検証を呼び出し、issueだけを返す */
function delegateIssues(result: Result<unknown>): ValidationIssue[] {
  return result.ok ? [] : [...result.issues]
}

/**
 * Collector ASTの構造検証。`depth`はrootを1とする入れ子の深さ（教材制約の上限は
 * `COLLECTOR_MAX_DEPTH`）。呼び出し側は既定値のまま使用する。
 */
export function validateCollectorStructure(
  input: unknown,
  path = 'collector',
  depth = 1,
): Result<CollectorDsl> {
  if (depth > COLLECTOR_MAX_DEPTH) {
    return fail([
      issue(
        'COLLECTOR_DEPTH',
        `Collectorの入れ子は${COLLECTOR_MAX_DEPTH}段までです（教材制約）`,
        path,
      ),
    ])
  }
  if (typeof input !== 'object' || input === null) {
    return fail([issue('STRUCTURE_INVALID', 'collectorはオブジェクトが必要です', path)])
  }
  const obj = input as Record<string, unknown>
  const kind = String(obj['kind'])
  if (!(COLLECTOR_DSL_KINDS as readonly string[]).includes(kind)) {
    return fail([
      issue('STRUCTURE_UNKNOWN_KIND', `未知のcollector kindです: ${kind}`, `${path}.kind`),
    ])
  }
  const issues = unknownFieldIssues(obj, COLLECTOR_ALLOWED_KEYS[kind] ?? ['kind'], path)

  if (kind === 'toCollection') {
    if (!(COLLECTOR_SUPPLIER_IDS as readonly string[]).includes(String(obj['supplierId']))) {
      issues.push(
        issue(
          'WHITELIST_KIND',
          `許可されていないコンテナsupplier IDです: ${String(obj['supplierId'])}`,
          `${path}.supplierId`,
        ),
      )
    }
  }

  if (kind === 'joining') {
    const delimiter = obj['delimiter']
    const prefix = obj['prefix']
    const suffix = obj['suffix']
    if (delimiter !== null) issues.push(...stringConstIssues(delimiter, `${path}.delimiter`))
    if (prefix !== null) issues.push(...stringConstIssues(prefix, `${path}.prefix`))
    if (suffix !== null) issues.push(...stringConstIssues(suffix, `${path}.suffix`))
    // overloadの組合せ: 引数なし（全null） / delimiter単独 / 3引数のみを許可する
    if ((prefix === null) !== (suffix === null)) {
      issues.push(
        issue(
          'TYPE_MISMATCH',
          'joiningのprefixとsuffixは両方指定が必要です（3引数overload）',
          `${path}.prefix`,
        ),
      )
    }
    if (delimiter === null && prefix !== null) {
      issues.push(
        issue(
          'TYPE_MISMATCH',
          'joiningのprefix / suffixを使う場合はdelimiterが必要です',
          `${path}.delimiter`,
        ),
      )
    }
  }

  if ((COLLECTOR_NUMERIC_KINDS as readonly string[]).includes(kind)) {
    const field = String(obj['field'])
    if (!(COLLECTOR_NUMERIC_FIELDS as readonly string[]).includes(field)) {
      issues.push(
        issue(
          'WHITELIST_FIELD',
          `数値集計Collectorで許可されていないfieldです: ${field}`,
          `${path}.field`,
        ),
      )
    } else {
      const primitive = numericKindPrimitive(kind as (typeof COLLECTOR_NUMERIC_KINDS)[number])
      const expected = COLLECTOR_NUMERIC_FIELD_BY_PRIMITIVE[primitive]
      if (field !== expected) {
        issues.push(
          issue(
            'TYPE_MISMATCH',
            `${kind}のfieldは${expected}（${primitive.toLowerCase()}型）が必要です: ${field}`,
            `${path}.field`,
          ),
        )
      }
    }
  }

  if (kind === 'minBy' || kind === 'maxBy') {
    issues.push(...collectorComparatorIssues(obj['comparator'], `${path}.comparator`))
  }

  if (kind === 'reducing') {
    issues.push(
      ...delegateIssues(validateReductionStructure(obj['reduction'], `${path}.reduction`)),
    )
  }

  if (kind === 'mapping' || kind === 'flatMapping') {
    issues.push(...collectorMapperIssues(obj['mapper'], `${path}.mapper`))
    issues.push(...nestedCollectorIssues(obj['downstream'], `${path}.downstream`, depth + 1))
  }

  if (kind === 'filtering') {
    issues.push(...collectorPredicateIssues(obj['predicate'], `${path}.predicate`))
    issues.push(...nestedCollectorIssues(obj['downstream'], `${path}.downstream`, depth + 1))
  }

  if (kind === 'collectingAndThen') {
    if (!(COLLECTOR_FINISHER_IDS as readonly string[]).includes(String(obj['finisherId']))) {
      issues.push(
        issue(
          'WHITELIST_KIND',
          `許可されていないfinisher IDです: ${String(obj['finisherId'])}`,
          `${path}.finisherId`,
        ),
      )
    }
    issues.push(...nestedCollectorIssues(obj['downstream'], `${path}.downstream`, depth + 1))
  }

  if (kind === 'groupingBy') {
    const classifierResult = validateClassifierStructure(obj['classifier'], `${path}.classifier`)
    issues.push(...delegateIssues(classifierResult))
    const mapFactoryId = obj['mapFactoryId']
    if (mapFactoryId !== null) {
      if (!(COLLECTOR_MAP_FACTORY_IDS as readonly string[]).includes(String(mapFactoryId))) {
        issues.push(
          issue(
            'WHITELIST_KIND',
            `許可されていないmapFactory IDです: ${String(mapFactoryId)}`,
            `${path}.mapFactoryId`,
          ),
        )
      } else if (classifierResult.ok) {
        // ComparatorなしのTreeMapは非Comparableキー（Department record）と組み合わせられない。
        // Java SE 25 TreeMap(): "All keys inserted into the map must implement the Comparable
        // interface." のため、この組合せだけを事前拒否する（指示§7.1）
        const meta = COLLECTOR_MAP_FACTORY_META[
          String(mapFactoryId) as keyof typeof COLLECTOR_MAP_FACTORY_META
        ]
        const comparableKey = COMPARABLE_CLASSIFIER_KINDS.includes(classifierResult.value.kind)
        if (meta?.jdkOrdered && !comparableKey) {
          issues.push(
            issue(
              'TYPE_MISMATCH',
              `${String(mapFactoryId)}（Comparatorなし）はComparableでないキー（${classifierResult.value.kind}）と組み合わせられません`,
              `${path}.mapFactoryId`,
            ),
          )
        }
      }
    }
    if (obj['downstream'] !== null) {
      issues.push(...nestedCollectorIssues(obj['downstream'], `${path}.downstream`, depth + 1))
    }
  }

  if (kind === 'partitioningBy') {
    issues.push(...collectorPredicateIssues(obj['predicate'], `${path}.predicate`))
    if (obj['downstream'] !== null) {
      issues.push(...nestedCollectorIssues(obj['downstream'], `${path}.downstream`, depth + 1))
    }
  }

  // ---- Phase 8: toMap（v0.11 §8.1、指示§7.3） ----
  if (kind === 'toMap') {
    issues.push(...delegateIssues(validateClassifierStructure(obj['keyMapper'], `${path}.keyMapper`)))
    issues.push(
      ...delegateIssues(validateToMapValueStructure(obj['valueMapper'], `${path}.valueMapper`)),
    )
    const mergeFunctionId = obj['mergeFunctionId']
    if (mergeFunctionId !== null) {
      if (!(TO_MAP_MERGE_IDS as readonly string[]).includes(String(mergeFunctionId))) {
        issues.push(
          issue(
            'WHITELIST_KIND',
            `許可されていないtoMapのmergeFunction IDです: ${String(mergeFunctionId)}（許可: ${TO_MAP_MERGE_IDS.join(' / ')}）`,
            `${path}.mergeFunctionId`,
          ),
        )
      }
    }
    const mapFactoryId = obj['mapFactoryId']
    if (mapFactoryId !== null) {
      if (!(COLLECTOR_MAP_FACTORY_IDS as readonly string[]).includes(String(mapFactoryId))) {
        issues.push(
          issue(
            'WHITELIST_KIND',
            `許可されていないmapFactory IDです: ${String(mapFactoryId)}`,
            `${path}.mapFactoryId`,
          ),
        )
      }
      // overload組合せ: mapFactoryあり かつ mergeFunctionなしに対応するJava overloadは存在しない
      // （toMapのoverloadは2引数 / 3引数 / 4引数の3形のみ。v0.11 §2.1・§8.1）
      if (mergeFunctionId === null) {
        issues.push(
          issue(
            'STRUCTURE_INVALID',
            'toMapにmapFactoryを指定する場合はmergeFunctionが必要です（keyMapper, valueMapper, mapFactoryの3引数overloadはJavaに存在しません）',
            `${path}.mergeFunctionId`,
          ),
        )
      }
    }
  }

  // ---- Phase 11: toUnmodifiableMap（v0.14 §2.2） ----
  // keyMapper / valueMapper / mergeFunctionIdの検証は既存toMapの検証を変更なしで流用する。
  // mapFactoryIdキーの拒否はclosed schema（COLLECTOR_ALLOWED_KEYS）が担う。
  if (kind === 'toUnmodifiableMap') {
    issues.push(...delegateIssues(validateClassifierStructure(obj['keyMapper'], `${path}.keyMapper`)))
    issues.push(
      ...delegateIssues(validateToMapValueStructure(obj['valueMapper'], `${path}.valueMapper`)),
    )
    const mergeFunctionId = obj['mergeFunctionId']
    if (mergeFunctionId !== null) {
      if (!(TO_MAP_MERGE_IDS as readonly string[]).includes(String(mergeFunctionId))) {
        issues.push(
          issue(
            'WHITELIST_KIND',
            `許可されていないtoMapのmergeFunction IDです: ${String(mergeFunctionId)}（許可: ${TO_MAP_MERGE_IDS.join(' / ')}）`,
            `${path}.mergeFunctionId`,
          ),
        )
      }
    }
  }

  if (kind === 'teeing') {
    if (!(TEEING_MERGER_IDS as readonly string[]).includes(String(obj['mergerId']))) {
      issues.push(
        issue(
          'WHITELIST_KIND',
          `許可されていないteeing merger IDです: ${String(obj['mergerId'])}`,
          `${path}.mergerId`,
        ),
      )
    }
    issues.push(...nestedCollectorIssues(obj['left'], `${path}.left`, depth + 1))
    issues.push(...nestedCollectorIssues(obj['right'], `${path}.right`, depth + 1))
  }

  if (issues.length > 0) return fail(issues)
  return ok(input as CollectorDsl)
}

/** classifierのMapキー型（groupingBy）を解決する。 */
export function resolveClassifierKeyType(
  classifier: ClassifierDsl,
  inputType: TypeRef,
  path = 'classifier',
): Result<TypeRef> {
  if (!isEmployeeType(inputType)) {
    return fail([
      issue('TYPE_MISMATCH', 'classifierはEmployee要素にのみ適用できます', path),
    ])
  }
  switch (classifier.kind) {
    case 'employeeField': {
      const field = EMPLOYEE_FIELDS[classifier.field]
      if (!field) {
        return fail([
          issue('WHITELIST_FIELD', `Employeeに存在しないfieldです: ${classifier.field}`, `${path}.field`),
        ])
      }
      if (!typeRefEquals(field.javaType, TYPE_STRING)) {
        return fail([
          issue('TYPE_MISMATCH', `classifierのEmployee fieldはString型が必要です: ${classifier.field}`, `${path}.field`),
        ])
      }
      return ok(TYPE_STRING)
    }
    case 'employeeDepartment':
      return ok(TYPE_DEPARTMENT)
    case 'departmentField':
      return ok(TYPE_STRING)
  }
}

function isEmployeeType(t: TypeRef): boolean {
  return t.kind === 'object' && t.name === 'Employee'
}

function isStringType(t: TypeRef): boolean {
  return typeRefEquals(t, TYPE_STRING)
}

/** wrapper数値型（Integer / Long / Double）か */
function isNumericWrapper(t: TypeRef): boolean {
  return t.kind === 'object' && (t.name === 'Integer' || t.name === 'Long' || t.name === 'Double')
}

/** mergeFunctionの値型制約（String / Integer / Long / Double）との一致判定（v0.13 §2.2） */
function isWrapperOfName(t: TypeRef, name: ToMapMergeValueWrapper): boolean {
  return t.kind === 'object' && t.name === name
}

/**
 * natural orderで比較できる要素型か（`compareNatural`が受け付ける型と一致させる）。
 * String / LocalDate / 数値wrapper / primitive数値のみ。Employee・Departmentは不可。
 */
function isNaturalComparable(t: TypeRef): boolean {
  if (isStringType(t) || isNumericWrapper(t)) return true
  if (t.kind === 'object' && t.name === 'LocalDate') return true
  return t.kind === 'primitive' && t.name !== 'boolean'
}

/** Predicateが入力要素型へ適用できるかを検証する（filtering / partitioningBy共通） */
function predicateAppliesTo(
  predicate: DslPredicate,
  inputType: TypeRef,
  path: string,
): ValidationIssue[] {
  if (predicate.kind === 'fieldCompare') {
    if (!isEmployeeType(inputType)) {
      return [issue('TYPE_MISMATCH', 'fieldCompare PredicateはEmployee要素にのみ適用できます', path)]
    }
    const typed = validateTypes(predicate, path)
    return typed.ok ? [] : [...typed.issues]
  }
  if (!isNumericWrapper(inputType) && inputType.kind !== 'primitive') {
    return [
      issue('TYPE_MISMATCH', 'currentValueCompare Predicateは数値要素にのみ適用できます', path),
    ]
  }
  const typed = validateTypes(predicate, path)
  return typed.ok ? [] : [...typed.issues]
}

/**
 * Collector ASTを再帰的にたどり、**内側から外側へ組み上がる結果TypeRef**を解決する
 * （指示§6.3-2・§7.2・§7.3、Draft v0.8 §15.2）。
 *
 * 既存`resolveMapperOutputType`と同じ`Result<TypeRef>`方式で、型不一致は構造化issueで返す。
 */
export function resolveCollectorType(
  dsl: CollectorDsl,
  inputType: TypeRef,
  path = 'collector',
): Result<TypeRef> {
  switch (dsl.kind) {
    case 'toList':
      return ok(listOf(inputType))
    case 'toSet':
      return ok(setOf(inputType))
    case 'toCollection':
      // コンテナ実装名（ArrayList等）はTypeRefで表現せず表示ラベルで持つ（指示§6.3）
      return ok(listOf(inputType))
    case 'joining':
      if (!isStringType(inputType)) {
        return fail([issue('TYPE_MISMATCH', 'joiningはString要素にのみ適用できます', path)])
      }
      return ok(TYPE_STRING)
    case 'counting':
      return ok({ kind: 'object', name: 'Long' })
    case 'summingInt':
    case 'summingLong':
    case 'summingDouble':
    case 'averagingInt':
    case 'averagingLong':
    case 'averagingDouble':
    case 'summarizingInt':
    case 'summarizingLong':
    case 'summarizingDouble': {
      if (!isEmployeeType(inputType)) {
        return fail([
          issue('TYPE_MISMATCH', `${dsl.kind}はEmployee要素にのみ適用できます`, path),
        ])
      }
      const primitive = numericKindPrimitive(dsl.kind)
      const family = numericKindFamily(dsl.kind)
      if (family === 'summing') {
        return ok({ kind: 'object', name: WRAPPER_NAMES[primitiveNameOf(primitive)] })
      }
      if (family === 'averaging') {
        return ok({ kind: 'object', name: 'Double' })
      }
      return ok({ kind: 'statistics', name: `${primitive}SummaryStatistics` })
    }
    case 'minBy':
    case 'maxBy': {
      // Comparatorの適用可能性を実行前に検証する（Engineへ「比較できない型」を渡さない）
      if (dsl.comparator.kind === 'employeeKeys') {
        if (!isEmployeeType(inputType)) {
          return fail([
            issue(
              'TYPE_MISMATCH',
              `employeeKeys ComparatorはEmployee要素にのみ適用できます: ${formatTypeRef(inputType)}`,
              `${path}.comparator`,
            ),
          ])
        }
        return ok(optionalOf(inputType))
      }
      // natural orderは要素自身がComparableな型（String / LocalDate / 数値wrapper）のみ
      if (!isNaturalComparable(inputType)) {
        return fail([
          issue(
            'TYPE_MISMATCH',
            `natural order Comparatorは${formatTypeRef(inputType)}要素へ適用できません（Comparableな要素型が必要です。EmployeeにはemployeeKeysを使用してください）`,
            `${path}.comparator`,
          ),
        ])
      }
      return ok(optionalOf(inputType))
    }
    case 'reducing': {
      if (dsl.reduction.kind === 'stringConcat') {
        if (!isStringType(inputType)) {
          return fail([
            issue('TYPE_MISMATCH', 'stringConcatのreducingはString要素にのみ適用できます', `${path}.reduction`),
          ])
        }
        return ok(optionalOf(inputType))
      }
      if (dsl.reduction.kind === 'numericSum') {
        if (!isNumericWrapper(inputType)) {
          return fail([
            issue('TYPE_MISMATCH', 'numericSumのreducingは数値wrapper要素にのみ適用できます', `${path}.reduction`),
          ])
        }
        return ok(optionalOf(inputType))
      }
      return fail([
        issue(
          'TYPE_MISMATCH',
          'employeeFieldSumは1引数reducing（BinaryOperator）では使用できません',
          `${path}.reduction`,
        ),
      ])
    }
    case 'mapping': {
      const mapped = resolveMapperOutputType(dsl.mapper, inputType, `${path}.mapper`)
      if (!mapped.ok) return mapped
      return resolveCollectorType(dsl.downstream, mapped.value, `${path}.downstream`)
    }
    case 'flatMapping': {
      // 展開規則は既存のskills展開等（Collection fieldを返すmapper）を再利用する。
      // 平坦化はflatMapping自身が担うため、downstreamの入力型はコンテナの要素型になる
      const mapped = resolveMapperOutputType(dsl.mapper, inputType, `${path}.mapper`)
      if (!mapped.ok) return mapped
      if (mapped.value.kind !== 'collection') {
        return fail([
          issue(
            'TYPE_MISMATCH',
            `flatMappingのmapperはコンテナ（List等）を返す必要があります: ${formatTypeRef(mapped.value)}`,
            `${path}.mapper`,
          ),
        ])
      }
      return resolveCollectorType(dsl.downstream, mapped.value.elementType, `${path}.downstream`)
    }
    case 'filtering': {
      const predicateIssues = predicateAppliesTo(dsl.predicate, inputType, `${path}.predicate`)
      if (predicateIssues.length > 0) return fail(predicateIssues)
      return resolveCollectorType(dsl.downstream, inputType, `${path}.downstream`)
    }
    case 'collectingAndThen': {
      const downstream = resolveCollectorType(dsl.downstream, inputType, `${path}.downstream`)
      if (!downstream.ok) return downstream
      // List::copyOfはList結果にのみ適用できる（finisherの型整合）
      if (dsl.finisherId === 'List::copyOf') {
        const r = downstream.value
        if (!(r.kind === 'collection' && r.container === 'List')) {
          return fail([
            issue(
              'TYPE_MISMATCH',
              `List::copyOfはList結果にのみ適用できます: ${formatTypeRef(r)}`,
              `${path}.finisherId`,
            ),
          ])
        }
        return ok(r)
      }
      return fail([
        issue('WHITELIST_KIND', `未対応のfinisher IDです: ${String(dsl.finisherId)}`, `${path}.finisherId`),
      ])
    }
    case 'groupingBy': {
      const keyType = resolveClassifierKeyType(dsl.classifier, inputType, `${path}.classifier`)
      if (!keyType.ok) return keyType
      const valueType =
        dsl.downstream === null
          ? ok<TypeRef>(listOf(inputType))
          : resolveCollectorType(dsl.downstream, inputType, `${path}.downstream`)
      if (!valueType.ok) return valueType
      return ok(mapOf(keyType.value, valueType.value))
    }
    case 'partitioningBy': {
      const predicateIssues = predicateAppliesTo(dsl.predicate, inputType, `${path}.predicate`)
      if (predicateIssues.length > 0) return fail(predicateIssues)
      const valueType =
        dsl.downstream === null
          ? ok<TypeRef>(listOf(inputType))
          : resolveCollectorType(dsl.downstream, inputType, `${path}.downstream`)
      if (!valueType.ok) return valueType
      // キーはwrapper Boolean（primitive booleanと混同しない。指示§6.3-1）
      return ok(mapOf(TYPE_BOOLEAN_WRAPPER, valueType.value))
    }
    case 'toMap': {
      // keyMapper（ClassifierDsl）はEmployee入力を要求するため、toMapを配置できるのは
      // 入力要素型がEmployeeであるslotに限られる（v0.11 §8.6。mapping配下等はTYPE_MISMATCH）
      const keyType = resolveClassifierKeyType(dsl.keyMapper, inputType, `${path}.keyMapper`)
      if (!keyType.ok) return keyType
      const valueType = resolveToMapValueType(dsl.valueMapper, inputType, `${path}.valueMapper`)
      if (!valueType.ok) return valueType
      const issues: ValidationIssue[] = []
      if (dsl.mergeFunctionId !== null) {
        const meta = TO_MAP_MERGE_META[dsl.mergeFunctionId]
        // 値型Uの制約: concatはString、sum系は各数値wrapperのときのみ受理する（v0.11 §8.4、v0.13 §2.2）
        const required = meta?.requiredValueWrapper ?? null
        if (required !== null && !isWrapperOfName(valueType.value, required)) {
          issues.push(
            issue(
              'TYPE_MISMATCH',
              `mergeFunction ${dsl.mergeFunctionId}（${meta.javaExpr}）は${required}値にのみ適用できます: ${formatTypeRef(valueType.value)}`,
              `${path}.mergeFunctionId`,
            ),
          )
        }
      }
      if (dsl.mapFactoryId !== null) {
        // ComparatorなしのTreeMapはComparableなキーを要求する（既存規則の流用。指示§7.3-4）
        const meta = COLLECTOR_MAP_FACTORY_META[dsl.mapFactoryId]
        if (meta?.jdkOrdered && !COMPARABLE_CLASSIFIER_KINDS.includes(dsl.keyMapper.kind)) {
          issues.push(
            issue(
              'TYPE_MISMATCH',
              `${dsl.mapFactoryId}（Comparatorなし）はComparableでないキー（${dsl.keyMapper.kind}）と組み合わせられません`,
              `${path}.mapFactoryId`,
            ),
          )
        }
      }
      if (issues.length > 0) return fail(issues)
      return ok(mapOf(keyType.value, valueType.value))
    }
    // ---- Phase 11: unmodifiable系（v0.14 §2.1） ----
    // 結果型のTypeRefは既存のList<T> / Set<T> / Map<K, U>のまま（不変性の軸をTypeRefへ
    // 追加しない。不変性はコンテナラベルで表示する。v0.14 §2.1・§3.3）
    case 'toUnmodifiableList':
      return ok(listOf(inputType))
    case 'toUnmodifiableSet':
      return ok(setOf(inputType))
    case 'toUnmodifiableMap': {
      // 入力要素型がEmployeeであるslotに限られる制約はtoMapと同一（v0.14 §2.2、v0.11 §8.6）
      const keyType = resolveClassifierKeyType(dsl.keyMapper, inputType, `${path}.keyMapper`)
      if (!keyType.ok) return keyType
      const valueType = resolveToMapValueType(dsl.valueMapper, inputType, `${path}.valueMapper`)
      if (!valueType.ok) return valueType
      if (dsl.mergeFunctionId !== null) {
        const meta = TO_MAP_MERGE_META[dsl.mergeFunctionId]
        const required = meta?.requiredValueWrapper ?? null
        if (required !== null && !isWrapperOfName(valueType.value, required)) {
          return fail([
            issue(
              'TYPE_MISMATCH',
              `mergeFunction ${dsl.mergeFunctionId}（${meta.javaExpr}）は${required}値にのみ適用できます: ${formatTypeRef(valueType.value)}`,
              `${path}.mergeFunctionId`,
            ),
          ])
        }
      }
      return ok(mapOf(keyType.value, valueType.value))
    }
    case 'teeing': {
      const left = resolveCollectorType(dsl.left, inputType, `${path}.left`)
      if (!left.ok) return left
      const right = resolveCollectorType(dsl.right, inputType, `${path}.right`)
      if (!right.ok) return right
      const record = TEEING_MERGER_RECORDS[dsl.mergerId]
      if (!record) {
        return fail([
          issue('WHITELIST_KIND', `未対応のteeing merger IDです: ${String(dsl.mergerId)}`, `${path}.mergerId`),
        ])
      }
      const issues: ValidationIssue[] = []
      const branchTypes = [left.value, right.value]
      record.fields.forEach((field, i) => {
        const branch = branchTypes[i]
        if (!branch || !typeRefEquals(branch, field.expected)) {
          issues.push(
            issue(
              'TYPE_MISMATCH',
              `${record.recordName}の${field.name}（${field.javaType}）には${formatTypeRef(field.expected)}結果のbranchが必要です: ${branch ? formatTypeRef(branch) : 'なし'}`,
              `${path}.${i === 0 ? 'left' : 'right'}`,
            ),
          )
        }
      })
      if (issues.length > 0) return fail(issues)
      return ok({ kind: 'object', name: record.recordName })
    }
  }
}

/** 数値種別（Int / Long / Double）をPrimitiveNameへ */
function primitiveNameOf(primitive: 'Int' | 'Long' | 'Double'): PrimitiveName {
  return primitive === 'Int' ? 'int' : primitive === 'Long' ? 'long' : 'double'
}

/** 3引数collectの結果型（コンテナ = 結果。中間変換なしで要素を直接収集する） */
export function resolveCollectTripleType(
  dsl: CollectTripleDsl,
  inputType: TypeRef,
  path = 'collectTriple',
): Result<TypeRef> {
  const matched = COLLECT_TRIPLE_ID_COMBINATIONS.find(
    (combo) =>
      combo.supplierId === dsl.supplierId &&
      combo.accumulatorId === dsl.accumulatorId &&
      combo.combinerId === dsl.combinerId,
  )
  if (!matched) {
    return fail([issue('WHITELIST_KIND', '許可されていない3引数collectのID組合せです', path)])
  }
  return ok(listOf(inputType))
}

/**
 * 3引数collectのDSL検証（指示§5.1・§7.1）。
 * supplier / accumulator / combinerは定義済みIDの**組合せ**ホワイトリストで検証する。
 */
export function validateCollectTriple(
  input: unknown,
  path = 'collectTriple',
): Result<CollectTripleDsl> {
  if (typeof input !== 'object' || input === null) {
    return fail([issue('STRUCTURE_INVALID', 'collectTripleはオブジェクトが必要です', path)])
  }
  const obj = input as Record<string, unknown>
  if (obj['kind'] !== 'collectTriple') {
    return fail([
      issue(
        'STRUCTURE_UNKNOWN_KIND',
        `未知のcollectTriple kindです: ${String(obj['kind'])}`,
        `${path}.kind`,
      ),
    ])
  }
  const issues = unknownFieldIssues(obj, COLLECT_TRIPLE_ALLOWED_KEYS, path)
  const matched = COLLECT_TRIPLE_ID_COMBINATIONS.find(
    (combo) =>
      combo.supplierId === obj['supplierId'] &&
      combo.accumulatorId === obj['accumulatorId'] &&
      combo.combinerId === obj['combinerId'],
  )
  if (!matched) {
    issues.push(
      issue(
        'WHITELIST_KIND',
        `許可されていない3引数collectのID組合せです: ${String(obj['supplierId'])} / ${String(obj['accumulatorId'])} / ${String(obj['combinerId'])}`,
        path,
      ),
    )
  }
  if (issues.length > 0) return fail(issues)
  return ok(input as CollectTripleDsl)
}
