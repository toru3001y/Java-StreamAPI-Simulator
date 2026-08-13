import { describe, expect, it } from 'vitest'
import type { SnapshotKind } from '../../src/domain/engine/snapshot'
import {
  IDENTITY_VALUE,
  NAME_KEY,
  NAME_VALUE,
  REGION_KEY,
  SALARY_VALUE,
  STANDARD_EMPLOYEES,
  collectorCtxOf,
  findToMapNode,
  kindElementPairs,
  kindsOf,
  lastOf,
  runLocalCollector,
  snapshotsOf,
  toMap2,
  toMap3,
  toMap4,
  toMapEntryPairs,
} from '../p8-helpers'

/**
 * P8-D07〜P8-D12: §8.2の確定snapshot列との完全一致（Phase 8指示 §12.1）。
 *
 * 「要素×5」= SOURCE_EMIT → NODE_ARRIVAL → TO_MAP_KEY_EVALUATED → TO_MAP_VALUE_EVALUATED
 *              → CONTAINER_UPDATED
 * 「要素×7」= 上記のうちCONTAINER_UPDATEDの前にDUPLICATE_KEY_DETECTED → MERGE_FUNCTION_APPLIED
 */

/** 新規put要素の5件（§8.2の「×5」） */
function newPut(elementId: string): string[] {
  return [
    `SOURCE_EMIT(${elementId})`,
    `NODE_ARRIVAL(${elementId})`,
    `TO_MAP_KEY_EVALUATED(${elementId})`,
    `TO_MAP_VALUE_EVALUATED(${elementId})`,
    `CONTAINER_UPDATED(${elementId})`,
  ]
}

/** merge要素の7件（§8.2の#4〜#7） */
function mergePut(elementId: string): string[] {
  return [
    `SOURCE_EMIT(${elementId})`,
    `NODE_ARRIVAL(${elementId})`,
    `TO_MAP_KEY_EVALUATED(${elementId})`,
    `TO_MAP_VALUE_EVALUATED(${elementId})`,
    `DUPLICATE_KEY_DETECTED(${elementId})`,
    `MERGE_FUNCTION_APPLIED(${elementId})`,
    `CONTAINER_UPDATED(${elementId})`,
  ]
}

/** groupingBy（1引数）要素の5件（§8.2の#10。既存P5と同一構成） */
function groupPut(elementId: string): string[] {
  return [
    `SOURCE_EMIT(${elementId})`,
    `NODE_ARRIVAL(${elementId})`,
    `CLASSIFIER_EVALUATED(${elementId})`,
    `BUCKET_SELECTED(${elementId})`,
    `CONTAINER_UPDATED(${elementId})`,
  ]
}

/** groupingBy + toMap要素の7件（§8.2の#9） */
function groupToMapPut(elementId: string): string[] {
  return [
    `SOURCE_EMIT(${elementId})`,
    `NODE_ARRIVAL(${elementId})`,
    `CLASSIFIER_EVALUATED(${elementId})`,
    `BUCKET_SELECTED(${elementId})`,
    `TO_MAP_KEY_EVALUATED(${elementId})`,
    `TO_MAP_VALUE_EVALUATED(${elementId})`,
    `CONTAINER_UPDATED(${elementId})`,
  ]
}

