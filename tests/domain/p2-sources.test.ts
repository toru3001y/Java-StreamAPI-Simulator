import { describe, expect, it } from 'vitest'
import { makeDefinition, runAllSnapshots } from '../helpers'
import { instantiateTemplate } from '../../src/domain/template/instantiate'
import { createDefaultTemplateRegistry } from '../../src/domain/template/templates'
import { createDefaultCatalog } from '../../src/domain/catalog/operations'
import { validateSourceStructure } from '../../src/domain/dsl/validateSource'
import { sourceToJavaExpr } from '../../src/domain/dsl/javaCode'
import { describeSource } from '../../src/domain/dsl/explanation'
import { formatTypeRef } from '../../src/domain/types/typeRef'

const registry = createDefaultTemplateRegistry()
const catalog = createDefaultCatalog()

describe('P2-D03 Collection.stream', () => {
  it('P2-D03: orderedに全要素を安定ID付きで送出する', () => {
    const def = makeDefinition('tmpl-src-collection', 'standard')
    expect(def.dataset.map((d) => d.elementId)).toEqual(['emp-001', 'emp-002', 'emp-003', 'emp-004'])
    const snapshots = runAllSnapshots(def)
    const emits = snapshots.filter((s) => s.kind === 'SOURCE_EMIT')
    expect(emits.map((s) => s.currentElementId)).toEqual([
      'emp-001',
      'emp-002',
      'emp-003',
      'emp-004',
    ])
    const last = snapshots[snapshots.length - 1]
    expect(last?.output.items.map((i) => i.label)).toEqual(['"佐藤"', '"鈴木"', '"高橋"', '"田中"'])
  })
})

describe('P2-D04 Arrays.stream', () => {
  it('P2-D04: object配列の型・index・順序が正しい', () => {
    const def = makeDefinition('tmpl-src-arrays-object', 'standard')
    const srcNode = def.nodes[0]
    expect(srcNode && formatTypeRef(srcNode.outputType)).toBe('Stream<String>')
    expect(def.dataset.map((d) => d.index)).toEqual([0, 1, 2])
    const snapshots = runAllSnapshots(def)
    const emits = snapshots.filter((s) => s.kind === 'SOURCE_EMIT')
    expect(emits.map((s) => s.sourceContext?.index)).toEqual([0, 1, 2])
    const last = snapshots[snapshots.length - 1]
    expect(last?.output.items.map((i) => i.label)).toEqual(['"JAVA"', '"SQL"', '"WEB"'])
  })

  it('P2-D04: int配列はIntStreamになり順序が保持される', () => {
    const def = makeDefinition('tmpl-src-arrays-int', 'standard')
    const srcNode = def.nodes[0]
    expect(srcNode && formatTypeRef(srcNode.outputType)).toBe('IntStream')
    const last = runAllSnapshots(def)[runAllSnapshots(def).length - 1]
    expect(last?.output.items.map((i) => i.label)).toEqual(['3', '1', '4'])
  })

  it('P2-D04: long/double配列はLong/DoubleStreamになる', () => {
    const longResult = instantiateTemplate(registry, catalog, {
      templateId: 'tmpl-src-arrays-int',
      templateVersion: 1,
      dataset: [],
      dslParameters: {
        'slot-source': { kind: 'arrayPrimitive', arrayId: 'values', primitive: 'long', values: [10, 20] },
      },
      mode: 'standard',
      revision: 'test-long',
    })
    expect(longResult.ok).toBe(true)
    if (longResult.ok) {
      expect(formatTypeRef(longResult.value.nodes[0]!.outputType)).toBe('LongStream')
      expect(formatTypeRef(longResult.value.resultType)).toBe('List<Long>')
    }
    const doubleResult = instantiateTemplate(registry, catalog, {
      templateId: 'tmpl-src-arrays-int',
      templateVersion: 1,
      dataset: [],
      dslParameters: {
        'slot-source': { kind: 'arrayPrimitive', arrayId: 'values', primitive: 'double', values: [1.5] },
      },
      mode: 'standard',
      revision: 'test-double',
    })
    expect(doubleResult.ok).toBe(true)
    if (doubleResult.ok) {
      expect(formatTypeRef(doubleResult.value.nodes[0]!.outputType)).toBe('DoubleStream')
      expect(formatTypeRef(doubleResult.value.resultType)).toBe('List<Double>')
    }
  })
})

