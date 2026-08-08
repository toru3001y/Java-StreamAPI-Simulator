import { describe, expect, it } from 'vitest'
import { createDefaultTemplateRegistry } from '../../src/domain/template/templates'
import { makeDefinition, makeScenario, runAllSnapshots } from '../helpers'
import {
  assertProcessingAtMostOne,
  finalSnapshot,
  instantiateCustom,
  intArraySource,
  lt,
  makeCustomDefinition,
  streamOfSource,
  tplSink,
  tplSrc,
} from '../p3-helpers'
import type { PipelineTemplate } from '../../src/domain/template/pipelineTemplate'
import type { ScenarioMode } from '../../src/domain/scenario/scenario'
import { lineIdForNode } from '../../src/domain/types/ids'

/** P3-D25〜P3-D31: stateful合成・不変条件・決定性（Phase 3指示 §7.1・§10・§14） */

const P3_TEMPLATE_MODES: readonly { templateId: string; mode: ScenarioMode }[] = [
  { templateId: 'tmpl-distinct', mode: 'standard' },
  { templateId: 'tmpl-distinct', mode: 'emptySource' },
  { templateId: 'tmpl-distinct-midempty', mode: 'midEmpty' },
  { templateId: 'tmpl-sorted-natural', mode: 'standard' },
  { templateId: 'tmpl-sorted-natural', mode: 'emptySource' },
  { templateId: 'tmpl-sorted-midempty', mode: 'midEmpty' },
  { templateId: 'tmpl-sorted-comparator', mode: 'standard' },
  { templateId: 'tmpl-sorted-comparator', mode: 'emptySource' },
  { templateId: 'tmpl-limit', mode: 'standard' },
  { templateId: 'tmpl-limit', mode: 'midEmpty' },
  { templateId: 'tmpl-limit', mode: 'emptySource' },
  { templateId: 'tmpl-limit-generate', mode: 'standard' },
  { templateId: 'tmpl-limit-iterate2', mode: 'standard' },
  { templateId: 'tmpl-skip', mode: 'standard' },
  { templateId: 'tmpl-skip', mode: 'midEmpty' },
  { templateId: 'tmpl-skip', mode: 'emptySource' },
  { templateId: 'tmpl-takewhile', mode: 'standard' },
  { templateId: 'tmpl-takewhile', mode: 'midEmpty' },
  { templateId: 'tmpl-takewhile', mode: 'emptySource' },
  { templateId: 'tmpl-dropwhile', mode: 'standard' },
  { templateId: 'tmpl-dropwhile', mode: 'midEmpty' },
  { templateId: 'tmpl-dropwhile', mode: 'emptySource' },
  { templateId: 'tmpl-peek', mode: 'standard' },
  { templateId: 'tmpl-peek', mode: 'emptySource' },
  { templateId: 'tmpl-peek-midempty', mode: 'midEmpty' },
]

function compositionTemplate(
  templateId: string,
  intermediates: PipelineTemplate['nodes'],
  slots: PipelineTemplate['parameterSlots'],
  sourceKinds: readonly string[],
): PipelineTemplate {
  return {
    templateId,
    version: 1,
    targetOperationId: 'toList',
    targetNodeId: 'node-sink',
    title: 'composition test',
    sourceDefinition: { slotId: 'slot-source', defaultDsl: null, allowedSourceKinds: sourceKinds },
    nodes: [tplSrc(sourceKinds[0] === 'streamOf' ? 'source.streamOf' : 'source.arraysStream'), ...intermediates, tplSink()],
    parameterSlots: slots,
    allowedDslProfile: { predicateKinds: ['currentValueCompare'] },
    supportedModes: ['standard'],
    jdkNotes: [],
    snapshotBudget: { limit: 500, estimatedMax: 100 },
  }
}

const countSlot = (targetNodeId: string) =>
  ({ slotId: 'slot-count', targetNodeId, kind: 'count', required: true }) as const

