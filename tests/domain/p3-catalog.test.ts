import { describe, expect, it } from 'vitest'
import { createDefaultCatalog } from '../../src/domain/catalog/operations'
import { makeDefinition } from '../helpers'
import { instantiateCustom, makeCustomDefinition, tplSink, tplSrc, intArraySource } from '../p3-helpers'
import type { PipelineTemplate } from '../../src/domain/template/pipelineTemplate'
import { formatTypeRef } from '../../src/domain/types/typeRef'

/** P3-D01 / P3-D02: OperationCatalogと型・順序規則（Phase 3指示 §5） */
const catalog = createDefaultCatalog()

const EXPECTED = [
  { id: 'distinct', traits: ['INTERMEDIATE', 'STATEFUL'], kind: '状態保持型' },
  { id: 'sorted', traits: ['INTERMEDIATE', 'STATEFUL'], kind: '全体バッファ型' },
  { id: 'limit', traits: ['INTERMEDIATE', 'STATEFUL', 'SHORT_CIRCUITING'], kind: '位置・件数制御型' },
  { id: 'skip', traits: ['INTERMEDIATE', 'STATEFUL'], kind: '位置・件数制御型' },
  { id: 'takeWhile', traits: ['INTERMEDIATE', 'STATEFUL', 'SHORT_CIRCUITING'], kind: '境界判定型' },
  { id: 'dropWhile', traits: ['INTERMEDIATE', 'STATEFUL'], kind: '境界判定型' },
  { id: 'peek', traits: ['INTERMEDIATE', 'STATELESS'], kind: '観察型' },
] as const

describe('P3-D01 OperationCatalog', () => {
  it('P3-D01: 7操作のcategory・traits・handler・visualization・legend・JDK noteが正しい', () => {
    for (const expected of EXPECTED) {
      const def = catalog.get(expected.id)
      expect(def.category, expected.id).toBe('intermediate')
      expect([...def.traits], expected.id).toEqual([...expected.traits])
      expect(def.handlerId, expected.id).toBe(`handler.${expected.id}`)
      expect(def.visualizationKind, expected.id).toBe(expected.kind)
      expect(def.legendStates.length, expected.id).toBeGreaterThanOrEqual(3)
      expect(def.jdkNotes.length, expected.id).toBeGreaterThanOrEqual(1)
      expect(def.sourceRefs.length, expected.id).toBeGreaterThanOrEqual(1)
    }
    // dropWhileはStream全体を短絡終了しないためSHORT_CIRCUITINGを付けない（§5.1）
    expect(catalog.get('dropWhile').traits).not.toContain('SHORT_CIRCUITING')
    // sortedは全体バッファ型でBUFFERED状態を凡例に持つ
    expect(catalog.get('sorted').legendStates).toContain('BUFFERED')
    // limitは要素を除外しないため凡例にREJECTEDを持たない
    expect(catalog.get('limit').legendStates).not.toContain('REJECTED')
  })
})

