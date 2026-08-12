import type { ParameterSlot, PipelineTemplate } from '../domain/template/pipelineTemplate'
import { ALLOWED_OPERATORS } from '../domain/dsl/ast'
import {
  ALLOWED_GENERATE_RULES,
  ALLOWED_ITERATE_OPERATORS,
} from '../domain/dsl/sourceAst'
import {
  CLASSIFIER_DEPARTMENT_FIELDS,
  CLASSIFIER_EMPLOYEE_FIELDS,
  COLLECTOR_FINISHER_IDS,
  COLLECTOR_MAP_FACTORY_IDS,
  COLLECTOR_MAP_FACTORY_META,
  COLLECTOR_MAX_DEPTH,
  COLLECTOR_NUMERIC_FIELD_BY_PRIMITIVE,
  COLLECTOR_NUMERIC_KINDS,
  COLLECTOR_SUPPLIER_IDS,
  COLLECT_TRIPLE_ID_COMBINATIONS,
  COMPARABLE_CLASSIFIER_KINDS,
  TEEING_MERGER_IDS,
  numericKindPrimitive,
} from '../domain/dsl/collectorAst'
import { EMPLOYEE_COMPARATOR_FIELDS } from '../domain/dsl/comparatorAst'
import { REDUCTION_FIELD_WHITELIST } from '../domain/dsl/terminalAst'
import type { EmployeeValue } from '../domain/model/employee'
import { EMPLOYEE_FIELDS } from '../domain/model/employee'
import type { Result, ValidationIssue } from '../domain/types/result'
import { fail, issue, ok } from '../domain/types/result'

/**
 * Import Contract（v0.10 §5.2、Phase 6指示 §7.3）。
 *
 * スロットごとの許可DSLを**宣言的なspec木**として表現する単一定義源。
 * 参照するのは次の2箇所だけであり、これ以外に機械可読な許可範囲を重複定義しない。
 *   1. プロンプト生成（`promptGenerator.ts`）: spec木を自然文へ言語化する
 *   2. 取込前段検証（`candidateImport.ts`）: spec木で貼付JSONを検証する
 *
 * Contractは既存DSL検証（`instantiateTemplate`の手順1〜7）と**同等または厳しい**範囲に限る。
 * 食い違う場合は既存DSL検証が最終判定である（v0.10 §5.2）。
 * spec木の元になる形状の正は既存AST定義（`sourceAst.ts`ほか）である。
 */

// ---- 確定値（v0.10 §6.2・§6.4、Phase 6指示 §7.5） ----

/** 貼付テキスト全体の上限（UTF-16 code unit。parse前に判定する） */
export const IMPORT_TEXT_MAX_LENGTH = 65_536

/** datasetの件数範囲 */
export const DATASET_MIN_SIZE = 0
export const DATASET_MAX_SIZE = 8

/** 一般DSL文字列1件の長さ範囲（空文字はdelimiter等で意味を持つため許可） */
export const DSL_STRING_MIN = 0
export const DSL_STRING_MAX = 20

/** source配列の件数範囲（datasetの件数上限と同値） */
export const SOURCE_ARRAY_MAX = 8

/** nested配列（nestedStringList / streamOfPrimitiveArrays）の件数範囲 */
export const NESTED_OUTER_MAX = 4
export const NESTED_INNER_MAX = 5

/** employeeKeysのキー件数範囲 */
export const COMPARATOR_KEYS_MIN = 1
export const COMPARATOR_KEYS_MAX = 3

export const TITLE_MIN = 1
export const TITLE_MAX = 60
export const DESCRIPTION_MIN = 1
export const DESCRIPTION_MAX = 300

export const INT32_MIN = -2_147_483_648
export const INT32_MAX = 2_147_483_647

/** double要素の絶対値範囲（0は正のゼロのみ別途許可） */
export const DOUBLE_ABS_MIN = 1e-6
export const DOUBLE_ABS_MAX = 1e15

export const DATASET_STRING_MAX = 30
export const SKILL_STRING_MAX = 20
export const SKILLS_MAX = 5
export const AGE_MIN = 15
export const AGE_MAX = 80
export const SALARY_MIN = 0
export const SALARY_MAX = 99_999_999
export const EVALUATION_MIN = 0
export const EVALUATION_MAX = 5
export const HIRE_DATE_MIN = '1970-01-01'
export const HIRE_DATE_MAX = '2100-12-31'

/** 変数識別子契約のパターン（v0.10 §6.3） */
export const IDENTIFIER_PATTERN = /^[a-z][A-Za-z0-9]{0,19}$/

/** Java予約語・リテラル（識別子として拒否する） */
export const JAVA_RESERVED_WORDS: readonly string[] = [
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
  'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
  'volatile', 'while',
  // リテラル
  'true', 'false', 'null',
  // 文脈キーワード・制限付き識別子（安全側で拒否する）
  'var', 'yield', 'record', 'sealed', 'permits',
]

/**
 * 生成Javaコードが常に使用する識別子（衝突すると重複変数宣言・lambda引数shadowingとなり、
 * 実データと一致する正当なJavaコードにならないため拒否する。v0.10 §7.3-3の趣旨をContractで担保）。
 */
export const GENERATED_CODE_IDENTIFIERS: readonly string[] = [
  'result',
  'employees',
  'counter',
  'e',
  'n',
  'a',
  'b',
  'acc',
]

/** `empty`ソースのJava型名固定表（v0.10 §6.3） */
export const EMPTY_STREAM_TYPE_NAMES: Readonly<Record<string, string>> = {
  object: 'String',
  int: 'int',
  long: 'long',
  double: 'double',
}

/** 制御文字（U+0000〜U+001F・U+007F）。正規表現に生の制御文字を置かないためcode unitで判定する */
const CONTROL_CHAR_MAX = 0x1f
const DEL_CHAR_CODE = 0x7f
/** 双方向制御文字（U+061C・U+200E・U+200F・U+202A〜U+202E・U+2066〜U+2069） */
const BIDI_CHAR_PATTERN = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/

// ---- spec木の定義 ----

/** 配列要素の重複判定方法（宣言的に持ち、プロンプトへも言語化する） */
export type UniqueBy = 'value' | 'field'

/** 追加制約（形状だけでは表せない組合せ規則）。noteはプロンプトへそのまま出す */
export interface SpecRefinement {
  readonly note: string
  readonly check: (value: Record<string, unknown>, path: string) => ValidationIssue[]
}

