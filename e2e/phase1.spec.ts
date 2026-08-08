import { expect, test } from '@playwright/test'
import {
  expectPlaybackState,
  forward,
  selectMode,
  selectTemplate,
  snapshotIds,
} from './utils'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Java Stream API 可視化シミュレーター',
  )
})

test('P1-E01: 標準filterで進むと佐藤・高橋だけが結果へ入る', async ({ page }) => {
  await forward(page, 20)
  await expectPlaybackState(page, 'COMPLETED')
  const items = page.getByTestId('output-list').locator('li')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText('佐藤')
  await expect(items.nth(1)).toContainText('高橋')
  await expect(page.getByTestId('output-panel')).toContainText('確定')
  await expect(page.getByRole('button', { name: '進む' })).toBeDisabled()
})

test('P1-E02: 途中0件は最終結果が空Listで全入力が除外される', async ({ page }) => {
  await selectMode(page, 'midEmpty')
  await forward(page, 18)
  await expectPlaybackState(page, 'COMPLETED')
  await expect(page.getByTestId('output-empty')).toBeVisible()
  await expect(page.getByTestId('output-panel')).toContainText('0件')
  const rows = page.locator('.element-row')
  await expect(rows).toHaveCount(4)
  for (let i = 0; i < 4; i++) {
    await expect(rows.nth(i)).toHaveAttribute('data-state', 'REJECTED')
  }
})

test('P1-E03: 空ソースは要素処理なしで空Listを確定する', async ({ page }) => {
  await selectMode(page, 'emptySource')
  await expect(page.getByTestId('input-panel')).toContainText('入力は0件です')
  await forward(page, 2)
  await expectPlaybackState(page, 'COMPLETED')
  await expect(page.getByTestId('output-empty')).toBeVisible()
  await expect(page.getByTestId('playback-position')).toContainText('snapshot 3 / 全3')
})

test('P1-E04: 戻るで任意位置から全パネルが直前状態へ復元される', async ({ page }) => {
  await forward(page, 4)
  const idAt4 = await snapshotIds(page)
  const outputAt4 = await page.getByTestId('output-panel').innerHTML()
  const activeLineAt4 = await page
    .locator('.code-line[data-active]')
    .getAttribute('data-line-id')
  const positionAt4 = await page.getByTestId('playback-position').textContent()

  await forward(page, 1)
  const idAt5 = await snapshotIds(page)
  expect(idAt5).not.toBe(idAt4)

  await page.getByRole('button', { name: '戻る' }).click()
  const idBack = await snapshotIds(page)
  expect(idBack).toBe(idAt4)
  expect(await page.getByTestId('output-panel').innerHTML()).toBe(outputAt4)
  expect(await page.locator('.code-line[data-active]').getAttribute('data-line-id')).toBe(
    activeLineAt4,
  )
  expect(await page.getByTestId('playback-position').textContent()).toBe(positionAt4)
})

test('P1-E05: 手動途中からの自動再生が最後まで進み停止する', async ({ page }) => {
  test.setTimeout(60_000)
  await forward(page, 3)
  await page.getByRole('button', { name: '自動' }).click()
  await expectPlaybackState(page, 'PLAYING')
  // 1000ms固定で1件ずつ進み、完了で自動停止する（残り17 snapshot ≒ 17秒）
  await expect(page.getByTestId('playback-state')).toHaveAttribute(
    'data-state',
    'COMPLETED',
    { timeout: 30_000 },
  )
  await expect(page.getByTestId('playback-position')).toContainText('snapshot 21 / 全21')
  await expect(page.getByRole('button', { name: '停止' })).toBeDisabled()
})

test('P1-E06: filterチェーンで横スクロールとactive node追従が機能する', async ({ page }) => {
  await selectTemplate(page, 'tmpl-filter-chain')
  const scroll = page.getByTestId('pipeline-scroll')
  // Pipeline専用の横スクロールが発生している（ページ全体ではない）
  const { scrollWidth, clientWidth } = await scroll.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }))
  expect(scrollWidth).toBeGreaterThan(clientWidth)
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(pageOverflow).toBe(false)

  // 佐藤がfilter5段目に到着するまで進める（EMIT1 + 4ノード×3 + ARRIVED = 14手）
  await forward(page, 14)
  const active = page.locator('.pipeline-node[data-active]')
  await expect(active).toHaveAttribute('data-node-id', 'node-filter-5')
  // active nodeが可視位置へ追従している（スクロール完了を待って判定）
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const container = document.querySelector('[data-testid="pipeline-scroll"]')
        const node = document.querySelector('.pipeline-node[data-active]')
        if (!container || !node) return false
        const cr = container.getBoundingClientRect()
        const nr = node.getBoundingClientRect()
        return nr.left >= cr.left - 1 && nr.right <= cr.right + 1
      }),
    )
    .toBe(true)
})

