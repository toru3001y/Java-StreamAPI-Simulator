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

  it('P2-D04: long配列templateの型・index・順序・コード・boxed後結果が正しい（レビュー対応）', () => {
    const def = makeDefinition('tmpl-src-arrays-long', 'standard')
    expect(def.nodes[0] && formatTypeRef(def.nodes[0].outputType)).toBe('LongStream')
    expect(formatTypeRef(def.resultType)).toBe('List<Long>')
    expect(def.dataset.map((d) => d.index)).toEqual([0, 1, 2])
    const javaText = def.javaCode.map((l) => l.text).join('\n')
    expect(javaText).toContain('long[] amounts = { 10L, 20L, 30L };')
    expect(javaText).toContain('Arrays.stream(amounts)')
    expect(javaText).toContain('.boxed()')
    const snapshots = runAllSnapshots(def)
    const emits = snapshots.filter((s) => s.kind === 'SOURCE_EMIT')
    expect(emits.map((s) => s.sourceContext?.index)).toEqual([0, 1, 2])
    expect(snapshots.at(-1)?.output.items.map((i) => i.label)).toEqual(['10L', '20L', '30L'])
    // 空ソースmode
    expect(makeDefinition('tmpl-src-arrays-long', 'emptySource').dataset).toHaveLength(0)
  })

  it('P2-D04: double配列templateの型・index・順序・コード・boxed後結果が正しい（レビュー対応）', () => {
    const def = makeDefinition('tmpl-src-arrays-double', 'standard')
    expect(def.nodes[0] && formatTypeRef(def.nodes[0].outputType)).toBe('DoubleStream')
    expect(formatTypeRef(def.resultType)).toBe('List<Double>')
    const javaText = def.javaCode.map((l) => l.text).join('\n')
    expect(javaText).toContain('double[] rates = { 1.5, 2.5, 4.0 };')
    expect(javaText).toContain('Arrays.stream(rates)')
    const snapshots = runAllSnapshots(def)
    const emits = snapshots.filter((s) => s.kind === 'SOURCE_EMIT')
    expect(emits.map((s) => s.sourceContext?.index)).toEqual([0, 1, 2])
    expect(snapshots.at(-1)?.output.items.map((i) => i.label)).toEqual(['1.5', '2.5', '4.0'])
    expect(makeDefinition('tmpl-src-arrays-double', 'emptySource').dataset).toHaveLength(0)
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

  it('P2-D07: 終了しない候補（step=0等）を具現化前に拒否する（レビュー対応）', () => {
    const run = (seed: number, operator: 'LTE' | 'LT', value: number, step: number) =>
      instantiateTemplate(registry, catalog, {
        templateId: 'tmpl-src-iterate3',
        templateVersion: 1,
        dataset: [],
        dslParameters: {
          'slot-source': {
            kind: 'iterate3',
            seed,
            predicate: { operator, value },
            operator: { ruleId: 'increment', step },
          },
        },
        mode: 'standard',
        revision: `test-finite-${seed}-${operator}-${value}-${step}`,
      })
    // seed=1, n<=5, step=0: predicateがfalseへ進まない → UNBOUNDED_SOURCE
    const step0 = run(1, 'LTE', 5, 0)
    expect(step0.ok).toBe(false)
    if (!step0.ok) {
      expect(step0.issues[0]?.code).toBe('UNBOUNDED_SOURCE')
      expect(step0.issues[0]?.message).toContain('step')
    }
    // 負のstepも同様に拒否
    const negative = run(1, 'LT', 5, -1)
    expect(negative.ok).toBe(false)
    if (!negative.ok) expect(negative.issues[0]?.code).toBe('UNBOUNDED_SOURCE')
    // seedが最初からfalseなら（step=0でも）空で有限終了するため受理される
    // ただしstandardモードは入力必須のため教材制約で拒否 → emptySourceで確認
    const emptyOk = instantiateTemplate(registry, catalog, {
      templateId: 'tmpl-src-iterate3',
      templateVersion: 1,
      dataset: [],
      dslParameters: {
        'slot-source': {
          kind: 'iterate3',
          seed: 10,
          predicate: { operator: 'LTE', value: 5 },
          operator: { ruleId: 'increment', step: 0 },
        },
      },
      mode: 'emptySource',
      revision: 'test-finite-empty',
    })
    expect(emptyOk.ok).toBe(true)
  })

  it('P2-D07: Java int範囲とsnapshot予算を巨大timeline生成前に検証する（レビュー対応）', () => {
    const run = (seed: number, value: number, step: number) =>
      instantiateTemplate(registry, catalog, {
        templateId: 'tmpl-src-iterate3',
        templateVersion: 1,
        dataset: [],
        dslParameters: {
          'slot-source': {
            kind: 'iterate3',
            seed,
            predicate: { operator: 'LTE', value },
            operator: { ruleId: 'increment', step },
          },
        },
        mode: 'standard',
        revision: `test-range-${seed}-${value}-${step}`,
      })
    // 最終候補がJava intの範囲を超える
    const overflow = run(2_147_483_640, 2_147_483_647, 1)
    expect(overflow.ok).toBe(false)
    if (!overflow.ok) expect(overflow.issues[0]?.code).toBe('TYPE_MISMATCH')
    // 生成要素数が安全上限に収まらない（timeline構築前に拒否）
    const tooMany = run(1, 100_000, 1)
    expect(tooMany.ok).toBe(false)
    if (!tooMany.ok) expect(tooMany.issues[0]?.code).toBe('SNAPSHOT_BUDGET')
    // seed自体がint範囲外は構造検証で拒否
    const badSeed = validateSourceStructure({
      kind: 'iterate3',
      seed: 3_000_000_000,
      predicate: { operator: 'LTE', value: 5 },
      operator: { ruleId: 'increment', step: 1 },
    })
    expect(badSeed.ok).toBe(false)
    if (!badSeed.ok) expect(badSeed.issues[0]?.code).toBe('TYPE_MISMATCH')
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
