import { describe, expect, it } from 'vitest'
import { makeDefinition, runAllSnapshots } from '../helpers'
import {
  createInitialSnapshot,
  EngineInvariantError,
  nextSnapshot,
} from '../../src/domain/engine/stepEngine'

describe('P1-D11 Step Engine', () => {
  it('P1-D11: 基準fixtureのsnapshot種別と順序が決定的', () => {
    const def = makeDefinition('tmpl-filter-basic', 'standard')
    const snapshots = runAllSnapshots(def)
    expect(snapshots.map((s) => s.kind)).toEqual([
      'INITIAL',
      // 佐藤(35): 通過
      'SOURCE_EMIT',
      'NODE_ARRIVAL',
      'PREDICATE_EVALUATED',
      'ELEMENT_PASSED',
      'SINK_APPENDED',
      // 鈴木(27): 除外
      'SOURCE_EMIT',
      'NODE_ARRIVAL',
      'PREDICATE_EVALUATED',
      'ELEMENT_REJECTED',
      // 高橋(42): 通過
      'SOURCE_EMIT',
      'NODE_ARRIVAL',
      'PREDICATE_EVALUATED',
      'ELEMENT_PASSED',
      'SINK_APPENDED',
      // 田中(29): 除外
      'SOURCE_EMIT',
      'NODE_ARRIVAL',
      'PREDICATE_EVALUATED',
      'ELEMENT_REJECTED',
      'RESULT_CONFIRMED',
      'STREAM_CONSUMED',
    ])
    expect(snapshots).toHaveLength(def.snapshotCount)
  })

  it('P1-D11: 同じrevisionから同じsnapshot列を生成する（決定性）', () => {
    const def1 = makeDefinition('tmpl-filter-basic', 'standard')
    const def2 = makeDefinition('tmpl-filter-basic', 'standard')
    const run1 = runAllSnapshots(def1)
    const run2 = runAllSnapshots(def2)
    expect(JSON.parse(JSON.stringify(run1))).toEqual(JSON.parse(JSON.stringify(run2)))
  })

  it('P1-D11: 標準ケースの最終結果は佐藤・高橋（elementId順）', () => {
    const def = makeDefinition('tmpl-filter-basic', 'standard')
    const snapshots = runAllSnapshots(def)
    const last = snapshots[snapshots.length - 1]
    expect(last?.output.elementIds).toEqual(['emp-001', 'emp-003'])
    expect(last?.output.confirmed).toBe(true)
    expect(last?.completion).toBe('STREAM_CONSUMED')
  })

  it('P1-D11: filterチェーンの期待結果は高橋1件、件数は約60（500上限内）', () => {
    const def = makeDefinition('tmpl-filter-chain', 'standard')
    const snapshots = runAllSnapshots(def)
    const last = snapshots[snapshots.length - 1]
    expect(last?.output.elementIds).toEqual(['emp-003'])
    // 佐藤16 + 鈴木7 + 高橋17 + 田中10 + INITIAL/RESULT/CONSUMED 3 = 53（≒60前後）
    expect(def.snapshotCount).toBe(53)
    expect(snapshots).toHaveLength(53)
    expect(def.snapshotCount).toBeLessThanOrEqual(500)
  })

  it('J-3: revision不一致のsnapshotはEngineInvariantErrorになる（フェイルセーフ）', () => {
    const def = makeDefinition('tmpl-filter-basic', 'standard')
    const other = makeDefinition('tmpl-filter-basic', 'midEmpty')
    const foreign = createInitialSnapshot(other)
    expect(() => nextSnapshot(def, foreign)).toThrow(EngineInvariantError)
  })

  it('J-3: Predicate未束縛のfilterはEngineInvariantErrorになる（フェイルセーフ）', () => {
    const def = makeDefinition('tmpl-filter-basic', 'standard')
    const broken = {
      ...def,
      nodes: def.nodes.map((n) => (n.role === 'intermediate' ? { ...n, predicate: null } : n)),
    }
    const s0 = createInitialSnapshot(broken)
    // 次snapshotの導出過程でPredicateが必要になり不整合を検知する
    expect(() => nextSnapshot(broken, s0)).toThrow(EngineInvariantError)
  })
})

