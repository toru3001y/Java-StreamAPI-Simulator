// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/ui/App'
import { createApp } from '../../src/ui/appInstance'
import { AI_CAPABILITY } from '../../src/providers/scenarioProvider'
import { FakeScheduler } from '../helpers'

/** React統合テスト（§23.3）。UIは確定snapshotからの描画だけを検証する。 */
function renderApp() {
  const scheduler = new FakeScheduler()
  const app = createApp({ scheduler })
  const utils = render(<App app={app} />)
  return { app, scheduler, ...utils }
}

async function clickForward(user: ReturnType<typeof userEvent.setup>, times: number) {
  const button = screen.getByRole('button', { name: '進む' })
  for (let i = 0; i < times; i++) {
    await user.click(button)
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('React統合', () => {
  it('P1-R01: 全パネルが同じsnapshot IDから描画される', async () => {
    const user = userEvent.setup()
    renderApp()
    await clickForward(user, 3)
    const panels = document.querySelectorAll('[data-snapshot-id]')
    expect(panels.length).toBeGreaterThanOrEqual(6)
    const ids = new Set([...panels].map((p) => p.getAttribute('data-snapshot-id')))
    expect(ids.size).toBe(1)
    expect([...ids][0]).toMatch(/^tmpl-filter-basic:standard:r\d+#3$/)
  })

  it('P1-R02: active node変更で対応するコード行だけを強調する', async () => {
    const user = userEvent.setup()
    renderApp()
    // 1回目: SOURCE_EMIT（sourceノード）
    await clickForward(user, 1)
    let activeLines = document.querySelectorAll('.code-line[data-active]')
    expect(activeLines).toHaveLength(1)
    expect(activeLines[0]?.getAttribute('data-line-id')).toBe('line-node-src')
    // 2回目: NODE_ARRIVAL（filterノード）
    await clickForward(user, 1)
    activeLines = document.querySelectorAll('.code-line[data-active]')
    expect(activeLines).toHaveLength(1)
    expect(activeLines[0]?.getAttribute('data-line-id')).toBe('line-node-filter-1')
    // Pipeline側のactive nodeも一致
    const activeNode = document.querySelector('.pipeline-node[data-active]')
    expect(activeNode?.getAttribute('data-node-id')).toBe('node-filter-1')
  })

  it('P1-R03: 凡例はfilterで必要な4状態だけを表示し、バッファ済みを表示しない', () => {
    renderApp()
    const legend = screen.getByTestId('legend')
    const items = legend.querySelectorAll('.legend-item')
    expect(items).toHaveLength(4)
    expect(legend.textContent).toContain('未評価')
    expect(legend.textContent).toContain('処理中')
    expect(legend.textContent).toContain('通過済み')
    expect(legend.textContent).toContain('除外済み')
    expect(legend.textContent).not.toContain('バッファ済み')
  })

  it('P1-R04: 入力の通過 / 除外 / 未評価状態がsnapshotと一致する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    // 9 step目: 鈴木のELEMENT_REJECTED
    await clickForward(user, 9)
    const snapshot = app.session.getState().snapshot
    expect(snapshot.kind).toBe('ELEMENT_REJECTED')
    const rows = document.querySelectorAll('.element-row')
    expect(rows).toHaveLength(4)
    const stateOf = (elementId: string) =>
      document
        .querySelector(`.element-row[data-element-id="${elementId}"]`)
        ?.getAttribute('data-state')
    expect(stateOf('emp-001')).toBe('PASSED')
    expect(stateOf('emp-002')).toBe('REJECTED')
    expect(stateOf('emp-003')).toBe('UNEVALUATED')
    expect(stateOf('emp-004')).toBe('UNEVALUATED')
    // 記号だけでなく文言でも識別できる
    const suzukiRow = document.querySelector('.element-row[data-element-id="emp-002"]')
    expect(suzukiRow?.textContent).toContain('除外済み')
    expect(suzukiRow?.textContent).toContain('×')
  })

  it('P1-R05: 通過要素だけがtoListの出力へ追加される', async () => {
    const user = userEvent.setup()
    renderApp()
    // 完了まで進める（21 snapshot）
    await clickForward(user, 20)
    const outputList = screen.getByTestId('output-list')
    const items = outputList.querySelectorAll('li')
    expect(items).toHaveLength(2)
    expect(items[0]?.textContent).toContain('佐藤')
    expect(items[1]?.textContent).toContain('高橋')
    expect(screen.getByTestId('output-panel').textContent).toContain('2件')
    expect(screen.getByTestId('output-panel').textContent).toContain('確定')
  })

  it('P1-R06: READY / PLAYING / PAUSED / COMPLETEDでボタンのdisabled状態が正しい', async () => {
    const user = userEvent.setup()
    const { scheduler } = renderApp()
    const btn = {
      restart: () => screen.getByRole('button', { name: '最初から' }),
      back: () => screen.getByRole('button', { name: '戻る' }),
      forward: () => screen.getByRole('button', { name: '進む' }),
      play: () => screen.getByRole('button', { name: '自動' }),
      stop: () => screen.getByRole('button', { name: '停止' }),
    }
    // READY（cursor 0）
    expect(btn.restart()).toBeDisabled()
    expect(btn.back()).toBeDisabled()
    expect(btn.forward()).toBeEnabled()
    expect(btn.play()).toBeEnabled()
    expect(btn.stop()).toBeDisabled()
    // PAUSED（手動で1歩進めた状態）
    await clickForward(user, 1)
    expect(btn.restart()).toBeEnabled()
    expect(btn.back()).toBeEnabled()
    // PLAYING
    await user.click(btn.play())
    expect(screen.getByTestId('playback-state').getAttribute('data-state')).toBe('PLAYING')
    expect(btn.restart()).toBeDisabled()
    expect(btn.back()).toBeDisabled()
    expect(btn.forward()).toBeDisabled()
    expect(btn.play()).toBeDisabled()
    expect(btn.stop()).toBeEnabled()
    // 停止 → PAUSED
    await user.click(btn.stop())
    expect(screen.getByTestId('playback-state').getAttribute('data-state')).toBe('PAUSED')
    expect(scheduler.pending.size).toBe(0)
    // COMPLETED（最後まで進める）
    await clickForward(user, 25)
    expect(screen.getByTestId('playback-state').getAttribute('data-state')).toBe('COMPLETED')
    expect(btn.forward()).toBeDisabled()
    expect(btn.play()).toBeDisabled()
    expect(btn.back()).toBeEnabled()
  })

  it('P1-R07: AIボタンはdisabledで理由が読め、fixtureへ自動切替しない', () => {
    const { app } = renderApp()
    const aiButton = screen.getByTestId('ai-button')
    expect(aiButton).toBeDisabled()
    expect(aiButton).toHaveAttribute('aria-describedby', 'ai-unavailable-reason')
    const reason = screen.getByTestId('ai-reason')
    expect(reason.textContent).toBe(AI_CAPABILITY.reason)
    // fixtureはAI生成ではなく「固定サンプル」と表示される
    expect(screen.getByTestId('provenance').textContent).toBe('固定サンプル')
    // disabledボタンなのでシナリオは変化しない
    const revision = app.session.getState().scenario.revision
    aiButton.click()
    expect(app.session.getState().scenario.revision).toBe(revision)
  })

  it('P1-R08: prefers-reduced-motion時は移動アニメーションを抑制する', async () => {
    const makeMatchMedia = (matches: boolean) =>
      ((query: string) => ({
        matches,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia

    const scrollSpy = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => {})

    // reduced motion有効時: behavior 'auto'
    window.matchMedia = makeMatchMedia(true)
    const user = userEvent.setup()
    const first = renderApp()
    await clickForward(user, 1)
    expect(scrollSpy).toHaveBeenCalled()
    const lastCallReduced = scrollSpy.mock.calls[scrollSpy.mock.calls.length - 1]?.[0]
    expect((lastCallReduced as ScrollIntoViewOptions).behavior).toBe('auto')
    first.unmount()

    // reduced motion無効時: behavior 'smooth'
    scrollSpy.mockClear()
    window.matchMedia = makeMatchMedia(false)
    renderApp()
    await clickForward(user, 1)
    expect(scrollSpy).toHaveBeenCalled()
    const lastCall = scrollSpy.mock.calls[scrollSpy.mock.calls.length - 1]?.[0]
    expect((lastCall as ScrollIntoViewOptions).behavior).toBe('smooth')
  })
})
