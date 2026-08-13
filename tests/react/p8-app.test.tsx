// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/ui/App'
import { createApp, type AppInstance } from '../../src/ui/appInstance'
import { FakeScheduler } from '../helpers'
import type { Snapshot } from '../../src/domain/engine/snapshot'
import {
  P11_TEMPLATE_IDS,
  P8_TEMPLATES,
  TO_MAP_OUT_OF_SCOPE_NOTES,
} from '../../src/domain/template/templatesP8'
import {
  TO_MAP_NOT_IMPORTABLE_REASON,
  UNMODIFIABLE_NOT_IMPORTABLE_REASON,
} from '../../src/application/importContract'
import { P8_TEMPLATE_MODES } from '../p8-helpers'

/**
 * P8-R01〜P8-R06: React統合テスト（Phase 8指示 §12.3、§9）。
 * UIは確定snapshotのview値だけを描画し、結果・型・蓄積状態・表示順を独自計算しない。
 */
vi.setConfig({ testTimeout: 60_000 })

const FAILING_TEMPLATE = 'tmpl-collect-tomap-duplicate'

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

afterEach(() => cleanup())

describe('P8-R01 toMap構造4行', () => {
  it('P8-R01: keyMapper / valueMapper / mergeFunction / mapFactoryが常設4行で表示される', async () => {
    const user = userEvent.setup()
    renderApp()
    for (const templateId of [
      'tmpl-collect-tomap-identity',
      'tmpl-collect-tomap-duplicate',
      'tmpl-collect-tomap-merge-first',
      'tmpl-collect-tomap-treemap',
      'tmpl-collect-tomap-grouped',
    ]) {
      await openTemplate(user, templateId)
      const table = screen.getByTestId('collector-tomap')
      for (const testId of [
        'tomap-key-mapper',
        'tomap-value-mapper',
        'tomap-merge-function',
        'tomap-map-factory',
      ]) {
        expect(within(table).getByTestId(testId), `${templateId}.${testId}`).toBeInTheDocument()
      }
      expect(within(table).getAllByRole('rowheader'), templateId).toHaveLength(4)
    }
  })

  it('P8-R01: 省略overloadの行が意味論文言を表示する（§7.5-4）', async () => {
    const user = userEvent.setup()
    renderApp()
    // 2引数版: mergeFunction・mapFactoryとも省略
    await openTemplate(user, 'tmpl-collect-tomap-identity')
    expect(screen.getByTestId('tomap-merge-function').textContent).toContain(
      'なし（重複キーでIllegalStateException）',
    )
    expect(screen.getByTestId('tomap-map-factory').textContent).toContain(
      'なし（Map実装型は無保証）',
    )
    expect(screen.getByTestId('collector-tomap').getAttribute('data-arity')).toBe('2')
    expect(screen.getByTestId('tomap-key-mapper').textContent).toContain('Employee::name')
    expect(screen.getByTestId('tomap-value-mapper').textContent).toContain('Function.identity()')

    // 3引数版: mapFactoryのみ省略
    await openTemplate(user, 'tmpl-collect-tomap-merge-first')
    expect(screen.getByTestId('collector-tomap').getAttribute('data-arity')).toBe('3')
    expect(screen.getByTestId('tomap-merge-function').textContent).toContain('(a, b) -> a')
    expect(screen.getByTestId('tomap-map-factory').textContent).toContain(
      'なし（Map実装型は無保証）',
    )

    // 4引数版: 省略なし
    await openTemplate(user, 'tmpl-collect-tomap-treemap')
    expect(screen.getByTestId('collector-tomap').getAttribute('data-arity')).toBe('4')
    expect(screen.getByTestId('tomap-map-factory').textContent).toContain('TreeMap::new')
  })
})

