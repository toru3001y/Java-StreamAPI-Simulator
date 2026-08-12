// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/ui/App'
import { createApp, type AppInstance } from '../../src/ui/appInstance'
import { FakeScheduler } from '../helpers'
import type { Snapshot } from '../../src/domain/engine/snapshot'
import { P7_TEMPLATES } from '../../src/domain/template/templatesP7'
import { GATHER_NOT_IMPORTABLE_REASON } from '../../src/application/importContract'

/**
 * P7-R01〜P7-R06: React統合テスト（Phase 7指示 §12.3、v0.9 §5）。
 * UIは確定snapshotのview値だけを描画し、結果・型・蓄積状態・表示順を独自計算しない。
 *
 * 複数のGatherer教材を終端まで進めるため、ファイル単位でtimeoutを引き上げる
 * （skipや期待値緩和ではなく、実行時間の確保のみ）。
 */
vi.setConfig({ testTimeout: 60_000 })

function renderApp() {
  const scheduler = new FakeScheduler()
  const app = createApp({ scheduler })
  const utils = render(<App app={app} />)
  return { app, scheduler, ...utils }
}

async function forwardUntil(
  user: ReturnType<typeof userEvent.setup>,
  app: AppInstance,
  predicate: (s: Snapshot) => boolean,
  max = 200,
) {
  const button = screen.getByRole('button', { name: '進む' })
  for (let i = 0; i < max; i++) {
    if (predicate(app.session.getState().snapshot)) return
    await user.click(button)
  }
  throw new Error('forwardUntil: 条件に到達しません')
}

async function openGather(
  user: ReturnType<typeof userEvent.setup>,
  templateId: string,
  mode?: string,
) {
  await user.selectOptions(screen.getByTestId('operation-select'), 'gather')
  await user.selectOptions(screen.getByTestId('template-select'), templateId)
  if (mode) await user.selectOptions(screen.getByTestId('mode-select'), mode)
}

afterEach(() => cleanup())

describe('P7-R01 Gatherer構造パネル', () => {
  it('P7-R01: 4構成要素の行が常設され、combinerは呼出し0回の意味論を表示する', async () => {
    const user = userEvent.setup()
    renderApp()
    for (const templateId of P7_TEMPLATES.map((t) => t.templateId)) {
      await openGather(user, templateId)
      const panel = screen.getByTestId('op-context-gather')
      const elements = within(panel).getByTestId('gatherer-elements')
      // 4行が常設（実行前から表示される）
      for (const name of ['initializer', 'integrator', 'combiner', 'finisher']) {
        expect(
          within(elements).getByTestId(`gatherer-element-${name}`),
          `${templateId}.${name}`,
        ).toBeInTheDocument()
      }
      const combiner = within(elements).getByTestId('gatherer-element-combiner')
      expect(combiner.textContent, templateId).toContain('呼出し 0回')
      expect(combiner.textContent, templateId).toContain('並列実行時に2つの中間状態を結合')
    }
  })

  it('P7-R01: scanのfinisher行は「終端での追加産出なし」の意味論を表示する', async () => {
    const user = userEvent.setup()
    renderApp()
    await openGather(user, 'tmpl-gather-scan')
    const finisher = screen.getByTestId('gatherer-element-finisher')
    expect(finisher.textContent).toContain('終端での追加産出はありません')
    // 「finisherが無い」というJDK実装同一性の断定はしない（v0.9 §5）
    expect(finisher.textContent).not.toContain('finisherが無い')
    expect(finisher.textContent).not.toContain('finisherは存在しません')
  })

  it('P7-R01: JDK実装同一性を断定しない旨の注記がある', async () => {
    const user = userEvent.setup()
    renderApp()
    await openGather(user, 'tmpl-gather-window-fixed')
    const note = screen.getByTestId('gatherer-model-note')
    expect(note.textContent).toContain('教材モデル上の割当て')
    expect(note.textContent).toContain('断定するものではありません')
  })

  it('P7-R01: Oracle観測の反映は「どのJDKでの観測か」を明示する（v0.9 §10-3）', async () => {
    const user = userEvent.setup()
    renderApp()
    for (const [templateId, expectedFinisher] of [
      ['tmpl-gather-window-fixed', 'defaultFinisher()とは別の実装'],
      ['tmpl-gather-window-sliding', 'defaultFinisher()とは別の実装'],
      // scanのfinisherはdefaultFinisher()と同一だった（終端での追加産出なしと整合）
      ['tmpl-gather-scan', 'defaultFinisher()と同一'],
      ['tmpl-gather-fold', 'defaultFinisher()とは別の実装'],
    ] as const) {
      await openGather(user, templateId)
      const note = screen.getByTestId('gatherer-observation-note')
      expect(note.textContent, templateId).toContain('OpenJDK Temurin 25.0.3+9での観測')
      expect(note.textContent, templateId).toContain('Gatherer.Integrator.Greedy')
      expect(note.textContent, templateId).toContain(expectedFinisher)
      // 観測であってJDKの保証ではない旨を明示する
      expect(note.textContent, templateId).toContain('JDKの保証ではありません')
    }
  })

  it('P7-R01: integratorの呼出し回数が実行に応じて増える（snapshot由来）', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openGather(user, 'tmpl-gather-fold')
    expect(screen.getByTestId('gatherer-element-integrator').textContent).toContain('呼出し 0回')
    await forwardUntil(user, app, (s) => s.kind === 'FOLD_ACCUMULATED')
    expect(screen.getByTestId('gatherer-element-integrator').textContent).toContain('呼出し 1回')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    expect(screen.getByTestId('gatherer-element-integrator').textContent).toContain('呼出し 4回')
    // combinerは実行後も0回のまま
    expect(screen.getByTestId('gatherer-element-combiner').textContent).toContain('呼出し 0回')
  })
})

