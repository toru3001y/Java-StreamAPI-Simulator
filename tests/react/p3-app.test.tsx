// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/ui/App'
import { createApp, type AppInstance } from '../../src/ui/appInstance'
import { FakeScheduler } from '../helpers'
import type { Snapshot } from '../../src/domain/engine/snapshot'

/** P3-R01〜P3-R10: React統合テスト（Phase 3指示 §13.3）。UIは確定snapshotの描画だけを検証する。 */
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

async function forwardUntil(
  user: ReturnType<typeof userEvent.setup>,
  app: AppInstance,
  predicate: (s: Snapshot) => boolean,
  max = 120,
) {
  const button = screen.getByRole('button', { name: '進む' })
  for (let i = 0; i < max; i++) {
    if (predicate(app.session.getState().snapshot)) return
    await user.click(button)
  }
  throw new Error('forwardUntil: 条件に到達しません')
}

async function selectOperation(user: ReturnType<typeof userEvent.setup>, operationId: string) {
  await user.selectOptions(screen.getByTestId('operation-select'), operationId)
}

async function selectTemplate(user: ReturnType<typeof userEvent.setup>, templateId: string) {
  await user.selectOptions(screen.getByTestId('template-select'), templateId)
}

afterEach(() => {
  cleanup()
})

describe('P3 React統合', () => {
  it('P3-R01: Phase 3操作とtemplateを選択でき、未実装リストが空である', async () => {
    const user = userEvent.setup()
    renderApp()
    const select = screen.getByTestId('operation-select') as HTMLSelectElement
    const options = [...select.querySelectorAll('option')]
    const byValue = (v: string) => options.find((o) => o.value === v)
    // Phase 3の7操作が選択可能
    for (const op of ['distinct', 'sorted', 'limit', 'skip', 'takeWhile', 'dropWhile', 'peek']) {
      expect(byValue(op), op).toBeDefined()
      expect(byValue(op)?.disabled, op).toBe(false)
    }
    // Phase 5指示§10.1により未実装リストは0件となった（Phase 3時点の未実装表示検証を
    // 「未実装リストが空で、空のoptgroupを描画しない」の検証へ更新する）
    const unimplemented = options.filter((o) => o.value.startsWith('unimplemented-'))
    expect(unimplemented).toHaveLength(0)
    expect(within(screen.getByTestId('operation-select')).queryByText(/未実装/)).toBeNull()
    // sortedはnatural / Comparatorのtemplateを区別して選択できる
    await selectOperation(user, 'sorted')
    const templateSelect = screen.getByTestId('template-select') as HTMLSelectElement
    const templateIds = [...templateSelect.querySelectorAll('option')].map((o) => o.value)
    expect(templateIds).toContain('tmpl-sorted-natural')
    expect(templateIds).toContain('tmpl-sorted-comparator')
  })

  it('P3-R02: distinctのseen・現在値・初登場 / 重複・通過 / 除外をsnapshotから描画する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await selectOperation(user, 'distinct')
    // 3件目（重複"Java"）のDISTINCT_CHECKEDまで進める
    await forwardUntil(
      user,
      app,
      (s) => s.kind === 'DISTINCT_CHECKED' && s.currentElementId === 'of-003',
    )
    const panel = screen.getByTestId('op-context-distinct')
    expect(screen.getByTestId('distinct-verdict').textContent).toBe('重複')
    const seen = within(panel).getByTestId('distinct-seen')
    expect(within(seen).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['"Java"', '"SQL"'])
    // 除外確定後、入力パネルの重複要素が除外済みになる
    await clickForward(user, 1)
    const row = document.querySelector('.element-row[data-element-id="of-003"]')
    expect(row?.getAttribute('data-state')).toBe('REJECTED')
    expect(row?.textContent).toContain('除外済み')
  })

  it('P3-R03: sortedのbuffer・Comparatorキー・確定順・放出位置・phaseを描画する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await selectOperation(user, 'sorted')
    await selectTemplate(user, 'tmpl-sorted-comparator')
    // 並べ替え確定まで進める
    await forwardUntil(user, app, (s) => s.kind === 'SORT_ORDER_CONFIRMED')
    const panel = screen.getByTestId('op-context-sorted')
    expect(screen.getByTestId('sorted-phase').getAttribute('data-phase')).toBe('ORDER_CONFIRMED')
    expect(screen.getByTestId('sorted-comparator').textContent).toBe(
      'Comparator.comparing(Employee::region)',
    )
    // 元buffer順とキー
    const buffer = within(panel).getByTestId('sorted-buffer')
    expect(buffer.textContent).toContain('佐藤')
    expect(buffer.textContent).toContain('region="関東"')
    // 確定順序（田中 → 佐藤 → 高橋 → 鈴木）と放出位置
    const confirmed = within(panel).getByTestId('sorted-confirmed')
    const items = within(confirmed).getAllByRole('listitem')
    expect(items[0]?.textContent).toContain('田中')
    expect(screen.getByTestId('sorted-emit-position').textContent).toContain('0/4')
    // 処理中パネルは「buffer全体の順序確定」を示し、処理中要素は0件（J-2）
    expect(screen.getByTestId('processing-panel').textContent).toContain('buffer全体')
    expect(app.session.getState().snapshot.currentElementId).toBeNull()
    // 1件放出後は放出位置が1になる
    await clickForward(user, 1)
    expect(screen.getByTestId('sorted-emit-position').textContent).toContain('1/4')
  })

  it('P3-R04: limit / skipのn/N・短絡 / 通過モード・残り未評価を描画する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await selectOperation(user, 'limit')
    await forwardUntil(user, app, (s) => s.kind === 'SHORT_CIRCUIT_CONFIRMED')
    expect(screen.getByTestId('limit-count').textContent).toContain('3/3')
    expect(screen.getByTestId('limit-reached')).toBeInTheDocument()
    expect(screen.getByTestId('limit-upstream-stopped').textContent).toContain('未評価')
    // 残り要素（4, 5）は入力パネルで未評価のまま
    expect(
      document.querySelector('.element-row[data-element-id="n-004"]')?.getAttribute('data-state'),
    ).toBe('UNEVALUATED')
    // skip: 通過モードとn/N
    await selectOperation(user, 'skip')
    await forwardUntil(user, app, (s) => s.kind === 'ELEMENT_PASSED')
    expect(screen.getByTestId('skip-count').textContent).toContain('2/2')
    expect(screen.getByTestId('skip-pass-mode')).toBeInTheDocument()
  })

  it('P3-R05: take/dropの境界・STOP / 通過モード・Predicate非評価範囲を描画する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await selectOperation(user, 'takeWhile')
    await forwardUntil(user, app, (s) => s.kind === 'SHORT_CIRCUIT_CONFIRMED')
    expect(screen.getByTestId('takewhile-stop').textContent).toContain('STOP')
    expect(screen.getByTestId('takewhile-predicate').textContent).toBe('n -> n < 5')
    // 境界（6）と、実際には評価されない未評価範囲（3, 7）の説明
    expect(screen.getByTestId('takewhile-boundary').textContent).toContain('6')
    expect(screen.getByTestId('takewhile-boundary').textContent).toContain('評価されず')
    expect(
      document.querySelector('.element-row[data-element-id="numbers-004"]')?.getAttribute('data-state'),
    ).toBe('UNEVALUATED')
    // dropWhile: drop中 → 通過モード
    await selectOperation(user, 'dropWhile')
    expect(screen.getByTestId('dropwhile-mode').getAttribute('data-mode')).toBe('DROPPING')
    await forwardUntil(user, app, (s) => s.kind === 'DROP_MODE_ENTERED')
    expect(screen.getByTestId('dropwhile-mode').getAttribute('data-mode')).toBe('PASSING')
    expect(screen.getByTestId('dropwhile-boundary').textContent).toContain('6')
    expect(screen.getByTestId('dropwhile-boundary').textContent).toContain('再評価せず')
  })

  it('P3-R06: peekのaction履歴と通常結果を分離し、0回状態も表示する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await selectOperation(user, 'peek')
    // 初期状態: Side Effectビューは0回表示
    expect(screen.getByTestId('side-effect-panel')).toBeInTheDocument()
    expect(screen.getByTestId('side-effect-empty').textContent).toContain('0回')
    // 2回のaction後: 履歴が2件
    await forwardUntil(user, app, (s) => s.sideEffects.length === 2)
    const list = screen.getByTestId('side-effect-list')
    const entries = within(list).getAllByRole('listitem')
    expect(entries).toHaveLength(2)
    expect(entries[0]?.textContent).toContain('佐藤')
    expect(entries[1]?.textContent).toContain('鈴木')
    // 通常の出力パネルとは別領域（Side EffectはStream結果に影響しない）
    const output = screen.getByTestId('output-panel')
    expect(output.contains(list)).toBe(false)
  })

  it('P3-R07: generate / iterate2が実行可能で、source infiniteとlimit有限化を区別表示する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await selectOperation(user, 'source.generate')
    // 実行可能（limit付きtemplate）
    expect(app.session.getState().scenario.pipeline.templateId).toBe('tmpl-limit-generate')
    // sourceは無限のまま、limitで有限化していることを表示
    const note = screen.getByTestId('infinite-source-note')
    expect(note.textContent).toContain('無限source')
    expect(note.textContent).toContain('unordered')
    expect(note.textContent).toContain('limit')
    // 要求前は要素を表示しない（存在しない残り全件を配列表示しない）
    expect(screen.getByTestId('infinite-source-unrequested')).toBeInTheDocument()
    await clickForward(user, 1)
    expect(document.querySelectorAll('.element-row')).toHaveLength(1)
    // iterate2も実行可能
    await selectOperation(user, 'source.iterate2')
    expect(app.session.getState().scenario.pipeline.templateId).toBe('tmpl-limit-iterate2')
  })

  it('P3-R08: active nodeの行だけを強調し、DSLと同じ式・キー・actionを表示する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await selectOperation(user, 'sorted')
    await selectTemplate(user, 'tmpl-sorted-comparator')
    await forwardUntil(user, app, (s) => s.kind === 'SORT_ORDER_CONFIRMED')
    // sortedノードの行だけが強調される
    const activeLines = document.querySelectorAll('.code-line[data-active]')
    expect(activeLines).toHaveLength(1)
    expect(activeLines[0]?.getAttribute('data-line-id')).toBe('line-node-sorted')
    expect(activeLines[0]?.textContent).toContain('.sorted(Comparator.comparing(Employee::region))')
    // 処理中パネルの式もDSL由来の同じ文字列
    expect(screen.getByTestId('processing-expression').textContent).toBe(
      '.sorted(Comparator.comparing(Employee::region))',
    )
  })

  it('P3-R09: 選択操作に必要な状態だけを凡例表示し、STATEFUL / SHORT_CIRCUITINGを識別できる', async () => {
    const user = userEvent.setup()
    renderApp()
    // sorted: バッファ済みを含む凡例
    await selectOperation(user, 'sorted')
    const legend = screen.getByTestId('legend')
    expect(legend.textContent).toContain('バッファ済み')
    // limit: 除外済みを含まない凡例
    await selectOperation(user, 'limit')
    expect(screen.getByTestId('legend').textContent).not.toContain('除外済み')
    // traits badge: takeWhileはSTATEFUL + SHORT_CIRCUITING、dropWhileはSHORT_CIRCUITINGなし
    await selectOperation(user, 'takeWhile')
    const takeNode = document.querySelector('.pipeline-node[data-node-id="node-takewhile"]')
    expect(takeNode?.textContent).toContain('STATEFUL')
    expect(takeNode?.textContent).toContain('SHORT_CIRCUITING')
    await selectOperation(user, 'dropWhile')
    const dropNode = document.querySelector('.pipeline-node[data-node-id="node-dropwhile"]')
    expect(dropNode?.textContent).toContain('STATEFUL')
    expect(dropNode?.textContent).not.toContain('SHORT_CIRCUITING')
  })

  it('P3-R10: keyboard・focus・aria・状態文言のアクセシビリティを維持する', async () => {
    const user = userEvent.setup()
    renderApp()
    await selectOperation(user, 'peek')
    // Side Effectビューを含む各パネルがaria-labelを持つ
    expect(screen.getByLabelText('入力')).toBeInTheDocument()
    expect(screen.getByLabelText('処理中')).toBeInTheDocument()
    expect(screen.getByLabelText('出力')).toBeInTheDocument()
    expect(screen.getByLabelText('Side Effect')).toBeInTheDocument()
    // 状態は色だけでなく記号・文言で識別できる
    await clickForward(user, 3)
    const row = document.querySelector('.element-row[data-element-id="emp-001"]')
    expect(row?.textContent).toMatch(/通過済み|処理中/)
    expect(row?.querySelector('.state-symbol')).not.toBeNull()
    // 操作ボタンはaccessible nameを持ち、キーボードで操作できる
    const forward = screen.getByRole('button', { name: '進む' })
    forward.focus()
    expect(document.activeElement).toBe(forward)
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('playback-position').textContent).toContain('snapshot 5')
  })
})
