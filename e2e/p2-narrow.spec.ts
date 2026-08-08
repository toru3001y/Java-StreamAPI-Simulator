import { expect, test } from '@playwright/test'
import { forward, selectOperation } from './utils'

/** P2-E09: 狭幅（375px、chromium-narrowプロジェクト）での型ラベルを含む長いPipeline検証 */
test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('P2-E09: 型ラベルを含む長いPipelineの横スクロール・active追従・sticky非遮蔽', async ({
  page,
}) => {
  // flatMapToInt: src → flatMapToInt → boxed → toList + 型ラベル（Stream<int[]> / IntStream / Stream<Integer>）
  await selectOperation(page, 'flatMapToInt')
  const scroll = page.getByTestId('pipeline-scroll')
  const { scrollWidth, clientWidth } = await scroll.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }))
  expect(scrollWidth).toBeGreaterThan(clientWidth)
  // ページ全体は横スクロールしない
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(pageOverflow).toBe(false)

  // boxedノードへ到達するまで進め、active node追従を確認（子1のboxed到着まで6手）
  await forward(page, 6)
  const active = page.locator('.pipeline-node[data-active]')
  await expect(active).toHaveAttribute('data-node-id', 'node-boxed')
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const container = document.querySelector('[data-testid="pipeline-scroll"]')
        const node = document.querySelector('.pipeline-node[data-active]')
        if (!container || !node) return false
        const cr = container.getBoundingClientRect()
        const nr = node.getBoundingClientRect()
        return nr.left >= cr.left - 1 && nr.right <= cr.right + 1
      }),
    )
    .toBe(true)

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

test('p2-capture-narrow: Phase 2狭幅キャプチャを保存する', async ({ page }) => {
  await selectOperation(page, 'flatMap')
  await forward(page, 4)
  await page.screenshot({ path: 'artifacts/phase-2/capture-narrow-flatmap.png', fullPage: true })
  await selectOperation(page, 'mapToInt')
  await forward(page, 3)
  await page.screenshot({ path: 'artifacts/phase-2/capture-narrow-maptoint.png', fullPage: true })
})
