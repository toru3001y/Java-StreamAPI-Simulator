import { describe, expect, it } from 'vitest'
import { makeScenario, FakeScheduler } from '../helpers'
import { SimulationSession, SNAPSHOT_LIMIT } from '../../src/application/session'

describe('P1-D14 安全上限', () => {
  it('P1-D14: 安全上限の既定値は初期snapshotを含む500件である', () => {
    expect(SNAPSHOT_LIMIT).toBe(500)
  })

  it('P1-D14: 上限到達時は新しいsnapshotを作らず、最終件を保持してLIMIT_REACHEDになる', () => {
    // Phase 1のfixtureは事前検証で500件以内が保証されるため、
    // 上限メカニズム自体は注入した小さい上限で検証する（既定値は上のテストで確認）
    const scenario = makeScenario('tmpl-filter-basic', 'standard')
    const session = new SimulationSession(scenario, new FakeScheduler(), 5)
    for (let i = 0; i < 4; i++) session.stepForward()
    expect(session.getState().historyLength).toBe(5)
    expect(session.getState().cursor).toBe(4)

    // 6件目（501件目相当）は作成されない
    session.stepForward()
    const state = session.getState()
    expect(state.historyLength).toBe(5)
    expect(state.cursor).toBe(4)
    expect(state.playbackState).toBe('LIMIT_REACHED')
    expect(state.stopReason).toContain('安全上限')
  })

  it('P1-D14: LIMIT_REACHED後も戻る操作で保存済みsnapshotを閲覧できる', () => {
    const scenario = makeScenario('tmpl-filter-basic', 'standard')
    const session = new SimulationSession(scenario, new FakeScheduler(), 5)
    for (let i = 0; i < 5; i++) session.stepForward()
    expect(session.getState().playbackState).toBe('LIMIT_REACHED')
    session.stepBack()
    expect(session.getState().cursor).toBe(3)
    expect(session.getState().playbackState).toBe('PAUSED')
  })

  it('P1-D14: 事前検証済みfixtureのsnapshot件数は全モードで500以内', () => {
    for (const [templateId, mode] of [
      ['tmpl-filter-basic', 'standard'],
      ['tmpl-filter-basic', 'midEmpty'],
      ['tmpl-filter-basic', 'emptySource'],
      ['tmpl-filter-chain', 'standard'],
    ] as const) {
      const scenario = makeScenario(templateId, mode)
      expect(scenario.pipeline.snapshotCount).toBeLessThanOrEqual(500)
    }
  })
})
