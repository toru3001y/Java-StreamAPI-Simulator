import { expect, test } from '@playwright/test'
import {
  expectPlaybackState,
  forward,
  forwardToEnd,
  outputLabels,
  selectMode,
  selectOperation,
  selectTemplate,
} from './utils'
import { copyPrompt, exampleJsonOf, grantClipboard, pasteCandidate } from './p6-utils'

/** Phase 6 E2E（指示§12.4）。PC幅（chromium-pc）で実行する。 */
test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

/** Employee系templateの取込候補（filter標準・age >= 30） */
const EMPLOYEE_CANDIDATE = {
  dslVersion: '1',
  templateId: 'tmpl-filter-basic',
  templateVersion: 1,
  mode: 'standard',
  dataset: [
    {
      name: 'E2E通過',
      age: 45,
      salary: 7_000_000,
      evaluation: 4.8,
      region: '北陸',
      hireDate: '2015-04-01',
      department: { name: '基盤部', division: '技術本部' },
      skills: ['Java', 'AWS'],
    },
    {
      name: 'E2E除外',
      age: 24,
      salary: 3_500_000,
      evaluation: 3.2,
      region: '四国',
      hireDate: '2024-04-01',
      department: { name: '基盤部', division: '技術本部' },
      skills: [],
    },
  ],
  dslParameters: {
    'slot-predicate-1': {
      kind: 'fieldCompare',
      field: 'age',
      operator: 'GTE',
      value: { type: 'int', value: 30 },
    },
  },
  title: 'E2E取込サンプル（filter標準）',
  description: 'E2Eで取込経路を確認します。',
}

/** source slot型templateの取込候補（int配列） */
const SOURCE_SLOT_CANDIDATE = {
  dslVersion: '1',
  templateId: 'tmpl-src-arrays-int',
  templateVersion: 1,
  mode: 'standard',
  dslParameters: {
    'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [11, 22, 33] },
  },
  title: 'E2E取込サンプル（int配列）',
  description: 'source slot型templateの取込経路を確認します。',
}

test('P6-E01: プロンプトコピー → 貼付 → 取込サンプル成立 → 実行（Employee系・source slot型）', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await grantClipboard(page)

  // ---- Employee系 ----
  await expect(page.getByTestId('provenance')).toHaveText('固定サンプル')
  const prompt = await copyPrompt(page)
  expect(prompt).toContain('templateId: "tmpl-filter-basic"')
  expect(prompt).toContain('## dataset契約')
  // プロンプトの出力例はそのまま貼り付けても成立する
  await pasteCandidate(page, exampleJsonOf(prompt))
  await expect(page.getByTestId('import-accepted')).toBeVisible()
  await expect(page.getByTestId('provenance')).toHaveText('取込サンプル')

  // 独自の候補を貼り付けて実行する
  await pasteCandidate(page, JSON.stringify(EMPLOYEE_CANDIDATE))
  await expect(page.getByTestId('import-accepted')).toBeVisible()
  await expect(page.getByTestId('provenance')).toHaveText('取込サンプル')
  await expect(page.locator('.scenario-description')).toContainText('E2E取込サンプル（filter標準）')
  // history初期化（戻るが無効・READY）
  await expectPlaybackState(page, 'READY')
  await expect(page.getByRole('button', { name: '戻る' })).toBeDisabled()
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['E2E通過（age=45）'])

  // 履歴復元: 戻る → 進むで同じsnapshotへ戻る
  const completedText = await page.getByTestId('processing-panel').textContent()
  await page.getByRole('button', { name: '戻る' }).click()
  await page.getByRole('button', { name: '進む' }).click()
  expect(await page.getByTestId('processing-panel').textContent()).toBe(completedText)
  await expect(page.getByTestId('provenance')).toHaveText('取込サンプル')

  // ---- source slot型 ----
  await selectOperation(page, 'source.arraysStream')
  await selectTemplate(page, 'tmpl-src-arrays-int')
  await expect(page.getByTestId('provenance')).toHaveText('固定サンプル')
  const sourcePrompt = await copyPrompt(page)
  expect(sourcePrompt).not.toContain('## dataset契約')
  expect(sourcePrompt).toContain('dataset キーは含めないでください')
  await pasteCandidate(page, JSON.stringify(SOURCE_SLOT_CANDIDATE))
  await expect(page.getByTestId('import-accepted')).toBeVisible()
  await expect(page.getByTestId('provenance')).toHaveText('取込サンプル')
  await expect(page.getByTestId('java-code-panel')).toContainText(
    'int[] numbers = { 11, 22, 33 };',
  )
  await forwardToEnd(page)
  expect(await outputLabels(page)).toEqual(['11', '22', '33'])
})

