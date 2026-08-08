import { describe, expect, it } from 'vitest'
import { SimulationSession } from '../../src/application/session'
import { buildScenario } from '../../src/application/scenarioFactory'
import { createDefaultCatalog } from '../../src/domain/catalog/operations'
import { createDefaultTemplateRegistry } from '../../src/domain/template/templates'
import { FixtureScenarioProvider } from '../../src/providers/fixtureScenarioProvider'
import { DSL_VERSION } from '../../src/domain/dsl/ast'
import type { ScenarioCandidate } from '../../src/providers/scenarioProvider'
import { FakeScheduler, makeScenario } from '../helpers'
import type { Snapshot } from '../../src/domain/engine/snapshot'

/** P3-A01〜P3-A07: Application（履歴・再生・検証境界）テスト（Phase 3指示 §13.2） */

function candidate(overrides: Partial<ScenarioCandidate>): ScenarioCandidate {
  return {
    providerKind: 'FIXTURE',
    templateId: 'tmpl-limit',
    templateVersion: 1,
    mode: 'standard',
    dataset: [],
    dslParameters: {},
    title: 't',
    description: 'd',
    provenance: { providerKind: 'FIXTURE', generatedAt: '2026-08-08T00:00:00+09:00', dslVersion: DSL_VERSION },
    revision: 'p3-app-test:r1',
    ...overrides,
  }
}

function forwardUntil(session: SimulationSession, predicate: (s: Snapshot) => boolean, max = 200): void {
  for (let i = 0; i < max; i++) {
    if (predicate(session.getState().snapshot)) return
    session.stepForward()
  }
  throw new Error('forwardUntil: 条件に到達しません')
}

describe('P3-A01 操作 / template切替', () => {
  it('P3-A01: 切替でtimer停止・新revision・history 1件・cursor 0・READY', () => {
    const scheduler = new FakeScheduler()
    const session = new SimulationSession(makeScenario('tmpl-sorted-natural'), scheduler)
    session.stepForward()
    session.stepForward()
    session.play()
    expect(session.getState().playbackState).toBe('PLAYING')
    expect(scheduler.pending.size).toBe(1)
    const before = session.getState().scenario.revision
    session.switchScenario(makeScenario('tmpl-distinct'))
    const state = session.getState()
    expect(scheduler.pending.size).toBe(0)
    expect(state.scenario.revision).not.toBe(before)
    expect(state.historyLength).toBe(1)
    expect(state.cursor).toBe(0)
    expect(state.playbackState).toBe('READY')
    expect(state.snapshot.kind).toBe('INITIAL')
  })
})

describe('P3-A02 mode切替', () => {
  it('P3-A02: supportedModesだけ選択可能で、同じmodeへ戻ってもrevisionを再利用しない', () => {
    const registry = createDefaultTemplateRegistry()
    const catalog = createDefaultCatalog()
    // supportedModes外は拒否される（generate + limitはstandardのみ）
    const unsupported = buildScenario(
      registry,
      catalog,
      candidate({
        templateId: 'tmpl-limit-generate',
        mode: 'midEmpty',
        dslParameters: {
          'slot-source': { kind: 'generate', ruleId: 'supplier-counter' },
          'slot-count': 3,
        },
      }),
    )
    expect(unsupported.ok).toBe(false)
    if (!unsupported.ok) expect(unsupported.issues[0]?.code).toBe('TEMPLATE_MODE_UNSUPPORTED')
    // 同じmodeへ戻ってもproviderは新しいrevisionを発行する
    const provider = new FixtureScenarioProvider()
    const request = {
      targetOperationId: 'takeWhile',
      mode: 'standard' as const,
      allowedTemplateIds: ['tmpl-takewhile'],
      templateId: 'tmpl-takewhile',
      dslVersion: DSL_VERSION,
      currentScenarioRevision: null as string | null,
    }
    const first = provider.generate(request)
    const second = provider.generate({ ...request, currentScenarioRevision: first.revision })
    expect(second.revision).not.toBe(first.revision)
  })
})

describe('P3-A03 sorted履歴', () => {
  it('P3-A03: buffer・確定順・放出位置を戻る / 再進行で完全復元し再計算しない', () => {
    const scheduler = new FakeScheduler()
    const session = new SimulationSession(makeScenario('tmpl-sorted-comparator'), scheduler)
    // 2件目の放出（SORT_EMITTED）まで進める
    let emitted = 0
    forwardUntil(session, (s) => {
      if (s.kind === 'SORT_EMITTED') emitted += 1
      return emitted === 2 && s.kind === 'SORT_EMITTED'
    })
    const target = session.getState().snapshot
    const targetCursor = session.getState().cursor
    const ctx = target.operationContexts['node-sorted']
    expect(ctx?.kind).toBe('sorted')
    if (ctx?.kind === 'sorted') expect(ctx.emittedCount).toBe(2)
    // 戻る × 3 → 進む × 3 で保存済みsnapshotを再利用（同一オブジェクト）
    session.stepBack()
    session.stepBack()
    session.stepBack()
    const backCtx = session.getState().snapshot.operationContexts['node-sorted']
    expect(backCtx?.kind).toBe('sorted')
    session.stepForward()
    session.stepForward()
    session.stepForward()
    const restored = session.getState()
    expect(restored.cursor).toBe(targetCursor)
    // 履歴再利用: 再計算ではなく同一の保存済みsnapshotが返る
    expect(restored.snapshot).toBe(target)
  })
})

