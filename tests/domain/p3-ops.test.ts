import { describe, expect, it } from 'vitest'
import { makeDefinition, runAllSnapshots } from '../helpers'
import {
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
import { STANDARD_EMPLOYEES } from '../../src/domain/fixtures/employees'

/** P3-D12〜P3-D24: 操作別Step Engine / snapshot契約（Phase 3指示 §7） */

function sortedIntTemplate(op: 'sorted' | 'distinct', primitive: 'int' | 'long' | 'double'): PipelineTemplate {
  return {
    templateId: `tmpl-test-${op}-${primitive}`,
    version: 1,
    targetOperationId: op,
    targetNodeId: `node-${op}`,
    title: 'test',
    sourceDefinition: { slotId: 'slot-source', defaultDsl: null, allowedSourceKinds: ['arrayPrimitive'] },
    nodes: [
      tplSrc('source.arraysStream'),
      { nodeId: `node-${op}`, operationId: op, role: 'intermediate', slotId: null },
      { nodeId: 'node-boxed', operationId: 'boxed', role: 'intermediate', slotId: null },
      tplSink(),
    ],
    parameterSlots: [],
    allowedDslProfile: { predicateKinds: [] },
    supportedModes: ['standard', 'emptySource'],
    jdkNotes: [],
    snapshotBudget: { limit: 500, estimatedMax: 60 },
  }
}

describe('P3-D12 distinct基本', () => {
  it('P3-D12: 初登場 / 重複、seen更新、通過 / 除外、出力順が正しい', () => {
    const def = makeDefinition('tmpl-distinct')
    const snapshots = runAllSnapshots(def)
    const last = snapshots[snapshots.length - 1]!
    expect(last.output.items.map((i) => i.label)).toEqual(['"Java"', '"SQL"', '"Git"'])
    // 必須snapshot: NODE_ARRIVAL → DISTINCT_CHECKED →（初登場時）DISTINCT_SEEN_UPDATED
    const checked = snapshots.filter((s) => s.kind === 'DISTINCT_CHECKED')
    expect(checked).toHaveLength(5)
    const seenUpdated = snapshots.filter((s) => s.kind === 'DISTINCT_SEEN_UPDATED')
    expect(seenUpdated).toHaveLength(3)
    // verdictの列: FIRST, FIRST, DUPLICATE, FIRST, DUPLICATE
    const verdicts = checked.map((s) => {
      const ctx = s.operationContexts['node-distinct']
      return ctx?.kind === 'distinct' ? ctx.verdict : null
    })
    expect(verdicts).toEqual(['FIRST', 'FIRST', 'DUPLICATE', 'FIRST', 'DUPLICATE'])
    // seenは1 → 2 → 2 → 3 → 3件と増える（重複では増えない）
    const seenCounts = checked.map((s) => {
      const ctx = s.operationContexts['node-distinct']
      return ctx?.kind === 'distinct' ? ctx.seen.length : -1
    })
    expect(seenCounts).toEqual([0, 1, 2, 2, 3])
    // 通過 / 除外の最終状態
    expect(last.elementLatestStates['of-001']).toBe('PASSED')
    expect(last.elementLatestStates['of-002']).toBe('PASSED')
    expect(last.elementLatestStates['of-003']).toBe('REJECTED')
    expect(last.elementLatestStates['of-004']).toBe('PASSED')
    expect(last.elementLatestStates['of-005']).toBe('REJECTED')
  })
})

describe('P3-D13 distinct型・安定性', () => {
  it('P3-D13: 同じ表示値でもelement IDを区別し、ordered先頭を保持する', () => {
    const def = makeDefinition('tmpl-distinct')
    const last = finalSnapshot(def)
    // "Java"は2要素あるが、encounter orderで最初のof-001だけが残る
    expect(last.output.items.map((i) => i.id)).toEqual(['of-001', 'of-002', 'of-004'])
    expect(last.elementLatestStates['of-001']).toBe('PASSED')
    expect(last.elementLatestStates['of-003']).toBe('REJECTED')
  })

  it('P3-D13: primitive / wrapper代表型のdistinctが正しい（Double.compare等価）', () => {
    const intDef = makeCustomDefinition(sortedIntTemplate('distinct', 'int'), {
      'slot-source': intArraySource([3, 1, 3]),
    })
    expect(finalSnapshot(intDef).output.items.map((i) => i.label)).toEqual(['3', '1'])
    const doubleDef = makeCustomDefinition(sortedIntTemplate('distinct', 'double'), {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'double', values: [2.5, 1.5, 2.5] },
    })
    expect(finalSnapshot(doubleDef).output.items.map((i) => i.label)).toEqual(['2.5', '1.5'])
  })
})

