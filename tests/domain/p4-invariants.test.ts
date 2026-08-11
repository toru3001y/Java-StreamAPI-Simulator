import { describe, expect, it } from 'vitest'
import { makeDefinition, makeScenario, runAllSnapshots } from '../helpers'
import {
  assertProcessingAtMostOne,
  finalSnapshot,
  makeCustomDefinition,
  streamOfSource,
  tplSink,
  tplSrc,
} from '../p3-helpers'
import { createDefaultCatalog } from '../../src/domain/catalog/operations'
import type { ScenarioMode } from '../../src/domain/scenario/scenario'

/** P4-D38〜P4-D40: snapshot不変条件と短絡合成（Phase 4指示 §10） */

const P4_TEMPLATE_MODES: readonly { templateId: string; mode: ScenarioMode }[] = [
  { templateId: 'tmpl-reduce-concat', mode: 'standard' },
  { templateId: 'tmpl-reduce-concat', mode: 'emptySource' },
  { templateId: 'tmpl-reduce-concat-midempty', mode: 'midEmpty' },
  { templateId: 'tmpl-reduce-int', mode: 'standard' },
  { templateId: 'tmpl-reduce-int', mode: 'emptySource' },
  { templateId: 'tmpl-reduce-int-identity', mode: 'standard' },
  { templateId: 'tmpl-reduce-int-identity', mode: 'emptySource' },
  { templateId: 'tmpl-reduce-salary', mode: 'standard' },
  { templateId: 'tmpl-reduce-salary', mode: 'emptySource' },
  { templateId: 'tmpl-count', mode: 'standard' },
  { templateId: 'tmpl-count', mode: 'emptySource' },
  { templateId: 'tmpl-count-midempty', mode: 'midEmpty' },
  { templateId: 'tmpl-min-age', mode: 'standard' },
  { templateId: 'tmpl-min-age', mode: 'emptySource' },
  { templateId: 'tmpl-max-age', mode: 'standard' },
  { templateId: 'tmpl-min-int', mode: 'standard' },
  { templateId: 'tmpl-max-long', mode: 'standard' },
  { templateId: 'tmpl-min-double', mode: 'standard' },
  { templateId: 'tmpl-findfirst', mode: 'standard' },
  { templateId: 'tmpl-findfirst', mode: 'midEmpty' },
  { templateId: 'tmpl-findfirst', mode: 'emptySource' },
  { templateId: 'tmpl-findany', mode: 'standard' },
  { templateId: 'tmpl-anymatch', mode: 'standard' },
  { templateId: 'tmpl-anymatch', mode: 'emptySource' },
  { templateId: 'tmpl-allmatch', mode: 'standard' },
  { templateId: 'tmpl-allmatch', mode: 'emptySource' },
  { templateId: 'tmpl-nonematch', mode: 'standard' },
  { templateId: 'tmpl-nonematch', mode: 'emptySource' },
  { templateId: 'tmpl-sum-int', mode: 'standard' },
  { templateId: 'tmpl-sum-long', mode: 'standard' },
  { templateId: 'tmpl-sum-double', mode: 'standard' },
  { templateId: 'tmpl-average-int', mode: 'standard' },
  { templateId: 'tmpl-average-long', mode: 'standard' },
  { templateId: 'tmpl-average-double', mode: 'standard' },
  { templateId: 'tmpl-stats-int', mode: 'standard' },
  { templateId: 'tmpl-stats-int', mode: 'emptySource' },
  { templateId: 'tmpl-stats-long', mode: 'standard' },
  { templateId: 'tmpl-stats-double', mode: 'standard' },
  { templateId: 'tmpl-toarray-object', mode: 'standard' },
  { templateId: 'tmpl-toarray-int', mode: 'standard' },
  { templateId: 'tmpl-toarray-long', mode: 'standard' },
  { templateId: 'tmpl-toarray-double', mode: 'standard' },
  { templateId: 'tmpl-toarray-generator', mode: 'standard' },
  { templateId: 'tmpl-toarray-generator', mode: 'emptySource' },
  { templateId: 'tmpl-foreach', mode: 'standard' },
  { templateId: 'tmpl-foreach', mode: 'emptySource' },
  { templateId: 'tmpl-foreachordered', mode: 'standard' },
]

