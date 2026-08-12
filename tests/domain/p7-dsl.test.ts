import { describe, expect, it } from 'vitest'
import {
  GATHERER_DSL_KINDS,
  GATHER_ACCUMULATION_KINDS,
  GATHER_FIELD_WHITELIST,
  GATHER_WINDOW_SIZE_MAX,
  GATHER_WINDOW_SIZE_MIN,
} from '../../src/domain/dsl/gatherAst'
import {
  resolveGathererOutputElementType,
  validateGatherAccumulation,
  validateGathererStructure,
} from '../../src/domain/dsl/validateGather'
import {
  REDUCTION_DSL_KINDS,
  REDUCTION_FIELD_WHITELIST,
} from '../../src/domain/dsl/terminalAst'
import { validateReductionIdentity } from '../../src/domain/dsl/validateTerminal'
import type { ValidationCode } from '../../src/domain/types/result'
import type { TypeRef } from '../../src/domain/types/typeRef'
import { formatTypeRef, listOf, streamOf } from '../../src/domain/types/typeRef'
import {
  formatSimValue,
  typeOfSimValue,
  type SimValue,
} from '../../src/domain/model/value'
import { deepFreeze } from '../../src/domain/util/deepFreeze'
import { distinctKeyOf } from '../../src/domain/engine/distinctKey'
import { EngineInvariantError } from '../../src/domain/types/invariantError'
import {
  evaluateValuePredicate,
  numericValueOf,
  predicateComparisonValue,
} from '../../src/domain/dsl/evaluate'
import { evaluateFlatMapper, evaluateMapper } from '../../src/domain/dsl/evaluateMapper'
import {
  compareByComparator,
  compareNatural,
  comparatorKeyLabel,
} from '../../src/domain/dsl/evaluateComparator'
import { evaluateConsumerMessage } from '../../src/domain/dsl/evaluateConsumer'
import { applyReduction, reductionInputLabel } from '../../src/domain/dsl/evaluateReduction'
import {
  collectorAccumulate,
  createCollectorRuntime,
} from '../../src/domain/engine/collectorRuntime'
import { makeDefinition } from '../helpers'
import {
  applyGatherAccumulation,
  gatherAccumulationInputLabel,
  gatherInitialToSimValue,
  GATHER_BOXED_KIND_BY_IDENTITY_TYPE,
} from '../../src/domain/dsl/evaluateGather'

/**
 * P7-D01〜P7-D07: Gatherer DSLの構造検証・境界・ホワイトリスト・型適合・SimValue合成値
 * （Phase 7指示 §12.1、v0.9 §8）。
 */

const TYPE_EMPLOYEE: TypeRef = { kind: 'object', name: 'Employee' }
const TYPE_STRING: TypeRef = { kind: 'object', name: 'String' }
const TYPE_INTEGER: TypeRef = { kind: 'object', name: 'Integer' }
const TYPE_LONG_W: TypeRef = { kind: 'object', name: 'Long' }
const TYPE_DOUBLE_W: TypeRef = { kind: 'object', name: 'Double' }

function codesOf(result: { ok: boolean; issues?: readonly { code: ValidationCode }[] }): string[] {
  return result.ok ? [] : (result.issues ?? []).map((i) => i.code)
}