describe('P7-R02 window表示', () => {
  it('P7-R02: バッファ内容・窓メンバー・unmodifiable注記・型遷移を表示する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openGather(user, 'tmpl-gather-window-fixed')
    // 型遷移（window系は要素型がListになることを強調する）
    const transition = screen.getByTestId('gatherer-type-transition')
    expect(transition.textContent).toContain('Stream<Employee> → Stream<List<Employee>>')
    expect(screen.getByTestId('gatherer-window-type-note').textContent).toContain('List<Employee>')
    expect(screen.getByTestId('gatherer-window-size').textContent).toContain('3')
    expect(screen.getByTestId('gatherer-unmodifiable-note').textContent).toContain(
      'UnsupportedOperationException',
    )
    // バッファ蓄積
    await forwardUntil(user, app, (s) => s.kind === 'WINDOW_BUFFER_UPDATED')
    expect(screen.getByTestId('gatherer-buffer').textContent).toContain('佐藤')
    // 窓放出後はメンバーが表示される
    await forwardUntil(user, app, (s) => s.kind === 'GATHER_EMITTED')
    const emitted = screen.getByTestId('gatherer-emitted')
    expect(emitted.textContent).toContain('佐藤')
    expect(within(emitted).getAllByTestId('gatherer-emitted-members')[0]?.textContent).toContain(
      'emp-001',
    )
  })

  it('P7-R02: windowSlidingのevict要素を表示する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openGather(user, 'tmpl-gather-window-sliding')
    expect(screen.queryByTestId('gatherer-evicted')).toBeNull()
    // 3件目の到着でevictが発生する
    await forwardUntil(
      user,
      app,
      (s) => s.kind === 'WINDOW_BUFFER_UPDATED' && s.currentElementId === 'of-003',
    )
    const evicted = screen.getByTestId('gatherer-evicted')
    expect(evicted.textContent).toContain('"Java"')
    expect(evicted.textContent).toContain('最古を除き次を追加')
    expect(screen.getByTestId('gatherer-buffer').textContent).toContain('"SQL"')
  })
})

