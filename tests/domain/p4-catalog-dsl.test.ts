import { describe, expect, it } from 'vitest'
import { createDefaultCatalog } from '../../src/domain/catalog/operations'
import { createDefaultTemplateRegistry } from '../../src/domain/template/templates'
import {
  validateArrayGenerator,
  validateReductionIdentity,
  validateReductionStructure,
} from '../../src/domain/dsl/validateTerminal'
import { applyReduction, identityToSimValue } from '../../src/domain/dsl/evaluateReduction'
import {
  arrayGeneratorToJavaExpr,
  combinerToJavaExpr,
  identityToJavaLiteral,
  reductionToJavaExpr,
} from '../../src/domain/dsl/javaCode'
import { describeReduction } from '../../src/domain/dsl/explanation'
import { makeDefinition } from '../helpers'
import { instantiateCustom, makeCustomDefinition, tplSink, tplSrc } from '../p3-helpers'
import { formatTypeRef } from '../../src/domain/types/typeRef'
import { STANDARD_EMPLOYEES } from '../../src/domain/fixtures/employees'
import type { PipelineTemplate } from '../../src/domain/template/pipelineTemplate'

/** P4-D01〜P4-D08: Catalog・TypeRef・template・terminal DSL（Phase 4指示 §8・§9） */
const catalog = createDefaultCatalog()

const TERMINAL_OPS = [
  'reduce',
  'count',
  'min',
  'max',
  'findFirst',
  'findAny',
  'anyMatch',
  'allMatch',
  'noneMatch',
  'sum',
  'average',
  'summaryStatistics',
  'toArray',
  'forEach',
  'forEachOrdered',
] as const

describe('P4-D01 OperationCatalog（terminal）', () => {
  it('P4-D01: 終端操作のcategory・traits・SHORT_CIRCUITING・visualizationKindが正しい', () => {
    const shortCircuiting = ['findFirst', 'findAny', 'anyMatch', 'allMatch', 'noneMatch']
    for (const id of TERMINAL_OPS) {
      const def = catalog.get(id)
      expect(def.category, id).toBe('terminal')
      expect(def.traits, id).toContain('TERMINAL')
      // terminal内部の累積状態があってもSTATEFUL表示は行わない（§9）
      expect(def.traits, id).not.toContain('STATEFUL')
      if (shortCircuiting.includes(id)) {
        expect(def.traits, id).toContain('SHORT_CIRCUITING')
      } else {
        expect(def.traits, id).not.toContain('SHORT_CIRCUITING')
      }
      expect(def.jdkNotes.length, id).toBeGreaterThanOrEqual(1)
      expect(def.sourceRefs.length, id).toBeGreaterThanOrEqual(1)
    }
    expect(catalog.get('reduce').visualizationKind).toBe('累積リダクション型')
    expect(catalog.get('count').visualizationKind).toBe('累積リダクション型')
    expect(catalog.get('min').visualizationKind).toBe('候補更新型')
    expect(catalog.get('findFirst').visualizationKind).toBe('短絡検索・判定型')
    expect(catalog.get('anyMatch').visualizationKind).toBe('短絡検索・判定型')
    expect(catalog.get('toArray').visualizationKind).toBe('結果化型')
    expect(catalog.get('forEach').visualizationKind).toBe('結果化型')
    // Phase 5でcollect（Collector）が実装され登録済みになったため期待値を反転した
    // （Phase 5指示 §12の許可範囲。検証意味は「Catalog登録状態が現状と一致すること」を維持）
    expect(catalog.has('collect')).toBe(true)
  })
})

describe('P4-D02 結果TypeRefの導出', () => {
  it('P4-D02: Optional / primitive Optional / scalar / boolean / array / statistics / voidが正しい', () => {
    const cases: readonly [string, string, string?][] = [
      ['tmpl-reduce-concat', 'Optional<String>'],
      ['tmpl-reduce-int', 'OptionalInt'],
      ['tmpl-reduce-int-identity', 'int'],
      ['tmpl-reduce-salary', 'long'],
      ['tmpl-count', 'long'],
      ['tmpl-min-age', 'Optional<Employee>'],
      ['tmpl-min-int', 'OptionalInt'],
      ['tmpl-max-long', 'OptionalLong'],
      ['tmpl-min-double', 'OptionalDouble'],
      ['tmpl-findfirst', 'Optional<Employee>'],
      ['tmpl-anymatch', 'boolean'],
      ['tmpl-sum-int', 'int'],
      ['tmpl-sum-long', 'long'],
      ['tmpl-sum-double', 'double'],
      ['tmpl-average-int', 'OptionalDouble'],
      ['tmpl-stats-int', 'IntSummaryStatistics'],
      ['tmpl-stats-long', 'LongSummaryStatistics'],
      ['tmpl-stats-double', 'DoubleSummaryStatistics'],
      ['tmpl-toarray-object', 'Object[]'],
      ['tmpl-toarray-int', 'int[]'],
      ['tmpl-toarray-generator', 'String[]'],
      ['tmpl-foreach', 'void'],
    ]
    for (const [templateId, expected] of cases) {
      const def = makeDefinition(templateId)
      expect(formatTypeRef(def.resultType), templateId).toBe(expected)
    }
  })
})

