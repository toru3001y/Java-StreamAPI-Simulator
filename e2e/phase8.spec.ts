import { expect, test } from '@playwright/test'
import {
  expectPlaybackState,
  forwardToEnd,
  forwardUntilText,
  forwardUntilVisible,
  selectOperation,
  selectTemplate,
  snapshotIds,
} from './utils'
import { accumulationEntryTexts, mapEntryTexts, openToMap, toMapRowText } from './p8-utils'

/**
 * P8-E01〜P8-E04: Collectors.toMapのE2E（Phase 8指示 §12.4）。
 * 実ブラウザで、identity成功・実行失敗・merge対比 / TreeMap / 比較導線・総点検回帰を確認する。
 */

const FAILING_TEMPLATE = 'tmpl-collect-tomap-duplicate'

const P8_TEMPLATE_MODES: readonly { templateId: string; mode: string }[] = [
  { templateId: 'tmpl-collect-tomap-identity', mode: 'standard' },
  { templateId: 'tmpl-collect-tomap-identity', mode: 'emptySource' },
  { templateId: 'tmpl-collect-tomap-duplicate', mode: 'standard' },
  { templateId: 'tmpl-collect-tomap-merge-first', mode: 'standard' },
  { templateId: 'tmpl-collect-tomap-merge-last', mode: 'standard' },
  { templateId: 'tmpl-collect-tomap-merge-concat', mode: 'standard' },
  { templateId: 'tmpl-collect-groupby-mergedemo', mode: 'standard' },
  { templateId: 'tmpl-collect-tomap-treemap', mode: 'standard' },
  { templateId: 'tmpl-collect-tomap-treemap', mode: 'emptySource' },
  { templateId: 'tmpl-collect-tomap-grouped', mode: 'standard' },
]

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('P8-E01: identity成功E2E（Map<String, Employee> 4 entryとentry蓄積表示・履歴復元）', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await openToMap(page, 'tmpl-collect-tomap-identity')

  // 構造4行が実行前から常設される
  expect(await toMapRowText(page, 'key-mapper')).toContain('Employee::name')
  expect(await toMapRowText(page, 'value-mapper')).toContain('Function.identity()')
  expect(await toMapRowText(page, 'merge-function')).toContain(
    'なし（重複キーでIllegalStateException）',
  )
  expect(await toMapRowText(page, 'map-factory')).toContain('なし（Map実装型は無保証）')

  // entry蓄積が1件ずつ伸びる
  await forwardUntilVisible(page, 'collector-tomap-entries')
  expect(await accumulationEntryTexts(page)).toHaveLength(1)

  await forwardToEnd(page)
  await expectPlaybackState(page, 'COMPLETED')
  await expect(page.getByTestId('output-type')).toContainText('Map<String, Employee>')
  const entries = await mapEntryTexts(page)
  expect(entries).toHaveLength(4)
  expect(entries.join(' | ')).toContain('佐藤')
  expect(await accumulationEntryTexts(page)).toHaveLength(4)
  await snapshotIds(page)

  // 履歴復元: 戻る → 進むで同じ表示に戻る
  const finalEntries = entries.join(' | ')
  await page.getByRole('button', { name: '戻る' }).click()
  await page.getByRole('button', { name: '戻る' }).click()
  await expectPlaybackState(page, 'PAUSED')
  await page.getByRole('button', { name: '進む' }).click()
  await page.getByRole('button', { name: '進む' }).click()
  await expectPlaybackState(page, 'COMPLETED')
  expect((await mapEntryTexts(page)).join(' | ')).toBe(finalEntries)
})

test('P8-E02: 実行失敗E2E（COLLECT_FAILED到達・失敗表示・進む不可・戻る→再前進の復元）', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await openToMap(page, FAILING_TEMPLATE)
  await forwardToEnd(page)

  // 教材上想定された実行失敗として表示される（ERRORとは異なる区分）
  await expectPlaybackState(page, 'FAILED')
  const failure = page.getByTestId('execution-failure')
  await expect(failure).toBeVisible()
  await expect(page.getByTestId('execution-failure-title')).toContainText('教材上想定された実行失敗')
  await expect(page.getByTestId('execution-failure-exception')).toContainText(
    'IllegalStateException',
  )
  await expect(page.getByTestId('execution-failure-key')).toContainText('関東')
  await expect(page.getByTestId('execution-failure-values')).toContainText('伊藤')
  await expect(page.getByTestId('execution-failure-values')).toContainText('渡辺')
  await expect(page.getByTestId('playback-state')).toHaveText('実行失敗（想定内）')
  // ERROR用のstopReasonは表示されない
  await expect(page.getByTestId('stop-reason')).toHaveCount(0)
  // 終端結果は確定しない
  await expect(page.getByTestId('output-map')).toHaveCount(0)
  await snapshotIds(page)

  // 進む・自動は無効、戻るは有効
  await expect(page.getByRole('button', { name: '進む' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '自動' })).toBeDisabled()
  const back = page.getByRole('button', { name: '戻る' })
  await expect(back).toBeEnabled()
  await back.click()
  await expectPlaybackState(page, 'PAUSED')
  await expect(page.getByTestId('execution-failure')).toHaveCount(0)

  // 再前進で失敗表示が履歴から復元される
  await page.getByRole('button', { name: '進む' }).click()
  await expectPlaybackState(page, 'FAILED')
  await expect(page.getByTestId('execution-failure-key')).toContainText('関東')
})

