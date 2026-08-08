import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { makeDefinition, runAllSnapshots } from '../helpers'
import { finalSnapshot, makeCustomDefinition, intArraySource, tplSink, tplSrc } from '../p3-helpers'
import { createDefaultTemplateRegistry } from '../../src/domain/template/templates'
import { formatDoubleLiteral, formatLongLiteral } from '../../src/domain/model/value'
import type { PipelineTemplate } from '../../src/domain/template/pipelineTemplate'
import type { ScenarioMode } from '../../src/domain/scenario/scenario'
import type { TemplateId } from '../../src/domain/types/ids'

/**
 * P3-O01の照合基準ファイル（oracle/expected-p3-from-core.json）が
 * Simulation Coreの実際の出力と一致していることを保証する同期テスト。
 * JDK 25側との照合本体は `npm run test:oracle` が行う。
 */
const expected = JSON.parse(
  readFileSync(path.join(__dirname, '../../oracle/expected-p3-from-core.json'), 'utf8'),
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
  const snapshot = finalSnapshot(makeDefinition(templateId, mode))
  return snapshot.output.items.map((item) => item.label)
}

const registry = createDefaultTemplateRegistry()

function limitBoundaryTemplate(templateId: string): PipelineTemplate {
  return {
    templateId,
    version: 1,
    targetOperationId: 'toList',
    targetNodeId: 'node-sink',
    title: 'oracle sync',
    sourceDefinition: { slotId: 'slot-source', defaultDsl: null, allowedSourceKinds: ['rangeClosed'] },
    nodes: [
      tplSrc('source.rangeClosed'),
      { nodeId: 'node-limit', operationId: 'limit', role: 'intermediate', slotId: 'slot-count' },
      { nodeId: 'node-boxed', operationId: 'boxed', role: 'intermediate', slotId: null },
      tplSink(),
    ],
    parameterSlots: [{ slotId: 'slot-count', targetNodeId: 'node-limit', kind: 'count', required: true }],
    allowedDslProfile: { predicateKinds: [] },
    supportedModes: ['standard'],
    jdkNotes: [],
    snapshotBudget: { limit: 500, estimatedMax: 40 },
  }
}

function primitiveOpTemplate(templateId: string, op: 'sorted' | 'distinct'): PipelineTemplate {
  return {
    templateId,
    version: 1,
    targetOperationId: op,
    targetNodeId: `node-${op}`,
    title: 'oracle sync',
    sourceDefinition: { slotId: 'slot-source', defaultDsl: null, allowedSourceKinds: ['arrayPrimitive'] },
    nodes: [
      tplSrc('source.arraysStream'),
      { nodeId: `node-${op}`, operationId: op, role: 'intermediate', slotId: null },
      { nodeId: 'node-boxed', operationId: 'boxed', role: 'intermediate', slotId: null },
      tplSink(),
    ],
    parameterSlots: [],
    allowedDslProfile: { predicateKinds: [] },
    supportedModes: ['standard'],
    jdkNotes: [],
    snapshotBudget: { limit: 500, estimatedMax: 60 },
  }
}

