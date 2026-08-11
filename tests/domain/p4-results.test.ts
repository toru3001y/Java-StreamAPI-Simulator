import { describe, expect, it } from 'vitest'
import { makeDefinition, runAllSnapshots } from '../helpers'
import { finalSnapshot } from '../p3-helpers'

/** P4-D30〜P4-D37: primitive集計・結果化・副作用（Phase 4指示 §6.4・§6.5） */

describe('P4-D30 sum', () => {
  it('P4-D30: int / long / doubleのsumと空結果（0 / 0L / 0.0）が正しい', () => {
    expect(finalSnapshot(makeDefinition('tmpl-sum-int')).output.result).toMatchObject({
      kind: 'SCALAR',
      typeLabel: 'int',
      valueLabel: '8',
    })
    expect(finalSnapshot(makeDefinition('tmpl-sum-long')).output.result).toMatchObject({
      typeLabel: 'long',
      valueLabel: '60L',
    })
    expect(finalSnapshot(makeDefinition('tmpl-sum-double')).output.result).toMatchObject({
      typeLabel: 'double',
      valueLabel: '4.0',
    })
    expect(finalSnapshot(makeDefinition('tmpl-sum-int', 'emptySource')).output.result).toMatchObject({
      valueLabel: '0',
    })
    expect(finalSnapshot(makeDefinition('tmpl-sum-long', 'emptySource')).output.result).toMatchObject({
      valueLabel: '0L',
    })
    expect(finalSnapshot(makeDefinition('tmpl-sum-double', 'emptySource')).output.result).toMatchObject({
      valueLabel: '0.0',
    })
    // 累積合計のsnapshot
    const snapshots = runAllSnapshots(makeDefinition('tmpl-sum-int'))
    const sums = snapshots
      .filter((s) => s.kind === 'ACCUMULATOR_UPDATED')
      .map((s) => s.processing?.evaluation)
    expect(sums).toEqual(['累積合計 → 3', '累積合計 → 4', '累積合計 → 8'])
  })
})

describe('P4-D31 average', () => {
  it('P4-D31: 合計・件数・平均の表示と空OptionalDoubleが正しい', () => {
    const def = makeDefinition('tmpl-average-int')
    const snapshots = runAllSnapshots(def)
    const updates = snapshots.filter((s) => s.kind === 'STATISTICS_UPDATED')
    expect(updates[3]?.processing?.evaluation).toBe('合計 10 / 件数 4 → 平均 2.5')
    expect(finalSnapshot(def).output.result).toMatchObject({
      kind: 'OPTIONAL',
      optionalTypeLabel: 'OptionalDouble',
      present: true,
      valueLabel: '2.5',
    })
    expect(finalSnapshot(makeDefinition('tmpl-average-long')).output.result).toMatchObject({
      valueLabel: '20.0',
    })
    expect(finalSnapshot(makeDefinition('tmpl-average-double')).output.result).toMatchObject({
      valueLabel: '2.5',
    })
    for (const t of ['tmpl-average-int', 'tmpl-average-long', 'tmpl-average-double']) {
      expect(finalSnapshot(makeDefinition(t, 'emptySource')).output.result, t).toMatchObject({
        optionalTypeLabel: 'OptionalDouble',
        present: false,
      })
    }
  })
})

describe('P4-D32 summaryStatistics標準値', () => {
  it('P4-D32: count / sum / min / average / maxを同時集計する', () => {
    expect(finalSnapshot(makeDefinition('tmpl-stats-int')).output.result).toMatchObject({
      kind: 'STATISTICS',
      statisticsTypeLabel: 'IntSummaryStatistics',
      countLabel: '4',
      sumLabel: '10L',
      minLabel: '1',
      maxLabel: '4',
      averageLabel: '2.5',
      emptyNote: null,
    })
    expect(finalSnapshot(makeDefinition('tmpl-stats-long')).output.result).toMatchObject({
      statisticsTypeLabel: 'LongSummaryStatistics',
      countLabel: '3',
      sumLabel: '60L',
      minLabel: '10L',
      maxLabel: '30L',
      averageLabel: '20.0',
    })
    expect(finalSnapshot(makeDefinition('tmpl-stats-double')).output.result).toMatchObject({
      statisticsTypeLabel: 'DoubleSummaryStatistics',
      countLabel: '3',
      sumLabel: '7.5',
      minLabel: '1.5',
      maxLabel: '3.5',
      averageLabel: '2.5',
    })
  })
})

describe('P4-D33 summaryStatistics空初期値', () => {
  it('P4-D33: 空Streamの正規初期値（MAX_VALUE / MIN_VALUE / 正負Infinity）が正しい', () => {
    expect(finalSnapshot(makeDefinition('tmpl-stats-int', 'emptySource')).output.result).toMatchObject({
      countLabel: '0',
      sumLabel: '0L',
      minLabel: 'Integer.MAX_VALUE',
      maxLabel: 'Integer.MIN_VALUE',
      averageLabel: '0.0',
    })
    expect(finalSnapshot(makeDefinition('tmpl-stats-long', 'emptySource')).output.result).toMatchObject({
      minLabel: 'Long.MAX_VALUE',
      maxLabel: 'Long.MIN_VALUE',
    })
    const doubleStats = finalSnapshot(makeDefinition('tmpl-stats-double', 'emptySource')).output.result
    expect(doubleStats).toMatchObject({
      sumLabel: '0.0',
      minLabel: 'Double.POSITIVE_INFINITY',
      maxLabel: 'Double.NEGATIVE_INFINITY',
      averageLabel: '0.0',
    })
    if (doubleStats.kind === 'STATISTICS') {
      expect(doubleStats.emptyNote).toContain('正規初期値')
    }
  })
})

