// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/ui/App'
import { createApp } from '../../src/ui/appInstance'
import { FakeScheduler } from '../helpers'

/**
 * P6-R01〜P6-R06: React統合テスト（Phase 6指示 §12.3、v0.10 §8）。
 * UIは確定snapshotとApplicationが返すResultの描画だけを行い、結果を独自計算しない。
 */
vi.setConfig({ testTimeout: 30_000 })

const EXAMPLE_MARKER = '## 出力例\n\n'

function renderApp() {
  const scheduler = new FakeScheduler()
  const app = createApp({ scheduler })
  const utils = render(<App app={app} />)
  return { app, scheduler, ...utils }
}

function exampleJsonFor(
  app: ReturnType<typeof createApp>,
  templateId: string,
  mode: 'standard' | 'midEmpty' | 'emptySource' = 'standard',
): string {
  const prompt = app.generatePrompt(templateId, mode)
  if (!prompt.ok) throw new Error('プロンプトを生成できません')
  const index = prompt.value.indexOf(EXAMPLE_MARKER)
  return prompt.value.slice(index + EXAMPLE_MARKER.length).trim()
}

/**
 * クリップボードAPIを差し替える。
 * `userEvent.setup()`は独自のclipboard stubを導入するため、setupの**後**に呼ぶ。
 */
function stubClipboard(impl: (text: string) => Promise<void>): { calls: string[] } {
  const calls: string[] = []
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (text: string) => {
        calls.push(text)
        return impl(text)
      },
    },
  })
  return { calls }
}

/** クリップボードAPIが存在しない環境を再現する */
function removeClipboard(): void {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: undefined,
  })
}

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(globalThis.navigator, 'clipboard')
})

describe('P6-R01 取込UI構成', () => {
  it('P6-R01: 取込UI（コピー / 貼付）が表示され、AIボタン・AI理由表示が存在しない', () => {
    renderApp()
    expect(screen.getByTestId('import-panel')).toBeInTheDocument()
    expect(screen.getByTestId('copy-prompt-button')).toBeEnabled()
    expect(screen.getByTestId('import-button')).toBeEnabled()
    expect(screen.getByTestId('import-textarea')).toBeEnabled()
    expect(screen.queryByTestId('ai-button')).toBeNull()
    expect(screen.queryByTestId('ai-reason')).toBeNull()
    expect(screen.queryByText(/AIで別サンプル/)).toBeNull()
    expect(document.body.textContent).not.toContain('AI生成')
  })

  it('P6-R01: provenanceバッジは固定サンプル / 取込サンプルを正しく表示する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    const badge = screen.getByTestId('provenance')
    expect(badge.textContent).toBe('固定サンプル')
    expect(badge.getAttribute('data-provider-kind')).toBe('FIXTURE')

    await user.click(screen.getByTestId('import-textarea'))
    await user.paste(exampleJsonFor(app, 'tmpl-filter-basic'))
    await user.click(screen.getByTestId('import-button'))

    const after = screen.getByTestId('provenance')
    expect(after.textContent).toBe('取込サンプル')
    expect(after.getAttribute('data-provider-kind')).toBe('IMPORTED')
  })
})

describe('P6-R02 コピー操作', () => {
  it('P6-R02: コピー成功時はフィードバックが表示され、シナリオ・履歴・再生状態が変化しない', async () => {
    const user = userEvent.setup()
    const clipboard = stubClipboard(() => Promise.resolve())
    const { app } = renderApp()
    await user.click(screen.getByRole('button', { name: '進む' }))
    const before = app.session.getState()

    await user.click(screen.getByTestId('copy-prompt-button'))

    expect(screen.getByTestId('copy-feedback').textContent).toContain('コピーしました')
    expect(clipboard.calls).toHaveLength(1)
    expect(clipboard.calls[0]).toContain('templateId: "tmpl-filter-basic"')
    const after = app.session.getState()
    expect(after.scenario).toBe(before.scenario)
    expect(after.snapshot).toBe(before.snapshot)
    expect(after.cursor).toBe(before.cursor)
    expect(after.historyLength).toBe(before.historyLength)
    expect(after.playbackState).toBe(before.playbackState)
  })

  it('P6-R02: コピー失敗時はプロンプト全文を選択可能なテキストとして表示する', async () => {
    const user = userEvent.setup()
    stubClipboard(() => Promise.reject(new Error('denied')))
    renderApp()
    await user.click(screen.getByTestId('copy-prompt-button'))
    const fallback = screen.getByTestId('copy-fallback-text') as HTMLTextAreaElement
    expect(fallback).toBeInTheDocument()
    expect(fallback.readOnly).toBe(true)
    expect(fallback.value).toContain('# Java Stream API学習教材の入力データ候補の作成依頼')
    expect(screen.getByTestId('copy-fallback').textContent).toContain('コピーできませんでした')
  })

  it('P6-R02: クリップボードAPIが存在しない環境でもフォールバック表示になる', async () => {
    const user = userEvent.setup()
    removeClipboard()
    renderApp()
    await user.click(screen.getByTestId('copy-prompt-button'))
    expect(screen.getByTestId('copy-fallback-text')).toBeInTheDocument()
  })
})

