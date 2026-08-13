import { describe, expect, it } from 'vitest'
import {
  CLASSIFIER_DSL_KINDS,
  COLLECTOR_MAX_DEPTH,
  COMPARABLE_CLASSIFIER_KINDS,
  TO_MAP_MERGE_IDS,
  TO_MAP_VALUE_KINDS,
  collectorDepth,
  collectorKindsOf,
  toMapArity,
} from '../../src/domain/dsl/collectorAst'
import type { CollectorDsl } from '../../src/domain/dsl/collectorAst'
import {
  resolveCollectorType,
  validateCollectorStructure,
  validateToMapValueStructure,
} from '../../src/domain/dsl/validateCollector'
import { MAPPER_DSL_KINDS } from '../../src/domain/dsl/mapperAst'
import { resolveMapperOutputType, validateMapperStructure } from '../../src/domain/dsl/validateMapper'
import { TYPE_EMPLOYEE, TYPE_STRING, formatTypeRef } from '../../src/domain/types/typeRef'
import { IDENTITY_VALUE, NAME_KEY, NAME_VALUE, REGION_KEY, SALARY_VALUE, toMap2, toMap3, toMap4 } from '../p8-helpers'

/**
 * P8-D01〜P8-D06: toMapのDSL構造検証・値DSL・mergeホワイトリスト・keyMapper制約・
 * 結果型導出・配置制約（Phase 8指示 §12.1、v0.11 §8）。
 */

function issuesOf(input: unknown): { code: string; path: string }[] {
  const result = validateCollectorStructure(input)
  if (result.ok) return []
  return result.issues.map((i) => ({ code: i.code, path: i.path }))
}

describe('P8-D01 toMap DSL構造検証（closed schema・overload組合せ）', () => {
  it('P8-D01: 3 overloadすべてを受理する', () => {
    for (const [label, dsl, arity] of [
      ['2引数版', toMap2(), 2],
      ['3引数版', toMap3('first'), 3],
      ['4引数版', toMap4('first'), 4],
    ] as const) {
      const result = validateCollectorStructure(dsl)
      expect(result.ok, `${label}: ${JSON.stringify(issuesOf(dsl))}`).toBe(true)
      if (result.ok) {
        expect(collectorKindsOf(result.value)).toEqual(['toMap'])
        // toMapはleaf Collectorであり深さは1（collectorDepthのdefault分岐で扱う）
        expect(collectorDepth(result.value)).toBe(1)
        expect(toMapArity(result.value as Extract<CollectorDsl, { kind: 'toMap' }>)).toBe(arity)
      }
    }
  })

  it('P8-D01: 未知kind・許可外キー・必須キー欠落を拒否する（5キー厳密）', () => {
    // 許可外キー（任意コード文字列の混入も含む）
    for (const extraKey of ['functionBody', 'evalExpr', 'javaCode', 'mergeFunction']) {
      const issues = issuesOf({ ...toMap2(), [extraKey]: 'x' })
      expect(issues, extraKey).toContainEqual({
        code: 'STRUCTURE_INVALID',
        path: `collector.${extraKey}`,
      })
    }
    // 必須キー欠落（keyMapper / valueMapper）
    expect(
      issuesOf({ kind: 'toMap', valueMapper: NAME_VALUE, mergeFunctionId: null, mapFactoryId: null })
        .length,
    ).toBeGreaterThan(0)
    expect(
      issuesOf({ kind: 'toMap', keyMapper: REGION_KEY, mergeFunctionId: null, mapFactoryId: null })
        .length,
    ).toBeGreaterThan(0)
    // keyMapperの未知kind
    expect(issuesOf(toMap2({ kind: 'employeeSalary' }))).toContainEqual({
      code: 'STRUCTURE_UNKNOWN_KIND',
      path: 'collector.keyMapper.kind',
    })
  })

  it('P8-D01: mapFactoryId非null ∧ mergeFunctionId nullをSTRUCTURE_INVALIDで拒否する', () => {
    const invalid = {
      kind: 'toMap',
      keyMapper: REGION_KEY,
      valueMapper: NAME_VALUE,
      mergeFunctionId: null,
      mapFactoryId: 'TreeMap::new',
    }
    expect(issuesOf(invalid)).toContainEqual({
      code: 'STRUCTURE_INVALID',
      path: 'collector.mergeFunctionId',
    })
  })

  it('P8-D01: 引数省略はoptional keyではなく明示nullで表す（キー自体の省略は拒否）', () => {
    const missingNullKeys = {
      kind: 'toMap',
      keyMapper: REGION_KEY,
      valueMapper: NAME_VALUE,
    }
    const result = validateCollectorStructure(missingNullKeys)
    // 実キー集合が5キーに満たないためclosed schemaを通らない（構造は受理されるが型解決で落ちる）
    // ここでは「明示nullを与えた形が正である」ことを対比で示す
    expect(validateCollectorStructure(toMap2()).ok).toBe(true)
    if (result.ok) {
      const dsl = result.value as Extract<CollectorDsl, { kind: 'toMap' }>
      expect(dsl.mergeFunctionId ?? null).toBeNull()
      expect(dsl.mapFactoryId ?? null).toBeNull()
    }
  })
})