export type SpecNode =
  /** 固定値のstring（例: collectionId = 'employees'） */
  | { readonly node: 'const'; readonly value: string }
  /** 許可値の列挙 */
  | { readonly node: 'enum'; readonly values: readonly string[]; readonly label: string }
  /** 自由文字列（UTF-16 code unit数で計数） */
  | { readonly node: 'string'; readonly min: number; readonly max: number; readonly label: string }
  /** Javaの変数識別子として埋め込まれる文字列 */
  | { readonly node: 'identifier'; readonly label: string }
  /** Java int32範囲の整数 */
  | { readonly node: 'int' }
  /** Number.isSafeIntegerを満たす整数（Java long相当） */
  | { readonly node: 'long' }
  /** 有限かつ0（正のゼロ）または絶対値1e-6〜1e15（-0は拒否） */
  | { readonly node: 'double' }
  /** limit / skipの引数（0以上のint32。Javaのint literalとして正当な範囲へ制限する） */
  | { readonly node: 'count' }
  /**
   * primitive依存の数値要素。具体的な値域は同じobjectの`primitive`で決まるため、
   * 構造ゲートとしては有限数値だけを見て、値域はvariantのrefineが判定する。
   */
  | { readonly node: 'numberByPrimitive' }
  /** 範囲付き整数（datasetのage / salary） */
  | {
      readonly node: 'boundedInt'
      readonly min: number
      readonly max: number
      readonly label: string
    }
  /** 範囲付きdouble（datasetのevaluation。NaN / Infinity / -0を拒否） */
  | {
      readonly node: 'boundedDouble'
      readonly min: number
      readonly max: number
      readonly label: string
    }
  /** ISO日付（実在日・範囲検証つき） */
  | { readonly node: 'isoDate'; readonly min: string; readonly max: string }
  | {
      readonly node: 'array'
      readonly item: SpecNode
      readonly min: number
      readonly max: number
      readonly label: string
      readonly unique?: UniqueBy
    }
  /** キー集合が固定のobject（kindを持たない正規object・dataset要素等） */
  | {
      readonly node: 'object'
      readonly label: string
      readonly fields: Readonly<Record<string, SpecNode>>
      readonly refine?: SpecRefinement
    }
  /** `kind`で判別するUnion */
  | {
      readonly node: 'unionByKind'
      readonly label: string
      readonly variants: Readonly<Record<string, VariantSpec>>
    }
  /** `type`で判別するUnion（DslLiteral・ReductionIdentity） */
  | {
      readonly node: 'unionByType'
      readonly label: string
      readonly variants: Readonly<Record<string, VariantSpec>>
    }
  /** nullを明示的に許可する（optional keyではなく明示null。既存DSLの方針） */
  | { readonly node: 'nullable'; readonly inner: SpecNode }
  /** Collector ASTの再帰参照（許可kindと深さ上限を伴う） */
  | { readonly node: 'collector'; readonly allowedKinds: readonly string[] }

export interface VariantSpec {
  /** 判別キー（kind / type）以外のフィールド */
  readonly fields: Readonly<Record<string, SpecNode>>
  readonly refine?: SpecRefinement
}

// ---- 値検証 ----

function schemaIssue(message: string, path: string): ValidationIssue {
  return issue('IMPORT_SCHEMA', message, path)
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= CONTROL_CHAR_MAX || code === DEL_CHAR_CODE) return true
  }
  return false
}

function stringRuleIssues(value: string, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (hasControlChar(value)) {
    issues.push(schemaIssue('制御文字（U+0000〜U+001F・U+007F）は使用できません', path))
  }
  if (BIDI_CHAR_PATTERN.test(value)) {
    issues.push(schemaIssue('双方向制御文字（U+061C・U+200E等）は使用できません', path))
  }
  return issues
}

/** 実在日（月の日数・うるう年）を検証する */
export function isRealDate(iso: string): boolean {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!matched) return false
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  if (month < 1 || month > 12 || day < 1) return false
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const limit = daysInMonth[month - 1] ?? 0
  return day <= limit
}

/** 取込前段が受理するdouble値か（v0.10 §6.4） */
export function isContractDouble(value: number): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (Object.is(value, -0)) return false
  if (value === 0) return true
  const abs = Math.abs(value)
  return abs >= DOUBLE_ABS_MIN && abs <= DOUBLE_ABS_MAX
}

/** 変数識別子契約を満たすか（v0.10 §6.3 + 生成コードの予約識別子） */
export function isContractIdentifier(value: string): boolean {
  if (!IDENTIFIER_PATTERN.test(value)) return false
  if (JAVA_RESERVED_WORDS.includes(value)) return false
  if (GENERATED_CODE_IDENTIFIERS.includes(value)) return false
  return true
}

function uniqueKeyOf(item: unknown, unique: UniqueBy): string {
  if (unique === 'value') return JSON.stringify(item)
  const field = (item as Record<string, unknown> | null)?.['field']
  return String(field)
}

/**
 * spec木による検証。すべての違反を`IMPORT_SCHEMA`のValidationIssueとして返す
 * （例外は送出しない）。pathはJSONパス風（`dataset[2].salary`）とする。
 */
export function validateBySpec(spec: SpecNode, value: unknown, path: string): ValidationIssue[] {
  switch (spec.node) {
    case 'const':
      return value === spec.value
        ? []
        : [schemaIssue(`"${spec.value}" のみ許可されます（実際: ${JSON.stringify(value)}）`, path)]
    case 'enum':
      return typeof value === 'string' && spec.values.includes(value)
        ? []
        : [
            schemaIssue(
              `${spec.label}は次のいずれかが必要です: ${spec.values.join(' / ')}（実際: ${JSON.stringify(value)}）`,
              path,
            ),
          ]
    case 'string': {
      if (typeof value !== 'string') {
        return [schemaIssue(`${spec.label}は文字列が必要です`, path)]
      }
      const issues = stringRuleIssues(value, path)
      if (value.length < spec.min || value.length > spec.max) {
        issues.push(
          schemaIssue(
            `${spec.label}は${spec.min}〜${spec.max} UTF-16 code unitが必要です（実際: ${value.length}）`,
            path,
          ),
        )
      }
      return issues
    }
    case 'identifier': {
      if (typeof value !== 'string') {
        return [schemaIssue(`${spec.label}は文字列が必要です`, path)]
      }
      if (!IDENTIFIER_PATTERN.test(value)) {
        return [
          schemaIssue(
            `${spec.label}は ${IDENTIFIER_PATTERN.source} に一致する必要があります（実際: ${JSON.stringify(value)}）`,
            path,
          ),
        ]
      }
      if (JAVA_RESERVED_WORDS.includes(value)) {
        return [schemaIssue(`${spec.label}にJavaの予約語・リテラルは使用できません: ${value}`, path)]
      }
      if (GENERATED_CODE_IDENTIFIERS.includes(value)) {
        return [
          schemaIssue(
            `${spec.label}に生成コードが使用する識別子は指定できません: ${value}（${GENERATED_CODE_IDENTIFIERS.join(' / ')}）`,
            path,
          ),
        ]
      }
      return []
    }
    case 'int':
      return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= INT32_MIN &&
        value <= INT32_MAX
        ? []
        : [
            schemaIssue(
              `Java int範囲（${INT32_MIN}〜${INT32_MAX}）の整数が必要です（実際: ${JSON.stringify(value)}）`,
              path,
            ),
          ]
    case 'long':
      return typeof value === 'number' && Number.isSafeInteger(value)
        ? []
        : [
            schemaIssue(
              `safe integer範囲の整数が必要です（実際: ${JSON.stringify(value)}）`,
              path,
            ),
          ]
    case 'double':
      return typeof value === 'number' && isContractDouble(value)
        ? []
        : [
            schemaIssue(
              `有限で、0（正のゼロ）または絶対値${DOUBLE_ABS_MIN}〜${DOUBLE_ABS_MAX}のdoubleが必要です（-0は不可。実際: ${Object.is(value, -0) ? '-0' : JSON.stringify(value)}）`,
              path,
            ),
          ]
    case 'count':
      return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= INT32_MAX
        ? []
        : [
            schemaIssue(
              `0〜${INT32_MAX}の整数が必要です（実際: ${JSON.stringify(value)}）`,
              path,
            ),
          ]
    case 'numberByPrimitive':
      return typeof value === 'number' && Number.isFinite(value)
        ? []
        : [
            schemaIssue(
              `有限の数値が必要です（実際: ${JSON.stringify(value)}）`,
              path,
            ),
          ]
    case 'boundedInt':
      return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= spec.min &&
        value <= spec.max
        ? []
        : [
            schemaIssue(
              `${spec.label}は${spec.min}〜${spec.max}の整数が必要です（実際: ${JSON.stringify(value)}）`,
              path,
            ),
          ]
    case 'boundedDouble': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return [
          schemaIssue(
            `${spec.label}は有限の数値が必要です（NaN / Infinityは不可。実際: ${JSON.stringify(value)}）`,
            path,
          ),
        ]
      }
      if (Object.is(value, -0)) {
        return [schemaIssue(`${spec.label}に負のゼロ（-0）は指定できません`, path)]
      }
      return value >= spec.min && value <= spec.max
        ? []
        : [
            schemaIssue(
              `${spec.label}は${spec.min}〜${spec.max}が必要です（実際: ${value}）`,
              path,
            ),
          ]
    }
    case 'isoDate': {
      if (typeof value !== 'string') {
        return [schemaIssue('hireDateは文字列が必要です', path)]
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return [schemaIssue(`hireDateはYYYY-MM-DD形式が必要です（実際: ${value}）`, path)]
      }
      if (!isRealDate(value)) {
        return [schemaIssue(`hireDateは実在する日付が必要です（実際: ${value}）`, path)]
      }
      if (value < spec.min || value > spec.max) {
        return [
          schemaIssue(`hireDateは${spec.min}〜${spec.max}の範囲が必要です（実際: ${value}）`, path),
        ]
      }
      return []
    }
    case 'array': {
      if (!Array.isArray(value)) {
        return [schemaIssue(`${spec.label}は配列が必要です`, path)]
      }
      const issues: ValidationIssue[] = []
      if (value.length < spec.min || value.length > spec.max) {
        issues.push(
          schemaIssue(
            `${spec.label}は${spec.min}〜${spec.max}件が必要です（実際: ${value.length}件）`,
            path,
          ),
        )
      }
      value.forEach((item, index) => {
        issues.push(...validateBySpec(spec.item, item, `${path}[${index}]`))
      })
      if (spec.unique) {
        const seen = new Set<string>()
        value.forEach((item, index) => {
          const key = uniqueKeyOf(item, spec.unique as UniqueBy)
          if (seen.has(key)) {
            issues.push(
              schemaIssue(
                spec.unique === 'field'
                  ? `${spec.label}で同一fieldを重複指定できません: ${key}`
                  : `${spec.label}に重複した要素は指定できません: ${key}`,
                `${path}[${index}]`,
              ),
            )
          }
          seen.add(key)
        })
      }
      return issues
    }
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return [schemaIssue(`${spec.label}はオブジェクトが必要です`, path)]
      }
      const obj = value as Record<string, unknown>
      const issues = closedObjectIssues(obj, spec.fields, path)
      if (issues.length === 0 && spec.refine) {
        issues.push(...spec.refine.check(obj, path))
      }
      return issues
    }
    case 'unionByKind':
      return unionIssues(spec.label, 'kind', spec.variants, value, path)
    case 'unionByType':
      return unionIssues(spec.label, 'type', spec.variants, value, path)
    case 'nullable':
      return value === null ? [] : validateBySpec(spec.inner, value, path)
    case 'collector':
      return collectorSpecIssues(spec.allowedKinds, value, path, 1)
  }
}

