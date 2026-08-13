import { describe, expect, it } from 'vitest'
import {
  COLLECTOR_DSL_KINDS,
  COLLECTOR_MAX_DEPTH,
  TO_MAP_MERGE_IDS,
  UNMODIFIABLE_COLLECTOR_KINDS,
  collectorDepth,
  collectorKindsOf,
  isUnmodifiableCollectorKind,
  toUnmodifiableMapArity,
} from '../../src/domain/dsl/collectorAst'
import type { CollectorDsl } from '../../src/domain/dsl/collectorAst'
import {
  resolveCollectorType,
  validateCollectorStructure,
} from '../../src/domain/dsl/validateCollector'
import { collectorToJavaExpr } from '../../src/domain/dsl/javaCode'
import { TYPE_EMPLOYEE, TYPE_STRING, formatTypeRef } from '../../src/domain/types/typeRef'
import {
  AGE_VALUE,
  EVALUATION_VALUE,
  IDENTITY_VALUE,
  NAME_KEY,
  NAME_VALUE,
  REGION_KEY,
  SALARY_VALUE,
} from '../p8-helpers'
import { toUnmodList, toUnmodMap2, toUnmodMap3, toUnmodSet } from '../p11-helpers'

/**
 * P11-D01〜P11-D06: unmodifiable系3 kindのDSL構造検証・closed schema・
 * mapFactoryIdキー拒否・merge流用・結果型導出・配置制約・Javaコード表記（v0.14 §2）。
 */

function issuesOf(input: unknown): { code: string; path: string }[] {
  const result = validateCollectorStructure(input)
  if (result.ok) return []
  return result.issues.map((i) => ({ code: i.code, path: i.path }))
}

describe('P11-D01 unmodifiable系3 kindの登録とleaf性（v0.14 §2.1）', () => {
  it('P11-D01: 3 kindがCOLLECTOR_DSL_KINDSへ登録され、単一定義源から導出される', () => {
    expect([...UNMODIFIABLE_COLLECTOR_KINDS]).toEqual([
      'toUnmodifiableList',
      'toUnmodifiableSet',
      'toUnmodifiableMap',
    ])
    for (const kind of UNMODIFIABLE_COLLECTOR_KINDS) {
      expect((COLLECTOR_DSL_KINDS as readonly string[]).includes(kind), kind).toBe(true)
      expect(isUnmodifiableCollectorKind(kind), kind).toBe(true)
    }
    // 既存kindはunmodifiable判定に含まれない
    for (const kind of ['toList', 'toSet', 'toMap', 'toCollection']) {
      expect(isUnmodifiableCollectorKind(kind), kind).toBe(false)
    }
    // 新しいoperationは登録しない（Collectors各種をcollect操作へ集約する既存方針。v0.14 §2.1）
    expect(COLLECTOR_DSL_KINDS.filter((k) => isUnmodifiableCollectorKind(k))).toHaveLength(3)
  })

  it('P11-D01: 3 kindともleaf Collectorであり深さは1である', () => {
    for (const dsl of [toUnmodList(), toUnmodSet(), toUnmodMap2(), toUnmodMap3('first')]) {
      const result = validateCollectorStructure(dsl)
      expect(result.ok, JSON.stringify(dsl)).toBe(true)
      if (result.ok) {
        expect(collectorDepth(result.value)).toBe(1)
        expect(collectorKindsOf(result.value)).toEqual([dsl['kind']])
      }
    }
  })

  it('P11-D01: toUnmodifiableMapのoverloadは2引数 / 3引数の2形のみである', () => {
    const two = validateCollectorStructure(toUnmodMap2())
    const three = validateCollectorStructure(toUnmodMap3('first'))
    expect(two.ok && three.ok).toBe(true)
    if (two.ok) {
      expect(
        toUnmodifiableMapArity(two.value as Extract<CollectorDsl, { kind: 'toUnmodifiableMap' }>),
      ).toBe(2)
    }
    if (three.ok) {
      expect(
        toUnmodifiableMapArity(three.value as Extract<CollectorDsl, { kind: 'toUnmodifiableMap' }>),
      ).toBe(3)
    }
  })
})