test('P6-E02: 不正な貼付で理由が表示され現行シナリオが維持され、修正後の再貼付で成功する', async ({
  page,
}) => {
  await forward(page, 3)
  const beforeSnapshot = await page.getByTestId('processing-panel').textContent()

  // 不正JSON
  await pasteCandidate(page, '{ これはJSONではありません')
  const issues = page.getByTestId('import-issues')
  await expect(issues).toBeVisible()
  await expect(issues).toContainText('IMPORT_PARSE')
  await expect(issues).toContainText('現在のシナリオは変更していません')
  // 現行シナリオが維持される
  await expect(page.getByTestId('provenance')).toHaveText('固定サンプル')
  expect(await page.getByTestId('processing-panel').textContent()).toBe(beforeSnapshot)

  // context不一致
  await pasteCandidate(
    page,
    JSON.stringify({ ...EMPLOYEE_CANDIDATE, templateId: 'tmpl-map' }),
  )
  await expect(issues).toContainText('IMPORT_CONTEXT_MISMATCH')
  await expect(page.getByTestId('provenance')).toHaveText('固定サンプル')

  // 値域違反（age 100）
  const outOfRange = structuredClone(EMPLOYEE_CANDIDATE)
  outOfRange.dataset[0]!.age = 100
  await pasteCandidate(page, JSON.stringify(outOfRange))
  await expect(issues).toContainText('IMPORT_SCHEMA')
  await expect(issues).toContainText('dataset[0].age')
  await expect(page.getByTestId('provenance')).toHaveText('固定サンプル')
  expect(await page.getByTestId('processing-panel').textContent()).toBe(beforeSnapshot)

  // 修正後の再貼付で成功する
  await pasteCandidate(page, JSON.stringify(EMPLOYEE_CANDIDATE))
  await expect(page.getByTestId('import-accepted')).toBeVisible()
  await expect(page.getByTestId('import-issues')).toHaveCount(0)
  await expect(page.getByTestId('provenance')).toHaveText('取込サンプル')
})

test('P6-E03: 取込データのJavaコード表示が構文的に正当で実データと一致する', async ({ page }) => {
  const tricky = {
    ...EMPLOYEE_CANDIDATE,
    dataset: [
      {
        name: 'a"b\\c',
        age: 45,
        salary: 7_000_000,
        evaluation: 4.8,
        region: 'r"1',
        hireDate: '2015-04-01',
        department: { name: '品"証部', division: '技\\本部' },
        skills: ['S"1', 'S\\2'],
      },
      {
        name: '除外',
        age: 24,
        salary: 3_500_000,
        evaluation: 3.2,
        region: '四国',
        hireDate: '2024-04-01',
        department: { name: '営業支援部', division: '営業本部' },
        skills: [],
      },
    ],
    title: 'Javaコード表示のE2E確認',
    description: '引用符・バックスラッシュと任意部署名の表示を確認します。',
  }
  await pasteCandidate(page, JSON.stringify(tricky))
  await expect(page.getByTestId('import-accepted')).toBeVisible()

  const code = page.getByTestId('java-code-panel')
  // 文字列リテラルがエスケープされている
  await expect(code).toContainText('new Employee("a\\"b\\\\c", 45, 7_000_000L, 4.8, "r\\"1",')
  await expect(code).toContainText('List.of("S\\"1", "S\\\\2")')
  // 部署はname + divisionの組で別変数になり、nullが現れない
  await expect(code).toContainText('Department dept1 = new Department("品\\"証部", "技\\\\本部");')
  await expect(code).toContainText('Department dept2 = new Department("営業支援部", "営業本部");')
  const codeText = (await code.textContent()) ?? ''
  expect(codeText).not.toContain(', null,')
  // 実データと一致する（datasetの表示と同じ値）
  await expect(page.getByTestId('details-disclosure')).toContainText('a"b\\c')
})

test('P6-E04: 既存E2Eの代表シナリオが従来どおり動作し、AIボタンが存在しない', async ({ page }) => {
  test.setTimeout(120_000)
  // AIボタン・AI理由は存在しない
  await expect(page.getByTestId('ai-button')).toHaveCount(0)
  await expect(page.getByTestId('ai-reason')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('AI生成')

  // 各Phaseの代表シナリオ（固定サンプル）が従来どおり終端まで到達する
  const cases: { operationId: string; templateId: string; mode?: string }[] = [
    { operationId: 'filter', templateId: 'tmpl-filter-basic' },
    { operationId: 'map', templateId: 'tmpl-map' },
    { operationId: 'flatMap', templateId: 'tmpl-flatmap' },
    { operationId: 'distinct', templateId: 'tmpl-distinct' },
    { operationId: 'sorted', templateId: 'tmpl-sorted-comparator' },
    { operationId: 'reduce', templateId: 'tmpl-reduce-salary' },
    { operationId: 'summaryStatistics', templateId: 'tmpl-stats-int' },
    { operationId: 'collect', templateId: 'tmpl-collect-groupingby-counting' },
    { operationId: 'collectTriple', templateId: 'tmpl-collect-triple' },
  ]
  for (const testCase of cases) {
    await selectOperation(page, testCase.operationId)
    await selectTemplate(page, testCase.templateId)
    if (testCase.mode) await selectMode(page, testCase.mode)
    await expect(page.getByTestId('provenance')).toHaveText('固定サンプル')
    await forwardToEnd(page)
    await expectPlaybackState(page, 'COMPLETED')
  }
})
