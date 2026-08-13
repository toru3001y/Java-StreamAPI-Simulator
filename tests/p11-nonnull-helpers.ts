import type { OperationCatalog } from '../src/domain/catalog/operationCatalog'
import type { SourceDsl } from '../src/domain/dsl/sourceAst'
import type { DatasetElement } from '../src/domain/model/employee'
import type { SimValue, SimValueKind } from '../src/domain/model/value'
import type { TypeRef } from '../src/domain/types/typeRef'
import {
  CLASSIFIER_DEPARTMENT_FIELDS,
  CLASSIFIER_DSL_KINDS,
  CLASSIFIER_EMPLOYEE_FIELDS,
  TO_MAP_MERGE_IDS,
  TO_MAP_VALUE_KINDS,
} from '../src/domain/dsl/collectorAst'
import {
  GATHERER_DSL_KINDS,
  GATHER_ACCUMULATION_KINDS,
  GATHER_FIELD_PRIMITIVE,
  GATHER_FIELD_WHITELIST,
} from '../src/domain/dsl/gatherAst'
import { MAPPER_DSL_KINDS } from '../src/domain/dsl/mapperAst'
import {
  ALLOWED_GENERATE_RULES,
  ALLOWED_ITERATE_OPERATORS,
  ITERATE_PREDICATE_OPERATORS,
  SOURCE_COLLECTION_IDS,
  SOURCE_DSL_KINDS,
  UNBOUNDED_SOURCE_KINDS,
} from '../src/domain/dsl/sourceAst'
import { sourceElementType } from '../src/domain/dsl/validateSource'
import { EMPLOYEE_FIELDS } from '../src/domain/model/employee'
import { SIM_VALUE_KINDS } from '../src/domain/model/value'
import { STANDARD_EMPLOYEES } from '../src/domain/fixtures/employees'
import { MERGE_DEMO_EMPLOYEES } from '../src/domain/fixtures/mergeDemoEmployees'

/**
 * v0.14 §4「非null不変条件」の機械検証機構。
 *
 * 3層構成:
 *   1. 評価器単位の列挙評価（互換直積）
 *   2. 境界到達の実行検証（全template × mode + producer別local到達）
 *   3. 網羅性assert（値variant網羅性・producer登録集合の機械導出・完了状態・変更感知型負例）
 *
 * 登録集合は手作業の一覧ではなく、**実装上閉じた構造**（OperationCatalog・識別可能unionの
 * 下位ホワイトリスト・closed DSL定数）から導出する。導出元へ新しいoperation / kind /
 * 下位定数が加わると、分類・展開の未定義として**機械的に失敗**する。
 */

// ---- 意味値検査器（§4「検査対象の定義」） ----

/**
 * 検査するのはSimValueオブジェクトの存在ではなく、**SimValueが保持するJavaの意味上の実値**。
 * 合成List・stringList・Map entry等の複合値は再帰的に全要素を検査する。
 */
export type MeaningChecker = (value: SimValue, path: string) => void

function requireDefined(value: unknown, path: string): void {
  if (value === null || value === undefined) {
    throw new Error(`意味値がnull / undefinedです: ${path} = ${String(value)}`)
  }
}

function requireString(value: unknown, path: string): void {
  requireDefined(value, path)
  if (typeof value !== 'string') throw new Error(`意味値が文字列ではありません: ${path}`)
}

function requireNumber(value: unknown, path: string): void {
  requireDefined(value, path)
  if (typeof value !== 'number') throw new Error(`意味値が数値ではありません: ${path}`)
}

function checkNumberArray(values: unknown, path: string): void {
  requireDefined(values, path)
  if (!Array.isArray(values)) throw new Error(`意味値が配列ではありません: ${path}`)
  values.forEach((n, i) => requireNumber(n, `${path}[${i}]`))
}

function checkDepartmentValue(dept: unknown, path: string): void {
  requireDefined(dept, path)
  const record = dept as Record<string, unknown>
  requireString(record['name'], `${path}.name`)
  requireString(record['division'], `${path}.division`)
}