/** キー集合が固定のobject検証（未知キー拒否・必須キー欠落検出） */
function closedObjectIssues(
  obj: Record<string, unknown>,
  fields: Readonly<Record<string, SpecNode>>,
  path: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const allowed = Object.keys(fields)
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      issues.push(schemaIssue(`許可されていないキーです: ${key}`, `${path}.${key}`))
    }
  }
  for (const [key, fieldSpec] of Object.entries(fields)) {
    if (!(key in obj)) {
      issues.push(schemaIssue(`必須キーがありません: ${key}`, `${path}.${key}`))
      continue
    }
    issues.push(...validateBySpec(fieldSpec, obj[key], `${path}.${key}`))
  }
  return issues
}

function unionIssues(
  label: string,
  discriminator: 'kind' | 'type',
  variants: Readonly<Record<string, VariantSpec>>,
  value: unknown,
  path: string,
): ValidationIssue[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [schemaIssue(`${label}はオブジェクトが必要です`, path)]
  }
  const obj = value as Record<string, unknown>
  const discriminatorValue = obj[discriminator]
  if (typeof discriminatorValue !== 'string' || !(discriminatorValue in variants)) {
    return [
      schemaIssue(
        `${label}の${discriminator}は次のいずれかが必要です: ${Object.keys(variants).join(' / ')}（実際: ${JSON.stringify(discriminatorValue)}）`,
        `${path}.${discriminator}`,
      ),
    ]
  }
  const variant = variants[discriminatorValue] as VariantSpec
  const fields: Record<string, SpecNode> = {
    [discriminator]: { node: 'const', value: discriminatorValue },
    ...variant.fields,
  }
  const issues = closedObjectIssues(obj, fields, path)
  if (issues.length === 0 && variant.refine) {
    issues.push(...variant.refine.check(obj, path))
  }
  return issues
}

// ---- 共通spec ----

const dslString = (label: string): SpecNode => ({
  node: 'string',
  min: DSL_STRING_MIN,
  max: DSL_STRING_MAX,
  label,
})

const datasetString = (label: string): SpecNode => ({
  node: 'string',
  min: 1,
  max: DATASET_STRING_MAX,
  label,
})

/** dataset文字列fieldは空白のみを拒否する（値自体は原文を保存する。v0.10 §6.4） */
function notBlankIssues(value: unknown, path: string, label: string): ValidationIssue[] {
  return typeof value === 'string' && value.trim().length === 0
    ? [schemaIssue(`${label}は空白のみにできません`, path)]
    : []
}

const DEPARTMENT_SPEC: SpecNode = {
  node: 'object',
  label: 'department',
  fields: {
    name: datasetString('department.name'),
    division: datasetString('department.division'),
  },
  refine: {
    note: 'department.name / department.divisionは空白のみにできません。',
    check: (obj, path) => [
      ...notBlankIssues(obj['name'], `${path}.name`, 'department.name'),
      ...notBlankIssues(obj['division'], `${path}.division`, 'department.division'),
    ],
  },
}

/**
 * dataset要素（Employee業務フィールドのみ。closed schema）。
 * `elementId`はアプリが付与するため持込みを拒否する（未知キーとして検出される）。
 */
export const DATASET_ELEMENT_SPEC: SpecNode = {
  node: 'object',
  label: 'dataset要素',
  fields: {
    name: datasetString('name'),
    age: { node: 'boundedInt', min: AGE_MIN, max: AGE_MAX, label: 'age' },
    salary: { node: 'boundedInt', min: SALARY_MIN, max: SALARY_MAX, label: 'salary' },
    evaluation: {
      node: 'boundedDouble',
      min: EVALUATION_MIN,
      max: EVALUATION_MAX,
      label: 'evaluation',
    },
    region: datasetString('region'),
    hireDate: { node: 'isoDate', min: HIRE_DATE_MIN, max: HIRE_DATE_MAX },
    department: DEPARTMENT_SPEC,
    skills: {
      node: 'array',
      label: 'skills',
      min: 0,
      max: SKILLS_MAX,
      unique: 'value',
      item: { node: 'string', min: 1, max: SKILL_STRING_MAX, label: 'skills要素' },
    },
  },
  refine: {
    note: 'name / regionおよびskillsの各要素は空白のみにできません。',
    check: (obj, path) => {
      const issues = [
        ...notBlankIssues(obj['name'], `${path}.name`, 'name'),
        ...notBlankIssues(obj['region'], `${path}.region`, 'region'),
      ]
      const skills = obj['skills']
      if (Array.isArray(skills)) {
        skills.forEach((skill, index) => {
          issues.push(...notBlankIssues(skill, `${path}.skills[${index}]`, 'skills要素'))
        })
      }
      return issues
    },
  },
}

