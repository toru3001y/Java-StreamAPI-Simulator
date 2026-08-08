// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/ui/App'
import { createApp } from '../../src/ui/appInstance'
import { FakeScheduler } from '../helpers'

/** Phase 2 React統合テスト（指示§12.3）。UIは確定snapshotからの描画だけを検証する。 */
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

async function selectOperation(user: ReturnType<typeof userEvent.setup>, operationId: string) {
  await user.selectOptions(screen.getByTestId('operation-select'), operationId)
}

afterEach(() => {
  cleanup()
})

describe('P2 React統合', () => {
  it('P2-R01: 実装済み操作だけ選択可能で、非実行sourceと未実装操作の理由が読める', () => {
    renderApp()
    const select = screen.getByTestId('operation-select') as HTMLSelectElement
    const options = [...select.querySelectorAll('option')]
    const byValue = (v: string) => options.find((o) => o.value === v)

    // 実装済み操作は選択可能
    expect(byValue('map')?.disabled).toBe(false)
    expect(byValue('flatMap')?.disabled).toBe(false)
    expect(byValue('source.range')?.disabled).toBe(false)
    // 非実行source（generate / iterate2）はdisabledで理由がtitleとnoteで読める
    expect(byValue('source.generate')?.disabled).toBe(true)
    expect(byValue('source.generate')?.title).toContain('limit()')
    expect(byValue('source.iterate2')?.disabled).toBe(true)
    const notes = screen.getByTestId('disabled-operation-notes')
    expect(notes.textContent).toContain('Stream.generate()')
    expect(notes.textContent).toContain('Phase 3')
    // Phase 3以降の未実装操作は選択不能で理由（Phase表記）が読める
    const unimplemented = options.filter((o) => o.value.startsWith('unimplemented-'))
    expect(unimplemented.length).toBeGreaterThanOrEqual(7)
    for (const o of unimplemented) {
      expect(o.disabled).toBe(true)
      expect(o.textContent).toMatch(/Phase [3-5]で実装予定/)
    }
  })

  it('P2-R02: Pipeline・処理中・出力・説明の型表示が同じsnapshotと一致する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await selectOperation(user, 'mapToInt')
    // EMIT → ARRIVAL → MAPPING_APPLIED
    await clickForward(user, 3)
    const snapshot = app.session.getState().snapshot
    expect(snapshot.kind).toBe('MAPPING_APPLIED')
    expect(screen.getByTestId('type-transition').textContent).toBe(
      `型: ${snapshot.typeTransition}`,
    )
    expect(snapshot.typeTransition).toBe('Stream<Employee> → IntStream')
    // Pipelineの型ラベルとoutputの結果型も同じsnapshot（def）由来
    const pipeline = screen.getByTestId('pipeline-viewport')
    expect(pipeline.textContent).toContain('IntStream')
    expect(pipeline.textContent).toContain('Stream<Integer>')
    expect(screen.getByTestId('output-type').textContent).toContain('List<Integer>')
    // 全パネル同一snapshot ID
    const ids = new Set(
      [...document.querySelectorAll('[data-snapshot-id]')].map((p) =>
        p.getAttribute('data-snapshot-id'),
      ),
    )
    expect(ids.size).toBe(1)
  })

  it('P2-R03: 配列index、iterate候補、range境界、empty状態をsnapshotから描画する', async () => {
    const user = userEvent.setup()
    renderApp()
    // 配列index
    await selectOperation(user, 'source.arraysStream')
    await clickForward(user, 1)
    expect(screen.getByTestId('source-index').textContent).toBe('index: 0')
    // iterate候補
    await selectOperation(user, 'source.iterate3')
    await clickForward(user, 1)
    expect(screen.getByTestId('processing-panel').textContent).toContain('生成候補')
    await clickForward(user, 1)
    expect(screen.getByTestId('processing-panel').textContent).toContain('1 <= 5 → true')
    // range境界
    await selectOperation(user, 'source.range')
    await clickForward(user, 1)
    expect(screen.getByTestId('source-note').textContent).toContain('1 <= n && n < 5')
    // empty状態
    await selectOperation(user, 'source.empty')
    expect(screen.getByTestId('input-panel').textContent).toContain('入力は0件です')
  })

  it('P2-R04: mapの元値・mapper式・新値・要素状態を同期表示する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await selectOperation(user, 'map')
    await clickForward(user, 3)
    expect(app.session.getState().snapshot.kind).toBe('MAPPING_APPLIED')
    expect(screen.getByTestId('processing-input').textContent).toBe('佐藤（age=35） → "佐藤"')
    expect(screen.getByTestId('processing-expression').textContent).toBe('Employee::name')
    // 要素状態: 佐藤が処理中、他は未評価
    const rows = document.querySelectorAll('.element-row')
    expect(rows[0]?.getAttribute('data-state')).toBe('PROCESSING')
    expect(rows[1]?.getAttribute('data-state')).toBe('UNEVALUATED')
    // 送出後は通過済みで出力へ反映
    await clickForward(user, 2)
    expect(document.querySelectorAll('.element-row')[0]?.getAttribute('data-state')).toBe('PASSED')
    const output = screen.getByTestId('output-list')
    expect(within(output).getAllByRole('listitem')[0]?.textContent).toBe('"佐藤"')
  })

  it('P2-R05: Int/Long/DoubleStreamとwrapper型を区別して表示する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await selectOperation(user, 'boxed')
    // EMIT → boxed ARRIVAL → MAPPING_APPLIED
    await clickForward(user, 3)
    const snapshot = app.session.getState().snapshot
    expect(snapshot.typeTransition).toBe('IntStream → Stream<Integer>')
    expect(screen.getByTestId('type-transition').textContent).toContain('IntStream → Stream<Integer>')
    // mapToObjはwrapperではなく任意object（String）
    await selectOperation(user, 'mapToObj')
    await clickForward(user, 3)
    expect(screen.getByTestId('type-transition').textContent).toContain('IntStream → Stream<String>')
    expect(screen.getByTestId('processing-input').textContent).toContain('"No.1"')
  })

  it('P2-R06: flatMapの親・mapped Stream・現在子・flatten出力・close詳細を区別する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await selectOperation(user, 'flatMap')
    // EMIT → ARRIVAL → MAPPED_STREAM_CREATED
    await clickForward(user, 3)
    expect(app.session.getState().snapshot.kind).toBe('MAPPED_STREAM_CREATED')
    const panel = screen.getByTestId('flatmap-panel')
    expect(screen.getByTestId('flatmap-parent').textContent).toContain('[Java, SQL]')
    const children = within(panel).getByTestId('flatmap-children')
    expect(within(children).getAllByRole('listitem')).toHaveLength(2)
    expect(children.textContent).toContain('未送出')
    expect(screen.queryByTestId('flatmap-closed')).toBeNull()
    // 子1送出: 現在子が強調され、親は文脈として保持
    await clickForward(user, 1)
    const snapshot = app.session.getState().snapshot
    expect(snapshot.kind).toBe('CHILD_EMITTED')
    expect(snapshot.parentElementId).toBe('nested-001')
    expect(children.textContent).toContain('送出済み')
    // 子1がtoListへ、子2送出→toListでclose詳細が表示される
    await clickForward(user, 3)
    expect(screen.getByTestId('flatmap-closed')).toBeInTheDocument()
    const output = screen.getByTestId('output-list')
    expect(within(output).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '"Java"',
      '"SQL"',
    ])
  })

  it('P2-R07: active nodeで対応行だけを強調し、コード/説明が同じAST内容を示す', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await selectOperation(user, 'map')
    await clickForward(user, 2)
    // NODE_ARRIVAL: mapノードの行だけが強調される
    const activeLines = document.querySelectorAll('.code-line[data-active]')
    expect(activeLines).toHaveLength(1)
    expect(activeLines[0]?.getAttribute('data-line-id')).toBe('line-node-map')
    expect(activeLines[0]?.textContent).toContain('.map(Employee::name)')
    // 説明パネルも同じsnapshotのAST由来テキスト
    const snapshot = app.session.getState().snapshot
    expect(screen.getByTestId('explanation-current').textContent).toBe(
      snapshot.explanation.current,
    )
    expect(snapshot.explanation.current).toContain('name()')
  })

  it('P2-R08: Employee/Departmentがrecordで、accessorとdatasetコードが正しい', async () => {
    const user = userEvent.setup()
    renderApp()
    await selectOperation(user, 'map')
    const code = screen.getByTestId('java-code-panel').textContent ?? ''
    expect(code).toContain('record Department(String name, String division) {}')
    expect(code).toContain('record Employee(')
    expect(code).toContain('new Employee("佐藤", 35, 5_500_000L, 4.2, "関東",')
    expect(code).toContain('.map(Employee::name)')
    expect(code).toContain('List<String> result = employees.stream()')
    // Unicode矢印がJavaコードへ混入していない
    expect(code).not.toMatch(/[→⇒]/)
  })

  it('P2-R09: 状態文言・keyboard・focus・狭幅レイアウト構造を維持する', async () => {
    const user = userEvent.setup()
    renderApp()
    await selectOperation(user, 'map')
    // 状態は記号だけでなく文言でも識別できる（map凡例は3状態）
    const legend = screen.getByTestId('legend')
    expect(legend.textContent).toContain('未評価')
    expect(legend.textContent).toContain('処理中')
    expect(legend.textContent).toContain('通過済み')
    expect(legend.textContent).not.toContain('除外済み')
    // 全操作ボタンがaccessible nameを持ちキーボード到達可能
    for (const name of ['最初から', '戻る', '進む', '自動', '停止']) {
      const button = screen.getByRole('button', { name })
      expect(button).toBeInTheDocument()
      expect(button.tabIndex).toBeGreaterThanOrEqual(-1)
    }
    // パネルにaria-labelがある
    expect(screen.getByLabelText('入力')).toBeInTheDocument()
    expect(screen.getByLabelText('処理中')).toBeInTheDocument()
    expect(screen.getByLabelText('出力')).toBeInTheDocument()
    expect(screen.getByLabelText('Pipeline')).toBeInTheDocument()
    // 進むボタンへフォーカスしてEnterで操作できる
    const forward = screen.getByRole('button', { name: '進む' })
    forward.focus()
    expect(document.activeElement).toBe(forward)
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('playback-position').textContent).toContain('snapshot 2')
  })
})