describe('P11-D02 closed schema（許可キー集合とmapFactoryIdキー拒否。v0.14 §2.2）', () => {
  it('P11-D02: toUnmodifiableList / Setの許可キーはkindのみである', () => {
    for (const kind of ['toUnmodifiableList', 'toUnmodifiableSet'] as const) {
      expect(validateCollectorStructure({ kind }).ok, kind).toBe(true)
      // 任意コード文字列の混入も含め、kind以外のキーはすべて拒否する
      for (const extraKey of ['functionBody', 'evalExpr', 'javaCode', 'supplierId', 'downstream']) {
        expect(issuesOf({ kind, [extraKey]: 'x' }), `${kind}.${extraKey}`).toContainEqual({
          code: 'STRUCTURE_INVALID',
          path: `collector.${extraKey}`,
        })
      }
    }
  })

  it('P11-D02: toUnmodifiableMapの許可キーは4キー厳密である', () => {
    for (const extraKey of ['functionBody', 'evalExpr', 'javaCode', 'mergeFunction', 'supplierId']) {
      expect(issuesOf({ ...toUnmodMap2(), [extraKey]: 'x' }), extraKey).toContainEqual({
        code: 'STRUCTURE_INVALID',
        path: `collector.${extraKey}`,
      })
    }
    // 必須キー欠落（keyMapper / valueMapper）
    expect(
      issuesOf({ kind: 'toUnmodifiableMap', valueMapper: NAME_VALUE, mergeFunctionId: null }).length,
    ).toBeGreaterThan(0)
    expect(
      issuesOf({ kind: 'toUnmodifiableMap', keyMapper: REGION_KEY, mergeFunctionId: null }).length,
    ).toBeGreaterThan(0)
  })

  it('P11-D02: mapFactoryIdキーは存在するだけで拒否する（Javaにmap Factory版overloadがない）', () => {
    // 値がnullでも許可キー集合に含まれないため拒否される（v0.14 §2.2）
    for (const mapFactoryId of [null, 'TreeMap::new', 'HashMap::new']) {
      const issues = issuesOf({ ...toUnmodMap2(), mapFactoryId })
      expect(issues, String(mapFactoryId)).toContainEqual({
        code: 'STRUCTURE_INVALID',
        path: 'collector.mapFactoryId',
      })
    }
    // 対比: 既存toMapはmapFactoryIdキーを持つ（既存の意味論は変更しない）
    expect(
      validateCollectorStructure({
        kind: 'toMap',
        keyMapper: REGION_KEY,
        valueMapper: NAME_VALUE,
        mergeFunctionId: 'first',
        mapFactoryId: 'TreeMap::new',
      }).ok,
    ).toBe(true)
  })

  it('P11-D02: keyMapper / valueMapperの検証はtoMapと同一である（未知kindを拒否）', () => {
    expect(issuesOf(toUnmodMap2({ kind: 'employeeSalary' }))).toContainEqual({
      code: 'STRUCTURE_UNKNOWN_KIND',
      path: 'collector.keyMapper.kind',
    })
    // valueMapperの許可はidentity / fieldAccessの2形のみ（toMap専用DSLの流用）
    for (const valueMapper of [
      { kind: 'fieldToPrimitive', field: 'salary', primitive: 'long' },
      { kind: 'toUpper' },
      { kind: 'listStream' },
    ]) {
      expect(
        validateCollectorStructure(toUnmodMap2(REGION_KEY, valueMapper)).ok,
        JSON.stringify(valueMapper),
      ).toBe(false)
    }
    expect(
      issuesOf(toUnmodMap2(REGION_KEY, { kind: 'fieldAccess', field: 'bonus' })),
    ).toContainEqual({ code: 'WHITELIST_FIELD', path: 'collector.valueMapper.field' })
  })
})

