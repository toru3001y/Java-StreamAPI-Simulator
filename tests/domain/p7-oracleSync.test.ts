import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildP7ExpectedFromCore } from '../p7-oracle-expected'
import { gatherTemplateModes } from '../p7-helpers'

/**
 * P7-O01(sync): oracle/expected-p7-from-core.json がSimulation Coreの結果と一致することを保証する。
 *
 * JDKとの照合は `npm run test:oracle`（Docker + gradle:9.6.1-jdk25）が行い、
 * こちらは「expected JSON ⇔ Simulation Core」の同期だけを担保する二層構造とする。
 */
const expected = JSON.parse(
  readFileSync(path.join(__dirname, '../../oracle/expected-p7-from-core.json'), 'utf8'),
) as Record<string, unknown>

describe('P7-O01(sync) expected-p7-from-core.jsonとSimulation Coreの一致', () => {
  it('P7-O01(sync): 全キーがSimulation Core由来の値と一致する', () => {
    const built = buildP7ExpectedFromCore()
    expect(Object.keys(expected).sort()).toEqual(Object.keys(built).sort())
    // 数値・文字列の表現差で偽装一致しないようJSON表現で厳密比較する
    expect(JSON.stringify(built)).toBe(JSON.stringify(expected))
  })

  it('P7-O01(sync): §8.2の11ケースがすべて照合対象に含まれる', () => {
    // 11ケース（standard 7 + emptySource 4）が期待値へ写像されていること
    expect(gatherTemplateModes()).toHaveLength(11)
    const listCases = [
      'windowFixed3',
      'windowFixed2',
      'windowFixedEmpty',
      'windowSliding2',
      'windowSlidingShort',
      'windowSlidingEmpty',
      'scanSum',
      'scanEmpty',
      'scanConcat',
    ]
    for (const key of listCases) {
      expect(Array.isArray(expected[key]), key).toBe(true)
    }
    // fold → findFirstの2ケースはOptionalとして保持する
    expect(expected['foldSalaryPresent']).toBe(true)
    expect(expected['foldEmptyPresent']).toBe(true)
  })

  it('P7-O01(sync): v0.9 §7の空入力表4行がすべて含まれる', () => {
    // 公式仕様で確定の2件（窓0件 → []）
    expect(expected['windowFixedEmpty']).toEqual([])
    expect(expected['windowSlidingEmpty']).toEqual([])
    // 「導出」区分の2件（scan空 → 出力0件、fold空 → Optional[初期値]）。
    // 実測と食い違えばnpm run test:oracleの照合がFAILになる
    expect(expected['scanEmpty']).toEqual([])
    expect(expected['foldEmptyPresent']).toBe(true)
    expect(expected['foldEmpty']).toBe('0L')
  })

  it('P7-O01(sync): long表記が3桁区切り + Lで保持され、numberへ変換されない', () => {
    expect(typeof expected['foldSalary']).toBe('string')
    expect(expected['foldSalary']).toBe('21_700_000L')
    expect(typeof expected['foldEmpty']).toBe('string')
  })

  it('P7-O01(sync): 出力要素のboxed型名がv0.9 §8.3の型適合表と一致する', () => {
    expect(expected['scanElementClass']).toBe('Integer')
    expect(expected['foldElementClass']).toBe('Long')
  })
})
