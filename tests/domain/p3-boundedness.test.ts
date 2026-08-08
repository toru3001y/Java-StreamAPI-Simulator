import { describe, expect, it } from 'vitest'
import { analyzeBoundedness } from '../../src/domain/pipeline/boundedness'
import { makeDefinition, runAllSnapshots, makeScenario } from '../helpers'
import { instantiateCustom, tplSink, tplSrc } from '../p3-helpers'
import type { PipelineTemplate } from '../../src/domain/template/pipelineTemplate'

/** P3-D08〜P3-D11: 無限sourceの有限性解析と有限化（Phase 3指示 §8） */

const GENERATE = { kind: 'generate', ruleId: 'supplier-counter' } as const
const ITERATE2 = { kind: 'iterate2', seed: 1, operator: { ruleId: 'increment', step: 1 } } as const

function generateTemplate(nodes: PipelineTemplate['nodes'], slots: PipelineTemplate['parameterSlots'] = []): PipelineTemplate {
  return {
    templateId: 'tmpl-test-unbounded',
    version: 1,
    targetOperationId: 'source.generate',
    targetNodeId: 'node-src',
    title: 'test',
    sourceDefinition: { slotId: 'slot-source', defaultDsl: null, allowedSourceKinds: ['generate', 'iterate2'] },
    nodes,
    parameterSlots: slots,
    allowedDslProfile: { predicateKinds: ['currentValueCompare'] },
    supportedModes: ['standard'],
    jdkNotes: [],
    snapshotBudget: { limit: 500, estimatedMax: 100 },
  }
}

describe('P3-D08 Pipeline有限性解析', () => {
  it('P3-D08: source有限性とPipeline有限化を区別し、必要source件数を事前導出する', () => {
    // 有限source: 常にfinitized、demandはnull
    const finite = analyzeBoundedness({ kind: 'collection', collectionId: 'employees' }, 'finite', [])
    expect(finite.ok).toBe(true)
    if (finite.ok) {
      expect(finite.value).toEqual({ sourceBounded: 'finite', pipelineFinitized: true, maxSourceDemand: null })
    }
    // generate → limit(3): supplier要求は3件
    const genLimit = analyzeBoundedness(GENERATE, 'infinite', [{ operationId: 'limit', count: 3 }])
    expect(genLimit.ok).toBe(true)
    if (genLimit.ok) {
      expect(genLimit.value.sourceBounded).toBe('infinite')
      expect(genLimit.value.pipelineFinitized).toBe(true)
      expect(genLimit.value.maxSourceDemand).toBe(3)
    }
    // generate → skip(2) → limit(3): 構造上必要な5件を上限として扱える（§8.2）
    const genSkipLimit = analyzeBoundedness(GENERATE, 'infinite', [
      { operationId: 'skip', count: 2 },
      { operationId: 'limit', count: 3 },
    ])
    expect(genSkipLimit.ok).toBe(true)
    if (genSkipLimit.ok) expect(genSkipLimit.value.maxSourceDemand).toBe(5)
    // 1→1のmap / peekはlimit前でも件数を変えない
    const genMapLimit = analyzeBoundedness(GENERATE, 'infinite', [
      { operationId: 'map', count: null },
      { operationId: 'peek', count: null },
      { operationId: 'limit', count: 4 },
    ])
    expect(genMapLimit.ok).toBe(true)
    if (genMapLimit.ok) expect(genMapLimit.value.maxSourceDemand).toBe(4)
    // limit(0)はsupplier / operatorを呼ばない
    const genLimit0 = analyzeBoundedness(GENERATE, 'infinite', [{ operationId: 'limit', count: 0 }])
    expect(genLimit0.ok).toBe(true)
    if (genLimit0.ok) expect(genLimit0.value.maxSourceDemand).toBe(0)
    // skip + limit(0)も0件
    const genSkipLimit0 = analyzeBoundedness(GENERATE, 'infinite', [
      { operationId: 'skip', count: 2 },
      { operationId: 'limit', count: 0 },
    ])
    expect(genSkipLimit0.ok).toBe(true)
    if (genSkipLimit0.ok) expect(genSkipLimit0.value.maxSourceDemand).toBe(0)
  })

  it('P3-D08: 無限sourceを有限と表示しない（source infiniteのままlimitで有限化）', () => {
    const scenario = makeScenario('tmpl-limit-generate')
    // Stream.generate()はlimitで有限に実行されてもsource自体はinfinite / unorderedのまま（§5.3）
    expect(scenario.source.finite).toBe(false)
    expect(scenario.source.ordered).toBe(false)
    expect(scenario.pipeline.boundedness.sourceBounded).toBe('infinite')
    expect(scenario.pipeline.boundedness.pipelineFinitized).toBe(true)
    expect(scenario.pipeline.boundedness.maxSourceDemand).toBe(3)
  })
})

