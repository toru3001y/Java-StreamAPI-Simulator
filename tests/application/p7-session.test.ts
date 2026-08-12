import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/ui/appInstance'
import { FakeScheduler } from '../helpers'
import { P7_TEMPLATES } from '../../src/domain/template/templatesP7'
import { GATHER_NOT_IMPORTABLE_REASON } from '../../src/application/importContract'
import { gatherTemplateModes } from '../p7-helpers'
import { createDefaultCatalog, OP_GATHER } from '../../src/domain/catalog/operations'
import type { ScenarioMode } from '../../src/domain/scenario/scenario'

/**
 * P7-A01〜P7-A04: Applicationレイヤ（シナリオ切替・再生復元・既存経路回帰・取込Result経路）
 * （Phase 7指示 §12.2）。
 */

function newApp() {
  const scheduler = new FakeScheduler()
  return { app: createApp({ scheduler }), scheduler }
}

describe('P7-A01 シナリオ切替', () => {
  it('P7-A01: gather templateの選択がシナリオ切替意味論で成立する', () => {
    for (const template of P7_TEMPLATES) {
      for (const mode of template.supportedModes) {
        const { app, scheduler } = newApp()
        // 自動再生中に切り替える（タイマー停止の確認）
        app.session.stepForward()
        app.session.play()
        expect(app.session.getState().playbackState).toBe('PLAYING')
        app.selectScenario(template.templateId, mode)
        const state = app.session.getState()
        expect(state.playbackState, `${template.templateId}:${mode}`).toBe('READY')
        expect(scheduler.pending.size, `${template.templateId}:${mode}`).toBe(0)
        // history初期化・cursor 0
        expect(state.cursor, `${template.templateId}:${mode}`).toBe(0)
        expect(state.snapshot.index).toBe(0)
        expect(state.snapshot.kind).toBe('INITIAL')
        // 新revisionは ${templateId}:${mode}:r${counter} 形式（既存FixtureScenarioProvider規約）
        expect(state.scenario.revision, `${template.templateId}:${mode}`).toMatch(
          new RegExp(`^${template.templateId}:${mode}:r\\d+$`),
        )
      }
    }
  })

  it('P7-A01: 同一templateの再選択で毎回新しいrevisionが発行される', () => {
    const { app } = newApp()
    app.selectScenario('tmpl-gather-window-fixed', 'standard')
    const first = app.session.getState().scenario.revision
    app.selectScenario('tmpl-gather-window-fixed', 'standard')
    const second = app.session.getState().scenario.revision
    expect(second).not.toBe(first)
  })
})

describe('P7-A02 再生・復元', () => {
  it('P7-A02: 全7 template × 全modeで初期snapshotから終端まで到達する', () => {
    const modes = gatherTemplateModes()
    expect(modes).toHaveLength(11)
    for (const { templateId, mode } of modes) {
      const { app } = newApp()
      app.selectScenario(templateId, mode as ScenarioMode)
      const total = app.session.getState().scenario.pipeline.snapshotCount
      for (let i = 1; i < total; i++) app.session.stepForward()
      const state = app.session.getState()
      expect(state.snapshot.completion, `${templateId}:${mode}`).toBe('STREAM_CONSUMED')
      expect(state.cursor, `${templateId}:${mode}`).toBe(total - 1)
      expect(state.playbackState, `${templateId}:${mode}`).toBe('COMPLETED')
    }
  })

  it('P7-A02: cursor移動でgather contextが完全復元され、snapshotCountが一致する', () => {
    for (const { templateId, mode } of gatherTemplateModes()) {
      const { app } = newApp()
      app.selectScenario(templateId, mode as ScenarioMode)
      const total = app.session.getState().scenario.pipeline.snapshotCount
      const forward: string[] = []
      forward.push(JSON.stringify(app.session.getState().snapshot.operationContexts))
      for (let i = 1; i < total; i++) {
        app.session.stepForward()
        forward.push(JSON.stringify(app.session.getState().snapshot.operationContexts))
      }
      // 戻る → 進むで全時点が一致する
      const backward: string[] = []
      backward.unshift(JSON.stringify(app.session.getState().snapshot.operationContexts))
      for (let i = total - 1; i > 0; i--) {
        app.session.stepBack()
        backward.unshift(JSON.stringify(app.session.getState().snapshot.operationContexts))
      }
      expect(backward, `${templateId}:${mode}`).toEqual(forward)
      for (let i = 1; i < total; i++) app.session.stepForward()
      expect(
        JSON.stringify(app.session.getState().snapshot.operationContexts),
        `${templateId}:${mode}`,
      ).toBe(forward[total - 1])
    }
  })
})

