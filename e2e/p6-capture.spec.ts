import { expect, test } from '@playwright/test'
import { captureArtifact } from './capture-helper'
import { forwardToEnd, selectOperation, selectTemplate } from './utils'
import { copyPrompt, exampleJsonOf, grantClipboard, pasteCandidate } from './p6-utils'

/**
 * P6-E05（PC幅分）: 取込UIを含むPC幅の視覚回帰とキャプチャ（artifacts/phase-6/へ保存。指示§14の証跡）
 */
const PC_CANDIDATE = {
  dslVersion: '1',
  templateId: 'tmpl-filter-basic',
  templateVersion: 1,
  mode: 'standard',
  dataset: [
    {
      name: 'PC通過',
      age: 46,
      salary: 7_800_000,
      evaluation: 4.7,
      region: '関東',
      hireDate: '2014-04-01',
      department: { name: '基盤部', division: '技術本部' },
      skills: ['Java', 'SQL'],
    },
    {
      name: 'PC除外',
      age: 25,
      salary: 3_600_000,
      evaluation: 3.3,
      region: '中国',
      hireDate: '2024-04-01',
      department: { name: '営業支援部', division: '営業本部' },
      skills: ['営業'],
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
  title: 'PC幅の取込サンプル',
  description: 'PC幅での取込UI表示とJavaコード表示を確認します。',
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('P6-E05: 取込UIを含むPC幅の視覚回帰（基準画像の意図的更新）', async ({ page }) => {
  test.setTimeout(120_000)
  await expect(page.getByTestId('import-panel')).toBeVisible()
  await expect(page).toHaveScreenshot('p6-e05-import-panel.png', { fullPage: true })

  await pasteCandidate(page, '{"dslVersion":"1"}')
  await expect(page.getByTestId('import-issues')).toBeVisible()
  await expect(page).toHaveScreenshot('p6-e05-import-rejected.png', { fullPage: true })

  await pasteCandidate(page, JSON.stringify(PC_CANDIDATE))
  await expect(page.getByTestId('import-accepted')).toBeVisible()
  await expect(page).toHaveScreenshot('p6-e05-import-accepted.png', { fullPage: true })

  await forwardToEnd(page)
  await expect(page).toHaveScreenshot('p6-e05-imported-completed.png', { fullPage: true })
})

test('p6-capture-pc: PC幅の画面キャプチャを保存する', async ({ page }) => {
  test.setTimeout(180_000)
  await grantClipboard(page)

  await captureArtifact(page, 6, 'capture-pc-import-panel.png')

  // プロンプトのコピー成否フィードバック
  await copyPrompt(page)
  await captureArtifact(page, 6, 'capture-pc-copy-feedback.png')

  // 検証失敗表示
  await pasteCandidate(page, '{"dslVersion":"1","templateId":"tmpl-filter-basic"}')
  await expect(page.getByTestId('import-issues')).toBeVisible()
  await captureArtifact(page, 6, 'capture-pc-import-rejected.png')

  // 取込サンプル成立と実行
  await pasteCandidate(page, JSON.stringify(PC_CANDIDATE))
  await expect(page.getByTestId('import-accepted')).toBeVisible()
  await captureArtifact(page, 6, 'capture-pc-import-accepted.png')
  await forwardToEnd(page)
  await captureArtifact(page, 6, 'capture-pc-imported-completed.png')

  // プロンプトの出力例をそのまま取り込んだsource slot型template
  await selectOperation(page, 'source.arraysStream')
  await selectTemplate(page, 'tmpl-src-arrays-int')
  const prompt = await copyPrompt(page)
  await pasteCandidate(page, exampleJsonOf(prompt))
  await expect(page.getByTestId('import-accepted')).toBeVisible()
  await forwardToEnd(page)
  await captureArtifact(page, 6, 'capture-pc-imported-source-slot.png')
})