describe('P2-D05 Stream.of', () => {
  it('P2-D05: 型付き引数を順に要素化する', () => {
    const def = makeDefinition('tmpl-src-of', 'standard')
    const snapshots = runAllSnapshots(def)
    const last = snapshots[snapshots.length - 1]
    expect(last?.output.items.map((i) => i.label)).toEqual(['"JAVA"', '"SQL"'])
    expect(def.javaCode.map((l) => l.text).join('\n')).toContain('Stream.of("Java", "SQL")')
  })

  it('P2-D05: templateが宣言したTypeRefと一致しない値を拒否する', () => {
    const structure = validateSourceStructure({
      kind: 'streamOf',
      elementTypeName: 'String',
      values: [1, 2],
    })
    expect(structure.ok).toBe(false)
    if (!structure.ok) expect(structure.issues[0]?.code).toBe('TYPE_MISMATCH')

    const viaInstantiate = instantiateTemplate(registry, catalog, {
      templateId: 'tmpl-src-of',
      templateVersion: 1,
      dataset: [],
      dslParameters: {
        'slot-source': { kind: 'streamOf', elementTypeName: 'String', values: [1] },
        'slot-mapper-1': { kind: 'toUpper' },
      },
      mode: 'standard',
      revision: 'test-of-bad',
    })
    expect(viaInstantiate.ok).toBe(false)
    if (!viaInstantiate.ok) expect(viaInstantiate.issues[0]?.code).toBe('TYPE_MISMATCH')
  })
})

describe('P2-D06 generate / iterate 2引数', () => {
  it('P2-D06: DSL・コード・説明は生成できる', () => {
    const generate = validateSourceStructure({ kind: 'generate', ruleId: 'supplier-counter' })
    expect(generate.ok).toBe(true)
    const iterate2 = validateSourceStructure({
      kind: 'iterate2',
      seed: 1,
      operator: { ruleId: 'increment', step: 1 },
    })
    expect(iterate2.ok).toBe(true)
    if (generate.ok && iterate2.ok) {
      expect(sourceToJavaExpr(generate.value)).toBe('Stream.generate(counter::incrementAndGet)')
      expect(sourceToJavaExpr(iterate2.value)).toBe('Stream.iterate(1, n -> n + 1)')
      expect(describeSource(generate.value)).toContain('無限')
      expect(describeSource(iterate2.value)).toContain('無限')
    }
  })

  it('P2-D06: 未知rule IDを拒否する', () => {
    const bad = validateSourceStructure({ kind: 'generate', ruleId: 'random' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.issues[0]?.code).toBe('STRUCTURE_UNKNOWN_KIND')
  })

  it('P2-D06: 有限化なし候補をPipelineDefinition生成前にUNBOUNDED_SOURCEとして拒否する', () => {
    for (const [templateId, source] of [
      ['tmpl-src-generate', { kind: 'generate', ruleId: 'supplier-counter' }],
      ['tmpl-src-iterate2', { kind: 'iterate2', seed: 1, operator: { ruleId: 'increment', step: 1 } }],
    ] as const) {
      const result = instantiateTemplate(registry, catalog, {
        templateId,
        templateVersion: 1,
        dataset: [],
        dslParameters: { 'slot-source': source },
        mode: 'standard',
        revision: 'test-unbounded',
      })
      expect(result.ok, templateId).toBe(false)
      if (!result.ok) expect(result.issues[0]?.code).toBe('UNBOUNDED_SOURCE')
    }
  })
})

describe('P2-D07 iterate 3引数', () => {
  it('P2-D07: seed→predicate→operatorの順で有限終了する', () => {
    const def = makeDefinition('tmpl-src-iterate3', 'standard')
    expect(def.iterateTrace?.map((c) => [c.value, c.passed])).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [4, true],
      [5, true],
      [6, false],
    ])
    const snapshots = runAllSnapshots(def)
    const kinds = snapshots.map((s) => s.kind)
    // 各候補: SOURCE_CANDIDATE → SOURCE_PREDICATE_EVALUATED →（trueなら）SOURCE_EMIT → SINK_APPENDED
    expect(kinds.slice(0, 5)).toEqual([
      'INITIAL',
      'SOURCE_CANDIDATE',
      'SOURCE_PREDICATE_EVALUATED',
      'SOURCE_EMIT',
      'SINK_APPENDED',
    ])
    // 最後の候補6はfalseで生成終了し、要素処理なしで結果確定へ進む
    expect(kinds.slice(-4)).toEqual([
      'SOURCE_CANDIDATE',
      'SOURCE_PREDICATE_EVALUATED',
      'RESULT_CONFIRMED',
      'STREAM_CONSUMED',
    ])
    const last = snapshots[snapshots.length - 1]
    expect(last?.output.items.map((i) => i.label)).toEqual(['1', '2', '3', '4', '5'])
  })

  it('P2-D07: seedが即falseの場合は空ソースになる', () => {
    const def = makeDefinition('tmpl-src-iterate3', 'emptySource')
    expect(def.dataset).toHaveLength(0)
    const snapshots = runAllSnapshots(def)
    expect(snapshots.map((s) => s.kind)).toEqual([
      'INITIAL',
      'SOURCE_CANDIDATE',
      'SOURCE_PREDICATE_EVALUATED',
      'RESULT_CONFIRMED',
      'STREAM_CONSUMED',
    ])
    expect(snapshots[snapshots.length - 1]?.output.count).toBe(0)
  })
})