describe('P4-D34 toList', () => {
  it('P4-D34: 既存実装を壊さず、unmodifiable注記を維持する', () => {
    const def = makeDefinition('tmpl-filter-basic')
    const snapshots = runAllSnapshots(def)
    const last = snapshots[snapshots.length - 1]!
    expect(last.output.result).toEqual({ kind: 'LIST' })
    expect(last.output.items.map((i) => i.label)).toEqual(['佐藤（age=35）', '高橋（age=42）'])
    const confirmed = snapshots.find((s) => s.kind === 'RESULT_CONFIRMED')!
    expect(confirmed.explanation.jdkNote).toContain('unmodifiable')
  })
})

describe('P4-D35 toArray', () => {
  it('P4-D35: Object[] / 型付き配列 / primitive配列 / 空配列が正しい', () => {
    // Object[]
    const objectArray = finalSnapshot(makeDefinition('tmpl-toarray-object')).output.result
    expect(objectArray).toMatchObject({ kind: 'ARRAY', componentTypeLabel: 'Object', length: 4 })
    if (objectArray.kind === 'ARRAY') {
      expect(objectArray.items[0]).toEqual({ index: 0, label: '佐藤（age=35）' })
    }
    // primitive配列（int / long / double）
    expect(finalSnapshot(makeDefinition('tmpl-toarray-int')).output.result).toMatchObject({
      componentTypeLabel: 'int',
      length: 3,
    })
    expect(finalSnapshot(makeDefinition('tmpl-toarray-long')).output.result).toMatchObject({
      componentTypeLabel: 'long',
      length: 3,
    })
    expect(finalSnapshot(makeDefinition('tmpl-toarray-double')).output.result).toMatchObject({
      componentTypeLabel: 'double',
      length: 2,
    })
    // generatorによる型付き配列
    expect(finalSnapshot(makeDefinition('tmpl-toarray-generator')).output.result).toMatchObject({
      componentTypeLabel: 'String',
      length: 2,
    })
    // 空Streamでも正しいcomponent typeの長さ0配列
    expect(finalSnapshot(makeDefinition('tmpl-toarray-generator', 'emptySource')).output.result).toMatchObject({
      componentTypeLabel: 'String',
      length: 0,
    })
    expect(finalSnapshot(makeDefinition('tmpl-toarray-int', 'emptySource')).output.result).toMatchObject({
      componentTypeLabel: 'int',
      length: 0,
    })
    // 格納snapshot（index順）
    const snapshots = runAllSnapshots(makeDefinition('tmpl-toarray-int'))
    const stored = snapshots.filter((s) => s.kind === 'ARRAY_ELEMENT_STORED')
    expect(stored.map((s) => s.processing?.inputLabel)).toEqual(['3 → [0]', '1 → [1]', '4 → [2]'])
  })
})

describe('P4-D36 forEach', () => {
  it('P4-D36: void結果とConsumer呼出しの回数・順序が正しい', () => {
    const def = makeDefinition('tmpl-foreach')
    const snapshots = runAllSnapshots(def)
    const last = snapshots[snapshots.length - 1]!
    expect(last.output.result).toEqual({ kind: 'VOID' })
    expect(last.output.resultTypeLabel).toBe('void')
    // Consumer呼出しはencounter orderで4回
    expect(snapshots.filter((s) => s.kind === 'CONSUMER_ACTION_PERFORMED')).toHaveLength(4)
    expect(last.sideEffects.map((e) => e.message)).toEqual(['佐藤', '鈴木', '高橋', '田中'])
    expect(last.sideEffects.map((e) => e.seq)).toEqual([1, 2, 3, 4])
    // 空StreamはConsumer 0回
    const empty = finalSnapshot(makeDefinition('tmpl-foreach', 'emptySource'))
    expect(empty.sideEffects).toHaveLength(0)
    expect(empty.output.result).toEqual({ kind: 'VOID' })
  })
})

describe('P4-D37 forEachOrdered', () => {
  it('P4-D37: encounter orderのConsumer実行と順序保証差の補助説明が正しい', () => {
    const def = makeDefinition('tmpl-foreachordered')
    const last = finalSnapshot(def)
    expect(last.output.result).toEqual({ kind: 'VOID' })
    // sequential実行では実際の処理順（encounter order）
    expect(last.sideEffects.map((e) => e.message)).toEqual(['3', '1', '4'])
    const ctx = last.operationContexts['node-sink']
    expect(ctx?.kind).toBe('forEach')
    if (ctx?.kind === 'forEach') {
      expect(ctx.op).toBe('forEachOrdered')
      expect(ctx.callCount).toBe(3)
      expect(ctx.orderingNote).toContain('encounter order')
    }
    // forEach側の注記はparallel非保証を説明
    const feCtx = finalSnapshot(makeDefinition('tmpl-foreach')).operationContexts['node-sink']
    if (feCtx?.kind === 'forEach') {
      expect(feCtx.orderingNote).toContain('保証しません')
    }
  })
})
