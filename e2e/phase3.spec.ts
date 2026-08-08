import { expect, test } from '@playwright/test'
import {
  expectPlaybackState,
  forward,
  forwardToEnd,
  forwardUntilText,
  forwardUntilVisible,
  outputLabels,
  selectMode,
  selectOperation,
  selectTemplate,
  snapshotIds,
} from './utils'

/** Phase 3 E2E（指示§13.4）。PC幅（chromium-pc）で実行する。 */
test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('P3-E01: distinctの重複入力を進む / 戻るで追跡し、最初の要素だけが残る', async ({ page }) => {
  await selectOperation(page, 'distinct')
  // 3件目（重複"Java"）の照合確定まで進める
  await forwardUntilText(page, 'distinct-verdict', '重複')
  await expect(page.getByTestId('distinct-seen')).toContainText('"Java"')
  await expect(page.getByTestId('distinct-seen')).toContainText('"SQL"')
  const idAtDuplicate = await snapshotIds(page)
  // 除外確定 → 入力パネルで重複要素が除外済みになる
  await forward(page, 1)
  await expect(page.locator('.element-row[data-element-id="of-003"]')).toHaveAttribute(
    'data-state',
    'REJECTED',
  )
  // 戻ると照合snapshotへ完全復元される
  await page.getByRole('button', { name: '戻る' }).click()
  expect(await snapshotIds(page)).toBe(idAtDuplicate)
  // 最後まで進めると、encounter orderで最初の要素だけが残る
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['"Java"', '"SQL"', '"Git"'])
  await expectPlaybackState(page, 'COMPLETED')
})

test('P3-E02: sortedのnatural / Comparator・buffer・order confirmed・stable同値キー・1件放出', async ({
  page,
}) => {
  test.setTimeout(90_000)
  // natural
  await selectOperation(page, 'sorted')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['"API"', '"Git"', '"Java"', '"SQL"'])
  // Comparator（region昇順）
  await selectTemplate(page, 'tmpl-sorted-comparator')
  await expect(page.getByTestId('java-code-panel')).toContainText(
    '.sorted(Comparator.comparing(Employee::region))',
  )
  // 全4件のbuffer蓄積 → 並べ替え確定
  await forwardUntilText(page, 'sorted-phase', '並べ替え確定')
  await expect(page.getByTestId('sorted-buffer').locator('li')).toHaveCount(4)
  await expect(page.getByTestId('sorted-emit-position')).toContainText('0/4')
  // 確定snapshotでは処理中要素0件（buffer全体の順序確定であることを表示）
  await expect(page.getByTestId('processing-panel')).toContainText('buffer全体')
  // 1件放出で放出位置が1へ進む
  await forward(page, 1)
  await expect(page.getByTestId('sorted-emit-position')).toContainText('1/4')
  // stable: 同値キー（関東）の佐藤が高橋より先に残る
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual([
    '田中（age=29）',
    '佐藤（age=35）',
    '高橋（age=42）',
    '鈴木（age=27）',
  ])
})

test('P3-E03: generate / iterate2を途中から自動再生し、所定件数で有限完了する', async ({ page }) => {
  test.setTimeout(90_000)
  await selectOperation(page, 'source.generate')
  // source infiniteとlimit有限化の区別表示
  await expect(page.getByTestId('infinite-source-note')).toContainText('無限source')
  await expect(page.getByTestId('infinite-source-note')).toContainText('limit')
  // 手動で2歩 → 自動再生で最後まで
  await forward(page, 2)
  await page.getByRole('button', { name: '自動' }).click()
  await expectPlaybackState(page, 'PLAYING')
  await expect(page.getByTestId('playback-state')).toHaveAttribute('data-state', 'COMPLETED', {
    timeout: 40_000,
  })
  expect(await outputLabels(page)).toEqual(['1', '2', '3'])
  // iterate2 + limit(5)
  await selectOperation(page, 'source.iterate2')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['1', '2', '3', '4', '5'])
})

test('P3-E04: skipが指定件数を除外し、その後の全要素を通す', async ({ page }) => {
  await selectOperation(page, 'skip')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['30', '40'])
  await expect(page.getByTestId('skip-count')).toContainText('2/2')
  await expect(page.getByTestId('skip-pass-mode')).toBeVisible()
  await expect(page.locator('.element-row[data-element-id="numbers-001"]')).toHaveAttribute(
    'data-state',
    'REJECTED',
  )
  await expect(page.locator('.element-row[data-element-id="numbers-004"]')).toHaveAttribute(
    'data-state',
    'PASSED',
  )
})

test('P3-E05: takeWhileが最初のfalseでSTOPし、後続が未評価のまま結果確定する', async ({ page }) => {
  await selectOperation(page, 'takeWhile')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['1', '2'])
  await expect(page.getByTestId('takewhile-stop')).toContainText('STOP')
  await expect(page.getByTestId('takewhile-boundary')).toContainText('6')
  // 3はPredicateならtrueだが、実際には評価されないことを画面で明示（§7.6）
  await expect(page.getByTestId('takewhile-boundary')).toContainText('評価されず')
  await expect(page.locator('.element-row[data-element-id="numbers-004"]')).toHaveAttribute(
    'data-state',
    'UNEVALUATED',
  )
  await expect(page.locator('.element-row[data-element-id="numbers-005"]')).toHaveAttribute(
    'data-state',
    'UNEVALUATED',
  )
  await expectPlaybackState(page, 'COMPLETED')
})