function checkEmployeeValue(employee: unknown, path: string): void {
  requireDefined(employee, path)
  const e = employee as Record<string, unknown>
  // Employee recordの全フィールドを再帰検査する（フィールド集合はEMPLOYEE_FIELDSから導出）
  for (const fieldName of Object.keys(EMPLOYEE_FIELDS)) {
    requireDefined(e[fieldName], `${path}.${fieldName}`)
  }
  requireString(e['name'], `${path}.name`)
  requireString(e['region'], `${path}.region`)
  requireString(e['hireDate'], `${path}.hireDate`)
  requireNumber(e['age'], `${path}.age`)
  requireNumber(e['salary'], `${path}.salary`)
  requireNumber(e['evaluation'], `${path}.evaluation`)
  checkDepartmentValue(e['department'], `${path}.department`)
  const skills = e['skills']
  requireDefined(skills, `${path}.skills`)
  if (!Array.isArray(skills)) throw new Error(`skillsが配列ではありません: ${path}.skills`)
  skills.forEach((s, i) => requireString(s, `${path}.skills[${i}]`))
}

/** SimValueの全variantに対する意味値検査器（網羅性は3層目がassertする） */
export const MEANING_CHECKERS: Readonly<Record<SimValueKind, MeaningChecker>> = {
  employee: (v, path) => {
    if (v.kind !== 'employee') throw new Error(`kind不一致: ${path}`)
    checkEmployeeValue(v.value, `${path}.value`)
  },
  department: (v, path) => {
    if (v.kind !== 'department') throw new Error(`kind不一致: ${path}`)
    checkDepartmentValue(v.value, `${path}.value`)
  },
  localDate: (v, path) => requireString((v as { value: unknown }).value, `${path}.value`),
  string: (v, path) => requireString((v as { value: unknown }).value, `${path}.value`),
  int: (v, path) => requireNumber((v as { value: unknown }).value, `${path}.value`),
  long: (v, path) => requireNumber((v as { value: unknown }).value, `${path}.value`),
  double: (v, path) => requireNumber((v as { value: unknown }).value, `${path}.value`),
  boxedInt: (v, path) => requireNumber((v as { value: unknown }).value, `${path}.value`),
  boxedLong: (v, path) => requireNumber((v as { value: unknown }).value, `${path}.value`),
  boxedDouble: (v, path) => requireNumber((v as { value: unknown }).value, `${path}.value`),
  stringList: (v, path) => {
    if (v.kind !== 'stringList') throw new Error(`kind不一致: ${path}`)
    requireDefined(v.value, `${path}.value`)
    v.value.forEach((s, i) => requireString(s, `${path}.value[${i}]`))
  },
  list: (v, path) => {
    if (v.kind !== 'list') throw new Error(`kind不一致: ${path}`)
    requireDefined(v.elementType, `${path}.elementType`)
    requireDefined(v.value, `${path}.value`)
    // 合成List値は再帰的に全要素を検査する（§4）
    v.value.forEach((child, i) => checkMeaningValue(child, `${path}.value[${i}]`))
  },
  intArray: (v, path) => checkNumberArray((v as { value: unknown }).value, `${path}.value`),
  longArray: (v, path) => checkNumberArray((v as { value: unknown }).value, `${path}.value`),
  doubleArray: (v, path) => checkNumberArray((v as { value: unknown }).value, `${path}.value`),
}

/**
 * 意味値の再帰検査。未定義variantはthrowする
 * （検査器の定義漏れが黙って通らないための防波堤）。
 */
export function checkMeaningValue(value: SimValue, path = 'value'): void {
  requireDefined(value, path)
  const checker = (MEANING_CHECKERS as Record<string, MeaningChecker | undefined>)[value.kind]
  if (!checker) throw new Error(`意味値検査器が未定義のvariantです: ${value.kind}（${path}）`)
  checker(value, path)
}

// ---- OperationCatalogの全域分類（§4-3(i)） ----

export type OperationClass = 'VALUE_PRODUCING' | 'NON_PRODUCING'

/**
 * 全operationの値生成 / 非値生成分類。**未分類のoperationが1件でもあれば導出が失敗する**。
 *
 * - `VALUE_PRODUCING`: 新しい要素値を生み出す（source・map系・boxed・gather）
 * - `NON_PRODUCING`: 既存値の選別・保持・通過（filter / distinct / sorted / limit / skip /
 *   takeWhile / dropWhile / peek）、または下流要素を生成しない終端（terminal・collector系）
 */