describe('P3-D14 sorted natural', () => {
  it('P3-D14: Stringを自然順序にし、型を維持する', () => {
    const def = makeDefinition('tmpl-sorted-natural')
    expect(finalSnapshot(def).output.items.map((i) => i.label)).toEqual(['"API"', '"Git"', '"Java"', '"SQL"'])
  })

  it('P3-D14: Int / Long / DoubleStreamの代表値を自然順にし、primitive Stream型を維持する', () => {
    const intDef = makeCustomDefinition(sortedIntTemplate('sorted', 'int'), {
      'slot-source': intArraySource([3, 1, 2]),
    })
    expect(finalSnapshot(intDef).output.items.map((i) => i.label)).toEqual(['1', '2', '3'])
    const longDef = makeCustomDefinition(sortedIntTemplate('sorted', 'long'), {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'long', values: [30, 10, 20] },
    })
    expect(finalSnapshot(longDef).output.items.map((i) => i.label)).toEqual(['10L', '20L', '30L'])
    const doubleDef = makeCustomDefinition(sortedIntTemplate('sorted', 'double'), {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'double', values: [2.5, 1.5, 3.5] },
    })
    expect(finalSnapshot(doubleDef).output.items.map((i) => i.label)).toEqual(['1.5', '2.5', '3.5'])
  })
})

describe('P3-D15 sorted Comparator', () => {
  it('P3-D15: region ASCの評価・キー表示・Javaコードが一致する', () => {
    const def = makeDefinition('tmpl-sorted-comparator')
    const last = finalSnapshot(def)
    expect(last.output.items.map((i) => i.label)).toEqual([
      '田中（age=29）',
      '佐藤（age=35）',
      '高橋（age=42）',
      '鈴木（age=27）',
    ])
    const ctx = last.operationContexts['node-sorted']
    expect(ctx?.kind).toBe('sorted')
    if (ctx?.kind === 'sorted') {
      expect(ctx.comparatorLabel).toBe('Comparator.comparing(Employee::region)')
      expect(ctx.bufferOrder[0]?.keyLabel).toBe('region="関東"')
    }
    expect(def.javaCode.map((l) => l.text).join('\n')).toContain(
      '.sorted(Comparator.comparing(Employee::region))',
    )
  })

  it('P3-D15: field DESC・複合キーの評価とJavaコードが一致する', () => {
    // 単一キーDESC・複合キーの評価検証用。§9の同値キー教材制約は基準template
    // （tmpl-sorted-comparator）で検証済みのため、ここではtargetを終端にして対象外とする
    const template: PipelineTemplate = {
      templateId: 'tmpl-test-sorted-desc',
      version: 1,
      targetOperationId: 'toList',
      targetNodeId: 'node-sink',
      title: 'test',
      sourceDefinition: {
        slotId: null,
        defaultDsl: { kind: 'collection', collectionId: 'employees' },
        allowedSourceKinds: ['collection'],
      },
      nodes: [
        { nodeId: 'node-src', operationId: 'source.collectionStream', role: 'source', slotId: null },
        { nodeId: 'node-sorted', operationId: 'sorted', role: 'intermediate', slotId: 'slot-comparator' },
        tplSink(),
      ],
      parameterSlots: [
        {
          slotId: 'slot-comparator',
          targetNodeId: 'node-sorted',
          kind: 'comparator',
          required: true,
          allowedComparatorKinds: ['employeeKeys'],
          allowedFields: ['age', 'salary', 'region'],
        },
      ],
      allowedDslProfile: { predicateKinds: [] },
      supportedModes: ['standard'],
      jdkNotes: [],
      snapshotBudget: { limit: 500, estimatedMax: 40 },
    }
    const descDef = makeCustomDefinition(
      template,
      { 'slot-comparator': { kind: 'employeeKeys', keys: [{ field: 'salary', direction: 'DESC' }] } },
      'standard',
      STANDARD_EMPLOYEES,
    )
    expect(finalSnapshot(descDef).output.items.map((i) => i.label.slice(0, 2))).toEqual([
      '高橋',
      '佐藤',
      '田中',
      '鈴木',
    ])
    expect(descDef.javaCode.map((l) => l.text).join('\n')).toContain(
      '.sorted(Comparator.comparingLong(Employee::salary).reversed())',
    )
    const compositeDef = makeCustomDefinition(
      template,
      {
        'slot-comparator': {
          kind: 'employeeKeys',
          keys: [
            { field: 'region', direction: 'ASC' },
            { field: 'age', direction: 'DESC' },
          ],
        },
      },
      'standard',
      STANDARD_EMPLOYEES,
    )
    // region ASC → 同region（関東）内はage DESC（高橋42 → 佐藤35）
    expect(finalSnapshot(compositeDef).output.items.map((i) => i.label.slice(0, 2))).toEqual([
      '田中',
      '高橋',
      '佐藤',
      '鈴木',
    ])
  })
})

