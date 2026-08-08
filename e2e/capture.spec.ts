import { test } from '@playwright/test'
import { forward, selectTemplate } from './utils'

/** PC幅の画面キャプチャ（artifacts/phase-1/へ保存、§23.5の証跡） */
test('capture-pc: PC幅の画面キャプチャを保存する', async ({ page }) => {
  await page.goto('/')
  await page.screenshot({ path: 'artifacts/phase-1/capture-pc-initial.png', fullPage: true })
  await forward(page, 4)
  await page.screenshot({ path: 'artifacts/phase-1/capture-pc-passed.png', fullPage: true })
  await selectTemplate(page, 'tmpl-filter-chain')
  await forward(page, 14)
  await page.screenshot({ path: 'artifacts/phase-1/capture-pc-chain.png', fullPage: true })
})