export const OPERATION_CLASSIFICATION: Readonly<Record<string, OperationClass>> = {
  'source.collectionStream': 'VALUE_PRODUCING',
  'source.arraysStream': 'VALUE_PRODUCING',
  'source.streamOf': 'VALUE_PRODUCING',
  'source.generate': 'VALUE_PRODUCING',
  'source.iterate2': 'VALUE_PRODUCING',
  'source.iterate3': 'VALUE_PRODUCING',
  'source.range': 'VALUE_PRODUCING',
  'source.rangeClosed': 'VALUE_PRODUCING',
  'source.empty': 'VALUE_PRODUCING',
  map: 'VALUE_PRODUCING',
  mapToInt: 'VALUE_PRODUCING',
  mapToLong: 'VALUE_PRODUCING',
  mapToDouble: 'VALUE_PRODUCING',
  mapToObj: 'VALUE_PRODUCING',
  boxed: 'VALUE_PRODUCING',
  flatMap: 'VALUE_PRODUCING',
  flatMapToInt: 'VALUE_PRODUCING',
  flatMapToLong: 'VALUE_PRODUCING',
  flatMapToDouble: 'VALUE_PRODUCING',
  gather: 'VALUE_PRODUCING',
  filter: 'NON_PRODUCING',
  distinct: 'NON_PRODUCING',
  sorted: 'NON_PRODUCING',
  limit: 'NON_PRODUCING',
  skip: 'NON_PRODUCING',
  takeWhile: 'NON_PRODUCING',
  dropWhile: 'NON_PRODUCING',
  peek: 'NON_PRODUCING',
  toList: 'NON_PRODUCING',
  reduce: 'NON_PRODUCING',
  count: 'NON_PRODUCING',
  min: 'NON_PRODUCING',
  max: 'NON_PRODUCING',
  findFirst: 'NON_PRODUCING',
  findAny: 'NON_PRODUCING',
  anyMatch: 'NON_PRODUCING',
  allMatch: 'NON_PRODUCING',
  noneMatch: 'NON_PRODUCING',
  sum: 'NON_PRODUCING',
  average: 'NON_PRODUCING',
  summaryStatistics: 'NON_PRODUCING',
  toArray: 'NON_PRODUCING',
  forEach: 'NON_PRODUCING',
  forEachOrdered: 'NON_PRODUCING',
  collect: 'NON_PRODUCING',
  collectTriple: 'NON_PRODUCING',
}

/**
 * catalogの全operationを分類する。未分類が1件でもあればthrow（§4-3(i)）。
 * 分類表に載っていない新しいoperationの追加が、そのまま検出の起点になる。
 */
export function classifyOperations(
  catalog: OperationCatalog,
  classification: Readonly<Record<string, OperationClass>> = OPERATION_CLASSIFICATION,
): { valueProducing: string[]; nonProducing: string[] } {
  const valueProducing: string[] = []
  const nonProducing: string[] = []
  for (const operation of catalog.list()) {
    const assigned = classification[operation.operationId]
    if (!assigned) {
      throw new Error(
        `値生成 / 非値生成の分類が未定義のoperationです: ${operation.operationId}（v0.14 §4-3の全域分類）`,
      )
    }
    if (assigned === 'VALUE_PRODUCING') valueProducing.push(operation.operationId)
    else nonProducing.push(operation.operationId)
  }
  return { valueProducing, nonProducing }
}

// ---- producerの導出（§4-3(ii)(iii)） ----

export type ProducerFamily =
  | 'source'
  | 'mapper'
  | 'flatMapper'
  | 'boxed'
  | 'gather'
  | 'classifier'
  | 'toMapValue'
  | 'merge'

export interface Producer {
  /** 実軸まで分解したproducer ID（例: `source.arrayPrimitive:int`） */
  readonly id: string
  readonly family: ProducerFamily
  /**
   * 起点となるOperationCatalogのoperationId（v0.14 §4-3(ii)）。
   * collector内部評価器（classifier / toMapValue / merge）はOperationCatalogのoperationでは
   * ないため**null**とし、operation由来producerと区分する（§4-3(iii)）。
   * `deriveProducers`はこの値を使い、値生成operation集合との双方向一致を検証する。
   */
  readonly operationId: string | null
  /** 生成側のDSL（familyごとに型が異なる） */
  readonly dsl: unknown
  /** sourceのみ: 具現化に使うdataset */
  readonly dataset?: readonly DatasetElement[]
  /** sourceのみ: 有限化（limit）が必要か */
  readonly unbounded?: boolean
  /** sourceのみ: 要素TypeRef */
  readonly elementType?: TypeRef
  /** sourceのみ: 仕様どおり0件放出（empty系） */
  readonly zeroEmission?: boolean
}

