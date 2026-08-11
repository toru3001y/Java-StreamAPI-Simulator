import { expect, test } from '@playwright/test'
import { captureArtifact } from './capture-helper'
import {
  forwardToEnd,
  forwardUntilText,
  selectMode,
  selectOperation,
  selectTemplate,
} from './utils'

/** P5-E10（狭幅確認分）: 375px（chromium-narrow）でのCollector表示検証とキャプチャ */
test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('P5-E10-narrow: 狭幅でCollector構造ツリー・Map結果・stickyが崩れない', async ({ page }) => {
  await selectOperation(page, 'collect')
  await selectTemplate(page, 'tmpl-collect-groupingby-nested')
  await forwardToEnd(page)
  // 構造ツリーとMap結果が狭幅でも読める
  await expect(page.getByTestId('op-context-collector')).toBeVisible()
  await expect(page.getByTestId('output-map')).toBeVisible()
  // ページ全体は横スクロールしない（構造ツリーは自身のコンテナ内でスクロールする）
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(pageOverflow).toBe(false)
  // Pipelineは狭幅でも専用横スクロールを維持する
  await expect(page.getByTestId('pipeline-scroll')).toBeVisible()

  // teeingの左右branch表示も狭幅で崩れない
  await selectTemplate(page, 'tmpl-collect-teeing')
  await forwardUntilText(page, 'explanation-current', 'mergerを適用しました')
  await expect(page.getByTestId('collector-teeing')).toBeVisible()
  await expect(page.getByTestId('teeing-final')).toBeVisible()
  const overflowAfterTeeing = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(overflowAfterTeeing).toBe(false)

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

test('p5-capture-narrow: Phase 5狭幅キャプチャを保存する', async ({ page }) => {
  test.setTimeout(120_000)
  await selectOperation(page, 'collect')
  await selectTemplate(page, 'tmpl-collect-groupingby-nested')
  await forwardToEnd(page)
  await captureArtifact(page, 5, 'capture-narrow-groupingby-nested.png')

  await selectTemplate(page, 'tmpl-collect-teeing')
  await forwardUntilText(page, 'explanation-current', 'mergerを適用しました')
  await captureArtifact(page, 5, 'capture-narrow-teeing-merger.png')

  await selectTemplate(page, 'tmpl-collect-partitioningby')
  await selectMode(page, 'emptySource')
  await forwardToEnd(page)
  await captureArtifact(page, 5, 'capture-narrow-partitioning-empty.png')

  await selectTemplate(page, 'tmpl-collect-collectingandthen')
  await forwardUntilText(page, 'explanation-current', 'finisherを適用しました')
  await captureArtifact(page, 5, 'capture-narrow-collecting-and-then.png')
})