describe('P6-R03 失敗理由表示', () => {
  it('P6-R03: 検証失敗理由が貼付欄近傍に表示され、aria-liveで通知され、現行シナリオが維持される', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    const before = app.session.getState()

    await user.click(screen.getByTestId('import-textarea'))
    await user.paste('{"dslVersion":"99","templateId":"tmpl-filter-basic"}')
    await user.click(screen.getByTestId('import-button'))

    const issues = screen.getByTestId('import-issues')
    expect(issues).toBeInTheDocument()
    // code・対象path・messageが読める
    expect(within(issues).getAllByText('IMPORT_SCHEMA').length).toBeGreaterThan(0)
    expect(issues.textContent).toContain('必須キーがありません')
    // aria-liveの領域内にある
    const feedback = screen.getByTestId('import-feedback')
    expect(feedback.getAttribute('aria-live')).toBe('polite')
    expect(feedback.contains(issues)).toBe(true)
    // 貼付欄と同じパネル内（近傍）に表示される
    expect(screen.getByTestId('import-panel').contains(issues)).toBe(true)
    // 色以外（記号・文言）でも識別できる
    expect(issues.textContent).toContain('×')
    expect(issues.textContent).toContain('現在のシナリオは変更していません')

    // 現行シナリオの表示が維持される
    const after = app.session.getState()
    expect(after.scenario).toBe(before.scenario)
    expect(screen.getByTestId('provenance').textContent).toBe('固定サンプル')
    expect(screen.getByTestId('playback-state').getAttribute('data-state')).toBe(
      before.playbackState,
    )
  })

  it('P6-R03: 修正後の再貼付で成功し、失敗表示が消える', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    const textarea = screen.getByTestId('import-textarea')
    await user.click(textarea)
    await user.paste('{}')
    await user.click(screen.getByTestId('import-button'))
    expect(screen.getByTestId('import-issues')).toBeInTheDocument()

    await user.clear(textarea)
    await user.click(textarea)
    await user.paste(exampleJsonFor(app, 'tmpl-filter-basic'))
    await user.click(screen.getByTestId('import-button'))
    expect(screen.queryByTestId('import-issues')).toBeNull()
    expect(screen.getByTestId('import-accepted')).toBeInTheDocument()
  })
})

describe('P6-R04 取込成立表示', () => {
  it('P6-R04: 取込サンプルバッジ・title / descriptionの表示・初期snapshot表示', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    const json = JSON.parse(exampleJsonFor(app, 'tmpl-filter-basic')) as Record<string, unknown>
    json['title'] = '取込タイトル<b>強調</b>'
    json['description'] = '説明<script>alert(1)</script>'

    await user.click(screen.getByTestId('import-textarea'))
    await user.paste(JSON.stringify(json))
    await user.click(screen.getByTestId('import-button'))

    expect(screen.getByTestId('provenance').textContent).toBe('取込サンプル')
    // HTMLとして解釈されず、テキストとして表示される
    const description = document.querySelector('.scenario-description') as HTMLElement
    expect(description.textContent).toContain('取込タイトル<b>強調</b>')
    expect(description.textContent).toContain('説明<script>alert(1)</script>')
    expect(description.querySelector('b')).toBeNull()
    expect(description.querySelector('script')).toBeNull()

    // history初期化後の初期snapshotが表示されている
    const state = app.session.getState()
    expect(state.cursor).toBe(0)
    expect(state.historyLength).toBe(1)
    expect(screen.getByTestId('playback-state').getAttribute('data-state')).toBe('READY')
    expect(screen.getByRole('button', { name: '戻る' })).toBeDisabled()
  })

  it('P6-R04: 取込後も進む操作で終端まで到達できる', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await user.click(screen.getByTestId('import-textarea'))
    await user.paste(exampleJsonFor(app, 'tmpl-filter-basic'))
    await user.click(screen.getByTestId('import-button'))

    const forward = screen.getByRole('button', { name: '進む' })
    for (let i = 0; i < 40 && !(forward as HTMLButtonElement).disabled; i++) {
      await user.click(forward)
    }
    expect(screen.getByTestId('playback-state').getAttribute('data-state')).toBe('COMPLETED')
    expect(app.session.getState().scenario.provenance.providerKind).toBe('IMPORTED')
  })
})