describe('P11-D03 mergeFunctionの流用（6種ホワイトリスト + 値型制約。v0.14 §2.2）', () => {
  it('P11-D03: 既存merge 6 IDをそのまま受理し、未知IDを拒否する', () => {
    for (const id of TO_MAP_MERGE_IDS) {
      const valueMapper =
        id === 'sumInt'
          ? AGE_VALUE
          : id === 'sumLong'
            ? SALARY_VALUE
            : id === 'sumDouble'
              ? EVALUATION_VALUE
              : NAME_VALUE
      expect(validateCollectorStructure(toUnmodMap3(id, REGION_KEY, valueMapper)).ok, id).toBe(true)
    }
    for (const id of ['sum', 'Long::sum', 'min', '']) {
      expect(issuesOf(toUnmodMap3(id)), id).toContainEqual({
        code: 'WHITELIST_KIND',
        path: 'collector.mergeFunctionId',
      })
    }
  })

  it('P11-D03: requiredValueWrapper型制約を変更なしで流用する', () => {
    const cases = [
      { id: 'concat', match: NAME_VALUE, mismatches: [SALARY_VALUE, IDENTITY_VALUE] },
      { id: 'sumInt', match: AGE_VALUE, mismatches: [SALARY_VALUE, EVALUATION_VALUE, NAME_VALUE] },
      { id: 'sumLong', match: SALARY_VALUE, mismatches: [AGE_VALUE, NAME_VALUE] },
      { id: 'sumDouble', match: EVALUATION_VALUE, mismatches: [AGE_VALUE, NAME_VALUE] },
    ] as const
    for (const { id, match, mismatches } of cases) {
      expect(
        resolveCollectorType(toUnmodMap3(id, REGION_KEY, match) as CollectorDsl, TYPE_EMPLOYEE).ok,
        `${id}: match`,
      ).toBe(true)
      for (const valueMapper of mismatches) {
        const dsl = toUnmodMap3(id, REGION_KEY, valueMapper) as CollectorDsl
        // 構造検証は通り、型解決でTYPE_MISMATCHとして実行前拒否される（toMapと同一挙動）
        expect(validateCollectorStructure(dsl).ok, `${id}: 構造検証`).toBe(true)
        const typed = resolveCollectorType(dsl, TYPE_EMPLOYEE)
        expect(typed.ok, `${id} × ${JSON.stringify(valueMapper)}`).toBe(false)
        if (!typed.ok) {
          expect(typed.issues[0]?.code).toBe('TYPE_MISMATCH')
          expect(typed.issues[0]?.path).toBe('collector.mergeFunctionId')
        }
      }
    }
    // first / lastは任意の同一型Uで受理される
    for (const id of ['first', 'last'] as const) {
      expect(
        resolveCollectorType(
          toUnmodMap3(id, REGION_KEY, IDENTITY_VALUE) as CollectorDsl,
          TYPE_EMPLOYEE,
        ).ok,
        id,
      ).toBe(true)
    }
  })
})

