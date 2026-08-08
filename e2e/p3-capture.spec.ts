import { test } from '@playwright/test'
import {
  forward,
  forwardToEnd,
  forwardUntilText,
  forwardUntilVisible,
  selectOperation,
  selectTemplate,
} from './utils'

/** Phase 3 PC幅キャプチャ（artifacts/phase-3/へ保存、指示§14・§15の証跡） */
test('p3-capture-pc: PC幅の画面キャプチャを保存する', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await selectOperation(page, 'distinct')
  await forwardUntilText(page, 'distinct-verdict', '重複')
  await page.screenshot({ path: 'artifacts/phase-3/capture-pc-distinct.png', fullPage: true })

  await selectOperation(page, 'sorted')
  await selectTemplate(page, 'tmpl-sorted-comparator')
  await forwardUntilText(page, 'sorted-phase', '並べ替え確定')
  await page.screenshot({ path: 'artifacts/phase-3/capture-pc-sorted-confirmed.png', fullPage: true })

  await selectOperation(page, 'takeWhile')
  await forwardUntilText(page, 'takewhile-stop', 'STOP')
  await page.screenshot({ path: 'artifacts/phase-3/capture-pc-takewhile-stop.png', fullPage: true })

  await selectOperation(page, 'peek')
  await forwardUntilVisible(page, 'side-effect-list')
  await page.screenshot({ path: 'artifacts/phase-3/capture-pc-peek.png', fullPage: true })

  await selectOperation(page, 'source.generate')
  await forwardToEnd(page)
  await page.screenshot({ path: 'artifacts/phase-3/capture-pc-generate-limit.png', fullPage: true })

  await selectOperation(page, 'limit')
  await forward(page, 4)
  await page.screenshot({ path: 'artifacts/phase-3/capture-pc-limit.png', fullPage: true })
})