describe('P7-R03 scan / fold累積表示', () => {
  it('P7-R03: scanは初期値・累積履歴・逐次放出の区別を表示する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openGather(user, 'tmpl-gather-scan')
    expect(screen.getByTestId('gatherer-initial').textContent).toContain('0')
    expect(screen.getByTestId('gatherer-emit-policy').textContent).toContain('逐次放出')
    expect(screen.getByTestId('gatherer-history-empty')).toBeInTheDocument()
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    const history = screen.getByTestId('gatherer-history')
    expect(within(history).getAllByRole('listitem')).toHaveLength(3)
    expect(history.textContent).toContain('4')
    expect(history.textContent).toContain('8')
    expect(screen.getByTestId('gatherer-accumulator').textContent).toContain('8')
    // window系の表示は出ない
    expect(screen.queryByTestId('gatherer-window-size')).toBeNull()
  })

  it('P7-R03: foldは放出なし累積を表示し、reduceとの対比説明を含む', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openGather(user, 'tmpl-gather-fold')
    expect(screen.getByTestId('gatherer-emit-policy').textContent).toContain('放出なし累積')
    // 累積中は放出0件
    await forwardUntil(user, app, (s) => s.kind === 'FOLD_ACCUMULATED')
    expect(screen.getByTestId('gatherer-emitted-empty')).toBeInTheDocument()
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    expect(screen.getByTestId('gatherer-emitted').textContent).toContain('21_700_000L')
    expect(screen.getByTestId('gatherer-finished-note').textContent).toContain('21_700_000L')
    // foldとreduceの対比
    const contrast = screen.getByTestId('gatherer-reduce-contrast-note')
    expect(contrast.textContent).toContain('中間操作')
    expect(contrast.textContent).toContain('reduce')
  })

  it('P7-R03: scanとreduceの対比説明も表示される', async () => {
    const user = userEvent.setup()
    renderApp()
    await openGather(user, 'tmpl-gather-scan-concat')
    const contrast = screen.getByTestId('gatherer-reduce-contrast-note')
    expect(contrast.textContent).toContain('途中経過')
    expect(contrast.textContent).toContain('reduce')
  })
})

describe('P7-R04 操作選択・補助説明', () => {
  it('P7-R04: 「中間」optgroupへgatherが追加され、既存optgroup構成が不変である', () => {
    renderApp()
    const select = screen.getByTestId('operation-select') as HTMLSelectElement
    const groups = Array.from(select.querySelectorAll('optgroup')).map((g) => g.label)
    // optgroupの新設はない（Phase 6と同じ4種）
    expect(groups).toEqual(['生成', '中間', '終端', 'Collector'])
    const intermediate = Array.from(select.querySelectorAll('optgroup')).find(
      (g) => g.label === '中間',
    )!
    const values = Array.from(intermediate.querySelectorAll('option')).map((o) => o.value)
    expect(values).toContain('gather')
    // 組み込み4種は操作として並ばない
    for (const kind of ['windowFixed', 'windowSliding', 'scan', 'fold', 'mapConcurrent']) {
      expect(values, kind).not.toContain(kind)
    }
  })

  it('P7-R04: mapConcurrentの対象外理由が補助説明として表示される（UNIMPLEMENTED_OPERATIONSは使わない）', async () => {
    const user = userEvent.setup()
    renderApp()
    await openGather(user, 'tmpl-gather-window-fixed')
    const note = screen.getByTestId('gatherer-mapconcurrent-note')
    expect(note.textContent).toContain('mapConcurrent')
    expect(note.textContent).toContain('仮想スレッド')
    expect(note.textContent).toContain('実行対象にせず')
    // 「実装予定」表示の機構は使わない
    expect(screen.queryByTestId('unimplemented-operations')).toBeNull()
  })

  it('P7-R04: integrator falseの短絡とlimit / takeWhileの短絡の対比を補助説明する', async () => {
    const user = userEvent.setup()
    renderApp()
    await openGather(user, 'tmpl-gather-window-sliding')
    const note = screen.getByTestId('gatherer-short-circuit-note')
    expect(note.textContent).toContain('integrator')
    expect(note.textContent).toContain('false')
    expect(note.textContent).toContain('limit')
    expect(note.textContent).toContain('takeWhile')
  })
})