describe('P11-D04 結果型導出（TypeRefへ不変性の軸を追加しない。v0.14 §2.1）', () => {
  it('P11-D04: 結果型は既存のList<T> / Set<T> / Map<K, U>のままである', () => {
    const cases: readonly [unknown, string][] = [
      [toUnmodList(), 'List<Employee>'],
      [toUnmodSet(), 'Set<Employee>'],
      [toUnmodMap2(REGION_KEY, NAME_VALUE), 'Map<String, String>'],
      [toUnmodMap2(NAME_KEY, IDENTITY_VALUE), 'Map<String, Employee>'],
      [toUnmodMap2(REGION_KEY, SALARY_VALUE), 'Map<String, Long>'],
      [toUnmodMap2({ kind: 'employeeDepartment' }, NAME_VALUE), 'Map<Department, String>'],
    ]
    for (const [dsl, expected] of cases) {
      const typed = resolveCollectorType(dsl as CollectorDsl, TYPE_EMPLOYEE)
      expect(typed.ok, expected).toBe(true)
      if (typed.ok) expect(formatTypeRef(typed.value)).toBe(expected)
    }
  })

  it('P11-D04: List / Setの結果型は入力要素型に追従する（String入力も可）', () => {
    for (const [dsl, expected] of [
      [toUnmodList(), 'List<String>'],
      [toUnmodSet(), 'Set<String>'],
    ] as const) {
      const typed = resolveCollectorType(dsl as CollectorDsl, TYPE_STRING)
      expect(typed.ok && formatTypeRef(typed.value)).toBe(expected)
    }
  })

  it('P11-D04: 既存toList / toSetの結果型と一致する（意味論の流用。v0.14 §2.3）', () => {
    const unmodList = resolveCollectorType(toUnmodList() as CollectorDsl, TYPE_EMPLOYEE)
    const toList = resolveCollectorType({ kind: 'toList' }, TYPE_EMPLOYEE)
    expect(unmodList.ok && toList.ok && unmodList.value).toEqual(toList.ok ? toList.value : null)
    const unmodSet = resolveCollectorType(toUnmodSet() as CollectorDsl, TYPE_EMPLOYEE)
    const toSet = resolveCollectorType({ kind: 'toSet' }, TYPE_EMPLOYEE)
    expect(unmodSet.ok && toSet.ok && unmodSet.value).toEqual(toSet.ok ? toSet.value : null)
  })
})

describe('P11-D05 配置制約（downstream / left / right・Employee入力・深さ。v0.14 §2.1）', () => {
  it('P11-D05: groupingBy / partitioningByのdownstream配置を受理する', () => {
    for (const downstream of [toUnmodList(), toUnmodSet(), toUnmodMap2(NAME_KEY, SALARY_VALUE)]) {
      const grouping: unknown = {
        kind: 'groupingBy',
        classifier: REGION_KEY,
        mapFactoryId: null,
        downstream,
      }
      expect(validateCollectorStructure(grouping).ok, JSON.stringify(downstream)).toBe(true)
      expect(collectorDepth(grouping as CollectorDsl)).toBe(2)
      expect(resolveCollectorType(grouping as CollectorDsl, TYPE_EMPLOYEE).ok).toBe(true)
    }
    const partition: unknown = {
      kind: 'partitioningBy',
      predicate: {
        kind: 'fieldCompare',
        field: 'age',
        operator: 'GTE',
        value: { type: 'int', value: 30 },
      },
      downstream: toUnmodList(),
    }
    expect(validateCollectorStructure(partition).ok).toBe(true)
    expect(resolveCollectorType(partition as CollectorDsl, TYPE_EMPLOYEE).ok).toBe(true)
  })

  it('P11-D05: mapping / flatMapping配下ではList / Setは受理、Mapは入力型で拒否される', () => {
    // toUnmodifiableList / SetはString入力でも成立する
    const mappingToList: unknown = {
      kind: 'mapping',
      mapper: { kind: 'fieldAccess', field: 'region' },
      downstream: toUnmodSet(),
    }
    expect(validateCollectorStructure(mappingToList).ok).toBe(true)
    const mappedTyped = resolveCollectorType(mappingToList as CollectorDsl, TYPE_EMPLOYEE)
    expect(mappedTyped.ok && formatTypeRef(mappedTyped.value)).toBe('Set<String>')

    // toUnmodifiableMapのkeyMapper（ClassifierDsl）はEmployee入力を要求する（v0.11 §8.6と同一）
    const mappingToMap: unknown = {
      kind: 'mapping',
      mapper: { kind: 'fieldAccess', field: 'name' },
      downstream: toUnmodMap2(),
    }
    expect(validateCollectorStructure(mappingToMap).ok).toBe(true)
    const typed = resolveCollectorType(mappingToMap as CollectorDsl, TYPE_EMPLOYEE)
    expect(typed.ok).toBe(false)
    if (!typed.ok) {
      expect(typed.issues[0]?.code).toBe('TYPE_MISMATCH')
      expect(typed.issues[0]?.path).toBe('collector.downstream.keyMapper')
    }
    expect(resolveCollectorType(toUnmodMap2() as CollectorDsl, TYPE_STRING).ok).toBe(false)
  })

  it('P11-D05: teeing branch配置はmerger recordの型契約に従う', () => {
    // RegionIndex（Map<String, String> / long）へtoUnmodifiableMapを左branchへ置ける
    const regionIndex: unknown = {
      kind: 'teeing',
      left: toUnmodMap2(),
      right: { kind: 'counting' },
      mergerId: 'RegionIndex::new',
    }
    expect(validateCollectorStructure(regionIndex).ok).toBe(true)
    const typed = resolveCollectorType(regionIndex as CollectorDsl, TYPE_EMPLOYEE)
    expect(typed.ok).toBe(true)
    if (typed.ok) expect(typed.value).toEqual({ kind: 'object', name: 'RegionIndex' })
    // SalarySummary（long / double）へのList配置は既存どおりTYPE_MISMATCH
    const wrong: unknown = {
      kind: 'teeing',
      left: toUnmodList(),
      right: { kind: 'averagingLong', field: 'salary' },
      mergerId: 'SalarySummary::new',
    }
    const wrongTyped = resolveCollectorType(wrong as CollectorDsl, TYPE_EMPLOYEE)
    expect(wrongTyped.ok).toBe(false)
    if (!wrongTyped.ok) expect(wrongTyped.issues[0]?.path).toBe('collector.left')
  })

  it('P11-D05: 深さ超過をCOLLECTOR_DEPTHで拒否する（COLLECTOR_MAX_DEPTHは不変）', () => {
    expect(COLLECTOR_MAX_DEPTH).toBe(4)
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
            downstream: toUnmodList(),
          },
        },
      },
    }
    expect(issuesOf(tooDeep).some((i) => i.code === 'COLLECTOR_DEPTH')).toBe(true)
  })
})