describe('P8-D07 snapshot列: identity（§8.2 #1 / #2）', () => {
  it('P8-D07: #1 tomap-identity × standardが確定列と完全一致する（23件）', () => {
    const snapshots = snapshotsOf('tmpl-collect-tomap-identity', 'standard')
    expect(kindElementPairs(snapshots)).toEqual([
      'INITIAL',
      ...newPut('emp-001'),
      ...newPut('emp-002'),
      ...newPut('emp-003'),
      ...newPut('emp-004'),
      'RESULT_CONFIRMED',
      'STREAM_CONSUMED',
    ])
    expect(snapshots).toHaveLength(23)
    // CONTAINER_CREATEDは2引数版のため発行しない
    expect(snapshots.map((s) => s.kind)).not.toContain('CONTAINER_CREATED')
  })

  it('P8-D07: #1のentry蓄積順がencounter orderである', () => {
    const snapshots = snapshotsOf('tmpl-collect-tomap-identity', 'standard')
    const last = snapshots[snapshots.length - 1]!
    const node = findToMapNode(collectorCtxOf(last).root)!
    expect(toMapEntryPairs(node)).toEqual([
      '佐藤=佐藤（age=35）',
      '鈴木=鈴木（age=27）',
      '高橋=高橋（age=42）',
      '田中=田中（age=29）',
    ])
    // 蓄積は要素ごとに1件ずつ伸びる
    const growth = snapshots
      .filter((s) => s.kind === 'CONTAINER_UPDATED')
      .map((s) => toMapEntryPairs(findToMapNode(collectorCtxOf(s).root)!).length)
    expect(growth).toEqual([1, 2, 3, 4])
  })

  it('P8-D07: #2 tomap-identity × emptySourceが確定列と完全一致する（3件）', () => {
    expect(kindsOf('tmpl-collect-tomap-identity', 'emptySource')).toEqual([
      'INITIAL',
      'RESULT_CONFIRMED',
      'STREAM_CONSUMED',
    ])
    const last = lastOf('tmpl-collect-tomap-identity', 'emptySource')
    expect(last.output.result).toMatchObject({ kind: 'MAP', size: 0, entries: [] })
  })
})

describe('P8-D08 snapshot列: 実行失敗（§8.2 #3）', () => {
  const snapshots = snapshotsOf('tmpl-collect-tomap-duplicate', 'standard')

  it('P8-D08: #3が確定列と完全一致する（12件・COLLECT_FAILED終端）', () => {
    expect(kindElementPairs(snapshots)).toEqual([
      'INITIAL',
      ...newPut('emp-101'),
      'SOURCE_EMIT(emp-102)',
      'NODE_ARRIVAL(emp-102)',
      'TO_MAP_KEY_EVALUATED(emp-102)',
      'TO_MAP_VALUE_EVALUATED(emp-102)',
      'DUPLICATE_KEY_DETECTED(emp-102)',
      'COLLECT_FAILED(emp-102)',
    ])
    expect(snapshots).toHaveLength(12)
  })

  it('P8-D08: emp-103〜105はSOURCE_EMITされず、RESULT_CONFIRMED / STREAM_CONSUMEDも発行されない', () => {
    const pairs = kindElementPairs(snapshots)
    for (const id of ['emp-103', 'emp-104', 'emp-105']) {
      expect(pairs.filter((p) => p.includes(id))).toEqual([])
    }
    const kinds = snapshots.map((s) => s.kind)
    expect(kinds).not.toContain('RESULT_CONFIRMED')
    expect(kinds).not.toContain('STREAM_CONSUMED')
  })

  it('P8-D08: 終端snapshotのcompletionがEXECUTION_FAILEDである', () => {
    const last = snapshots[snapshots.length - 1]!
    expect(last.kind).toBe('COLLECT_FAILED')
    expect(last.completion).toBe('EXECUTION_FAILED')
    // 失敗以外のsnapshotのcompletionはNONEのまま
    for (const s of snapshots.slice(0, -1)) expect(s.completion).toBe('NONE')
  })

  it('P8-D08: DUPLICATE_KEY_DETECTEDのcontextがキー・既存値・新しい値を表示する', () => {
    const dup = snapshots.find((s) => s.kind === 'DUPLICATE_KEY_DETECTED')!
    expect(dup.processing?.inputLabel).toContain('関東')
    expect(dup.processing?.evaluation).toBe('既存値 "伊藤" / 新しい値 "渡辺"')
  })
})

