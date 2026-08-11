// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/ui/App'
import { createApp, UNIMPLEMENTED_OPERATIONS, type AppInstance } from '../../src/ui/appInstance'
import { FakeScheduler } from '../helpers'
import type { Snapshot } from '../../src/domain/engine/snapshot'

/**
 * P5-R01〜P5-R10: React統合テスト（Phase 5指示 §12.3）。
 * UIは確定snapshotの描画だけを検証する（結果・型・蓄積状態を独自計算しない）。
 *
 * 複数のCollector教材を終端まで進める操作を含むため、既定の5秒では
 * フルスイート同時実行時にtimeoutし得る。ファイル単位でtimeoutを引き上げる
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

async function selectOperation(user: ReturnType<typeof userEvent.setup>, operationId: string) {
  await user.selectOptions(screen.getByTestId('operation-select'), operationId)
}

async function selectTemplate(user: ReturnType<typeof userEvent.setup>, templateId: string) {
  await user.selectOptions(screen.getByTestId('template-select'), templateId)
}

async function selectMode(user: ReturnType<typeof userEvent.setup>, mode: string) {
  await user.selectOptions(screen.getByTestId('mode-select'), mode)
}

/** Collector教材を選ぶ（collect操作 → 指定template） */
async function openCollector(
  user: ReturnType<typeof userEvent.setup>,
  templateId: string,
  operationId = 'collect',
) {
  await selectOperation(user, operationId)
  await selectTemplate(user, templateId)
}

afterEach(() => cleanup())

describe('P5-R01 操作 / template UI', () => {
  it('P5-R01: Collector optgroupが表示され、未実装リストが0件で空optgroupを描画せず、AI理由はPhase 6のまま維持される', async () => {
    const user = userEvent.setup()
    renderApp()
    const select = screen.getByTestId('operation-select') as HTMLSelectElement
    // Collector optgroupが存在する
    const groups = Array.from(select.querySelectorAll('optgroup')).map((g) => g.label)
    expect(groups).toContain('Collector')
    expect(groups).toEqual(['生成', '中間', '終端', 'Collector'])
    // 未実装リストは0件、空の「未実装」optgroupは描画しない
    expect(UNIMPLEMENTED_OPERATIONS).toHaveLength(0)
    expect(groups.some((label) => label.includes('未実装'))).toBe(false)
    expect(within(select).queryByText(/実装予定/)).toBeNull()
    // Collector操作は選択可能
    const options = Array.from(select.options)
    for (const operationId of ['collect', 'collectTriple']) {
      const option = options.find((o) => o.value === operationId)
      expect(option, operationId).toBeDefined()
      expect(option?.disabled, operationId).toBe(false)
    }
    // AI capabilityのdisabled理由はPhase 6のまま維持
    expect((screen.getByTestId('ai-button') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('ai-reason').textContent).toContain('Phase 6')
    // Collector教材を選ぶとJavaコードにcollectが現れる
    await openCollector(user, 'tmpl-collect-groupingby-counting')
    expect(screen.getByTestId('java-code-panel').textContent).toContain(
      '.collect(Collectors.groupingBy(Employee::region, Collectors.counting()));',
    )
  })
})

describe('P5-R02 構造ツリー表示', () => {
  it('P5-R02: Collector AST・現在経路・active bucket / branchをsnapshotから描画する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openCollector(user, 'tmpl-collect-groupingby-counting')
    const panel = screen.getByTestId('op-context-collector')
    // AST構造（groupingBy → counting）が描画される
    expect(panel.querySelector('[data-collector-kind="groupingBy"]')).not.toBeNull()
    expect(panel.textContent).toContain('Collectors.groupingBy(Employee::region, Collectors.counting())')

    await forwardUntil(user, app, (s) => s.kind === 'BUCKET_SELECTED')
    const afterBucket = screen.getByTestId('op-context-collector')
    // 現在経路の表示
    expect(screen.getByTestId('collector-current-path').textContent).toContain('現在経路')
    // active bucketがdata属性で識別できる（色以外の手段）
    expect(afterBucket.querySelector('.collector-bucket[data-active="true"]')).not.toBeNull()
    expect(afterBucket.querySelector('.collector-node[data-active="true"]')).not.toBeNull()
    // 新規生成bucketの表示
    expect(screen.getByTestId('collector-bucket-new').textContent).toContain('新規生成')

    // teeingではactive branchが表示される
    await openCollector(user, 'tmpl-collect-teeing')
    await forwardUntil(user, app, (s) => s.kind === 'TEE_BRANCH_ACCUMULATED')
    expect(screen.getByTestId('collector-teeing').getAttribute('data-active-branch')).toBe('LEFT')
  })
})