describe('P4-D38 RESULT_CONFIRMED → STREAM_CONSUMED', () => {
  it('P4-D38: 終端後に必ずSTREAM CONSUMEDとなり、履歴を再現できる', () => {
    for (const { templateId, mode } of P4_TEMPLATE_MODES) {
      const snapshots = runAllSnapshots(makeDefinition(templateId, mode))
      const kinds = snapshots.map((s) => s.kind)
      // 最後の2件は必ずRESULT_CONFIRMED → STREAM_CONSUMED（以降のsnapshotなし）
      expect(kinds.at(-2), `${templateId}:${mode}`).toBe('RESULT_CONFIRMED')
      expect(kinds.at(-1), `${templateId}:${mode}`).toBe('STREAM_CONSUMED')
      expect(kinds.filter((k) => k === 'STREAM_CONSUMED'), `${templateId}:${mode}`).toHaveLength(1)
      // 構造処理・空結果確定はcurrentElementId === null
      const confirmed = snapshots[snapshots.length - 2]!
      expect(confirmed.currentElementId, `${templateId}:${mode}`).toBeNull()
    }
    // 同revisionから同一列を再現（構造比較）
    const scenarioA = makeScenario('tmpl-reduce-salary')
    const scenarioB = makeScenario('tmpl-reduce-salary')
    const a = runAllSnapshots(scenarioA.pipeline)
    const b = runAllSnapshots(scenarioB.pipeline)
    expect(b.map((s) => s.kind)).toEqual(a.map((s) => s.kind))
    a.forEach((s, i) => {
      expect(b[i]!.output.result).toEqual(s.output.result)
      expect(b[i]!.operationContexts).toEqual(s.operationContexts)
    })
  })
})

describe('P4-D39 PROCESSING・deep freeze・予算', () => {
  it('P4-D39: 全P4 templateでPROCESSING最大1件・deep freeze・500以内', () => {
    for (const { templateId, mode } of P4_TEMPLATE_MODES) {
      const def = makeDefinition(templateId, mode)
      const snapshots = runAllSnapshots(def)
      assertProcessingAtMostOne(snapshots, `${templateId}:${mode}`)
      expect(snapshots.length, `${templateId}:${mode}`).toBeLessThanOrEqual(500)
      expect(def.snapshotCount, `${templateId}:${mode}`).toBe(snapshots.length)
      const last = snapshots[snapshots.length - 1]!
      expect(Object.isFrozen(last), `${templateId}:${mode}`).toBe(true)
      expect(Object.isFrozen(last.output.result), `${templateId}:${mode}`).toBe(true)
      expect(Object.isFrozen(last.operationContexts), `${templateId}:${mode}`).toBe(true)
      expect(Object.isFrozen(last.sideEffects), `${templateId}:${mode}`).toBe(true)
    }
  })
})

