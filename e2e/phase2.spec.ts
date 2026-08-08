import { expect, test } from '@playwright/test'
import {
  expectPlaybackState,
  forward,
  forwardToEnd,
  outputLabels,
  selectMode,
  selectOperation,
  selectTemplate,
  snapshotIds,
} from './utils'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('P2-E01: finite sourceを切替えて正しい結果へ到達する', async ({ page }) => {
  test.setTimeout(90_000)
  // Collection.stream
  await selectOperation(page, 'source.collectionStream')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['"佐藤"', '"鈴木"', '"高橋"', '"田中"'])
  // Arrays.stream（object）
  await selectOperation(page, 'source.arraysStream')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['"JAVA"', '"SQL"', '"WEB"'])
  // Arrays.stream（int[]）
  await selectTemplate(page, 'tmpl-src-arrays-int')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['3', '1', '4'])
  // Arrays.stream（long[] / double[]）（レビュー対応）
  await selectTemplate(page, 'tmpl-src-arrays-long')
  await expect(page.getByTestId('pipeline-viewport')).toContainText('LongStream')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['10L', '20L', '30L'])
  await selectTemplate(page, 'tmpl-src-arrays-double')
  await expect(page.getByTestId('pipeline-viewport')).toContainText('DoubleStream')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['1.5', '2.5', '4.0'])
  // Stream.of
  await selectOperation(page, 'source.streamOf')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['"JAVA"', '"SQL"'])
  // iterate 3引数
  await selectOperation(page, 'source.iterate3')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['1', '2', '3', '4', '5'])
  // range / rangeClosed
  await selectOperation(page, 'source.range')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['1', '2', '3', '4'])
  await selectOperation(page, 'source.rangeClosed')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['1', '2', '3', '4', '5'])
  // empty
  await selectOperation(page, 'source.empty')
  await forwardToEnd(page)
  await expect(page.getByTestId('output-empty')).toBeVisible()
  await expect(page.getByTestId('output-type')).toContainText('List<String>')
})

test('P2-E02: mapのEmployee→String変換を進む/戻るで確認する', async ({ page }) => {
  await selectOperation(page, 'map')
  await forward(page, 3)
  await expect(page.getByTestId('processing-input')).toHaveText('佐藤（age=35） → "佐藤"')
  await expect(page.getByTestId('type-transition')).toContainText('Stream<Employee> → Stream<String>')
  const idAtApplied = await snapshotIds(page)
  await forward(page, 1)
  await page.getByRole('button', { name: '戻る' }).click()
  expect(await snapshotIds(page)).toBe(idAtApplied)
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['"佐藤"', '"鈴木"', '"高橋"', '"田中"'])
  await expectPlaybackState(page, 'COMPLETED')
})

test('P2-E03: mapToXの型変化とboxed後の結果を確認する', async ({ page }) => {
  test.setTimeout(90_000)
  await selectOperation(page, 'mapToInt')
  await forward(page, 3)
  await expect(page.getByTestId('type-transition')).toContainText('Stream<Employee> → IntStream')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['35', '27', '42', '29'])
  await expect(page.getByTestId('output-type')).toContainText('List<Integer>')

  await selectOperation(page, 'mapToLong')
  await expect(page.getByTestId('pipeline-viewport')).toContainText('LongStream')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['5_500_000L', '4_200_000L', '7_200_000L', '4_800_000L'])

  await selectOperation(page, 'mapToDouble')
  await expect(page.getByTestId('pipeline-viewport')).toContainText('DoubleStream')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['4.2', '3.8', '4.6', '4.0'])
})

test('P2-E04: boxedとmapToObjの出力型・コード・説明の違いを確認する', async ({ page }) => {
  await selectOperation(page, 'boxed')
  await expect(page.getByTestId('java-code-panel')).toContainText('.boxed()')
  await expect(page.getByTestId('pipeline-viewport')).toContainText('Stream<Integer>')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['1', '2', '3'])
  await expect(page.getByTestId('output-type')).toContainText('List<Integer>')

  await selectOperation(page, 'mapToObj')
  await expect(page.getByTestId('java-code-panel')).toContainText('.mapToObj(n -> "No." + n)')
  await expect(page.getByTestId('pipeline-viewport')).toContainText('Stream<String>')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['"No.1"', '"No.2"', '"No.3"'])
  await expect(page.getByTestId('output-type')).toContainText('List<String>')
})