describe('P8-D09 snapshot列: first / last（§8.2 #4 / #5）', () => {
  const expectedSequence = [
    'INITIAL',
    ...newPut('emp-101'),
    ...mergePut('emp-102'),
    ...mergePut('emp-103'),
    ...newPut('emp-104'),
    ...newPut('emp-105'),
    'RESULT_CONFIRMED',
    'STREAM_CONSUMED',
  ]

  it('P8-D09: #4 merge-firstが確定列と完全一致する（32件）', () => {
    const snapshots = snapshotsOf('tmpl-collect-tomap-merge-first', 'standard')
    expect(kindElementPairs(snapshots)).toEqual(expectedSequence)
    expect(snapshots).toHaveLength(32)
  })

  it('P8-D09: #5 merge-lastが#4と同一のkind列である（結果値のみ異なる）', () => {
    const snapshots = snapshotsOf('tmpl-collect-tomap-merge-last', 'standard')
    expect(kindElementPairs(snapshots)).toEqual(expectedSequence)
    expect(snapshots).toHaveLength(32)
  })

  it('P8-D09: MERGE_FUNCTION_APPLIEDのcontextが（既存値, 新しい値）の順である', () => {
    const first = snapshotsOf('tmpl-collect-tomap-merge-first', 'standard')
    const merges = first.filter((s) => s.kind === 'MERGE_FUNCTION_APPLIED')
    expect(merges).toHaveLength(2)
    // 1回目: 既存値=伊藤（Map内）、新しい値=渡辺（新規要素）
    expect(merges[0]?.processing?.inputLabel).toBe('mergeFunction("伊藤", "渡辺")')
    expect(merges[0]?.processing?.evaluation).toBe('"伊藤", "渡辺" → "伊藤"')
    expect(merges[0]?.processing?.expression).toBe('(a, b) -> a')
    // 2回目: 既存値は前回merge結果（伊藤）
    expect(merges[1]?.processing?.inputLabel).toBe('mergeFunction("伊藤", "山本")')
    expect(merges[1]?.explanation.jdkNote).toContain('Map内の既存値, 新しい値')
  })

  it('P8-D09: first / lastの結果差が同一データで現れる', () => {
    const firstResult = lastOf('tmpl-collect-tomap-merge-first', 'standard').output.result
    const lastResult = lastOf('tmpl-collect-tomap-merge-last', 'standard').output.result
    expect(firstResult).toMatchObject({
      kind: 'MAP',
      size: 3,
      entries: [
        { keyLabel: '関東', value: { valueLabel: '"伊藤"' } },
        { keyLabel: '関西', value: { valueLabel: '"中村"' } },
        { keyLabel: '中部', value: { valueLabel: '"小林"' } },
      ],
    })
    expect(lastResult).toMatchObject({
      kind: 'MAP',
      size: 3,
      entries: [
        { keyLabel: '関東', value: { valueLabel: '"山本"' } },
        { keyLabel: '関西', value: { valueLabel: '"中村"' } },
        { keyLabel: '中部', value: { valueLabel: '"小林"' } },
      ],
    })
  })
})

describe('P8-D10 snapshot列: concat 3件衝突（§8.2 #6）', () => {
  const snapshots = snapshotsOf('tmpl-collect-tomap-merge-concat', 'standard')

  it('P8-D10: #6が確定列と完全一致する（32件）', () => {
    expect(kindElementPairs(snapshots)).toEqual([
      'INITIAL',
      ...newPut('emp-101'),
      ...mergePut('emp-102'),
      ...mergePut('emp-103'),
      ...newPut('emp-104'),
      ...newPut('emp-105'),
      'RESULT_CONFIRMED',
      'STREAM_CONSUMED',
    ])
    expect(snapshots).toHaveLength(32)
  })

  it('P8-D10: 2回のmergeが「現在Mapにある値」へ順次適用される', () => {
    const merges = snapshots.filter((s) => s.kind === 'MERGE_FUNCTION_APPLIED')
    expect(merges).toHaveLength(2)
    expect(merges[0]?.processing?.evaluation).toBe('"伊藤", "渡辺" → "伊藤, 渡辺"')
    // 2回目の第1引数は前回merge結果（現在Mapにある値）
    expect(merges[1]?.processing?.inputLabel).toBe('mergeFunction("伊藤, 渡辺", "山本")')
    expect(merges[1]?.processing?.evaluation).toBe('"伊藤, 渡辺", "山本" → "伊藤, 渡辺, 山本"')
    const result = lastOf('tmpl-collect-tomap-merge-concat', 'standard').output.result
    expect(result?.kind).toBe('MAP')
    if (result?.kind === 'MAP') {
      expect(result.entries[0]).toMatchObject({
        keyLabel: '関東',
        value: { valueLabel: '"伊藤, 渡辺, 山本"' },
      })
    }
  })
})

