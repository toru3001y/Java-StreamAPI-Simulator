import { describe, expect, it } from 'vitest'
import type { SnapshotKind } from '../../src/domain/engine/snapshot'
import { createInitialSnapshot, nextSnapshot } from '../../src/domain/engine/stepEngine'
import { makeDefinition, runAllSnapshots } from '../helpers'
import {
  GATHER_NODE_ID,
  gatherCtxOf,
  gatherTemplateModes,
  lastGatherCtx,
  outputLabels,
  runGather,
  snapshotsOfKind,
} from '../p7-helpers'

/**
 * P7-D08〜P7-D18・P7-D22: Step Engineのgather実装が
 * Phase 7指示 §8.2の確定snapshot列と一致することを検証する。
 *
 * 期待列は指示書§8.2の表をそのまま写したものであり、実装に合わせて書き換えない。
 */

// ---- §8.2の確定列（表記の短縮のためkind列のみを定数化する） ----
const SE = 'SOURCE_EMIT'
const NA = 'NODE_ARRIVAL'
const WBU = 'WINDOW_BUFFER_UPDATED'
const GE = 'GATHER_EMITTED'
const SA = 'SINK_APPENDED'
const GI = 'GATHER_INITIALIZED'
const GF = 'GATHER_FINISHED'
const RC = 'RESULT_CONFIRMED'
const SC = 'STREAM_CONSUMED'

/** §8.2 #1 window-fixed × standard（計21） */
const EXPECTED_WINDOW_FIXED_STANDARD: SnapshotKind[] = [
  'INITIAL', GI,
  SE, NA, WBU,
  SE, NA, WBU,
  SE, NA, WBU, GE, SA,
  SE, NA, WBU, GF, GE, SA,
  RC, SC,
]

/** §8.2 #2 window-fixed-exact × standard（計21） */
const EXPECTED_WINDOW_FIXED_EXACT: SnapshotKind[] = [
  'INITIAL', GI,
  SE, NA, WBU,
  SE, NA, WBU, GE, SA,
  SE, NA, WBU,
  SE, NA, WBU, GE, SA,
  GF,
  RC, SC,
]

/** §8.2 #3 / #6 window系 × emptySource（計5） */
const EXPECTED_WINDOW_EMPTY: SnapshotKind[] = ['INITIAL', GI, GF, RC, SC]

/** §8.2 #4 window-sliding × standard（計23） */
const EXPECTED_WINDOW_SLIDING_STANDARD: SnapshotKind[] = [
  'INITIAL', GI,
  SE, NA, WBU,
  SE, NA, WBU, GE, SA,
  SE, NA, WBU, GE, SA,
  SE, NA, WBU, GE, SA,
  GF,
  RC, SC,
]

/** §8.2 #5 window-sliding-short × standard（計13） */
const EXPECTED_WINDOW_SLIDING_SHORT: SnapshotKind[] = [
  'INITIAL', GI,
  SE, NA, WBU,
  SE, NA, WBU,
  GF, GE, SA,
  RC, SC,
]

/** §8.2 #7 scan × standard（boxed経由。計28） */
const EXPECTED_SCAN_STANDARD: SnapshotKind[] = [
  'INITIAL', GI,
  SE, NA, 'MAPPING_APPLIED', 'MAPPED_EMITTED', NA, 'SCAN_ACCUMULATED', GE, SA,
  SE, NA, 'MAPPING_APPLIED', 'MAPPED_EMITTED', NA, 'SCAN_ACCUMULATED', GE, SA,
  SE, NA, 'MAPPING_APPLIED', 'MAPPED_EMITTED', NA, 'SCAN_ACCUMULATED', GE, SA,
  RC, SC,
]

/** §8.2 #8 scan × emptySource（計4） */
const EXPECTED_SCAN_EMPTY: SnapshotKind[] = ['INITIAL', GI, RC, SC]