describe('P4-D03 Reduction DSL', () => {
  it('P4-D03: 構造・評価・Javaコード・説明が同一ASTから一致する', () => {
    const sum = validateReductionStructure({ kind: 'numericSum' })
    expect(sum.ok).toBe(true)
    expect(reductionToJavaExpr({ kind: 'numericSum' })).toBe('(a, b) -> a + b')
    expect(describeReduction({ kind: 'numericSum' })).toContain('加算')
    expect(
      applyReduction({ kind: 'numericSum' }, { kind: 'int', value: 3 }, { kind: 'int', value: 4 }),
    ).toEqual({ kind: 'int', value: 7 })

    const concat = validateReductionStructure({ kind: 'stringConcat' })
    expect(concat.ok).toBe(true)
    expect(
      applyReduction(
        { kind: 'stringConcat' },
        { kind: 'string', value: 'Java' },
        { kind: 'string', value: 'SQL' },
      ),
    ).toEqual({ kind: 'string', value: 'JavaSQL' })

    const fieldSum = validateReductionStructure({ kind: 'employeeFieldSum', field: 'salary' })
    expect(fieldSum.ok).toBe(true)
    expect(reductionToJavaExpr({ kind: 'employeeFieldSum', field: 'salary' })).toBe(
      '(acc, e) -> acc + e.salary()',
    )
    const sato = STANDARD_EMPLOYEES[0]!
    expect(
      applyReduction(
        { kind: 'employeeFieldSum', field: 'salary' },
        { kind: 'long', value: 0 },
        { kind: 'employee', value: sato.value },
      ),
    ).toEqual({ kind: 'long', value: 5_500_000 })
    // 未知kind・許可外fieldを拒否
    expect(validateReductionStructure({ kind: 'customCode', code: 'a+b' }).ok).toBe(false)
    expect(validateReductionStructure({ kind: 'employeeFieldSum', field: 'skills' }).ok).toBe(false)
  })
})

describe('P4-D04 Reduction identity', () => {
  it('P4-D04: 型付きidentityを検証し、範囲外・型不一致を拒否する', () => {
    expect(validateReductionIdentity({ type: 'int', value: 0 }).ok).toBe(true)
    expect(validateReductionIdentity({ type: 'long', value: 0 }).ok).toBe(true)
    expect(validateReductionIdentity({ type: 'string', value: '' }).ok).toBe(true)
    expect(identityToJavaLiteral({ type: 'long', value: 0 })).toBe('0L')
    expect(identityToJavaLiteral({ type: 'string', value: '' })).toBe('""')
    expect(combinerToJavaExpr({ type: 'long', value: 0 })).toBe('Long::sum')
    expect(identityToSimValue({ type: 'int', value: 100 }, { kind: 'numericSum' }, 'int')).toEqual({
      kind: 'int',
      value: 100,
    })
    // 拒否: 未知型・int範囲外・小数・NaN
    expect(validateReductionIdentity({ type: 'boolean', value: true }).ok).toBe(false)
    expect(validateReductionIdentity({ type: 'int', value: 2_147_483_648 }).ok).toBe(false)
    expect(validateReductionIdentity({ type: 'int', value: 1.5 }).ok).toBe(false)
    expect(validateReductionIdentity({ type: 'double', value: Number.NaN }).ok).toBe(false)
    // identity型と要素型の不一致はinstantiateで拒否
    const registry = createDefaultTemplateRegistry()
    const template = registry.get('tmpl-reduce-int-identity', 1)!
    const mismatch = instantiateCustom(template, {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [1, 2] },
      'slot-reduction': { kind: 'numericSum' },
      'slot-identity': { type: 'long', value: 0 },
    })
    expect(mismatch.ok).toBe(false)
    if (!mismatch.ok) expect(mismatch.issues[0]?.code).toBe('TYPE_MISMATCH')
  })
})