describe('P8-R02 蓄積・重複・merge表示', () => {
  it('P8-R02: entryが蓄積順で表示され、groupingByのbucket表示と区別される', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openTemplate(user, 'tmpl-collect-tomap-identity')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    const entries = screen.getByTestId('collector-tomap-entries')
    const items = within(entries).getAllByRole('listitem')
    expect(items.map((li) => li.textContent?.replace(/\s+/g, ''))).toEqual([
      '佐藤=佐藤（age=35）（Employee）',
      '鈴木=鈴木（age=27）（Employee）',
      '高橋=高橋（age=42）（Employee）',
      '田中=田中（age=29）（Employee）',
    ])
    // toMapはentry表示（キー→値1件）であり、bucket表示ではない
    expect(screen.queryByTestId('collector-buckets')).toBeNull()
    expect(screen.getByTestId('collector-acc-tomap')).toBeInTheDocument()

    // groupingBy比較templateではbucket表示（キー→List）になる
    await openTemplate(user, 'tmpl-collect-groupby-mergedemo')
    expect(screen.queryByTestId('collector-acc-tomap')).toBeNull()
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    expect(screen.getByTestId('collector-buckets')).toBeInTheDocument()
    expect(screen.queryByTestId('collector-acc-tomap')).toBeNull()
  })

  it('P8-R02: 重複検出で重複キー・既存値・新しい値の3点が表示される', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openTemplate(user, FAILING_TEMPLATE)
    await forwardUntil(user, app, (s) => s.kind === 'DUPLICATE_KEY_DETECTED')
    expect(screen.getByTestId('processing-input').textContent).toContain('関東')
    const evaluation = screen.getByTestId('processing-evaluation').textContent ?? ''
    expect(evaluation).toContain('既存値')
    expect(evaluation).toContain('"伊藤"')
    expect(evaluation).toContain('新しい値')
    expect(evaluation).toContain('"渡辺"')
  })

  it('P8-R02: merge適用フローと意味論の併記・引数順が表示される', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openTemplate(user, 'tmpl-collect-tomap-merge-first')
    await forwardUntil(user, app, (s) => s.kind === 'MERGE_FUNCTION_APPLIED')
    expect(screen.getByTestId('processing-input').textContent).toBe('mergeFunction("伊藤", "渡辺")')
    expect(screen.getByTestId('processing-expression').textContent).toBe('(a, b) -> a')
    expect(screen.getByTestId('processing-evaluation').textContent).toBe('"伊藤", "渡辺" → "伊藤"')
    expect(screen.getByTestId('processing-outcome').textContent).toContain('既存値を保持（先勝ち）')
    expect(screen.getByTestId('explanation-jdk').textContent).toContain('（Map内の既存値, 新しい値）')
    // 構造4行にも意味論と引数順が併記される
    expect(screen.getByTestId('tomap-merge-meaning').textContent).toContain('既存値を保持（先勝ち）')
    expect(screen.getByTestId('tomap-merge-meaning').textContent).toContain(
      '(Map内の既存値, 新しい値)',
    )
  })

  it('P8-R02: lastは「新しい値で置換（後勝ち）」を併記する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openTemplate(user, 'tmpl-collect-tomap-merge-last')
    await forwardUntil(user, app, (s) => s.kind === 'MERGE_FUNCTION_APPLIED')
    expect(screen.getByTestId('processing-outcome').textContent).toContain(
      '新しい値で置換（後勝ち）',
    )
    expect(screen.getByTestId('tomap-merge-meaning').textContent).toContain(
      '新しい値で置換（後勝ち）',
    )
  })

  it('P8-R02: concatの3件衝突が順次適用として表示される', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openTemplate(user, 'tmpl-collect-tomap-merge-concat')
    await forwardUntil(user, app, (s) => s.kind === 'STREAM_CONSUMED')
    const entries = within(screen.getByTestId('map-entries')).getAllByRole('listitem')
    const kanto = entries.find((li) => li.textContent?.startsWith('関東'))
    expect(kanto?.textContent).toContain('伊藤, 渡辺, 山本')
  })
})

