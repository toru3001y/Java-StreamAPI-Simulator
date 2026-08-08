import { describe, expect, it } from 'vitest'
import { createDefaultCatalog } from '../../src/domain/catalog/operations'
import { sourceStreamType } from '../../src/domain/dsl/validateSource'
import { formatTypeRef } from '../../src/domain/types/typeRef'

const catalog = createDefaultCatalog()

describe('P2-D01 Source OperationCatalog', () => {
  it('P2-D01: 全sourceのordered/unordered・finite/infiniteが正しい', () => {
    const expectMeta = (
      opId: string,
      ordered: boolean,
      bounded: 'finite' | 'infinite' | 'conditionallyFinite',
    ) => {
      const op = catalog.get(opId)
      expect(op.category).toBe('source')
      expect(op.sourceMeta?.ordered, opId).toBe(ordered)
      expect(op.sourceMeta?.bounded, opId).toBe(bounded)
      expect(op.handlerId).toBe(`handler.${opId}`)
      expect(op.outputTypeRule.kind).toBe('fromSource')
    }
    expectMeta('source.collectionStream', true, 'finite')
    expectMeta('source.arraysStream', true, 'finite')
    expectMeta('source.streamOf', true, 'finite')
    expectMeta('source.generate', false, 'infinite')
    expectMeta('source.iterate2', true, 'infinite')
    expectMeta('source.iterate3', true, 'conditionallyFinite')
    expectMeta('source.range', true, 'finite')
    expectMeta('source.rangeClosed', true, 'finite')
    expectMeta('source.empty', true, 'finite')
  })

  it('P2-D01: source DSLごとの出力TypeRefが正しい', () => {
    expect(formatTypeRef(sourceStreamType({ kind: 'collection', collectionId: 'employees' }))).toBe(
      'Stream<Employee>',
    )
    expect(
      formatTypeRef(
        sourceStreamType({ kind: 'arrayObject', arrayId: 'a', elementTypeName: 'String', values: [] }),
      ),
    ).toBe('Stream<String>')
    expect(
      formatTypeRef(
        sourceStreamType({ kind: 'arrayPrimitive', arrayId: 'a', primitive: 'int', values: [] }),
      ),
    ).toBe('IntStream')
    expect(
      formatTypeRef(
        sourceStreamType({ kind: 'arrayPrimitive', arrayId: 'a', primitive: 'long', values: [] }),
      ),
    ).toBe('LongStream')
    expect(
      formatTypeRef(
        sourceStreamType({ kind: 'arrayPrimitive', arrayId: 'a', primitive: 'double', values: [] }),
      ),
    ).toBe('DoubleStream')
    expect(formatTypeRef(sourceStreamType({ kind: 'range', from: 1, to: 5 }))).toBe('IntStream')
    expect(
      formatTypeRef(
        sourceStreamType({
          kind: 'iterate3',
          seed: 1,
          predicate: { operator: 'LTE', value: 5 },
          operator: { ruleId: 'increment', step: 1 },
        }),
      ),
    ).toBe('Stream<Integer>')
    expect(
      formatTypeRef(sourceStreamType({ kind: 'empty', streamType: 'object', elementTypeName: 'String' })),
    ).toBe('Stream<String>')
    expect(
      formatTypeRef(sourceStreamType({ kind: 'empty', streamType: 'double', elementTypeName: 'double' })),
    ).toBe('DoubleStream')
    expect(
      formatTypeRef(
        sourceStreamType({ kind: 'streamOfPrimitiveArrays', primitive: 'int', arrays: [] }),
      ),
    ).toBe('Stream<int[]>')
    expect(
      formatTypeRef(sourceStreamType({ kind: 'nestedStringList', listId: 'nested', values: [] })),
    ).toBe('Stream<List<String>>')
  })
})

describe('P2-D02 Intermediate Catalog', () => {
  it('P2-D02: map系/boxed/mapToObj/flatMap系がINTERMEDIATE・STATELESSで型規則とhandlerが正しい', () => {
    const intermediates = [
      'map',
      'mapToInt',
      'mapToLong',
      'mapToDouble',
      'boxed',
      'mapToObj',
      'flatMap',
      'flatMapToInt',
      'flatMapToLong',
      'flatMapToDouble',
    ]
    for (const opId of intermediates) {
      const op = catalog.get(opId)
      expect(op.category, opId).toBe('intermediate')
      expect(op.traits, opId).toContain('INTERMEDIATE')
      expect(op.traits, opId).toContain('STATELESS')
      expect(op.handlerId).toBe(`handler.${opId}`)
    }
    expect(catalog.get('map').inputTypeRule.kind).toBe('anyStream')
    expect(catalog.get('map').outputTypeRule.kind).toBe('fromMapper')
    expect(catalog.get('mapToInt').outputTypeRule).toEqual({
      kind: 'fixedPrimitiveStream',
      name: 'IntStream',
    })
    expect(catalog.get('mapToLong').outputTypeRule).toEqual({
      kind: 'fixedPrimitiveStream',
      name: 'LongStream',
    })
    expect(catalog.get('mapToDouble').outputTypeRule).toEqual({
      kind: 'fixedPrimitiveStream',
      name: 'DoubleStream',
    })
    expect(catalog.get('boxed').inputTypeRule.kind).toBe('anyPrimitiveStream')
    expect(catalog.get('boxed').outputTypeRule.kind).toBe('boxedWrapper')
    expect(catalog.get('mapToObj').inputTypeRule.kind).toBe('anyPrimitiveStream')
    expect(catalog.get('mapToObj').outputTypeRule.kind).toBe('fromMapper')
    expect(catalog.get('flatMap').outputTypeRule.kind).toBe('fromMapper')
    expect(catalog.get('flatMapToInt').outputTypeRule).toEqual({
      kind: 'fixedPrimitiveStream',
      name: 'IntStream',
    })
  })
})
