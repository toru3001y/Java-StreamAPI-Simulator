import { expect, test } from '@playwright/test'
import { captureArtifact } from './capture-helper'
import { forwardToEnd, forwardUntilVisible } from './utils'
import { openToMap } from './p8-utils'

/**
 * P8-E05（狭幅確認分）: 375px（chromium-narrow）でのtoMap表示・FAILED表示の検証とキャプチャ。
 * 縦積み・横スクロール・sticky非遮蔽を確認する（v0.8 §17.5の既存a11y / responsive要件）。
 *
 * `details-disclosure`のマスク理由はp8-capture.spec.tsと同じ（最下部summary行の1pxゆらぎ）。
 * 色比較のthresholdは既定のまま緩めない。
 */

/** 不安定な最下部パネルだけを比較対象から外す（threshold・maxDiffPixelsは変更しない） */
function stableShot(page: import('@playwright/test').Page) {
  return { fullPage: true as const, mask: [page.getByTestId('details-disclosure')] }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('P8-E05: 狭幅でtoMap構造4行とentry蓄積が縦積みで表示され、横スクロールが本文に漏れない', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await openToMap(page, 'tmpl-collect-tomap-identity')
  await forwardUntilVisible(page, 'collector-tomap-entries')

  // ページ本文は横スクロールしない（超過分は専用コンテナが吸収する）
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)

  // 構造4行は狭幅でも全行が表示される
  for (const row of ['key-mapper', 'value-mapper', 'merge-function', 'map-factory']) {
    await expect(page.getByTestId(`tomap-${row}`)).toBeVisible()
  }
  await expect(page.getByTestId('collector-tomap-entries')).toBeVisible()

  // sticky再生バーが本文を隠さない
  await expect(page.getByRole('toolbar', { name: '再生操作' })).toBeVisible()
  await page.evaluate(() => {
    const el = document.scrollingElement
    if (el) el.scrollTop = el.scrollHeight
  })
  const geometry = await page.evaluate(() => {
    const details = document.querySelector('[data-testid="details-disclosure"]')
    const bar = document.querySelector('.sticky-playback-bar')
    return {
      detailsBottom: details?.getBoundingClientRect().bottom ?? 0,
      barTop: bar?.getBoundingClientRect().top ?? 0,
    }
  })
  expect(geometry.detailsBottom).toBeLessThanOrEqual(geometry.barTop + 1)

  await expect(page).toHaveScreenshot('p8-e05-narrow-tomap-identity.png', stableShot(page))
})

test('P8-E05: 狭幅で実行失敗表示が読め、進む無効・戻る有効が確認できる', async ({ page }) => {
  test.setTimeout(180_000)
  await openToMap(page, 'tmpl-collect-tomap-duplicate')
  await forwardToEnd(page)

  const failure = page.getByTestId('execution-failure')
  await expect(failure).toBeVisible()
  await expect(page.getByTestId('execution-failure-exception')).toContainText(
    'IllegalStateException',
  )
  await expect(page.getByTestId('execution-failure-key')).toContainText('関東')
  await expect(page.getByRole('button', { name: '進む' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '戻る' })).toBeEnabled()

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)

  await expect(page).toHaveScreenshot('p8-e05-narrow-tomap-failed.png', stableShot(page))
})

test('p8-capture-narrow: Phase 8狭幅キャプチャを保存する', async ({ page }) => {
  test.setTimeout(180_000)

  await openToMap(page, 'tmpl-collect-tomap-identity')
  await forwardToEnd(page)
  await captureArtifact(page, 8, 'p8-narrow-tomap-identity.png')

  await openToMap(page, 'tmpl-collect-tomap-duplicate')
  await forwardToEnd(page)
  await captureArtifact(page, 8, 'p8-narrow-tomap-failed.png')

  await openToMap(page, 'tmpl-collect-tomap-merge-concat')
  await forwardToEnd(page)
  await captureArtifact(page, 8, 'p8-narrow-tomap-merge-concat.png')

  await openToMap(page, 'tmpl-collect-groupby-mergedemo')
  await forwardToEnd(page)
  await captureArtifact(page, 8, 'p8-narrow-groupby-mergedemo.png')

  await openToMap(page, 'tmpl-collect-tomap-treemap')
  await forwardToEnd(page)
  await captureArtifact(page, 8, 'p8-narrow-tomap-treemap.png')
})