describe('P5-R03 蓄積表示', () => {
  it('P5-R03: bucket成長・Setの無変化・joining連結・統計値をノード別に表示する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    // bucket成長
    await openCollector(user, 'tmpl-collect-groupingby-counting')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    expect(screen.getByTestId('collector-acc-map').textContent).toContain('bucket数')
    expect(screen.getAllByTestId('collector-acc-number').length).toBeGreaterThan(0)

    // Setの「追加しても変化しない」
    await openCollector(user, 'tmpl-collect-toset')
    await forwardUntil(user, app, (s) => {
      const ctx = s.operationContexts['node-sink']
      return (
        ctx?.kind === 'collector' &&
        ctx.root.accumulation.kind === 'ELEMENTS' &&
        ctx.root.accumulation.changedByLast === false
      )
    })
    expect(screen.getByTestId('collector-acc-unchanged').textContent).toContain('変化しません')

    // joiningの連結途中文字列
    await openCollector(user, 'tmpl-collect-joining-delimiter')
    await forwardUntil(user, app, (s) => s.kind === 'CONTAINER_UPDATED')
    expect(screen.getByTestId('collector-acc-text').textContent).toContain('連結中')

    // summarizingの統計値
    await openCollector(user, 'tmpl-collect-summarizing-int')
    await forwardUntil(user, app, (s) => s.kind === 'CONTAINER_UPDATED')
    expect(screen.getByTestId('collector-acc-statistics').textContent).toContain('count=')
  })
})

describe('P5-R04 結果TypeRef表示', () => {
  it('P5-R04: 内側から外側の結果型・Map / SalarySummary型が全パネルで一致する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openCollector(user, 'tmpl-collect-groupingby-nested')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    const expectedType = 'Map<Department, Map<String, List<Employee>>>'
    // Pipeline領域の型ラベル
    expect(screen.getByTestId('pipeline-scroll').textContent).toContain(expectedType)
    // 出力領域の型ラベル
    expect(screen.getByTestId('map-meta').textContent).toContain(expectedType)
    // 構造ツリーのノード結果型
    expect(screen.getByTestId('op-context-collector').textContent).toContain(expectedType)
    // Javaコードの宣言型
    expect(screen.getByTestId('java-code-panel').textContent).toContain(`${expectedType} result =`)

    await openCollector(user, 'tmpl-collect-teeing')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    expect(screen.getByTestId('pipeline-scroll').textContent).toContain('SalarySummary')
    expect(screen.getByTestId('output-record').textContent).toContain('SalarySummary')
    expect(screen.getByTestId('java-code-panel').textContent).toContain('SalarySummary result =')
  })
})

describe('P5-R05 finisher / merger表示', () => {
  it('P5-R05: collectingAndThen finisherの前後と、teeing mergerの左右結果・merger定義・最終結果を同時表示する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openCollector(user, 'tmpl-collect-collectingandthen')
    await forwardUntil(user, app, (s) => s.kind === 'COLLECTOR_FINISHED')
    const finisher = screen.getByTestId('collector-finisher')
    expect(finisher.getAttribute('data-state')).toBe('APPLIED')
    expect(finisher.textContent).toContain('List::copyOf')
    expect(screen.getByTestId('collector-finisher-before').textContent).toContain('List<Employee>')
    expect(screen.getByTestId('collector-finisher-after').textContent).toContain('List<Employee>')

    await openCollector(user, 'tmpl-collect-teeing')
    await forwardUntil(user, app, (s) => s.kind === 'TEE_MERGER_APPLIED')
    // 左結果・右結果・merger定義・最終結果を同時に表示する
    expect(screen.getByTestId('teeing-left-result').textContent).toBe('4')
    expect(screen.getByTestId('teeing-right-result').textContent).toBe('5425000.0')
    expect(screen.getByTestId('teeing-merger').textContent).toContain('SalarySummary::new')
    expect(screen.getByTestId('teeing-merger').textContent).toContain('適用済み')
    expect(screen.getByTestId('teeing-final').textContent).toContain(
      'SalarySummary[employeeCount=4, averageSalary=5425000.0]',
    )
    // R1 / R2 / Rの型を区別して表示する
    expect(screen.getByTestId('teeing-left').textContent).toContain('Long')
    expect(screen.getByTestId('teeing-right').textContent).toContain('Double')
    expect(screen.getByTestId('teeing-final').textContent).toContain('SalarySummary')
  })
})