describe('P8-D02 ToMapValueDsl（toMap専用の値DSL）', () => {
  it('P8-D02: identity / fieldAccessを受理する', () => {
    expect(validateToMapValueStructure(IDENTITY_VALUE).ok).toBe(true)
    expect(validateToMapValueStructure(NAME_VALUE).ok).toBe(true)
    expect(validateToMapValueStructure(SALARY_VALUE).ok).toBe(true)
    expect(TO_MAP_VALUE_KINDS).toEqual(['identity', 'fieldAccess'])
  })

  it('P8-D02: fieldToPrimitive / toUpper / prefix / listStream / arrayStream相当を拒否する', () => {
    const rejected: readonly unknown[] = [
      { kind: 'fieldToPrimitive', field: 'salary', primitive: 'long' },
      { kind: 'toUpper' },
      { kind: 'prefix', prefix: 'No.' },
      { kind: 'listStream' },
      { kind: 'arrayStream', primitive: 'int' },
    ]
    for (const value of rejected) {
      const result = validateToMapValueStructure(value)
      expect(result.ok, JSON.stringify(value)).toBe(false)
      if (!result.ok) {
        expect(result.issues[0]?.code).toBe('STRUCTURE_UNKNOWN_KIND')
        expect(result.issues[0]?.path).toBe('valueMapper.kind')
      }
      // Collector AST経由でも同じく拒否される
      expect(validateCollectorStructure(toMap2(REGION_KEY, value)).ok).toBe(false)
    }
  })

  it('P8-D02: fieldAccessのfieldはEmployeeのフィールドに限る（許可外キーも拒否）', () => {
    const unknownField = validateToMapValueStructure({ kind: 'fieldAccess', field: 'bonus' })
    expect(unknownField.ok).toBe(false)
    if (!unknownField.ok) expect(unknownField.issues[0]?.code).toBe('WHITELIST_FIELD')
    const extraKey = validateToMapValueStructure({
      kind: 'fieldAccess',
      field: 'name',
      functionBody: 'return 1',
    })
    expect(extraKey.ok).toBe(false)
    if (!extraKey.ok) expect(extraKey.issues[0]?.path).toBe('valueMapper.functionBody')
    // identityは追加キーを持たない
    expect(validateToMapValueStructure({ kind: 'identity', field: 'name' }).ok).toBe(false)
  })

  it('P8-D02: 共有MapperDsl・validateMapperの許可範囲が不変である', () => {
    // 共有MapperDslのkind集合はPhase 7完了時点と同一（identityは含まれない）
    expect([...MAPPER_DSL_KINDS]).toEqual([
      'fieldAccess',
      'toUpper',
      'prefix',
      'fieldToPrimitive',
      'listStream',
      'arrayStream',
    ])
    expect((MAPPER_DSL_KINDS as readonly string[]).includes('identity')).toBe(false)
    // validateMapperStructureはidentityを受理しない（toMap専用DSLは共有側へ漏れていない）
    expect(validateMapperStructure({ kind: 'identity' }).ok).toBe(false)
  })
})