/**
 * producer導出の入力軸。**実装上閉じた定数**を引数で受け取り、
 * 変更感知型負例テストが複製へ仮想要素を注入できるようにする（§4-3の負例メタテスト）。
 */
export interface ProducerAxes {
  readonly sourceKinds: readonly string[]
  readonly sourceCollectionIds: readonly string[]
  readonly primitives: readonly string[]
  readonly generateRules: readonly string[]
  readonly iterateOperators: readonly string[]
  readonly iteratePredicateOperators: readonly string[]
  readonly emptyStreamTypes: readonly string[]
  readonly mapperKinds: readonly string[]
  readonly employeeFields: readonly string[]
  readonly gathererKinds: readonly string[]
  readonly gatherAccumulationKinds: readonly string[]
  readonly gatherFields: readonly string[]
  readonly classifierKinds: readonly string[]
  readonly classifierEmployeeFields: readonly string[]
  readonly classifierDepartmentFields: readonly string[]
  readonly toMapValueKinds: readonly string[]
  readonly toMapMergeIds: readonly string[]
}

export const PRIMITIVE_NAMES = ['int', 'long', 'double'] as const

export function defaultProducerAxes(): ProducerAxes {
  return {
    sourceKinds: [...SOURCE_DSL_KINDS],
    sourceCollectionIds: [...SOURCE_COLLECTION_IDS],
    primitives: [...PRIMITIVE_NAMES],
    generateRules: [...ALLOWED_GENERATE_RULES],
    iterateOperators: [...ALLOWED_ITERATE_OPERATORS],
    iteratePredicateOperators: [...ITERATE_PREDICATE_OPERATORS],
    emptyStreamTypes: ['object', ...PRIMITIVE_NAMES],
    mapperKinds: [...MAPPER_DSL_KINDS],
    employeeFields: Object.keys(EMPLOYEE_FIELDS),
    gathererKinds: [...GATHERER_DSL_KINDS],
    gatherAccumulationKinds: [...GATHER_ACCUMULATION_KINDS],
    gatherFields: [...GATHER_FIELD_WHITELIST],
    classifierKinds: [...CLASSIFIER_DSL_KINDS],
    classifierEmployeeFields: [...CLASSIFIER_EMPLOYEE_FIELDS],
    classifierDepartmentFields: [...CLASSIFIER_DEPARTMENT_FIELDS],
    toMapValueKinds: [...TO_MAP_VALUE_KINDS],
    toMapMergeIds: [...TO_MAP_MERGE_IDS],
  }
}

function datasetOf(collectionId: string): readonly DatasetElement[] {
  if (collectionId === 'employees') return STANDARD_EMPLOYEES
  if (collectionId === 'employeesMergeDemo') return MERGE_DEMO_EMPLOYEES
  throw new Error(`datasetが未定義のcollection IDです（producer導出の未定義）: ${collectionId}`)
}

/**
 * source DSL kind → 起点operationId（単一定義源）。
 * 未対応kindはthrowし、producer展開の未定義を検出する。
 */
export function sourceOperationIdOf(dsl: SourceDsl): string {
  switch (dsl.kind) {
    case 'collection':
      return 'source.collectionStream'
    case 'arrayObject':
    case 'arrayPrimitive':
      return 'source.arraysStream'
    case 'streamOf':
    case 'streamOfPrimitiveArrays':
    case 'nestedStringList':
      return 'source.streamOf'
    case 'generate':
      return 'source.generate'
    case 'iterate2':
      return 'source.iterate2'
    case 'iterate3':
      return 'source.iterate3'
    case 'range':
      return 'source.range'
    case 'rangeClosed':
      return 'source.rangeClosed'
    case 'empty':
      return 'source.empty'
  }
}