describe('P7-A03 既存経路回帰', () => {
  it('P7-A03: 操作一覧へgatherが中間categoryで追加される', () => {
    const { app } = newApp()
    const gather = app.operations.find((op) => op.operationId === OP_GATHER)
    expect(gather).toBeDefined()
    expect(gather?.category).toBe('intermediate')
    expect(gather?.executable).toBe(true)
    expect(gather?.displayName).toBe('gather')
    // categoryの構成は増えない（新設optgroupなし）
    expect([...new Set(app.operations.map((op) => op.category))].sort()).toEqual([
      'collector',
      'intermediate',
      'source',
      'terminal',
    ])
    // 操作選択の一覧はtemplateを持つ操作から導出される。gatherが1行増えるだけで
    // optgroupの新設はない（catalog全体は46操作。P7-D20）
    expect(app.operations).toHaveLength(45)
    expect(createDefaultCatalog().list()).toHaveLength(46)
    expect(app.operations.filter((op) => op.category === 'intermediate')).toHaveLength(19)
  })

  it('P7-A03: gatherに対して7 templateが引ける', () => {
    const { app } = newApp()
    const templates = app.templatesFor(OP_GATHER)
    expect(templates).toHaveLength(7)
    expect(templates.every((t) => t.executable !== false)).toBe(true)
  })

  it('P7-A03: 既存操作・既存templateのfixture経路の挙動が不変である', () => {
    const { app } = newApp()
    const catalog = createDefaultCatalog()
    // 既存の代表シナリオが従来どおり終端まで到達する
    for (const [templateId, mode] of [
      ['tmpl-filter-basic', 'standard'],
      ['tmpl-sorted-comparator', 'standard'],
      ['tmpl-reduce-identity', 'standard'],
      ['tmpl-collect-tolist', 'standard'],
    ] as const) {
      if (!app.templates.some((t) => t.templateId === templateId)) continue
      app.selectScenario(templateId, mode)
      const total = app.session.getState().scenario.pipeline.snapshotCount
      for (let i = 1; i < total; i++) app.session.stepForward()
      expect(app.session.getState().snapshot.completion, templateId).toBe('STREAM_CONSUMED')
      // 非gather Pipelineにgather contextは現れない
      expect(
        Object.values(app.session.getState().snapshot.operationContexts).some(
          (ctx) => ctx.kind === 'gather',
        ),
        templateId,
      ).toBe(false)
    }
    // 既存45操作の定義が変わっていない
    expect(catalog.list().filter((d) => d.operationId !== OP_GATHER)).toHaveLength(45)
  })
})

describe('P7-A04 取込Result経路', () => {
  it('P7-A04: gather template選択中の取込系操作はthrowせず失敗理由を返す', () => {
    for (const template of P7_TEMPLATES) {
      for (const mode of template.supportedModes) {
        const { app } = newApp()
        app.selectScenario(template.templateId, mode as ScenarioMode)
        expect(() => app.generatePrompt(template.templateId, mode as ScenarioMode)).not.toThrow()
        const prompt = app.generatePrompt(template.templateId, mode as ScenarioMode)
        expect(prompt.ok, `${template.templateId}:${mode}`).toBe(false)
        if (!prompt.ok) expect(prompt.issues[0]?.message).toBe(GATHER_NOT_IMPORTABLE_REASON)
        expect(() =>
          app.importCandidate(template.templateId, mode as ScenarioMode, '{}'),
        ).not.toThrow()
        const imported = app.importCandidate(template.templateId, mode as ScenarioMode, '{}')
        expect(imported.ok, `${template.templateId}:${mode}`).toBe(false)
      }
    }
  })

  it('P7-A04: 取込失敗時にシナリオ・履歴・再生状態が一切変わらない', () => {
    const { app, scheduler } = newApp()
    app.selectScenario('tmpl-gather-window-fixed', 'standard')
    app.session.stepForward()
    app.session.stepForward()
    const before = app.session.getState()
    const beforeRevision = before.scenario.revision
    const beforeCursor = before.cursor
    const beforePlayback = before.playbackState
    const beforeSnapshotId = before.snapshot.snapshotId

    const result = app.importCandidate(
      'tmpl-gather-window-fixed',
      'standard',
      JSON.stringify({
        dslVersion: '1',
        templateId: 'tmpl-gather-window-fixed',
        templateVersion: 1,
        mode: 'standard',
        title: 'x',
        description: 'y',
        dslParameters: { 'slot-gatherer': { kind: 'windowFixed', size: 3 } },
        dataset: [],
      }),
    )
    expect(result.ok).toBe(false)

    const after = app.session.getState()
    expect(after.scenario.revision).toBe(beforeRevision)
    expect(after.cursor).toBe(beforeCursor)
    expect(after.playbackState).toBe(beforePlayback)
    expect(after.snapshot.snapshotId).toBe(beforeSnapshotId)
    expect(scheduler.pending.size).toBe(0)
  })

  it('P7-A04: 非gather templateへ戻すと取込経路が従来どおり成立する', () => {
    const { app } = newApp()
    app.selectScenario('tmpl-gather-fold', 'standard')
    expect(app.importabilityOf('tmpl-gather-fold').importable).toBe(false)
    app.selectScenario('tmpl-filter-basic', 'standard')
    expect(app.importabilityOf('tmpl-filter-basic').importable).toBe(true)
    const prompt = app.generatePrompt('tmpl-filter-basic', 'standard')
    expect(prompt.ok).toBe(true)
  })
})