/** §8.2 #9 scan-concat × standard（計19） */
const EXPECTED_SCAN_CONCAT: SnapshotKind[] = [
  'INITIAL', GI,
  SE, NA, 'SCAN_ACCUMULATED', GE, SA,
  SE, NA, 'SCAN_ACCUMULATED', GE, SA,
  SE, NA, 'SCAN_ACCUMULATED', GE, SA,
  RC, SC,
]

/** §8.2 #10 fold × standard（計20） */
const EXPECTED_FOLD_STANDARD: SnapshotKind[] = [
  'INITIAL', GI,
  SE, NA, 'FOLD_ACCUMULATED',
  SE, NA, 'FOLD_ACCUMULATED',
  SE, NA, 'FOLD_ACCUMULATED',
  SE, NA, 'FOLD_ACCUMULATED',
  GF, GE, 'FIND_SELECTED', 'SHORT_CIRCUIT_CONFIRMED',
  RC, SC,
]

/** §8.2 #11 fold × emptySource（計8） */
const EXPECTED_FOLD_EMPTY: SnapshotKind[] = [
  'INITIAL', GI, GF, GE, 'FIND_SELECTED', 'SHORT_CIRCUIT_CONFIRMED', RC, SC,
]

describe('P7-D08 GATHER_INITIALIZED', () => {
  it('P7-D08: 全template × 全modeで正確に1件発行される', () => {
    for (const { templateId, mode } of gatherTemplateModes()) {
      const run = runGather(templateId, mode)
      const initialized = snapshotsOfKind(run, 'GATHER_INITIALIZED')
      expect(initialized.length, `${templateId}:${mode}`).toBe(1)
      expect(initialized[0]?.activeNodeId, `${templateId}:${mode}`).toBe(GATHER_NODE_ID)
      expect(initialized[0]?.currentElementId, `${templateId}:${mode}`).toBeNull()
    }
  })

  it('P7-D08: source要素送出前（空ソースでは終端処理前）の位置に発行される', () => {
    for (const { templateId, mode } of gatherTemplateModes()) {
      const run = runGather(templateId, mode)
      const giIndex = run.kinds.indexOf('GATHER_INITIALIZED')
      // INITIALの直後
      expect(giIndex, `${templateId}:${mode}`).toBe(1)
      const firstEmit = run.kinds.indexOf('SOURCE_EMIT')
      if (firstEmit >= 0) expect(giIndex, `${templateId}:${mode}`).toBeLessThan(firstEmit)
      const resultIndex = run.kinds.indexOf('RESULT_CONFIRMED')
      expect(giIndex, `${templateId}:${mode}`).toBeLessThan(resultIndex)
    }
  })
})

describe('P7-D09 windowFixed標準列（§8.2 #1）', () => {
  const run = runGather('tmpl-gather-window-fixed', 'standard')

  it('P7-D09: 確定列と完全一致する（計21件）', () => {
    expect(run.kinds).toEqual(EXPECTED_WINDOW_FIXED_STANDARD)
    expect(run.snapshots).toHaveLength(21)
  })

  it('P7-D09: 窓成立時のGATHER_EMITTED → SINK_APPENDEDの順序とcurrentElementId', () => {
    const emitted = snapshotsOfKind(run, 'GATHER_EMITTED')
    expect(emitted.map((s) => s.currentElementId)).toEqual([
      'node-gather-win-1',
      'node-gather-win-2',
    ])
    // 各GATHER_EMITTEDの直後がSINK_APPENDED（下流へdepth-firstで流れ切る）
    for (const snapshot of emitted) {
      expect(run.kinds[snapshot.index + 1]).toBe('SINK_APPENDED')
    }
  })

  it('P7-D09: 残余flushはGATHER_FINISHEDの直後に起きる', () => {
    const finishedIndex = run.kinds.indexOf('GATHER_FINISHED')
    expect(run.kinds[finishedIndex + 1]).toBe('GATHER_EMITTED')
    expect(run.snapshots[finishedIndex + 1]?.currentElementId).toBe('node-gather-win-2')
    expect(outputLabels(run)).toEqual([
      '[佐藤（age=35）, 鈴木（age=27）, 高橋（age=42）]',
      '[田中（age=29）]',
    ])
  })
})

