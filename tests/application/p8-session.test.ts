import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/ui/appInstance'
import { FakeScheduler } from '../helpers'
import { P8_TEMPLATES } from '../../src/domain/template/templatesP8'
import { TO_MAP_NOT_IMPORTABLE_REASON } from '../../src/application/importContract'
import { expectedCompletionOf } from '../../src/domain/template/pipelineTemplate'
import { P8_TEMPLATE_MODES } from '../p8-helpers'

/**
 * P8-A01〜P8-A04: Applicationレイヤ（シナリオ切替・再生 / 復元・FAILED遷移・既存経路回帰）
 * （Phase 8指示 §12.2、v0.11 §6.2の4）。
 */

const FAILING_TEMPLATE = 'tmpl-collect-tomap-duplicate'

function newApp() {
  const scheduler = new FakeScheduler()
  return { app: createApp({ scheduler }), scheduler }
}

/** 終端（COMPLETED / FAILED）まで進める */
function runToEnd(app: ReturnType<typeof createApp>): void {
  for (let i = 0; i < 600; i++) {
    const before = app.session.getState()
    if (before.playbackState === 'COMPLETED' || before.playbackState === 'FAILED') return
    app.session.stepForward()
    if (app.session.getState().cursor === before.cursor) return
  }
  throw new Error('終端へ到達しませんでした')
}

describe('P8-A01 シナリオ切替', () => {
  it('P8-A01: toMap templateの選択がシナリオ切替意味論で成立する', () => {
    for (const template of P8_TEMPLATES) {
      for (const mode of template.supportedModes) {
        const { app, scheduler } = newApp()
        app.session.stepForward()
        app.session.play()
        expect(app.session.getState().playbackState).toBe('PLAYING')
        app.selectScenario(template.templateId, mode)
        const state = app.session.getState()
        const key = `${template.templateId}:${mode}`
        // タイマー停止・history初期化・cursor 0・READY
        expect(state.playbackState, key).toBe('READY')
        expect(scheduler.pending.size, key).toBe(0)
        expect(state.cursor, key).toBe(0)
        expect(state.historyLength, key).toBe(1)
        expect(state.snapshot.kind, key).toBe('INITIAL')
        expect(state.snapshot.executionFailure, key).toBeNull()
        expect(state.scenario.revision, key).toMatch(
          new RegExp(`^${template.templateId}:${mode}:r\\d+$`),
        )
      }
    }
  })

  it('P8-A01: 失敗templateからの切替でもFAILEDが残らずREADYになる', () => {
    const { app } = newApp()
    app.selectScenario(FAILING_TEMPLATE, 'standard')
    runToEnd(app)
    expect(app.session.getState().playbackState).toBe('FAILED')
    app.selectScenario('tmpl-collect-tomap-merge-first', 'standard')
    expect(app.session.getState().playbackState).toBe('READY')
    expect(app.session.getState().stopReason).toBeNull()
  })
})

describe('P8-A02 再生・復元', () => {
  it('P8-A02: 全8 template × 全modeで期待終端へ到達し、snapshotCountが一致する', () => {
    expect(P8_TEMPLATE_MODES).toHaveLength(10)
    for (const { templateId, mode } of P8_TEMPLATE_MODES) {
      const { app } = newApp()
      app.selectScenario(templateId, mode)
      runToEnd(app)
      const state = app.session.getState()
      const key = `${templateId}:${mode}`
      const template = P8_TEMPLATES.find((t) => t.templateId === templateId)!
      const expected = expectedCompletionOf(template)
      expect(state.playbackState, key).toBe(expected === 'EXECUTION_FAILED' ? 'FAILED' : 'COMPLETED')
      expect(state.snapshot.completion, key).toBe(expected)
      expect(state.historyLength, key).toBe(state.scenario.pipeline.snapshotCount)
      expect(state.cursor, key).toBe(state.historyLength - 1)
    }
  })

  it('P8-A02: cursor移動で全snapshotが完全復元される（失敗列を含む）', () => {
    for (const { templateId, mode } of P8_TEMPLATE_MODES) {
      const { app } = newApp()
      app.selectScenario(templateId, mode)
      runToEnd(app)
      const forward: string[] = []
      const length = app.session.getState().historyLength
      for (let i = length - 1; i >= 0; i--) {
        forward.unshift(JSON.stringify(app.session.getState().snapshot))
        if (i > 0) app.session.stepBack()
      }
      expect(app.session.getState().cursor, `${templateId}:${mode}`).toBe(0)
      for (let i = 1; i < length; i++) {
        app.session.stepForward()
        expect(JSON.stringify(app.session.getState().snapshot), `${templateId}:${mode}#${i}`).toBe(
          forward[i],
        )
      }
    }
  })
})