describe('P7-D01 Gatherer DSL構造検証（closed schema）', () => {
  it('P7-D01: 4 kindのclosed schemaを受理する', () => {
    expect(GATHERER_DSL_KINDS).toEqual(['windowFixed', 'windowSliding', 'scan', 'fold'])
    const accepted: unknown[] = [
      { kind: 'windowFixed', size: 3 },
      { kind: 'windowSliding', size: 2 },
      { kind: 'scan', initial: { type: 'int', value: 0 }, accumulation: { kind: 'numericSum' } },
      {
        kind: 'fold',
        initial: { type: 'long', value: 0 },
        accumulation: { kind: 'employeeFieldSum', field: 'salary' },
      },
    ]
    for (const input of accepted) {
      const result = validateGathererStructure(input)
      expect(result.ok, JSON.stringify(input)).toBe(true)
    }
  })

  it('P7-D01: 未知kindはSTRUCTURE_UNKNOWN_KINDで拒否する', () => {
    for (const kind of ['mapConcurrent', 'windowfixed', 'custom', '', 'andThen']) {
      const result = validateGathererStructure({ kind, size: 2 })
      expect(codesOf(result), kind).toEqual(['STRUCTURE_UNKNOWN_KIND'])
    }
  })

  it('P7-D01: 許可外キーはSTRUCTURE_INVALIDで拒否する（任意コード文字列の混入を防ぐ）', () => {
    const result = validateGathererStructure({
      kind: 'windowFixed',
      size: 2,
      functionBody: 'e -> e',
    })
    expect(codesOf(result)).toContain('STRUCTURE_INVALID')
    const scanExtra = validateGathererStructure({
      kind: 'scan',
      initial: { type: 'int', value: 0 },
      accumulation: { kind: 'numericSum' },
      lambda: '(a, b) -> a + b',
    })
    expect(codesOf(scanExtra)).toContain('STRUCTURE_INVALID')
  })

  it('P7-D01: 必須キーの欠落を拒否する', () => {
    expect(codesOf(validateGathererStructure({ kind: 'windowFixed' }))).toContain('STRUCTURE_INVALID')
    expect(
      codesOf(validateGathererStructure({ kind: 'scan', accumulation: { kind: 'numericSum' } })),
    ).toContain('STRUCTURE_INVALID')
    expect(
      codesOf(validateGathererStructure({ kind: 'fold', initial: { type: 'int', value: 0 } })),
    ).toContain('STRUCTURE_INVALID')
  })

  it('P7-D01: 非objectを拒否する', () => {
    for (const input of [null, undefined, 'windowFixed', 42, true, [{ kind: 'windowFixed' }]]) {
      expect(codesOf(validateGathererStructure(input)), String(input)).toEqual(['STRUCTURE_INVALID'])
    }
  })
})

describe('P7-D02 windowSize境界', () => {
  it('P7-D02: 1 / 16を受理する', () => {
    expect(GATHER_WINDOW_SIZE_MIN).toBe(1)
    expect(GATHER_WINDOW_SIZE_MAX).toBe(16)
    for (const size of [1, 2, 8, 15, 16]) {
      expect(validateGathererStructure({ kind: 'windowFixed', size }).ok, `size=${size}`).toBe(true)
      expect(validateGathererStructure({ kind: 'windowSliding', size }).ok, `size=${size}`).toBe(true)
    }
  })

  it('P7-D02: 0以下はSTRUCTURE_INVALID（JDKのIllegalArgumentExceptionに対応）', () => {
    for (const size of [0, -1, -16]) {
      const result = validateGathererStructure({ kind: 'windowFixed', size })
      expect(codesOf(result), `size=${size}`).toEqual(['STRUCTURE_INVALID'])
    }
  })

  it('P7-D02: 17以上はGATHER_SIZE_LIMIT（教材上限専用code）', () => {
    for (const size of [17, 100, 1000]) {
      const result = validateGathererStructure({ kind: 'windowSliding', size })
      expect(codesOf(result), `size=${size}`).toEqual(['GATHER_SIZE_LIMIT'])
    }
  })

  it('P7-D02: 非整数・非有限値・非数値を拒否する', () => {
    for (const size of [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '3', null]) {
      const result = validateGathererStructure({ kind: 'windowFixed', size })
      expect(codesOf(result), String(size)).toEqual(['STRUCTURE_INVALID'])
    }
  })
})

