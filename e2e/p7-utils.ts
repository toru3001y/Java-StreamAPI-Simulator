import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { selectMode, selectOperation, selectTemplate } from './utils'

/** Phase 7 E2E共通helper */

export async function openGather(page: Page, templateId: string, mode?: string): Promise<void> {
  await selectOperation(page, 'gather')
  await selectTemplate(page, templateId)
  if (mode) await selectMode(page, mode)
  await expect(page.getByTestId('op-context-gather')).toBeVisible()
}

/** gatherパネルの構成要素行のテキストを取り出す */
export async function elementRowText(
  page: Page,
  name: 'initializer' | 'integrator' | 'combiner' | 'finisher',
): Promise<string> {
  return (await page.getByTestId(`gatherer-element-${name}`).textContent()) ?? ''
}
