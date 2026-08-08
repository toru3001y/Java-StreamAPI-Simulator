import { describe, expect, it } from 'vitest'
import { validateStructure, validateTypes } from '../../src/domain/dsl/validate'
import { evaluateValuePredicate, predicateComparisonValue } from '../../src/domain/dsl/evaluate'
import { predicateToJavaExpr } from '../../src/domain/dsl/javaCode'
import { STANDARD_EMPLOYEES } from '../../src/domain/fixtures/employees'
import { runAllSnapshots } from '../helpers'
import {
  assertProcessingAtMostOne,
  instantiateCustom,
  makeCustomDefinition,
  tplSink,
} from '../p3-helpers'
import type { PipelineTemplate } from '../../src/domain/template/pipelineTemplate'

/**
 * Phase 3完了レビューの修正2件の検証。
 * 修正1: takeWhile / dropWhileのEmployee fieldCompare実行（stepEngineの比較値取得の一般化）
 * 修正2: DSLのint定数をJava int範囲に制限
 */

const AGE_GTE_30 = {
  kind: 'fieldCompare',
  field: 'age',
  operator: 'GTE',
  value: { type: 'int', value: 30 },
} as const

function employeeWhileTemplate(op: 'takeWhile' | 'dropWhile'): PipelineTemplate {
  return {
    templateId: `tmpl-test-${op}-employee`,
    version: 1,
    targetOperationId: op,
    targetNodeId: `node-${op}`,
    title: 'review fix 1',
    sourceDefinition: {
      slotId: null,
      defaultDsl: { kind: 'collection', collectionId: 'employees' },
      allowedSourceKinds: ['collection'],
    },
    nodes: [
      { nodeId: 'node-src', operationId: 'source.collectionStream', role: 'source', slotId: null },
      { nodeId: `node-${op}`, operationId: op, role: 'intermediate', slotId: 'slot-predicate-1' },
      tplSink(),
    ],
    parameterSlots: [
      {
        slotId: 'slot-predicate-1',
        targetNodeId: `node-${op}`,
        kind: 'predicate',
        required: true,
        allowedFields: ['age'],
        allowedOperators: ['GTE'],
      },
    ],
    allowedDslProfile: { predicateKinds: ['fieldCompare'] },
    supportedModes: ['standard'],
    jdkNotes: [],
    snapshotBudget: { limit: 500, estimatedMax: 40 },
  }
}