describe('P3-D25 stateful合成', () => {
  it('P3-D25: distinct → sortedが正しい', () => {
    const def = makeCustomDefinition(
      compositionTemplate(
        'tmpl-test-distinct-sorted',
        [
          { nodeId: 'node-distinct', operationId: 'distinct', role: 'intermediate', slotId: null },
          { nodeId: 'node-sorted', operationId: 'sorted', role: 'intermediate', slotId: null },
        ],
        [],
        ['streamOf'],
      ),
      { 'slot-source': streamOfSource(['B', 'A', 'B']) },
    )
    expect(finalSnapshot(def).output.items.map((i) => i.label)).toEqual(['"A"', '"B"'])
  })

  it('P3-D25: sorted → limitが正しい（確定順序の先頭N件で短絡）', () => {
    const def = makeCustomDefinition(
      compositionTemplate(
        'tmpl-test-sorted-limit',
        [
          { nodeId: 'node-sorted', operationId: 'sorted', role: 'intermediate', slotId: null },
          { nodeId: 'node-limit', operationId: 'limit', role: 'intermediate', slotId: 'slot-count' },
        ],
        [countSlot('node-limit')],
        ['streamOf'],
      ),
      { 'slot-source': streamOfSource(['C', 'A', 'B']), 'slot-count': 2 },
    )
    const snapshots = runAllSnapshots(def)
    expect(finalSnapshot(def).output.items.map((i) => i.label)).toEqual(['"A"', '"B"'])
    // limitの短絡後、sortedは残りのbuffer要素（"C"）を放出しない
    expect(snapshots.filter((s) => s.kind === 'SORT_EMITTED')).toHaveLength(2)
    expect(snapshots.some((s) => s.kind === 'SHORT_CIRCUIT_CONFIRMED')).toBe(true)
    const last = finalSnapshot(def)
    expect(last.elementLatestStates['of-001']).toBe('BUFFERED')
  })

  it('P3-D25: limit → sortedが正しい（上流停止後にflush）', () => {
    const def = makeCustomDefinition(
      compositionTemplate(
        'tmpl-test-limit-sorted',
        [
          { nodeId: 'node-limit', operationId: 'limit', role: 'intermediate', slotId: 'slot-count' },
          { nodeId: 'node-sorted', operationId: 'sorted', role: 'intermediate', slotId: null },
        ],
        [countSlot('node-limit')],
        ['streamOf'],
      ),
      { 'slot-source': streamOfSource(['C', 'A', 'B']), 'slot-count': 2 },
    )
    const snapshots = runAllSnapshots(def)
    // 最初の2件（C, A）だけがlimitを通過し、sortedが[A, C]へ並べ替える
    expect(finalSnapshot(def).output.items.map((i) => i.label)).toEqual(['"A"', '"C"'])
    expect(snapshots.filter((s) => s.kind === 'SOURCE_EMIT')).toHaveLength(2)
    // Bは要求されず未評価のまま
    expect(finalSnapshot(def).elementLatestStates['of-003']).toBe('UNEVALUATED')
  })

  it('P3-D25: skip → takeWhileが正しい', () => {
    const def = makeCustomDefinition(
      compositionTemplate(
        'tmpl-test-skip-takewhile',
        [
          { nodeId: 'node-skip', operationId: 'skip', role: 'intermediate', slotId: 'slot-count' },
          { nodeId: 'node-takewhile', operationId: 'takeWhile', role: 'intermediate', slotId: 'slot-predicate-1' },
          { nodeId: 'node-boxed', operationId: 'boxed', role: 'intermediate', slotId: null },
        ],
        [
          countSlot('node-skip'),
          {
            slotId: 'slot-predicate-1',
            targetNodeId: 'node-takewhile',
            kind: 'predicate',
            required: true,
            allowedFields: [],
            allowedOperators: ['LT'],
          },
        ],
        ['arrayPrimitive'],
      ),
      { 'slot-source': intArraySource([9, 1, 2, 6, 3]), 'slot-count': 1, 'slot-predicate-1': lt(5) },
    )
    const snapshots = runAllSnapshots(def)
    // 9はskip、1・2はtrueで通過、6が境界、3は未評価
    expect(finalSnapshot(def).output.items.map((i) => i.label)).toEqual(['1', '2'])
    expect(finalSnapshot(def).elementLatestStates['numbers-001']).toBe('REJECTED')
    expect(finalSnapshot(def).elementLatestStates['numbers-005']).toBe('UNEVALUATED')
    expect(snapshots.filter((s) => s.kind === 'SOURCE_EMIT')).toHaveLength(4)
  })
})

