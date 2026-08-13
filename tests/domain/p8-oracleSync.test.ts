import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildP8ExpectedFromCore } from '../p8-oracle-expected'
import { P8_TEMPLATE_MODES } from '../p8-helpers'

/**
 * P8-O01(sync): oracle/expected-p8-from-core.json がSimulation Coreの結果と一致することを保証する。
 *
 * JDKとの照合は `npm run test:oracle`（Docker + gradle:9.6.1-jdk25）が行い、
 * こちらは「expected JSON ⇔ Simulation Core」の同期だけを担保する二層構造とする。
 */
const expected = JSON.parse(
  readFileSync(path.join(__dirname, '../../oracle/expected-p8-from-core.json'), 'utf8'),
) as Record<string, unknown>

describe('P8-O01(sync) expected-p8-from-core.jsonとSimulation Coreの一致', () => {
  it('P8-O01(sync): 全キーがSimulation Core由来の値と一致する', () => {
    const built = buildP8ExpectedFromCore()
    expect(Object.keys(expected).sort()).toEqual(Object.keys(built).sort())
    // 数値・文字列の表現差で偽装一致しないようJSON表現で厳密比較する
    expect(JSON.stringify(built)).toBe(JSON.stringify(expected))
  })

  it('P8-O01(sync): §8.2の10ケース + v0.12 teeing×toMap + v0.13 sum系がすべて照合対象に含まれる', () => {
    expect(P8_TEMPLATE_MODES).toHaveLength(19)
    for (const key of [
      'identity',
      'identityEmpty',
      'mergeFirst',
      'mergeLast',
      'mergeConcat',
      'groupingByMergeDemo',
      'treeMapOrdered',
      'treeMapEmpty',
      'groupedToMap',
    ]) {
      expect(Array.isArray(expected[key]), key).toBe(true)
    }
    // #3（実行失敗）は配列ではなく例外型として保持する
    expect(expected['duplicateExceptionType']).toBe('IllegalStateException')
    // v0.12 teeing×toMap: merger recordのfield値（左=TreeMapの実entry順・右=counting）
    expect(expected['teeingToMapByRegion']).toBe('{中部="小林", 関東="伊藤", 関西="中村"}')
    expect(expected['teeingToMapCount']).toBe('5')
    // v0.13 sum系: 型ごとの合計（int / long=L表記 / double=IEEE 754素朴加算）
    expect(expected['toMapSumIntByRegion']).toEqual(['中部=30', '関東=95', '関西=33'])
    expect(expected['toMapSumLongByRegion']).toEqual([
      '中部=4_900_000L',
      '関東=15_700_000L',
      '関西=5_200_000L',
    ])
    expect(expected['toMapSumDoubleByRegion']).toEqual(['中部=3.7', '関東=12.4', '関西=4.0'])
    // v0.14 unmodifiable系: 結果3キー（Core導出）+ UOE契約3キー（仕様由来リテラル）
    expect(expected['unmodifiableList']).toEqual([
      '佐藤（age=35）',
      '鈴木（age=27）',
      '高橋（age=42）',
      '田中（age=29）',
    ])
    expect(expected['unmodifiableSet']).toEqual(['"中部"', '"関東"', '"関西"'])
    expect(expected['unmodifiableMapMergeFirst']).toEqual([
      '中部="小林"',
      '関東="伊藤"',
      '関西="中村"',
    ])
    // 同一データ・同一merge（first）のtoMap教材と結果が一致する（違いは不変性だけ）
    expect(expected['unmodifiableMapMergeFirst']).toEqual(expected['mergeFirst'])
    for (const key of ['uoeOnListAdd', 'uoeOnSetAdd', 'uoeOnMapPut']) {
      expect(expected[key], key).toBe('UnsupportedOperationException')
    }
  })

  it('P8-O01(sync): 例外契約は型のみで、メッセージ全文を含まない', () => {
    const text = JSON.stringify(expected)
    expect(expected['duplicateExceptionType']).toBe('IllegalStateException')
    // JDKの例外メッセージ（"Duplicate key ..."）は照合契約に含めない
    expect(text).not.toContain('Duplicate key')
    expect(text).not.toContain('attempted merging values')
  })

  it('P8-O01(sync): 順序保証のないMapはキー辞書順へ正規化されている', () => {
    for (const key of [
      'identity',
      'mergeFirst',
      'mergeLast',
      'mergeConcat',
      'groupingByMergeDemo',
      'groupedToMap',
    ]) {
      const value = expected[key] as string[]
      expect([...value].sort(), key).toEqual(value)
    }
  })

  it('P8-O01(sync): TreeMapは正規化せず実entry順（中部 → 関東 → 関西）で保持する', () => {
    expect(expected['treeMapOrdered']).toEqual([
      '中部=4_800_000L',
      '関東=5_500_000L',
      '関西=4_200_000L',
    ])
    // TreeMapの順序はString.compareTo（UTF-16コード単位）であり、encounter order
    // （関東 → 関西 → 中部）とは異なる。順序自体が検証対象であることの機械的な裏取り
    const keys = (expected['treeMapOrdered'] as string[]).map((pair) => pair.split('=')[0])
    expect(keys).toEqual(['中部', '関東', '関西'])
    expect(keys).not.toEqual(['関東', '関西', '中部'])
    expect(expected['treeMapEmpty']).toEqual([])
  })

  it('P8-O01(sync): mergeの適用順・encounter orderを結果値で検証する', () => {
    // first → 最初の値（伊藤）、last → 最後の値（山本）: (既存値, 新しい値)の適用順の実証
    expect(expected['mergeFirst']).toContain('関東="伊藤"')
    expect(expected['mergeLast']).toContain('関東="山本"')
    // concat → 全値の連結（入力順）: 順次適用のencounter orderの実証
    expect(expected['mergeConcat']).toContain('関東="伊藤, 渡辺, 山本"')
    // 同一データのgroupingByは1キー多値（衝突しない）
    expect(expected['groupingByMergeDemo']).toContain(
      '関東=[伊藤（age=31）, 渡辺（age=38）, 山本（age=26）]',
    )
  })

  it('P8-O01(sync): 空streamのtoMapは空Mapである（v0.11 §7の導出区分）', () => {
    expect(expected['identityEmpty']).toEqual([])
    expect(expected['treeMapEmpty']).toEqual([])
  })

  it('P8-O01(sync): partitioningBy空partitionの追加照合が含まれる（v0.11 §3.3）', () => {
    expect(expected['partitionFalseEmpty']).toEqual([])
    expect(expected['partitionTrue']).toEqual([
      '佐藤=5_500_000L',
      '田中=4_800_000L',
      '鈴木=4_200_000L',
      '高橋=7_200_000L',
    ])
  })

  it('P8-O01(sync): long表記が3桁区切り + Lで保持され、numberへ変換されない', () => {
    for (const key of ['treeMapOrdered', 'partitionTrue']) {
      for (const pair of expected[key] as string[]) {
        expect(pair, `${key}: ${pair}`).toMatch(/=\d{1,3}(_\d{3})*L$/)
      }
    }
  })

  it('P8-O01(sync): bucketごとの独立蓄積がnested Mapとして保持される', () => {
    expect(expected['groupedToMap']).toEqual([
      '中部={田中=4_800_000L}',
      '関東={佐藤=5_500_000L, 高橋=7_200_000L}',
      '関西={鈴木=4_200_000L}',
    ])
  })
})