export const DATASET_SPEC: SpecNode = {
  node: 'array',
  label: 'dataset',
  min: DATASET_MIN_SIZE,
  max: DATASET_MAX_SIZE,
  item: DATASET_ELEMENT_SPEC,
}

export const TITLE_SPEC: SpecNode = {
  node: 'string',
  min: TITLE_MIN,
  max: TITLE_MAX,
  label: 'title',
}
export const DESCRIPTION_SPEC: SpecNode = {
  node: 'string',
  min: DESCRIPTION_MIN,
  max: DESCRIPTION_MAX,
  label: 'description',
}

// ---- DSL spec（既存AST定義に対応させる） ----

/** Employee fieldごとのDSLリテラル型（既存`validateTypes`の受理範囲と一致させる） */
const LITERAL_TYPE_BY_FIELD: Readonly<Record<string, 'int' | 'long'>> = {
  age: 'int',
  salary: 'long',
}

/**
 * primitive変換できるEmployee field（既存`EMPLOYEE_FIELDS`のjavaTypeから導出する。
 * `resolveMapperOutputType`はfieldとprimitiveの不一致を型検証で拒否するため、
 * Contractは同じ対応表を前段で適用する）。
 */
const PRIMITIVE_BY_EMPLOYEE_FIELD: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(EMPLOYEE_FIELDS)
    .filter(([, info]) => info.javaType.kind === 'primitive')
    .map(([field, info]) => [
      field,
      info.javaType.kind === 'primitive' ? info.javaType.name : 'int',
    ]),
)

/** fieldCompareで扱えるEmployee field（int / long fieldのみ。既存型検証と同等以上に厳しい） */
export const COMPARABLE_PREDICATE_FIELDS: readonly string[] = Object.keys(LITERAL_TYPE_BY_FIELD)

function literalSpecOf(types: readonly ('int' | 'long')[], label: string): SpecNode {
  return {
    node: 'unionByType',
    label,
    variants: Object.fromEntries(
      types.map((type) => [type, { fields: { value: { node: type } } } as VariantSpec]),
    ),
  }
}

function literalSpecForField(field: string): SpecNode {
  const type = LITERAL_TYPE_BY_FIELD[field] ?? 'int'
  return literalSpecOf([type], `${field}のリテラル`)
}

const INT_LITERAL_SPEC: SpecNode = {
  node: 'unionByType',
  label: 'int定数',
  variants: { int: { fields: { value: { node: 'int' } } } },
}

/** Predicate spec（許可kind・field・operatorをslotから絞る） */
function predicateSpec(
  predicateKinds: readonly string[],
  allowedFields: readonly string[],
  allowedOperators: readonly string[],
  label: string,
): SpecNode {
  const variants: Record<string, VariantSpec> = {}
  const fields = allowedFields.filter((f) => COMPARABLE_PREDICATE_FIELDS.includes(f))
  if (predicateKinds.includes('fieldCompare') && fields.length > 0) {
    // valueの型はfieldで決まる（age = int、salary = long）。
    // 許可fieldが複数ある場合は、構造ゲートで許容型のUnionを受けたうえでrefineがfieldごとに絞る
    const literalTypes = [
      ...new Set(fields.map((field) => LITERAL_TYPE_BY_FIELD[field] ?? 'int')),
    ] as ('int' | 'long')[]
    variants['fieldCompare'] = {
      fields: {
        field: { node: 'enum', values: fields, label: 'field' },
        operator: { node: 'enum', values: allowedOperators, label: 'operator' },
        value:
          fields.length === 1
            ? literalSpecForField(fields[0] as string)
            : literalSpecOf(literalTypes, 'リテラル'),
      },
      refine:
        fields.length > 1
          ? {
              note: `valueの型はfieldに対応させます（${fields
                .map((field) => `${field} = ${LITERAL_TYPE_BY_FIELD[field] ?? 'int'}`)
                .join(' / ')}）。`,
              check: (obj, path) => {
                const field = String(obj['field'])
                if (!(field in LITERAL_TYPE_BY_FIELD)) return []
                return validateBySpec(literalSpecForField(field), obj['value'], `${path}.value`)
              },
            }
          : undefined,
    }
  }
  if (predicateKinds.includes('currentValueCompare')) {
    variants['currentValueCompare'] = {
      fields: {
        operator: { node: 'enum', values: allowedOperators, label: 'operator' },
        value: INT_LITERAL_SPEC,
      },
    }
  }
  return { node: 'unionByKind', label, variants }
}

const MAPPER_VARIANTS: Readonly<Record<string, VariantSpec>> = {
  fieldAccess: {
    fields: { field: { node: 'enum', values: Object.keys(EMPLOYEE_FIELDS), label: 'field' } },
  },
  toUpper: { fields: {} },
  prefix: { fields: { prefix: dslString('prefix') } },
  fieldToPrimitive: {
    fields: {
      field: {
        node: 'enum',
        values: Object.keys(PRIMITIVE_BY_EMPLOYEE_FIELD),
        label: 'field',
      },
      primitive: { node: 'enum', values: ['int', 'long', 'double'], label: 'primitive' },
    },
    refine: {
      note: `fieldとprimitiveは対応させます: ${Object.entries(PRIMITIVE_BY_EMPLOYEE_FIELD)
        .map(([field, primitive]) => `${field} → ${primitive}`)
        .join(' / ')}。`,
      check: (obj, path) => {
        const expected = PRIMITIVE_BY_EMPLOYEE_FIELD[String(obj['field'])]
        return expected !== undefined && obj['primitive'] === expected
          ? []
          : [
              schemaIssue(
                `field ${String(obj['field'])} のprimitiveは ${String(expected)} が必要です`,
                `${path}.primitive`,
              ),
            ]
      },
    },
  },
  listStream: { fields: {} },
  arrayStream: {
    fields: { primitive: { node: 'enum', values: ['int', 'long', 'double'], label: 'primitive' } },
  },
}

function mapperSpec(allowedKinds: readonly string[], label = 'mapper'): SpecNode {
  return { node: 'unionByKind', label, variants: pickVariants(MAPPER_VARIANTS, allowedKinds) }
}

function pickVariants(
  all: Readonly<Record<string, VariantSpec>>,
  allowedKinds: readonly string[],
): Readonly<Record<string, VariantSpec>> {
  const picked: Record<string, VariantSpec> = {}
  for (const kind of allowedKinds) {
    const variant = all[kind]
    if (variant) picked[kind] = variant
  }
  return picked
}

function comparatorSpec(
  allowedKinds: readonly string[],
  allowedFields: readonly string[],
  label = 'comparator',
): SpecNode {
  const all: Readonly<Record<string, VariantSpec>> = {
    natural: { fields: {} },
    employeeKeys: {
      fields: {
        keys: {
          node: 'array',
          label: 'keys',
          min: COMPARATOR_KEYS_MIN,
          max: COMPARATOR_KEYS_MAX,
          unique: 'field',
          item: {
            node: 'object',
            label: 'Comparatorキー',
            fields: {
              field: { node: 'enum', values: allowedFields, label: 'field' },
              direction: { node: 'enum', values: ['ASC', 'DESC'], label: 'direction' },
            },
          },
        },
      },
    },
  }
  return { node: 'unionByKind', label, variants: pickVariants(all, allowedKinds) }
}