test('P3-E06: dropWhileが最初のfalseから通過モードとなり、後続Predicateを評価しない', async ({
  page,
}) => {
  await selectOperation(page, 'dropWhile')
  await expect(page.getByTestId('dropwhile-mode')).toHaveAttribute('data-mode', 'DROPPING')
  // 境界要素6で通過モードへ
  await forwardUntilText(page, 'dropwhile-mode', '通過モード')
  await expect(page.getByTestId('dropwhile-boundary')).toContainText('6')
  await expect(page.getByTestId('dropwhile-boundary')).toContainText('再評価せず')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['6', '3', '7'])
  // 通過モード後の3・7は通過済み（Predicate非評価で通過）
  await expect(page.locator('.element-row[data-element-id="numbers-004"]')).toHaveAttribute(
    'data-state',
    'PASSED',
  )
})

test('P3-E07: peekのaction履歴が1件ずつ増え、戻る / 再進行で復元される', async ({ page }) => {
  await selectOperation(page, 'peek')
  // 0回状態の表示
  await expect(page.getByTestId('side-effect-empty')).toContainText('0回')
  // 1件目のaction
  await forwardUntilVisible(page, 'side-effect-list')
  await expect(page.getByTestId('side-effect-list').locator('li')).toHaveCount(1)
  await expect(page.getByTestId('side-effect-list')).toContainText('佐藤')
  const idAtFirstAction = await snapshotIds(page)
  // 2件目
  await forwardUntilText(page, 'peek-call-count', '2回')
  await expect(page.getByTestId('side-effect-list').locator('li')).toHaveCount(2)
  // 戻ると履歴が減り、再進行で復元される（実actionは再実行されない）
  const backButton = page.getByRole('button', { name: '戻る' })
  await backButton.click()
  await backButton.click()
  await backButton.click()
  await backButton.click()
  await expect(page.getByTestId('side-effect-list').locator('li')).toHaveCount(1)
  expect(await snapshotIds(page)).toBe(idAtFirstAction)
  // 最後まで進めると4件の履歴、通常結果は不変
  await forwardToEnd(page)
  await expect(page.getByTestId('side-effect-list').locator('li')).toHaveCount(4)
  expect(await outputLabels(page)).toEqual([
    '佐藤（age=35）',
    '鈴木（age=27）',
    '高橋（age=42）',
    '田中（age=29）',
  ])
})

test('P3-E08: stateful途中の操作 / template / mode切替でtimerと履歴を正しく初期化する', async ({
  page,
}) => {
  await selectOperation(page, 'sorted')
  await selectTemplate(page, 'tmpl-sorted-comparator')
  await forward(page, 5)
  await page.getByRole('button', { name: '自動' }).click()
  await expectPlaybackState(page, 'PLAYING')
  const idBefore = await snapshotIds(page)
  // mode切替: timer停止、新revision、history 1件、READY
  await selectMode(page, 'emptySource')
  await expectPlaybackState(page, 'READY')
  await expect(page.getByTestId('playback-position')).toContainText('snapshot 1 /')
  const idAfterMode = await snapshotIds(page)
  expect(idAfterMode).not.toBe(idBefore)
  expect(idAfterMode.endsWith('#0')).toBe(true)
  await page.waitForTimeout(2200)
  await expect(page.getByTestId('playback-position')).toContainText('snapshot 1 /')
  // 操作切替でも初期化され、操作固有状態が新しいPipelineのものへ切替わる
  await selectOperation(page, 'takeWhile')
  await expectPlaybackState(page, 'READY')
  await expect(page.getByTestId('op-context-takeWhile')).toBeVisible()
  const idAfterOperation = await snapshotIds(page)
  expect(idAfterOperation).not.toBe(idAfterMode)
})

test('P3-E10: distinct重複・sorted order confirmed・take STOP・peek actionの視覚回帰', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await selectOperation(page, 'distinct')
  await forwardUntilText(page, 'distinct-verdict', '重複')
  await expect(page.getByTestId('distinct-seen')).toBeVisible()
  await expect(page).toHaveScreenshot('p3-e10-distinct-duplicate.png', { fullPage: true })

  await selectOperation(page, 'sorted')
  await selectTemplate(page, 'tmpl-sorted-comparator')
  await forwardUntilText(page, 'sorted-phase', '並べ替え確定')
  await expect(page.getByTestId('sorted-confirmed')).toBeVisible()
  await expect(page).toHaveScreenshot('p3-e10-sorted-order-confirmed.png', { fullPage: true })

  await selectOperation(page, 'takeWhile')
  await forwardUntilText(page, 'takewhile-stop', 'STOP')
  await expect(page).toHaveScreenshot('p3-e10-takewhile-stop.png', { fullPage: true })

  await selectOperation(page, 'peek')
  await forwardUntilVisible(page, 'side-effect-list')
  await expect(page).toHaveScreenshot('p3-e10-peek-action.png', { fullPage: true })
})
