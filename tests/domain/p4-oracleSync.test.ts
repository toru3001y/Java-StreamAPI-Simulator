import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { makeDefinition, runAllSnapshots } from '../helpers'
import { finalSnapshot } from '../p3-helpers'
import type { ScenarioMode } from '../../src/domain/scenario/scenario'

/**
 * P4-O01の照合基準ファイル（oracle/expected-p4-from-core.json）が
 * Simulation Coreの実際の出力と一致していることを保証する同期テスト。
 * JDK 25側との照合本体は `npm run test:oracle` が行う。
 *
 * 対象外のキー:
 * - peekCountResult: Coreはpeek + countの評価省略をシミュレートしない（概念的逐次評価）。
 *   JDK側の観測記録はoracle-result.mdの観測記録欄に残す。
 * - findAnyの選択要素: JDKの保証ではないため名前の一致を移植可能な保証として扱わない
 *   （presentのみ照合）。
 */
const expected = JSON.parse(
  readFileSync(path.join(__dirname, '../../oracle/expected-p4-from-core.json'), 'utf8'),
) as Record<string, unknown>

function result(templateId: string, mode: ScenarioMode = 'standard') {
  return finalSnapshot(makeDefinition(templateId, mode)).output.result
}

describe('P4-O01 Oracle期待値の同期', () => {
  it('P4-O01(sync): reduce全形式と空結果がCoreと一致する', () => {
    expect(result('tmpl-reduce-concat')).toMatchObject({
      valueLabel: `"${expected['reduceConcat']}"`,
    })
    expect(result('tmpl-reduce-concat', 'emptySource')).toMatchObject({
      present: expected['reduceConcatEmptyPresent'],
    })
    expect(result('tmpl-reduce-int')).toMatchObject({ valueLabel: String(expected['reduceIntNoIdentity']) })
    expect(result('tmpl-reduce-int', 'emptySource')).toMatchObject({
      present: expected['reduceIntEmptyPresent'],
    })
    expect(result('tmpl-reduce-int-identity')).toMatchObject({
      valueLabel: String(expected['reduceIntIdentity']),
    })
    expect(result('tmpl-reduce-int-identity', 'emptySource')).toMatchObject({
      valueLabel: String(expected['reduceIntIdentityEmpty']),
    })
    expect(result('tmpl-reduce-salary')).toMatchObject({ valueLabel: '21_700_000L' })
    expect(Number(String(expected['reduceSalary']))).toBe(21_700_000)
    // sequential combiner呼出し回数はCore・JDKともに0
    const ctx = finalSnapshot(makeDefinition('tmpl-reduce-salary')).operationContexts['node-sink']
    if (ctx?.kind === 'reduce') expect(ctx.combinerCallCount).toBe(expected['reduceCombinerCalls'])
  })

  it('P4-O01(sync): countがCoreと一致する（評価省略はJDK観測記録として分離）', () => {
    expect(result('tmpl-count')).toMatchObject({ valueLabel: `${expected['count']}L` })
    expect(result('tmpl-count', 'emptySource')).toMatchObject({ valueLabel: `${expected['countEmpty']}L` })
    // peekCountResultの結果値そのものはCoreの概念評価とも一致する（peek呼出し回数は対象外）
    expect(expected['peekCountResult']).toBe(2)
  })

  it('P4-O01(sync): min / maxがCoreと一致する', () => {
    const minAge = result('tmpl-min-age')
    if (minAge.kind === 'OPTIONAL') {
      expect(minAge.valueLabel).toContain(String(expected['minAge']))
    }
    const maxAge = result('tmpl-max-age')
    if (maxAge.kind === 'OPTIONAL') {
      expect(maxAge.valueLabel).toContain(String(expected['maxAge']))
    }
    expect(result('tmpl-min-age', 'emptySource')).toMatchObject({
      present: expected['minAgeEmptyPresent'],
    })
    expect(result('tmpl-min-int')).toMatchObject({ valueLabel: String(expected['minInt']) })
    expect(result('tmpl-max-long')).toMatchObject({ valueLabel: `${expected['maxLong']}L` })
    expect(result('tmpl-min-double')).toMatchObject({ valueLabel: '1.5' })
    expect(result('tmpl-min-int', 'emptySource')).toMatchObject({
      present: expected['minIntEmptyPresent'],
    })
  })

  it('P4-O01(sync): findFirst / findAnyがCoreと一致する（findAnyはpresentのみ）', () => {
    const findFirst = result('tmpl-findfirst')
    if (findFirst.kind === 'OPTIONAL') {
      expect(findFirst.valueLabel).toContain(String(expected['findFirst']))
    }
    expect(result('tmpl-findfirst', 'midEmpty')).toMatchObject({
      present: expected['findFirstEmptyPresent'],
    })
    expect(result('tmpl-findany')).toMatchObject({ present: expected['findAnyPresent'] })
  })

  it('P4-O01(sync): match系の結果とPredicate呼出し回数がCoreと一致する', () => {
    const cases: readonly [string, ScenarioMode, string, string, number | null][] = [
      ['tmpl-anymatch', 'standard', 'anyMatch', 'anyMatchCalls', null],
      ['tmpl-allmatch', 'standard', 'allMatch', 'allMatchCalls', null],
      ['tmpl-nonematch', 'standard', 'noneMatch', 'noneMatchCalls', null],
      ['tmpl-anymatch', 'emptySource', 'anyMatchEmpty', 'emptyMatchPredicateCalls', 0],
      ['tmpl-allmatch', 'emptySource', 'allMatchEmpty', 'emptyMatchPredicateCalls', 0],
      ['tmpl-nonematch', 'emptySource', 'noneMatchEmpty', 'emptyMatchPredicateCalls', 0],
    ]
    for (const [templateId, mode, resultKey, callsKey, expectedCalls] of cases) {
      const snapshots = runAllSnapshots(makeDefinition(templateId, mode))
      const last = snapshots[snapshots.length - 1]!
      expect(last.output.result, resultKey).toMatchObject({
        valueLabel: String(expected[resultKey]),
      })
      const evaluated = snapshots.filter((s) => s.kind === 'MATCH_EVALUATED').length
      expect(evaluated, callsKey).toBe(expectedCalls ?? expected[callsKey])
    }
  })

  it('P4-O01(sync): sum / average / statisticsと空初期値がCoreと一致する', () => {
    expect(result('tmpl-sum-int')).toMatchObject({ valueLabel: String(expected['sumInt']) })
    expect(result('tmpl-sum-long')).toMatchObject({ valueLabel: `${expected['sumLong']}L` })
    expect(result('tmpl-sum-double')).toMatchObject({ valueLabel: '4.0' })
    expect(result('tmpl-sum-int', 'emptySource')).toMatchObject({ valueLabel: '0' })
    expect(result('tmpl-sum-long', 'emptySource')).toMatchObject({ valueLabel: '0L' })
    expect(result('tmpl-sum-double', 'emptySource')).toMatchObject({ valueLabel: '0.0' })
    expect(result('tmpl-average-int')).toMatchObject({ valueLabel: String(expected['avgInt']) })
    expect(result('tmpl-average-long')).toMatchObject({ valueLabel: '20.0' })
    expect(result('tmpl-average-double')).toMatchObject({ valueLabel: String(expected['avgDouble']) })
    expect(result('tmpl-average-int', 'emptySource')).toMatchObject({
      present: expected['avgEmptyPresent'],
    })
    // statistics [count, sum, min, max, average]
    const statsInt = expected['statsInt'] as number[]
    expect(result('tmpl-stats-int')).toMatchObject({
      countLabel: String(statsInt[0]),
      sumLabel: `${statsInt[1]}L`,
      minLabel: String(statsInt[2]),
      maxLabel: String(statsInt[3]),
      averageLabel: String(statsInt[4]),
    })
    const statsIntEmpty = expected['statsIntEmpty'] as number[]
    expect(statsIntEmpty[2]).toBe(2_147_483_647)
    expect(statsIntEmpty[3]).toBe(-2_147_483_648)
    expect(result('tmpl-stats-int', 'emptySource')).toMatchObject({
      countLabel: '0',
      minLabel: 'Integer.MAX_VALUE',
      maxLabel: 'Integer.MIN_VALUE',
    })
    // doubleの空はJDK側で±Infinityであることをbooleanで照合し、Coreはラベルで保持
    expect(expected['statsDoubleEmptyMinIsPositiveInfinity']).toBe(true)
    expect(expected['statsDoubleEmptyMaxIsNegativeInfinity']).toBe(true)
    expect(result('tmpl-stats-double', 'emptySource')).toMatchObject({
      minLabel: 'Double.POSITIVE_INFINITY',
      maxLabel: 'Double.NEGATIVE_INFINITY',
    })
  })

  it('P4-O01(sync): toArrayと配列型がCoreと一致する', () => {
    expect(result('tmpl-toarray-object')).toMatchObject({
      length: expected['objectArrayLength'],
      componentTypeLabel: expected['objectArrayComponent'],
    })
    const stringArray = result('tmpl-toarray-generator')
    expect(stringArray).toMatchObject({
      componentTypeLabel: expected['stringArrayComponent'],
      length: (expected['stringArray'] as string[]).length,
    })
    if (stringArray.kind === 'ARRAY') {
      expect(stringArray.items.map((i) => i.label)).toEqual(
        (expected['stringArray'] as string[]).map((s) => `"${s}"`),
      )
    }
    const intArray = result('tmpl-toarray-int')
    if (intArray.kind === 'ARRAY') {
      expect(intArray.items.map((i) => i.label)).toEqual(
        (expected['intArray'] as number[]).map(String),
      )
    }
    expect(result('tmpl-toarray-generator', 'emptySource')).toMatchObject({
      length: expected['emptyStringArrayLength'],
      componentTypeLabel: expected['emptyStringArrayComponent'],
    })
  })

  it('P4-O01(sync): forEach系のConsumer履歴とtoListのunmodifiable性がCoreと一致する', () => {
    const forEach = finalSnapshot(makeDefinition('tmpl-foreach'))
    expect(forEach.sideEffects.map((e) => e.message)).toEqual(expected['forEachActions'])
    const forEachOrdered = finalSnapshot(makeDefinition('tmpl-foreachordered'))
    expect(forEachOrdered.sideEffects.map((e) => e.message)).toEqual(
      (expected['forEachOrderedActions'] as number[]).map(String),
    )
    expect(finalSnapshot(makeDefinition('tmpl-foreach', 'emptySource')).sideEffects).toHaveLength(
      expected['forEachEmptyCalls'] as number,
    )
    // toListのunmodifiable性: JDK側で例外を確認し、Coreは注記で保持
    expect(expected['toListUnmodifiable']).toBe(true)
    const confirmed = runAllSnapshots(makeDefinition('tmpl-filter-basic')).find(
      (s) => s.kind === 'RESULT_CONFIRMED',
    )!
    expect(confirmed.explanation.jdkNote).toContain('unmodifiable')
  })
})