describe('P3-D26 finish / cancel伝播', () => {
  it('P3-D26: sorted flushが後段（boxed等）まで流れ切る', () => {
    const def = makeCustomDefinition(
      compositionTemplate(
        'tmpl-test-sorted-flush',
        [
          { nodeId: 'node-sorted', operationId: 'sorted', role: 'intermediate', slotId: null },
          { nodeId: 'node-boxed', operationId: 'boxed', role: 'intermediate', slotId: null },
        ],
        [],
        ['arrayPrimitive'],
      ),
      { 'slot-source': intArraySource([3, 1, 2]) },
    )
    const snapshots = runAllSnapshots(def)
    // 各SORT_EMITTEDの後にboxedのMAPPING_APPLIEDとSINK_APPENDEDが続く（depth-first）
    const kinds = snapshots.map((s) => s.kind)
    const firstEmit = kinds.indexOf('SORT_EMITTED')
    expect(kinds[firstEmit + 1]).toBe('NODE_ARRIVAL')
    expect(kinds.slice(firstEmit, firstEmit + 5)).toContain('SINK_APPENDED')
    expect(finalSnapshot(def).output.items.map((i) => i.label)).toEqual(['1', '2', '3'])
  })

  it('P3-D26: limit / takeWhileのupstream停止が後段まで正しく伝播する', () => {
    // takeWhile境界後、後段のboxed・toListへ追加評価が流れない
    const def = makeDefinition('tmpl-takewhile')
    const snapshots = runAllSnapshots(def)
    const scIdx = snapshots.findIndex((s) => s.kind === 'SHORT_CIRCUIT_CONFIRMED')
    expect(scIdx).toBeGreaterThan(0)
    const after = snapshots.slice(scIdx + 1)
    // 短絡確定後は結果確定と消費だけ
    expect(after.map((s) => s.kind)).toEqual(['RESULT_CONFIRMED', 'STREAM_CONSUMED'])
  })
})

describe('P3-D27 short-circuit不変条件', () => {
  it('P3-D27: 確定後にsource / mapper / peek snapshotがなく、残りがUNEVALUATED', () => {
    for (const templateId of ['tmpl-limit', 'tmpl-takewhile', 'tmpl-limit-generate']) {
      const def = makeDefinition(templateId)
      const snapshots = runAllSnapshots(def)
      const scIdx = snapshots.findIndex((s) => s.kind === 'SHORT_CIRCUIT_CONFIRMED')
      expect(scIdx, templateId).toBeGreaterThan(0)
      const forbidden = ['SOURCE_EMIT', 'SOURCE_CANDIDATE', 'PREDICATE_EVALUATED', 'MAPPING_APPLIED', 'PEEK_ACTION_PERFORMED', 'NODE_ARRIVAL']
      for (const s of snapshots.slice(scIdx + 1)) {
        expect(forbidden, `${templateId}#${s.index}`).not.toContain(s.kind)
      }
      // 有限sourceでは残り要素がUNEVALUATEDのまま
      const last = snapshots[snapshots.length - 1]!
      if (templateId === 'tmpl-limit') {
        expect(last.elementLatestStates['n-004']).toBe('UNEVALUATED')
        expect(last.elementLatestStates['n-005']).toBe('UNEVALUATED')
      }
    }
  })
})

describe('P3-D28 PROCESSING不変条件', () => {
  it('P3-D28: 全Phase 3 templateの全snapshotでPROCESSINGが0または1件', () => {
    for (const { templateId, mode } of P3_TEMPLATE_MODES) {
      const def = makeDefinition(templateId, mode)
      const snapshots = runAllSnapshots(def)
      assertProcessingAtMostOne(snapshots, `${templateId}:${mode}`)
    }
  })
})

