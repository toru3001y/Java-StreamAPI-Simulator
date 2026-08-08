import { describe, expect, it } from 'vitest'
import { makeDefinition, runAllSnapshots } from '../helpers'
import { instantiateTemplate } from '../../src/domain/template/instantiate'
import { createDefaultTemplateRegistry } from '../../src/domain/template/templates'
import { createDefaultCatalog } from '../../src/domain/catalog/operations'
import { validateMapperStructure, resolveMapperOutputType } from '../../src/domain/dsl/validateMapper'
import { evaluateMapper } from '../../src/domain/dsl/evaluateMapper'
import { describeMapper } from '../../src/domain/dsl/explanation'
import { mapperToJavaExpr } from '../../src/domain/dsl/javaCode'
import { formatTypeRef } from '../../src/domain/types/typeRef'

const registry = createDefaultTemplateRegistry()
const catalog = createDefaultCatalog()

describe('P2-D10 Mapper DSL検証', () => {
  it('P2-D10: 正常kindを受理する', () => {
    expect(validateMapperStructure({ kind: 'fieldAccess', field: 'name' }).ok).toBe(true)
    expect(validateMapperStructure({ kind: 'toUpper' }).ok).toBe(true)
    expect(validateMapperStructure({ kind: 'prefix', prefix: 'No.' }).ok).toBe(true)
    expect(
      validateMapperStructure({ kind: 'fieldToPrimitive', field: 'age', primitive: 'int' }).ok,
    ).toBe(true)
    expect(validateMapperStructure({ kind: 'listStream' }).ok).toBe(true)
    expect(validateMapperStructure({ kind: 'arrayStream', primitive: 'long' }).ok).toBe(true)
  })

  it('P2-D10: 未知kind・任意コードを拒否する', () => {
    const unknown = validateMapperStructure({ kind: 'regex', pattern: '.*' })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.issues[0]?.code).toBe('STRUCTURE_UNKNOWN_KIND')
    // 関数本文文字列・任意Javaコード文字列は構造として存在しない（kindで拒否される）
    const code = validateMapperStructure({ kind: 'javaCode', body: 'e -> e.hack()' })
    expect(code.ok).toBe(false)
  })

  it('P2-D10: 許可外field・型不一致を拒否する', () => {
    const badField = resolveMapperOutputType(
      { kind: 'fieldAccess', field: 'unknown' },
      { kind: 'object', name: 'Employee' },
    )
    expect(badField.ok).toBe(false)
    if (!badField.ok) expect(badField.issues[0]?.code).toBe('WHITELIST_FIELD')

    const typeMismatch = resolveMapperOutputType(
      { kind: 'fieldToPrimitive', field: 'name', primitive: 'int' },
      { kind: 'object', name: 'Employee' },
    )
    expect(typeMismatch.ok).toBe(false)
    if (!typeMismatch.ok) expect(typeMismatch.issues[0]?.code).toBe('TYPE_MISMATCH')

    const wrongInput = resolveMapperOutputType({ kind: 'toUpper' }, { kind: 'object', name: 'Employee' })
    expect(wrongInput.ok).toBe(false)
  })

  it('P2-D10: slot許可範囲外のmapper kindを拒否する（WHITELIST_KIND）', () => {
    const result = instantiateTemplate(registry, catalog, {
      templateId: 'tmpl-map',
      templateVersion: 1,
      dataset: [],
      dslParameters: { 'slot-mapper-1': { kind: 'toUpper' } },
      mode: 'emptySource',
      revision: 'test-whitelist',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.code).toBe('WHITELIST_KIND')
  })
})

describe('P2-D11 map', () => {
  it('P2-D11: 1→1変換・Stream型変化・評価/コード/説明が同一ASTと一致する', () => {
    const def = makeDefinition('tmpl-map', 'standard')
    const mapNode = def.nodes.find((n) => n.operationId === 'map')
    expect(mapNode?.inputType && formatTypeRef(mapNode.inputType)).toBe('Stream<Employee>')
    expect(mapNode && formatTypeRef(mapNode.outputType)).toBe('Stream<String>')
    expect(def.javaCode.map((l) => l.text).join('\n')).toContain('.map(Employee::name)')

    const snapshots = runAllSnapshots(def)
    // 要素ごとに 到着 → 変換確定 → 送出 の3snapshot
    const kinds = snapshots.map((s) => s.kind)
    expect(kinds.slice(1, 6)).toEqual([
      'SOURCE_EMIT',
      'NODE_ARRIVAL',
      'MAPPING_APPLIED',
      'MAPPED_EMITTED',
      'SINK_APPENDED',
    ])
    const applied = snapshots.find((s) => s.kind === 'MAPPING_APPLIED')
    expect(applied?.processing?.evaluation).toBe('佐藤（age=35） → "佐藤"')
    expect(applied?.typeTransition).toBe('Stream<Employee> → Stream<String>')
    const arrival = snapshots.find((s) => s.kind === 'NODE_ARRIVAL')
    expect(arrival?.explanation.current).toContain(
      describeMapper({ kind: 'fieldAccess', field: 'name' }),
    )
    const last = snapshots[snapshots.length - 1]
    expect(last?.output.items.map((i) => i.label)).toEqual(['"佐藤"', '"鈴木"', '"高橋"', '"田中"'])
    // 要素数は変わらない（1→1変換）
    expect(last?.output.count).toBe(def.dataset.length)
  })
})