describe('P3-O01 Oracle期待値の同期', () => {
  it('P3-O01(sync): distinct（結果・ordered先頭保持）がCoreと一致する', () => {
    expect(coreLabels('tmpl-distinct')).toEqual((expected['distinct'] as string[]).map((v) => toLabel('string', v)))
    // distinctKeptIndices: encounter orderで最初の要素のindexが残る
    const keptIndices = finalSnapshot(makeDefinition('tmpl-distinct')).output.items.map((item) =>
      Number(item.id.replace('of-', '')) - 1,
    )
    expect(keptIndices).toEqual(expected['distinctKeptIndices'])
  })

  it('P3-O01(sync): sorted（natural / Comparator stable順）がCoreと一致する', () => {
    expect(coreLabels('tmpl-sorted-natural')).toEqual(
      (expected['sortedNatural'] as string[]).map((v) => toLabel('string', v)),
    )
    const comparatorNames = finalSnapshot(makeDefinition('tmpl-sorted-comparator')).output.items.map(
      (item) => item.label.split('（')[0],
    )
    expect(comparatorNames).toEqual(expected['sortedComparatorNames'])
  })

  it('P3-O01(sync): limit / skipの0・一部・全件境界がCoreと一致する', () => {
    const asInt = (key: string) => (expected[key] as number[]).map((v) => toLabel('int', v))
    expect(coreLabels('tmpl-limit')).toEqual(asInt('limitStandard'))
    expect(coreLabels('tmpl-limit', 'midEmpty')).toEqual(asInt('limitZero'))
    const equalDef = makeCustomDefinition(limitBoundaryTemplate('tmpl-sync-limit-equal'), {
      'slot-source': { kind: 'rangeClosed', from: 1, to: 3 },
      'slot-count': 3,
    })
    expect(finalSnapshot(equalDef).output.items.map((i) => i.label)).toEqual(asInt('limitEqual'))
    const overDef = makeCustomDefinition(limitBoundaryTemplate('tmpl-sync-limit-over'), {
      'slot-source': { kind: 'rangeClosed', from: 1, to: 2 },
      'slot-count': 5,
    })
    expect(finalSnapshot(overDef).output.items.map((i) => i.label)).toEqual(asInt('limitOver'))

    expect(coreLabels('tmpl-skip')).toEqual(asInt('skipStandard'))
    const skipTemplate = registry.get('tmpl-skip', 1)!
    const skipZeroDef = makeCustomDefinition(skipTemplate, {
      'slot-source': intArraySource([10, 20, 30, 40]),
      'slot-count': 0,
    })
    expect(finalSnapshot(skipZeroDef).output.items.map((i) => i.label)).toEqual(asInt('skipZero'))
    const skipAllDef = makeCustomDefinition(skipTemplate, {
      'slot-source': intArraySource([10, 20, 30, 40]),
      'slot-count': 6,
    })
    expect(finalSnapshot(skipAllDef).output.items.map((i) => i.label)).toEqual(asInt('skipAll'))
  })

  it('P3-O01(sync): takeWhile / dropWhileの基準入力がCoreと一致する', () => {
    const asInt = (key: string) => (expected[key] as number[]).map((v) => toLabel('int', v))
    expect(coreLabels('tmpl-takewhile')).toEqual(asInt('takeWhileStandard'))
    expect(coreLabels('tmpl-takewhile', 'midEmpty')).toEqual(asInt('takeWhileFirstFalse'))
    expect(coreLabels('tmpl-dropwhile')).toEqual(asInt('dropWhileStandard'))
    expect(coreLabels('tmpl-dropwhile', 'midEmpty')).toEqual(asInt('dropWhileAllTrue'))
  })

  it('P3-O01(sync): generate / iterate2 + limitとsupplier呼び出し回数がCoreと一致する', () => {
    const asInt = (key: string) => (expected[key] as number[]).map((v) => toLabel('int', v))
    const genDef = makeDefinition('tmpl-limit-generate')
    expect(finalSnapshot(genDef).output.items.map((i) => i.label)).toEqual(asInt('generateLimit'))
    // supplier呼び出し回数 = source要求件数（無限sourceを全件具現化しない）
    const emits = runAllSnapshots(genDef).filter((s) => s.kind === 'SOURCE_EMIT').length
    expect(emits).toBe(expected['generateSupplierCalls'])
    expect(genDef.boundedness.maxSourceDemand).toBe(expected['generateSupplierCalls'])
    expect(coreLabels('tmpl-limit-iterate2')).toEqual(asInt('iterateLimit'))
  })

  it('P3-O01(sync): peekのaction呼出し順と最終結果の不変性がCoreと一致する', () => {
    const peekLast = finalSnapshot(makeDefinition('tmpl-peek'))
    expect(peekLast.output.items.map((i) => i.label.split('（')[0])).toEqual(expected['peekResultNames'])
    expect(peekLast.sideEffects.map((e) => e.message)).toEqual(expected['peekActions'])
  })

  it('P3-O01(sync): primitive Streamのsorted / distinct（Double.compare準拠）がCoreと一致する', () => {
    const intDef = makeCustomDefinition(primitiveOpTemplate('tmpl-sync-int-sorted', 'sorted'), {
      'slot-source': intArraySource([3, 1, 2]),
    })
    expect(finalSnapshot(intDef).output.items.map((i) => i.label)).toEqual(
      (expected['intSorted'] as number[]).map((v) => toLabel('int', v)),
    )
    const longDef = makeCustomDefinition(primitiveOpTemplate('tmpl-sync-long-sorted', 'sorted'), {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'long', values: [30, 10, 20] },
    })
    expect(finalSnapshot(longDef).output.items.map((i) => i.label)).toEqual(
      (expected['longSorted'] as number[]).map((v) => toLabel('long', v)),
    )
    const doubleDef = makeCustomDefinition(primitiveOpTemplate('tmpl-sync-double-sorted', 'sorted'), {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'double', values: [2.5, 1.5, 3.5] },
    })
    expect(finalSnapshot(doubleDef).output.items.map((i) => i.label)).toEqual(
      (expected['doubleSorted'] as number[]).map((v) => toLabel('double', v)),
    )
    const doubleDistinctDef = makeCustomDefinition(primitiveOpTemplate('tmpl-sync-double-distinct', 'distinct'), {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'double', values: [2.5, 1.5, 2.5] },
    })
    expect(finalSnapshot(doubleDistinctDef).output.items.map((i) => i.label)).toEqual(
      (expected['doubleDistinct'] as number[]).map((v) => toLabel('double', v)),
    )
  })

  it('P3-O01(sync): 空Streamで各操作が空結果となることがCoreと一致する', () => {
    expect(coreLabels('tmpl-distinct', 'emptySource')).toEqual(expected['emptyDistinct'])
    expect(coreLabels('tmpl-sorted-natural', 'emptySource')).toEqual(expected['emptySorted'])
    expect(coreLabels('tmpl-limit', 'emptySource')).toEqual(expected['emptyLimit'])
    expect(coreLabels('tmpl-skip', 'emptySource')).toEqual(expected['emptySkip'])
    expect(coreLabels('tmpl-takewhile', 'emptySource')).toEqual(expected['emptyTakeWhile'])
    expect(coreLabels('tmpl-dropwhile', 'emptySource')).toEqual(expected['emptyDropWhile'])
    const emptyPeek = finalSnapshot(makeDefinition('tmpl-peek', 'emptySource'))
    expect(emptyPeek.output.items).toEqual(expected['emptyPeek'])
    expect(emptyPeek.sideEffects.length).toBe(expected['emptyPeekActionCount'])
  })
})
