import { expect, test } from '@playwright/test'
import { captureArtifact } from './capture-helper'
import { forwardToEnd, forwardUntilText, forwardUntilVisible, selectOperation, selectTemplate } from './utils'
import { openGather } from './p7-utils'

/**
 * P7-E05（PC幅分）: Gathererパネルを含むPC幅の視覚回帰と証跡キャプチャ
 * （artifacts/phase-7/へ保存。指示§14の証跡）。
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('P7-E05: Gathererパネルを含むPC幅の視覚回帰（Phase 7基準画像の新設）', async ({ page }) => {
  test.setTimeout(180_000)

  // windowFixed: 窓成立後の構造パネル
  await openGather(page, 'tmpl-gather-window-fixed')
  await forwardUntilText(page, 'gatherer-emitted', '佐藤')
  await expect(page).toHaveScreenshot('p7-e05-window-fixed-emitted.png', { fullPage: true })

  // windowSliding: evict表示
  await openGather(page, 'tmpl-gather-window-sliding')
  await forwardUntilVisible(page, 'gatherer-evicted')
  await expect(page).toHaveScreenshot('p7-e05-window-sliding-evicted.png', { fullPage: true })

  // scan: 累積履歴つきの完了状態
  await openGather(page, 'tmpl-gather-scan')
  await forwardToEnd(page)
  await expect(page).toHaveScreenshot('p7-e05-scan-completed.png', { fullPage: true })

  // fold: 終端でのOptional結果
  await openGather(page, 'tmpl-gather-fold')
  await forwardToEnd(page)
  await expect(page).toHaveScreenshot('p7-e05-fold-completed.png', { fullPage: true })

  // 空ソースのGATHER_INITIALIZED表示
  await openGather(page, 'tmpl-gather-window-fixed', 'emptySource')
  await forwardUntilText(page, 'explanation-current', 'initializerが中間状態を生成しました')
  await expect(page).toHaveScreenshot('p7-e05-empty-initialized.png', { fullPage: true })
})

test('p7-capture-pc: PC幅の画面キャプチャを保存する', async ({ page }) => {
  test.setTimeout(300_000)

  // ---- windowFixed（4種の代表snapshot 1/4） ----
  await openGather(page, 'tmpl-gather-window-fixed')
  await captureArtifact(page, 7, 'capture-pc-window-fixed-initialized.png')
  await forwardUntilText(page, 'gatherer-emitted', '佐藤')
  await captureArtifact(page, 7, 'capture-pc-window-fixed-emitted.png')
  await forwardUntilText(page, 'gatherer-finished-note', '残余')
  await captureArtifact(page, 7, 'capture-pc-window-fixed-finished.png')
  await forwardToEnd(page)
  await captureArtifact(page, 7, 'capture-pc-window-fixed-completed.png')

  // ---- windowSliding（2/4）: evict + append の1回更新 ----
  await openGather(page, 'tmpl-gather-window-sliding')
  await forwardUntilVisible(page, 'gatherer-evicted')
  await captureArtifact(page, 7, 'capture-pc-window-sliding-evicted.png')
  await forwardToEnd(page)
  await captureArtifact(page, 7, 'capture-pc-window-sliding-completed.png')

  // 入力件数 < 窓サイズ の終端flush
  await openGather(page, 'tmpl-gather-window-sliding-short')
  await forwardUntilText(page, 'gatherer-finished-note', '窓サイズ未満')
  await captureArtifact(page, 7, 'capture-pc-window-sliding-short-flush.png')

  // ---- scan（3/4）: 逐次放出と累積履歴 ----
  await openGather(page, 'tmpl-gather-scan')
  await forwardToEnd(page)
  await captureArtifact(page, 7, 'capture-pc-scan-completed.png')
  await openGather(page, 'tmpl-gather-scan-concat')
  await forwardToEnd(page)
  await captureArtifact(page, 7, 'capture-pc-scan-concat-completed.png')

  // ---- fold（4/4）: 放出なし累積 → 終端で1件 ----
  await openGather(page, 'tmpl-gather-fold')
  await forwardUntilText(page, 'explanation-current', 'foldの累積値')
  await captureArtifact(page, 7, 'capture-pc-fold-accumulating.png')
  await forwardToEnd(page)
  await captureArtifact(page, 7, 'capture-pc-fold-completed.png')

  // ---- 空ソースのGATHER_INITIALIZED表示 ----
  await openGather(page, 'tmpl-gather-fold', 'emptySource')
  await forwardUntilText(page, 'explanation-current', 'initializerが中間状態を生成しました')
  await captureArtifact(page, 7, 'capture-pc-empty-initialized.png')
  await forwardToEnd(page)
  await captureArtifact(page, 7, 'capture-pc-empty-fold-identity.png')

  // ---- 取込UI無効化状態（§7.8の取込対象外） ----
  await openGather(page, 'tmpl-gather-window-fixed')
  await expect(page.getByTestId('import-disabled-reason')).toContainText('取込対象外')
  await captureArtifact(page, 7, 'capture-pc-import-disabled.png')

  // ---- 非gather templateへ戻した回帰確認 ----
  await selectOperation(page, 'filter')
  await selectTemplate(page, 'tmpl-filter-basic')
  await expect(page.getByTestId('copy-prompt-button')).toBeEnabled()
  await captureArtifact(page, 7, 'capture-pc-non-gather-regression.png')
})
