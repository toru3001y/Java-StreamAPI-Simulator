import { describe, expect, it } from 'vitest'
import { SimulationSession } from '../../src/application/session'
import type { Snapshot } from '../../src/domain/engine/snapshot'
import { createDefaultCatalog } from '../../src/domain/catalog/operations'
import { createDefaultTemplateRegistry } from '../../src/domain/template/templates'
import { instantiateTemplate } from '../../src/domain/template/instantiate'
import { createApp } from '../../src/ui/appInstance'
import { FakeScheduler, makeScenario } from '../helpers'
import { STANDARD_EMPLOYEES } from '../../src/domain/fixtures/employees'
import { collectorContextOf, findTeeingView } from '../p5-helpers'

/** P5-A01〜P5-A05: Application（Collector教材の履歴・再生・検証エラー）テスト（Phase 5指示 §12.2） */

function forwardUntil(
  session: SimulationSession,
  predicate: (s: Snapshot) => boolean,
  max = 300,
): void {
  for (let i = 0; i < max; i++) {
    if (predicate(session.getState().snapshot)) return
    session.stepForward()
  }
  throw new Error('forwardUntil: 条件に到達しません')
}

describe('P5-A01 Collector操作の切替', () => {
  it('P5-A01: Collector教材へ切替えるとtimer停止・新revision・history 1件・cursor 0・READYになる', () => {
    const scheduler = new FakeScheduler()
    const session = new SimulationSession(makeScenario('tmpl-collect-groupingby-counting'), scheduler)
    session.stepForward()
    session.play()
    expect(session.getState().playbackState).toBe('PLAYING')
    expect(scheduler.pending.size).toBe(1)

    const before = session.getState().scenario.revision
    session.switchScenario(makeScenario('tmpl-collect-teeing'))
    const state = session.getState()
    // timerが解除される
    expect(scheduler.pending.size).toBe(0)
    expect(state.playbackState).toBe('READY')
    expect(state.historyLength).toBe(1)
    expect(state.cursor).toBe(0)
    expect(state.snapshot.kind).toBe('INITIAL')
    expect(state.scenario.revision).not.toBe(before)
    expect(state.stopReason).toBeNull()
    // 初期snapshotからCollector contextとresult viewが参照できる
    expect(collectorContextOf(state.snapshot).op).toBe('collect')
    expect(state.snapshot.output.result.kind).toBe('RECORD')
  })
})

