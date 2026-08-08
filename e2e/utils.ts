import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export async function forward(page: Page, times: number): Promise<void> {
  const button = page.getByRole('button', { name: '進む' })
  for (let i = 0; i < times; i++) {
    await button.click()
  }
}

export async function selectTemplate(page: Page, templateId: string): Promise<void> {
  await page.getByLabel('教材Pipelineテンプレート').selectOption(templateId)
}

export async function selectMode(page: Page, mode: string): Promise<void> {
  await page.getByLabel('シナリオモード').selectOption(mode)
}

export async function expectPlaybackState(page: Page, state: string): Promise<void> {
  await expect(page.getByTestId('playback-state')).toHaveAttribute('data-state', state)
}

/** 全パネルが同じsnapshot IDを描画していることを確認し、そのIDを返す */
export async function snapshotIds(page: Page): Promise<string> {
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('[data-snapshot-id]')].map(
      (el) => el.getAttribute('data-snapshot-id') ?? '',
    ),
  )
  expect(ids.length).toBeGreaterThan(0)
  expect(new Set(ids).size).toBe(1)
  return ids[0] ?? ''
}