describe('P8-D10 snapshot列: sum系merge（v0.13 §4。first / lastと同形の32件）', () => {
  const expectedSequence = [
    'INITIAL',
    ...newPut('emp-101'),
    ...mergePut('emp-102'),
    ...mergePut('emp-103'),
    ...newPut('emp-104'),
    ...newPut('emp-105'),
    'RESULT_CONFIRMED',
    'STREAM_CONSUMED',
  ]

  it('P8-D10: sum系3 templateがmerge-first / lastと同一のkind列である', () => {
    for (const templateId of [
      'tmpl-collect-tomap-merge-sumint',
      'tmpl-collect-tomap-merge-sumlong',
      'tmpl-collect-tomap-merge-sumdouble',
    ]) {
      const snapshots = snapshotsOf(templateId, 'standard')
      expect(kindElementPairs(snapshots), templateId).toEqual(expectedSequence)
      expect(snapshots, templateId).toHaveLength(32)
    }
  })

  it('P8-D10: sumLongの2回のmergeが「現在Mapにある値」へ順次適用される（(a+b)+c）', () => {
    const snapshots = snapshotsOf('tmpl-collect-tomap-merge-sumlong', 'standard')
    const merges = snapshots.filter((s) => s.kind === 'MERGE_FUNCTION_APPLIED')
    expect(merges).toHaveLength(2)
    expect(merges[0]?.processing?.inputLabel).toBe('mergeFunction(5_000_000L, 6_100_000L)')
    expect(merges[0]?.processing?.evaluation).toBe('5_000_000L, 6_100_000L → 11_100_000L')
    expect(merges[0]?.processing?.expression).toBe('Long::sum')
    // 2回目の第1引数は前回merge結果（現在Mapにある値）
    expect(merges[1]?.processing?.inputLabel).toBe('mergeFunction(11_100_000L, 4_600_000L)')
    expect(merges[1]?.processing?.evaluation).toBe('11_100_000L, 4_600_000L → 15_700_000L')
    expect(merges[1]?.explanation.jdkNote).toContain('Map内の既存値, 新しい値')
    const result = lastOf('tmpl-collect-tomap-merge-sumlong', 'standard').output.result
    expect(result).toMatchObject({
      kind: 'MAP',
      size: 3,
      entries: [
        { keyLabel: '関東', value: { valueLabel: '15_700_000L' } },
        { keyLabel: '関西', value: { valueLabel: '5_200_000L' } },
        { keyLabel: '中部', value: { valueLabel: '4_900_000L' } },
      ],
    })
  })

  it('P8-D10: sumIntは95、sumDoubleはIEEE 754逐次加算で12.4になる', () => {
    const intResult = lastOf('tmpl-collect-tomap-merge-sumint', 'standard').output.result
    expect(intResult).toMatchObject({
      kind: 'MAP',
      size: 3,
      entries: [
        { keyLabel: '関東', value: { valueLabel: '95' } },
        { keyLabel: '関西', value: { valueLabel: '33' } },
        { keyLabel: '中部', value: { valueLabel: '30' } },
      ],
    })
    // (4.1 + 4.4) + 3.9はIEEE 754 binary64でちょうど12.4になる（丸め誤差が相殺される組合せ）
    const doubleResult = lastOf('tmpl-collect-tomap-merge-sumdouble', 'standard').output.result
    expect(doubleResult).toMatchObject({
      kind: 'MAP',
      size: 3,
      entries: [
        { keyLabel: '関東', value: { valueLabel: '12.4' } },
        { keyLabel: '関西', value: { valueLabel: '4.0' } },
        { keyLabel: '中部', value: { valueLabel: '3.7' } },
      ],
    })
    // sumDoubleの中間mergeもIEEE 754の素朴加算（4.1 + 4.4 = 8.5）
    const doubleMerges = snapshotsOf('tmpl-collect-tomap-merge-sumdouble', 'standard').filter(
      (s) => s.kind === 'MERGE_FUNCTION_APPLIED',
    )
    expect(doubleMerges[0]?.processing?.evaluation).toBe('4.1, 4.4 → 8.5')
    expect(doubleMerges[1]?.processing?.evaluation).toBe('8.5, 3.9 → 12.4')
  })
})

