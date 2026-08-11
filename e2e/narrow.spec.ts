import { expect, test } from '@playwright/test'
import { captureArtifact } from './capture-helper'
import { forward, selectTemplate } from './utils'

/** 狭幅レイアウト検証（chromium-narrowプロジェクト、375px幅で実行される） */
test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('P1-E09: 狭幅でコード / 説明が縦積みになり、Pipelineは横スクロールを維持する', async ({
  page,
}) => {
  // コード / 説明の縦積み
  const javaBox = await page.getByTestId('java-code-panel').boundingBox()
  const explanationBox = await page.getByTestId('explanation-panel').boundingBox()
  expect(javaBox).not.toBeNull()
  expect(explanationBox).not.toBeNull()
  if (javaBox && explanationBox) {
    expect(Math.abs(javaBox.x - explanationBox.x)).toBeLessThan(2)
    expect(explanationBox.y).toBeGreaterThanOrEqual(javaBox.y + javaBox.height - 1)
  }
  // 入力 → 処理中 → 出力も縦積み
  const inputBox = await page.getByTestId('input-panel').boundingBox()
  const processingBox = await page.getByTestId('processing-panel').boundingBox()
  expect(inputBox).not.toBeNull()
  expect(processingBox).not.toBeNull()
  if (inputBox && processingBox) {
    expect(processingBox.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height - 1)
  }

  // Pipelineは狭幅でも非折返し・専用横スクロール
  await selectTemplate(page, 'tmpl-filter-chain')
  const { scrollWidth, clientWidth } = await page
    .getByTestId('pipeline-scroll')
    .evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
  expect(scrollWidth).toBeGreaterThan(clientWidth)
  // ページ全体は横スクロールしない
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(pageOverflow).toBe(false)

  // stickyバーが本文を隠さない（下部余白の確保）
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

test('capture-narrow: 狭幅の画面キャプチャを保存する', async ({ page }) => {
  await forward(page, 4)
  await captureArtifact(page, 1, 'capture-narrow-standard.png')
  await selectTemplate(page, 'tmpl-filter-chain')
  await captureArtifact(page, 1, 'capture-narrow-chain.png')
})
