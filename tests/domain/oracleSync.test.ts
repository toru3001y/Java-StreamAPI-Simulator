import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { makeDefinition, runAllSnapshots } from '../helpers'
import type { ScenarioMode } from '../../src/domain/scenario/scenario'
import type { TemplateId } from '../../src/domain/types/ids'

/**
 * P1-O01の照合基準ファイル（oracle/expected-from-core.json）が
 * Simulation Coreの実際の出力と一致していることを保証する同期テスト。
 * JDK 25側との照合本体は `npm run test:oracle` が行う。
 */
const expected = JSON.parse(
  readFileSync(path.join(__dirname, '../../oracle/expected-from-core.json'), 'utf8'),
) as Record<string, unknown>

function coreResultNames(templateId: TemplateId, mode: ScenarioMode): string[] {
  const def = makeDefinition(templateId, mode)
  const snapshots = runAllSnapshots(def)
  const last = snapshots[snapshots.length - 1]
  if (!last) throw new Error('snapshotがありません')
  return last.output.elementIds.map((id) => {
    const element = def.dataset.find((d) => d.elementId === id)
    if (!element) throw new Error(`unknown element: ${id}`)
    return element.value.name
  })
}

describe('P1-O01 Oracle期待値の同期', () => {
  it('P1-O01(sync): expected-from-core.jsonがSimulation Coreの結果と一致する', () => {
    expect(coreResultNames('tmpl-filter-basic', 'standard')).toEqual(expected['standard'])
    expect(coreResultNames('tmpl-filter-basic', 'midEmpty')).toEqual(expected['midEmpty'])
    expect(coreResultNames('tmpl-filter-basic', 'emptySource')).toEqual(expected['emptySource'])
    expect(coreResultNames('tmpl-filter-chain', 'standard')).toEqual(expected['chain'])
    // Stream.toList()のunmodifiable性はJDK側で検証する（Core側のList相当は凍結済み）
    expect(expected['standardUnmodifiable']).toBe(true)
  })
})
