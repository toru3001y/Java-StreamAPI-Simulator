import { describe, expect, it } from 'vitest'
import { SimulationSession } from '../../src/application/session'
import { FakeScheduler, makeScenario } from '../helpers'
import type { Snapshot } from '../../src/domain/engine/snapshot'

/** P4-A01〜P4-A07: Application（履歴・再生・terminal状態）テスト（Phase 4指示 §13） */

function forwardUntil(session: SimulationSession, predicate: (s: Snapshot) => boolean, max = 200): void {
  for (let i = 0; i < max; i++) {
    if (predicate(session.getState().snapshot)) return
    session.stepForward()
  }
  throw new Error('forwardUntil: 条件に到達しません')
}

describe('P4-A01 Phase 4 scenarioの初期化', () => {
  it('P4-A01: 終端templateのscenarioがhistory 1件・cursor 0・READYで初期化される', () => {
    const session = new SimulationSession(makeScenario('tmpl-reduce-salary'), new FakeScheduler())
    const state = session.getState()
    expect(state.historyLength).toBe(1)
    expect(state.cursor).toBe(0)
    expect(state.playbackState).toBe('READY')
    expect(state.snapshot.kind).toBe('INITIAL')
    // 初期snapshotからterminal contextとresult viewが参照できる
    expect(state.snapshot.operationContexts['node-sink']?.kind).toBe('reduce')
    expect(state.snapshot.output.result.kind).toBe('SCALAR')
  })
})

describe('P4-A02 進む / 戻るのterminal状態復元', () => {
  it('P4-A02: accumulator・候補・履歴を戻る / 進むで完全復元する', () => {
    const session = new SimulationSession(makeScenario('tmpl-reduce-int'), new FakeScheduler())
    forwardUntil(session, (s) => {
      const ctx = s.operationContexts['node-sink']
      return ctx?.kind === 'reduce' && ctx.stepCount === 2
    })
    const at2 = session.getState().snapshot
    session.stepBack()
    session.stepBack()
    const before = session.getState().snapshot
    const beforeCtx = before.operationContexts['node-sink']
    if (beforeCtx?.kind === 'reduce') {
      expect(beforeCtx.stepCount).toBeLessThan(2)
    }
    session.stepForward()
    session.stepForward()
    // 保存済みsnapshotの再利用（同一オブジェクト）
    expect(session.getState().snapshot).toBe(at2)
  })
})

describe('P4-A03 既存historyの再利用', () => {
  it('P4-A03: 戻った後の進むで再計算せず既存historyを辿る', () => {
    const session = new SimulationSession(makeScenario('tmpl-min-age'), new FakeScheduler())
    const seen: Snapshot[] = [session.getState().snapshot]
    for (let i = 0; i < 6; i++) {
      session.stepForward()
      seen.push(session.getState().snapshot)
    }
    for (let i = 0; i < 6; i++) session.stepBack()
    for (let i = 1; i <= 6; i++) {
      session.stepForward()
      expect(session.getState().snapshot).toBe(seen[i])
    }
  })
})

describe('P4-A04 自動再生の開始位置', () => {
  it('P4-A04: 自動は現在位置の次から1 tickごとに1件進む', () => {
    const scheduler = new FakeScheduler()
    const session = new SimulationSession(makeScenario('tmpl-count'), scheduler)
    session.stepForward()
    session.stepForward()
    const startCursor = session.getState().cursor
    session.play()
    scheduler.flushOne()
    expect(session.getState().cursor).toBe(startCursor + 1)
    scheduler.flushOne()
    expect(session.getState().cursor).toBe(startCursor + 2)
    session.stop()
    expect(scheduler.pending.size).toBe(0)
  })
})

describe('P4-A05 短絡完了時の自動停止', () => {
  it('P4-A05: 内部短絡を含むtimelineを最後まで進み、COMPLETEDで自動停止する', () => {
    const scheduler = new FakeScheduler()
    const session = new SimulationSession(makeScenario('tmpl-anymatch'), scheduler)
    session.play()
    let ticks = 0
    while (session.getState().playbackState === 'PLAYING' && ticks < 100) {
      scheduler.flushOne()
      ticks += 1
    }
    const state = session.getState()
    expect(state.playbackState).toBe('COMPLETED')
    expect(state.snapshot.kind).toBe('STREAM_CONSUMED')
    expect(state.snapshot.output.result).toMatchObject({ valueLabel: 'true' })
    expect(scheduler.pending.size).toBe(0)
  })
})

describe('P4-A06 結果の不変性', () => {
  it('P4-A06: Optional・statistics・array・void結果をsessionが変更しない', () => {
    for (const templateId of ['tmpl-min-age', 'tmpl-stats-int', 'tmpl-toarray-int', 'tmpl-foreach']) {
      const session = new SimulationSession(makeScenario(templateId), new FakeScheduler())
      forwardUntil(session, (s) => s.kind === 'STREAM_CONSUMED')
      const result = session.getState().snapshot.output.result
      expect(Object.isFrozen(result), templateId).toBe(true)
      // 再生操作（restart → 進む）後も同一の確定resultが得られる
      const serialized = JSON.stringify(result)
      session.restart()
      forwardUntil(session, (s) => s.kind === 'STREAM_CONSUMED')
      expect(JSON.stringify(session.getState().snapshot.output.result), templateId).toBe(serialized)
    }
  })
})

describe('P4-A07 scenario切替の初期化', () => {
  it('P4-A07: 切替時にterminal固有状態とタイマーを初期化する', () => {
    const scheduler = new FakeScheduler()
    const session = new SimulationSession(makeScenario('tmpl-reduce-int'), scheduler)
    forwardUntil(session, (s) => {
      const ctx = s.operationContexts['node-sink']
      return ctx?.kind === 'reduce' && ctx.stepCount >= 1
    })
    session.play()
    expect(scheduler.pending.size).toBe(1)
    const before = session.getState().scenario.revision
    session.switchScenario(makeScenario('tmpl-stats-int'))
    const state = session.getState()
    expect(scheduler.pending.size).toBe(0)
    expect(state.scenario.revision).not.toBe(before)
    expect(state.historyLength).toBe(1)
    expect(state.cursor).toBe(0)
    expect(state.playbackState).toBe('READY')
    // 新しいterminalの初期状態（aggregate 0件）が表示される
    const ctx = state.snapshot.operationContexts['node-sink']
    expect(ctx?.kind).toBe('aggregate')
    if (ctx?.kind === 'aggregate') expect(ctx.count).toBe(0)
  })
})