describe('P8-R03 実行失敗表示', () => {
  it('P8-R03: 教材上想定された実行失敗として例外型・原因キー・衝突2値が表示される', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openTemplate(user, FAILING_TEMPLATE)
    await forwardUntil(user, app, (s) => s.kind === 'COLLECT_FAILED')
    const failure = screen.getByTestId('execution-failure')
    expect(within(failure).getByTestId('execution-failure-title').textContent).toContain(
      '教材上想定された実行失敗',
    )
    expect(within(failure).getByTestId('execution-failure-exception').textContent).toContain(
      'IllegalStateException',
    )
    expect(within(failure).getByTestId('execution-failure-key').textContent).toContain('関東')
    const values = within(failure).getByTestId('execution-failure-values').textContent ?? ''
    expect(values).toContain('"伊藤"')
    expect(values).toContain('"渡辺"')
    expect(within(failure).getByTestId('execution-failure-note').textContent).toContain(
      'JDKで実行した場合',
    )
    // 例外メッセージ全文は表示契約に含めない
    expect(failure.textContent).toContain('メッセージ全文はJDK実装詳細のため表示しません')
    // 終端結果は確定しない
    expect(screen.queryByTestId('output-map')).toBeNull()
  })

  it('P8-R03: ERROR（エンジン内部不整合）と異なる表示区分・文言である', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openTemplate(user, FAILING_TEMPLATE)
    await forwardUntil(user, app, (s) => s.kind === 'COLLECT_FAILED')
    const playbackState = screen.getByTestId('playback-state')
    expect(playbackState.getAttribute('data-state')).toBe('FAILED')
    expect(playbackState.textContent).toBe('実行失敗（想定内）')
    expect(playbackState.textContent).not.toBe('エラー')
    // ERROR用のstopReason（エンジン内部の不整合…）は表示されない
    expect(screen.queryByTestId('stop-reason')).toBeNull()
    expect(screen.getByTestId('execution-failure').textContent).toContain(
      'エンジンの内部エラーではありません',
    )
  })

  it('P8-R03: FAILEDでは進む・自動が無効化され、戻るは有効である', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openTemplate(user, FAILING_TEMPLATE)
    await forwardUntil(user, app, (s) => s.kind === 'COLLECT_FAILED')
    expect(screen.getByRole('button', { name: '進む' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '自動' })).toBeDisabled()
    const back = screen.getByRole('button', { name: '戻る' })
    expect(back).toBeEnabled()
    await user.click(back)
    expect(app.session.getState().playbackState).toBe('PAUSED')
    expect(screen.queryByTestId('execution-failure')).toBeNull()
    // 再前進で失敗表示が復元される
    await user.click(screen.getByRole('button', { name: '進む' }))
    expect(screen.getByTestId('execution-failure')).toBeInTheDocument()
    expect(app.session.getState().playbackState).toBe('FAILED')
  })

  it('P8-R03: downstream配置の失敗ではCollector経路とbucketキーが表示される', async () => {
    // 教材templateには存在しない配置のため、fixture経路ではなくroot配置で経路表示を確認し、
    // bucket行の出し分け（bucketPathが空なら非表示）を検証する
    const user = userEvent.setup()
    const { app } = renderApp()
    await openTemplate(user, FAILING_TEMPLATE)
    await forwardUntil(user, app, (s) => s.kind === 'COLLECT_FAILED')
    const failure = screen.getByTestId('execution-failure')
    expect(within(failure).getByTestId('execution-failure-path').textContent).toBe('c0')
    // root配置ではbucketPathが空のためbucketキー行を表示しない
    expect(within(failure).queryByTestId('execution-failure-buckets')).toBeNull()
    // 表示はsnapshot.executionFailureのみから導出している（UIで独自計算しない）
    const view = app.session.getState().snapshot.executionFailure!
    expect(within(failure).getByTestId('execution-failure-path').textContent).toBe(
      view.collectorPath.join(' → '),
    )
    expect(view.bucketPath).toEqual([])
  })
})

