import { expect, test } from '@playwright/test'
import { captureArtifact } from './capture-helper'
import { forwardToEnd, forwardUntilText, forwardUntilVisible } from './utils'
import { openGather } from './p7-utils'

/**
 * P7-E05（狭幅確認分）: 375px（chromium-narrow）でのGathererパネル表示検証とキャプチャ。
 * 縦積み・横スクロール・sticky非遮蔽を確認する（v0.8 §17.5の既存a11y / responsive要件）。
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('P7-E05: 狭幅でGathererパネルが縦積みで表示され、横スクロールが本文に漏れない', async ({ page }) => {
  test.setTimeout(180_000)
  await openGather(page, 'tmpl-gather-window-fixed')
  await forwardUntilText(page, 'gatherer-emitted', '佐藤')

  // ページ本文は横スクロールしない（超過分は専用コンテナが吸収する）
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)

  // 構成要素4行は狭幅でも全行が表示される（CSSで縦積みになる）
  for (const name of ['initializer', 'integrator', 'combiner', 'finisher']) {
    await expect(page.getByTestId(`gatherer-element-${name}`)).toBeVisible()
  }

  // sticky再生バーが本文を隠さない（既存P2〜P4 narrowと同じ検証手法）
  await expect(page.getByRole('toolbar', { name: '再生操作' })).toBeVisible()
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

  await expect(page).toHaveScreenshot('p7-e05-narrow-window-fixed.png', { fullPage: true })
})

test('P7-E05: 狭幅でscan / foldの累積表示と取込無効化が読める', async ({ page }) => {
  test.setTimeout(180_000)
  await openGather(page, 'tmpl-gather-scan')
  await forwardToEnd(page)
  await expect(page.getByTestId('gatherer-history')).toBeVisible()
  await expect(page).toHaveScreenshot('p7-e05-narrow-scan.png', { fullPage: true })

  await openGather(page, 'tmpl-gather-fold')
  await expect(page.getByTestId('import-disabled-reason')).toContainText('取込対象外')
  await expect(page).toHaveScreenshot('p7-e05-narrow-import-disabled.png', { fullPage: true })
})

test('p7-capture-narrow: 狭幅の画面キャプチャを保存する', async ({ page }) => {
  test.setTimeout(300_000)

  await openGather(page, 'tmpl-gather-window-fixed')
  await captureArtifact(page, 7, 'capture-narrow-window-fixed-initialized.png')
  await forwardUntilText(page, 'gatherer-emitted', '佐藤')
  await captureArtifact(page, 7, 'capture-narrow-window-fixed-emitted.png')

  await openGather(page, 'tmpl-gather-window-sliding')
  await forwardUntilVisible(page, 'gatherer-evicted')
  await captureArtifact(page, 7, 'capture-narrow-window-sliding-evicted.png')

  await openGather(page, 'tmpl-gather-scan')
  await forwardToEnd(page)
  await captureArtifact(page, 7, 'capture-narrow-scan-completed.png')

  await openGather(page, 'tmpl-gather-fold')
  await forwardToEnd(page)
  await captureArtifact(page, 7, 'capture-narrow-fold-completed.png')

  await openGather(page, 'tmpl-gather-scan', 'emptySource')
  await forwardUntilText(page, 'explanation-current', 'initializerが中間状態を生成しました')
  await captureArtifact(page, 7, 'capture-narrow-empty-initialized.png')

  await openGather(page, 'tmpl-gather-window-fixed')
  await expect(page.getByTestId('import-disabled-reason')).toContainText('取込対象外')
  await captureArtifact(page, 7, 'capture-narrow-import-disabled.png')
})
