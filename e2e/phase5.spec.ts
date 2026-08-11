import { expect, test } from '@playwright/test'
import {
  expectPlaybackState,
  forward,
  forwardToEnd,
  forwardUntilText,
  forwardUntilVisible,
  selectMode,
  selectOperation,
  selectTemplate,
  snapshotIds,
} from './utils'

/** Phase 5 E2E（指示§12.4）。PC幅（chromium-pc）で実行する。 */
test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

async function openCollector(page: import('@playwright/test').Page, templateId: string) {
  await selectOperation(page, 'collect')
  await selectTemplate(page, templateId)
}

test('P5-E01: 単純Collector（toList / toSet / joining / counting）を切替えて正しい結果へ到達する', async ({
  page,
}) => {
  await openCollector(page, 'tmpl-collect-tolist')
  await expect(page.getByTestId('java-code-panel')).toContainText('.collect(Collectors.toList());')
  await forwardToEnd(page)
  await expect(page.getByTestId('output-list').locator('li')).toHaveCount(4)
  await expectPlaybackState(page, 'COMPLETED')

  await openCollector(page, 'tmpl-collect-toset')
  await forwardToEnd(page)
  await expect(page.getByTestId('output-collection')).toHaveAttribute('data-container', 'Set')
  await expect(page.getByTestId('collection-items').locator('li')).toHaveCount(3)
  await expect(page.getByTestId('collection-element-id-note')).toContainText('最初に受理した')

  await openCollector(page, 'tmpl-collect-joining-full')
  await forwardToEnd(page)
  await expect(page.getByTestId('output-scalar')).toContainText('"[佐藤, 鈴木, 高橋, 田中]"')

  await openCollector(page, 'tmpl-collect-counting')
  await forwardToEnd(page)
  await expect(page.getByTestId('output-scalar')).toContainText('4')
})

test('P5-E02: 3引数collectのsupplier→accumulator→結果を進む / 戻る / 自動で確認する', async ({ page }) => {
  await selectOperation(page, 'collectTriple')
  await expect(page.getByTestId('java-code-panel')).toContainText(
    '.collect(ArrayList::new, ArrayList::add, ArrayList::addAll);',
  )
  // supplier適用（CONTAINER_CREATED）が要素処理前に現れる
  await forward(page, 1)
  await expect(page.getByTestId('explanation-current')).toContainText('空のArrayListを生成')
  await expect(page.getByTestId('collector-triple-combiner')).toContainText('呼出し0回')
  // accumulator適用
  await forwardUntilText(page, 'explanation-current', 'ArrayListへ追加されました')
  // 戻る→進むで同じsnapshotへ戻る
  const before = await snapshotIds(page)
  await page.getByRole('button', { name: '戻る' }).click()
  await page.getByRole('button', { name: '進む' }).click()
  expect(await snapshotIds(page)).toEqual(before)
  // 自動再生で最後まで進む
  await page.getByRole('button', { name: '自動' }).click()
  await expect(page.getByTestId('playback-state')).toHaveAttribute('data-state', 'COMPLETED', {
    timeout: 30_000,
  })
  await expect(page.getByTestId('output-list').locator('li')).toHaveCount(4)
})

test('P5-E03: groupingBy系（bucket成長・downstream・nested・mapFactory）の経路を確認する', async ({
  page,
}) => {
  await openCollector(page, 'tmpl-collect-groupingby')
  // classifier評価 → bucket決定（新規生成）
  await forwardUntilText(page, 'explanation-current', 'classifierを評価しました')
  await forwardUntilText(page, 'explanation-current', 'bucketを新規生成しました')
  await expect(page.getByTestId('collector-bucket-new')).toBeVisible()
  await forwardToEnd(page)
  await expect(page.getByTestId('map-meta')).toContainText('Map<Department, List<Employee>>')
  await expect(page.getByTestId('map-entries').locator('> li')).toHaveCount(2)

  await openCollector(page, 'tmpl-collect-groupingby-counting')
  await forwardToEnd(page)
  await expect(page.getByTestId('map-entries')).toContainText('関東')
  await expect(page.getByTestId('map-meta')).toContainText('Map<String, Long>')

  await openCollector(page, 'tmpl-collect-groupingby-nested')
  await forwardToEnd(page)
  await expect(page.getByTestId('map-meta')).toContainText(
    'Map<Department, Map<String, List<Employee>>>',
  )

  await openCollector(page, 'tmpl-collect-groupingby-treemap')
  await forwardToEnd(page)
  await expect(page.getByTestId('output-map')).toHaveAttribute('data-jdk-ordered', 'true')
  await expect(page.getByTestId('map-order-note')).toContainText('実際の順序')
})