describe('P3-D02 Type / order rules', () => {
  it('P3-D02: 7操作はobject / primitive両Streamを受理し入力型を維持する（anyStreamLike）', () => {
    for (const expected of EXPECTED) {
      const def = catalog.get(expected.id)
      expect(def.inputTypeRule.kind, expected.id).toBe('anyStreamLike')
      expect(def.outputTypeRule.kind, expected.id).toBe('identity')
    }
    // IntStream上のlimit / skip / takeWhile / dropWhileは型を維持する
    for (const templateId of ['tmpl-limit', 'tmpl-skip', 'tmpl-takewhile', 'tmpl-dropwhile']) {
      const def = makeDefinition(templateId)
      const target = def.nodes.find((n) => n.nodeId === def.targetNodeId)
      expect(target, templateId).toBeDefined()
      expect(formatTypeRef(target!.inputType!), templateId).toBe('IntStream')
      expect(formatTypeRef(target!.outputType), templateId).toBe('IntStream')
    }
    // Stream<String>上のdistinct / sortedも型を維持する
    for (const templateId of ['tmpl-distinct', 'tmpl-sorted-natural']) {
      const def = makeDefinition(templateId)
      const target = def.nodes.find((n) => n.nodeId === def.targetNodeId)
      expect(formatTypeRef(target!.outputType), templateId).toBe('Stream<String>')
    }
  })

  it('P3-D02: primitive Streamのsorted()は同じprimitive Stream型を維持する', () => {
    const template: PipelineTemplate = {
      templateId: 'tmpl-test-sorted-int',
      version: 1,
      targetOperationId: 'sorted',
      targetNodeId: 'node-sorted',
      title: 'test',
      sourceDefinition: { slotId: 'slot-source', defaultDsl: null, allowedSourceKinds: ['arrayPrimitive'] },
      nodes: [
        tplSrc('source.arraysStream'),
        { nodeId: 'node-sorted', operationId: 'sorted', role: 'intermediate', slotId: null },
        { nodeId: 'node-boxed', operationId: 'boxed', role: 'intermediate', slotId: null },
        tplSink(),
      ],
      parameterSlots: [],
      allowedDslProfile: { predicateKinds: [] },
      supportedModes: ['standard'],
      jdkNotes: [],
      snapshotBudget: { limit: 500, estimatedMax: 40 },
    }
    const def = makeCustomDefinition(template, { 'slot-source': intArraySource([3, 1, 2]) })
    const sorted = def.nodes.find((n) => n.nodeId === 'node-sorted')
    expect(formatTypeRef(sorted!.inputType!)).toBe('IntStream')
    expect(formatTypeRef(sorted!.outputType)).toBe('IntStream')
  })

  it('P3-D02: Stream<Employee>.sorted()はComparableではないためPipelineDefinition生成前に拒否する', () => {
    const template: PipelineTemplate = {
      templateId: 'tmpl-test-sorted-employee',
      version: 1,
      targetOperationId: 'sorted',
      targetNodeId: 'node-sorted',
      title: 'test',
      sourceDefinition: {
        slotId: null,
        defaultDsl: { kind: 'collection', collectionId: 'employees' },
        allowedSourceKinds: ['collection'],
      },
      nodes: [
        { nodeId: 'node-src', operationId: 'source.collectionStream', role: 'source', slotId: null },
        { nodeId: 'node-sorted', operationId: 'sorted', role: 'intermediate', slotId: null },
        tplSink(),
      ],
      parameterSlots: [],
      allowedDslProfile: { predicateKinds: [] },
      supportedModes: ['standard'],
      jdkNotes: [],
      snapshotBudget: { limit: 500, estimatedMax: 40 },
    }
    const result = instantiateCustom(template, {}, 'standard', [
      {
        elementId: 'emp-001',
        value: {
          name: '佐藤',
          age: 35,
          salary: 5_500_000,
          evaluation: 4.2,
          region: '関東',
          hireDate: '2022-04-01',
          department: { name: '開発部', division: '技術本部' },
          skills: ['Java'],
        },
      },
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe('TYPE_MISMATCH')
      expect(result.issues[0]?.message).toContain('Comparable')
    }
  })

  it('P3-D02: Comparatorをprimitive Streamへ指定する候補は拒否する', () => {
    const template: PipelineTemplate = {
      templateId: 'tmpl-test-sorted-int-comparator',
      version: 1,
      targetOperationId: 'sorted',
      targetNodeId: 'node-sorted',
      title: 'test',
      sourceDefinition: { slotId: 'slot-source', defaultDsl: null, allowedSourceKinds: ['arrayPrimitive'] },
      nodes: [
        tplSrc('source.arraysStream'),
        { nodeId: 'node-sorted', operationId: 'sorted', role: 'intermediate', slotId: 'slot-comparator' },
        { nodeId: 'node-boxed', operationId: 'boxed', role: 'intermediate', slotId: null },
        tplSink(),
      ],
      parameterSlots: [
        {
          slotId: 'slot-comparator',
          targetNodeId: 'node-sorted',
          kind: 'comparator',
          required: true,
          allowedComparatorKinds: ['natural', 'employeeKeys'],
          allowedFields: ['region'],
        },
      ],
      allowedDslProfile: { predicateKinds: [] },
      supportedModes: ['standard'],
      jdkNotes: [],
      snapshotBudget: { limit: 500, estimatedMax: 40 },
    }
    const result = instantiateCustom(template, {
      'slot-source': intArraySource([3, 1, 2]),
      'slot-comparator': { kind: 'natural' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe('TYPE_MISMATCH')
      expect(result.issues[0]?.message).toContain('primitive Stream')
    }
  })

  it('P3-D02: ordered / unorderedメタデータが正しい', () => {
    // collection / arrayPrimitive sourceはordered
    expect(makeDefinition('tmpl-sorted-comparator').orderMeta.sourceOrdered).toBe(true)
    expect(makeDefinition('tmpl-takewhile').orderMeta.sourceOrdered).toBe(true)
    // generateはunordered、iterate2はordered（いずれもsourceは無限のまま）
    const gen = makeDefinition('tmpl-limit-generate')
    expect(gen.orderMeta.sourceOrdered).toBe(false)
    expect(gen.orderMeta.resultOrdered).toBe(false)
    const it2 = makeDefinition('tmpl-limit-iterate2')
    expect(it2.orderMeta.sourceOrdered).toBe(true)
  })
})