describe('P4-D40 短絡合成とCatalog登録範囲', () => {
  it('P4-D40: sorted → findFirstはsort後の最初の放出で短絡し、残りを放出しない', () => {
    const def = makeCustomDefinition(
      {
        templateId: 'tmpl-test-sorted-findfirst',
        version: 1,
        targetOperationId: 'findFirst',
        targetNodeId: 'node-sink',
        title: 'test',
        sourceDefinition: { slotId: 'slot-source', defaultDsl: null, allowedSourceKinds: ['streamOf'] },
        nodes: [
          tplSrc('source.streamOf'),
          { nodeId: 'node-sorted', operationId: 'sorted', role: 'intermediate', slotId: null },
          { nodeId: 'node-sink', operationId: 'findFirst', role: 'terminal', slotId: null },
        ],
        parameterSlots: [],
        allowedDslProfile: { predicateKinds: [] },
        supportedModes: ['standard'],
        jdkNotes: [],
        snapshotBudget: { limit: 500, estimatedMax: 40 },
      },
      { 'slot-source': streamOfSource(['C', 'A', 'B']) },
    )
    const snapshots = runAllSnapshots(def)
    // source全体（3件）のbuffer後にsortが確定し、最初の放出（"A"）だけで短絡
    expect(snapshots.filter((s) => s.kind === 'SORT_BUFFERED')).toHaveLength(3)
    expect(snapshots.filter((s) => s.kind === 'SORT_ORDER_CONFIRMED')).toHaveLength(1)
    expect(snapshots.filter((s) => s.kind === 'SORT_EMITTED')).toHaveLength(1)
    expect(finalSnapshot(def).output.result).toMatchObject({ present: true, valueLabel: '"A"' })
    // 残りのsorted要素（"B", "C"）は放出されずBUFFEREDのまま
    const last = finalSnapshot(def)
    expect(last.elementLatestStates['of-001']).toBe('BUFFERED')
    expect(last.elementLatestStates['of-003']).toBe('BUFFERED')
    assertProcessingAtMostOne(snapshots, 'sorted-findFirst')
  })

  it('P4-D40: flatMap → anyMatchは短絡後に残りの子・親を送出しない', () => {
    const def = makeCustomDefinition(
      {
        templateId: 'tmpl-test-flatmap-anymatch',
        version: 1,
        targetOperationId: 'anyMatch',
        targetNodeId: 'node-sink',
        title: 'test',
        sourceDefinition: {
          slotId: 'slot-source',
          defaultDsl: null,
          allowedSourceKinds: ['streamOfPrimitiveArrays'],
        },
        nodes: [
          tplSrc('source.streamOf'),
          { nodeId: 'node-flatmap', operationId: 'flatMapToInt', role: 'intermediate', slotId: 'slot-mapper-1' },
          { nodeId: 'node-sink', operationId: 'anyMatch', role: 'terminal', slotId: 'slot-predicate-1' },
        ],
        parameterSlots: [
          {
            slotId: 'slot-mapper-1',
            targetNodeId: 'node-flatmap',
            kind: 'mapper',
            required: true,
            allowedMapperKinds: ['arrayStream'],
          },
          {
            slotId: 'slot-predicate-1',
            targetNodeId: 'node-sink',
            kind: 'predicate',
            required: true,
            allowedFields: [],
            allowedOperators: ['GTE'],
          },
        ],
        allowedDslProfile: { predicateKinds: ['currentValueCompare'] },
        supportedModes: ['standard'],
        jdkNotes: [],
        snapshotBudget: { limit: 500, estimatedMax: 60 },
      },
      {
        'slot-source': { kind: 'streamOfPrimitiveArrays', primitive: 'int', arrays: [[1, 6], [2]] },
        'slot-mapper-1': { kind: 'arrayStream', primitive: 'int' },
        'slot-predicate-1': { kind: 'currentValueCompare', operator: 'GTE', value: { type: 'int', value: 5 } },
      },
    )
    const snapshots = runAllSnapshots(def)
    // 子6のtrueで確定。親2つ目（[2]）は送出されず未評価
    expect(finalSnapshot(def).output.result).toMatchObject({ valueLabel: 'true' })
    expect(snapshots.filter((s) => s.kind === 'MATCH_EVALUATED')).toHaveLength(2)
    expect(snapshots.filter((s) => s.kind === 'SOURCE_EMIT')).toHaveLength(1)
    expect(finalSnapshot(def).elementLatestStates['arr-002']).toBe('UNEVALUATED')
    assertProcessingAtMostOne(snapshots, 'flatMap-anyMatch')
  })

  it('P4-D40: limitとterminal短絡の組合せでは、より早い確定位置で上流を停止する', () => {
    const def = makeCustomDefinition(
      {
        templateId: 'tmpl-test-limit-findfirst',
        version: 1,
        targetOperationId: 'findFirst',
        targetNodeId: 'node-sink',
        title: 'test',
        sourceDefinition: { slotId: 'slot-source', defaultDsl: null, allowedSourceKinds: ['rangeClosed'] },
        nodes: [
          tplSrc('source.rangeClosed'),
          { nodeId: 'node-limit', operationId: 'limit', role: 'intermediate', slotId: 'slot-count' },
          { nodeId: 'node-sink', operationId: 'findFirst', role: 'terminal', slotId: null },
        ],
        parameterSlots: [{ slotId: 'slot-count', targetNodeId: 'node-limit', kind: 'count', required: true }],
        allowedDslProfile: { predicateKinds: [] },
        supportedModes: ['standard'],
        jdkNotes: [],
        snapshotBudget: { limit: 500, estimatedMax: 40 },
      },
      { 'slot-source': { kind: 'rangeClosed', from: 1, to: 5 }, 'slot-count': 3 },
    )
    const snapshots = runAllSnapshots(def)
    // findFirstが最初の要素で確定し、limit(3)より早く停止（source送出1件）
    expect(snapshots.filter((s) => s.kind === 'SOURCE_EMIT')).toHaveLength(1)
    expect(finalSnapshot(def).output.result).toMatchObject({
      optionalTypeLabel: 'OptionalInt',
      valueLabel: '1',
    })
    const scIdx = snapshots.findIndex((s) => s.kind === 'SHORT_CIRCUIT_CONFIRMED')
    expect(snapshots.slice(scIdx + 1).map((s) => s.kind)).toEqual(['RESULT_CONFIRMED', 'STREAM_CONSUMED'])
  })

  it('P4-D40: collect / 3引数collectはcollector categoryで登録され、Collectors各種は操作ではなくCollector AST kindである', () => {
    // Phase 5実装に伴い現状へ更新した（Phase 5指示 §12の許可範囲）。
    // 検証意味は「OperationCatalogの登録範囲が仕様どおりであること」を維持する:
    // collect / collectTripleは操作として登録し、Collectors.*は操作ではなくCollector AST kindとして扱う。
    const catalog = createDefaultCatalog()
    expect(catalog.has('collect')).toBe(true)
    expect(catalog.get('collect').category).toBe('collector')
    expect(catalog.has('collectTriple')).toBe(true)
    expect(catalog.get('collectTriple').category).toBe('collector')
    // Collectors.groupingBy / partitioningByはCollector AST内のkindであり、操作としては登録しない
    expect(catalog.has('groupingBy')).toBe(false)
    expect(catalog.has('partitioningBy')).toBe(false)
    void tplSink
  })
})