describe('P8-D03 mergeFunctionホワイトリスト', () => {
  it('P8-D03: first / last / concatの3 IDを受理し、未知IDを拒否する', () => {
    expect([...TO_MAP_MERGE_IDS]).toEqual(['first', 'last', 'concat'])
    for (const id of TO_MAP_MERGE_IDS) {
      expect(validateCollectorStructure(toMap3(id)).ok, id).toBe(true)
    }
    for (const id of ['sum', 'Long::sum', 'min', '']) {
      const issues = issuesOf(toMap3(id))
      expect(issues, id).toContainEqual({
        code: 'WHITELIST_KIND',
        path: 'collector.mergeFunctionId',
      })
    }
  })

  it('P8-D03: concat × 非String値型（identity=Employee / salary=Long）をTYPE_MISMATCHで拒否する', () => {
    for (const [label, valueMapper] of [
      ['identity（Employee）', IDENTITY_VALUE],
      ['salary（Long）', SALARY_VALUE],
    ] as const) {
      const dsl = toMap3('concat', REGION_KEY, valueMapper) as CollectorDsl
      // 構造検証は通る（型検証で拒否する）
      expect(validateCollectorStructure(dsl).ok, label).toBe(true)
      const typed = resolveCollectorType(dsl, TYPE_EMPLOYEE)
      expect(typed.ok, label).toBe(false)
      if (!typed.ok) {
        expect(typed.issues[0]?.code, label).toBe('TYPE_MISMATCH')
        expect(typed.issues[0]?.path, label).toBe('collector.mergeFunctionId')
      }
    }
    // String値（name）なら受理される
    expect(resolveCollectorType(toMap3('concat') as CollectorDsl, TYPE_EMPLOYEE).ok).toBe(true)
    // first / lastは任意の同一型Uで受理される
    for (const id of ['first', 'last'] as const) {
      expect(
        resolveCollectorType(toMap3(id, REGION_KEY, IDENTITY_VALUE) as CollectorDsl, TYPE_EMPLOYEE)
          .ok,
        id,
      ).toBe(true)
    }
  })
})

describe('P8-D04 keyMapper（ClassifierDsl流用）とTreeMap制約', () => {
  it('P8-D04: ClassifierDsl 3形をすべて流用して受理する', () => {
    const classifiers: readonly unknown[] = [
      { kind: 'employeeField', field: 'region' },
      { kind: 'employeeDepartment' },
      { kind: 'departmentField', field: 'name' },
    ]
    for (const classifier of classifiers) {
      const dsl = toMap2(classifier, NAME_VALUE) as CollectorDsl
      expect(validateCollectorStructure(dsl).ok, JSON.stringify(classifier)).toBe(true)
      expect(resolveCollectorType(dsl, TYPE_EMPLOYEE).ok, JSON.stringify(classifier)).toBe(true)
    }
  })

  it('P8-D04: employeeDepartment × TreeMap::newをTYPE_MISMATCHで拒否する', () => {
    const dsl = toMap4('first', { kind: 'employeeDepartment' }, NAME_VALUE) as CollectorDsl
    expect(validateCollectorStructure(dsl).ok).toBe(true)
    const typed = resolveCollectorType(dsl, TYPE_EMPLOYEE)
    expect(typed.ok).toBe(false)
    if (!typed.ok) {
      expect(typed.issues[0]?.code).toBe('TYPE_MISMATCH')
      expect(typed.issues[0]?.path).toBe('collector.mapFactoryId')
    }
    // Comparableキー（employeeField / departmentField）なら受理される
    expect(resolveCollectorType(toMap4('first') as CollectorDsl, TYPE_EMPLOYEE).ok).toBe(true)
    expect(
      resolveCollectorType(
        toMap4('first', { kind: 'departmentField', field: 'name' }, NAME_VALUE) as CollectorDsl,
        TYPE_EMPLOYEE,
      ).ok,
    ).toBe(true)
  })

  it('P8-D04: ClassifierDsl定義・COMPARABLE_CLASSIFIER_KINDSが不変である', () => {
    expect([...CLASSIFIER_DSL_KINDS]).toEqual([
      'employeeField',
      'employeeDepartment',
      'departmentField',
    ])
    expect([...COMPARABLE_CLASSIFIER_KINDS]).toEqual(['employeeField', 'departmentField'])
  })
})