function consumerSpec(allowedKinds: readonly string[], allowedFields: readonly string[]): SpecNode {
  const all: Readonly<Record<string, VariantSpec>> = {
    printValue: { fields: {} },
    printField: {
      fields: { field: { node: 'enum', values: allowedFields, label: 'field' } },
    },
  }
  return { node: 'unionByKind', label: 'consumer', variants: pickVariants(all, allowedKinds) }
}

const REDUCTION_VARIANTS: Readonly<Record<string, VariantSpec>> = {
  numericSum: { fields: {} },
  stringConcat: { fields: {} },
  employeeFieldSum: {
    fields: { field: { node: 'enum', values: [...REDUCTION_FIELD_WHITELIST], label: 'field' } },
  },
}

function reductionSpec(allowedKinds: readonly string[], label = 'reduction'): SpecNode {
  return { node: 'unionByKind', label, variants: pickVariants(REDUCTION_VARIANTS, allowedKinds) }
}

const IDENTITY_SPEC: SpecNode = {
  node: 'unionByType',
  label: 'identity',
  variants: {
    int: { fields: { value: { node: 'int' } } },
    long: { fields: { value: { node: 'long' } } },
    double: { fields: { value: { node: 'double' } } },
    string: { fields: { value: dslString('identity value') } },
  },
}

function arrayGeneratorSpec(allowedElementTypeNames: readonly string[]): SpecNode {
  return {
    node: 'unionByKind',
    label: 'arrayGenerator',
    variants: {
      arrayGenerator: {
        fields: {
          elementTypeName: {
            node: 'enum',
            values: allowedElementTypeNames,
            label: 'elementTypeName',
          },
        },
      },
    },
  }
}

const COLLECT_TRIPLE_SPEC: SpecNode = {
  node: 'unionByKind',
  label: 'collectTriple',
  variants: {
    collectTriple: {
      fields: {
        supplierId: {
          node: 'enum',
          values: COLLECT_TRIPLE_ID_COMBINATIONS.map((c) => c.supplierId),
          label: 'supplierId',
        },
        accumulatorId: {
          node: 'enum',
          values: COLLECT_TRIPLE_ID_COMBINATIONS.map((c) => c.accumulatorId),
          label: 'accumulatorId',
        },
        combinerId: {
          node: 'enum',
          values: COLLECT_TRIPLE_ID_COMBINATIONS.map((c) => c.combinerId),
          label: 'combinerId',
        },
      },
      refine: {
        note: 'supplier / accumulator / combinerは定義済みの組合せだけを指定できます。',
        check: (obj, path) =>
          COLLECT_TRIPLE_ID_COMBINATIONS.some(
            (c) =>
              c.supplierId === obj['supplierId'] &&
              c.accumulatorId === obj['accumulatorId'] &&
              c.combinerId === obj['combinerId'],
          )
            ? []
            : [schemaIssue('許可されていない3引数collectのID組合せです', path)],
      },
    },
  },
}

// ---- Source DSL spec ----

/** primitive名から数値要素specを決める（intはint32、longはsafe integer、doubleは§6.4の値域） */
function numberSpecFor(primitive: string): SpecNode {
  if (primitive === 'double') return { node: 'double' }
  if (primitive === 'long') return { node: 'long' }
  return { node: 'int' }
}

/**
 * primitiveごとに数値要素の値域が変わるため、variantのrefineで再検証する。
 * 件数・配列構造は宣言側のarray specが担い、ここでは各要素の値域だけを見る。
 */
function primitiveArrayRefine(valuesKey: 'values' | 'arrays', nested: boolean): SpecRefinement {
  return {
    note: 'primitiveがintならJava int32範囲の整数、longならsafe integer範囲の整数、doubleは0（正のゼロ）または絶対値1e-6〜1e15の有限値です。',
    check: (obj, path) => {
      const itemSpec = numberSpecFor(String(obj['primitive']))
      const raw = obj[valuesKey]
      if (!Array.isArray(raw)) return []
      const issues: ValidationIssue[] = []
      raw.forEach((item, index) => {
        const itemPath = `${path}.${valuesKey}[${index}]`
        if (!nested) {
          issues.push(...validateBySpec(itemSpec, item, itemPath))
          return
        }
        if (!Array.isArray(item)) return
        item.forEach((inner, innerIndex) => {
          issues.push(...validateBySpec(itemSpec, inner, `${itemPath}[${innerIndex}]`))
        })
      })
      return issues
    },
  }
}

const SOURCE_VARIANTS: Readonly<Record<string, VariantSpec>> = {
  collection: { fields: { collectionId: { node: 'const', value: 'employees' } } },
  arrayObject: {
    fields: {
      arrayId: { node: 'identifier', label: 'arrayId' },
      elementTypeName: { node: 'const', value: 'String' },
      values: {
        node: 'array',
        label: 'values',
        min: 0,
        max: SOURCE_ARRAY_MAX,
        item: dslString('values要素'),
      },
    },
  },
  arrayPrimitive: {
    fields: {
      arrayId: { node: 'identifier', label: 'arrayId' },
      primitive: { node: 'enum', values: ['int', 'long', 'double'], label: 'primitive' },
      values: {
        node: 'array',
        label: 'values',
        min: 0,
        max: SOURCE_ARRAY_MAX,
        // 具体的な値域はprimitiveで決まる（refineで再検証する）
        item: { node: 'numberByPrimitive' },
      },
    },
    refine: primitiveArrayRefine('values', false),
  },
  streamOf: {
    fields: {
      elementTypeName: { node: 'const', value: 'String' },
      values: {
        node: 'array',
        label: 'values',
        min: 0,
        max: SOURCE_ARRAY_MAX,
        item: dslString('values要素'),
      },
    },
  },
  streamOfPrimitiveArrays: {
    fields: {
      primitive: { node: 'enum', values: ['int', 'long', 'double'], label: 'primitive' },
      arrays: {
        node: 'array',
        label: 'arrays',
        min: 0,
        max: NESTED_OUTER_MAX,
        item: {
          node: 'array',
          label: 'arrays要素',
          min: 0,
          max: NESTED_INNER_MAX,
          item: { node: 'numberByPrimitive' },
        },
      },
    },
    refine: primitiveArrayRefine('arrays', true),
  },
  nestedStringList: {
    fields: {
      listId: { node: 'identifier', label: 'listId' },
      values: {
        node: 'array',
        label: 'values',
        min: 0,
        max: NESTED_OUTER_MAX,
        item: {
          node: 'array',
          label: 'values要素',
          min: 0,
          max: NESTED_INNER_MAX,
          item: dslString('values要素の文字列'),
        },
      },
    },
  },
  generate: {
    fields: { ruleId: { node: 'enum', values: [...ALLOWED_GENERATE_RULES], label: 'ruleId' } },
  },
  iterate2: {
    fields: {
      seed: { node: 'int' },
      operator: {
        node: 'object',
        label: 'operator',
        fields: {
          ruleId: { node: 'enum', values: [...ALLOWED_ITERATE_OPERATORS], label: 'ruleId' },
          step: { node: 'int' },
        },
      },
    },
  },
  iterate3: {
    fields: {
      seed: { node: 'int' },
      predicate: {
        node: 'object',
        label: 'iterate predicate',
        fields: {
          operator: { node: 'enum', values: ['LTE', 'LT'], label: 'operator' },
          value: { node: 'int' },
        },
      },
      operator: {
        node: 'object',
        label: 'operator',
        fields: {
          ruleId: { node: 'enum', values: [...ALLOWED_ITERATE_OPERATORS], label: 'ruleId' },
          step: { node: 'int' },
        },
      },
    },
  },
  range: { fields: { from: { node: 'int' }, to: { node: 'int' } } },
  rangeClosed: { fields: { from: { node: 'int' }, to: { node: 'int' } } },
  empty: {
    fields: {
      streamType: {
        node: 'enum',
        values: Object.keys(EMPTY_STREAM_TYPE_NAMES),
        label: 'streamType',
      },
      elementTypeName: {
        node: 'enum',
        values: [...new Set(Object.values(EMPTY_STREAM_TYPE_NAMES))],
        label: 'elementTypeName',
      },
    },
    refine: {
      note: `streamTypeとelementTypeNameの組は固定です: ${Object.entries(EMPTY_STREAM_TYPE_NAMES)
        .map(([k, v]) => `${k} → ${v}`)
        .join(' / ')}。`,
      check: (obj, path) => {
        const expected = EMPTY_STREAM_TYPE_NAMES[String(obj['streamType'])]
        return expected !== undefined && obj['elementTypeName'] === expected
          ? []
          : [
              schemaIssue(
                `streamType ${String(obj['streamType'])} のelementTypeNameは ${String(expected)} が必要です`,
                `${path}.elementTypeName`,
              ),
            ]
      },
    },
  },
}