test('P2-E05: flatMapで0/1/複数子の親を通過し、親子追跡とflatten順序を確認する', async ({
  page,
}) => {
  await selectOperation(page, 'flatMap')
  // 親1（2子）: mapped Stream生成
  await forward(page, 3)
  await expect(page.getByTestId('flatmap-parent')).toContainText('[Java, SQL]')
  await expect(page.getByTestId('flatmap-children').locator('li')).toHaveCount(2)
  // 子1送出→toList、子2送出→toListでclose詳細
  await forward(page, 1)
  await expect(page.getByTestId('flatmap-children').locator('li').first()).toContainText('送出済み')
  await forward(page, 3)
  await expect(page.getByTestId('flatmap-closed')).toBeVisible()
  // 親2（0子）
  await forward(page, 3)
  await expect(page.getByTestId('flatmap-children-empty')).toBeVisible()
  await expect(page.getByTestId('flatmap-closed')).toBeVisible()
  // 最後まで進めてflatten順序を確認
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['"Java"', '"SQL"', '"分析"'])
})

test('P2-E06: flatMapToXのprimitive子の型・順序・boxed後結果を確認する', async ({ page }) => {
  test.setTimeout(90_000)
  await selectOperation(page, 'flatMapToInt')
  await expect(page.getByTestId('pipeline-viewport')).toContainText('Stream<int[]>')
  await expect(page.getByTestId('pipeline-viewport')).toContainText('IntStream')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['1', '2', '3'])

  await selectOperation(page, 'flatMapToLong')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['10L', '20L', '30L'])

  await selectOperation(page, 'flatMapToDouble')
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['1.5', '2.5', '3.5'])
})

test('P2-E07: mode/操作切替でtimer停止・新revision・history初期化・表示切替を確認する', async ({
  page,
}) => {
  await selectOperation(page, 'flatMap')
  await forward(page, 2)
  await page.getByRole('button', { name: '自動' }).click()
  await expectPlaybackState(page, 'PLAYING')
  const idBefore = await snapshotIds(page)
  // mode切替で自動再生が停止し、新revisionのhistory 1件 / READYへ
  await selectMode(page, 'midEmpty')
  await expectPlaybackState(page, 'READY')
  await expect(page.getByTestId('playback-position')).toContainText('snapshot 1 /')
  const idAfterMode = await snapshotIds(page)
  expect(idAfterMode).not.toBe(idBefore)
  expect(idAfterMode.endsWith('#0')).toBe(true)
  // 2秒待っても自動進行しない（timer停止済み）
  await page.waitForTimeout(2200)
  await expect(page.getByTestId('playback-position')).toContainText('snapshot 1 /')
  // 操作切替で表示全領域が切替わる
  await selectOperation(page, 'source.range')
  await expect(page.getByTestId('pipeline-viewport')).toContainText('IntStream.range()')
  await expect(page.getByTestId('java-code-panel')).toContainText('IntStream.range(1, 5)')
  const idAfterOperation = await snapshotIds(page)
  expect(idAfterOperation).not.toBe(idAfterMode)
})

test('P2-E08: 型変化/flatMap途中から戻る→再進行、手動途中→自動完了を確認する', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await selectOperation(page, 'flatMap')
  await forward(page, 4)
  const idAtChild = await snapshotIds(page)
  await forward(page, 2)
  await page.getByRole('button', { name: '戻る' }).click()
  await page.getByRole('button', { name: '戻る' }).click()
  expect(await snapshotIds(page)).toBe(idAtChild)
  await expect(page.getByTestId('flatmap-children').locator('li').first()).toContainText('送出済み')

  // 手動途中からの自動再生（boxed: 18 snapshot）
  await selectOperation(page, 'boxed')
  await forward(page, 5)
  await page.getByRole('button', { name: '自動' }).click()
  await expectPlaybackState(page, 'PLAYING')
  await expect(page.getByTestId('playback-state')).toHaveAttribute('data-state', 'COMPLETED', {
    timeout: 30_000,
  })
  expect(await outputLabels(page)).toEqual(['1', '2', '3'])
})

test('P2-E10: map型変化・mapToInt・flatMap親子・emptyの代表snapshotの視覚回帰', async ({
  page,
}) => {
  await selectOperation(page, 'map')
  await forward(page, 3)
  await expect(page.getByTestId('type-transition')).toBeVisible()
  await expect(page).toHaveScreenshot('p2-e10-map-applied.png', { fullPage: true })

  await selectOperation(page, 'mapToInt')
  await forward(page, 3)
  await expect(page.getByTestId('type-transition')).toContainText('IntStream')
  await expect(page).toHaveScreenshot('p2-e10-maptoint-applied.png', { fullPage: true })

  await selectOperation(page, 'flatMap')
  await forward(page, 4)
  await expect(page.getByTestId('flatmap-panel')).toBeVisible()
  await expect(page).toHaveScreenshot('p2-e10-flatmap-child.png', { fullPage: true })

  await selectOperation(page, 'source.empty')
  await selectTemplate(page, 'tmpl-src-empty-int')
  await forwardToEnd(page)
  await expect(page.getByTestId('output-empty')).toBeVisible()
  await expect(page).toHaveScreenshot('p2-e10-empty-completed.png', { fullPage: true })
})