describe('P3-A04 short-circuit履歴', () => {
  it('P3-A04: limit / takeWhile境界と未評価範囲を完全復元する', () => {
    const scheduler = new FakeScheduler()
    const session = new SimulationSession(makeScenario('tmpl-takewhile'), scheduler)
    forwardUntil(session, (s) => s.kind === 'SHORT_CIRCUIT_CONFIRMED')
    const scSnapshot = session.getState().snapshot
    const scCursor = session.getState().cursor
    const ctx = scSnapshot.operationContexts['node-takewhile']
    if (ctx?.kind === 'takeWhile') {
      expect(ctx.stopped).toBe(true)
      expect(ctx.boundaryLabel).toBe('6')
    }
    expect(scSnapshot.elementLatestStates['numbers-004']).toBe('UNEVALUATED')
    // 最初まで戻って再進行しても同じ位置で同じsnapshotが復元される
    while (session.getState().cursor > 0) session.stepBack()
    const initialCtx = session.getState().snapshot.operationContexts['node-takewhile']
    if (initialCtx?.kind === 'takeWhile') expect(initialCtx.stopped).toBe(false)
    for (let i = 0; i < scCursor; i++) session.stepForward()
    expect(session.getState().snapshot).toBe(scSnapshot)
  })
})

describe('P3-A05 peek履歴', () => {
  it('P3-A05: 戻るとSide Effectが減り、再進行で同一entryを復元し再実行しない', () => {
    const scheduler = new FakeScheduler()
    const session = new SimulationSession(makeScenario('tmpl-peek'), scheduler)
    forwardUntil(session, (s) => s.sideEffects.length === 2)
    const withTwo = session.getState().snapshot
    expect(withTwo.sideEffects.map((e) => e.message)).toEqual(['佐藤', '鈴木'])
    // 戻ると履歴が減る
    session.stepBack()
    expect(session.getState().snapshot.sideEffects.length).toBeLessThan(2)
    // 再進行で同一entry（同一の保存済みsnapshot）が復元される。実actionは再実行されない
    session.stepForward()
    const restored = session.getState().snapshot
    expect(restored).toBe(withTwo)
    expect(restored.sideEffects[1]).toBe(withTwo.sideEffects[1])
  })
})

describe('P3-A06 自動・停止', () => {
  it('P3-A06: 手動途中から1 tickごとに1 snapshot進み、内部短絡後も結果確定まで進んで停止する', () => {
    const scheduler = new FakeScheduler()
    const session = new SimulationSession(makeScenario('tmpl-takewhile'), scheduler)
    session.stepForward()
    session.stepForward()
    const startCursor = session.getState().cursor
    session.play()
    let ticks = 0
    while (session.getState().playbackState === 'PLAYING' && ticks < 100) {
      const before = session.getState().cursor
      scheduler.flushOne()
      ticks += 1
      const after = session.getState().cursor
      // 1 tickで進むsnapshotは1件だけ
      expect(after - before).toBeLessThanOrEqual(1)
    }
    const state = session.getState()
    expect(state.playbackState).toBe('COMPLETED')
    expect(state.snapshot.completion).toBe('STREAM_CONSUMED')
    // 各tickで1件ずつ進んだ合計と一致する
    expect(state.cursor).toBe(startCursor + ticks)
    // 短絡（SHORT_CIRCUIT_CONFIRMED）を含むtimelineを最後まで進み切っている
    expect(state.snapshot.kind).toBe('STREAM_CONSUMED')
    expect(scheduler.pending.size).toBe(0)
  })
})

describe('P3-A07 検証エラー', () => {
  it('P3-A07: unsafe無限Pipeline・DSL不正をSessionへ入れず理由を保持する', () => {
    const registry = createDefaultTemplateRegistry()
    const catalog = createDefaultCatalog()
    // 有限化limitなしの無限source
    const unbounded = buildScenario(
      registry,
      catalog,
      candidate({
        templateId: 'tmpl-src-generate',
        mode: 'standard',
        dslParameters: { 'slot-source': { kind: 'generate', ruleId: 'supplier-counter' } },
      }),
    )
    expect(unbounded.ok).toBe(false)
    if (!unbounded.ok) {
      expect(unbounded.issues[0]?.code).toBe('UNBOUNDED_SOURCE')
      expect(unbounded.issues[0]?.message).toContain('limit()')
    }
    // 許可外operator（takeWhileはLTのみ）
    const badOperator = buildScenario(
      registry,
      catalog,
      candidate({
        templateId: 'tmpl-takewhile',
        dslParameters: {
          'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [1, 6, 2] },
          'slot-predicate-1': { kind: 'currentValueCompare', operator: 'GTE', value: { type: 'int', value: 5 } },
        },
      }),
    )
    expect(badOperator.ok).toBe(false)
    if (!badOperator.ok) expect(badOperator.issues[0]?.code).toBe('WHITELIST_OPERATOR')
    // 負数limit
    const badCount = buildScenario(
      registry,
      catalog,
      candidate({
        templateId: 'tmpl-limit',
        dslParameters: { 'slot-source': { kind: 'rangeClosed', from: 1, to: 5 }, 'slot-count': -1 },
      }),
    )
    expect(badCount.ok).toBe(false)
    if (!badCount.ok) expect(badCount.issues[0]?.code).toBe('TYPE_MISMATCH')
    // 未知comparator field
    const badComparator = buildScenario(
      registry,
      catalog,
      candidate({
        templateId: 'tmpl-sorted-comparator',
        dslParameters: {
          'slot-comparator': { kind: 'employeeKeys', keys: [{ field: 'skills', direction: 'ASC' }] },
        },
      }),
    )
    expect(badComparator.ok).toBe(false)
    if (!badComparator.ok) expect(badComparator.issues.length).toBeGreaterThan(0)
  })
})
