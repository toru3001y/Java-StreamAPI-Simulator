import type { Page } from '@playwright/test'

/**
 * 証跡（artifacts/phase-N/）への書込みを許可するPhase。
 * 次Phase着手時はこの1か所だけを更新する（例: Phase 5開始時に 5 へ変更）。
 */
export const CAPTURE_TARGET_PHASE = 4

/**
 * Phase証跡キャプチャの共通処理。
 * - 対象Phase（CAPTURE_TARGET_PHASE）のときだけ artifacts/phase-N/ へPNGを書き込む。
 * - 対象外Phaseでは同じ画面操作の成立を確認するため screenshot のbuffer取得だけを行い、
 *   追跡対象ファイル（過去Phaseの証跡）には一切書き込まない。
 */
export async function captureArtifact(page: Page, phase: number, fileName: string): Promise<void> {
  if (phase === CAPTURE_TARGET_PHASE) {
    await page.screenshot({ path: `artifacts/phase-${phase}/${fileName}`, fullPage: true })
  } else {
    await page.screenshot({ fullPage: true })
  }
}
