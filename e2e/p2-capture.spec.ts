import { test } from '@playwright/test'
import { captureArtifact } from './capture-helper'
import { forward, forwardToEnd, selectOperation } from './utils'

/** Phase 2 PC幅キャプチャ（指示§14の証跡。現行Phase以外では書込みせず操作確認のみ） */
test('p2-capture-pc: PC幅の画面キャプチャを保存する', async ({ page }) => {
  await page.goto('/')
  await selectOperation(page, 'map')
  await forward(page, 3)
  await captureArtifact(page, 2, 'capture-pc-map.png')
  await selectOperation(page, 'mapToInt')
  await forward(page, 3)
  await captureArtifact(page, 2, 'capture-pc-maptoint.png')
  await selectOperation(page, 'flatMap')
  await forward(page, 4)
  await captureArtifact(page, 2, 'capture-pc-flatmap.png')
  await selectOperation(page, 'source.iterate3')
  await forward(page, 2)
  await captureArtifact(page, 2, 'capture-pc-iterate.png')
  await selectOperation(page, 'source.empty')
  await forwardToEnd(page)
  await captureArtifact(page, 2, 'capture-pc-empty.png')
})