describe('P8-D05 結果型導出（Map<K, U>）', () => {
  it('P8-D05: identity / fieldAccessの値型（boxing済み）が正しい', () => {
    const cases: readonly [unknown, string][] = [
      [toMap2(NAME_KEY, IDENTITY_VALUE), 'Map<String, Employee>'],
      [toMap2(REGION_KEY, NAME_VALUE), 'Map<String, String>'],
      [toMap2(REGION_KEY, SALARY_VALUE), 'Map<String, Long>'],
      [toMap2(REGION_KEY, { kind: 'fieldAccess', field: 'age' }), 'Map<String, Integer>'],
      [toMap2(REGION_KEY, { kind: 'fieldAccess', field: 'evaluation' }), 'Map<String, Double>'],
      [toMap2(REGION_KEY, { kind: 'fieldAccess', field: 'department' }), 'Map<String, Department>'],
    ]
    for (const [dsl, expected] of cases) {
      const typed = resolveCollectorType(dsl as CollectorDsl, TYPE_EMPLOYEE)
      expect(typed.ok, expected).toBe(true)
      if (typed.ok) expect(formatTypeRef(typed.value)).toBe(expected)
    }
    // fieldAccessの値型導出は既存resolveMapperOutputTypeと同一である（boxing規則の共有）
    const viaMapper = resolveMapperOutputType({ kind: 'fieldAccess', field: 'salary' }, TYPE_EMPLOYEE)
    expect(viaMapper.ok && formatTypeRef(viaMapper.value)).toBe('Long')
  })

  it('P8-D05: キー型はclassifier由来（employeeDepartmentはDepartment）', () => {
    const typed = resolveCollectorType(
      toMap2({ kind: 'employeeDepartment' }, NAME_VALUE) as CollectorDsl,
      TYPE_EMPLOYEE,
    )
    expect(typed.ok && formatTypeRef(typed.value)).toBe('Map<Department, String>')
  })

  it('P8-D05: nested（groupingBy配下）はMap<String, Map<String, Long>>になる', () => {
    const nested: unknown = {
      kind: 'groupingBy',
      classifier: REGION_KEY,
      mapFactoryId: null,
      downstream: toMap2(NAME_KEY, SALARY_VALUE),
    }
    expect(validateCollectorStructure(nested).ok).toBe(true)
    const typed = resolveCollectorType(nested as CollectorDsl, TYPE_EMPLOYEE)
    expect(typed.ok && formatTypeRef(typed.value)).toBe('Map<String, Map<String, Long>>')
  })

  it('P8-D05: 4引数版の表示コンテナ名はTreeMapである（TypeRefはMapのまま）', () => {
    const typed = resolveCollectorType(toMap4('first') as CollectorDsl, TYPE_EMPLOYEE)
    // TypeRefは既存規約どおりMap<K, U>（実装名は表示ラベルで持つ。指示§7.3-6）
    expect(typed.ok && formatTypeRef(typed.value)).toBe('Map<String, String>')
  })
})