describe('P7-D10 windowFixed倍数ケース（§8.2 #2）', () => {
  const run = runGather('tmpl-gather-window-fixed-exact', 'standard')

  it('P7-D10: 確定列と完全一致する（計21件）', () => {
    expect(run.kinds).toEqual(EXPECTED_WINDOW_FIXED_EXACT)
    expect(run.snapshots).toHaveLength(21)
  })

  it('P7-D10: GATHER_FINISHED後にGATHER_EMITTEDが存在しない', () => {
    const finishedIndex = run.kinds.indexOf('GATHER_FINISHED')
    expect(finishedIndex).toBeGreaterThan(0)
    expect(run.kinds.slice(finishedIndex).filter((k) => k === 'GATHER_EMITTED')).toEqual([])
  })

  it('P7-D10: 「残余なし」がcontextに明示される', () => {
    const ctx = lastGatherCtx(run)
    expect(ctx.finishedNote).toContain('残余なし')
    expect(ctx.buffer).toEqual([])
    expect(ctx.emittedCount).toBe(2)
    expect(outputLabels(run)).toEqual([
      '[佐藤（age=35）, 鈴木（age=27）]',
      '[高橋（age=42）, 田中（age=29）]',
    ])
  })
})

describe('P7-D11 windowFixed空ソース（§8.2 #3）', () => {
  const run = runGather('tmpl-gather-window-fixed', 'emptySource')

  it('P7-D11: 確定列と完全一致する（計5件）', () => {
    expect(run.kinds).toEqual(EXPECTED_WINDOW_EMPTY)
    expect(run.snapshots).toHaveLength(5)
  })

  it('P7-D11: 放出0件がcontextに明示される', () => {
    const ctx = lastGatherCtx(run)
    expect(ctx.finishedNote).toContain('放出した窓は0件')
    expect(ctx.emittedCount).toBe(0)
    expect(ctx.emitted).toEqual([])
    expect(outputLabels(run)).toEqual([])
  })
})

describe('P7-D12 windowSliding標準（§8.2 #4）', () => {
  const run = runGather('tmpl-gather-window-sliding', 'standard')

  it('P7-D12: 確定列と完全一致する（計23件）', () => {
    expect(run.kinds).toEqual(EXPECTED_WINDOW_SLIDING_STANDARD)
    expect(run.snapshots).toHaveLength(23)
  })

  it('P7-D12: evict+appendが1回のWINDOW_BUFFER_UPDATEDで、evict要素がcontextに載る', () => {
    const updates = snapshotsOfKind(run, 'WINDOW_BUFFER_UPDATED')
    expect(updates).toHaveLength(4)
    // 1件目・2件目はバッファ充填のみ（evictなし）
    expect(gatherCtxOf(updates[0]!).evictedLast).toBeNull()
    expect(gatherCtxOf(updates[1]!).evictedLast).toBeNull()
    // 3件目・4件目はevict + append（1回の状態更新）
    expect(gatherCtxOf(updates[2]!).evictedLast?.label).toBe('"Java"')
    expect(gatherCtxOf(updates[3]!).evictedLast?.label).toBe('"SQL"')
  })

  it('P7-D12: 3窓が放出され、終端は追加放出なしを明示する', () => {
    expect(outputLabels(run)).toEqual([
      '["Java", "SQL"]',
      '["SQL", "Git"]',
      '["Git", "AWS"]',
    ])
    expect(lastGatherCtx(run).finishedNote).toContain('追加放出なし')
  })
})