describe('P3-D29 snapshot同期', () => {
  it('P3-D29: active node・line ID・操作context・要素状態・出力が同一時点を表す', () => {
    for (const { templateId, mode } of P3_TEMPLATE_MODES) {
      const def = makeDefinition(templateId, mode)
      const snapshots = runAllSnapshots(def)
      const nodeIds = new Set(def.nodes.map((n) => n.nodeId))
      for (const s of snapshots) {
        // active nodeとline IDの同期
        if (s.activeNodeId !== null) {
          expect(nodeIds.has(s.activeNodeId), `${templateId}#${s.index}`).toBe(true)
          expect(s.activeLineId, `${templateId}#${s.index}`).toBe(lineIdForNode(s.activeNodeId))
        }
        // 操作contextのnodeIdはPipelineのnodeと一致
        for (const [nodeId, ctx] of Object.entries(s.operationContexts)) {
          expect(nodeIds.has(nodeId), `${templateId}#${s.index}`).toBe(true)
          expect(ctx.nodeId).toBe(nodeId)
        }
        // 出力件数とitems件数の一致
        expect(s.output.count).toBe(s.output.items.length)
        // currentElementIdは登録済み要素
        if (s.currentElementId !== null) {
          expect(s.elementLatestStates[s.currentElementId], `${templateId}#${s.index}`).toBeDefined()
        }
      }
      // sortedのSORT_EMITTEDでは放出済み件数が出力件数以上（後段除外がない場合は一致）
      const emitted = snapshots.filter((s) => s.kind === 'SORT_EMITTED')
      for (const s of emitted) {
        const ctx = Object.values(s.operationContexts).find((c) => c.kind === 'sorted')
        if (ctx?.kind === 'sorted') {
          expect(ctx.emittedCount).toBeGreaterThanOrEqual(s.output.count)
        }
      }
    }
  })
})

describe('P3-D30 Template / 教材制約', () => {
  it('P3-D30: 同一target operationへ複数templateが登録され、3 modeが揃っている', () => {
    const registry = createDefaultTemplateRegistry()
    expect(registry.listByTargetOperation('sorted').length).toBeGreaterThanOrEqual(3)
    expect(registry.listByTargetOperation('distinct').length).toBeGreaterThanOrEqual(2)
    expect(registry.listByTargetOperation('peek').length).toBeGreaterThanOrEqual(2)
    // 各主対象操作について標準 / 途中0件 / 空ソースが（意味の成立する範囲で）揃う
    const modesFor = (operationId: string): Set<string> => {
      const modes = new Set<string>()
      for (const t of registry.listByTargetOperation(operationId)) {
        for (const m of t.supportedModes) modes.add(m)
      }
      return modes
    }
    for (const op of ['distinct', 'sorted', 'limit', 'skip', 'takeWhile', 'dropWhile', 'peek']) {
      const modes = modesFor(op)
      expect(modes.has('standard'), op).toBe(true)
      expect(modes.has('midEmpty'), op).toBe(true)
      expect(modes.has('emptySource'), op).toBe(true)
    }
  })

  it('P3-D30: 教材制約（重複・未整列・境界後値・limit超過入力）を機械検証する', () => {
    // distinct標準: 重複なし入力を拒否
    const registry = createDefaultTemplateRegistry()
    const distinctTemplate = registry.get('tmpl-distinct', 1)!
    const noDup = instantiateCustom(distinctTemplate, {
      'slot-source': streamOfSource(['A', 'B']),
    })
    expect(noDup.ok).toBe(false)
    if (!noDup.ok) expect(noDup.issues[0]?.code).toBe('TEACHING_CONSTRAINT')
    // sorted標準: 整列済み入力を拒否
    const sortedTemplate = registry.get('tmpl-sorted-natural', 1)!
    const preSorted = instantiateCustom(sortedTemplate, {
      'slot-source': streamOfSource(['A', 'B', 'C']),
    })
    expect(preSorted.ok).toBe(false)
    if (!preSorted.ok) expect(preSorted.issues[0]?.code).toBe('TEACHING_CONSTRAINT')
    // limit標準: 元要素数がlimit値以下の入力を拒否
    const limitTemplate = registry.get('tmpl-limit', 1)!
    const tooFew = instantiateCustom(limitTemplate, {
      'slot-source': { kind: 'rangeClosed', from: 1, to: 3 },
      'slot-count': 3,
    })
    expect(tooFew.ok).toBe(false)
    if (!tooFew.ok) expect(tooFew.issues[0]?.code).toBe('TEACHING_CONSTRAINT')
    // takeWhile標準: 最初のfalse後にtrueとなる値がない入力を拒否
    const takeTemplate = registry.get('tmpl-takewhile', 1)!
    const noTrueAfter = instantiateCustom(takeTemplate, {
      'slot-source': intArraySource([1, 2, 6]),
      'slot-predicate-1': lt(5),
    })
    expect(noTrueAfter.ok).toBe(false)
    if (!noTrueAfter.ok) expect(noTrueAfter.issues[0]?.code).toBe('TEACHING_CONSTRAINT')
    // dropWhile標準: 全件trueの入力を拒否
    const dropTemplate = registry.get('tmpl-dropwhile', 1)!
    const allTrue = instantiateCustom(dropTemplate, {
      'slot-source': intArraySource([1, 2, 3]),
      'slot-predicate-1': lt(5),
    })
    expect(allTrue.ok).toBe(false)
    if (!allTrue.ok) expect(allTrue.issues[0]?.code).toBe('TEACHING_CONSTRAINT')
    // sorted Comparator標準: 同値キーを持たない入力を拒否
    const comparatorTemplate = registry.get('tmpl-sorted-comparator', 1)!
    const uniqueKeys = instantiateCustom(
      comparatorTemplate,
      { 'slot-comparator': { kind: 'employeeKeys', keys: [{ field: 'name', direction: 'ASC' }] } },
      'standard',
      // 全name一意のためregionのような同値キーが存在しない
      [
        {
          elementId: 'emp-001',
          value: {
            name: 'Bob',
            age: 30,
            salary: 1,
            evaluation: 1,
            region: 'A',
            hireDate: '2020-01-01',
            department: { name: '開発部', division: '技術本部' },
            skills: [],
          },
        },
        {
          elementId: 'emp-002',
          value: {
            name: 'Alice',
            age: 31,
            salary: 2,
            evaluation: 2,
            region: 'B',
            hireDate: '2020-01-02',
            department: { name: '開発部', division: '技術本部' },
            skills: [],
          },
        },
      ],
    )
    expect(uniqueKeys.ok).toBe(false)
    if (!uniqueKeys.ok) expect(uniqueKeys.issues[0]?.code).toBe('TEACHING_CONSTRAINT')
  })
})

