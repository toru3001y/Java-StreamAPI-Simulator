import { expect, test } from '@playwright/test'
import { forward, forwardToEnd, forwardUntilVisible, selectOperation, selectTemplate } from './utils'

/** P4-E10（狭幅確認分）: 375px（chromium-narrow）でのPhase 4終端表示検証とキャプチャ */
test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('P4-E10-narrow: 狭幅でterminal結果・Side Effect・stickyが崩れない', async ({ page }) => {
  // statistics: 表が狭幅でも読める
  await selectOperation(page, 'summaryStatistics')
  await forwardToEnd(page)
  await expect(page.getByTestId('output-statistics')).toBeVisible()
  await expect(page.getByTestId('stats-average')).toHaveText('2.5')
  // ページ全体は横スクロールしない
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(pageOverflow).toBe(false)
  // forEach: Side Effectビューが表示される
  await selectOperation(page, 'forEach')
  await forwardToEnd(page)
  await expect(page.getByTestId('side-effect-panel')).toBeVisible()
  await expect(page.getByTestId('side-effect-list').locator('li')).toHaveCount(4)
  // stickyバーが本文を隠さない
  await page.evaluate(() => {
    const el = document.scrollingElement
    if (el) el.scrollTop = el.scrollHeight
  })
  const geometry = await page.evaluate(() => {
    const details = document.querySelector('[data-testid="details-disclosure"]')
    const bar = document.querySelector('.sticky-playback-bar')
    if (!details || !bar) return null
    return {
      detailsBottom: details.getBoundingClientRect().bottom,
      barTop: bar.getBoundingClientRect().top,
    }
  })
  expect(geometry).not.toBeNull()
  if (geometry) {
    expect(geometry.detailsBottom).toBeLessThanOrEqual(geometry.barTop + 1)
  }
})

test('p4-capture-narrow: Phase 4狭幅キャプチャを保存する', async ({ page }) => {
  await selectOperation(page, 'summaryStatistics')
  await forwardToEnd(page)
  await page.screenshot({ path: 'artifacts/phase-4/capture-narrow-statistics.png', fullPage: true })
  await selectOperation(page, 'reduce')
  await selectTemplate(page, 'tmpl-reduce-salary')
  await forwardUntilVisible(page, 'reduce-history')
  await page.screenshot({ path: 'artifacts/phase-4/capture-narrow-reduce.png', fullPage: true })
  await selectOperation(page, 'findFirst')
  await forward(page, 6)
  await page.screenshot({ path: 'artifacts/phase-4/capture-narrow-findfirst.png', fullPage: true })
})
