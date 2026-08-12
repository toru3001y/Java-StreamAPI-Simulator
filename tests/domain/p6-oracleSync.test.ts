import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  P6_BOUNDARY_EMPLOYEES,
  P6_DOUBLE_VALUES,
  P6_INT_VALUES,
  P6_LONG_VALUES,
  buildP6ExpectedFromCore,
} from '../p6-oracle-expected'
import {
  AGE_MAX,
  AGE_MIN,
  DOUBLE_ABS_MAX,
  DOUBLE_ABS_MIN,
  EVALUATION_MAX,
  EVALUATION_MIN,
  INT32_MAX,
  INT32_MIN,
  SALARY_MAX,
  SALARY_MIN,
} from '../../src/application/importContract'

/**
 * P6-O01(sync): oracle/expected-p6-from-core.json がSimulation Coreの結果と一致することを保証する。
 *
 * JDKとの照合は `npm run test:oracle`（Docker + gradle:9.6.1-jdk25）が行い、
 * こちらは「expected JSON ⇔ Simulation Core」の同期だけを担保する二層構造とする。
 */
const expected = JSON.parse(
  readFileSync(path.join(__dirname, '../../oracle/expected-p6-from-core.json'), 'utf8'),
) as Record<string, unknown>

describe('P6-O01(sync) expected-p6-from-core.jsonとSimulation Coreの一致', () => {
  it('P6-O01(sync): 全キーがSimulation Core（取込相当candidate）由来の値と一致する', () => {
    const built = buildP6ExpectedFromCore()
    expect(Object.keys(expected).sort()).toEqual(Object.keys(built).sort())
    // 数値の表現差で偽装一致しないようJSON表現で厳密比較する
    expect(JSON.stringify(built)).toBe(JSON.stringify(expected))
  })

  it('P6-O01(sync): 照合対象がImport Contractの値域境界を網羅している', () => {
    expect(P6_INT_VALUES).toEqual([INT32_MAX, INT32_MIN])
    expect(P6_LONG_VALUES).toEqual([Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER])
    expect(P6_DOUBLE_VALUES).toEqual([0, DOUBLE_ABS_MIN, DOUBLE_ABS_MAX])
    const ages = P6_BOUNDARY_EMPLOYEES.map((e) => e.age)
    const salaries = P6_BOUNDARY_EMPLOYEES.map((e) => e.salary)
    const evaluations = P6_BOUNDARY_EMPLOYEES.map((e) => e.evaluation)
    expect(ages).toEqual([AGE_MIN, AGE_MAX])
    expect(salaries).toEqual([SALARY_MIN, SALARY_MAX])
    expect(evaluations).toEqual([EVALUATION_MIN, EVALUATION_MAX])
  })

  it('P6-O01(sync): 代表値が指数表記にならず、決定的な10進表記で保持されている', () => {
    expect(expected['intBoundarySum']).toBe(-1)
    expect(expected['intBoundaryAverage']).toBe('-0.5')
    expect(expected['intStatsMin']).toBe(-2_147_483_648)
    expect(expected['intStatsMax']).toBe(2_147_483_647)
    expect(expected['longStatsMin']).toBe('-9_007_199_254_740_991L')
    expect(expected['longStatsMax']).toBe('9_007_199_254_740_991L')
    expect(expected['doubleBoxedValues']).toEqual(['0.0', '0.000001', '1000000000000000.0'])
    expect(expected['doubleStatsMax']).toBe('1000000000000000.0')
    expect(expected['summingLongSalary']).toBe(99_999_999)
    expect(expected['averagingLongSalary']).toBe('49999999.5')
    expect(expected['summingDoubleEvaluation']).toBe('5.0')
    for (const value of Object.values(expected)) {
      const texts = Array.isArray(value) ? value : [value]
      for (const text of texts) {
        if (typeof text !== 'string') continue
        // 指数表記（1.0E15等）が混入していないこと
        expect(text, text).not.toMatch(/\d[eE][+-]?\d/)
      }
    }
  })

  it('P6-O01(sync): DoubleStreamのsum / averageは照合対象に含めない（補償付き加算の差を持ち込まない）', () => {
    const keys = Object.keys(expected)
    expect(keys).not.toContain('doubleStatsSum')
    expect(keys).not.toContain('doubleStatsAverage')
    expect(keys).not.toContain('doubleBoundarySum')
  })
})
