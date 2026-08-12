import { expect, test } from '@playwright/test'
import { captureArtifact } from './capture-helper'
import { forwardToEnd, selectOperation, selectTemplate } from './utils'
import { pasteCandidate } from './p6-utils'

/** P6-E05（狭幅確認分）: 375px（chromium-narrow）での取込UI表示検証とキャプチャ */
test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

const NARROW_CANDIDATE = {
  dslVersion: '1',
  templateId: 'tmpl-filter-basic',
  templateVersion: 1,
  mode: 'standard',
  dataset: [
    {
      name: '狭幅通過',
      age: 44,
      salary: 6_400_000,
      evaluation: 4.4,
      region: '東北',
      hireDate: '2016-04-01',
      department: { name: '設計部', division: '技術本部' },
      skills: ['Java'],
    },
    {
      name: '狭幅除外',
      age: 26,
      salary: 3_900_000,
      evaluation: 3.4,
      region: '沖縄',
      hireDate: '2023-04-01',
      department: { name: '設計部', division: '技術本部' },
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
  title: '狭幅の取込サンプル',
  description: '狭幅での取込UI表示を確認します。',
}

async function pageOverflows(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
}

test('P6-E05-narrow: 狭幅で取込UI・失敗理由・取込サンプル実行が崩れない', async ({ page }) => {
  test.setTimeout(120_000)
  // 取込UIが狭幅でも表示され、ページ全体は横スクロールしない
  await expect(page.getByTestId('import-panel')).toBeVisible()
  await expect(page.getByTestId('import-textarea')).toBeVisible()
  expect(await pageOverflows(page)).toBe(false)

  // 検証失敗理由（長いpath・messageを含む）でも横スクロールしない
  await pasteCandidate(page, '{"dslVersion":"1"}')
  await expect(page.getByTestId('import-issues')).toBeVisible()
  expect(await pageOverflows(page)).toBe(false)

  // 取込成立後も崩れない
  await pasteCandidate(page, JSON.stringify(NARROW_CANDIDATE))
  await expect(page.getByTestId('import-accepted')).toBeVisible()
  await expect(page.getByTestId('provenance')).toHaveText('取込サンプル')
  expect(await pageOverflows(page)).toBe(false)
  // Pipelineは狭幅でも専用横スクロールを維持する
  await expect(page.getByTestId('pipeline-scroll')).toBeVisible()

  await forwardToEnd(page)
  expect(await pageOverflows(page)).toBe(false)

  // stickyバーが本文を隠さない
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

test('P6-E05-narrow: 狭幅の視覚回帰（取込UI・失敗表示・取込サンプル）', async ({ page }) => {
  test.setTimeout(120_000)
  await expect(page.getByTestId('import-panel')).toBeVisible()
  await expect(page).toHaveScreenshot('p6-e05-narrow-import-panel.png', { fullPage: true })

  await pasteCandidate(page, '{"dslVersion":"1"}')
  await expect(page.getByTestId('import-issues')).toBeVisible()
  await expect(page).toHaveScreenshot('p6-e05-narrow-import-rejected.png', { fullPage: true })

  await pasteCandidate(page, JSON.stringify(NARROW_CANDIDATE))
  await expect(page.getByTestId('import-accepted')).toBeVisible()
  await expect(page).toHaveScreenshot('p6-e05-narrow-import-accepted.png', { fullPage: true })
})

test('p6-capture-narrow: Phase 6狭幅キャプチャを保存する', async ({ page }) => {
  test.setTimeout(120_000)
  await captureArtifact(page, 6, 'capture-narrow-import-panel.png')

  await pasteCandidate(page, '{"dslVersion":"1"}')
  await expect(page.getByTestId('import-issues')).toBeVisible()
  await captureArtifact(page, 6, 'capture-narrow-import-rejected.png')

  await pasteCandidate(page, JSON.stringify(NARROW_CANDIDATE))
  await expect(page.getByTestId('import-accepted')).toBeVisible()
  await captureArtifact(page, 6, 'capture-narrow-import-accepted.png')

  await forwardToEnd(page)
  await captureArtifact(page, 6, 'capture-narrow-imported-completed.png')

  // source slot型templateの取込UI
  await selectOperation(page, 'source.arraysStream')
  await selectTemplate(page, 'tmpl-src-arrays-int')
  await captureArtifact(page, 6, 'capture-narrow-source-slot.png')
})
