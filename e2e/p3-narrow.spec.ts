import { expect, test } from '@playwright/test'
import { captureArtifact } from './capture-helper'
import { forward, forwardUntilVisible, selectOperation, selectTemplate } from './utils'

/** P3-E09: 狭幅（375px、chromium-narrowプロジェクト）でのPhase 3複合Pipeline検証 */
test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('P3-E09: Phase 3複合Pipelineの横スクロール・active追従・Side Effect・sticky非遮蔽', async ({
  page,
}) => {
  // peek途中0件template: src → filter → peek → toList（4ノード + Side Effectビュー）
  await selectOperation(page, 'peek')
  await selectTemplate(page, 'tmpl-peek-midempty')
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
  // Side Effectビューは狭幅でも表示され、0回状態が読める
  await expect(page.getByTestId('side-effect-panel')).toBeVisible()
  await expect(page.getByTestId('side-effect-empty')).toContainText('0回')

  // filterノードへ進めてactive追従を確認
  await forward(page, 2)
  const active = page.locator('.pipeline-node[data-active]')
  await expect(active).toHaveAttribute('data-node-id', 'node-filter-1')
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

test('p3-capture-narrow: Phase 3狭幅キャプチャを保存する', async ({ page }) => {
  await selectOperation(page, 'sorted')
  await selectTemplate(page, 'tmpl-sorted-comparator')
  await forward(page, 13)
  await captureArtifact(page, 3, 'capture-narrow-sorted.png')
  await selectOperation(page, 'peek')
  await forwardUntilVisible(page, 'side-effect-list')
  await captureArtifact(page, 3, 'capture-narrow-peek.png')
  await selectOperation(page, 'takeWhile')
  await forward(page, 12)
  await captureArtifact(page, 3, 'capture-narrow-takewhile.png')
})