describe('P7-D13 windowSliding 入力<窓サイズ・空（§8.2 #5 / #6）', () => {
  const short = runGather('tmpl-gather-window-sliding-short', 'standard')
  const empty = runGather('tmpl-gather-window-sliding', 'emptySource')

  it('P7-D13: 入力<窓サイズは確定列と完全一致する（計13件）', () => {
    expect(short.kinds).toEqual(EXPECTED_WINDOW_SLIDING_SHORT)
    expect(short.snapshots).toHaveLength(13)
  })

  it('P7-D13: 全要素の1窓が終端で確定・放出され、メンバー構成が全入力と一致する', () => {
    expect(outputLabels(short)).toEqual(['["Java", "SQL"]'])
    const ctx = lastGatherCtx(short)
    expect(ctx.emittedCount).toBe(1)
    expect(ctx.emitted[0]?.id).toBe('node-gather-win-1')
    expect(ctx.emitted[0]?.memberIds).toEqual(['of-001', 'of-002'])
    expect(ctx.finishedNote).toContain('窓サイズ未満')
  })

  it('P7-D13: 空ソースは確定列と完全一致する（計5件）', () => {
    expect(empty.kinds).toEqual(EXPECTED_WINDOW_EMPTY)
    expect(empty.snapshots).toHaveLength(5)
    expect(outputLabels(empty)).toEqual([])
  })
})

describe('P7-D14 scan（§8.2 #7 / #8）', () => {
  const run = runGather('tmpl-gather-scan', 'standard')
  const empty = runGather('tmpl-gather-scan', 'emptySource')

  it('P7-D14: 標準列と完全一致する（計28件）', () => {
    expect(run.kinds).toEqual(EXPECTED_SCAN_STANDARD)
    expect(run.snapshots).toHaveLength(28)
  })

  it('P7-D14: SCAN_ACCUMULATEDとGATHER_EMITTEDが分離している', () => {
    const accumulated = snapshotsOfKind(run, 'SCAN_ACCUMULATED')
    expect(accumulated).toHaveLength(3)
    for (const snapshot of accumulated) {
      expect(run.kinds[snapshot.index + 1]).toBe('GATHER_EMITTED')
    }
  })

  it('P7-D14: 出力IDは入力要素のIDを継承する（map系1→1変換と同一規則）', () => {
    const emitted = snapshotsOfKind(run, 'GATHER_EMITTED')
    expect(emitted.map((s) => s.currentElementId)).toEqual([
      'numbers-001',
      'numbers-002',
      'numbers-003',
    ])
    expect(outputLabels(run)).toEqual(['3', '4', '8'])
  })

  it('P7-D14: GATHER_FINISHEDを発行しない（v0.9 §6.1の統一規則）', () => {
    expect(run.kinds).not.toContain('GATHER_FINISHED')
    expect(empty.kinds).not.toContain('GATHER_FINISHED')
    expect(lastGatherCtx(run).finishedNote).toBeNull()
  })

  it('P7-D14: 空ソースは初期値生成のみを実演する（計4件）', () => {
    expect(empty.kinds).toEqual(EXPECTED_SCAN_EMPTY)
    expect(empty.snapshots).toHaveLength(4)
    const ctx = lastGatherCtx(empty)
    expect(ctx.initialLabel).toBe('0')
    expect(ctx.accumulatorLabel).toBe('0')
    expect(ctx.emittedCount).toBe(0)
    expect(outputLabels(empty)).toEqual([])
  })
})