describe('P7-D03 AccumulationRuleホワイトリスト', () => {
  it('P7-D03: 3 kindを受理する', () => {
    expect(GATHER_ACCUMULATION_KINDS).toEqual(['numericSum', 'stringConcat', 'employeeFieldSum'])
    expect(validateGatherAccumulation({ kind: 'numericSum' }).ok).toBe(true)
    expect(validateGatherAccumulation({ kind: 'stringConcat' }).ok).toBe(true)
    for (const field of GATHER_FIELD_WHITELIST) {
      expect(validateGatherAccumulation({ kind: 'employeeFieldSum', field }).ok, field).toBe(true)
    }
  })

  it('P7-D03: 未知kind・未知fieldを拒否する', () => {
    expect(codesOf(validateGatherAccumulation({ kind: 'average' }))).toEqual([
      'STRUCTURE_UNKNOWN_KIND',
    ])
    for (const field of ['name', 'region', 'hireDate', 'department', 'skills', '']) {
      expect(
        codesOf(validateGatherAccumulation({ kind: 'employeeFieldSum', field })),
        field,
      ).toEqual(['WHITELIST_FIELD'])
    }
  })

  it('P7-D03: Gatherer専用fieldホワイトリストはage / salary / evaluationである', () => {
    expect([...GATHER_FIELD_WHITELIST]).toEqual(['age', 'salary', 'evaluation'])
  })

  it('P7-D03: REDUCTION_FIELD_WHITELISTはsalary / ageのまま不変である（Terminal DSL無変更）', () => {
    // 共有DSLへのfield追加はPhase 4の許可範囲を変えるため行わない（v0.9 §8.2）
    expect([...REDUCTION_FIELD_WHITELIST]).toEqual(['salary', 'age'])
    expect(REDUCTION_FIELD_WHITELIST).not.toContain('evaluation')
    expect([...REDUCTION_DSL_KINDS]).toEqual(['numericSum', 'stringConcat', 'employeeFieldSum'])
  })
})

describe('P7-D04 identity検証（既存validateReductionIdentityへの委譲）', () => {
  it('P7-D04: 4 typeを受理する', () => {
    const cases: { type: string; value: unknown }[] = [
      { type: 'int', value: 0 },
      { type: 'long', value: 0 },
      { type: 'double', value: 0 },
      { type: 'string', value: '' },
    ]
    for (const initial of cases) {
      const result = validateGathererStructure({
        kind: 'scan',
        initial,
        accumulation: { kind: 'numericSum' },
      })
      expect(result.ok, initial.type).toBe(true)
    }
  })

  it('P7-D04: null / 非object / int32範囲外 / safe integer範囲外を拒否する', () => {
    const rejected: unknown[] = [
      null,
      'zero',
      { type: 'int', value: null },
      { type: 'int', value: 2_147_483_648 },
      { type: 'int', value: -2_147_483_649 },
      { type: 'long', value: Number.MAX_SAFE_INTEGER + 2 },
      { type: 'string', value: 0 },
      { type: 'bigint', value: 0 },
      { type: 'int', value: 1.5 },
    ]
    for (const initial of rejected) {
      const result = validateGathererStructure({
        kind: 'fold',
        initial,
        accumulation: { kind: 'numericSum' },
      })
      expect(result.ok, JSON.stringify(initial)).toBe(false)
    }
  })

  it('P7-D04: 既存validateReductionIdentityと同一の受理範囲である', () => {
    const samples: unknown[] = [
      { type: 'int', value: 0 },
      { type: 'int', value: 2_147_483_647 },
      { type: 'int', value: 2_147_483_648 },
      { type: 'long', value: Number.MAX_SAFE_INTEGER },
      { type: 'long', value: Number.MAX_SAFE_INTEGER + 2 },
      { type: 'double', value: 1.5 },
      { type: 'string', value: 'x' },
      { type: 'string', value: 1 },
      null,
      { type: 'unknown', value: 0 },
    ]
    for (const initial of samples) {
      const viaGather = validateGathererStructure({
        kind: 'scan',
        initial,
        accumulation: { kind: 'numericSum' },
      }).ok
      const viaTerminal = validateReductionIdentity(initial).ok
      expect(viaGather, JSON.stringify(initial)).toBe(viaTerminal)
    }
  })
})

