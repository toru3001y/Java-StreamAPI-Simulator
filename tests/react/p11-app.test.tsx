// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/ui/App'
import { createApp, type AppInstance } from '../../src/ui/appInstance'
import { FakeScheduler } from '../helpers'
import type { Snapshot } from '../../src/domain/engine/snapshot'
import { P11_TEMPLATE_IDS } from '../../src/domain/template/templatesP8'
import { UNMODIFIABLE_NOT_IMPORTABLE_REASON } from '../../src/application/importContract'

/**
 * P11-R01〜P11-R04: React統合テスト（v0.14 §3.2・§3.3・§5.1・§5.2）。
 * UIは確定snapshotのview値だけを描画し、ラベル・不変性を独自計算しない。
 */
vi.setConfig({ testTimeout: 60_000 })

function renderApp() {
  const scheduler = new FakeScheduler()
  const app = createApp({ scheduler })
  const utils = render(<App app={app} />)
  return { app, scheduler, ...utils }
}

async function openTemplate(
  user: ReturnType<typeof userEvent.setup>,
  templateId: string,
  mode?: string,
) {
  await user.selectOptions(screen.getByTestId('operation-select'), 'collect')
  await user.selectOptions(screen.getByTestId('template-select'), templateId)
  if (mode) await user.selectOptions(screen.getByTestId('mode-select'), mode)
}

async function forwardUntil(
  user: ReturnType<typeof userEvent.setup>,
  app: AppInstance,
  predicate: (s: Snapshot) => boolean,
  max = 60,
) {
  const button = screen.getByRole('button', { name: '進む' })
  for (let i = 0; i < max; i++) {
    if (predicate(app.session.getState().snapshot)) return
    await user.click(button)
  }
  if (!predicate(app.session.getState().snapshot)) {
    throw new Error('forwardUntil: 条件に到達しません')
  }
}

async function runToEnd(user: ReturnType<typeof userEvent.setup>, app: AppInstance) {
  await forwardUntil(user, app, (s) => s.completion !== 'NONE')
}

afterEach(() => cleanup())

describe('P11-R01 教材Pipelineとして選択できる', () => {
  it('P11-R01: unmodifiable系3 templateがcollect操作のPipeline選択に現れる', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.selectOptions(screen.getByTestId('operation-select'), 'collect')
    const select = screen.getByTestId('template-select') as HTMLSelectElement
    const ids = Array.from(select.options).map((o) => o.value)
    for (const templateId of P11_TEMPLATE_IDS) {
      expect(ids, templateId).toContain(templateId)
    }
    // 未実装扱い（unimplemented-）の選択肢としては現れない
    expect(ids.filter((v) => v.startsWith('unimplemented-'))).toEqual([])
  })
})

describe('P11-R02 蓄積ラベルと結果ラベルの分離（v0.14 §3.3）', () => {
  it('P11-R02: 蓄積中はList（蓄積中）、確定後はList（unmodifiable）が表示される', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openTemplate(user, 'tmpl-collect-tounmod-list')
    // 蓄積中の表示
    await forwardUntil(user, app, (s) => s.kind === 'CONTAINER_UPDATED')
    expect(screen.getByTestId('collector-acc-elements').textContent).toContain('List（蓄積中）')
    expect(screen.getByTestId('collector-acc-elements').textContent).not.toContain('unmodifiable）')
    // finisher適用時にラベル遷移が表示される
    await forwardUntil(user, app, (s) => s.kind === 'COLLECTOR_FINISHED')
    const finisher = screen.getByTestId('collector-finisher')
    expect(finisher).toHaveAttribute('data-state', 'APPLIED')
    expect(finisher.textContent).toContain('unmodifiableへのラップ')
    expect(screen.getByTestId('collector-finisher-before').textContent).toContain('List（蓄積中）')
    expect(screen.getByTestId('collector-finisher-after').textContent).toContain(
      'List（unmodifiable）',
    )
    // TypeRefは前後で同一（不変性の軸をTypeRefへ追加しない）
    expect(screen.getByTestId('collector-finisher-before').textContent).toContain('List<Employee>')
    expect(screen.getByTestId('collector-finisher-after').textContent).toContain('List<Employee>')
  })

  it('P11-R02: root配置のtoUnmodifiableListはCOLLECTION viewで結果ラベル付き表示になる', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openTemplate(user, 'tmpl-collect-tounmod-list')
    await runToEnd(user, app)
    const collection = screen.getByTestId('output-collection')
    expect(collection).toHaveAttribute('data-container', 'List（unmodifiable）')
    expect(collection.textContent).toContain('List（unmodifiable）<Employee>')
  })

  it('P11-R02: toUnmodifiableSetの結果ラベルと表示順注記が表示される', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openTemplate(user, 'tmpl-collect-tounmod-set')
    await runToEnd(user, app)
    const collection = screen.getByTestId('output-collection')
    expect(collection).toHaveAttribute('data-container', 'Set（unmodifiable）')
    expect(collection.textContent).toContain('Set（unmodifiable）<String>')
  })

  it('P11-R02: 空入力でも確定snapshotで空の不変コンテナが表示される', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openTemplate(user, 'tmpl-collect-tounmod-list', 'emptySource')
    await forwardUntil(user, app, (s) => s.kind === 'COLLECTOR_FINISHED')
    expect(screen.getByTestId('collector-finisher-before').textContent).toContain('List（蓄積中）[]')
    expect(screen.getByTestId('collector-finisher-after').textContent).toContain(
      'List（unmodifiable）[]',
    )
    await runToEnd(user, app)
    expect(screen.getByTestId('output-collection')).toHaveAttribute(
      'data-container',
      'List（unmodifiable）',
    )
  })
})