describe('P7-D15 fold（§8.2 #10 / #11）', () => {
  const run = runGather('tmpl-gather-fold', 'standard')
  const empty = runGather('tmpl-gather-fold', 'emptySource')

  it('P7-D15: 標準列と完全一致する（計20件）', () => {
    expect(run.kinds).toEqual(EXPECTED_FOLD_STANDARD)
    expect(run.snapshots).toHaveLength(20)
  })

  it('P7-D15: FOLD_ACCUMULATEDは放出を伴わない', () => {
    const accumulated = snapshotsOfKind(run, 'FOLD_ACCUMULATED')
    expect(accumulated).toHaveLength(4)
    for (const snapshot of accumulated) {
      expect(run.kinds[snapshot.index + 1]).not.toBe('GATHER_EMITTED')
      expect(gatherCtxOf(snapshot).emittedCount).toBe(0)
    }
    // 放出は終端の1件だけ
    expect(snapshotsOfKind(run, 'GATHER_EMITTED')).toHaveLength(1)
  })

  it('P7-D15: 終端でOptional[21_700_000L]へ到達する', () => {
    const last = run.snapshots[run.snapshots.length - 1]!
    expect(last.output.result).toEqual({
      kind: 'OPTIONAL',
      optionalTypeLabel: 'Optional',
      elementTypeLabel: 'Long',
      present: true,
      valueLabel: '21_700_000L',
      valueElementId: 'node-gather-result',
    })
  })

  it('P7-D15: 空ソースはidentityを最終値としてOptional[0L]になる（計8件）', () => {
    expect(empty.kinds).toEqual(EXPECTED_FOLD_EMPTY)
    expect(empty.snapshots).toHaveLength(8)
    const last = empty.snapshots[empty.snapshots.length - 1]!
    expect(last.output.result).toMatchObject({
      kind: 'OPTIONAL',
      present: true,
      valueLabel: '0L',
      valueElementId: 'node-gather-result',
    })
    expect(lastGatherCtx(empty).finishedNote).toContain('identity')
  })
})

describe('P7-D22 scan × stringConcat実行契約（§8.2 #9）', () => {
  const run = runGather('tmpl-gather-scan-concat', 'standard')

  it('P7-D22: 確定列と完全一致する（計19件）', () => {
    expect(run.kinds).toEqual(EXPECTED_SCAN_CONCAT)
    expect(run.snapshots).toHaveLength(19)
  })

  it('P7-D22: string累積のboxed変換契約（string → string）と空文字initialの表示', () => {
    const first = run.snapshots[1]!
    const ctx = gatherCtxOf(first)
    expect(ctx.initialLabel).toBe('""')
    expect(ctx.accumulatorLabel).toBe('""')
    expect(outputLabels(run)).toEqual(['"Java"', '"JavaSQL"', '"JavaSQLGit"'])
  })

  it('P7-D22: 出力IDは入力要素のIDを継承する', () => {
    expect(snapshotsOfKind(run, 'GATHER_EMITTED').map((s) => s.currentElementId)).toEqual([
      'of-001',
      'of-002',
      'of-003',
    ])
  })
})

describe('P7-D16 合成ID契約', () => {
  it('P7-D16: 窓IDは<nodeId>-win-<N>で生成順に採番される', () => {
    const run = runGather('tmpl-gather-window-sliding', 'standard')
    const ctx = lastGatherCtx(run)
    expect(ctx.emitted.map((item) => item.id)).toEqual([
      'node-gather-win-1',
      'node-gather-win-2',
      'node-gather-win-3',
    ])
  })

  it('P7-D16: fold最終値IDは<nodeId>-resultである', () => {
    const run = runGather('tmpl-gather-fold', 'standard')
    expect(lastGatherCtx(run).emitted.map((i) => i.id)).toEqual(['node-gather-result'])
  })

  it('P7-D16: memberIdsが入力ElementId列と一致する', () => {
    const fixed = runGather('tmpl-gather-window-fixed', 'standard')
    expect(lastGatherCtx(fixed).emitted.map((i) => i.memberIds)).toEqual([
      ['emp-001', 'emp-002', 'emp-003'],
      ['emp-004'],
    ])
    const sliding = runGather('tmpl-gather-window-sliding', 'standard')
    expect(lastGatherCtx(sliding).emitted.map((i) => i.memberIds)).toEqual([
      ['of-001', 'of-002'],
      ['of-002', 'of-003'],
      ['of-003', 'of-004'],
    ])
  })

  it('P7-D16: Pipeline全体でElementIdが一意である', () => {
    for (const { templateId, mode } of gatherTemplateModes()) {
      const run = runGather(templateId, mode)
      const last = run.snapshots[run.snapshots.length - 1]!
      const ids = Object.keys(last.elementNodeStates)
      expect(new Set(ids).size, `${templateId}:${mode}`).toBe(ids.length)
    }
  })

  it('P7-D16: 同一revisionの再実行で同一のID列・snapshot列を生成する（決定性）', () => {
    for (const { templateId, mode } of gatherTemplateModes()) {
      const a = runAllSnapshots(makeDefinition(templateId, mode))
      const b = runAllSnapshots(makeDefinition(templateId, mode))
      expect(a.map((s) => s.kind), `${templateId}:${mode}`).toEqual(b.map((s) => s.kind))
      expect(
        a.map((s) => s.currentElementId),
        `${templateId}:${mode}`,
      ).toEqual(b.map((s) => s.currentElementId))
      expect(
        a.map((s) => JSON.stringify(s.operationContexts)),
        `${templateId}:${mode}`,
      ).toEqual(b.map((s) => JSON.stringify(s.operationContexts)))
    }
  })
})