const primitiveCases = [
  {
    id: 'P2-D12',
    templateId: 'tmpl-maptoint',
    op: 'mapToInt',
    stream: 'IntStream',
    transition: 'Stream<Employee> → IntStream',
    labels: ['35', '27', '42', '29'],
    javaExpr: '.mapToInt(Employee::age)',
  },
  {
    id: 'P2-D13',
    templateId: 'tmpl-maptolong',
    op: 'mapToLong',
    stream: 'LongStream',
    transition: 'Stream<Employee> → LongStream',
    labels: ['5_500_000L', '4_200_000L', '7_200_000L', '4_800_000L'],
    javaExpr: '.mapToLong(Employee::salary)',
  },
  {
    id: 'P2-D14',
    templateId: 'tmpl-maptodouble',
    op: 'mapToDouble',
    stream: 'DoubleStream',
    transition: 'Stream<Employee> → DoubleStream',
    labels: ['4.2', '3.8', '4.6', '4.0'],
    javaExpr: '.mapToDouble(Employee::evaluation)',
  },
] as const

for (const c of primitiveCases) {
  describe(`${c.id} ${c.op}`, () => {
    it(`${c.id}: Employeeフィールドを${c.stream}へ変換する`, () => {
      const def = makeDefinition(c.templateId, 'standard')
      const node = def.nodes.find((n) => n.operationId === c.op)
      expect(node && formatTypeRef(node.outputType)).toBe(c.stream)
      expect(def.javaCode.map((l) => l.text).join('\n')).toContain(c.javaExpr)
      const snapshots = runAllSnapshots(def)
      const applied = snapshots.find((s) => s.kind === 'MAPPING_APPLIED')
      expect(applied?.typeTransition).toBe(c.transition)
      const last = snapshots[snapshots.length - 1]
      expect(last?.output.items.map((i) => i.label)).toEqual(c.labels)
    })
  })
}

describe('P2-D15 boxed', () => {
  it('P2-D15: int/long/doubleが対応wrapperのobject Streamになる', () => {
    const def = makeDefinition('tmpl-boxed', 'standard')
    const boxedNode = def.nodes.find((n) => n.operationId === 'boxed')
    expect(boxedNode?.inputType && formatTypeRef(boxedNode.inputType)).toBe('IntStream')
    expect(boxedNode && formatTypeRef(boxedNode.outputType)).toBe('Stream<Integer>')
    const last = runAllSnapshots(def).at(-1)
    expect(last?.output.items.map((i) => i.label)).toEqual(['1', '2', '3'])
    expect(formatTypeRef(def.resultType)).toBe('List<Integer>')

    // long / double wrapper（mapToLong/Double template内のboxed）
    const longDef = makeDefinition('tmpl-maptolong', 'standard')
    const longBoxed = longDef.nodes.find((n) => n.operationId === 'boxed')
    expect(longBoxed && formatTypeRef(longBoxed.outputType)).toBe('Stream<Long>')
    const doubleDef = makeDefinition('tmpl-maptodouble', 'standard')
    const doubleBoxed = doubleDef.nodes.find((n) => n.operationId === 'boxed')
    expect(doubleBoxed && formatTypeRef(doubleBoxed.outputType)).toBe('Stream<Double>')
  })
})

describe('P2-D16 mapToObj', () => {
  it('P2-D16: primitiveから任意objectへ変換し、boxedとの差が型・コード・説明へ反映される', () => {
    const def = makeDefinition('tmpl-maptoobj', 'standard')
    const node = def.nodes.find((n) => n.operationId === 'mapToObj')
    expect(node?.inputType && formatTypeRef(node.inputType)).toBe('IntStream')
    expect(node && formatTypeRef(node.outputType)).toBe('Stream<String>')
    expect(def.javaCode.map((l) => l.text).join('\n')).toContain('.mapToObj(n -> "No." + n)')
    const last = runAllSnapshots(def).at(-1)
    expect(last?.output.items.map((i) => i.label)).toEqual(['"No.1"', '"No.2"', '"No.3"'])

    // boxedとの差: boxedはIntStream → Stream<Integer>、mapToObjは任意object（String）
    const boxedDef = makeDefinition('tmpl-boxed', 'standard')
    const boxedNode = boxedDef.nodes.find((n) => n.operationId === 'boxed')
    expect(boxedNode && formatTypeRef(boxedNode.outputType)).toBe('Stream<Integer>')
    expect(mapperToJavaExpr({ kind: 'prefix', prefix: 'No.' })).toBe('n -> "No." + n')
    expect(describeMapper({ kind: 'prefix', prefix: 'No.' })).toContain('"No." + n')
    // 評価も同一ASTと一致する
    expect(evaluateMapper({ kind: 'prefix', prefix: 'No.' }, { kind: 'int', value: 1 })).toEqual({
      kind: 'string',
      value: 'No.1',
    })
  })
})
