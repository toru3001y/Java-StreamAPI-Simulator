import { describe, expect, it } from 'vitest'
import { EXECUTABLE_TEMPLATES } from '../p6-helpers'
import { makeDefinition, runAllSnapshots } from '../helpers'
import { SNAPSHOT_LIMIT } from '../../src/domain/template/instantiate'
import type { ScenarioMode } from '../../src/domain/scenario/scenario'

/**
 * P6-D22（§12の末尾連番採番）: 全シナリオ種別の総点検（Phase 6指示 §10.1）。
 *
 * 全実行可能template × supportedModesの全組合せについて、
 * 初期snapshotから終端（STREAM_CONSUMED）まで到達し、snapshot予算内に収まり、
 * Javaコード表示が生成されることを機械検証する。
 * 代表シナリオの画面確認はE2E（P6-E04）が担う。
 */

interface CheckRow {
  readonly templateId: string
  readonly mode: ScenarioMode
  readonly snapshots: number
  readonly completed: boolean
  readonly javaCodeLines: number
}

function runCheck(): CheckRow[] {
  const rows: CheckRow[] = []
  for (const template of EXECUTABLE_TEMPLATES) {
    for (const mode of template.supportedModes) {
      const definition = makeDefinition(template.templateId, mode)
      const snapshots = runAllSnapshots(definition)
      const last = snapshots[snapshots.length - 1]
      rows.push({
        templateId: template.templateId,
        mode,
        snapshots: snapshots.length,
        completed: last?.completion === 'STREAM_CONSUMED',
        javaCodeLines: definition.javaCode.length,
      })
    }
  }
  return rows
}

describe('P6-D22 全シナリオ種別の総点検', () => {
  const rows = runCheck()

  it('P6-D22: 全実行可能template × modeが初期snapshotから終端まで到達する', () => {
    expect(rows.length).toBeGreaterThan(80)
    const notCompleted = rows.filter((row) => !row.completed)
    expect(notCompleted.map((r) => `${r.templateId}:${r.mode}`)).toEqual([])
  })

  it('P6-D22: 全組合せがsnapshot安全上限に収まり、Javaコード表示が生成される', () => {
    const overBudget = rows.filter((row) => row.snapshots > SNAPSHOT_LIMIT)
    expect(overBudget.map((r) => `${r.templateId}:${r.mode}=${r.snapshots}`)).toEqual([])
    const noJavaCode = rows.filter((row) => row.javaCodeLines === 0)
    expect(noJavaCode.map((r) => `${r.templateId}:${r.mode}`)).toEqual([])
  })

  it('P6-D22: 全実行可能templateのsupportedModesが1件以上ある（未点検の組合せがない）', () => {
    for (const template of EXECUTABLE_TEMPLATES) {
      expect(template.supportedModes.length, template.templateId).toBeGreaterThan(0)
      const checked = rows.filter((row) => row.templateId === template.templateId)
      expect(checked.length, template.templateId).toBe(template.supportedModes.length)
    }
  })
})