describe('P4-D05 Array Generator DSL', () => {
  it('P4-D05: 許可済みgeneratorだけを受理し、要素型不一致を拒否する', () => {
    expect(validateArrayGenerator({ kind: 'arrayGenerator', elementTypeName: 'String' }).ok).toBe(true)
    expect(arrayGeneratorToJavaExpr({ kind: 'arrayGenerator', elementTypeName: 'Employee' })).toBe(
      'Employee[]::new',
    )
    // 任意コード・未知型を拒否
    expect(validateArrayGenerator({ kind: 'arrayGenerator', elementTypeName: 'Runtime' }).ok).toBe(false)
    expect(validateArrayGenerator('size -> new String[size]').ok).toBe(false)
    // 要素型不一致（Stream<String>へEmployee[]::new）はinstantiateで拒否
    const registry = createDefaultTemplateRegistry()
    const base = registry.get('tmpl-toarray-generator', 1)!
    const template: PipelineTemplate = {
      ...base,
      templateId: 'tmpl-test-generator-mismatch',
      parameterSlots: [
        {
          slotId: 'slot-generator',
          targetNodeId: 'node-sink',
          kind: 'arrayGenerator',
          required: true,
          allowedElementTypeNames: ['String', 'Employee'],
        },
      ],
    }
    const mismatch = instantiateCustom(template, {
      'slot-source': { kind: 'streamOf', elementTypeName: 'String', values: ['Java'] },
      'slot-generator': { kind: 'arrayGenerator', elementTypeName: 'Employee' },
    })
    expect(mismatch.ok).toBe(false)
    if (!mismatch.ok) expect(mismatch.issues[0]?.code).toBe('TYPE_MISMATCH')
  })
})

describe('P4-D06 既存DSLのterminal再利用と型検証', () => {
  it('P4-D06: match / min・max / forEachの型検証がoperationIdを迂回しない', () => {
    // matchのfieldCompareはEmployee要素のみ（IntStreamへは拒否）
    const matchOnInt = instantiateCustom(
      {
        templateId: 'tmpl-test-match-int',
        version: 1,
        targetOperationId: 'anyMatch',
        targetNodeId: 'node-sink',
        title: 'test',
        sourceDefinition: { slotId: 'slot-source', defaultDsl: null, allowedSourceKinds: ['arrayPrimitive'] },
        nodes: [tplSrc('source.arraysStream'), { nodeId: 'node-sink', operationId: 'anyMatch', role: 'terminal', slotId: 'slot-predicate-1' }],
        parameterSlots: [
          {
            slotId: 'slot-predicate-1',
            targetNodeId: 'node-sink',
            kind: 'predicate',
            required: true,
            allowedFields: ['age'],
            allowedOperators: ['GTE'],
          },
        ],
        allowedDslProfile: { predicateKinds: ['fieldCompare'] },
        supportedModes: ['standard'],
        jdkNotes: [],
        snapshotBudget: { limit: 500, estimatedMax: 30 },
      },
      {
        'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [1, 2] },
        'slot-predicate-1': { kind: 'fieldCompare', field: 'age', operator: 'GTE', value: { type: 'int', value: 30 } },
      },
    )
    expect(matchOnInt.ok).toBe(false)
    if (!matchOnInt.ok) expect(matchOnInt.issues[0]?.code).toBe('TYPE_MISMATCH')
    // primitive Streamのmin()へComparator指定は拒否
    const registry = createDefaultTemplateRegistry()
    const minInt = registry.get('tmpl-min-int', 1)!
    const template: PipelineTemplate = {
      ...minInt,
      templateId: 'tmpl-test-min-int-comparator',
      parameterSlots: [
        {
          slotId: 'slot-comparator',
          targetNodeId: 'node-sink',
          kind: 'comparator',
          required: true,
          allowedComparatorKinds: ['natural'],
          allowedFields: [],
        },
      ],
      nodes: [tplSrc('source.arraysStream'), { nodeId: 'node-sink', operationId: 'min', role: 'terminal', slotId: 'slot-comparator' }],
    }
    const comparatorOnPrimitive = instantiateCustom(template, {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [1, 2] },
      'slot-comparator': { kind: 'natural' },
    })
    expect(comparatorOnPrimitive.ok).toBe(false)
    // object Streamのmin()はComparator必須
    const minAge = registry.get('tmpl-min-age', 1)!
    const noComparator = instantiateCustom(
      { ...minAge, templateId: 'tmpl-test-min-nocomp', parameterSlots: [] },
      {},
      'standard',
      STANDARD_EMPLOYEES,
    )
    expect(noComparator.ok).toBe(false)
    if (!noComparator.ok) expect(noComparator.issues[0]?.code).toBe('SLOT_MISSING')
    // forEachのPRINT_FIELDはEmployee要素のみ
    const foreachOrdered = registry.get('tmpl-foreachordered', 1)!
    const printFieldOnInt = instantiateCustom(
      {
        ...foreachOrdered,
        templateId: 'tmpl-test-foreach-int-field',
        parameterSlots: [
          {
            slotId: 'slot-consumer',
            targetNodeId: 'node-sink',
            kind: 'consumer',
            required: true,
            allowedConsumerKinds: ['printValue', 'printField'],
            allowedFields: ['name'],
          },
        ],
      },
      {
        'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [1] },
        'slot-consumer': { kind: 'printField', field: 'name' },
      },
    )
    expect(printFieldOnInt.ok).toBe(false)
  })
})