function sourceProducer(id: string, dsl: SourceDsl, dataset: readonly DatasetElement[] = []): Producer {
  return {
    id,
    family: 'source',
    operationId: sourceOperationIdOf(dsl),
    dsl,
    dataset,
    unbounded: UNBOUNDED_SOURCE_KINDS.includes(dsl.kind),
    elementType: sourceElementType(dsl),
    zeroEmission: dsl.kind === 'empty',
  }
}

function expandSourceProducers(axes: ProducerAxes): Producer[] {
  const out: Producer[] = []
  for (const kind of axes.sourceKinds) {
    switch (kind) {
      case 'collection':
        for (const collectionId of axes.sourceCollectionIds) {
          out.push(
            sourceProducer(
              `source.collection:${collectionId}`,
              { kind: 'collection', collectionId: collectionId as 'employees' },
              datasetOf(collectionId),
            ),
          )
        }
        break
      case 'arrayObject':
        out.push(
          sourceProducer('source.arrayObject:String', {
            kind: 'arrayObject',
            arrayId: 'names',
            elementTypeName: 'String',
            values: ['alpha', 'beta'],
          }),
        )
        break
      case 'arrayPrimitive':
        for (const primitive of axes.primitives) {
          out.push(
            sourceProducer(`source.arrayPrimitive:${primitive}`, {
              kind: 'arrayPrimitive',
              arrayId: 'nums',
              primitive: primitive as 'int',
              values: [1, 2, 3],
            }),
          )
        }
        break
      case 'streamOf':
        out.push(
          sourceProducer('source.streamOf:String', {
            kind: 'streamOf',
            elementTypeName: 'String',
            values: ['x', 'y'],
          }),
        )
        break
      case 'streamOfPrimitiveArrays':
        for (const primitive of axes.primitives) {
          out.push(
            sourceProducer(`source.streamOfPrimitiveArrays:${primitive}`, {
              kind: 'streamOfPrimitiveArrays',
              primitive: primitive as 'int',
              arrays: [
                [1, 2],
                [3, 4],
              ],
            }),
          )
        }
        break
      case 'nestedStringList':
        out.push(
          sourceProducer('source.nestedStringList:String', {
            kind: 'nestedStringList',
            listId: 'nested',
            values: [['a', 'b'], ['c']],
          }),
        )
        break
      case 'generate':
        for (const ruleId of axes.generateRules) {
          out.push(sourceProducer(`source.generate:${ruleId}`, { kind: 'generate', ruleId }))
        }
        break
      case 'iterate2':
        for (const ruleId of axes.iterateOperators) {
          out.push(
            sourceProducer(`source.iterate2:${ruleId}`, {
              kind: 'iterate2',
              seed: 1,
              operator: { ruleId: ruleId as 'increment', step: 1 },
            }),
          )
        }
        break
      case 'iterate3':
        for (const ruleId of axes.iterateOperators) {
          for (const operator of axes.iteratePredicateOperators) {
            out.push(
              sourceProducer(`source.iterate3:${ruleId}:${operator}`, {
                kind: 'iterate3',
                seed: 1,
                predicate: { operator: operator as 'LTE', value: 4 },
                operator: { ruleId: ruleId as 'increment', step: 1 },
              }),
            )
          }
        }
        break
      case 'range':
        out.push(sourceProducer('source.range:int', { kind: 'range', from: 1, to: 4 }))
        break
      case 'rangeClosed':
        out.push(sourceProducer('source.rangeClosed:int', { kind: 'rangeClosed', from: 1, to: 3 }))
        break
      case 'empty':
        for (const streamType of axes.emptyStreamTypes) {
          out.push(
            sourceProducer(`source.empty:${streamType}`, {
              kind: 'empty',
              streamType: streamType as 'object',
              elementTypeName: streamType === 'object' ? 'String' : streamType,
            }),
          )
        }
        break
      default:
        throw new Error(`producer展開が未定義のsource kindです: ${kind}（v0.14 §4-3の互換直積）`)
    }
  }
  return out
}

/** primitive別のmapToXxx / flatMapToXxx operationId（単一定義源） */
export function mapToPrimitiveOperationId(primitive: string): string {
  if (primitive === 'int') return 'mapToInt'
  if (primitive === 'long') return 'mapToLong'
  if (primitive === 'double') return 'mapToDouble'
  throw new Error(`producer展開が未定義のprimitiveです: ${primitive}（mapToXxx）`)
}