test('P1-E07: Pipelineはmin-height + auto heightでバッジ・型が欠けない', async ({ page }) => {
  for (const templateId of ['tmpl-filter-basic', 'tmpl-filter-chain']) {
    await selectTemplate(page, templateId)
    const scroll = page.getByTestId('pipeline-scroll')
    // 縦方向のクリッピング（縦スクロール）が発生していない
    const { scrollHeight, clientHeight } = await scroll.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }))
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1)
    // 各ノードの型ラベル・バッジが可視である
    const track = page.locator('.pipeline-track')
    const trackBox = await track.boundingBox()
    expect(trackBox).not.toBeNull()
    for (const badge of await page.locator('.pipeline-node .badge').all()) {
      await expect(badge).toBeVisible()
    }
    for (const type of await page.locator('.pipeline-type').all()) {
      await expect(type).toBeVisible()
    }
  }
})

test('P1-E08: sticky操作バーが本文末尾を隠さない', async ({ page }) => {
  // 詳細を開いて本文を最長にし、末尾までスクロールする
  await page.locator('summary').click()
  await page.evaluate(() => {
    const el = document.scrollingElement
    if (el) el.scrollTop = el.scrollHeight
  })
  const geometry = await page.evaluate(() => {
    const details = document.querySelector('[data-testid="details-disclosure"]')
    const bar = document.querySelector('.sticky-playback-bar')
    if (!details || !bar) return null
    return {
      detailsBottom: details.getBoundingClientRect().bottom,
      barTop: bar.getBoundingClientRect().top,
    }
  })
  expect(geometry).not.toBeNull()
  if (geometry) {
    expect(geometry.detailsBottom).toBeLessThanOrEqual(geometry.barTop + 1)
  }
})

test('P1-E10: キーボード操作・focus可視化・状態名で操作と識別ができる', async ({ page }) => {
  // Tabキーだけで「進む」ボタンへ到達できる
  let reached = false
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab')
    const name = await page.evaluate(() => document.activeElement?.textContent?.trim())
    if (name === '進む') {
      reached = true
      break
    }
  }
  expect(reached).toBe(true)
  // focusが:focus-visibleとして可視化されている
  const focusVisible = await page.evaluate(() =>
    document.activeElement ? document.activeElement.matches(':focus-visible') : false,
  )
  expect(focusVisible).toBe(true)
  // Enterで1 snapshot進む
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('playback-position')).toContainText('snapshot 2 / 全21')
  // 状態は色だけでなく記号・文言（読み上げ可能な状態名）で識別できる
  const firstRow = page.locator('.element-row').first()
  await expect(firstRow.locator('.state-label')).toHaveText('処理中')
  await expect(firstRow.locator('.state-symbol')).toHaveText('▶')
})

test('P1-E11: 初期・通過・除外・完了の代表snapshotの視覚回帰', async ({ page }) => {
  // 期待画像は§21.3の基準fixture（4要素）を正とする
  await expect(page).toHaveScreenshot('p1-e11-initial.png', { fullPage: true })
  // index 4: 佐藤の通過確定（ELEMENT_PASSED）
  await forward(page, 4)
  await expect(page.getByTestId('processing-panel')).toContainText('通過確定')
  await expect(page).toHaveScreenshot('p1-e11-passed.png', { fullPage: true })
  // index 9: 鈴木の除外確定（ELEMENT_REJECTED）
  await forward(page, 5)
  await expect(page.getByTestId('processing-panel')).toContainText('除外確定')
  await expect(page).toHaveScreenshot('p1-e11-rejected.png', { fullPage: true })
  // index 20: 完了（STREAM_CONSUMED）
  await forward(page, 11)
  await expect(page.getByTestId('playback-state')).toHaveAttribute('data-state', 'COMPLETED')
  await expect(page).toHaveScreenshot('p1-e11-completed.png', { fullPage: true })
})