describe('P3-D16 sorted J-2 invariant', () => {
  it('P3-D16: BUFFERED → ORDER_CONFIRMED → 1件放出、PROCESSING最大1件、確定時0件', () => {
    const def = makeDefinition('tmpl-sorted-natural')
    const snapshots = runAllSnapshots(def)
    // 全snapshotでPROCESSINGは最大1件
    for (const s of snapshots) {
      const processing = Object.values(s.elementLatestStates).filter((st) => st === 'PROCESSING')
      expect(processing.length, `#${s.index} ${s.kind}`).toBeLessThanOrEqual(1)
    }
    // SORT_ORDER_CONFIRMEDは1件だけ
    const confirmed = snapshots.filter((s) => s.kind === 'SORT_ORDER_CONFIRMED')
    expect(confirmed).toHaveLength(1)
    const confirmSnapshot = confirmed[0]!
    // 確定時: currentElementId === null、PROCESSING 0件
    expect(confirmSnapshot.currentElementId).toBeNull()
    expect(
      Object.values(confirmSnapshot.elementLatestStates).filter((st) => st === 'PROCESSING'),
    ).toHaveLength(0)
    // 最初のSORT_EMITTEDより前に全入力（4件）がbuffer済み
    const firstEmitIdx = snapshots.findIndex((s) => s.kind === 'SORT_EMITTED')
    const buffered = snapshots.filter((s, i) => s.kind === 'SORT_BUFFERED' && i < firstEmitIdx)
    expect(buffered).toHaveLength(4)
    // 並べ替え確定前の後段出力は0件
    const confirmIdx = snapshots.indexOf(confirmSnapshot)
    for (const s of snapshots.slice(0, confirmIdx + 1)) {
      expect(s.output.count, `#${s.index}`).toBe(0)
    }
    // 1回のSORT_EMITTEDで放出位置が1だけ進む
    const emitted = snapshots.filter((s) => s.kind === 'SORT_EMITTED')
    emitted.forEach((s, i) => {
      const ctx = s.operationContexts['node-sorted']
      expect(ctx?.kind).toBe('sorted')
      if (ctx?.kind === 'sorted') expect(ctx.emittedCount).toBe(i + 1)
    })
  })
})