describe('P5-A02 template / mode切替', () => {
  it('P5-A02: supportedModesだけ選択でき、同じmodeへ戻ってもrevisionを再利用しない', () => {
    const registry = createDefaultTemplateRegistry()
    const template = registry.get('tmpl-collect-teeing', 1)
    expect(template?.supportedModes).toEqual(['standard', 'emptySource'])
    // midEmptyは提供しない（同名の専用templateが担当する）
    expect(template?.supportedModes).not.toContain('midEmpty')
    const midEmptyTemplate = registry.get('tmpl-collect-teeing-midempty', 1)
    expect(midEmptyTemplate?.supportedModes).toEqual(['midEmpty'])

    // 実際の切替経路（AppInstance.selectScenario）でrevisionが再利用されないことを確認する
    const app = createApp({ scheduler: new FakeScheduler() })
    app.selectScenario('tmpl-collect-groupingby', 'standard')
    const first = app.session.getState().scenario.revision
    app.selectScenario('tmpl-collect-groupingby', 'emptySource')
    const second = app.session.getState().scenario.revision
    app.selectScenario('tmpl-collect-groupingby', 'standard')
    const third = app.session.getState().scenario.revision
    // 同じtemplate / modeへ戻ってもrevisionは新規発行される
    expect(new Set([first, second, third]).size).toBe(3)
    expect(app.session.getState().historyLength).toBe(1)
    expect(app.session.getState().cursor).toBe(0)
  })

  it('P5-A02: サポート外modeのfixtureは提供されない（instantiateがTEMPLATE_MODE_UNSUPPORTEDで拒否する）', () => {
    const registry = createDefaultTemplateRegistry()
    const catalog = createDefaultCatalog()
    const result = instantiateTemplate(registry, catalog, {
      templateId: 'tmpl-collect-teeing',
      templateVersion: 1,
      dataset: STANDARD_EMPLOYEES,
      dslParameters: {
        'slot-collector': {
          kind: 'teeing',
          left: { kind: 'counting' },
          right: { kind: 'averagingLong', field: 'salary' },
          mergerId: 'SalarySummary::new',
        },
      },
      mode: 'midEmpty',
      revision: 'p5-a02:r1',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.code).toBe('TEMPLATE_MODE_UNSUPPORTED')
  })
})

describe('P5-A03 履歴復元', () => {
  it('P5-A03: bucket・蓄積・finisher・merger結果・Setの保持elementIdを戻る→進むで完全復元し、再計算しない（§10条件19）', () => {
    // groupingBy: bucket成長の途中状態を復元する
    const scheduler = new FakeScheduler()
    const session = new SimulationSession(
      makeScenario('tmpl-collect-groupingby-averaging'),
      scheduler,
    )
    forwardUntil(session, (s) => s.kind === 'BUCKET_SELECTED')
    forwardUntil(session, (s) => {
      const ctx = collectorContextOf(s)
      return ctx.root.buckets.length === 2
    })
    const at2Buckets = session.getState().snapshot
    const historyBefore = session.getState().historyLength
    session.stepBack()
    const back = session.getState().snapshot
    expect(collectorContextOf(back).root.buckets.length).toBeLessThanOrEqual(2)
    session.stepForward()
    const forward = session.getState().snapshot
    // 保存済みsnapshotをそのまま再利用する（再計算しないため同一インスタンス・同一ID）
    expect(forward).toBe(at2Buckets)
    expect(forward.snapshotId).toBe(at2Buckets.snapshotId)
    expect(session.getState().historyLength).toBe(historyBefore)

    // finisher / mergerの確定snapshotも完全復元される
    forwardUntil(session, (s) => s.kind === 'COLLECTOR_FINISHED')
    const finished = session.getState().snapshot
    const finishedJson = JSON.stringify(finished.operationContexts)
    session.stepBack()
    session.stepForward()
    expect(session.getState().snapshot).toBe(finished)
    expect(JSON.stringify(session.getState().snapshot.operationContexts)).toBe(finishedJson)

    // teeing mergerの左右結果も復元される
    const teeSession = new SimulationSession(makeScenario('tmpl-collect-teeing'), new FakeScheduler())
    forwardUntil(teeSession, (s) => s.kind === 'TEE_MERGER_APPLIED')
    const merger = teeSession.getState().snapshot
    const view = findTeeingView(collectorContextOf(merger).root)
    expect(view?.leftResultLabel).toBe('4')
    expect(view?.rightResultLabel).toBe('5425000.0')
    teeSession.stepBack()
    teeSession.stepForward()
    expect(teeSession.getState().snapshot).toBe(merger)

    // toSetの保持elementIdも復元される
    const setSession = new SimulationSession(makeScenario('tmpl-collect-toset'), new FakeScheduler())
    forwardUntil(setSession, (s) => {
      const acc = collectorContextOf(s).root.accumulation
      return acc.kind === 'ELEMENTS' && acc.changedByLast === false
    })
    const unchanged = setSession.getState().snapshot
    const ids = (() => {
      const acc = collectorContextOf(unchanged).root.accumulation
      return acc.kind === 'ELEMENTS' ? acc.items.map((i) => i.id) : []
    })()
    expect(ids).toContain('emp-001')
    setSession.stepBack()
    setSession.stepForward()
    expect(setSession.getState().snapshot).toBe(unchanged)
  })
})

describe('P5-A04 自動再生', () => {
  it('P5-A04: Collector教材でも1000msごとに1 snapshotだけ進み、merger / finisher snapshotを飛ばさない（§10条件21）', () => {
    const scheduler = new FakeScheduler()
    const session = new SimulationSession(makeScenario('tmpl-collect-teeing'), scheduler)
    session.play()
    const seen: string[] = [session.getState().snapshot.kind]
    let guard = 0
    while (session.getState().playbackState === 'PLAYING' && guard < 100) {
      const before = session.getState().cursor
      scheduler.flushOne()
      const after = session.getState().cursor
      // 1回のtickで1 snapshotだけ進む
      expect(after - before).toBeLessThanOrEqual(1)
      seen.push(session.getState().snapshot.kind)
      guard += 1
    }
    expect(session.getState().playbackState).toBe('COMPLETED')
    // finisher×2とmergerを飛ばさない
    expect(seen.filter((k) => k === 'TEE_BRANCH_FINISHED')).toHaveLength(2)
    expect(seen.filter((k) => k === 'TEE_MERGER_APPLIED')).toHaveLength(1)
    expect(seen.at(-1)).toBe('STREAM_CONSUMED')

    // collectingAndThenのfinisherも飛ばさない
    const scheduler2 = new FakeScheduler()
    const session2 = new SimulationSession(
      makeScenario('tmpl-collect-collectingandthen'),
      scheduler2,
    )
    session2.play()
    const kinds: string[] = []
    let guard2 = 0
    while (session2.getState().playbackState === 'PLAYING' && guard2 < 100) {
      scheduler2.flushOne()
      kinds.push(session2.getState().snapshot.kind)
      guard2 += 1
    }
    expect(kinds.filter((k) => k === 'COLLECTOR_FINISHED')).toHaveLength(1)
  })
})

describe('P5-A05 検証エラー', () => {
  it('P5-A05: 許可外Collector AST・型不一致・深すぎる入れ子を実行セッションへ入れず、理由を保持する', () => {
    const registry = createDefaultTemplateRegistry()
    const catalog = createDefaultCatalog()
    const run = (collector: unknown) =>
      instantiateTemplate(registry, catalog, {
        templateId: 'tmpl-collect-groupingby',
        templateVersion: 1,
        dataset: STANDARD_EMPLOYEES,
        dslParameters: { 'slot-collector': collector },
        mode: 'standard',
        revision: 'p5-a05:r1',
      })

    // slotの許可範囲外のcollector kind（このtemplateはgroupingByのみ許可）
    const outOfSlot = run({ kind: 'counting' })
    expect(outOfSlot.ok).toBe(false)
    if (!outOfSlot.ok) {
      expect(outOfSlot.issues.some((i) => i.code === 'WHITELIST_KIND')).toBe(true)
      expect(outOfSlot.issues[0]?.message).toContain('許可されていない')
    }

    // 型不一致（classifierのfieldがString以外）
    const typeMismatch = run({
      kind: 'groupingBy',
      classifier: { kind: 'employeeField', field: 'age' },
      mapFactoryId: null,
      downstream: null,
    })
    expect(typeMismatch.ok).toBe(false)

    // 深すぎる入れ子
    const deep = run({
      kind: 'groupingBy',
      classifier: { kind: 'employeeField', field: 'region' },
      mapFactoryId: null,
      downstream: {
        kind: 'groupingBy',
        classifier: { kind: 'employeeField', field: 'region' },
        mapFactoryId: null,
        downstream: {
          kind: 'groupingBy',
          classifier: { kind: 'employeeField', field: 'region' },
          mapFactoryId: null,
          downstream: {
            kind: 'groupingBy',
            classifier: { kind: 'employeeField', field: 'region' },
            mapFactoryId: null,
            downstream: { kind: 'toList' },
          },
        },
      },
    })
    expect(deep.ok).toBe(false)
    if (!deep.ok) {
      expect(deep.issues.some((i) => i.code === 'COLLECTOR_DEPTH')).toBe(true)
    }

    // 任意コード文字列の混入も実行セッションへ入れない
    const arbitraryCode = run({ kind: 'groupingBy', functionBody: 'return 1' })
    expect(arbitraryCode.ok).toBe(false)
    if (!arbitraryCode.ok) {
      expect(arbitraryCode.issues.some((i) => i.code === 'STRUCTURE_INVALID')).toBe(true)
    }

    // 埋め込みDSL（classifier）への任意コード混入も拒否する
    const arbitraryInClassifier = run({
      kind: 'groupingBy',
      classifier: { kind: 'employeeField', field: 'region', javaCode: 'e -> e.region()' },
      mapFactoryId: null,
      downstream: null,
    })
    expect(arbitraryInClassifier.ok).toBe(false)
    if (!arbitraryInClassifier.ok) {
      expect(arbitraryInClassifier.issues.some((i) => i.code === 'STRUCTURE_INVALID')).toBe(true)
    }
  })

  it('P5-A05: Comparatorが適用できないCollectorはinstantiateで拒否され、Engineへ入らない', () => {
    const registry = createDefaultTemplateRegistry()
    const catalog = createDefaultCatalog()
    // minBy templateはEmployee要素。natural order Comparatorは比較できないため事前に拒否される
    const result = instantiateTemplate(registry, catalog, {
      templateId: 'tmpl-collect-minby',
      templateVersion: 1,
      dataset: STANDARD_EMPLOYEES,
      dslParameters: { 'slot-collector': { kind: 'minBy', comparator: { kind: 'natural' } } },
      mode: 'standard',
      revision: 'p5-a05-comparator:r1',
    })
    // Step Engineへ渡らず、構造化issueとして返る（実行時例外にならない）
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'TYPE_MISMATCH')).toBe(true)
      expect(result.issues.some((i) => i.message.includes('employeeKeys'))).toBe(true)
    }
    // 正例（employeeKeys）は成立する
    const ok = instantiateTemplate(registry, catalog, {
      templateId: 'tmpl-collect-minby',
      templateVersion: 1,
      dataset: STANDARD_EMPLOYEES,
      dslParameters: {
        'slot-collector': {
          kind: 'minBy',
          comparator: { kind: 'employeeKeys', keys: [{ field: 'age', direction: 'ASC' }] },
        },
      },
      mode: 'standard',
      revision: 'p5-a05-comparator:r2',
    })
    expect(ok.ok).toBe(true)
  })
})