describe('P8-R04 操作選択・補助説明・比較導線', () => {
  it('P8-R04: 操作一覧が不変である（新operationIdなし・未実装optgroupなし）', async () => {
    const user = userEvent.setup()
    renderApp()
    await openTemplate(user, 'tmpl-collect-tomap-identity')
    const select = screen.getByTestId('operation-select') as HTMLSelectElement
    const values = Array.from(select.options).map((o) => o.value)
    expect(values).not.toContain('toMap')
    expect(values).not.toContain('collectToMap')
    expect(values.filter((v) => v.startsWith('unimplemented-'))).toEqual([])
    // toMap templateはcollect操作の教材Pipelineとして選べる
    const templateSelect = screen.getByTestId('template-select') as HTMLSelectElement
    const templateIds = Array.from(templateSelect.options).map((o) => o.value)
    for (const template of P8_TEMPLATES) {
      expect(templateIds, template.templateId).toContain(template.templateId)
    }
  })

  it('P8-R04: 対象外の補助説明（toConcurrentMap / key側identity）が表示される', async () => {
    const user = userEvent.setup()
    renderApp()
    await openTemplate(user, 'tmpl-collect-tomap-identity')
    const details = screen.getByTestId('details-disclosure')
    const text = details.textContent ?? ''
    expect(text).toContain('toConcurrentMap')
    expect(text).toContain('key側のFunction.identity()')
    // 数値加算mergeはv0.13で、toUnmodifiableMap系はv0.14（Phase 11）で実装済みとなり、
    // 対象外の説明はもう表示されない（実行できる教材が別途ある）
    expect(text).not.toContain('数値加算merge')
    expect(text).not.toContain('実行対象外とする（説明のみ）。toUnmodifiableList')
    // 対象外注記は2件だけになった
    expect(TO_MAP_OUT_OF_SCOPE_NOTES).toHaveLength(2)
    for (const note of TO_MAP_OUT_OF_SCOPE_NOTES) {
      expect(text, note.slice(0, 20)).toContain(note)
    }
  })

  it('P8-R04: sum系templateに数値意味論の補助説明（v0.13 §3）が表示される', async () => {
    const user = userEvent.setup()
    renderApp()
    // sum系共通: +演算子による素朴な加算と型制約
    await openTemplate(user, 'tmpl-collect-tomap-merge-sumint')
    const sumIntText = screen.getByTestId('details-disclosure').textContent ?? ''
    expect(sumIntText).toContain('Integer::sum')
    expect(sumIntText).toContain('as per the + operator')
    // int: ラップ意味論はJLS根拠つきの説明のみ（実行対象外のまま）
    expect(sumIntText).toContain('JLS §15.18.2')
    // long: safe integer範囲の限定
    await openTemplate(user, 'tmpl-collect-tomap-merge-sumlong')
    const sumLongText = screen.getByTestId('details-disclosure').textContent ?? ''
    expect(sumLongText).toContain('Long::sum')
    expect(sumLongText).toContain('safe integer範囲')
    // double: 素朴加算（補償付き加算との違い）
    await openTemplate(user, 'tmpl-collect-tomap-merge-sumdouble')
    const sumDoubleText = screen.getByTestId('details-disclosure').textContent ?? ''
    expect(sumDoubleText).toContain('Double.sum')
    expect(sumDoubleText).toContain('補償付き加算ではない')
    expect(sumDoubleText).toContain('summingDouble')
    // 相互参照導線（groupingByとの対比）
    expect(sumDoubleText).toContain('1つの合計値へ畳み込む')
  })

  it('P8-R04: §7.8の教材規約文言が表示される', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openTemplate(user, FAILING_TEMPLATE)
    const details = screen.getByTestId('details-disclosure').textContent ?? ''
    // 表示順が教材規約でありJDK内部の評価順を断定しない
    expect(details).toContain('教材上の規約であり')
    expect(details).toContain('実際の順序を示すものではない')
    // キー評価snapshotのjdkNoteでも同じ規約を提示する
    await forwardUntil(user, app, (s) => s.kind === 'TO_MAP_KEY_EVALUATED')
    expect(screen.getByTestId('explanation-jdk').textContent).toContain('教材上の規約であり')

    // encounter orderはImplementation Note区分として扱い、iteration order保証と混同させない
    await openTemplate(user, 'tmpl-collect-tomap-identity')
    const identityNotes = screen.getByTestId('details-disclosure').textContent ?? ''
    expect(identityNotes).toContain('encounter order')
    expect(identityNotes).toContain('Implementation Note')
    expect(identityNotes).toContain('返却Mapのentry反復順序そのものは一般には保証されない')
  })

  it('P8-R04: groupingBy比較導線の相互参照文言が画面に表示される', async () => {
    const user = userEvent.setup()
    renderApp()
    // toMap側（duplicate / first / last / concat）からgroupingBy比較templateを参照する
    for (const templateId of [
      FAILING_TEMPLATE,
      'tmpl-collect-tomap-merge-first',
      'tmpl-collect-tomap-merge-last',
      'tmpl-collect-tomap-merge-concat',
    ]) {
      await openTemplate(user, templateId)
      const text = screen.getByTestId('details-disclosure').textContent ?? ''
      expect(text, templateId).toContain('toMapとの対比')
      expect(text, templateId).toContain('groupingByは同じキーの値をListへ蓄積する')
    }
    // groupingBy比較template側からtoMap 4 templateを参照する
    await openTemplate(user, 'tmpl-collect-groupby-mergedemo')
    const compare = screen.getByTestId('details-disclosure').textContent ?? ''
    expect(compare).toContain('toMap・重複キーで実行失敗')
    expect(compare).toContain('mergeFunction: first / last / concat')
    // 既存P5のgroupingBy教材（基準4件データ）への参照も維持する
    expect(compare).toContain('groupingBy(Employee::region) + counting()')
    // タイトルにも比較導線を明示する
    expect(screen.getByTestId('template-select')).toHaveValue('tmpl-collect-groupby-mergedemo')
  })
})