describe('P3-D17 sorted境界', () => {
  it('P3-D17: 空Streamでも空bufferのSORT_ORDER_CONFIRMEDを1件生成する', () => {
    const def = makeDefinition('tmpl-sorted-natural', 'emptySource')
    const snapshots = runAllSnapshots(def)
    const confirmed = snapshots.filter((s) => s.kind === 'SORT_ORDER_CONFIRMED')
    expect(confirmed).toHaveLength(1)
    const ctx = confirmed[0]!.operationContexts['node-sorted']
    if (ctx?.kind === 'sorted') {
      expect(ctx.bufferOrder).toHaveLength(0)
      expect(ctx.confirmedOrder).toHaveLength(0)
    }
    expect(finalSnapshot(def).output.count).toBe(0)
    // 途中0件（filterで全件除外）でも空bufferの確定を1件生成する
    const midDef = makeDefinition('tmpl-sorted-midempty', 'midEmpty')
    const midSnapshots = runAllSnapshots(midDef)
    expect(midSnapshots.filter((s) => s.kind === 'SORT_ORDER_CONFIRMED')).toHaveLength(1)
  })

  it('P3-D17: 1件Streamでもbuffer → order confirmed → emitの構造を維持する', () => {
    const template: PipelineTemplate = {
      templateId: 'tmpl-test-sorted-single',
      version: 1,
      targetOperationId: 'sorted',
      targetNodeId: 'node-sorted',
      title: 'test',
      sourceDefinition: { slotId: 'slot-source', defaultDsl: null, allowedSourceKinds: ['streamOf'] },
      nodes: [
        tplSrc('source.streamOf'),
        { nodeId: 'node-sorted', operationId: 'sorted', role: 'intermediate', slotId: null },
        tplSink(),
      ],
      parameterSlots: [],
      allowedDslProfile: { predicateKinds: [] },
      supportedModes: ['midEmpty', 'standard', 'emptySource'],
      jdkNotes: [],
      snapshotBudget: { limit: 500, estimatedMax: 20 },
    }
    // 1件は「未整列」制約が意味を持たないため、教材制約の対象外モードで直接検証する
    const result = instantiateCustom(template, { 'slot-source': streamOfSource(['Java']) }, 'standard')
    // 1件入力は「事前整列済み」となるため標準モードの教材制約で拒否される
    expect(result.ok).toBe(false)
    // エンジン構造の検証はemptySource制約のないtemplate経由ではなく直接buffer構造を確認する
    const def = makeCustomDefinition(
      {
        ...template,
        templateId: 'tmpl-test-sorted-single2',
        targetNodeId: 'node-sink',
        targetOperationId: 'toList',
      },
      { 'slot-source': streamOfSource(['Java']) },
      'standard',
    )
    const snapshots = runAllSnapshots(def)
    const kinds = snapshots.map((s) => s.kind)
    expect(kinds).toContain('SORT_BUFFERED')
    expect(kinds).toContain('SORT_ORDER_CONFIRMED')
    expect(kinds).toContain('SORT_EMITTED')
    expect(kinds.indexOf('SORT_BUFFERED')).toBeLessThan(kinds.indexOf('SORT_ORDER_CONFIRMED'))
    expect(kinds.indexOf('SORT_ORDER_CONFIRMED')).toBeLessThan(kinds.indexOf('SORT_EMITTED'))
    expect(finalSnapshot(def).output.items.map((i) => i.label)).toEqual(['"Java"'])
  })

  it('P3-D17: ordered Streamの同値キーはencounter orderを維持し、unorderedでは保証を表示しない', () => {
    // ordered stable: 同region（関東）の佐藤（emp-001）が高橋（emp-003）より先
    const def = makeDefinition('tmpl-sorted-comparator')
    const last = finalSnapshot(def)
    expect(last.output.items.map((i) => i.id)).toEqual(['emp-004', 'emp-001', 'emp-003', 'emp-002'])
    const ctx = last.operationContexts['node-sorted']
    if (ctx?.kind === 'sorted') {
      expect(ctx.stableNote).toContain('encounter order')
    }
    // unordered（generate → limit → sorted）: stable保証を表示しない
    const unorderedTemplate: PipelineTemplate = {
      templateId: 'tmpl-test-gen-sorted',
      version: 1,
      targetOperationId: 'sorted',
      targetNodeId: 'node-sorted',
      title: 'test',
      sourceDefinition: { slotId: 'slot-source', defaultDsl: null, allowedSourceKinds: ['generate'] },
      nodes: [
        tplSrc('source.generate'),
        { nodeId: 'node-limit', operationId: 'limit', role: 'intermediate', slotId: 'slot-count' },
        { nodeId: 'node-sorted', operationId: 'sorted', role: 'intermediate', slotId: null },
        tplSink(),
      ],
      parameterSlots: [{ slotId: 'slot-count', targetNodeId: 'node-limit', kind: 'count', required: true }],
      allowedDslProfile: { predicateKinds: [] },
      supportedModes: ['standard'],
      jdkNotes: [],
      snapshotBudget: { limit: 500, estimatedMax: 40 },
    }
    const unorderedDef = makeCustomDefinition(unorderedTemplate, {
      'slot-source': { kind: 'generate', ruleId: 'supplier-counter' },
      'slot-count': 3,
    })
    const unorderedSnapshots = runAllSnapshots(unorderedDef)
    const confirmSnapshot = unorderedSnapshots.find((s) => s.kind === 'SORT_ORDER_CONFIRMED')!
    const unorderedCtx = confirmSnapshot.operationContexts['node-sorted']
    if (unorderedCtx?.kind === 'sorted') {
      expect(unorderedCtx.stableNote).toBeNull()
    }
    expect(confirmSnapshot.explanation.jdkNote).toContain('unordered')
  })
})

describe('P3-D18 limit基本', () => {
  it('P3-D18: 最初のN件だけ通し、n/Nを更新し、残りを未評価にする', () => {
    const def = makeDefinition('tmpl-limit')
    const snapshots = runAllSnapshots(def)
    const last = snapshots[snapshots.length - 1]!
    expect(last.output.items.map((i) => i.label)).toEqual(['1', '2', '3'])
    // n/Nの更新snapshot
    const counts = snapshots
      .filter((s) => s.kind === 'LIMIT_COUNT_UPDATED')
      .map((s) => {
        const ctx = s.operationContexts['node-limit']
        return ctx?.kind === 'limit' ? `${ctx.passedCount}/${ctx.maxSize}` : ''
      })
    expect(counts).toEqual(['1/3', '2/3', '3/3'])
    // 上限到達後の残りはREJECTEDではなくUNEVALUATED（§7.4）
    expect(last.elementLatestStates['n-004']).toBe('UNEVALUATED')
    expect(last.elementLatestStates['n-005']).toBe('UNEVALUATED')
    // source要求は3件だけ
    expect(snapshots.filter((s) => s.kind === 'SOURCE_EMIT')).toHaveLength(3)
  })
})