function sourceSpec(allowedKinds: readonly string[]): SpecNode {
  return { node: 'unionByKind', label: 'source', variants: pickVariants(SOURCE_VARIANTS, allowedKinds) }
}

// ---- Collector spec（再帰。許可kindと深さ上限を伴う） ----

const STRING_CONST_SPEC: SpecNode = {
  node: 'unionByType',
  label: 'String定数',
  variants: { string: { fields: { value: dslString('String定数のvalue') } } },
}

const CLASSIFIER_SPEC: SpecNode = {
  node: 'unionByKind',
  label: 'classifier',
  variants: {
    employeeField: {
      fields: { field: { node: 'enum', values: [...CLASSIFIER_EMPLOYEE_FIELDS], label: 'field' } },
    },
    employeeDepartment: { fields: {} },
    departmentField: {
      fields: { field: { node: 'enum', values: [...CLASSIFIER_DEPARTMENT_FIELDS], label: 'field' } },
    },
  },
}

/** Collector内部Predicateの許可範囲（既存`validateCollector`と同等以上に厳しい） */
const COLLECTOR_PREDICATE_SPEC: SpecNode = predicateSpec(
  ['fieldCompare', 'currentValueCompare'],
  COMPARABLE_PREDICATE_FIELDS,
  [...ALLOWED_OPERATORS],
  'Collector内部Predicate',
)

/** Collector variantごとのフィールド定義。downstream / left / rightは再帰参照 */
function collectorVariants(allowedKinds: readonly string[]): Record<string, VariantSpec> {
  const child: SpecNode = { node: 'collector', allowedKinds }
  const nullableChild: SpecNode = { node: 'nullable', inner: child }
  const all: Record<string, VariantSpec> = {
    toList: { fields: {} },
    toSet: { fields: {} },
    toCollection: {
      fields: { supplierId: { node: 'enum', values: [...COLLECTOR_SUPPLIER_IDS], label: 'supplierId' } },
    },
    joining: {
      fields: {
        delimiter: { node: 'nullable', inner: STRING_CONST_SPEC },
        prefix: { node: 'nullable', inner: STRING_CONST_SPEC },
        suffix: { node: 'nullable', inner: STRING_CONST_SPEC },
      },
      refine: {
        note: 'joiningのoverloadは「全てnull」「delimiterのみ」「3つすべて指定」の3形だけです。',
        check: (obj, path) => {
          const issues: ValidationIssue[] = []
          if ((obj['prefix'] === null) !== (obj['suffix'] === null)) {
            issues.push(schemaIssue('prefixとsuffixは両方指定が必要です', `${path}.prefix`))
          }
          if (obj['delimiter'] === null && obj['prefix'] !== null) {
            issues.push(
              schemaIssue('prefix / suffixを使う場合はdelimiterが必要です', `${path}.delimiter`),
            )
          }
          return issues
        },
      },
    },
    counting: { fields: {} },
    minBy: { fields: { comparator: comparatorSpec(['natural', 'employeeKeys'], EMPLOYEE_COMPARATOR_FIELDS) } },
    maxBy: { fields: { comparator: comparatorSpec(['natural', 'employeeKeys'], EMPLOYEE_COMPARATOR_FIELDS) } },
    // employeeFieldSumは1引数reducing（BinaryOperator）では成立しないため許可しない
    reducing: { fields: { reduction: reductionSpec(['numericSum', 'stringConcat']) } },
    mapping: {
      fields: { mapper: mapperSpec(Object.keys(MAPPER_VARIANTS)), downstream: child },
    },
    filtering: { fields: { predicate: COLLECTOR_PREDICATE_SPEC, downstream: child } },
    flatMapping: {
      fields: { mapper: mapperSpec(Object.keys(MAPPER_VARIANTS)), downstream: child },
    },
    collectingAndThen: {
      fields: {
        downstream: child,
        finisherId: { node: 'enum', values: [...COLLECTOR_FINISHER_IDS], label: 'finisherId' },
      },
    },
    groupingBy: {
      fields: {
        classifier: CLASSIFIER_SPEC,
        mapFactoryId: {
          node: 'nullable',
          inner: { node: 'enum', values: [...COLLECTOR_MAP_FACTORY_IDS], label: 'mapFactoryId' },
        },
        downstream: nullableChild,
      },
      refine: {
        note: 'ComparatorなしのTreeMap::newはComparableなキー（employeeField / departmentField）とだけ組み合わせられます。',
        check: (obj, path) => {
          const mapFactoryId = obj['mapFactoryId']
          if (mapFactoryId === null) return []
          const meta =
            COLLECTOR_MAP_FACTORY_META[String(mapFactoryId) as keyof typeof COLLECTOR_MAP_FACTORY_META]
          if (!meta?.jdkOrdered) return []
          const classifierKind = (obj['classifier'] as Record<string, unknown> | null)?.['kind']
          return COMPARABLE_CLASSIFIER_KINDS.includes(
            classifierKind as (typeof COMPARABLE_CLASSIFIER_KINDS)[number],
          )
            ? []
            : [
                schemaIssue(
                  `${String(mapFactoryId)}（Comparatorなし）はComparableでないキー（${String(classifierKind)}）と組み合わせられません`,
                  `${path}.mapFactoryId`,
                ),
              ]
        },
      },
    },
    partitioningBy: {
      fields: { predicate: COLLECTOR_PREDICATE_SPEC, downstream: nullableChild },
    },
    teeing: {
      fields: {
        left: child,
        right: child,
        mergerId: { node: 'enum', values: [...TEEING_MERGER_IDS], label: 'mergerId' },
      },
    },
  }
  for (const kind of COLLECTOR_NUMERIC_KINDS) {
    const expectedField = COLLECTOR_NUMERIC_FIELD_BY_PRIMITIVE[numericKindPrimitive(kind)]
    all[kind] = { fields: { field: { node: 'const', value: expectedField } } }
  }
  return all
}

/**
 * 許可kindに対応するCollector variant定義を返す（プロンプト生成が言語化に使う）。
 * 許可範囲そのものはこのモジュールが単一定義源である。
 */
export function collectorVariantsFor(
  allowedKinds: readonly string[],
): Readonly<Record<string, VariantSpec>> {
  const all = collectorVariants(allowedKinds)
  return pickVariants(all, allowedKinds)
}

