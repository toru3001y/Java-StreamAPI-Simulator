import { expect, test } from '@playwright/test'
import {
  expectPlaybackState,
  forward,
  forwardToEnd,
  forwardUntilText,
  forwardUntilVisible,
  selectMode,
  selectOperation,
  selectTemplate,
  snapshotIds,
} from './utils'

/** Phase 4 E2E（指示§13）。PC幅（chromium-pc）で実行する。 */
test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('P4-E01: reduce標準から結果確定まで（accumulator履歴と最終Optional）', async ({ page }) => {
  await selectOperation(page, 'reduce')
  // 最初のtemplate（String連結・identityなし）
  await expect(page.getByTestId('java-code-panel')).toContainText('.reduce((a, b) -> a + b);')
  // 1要素目で累積値が初期化され、履歴が増えていく
  await forwardUntilText(page, 'reduce-accumulator', '"JavaSQL"')
  await expect(page.getByTestId('reduce-history').locator('li')).toHaveCount(2)
  await forwardToEnd(page)
  await expect(page.getByTestId('optional-value')).toHaveText('Optional["JavaSQLGit"]')
  await expectPlaybackState(page, 'COMPLETED')
  await expect(page.getByTestId('explanation-current')).toContainText('STREAM CONSUMED')
})

test('P4-E02: 空reduceがOptional.emptyになる', async ({ page }) => {
  await selectOperation(page, 'reduce')
  await selectMode(page, 'emptySource')
  await forwardToEnd(page)
  await expect(page.getByTestId('optional-empty')).toContainText('Optional.empty()')
  // identityありは空Streamでidentityを返す
  await selectTemplate(page, 'tmpl-reduce-int-identity')
  await selectMode(page, 'emptySource')
  await forwardToEnd(page)
  await expect(page.getByTestId('output-scalar')).toContainText('100')
})

test('P4-E03: match短絡と残り未評価', async ({ page }) => {
  await selectOperation(page, 'anyMatch')
  await forwardToEnd(page)
  await expect(page.getByTestId('output-scalar')).toContainText('true')
  await expect(page.getByTestId('match-decided')).toContainText('STOP')
  // 高橋のtrueで確定し、田中は未評価のまま
  await expect(page.locator('.element-row[data-element-id="emp-004"]')).toHaveAttribute(
    'data-state',
    'UNEVALUATED',
  )
  await expect(page.getByTestId('match-progress')).toContainText('3回')
})

test('P4-E04: 空matchがfalse / true / trueとなりvacuous truthを説明する', async ({ page }) => {
  await selectOperation(page, 'anyMatch')
  await selectMode(page, 'emptySource')
  await forwardToEnd(page)
  await expect(page.getByTestId('output-scalar')).toContainText('false')
  await selectOperation(page, 'allMatch')
  await selectMode(page, 'emptySource')
  await forwardToEnd(page)
  await expect(page.getByTestId('output-scalar')).toContainText('true')
  await expect(page.getByTestId('match-vacuous-note')).toContainText('vacuous truth')
  await selectOperation(page, 'noneMatch')
  await selectMode(page, 'emptySource')
  await forwardToEnd(page)
  await expect(page.getByTestId('output-scalar')).toContainText('true')
  await expect(page.getByTestId('match-vacuous-note')).toContainText('一度も評価されていません')
})

test('P4-E05: findAnyの結果と非保証注記', async ({ page }) => {
  await selectOperation(page, 'findAny')
  // 非決定性の注記は初期状態から常時表示
  await expect(page.getByTestId('find-nondeterminism-note')).toContainText('保証しません')
  await forwardToEnd(page)
  await expect(page.getByTestId('optional-value')).toContainText('佐藤')
  await expect(page.getByTestId('find-nondeterminism-note')).toContainText('保証しません')
  await expect(page.getByTestId('find-decided')).toBeVisible()
})

test('P4-E06: sum / average / statisticsの表示', async ({ page }) => {
  test.setTimeout(90_000)
  await selectOperation(page, 'sum')
  await forwardToEnd(page)
  await expect(page.getByTestId('output-scalar')).toContainText('8')
  await selectOperation(page, 'average')
  await forwardToEnd(page)
  await expect(page.getByTestId('optional-value')).toHaveText('OptionalDouble[2.5]')
  await selectOperation(page, 'summaryStatistics')
  await forwardToEnd(page)
  await expect(page.getByTestId('stats-count')).toHaveText('4')
  await expect(page.getByTestId('stats-min')).toHaveText('1')
  await expect(page.getByTestId('stats-max')).toHaveText('4')
  await expect(page.getByTestId('stats-average')).toHaveText('2.5')
  // 空Streamの正規初期値
  await selectMode(page, 'emptySource')
  await forwardToEnd(page)
  await expect(page.getByTestId('stats-min')).toHaveText('Integer.MAX_VALUE')
  await expect(page.getByTestId('stats-empty-note')).toBeVisible()
})