describe('P4-D07 terminal Javaコード生成', () => {
  it('P4-D07: 各終端の正当なJava 25コードを生成し、Unicode矢印を混入しない', () => {
    const cases: readonly [string, string][] = [
      ['tmpl-reduce-concat', '.reduce((a, b) -> a + b);'],
      ['tmpl-reduce-int-identity', '.reduce(100, (a, b) -> a + b);'],
      ['tmpl-reduce-salary', '.reduce(0L, (acc, e) -> acc + e.salary(), Long::sum);'],
      ['tmpl-count', '.count();'],
      ['tmpl-min-age', '.min(Comparator.comparingInt(Employee::age));'],
      ['tmpl-min-int', '.min();'],
      ['tmpl-findfirst', '.findFirst();'],
      ['tmpl-anymatch', '.anyMatch(e -> e.age() >= 40);'],
      ['tmpl-sum-int', '.sum();'],
      ['tmpl-average-int', '.average();'],
      ['tmpl-stats-int', '.summaryStatistics();'],
      ['tmpl-toarray-object', '.toArray();'],
      ['tmpl-toarray-generator', '.toArray(String[]::new);'],
      ['tmpl-foreach', '.forEach(e -> System.out.println(e.name()));'],
      ['tmpl-foreachordered', '.forEachOrdered(System.out::println);'],
    ]
    for (const [templateId, expected] of cases) {
      const code = makeDefinition(templateId).javaCode.map((l) => l.text).join('\n')
      expect(code, templateId).toContain(expected)
      expect(code, templateId).not.toMatch(/[→⇒]/)
    }
    // void結果（forEach系）は代入文にしない
    const forEachCode = makeDefinition('tmpl-foreach').javaCode.map((l) => l.text).join('\n')
    expect(forEachCode).not.toContain('void result =')
    expect(forEachCode).toContain('employees.stream()')
    // 非void結果は結果型の代入文
    expect(makeDefinition('tmpl-count').javaCode.map((l) => l.text).join('\n')).toContain(
      'long result = employees.stream()',
    )
  })
})

describe('P4-D08 template構造', () => {
  it('P4-D08: 同一target operationへ複数templateを登録し、モードを区別する', () => {
    const registry = createDefaultTemplateRegistry()
    // reduce: 5 template（concat / concat-midempty / int / int-identity / salary）
    expect(registry.listByTargetOperation('reduce').length).toBeGreaterThanOrEqual(5)
    expect(registry.listByTargetOperation('min').length).toBeGreaterThanOrEqual(3)
    expect(registry.listByTargetOperation('toArray').length).toBeGreaterThanOrEqual(5)
    expect(registry.listByTargetOperation('count').length).toBeGreaterThanOrEqual(2)
    // 標準 / 途中0件 / 空ソースの区別（reduce / count / findFirstは3モード揃う）
    const modesFor = (op: string): Set<string> => {
      const modes = new Set<string>()
      for (const t of registry.listByTargetOperation(op)) {
        for (const m of t.supportedModes) modes.add(m)
      }
      return modes
    }
    for (const op of ['reduce', 'count', 'findFirst']) {
      expect(modesFor(op).has('standard'), op).toBe(true)
      expect(modesFor(op).has('midEmpty'), op).toBe(true)
      expect(modesFor(op).has('emptySource'), op).toBe(true)
    }
    // terminal templateのIDとnode ID / line IDが安定している
    const def = makeCustomDefinition(
      registry.get('tmpl-count', 1)!,
      {},
      'standard',
      STANDARD_EMPLOYEES,
    )
    expect(def.nodes.map((n) => n.nodeId)).toEqual(['node-src', 'node-sink'])
    expect(def.nodes[1]?.lineId).toBe('line-node-sink')
    void tplSink
  })
})
