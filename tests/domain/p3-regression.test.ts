import { describe, expect, it } from 'vitest'
import { makeDefinition, runAllSnapshots } from '../helpers'
import { validateSourceStructure } from '../../src/domain/dsl/validateSource'
import { sourceToJavaExpr } from '../../src/domain/dsl/javaCode'
import { describeSource } from '../../src/domain/dsl/explanation'

/** P3-D32: Phase 3拡張後もP1 / P2の既存動作が正しいことの回帰検証 */
describe('P3-D32 P1/P2回帰', () => {
  it('P3-D32: filter / map / flatMapの既存Pipelineが正しい', () => {
    const filterDef = makeDefinition('tmpl-filter-basic')
    const filterLast = runAllSnapshots(filterDef).at(-1)!
    expect(filterLast.output.items.map((i) => i.label)).toEqual(['佐藤（age=35）', '高橋（age=42）'])

    const mapDef = makeDefinition('tmpl-map')
    const mapLast = runAllSnapshots(mapDef).at(-1)!
    expect(mapLast.output.items.map((i) => i.label)).toEqual(['"佐藤"', '"鈴木"', '"高橋"', '"田中"'])

    const flatMapDef = makeDefinition('tmpl-flatmap')
    const flatMapLast = runAllSnapshots(flatMapDef).at(-1)!
    expect(flatMapLast.output.items.map((i) => i.label)).toEqual(['"Java"', '"SQL"', '"分析"'])
  })

  it('P3-D32: source（iterate3 / range / empty）の既存動作が正しい', () => {
    expect(runAllSnapshots(makeDefinition('tmpl-src-iterate3')).at(-1)!.output.items.map((i) => i.label)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ])
    expect(runAllSnapshots(makeDefinition('tmpl-src-range')).at(-1)!.output.items.map((i) => i.label)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ])
    expect(
      runAllSnapshots(makeDefinition('tmpl-src-empty-object', 'emptySource')).at(-1)!.output.count,
    ).toBe(0)
  })

  it('P3-D32: generate / iterate2の既存DSL（検証・コード・説明）がPhase 3拡張後も正しい', () => {
    const generate = validateSourceStructure({ kind: 'generate', ruleId: 'supplier-counter' })
    expect(generate.ok).toBe(true)
    if (generate.ok) {
      expect(sourceToJavaExpr(generate.value)).toBe('Stream.generate(counter::incrementAndGet)')
      expect(describeSource(generate.value)).toContain('無限')
    }
    const iterate2 = validateSourceStructure({
      kind: 'iterate2',
      seed: 1,
      operator: { ruleId: 'increment', step: 1 },
    })
    expect(iterate2.ok).toBe(true)
    if (iterate2.ok) {
      expect(sourceToJavaExpr(iterate2.value)).toBe('Stream.iterate(1, n -> n + 1)')
      expect(describeSource(iterate2.value)).toContain('無限')
    }
    // 未知rule IDは引き続き拒否
    expect(validateSourceStructure({ kind: 'generate', ruleId: 'random' }).ok).toBe(false)
  })

  it('P3-D32: P1/P2既存templateのsnapshot列構造が維持されている（filter基準）', () => {
    const def = makeDefinition('tmpl-filter-basic')
    const kinds = runAllSnapshots(def).map((s) => s.kind)
    // Phase 1確立のfilter系列: INITIAL → EMIT → ARRIVAL → PREDICATE → PASSED/REJECTED …
    expect(kinds.slice(0, 5)).toEqual([
      'INITIAL',
      'SOURCE_EMIT',
      'NODE_ARRIVAL',
      'PREDICATE_EVALUATED',
      'ELEMENT_PASSED',
    ])
    expect(kinds.at(-2)).toBe('RESULT_CONFIRMED')
    expect(kinds.at(-1)).toBe('STREAM_CONSUMED')
  })
})
