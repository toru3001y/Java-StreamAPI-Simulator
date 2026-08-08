import { describe, expect, it } from 'vitest'
import { formatTypeRef } from '../../src/domain/types/typeRef'
import { createDefaultCatalog } from '../../src/domain/catalog/operations'
import { makeDefinition } from '../helpers'

describe('P1-D01 TypeRef', () => {
  it('P1-D01: 基準PipelineでStream<Employee> → Stream<Employee> → List<Employee>が正しい', () => {
    const def = makeDefinition('tmpl-filter-basic', 'standard')
    const [src, filter, sink] = def.nodes
    expect(src && formatTypeRef(src.outputType)).toBe('Stream<Employee>')
    expect(filter?.inputType && formatTypeRef(filter.inputType)).toBe('Stream<Employee>')
    expect(filter && formatTypeRef(filter.outputType)).toBe('Stream<Employee>')
    expect(sink?.inputType && formatTypeRef(sink.inputType)).toBe('Stream<Employee>')
    expect(sink && formatTypeRef(sink.outputType)).toBe('List<Employee>')
    expect(formatTypeRef(def.resultType)).toBe('List<Employee>')
  })

  it('P1-D01: filterチェーンでも全区間の型遷移が一致する', () => {
    const def = makeDefinition('tmpl-filter-chain', 'standard')
    for (const node of def.nodes) {
      if (node.role === 'intermediate') {
        expect(node.inputType && formatTypeRef(node.inputType)).toBe('Stream<Employee>')
        expect(formatTypeRef(node.outputType)).toBe('Stream<Employee>')
      }
    }
    expect(formatTypeRef(def.resultType)).toBe('List<Employee>')
  })
})

describe('P1-D02 OperationCatalog', () => {
  it('P1-D02: filterがINTERMEDIATE / STATELESS、toListがTERMINAL', () => {
    const catalog = createDefaultCatalog()
    const filter = catalog.get('filter')
    expect(filter.traits).toContain('INTERMEDIATE')
    expect(filter.traits).toContain('STATELESS')
    expect(filter.category).toBe('intermediate')
    const toList = catalog.get('toList')
    expect(toList.traits).toContain('TERMINAL')
    expect(toList.category).toBe('terminal')
  })

  it('P1-D02: 拡張可能な登録方式（新規操作を登録・取得でき、重複登録は拒否する）', () => {
    const catalog = createDefaultCatalog()
    // Phase 2でmapは標準登録されたため、拡張検証には未登録の操作IDを使用する
    catalog.register({
      operationId: 'custom.futureOp',
      category: 'intermediate',
      traits: ['INTERMEDIATE', 'STATELESS'],
      inputTypeRule: { kind: 'anyStream' },
      outputTypeRule: { kind: 'identity' },
      handlerId: 'handler.custom.futureOp',
      visualizationKind: '1→1変換型',
      legendStates: ['UNEVALUATED', 'PROCESSING', 'PASSED'],
      jdkNotes: [],
      sourceRefs: [],
      displayName: 'futureOp',
    })
    expect(catalog.get('custom.futureOp').operationId).toBe('custom.futureOp')
    expect(() => catalog.get('unknown-op')).toThrow()
    expect(() =>
      catalog.register({
        operationId: 'filter',
        category: 'intermediate',
        traits: [],
        inputTypeRule: { kind: 'anyStream' },
        outputTypeRule: { kind: 'identity' },
        handlerId: 'x',
        visualizationKind: 'x',
        legendStates: [],
        jdkNotes: [],
        sourceRefs: [],
        displayName: 'x',
      }),
    ).toThrow()
  })
})