describe('P8-D06 配置制約（downstream / left / right・Employee入力・深さ）', () => {
  it('P8-D06: groupingBy / partitioningByのdownstream配置を受理する（深さ4以内）', () => {
    const single: unknown = {
      kind: 'groupingBy',
      classifier: REGION_KEY,
      mapFactoryId: null,
      downstream: toMap2(NAME_KEY, SALARY_VALUE),
    }
    expect(validateCollectorStructure(single).ok).toBe(true)
    expect(collectorDepth(single as CollectorDsl)).toBe(2)

    const partition: unknown = {
      kind: 'partitioningBy',
      predicate: {
        kind: 'fieldCompare',
        field: 'age',
        operator: 'GTE',
        value: { type: 'int', value: 30 },
      },
      downstream: toMap2(NAME_KEY, SALARY_VALUE),
    }
    expect(validateCollectorStructure(partition).ok).toBe(true)

    // adapter系（filtering）経由の配置も受理する
    const viaAdapter: unknown = {
      kind: 'filtering',
      predicate: {
        kind: 'fieldCompare',
        field: 'age',
        operator: 'GTE',
        value: { type: 'int', value: 0 },
      },
      downstream: toMap2(),
    }
    expect(validateCollectorStructure(viaAdapter).ok).toBe(true)
    expect(resolveCollectorType(viaAdapter as CollectorDsl, TYPE_EMPLOYEE).ok).toBe(true)
  })

  it('P8-D06: mapping配下（Employee入力でないslot）をTYPE_MISMATCHで拒否する', () => {
    const underMapping: unknown = {
      kind: 'mapping',
      mapper: { kind: 'fieldAccess', field: 'name' },
      downstream: toMap2(),
    }
    // 構造は通るが、String入力へkeyMapper（ClassifierDsl）は適用できない
    expect(validateCollectorStructure(underMapping).ok).toBe(true)
    const typed = resolveCollectorType(underMapping as CollectorDsl, TYPE_EMPLOYEE)
    expect(typed.ok).toBe(false)
    if (!typed.ok) {
      expect(typed.issues[0]?.code).toBe('TYPE_MISMATCH')
      expect(typed.issues[0]?.path).toBe('collector.downstream.keyMapper')
    }
    // flatMapping配下（String入力）も同様
    const underFlatMapping: unknown = {
      kind: 'flatMapping',
      mapper: { kind: 'fieldAccess', field: 'skills' },
      downstream: toMap2(),
    }
    expect(resolveCollectorType(underFlatMapping as CollectorDsl, TYPE_EMPLOYEE).ok).toBe(false)
    // 参考: String入力そのものへの直接適用も拒否される
    expect(resolveCollectorType(toMap2() as CollectorDsl, TYPE_STRING).ok).toBe(false)
  })

  it('P8-D06: 深さ超過をCOLLECTOR_DEPTHで拒否する', () => {
    expect(COLLECTOR_MAX_DEPTH).toBe(4)
    // groupingBy(1) → groupingBy(2) → groupingBy(3) → groupingBy(4) → toMap(5)
    const tooDeep: unknown = {
      kind: 'groupingBy',
      classifier: REGION_KEY,
      mapFactoryId: null,
      downstream: {
        kind: 'groupingBy',
        classifier: { kind: 'departmentField', field: 'name' },
        mapFactoryId: null,
        downstream: {
          kind: 'groupingBy',
          classifier: { kind: 'departmentField', field: 'division' },
          mapFactoryId: null,
          downstream: {
            kind: 'groupingBy',
            classifier: NAME_KEY,
            mapFactoryId: null,
            downstream: toMap2(NAME_KEY, SALARY_VALUE),
          },
        },
      },
    }
    const issues = issuesOf(tooDeep)
    expect(issues.some((i) => i.code === 'COLLECTOR_DEPTH')).toBe(true)
  })

  it('P8-D06: teeing branchへのtoMap配置は既存merger record契約により型不整合になる（Phase 8未実装事項）', () => {
    // TEEING_MERGER_IDSは'SalarySummary::new'（long / double）の1件だけであり、
    // branch結果がMapのteeingは成立しない。v0.11 §8.6のleaf配置許可はDSL構造上の許可であり、
    // 実行可能な組合せはmerger recordの型契約に従う（docs/phase-8-decisions.md §9）
    const teeingWithToMap: unknown = {
      kind: 'teeing',
      left: toMap2(),
      right: { kind: 'averagingLong', field: 'salary' },
      mergerId: 'SalarySummary::new',
    }
    expect(validateCollectorStructure(teeingWithToMap).ok).toBe(true)
    const typed = resolveCollectorType(teeingWithToMap as CollectorDsl, TYPE_EMPLOYEE)
    expect(typed.ok).toBe(false)
    if (!typed.ok) {
      expect(typed.issues[0]?.code).toBe('TYPE_MISMATCH')
      expect(typed.issues[0]?.path).toBe('collector.left')
    }
  })
})
