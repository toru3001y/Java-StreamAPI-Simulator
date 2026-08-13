import { expect, test } from '@playwright/test'
import { captureArtifact } from './capture-helper'
import { forwardToEnd, forwardUntilText, forwardUntilVisible } from './utils'
import { openToMap } from './p8-utils'

/**
 * P8-E05（PC幅分）: toMap表示・FAILED表示を含むPC幅の視覚回帰と証跡キャプチャ
 * （artifacts/phase-8/へ保存。指示§14の証跡）。
 *
 * **`details-disclosure`をマスクする理由**: ページ最下部のDetailsDisclosure（閉じた`<summary>`行）は
 * サブピクセルのレイアウト丸めが実行ごとに1pxゆらぎ、fullPage比較で98px前後の差分を間欠的に生む
 * （6回中1回。差分領域はsummary行のみで、拡大比較により**表示内容は同一**であることを確認済み）。
 * 色比較のthresholdは既定のまま緩めず、**この1要素だけを比較対象から外す**ことで安定させる。
 * 当該パネルの表示内容（対象外の補助説明・groupingBy比較導線の相互参照文言）は
 * P8-R04がDOMレベルで検証しており、視覚回帰から外しても検証の穴にならない。
 */

/** 不安定な最下部パネルだけを比較対象から外す（threshold・maxDiffPixelsは変更しない） */
function stableShot(page: import('@playwright/test').Page) {
  return { fullPage: true as const, mask: [page.getByTestId('details-disclosure')] }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('P8-E05: toMap表示・FAILED表示を含むPC幅の視覚回帰（Phase 8基準画像の新設）', async ({
  page,
}) => {
  test.setTimeout(300_000)

  // identity成功: entry蓄積とMap<String, Employee>結果
  await openToMap(page, 'tmpl-collect-tomap-identity')
  await forwardToEnd(page)
  await expect(page).toHaveScreenshot('p8-e05-tomap-identity-completed.png', stableShot(page))

  // 実行失敗: COLLECT_FAILEDの失敗表示
  await openToMap(page, 'tmpl-collect-tomap-duplicate')
  await forwardToEnd(page)
  await expect(page).toHaveScreenshot('p8-e05-tomap-duplicate-failed.png', stableShot(page))

  // merge対比（concat 3件衝突）
  await openToMap(page, 'tmpl-collect-tomap-merge-concat')
  await forwardToEnd(page)
  await expect(page).toHaveScreenshot('p8-e05-tomap-merge-concat.png', stableShot(page))

  // 同一データのgroupingBy比較
  await openToMap(page, 'tmpl-collect-groupby-mergedemo')
  await forwardToEnd(page)
  await expect(page).toHaveScreenshot('p8-e05-groupby-mergedemo.png', stableShot(page))

  // TreeMap（4引数版・キー昇順）
  await openToMap(page, 'tmpl-collect-tomap-treemap')
  await forwardToEnd(page)
  await expect(page).toHaveScreenshot('p8-e05-tomap-treemap.png', stableShot(page))

  // downstream形（nested Map）
  await openToMap(page, 'tmpl-collect-tomap-grouped')
  await forwardToEnd(page)
  await expect(page).toHaveScreenshot('p8-e05-tomap-grouped.png', stableShot(page))
})

test('p8-capture: Phase 8のPC幅キャプチャを保存する', async ({ page }) => {
  test.setTimeout(300_000)

  await openToMap(page, 'tmpl-collect-tomap-identity')
  await forwardUntilVisible(page, 'collector-tomap-entries')
  await captureArtifact(page, 8, 'p8-tomap-identity-accumulating.png')
  await forwardToEnd(page)
  await captureArtifact(page, 8, 'p8-tomap-identity-completed.png')

  await openToMap(page, 'tmpl-collect-tomap-duplicate')
  await forwardUntilText(page, 'processing-input', '重複キー 関東')
  await captureArtifact(page, 8, 'p8-tomap-duplicate-detected.png')
  await forwardToEnd(page)
  await captureArtifact(page, 8, 'p8-tomap-duplicate-failed.png')

  await openToMap(page, 'tmpl-collect-tomap-merge-first')
  await forwardToEnd(page)
  await captureArtifact(page, 8, 'p8-tomap-merge-first.png')

  await openToMap(page, 'tmpl-collect-tomap-merge-last')
  await forwardToEnd(page)
  await captureArtifact(page, 8, 'p8-tomap-merge-last.png')

  await openToMap(page, 'tmpl-collect-tomap-merge-concat')
  await forwardToEnd(page)
  await captureArtifact(page, 8, 'p8-tomap-merge-concat.png')

  await openToMap(page, 'tmpl-collect-groupby-mergedemo')
  await forwardToEnd(page)
  await captureArtifact(page, 8, 'p8-groupby-mergedemo.png')

  await openToMap(page, 'tmpl-collect-tomap-treemap')
  await forwardToEnd(page)
  await captureArtifact(page, 8, 'p8-tomap-treemap.png')

  await openToMap(page, 'tmpl-collect-tomap-grouped')
  await forwardToEnd(page)
  await captureArtifact(page, 8, 'p8-tomap-grouped.png')

  // 取込UIの無効化表示
  await openToMap(page, 'tmpl-collect-tomap-identity')
  await expect(page.getByTestId('import-disabled-reason')).toBeVisible()
  await captureArtifact(page, 8, 'p8-import-disabled.png')
})