describe('P3-D31 決定性・予算・不変性', () => {
  it('P3-D31: 同revisionで同一snapshot列を生成し、全templateが500以内で、snapshotは不変', () => {
    for (const { templateId, mode } of P3_TEMPLATE_MODES) {
      const scenarioA = makeScenario(templateId, mode)
      const snapshotsA = runAllSnapshots(scenarioA.pipeline)
      // 事前実行のsnapshotCountと実測が一致し、500以内
      expect(scenarioA.pipeline.snapshotCount, `${templateId}:${mode}`).toBe(snapshotsA.length)
      expect(snapshotsA.length, `${templateId}:${mode}`).toBeLessThanOrEqual(500)
      // 構造的決定性: 同じtemplate + modeから再生成した列とkind / element / outputが一致
      const scenarioB = makeScenario(templateId, mode)
      const snapshotsB = runAllSnapshots(scenarioB.pipeline)
      expect(snapshotsB.length).toBe(snapshotsA.length)
      snapshotsA.forEach((a, i) => {
        const b = snapshotsB[i]!
        expect(b.kind, `${templateId}#${i}`).toBe(a.kind)
        expect(b.currentElementId).toBe(a.currentElementId)
        expect(b.activeNodeId).toBe(a.activeNodeId)
        expect(b.output.items).toEqual(a.output.items)
        expect(b.elementLatestStates).toEqual(a.elementLatestStates)
        expect(b.sideEffects.map((e) => e.seq)).toEqual(a.sideEffects.map((e) => e.seq))
      })
      // snapshot / 操作context / Side Effect履歴はdeep freeze済み
      const last = snapshotsA[snapshotsA.length - 1]!
      expect(Object.isFrozen(last)).toBe(true)
      expect(Object.isFrozen(last.operationContexts)).toBe(true)
      expect(Object.isFrozen(last.sideEffects)).toBe(true)
      for (const ctx of Object.values(last.operationContexts)) {
        expect(Object.isFrozen(ctx)).toBe(true)
      }
    }
  })
})