test('P5-E04: partitioningByのtrue / false固定2分岐と空partitionを確認する', async ({ page }) => {
  await openCollector(page, 'tmpl-collect-partitioningby')
  // 2キーは最初から固定表示される
  await expect(page.getByTestId('collector-buckets').locator('> li')).toHaveCount(2)
  await forwardToEnd(page)
  await expect(page.getByTestId('map-meta')).toContainText('Map<Boolean, List<Employee>>')
  const entries = page.getByTestId('map-entries').locator('> li')
  await expect(entries).toHaveCount(2)
  await expect(entries.first()).toContainText('false')

  // 空ソースでも両キーを保持する（空partition）
  await selectMode(page, 'emptySource')
  await forwardToEnd(page)
  await expect(page.getByTestId('map-entries').locator('> li')).toHaveCount(2)
  await expect(page.getByTestId('map-entries')).toContainText('true')
})

test('P5-E05: downstream合成の経路とcollectingAndThenのfinisher snapshotを確認する', async ({
  page,
}) => {
  // mapping / filtering / flatMapping自身はfinisher snapshotを発行しない
  await openCollector(page, 'tmpl-collect-mapping')
  await forwardToEnd(page)
  await expect(page.getByTestId('map-meta')).toContainText('Map<String, List<String>>')
  await expect(page.getByTestId('collector-finisher')).toHaveCount(0)

  await openCollector(page, 'tmpl-collect-filtering')
  await forwardUntilText(page, 'explanation-current', 'downstreamへ渡されません')
  await expect(page.getByTestId('explanation-jdk')).toContainText('Stream.filter')
  await forwardToEnd(page)
  await expect(page.getByTestId('collector-finisher')).toHaveCount(0)

  await openCollector(page, 'tmpl-collect-flatmapping')
  await forwardUntilText(page, 'explanation-current', '展開しました')
  await forwardToEnd(page)
  await expect(page.getByTestId('collector-finisher')).toHaveCount(0)

  // collectingAndThenはfinisherを独立snapshotで適用する
  await openCollector(page, 'tmpl-collect-collectingandthen')
  await forwardUntilText(page, 'explanation-current', 'finisherを適用しました')
  await expect(page.getByTestId('collector-finisher')).toHaveAttribute('data-state', 'APPLIED')
  await expect(page.getByTestId('collector-finisher')).toContainText('List::copyOf')
})

test('P5-E06: teeing標準で左右蓄積 → finisher×2 → merger → SalarySummaryへ到達する', async ({
  page,
}) => {
  await openCollector(page, 'tmpl-collect-teeing')
  await expect(page.getByTestId('java-code-panel')).toContainText(
    'record SalarySummary(long employeeCount, double averageSalary) {}',
  )
  // 左branchの蓄積
  await forwardUntilText(page, 'explanation-current', '左branchの蓄積')
  await expect(page.getByTestId('collector-teeing')).toHaveAttribute('data-active-branch', 'LEFT')
  // 右branchの蓄積
  await forwardUntilText(page, 'explanation-current', '右branchの蓄積')
  await expect(page.getByTestId('collector-teeing')).toHaveAttribute('data-active-branch', 'RIGHT')
  // finisher×2
  await forwardUntilText(page, 'explanation-current', '左downstreamのfinisher')
  await expect(page.getByTestId('teeing-left-result')).toHaveText('4')
  await expect(page.getByTestId('explanation-jdk')).toContainText('教材上の表示順は左→右')
  await forwardUntilText(page, 'explanation-current', '右downstreamのfinisher')
  await expect(page.getByTestId('teeing-right-result')).toHaveText('5425000.0')
  // merger
  await forwardUntilText(page, 'explanation-current', 'mergerを適用しました')
  await expect(page.getByTestId('collector-teeing')).toHaveAttribute('data-active-branch', 'NONE')
  await expect(page.getByTestId('teeing-final')).toContainText(
    'SalarySummary[employeeCount=4, averageSalary=5425000.0]',
  )
  await forwardToEnd(page)
  await expect(page.getByTestId('record-field-employeeCount')).toContainText('4')
  await expect(page.getByTestId('record-field-averageSalary')).toContainText('5425000.0')
})

