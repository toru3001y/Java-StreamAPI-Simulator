import { test } from '@playwright/test'
import { captureArtifact } from './capture-helper'
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
  await captureArtifact(page, 4, 'capture-pc-reduce.png')

  await selectOperation(page, 'count')
  await forwardToEnd(page)
  await captureArtifact(page, 4, 'capture-pc-count.png')

  await selectOperation(page, 'min')
  await forwardUntilText(page, 'minmax-candidate', '鈴木')
  await captureArtifact(page, 4, 'capture-pc-min.png')

  await selectOperation(page, 'anyMatch')
  await forwardUntilText(page, 'match-decided', 'STOP')
  await captureArtifact(page, 4, 'capture-pc-anymatch.png')

  await selectOperation(page, 'summaryStatistics')
  await forwardToEnd(page)
  await captureArtifact(page, 4, 'capture-pc-statistics.png')

  await selectOperation(page, 'toArray')
  await selectTemplate(page, 'tmpl-toarray-generator')
  await forwardToEnd(page)
  await captureArtifact(page, 4, 'capture-pc-toarray.png')

  await selectOperation(page, 'forEach')
  await forwardToEnd(page)
  await captureArtifact(page, 4, 'capture-pc-foreach.png')

  await selectOperation(page, 'reduce')
  await selectMode(page, 'emptySource')
  await forwardToEnd(page)
  await captureArtifact(page, 4, 'capture-pc-optional-empty.png')
})