/** Collector ASTの検証（深さ上限つき再帰） */
function collectorSpecIssues(
  allowedKinds: readonly string[],
  value: unknown,
  path: string,
  depth: number,
): ValidationIssue[] {
  if (depth > COLLECTOR_MAX_DEPTH) {
    return [
      issue(
        'IMPORT_SCHEMA',
        `Collectorの入れ子は${COLLECTOR_MAX_DEPTH}段までです（教材制約）`,
        path,
      ),
    ]
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [schemaIssue('collectorはオブジェクトが必要です', path)]
  }
  const obj = value as Record<string, unknown>
  const variants = collectorVariants(allowedKinds)
  const kind = obj['kind']
  if (typeof kind !== 'string' || !allowedKinds.includes(kind) || !(kind in variants)) {
    return [
      schemaIssue(
        `collectorのkindは次のいずれかが必要です: ${allowedKinds.join(' / ')}（実際: ${JSON.stringify(kind)}）`,
        `${path}.kind`,
      ),
    ]
  }
  const variant = variants[kind] as VariantSpec
  const issues: ValidationIssue[] = []
  const allowedFieldKeys = ['kind', ...Object.keys(variant.fields)]
  for (const key of Object.keys(obj)) {
    if (!allowedFieldKeys.includes(key)) {
      issues.push(schemaIssue(`許可されていないキーです: ${key}`, `${path}.${key}`))
    }
  }
  for (const [key, fieldSpec] of Object.entries(variant.fields)) {
    if (!(key in obj)) {
      issues.push(schemaIssue(`必須キーがありません: ${key}`, `${path}.${key}`))
      continue
    }
    const childValue = obj[key]
    if (fieldSpec.node === 'collector') {
      issues.push(...collectorSpecIssues(allowedKinds, childValue, `${path}.${key}`, depth + 1))
    } else if (fieldSpec.node === 'nullable' && fieldSpec.inner.node === 'collector') {
      if (childValue !== null) {
        issues.push(...collectorSpecIssues(allowedKinds, childValue, `${path}.${key}`, depth + 1))
      }
    } else {
      issues.push(...validateBySpec(fieldSpec, childValue, `${path}.${key}`))
    }
  }
  if (issues.length === 0 && variant.refine) {
    issues.push(...variant.refine.check(obj, path))
  }
  return issues
}

// ---- TemplateContract ----

export interface SlotContract {
  readonly slotId: string
  readonly required: boolean
  /** slot種別（プロンプトの説明に使う） */
  readonly role: string
  readonly spec: SpecNode
}

/**
 * templateごとの取込契約。
 *
 * プロンプト生成（`describeSpec`）と前段検証（`validateCandidateShape`）は、
 * **このオブジェクトが持つspecノードだけ**を走査する。
 * トップレベルのキー集合・dataset・title・descriptionもここへ含め、
 * 片方だけが別経路で許可範囲を組み立てることがないようにする（v0.10 §5.2）。
 */
export interface TemplateContract {
  readonly templateId: string
  readonly templateVersion: number
  readonly supportedModes: readonly string[]
  /** 取込対象か（実行不能templateは対象外。v0.10 §5.1） */
  readonly importable: boolean
  readonly disabledReason: string | null
  /** Employee系templateはdataset必須、source slot型templateはdataset禁止（v0.10 §5.1） */
  readonly datasetPolicy: 'required' | 'forbidden'
  /** 貼付JSONのトップレベルで許可するキー（datasetPolicyを反映済み） */
  readonly topLevelKeys: readonly string[]
  /** トップレベルのキーごとの型（closed schemaの型検査とプロンプトの双方が使う） */
  readonly topLevelTypes: Readonly<Record<string, TopLevelType>>
  /** 貼付JSONへ含めてはならないトップレベルキー（アプリが付与する） */
  readonly reservedTopLevelKeys: readonly string[]
  /** dataset要素へ含めてはならないキー（アプリが再付番する） */
  readonly reservedDatasetKeys: readonly string[]
  /** datasetのspec（datasetPolicyが'forbidden'ならnull） */
  readonly datasetSpec: SpecNode | null
  readonly titleSpec: SpecNode
  readonly descriptionSpec: SpecNode
  /** 貼付テキスト全体の上限（UTF-16 code unit） */
  readonly textMaxLength: number
  readonly slots: readonly SlotContract[]
  /** templateのノード列（プロンプトの構造説明に使う） */
  readonly nodeSummary: readonly string[]
}

function slotSpecOf(slot: ParameterSlot, template: PipelineTemplate): SpecNode {
  switch (slot.kind) {
    case 'predicate':
      return predicateSpec(
        template.allowedDslProfile.predicateKinds,
        slot.allowedFields,
        slot.allowedOperators,
        'predicate',
      )
    case 'mapper':
      return mapperSpec(slot.allowedMapperKinds)
    case 'source':
      return sourceSpec(slot.allowedSourceKinds)
    case 'comparator':
      return comparatorSpec(slot.allowedComparatorKinds, slot.allowedFields)
    case 'consumer':
      return consumerSpec(slot.allowedConsumerKinds, slot.allowedFields)
    case 'count':
      return { node: 'count' }
    case 'reduction':
      return reductionSpec(slot.allowedReductionKinds)
    case 'identity':
      return IDENTITY_SPEC
    case 'arrayGenerator':
      return arrayGeneratorSpec(slot.allowedElementTypeNames)
    case 'collector':
      return { node: 'collector', allowedKinds: slot.allowedCollectorKinds }
    case 'collectTriple':
      return COLLECT_TRIPLE_SPEC
  }
}

/** templateがEmployee dataset（collection source）を使うか */
export function usesEmployeeDataset(template: PipelineTemplate): boolean {
  const definition = template.sourceDefinition
  if (definition.defaultDsl?.kind === 'collection') return true
  return definition.slotId !== null && definition.allowedSourceKinds.includes('collection')
}

/**
 * templateからImport Contractを導出する。
 * 許可範囲の元になるのは既存のtemplate slot定義（`allowed*`）とAST定義であり、
 * Contract側で新たな許可範囲を発明しない（不足していた値域・上限だけを補う）。
 */
export function buildTemplateContract(template: PipelineTemplate): TemplateContract {
  const slots: SlotContract[] = []
  const sourceDefinition = template.sourceDefinition
  if (sourceDefinition.slotId !== null) {
    slots.push({
      slotId: sourceDefinition.slotId,
      required: sourceDefinition.defaultDsl === null,
      role: 'source',
      spec: sourceSpec(sourceDefinition.allowedSourceKinds),
    })
  }
  for (const slot of template.parameterSlots) {
    slots.push({
      slotId: slot.slotId,
      required: slot.required,
      role: slot.kind,
      spec: slotSpecOf(slot, template),
    })
  }
  const datasetPolicy = usesEmployeeDataset(template) ? 'required' : 'forbidden'
  return {
    templateId: template.templateId,
    templateVersion: template.version,
    supportedModes: template.supportedModes,
    importable: template.executable !== false,
    disabledReason: template.executable === false ? (template.disabledReason ?? null) : null,
    datasetPolicy,
    topLevelKeys: TOP_LEVEL_KEYS.filter((key) => key !== 'dataset' || datasetPolicy === 'required'),
    topLevelTypes: TOP_LEVEL_TYPES,
    reservedTopLevelKeys: RESERVED_TOP_LEVEL_KEYS,
    reservedDatasetKeys: RESERVED_DATASET_KEYS,
    datasetSpec: datasetPolicy === 'required' ? DATASET_SPEC : null,
    titleSpec: TITLE_SPEC,
    descriptionSpec: DESCRIPTION_SPEC,
    textMaxLength: IMPORT_TEXT_MAX_LENGTH,
    slots,
    nodeSummary: template.nodes.map((node) => `${node.nodeId}（${node.operationId} / ${node.role}）`),
  }
}