describe('P7-D17 要素状態遷移（§7.3-6）', () => {
  it('P7-D17: window系はBUFFERED → 最初の窓放出でPASSEDへ遷移する', () => {
    const run = runGather('tmpl-gather-window-fixed', 'standard')
    const buffered = snapshotsOfKind(run, 'WINDOW_BUFFER_UPDATED')[0]!
    expect(buffered.elementLatestStates['emp-001']).toBe('BUFFERED')
    expect(buffered.elementNodeStates['emp-001']?.[GATHER_NODE_ID]).toBe('BUFFERED')
    const firstWindow = snapshotsOfKind(run, 'GATHER_EMITTED')[0]!
    for (const id of ['emp-001', 'emp-002', 'emp-003']) {
      expect(firstWindow.elementNodeStates[id]?.[GATHER_NODE_ID], id).toBe('PASSED')
      expect(firstWindow.elementLatestStates[id], id).toBe('PASSED')
    }
  })

  it('P7-D17: windowSlidingで放出後もバッファに残る要素のlatestはPASSEDのまま維持される', () => {
    const run = runGather('tmpl-gather-window-sliding', 'standard')
    const emitted = snapshotsOfKind(run, 'GATHER_EMITTED')
    // of-002は win-1 と win-2 の両方に属する
    expect(emitted[0]?.elementLatestStates['of-002']).toBe('PASSED')
    const secondWindow = emitted[1]!
    expect(secondWindow.elementLatestStates['of-002']).toBe('PASSED')
    // 現在のバッファ所属はcontextのみで表す（状態と所属の分離）
    expect(gatherCtxOf(secondWindow).buffer.map((i) => i.id)).toEqual(['of-002', 'of-003'])
  })

  it('P7-D17: scanはmap系（PROCESSING → PASSED）の遷移に従う', () => {
    const run = runGather('tmpl-gather-scan-concat', 'standard')
    const arrivals = run.snapshots.filter(
      (s) => s.kind === 'NODE_ARRIVAL' && s.activeNodeId === GATHER_NODE_ID,
    )
    expect(arrivals[0]?.elementLatestStates['of-001']).toBe('PROCESSING')
    const emitted = snapshotsOfKind(run, 'GATHER_EMITTED')[0]!
    expect(emitted.elementNodeStates['of-001']?.[GATHER_NODE_ID]).toBe('PASSED')
    expect(emitted.elementLatestStates['of-001']).toBe('PASSED')
  })

  it('P7-D17: foldはFOLD_ACCUMULATEDでPASSEDへ遷移する（reduce系に倣う）', () => {
    const run = runGather('tmpl-gather-fold', 'standard')
    const accumulated = snapshotsOfKind(run, 'FOLD_ACCUMULATED')[0]!
    expect(accumulated.elementNodeStates['emp-001']?.[GATHER_NODE_ID]).toBe('PASSED')
    expect(accumulated.elementLatestStates['emp-001']).toBe('PASSED')
  })

  it('P7-D17: gatherノードでREJECTEDは発生しない', () => {
    for (const { templateId, mode } of gatherTemplateModes()) {
      const run = runGather(templateId, mode)
      for (const snapshot of run.snapshots) {
        for (const [elementId, states] of Object.entries(snapshot.elementNodeStates)) {
          expect(states[GATHER_NODE_ID], `${templateId}:${mode} ${elementId}`).not.toBe('REJECTED')
        }
      }
    }
  })
})