describe('P8-D11 snapshot列: TreeMap・CONTAINER_CREATED判定（§8.2 #7 / #8）', () => {
  it('P8-D11: #7 tomap-treemap × standardが確定列と完全一致する（26件）', () => {
    const snapshots = snapshotsOf('tmpl-collect-tomap-treemap', 'standard')
    expect(kindElementPairs(snapshots)).toEqual([
      'INITIAL',
      'CONTAINER_CREATED',
      ...newPut('emp-001'),
      ...newPut('emp-002'),
      ...mergePut('emp-003'),
      ...newPut('emp-004'),
      'RESULT_CONFIRMED',
      'STREAM_CONSUMED',
    ])
    expect(snapshots).toHaveLength(26)
  })

  it('P8-D11: #8 tomap-treemap × emptySourceが確定列と完全一致する（4件）', () => {
    expect(kindsOf('tmpl-collect-tomap-treemap', 'emptySource')).toEqual([
      'INITIAL',
      'CONTAINER_CREATED',
      'RESULT_CONFIRMED',
      'STREAM_CONSUMED',
    ])
    expect(lastOf('tmpl-collect-tomap-treemap', 'emptySource').output.result).toMatchObject({
      kind: 'MAP',
      containerLabel: 'TreeMap',
      size: 0,
    })
  })

  it('P8-D11: CONTAINER_CREATEDはroot 4引数版のみ・INITIAL直後に正確に1回である', () => {
    for (const mode of ['standard', 'emptySource'] as const) {
      const snapshots = snapshotsOf('tmpl-collect-tomap-treemap', mode)
      const indexes = snapshots.flatMap((s, i) => (s.kind === 'CONTAINER_CREATED' ? [i] : []))
      expect(indexes, mode).toEqual([1])
      expect(snapshots[1]?.processing?.expression, mode).toBe('TreeMap::new')
      // 生成説明のコンテナ名がTreeMapであること（欠落文言「空のを生成」にならないこと）
      expect(snapshots[1]?.processing?.evaluation, mode).toBe('空のTreeMapを生成しました')
      expect(snapshots[1]?.explanation.current, mode).toBe(
        'supplier（TreeMap::new）を適用し、空のTreeMapを生成しました。',
      )
      expect(snapshots[1]?.processing?.evaluation, mode).not.toContain('空のを生成')
      expect(snapshots[1]?.explanation.current, mode).not.toContain('空のを生成')
    }
    // 2引数版・3引数版・downstream配置では発行しない
    for (const templateId of [
      'tmpl-collect-tomap-identity',
      'tmpl-collect-tomap-duplicate',
      'tmpl-collect-tomap-merge-first',
      'tmpl-collect-tomap-merge-last',
      'tmpl-collect-tomap-merge-concat',
      'tmpl-collect-tomap-grouped',
    ]) {
      expect(kindsOf(templateId, 'standard'), templateId).not.toContain('CONTAINER_CREATED')
    }
  })

  it('P8-D11: root adapter経由の4引数版でもCONTAINER_CREATEDがINITIAL直後に1回発行される', () => {
    // filtering(…, toMap(…, TreeMap::new)): 実効rootコンテナで判定する（指示§8.1-1）
    const { kinds, snapshots } = runLocalCollector(
      'tmpl-p8-local-adapter-treemap',
      ['filtering', 'toMap'],
      {
        kind: 'filtering',
        predicate: {
          kind: 'fieldCompare',
          field: 'age',
          operator: 'GTE',
          value: { type: 'int', value: 0 },
        },
        downstream: toMap4('first'),
      },
    )
    const indexes = kinds.flatMap((k, i) => (k === 'CONTAINER_CREATED' ? [i] : []))
    expect(indexes).toEqual([1])
    expect(snapshots[1]?.processing?.expression).toBe('TreeMap::new')
    // root adapter経由でも生成説明のコンテナ名がTreeMapであること（欠落文言にならないこと）
    expect(snapshots[1]?.processing?.evaluation).toBe('空のTreeMapを生成しました')
    expect(snapshots[1]?.explanation.current).toBe(
      'supplier（TreeMap::new）を適用し、空のTreeMapを生成しました。',
    )
    expect(snapshots[1]?.explanation.current).not.toContain('空のを生成')
    // adapter経由の2引数版では発行しない
    const two = runLocalCollector('tmpl-p8-local-adapter-plain', ['filtering', 'toMap'], {
      kind: 'filtering',
      predicate: {
        kind: 'fieldCompare',
        field: 'age',
        operator: 'GTE',
        value: { type: 'int', value: 0 },
      },
      downstream: toMap3('first'),
    })
    expect(two.kinds).not.toContain('CONTAINER_CREATED')
  })

  it('P8-D11: TreeMapのentryはキー昇順（中部 → 関東 → 関西）で確定する', () => {
    const last = lastOf('tmpl-collect-tomap-treemap', 'standard')
    expect(last.output.result).toMatchObject({
      kind: 'MAP',
      containerLabel: 'TreeMap',
      jdkOrdered: true,
      entries: [
        { keyLabel: '中部', value: { valueLabel: '4_800_000L' } },
        { keyLabel: '関東', value: { valueLabel: '5_500_000L' } },
        { keyLabel: '関西', value: { valueLabel: '4_200_000L' } },
      ],
    })
    // 蓄積viewもキー順で表示する（UIは並べ替えない）
    const node = findToMapNode(collectorCtxOf(last).root)!
    expect(toMapEntryPairs(node)).toEqual([
      '中部=4_800_000L',
      '関東=5_500_000L',
      '関西=4_200_000L',
    ])
    // 既存Phase 5のTreeMap templateの実測順と一致する
    const p5 = lastOf('tmpl-collect-groupingby-treemap', 'standard').output.result
    expect(p5?.kind).toBe('MAP')
    if (p5?.kind === 'MAP') {
      expect(p5.entries.map((e) => e.keyLabel)).toEqual(['中部', '関東', '関西'])
    }
  })
})

