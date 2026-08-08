import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeScenario } from '../helpers'
import {
  createTimeoutScheduler,
  INTERVAL_MS,
  SimulationSession,
} from '../../src/application/session'
import { createApp } from '../../src/ui/appInstance'
import { FakeScheduler } from '../helpers'
import { buildScenario } from '../../src/application/scenarioFactory'
import { createDefaultCatalog } from '../../src/domain/catalog/operations'
import { createDefaultTemplateRegistry } from '../../src/domain/template/templates'
import { FixtureScenarioProvider } from '../../src/providers/fixtureScenarioProvider'
import { DSL_VERSION } from '../../src/domain/dsl/ast'
import { instantiateTemplate } from '../../src/domain/template/instantiate'
import { STANDARD_EMPLOYEES } from '../../src/domain/fixtures/employees'

describe('P2 Application', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('P2-A01: 操作切替でtimer停止・新revision・history 1件・cursor 0・READY・初期snapshot ID更新', () => {
    const session = new SimulationSession(
      makeScenario('tmpl-map', 'standard'),
      createTimeoutScheduler(),
    )
    const rev1 = session.getState().scenario.revision
    session.play()
    vi.advanceTimersByTime(INTERVAL_MS * 2)
    expect(session.getState().cursor).toBe(2)

    // 別操作（flatMap）へ切替
    const next = makeScenario('tmpl-flatmap', 'standard')
    session.switchScenario(next)
    const state = session.getState()
    expect(state.scenario.revision).not.toBe(rev1)
    expect(state.historyLength).toBe(1)
    expect(state.cursor).toBe(0)
    expect(state.playbackState).toBe('READY')
    expect(state.snapshot.snapshotId).toBe(`${state.scenario.revision}#0`)
    // timer停止済み
    vi.advanceTimersByTime(INTERVAL_MS * 3)
    expect(session.getState().cursor).toBe(0)
  })

  it('P2-A02: 同一操作内の別template（固定sample）へ切替え、fixture/AI表示を混同しない', () => {
    const scheduler = new FakeScheduler()
    const app = createApp({ scheduler })
    // Arrays.stream操作は2つのtemplateを持つ
    app.selectScenario('tmpl-src-arrays-object', 'standard')
    const first = app.session.getState().scenario
    expect(first.pipeline.templateId).toBe('tmpl-src-arrays-object')
    app.selectScenario('tmpl-src-arrays-int', 'standard')
    const second = app.session.getState().scenario
    expect(second.pipeline.templateId).toBe('tmpl-src-arrays-int')
    expect(second.targetOperationId).toBe(first.targetOperationId)
    expect(second.revision).not.toBe(first.revision)
    // どちらも固定サンプル（FIXTURE）でありAI生成とは表示しない
    expect(first.provenance.providerKind).toBe('FIXTURE')
    expect(second.provenance.providerKind).toBe('FIXTURE')
    expect(app.aiCapability.available).toBe(false)
  })

  it('P2-A03: supportedModesだけを選択でき、同じmodeへ戻ってもrevisionを再利用しない', () => {
    const scheduler = new FakeScheduler()
    const app = createApp({ scheduler })
    app.selectScenario('tmpl-flatmap', 'standard')
    const rev1 = app.session.getState().scenario.revision
    app.selectScenario('tmpl-flatmap', 'midEmpty')
    const rev2 = app.session.getState().scenario.revision
    app.selectScenario('tmpl-flatmap', 'standard')
    const rev3 = app.session.getState().scenario.revision
    expect(new Set([rev1, rev2, rev3]).size).toBe(3)

    // supportedModes外は検証エラーになり実行セッションへ入らない
    expect(() => app.selectScenario('tmpl-map', 'midEmpty')).toThrow()
    // 失敗後も現在のscenarioは維持される
    expect(app.session.getState().scenario.revision).toBe(rev3)
  })

  it('P2-A04: flatMapの親子位置を含むsnapshotを戻る/再進行で完全復元し、再計算しない', () => {
    const session = new SimulationSession(
      makeScenario('tmpl-flatmap', 'standard'),
      createTimeoutScheduler(),
    )
    // CHILD_EMITTED（index 4）まで進める
    for (let i = 0; i < 4; i++) session.stepForward()
    const childSnapshot = session.getState().snapshot
    expect(childSnapshot.kind).toBe('CHILD_EMITTED')
    expect(childSnapshot.parentElementId).toBe('nested-001')
    expect(childSnapshot.currentElementId).toBe('nested-001-c1')

    session.stepForward()
    session.stepForward()
    session.stepBack()
    session.stepBack()
    const restored = session.getState().snapshot
    // 保存済みsnapshotの再利用（同一オブジェクト）
    expect(restored).toBe(childSnapshot)
    expect(restored.flatMapContext?.parentElementId).toBe('nested-001')
    expect(restored.flatMapContext?.emittedCount).toBe(1)
    // 再進行も既存historyを再利用
    session.stepForward()
    const forward = session.getState().snapshot
    expect(forward.kind).toBe('SINK_APPENDED')
  })

  it('P2-A05: 手動途中から1000msごとに1snapshotだけ進み、完了/切替で停止する', () => {
    const session = new SimulationSession(
      makeScenario('tmpl-maptoint', 'standard'),
      createTimeoutScheduler(),
    )
    const total = session.getState().scenario.pipeline.snapshotCount
    for (let i = 0; i < 3; i++) session.stepForward()
    session.play()
    vi.advanceTimersByTime(INTERVAL_MS)
    expect(session.getState().cursor).toBe(4)
    vi.advanceTimersByTime(INTERVAL_MS * (total + 5))
    expect(session.getState().cursor).toBe(total - 1)
    expect(session.getState().playbackState).toBe('COMPLETED')

    // 再生中の切替でも停止する
    const session2 = new SimulationSession(
      makeScenario('tmpl-map', 'standard'),
      createTimeoutScheduler(),
    )
    session2.play()
    vi.advanceTimersByTime(INTERVAL_MS)
    session2.switchScenario(makeScenario('tmpl-boxed', 'standard'))
    vi.advanceTimersByTime(INTERVAL_MS * 3)
    expect(session2.getState().cursor).toBe(0)
    expect(session2.getState().playbackState).toBe('READY')
  })

  it('P2-A06: 無限source・型不一致・許可外DSLを実行セッションへ入れず、理由を保持する', () => {
    const catalog = createDefaultCatalog()
    const registry = createDefaultTemplateRegistry()
    const provider = new FixtureScenarioProvider()

    // 無限source（generate）: 候補は生成できるが検証で拒否され、Scenarioにならない
    const generateCandidate = provider.generate({
      targetOperationId: 'source.generate',
      mode: 'standard',
      allowedTemplateIds: ['tmpl-src-generate'],
      templateId: 'tmpl-src-generate',
      dslVersion: DSL_VERSION,
      currentScenarioRevision: null,
    })
    const generateResult = buildScenario(registry, catalog, generateCandidate)
    expect(generateResult.ok).toBe(false)
    if (!generateResult.ok) {
      expect(generateResult.issues[0]?.code).toBe('UNBOUNDED_SOURCE')
      expect(generateResult.issues[0]?.message).toContain('limit()')
    }

    // 型不一致（mapToIntへnameフィールド）
    const typeResult = instantiateTemplate(registry, catalog, {
      templateId: 'tmpl-maptoint',
      templateVersion: 1,
      dataset: STANDARD_EMPLOYEES,
      dslParameters: {
        'slot-mapper-1': { kind: 'fieldToPrimitive', field: 'name', primitive: 'int' },
      },
      mode: 'standard',
      revision: 'test-a06-type',
    })
    expect(typeResult.ok).toBe(false)
    if (!typeResult.ok) expect(typeResult.issues[0]?.code).toBe('TYPE_MISMATCH')

    // 許可外DSL（mapスロットへlistStream）
    const whitelistResult = instantiateTemplate(registry, catalog, {
      templateId: 'tmpl-map',
      templateVersion: 1,
      dataset: STANDARD_EMPLOYEES,
      dslParameters: { 'slot-mapper-1': { kind: 'listStream' } },
      mode: 'standard',
      revision: 'test-a06-whitelist',
    })
    expect(whitelistResult.ok).toBe(false)
    if (!whitelistResult.ok) expect(whitelistResult.issues[0]?.code).toBe('WHITELIST_KIND')
  })
})
