import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { makeDefinition, runAllSnapshots } from '../helpers'
import { formatDoubleLiteral, formatLongLiteral } from '../../src/domain/model/value'
import { formatTypeRef } from '../../src/domain/types/typeRef'
import type { ScenarioMode } from '../../src/domain/scenario/scenario'
import type { TemplateId } from '../../src/domain/types/ids'

/**
 * P2-O01の照合基準ファイル（oracle/expected-p2-from-core.json）が
 * Simulation Coreの実際の出力と一致していることを保証する同期テスト。
 * JDK 25側との照合本体は `npm run test:oracle` が行う。
 */
const expected = JSON.parse(
  readFileSync(path.join(__dirname, '../../oracle/expected-p2-from-core.json'), 'utf8'),
) as Record<string, unknown>

type LabelKind = 'string' | 'int' | 'long' | 'double'

function toLabel(kind: LabelKind, v: unknown): string {
  switch (kind) {
    case 'string':
      return `"${String(v)}"`
    case 'int':
      return String(v)
    case 'long':
      return formatLongLiteral(Number(v))
    case 'double':
      return formatDoubleLiteral(Number(v))
  }
}

function coreLabels(templateId: TemplateId, mode: ScenarioMode = 'standard'): string[] {
  const def = makeDefinition(templateId, mode)
  const snapshots = runAllSnapshots(def)
  const last = snapshots[snapshots.length - 1]
  if (!last) throw new Error('snapshotがありません')
  return last.output.items.map((item) => item.label)
}

function elementTypeName(templateId: TemplateId, mode: ScenarioMode = 'standard'): string {
  const def = makeDefinition(templateId, mode)
  const formatted = formatTypeRef(def.resultType)
  const match = /^List<(.+)>$/.exec(formatted)
  if (!match || !match[1]) throw new Error(`List型ではありません: ${formatted}`)
  return match[1]
}

describe('P2-O01 Oracle期待値の同期', () => {
  const listCases: readonly [string, TemplateId, LabelKind, ScenarioMode?][] = [
    ['collectionNames', 'tmpl-src-collection', 'string'],
    ['arraysUpper', 'tmpl-src-arrays-object', 'string'],
    ['arraysInt', 'tmpl-src-arrays-int', 'int'],
    ['streamOfUpper', 'tmpl-src-of', 'string'],
    ['iterate3', 'tmpl-src-iterate3', 'int'],
    ['range', 'tmpl-src-range', 'int'],
    ['rangeClosed', 'tmpl-src-range-closed', 'int'],
    ['ages', 'tmpl-maptoint', 'int'],
    ['salaries', 'tmpl-maptolong', 'long'],
    ['evaluations', 'tmpl-maptodouble', 'double'],
    ['boxedRange', 'tmpl-boxed', 'int'],
    ['mapToObj', 'tmpl-maptoobj', 'string'],
    ['flatten', 'tmpl-flatmap', 'string'],
    ['flattenInt', 'tmpl-flatmap-int', 'int'],
    ['flattenLong', 'tmpl-flatmap-long', 'long'],
    ['flattenDouble', 'tmpl-flatmap-double', 'double'],
    ['emptyObject', 'tmpl-src-empty-object', 'string', 'emptySource'],
    ['emptyInt', 'tmpl-src-empty-int', 'int', 'emptySource'],
    ['emptyLong', 'tmpl-src-empty-long', 'long', 'emptySource'],
    ['emptyDouble', 'tmpl-src-empty-double', 'double', 'emptySource'],
  ]

  it('P2-O01(sync): expected-p2-from-core.jsonの各ケースがSimulation Coreの結果と一致する', () => {
    for (const [key, templateId, kind, mode] of listCases) {
      const values = expected[key]
      expect(Array.isArray(values), key).toBe(true)
      const expectedLabels = (values as unknown[]).map((v) => toLabel(kind, v))
      expect(coreLabels(templateId, mode ?? 'standard'), key).toEqual(expectedLabels)
    }
  })

  it('P2-O01(sync): wrapper要素型がSimulation CoreのTypeRefと一致する', () => {
    expect(elementTypeName('tmpl-maptoint')).toBe(expected['agesElementType'])
    expect(elementTypeName('tmpl-maptolong')).toBe(expected['salariesElementType'])
    expect(elementTypeName('tmpl-maptodouble')).toBe(expected['evaluationsElementType'])
    expect(elementTypeName('tmpl-maptoobj')).toBe(expected['mapToObjElementType'])
    expect(elementTypeName('tmpl-flatmap-int')).toBe(expected['flattenIntElementType'])
  })
})