describe('P1-D12 snapshot不変条件', () => {
  const defs = [
    makeDefinition('tmpl-filter-basic', 'standard'),
    makeDefinition('tmpl-filter-basic', 'midEmpty'),
    makeDefinition('tmpl-filter-chain', 'standard'),
  ]

  it('P1-D12: active nodeとline IDが全snapshotで一致する', () => {
    for (const def of defs) {
      for (const snapshot of runAllSnapshots(def)) {
        if (snapshot.activeNodeId === null) {
          expect(snapshot.activeLineId).toBeNull()
        } else {
          const node = def.nodes.find((n) => n.nodeId === snapshot.activeNodeId)
          expect(node?.lineId).toBe(snapshot.activeLineId)
        }
      }
    }
  })

  it('P1-D12: 出力へ追加された要素は必要な全操作を通過済みである', () => {
    for (const def of defs) {
      const sink = def.nodes.find((n) => n.role === 'terminal')
      const filters = def.nodes.filter((n) => n.role === 'intermediate')
      for (const snapshot of runAllSnapshots(def)) {
        for (const elementId of snapshot.output.elementIds) {
          const states = snapshot.elementNodeStates[elementId]
          expect(states).toBeDefined()
          if (!states || !sink) continue
          expect(states[sink.nodeId]).toBe('PASSED')
          for (const f of filters) expect(states[f.nodeId]).toBe('PASSED')
        }
      }
    }
  })

  it('P1-D12: 要素の最新状態がノード別状態履歴と矛盾しない', () => {
    for (const def of defs) {
      for (const snapshot of runAllSnapshots(def)) {
        for (const element of def.dataset) {
          const latest = snapshot.elementLatestStates[element.elementId]
          const states = snapshot.elementNodeStates[element.elementId]
          expect(latest).toBeDefined()
          expect(states).toBeDefined()
          if (!latest || !states) continue
          const values = Object.values(states)
          if (latest === 'UNEVALUATED') {
            expect(values.every((v) => v === 'UNEVALUATED')).toBe(true)
          }
          if (latest === 'REJECTED') {
            expect(values).toContain('REJECTED')
          }
          if (latest === 'PROCESSING') {
            expect(values).toContain('PROCESSING')
          }
        }
      }
    }
  })

  it('P1-D12: snapshot IDと連番・revisionが一貫している', () => {
    const def = makeDefinition('tmpl-filter-basic', 'standard')
    const snapshots = runAllSnapshots(def)
    snapshots.forEach((snapshot, i) => {
      expect(snapshot.index).toBe(i)
      expect(snapshot.revision).toBe(def.revision)
      expect(snapshot.snapshotId).toBe(`${def.revision}#${i}`)
    })
    expect(new Set(snapshots.map((s) => s.snapshotId)).size).toBe(snapshots.length)
  })

  it('P1-D12: snapshotは不変（凍結）であり破壊的変更できない', () => {
    const def = makeDefinition('tmpl-filter-basic', 'standard')
    const snapshot = createInitialSnapshot(def)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.output)).toBe(true)
    expect(() => {
      ;(snapshot.output.elementIds as string[]).push('emp-999')
    }).toThrow()
  })
})

describe('P1-D13 空ソース', () => {
  it('P1-D13: 要素処理なしで空List結果が確定し、count 0', () => {
    const def = makeDefinition('tmpl-filter-basic', 'emptySource')
    const snapshots = runAllSnapshots(def)
    expect(snapshots.map((s) => s.kind)).toEqual([
      'INITIAL',
      'RESULT_CONFIRMED',
      'STREAM_CONSUMED',
    ])
    const last = snapshots[snapshots.length - 1]
    expect(last?.output.elementIds).toEqual([])
    expect(last?.output.count).toBe(0)
    expect(last?.output.confirmed).toBe(true)
    expect(last?.output.resultTypeLabel).toBe('List<Employee>')
  })

  it('P1-D13: 途中0件は全入力が除外され空List', () => {
    const def = makeDefinition('tmpl-filter-basic', 'midEmpty')
    const snapshots = runAllSnapshots(def)
    const last = snapshots[snapshots.length - 1]
    expect(last?.output.count).toBe(0)
    for (const element of def.dataset) {
      expect(last?.elementLatestStates[element.elementId]).toBe('REJECTED')
    }
  })
})