describe('P5-R06 空結果表示', () => {
  it('P5-R06: 空partitionの両キーと各Collectorの空結果を正しく表示する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openCollector(user, 'tmpl-collect-partitioningby')
    await selectMode(user, 'emptySource')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    const entries = screen.getByTestId('map-entries')
    expect(entries.textContent).toContain('false')
    expect(entries.textContent).toContain('true')
    expect(entries.querySelectorAll('li')).toHaveLength(2)

    // 空Setは空コンテナとして表示される
    await openCollector(user, 'tmpl-collect-toset')
    await selectMode(user, 'emptySource')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    expect(screen.getByTestId('collection-empty').textContent).toContain('0件')

    // 空groupingByは空Map
    await openCollector(user, 'tmpl-collect-groupingby')
    await selectMode(user, 'emptySource')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    expect(screen.getByTestId('map-empty').textContent).toContain('0件')

    // 空teeingでもmerger結果を表示する
    await openCollector(user, 'tmpl-collect-teeing')
    await selectMode(user, 'emptySource')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    expect(screen.getByTestId('record-field-employeeCount').textContent).toContain('0')
    expect(screen.getByTestId('record-field-averageSalary').textContent).toContain('0.0')
  })
})

describe('P5-R07 表示順projection', () => {
  it('P5-R07: Set / Mapの決定的表示順と注記、TreeMapの意味論優先を表示する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    // 順序保証のないMapは学習用の安定順序＋注記
    await openCollector(user, 'tmpl-collect-groupingby-counting')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    const map = screen.getByTestId('output-map')
    expect(map.getAttribute('data-jdk-ordered')).toBeNull()
    expect(screen.getByTestId('map-order-note').textContent).toContain('学習用の順序')
    const keys = Array.from(screen.getByTestId('map-entries').querySelectorAll('.map-key')).map(
      (el) => el.textContent,
    )
    expect(keys).toEqual(['中部', '関東', '関西'])

    // TreeMapは実際の順序性を優先し、学習用順序の注記を出さない
    await openCollector(user, 'tmpl-collect-groupingby-treemap')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    expect(screen.getByTestId('output-map').getAttribute('data-jdk-ordered')).toBe('true')
    expect(screen.getByTestId('map-order-note').textContent).toContain('実際の順序')
    const treeKeys = Array.from(screen.getByTestId('map-entries').querySelectorAll('.map-key')).map(
      (el) => el.textContent,
    )
    expect(treeKeys).toEqual(['中部', '関東', '関西'])

    // Setは表示順注記と要素ID規則の注記を持つ
    await openCollector(user, 'tmpl-collect-toset')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    expect(screen.getByTestId('collection-order-note').textContent).toContain('学習用の順序')
    expect(screen.getByTestId('collection-element-id-note').textContent).toContain('最初に受理した')
  })

  it('P5-R07: 構造ツリーの順序（蓄積追加順・bucket生成履歴順）と最終結果の表示順を区別して注記する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    // 順序保証のないgroupingBy: ツリーはbucket生成順（関東→関西→中部）、結果は辞書順（中部→関東→関西）
    await openCollector(user, 'tmpl-collect-groupingby-counting')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    const treeBuckets = Array.from(
      screen.getByTestId('collector-buckets').querySelectorAll(':scope > li > .map-key'),
    ).map((el) => el.textContent)
    expect(treeBuckets).toEqual(['関東', '関西', '中部'])
    const resultKeys = Array.from(
      screen.getByTestId('map-entries').querySelectorAll('.map-key'),
    ).map((el) => el.textContent)
    expect(resultKeys).toEqual(['中部', '関東', '関西'])
    // 両者が異なる意味であることを注記で明示する（一律に「学習用の順序」と説明しない）
    expect(screen.getByTestId('collector-bucket-order-note').textContent).toContain(
      'bucket生成履歴順',
    )
    expect(screen.getByTestId('collector-bucket-order-note').textContent).toContain(
      '最終結果パネルの表示順とは意味が異なります',
    )
    expect(screen.getByTestId('collector-tree-order-note').textContent).toContain('蓄積の追加順')
    // 構造ツリーの注記は「学習用の順序」を主張しない（結果パネル側の注記と混同させない）
    expect(screen.getByTestId('collector-tree-order-note').textContent).not.toContain('学習用の順序')

    // TreeMapでは結果パネルが実順序であることを注記し、ツリーは生成履歴順のまま
    await openCollector(user, 'tmpl-collect-groupingby-treemap')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    expect(screen.getByTestId('map-order-note').textContent).toContain('実際の順序')
    expect(screen.getByTestId('collector-bucket-order-note').textContent).toContain(
      'bucket生成履歴順',
    )
  })
})