describe('レビュー修正1: takeWhile / dropWhileのEmployee fieldCompare実行', () => {
  it('Stream<Employee>.takeWhile(e -> e.age() >= 30)で佐藤だけ通過し、鈴木が境界、以降は未評価', () => {
    const def = makeCustomDefinition(
      employeeWhileTemplate('takeWhile'),
      { 'slot-predicate-1': AGE_GTE_30 },
      'standard',
      STANDARD_EMPLOYEES,
    )
    const snapshots = runAllSnapshots(def)
    const last = snapshots[snapshots.length - 1]!
    // 佐藤（35 >= 30 true）だけ通過
    expect(last.output.items.map((i) => i.label)).toEqual(['佐藤（age=35）'])
    // 鈴木（27）が最初のfalseの境界要素として除外、高橋・田中は未評価
    expect(last.elementLatestStates['emp-001']).toBe('PASSED')
    expect(last.elementLatestStates['emp-002']).toBe('REJECTED')
    expect(last.elementLatestStates['emp-003']).toBe('UNEVALUATED')
    expect(last.elementLatestStates['emp-004']).toBe('UNEVALUATED')
    // Predicate評価は2回（佐藤・鈴木）だけで、短絡確定snapshotがある
    expect(snapshots.filter((s) => s.kind === 'PREDICATE_EVALUATED')).toHaveLength(2)
    expect(snapshots.some((s) => s.kind === 'SHORT_CIRCUIT_CONFIRMED')).toBe(true)
    expect(snapshots.filter((s) => s.kind === 'SOURCE_EMIT')).toHaveLength(2)
    // 境界情報のcontext
    const ctx = last.operationContexts['node-takeWhile']
    if (ctx?.kind === 'takeWhile') {
      expect(ctx.stopped).toBe(true)
      expect(ctx.boundaryLabel).toBe('鈴木（age=27）')
    }
    // 全snapshotでPROCESSING最大1件
    assertProcessingAtMostOne(snapshots, 'takeWhile-employee')
  })

  it('Stream<Employee>.dropWhile(e -> e.age() >= 30)で佐藤をdropし、鈴木から通過モードで全員出力', () => {
    const def = makeCustomDefinition(
      employeeWhileTemplate('dropWhile'),
      { 'slot-predicate-1': AGE_GTE_30 },
      'standard',
      STANDARD_EMPLOYEES,
    )
    const snapshots = runAllSnapshots(def)
    const last = snapshots[snapshots.length - 1]!
    expect(last.output.items.map((i) => i.label)).toEqual([
      '鈴木（age=27）',
      '高橋（age=42）',
      '田中（age=29）',
    ])
    // 佐藤はdrop（REJECTED）、境界の鈴木でDROP_MODE_ENTERED
    expect(last.elementLatestStates['emp-001']).toBe('REJECTED')
    const entered = snapshots.filter((s) => s.kind === 'DROP_MODE_ENTERED')
    expect(entered).toHaveLength(1)
    expect(entered[0]?.currentElementId).toBe('emp-002')
    // Predicate評価は2回（佐藤・鈴木）だけ。高橋（trueとなる値）は再評価されない
    expect(snapshots.filter((s) => s.kind === 'PREDICATE_EVALUATED')).toHaveLength(2)
    assertProcessingAtMostOne(snapshots, 'dropWhile-employee')
  })

  it('Java式・snapshotの値表示・評価が同じfield値を参照する', () => {
    const def = makeCustomDefinition(
      employeeWhileTemplate('takeWhile'),
      { 'slot-predicate-1': AGE_GTE_30 },
      'standard',
      STANDARD_EMPLOYEES,
    )
    // Java式
    expect(predicateToJavaExpr(AGE_GTE_30)).toBe('e -> e.age() >= 30')
    expect(def.javaCode.map((l) => l.text).join('\n')).toContain('.takeWhile(e -> e.age() >= 30)')
    // snapshotの値表示: 「佐藤.age() → 35」と「35 >= 30 → true」
    const snapshots = runAllSnapshots(def)
    const evaluated = snapshots.filter((s) => s.kind === 'PREDICATE_EVALUATED')
    expect(evaluated[0]?.processing?.inputLabel).toBe('佐藤.age() → 35')
    expect(evaluated[0]?.processing?.evaluation).toBe('35 >= 30 → true')
    expect(evaluated[1]?.processing?.inputLabel).toBe('鈴木.age() → 27')
    expect(evaluated[1]?.processing?.evaluation).toBe('27 >= 30 → false')
    // 共通関数がPredicate種別で比較値を切り替える（takeWhile / dropWhileで共用）
    const sato = { kind: 'employee', value: STANDARD_EMPLOYEES[0]!.value } as const
    expect(predicateComparisonValue(AGE_GTE_30, sato)).toBe(35)
    expect(evaluateValuePredicate(AGE_GTE_30, sato)).toBe(true)
    expect(
      predicateComparisonValue(
        { kind: 'currentValueCompare', operator: 'LT', value: { type: 'int', value: 5 } },
        { kind: 'int', value: 6 },
      ),
    ).toBe(6)
  })
})

describe('レビュー修正2: DSLのint定数をJava int範囲に制限', () => {
  const INT32_MAX = 2_147_483_647
  const INT32_MIN = -2_147_483_648

  function fieldPredicate(value: number): unknown {
    return { kind: 'fieldCompare', field: 'age', operator: 'GTE', value: { type: 'int', value } }
  }

  function currentPredicate(value: number): unknown {
    return { kind: 'currentValueCompare', operator: 'LT', value: { type: 'int', value } }
  }

  it('INT32_MIN / INT32_MAXは受理し、範囲外はValidationIssueで拒否する（例外にしない）', () => {
    for (const make of [fieldPredicate, currentPredicate]) {
      // 境界値は受理（構造検証 + 型検証）
      for (const ok of [INT32_MIN, INT32_MAX, 0]) {
        const result = validateStructure(make(ok))
        expect(result.ok, `${make.name}:${ok}`).toBe(true)
        if (result.ok) expect(validateTypes(result.value).ok, `${make.name}:${ok}`).toBe(true)
      }
      // 範囲外は例外ではなくResultで拒否
      for (const bad of [INT32_MAX + 1, INT32_MIN - 1]) {
        const result = validateStructure(make(bad))
        expect(result.ok, `${make.name}:${bad}`).toBe(false)
        if (!result.ok) {
          expect(result.issues[0]?.code).toBe('TYPE_MISMATCH')
          expect(result.issues[0]?.path).toContain('value.value')
        }
      }
    }
  })

  it('範囲外の値はPipelineDefinition生成前に拒否され、不正なJavaコードを生成しない', () => {
    const result = instantiateCustom(
      employeeWhileTemplate('takeWhile'),
      { 'slot-predicate-1': fieldPredicate(INT32_MAX + 1) },
      'standard',
      STANDARD_EMPLOYEES,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.code).toBe('TYPE_MISMATCH')
    // 受理される境界値からは正当なJavaコードが生成される
    const okExpr = predicateToJavaExpr({
      kind: 'currentValueCompare',
      operator: 'LT',
      value: { type: 'int', value: INT32_MAX },
    })
    expect(okExpr).toBe(`n -> n < ${INT32_MAX}`)
  })
})