describe('P7-D05 型適合表（v0.9 §8.3）', () => {
  const ok = (dsl: unknown, elementType: TypeRef) =>
    resolveGathererOutputElementType(
      (validateGathererStructure(dsl) as { value: never }).value,
      streamOf(elementType),
    )

  it('P7-D05: stringConcat × String（initial.type = string）→ String', () => {
    const result = ok(
      { kind: 'scan', initial: { type: 'string', value: '' }, accumulation: { kind: 'stringConcat' } },
      TYPE_STRING,
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(formatTypeRef(result.value)).toBe('String')
  })

  it('P7-D05: numericSum × Integer / Long / Double（Rは入力Tと同じboxed型）', () => {
    const table: { element: TypeRef; initialType: string; expected: string }[] = [
      { element: TYPE_INTEGER, initialType: 'int', expected: 'Integer' },
      { element: TYPE_LONG_W, initialType: 'long', expected: 'Long' },
      { element: TYPE_DOUBLE_W, initialType: 'double', expected: 'Double' },
    ]
    for (const row of table) {
      const result = ok(
        {
          kind: 'fold',
          initial: { type: row.initialType, value: 0 },
          accumulation: { kind: 'numericSum' },
        },
        row.element,
      )
      expect(result.ok, row.expected).toBe(true)
      if (result.ok) expect(formatTypeRef(result.value)).toBe(row.expected)
    }
  })

  it('P7-D05: employeeFieldSum × Employee（fieldに対応するboxed型）', () => {
    const table: { field: string; initialType: string; expected: string }[] = [
      { field: 'age', initialType: 'int', expected: 'Integer' },
      { field: 'salary', initialType: 'long', expected: 'Long' },
      { field: 'evaluation', initialType: 'double', expected: 'Double' },
    ]
    for (const row of table) {
      const result = ok(
        {
          kind: 'fold',
          initial: { type: row.initialType, value: 0 },
          accumulation: { kind: 'employeeFieldSum', field: row.field },
        },
        TYPE_EMPLOYEE,
      )
      expect(result.ok, row.field).toBe(true)
      if (result.ok) expect(formatTypeRef(result.value)).toBe(row.expected)
    }
  })

  it('P7-D05: 不適合な組合せはTYPE_MISMATCHで拒否する', () => {
    const rejected: { dsl: unknown; element: TypeRef; label: string }[] = [
      {
        dsl: { kind: 'scan', initial: { type: 'string', value: '' }, accumulation: { kind: 'stringConcat' } },
        element: TYPE_EMPLOYEE,
        label: 'stringConcat × Employee',
      },
      {
        dsl: { kind: 'scan', initial: { type: 'int', value: 0 }, accumulation: { kind: 'numericSum' } },
        element: TYPE_STRING,
        label: 'numericSum × String',
      },
      {
        dsl: { kind: 'scan', initial: { type: 'long', value: 0 }, accumulation: { kind: 'numericSum' } },
        element: TYPE_INTEGER,
        label: 'numericSum × Integer + long initial',
      },
      {
        dsl: {
          kind: 'fold',
          initial: { type: 'int', value: 0 },
          accumulation: { kind: 'employeeFieldSum', field: 'salary' },
        },
        element: TYPE_EMPLOYEE,
        label: 'salary + int initial',
      },
      {
        dsl: {
          kind: 'fold',
          initial: { type: 'long', value: 0 },
          accumulation: { kind: 'employeeFieldSum', field: 'salary' },
        },
        element: TYPE_STRING,
        label: 'employeeFieldSum × String',
      },
      {
        dsl: { kind: 'scan', initial: { type: 'int', value: 0 }, accumulation: { kind: 'stringConcat' } },
        element: TYPE_STRING,
        label: 'stringConcat + int initial',
      },
    ]
    for (const row of rejected) {
      const result = ok(row.dsl, row.element)
      expect(codesOf(result), row.label).toEqual(['TYPE_MISMATCH'])
    }
  })

  it('P7-D05: primitive Stream直結を拒否し、boxed()経由を促す', () => {
    for (const name of ['IntStream', 'LongStream', 'DoubleStream'] as const) {
      const result = resolveGathererOutputElementType(
        { kind: 'windowFixed', size: 2 },
        { kind: 'primitiveStream', name },
      )
      expect(codesOf(result), name).toEqual(['TYPE_MISMATCH'])
      if (!result.ok) {
        expect(result.issues[0]?.message).toContain('boxed()')
      }
    }
  })
})

describe('P7-D06 型遷移', () => {
  it('P7-D06: window系はStream<T> → Stream<List<T>>（collection合成TypeRef）', () => {
    for (const kind of ['windowFixed', 'windowSliding'] as const) {
      const result = resolveGathererOutputElementType({ kind, size: 2 }, streamOf(TYPE_EMPLOYEE))
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toEqual(listOf(TYPE_EMPLOYEE))
        expect(formatTypeRef(streamOf(result.value))).toBe('Stream<List<Employee>>')
      }
    }
    const strWindow = resolveGathererOutputElementType(
      { kind: 'windowSliding', size: 2 },
      streamOf(TYPE_STRING),
    )
    expect(strWindow.ok).toBe(true)
    if (strWindow.ok) expect(formatTypeRef(streamOf(strWindow.value))).toBe('Stream<List<String>>')
  })

  it('P7-D06: scan / foldはStream<T> → Stream<boxed R>', () => {
    const scan = resolveGathererOutputElementType(
      { kind: 'scan', initial: { type: 'int', value: 0 }, accumulation: { kind: 'numericSum' } },
      streamOf(TYPE_INTEGER),
    )
    expect(scan.ok).toBe(true)
    if (scan.ok) expect(formatTypeRef(streamOf(scan.value))).toBe('Stream<Integer>')
    const fold = resolveGathererOutputElementType(
      {
        kind: 'fold',
        initial: { type: 'long', value: 0 },
        accumulation: { kind: 'employeeFieldSum', field: 'salary' },
      },
      streamOf(TYPE_EMPLOYEE),
    )
    expect(fold.ok).toBe(true)
    if (fold.ok) expect(formatTypeRef(streamOf(fold.value))).toBe('Stream<Long>')
  })

  it('P7-D06: 実templateのresultTypeが導出される（List<List<Employee>> / Optional<Long>）', () => {
    expect(formatTypeRef(makeDefinition('tmpl-gather-window-fixed', 'standard').resultType)).toBe(
      'List<List<Employee>>',
    )
    expect(formatTypeRef(makeDefinition('tmpl-gather-window-sliding', 'standard').resultType)).toBe(
      'List<List<String>>',
    )
    expect(formatTypeRef(makeDefinition('tmpl-gather-scan', 'standard').resultType)).toBe(
      'List<Integer>',
    )
    expect(formatTypeRef(makeDefinition('tmpl-gather-scan-concat', 'standard').resultType)).toBe(
      'List<String>',
    )
    expect(formatTypeRef(makeDefinition('tmpl-gather-fold', 'standard').resultType)).toBe(
      'Optional<Long>',
    )
  })
})

