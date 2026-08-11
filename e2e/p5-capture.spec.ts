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

/** Phase 5 PC幅キャプチャ（artifacts/phase-5/へ保存、指示§14の証跡） */
test('p5-capture-pc: PC幅の画面キャプチャを保存する', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')

  await selectOperation(page, 'collect')
  await selectTemplate(page, 'tmpl-collect-groupingby')
  await forwardToEnd(page)
  await captureArtifact(page, 5, 'capture-pc-groupingby.png')

  await selectTemplate(page, 'tmpl-collect-groupingby-nested')
  await forwardToEnd(page)
  await captureArtifact(page, 5, 'capture-pc-groupingby-nested.png')

  await selectTemplate(page, 'tmpl-collect-groupingby-treemap')
  await forwardToEnd(page)
  await captureArtifact(page, 5, 'capture-pc-groupingby-treemap.png')

  await selectTemplate(page, 'tmpl-collect-partitioningby')
  await forwardToEnd(page)
  await captureArtifact(page, 5, 'capture-pc-partitioningby.png')

  await selectTemplate(page, 'tmpl-collect-partitioningby')
  await selectMode(page, 'emptySource')
  await forwardToEnd(page)
  await captureArtifact(page, 5, 'capture-pc-partitioning-empty.png')

  await selectTemplate(page, 'tmpl-collect-collectingandthen')
  await forwardUntilText(page, 'explanation-current', 'finisherを適用しました')
  await captureArtifact(page, 5, 'capture-pc-collecting-and-then.png')

  await selectTemplate(page, 'tmpl-collect-teeing')
  await forwardUntilText(page, 'explanation-current', 'mergerを適用しました')
  await captureArtifact(page, 5, 'capture-pc-teeing-merger.png')

  await selectTemplate(page, 'tmpl-collect-teeing')
  await selectMode(page, 'emptySource')
  await forwardToEnd(page)
  await captureArtifact(page, 5, 'capture-pc-teeing-empty.png')

  await selectTemplate(page, 'tmpl-collect-toset')
  await forwardToEnd(page)
  await captureArtifact(page, 5, 'capture-pc-toset.png')

  await selectTemplate(page, 'tmpl-collect-filtering')
  await forwardToEnd(page)
  await captureArtifact(page, 5, 'capture-pc-filtering.png')

  await selectOperation(page, 'collectTriple')
  await forwardUntilVisible(page, 'collector-triple')
  await forwardToEnd(page)
  await captureArtifact(page, 5, 'capture-pc-collect-triple.png')

  // 持越しtemplate（takeWhile / dropWhileのEmployee fieldCompare）
  await selectOperation(page, 'takeWhile')
  await selectTemplate(page, 'tmpl-takewhile-employee')
  await forwardToEnd(page)
  await captureArtifact(page, 5, 'capture-pc-takewhile-employee.png')

  await selectOperation(page, 'dropWhile')
  await selectTemplate(page, 'tmpl-dropwhile-employee')
  await forwardToEnd(page)
  await captureArtifact(page, 5, 'capture-pc-dropwhile-employee.png')
})