export function flatMapToPrimitiveOperationId(primitive: string): string {
  if (primitive === 'int') return 'flatMapToInt'
  if (primitive === 'long') return 'flatMapToLong'
  if (primitive === 'double') return 'flatMapToDouble'
  throw new Error(`producer展開が未定義のprimitiveです: ${primitive}（flatMapToXxx）`)
}

/** mapper kind × 下位軸の候補（型適合はバリデータ受理でフィルタする） */
function expandMapperProducers(axes: ProducerAxes): Producer[] {
  const out: Producer[] = []
  for (const kind of axes.mapperKinds) {
    switch (kind) {
      case 'fieldAccess':
        for (const field of axes.employeeFields) {
          out.push({
            id: `mapper.fieldAccess:${field}`,
            family: 'mapper',
            operationId: 'map',
            dsl: { kind, field },
          })
        }
        break
      case 'toUpper':
        out.push({ id: 'mapper.toUpper', family: 'mapper', operationId: 'map', dsl: { kind } })
        break
      case 'prefix':
        // prefixはprimitive入力・String出力のためmapToObjが起点になる
        out.push({
          id: 'mapper.prefix',
          family: 'mapper',
          operationId: 'mapToObj',
          dsl: { kind, prefix: 'No.' },
        })
        break
      case 'fieldToPrimitive':
        for (const field of axes.employeeFields) {
          for (const primitive of axes.primitives) {
            const info = EMPLOYEE_FIELDS[field]
            // 型適合表（fieldのJava型 = primitive）で互換直積に絞る
            if (!info || info.javaType.kind !== 'primitive' || info.javaType.name !== primitive) {
              continue
            }
            out.push({
              id: `mapper.fieldToPrimitive:${field}:${primitive}`,
              family: 'mapper',
              operationId: mapToPrimitiveOperationId(primitive),
              dsl: { kind, field, primitive },
            })
          }
        }
        break
      case 'listStream':
        out.push({
          id: 'mapper.listStream',
          family: 'flatMapper',
          operationId: 'flatMap',
          dsl: { kind },
        })
        break
      case 'arrayStream':
        for (const primitive of axes.primitives) {
          out.push({
            id: `mapper.arrayStream:${primitive}`,
            family: 'flatMapper',
            operationId: flatMapToPrimitiveOperationId(primitive),
            dsl: { kind, primitive },
          })
        }
        break
      default:
        throw new Error(`producer展開が未定義のmapper kindです: ${kind}（v0.14 §4-3の互換直積）`)
    }
  }
  return out
}

/** boxed（MapperDslを経由しない値生成handler。閉じた定数集合＝primitive軸） */
function expandBoxedProducers(axes: ProducerAxes): Producer[] {
  return axes.primitives.map((primitive) => {
    if (!(PRIMITIVE_NAMES as readonly string[]).includes(primitive)) {
      throw new Error(`producer展開が未定義のprimitiveです: ${primitive}（boxed値生成handler）`)
    }
    return {
      id: `boxed:${primitive}`,
      family: 'boxed' as const,
      operationId: 'boxed',
      dsl: { primitive },
    }
  })
}

function gatherInitialFor(primitive: 'int' | 'long' | 'double'): { type: string; value: number } {
  return { type: primitive, value: 0 }
}