describe('P5-R08 コード・説明同期', () => {
  it('P5-R08: collect行のline ID強調・説明・jdkNoteが同じsnapshotを示す', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openCollector(user, 'tmpl-collect-teeing')
    await forwardUntil(user, app, (s) => s.kind === 'TEE_BRANCH_FINISHED')
    const snapshot = app.session.getState().snapshot
    // active lineがcollect行と一致する
    const activeLine = screen
      .getByTestId('java-code-panel')
      .querySelector('[data-active="true"]')
    expect(activeLine?.getAttribute('data-line-id')).toBe(snapshot.activeLineId)
    expect(activeLine?.textContent).toContain('.collect(Collectors.teeing(')
    // 説明・jdkNoteが同じsnapshotの確定値
    expect(screen.getByTestId('explanation-current').textContent).toBe(snapshot.explanation.current)
    expect(screen.getByTestId('explanation-jdk').textContent).toContain('教材上の表示順は左→右')
    // 全パネルが同じsnapshot IDを描画する
    const ids = new Set(
      Array.from(document.querySelectorAll('[data-snapshot-id]')).map((el) =>
        el.getAttribute('data-snapshot-id'),
      ),
    )
    expect(ids).toEqual(new Set([snapshot.snapshotId]))
  })
})

describe('P5-R09 record表示', () => {
  it('P5-R09: SalarySummaryのrecord定義と結果値の表示が正しい', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openCollector(user, 'tmpl-collect-teeing')
    // Detailsにrecord定義を表示する
    expect(screen.getByTestId('merger-record-definitions').textContent).toBe(
      'record SalarySummary(long employeeCount, double averageSalary) {}',
    )
    // Javaコード表示にもrecord宣言を含む
    expect(screen.getByTestId('java-code-panel').textContent).toContain(
      'record SalarySummary(long employeeCount, double averageSalary) {}',
    )
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    const record = screen.getByTestId('output-record')
    expect(record.textContent).toContain('SalarySummary')
    expect(screen.getByTestId('record-field-employeeCount').textContent).toContain('4')
    expect(screen.getByTestId('record-field-averageSalary').textContent).toContain('5425000.0')
    // teeingを使わない教材ではrecord定義を追加表示しない
    await openCollector(user, 'tmpl-collect-tolist')
    expect(screen.queryByTestId('merger-record-definitions')).toBeNull()
  })
})

describe('P5-R10 a11y・responsive', () => {
  it('P5-R10: 状態文言・keyboard・focus・reduced motion・狭幅要件を維持する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openCollector(user, 'tmpl-collect-groupingby-counting')
    await forwardUntil(user, app, (s) => s.kind === 'BUCKET_SELECTED')

    // 色だけでなく記号と文言で識別する（凡例＋data属性）
    const legend = screen.getByTestId('legend')
    expect(legend.textContent).toContain('処理中')
    const activeNode = screen
      .getByTestId('op-context-collector')
      .querySelector('.collector-node[data-active="true"]')
    expect(activeNode?.getAttribute('aria-current')).toBe('step')
    expect(activeNode?.textContent).toContain('▶')

    // teeing branchの状態は文言で読める
    await openCollector(user, 'tmpl-collect-teeing')
    await forwardUntil(user, app, (s) => s.kind === 'TEE_MERGER_APPLIED')
    expect(screen.getByTestId('teeing-left').textContent).toContain('FINISHED')

    // keyboard操作で進める（Tab移動 + Enter）
    const forward = screen.getByRole('button', { name: '進む' })
    forward.focus()
    expect(document.activeElement).toBe(forward)
    const before = app.session.getState().cursor
    await user.keyboard('{Enter}')
    expect(app.session.getState().cursor).toBeGreaterThan(before)

    // Pipelineは狭幅でも専用横スクロールを維持する
    expect(screen.getByTestId('pipeline-scroll')).toBeDefined()
    // 構造ツリーは横スクロール可能なコンテナに入る
    expect(screen.getByTestId('op-context-collector').className).toContain('collector-structure')
  })
})