describe('P2-D08 range / rangeClosed', () => {
  it('P2-D08: rangeは半開区間で[1, 2, 3, 4]', () => {
    const def = makeDefinition('tmpl-src-range', 'standard')
    expect(def.nodes[0] && formatTypeRef(def.nodes[0].outputType)).toBe('IntStream')
    const last = runAllSnapshots(def).at(-1)
    expect(last?.output.items.map((i) => i.label)).toEqual(['1', '2', '3', '4'])
  })

  it('P2-D08: rangeClosedは閉区間で[1, 2, 3, 4, 5]', () => {
    const def = makeDefinition('tmpl-src-range-closed', 'standard')
    const last = runAllSnapshots(def).at(-1)
    expect(last?.output.items.map((i) => i.label)).toEqual(['1', '2', '3', '4', '5'])
  })

  it('P2-D08: 空範囲は要素を送出しない', () => {
    for (const templateId of ['tmpl-src-range', 'tmpl-src-range-closed'] as const) {
      const def = makeDefinition(templateId, 'emptySource')
      expect(def.dataset).toHaveLength(0)
      const snapshots = runAllSnapshots(def)
      expect(snapshots.map((s) => s.kind)).toEqual(['INITIAL', 'RESULT_CONFIRMED', 'STREAM_CONSUMED'])
    }
  })
})

describe('P2-D09 empty source', () => {
  it('P2-D09: object/int/long/doubleの空Stream型と空結果が正しい', () => {
    const cases = [
      ['tmpl-src-empty-object', 'Stream<String>', 'List<String>'],
      ['tmpl-src-empty-int', 'IntStream', 'List<Integer>'],
      ['tmpl-src-empty-long', 'LongStream', 'List<Long>'],
      ['tmpl-src-empty-double', 'DoubleStream', 'List<Double>'],
    ] as const
    for (const [templateId, streamType, resultType] of cases) {
      const def = makeDefinition(templateId, 'emptySource')
      expect(def.nodes[0] && formatTypeRef(def.nodes[0].outputType), templateId).toBe(streamType)
      expect(formatTypeRef(def.resultType), templateId).toBe(resultType)
      const last = runAllSnapshots(def).at(-1)
      expect(last?.output.count, templateId).toBe(0)
      expect(last?.output.confirmed, templateId).toBe(true)
    }
  })
})