test('P5-E07: teeing空Streamで蓄積0件からmerger 1回・employeeCount=0 / averageSalary=0.0', async ({
  page,
}) => {
  await openCollector(page, 'tmpl-collect-teeing')
  await selectMode(page, 'emptySource')
  // 蓄積snapshotなしでfinisher×2 → mergerへ進む
  await forward(page, 1)
  await expect(page.getByTestId('explanation-current')).toContainText('左downstreamのfinisher')
  await forward(page, 1)
  await expect(page.getByTestId('explanation-current')).toContainText('右downstreamのfinisher')
  await forward(page, 1)
  await expect(page.getByTestId('explanation-current')).toContainText('mergerを適用しました')
  await forwardToEnd(page)
  await expect(page.getByTestId('record-field-employeeCount')).toContainText('0')
  await expect(page.getByTestId('record-field-averageSalary')).toContainText('0.0')
})

test('P5-E08: mode / 操作切替でtimer停止・新revision・history初期化・表示切替を確認する', async ({
  page,
}) => {
  await openCollector(page, 'tmpl-collect-groupingby-counting')
  await forward(page, 3)
  await page.getByRole('button', { name: '自動' }).click()
  await expectPlaybackState(page, 'PLAYING')
  // 操作切替でtimerが止まり、READY・1/N へ初期化される
  await selectOperation(page, 'collectTriple')
  await expectPlaybackState(page, 'READY')
  await expect(page.getByTestId('playback-position')).toContainText('snapshot 1 /')
  await expect(page.getByTestId('collector-triple')).toBeVisible()
  // template切替で表示全領域が切替わる
  await openCollector(page, 'tmpl-collect-teeing')
  await expect(page.getByTestId('collector-teeing')).toBeVisible()
  await expect(page.getByTestId('java-code-panel')).toContainText('Collectors.teeing(')
  // mode切替でも初期化される
  await forward(page, 2)
  await selectMode(page, 'emptySource')
  await expectPlaybackState(page, 'READY')
  await expect(page.getByTestId('playback-position')).toContainText('snapshot 1 /')
  // 全パネルが同じsnapshot IDを描画する（snapshotIdsが内部で一意性を検証する）
  expect(await snapshotIds(page)).not.toBe('')
})

test('P5-E09: Collector途中から戻る→再進行、手動途中→自動完了を確認する', async ({ page }) => {
  await openCollector(page, 'tmpl-collect-groupingby-averaging')
  await forwardUntilText(page, 'explanation-current', 'bucketを新規生成しました')
  const at = await snapshotIds(page)
  const mapText = await page.getByTestId('op-context-collector').textContent()
  await page.getByRole('button', { name: '戻る' }).click()
  await page.getByRole('button', { name: '進む' }).click()
  expect(await snapshotIds(page)).toEqual(at)
  expect(await page.getByTestId('op-context-collector').textContent()).toBe(mapText)
  // 手動途中から自動で完了まで進み、bucketごとのfinisherを飛ばさない
  await page.getByRole('button', { name: '自動' }).click()
  await expect(page.getByTestId('playback-state')).toHaveAttribute('data-state', 'COMPLETED', {
    timeout: 60_000,
  })
  await expect(page.getByTestId('map-entries').locator('> li')).toHaveCount(3)
})

test('P5-E10: 代表snapshotの視覚回帰（groupingBy bucket・partitioningBy・collectingAndThen finisher・teeing merger）', async ({
  page,
}) => {
  await openCollector(page, 'tmpl-collect-groupingby-counting')
  await forwardToEnd(page)
  await expect(page.getByTestId('output-map')).toBeVisible()
  await expect(page).toHaveScreenshot('p5-e10-groupingby.png', { fullPage: true })

  await openCollector(page, 'tmpl-collect-partitioningby')
  await selectMode(page, 'emptySource')
  await forwardToEnd(page)
  await expect(page.getByTestId('map-entries')).toBeVisible()
  await expect(page).toHaveScreenshot('p5-e10-partitioning-empty.png', { fullPage: true })

  await openCollector(page, 'tmpl-collect-collectingandthen')
  await forwardUntilVisible(page, 'collector-finisher')
  await forwardUntilText(page, 'explanation-current', 'finisherを適用しました')
  await expect(page).toHaveScreenshot('p5-e10-collecting-and-then.png', { fullPage: true })

  await openCollector(page, 'tmpl-collect-teeing')
  await forwardUntilText(page, 'explanation-current', 'mergerを適用しました')
  await expect(page.getByTestId('teeing-final')).toBeVisible()
  await expect(page).toHaveScreenshot('p5-e10-teeing-merger.png', { fullPage: true })
})