function expandGatherProducers(axes: ProducerAxes): Producer[] {
  const out: Producer[] = []
  for (const kind of axes.gathererKinds) {
    switch (kind) {
      case 'windowFixed':
      case 'windowSliding':
        out.push({
          id: `gather.${kind}`,
          family: 'gather',
          operationId: 'gather',
          dsl: { kind, size: 2 },
        })
        break
      case 'scan':
      case 'fold':
        for (const accumulationKind of axes.gatherAccumulationKinds) {
          switch (accumulationKind) {
            case 'numericSum':
              // 入力はboxed数値。initial typeは入力primitiveへ適合させる
              for (const primitive of axes.primitives) {
                out.push({
                  id: `gather.${kind}:numericSum:${primitive}`,
                  family: 'gather',
                  operationId: 'gather',
                  dsl: {
                    kind,
                    initial: gatherInitialFor(primitive as 'int'),
                    accumulation: { kind: 'numericSum' },
                  },
                })
              }
              break
            case 'stringConcat':
              out.push({
                id: `gather.${kind}:stringConcat:string`,
                family: 'gather',
                operationId: 'gather',
                dsl: {
                  kind,
                  initial: { type: 'string', value: '' },
                  accumulation: { kind: 'stringConcat' },
                },
              })
              break
            case 'employeeFieldSum':
              for (const field of axes.gatherFields) {
                const primitive =
                  GATHER_FIELD_PRIMITIVE[field as keyof typeof GATHER_FIELD_PRIMITIVE]
                if (!primitive) {
                  throw new Error(
                    `producer展開が未定義のgather fieldです: ${field}（型適合表GATHER_FIELD_PRIMITIVE）`,
                  )
                }
                out.push({
                  id: `gather.${kind}:employeeFieldSum:${field}:${primitive}`,
                  family: 'gather',
                  operationId: 'gather',
                  dsl: {
                    kind,
                    initial: gatherInitialFor(primitive),
                    accumulation: { kind: 'employeeFieldSum', field },
                  },
                })
              }
              break
            default:
              throw new Error(
                `producer展開が未定義のgather accumulation kindです: ${accumulationKind}`,
              )
          }
        }
        break
      default:
        throw new Error(`producer展開が未定義のgatherer kindです: ${kind}（v0.14 §4-3の互換直積）`)
    }
  }
  return out
}

/** collector内部の評価器（keyMapper / classifier / valueMapper / merge）はclosed DSL定数から導出 */
function expandCollectorInternalProducers(axes: ProducerAxes): Producer[] {
  const out: Producer[] = []
  for (const kind of axes.classifierKinds) {
    switch (kind) {
      case 'employeeField':
        for (const field of axes.classifierEmployeeFields) {
          out.push({
            id: `classifier.employeeField:${field}`,
            family: 'classifier',
            operationId: null,
            dsl: { kind, field },
          })
        }
        break
      case 'employeeDepartment':
        out.push({
          id: 'classifier.employeeDepartment',
          family: 'classifier',
          operationId: null,
          dsl: { kind },
        })
        break
      case 'departmentField':
        for (const field of axes.classifierDepartmentFields) {
          out.push({
            id: `classifier.departmentField:${field}`,
            family: 'classifier',
            operationId: null,
            dsl: { kind, field },
          })
        }
        break
      default:
        throw new Error(`producer展開が未定義のclassifier kindです: ${kind}`)
    }
  }
  for (const kind of axes.toMapValueKinds) {
    switch (kind) {
      case 'identity':
        out.push({
          id: 'toMapValue.identity',
          family: 'toMapValue',
          operationId: null,
          dsl: { kind },
        })
        break
      case 'fieldAccess':
        for (const field of axes.employeeFields) {
          out.push({
            id: `toMapValue.fieldAccess:${field}`,
            family: 'toMapValue',
            operationId: null,
            dsl: { kind, field },
          })
        }
        break
      default:
        throw new Error(`producer展開が未定義のtoMap valueMapper kindです: ${kind}`)
    }
  }
  for (const mergeId of axes.toMapMergeIds) {
    if (!(TO_MAP_MERGE_IDS as readonly string[]).includes(mergeId)) {
      throw new Error(`producer展開が未定義のmergeFunction IDです: ${mergeId}`)
    }
    out.push({ id: `merge:${mergeId}`, family: 'merge', operationId: null, dsl: { mergeId } })
  }
  return out
}

/**
 * producer登録集合の機械導出（§4-3(ii)(iii)）。
 * (1) OperationCatalog全operationを全域分類し、未分類があればthrow
 * (2) 値生成operationのproducer IDを識別可能union実軸の互換直積で展開
 * (3) collector内部評価器をclosed DSL定数から導出（起点operationIdを持たない）
 * (4) **値生成operation集合とproducer展開カバー集合の双方向一致**を検証し、
 *     「分類済みだがproducer展開が未定義」「非値生成operationを参照する展開」を検出する
 */