// ---- トップレベルcandidate schema（v0.10 §6.1） ----

/** 貼付JSONのトップレベルで許可するキー（datasetはdatasetPolicyで決まる） */
export const TOP_LEVEL_KEYS: readonly string[] = [
  'dslVersion',
  'templateId',
  'templateVersion',
  'mode',
  'dataset',
  'dslParameters',
  'title',
  'description',
]

export type TopLevelType = 'string' | 'number' | 'object' | 'array'

/** トップレベルキーのJSON型（closed schemaの型検査とプロンプトの双方が参照する） */
export const TOP_LEVEL_TYPES: Readonly<Record<string, TopLevelType>> = {
  dslVersion: 'string',
  templateId: 'string',
  templateVersion: 'number',
  mode: 'string',
  dataset: 'array',
  dslParameters: 'object',
  title: 'string',
  description: 'string',
}

/** 貼付JSONへ含めてはならないキー（アプリが付与する。v0.10 §6.1） */
export const RESERVED_TOP_LEVEL_KEYS: readonly string[] = [
  'providerKind',
  'provenance',
  'revision',
]

/** datasetの各要素へ含めてはならないキー（アプリが再付番する） */
export const RESERVED_DATASET_KEYS: readonly string[] = ['elementId']

/** 取込時に一致検証する選択中の文脈（v0.10 §6.1） */
export interface ImportContext {
  readonly dslVersion: string
  readonly templateId: string
  readonly templateVersion: number
  readonly mode: string
}

/** Contract検証を通過した貼付JSONの内容（アプリ付与項目は含まない） */
export interface CandidateShape {
  readonly dataset: readonly EmployeeValue[]
  readonly dslParameters: Readonly<Record<string, unknown>>
  readonly title: string
  readonly description: string
}

function contextIssue(message: string, path: string): ValidationIssue {
  return issue('IMPORT_CONTEXT_MISMATCH', message, path)
}

/**
 * 貼付JSONのcandidate schema検証（v0.10 §6.1〜§6.4、§7.2手順4）。
 *
 * 先にトップレベルのclosed schemaとキー型を検証し、文脈（templateId等）の不一致があれば
 * その時点で返す（別templateの候補に対して後段のslot検証を並べても修正の役に立たないため）。
 * 文脈が一致していれば、dataset・dslParameters・title / descriptionの違反をすべて集めて返す。
 */
export function validateCandidateShape(
  contract: TemplateContract,
  context: ImportContext,
  parsed: unknown,
): Result<CandidateShape> {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail([schemaIssue('貼付JSONのトップレベルはオブジェクトが必要です', '')])
  }
  const obj = parsed as Record<string, unknown>
  const datasetRequired = contract.datasetPolicy === 'required'
  const allowedKeys = contract.topLevelKeys

  const structureIssues: ValidationIssue[] = []
  for (const key of Object.keys(obj)) {
    if (allowedKeys.includes(key)) continue
    if (contract.reservedTopLevelKeys.includes(key)) {
      structureIssues.push(
        schemaIssue(`${key}はアプリが付与するため貼付JSONへ含められません`, key),
      )
    } else if (key === 'dataset') {
      structureIssues.push(
        schemaIssue(
          'このtemplateはdatasetを使用しないため、datasetキーは指定できません（source slotで入力を表現します）',
          'dataset',
        ),
      )
    } else {
      structureIssues.push(schemaIssue(`許可されていないキーです: ${key}`, key))
    }
  }
  for (const key of allowedKeys) {
    if (!(key in obj)) structureIssues.push(schemaIssue(`必須キーがありません: ${key}`, key))
  }
  for (const key of allowedKeys) {
    if (!(key in obj)) continue
    const value = obj[key]
    const expected = contract.topLevelTypes[key]
    const ok =
      expected === 'array'
        ? Array.isArray(value)
        : expected === 'object'
          ? typeof value === 'object' && value !== null && !Array.isArray(value)
          : typeof value === expected
    if (!ok) {
      structureIssues.push(schemaIssue(`${key}は${expected}が必要です`, key))
    }
  }
  if (structureIssues.length > 0) return fail(structureIssues)

  // 文脈の一致検証（型は上で確定済み）
  const contextIssues: ValidationIssue[] = []
  if (obj['dslVersion'] !== context.dslVersion) {
    contextIssues.push(
      contextIssue(
        `dslVersionが選択中と一致しません（期待: ${context.dslVersion} / 実際: ${String(obj['dslVersion'])}）`,
        'dslVersion',
      ),
    )
  }
  if (obj['templateId'] !== context.templateId) {
    contextIssues.push(
      contextIssue(
        `templateIdが選択中と一致しません（期待: ${context.templateId} / 実際: ${String(obj['templateId'])}）`,
        'templateId',
      ),
    )
  }
  const templateVersion = obj['templateVersion'] as number
  if (!Number.isInteger(templateVersion) || templateVersion < 1) {
    contextIssues.push(
      contextIssue(`templateVersionは1以上の整数が必要です（実際: ${templateVersion}）`, 'templateVersion'),
    )
  } else if (templateVersion !== context.templateVersion) {
    contextIssues.push(
      contextIssue(
        `templateVersionが選択中と一致しません（期待: ${context.templateVersion} / 実際: ${templateVersion}）`,
        'templateVersion',
      ),
    )
  }
  if (obj['mode'] !== context.mode) {
    contextIssues.push(
      contextIssue(
        `modeが選択中と一致しません（期待: ${context.mode} / 実際: ${String(obj['mode'])}）`,
        'mode',
      ),
    )
  }
  if (contextIssues.length > 0) return fail(contextIssues)

  const issues: ValidationIssue[] = []

  // dataset（Employee系templateのみ。specはContractが持つ）
  if (contract.datasetSpec) {
    issues.push(...validateBySpec(contract.datasetSpec, obj['dataset'], 'dataset'))
  }

  // dslParameters（closed schema: templateの公開スロットIDのみ）
  const rawParameters = obj['dslParameters'] as Record<string, unknown>
  const slotIds = contract.slots.map((slot) => slot.slotId)
  for (const key of Object.keys(rawParameters)) {
    if (!slotIds.includes(key)) {
      issues.push(schemaIssue(`未定義のslotです: ${key}`, `dslParameters.${key}`))
    }
  }
  for (const slot of contract.slots) {
    const path = `dslParameters.${slot.slotId}`
    if (!(slot.slotId in rawParameters)) {
      if (slot.required) issues.push(schemaIssue(`必須slotが欠落しています: ${slot.slotId}`, path))
      continue
    }
    issues.push(...validateBySpec(slot.spec, rawParameters[slot.slotId], path))
  }

  // title / descriptionはtrim後の値を採用・保存する（v0.10 §6.4）
  const title = String(obj['title']).trim()
  const description = String(obj['description']).trim()
  issues.push(...validateBySpec(contract.titleSpec, title, 'title'))
  issues.push(...validateBySpec(contract.descriptionSpec, description, 'description'))

  if (issues.length > 0) return fail(issues)
  return ok({
    dataset: datasetRequired ? (obj['dataset'] as readonly EmployeeValue[]) : [],
    dslParameters: rawParameters,
    title,
    description,
  })
}