describe('P8-A03 FAILED状態遷移（v0.11 §6.2の4の全行）', () => {
  it('P8-A03: 手動でCOLLECT_FAILEDへ到達するとFAILEDになる', () => {
    const { app, scheduler } = newApp()
    app.selectScenario(FAILING_TEMPLATE, 'standard')
    runToEnd(app)
    const state = app.session.getState()
    expect(state.snapshot.kind).toBe('COLLECT_FAILED')
    expect(state.playbackState).toBe('FAILED')
    expect(scheduler.pending.size).toBe(0)
    // ERROR用のstopReasonは使用しない（FAILED専用の表示情報はsnapshot.executionFailureが持つ）
    expect(state.stopReason).toBeNull()
    expect(state.snapshot.executionFailure).not.toBeNull()
    expect(state.snapshot.executionFailure?.exceptionType).toBe('IllegalStateException')
  })

  it('P8-A03: 自動再生でCOLLECT_FAILEDへ到達するとFAILEDになりタイマーが停止する', () => {
    const { app, scheduler } = newApp()
    app.selectScenario(FAILING_TEMPLATE, 'standard')
    app.session.play()
    expect(app.session.getState().playbackState).toBe('PLAYING')
    for (let i = 0; i < 50; i++) {
      if (app.session.getState().playbackState !== 'PLAYING') break
      scheduler.flushOne()
    }
    expect(app.session.getState().playbackState).toBe('FAILED')
    expect(app.session.getState().snapshot.kind).toBe('COLLECT_FAILED')
    expect(scheduler.pending.size).toBe(0)
  })

  it('P8-A03: FAILEDで進む・自動再生開始はno-opである', () => {
    const { app, scheduler } = newApp()
    app.selectScenario(FAILING_TEMPLATE, 'standard')
    runToEnd(app)
    const before = app.session.getState()
    app.session.stepForward()
    expect(app.session.getState().cursor).toBe(before.cursor)
    expect(app.session.getState().playbackState).toBe('FAILED')
    app.session.play()
    expect(app.session.getState().playbackState).toBe('FAILED')
    expect(scheduler.pending.size).toBe(0)
    expect(app.session.getState().historyLength).toBe(before.historyLength)
  })

  it('P8-A03: FAILEDで戻ると1件前のsnapshotへ移動しPAUSEDになる', () => {
    const { app } = newApp()
    app.selectScenario(FAILING_TEMPLATE, 'standard')
    runToEnd(app)
    const failedCursor = app.session.getState().cursor
    app.session.stepBack()
    const state = app.session.getState()
    expect(state.cursor).toBe(failedCursor - 1)
    expect(state.playbackState).toBe('PAUSED')
    expect(state.snapshot.kind).toBe('DUPLICATE_KEY_DETECTED')
    expect(state.snapshot.executionFailure).toBeNull()
    expect(state.snapshot.output.result).not.toBeNull()
  })

  it('P8-A03: 戻った位置から保存済みCOLLECT_FAILEDへ再前進すると履歴復元でFAILEDへ戻る', () => {
    const { app } = newApp()
    app.selectScenario(FAILING_TEMPLATE, 'standard')
    runToEnd(app)
    const failed = JSON.stringify(app.session.getState().snapshot)
    const historyLength = app.session.getState().historyLength
    app.session.stepBack()
    app.session.stepForward()
    const state = app.session.getState()
    expect(state.playbackState).toBe('FAILED')
    // 再計算せず履歴から復元する（historyは伸びない）
    expect(state.historyLength).toBe(historyLength)
    expect(JSON.stringify(state.snapshot)).toBe(failed)
  })

  it('P8-A03: FAILEDからrestartするとREADYへ戻る', () => {
    const { app } = newApp()
    app.selectScenario(FAILING_TEMPLATE, 'standard')
    runToEnd(app)
    app.session.restart()
    const state = app.session.getState()
    expect(state.playbackState).toBe('READY')
    expect(state.cursor).toBe(0)
    expect(state.stopReason).toBeNull()
    // historyは保持されるため、再前進で再びFAILEDへ到達できる
    runToEnd(app)
    expect(app.session.getState().playbackState).toBe('FAILED')
  })

  it('P8-A03: FAILEDはERROR用のcatch経路・stopReasonを使用しない', () => {
    const { app } = newApp()
    app.selectScenario(FAILING_TEMPLATE, 'standard')
    for (let i = 0; i < 20; i++) {
      app.session.stepForward()
      const state = app.session.getState()
      expect(state.playbackState).not.toBe('ERROR')
      expect(state.stopReason).toBeNull()
      if (state.playbackState === 'FAILED') break
    }
    expect(app.session.getState().playbackState).toBe('FAILED')
  })

  it('P8-A03: 成功templateではFAILEDへ遷移しない', () => {
    for (const { templateId, mode } of P8_TEMPLATE_MODES) {
      if (templateId === FAILING_TEMPLATE) continue
      const { app } = newApp()
      app.selectScenario(templateId, mode)
      runToEnd(app)
      expect(app.session.getState().playbackState, `${templateId}:${mode}`).toBe('COMPLETED')
    }
  })
})