export function deriveProducers(
  catalog: OperationCatalog,
  axes: ProducerAxes = defaultProducerAxes(),
  classification: Readonly<Record<string, OperationClass>> = OPERATION_CLASSIFICATION,
): Producer[] {
  const { valueProducing } = classifyOperations(catalog, classification)
  const producers = [
    ...expandSourceProducers(axes),
    ...expandMapperProducers(axes),
    ...expandBoxedProducers(axes),
    ...expandGatherProducers(axes),
    ...expandCollectorInternalProducers(axes),
  ]
  const ids = producers.map((p) => p.id)
  const duplicated = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (duplicated.length > 0) {
    throw new Error(`producer IDが重複しています: ${[...new Set(duplicated)].join(', ')}`)
  }

  // 分類結果とproducer展開の双方向一致（v0.14 §4-3(ii)）。
  // 値生成operationをOperationCatalogと分類表の双方へ登録しても、producer展開を書き忘れれば
  // ここで失敗する（「カタログにもテストにも登録し忘れた場合を含めて機械的に失敗する」契約）
  const covered = new Set(
    producers.map((p) => p.operationId).filter((id): id is string => id !== null),
  )
  const uncovered = valueProducing.filter((id) => !covered.has(id))
  if (uncovered.length > 0) {
    throw new Error(
      `値生成として分類済みですがproducer展開が未定義のoperationです: ${uncovered.join(', ')}（v0.14 §4-3(ii)）`,
    )
  }
  const unclassified = [...covered].filter((id) => !valueProducing.includes(id))
  if (unclassified.length > 0) {
    throw new Error(
      `producer展開が参照していますが値生成として分類されていないoperationです: ${unclassified.join(', ')}（v0.14 §4-3(ii)）`,
    )
  }
  return producers
}

// ---- producer完了状態（§4-3） ----

/**
 * producerの完了状態（v0.14 §4-3）。
 *
 * - `VALUE_REACHED`: 1件以上の意味値が**Collector境界へ到達**し全件を検査した
 * - `ZERO_EMISSION`: 有効なPipelineで実行したが仕様どおり0件を放出した（`empty`系のみ）
 * - `INVARIANT_BLOCKED`: 値生成と意味値の全件検査は完了したが、**既存の構造的不変条件により
 *   Collector境界への到達が禁止される**（window系のみ。`assertNotCompositeList`）
 *
 * `VALUE_REACHED`の定義は「実際にCollector境界へ到達したproducer」に限定し、
 * `INVARIANT_BLOCKED`と混同しない。
 */
export type ProducerState = 'VALUE_REACHED' | 'ZERO_EMISSION' | 'INVARIANT_BLOCKED'

/**
 * 合成List値を生成し、Collector境界へ構造的に到達できないproducerか（window系）。
 * 期待状態表とreachテストの双方がこの単一判定を参照する。
 */
export function isInvariantBlockedProducer(producer: Producer): boolean {
  if (producer.family !== 'gather') return false
  const kind = (producer.dsl as { kind?: string }).kind
  return kind === 'windowFixed' || kind === 'windowSliding'
}

/**
 * 期待状態の対応表（v0.14 §4-3）。
 * empty系→ZERO_EMISSION、window系→INVARIANT_BLOCKED、それ以外→VALUE_REACHED。
 */
export function expectedStateOf(producer: Producer): ProducerState {
  if (producer.zeroEmission === true) return 'ZERO_EMISSION'
  if (isInvariantBlockedProducer(producer)) return 'INVARIANT_BLOCKED'
  return 'VALUE_REACHED'
}

export class ProducerLedger {
  private readonly states = new Map<string, ProducerState>()

  mark(producerId: string, state: ProducerState): void {
    this.states.set(producerId, state)
  }

  stateOf(producerId: string): ProducerState | null {
    return this.states.get(producerId) ?? null
  }

  /** 未実行・未分類のproducer ID（0件であることをassertする） */
  missing(producers: readonly Producer[]): string[] {
    return producers.filter((p) => !this.states.has(p.id)).map((p) => p.id)
  }

  /** 期待状態の対応表と一致しないproducer（0件であることをassertする） */
  mismatched(producers: readonly Producer[]): string[] {
    return producers
      .filter((p) => this.states.has(p.id) && this.states.get(p.id) !== expectedStateOf(p))
      .map((p) => `${p.id}: expected=${expectedStateOf(p)} actual=${String(this.states.get(p.id))}`)
  }
}

export { SIM_VALUE_KINDS }
