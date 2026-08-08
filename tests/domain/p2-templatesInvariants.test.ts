import { describe, expect, it } from 'vitest'
import { executableTemplateModes, makeDefinition, makeScenario, runAllSnapshots } from '../helpers'
import { createDefaultTemplateRegistry } from '../../src/domain/template/templates'
import { createDefaultCatalog } from '../../src/domain/catalog/operations'
import { instantiateTemplate } from '../../src/domain/template/instantiate'
import { STANDARD_EMPLOYEES } from '../../src/domain/fixtures/employees'
import { evaluateMapper } from '../../src/domain/dsl/evaluateMapper'
import { mapperToJavaExpr } from '../../src/domain/dsl/javaCode'
import { formatSimValue } from '../../src/domain/model/value'
import { formatTypeRef } from '../../src/domain/types/typeRef'

const registry = createDefaultTemplateRegistry()
const catalog = createDefaultCatalog()

describe('P2-D20 TemplateRegistry', () => {
  it('P2-D20: 同一target operationへ複数templateを登録・取得できる', () => {
    expect(registry.listByTargetOperation('map').map((t) => t.templateId)).toEqual([
      'tmpl-map',
      'tmpl-map-midempty',
    ])
    expect(registry.listByTargetOperation('source.arraysStream').map((t) => t.templateId)).toEqual([
      'tmpl-src-arrays-object',
      'tmpl-src-arrays-int',
    ])
    expect(registry.listByTargetOperation('filter')).toHaveLength(2)
  })

  it('P2-D20: template ID / version / node ID / line IDが安定している', () => {
    const map = registry.get('tmpl-map', 1)
    expect(map?.nodes.map((n) => n.nodeId)).toEqual(['node-src', 'node-map', 'node-sink'])
    const def = makeDefinition('tmpl-map', 'standard')
    expect(def.nodes.map((n) => n.lineId)).toEqual([
      'line-node-src',
      'line-node-map',
      'line-node-sink',
    ])
    // 2回取得しても同一定義
    expect(registry.get('tmpl-map', 1)).toBe(map)
  })
})