describe('P3-D09 generate + limit', () => {
  it('P3-D09: supplierを必要回数だけ呼び、limit(3)で[1, 2, 3]', () => {
    const def = makeDefinition('tmpl-limit-generate')
    // 無限sourceを全件具現化しない: datasetは必要な3件だけ
    expect(def.dataset).toHaveLength(3)
    const snapshots = runAllSnapshots(def)
    const emits = snapshots.filter((s) => s.kind === 'SOURCE_EMIT')
    expect(emits).toHaveLength(3)
    const last = snapshots[snapshots.length - 1]
    expect(last?.output.items.map((i) => i.label)).toEqual(['1', '2', '3'])
    // 短絡確定snapshotが存在する
    expect(snapshots.some((s) => s.kind === 'SHORT_CIRCUIT_CONFIRMED')).toBe(true)
  })
})

describe('P3-D10 iterate2 + limit', () => {
  it('P3-D10: operatorを必要範囲だけ適用し、limit(5)で[1, 2, 3, 4, 5]', () => {
    const def = makeDefinition('tmpl-limit-iterate2')
    expect(def.dataset).toHaveLength(5)
    const snapshots = runAllSnapshots(def)
    expect(snapshots.filter((s) => s.kind === 'SOURCE_EMIT')).toHaveLength(5)
    const last = snapshots[snapshots.length - 1]
    expect(last?.output.items.map((i) => i.label)).toEqual(['1', '2', '3', '4', '5'])
  })
})

describe('P3-D11 unsafe無限Pipeline', () => {
  it('P3-D11: limitなしの無限sourceをPipelineDefinition生成前に拒否する', () => {
    const result = instantiateCustom(
      generateTemplate([tplSrc('source.generate'), tplSink()]),
      { 'slot-source': GENERATE },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe('UNBOUNDED_SOURCE')
      expect(result.issues[0]?.message).toContain('limit()')
    }
  })

  it('P3-D11: sorted-before-limitの無限Pipelineを拒否する（全bufferが完了しない）', () => {
    const result = instantiateCustom(
      generateTemplate([
        tplSrc('source.generate'),
        { nodeId: 'node-sorted', operationId: 'sorted', role: 'intermediate', slotId: null },
        { nodeId: 'node-limit', operationId: 'limit', role: 'intermediate', slotId: 'slot-count' },
        tplSink(),
      ], [{ slotId: 'slot-count', targetNodeId: 'node-limit', kind: 'count', required: true }]),
      { 'slot-source': GENERATE, 'slot-count': 3 },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.code).toBe('UNBOUNDED_SOURCE')
  })

  it('P3-D11: 有限なsource要求件数を保証できない候補を保守的に拒否する', () => {
    // distinct-before-limit
    const distinctResult = instantiateCustom(
      generateTemplate([
        tplSrc('source.generate'),
        { nodeId: 'node-distinct', operationId: 'distinct', role: 'intermediate', slotId: null },
        { nodeId: 'node-limit', operationId: 'limit', role: 'intermediate', slotId: 'slot-count' },
        tplSink(),
      ], [{ slotId: 'slot-count', targetNodeId: 'node-limit', kind: 'count', required: true }]),
      { 'slot-source': GENERATE, 'slot-count': 3 },
    )
    expect(distinctResult.ok).toBe(false)
    if (!distinctResult.ok) expect(distinctResult.issues[0]?.code).toBe('UNSAFE_BOUNDEDNESS')
    // dropWhile-before-limit（ordered iterate2でも構造保証はできない）
    const dropResult = instantiateCustom(
      generateTemplate([
        tplSrc('source.iterate2'),
        { nodeId: 'node-drop', operationId: 'dropWhile', role: 'intermediate', slotId: 'slot-predicate-1' },
        { nodeId: 'node-limit', operationId: 'limit', role: 'intermediate', slotId: 'slot-count' },
        tplSink(),
      ], [
        {
          slotId: 'slot-predicate-1',
          targetNodeId: 'node-drop',
          kind: 'predicate',
          required: true,
          allowedFields: [],
          allowedOperators: ['LT'],
        },
        { slotId: 'slot-count', targetNodeId: 'node-limit', kind: 'count', required: true },
      ]),
      {
        'slot-source': ITERATE2,
        'slot-predicate-1': { kind: 'currentValueCompare', operator: 'LT', value: { type: 'int', value: 3 } },
        'slot-count': 3,
      },
    )
    expect(dropResult.ok).toBe(false)
    if (!dropResult.ok) expect(dropResult.issues[0]?.code).toBe('UNSAFE_BOUNDEDNESS')
    // 解析関数レベル: filter / flatMap / takeWhileも保証不能として拒否
    for (const operationId of ['filter', 'flatMap', 'takeWhile']) {
      const result = analyzeBoundedness(GENERATE, 'infinite', [
        { operationId, count: null },
        { operationId: 'limit', count: 3 },
      ])
      expect(result.ok, operationId).toBe(false)
      if (!result.ok) expect(result.issues[0]?.code).toBe('UNSAFE_BOUNDEDNESS')
    }
  })

  it('P3-D11: iterate2の候補値がJava int範囲を超える場合は拒否する', () => {
    const result = analyzeBoundedness(
      { kind: 'iterate2', seed: 2_147_483_640, operator: { ruleId: 'increment', step: 1 } },
      'infinite',
      [{ operationId: 'limit', count: 20 }],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.code).toBe('TYPE_MISMATCH')
  })
})