describe('P7-R05 取込UI無効化', () => {
  it('P7-R05: gather template選択中はコピー・貼付の両方が無効化され理由が表示される', async () => {
    const user = userEvent.setup()
    renderApp()
    for (const templateId of P7_TEMPLATES.map((t) => t.templateId)) {
      await openGather(user, templateId)
      expect(screen.getByTestId('copy-prompt-button'), templateId).toBeDisabled()
      expect(screen.getByTestId('import-button'), templateId).toBeDisabled()
      expect(screen.getByTestId('import-textarea'), templateId).toBeDisabled()
      const reason = screen.getByTestId('import-disabled-reason')
      expect(reason.textContent, templateId).toContain(GATHER_NOT_IMPORTABLE_REASON)
      // 色以外（記号）でも識別できる（P6-R05様式）
      expect(reason.textContent, templateId).toContain('×')
    }
  })

  it('P7-R05: 非gather templateへ戻すと取込UIが復帰する', async () => {
    const user = userEvent.setup()
    renderApp()
    await openGather(user, 'tmpl-gather-fold')
    expect(screen.getByTestId('copy-prompt-button')).toBeDisabled()
    await user.selectOptions(screen.getByTestId('operation-select'), 'filter')
    expect(screen.getByTestId('copy-prompt-button')).toBeEnabled()
    expect(screen.getByTestId('import-button')).toBeEnabled()
    expect(screen.getByTestId('import-textarea')).toBeEnabled()
    expect(screen.queryByTestId('import-disabled-reason')).toBeNull()
  })
})

describe('P7-R06 a11y・responsive', () => {
  it('P7-R06: gatherパネルがキーボード操作だけで到達・操作できる', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openGather(user, 'tmpl-gather-window-fixed')
    // 補助説明のsummaryはキーボードフォーカス可能（focus-visibleはCSSで付与）
    const summary = screen.getByTestId('gatherer-notes-summary')
    summary.focus()
    expect(document.activeElement).toBe(summary)
    // details配下の内容はDOM上に存在し、支援技術から到達できる
    // （<details>の開閉自体はブラウザのnative動作であり、実ブラウザ確認はP7-E05が担う）
    expect(screen.getByTestId('gatherer-mapconcurrent-note')).toBeInTheDocument()
    expect(screen.getByTestId('gatherer-short-circuit-note')).toBeInTheDocument()
    // 「進む」ボタンへキーボードで到達し、Enterでgather snapshotを進められる
    const forward = screen.getByRole('button', { name: '進む' })
    forward.focus()
    expect(document.activeElement).toBe(forward)
    const before = app.session.getState().cursor
    await user.keyboard('{Enter}')
    expect(app.session.getState().cursor).toBe(before + 1)
    expect(screen.getByTestId('op-context-gather')).toBeInTheDocument()
  })

  it('P7-R06: gatherパネルの構成要素表がテーブルセマンティクスを持つ（見出しつき）', async () => {
    const user = userEvent.setup()
    renderApp()
    await openGather(user, 'tmpl-gather-scan')
    const elements = screen.getByTestId('gatherer-elements')
    // 列見出し3つ（構成要素 / 状態 / 役割）と行見出し4つ
    expect(within(elements).getAllByRole('columnheader')).toHaveLength(3)
    expect(within(elements).getAllByRole('rowheader')).toHaveLength(4)
  })

  it('P7-R06: 横スクロール可能なコンテナに収まり、狭幅で内容が失われない', async () => {
    const user = userEvent.setup()
    renderApp()
    await openGather(user, 'tmpl-gather-window-fixed')
    const panel = screen.getByTestId('op-context-gather')
    // 横幅超過は専用コンテナのスクロールで吸収する（CSS: .gatherer-structure { overflow-x: auto }）
    expect(panel.className).toContain('gatherer-structure')
    expect(panel.getAttribute('data-gatherer-kind')).toBe('windowFixed')
    expect(panel.getAttribute('data-node-id')).toBe('node-gather')
  })

  it('P7-R06: 全gather template × modeでパネルが例外なく描画される', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    for (const template of P7_TEMPLATES) {
      for (const mode of template.supportedModes) {
        await openGather(user, template.templateId, mode)
        expect(screen.getByTestId('op-context-gather'), `${template.templateId}:${mode}`).toBeInTheDocument()
        await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
        expect(
          screen.getByTestId('op-context-gather'),
          `${template.templateId}:${mode} 終端`,
        ).toBeInTheDocument()
      }
    }
  })
})