describe('P2-D21 教材制約・mode', () => {
  it('P2-D21: mapの標準は変換前後が視覚的に異なる必要がある', () => {
    // mapを主対象とするテスト用template（toUpper許可）を登録して検証する
    const registry2 = createDefaultTemplateRegistry()
    registry2.register({
      templateId: 'tmpl-test-map-upper',
      version: 1,
      targetOperationId: 'map',
      targetNodeId: 'node-map',
      title: 'map視覚変化検証用',
      sourceDefinition: { slotId: 'slot-source', defaultDsl: null, allowedSourceKinds: ['arrayObject'] },
      nodes: [
        { nodeId: 'node-src', operationId: 'source.arraysStream', role: 'source', slotId: 'slot-source' },
        { nodeId: 'node-map', operationId: 'map', role: 'intermediate', slotId: 'slot-mapper-1' },
        { nodeId: 'node-sink', operationId: 'toList', role: 'terminal', slotId: null },
      ],
      parameterSlots: [
        {
          slotId: 'slot-mapper-1',
          targetNodeId: 'node-map',
          kind: 'mapper',
          required: true,
          allowedMapperKinds: ['toUpper'],
        },
      ],
      allowedDslProfile: { predicateKinds: [] },
      supportedModes: ['standard'],
      jdkNotes: [],
      snapshotBudget: { limit: 500, estimatedMax: 30 },
    })
    const run = (values: string[]) =>
      instantiateTemplate(registry2, catalog, {
        templateId: 'tmpl-test-map-upper',
        templateVersion: 1,
        dataset: [],
        dslParameters: {
          'slot-source': { kind: 'arrayObject', arrayId: 'names', elementTypeName: 'String', values },
          'slot-mapper-1': { kind: 'toUpper' },
        },
        mode: 'standard',
        revision: `test-visual-${values.join('-')}`,
      })
    // 変化する値は受理
    expect(run(['java', 'sql']).ok).toBe(true)
    // 既に大文字で変化しない値は拒否
    const noChange = run(['JAVA', 'SQL'])
    expect(noChange.ok).toBe(false)
    if (!noChange.ok) expect(noChange.issues[0]?.code).toBe('TEACHING_CONSTRAINT')
  })

  it('P2-D21: flatMapの標準は複数子を生成する親が必要', () => {
    const result = instantiateTemplate(registry, catalog, {
      templateId: 'tmpl-flatmap',
      templateVersion: 1,
      dataset: [],
      dslParameters: {
        'slot-source': { kind: 'nestedStringList', listId: 'nested', values: [['a'], ['b']] },
        'slot-mapper-1': { kind: 'listStream' },
      },
      mode: 'standard',
      revision: 'test-single-child',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.code).toBe('TEACHING_CONSTRAINT')
  })

  it('P2-D21: 途中0件は結果0件、空ソースは入力0件が必要', () => {
    const midEmptyBad = instantiateTemplate(registry, catalog, {
      templateId: 'tmpl-flatmap',
      templateVersion: 1,
      dataset: [],
      dslParameters: {
        'slot-source': { kind: 'nestedStringList', listId: 'nested', values: [['a', 'b']] },
        'slot-mapper-1': { kind: 'listStream' },
      },
      mode: 'midEmpty',
      revision: 'test-midempty-bad',
    })
    expect(midEmptyBad.ok).toBe(false)
    if (!midEmptyBad.ok) expect(midEmptyBad.issues[0]?.code).toBe('TEACHING_CONSTRAINT')

    const emptyBad = instantiateTemplate(registry, catalog, {
      templateId: 'tmpl-map',
      templateVersion: 1,
      dataset: STANDARD_EMPLOYEES,
      dslParameters: { 'slot-mapper-1': { kind: 'fieldAccess', field: 'name' } },
      mode: 'emptySource',
      revision: 'test-empty-bad',
    })
    expect(emptyBad.ok).toBe(false)
    if (!emptyBad.ok) expect(emptyBad.issues[0]?.code).toBe('TEACHING_CONSTRAINT')

    const standardBad = instantiateTemplate(registry, catalog, {
      templateId: 'tmpl-map',
      templateVersion: 1,
      dataset: [],
      dslParameters: { 'slot-mapper-1': { kind: 'fieldAccess', field: 'name' } },
      mode: 'standard',
      revision: 'test-standard-bad',
    })
    expect(standardBad.ok).toBe(false)
    if (!standardBad.ok) expect(standardBad.issues[0]?.code).toBe('TEACHING_CONSTRAINT')
  })

  it('P2-D21: supportedModes外のmodeを拒否する', () => {
    const result = instantiateTemplate(registry, catalog, {
      templateId: 'tmpl-map',
      templateVersion: 1,
      dataset: STANDARD_EMPLOYEES,
      dslParameters: { 'slot-mapper-1': { kind: 'fieldAccess', field: 'name' } },
      mode: 'midEmpty',
      revision: 'test-mode',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.code).toBe('TEMPLATE_MODE_UNSUPPORTED')
  })
})

describe('P2-D22 Source of Truth', () => {
  it('P2-D22: 評価結果・TypeRef・Javaコード・説明が同一ASTから一致して生成される', () => {
    // map: 評価とsnapshot表示の一致
    const def = makeDefinition('tmpl-map', 'standard')
    const mapNode = def.nodes.find((n) => n.operationId === 'map')
    expect(mapNode?.mapper).toBeTruthy()
    if (!mapNode?.mapper) return
    const javaText = def.javaCode.map((l) => l.text).join('\n')
    expect(javaText).toContain(`.map(${mapperToJavaExpr(mapNode.mapper)})`)
    const snapshots = runAllSnapshots(def)
    const firstElement = def.dataset[0]
    if (!firstElement) throw new Error('dataset is empty')
    const evaluated = evaluateMapper(mapNode.mapper, firstElement.value)
    const applied = snapshots.find((s) => s.kind === 'MAPPING_APPLIED')
    expect(applied?.processing?.evaluation).toContain(formatSimValue(evaluated))
    // 出力ラベルも同じ評価結果から生成される
    const last = snapshots[snapshots.length - 1]
    expect(last?.output.items[0]?.label).toBe(formatSimValue(evaluated))
    // TypeRefも同じASTから解決される
    expect(formatTypeRef(mapNode.outputType)).toBe('Stream<String>')
  })
})

describe('P2-D23 TypeRef連鎖', () => {
  const chains = [
    ['tmpl-maptoint', 'standard', ['Stream<Employee>', 'IntStream', 'Stream<Integer>', 'List<Integer>']],
    ['tmpl-maptolong', 'standard', ['Stream<Employee>', 'LongStream', 'Stream<Long>', 'List<Long>']],
    [
      'tmpl-maptodouble',
      'standard',
      ['Stream<Employee>', 'DoubleStream', 'Stream<Double>', 'List<Double>'],
    ],
    ['tmpl-flatmap', 'standard', ['Stream<List<String>>', 'Stream<String>', 'List<String>']],
    ['tmpl-flatmap-int', 'standard', ['Stream<int[]>', 'IntStream', 'Stream<Integer>', 'List<Integer>']],
    ['tmpl-flatmap-long', 'standard', ['Stream<long[]>', 'LongStream', 'Stream<Long>', 'List<Long>']],
    [
      'tmpl-flatmap-double',
      'standard',
      ['Stream<double[]>', 'DoubleStream', 'Stream<Double>', 'List<Double>'],
    ],
    ['tmpl-boxed', 'standard', ['IntStream', 'Stream<Integer>', 'List<Integer>']],
    ['tmpl-maptoobj', 'standard', ['IntStream', 'Stream<String>', 'List<String>']],
    ['tmpl-map', 'standard', ['Stream<Employee>', 'Stream<String>', 'List<String>']],
    ['tmpl-src-iterate3', 'standard', ['Stream<Integer>', 'List<Integer>']],
  ] as const

  it('P2-D23: object↔primitive、flatMap前後、boxed/toListまで全区間が正しい', () => {
    for (const [templateId, mode, expected] of chains) {
      const def = makeDefinition(templateId, mode)
      const actual = def.nodes.map((n) => formatTypeRef(n.outputType))
      expect(actual, templateId).toEqual(expected)
      // 各ノードの入力型は前段の出力型と一致する
      for (let i = 1; i < def.nodes.length; i++) {
        const node = def.nodes[i]
        const prev = def.nodes[i - 1]
        if (node && prev && node.inputType) {
          expect(formatTypeRef(node.inputType), `${templateId}#${node.nodeId}`).toBe(
            formatTypeRef(prev.outputType),
          )
        }
      }
    }
  })
})

describe('P2-D24 snapshot不変条件', () => {
  it('P2-D24: active node・line ID・親子位置・型・要素状態・出力が同一時点を表す', () => {
    for (const { templateId, mode } of executableTemplateModes()) {
      const def = makeDefinition(templateId, mode)
      const snapshots = runAllSnapshots(def)
      snapshots.forEach((s, i) => {
        const label = `${templateId}:${mode}#${i}`
        expect(s.index, label).toBe(i)
        expect(s.snapshotId, label).toBe(`${def.revision}#${i}`)
        // active nodeとline IDの一致
        if (s.activeNodeId === null) {
          expect(s.activeLineId, label).toBeNull()
        } else {
          const node = def.nodes.find((n) => n.nodeId === s.activeNodeId)
          expect(node?.lineId, label).toBe(s.activeLineId)
        }
        // 親子位置: parentElementIdを持つのはflatMap文脈のみ
        if (s.parentElementId !== null) {
          expect(s.flatMapContext, label).not.toBeNull()
        }
        // 出力件数の整合
        expect(s.output.count, label).toBe(s.output.items.length)
        expect(s.output.elementIds, label).toEqual(s.output.items.map((item) => item.id))
        // 不変（凍結）
        expect(Object.isFrozen(s), label).toBe(true)
      })
    }
  })
})

describe('P2-D25 決定性・予算', () => {
  it('P2-D25: 同revisionで同じsnapshot列を生成する', () => {
    for (const { templateId, mode } of executableTemplateModes()) {
      const run1 = runAllSnapshots(makeDefinition(templateId, mode))
      const run2 = runAllSnapshots(makeDefinition(templateId, mode))
      expect(JSON.parse(JSON.stringify(run1)), `${templateId}:${mode}`).toEqual(
        JSON.parse(JSON.stringify(run2)),
      )
    }
  })

  it('P2-D25: 全template × modeが500 snapshot以内', () => {
    for (const { templateId, mode } of executableTemplateModes()) {
      const def = makeDefinition(templateId, mode)
      expect(def.snapshotCount, `${templateId}:${mode}`).toBeLessThanOrEqual(500)
      expect(runAllSnapshots(def).length, `${templateId}:${mode}`).toBe(def.snapshotCount)
    }
  })

  it('P2-D25: 無限source候補は事前拒否される（実行不能templateはfixture要素数で打ち切らない）', () => {
    const result = instantiateTemplate(registry, catalog, {
      templateId: 'tmpl-src-generate',
      templateVersion: 1,
      dataset: [],
      dslParameters: { 'slot-source': { kind: 'generate', ruleId: 'supplier-counter' } },
      mode: 'standard',
      revision: 'test-gen',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.code).toBe('UNBOUNDED_SOURCE')
  })
})

describe('P2-D26 filter回帰', () => {
  it('P2-D26: Phase 1 filterの3modeとチェーンが汎用化後も正しい', () => {
    const standard = runAllSnapshots(makeDefinition('tmpl-filter-basic', 'standard'))
    expect(standard.at(-1)?.output.elementIds).toEqual(['emp-001', 'emp-003'])
    expect(standard).toHaveLength(21)
    expect(standard.map((s) => s.kind).slice(0, 6)).toEqual([
      'INITIAL',
      'SOURCE_EMIT',
      'NODE_ARRIVAL',
      'PREDICATE_EVALUATED',
      'ELEMENT_PASSED',
      'SINK_APPENDED',
    ])

    const midEmpty = runAllSnapshots(makeDefinition('tmpl-filter-basic', 'midEmpty'))
    expect(midEmpty.at(-1)?.output.count).toBe(0)
    expect(midEmpty).toHaveLength(19)

    const emptySource = runAllSnapshots(makeDefinition('tmpl-filter-basic', 'emptySource'))
    expect(emptySource.map((s) => s.kind)).toEqual(['INITIAL', 'RESULT_CONFIRMED', 'STREAM_CONSUMED'])

    const chain = runAllSnapshots(makeDefinition('tmpl-filter-chain', 'standard'))
    expect(chain.at(-1)?.output.elementIds).toEqual(['emp-003'])
    expect(chain).toHaveLength(53)

    // scenario化しても同じ（revision発行含む）
    const scenario = makeScenario('tmpl-filter-basic', 'standard')
    expect(scenario.pipeline.snapshotCount).toBe(21)
  })
})
