import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeScenario } from '../helpers'
import {
  createTimeoutScheduler,
  INTERVAL_MS,
  SimulationSession,
} from '../../src/application/session'
import { FixtureScenarioProvider } from '../../src/providers/fixtureScenarioProvider'
import { buildScenario } from '../../src/application/scenarioFactory'
import { createDefaultCatalog, OP_FILTER } from '../../src/domain/catalog/operations'
import { createDefaultTemplateRegistry } from '../../src/domain/template/templates'
import { DSL_VERSION } from '../../src/domain/dsl/ast'
import type { ScenarioMode } from '../../src/domain/scenario/scenario'

/**
 * 履歴・Applicationテスト（§23.2）。
 * timer関連はfake timerで1000ms、停止、再開、追い越しなしを決定的に検証する。
 */
describe('履歴・再生制御', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const newSession = () =>
    new SimulationSession(makeScenario('tmpl-filter-basic', 'standard'), createTimeoutScheduler())

  it('P1-A01: 進む → 戻るでsnapshotが完全一致する', () => {
    const session = newSession()
    session.stepForward()
    const first = session.getState().snapshot
    session.stepForward()
    session.stepBack()
    const restored = session.getState().snapshot
    // 保存済みsnapshotの再利用（同一オブジェクト）かつ構造完全一致
    expect(restored).toBe(first)
    expect(JSON.parse(JSON.stringify(restored))).toEqual(JSON.parse(JSON.stringify(first)))
  })

  it('P1-A02: 戻った後の進むは既存historyを再利用する（再計算しない）', () => {
    const session = newSession()
    for (let i = 0; i < 5; i++) session.stepForward()
    const snapshotAt5 = session.getState().snapshot
    const historyLength = session.getState().historyLength
    session.stepBack()
    session.stepBack()
    session.stepForward()
    session.stepForward()
    expect(session.getState().snapshot).toBe(snapshotAt5)
    expect(session.getState().historyLength).toBe(historyLength)
  })

  it('P1-A03: 最初からはscenario / revisionを維持してcursor 0へ戻る', () => {
    const session = newSession()
    const revision = session.getState().scenario.revision
    for (let i = 0; i < 3; i++) session.stepForward()
    session.restart()
    const state = session.getState()
    expect(state.cursor).toBe(0)
    expect(state.scenario.revision).toBe(revision)
    expect(state.playbackState).toBe('READY')
    expect(state.snapshot.kind).toBe('INITIAL')
  })

  it('P1-A04: 自動は現在位置の次から1000msごとに1件進む', () => {
    const session = newSession()
    session.stepForward()
    session.stepForward()
    expect(session.getState().cursor).toBe(2)
    session.play()
    expect(session.getState().playbackState).toBe('PLAYING')
    expect(session.getState().cursor).toBe(2)
    vi.advanceTimersByTime(INTERVAL_MS)
    expect(session.getState().cursor).toBe(3)
    vi.advanceTimersByTime(INTERVAL_MS)
    expect(session.getState().cursor).toBe(4)
  })

  it('P1-A04: 完了時に自動再生が停止しCOMPLETEDになる', () => {
    const session = newSession()
    const total = session.getState().scenario.pipeline.snapshotCount
    session.play()
    vi.advanceTimersByTime(INTERVAL_MS * (total + 5))
    const state = session.getState()
    expect(state.cursor).toBe(total - 1)
    expect(state.playbackState).toBe('COMPLETED')
    expect(state.snapshot.completion).toBe('STREAM_CONSUMED')
    // 完了後は時間が経過しても進まない
    vi.advanceTimersByTime(INTERVAL_MS * 3)
    expect(session.getState().cursor).toBe(total - 1)
  })

  it('P1-A05: 停止は最終確定snapshotを保持し、再開は現在snapshotの次から続ける', () => {
    const session = newSession()
    session.play()
    vi.advanceTimersByTime(INTERVAL_MS * 3)
    expect(session.getState().cursor).toBe(3)
    session.stop()
    expect(session.getState().playbackState).toBe('PAUSED')
    expect(session.getState().cursor).toBe(3)
    // 停止中は時間が経過しても進まない（タイマー解除）
    vi.advanceTimersByTime(INTERVAL_MS * 5)
    expect(session.getState().cursor).toBe(3)
    // 再開
    session.play()
    vi.advanceTimersByTime(INTERVAL_MS)
    expect(session.getState().cursor).toBe(4)
  })

  it('P1-A06: timer遅延時も複数snapshotをまとめて追い越し実行しない', () => {
    const session = newSession()
    session.play()
    // 期限前は進まない
    vi.advanceTimersByTime(INTERVAL_MS - 1)
    expect(session.getState().cursor).toBe(0)
    // 遅延したtickの一括flushでも、実行されるのは保留中の1 tick = 1 snapshotだけ
    vi.runOnlyPendingTimers()
    expect(session.getState().cursor).toBe(1)
    vi.runOnlyPendingTimers()
    expect(session.getState().cursor).toBe(2)
  })

  it('P1-A07: scenario切替でtimer停止・新revision・history初期化', () => {
    const session = newSession()
    const oldRevision = session.getState().scenario.revision
    session.play()
    vi.advanceTimersByTime(INTERVAL_MS * 2)
    expect(session.getState().cursor).toBe(2)

    session.switchScenario(makeScenario('tmpl-filter-basic', 'midEmpty'))
    const state = session.getState()
    expect(state.scenario.revision).not.toBe(oldRevision)
    expect(state.cursor).toBe(0)
    expect(state.historyLength).toBe(1)
    expect(state.playbackState).toBe('READY')
    // 切替後、旧タイマーは解除済みで自動進行しない
    vi.advanceTimersByTime(INTERVAL_MS * 3)
    expect(session.getState().cursor).toBe(0)
  })

  it('P1-A07: 連続切替でrevisionが毎回新しく発行され、history初期化とタイマー停止が行われる', () => {
    // 同一providerを共有し、§10.2どおり現在のrevisionを渡して切替える（実UIと同じ経路）
    const catalog = createDefaultCatalog()
    const registry = createDefaultTemplateRegistry()
    const provider = new FixtureScenarioProvider()
    const generateScenario = (mode: ScenarioMode, currentScenarioRevision: string | null) => {
      const candidate = provider.generate({
        targetOperationId: OP_FILTER,
        mode,
        allowedTemplateIds: ['tmpl-filter-basic', 'tmpl-filter-chain'],
        templateId: 'tmpl-filter-basic',
        dslVersion: DSL_VERSION,
        currentScenarioRevision,
      })
      const result = buildScenario(registry, catalog, candidate)
      if (!result.ok) throw new Error(result.issues.map((i) => i.message).join(' / '))
      return result.value
    }

    const session = new SimulationSession(generateScenario('standard', null), createTimeoutScheduler())
    const rev1 = session.getState().scenario.revision

    // 自動再生中に切替え、タイマーが停止することを確認する
    session.play()
    vi.advanceTimersByTime(INTERVAL_MS * 2)
    expect(session.getState().cursor).toBe(2)

    session.switchScenario(generateScenario('midEmpty', rev1))
    const stateAfterSwitch = session.getState()
    const rev2 = stateAfterSwitch.scenario.revision
    // 切替後はhistoryLength=1、cursor=0、READY
    expect(stateAfterSwitch.historyLength).toBe(1)
    expect(stateAfterSwitch.cursor).toBe(0)
    expect(stateAfterSwitch.playbackState).toBe('READY')
    // 初期snapshot IDに新revisionが反映される
    expect(stateAfterSwitch.snapshot.snapshotId).toBe(`${rev2}#0`)
    expect(stateAfterSwitch.snapshot.revision).toBe(rev2)
    // 切替時に自動再生タイマーが停止する
    vi.advanceTimersByTime(INTERVAL_MS * 3)
    expect(session.getState().cursor).toBe(0)

    // 標準 → 途中0件 → 標準と戻しても、最初の標準のrevisionを再利用しない
    session.switchScenario(generateScenario('standard', rev2))
    const rev3 = session.getState().scenario.revision
    expect(rev2).not.toBe(rev1)
    expect(rev3).not.toBe(rev1)
    expect(rev3).not.toBe(rev2)
    expect(session.getState().snapshot.snapshotId).toBe(`${rev3}#0`)
    expect(session.getState().historyLength).toBe(1)
    expect(session.getState().cursor).toBe(0)
    expect(session.getState().playbackState).toBe('READY')
  })

  // P1-A08（AI利用不能理由とUI状態の一致）はPhase 6で廃止した。
  // 「利用者へ示す理由とUI状態の一致」という目的はP6-A02が継承する
  // （v0.10 §1.3、Phase 6指示 §12冒頭）。

  it('J-3: エンジン不整合検知時はERRORへ遷移しタイマー解除・history保持', () => {
    const scenario = makeScenario('tmpl-filter-basic', 'standard')
    const broken = {
      ...scenario,
      pipeline: {
        ...scenario.pipeline,
        nodes: scenario.pipeline.nodes.map((n) =>
          n.role === 'intermediate' ? { ...n, predicate: null } : n,
        ),
      },
    }
    const session = new SimulationSession(broken, createTimeoutScheduler())
    session.play()
    vi.advanceTimersByTime(INTERVAL_MS * 10)
    const state = session.getState()
    expect(state.playbackState).toBe('ERROR')
    expect(state.stopReason).toContain('不整合')
    // 最後の確定snapshot（初期snapshot）とhistoryを保持している
    expect(state.historyLength).toBeGreaterThanOrEqual(1)
    expect(state.cursor).toBe(state.historyLength - 1)
    expect(state.snapshot.kind).toBe('INITIAL')
    // ERROR中は進む・自動を受け付けない
    session.stepForward()
    expect(session.getState().cursor).toBe(state.cursor)
    session.play()
    vi.advanceTimersByTime(INTERVAL_MS * 3)
    expect(session.getState().cursor).toBe(state.cursor)
    // 最初からで復帰できる
    session.restart()
    expect(session.getState().playbackState).toBe('READY')
  })
})
