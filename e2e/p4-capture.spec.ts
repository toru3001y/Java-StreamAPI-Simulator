import { test } from '@playwright/test'
import {
  forwardToEnd,
  forwardUntilText,
  forwardUntilVisible,
  selectMode,
  selectOperation,
  selectTemplate,
} from './utils'

/** Phase 4 PC幅キャプチャ（artifacts/phase-4/へ保存、指示§15の証跡） */
test('p4-capture-pc: PC幅の画面キャプチャを保存する', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await selectOperation(page, 'reduce')
  await selectTemplate(page, 'tmpl-reduce-salary')
  await forwardUntilVisible(page, 'reduce-history')
  await page.screenshot({ path: 'artifacts/phase-4/capture-pc-reduce.png', fullPage: true })

  await selectOperation(page, 'count')
  await forwardToEnd(page)
  await page.screenshot({ path: 'artifacts/phase-4/capture-pc-count.png', fullPage: true })

  await selectOperation(page, 'min')
  await forwardUntilText(page, 'minmax-candidate', '鈴木')
  await page.screenshot({ path: 'artifacts/phase-4/capture-pc-min.png', fullPage: true })

  await selectOperation(page, 'anyMatch')
  await forwardUntilText(page, 'match-decided', 'STOP')
  await page.screenshot({ path: 'artifacts/phase-4/capture-pc-anymatch.png', fullPage: true })

  await selectOperation(page, 'summaryStatistics')
  await forwardToEnd(page)
  await page.screenshot({ path: 'artifacts/phase-4/capture-pc-statistics.png', fullPage: true })

  await selectOperation(page, 'toArray')
  await selectTemplate(page, 'tmpl-toarray-generator')
  await forwardToEnd(page)
  await page.screenshot({ path: 'artifacts/phase-4/capture-pc-toarray.png', fullPage: true })

  await selectOperation(page, 'forEach')
  await forwardToEnd(page)
  await page.screenshot({ path: 'artifacts/phase-4/capture-pc-foreach.png', fullPage: true })

  await selectOperation(page, 'reduce')
  await selectMode(page, 'emptySource')
  await forwardToEnd(page)
  await page.screenshot({ path: 'artifacts/phase-4/capture-pc-optional-empty.png', fullPage: true })
})
