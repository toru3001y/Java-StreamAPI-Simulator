// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/ui/App'
import { createApp, type AppInstance } from '../../src/ui/appInstance'
import { FakeScheduler } from '../helpers'
import type { Snapshot } from '../../src/domain/engine/snapshot'

/** P4-R01〜P4-R10: React統合テスト（Phase 4指示 §12・§13）。UIは確定snapshotの描画だけを検証する。 */
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

async function selectMode(user: ReturnType<typeof userEvent.setup>, mode: string) {
  await user.selectOptions(screen.getByTestId('mode-select'), mode)
}

afterEach(() => {
  cleanup()
})

describe('P4 React統合', () => {
  it('P4-R01: Phase 4の終端操作とPhase 5のCollector操作が選択可能で、未実装リストが空である', async () => {
    const user = userEvent.setup()
    renderApp()
    const select = screen.getByTestId('operation-select') as HTMLSelectElement
    const options = [...select.querySelectorAll('option')]
    const byValue = (v: string) => options.find((o) => o.value === v)
    for (const op of [
      'reduce',
      'count',
      'min',
      'max',
      'findFirst',
      'findAny',
      'anyMatch',
      'allMatch',
      'noneMatch',
      'sum',
      'average',
      'summaryStatistics',
      'toArray',
      'forEach',
      'forEachOrdered',
    ]) {
      expect(byValue(op), op).toBeDefined()
      expect(byValue(op)?.disabled, op).toBe(false)
    }
    // Phase 5指示§10.1により、Phase 5の未実装項目は0件へ移行した。
    // 「Phase 5で実装予定」文言の検証を「未実装リストが空・空optgroup非描画・
    // Collector操作が選択可能」の検証へ更新する（Phase 4終端の検証意味は上で維持）
    const unimplemented = options.filter((o) => o.value.startsWith('unimplemented-'))
    expect(unimplemented).toHaveLength(0)
    expect(within(screen.getByTestId('operation-select')).queryByText(/未実装/)).toBeNull()
    for (const op of ['collect', 'collectTriple']) {
      expect(byValue(op), op).toBeDefined()
      expect(byValue(op)?.disabled, op).toBe(false)
    }
    // 終端操作を選択するとscenarioが切替わる
    await selectOperation(user, 'count')
    expect(screen.getByTestId('java-code-panel').textContent).toContain('.count();')
  })

  it('P4-R02: Optionalのpresent / empty表示', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await selectOperation(user, 'min')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    expect(screen.getByTestId('output-optional')).toHaveAttribute('data-present')
    expect(screen.getByTestId('optional-value').textContent).toBe('Optional[鈴木（age=27）]')
    // empty表示
    await selectMode(user, 'emptySource')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    expect(screen.getByTestId('optional-empty').textContent).toContain('Optional.empty()')
  })

  it('P4-R03: reduceのaccumulator表示', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await selectOperation(user, 'reduce')
    await selectTemplate(user, 'tmpl-reduce-salary')
    // identity初期化snapshotで常時表示
    await clickForward(user, 1)
    expect(app.session.getState().snapshot.kind).toBe('REDUCTION_INITIALIZED')
    expect(screen.getByTestId('reduce-identity').textContent).toContain('0L')
    // accumulator履歴が増える
    await forwardUntil(user, app, (s) => {
      const ctx = s.operationContexts['node-sink']
      return ctx?.kind === 'reduce' && ctx.stepCount === 2
    })
    const history = screen.getByTestId('reduce-history')
    expect(within(history).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByTestId('reduce-accumulator').textContent).toContain('9_700_000L')
    // combiner 0回の表示
    expect(screen.getByTestId('reduce-combiner-note').textContent).toContain('0回')
  })

  it('P4-R04: min/maxの候補表示', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await selectOperation(user, 'min')
    // 鈴木で候補更新されるまで進める
    await forwardUntil(user, app, (s) => {
      const ctx = s.operationContexts['node-sink']
      return ctx?.kind === 'minmax' && ctx.candidateLabel === '鈴木（age=27）'
    })
    expect(screen.getByTestId('minmax-candidate').textContent).toContain('鈴木')
    expect(screen.getByTestId('minmax-comparator').textContent).toBe(
      'Comparator.comparingInt(Employee::age)',
    )
  })

  it('P4-R05: match/findのSTOPと未評価表示', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await selectOperation(user, 'anyMatch')
    await forwardUntil(user, app, (s) => s.kind === 'SHORT_CIRCUIT_CONFIRMED')
    expect(screen.getByTestId('match-decided').textContent).toContain('STOP')
    expect(screen.getByTestId('match-progress').textContent).toContain('結果: true')
    // 田中は未評価のまま
    expect(
      document.querySelector('.element-row[data-element-id="emp-004"]')?.getAttribute('data-state'),
    ).toBe('UNEVALUATED')
    // findFirstのSTOP表示
    await selectOperation(user, 'findFirst')
    await forwardUntil(user, app, (s) => s.kind === 'SHORT_CIRCUIT_CONFIRMED')
    expect(screen.getByTestId('find-decided')).toBeInTheDocument()
    expect(screen.getByTestId('find-selected').textContent).toContain('佐藤')
    expect(
      document.querySelector('.element-row[data-element-id="emp-002"]')?.getAttribute('data-state'),
    ).toBe('UNEVALUATED')
  })

  it('P4-R06: vacuous truth説明', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await selectOperation(user, 'allMatch')
    await selectMode(user, 'emptySource')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    expect(screen.getByTestId('output-scalar').textContent).toContain('true')
    expect(screen.getByTestId('match-vacuous-note').textContent).toContain('vacuous truth')
    expect(screen.getByTestId('match-vacuous-note').textContent).toContain('一度も評価されていません')
  })

  it('P4-R07: sum / average / statisticsの表示', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await selectOperation(user, 'sum')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    expect(screen.getByTestId('output-scalar').textContent).toContain('8')
    await selectOperation(user, 'average')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    expect(screen.getByTestId('optional-value').textContent).toBe('OptionalDouble[2.5]')
    await selectOperation(user, 'summaryStatistics')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    const stats = screen.getByTestId('output-statistics')
    expect(within(stats).getByTestId('stats-count').textContent).toBe('4')
    expect(within(stats).getByTestId('stats-sum').textContent).toBe('10L')
    expect(within(stats).getByTestId('stats-min').textContent).toBe('1')
    expect(within(stats).getByTestId('stats-average').textContent).toBe('2.5')
    expect(within(stats).getByTestId('stats-max').textContent).toBe('4')
    // 空の正規初期値
    await selectMode(user, 'emptySource')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    expect(within(screen.getByTestId('output-statistics')).getByTestId('stats-min').textContent).toBe(
      'Integer.MAX_VALUE',
    )
    expect(screen.getByTestId('stats-empty-note')).toBeInTheDocument()
  })

  it('P4-R08: 配列のcomponent type・length・index表示', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await selectOperation(user, 'toArray')
    await selectTemplate(user, 'tmpl-toarray-generator')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    expect(screen.getByTestId('array-meta').textContent).toContain('String')
    expect(screen.getByTestId('array-meta').textContent).toContain('length: 2')
    const items = within(screen.getByTestId('array-items')).getAllByRole('listitem')
    expect(items[0]?.textContent).toContain('[0]')
    expect(items[0]?.textContent).toContain('"Java"')
    // 空配列
    await selectMode(user, 'emptySource')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    expect(screen.getByTestId('array-meta').textContent).toContain('length: 0')
  })

  it('P4-R09: forEach系のSide Effect表示とvoid結果', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await selectOperation(user, 'forEach')
    expect(screen.getByTestId('side-effect-panel')).toBeInTheDocument()
    expect(screen.getByTestId('side-effect-empty').textContent).toContain('0回')
    await forwardUntil(user, app, (s) => s.sideEffects.length === 2)
    const list = screen.getByTestId('side-effect-list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(list.textContent).toContain('佐藤')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    expect(screen.getByTestId('output-void').textContent).toContain('void')
    expect(screen.getByTestId('foreach-call-count').textContent).toContain('4回')
  })

  it('P4-R10: findAny・count注記・traits・凡例・STREAM CONSUMED表示', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    // findAnyの非決定性は常時表示（初期snapshotから）
    await selectOperation(user, 'findAny')
    expect(screen.getByTestId('find-nondeterminism-note').textContent).toContain('保証しません')
    // countの評価省略注記も常時表示
    await selectOperation(user, 'count')
    expect(screen.getByTestId('count-elision-note').textContent).toContain('省略')
    // traits badge: findFirstはTERMINAL + SHORT_CIRCUITING、countはSHORT_CIRCUITINGなし
    await selectOperation(user, 'findFirst')
    const sinkNode = document.querySelector('.pipeline-node[data-node-id="node-sink"]')
    expect(sinkNode?.textContent).toContain('TERMINAL')
    expect(sinkNode?.textContent).toContain('SHORT_CIRCUITING')
    await selectOperation(user, 'count')
    const countNode = document.querySelector('.pipeline-node[data-node-id="node-sink"]')
    expect(countNode?.textContent).not.toContain('SHORT_CIRCUITING')
    // 凡例はバッファ済みを含まない（count）
    expect(screen.getByTestId('legend').textContent).not.toContain('バッファ済み')
    // STREAM CONSUMED表示
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    expect(screen.getByTestId('explanation-current').textContent).toContain('STREAM CONSUMED')
    expect(screen.getByTestId('playback-state').getAttribute('data-state')).toBe('COMPLETED')
  })
})