describe('P8-A04 既存経路回帰・取込Result経路', () => {
  it('P8-A04: 既存template（非Phase 8）のfixture経路の挙動が不変である', () => {
    for (const templateId of [
      'tmpl-filter-basic',
      'tmpl-collect-tolist',
      'tmpl-collect-groupingby',
      'tmpl-collect-teeing',
      'tmpl-gather-window-fixed',
    ]) {
      const { app } = newApp()
      app.selectScenario(templateId, 'standard')
      runToEnd(app)
      const state = app.session.getState()
      expect(state.playbackState, templateId).toBe('COMPLETED')
      expect(state.snapshot.completion, templateId).toBe('STREAM_CONSUMED')
      expect(state.snapshot.output.result, templateId).not.toBeNull()
      expect(state.snapshot.executionFailure, templateId).toBeNull()
    }
  })

  it('P8-A04: toMap template選択中の取込系操作はthrowせず失敗理由を返す', () => {
    const { app } = newApp()
    for (const template of P8_TEMPLATES) {
      const importability = app.importabilityOf(template.templateId)
      if (template.templateId === 'tmpl-collect-groupby-mergedemo') {
        // toMap非含有のため通常どおり取込対象
        expect(importability.importable).toBe(true)
        continue
      }
      expect(importability.importable, template.templateId).toBe(false)
      expect(importability.reason, template.templateId).toBe(TO_MAP_NOT_IMPORTABLE_REASON)
      const mode = template.supportedModes[0]!
      expect(() => app.generatePrompt(template.templateId, mode)).not.toThrow()
      expect(app.generatePrompt(template.templateId, mode).ok).toBe(false)
      expect(() => app.importCandidate(template.templateId, mode, '{}')).not.toThrow()
      const result = app.importCandidate(template.templateId, mode, '{}')
      expect(result.ok, template.templateId).toBe(false)
      if (!result.ok) expect(result.issues.length).toBeGreaterThan(0)
    }
  })

  it('P8-A04: 取込失敗時に現在のシナリオ・履歴・再生状態が変化しない', () => {
    const { app } = newApp()
    app.selectScenario('tmpl-collect-tomap-merge-first', 'standard')
    app.session.stepForward()
    app.session.stepForward()
    const before = app.session.getState()
    const revision = before.scenario.revision
    const cursor = before.cursor
    const historyLength = before.historyLength
    const result = app.importCandidate('tmpl-collect-tomap-merge-first', 'standard', '{}')
    expect(result.ok).toBe(false)
    const after = app.session.getState()
    expect(after.scenario.revision).toBe(revision)
    expect(after.cursor).toBe(cursor)
    expect(after.historyLength).toBe(historyLength)
    expect(after.playbackState).toBe(before.playbackState)
  })
})