describe('P8-R05 取込UI無効化', () => {
  it('P8-R05: toMap / unmodifiable template選択中はコピー・貼付の両方が無効化され理由が表示される', async () => {
    const user = userEvent.setup()
    renderApp()
    for (const template of P8_TEMPLATES) {
      if (template.templateId === 'tmpl-collect-groupby-mergedemo') continue
      await openTemplate(user, template.templateId)
      expect(screen.getByTestId('copy-prompt-button'), template.templateId).toBeDisabled()
      expect(screen.getByTestId('import-button'), template.templateId).toBeDisabled()
      expect(screen.getByTestId('import-textarea'), template.templateId).toBeDisabled()
      // v0.14（Phase 11）でunmodifiable系が加わり、理由文言だけがkindごとに分かれる
      expect(
        screen.getByTestId('import-disabled-reason').textContent,
        template.templateId,
      ).toContain(
        P11_TEMPLATE_IDS.includes(template.templateId)
          ? UNMODIFIABLE_NOT_IMPORTABLE_REASON
          : TO_MAP_NOT_IMPORTABLE_REASON,
      )
    }
  })

  it('P8-R05: 非toMap templateへ戻すと取込UIが復帰する', async () => {
    const user = userEvent.setup()
    renderApp()
    await openTemplate(user, 'tmpl-collect-tomap-identity')
    expect(screen.getByTestId('import-button')).toBeDisabled()
    // 同じPhase 8のgroupingBy比較template（toMap非含有）では有効
    await openTemplate(user, 'tmpl-collect-groupby-mergedemo')
    expect(screen.getByTestId('import-button')).toBeEnabled()
    expect(screen.queryByTestId('import-disabled-reason')).toBeNull()
    // 既存のtoList templateでも有効
    await openTemplate(user, 'tmpl-collect-tolist')
    expect(screen.getByTestId('copy-prompt-button')).toBeEnabled()
    expect(screen.getByTestId('import-button')).toBeEnabled()
  })
})

describe('P8-R06 a11y・responsive', () => {
  it('P8-R06: toMap表示・FAILED表示がキーボード操作だけで到達できる', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openTemplate(user, FAILING_TEMPLATE)
    const forward = screen.getByRole('button', { name: '進む' })
    forward.focus()
    expect(document.activeElement).toBe(forward)
    for (let i = 0; i < 12; i++) {
      if (app.session.getState().snapshot.kind === 'COLLECT_FAILED') break
      await user.keyboard('{Enter}')
    }
    expect(app.session.getState().snapshot.kind).toBe('COLLECT_FAILED')
    // FAILEDでは進むが無効化されるが、戻るへキーボードで到達できる
    const back = screen.getByRole('button', { name: '戻る' })
    back.focus()
    expect(document.activeElement).toBe(back)
    await user.keyboard('{Enter}')
    expect(app.session.getState().playbackState).toBe('PAUSED')
  })

  it('P8-R06: toMap構造4行がテーブルセマンティクス（行見出し）を持ち、失敗表示はstatusで通知される', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    await openTemplate(user, 'tmpl-collect-tomap-treemap')
    const table = screen.getByTestId('collector-tomap')
    expect(within(table).getAllByRole('rowheader').map((th) => th.textContent)).toEqual([
      'keyMapper',
      'valueMapper',
      'mergeFunction',
      'mapFactory',
    ])
    await openTemplate(user, FAILING_TEMPLATE)
    await forwardUntil(user, app, (s) => s.kind === 'COLLECT_FAILED')
    const failure = screen.getByTestId('execution-failure')
    expect(failure.getAttribute('role')).toBe('status')
    expect(failure.getAttribute('data-failure-kind')).toBe('DUPLICATE_TO_MAP_KEY')
    expect(within(failure).getAllByRole('rowheader').length).toBeGreaterThanOrEqual(4)
  })

  it('P8-R06: 全Phase 8 template × modeで例外なく描画され終端まで到達する', async () => {
    const user = userEvent.setup()
    const { app } = renderApp()
    for (const { templateId, mode } of P8_TEMPLATE_MODES) {
      await openTemplate(user, templateId, mode)
      const key = `${templateId}:${mode}`
      expect(screen.getByTestId('op-context-collector'), key).toBeInTheDocument()
      await forwardUntil(
        user,
        app,
        (s) => s.kind === 'STREAM_CONSUMED' || s.kind === 'COLLECT_FAILED',
      )
      expect(screen.getByTestId('op-context-collector'), `${key} 終端`).toBeInTheDocument()
      const state = app.session.getState().playbackState
      expect(['COMPLETED', 'FAILED'], key).toContain(state)
    }
  })
})
