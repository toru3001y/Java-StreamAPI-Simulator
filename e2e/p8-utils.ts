import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { selectMode, selectOperation, selectTemplate } from './utils'

/** Phase 8 E2E共通helper */

export async function openToMap(page: Page, templateId: string, mode?: string): Promise<void> {
  await selectOperation(page, 'collect')
  await selectTemplate(page, templateId)
  if (mode) await selectMode(page, mode)
  await expect(page.getByTestId('op-context-collector')).toBeVisible()
}

/** toMap構造4行のテキストを取り出す */
export async function toMapRowText(
  page: Page,
  row: 'key-mapper' | 'value-mapper' | 'merge-function' | 'map-factory',
): Promise<string> {
  return (await page.getByTestId(`tomap-${row}`).textContent()) ?? ''
}

/** 最終結果パネルのMap entryテキスト列 */
export async function mapEntryTexts(page: Page): Promise<string[]> {
  return page.getByTestId('map-entries').locator('> li').allTextContents()
}

/** toMap蓄積viewのentryテキスト列（構造ツリー側） */
export async function accumulationEntryTexts(page: Page): Promise<string[]> {
  return page.getByTestId('collector-tomap-entries').locator('li').allTextContents()
}
