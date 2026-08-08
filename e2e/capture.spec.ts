import { test } from '@playwright/test'
import { captureArtifact } from './capture-helper'
import { forward, selectTemplate } from './utils'

/** PC幅の画面キャプチャ（§23.5の証跡。現行Phase以外では書込みせず操作確認のみ） */
test('capture-pc: PC幅の画面キャプチャを保存する', async ({ page }) => {
  await page.goto('/')
  await captureArtifact(page, 1, 'capture-pc-initial.png')
  await forward(page, 4)
  await captureArtifact(page, 1, 'capture-pc-passed.png')
  await selectTemplate(page, 'tmpl-filter-chain')
  await forward(page, 14)
  await captureArtifact(page, 1, 'capture-pc-chain.png')
})