describe('P8-D12 snapshot列: downstream形・配置別生成表示（§8.2 #9 / #10）', () => {
  it('P8-D12: #9 tomap-groupedが確定列と完全一致する（31件）', () => {
    const snapshots = snapshotsOf('tmpl-collect-tomap-grouped', 'standard')
    expect(kindElementPairs(snapshots)).toEqual([
      'INITIAL',
      ...groupToMapPut('emp-001'),
      ...groupToMapPut('emp-002'),
      ...groupToMapPut('emp-003'),
      ...groupToMapPut('emp-004'),
      'RESULT_CONFIRMED',
      'STREAM_CONSUMED',
    ])
    expect(snapshots).toHaveLength(31)
  })

  it('P8-D12: bucketごとに独立して蓄積し、関東bucket内で佐藤・高橋が衝突しない', () => {
    const last = lastOf('tmpl-collect-tomap-grouped', 'standard')
    expect(last.completion).toBe('STREAM_CONSUMED')
    expect(last.output.result).toMatchObject({
      kind: 'MAP',
      valueTypeLabel: 'Map<String, Long>',
      entries: [
        {
          keyLabel: '関東',
          value: {
            kind: 'MAP',
            size: 2,
            entries: [
              { keyLabel: '佐藤', value: { valueLabel: '5_500_000L' } },
              { keyLabel: '高橋', value: { valueLabel: '7_200_000L' } },
            ],
          },
        },
        { keyLabel: '関西', value: { kind: 'MAP', size: 1 } },
        { keyLabel: '中部', value: { kind: 'MAP', size: 1 } },
      ],
    })
    // DUPLICATE_KEY_DETECTEDは1件も発行されない（bucketごとの判定）
    expect(kindsOf('tmpl-collect-tomap-grouped', 'standard')).not.toContain(
      'DUPLICATE_KEY_DETECTED' satisfies SnapshotKind,
    )
  })

  it('P8-D12: #10 groupby-mergedemoが既存P5のgroupingBy標準templateと同一のkind列構成である（28件）', () => {
    const snapshots = snapshotsOf('tmpl-collect-groupby-mergedemo', 'standard')
    expect(kindElementPairs(snapshots)).toEqual([
      'INITIAL',
      ...groupPut('emp-101'),
      ...groupPut('emp-102'),
      ...groupPut('emp-103'),
      ...groupPut('emp-104'),
      ...groupPut('emp-105'),
      'RESULT_CONFIRMED',
      'STREAM_CONSUMED',
    ])
    expect(snapshots).toHaveLength(28)
    // 既存P5のgroupingBy(1引数)標準templateとkind構成が一致する（データのみ異なる）
    const p5Kinds = kindsOf('tmpl-collect-groupingby', 'standard')
    const uniqueP8 = [...new Set(snapshots.map((s) => s.kind))]
    const uniqueP5 = [...new Set(p5Kinds)]
    expect(uniqueP8).toEqual(uniqueP5)
    expect(lastOf('tmpl-collect-groupby-mergedemo', 'standard').output.result).toMatchObject({
      entries: [
        { keyLabel: '関東', value: { kind: 'COLLECTION', size: 3 } },
        { keyLabel: '関西', value: { kind: 'COLLECTION', size: 1 } },
        { keyLabel: '中部', value: { kind: 'COLLECTION', size: 1 } },
      ],
    })
  })

  it('P8-D12: groupingBy配下の4引数版は独立CONTAINER_CREATEDを持たず、新規BUCKET_SELECTEDのcontextで生成を表す', () => {
    const { kinds, snapshots } = runLocalCollector(
      'tmpl-p8-local-group-treemap',
      ['groupingBy', 'toMap'],
      {
        kind: 'groupingBy',
        classifier: REGION_KEY,
        mapFactoryId: null,
        downstream: toMap4('first', NAME_KEY, SALARY_VALUE),
      },
      STANDARD_EMPLOYEES,
    )
    expect(kinds).not.toContain('CONTAINER_CREATED')
    const newBuckets = snapshots.filter(
      (s) => s.kind === 'BUCKET_SELECTED' && s.processing?.title === 'bucket決定（新規生成）',
    )
    expect(newBuckets).toHaveLength(3)
    for (const snapshot of newBuckets) {
      expect(snapshot.explanation.jdkNote).toContain('downstream Map（TreeMap）')
    }
    // 既存bucket選択ではdownstream Map生成表示を繰り返さない
    const existingBuckets = snapshots.filter(
      (s) => s.kind === 'BUCKET_SELECTED' && s.processing?.title === 'bucket決定（既存）',
    )
    expect(existingBuckets).toHaveLength(1)
    expect(existingBuckets[0]?.explanation.jdkNote).not.toContain('downstream Map')
  })

  it('P8-D12: partitioningBy配下の4引数版は両partitionの初期downstream MapがTreeMapで、0件partitionも空TreeMapになる', () => {
    const { kinds, snapshots } = runLocalCollector(
      'tmpl-p8-local-partition-treemap',
      ['partitioningBy', 'toMap'],
      {
        kind: 'partitioningBy',
        // 全件true（age >= 0）にして、falseのpartitionを要素0件にする
        predicate: {
          kind: 'fieldCompare',
          field: 'age',
          operator: 'GTE',
          value: { type: 'int', value: 0 },
        },
        downstream: toMap4('first', NAME_KEY, SALARY_VALUE),
      },
      STANDARD_EMPLOYEES,
    )
    expect(kinds).not.toContain('CONTAINER_CREATED')
    // 実行開始時（INITIAL）から両partitionのdownstream MapがTreeMapとして存在する
    const initial = snapshots[0]!
    const root = collectorCtxOf(initial).root
    expect(root.buckets).toHaveLength(2)
    for (const bucket of root.buckets) {
      expect(bucket.node.accumulation, bucket.keyLabel).toMatchObject({
        kind: 'TO_MAP',
        containerLabel: 'TreeMap',
        entries: [],
      })
    }
    // 要素0件のfalse partitionも空TreeMapが値になる（v0.11 §3.3・§7）
    const last = snapshots[snapshots.length - 1]!
    expect(last.output.result).toMatchObject({
      kind: 'MAP',
      entries: [
        { keyLabel: 'false', value: { kind: 'MAP', containerLabel: 'TreeMap', size: 0 } },
        { keyLabel: 'true', value: { kind: 'MAP', containerLabel: 'TreeMap', size: 4 } },
      ],
    })
  })

  it('P8-D12: bucket内toMapの蓄積列にTO_MAP_KEY_EVALUATED以降が適用される（identity値）', () => {
    const { kinds } = runLocalCollector(
      'tmpl-p8-local-group-identity',
      ['groupingBy', 'toMap'],
      {
        kind: 'groupingBy',
        classifier: REGION_KEY,
        mapFactoryId: null,
        downstream: toMap2(NAME_KEY, IDENTITY_VALUE),
      },
      STANDARD_EMPLOYEES,
    )
    expect(kinds.filter((k) => k === 'TO_MAP_KEY_EVALUATED')).toHaveLength(4)
    expect(kinds.filter((k) => k === 'TO_MAP_VALUE_EVALUATED')).toHaveLength(4)
    expect(kinds).not.toContain('MAPPING_APPLIED')
  })

  it('P8-D12: toMapでCLASSIFIER_EVALUATED / MAPPING_APPLIEDを再利用していない', () => {
    for (const templateId of [
      'tmpl-collect-tomap-identity',
      'tmpl-collect-tomap-duplicate',
      'tmpl-collect-tomap-merge-first',
      'tmpl-collect-tomap-treemap',
    ]) {
      const kinds = kindsOf(templateId, 'standard')
      expect(kinds, templateId).not.toContain('CLASSIFIER_EVALUATED')
      expect(kinds, templateId).not.toContain('MAPPING_APPLIED')
    }
    // groupingBy配下ではgroupingBy自身のCLASSIFIER_EVALUATEDだけが現れる
    const grouped = kindsOf('tmpl-collect-tomap-grouped', 'standard')
    expect(grouped.filter((k) => k === 'CLASSIFIER_EVALUATED')).toHaveLength(4)
    expect(grouped).not.toContain('MAPPING_APPLIED')
  })

  it('P8-D12: valueMapperにNAME_VALUEを使ってもmapping系snapshotへ乗らない', () => {
    const kinds = kindsOf('tmpl-collect-tomap-merge-first', 'standard')
    expect(kinds).not.toContain('MAPPING_APPLIED')
    expect(kinds.filter((k) => k === 'TO_MAP_VALUE_EVALUATED')).toHaveLength(5)
    expect(NAME_VALUE.kind).toBe('fieldAccess')
  })
})