describe('P7-D07 SimValue合成値（list variant）', () => {
  const listValue: SimValue = {
    kind: 'list',
    elementType: TYPE_STRING,
    value: [
      { kind: 'string', value: 'Java' },
      { kind: 'string', value: 'SQL' },
    ],
  }

  // ---- 到達不能経路の検証で使うDSL（いずれも既存の検証済み形状） ----
  const CURRENT_VALUE_PREDICATE = {
    kind: 'currentValueCompare',
    operator: 'LT',
    value: { type: 'int', value: 5 },
  } as const
  const TO_UPPER_MAPPER = { kind: 'toUpper' } as const
  const LIST_STREAM_MAPPER = { kind: 'listStream' } as const
  const NATURAL_COMPARATOR = { kind: 'natural' } as const
  const PRINT_VALUE_CONSUMER = { kind: 'printValue' } as const
  const NUMERIC_SUM = { kind: 'numericSum' } as const
  const BOXED_ONE: SimValue = { kind: 'boxedInt', value: 1 }

  /**
   * Collector蓄積経路（`collectorRuntime.ts`）へ合成List値を渡す。
   * `collectorAccumulate` は公開関数のため、実経路をそのまま呼び出して検証する。
   *
   * なお`collectorAccumulate`は先頭で`shortLabel(value)`を評価するため、
   * どのCollector種別でもここが**入口ガード**になる。
   * `employeeOf` / `stringOf` / `classifierKey` のガードはその内側の多層防御であり、
   * 入口を通過した合成List値が存在しない以上、単体では到達しない
   * （判断記録 §3.3。到達不能であること自体がこのテストで担保される）。
   */
  function accumulateViaCollector(value: SimValue): unknown {
    const rt = createCollectorRuntime('node-sink', TYPE_EMPLOYEE, { kind: 'toList' }, null)
    return collectorAccumulate(rt, 'probe-001', value, () => {})
  }

  /**
   * Collector種別を変えても入口ガードで停止すること。
   * 各Collectorが要求する要素型（joiningはString、その他はEmployee）で構築する。
   */
  function accumulateViaCollectorKinds(value: SimValue): void {
    const cases = [
      {
        elementType: TYPE_STRING,
        collector: { kind: 'joining', delimiter: null, prefix: null, suffix: null },
      },
      { elementType: TYPE_EMPLOYEE, collector: { kind: 'summingInt', field: 'age' } },
      {
        elementType: TYPE_EMPLOYEE,
        collector: {
          kind: 'groupingBy',
          classifier: { kind: 'employeeField', field: 'region' },
          mapFactoryId: null,
          downstream: null,
        },
      },
    ] as const
    for (const { elementType, collector } of cases) {
      const rt = createCollectorRuntime('node-sink', elementType, collector, null)
      expect(
        () => collectorAccumulate(rt, 'probe-001', value, () => {}),
        collector.kind,
      ).toThrow(EngineInvariantError)
    }
  }

  it('P7-D07: formatSimValueは要素を再帰整形する', () => {
    expect(formatSimValue(listValue)).toBe('["Java", "SQL"]')
    const employeeList: SimValue = {
      kind: 'list',
      elementType: TYPE_EMPLOYEE,
      value: [
        {
          kind: 'employee',
          value: {
            name: '佐藤',
            age: 35,
            salary: 5_500_000,
            evaluation: 4.2,
            region: '関東',
            hireDate: '2022-04-01',
            department: { name: '開発部', division: '技術本部' },
            skills: ['Java'],
          },
        },
      ],
    }
    expect(formatSimValue(employeeList)).toBe('[佐藤（age=35）]')
    // 入れ子のlistも再帰整形できる
    const nested: SimValue = { kind: 'list', elementType: TYPE_STRING, value: [listValue] }
    expect(formatSimValue(nested)).toBe('[["Java", "SQL"]]')
  })

  it('P7-D07: typeOfSimValueは自己保持のelementTypeを使い、0件でも型が確定する', () => {
    expect(typeOfSimValue(listValue)).toEqual(listOf(TYPE_STRING))
    const empty: SimValue = { kind: 'list', elementType: TYPE_EMPLOYEE, value: [] }
    expect(typeOfSimValue(empty)).toEqual(listOf(TYPE_EMPLOYEE))
    expect(formatSimValue(empty)).toBe('[]')
  })

  it('P7-D07: 既存stringListの表示・型は不変である（並存させ移行しない）', () => {
    const stringList: SimValue = { kind: 'stringList', value: ['Java', 'SQL'] }
    // stringListは要素をクォートせず join する既存表示のまま
    expect(formatSimValue(stringList)).toBe('[Java, SQL]')
    expect(typeOfSimValue(stringList)).toEqual(listOf(TYPE_STRING))
    expect(distinctKeyOf(stringList)).toBe('list:["Java","SQL"]')
  })

  it('P7-D07: structuredClone / deepFreeze可能である（snapshot契約）', () => {
    const cloned = structuredClone(listValue)
    expect(cloned).toEqual(listValue)
    const frozen = deepFreeze(structuredClone(listValue))
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.value)).toBe(true)
  })

  /**
   * 棚卸し（docs/phase-7-decisions.md §3）で列挙した到達不能経路すべてを検証する。
   *
   * 例外型は名前の違いではなくJ-3のフェイルセーフ契約そのものである:
   * `SimulationSession.step` は `EngineInvariantError` だけを捕捉して `ERROR` へ遷移し、
   * plain `Error` は再送出する（`src/application/session.ts`）。
   */
  const UNREACHABLE_PATHS: { readonly name: string; readonly run: () => unknown }[] = [
    { name: 'distinctKey.distinctKeyOf', run: () => distinctKeyOf(listValue) },
    { name: 'evaluate.numericValueOf', run: () => numericValueOf(listValue) },
    {
      name: 'evaluate.predicateComparisonValue',
      run: () => predicateComparisonValue(CURRENT_VALUE_PREDICATE, listValue),
    },
    {
      name: 'evaluate.evaluateValuePredicate',
      run: () => evaluateValuePredicate(CURRENT_VALUE_PREDICATE, listValue),
    },
    { name: 'evaluateMapper.evaluateMapper', run: () => evaluateMapper(TO_UPPER_MAPPER, listValue) },
    {
      name: 'evaluateMapper.evaluateFlatMapper',
      run: () => evaluateFlatMapper(LIST_STREAM_MAPPER, listValue),
    },
    { name: 'evaluateComparator.compareNatural', run: () => compareNatural(listValue, listValue) },
    {
      name: 'evaluateComparator.compareByComparator',
      run: () => compareByComparator(NATURAL_COMPARATOR, listValue, listValue),
    },
    {
      name: 'evaluateComparator.comparatorKeyLabel',
      run: () => comparatorKeyLabel(NATURAL_COMPARATOR, listValue),
    },
    {
      name: 'evaluateConsumer.evaluateConsumerMessage',
      run: () => evaluateConsumerMessage(PRINT_VALUE_CONSUMER, listValue),
    },
    {
      name: 'evaluateReduction.applyReduction（累積値）',
      run: () => applyReduction(NUMERIC_SUM, listValue, { kind: 'int', value: 1 }),
    },
    {
      name: 'evaluateReduction.applyReduction（入力要素）',
      run: () => applyReduction(NUMERIC_SUM, { kind: 'int', value: 1 }, listValue),
    },
    {
      name: 'evaluateReduction.reductionInputLabel',
      run: () => reductionInputLabel(NUMERIC_SUM, listValue),
    },
    { name: 'collectorRuntime.collectorAccumulate', run: () => accumulateViaCollector(listValue) },
    // Gatherer DSLの累積はTerminal DSLと別実装（evaluateGather.ts）のため個別に検証する。
    // `numericSum`はReductionRule / GatherAccumulationRuleの双方で同一構造のためNUMERIC_SUMを共用する
    {
      name: 'evaluateGather.applyGatherAccumulation（累積値）',
      run: () => applyGatherAccumulation(NUMERIC_SUM, listValue, BOXED_ONE),
    },
    {
      name: 'evaluateGather.applyGatherAccumulation（入力要素）',
      run: () => applyGatherAccumulation(NUMERIC_SUM, BOXED_ONE, listValue),
    },
    {
      name: 'evaluateGather.gatherAccumulationInputLabel',
      run: () => gatherAccumulationInputLabel(NUMERIC_SUM, listValue),
    },
  ]

  it('P7-D07: 棚卸しした全ての到達不能経路がEngineInvariantErrorを送出する', () => {
    // 判断記録§3の棚卸し表のうち、`list`を実装した2箇所（formatSimValue / typeOfSimValue）と
    // 生成側のみの2箇所（materializeSource / javaCode）を除く全経路を網羅する
    expect(UNREACHABLE_PATHS).toHaveLength(17)
    for (const path of UNREACHABLE_PATHS) {
      expect(path.run, path.name).toThrow(EngineInvariantError)
    }
  })

  it('P7-D07: Collectorはどの種別でも入口ガードで合成List値を拒否する', () => {
    accumulateViaCollectorKinds(listValue)
  })

  it('P7-D07: boxValueへ合成List値が到達しないことをPipeline構造から確認する（直接assertではない）', () => {
    // boxValueはprivate関数で`list`を渡す公開経路がないため、この検証は例外送出のassertではなく
    // 「到達し得ない」ことのPipeline構造検証である（既存のdefault分岐が変更前からEngineInvariantErrorを
    // 送出しており実装変更は不要。判断記録§3.3の但し書きに対応）。
    // `boxed`操作の入力はinstantiate手順4でprimitiveStreamに限定される
    // （`boxedWrapper` ruleがprimitiveStream以外をTYPE_MISMATCHで拒否）。
    const def = makeDefinition('tmpl-gather-scan', 'standard')
    const boxed = def.nodes.find((n) => n.operationId === 'boxed')
    expect(boxed).toBeDefined()
    expect(boxed?.inputType?.kind).toBe('primitiveStream')
    // boxedの下流にgatherが来る構成であり、boxedの上流にgather（合成List値の生成元）は存在しない
    const nodeIds = def.nodes.map((n) => n.operationId)
    expect(nodeIds.indexOf('boxed')).toBeLessThan(nodeIds.indexOf('gather'))
  })

  it('P7-D07: 既存kindに対する例外型・挙動は変更されていない', () => {
    // listガードの追加が既存kindの検証・例外へ影響していないこと
    expect(distinctKeyOf({ kind: 'string', value: 'x' })).toBe('str:x')
    expect(numericValueOf({ kind: 'boxedInt', value: 7 })).toBe(7)
    expect(() => numericValueOf({ kind: 'string', value: 'x' })).toThrow(Error)
    expect(() => numericValueOf({ kind: 'string', value: 'x' })).not.toThrow(EngineInvariantError)
    expect(() => evaluateFlatMapper(LIST_STREAM_MAPPER, { kind: 'string', value: 'x' })).toThrow(
      Error,
    )
    expect(() =>
      evaluateFlatMapper(LIST_STREAM_MAPPER, { kind: 'string', value: 'x' }),
    ).not.toThrow(EngineInvariantError)
    // 既存stringListは従来どおり受理される
    expect(evaluateFlatMapper(LIST_STREAM_MAPPER, { kind: 'stringList', value: ['a'] })).toEqual([
      { kind: 'string', value: 'a' },
    ])
    expect(compareNatural({ kind: 'string', value: 'a' }, { kind: 'string', value: 'b' })).toBe(-1)
    // evaluateGatherも同じで、`list`以外の型不整合は従来どおりplain Errorのままである
    expect(() => applyGatherAccumulation(NUMERIC_SUM, { kind: 'string', value: 'x' }, BOXED_ONE))
      .toThrow(Error)
    expect(() =>
      applyGatherAccumulation(NUMERIC_SUM, { kind: 'string', value: 'x' }, BOXED_ONE),
    ).not.toThrow(EngineInvariantError)
    // 既存kindのinputLabelは例外にならず従来の戻り値を保つ
    expect(gatherAccumulationInputLabel(NUMERIC_SUM, BOXED_ONE)).toBe('')
  })
})