describe('P11-D06 Javaコード表記（v0.14 §2.1）', () => {
  it('P11-D06: 3 kindのJava式が公式APIのoverload形と一致する', () => {
    expect(collectorToJavaExpr(toUnmodList() as CollectorDsl)).toBe(
      'Collectors.toUnmodifiableList()',
    )
    expect(collectorToJavaExpr(toUnmodSet() as CollectorDsl)).toBe('Collectors.toUnmodifiableSet()')
    expect(collectorToJavaExpr(toUnmodMap2() as CollectorDsl)).toBe(
      'Collectors.toUnmodifiableMap(Employee::region, Employee::name)',
    )
    expect(collectorToJavaExpr(toUnmodMap3('first') as CollectorDsl)).toBe(
      'Collectors.toUnmodifiableMap(Employee::region, Employee::name, (a, b) -> a)',
    )
    expect(
      collectorToJavaExpr(toUnmodMap3('sumLong', REGION_KEY, SALARY_VALUE) as CollectorDsl),
    ).toBe('Collectors.toUnmodifiableMap(Employee::region, Employee::salary, Long::sum)')
    expect(
      collectorToJavaExpr(toUnmodMap2(NAME_KEY, IDENTITY_VALUE) as CollectorDsl),
    ).toBe('Collectors.toUnmodifiableMap(Employee::name, Function.identity())')
  })

  it('P11-D06: 入れ子配置でも再帰的に生成される', () => {
    const nested: CollectorDsl = {
      kind: 'groupingBy',
      classifier: REGION_KEY,
      mapFactoryId: null,
      downstream: toUnmodList() as CollectorDsl,
    }
    expect(collectorToJavaExpr(nested)).toBe(
      'Collectors.groupingBy(Employee::region, Collectors.toUnmodifiableList())',
    )
  })
})