describe('P3-D19 limit境界', () => {
  it('P3-D19: limit(0)はsource要素を1件も要求せず、処理中0件で短絡を確定する', () => {
    const def = makeDefinition('tmpl-limit', 'midEmpty')
    const snapshots = runAllSnapshots(def)
    expect(snapshots.filter((s) => s.kind === 'SOURCE_EMIT')).toHaveLength(0)
    const sc = snapshots.find((s) => s.kind === 'SHORT_CIRCUIT_CONFIRMED')!
    expect(sc.currentElementId).toBeNull()
    expect(Object.values(sc.elementLatestStates).filter((st) => st === 'PROCESSING')).toHaveLength(0)
    expect(finalSnapshot(def).output.count).toBe(0)
  })

  it('P3-D19: N = source件数では全通過し、N > source件数では通常のupstream完了で終わる', () => {
    const equalTemplate: PipelineTemplate = {
      templateId: 'tmpl-test-limit-equal',
      version: 1,
      targetOperationId: 'toList',
      targetNodeId: 'node-sink',
      title: 'test',
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
    // N = source件数（3件 + limit(3)）: 全件通過し、最後の要素で上限到達
    const equalDef = makeCustomDefinition(equalTemplate, {
      'slot-source': { kind: 'rangeClosed', from: 1, to: 3 },
      'slot-count': 3,
    })
    const equalSnapshots = runAllSnapshots(equalDef)
    expect(finalSnapshot(equalDef).output.items.map((i) => i.label)).toEqual(['1', '2', '3'])
    expect(equalSnapshots.some((s) => s.kind === 'SHORT_CIRCUIT_CONFIRMED')).toBe(true)
    // N > source件数（2件 + limit(5)）: 短絡せず通常のupstream完了
    const overDef = makeCustomDefinition(
      { ...equalTemplate, templateId: 'tmpl-test-limit-over' },
      { 'slot-source': { kind: 'rangeClosed', from: 1, to: 2 }, 'slot-count': 5 },
    )
    const overSnapshots = runAllSnapshots(overDef)
    expect(finalSnapshot(overDef).output.items.map((i) => i.label)).toEqual(['1', '2'])
    expect(overSnapshots.some((s) => s.kind === 'SHORT_CIRCUIT_CONFIRMED')).toBe(false)
  })
})

describe('P3-D20 skip', () => {
  it('P3-D20: skip(0) / 一部 / 全件以上、count更新、残り通過、非短絡が正しい', () => {
    // 標準: skip(2) → [30, 40]、count更新 1/2 → 2/2
    const def = makeDefinition('tmpl-skip')
    const snapshots = runAllSnapshots(def)
    expect(finalSnapshot(def).output.items.map((i) => i.label)).toEqual(['30', '40'])
    const counts = snapshots
      .filter((s) => s.kind === 'SKIP_COUNT_UPDATED')
      .map((s) => {
        const ctx = s.operationContexts['node-skip']
        return ctx?.kind === 'skip' ? `${ctx.skippedCount}/${ctx.n}` : ''
      })
    expect(counts).toEqual(['1/2', '2/2'])
    // skip対象はREJECTED、以後はPredicateなしで通過
    const last = snapshots[snapshots.length - 1]!
    expect(last.elementLatestStates['numbers-001']).toBe('REJECTED')
    expect(last.elementLatestStates['numbers-002']).toBe('REJECTED')
    expect(last.elementLatestStates['numbers-003']).toBe('PASSED')
    // skipは短絡しない: 全4件がsourceから送出される
    expect(snapshots.filter((s) => s.kind === 'SOURCE_EMIT')).toHaveLength(4)
    expect(snapshots.some((s) => s.kind === 'SHORT_CIRCUIT_CONFIRMED')).toBe(false)
    // skip(0): 全件通過
    const zeroDef = makeCustomDefinition(
      {
        templateId: 'tmpl-test-skip0',
        version: 1,
        targetOperationId: 'toList',
        targetNodeId: 'node-sink',
        title: 'test',
        sourceDefinition: { slotId: 'slot-source', defaultDsl: null, allowedSourceKinds: ['arrayPrimitive'] },
        nodes: [
          tplSrc('source.arraysStream'),
          { nodeId: 'node-skip', operationId: 'skip', role: 'intermediate', slotId: 'slot-count' },
          { nodeId: 'node-boxed', operationId: 'boxed', role: 'intermediate', slotId: null },
          tplSink(),
        ],
        parameterSlots: [{ slotId: 'slot-count', targetNodeId: 'node-skip', kind: 'count', required: true }],
        allowedDslProfile: { predicateKinds: [] },
        supportedModes: ['standard'],
        jdkNotes: [],
        snapshotBudget: { limit: 500, estimatedMax: 40 },
      },
      { 'slot-source': intArraySource([10, 20]), 'slot-count': 0 },
    )
    expect(finalSnapshot(zeroDef).output.items.map((i) => i.label)).toEqual(['10', '20'])
    // n >= source件数: 結果は空
    const allDef = makeDefinition('tmpl-skip', 'midEmpty')
    expect(finalSnapshot(allDef).output.count).toBe(0)
  })
})

describe('P3-D21 takeWhile', () => {
  it('P3-D21: true prefix・最初のfalse・境界後未評価が正しい', () => {
    const def = makeDefinition('tmpl-takewhile')
    const snapshots = runAllSnapshots(def)
    const last = snapshots[snapshots.length - 1]!
    expect(last.output.items.map((i) => i.label)).toEqual(['1', '2'])
    // 6は評価されてfalseの境界要素（除外済み）、3・7は未評価
    expect(last.elementLatestStates['numbers-003']).toBe('REJECTED')
    expect(last.elementLatestStates['numbers-004']).toBe('UNEVALUATED')
    expect(last.elementLatestStates['numbers-005']).toBe('UNEVALUATED')
    // Predicate評価は3回だけ（1, 2, 6）
    expect(snapshots.filter((s) => s.kind === 'PREDICATE_EVALUATED')).toHaveLength(3)
    // 短絡確定と上流停止（source送出は3件だけ）
    expect(snapshots.some((s) => s.kind === 'SHORT_CIRCUIT_CONFIRMED')).toBe(true)
    expect(snapshots.filter((s) => s.kind === 'SOURCE_EMIT')).toHaveLength(3)
    const ctx = last.operationContexts['node-takewhile']
    if (ctx?.kind === 'takeWhile') {
      expect(ctx.stopped).toBe(true)
      expect(ctx.boundaryLabel).toBe('6')
    }
  })

  it('P3-D21: 最初からfalse・全件true・空を検証する', () => {
    // 最初からfalse: 結果は空、source送出は1件
    const firstFalseDef = makeDefinition('tmpl-takewhile', 'midEmpty')
    const firstFalseSnapshots = runAllSnapshots(firstFalseDef)
    expect(finalSnapshot(firstFalseDef).output.count).toBe(0)
    expect(firstFalseSnapshots.filter((s) => s.kind === 'SOURCE_EMIT')).toHaveLength(1)
    // 全件true: 短絡せず全件通過
    const allTrueDef = makeCustomDefinition(
      {
        templateId: 'tmpl-test-takewhile-alltrue',
        version: 1,
        targetOperationId: 'toList',
        targetNodeId: 'node-sink',
        title: 'test',
        sourceDefinition: { slotId: 'slot-source', defaultDsl: null, allowedSourceKinds: ['arrayPrimitive'] },
        nodes: [
          tplSrc('source.arraysStream'),
          { nodeId: 'node-takewhile', operationId: 'takeWhile', role: 'intermediate', slotId: 'slot-predicate-1' },
          { nodeId: 'node-boxed', operationId: 'boxed', role: 'intermediate', slotId: null },
          tplSink(),
        ],
        parameterSlots: [
          {
            slotId: 'slot-predicate-1',
            targetNodeId: 'node-takewhile',
            kind: 'predicate',
            required: true,
            allowedFields: [],
            allowedOperators: ['LT'],
          },
        ],
        allowedDslProfile: { predicateKinds: ['currentValueCompare'] },
        supportedModes: ['standard'],
        jdkNotes: [],
        snapshotBudget: { limit: 500, estimatedMax: 40 },
      },
      { 'slot-source': intArraySource([1, 2]), 'slot-predicate-1': lt(5) },
    )
    const allTrueSnapshots = runAllSnapshots(allTrueDef)
    expect(finalSnapshot(allTrueDef).output.items.map((i) => i.label)).toEqual(['1', '2'])
    expect(allTrueSnapshots.some((s) => s.kind === 'SHORT_CIRCUIT_CONFIRMED')).toBe(false)
    // 空: Predicate評価は0回
    const emptyDef = makeDefinition('tmpl-takewhile', 'emptySource')
    expect(runAllSnapshots(emptyDef).filter((s) => s.kind === 'PREDICATE_EVALUATED')).toHaveLength(0)
  })

  it('P3-D21: unordered source候補は実行可能Pipelineとして受理しない', () => {
    const result = instantiateCustom(
      {
        templateId: 'tmpl-test-takewhile-unordered',
        version: 1,
        targetOperationId: 'takeWhile',
        targetNodeId: 'node-takewhile',
        title: 'test',
        sourceDefinition: { slotId: 'slot-source', defaultDsl: null, allowedSourceKinds: ['generate'] },
        nodes: [
          tplSrc('source.generate'),
          { nodeId: 'node-limit', operationId: 'limit', role: 'intermediate', slotId: 'slot-count' },
          { nodeId: 'node-takewhile', operationId: 'takeWhile', role: 'intermediate', slotId: 'slot-predicate-1' },
          tplSink(),
        ],
        parameterSlots: [
          { slotId: 'slot-count', targetNodeId: 'node-limit', kind: 'count', required: true },
          {
            slotId: 'slot-predicate-1',
            targetNodeId: 'node-takewhile',
            kind: 'predicate',
            required: true,
            allowedFields: [],
            allowedOperators: ['LT'],
          },
        ],
        allowedDslProfile: { predicateKinds: ['currentValueCompare'] },
        supportedModes: ['standard'],
        jdkNotes: [],
        snapshotBudget: { limit: 500, estimatedMax: 40 },
      },
      { 'slot-source': { kind: 'generate', ruleId: 'supplier-counter' }, 'slot-count': 3, 'slot-predicate-1': lt(5) },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.code).toBe('UNORDERED_WHILE')
  })
})

describe('P3-D22 dropWhile', () => {
  it('P3-D22: drop prefix・通過モード・以後Predicate非評価が正しい', () => {
    const def = makeDefinition('tmpl-dropwhile')
    const snapshots = runAllSnapshots(def)
    const last = snapshots[snapshots.length - 1]!
    expect(last.output.items.map((i) => i.label)).toEqual(['6', '3', '7'])
    // 1・2はdrop（REJECTED）、6は境界要素として通過
    expect(last.elementLatestStates['numbers-001']).toBe('REJECTED')
    expect(last.elementLatestStates['numbers-002']).toBe('REJECTED')
    expect(last.elementLatestStates['numbers-003']).toBe('PASSED')
    // DROP_MODE_ENTEREDは境界要素6で1回だけ
    const entered = snapshots.filter((s) => s.kind === 'DROP_MODE_ENTERED')
    expect(entered).toHaveLength(1)
    expect(entered[0]?.currentElementId).toBe('numbers-003')
    // Predicate評価は3回だけ（1, 2, 6）。3・7（Predicateならtrue）は再評価しない
    expect(snapshots.filter((s) => s.kind === 'PREDICATE_EVALUATED')).toHaveLength(3)
    // dropWhileは短絡しない
    expect(snapshots.some((s) => s.kind === 'SHORT_CIRCUIT_CONFIRMED')).toBe(false)
    expect(snapshots.filter((s) => s.kind === 'SOURCE_EMIT')).toHaveLength(5)
  })

  it('P3-D22: 最初からfalse・全件true・空を検証する', () => {
    // 全件true: 結果は空
    const allTrueDef = makeDefinition('tmpl-dropwhile', 'midEmpty')
    expect(finalSnapshot(allTrueDef).output.count).toBe(0)
    // 最初からfalse: 全件通過
    const firstFalseDef = makeCustomDefinition(
      {
        templateId: 'tmpl-test-dropwhile-firstfalse',
        version: 1,
        targetOperationId: 'toList',
        targetNodeId: 'node-sink',
        title: 'test',
        sourceDefinition: { slotId: 'slot-source', defaultDsl: null, allowedSourceKinds: ['arrayPrimitive'] },
        nodes: [
          tplSrc('source.arraysStream'),
          { nodeId: 'node-dropwhile', operationId: 'dropWhile', role: 'intermediate', slotId: 'slot-predicate-1' },
          { nodeId: 'node-boxed', operationId: 'boxed', role: 'intermediate', slotId: null },
          tplSink(),
        ],
        parameterSlots: [
          {
            slotId: 'slot-predicate-1',
            targetNodeId: 'node-dropwhile',
            kind: 'predicate',
            required: true,
            allowedFields: [],
            allowedOperators: ['LT'],
          },
        ],
        allowedDslProfile: { predicateKinds: ['currentValueCompare'] },
        supportedModes: ['standard'],
        jdkNotes: [],
        snapshotBudget: { limit: 500, estimatedMax: 40 },
      },
      { 'slot-source': intArraySource([6, 1]), 'slot-predicate-1': lt(5) },
    )
    const snapshots = runAllSnapshots(firstFalseDef)
    expect(finalSnapshot(firstFalseDef).output.items.map((i) => i.label)).toEqual(['6', '1'])
    // 6でPASSINGモードへ入り、1はPredicateを評価されない
    expect(snapshots.filter((s) => s.kind === 'PREDICATE_EVALUATED')).toHaveLength(1)
    // 空
    const emptyDef = makeDefinition('tmpl-dropwhile', 'emptySource')
    expect(runAllSnapshots(emptyDef).filter((s) => s.kind === 'PREDICATE_EVALUATED')).toHaveLength(0)
  })
})

describe('P3-D23 peek', () => {
  it('P3-D23: action履歴・値 / 型不変・到着0件で0回が正しい', () => {
    const def = makeDefinition('tmpl-peek')
    const snapshots = runAllSnapshots(def)
    const last = snapshots[snapshots.length - 1]!
    // 値・型は不変（結果はEmployeeのList）
    expect(last.output.items.map((i) => i.label)).toEqual([
      '佐藤（age=35）',
      '鈴木（age=27）',
      '高橋（age=42）',
      '田中（age=29）',
    ])
    expect(last.output.resultTypeLabel).toBe('List<Employee>')
    // 履歴は4件、順序どおり
    expect(last.sideEffects.map((e) => e.message)).toEqual(['佐藤', '鈴木', '高橋', '田中'])
    expect(snapshots.filter((s) => s.kind === 'PEEK_ACTION_PERFORMED')).toHaveLength(4)
    // peek到着0件ではConsumer呼出し0回
    const midDef = makeDefinition('tmpl-peek-midempty', 'midEmpty')
    expect(finalSnapshot(midDef).sideEffects).toHaveLength(0)
    const emptyDef = makeDefinition('tmpl-peek', 'emptySource')
    expect(finalSnapshot(emptyDef).sideEffects).toHaveLength(0)
  })

  it('P3-D23: 短絡後の未評価要素についてSide Effectを追加しない', () => {
    const def = makeCustomDefinition(
      {
        templateId: 'tmpl-test-takewhile-peek',
        version: 1,
        targetOperationId: 'toList',
        targetNodeId: 'node-sink',
        title: 'test',
        sourceDefinition: { slotId: 'slot-source', defaultDsl: null, allowedSourceKinds: ['arrayPrimitive'] },
        nodes: [
          tplSrc('source.arraysStream'),
          { nodeId: 'node-takewhile', operationId: 'takeWhile', role: 'intermediate', slotId: 'slot-predicate-1' },
          { nodeId: 'node-peek', operationId: 'peek', role: 'intermediate', slotId: 'slot-consumer' },
          { nodeId: 'node-boxed', operationId: 'boxed', role: 'intermediate', slotId: null },
          tplSink(),
        ],
        parameterSlots: [
          {
            slotId: 'slot-predicate-1',
            targetNodeId: 'node-takewhile',
            kind: 'predicate',
            required: true,
            allowedFields: [],
            allowedOperators: ['LT'],
          },
          {
            slotId: 'slot-consumer',
            targetNodeId: 'node-peek',
            kind: 'consumer',
            required: true,
            allowedConsumerKinds: ['printValue'],
            allowedFields: [],
          },
        ],
        allowedDslProfile: { predicateKinds: ['currentValueCompare'] },
        supportedModes: ['standard'],
        jdkNotes: [],
        snapshotBudget: { limit: 500, estimatedMax: 40 },
      },
      {
        'slot-source': intArraySource([1, 6, 2]),
        'slot-predicate-1': lt(5),
        'slot-consumer': { kind: 'printValue' },
      },
    )
    const last = finalSnapshot(def)
    // takeWhileの短絡後、未評価の2に対するSide Effectは追加されない
    expect(last.sideEffects.map((e) => e.message)).toEqual(['1'])
    expect(last.elementLatestStates['numbers-003']).toBe('UNEVALUATED')
  })
})

describe('P3-D24 Side Effect履歴', () => {
  it('P3-D24: entryの安定ID・順序・node / element対応・不変性が正しい', () => {
    const def = makeDefinition('tmpl-peek')
    const snapshots = runAllSnapshots(def)
    const last = snapshots[snapshots.length - 1]!
    // seqは1始まりの連番で安定
    expect(last.sideEffects.map((e) => e.seq)).toEqual([1, 2, 3, 4])
    // node / element対応
    for (const entry of last.sideEffects) {
      expect(entry.nodeId).toBe('node-peek')
    }
    expect(last.sideEffects.map((e) => e.elementId)).toEqual(['emp-001', 'emp-002', 'emp-003', 'emp-004'])
    // 途中のsnapshotでは履歴がその時点までしかない
    const secondAction = snapshots.filter((s) => s.kind === 'PEEK_ACTION_PERFORMED')[1]!
    expect(secondAction.sideEffects).toHaveLength(2)
    expect(secondAction.sideEffects[1]?.seq).toBe(2)
    // 不変性: deep freeze済みで変更できない
    expect(Object.isFrozen(last.sideEffects)).toBe(true)
    expect(Object.isFrozen(last.sideEffects[0])).toBe(true)
  })
})
