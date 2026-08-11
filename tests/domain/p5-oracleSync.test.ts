import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildP5ExpectedFromCore } from '../p5-oracle-expected'

/**
 * P5-O01(sync): oracle/expected-p5-from-core.json がSimulation Coreの結果と一致することを保証する。
 *
 * JDKとの照合は `npm run test:oracle`（Docker + gradle:9.6.1-jdk25）が行い、
 * こちらは「expected JSON ⇔ Simulation Core」の同期だけを担保する二層構造とする。
 */
const expected = JSON.parse(
  readFileSync(path.join(__dirname, '../../oracle/expected-p5-from-core.json'), 'utf8'),
) as Record<string, unknown>

describe('P5-O01(sync) expected-p5-from-core.jsonとSimulation Coreの一致', () => {
  it('P5-O01(sync): 全キーがSimulation Core由来の値と一致する', () => {
    const built = buildP5ExpectedFromCore()
    // キー集合が一致する（追加・欠落を検出する）
    expect(Object.keys(expected).sort()).toEqual(Object.keys(built).sort())
    // 値もJSON表現で厳密一致する（数値の表現差で偽装一致しない）
    expect(JSON.stringify(built)).toBe(JSON.stringify(expected))
  })

  it('P5-O01(sync): 代表値がDraft v0.8・指示§8の期待値と一致する', () => {
    expect(expected['toList']).toEqual(['佐藤', '鈴木', '高橋', '田中'])
    // toSetは辞書順へ正規化済み（JDKのiteration order保証ではない）
    expect(expected['toSet']).toEqual(['中部', '関東', '関西'])
    expect(expected['joining']).toBe('佐藤鈴木高橋田中')
    expect(expected['joiningEmpty']).toBe('')
    expect(expected['joiningFull']).toBe('[佐藤, 鈴木, 高橋, 田中]')
    // Draft v0.8 付録F.1のJDK 25実測
    expect(expected['joiningFullEmpty']).toBe('[]')
    expect(expected['counting']).toBe(4)
    expect(expected['countingEmpty']).toBe(0)
    expect(expected['summingInt']).toBe(133)
    expect(expected['summingLong']).toBe(21_700_000)
    expect(expected['averagingInt']).toBe('33.25')
    expect(expected['averagingLong']).toBe('5425000.0')
    expect(expected['averagingLongEmpty']).toBe('0.0')
    expect(expected['minByName']).toBe('鈴木')
    expect(expected['maxByName']).toBe('高橋')
    expect(expected['reducing']).toBe('佐藤鈴木高橋田中')
    // filteringは営業部が空bucketとして残る（Stream.filterとの差）
    expect(expected['filtering']).toEqual([
      ['営業部', []],
      ['開発部', ['佐藤', '高橋']],
    ])
    expect(expected['groupingByCounting']).toEqual([
      ['中部', 1],
      ['関東', 2],
      ['関西', 1],
    ])
    // TreeMapは実順序（Java Stringのnatural ordering）で照合する
    expect((expected['groupingByTreeMapOrdered'] as [string, string[]][]).map((e) => e[0])).toEqual([
      '中部',
      '関東',
      '関西',
    ])
    // partitioningByはtrue / false両キーを保持する（空でも）
    expect(expected['partitioningByEmpty']).toEqual([
      ['false', []],
      ['true', []],
    ])
    // teeing基準fixture（docs/phase-5-decisions.md §9）
    expect(expected['teeingRecordToString']).toBe(
      'SalarySummary[employeeCount=4, averageSalary=5425000.0]',
    )
    expect(expected['teeingEmptyRecordToString']).toBe(
      'SalarySummary[employeeCount=0, averageSalary=0.0]',
    )
    // 64bit境界値は10進文字列のまま保持する
    const statsLongEmpty = expected['statsLongEmpty'] as unknown[]
    expect(statsLongEmpty[2]).toBe('9223372036854775807')
    expect(statsLongEmpty[3]).toBe('-9223372036854775808')
    expect(typeof statsLongEmpty[2]).toBe('string')
    // doubleの±Infinityも文字列
    const statsDoubleEmpty = expected['statsDoubleEmpty'] as unknown[]
    expect(statsDoubleEmpty[2]).toBe('Infinity')
    expect(statsDoubleEmpty[3]).toBe('-Infinity')
    // 持越しtemplate
    expect(expected['takeWhileSalary']).toEqual(['佐藤'])
    expect(expected['dropWhileSalary']).toEqual(['鈴木', '高橋', '田中'])
  })
})