describe('P7-D07 boxed変換契約（§7.4-4）', () => {
  it('P7-D07: initial.typeのタグと累積値のSimValue kindが対応する', () => {
    expect(GATHER_BOXED_KIND_BY_IDENTITY_TYPE).toEqual({
      int: 'boxedInt',
      long: 'boxedLong',
      double: 'boxedDouble',
      string: 'string',
    })
    expect(gatherInitialToSimValue({ type: 'int', value: 0 })).toEqual({ kind: 'boxedInt', value: 0 })
    expect(gatherInitialToSimValue({ type: 'long', value: 0 })).toEqual({ kind: 'boxedLong', value: 0 })
    expect(gatherInitialToSimValue({ type: 'double', value: 0 })).toEqual({
      kind: 'boxedDouble',
      value: 0,
    })
    expect(gatherInitialToSimValue({ type: 'string', value: '' })).toEqual({
      kind: 'string',
      value: '',
    })
  })

  it('P7-D07: 累積はboxed kindのまま行われ、primitive kindへ落ちない', () => {
    const acc = gatherInitialToSimValue({ type: 'long', value: 0 })
    const next = applyGatherAccumulation(
      { kind: 'employeeFieldSum', field: 'salary' },
      acc,
      {
        kind: 'employee',
        value: {
          name: '佐藤',
          age: 35,
          salary: 5_500_000,
          evaluation: 4.2,
          region: '関東',
          hireDate: '2022-04-01',
          department: { name: '開発部', division: '技術本部' },
          skills: [],
        },
      },
    )
    expect(next).toEqual({ kind: 'boxedLong', value: 5_500_000 })
    expect(formatTypeRef(typeOfSimValue(next))).toBe('Long')
  })

  it('P7-D07: 型不整合な累積は例外になる（検証済みDSLでは到達しない）', () => {
    // `list`以外の型不整合はガード追加前と同じplain Errorであり、例外型は変わっていない
    expect(() =>
      applyGatherAccumulation({ kind: 'numericSum' }, { kind: 'string', value: '' }, {
        kind: 'boxedInt',
        value: 1,
      }),
    ).toThrow()
    expect(() =>
      applyGatherAccumulation({ kind: 'stringConcat' }, { kind: 'boxedInt', value: 0 }, {
        kind: 'string',
        value: 'x',
      }),
    ).toThrow()
    expect(() =>
      applyGatherAccumulation(
        { kind: 'employeeFieldSum', field: 'age' },
        { kind: 'boxedInt', value: 0 },
        { kind: 'string', value: 'x' },
      ),
    ).toThrow()
  })
})
