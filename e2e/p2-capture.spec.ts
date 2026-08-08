import { test } from '@playwright/test'
import { forward, forwardToEnd, selectOperation } from './utils'

/** Phase 2 PC幅キャプチャ（artifacts/phase-2/へ保存、指示§14の証跡） */
test('p2-capture-pc: PC幅の画面キャプチャを保存する', async ({ page }) => {
  await page.goto('/')
  await selectOperation(page, 'map')
  await forward(page, 3)
  await page.screenshot({ path: 'artifacts/phase-2/capture-pc-map.png', fullPage: true })
  await selectOperation(page, 'mapToInt')
  await forward(page, 3)
  await page.screenshot({ path: 'artifacts/phase-2/capture-pc-maptoint.png', fullPage: true })
  await selectOperation(page, 'flatMap')
  await forward(page, 4)
  await page.screenshot({ path: 'artifacts/phase-2/capture-pc-flatmap.png', fullPage: true })
  await selectOperation(page, 'source.iterate3')
  await forward(page, 2)
  await page.screenshot({ path: 'artifacts/phase-2/capture-pc-iterate.png', fullPage: true })
  await selectOperation(page, 'source.empty')
  await forwardToEnd(page)
  await page.screenshot({ path: 'artifacts/phase-2/capture-pc-empty.png', fullPage: true })
})