describe('P6-R05 実行不能template', () => {
  it('P6-R05: 実行不能templateは取込対象外であり、UIの教材Pipeline選択に現れない', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    for (const templateId of ['tmpl-src-generate', 'tmpl-src-iterate2']) {
      const importability = app.importabilityOf(templateId)
      expect(importability.importable, templateId).toBe(false)
      expect(importability.reason, templateId).toContain('limit')
    }
    // 実行不能templateはUIから選択できない（generate操作ではlimit付きtemplateだけが並ぶ）
    await user.selectOptions(screen.getByTestId('operation-select'), 'source.generate')
    const templateSelect = screen.getByTestId('template-select') as HTMLSelectElement
    const values = Array.from(templateSelect.options).map((o) => o.value)
    expect(values).not.toContain('tmpl-src-generate')
    expect(values).toContain('tmpl-limit-generate')
    // 選択中のtemplate（limit付き）は取込対象であり、両操作が有効
    expect(screen.getByTestId('copy-prompt-button')).toBeEnabled()
    expect(screen.getByTestId('import-button')).toBeEnabled()
  })

  it('P6-R05: importabilityがfalseのときは両ボタンがdisabledになり理由を表示する', () => {
    const scheduler = new FakeScheduler()
    const app = createApp({ scheduler })
    const disabledApp = {
      ...app,
      importabilityOf: () => ({ importable: false, reason: 'テスト用の取込対象外理由です' }),
    }
    render(<App app={disabledApp} />)
    expect(screen.getByTestId('copy-prompt-button')).toBeDisabled()
    expect(screen.getByTestId('import-button')).toBeDisabled()
    expect(screen.getByTestId('import-textarea')).toBeDisabled()
    const reason = screen.getByTestId('import-disabled-reason')
    expect(reason.textContent).toContain('テスト用の取込対象外理由です')
    // 色以外（記号）でも識別できる
    expect(reason.textContent).toContain('×')
  })
})

describe('P6-R06 a11y・responsive', () => {
  it('P6-R06: 取込UIはキーボード操作でき、focus-visible対象のnativeコントロールで構成される', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    const copyButton = screen.getByTestId('copy-prompt-button')
    const importButton = screen.getByTestId('import-button')
    const textarea = screen.getByTestId('import-textarea')
    for (const element of [copyButton, importButton, textarea]) {
      expect(element.tagName === 'BUTTON' || element.tagName === 'TEXTAREA').toBe(true)
      expect(element.getAttribute('tabindex')).toBeNull()
    }
    // Tabでフォーカスが移動する
    copyButton.focus()
    expect(document.activeElement).toBe(copyButton)
    await user.tab()
    expect(document.activeElement).toBe(importButton)
    await user.tab()
    expect(document.activeElement).toBe(textarea)
    // キーボードだけで取込を実行できる
    await user.paste(exampleJsonFor(app, 'tmpl-filter-basic'))
    importButton.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('import-accepted')).toBeInTheDocument()
  })

  it('P6-R06: 取込UIは常設パネルでモーダルを使わず、aria-labelと見出しを持つ', () => {
    renderApp()
    const panel = screen.getByTestId('import-panel')
    expect(panel.getAttribute('aria-label')).toBe('候補の取込')
    expect(panel.querySelector('h3')?.textContent).toContain('候補の取込')
    // モーダルダイアログは使用しない（v0.10 §8）
    expect(panel.querySelector('dialog')).toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    // 既存P1-E08の`locator('summary')`を曖昧にしないため、取込UIは<summary>を追加しない
    expect(panel.querySelector('summary')).toBeNull()
    expect(document.querySelectorAll('summary')).toHaveLength(1)
    // textareaにはラベルがある
    expect(screen.getByLabelText('候補JSON')).toBeInTheDocument()
  })

  it('P6-R06: 取込UIは狭幅で縦積みになる（flex-direction: column指定のラベル構造）', () => {
    renderApp()
    const label = screen.getByTestId('import-textarea').closest('label')
    expect(label?.className).toContain('import-textarea-label')
    const actions = document.querySelector('.import-actions')
    expect(actions).not.toBeNull()
    // 横並びボタンはflex-wrapで折り返す（CSSはstyles.cssで定義）
    expect(actions?.children.length).toBe(2)
  })

  it('P6-R06: reduced motion環境でも取込UIが機能する', async () => {
    const matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    const original = window.matchMedia
    window.matchMedia = matchMedia
    try {
      const user = userEvent.setup()
      const { app } = renderApp()
      await user.click(screen.getByTestId('import-textarea'))
      await user.paste(exampleJsonFor(app, 'tmpl-filter-basic'))
      await user.click(screen.getByTestId('import-button'))
      expect(screen.getByTestId('import-accepted')).toBeInTheDocument()
    } finally {
      window.matchMedia = original
    }
  })
})