describe('P11-R03 toUnmodifiableMapの常設4行と補助説明（v0.14 §3.3・§5.1）', () => {
  it('P11-R03: 常設4行が表示され、mapFactory行が意味論表示になる', async () => {
    const user = userEvent.setup()
    renderApp()
    await openTemplate(user, 'tmpl-collect-tounmod-map')
    const table = screen.getByTestId('collector-tomap')
    expect(table).toHaveAttribute('data-arity', '3')
    for (const testId of [
      'tomap-key-mapper',
      'tomap-value-mapper',
      'tomap-merge-function',
      'tomap-map-factory',
    ]) {
      expect(within(table).getByTestId(testId), testId).toBeInTheDocument()
    }
    expect(within(table).getAllByRole('rowheader')).toHaveLength(4)
    expect(within(table).getByTestId('tomap-map-factory').textContent).toContain(
      'なし（unmodifiable Mapを返す。mapFactory版のoverloadは存在しない）',
    )
    expect(within(table).getByTestId('tomap-merge-function').textContent).toContain('(a, b) -> a')
    expect(within(table).getByTestId('tomap-merge-meaning').textContent).toContain(
      '既存値を保持（先勝ち）',
    )
  })

  it('P11-R03: 結果Mapが不変ラベルで表示され、RESULT_CONFIRMEDに不変性注記が出る', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openTemplate(user, 'tmpl-collect-tounmod-map')
    await forwardUntil(user, app, (s) => s.kind === 'RESULT_CONFIRMED')
    const jdkNote = screen.getByTestId('explanation-jdk').textContent ?? ''
    expect(jdkNote).toContain('unmodifiable')
    expect(jdkNote).toContain('UnsupportedOperationException')
    expect(jdkNote).toContain('Oracle')
  })

  it('P11-R03: 補助説明に一次情報・対比導線・重複キーの参照注記が表示される', async () => {
    const user = userEvent.setup()
    renderApp()
    await openTemplate(user, 'tmpl-collect-tounmod-list')
    const listNotes = screen.getByTestId('details-disclosure').textContent ?? ''
    expect(listNotes).toContain('Since 10')
    expect(listNotes).toContain('NullPointerException')
    expect(listNotes).toContain('Stream.toList()')
    expect(listNotes).toContain('null禁止の規定はない')
    expect(listNotes).toContain('教材モデル上の状態表示')

    await openTemplate(user, 'tmpl-collect-tounmod-set')
    const setNotes = screen.getByTestId('details-disclosure').textContent ?? ''
    expect(setNotes).toContain('unordered Collector')
    expect(setNotes).toContain('Collectors.toSet()との違いは不変性だけ')

    await openTemplate(user, 'tmpl-collect-tounmod-map')
    const mapNotes = screen.getByTestId('details-disclosure').textContent ?? ''
    expect(mapNotes).toContain('mapFactoryを指定する形は存在しない')
    // 2引数版の重複キーは既存教材への参照注記で扱う（専用templateは設けない）
    expect(mapNotes).toContain('collect（toMap・重複キーで実行失敗）')
    expect(mapNotes).toContain('IllegalStateException')
  })
})

describe('P11-R04 取込UI無効化（v0.14 §5.2）', () => {
  it('P11-R04: unmodifiable template選択中はコピー・貼付が無効化され理由が表示される', async () => {
    const user = userEvent.setup()
    renderApp()
    for (const templateId of P11_TEMPLATE_IDS) {
      await openTemplate(user, templateId)
      expect(screen.getByTestId('copy-prompt-button'), templateId).toBeDisabled()
      expect(screen.getByTestId('import-button'), templateId).toBeDisabled()
      expect(screen.getByTestId('import-textarea'), templateId).toBeDisabled()
      expect(screen.getByTestId('import-disabled-reason').textContent, templateId).toContain(
        UNMODIFIABLE_NOT_IMPORTABLE_REASON,
      )
    }
  })

  it('P11-R04: 非unmodifiable templateへ戻すと取込UIが復帰する', async () => {
    const user = userEvent.setup()
    renderApp()
    await openTemplate(user, 'tmpl-collect-tounmod-list')
    expect(screen.getByTestId('import-button')).toBeDisabled()
    await openTemplate(user, 'tmpl-collect-tolist')
    expect(screen.getByTestId('import-button')).toBeEnabled()
    expect(screen.queryByTestId('import-disabled-reason')).toBeNull()
  })
})