test('P8-E03: merge / TreeMap / 比較導線E2E（同一データでの結果差と直接比較）', async ({ page }) => {
  test.setTimeout(180_000)

  // first: 既存値を保持（先勝ち）→ 関東=伊藤
  await openToMap(page, 'tmpl-collect-tomap-merge-first')
  expect(await toMapRowText(page, 'merge-function')).toContain('(a, b) -> a')
  expect(await toMapRowText(page, 'merge-function')).toContain('既存値を保持（先勝ち）')
  await forwardToEnd(page)
  const firstEntries = (await mapEntryTexts(page)).join(' | ')
  expect(firstEntries).toContain('関東')
  expect(firstEntries).toContain('伊藤')
  expect(firstEntries).not.toContain('山本')

  // last: 新しい値で置換（後勝ち）→ 関東=山本（同一データ・同一keyMapper）
  await openToMap(page, 'tmpl-collect-tomap-merge-last')
  expect(await toMapRowText(page, 'merge-function')).toContain('新しい値で置換（後勝ち）')
  await forwardToEnd(page)
  const lastEntries = (await mapEntryTexts(page)).join(' | ')
  expect(lastEntries).toContain('山本')
  expect(lastEntries).not.toContain('伊藤')

  // concat: 3件衝突の順次適用 → 関東=伊藤, 渡辺, 山本
  await openToMap(page, 'tmpl-collect-tomap-merge-concat')
  await forwardToEnd(page)
  expect((await mapEntryTexts(page)).join(' | ')).toContain('伊藤, 渡辺, 山本')

  // TreeMap: キー昇順（中部 → 関東 → 関西）
  await openToMap(page, 'tmpl-collect-tomap-treemap')
  expect(await toMapRowText(page, 'map-factory')).toContain('TreeMap::new')
  await forwardToEnd(page)
  await expect(page.getByTestId('map-meta')).toContainText('TreeMap<String, Long>')
  const treeKeys = (await mapEntryTexts(page)).map((text) => text.trim().split(' ')[0])
  expect(treeKeys).toEqual(['中部', '関東', '関西'])

  // 同一データのgroupingBy比較: 関東=[伊藤, 渡辺, 山本]（List蓄積）
  await openToMap(page, 'tmpl-collect-groupby-mergedemo')
  await forwardToEnd(page)
  const groupEntries = (await mapEntryTexts(page)).join(' | ')
  expect(groupEntries).toContain('伊藤')
  expect(groupEntries).toContain('渡辺')
  expect(groupEntries).toContain('山本')
  // groupingByはbucket（キー→List）表示であり、toMapのentry表示とは異なる
  await expect(page.getByTestId('collector-buckets')).toBeVisible()
  await expect(page.getByTestId('collector-acc-tomap')).toHaveCount(0)

  // 相互参照文言（比較導線）が画面に表示される
  const details = page.getByTestId('details-disclosure')
  await expect(details).toContainText('toMap・重複キーで実行失敗')
  await expect(details).toContainText('mergeFunction: first / last / concat')
  await openToMap(page, FAILING_TEMPLATE)
  await expect(page.getByTestId('details-disclosure')).toContainText('toMapとの対比')
})

test('P8-E04: 総点検回帰（全toMap template × modeが期待終端へ到達する）', async ({ page }) => {
  test.setTimeout(300_000)
  for (const { templateId, mode } of P8_TEMPLATE_MODES) {
    await openToMap(page, templateId, mode)
    await forwardToEnd(page)
    const expectedState = templateId === FAILING_TEMPLATE ? 'FAILED' : 'COMPLETED'
    await expectPlaybackState(page, expectedState)
    await expect(page.getByTestId('op-context-collector')).toBeVisible()
    await snapshotIds(page)
  }
})

test('P8-E04: 既存操作の代表シナリオが従来どおり動作する（回帰）', async ({ page }) => {
  test.setTimeout(180_000)
  for (const [operationId, templateId] of [
    ['filter', 'tmpl-filter-basic'],
    ['collect', 'tmpl-collect-tolist'],
    ['collect', 'tmpl-collect-groupingby'],
    ['collect', 'tmpl-collect-teeing'],
  ] as const) {
    await selectOperation(page, operationId)
    await selectTemplate(page, templateId)
    await forwardToEnd(page)
    await expectPlaybackState(page, 'COMPLETED')
    await expect(page.getByTestId('execution-failure')).toHaveCount(0)
  }
})

test('P8-E04: toMap template選択中は取込UIが無効化される', async ({ page }) => {
  await openToMap(page, 'tmpl-collect-tomap-identity')
  await expect(page.getByTestId('copy-prompt-button')).toBeDisabled()
  await expect(page.getByTestId('import-button')).toBeDisabled()
  await expect(page.getByTestId('import-disabled-reason')).toContainText('toMapを含むtemplate')
  // toMap非含有のgroupingBy比較templateでは有効
  await openToMap(page, 'tmpl-collect-groupby-mergedemo')
  await expect(page.getByTestId('copy-prompt-button')).toBeEnabled()
  await expect(page.getByTestId('import-button')).toBeEnabled()
})

test('P8-E04: 重複検出とmerge適用の処理中表示が段階的に確認できる', async ({ page }) => {
  test.setTimeout(180_000)
  await openToMap(page, 'tmpl-collect-tomap-merge-concat')
  await forwardUntilText(page, 'processing-input', 'mergeFunction("伊藤", "渡辺")')
  await expect(page.getByTestId('processing-expression')).toHaveText('(s, a) -> s + ", " + a')
  await expect(page.getByTestId('processing-evaluation')).toContainText('→ "伊藤, 渡辺"')
  // 2回目のmergeは「現在Mapにある値」へ順次適用される
  await forwardUntilText(page, 'processing-input', 'mergeFunction("伊藤, 渡辺", "山本")')
  await expect(page.getByTestId('processing-evaluation')).toContainText('→ "伊藤, 渡辺, 山本"')
})
