import { describe, expect, it } from 'vitest'
import { makeDefinition, runAllSnapshots } from '../helpers'
import { formatTypeRef } from '../../src/domain/types/typeRef'

describe('P2-D17 flatMap', () => {
  it('P2-D17: 0/1/複数子、親子位置、順序、flatten結果が正しい', () => {
    const def = makeDefinition('tmpl-flatmap', 'standard')
    // 親: [Java, SQL]（2子）、[]（0子）、[分析]（1子）
    expect(def.dataset.map((d) => d.elementId)).toEqual(['nested-001', 'nested-002', 'nested-003'])
    const snapshots = runAllSnapshots(def)
    const kinds = snapshots.map((s) => s.kind)
    expect(kinds).toEqual([
      'INITIAL',
      // 親1（2子）
      'SOURCE_EMIT',
      'NODE_ARRIVAL',
      'MAPPED_STREAM_CREATED',
      'CHILD_EMITTED',
      'SINK_APPENDED',
      'CHILD_EMITTED',
      'SINK_APPENDED',
      // 親2（0子）
      'SOURCE_EMIT',
      'NODE_ARRIVAL',
      'MAPPED_STREAM_CREATED',
      // 親3（1子）
      'SOURCE_EMIT',
      'NODE_ARRIVAL',
      'MAPPED_STREAM_CREATED',
      'CHILD_EMITTED',
      'SINK_APPENDED',
      'RESULT_CONFIRMED',
      'STREAM_CONSUMED',
    ])
    // 親子位置: 子要素snapshotは親をparentElementIdとして保持し、処理中は子1件だけ
    const childEmits = snapshots.filter((s) => s.kind === 'CHILD_EMITTED')
    expect(childEmits.map((s) => s.currentElementId)).toEqual([
      'nested-001-c1',
      'nested-001-c2',
      'nested-003-c1',
    ])
    expect(childEmits.map((s) => s.parentElementId)).toEqual([
      'nested-001',
      'nested-001',
      'nested-003',
    ])
    // encounter orderどおりのflatten結果
    const last = snapshots[snapshots.length - 1]
    expect(last?.output.items.map((i) => i.label)).toEqual(['"Java"', '"SQL"', '"分析"'])
    expect(last?.output.elementIds).toEqual(['nested-001-c1', 'nested-001-c2', 'nested-003-c1'])
  })

  it('P2-D17: mapped Stream生成snapshotでは親だけが処理対象（処理中は原則1件）', () => {
    const def = makeDefinition('tmpl-flatmap', 'standard')
    const snapshots = runAllSnapshots(def)
    const created = snapshots.filter((s) => s.kind === 'MAPPED_STREAM_CREATED')
    for (const s of created) {
      expect(s.currentElementId).toBe(s.flatMapContext?.parentElementId)
      // 処理中状態の要素は高々1件（親のみ）
      const processing = Object.entries(s.elementLatestStates).filter(
        ([, state]) => state === 'PROCESSING',
      )
      expect(processing.length).toBeLessThanOrEqual(1)
    }
    // 子要素snapshotでも処理中は1件だけ（親は文脈情報として保持）
    const childSnapshots = snapshots.filter((s) => s.kind === 'CHILD_EMITTED')
    for (const s of childSnapshots) {
      const processing = Object.entries(s.elementLatestStates).filter(
        ([, state]) => state === 'PROCESSING',
      )
      expect(processing.length).toBeLessThanOrEqual(1)
      expect(processing[0]?.[0]).toBe(s.currentElementId)
    }
  })

  it('P2-D17: 途中0件（全親が空List）と空ソース', () => {
    const midEmpty = makeDefinition('tmpl-flatmap', 'midEmpty')
    const midSnapshots = runAllSnapshots(midEmpty)
    expect(midSnapshots.at(-1)?.output.count).toBe(0)
    // 全親のmapped Streamが0子で生成される
    const created = midSnapshots.filter((s) => s.kind === 'MAPPED_STREAM_CREATED')
    expect(created).toHaveLength(2)
    for (const s of created) expect(s.flatMapContext?.children).toHaveLength(0)

    const empty = makeDefinition('tmpl-flatmap', 'emptySource')
    expect(runAllSnapshots(empty).map((s) => s.kind)).toEqual([
      'INITIAL',
      'RESULT_CONFIRMED',
      'STREAM_CONSUMED',
    ])
  })
})

describe('P2-D18 flatMapToX', () => {
  const cases = [
    {
      templateId: 'tmpl-flatmap-int',
      op: 'flatMapToInt',
      stream: 'IntStream',
      labels: ['1', '2', '3'],
      result: 'List<Integer>',
    },
    {
      templateId: 'tmpl-flatmap-long',
      op: 'flatMapToLong',
      stream: 'LongStream',
      labels: ['10L', '20L', '30L'],
      result: 'List<Long>',
    },
    {
      templateId: 'tmpl-flatmap-double',
      op: 'flatMapToDouble',
      stream: 'DoubleStream',
      labels: ['1.5', '2.5', '3.5'],
      result: 'List<Double>',
    },
  ] as const

  for (const c of cases) {
    it(`P2-D18: ${c.op}のmapped Streamとprimitive出力型が正しい`, () => {
      const def = makeDefinition(c.templateId, 'standard')
      const node = def.nodes.find((n) => n.operationId === c.op)
      expect(node && formatTypeRef(node.outputType)).toBe(c.stream)
      expect(formatTypeRef(def.resultType)).toBe(c.result)
      const snapshots = runAllSnapshots(def)
      const last = snapshots[snapshots.length - 1]
      expect(last?.output.items.map((i) => i.label)).toEqual(c.labels)
      // 親（配列）→子（primitive）の親子構造
      const childEmits = snapshots.filter((s) => s.kind === 'CHILD_EMITTED')
      expect(childEmits.length).toBe(c.labels.length)
      for (const s of childEmits) expect(s.parentElementId).not.toBeNull()
    })
  }
})

describe('P2-D19 mapped Stream close', () => {
  it('P2-D19: closeは独立snapshotを生成せず、詳細（flatMapContext）へ含まれる', () => {
    const def = makeDefinition('tmpl-flatmap', 'standard')
    const snapshots = runAllSnapshots(def)
    // closeという独立snapshot種別は存在しない
    for (const s of snapshots) {
      expect(s.kind).not.toContain('CLOSE')
    }
    // 2子の親: mapped Stream生成時点ではclosedではない
    const created2 = snapshots.find(
      (s) => s.kind === 'MAPPED_STREAM_CREATED' && s.flatMapContext?.children.length === 2,
    )
    expect(created2?.flatMapContext?.closed).toBe(false)
    // 最後の子の処理完了snapshotでclose状態が詳細へ反映される
    const lastChildSink = snapshots.find(
      (s) => s.kind === 'SINK_APPENDED' && s.currentElementId === 'nested-001-c2',
    )
    expect(lastChildSink?.flatMapContext?.closed).toBe(true)
    expect(lastChildSink?.flatMapContext?.emittedCount).toBe(2)
    // 0子の親: 生成snapshot自体でclose済み
    const created0 = snapshots.find(
      (s) => s.kind === 'MAPPED_STREAM_CREATED' && s.flatMapContext?.children.length === 0,
    )
    expect(created0?.flatMapContext?.closed).toBe(true)
  })
})