describe('P7-D18 復元契約（任意cursorからの完全復元）', () => {
  it('P7-D18: 任意cursorのsnapshotからgather contextの全フィールドが復元できる', () => {
    for (const { templateId, mode } of gatherTemplateModes()) {
      const def = makeDefinition(templateId, mode)
      const snapshots = runAllSnapshots(def)
      for (const snapshot of snapshots) {
        const ctx = snapshot.operationContexts[GATHER_NODE_ID]
        // gatherノードのcontextはINITIAL時点から常設される
        expect(ctx, `${templateId}:${mode} @${snapshot.index}`).toBeDefined()
        expect(ctx?.kind).toBe('gather')
        if (ctx?.kind !== 'gather') continue
        // §7.7の契約項目がすべて載っていること
        expect(ctx.nodeId).toBe(GATHER_NODE_ID)
        expect(ctx.gathererLabel).toContain('Gatherers.')
        expect(ctx.elements.map((e) => e.name)).toEqual([
          'initializer',
          'integrator',
          'combiner',
          'finisher',
        ])
        expect(ctx.typeTransitionLabel).toContain('→')
        expect(typeof ctx.emittedCount).toBe('number')
        expect(ctx.emitted.length).toBe(ctx.emittedCount)
      }
    }
  })

  it('P7-D18: 戻る → 進むで全フィールドが一致する（再計算せず保存済みsnapshotを返す）', () => {
    for (const { templateId, mode } of gatherTemplateModes()) {
      const def = makeDefinition(templateId, mode)
      const forward = runAllSnapshots(def)
      // 先頭から順に next を辿り直し、同じsnapshotが得られること
      let cursor = createInitialSnapshot(def)
      const replayed = [cursor]
      for (;;) {
        const next = nextSnapshot(def, cursor)
        if (next === null) break
        cursor = next
        replayed.push(cursor)
      }
      expect(replayed.length, `${templateId}:${mode}`).toBe(forward.length)
      for (let i = 0; i < forward.length; i++) {
        expect(
          JSON.stringify(replayed[i]?.operationContexts[GATHER_NODE_ID]),
          `${templateId}:${mode} @${i}`,
        ).toBe(JSON.stringify(forward[i]?.operationContexts[GATHER_NODE_ID]))
        expect(replayed[i]?.snapshotId).toBe(forward[i]?.snapshotId)
      }
    }
  })

  it('P7-D18: バッファ・evict・累積値・emitted・memberIdsが各cursorで独立に復元される', () => {
    const run = runGather('tmpl-gather-window-sliding', 'standard')
    const updates = snapshotsOfKind(run, 'WINDOW_BUFFER_UPDATED')
    // 各時点のバッファ内容が混ざらない（structuredCloneによるsnapshot固定）
    expect(updates.map((s) => gatherCtxOf(s).buffer.map((i) => i.label))).toEqual([
      ['"Java"'],
      ['"Java"', '"SQL"'],
      ['"SQL"', '"Git"'],
      ['"Git"', '"AWS"'],
    ])
    const foldRun = runGather('tmpl-gather-fold', 'standard')
    expect(
      snapshotsOfKind(foldRun, 'FOLD_ACCUMULATED').map((s) => gatherCtxOf(s).accumulatorLabel),
    ).toEqual(['5_500_000L', '9_700_000L', '16_900_000L', '21_700_000L'])
    expect(
      snapshotsOfKind(foldRun, 'FOLD_ACCUMULATED').map((s) => gatherCtxOf(s).history.length),
    ).toEqual([1, 2, 3, 4])
  })
})