test('P4-E07: toArrayの型・length・値', async ({ page }) => {
  await selectOperation(page, 'toArray')
  await selectTemplate(page, 'tmpl-toarray-generator')
  await expect(page.getByTestId('java-code-panel')).toContainText('.toArray(String[]::new);')
  await forwardToEnd(page)
  await expect(page.getByTestId('array-meta')).toContainText('String')
  await expect(page.getByTestId('array-meta')).toContainText('length: 2')
  const items = page.getByTestId('array-items').locator('li')
  await expect(items).toHaveCount(2)
  await expect(items.first()).toContainText('[0]')
  await expect(items.first()).toContainText('"Java"')
  // primitive配列
  await selectTemplate(page, 'tmpl-toarray-int')
  await forwardToEnd(page)
  await expect(page.getByTestId('array-meta')).toContainText('component type: int')
  await expect(page.getByTestId('array-meta')).toContainText('length: 3')
})

test('P4-E08: forEach / forEachOrderedのSide Effect', async ({ page }) => {
  await selectOperation(page, 'forEach')
  await expect(page.getByTestId('side-effect-empty')).toContainText('0回')
  await forwardToEnd(page)
  await expect(page.getByTestId('side-effect-list').locator('li')).toHaveCount(4)
  await expect(page.getByTestId('side-effect-list')).toContainText('佐藤')
  await expect(page.getByTestId('output-void')).toContainText('void')
  await selectOperation(page, 'forEachOrdered')
  await forwardToEnd(page)
  const entries = page.getByTestId('side-effect-list').locator('li')
  await expect(entries).toHaveCount(3)
  await expect(entries.nth(0)).toContainText('3')
  await expect(entries.nth(1)).toContainText('1')
  await expect(entries.nth(2)).toContainText('4')
})

test('P4-E09: 途中から自動、停止、戻る、再進行', async ({ page }) => {
  test.setTimeout(90_000)
  await selectOperation(page, 'reduce')
  await selectTemplate(page, 'tmpl-reduce-salary')
  await forward(page, 4)
  const idAtManual = await snapshotIds(page)
  // 自動 → 停止
  await page.getByRole('button', { name: '自動' }).click()
  await expectPlaybackState(page, 'PLAYING')
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: '停止' }).click()
  await expectPlaybackState(page, 'PAUSED')
  // 戻る → 再進行で同じsnapshotを復元
  const idBeforeBack = await snapshotIds(page)
  await page.getByRole('button', { name: '戻る' }).click()
  await page.getByRole('button', { name: '進む' }).click()
  expect(await snapshotIds(page)).toBe(idBeforeBack)
  expect(idBeforeBack).not.toBe(idAtManual)
  // 自動で最後まで進み停止
  await page.getByRole('button', { name: '自動' }).click()
  await expect(page.getByTestId('playback-state')).toHaveAttribute('data-state', 'COMPLETED', {
    timeout: 40_000,
  })
  await expect(page.getByTestId('output-scalar')).toContainText('21_700_000L')
})

test('P4-E10: 代表snapshotの視覚回帰（reduce・stats・match STOP・Optional.empty）', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await selectOperation(page, 'reduce')
  await selectTemplate(page, 'tmpl-reduce-salary')
  await forwardUntilVisible(page, 'reduce-history')
  await expect(page.getByTestId('reduce-history')).toBeVisible()
  await expect(page).toHaveScreenshot('p4-e10-reduce-accumulator.png', { fullPage: true })

  await selectOperation(page, 'summaryStatistics')
  await forwardToEnd(page)
  await expect(page.getByTestId('output-statistics')).toBeVisible()
  await expect(page).toHaveScreenshot('p4-e10-statistics.png', { fullPage: true })

  await selectOperation(page, 'anyMatch')
  await forwardUntilText(page, 'match-decided', 'STOP')
  await expect(page).toHaveScreenshot('p4-e10-anymatch-stop.png', { fullPage: true })

  await selectOperation(page, 'min')
  await selectMode(page, 'emptySource')
  await forwardToEnd(page)
  await expect(page.getByTestId('optional-empty')).toBeVisible()
  await expect(page).toHaveScreenshot('p4-e10-optional-empty.png', { fullPage: true })
})
