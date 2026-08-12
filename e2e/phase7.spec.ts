import { expect, test } from '@playwright/test'
import {
  expectPlaybackState,
  forwardToEnd,
  forwardUntilText,
  forwardUntilVisible,
  outputLabels,
  selectMode,
  selectOperation,
  selectTemplate,
  snapshotIds,
} from './utils'
import { elementRowText, openGather } from './p7-utils'

/**
 * P7-E01〜P7-E04: Gatherer教材のE2E（Phase 7指示 §12.4）。
 * 期待結果は§8.2の確定値であり、実装に合わせて緩めない。
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('P7-E01: windowFixedのstandard実行が残余flushまで到達し、履歴復元できる', async ({ page }) => {
  test.setTimeout(120_000)
  await openGather(page, 'tmpl-gather-window-fixed')

  // initializerによる初期状態生成が最初に表示される
  await forwardUntilText(page, 'explanation-current', 'initializerが中間状態を生成しました')
  expect(await elementRowText(page, 'combiner')).toContain('呼出し 0回')

  // 窓の成立と放出
  await forwardUntilText(page, 'gatherer-emitted', '佐藤')
  const emitted = page.getByTestId('gatherer-emitted')
  await expect(emitted).toContainText('鈴木')
  await expect(emitted).toContainText('高橋')

  // 残余flush（finisherによる不完全窓の確定）
  await forwardUntilText(page, 'gatherer-finished-note', '残余')
  await expect(page.getByTestId('gatherer-finished-note')).toContainText('不完全な窓')

  await forwardToEnd(page)
  const labels = await outputLabels(page)
  expect(labels).toHaveLength(2)
  expect(labels[0]).toContain('佐藤（age=35）')
  expect(labels[0]).toContain('鈴木（age=27）')
  expect(labels[0]).toContain('高橋（age=42）')
  expect(labels[1]).toContain('田中（age=29）')
  expect(labels[1]).not.toContain('佐藤')

  // 全パネルが同一snapshotを描画している
  const endId = await snapshotIds(page)

  // 履歴復元: 戻る → 進むで同じ状態に戻る
  const back = page.getByRole('button', { name: '戻る' })
  await back.click()
  await back.click()
  const midId = await snapshotIds(page)
  expect(midId).not.toBe(endId)
  await page.getByRole('button', { name: '進む' }).click()
  await page.getByRole('button', { name: '進む' }).click()
  expect(await snapshotIds(page)).toBe(endId)
  expect(await outputLabels(page)).toEqual(labels)
})

test('P7-E02: scanの逐次出力・foldのOptional・空ソースのGATHER_INITIALIZED表示', async ({ page }) => {
  test.setTimeout(180_000)

  // scan: 1入力→1出力の逐次放出 [3, 4, 8]
  await openGather(page, 'tmpl-gather-scan')
  await expect(page.getByTestId('gatherer-emit-policy')).toContainText('逐次放出')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['3', '4', '8'])

  // fold: 放出なし累積 → 終端で1件放出 → Optional[21_700_000L]
  await openGather(page, 'tmpl-gather-fold')
  await expect(page.getByTestId('gatherer-emit-policy')).toContainText('放出なし累積')
  await forwardToEnd(page)
  await expect(page.getByTestId('optional-value')).toHaveText('Optional[21_700_000L]')

  // fold空ソース: identityを最終値としてOptional[0L]（reduceとの違い）
  await selectMode(page, 'emptySource')
  await forwardToEnd(page)
  await expect(page.getByTestId('optional-value')).toHaveText('Optional[0L]')

  // 空ソースでもinitializerの実演（GATHER_INITIALIZED）が最初に表示される
  await openGather(page, 'tmpl-gather-scan', 'emptySource')
  await forwardUntilText(page, 'explanation-current', 'initializerが中間状態を生成しました')
  await expect(page.getByTestId('gatherer-initial')).toContainText('0')
  await forwardToEnd(page)
  await expect(page.getByTestId('output-empty')).toBeVisible()
  // scanは終端で追加産出しないため、finisherの確定表示は現れない
  expect(await page.getByTestId('gatherer-finished-note').count()).toBe(0)
})

test('P7-E03: windowSlidingのevict表示と、入力<窓サイズの1窓flush', async ({ page }) => {
  test.setTimeout(120_000)

  // evict + append を1回の状態更新として表示する
  await openGather(page, 'tmpl-gather-window-sliding')
  await forwardUntilVisible(page, 'gatherer-evicted')
  await expect(page.getByTestId('gatherer-evicted')).toContainText('"Java"')
  await expect(page.getByTestId('gatherer-evicted')).toContainText('最古を除き次を追加')
  await forwardToEnd(page)
  const labels = await outputLabels(page)
  expect(labels).toHaveLength(3)
  expect(labels[0]).toContain('"Java"')
  expect(labels[1]).toContain('"SQL"')
  expect(labels[2]).toContain('"AWS"')

  // 入力2件 < 窓サイズ3: 窓成立0回 → 終端finisherで全要素の1窓
  await openGather(page, 'tmpl-gather-window-sliding-short')
  await forwardUntilText(page, 'gatherer-finished-note', '窓サイズ未満')
  await forwardToEnd(page)
  const shortLabels = await outputLabels(page)
  expect(shortLabels).toHaveLength(1)
  expect(shortLabels[0]).toContain('"Java"')
  expect(shortLabels[0]).toContain('"SQL"')
})

test('P7-E04: 全gather template × modeが終端まで到達する（総点検の画面確認）', async ({ page }) => {
  test.setTimeout(300_000)
  const cases: { templateId: string; modes: string[] }[] = [
    { templateId: 'tmpl-gather-window-fixed', modes: ['standard', 'emptySource'] },
    { templateId: 'tmpl-gather-window-fixed-exact', modes: ['standard'] },
    { templateId: 'tmpl-gather-window-sliding', modes: ['standard', 'emptySource'] },
    { templateId: 'tmpl-gather-window-sliding-short', modes: ['standard'] },
    { templateId: 'tmpl-gather-scan', modes: ['standard', 'emptySource'] },
    { templateId: 'tmpl-gather-scan-concat', modes: ['standard'] },
    { templateId: 'tmpl-gather-fold', modes: ['standard', 'emptySource'] },
  ]
  let checked = 0
  for (const { templateId, modes } of cases) {
    for (const mode of modes) {
      await openGather(page, templateId, mode)
      // gather templateは取込対象外（両操作が無効・理由表示）
      await expect(page.getByTestId('copy-prompt-button')).toBeDisabled()
      await expect(page.getByTestId('import-button')).toBeDisabled()
      await expect(page.getByTestId('import-disabled-reason')).toContainText('取込対象外')
      await forwardToEnd(page)
      await expectPlaybackState(page, 'COMPLETED')
      await snapshotIds(page)
      checked += 1
    }
  }
  expect(checked).toBe(11)

  // 既存の非gather経路は従来どおり動作する（回帰）
  await selectOperation(page, 'filter')
  await selectTemplate(page, 'tmpl-filter-basic')
  await expect(page.getByTestId('copy-prompt-button')).toBeEnabled()
  await forwardToEnd(page)
  await expectPlaybackState(page, 'COMPLETED')
})
