import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/** Phase 6 E2E共通helper（取込UIの操作） */

/** クリップボード権限を付与する（付与できない環境ではフォールバック表示を検証する） */
export async function grantClipboard(page: Page): Promise<boolean> {
  try {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    return true
  } catch {
    return false
  }
}

const PROMPT_HEADING = '# Java Stream API学習教材の入力データ候補の作成依頼'

/** Windowsのクリップボードは改行をCRLFへ正規化するため、LFへ戻して比較・抽出する */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').trim()
}

/**
 * 「プロンプトをコピー」を押し、コピーされた全文を取得する。
 *
 * クリップボード読取りが使えない環境（権限なし・非フォーカス等）でも検証を続けられるよう、
 * 読取りに失敗した場合は`writeText`を失敗させてフォールバック表示経路から全文を取得する
 * （フォールバック表示自体もv0.10 §5.2の要求であり、ここで併せて成立を確認する）。
 */
export async function copyPrompt(page: Page): Promise<string> {
  await page.getByTestId('copy-prompt-button').click()
  const fallback = page.getByTestId('copy-fallback-text')
  if ((await fallback.count()) > 0) {
    return normalizeNewlines(await fallback.inputValue())
  }
  await expect(page.getByTestId('copy-feedback')).toBeVisible()
  const copied = await page
    .evaluate(() => navigator.clipboard.readText())
    .catch(() => '')
  if (copied.includes(PROMPT_HEADING)) return normalizeNewlines(copied)

  // クリップボード読取りが使えないため、フォールバック表示経路で全文を取得する
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('e2e: clipboard unavailable')) },
    })
  })
  await page.getByTestId('copy-prompt-button').click()
  await expect(fallback).toBeVisible()
  return normalizeNewlines(await fallback.inputValue())
}

/** プロンプト全文から「## 出力例」のJSONを取り出す */
export function exampleJsonOf(prompt: string): string {
  const marker = '## 出力例\n\n'
  const index = prompt.indexOf(marker)
  if (index < 0) throw new Error('プロンプトに出力例が含まれていません')
  return prompt.slice(index + marker.length).trim()
}

/** 候補JSONを貼付欄へ入力して「候補を貼り付け」を押す */
export async function pasteCandidate(page: Page, json: string): Promise<void> {
  await page.getByTestId('import-textarea').fill(json)
  await page.getByTestId('import-button').click()
}
