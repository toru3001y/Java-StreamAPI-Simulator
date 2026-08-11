import { describe, expect, it } from 'vitest'
import { createDefaultCatalog } from '../../src/domain/catalog/operations'
import { createDefaultTemplateRegistry } from '../../src/domain/template/templates'
import {
  COLLECTOR_MAX_DEPTH,
  collectorDepth,
  collectorKindsOf,
} from '../../src/domain/dsl/collectorAst'
import {
  resolveCollectorType,
  validateCollectTriple,
  validateCollectorStructure,
} from '../../src/domain/dsl/validateCollector'
import { TYPE_EMPLOYEE, TYPE_STRING, formatTypeRef } from '../../src/domain/types/typeRef'
import { collectorToJavaExpr } from '../../src/domain/dsl/javaCode'

/** P5-D01〜P5-D02: Collector Catalog・Collector AST検証（Phase 5指示 §7.1・§7.2・§12.1） */

const salaryGte5m = {
  kind: 'fieldCompare',
  field: 'salary',
  operator: 'GTE',
  value: { type: 'long', value: 5_000_000 },
} as const

describe('P5-D01 Collector Catalog', () => {
  it('P5-D01: collect / 3引数collectのcategory・traits・型規則・handlerが正しい', () => {
    const catalog = createDefaultCatalog()
    for (const operationId of ['collect', 'collectTriple']) {
      expect(catalog.has(operationId), operationId).toBe(true)
      const def = catalog.get(operationId)
      expect(def.category, operationId).toBe('collector')
      expect(def.traits, operationId).toEqual(['TERMINAL'])
      // terminal内部の蓄積状態はJava APIのstateful intermediate operationとは別概念
      expect(def.traits, operationId).not.toContain('STATEFUL')
      expect(def.inputTypeRule.kind, operationId).toBe('anyStream')
      expect(def.outputTypeRule.kind, operationId).toBe('fromCollector')
      expect(def.handlerId, operationId).toBe(`handler.${operationId}`)
      expect(def.legendStates, operationId).toEqual(['UNEVALUATED', 'PROCESSING', 'PASSED'])
      expect(def.jdkNotes.length, operationId).toBeGreaterThan(0)
    }
  })

  it('P5-D01: §5.2の全Collector variantが実行可能templateとして登録されている', () => {
    const registry = createDefaultTemplateRegistry()
    const registeredKinds = new Set<string>()
    for (const template of registry.listAll()) {
      for (const slot of template.parameterSlots) {
        if (slot.kind === 'collector') {
          for (const kind of slot.allowedCollectorKinds) registeredKinds.add(kind)
        }
      }
    }
    const required = [
      'toList',
      'toSet',
      'toCollection',
      'joining',
      'counting',
      'summingInt',
      'summingLong',
      'summingDouble',
      'averagingInt',
      'averagingLong',
      'averagingDouble',
      'summarizingInt',
      'summarizingLong',
      'summarizingDouble',
      'minBy',
      'maxBy',
      'reducing',
      'mapping',
      'filtering',
      'flatMapping',
      'collectingAndThen',
      'groupingBy',
      'partitioningBy',
      'teeing',
    ]
    for (const kind of required) {
      expect(registeredKinds.has(kind), kind).toBe(true)
    }
    // 3引数collectのtemplateも登録済み
    expect(
      registry.listAll().some((t) => t.parameterSlots.some((s) => s.kind === 'collectTriple')),
    ).toBe(true)
  })
})

describe('P5-D02 Collector AST検証（closed schema）', () => {
  it('P5-D02: 正常なCollector ASTを受理する', () => {
    const ok = validateCollectorStructure({
      kind: 'groupingBy',
      classifier: { kind: 'employeeField', field: 'region' },
      mapFactoryId: null,
      downstream: { kind: 'counting' },
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(collectorKindsOf(ok.value)).toEqual(['groupingBy', 'counting'])
      expect(collectorToJavaExpr(ok.value)).toBe(
        'Collectors.groupingBy(Employee::region, Collectors.counting())',
      )
    }
  })

  it('P5-D02: 未知kindを構造化issueで拒否する', () => {
    const result = validateCollectorStructure({ kind: 'toMap' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe('STRUCTURE_UNKNOWN_KIND')
      expect(result.issues[0]?.path).toBe('collector.kind')
    }
  })

  it('P5-D02: 未知ID（supplier / mapFactory / finisher / merger）を拒否する', () => {
    const cases: readonly [unknown, string][] = [
      [{ kind: 'toCollection', supplierId: 'HashSet::new' }, 'collector.supplierId'],
      [
        {
          kind: 'groupingBy',
          classifier: { kind: 'employeeField', field: 'region' },
          mapFactoryId: 'HashMap::new',
          downstream: null,
        },
        'collector.mapFactoryId',
      ],
      [
        { kind: 'collectingAndThen', downstream: { kind: 'toList' }, finisherId: 'Set::copyOf' },
        'collector.finisherId',
      ],
      [
        {
          kind: 'teeing',
          left: { kind: 'counting' },
          right: { kind: 'counting' },
          mergerId: 'Object::new',
        },
        'collector.mergerId',
      ],
    ]
    for (const [input, path] of cases) {
      const result = validateCollectorStructure(input)
      expect(result.ok, path).toBe(false)
      if (!result.ok) {
        expect(result.issues.some((i) => i.code === 'WHITELIST_KIND' && i.path === path), path).toBe(
          true,
        )
      }
    }
  })

  it('P5-D02: 許可外キー・任意コード文字列をSTRUCTURE_INVALIDで拒否する（closed schema）', () => {
    for (const extraKey of ['functionBody', 'evalExpr', 'javaCode', 'extra']) {
      const result = validateCollectorStructure({ kind: 'counting', [extraKey]: 'x' })
      expect(result.ok, extraKey).toBe(false)
      if (!result.ok) {
        expect(result.issues[0]?.code, extraKey).toBe('STRUCTURE_INVALID')
        expect(result.issues[0]?.path, extraKey).toBe(`collector.${extraKey}`)
      }
    }
    // 入れ子ノードの許可外キーも再帰的に拒否する
    const nested = validateCollectorStructure({
      kind: 'mapping',
      mapper: { kind: 'fieldAccess', field: 'name' },
      downstream: { kind: 'toList', functionBody: 'return 1' },
    })
    expect(nested.ok).toBe(false)
    if (!nested.ok) {
      expect(nested.issues[0]?.path).toBe('collector.downstream.functionBody')
    }
  })

  it('P5-D02: 埋め込みDSL（mapper / predicate / literal / comparator / comparator key / reduction）の許可外キーも各階層で拒否する', () => {
    // mapperへの任意コード混入
    const badMapper = validateCollectorStructure({
      kind: 'mapping',
      mapper: { kind: 'fieldAccess', field: 'name', functionBody: 'return 1' },
      downstream: { kind: 'toList' },
    })
    expect(badMapper.ok).toBe(false)
    if (!badMapper.ok) {
      expect(
        badMapper.issues.some(
          (i) => i.code === 'STRUCTURE_INVALID' && i.path === 'collector.mapper.functionBody',
        ),
      ).toBe(true)
    }

    // flatMappingのmapperも同様
    const badFlatMapper = validateCollectorStructure({
      kind: 'flatMapping',
      mapper: { kind: 'fieldAccess', field: 'skills', evalExpr: 'x' },
      downstream: { kind: 'toList' },
    })
    expect(badFlatMapper.ok).toBe(false)
    if (!badFlatMapper.ok) {
      expect(badFlatMapper.issues.some((i) => i.path === 'collector.mapper.evalExpr')).toBe(true)
    }

    // predicate本体への混入
    const badPredicate = validateCollectorStructure({
      kind: 'filtering',
      predicate: { ...salaryGte5m, javaCode: 'e -> true' },
      downstream: { kind: 'toList' },
    })
    expect(badPredicate.ok).toBe(false)
    if (!badPredicate.ok) {
      expect(badPredicate.issues.some((i) => i.path === 'collector.predicate.javaCode')).toBe(true)
    }

    // predicate literal（value）への混入
    const badLiteral = validateCollectorStructure({
      kind: 'partitioningBy',
      predicate: {
        kind: 'fieldCompare',
        field: 'age',
        operator: 'GTE',
        value: { type: 'int', value: 30, javaCode: '30' },
      },
      downstream: null,
    })
    expect(badLiteral.ok).toBe(false)
    if (!badLiteral.ok) {
      expect(badLiteral.issues.some((i) => i.path === 'collector.predicate.value.javaCode')).toBe(true)
    }

    // comparator本体への混入
    const badComparator = validateCollectorStructure({
      kind: 'minBy',
      comparator: {
        kind: 'employeeKeys',
        keys: [{ field: 'age', direction: 'ASC' }],
        evalExpr: 'a - b',
      },
    })
    expect(badComparator.ok).toBe(false)
    if (!badComparator.ok) {
      expect(badComparator.issues.some((i) => i.path === 'collector.comparator.evalExpr')).toBe(true)
    }

    // comparatorの個別keyへの混入
    const badComparatorKey = validateCollectorStructure({
      kind: 'maxBy',
      comparator: {
        kind: 'employeeKeys',
        keys: [{ field: 'salary', direction: 'ASC', functionBody: 'x' }],
      },
    })
    expect(badComparatorKey.ok).toBe(false)
    if (!badComparatorKey.ok) {
      expect(
        badComparatorKey.issues.some((i) => i.path === 'collector.comparator.keys.0.functionBody'),
      ).toBe(true)
    }

    // reductionへの混入（Phase 4のclosed schemaが担保する）
    const badReduction = validateCollectorStructure({
      kind: 'reducing',
      reduction: { kind: 'stringConcat', functionBody: 'a + b' },
    })
    expect(badReduction.ok).toBe(false)
    if (!badReduction.ok) {
      expect(badReduction.issues.some((i) => i.path === 'collector.reduction.functionBody')).toBe(true)
    }

    // joiningのString定数への混入
    const badStringConst = validateCollectorStructure({
      kind: 'joining',
      delimiter: { type: 'string', value: ', ', javaCode: '","' },
      prefix: null,
      suffix: null,
    })
    expect(badStringConst.ok).toBe(false)
    if (!badStringConst.ok) {
      expect(badStringConst.issues.some((i) => i.path === 'collector.delimiter.javaCode')).toBe(true)
    }

    // 入れ子の奥（bucket downstream内のmapper）でも拒否する
    const deepBad = validateCollectorStructure({
      kind: 'groupingBy',
      classifier: { kind: 'employeeField', field: 'region' },
      mapFactoryId: null,
      downstream: {
        kind: 'mapping',
        mapper: { kind: 'fieldAccess', field: 'name', extra: 1 },
        downstream: { kind: 'toList' },
      },
    })
    expect(deepBad.ok).toBe(false)
    if (!deepBad.ok) {
      expect(deepBad.issues.some((i) => i.path === 'collector.downstream.mapper.extra')).toBe(true)
    }
  })

  it('P5-D02: minBy / maxByのComparator適用可能性を型検証で拒否する', () => {
    // Employee要素へnatural order Comparatorは適用できない（Engineへ渡すと比較時に失敗する）
    const naturalOnEmployee = resolveCollectorType(
      { kind: 'minBy', comparator: { kind: 'natural' } },
      TYPE_EMPLOYEE,
    )
    expect(naturalOnEmployee.ok).toBe(false)
    if (!naturalOnEmployee.ok) {
      expect(naturalOnEmployee.issues[0]?.code).toBe('TYPE_MISMATCH')
      expect(naturalOnEmployee.issues[0]?.path).toBe('collector.comparator')
      expect(naturalOnEmployee.issues[0]?.message).toContain('employeeKeys')
    }
    // String要素へemployeeKeys Comparatorも適用できない
    const employeeKeysOnString = resolveCollectorType(
      {
        kind: 'maxBy',
        comparator: { kind: 'employeeKeys', keys: [{ field: 'age', direction: 'ASC' }] },
      },
      TYPE_STRING,
    )
    expect(employeeKeysOnString.ok).toBe(false)
    if (!employeeKeysOnString.ok) {
      expect(employeeKeysOnString.issues[0]?.code).toBe('TYPE_MISMATCH')
    }
    // 正例: Employee × employeeKeys / String × natural
    expect(
      resolveCollectorType(
        {
          kind: 'minBy',
          comparator: { kind: 'employeeKeys', keys: [{ field: 'age', direction: 'ASC' }] },
        },
        TYPE_EMPLOYEE,
      ).ok,
    ).toBe(true)
    expect(
      resolveCollectorType({ kind: 'maxBy', comparator: { kind: 'natural' } }, TYPE_STRING).ok,
    ).toBe(true)
  })

  it('P5-D02: 許可外fieldを拒否する', () => {
    const result = validateCollectorStructure({ kind: 'summingInt', field: 'name' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'WHITELIST_FIELD')).toBe(true)
    }
    const classifier = validateCollectorStructure({
      kind: 'groupingBy',
      classifier: { kind: 'employeeField', field: 'age' },
      mapFactoryId: null,
      downstream: null,
    })
    expect(classifier.ok).toBe(false)
  })

  it('P5-D02: 型不一致（集計kindとfieldの数値種別、joining overload組合せ）を拒否する', () => {
    const wrongField = validateCollectorStructure({ kind: 'summingLong', field: 'age' })
    expect(wrongField.ok).toBe(false)
    if (!wrongField.ok) {
      expect(wrongField.issues.some((i) => i.code === 'TYPE_MISMATCH')).toBe(true)
    }
    // prefixのみ指定（suffixなし）は不正
    const badJoining = validateCollectorStructure({
      kind: 'joining',
      delimiter: { type: 'string', value: ', ' },
      prefix: { type: 'string', value: '[' },
      suffix: null,
    })
    expect(badJoining.ok).toBe(false)
    if (!badJoining.ok) {
      expect(badJoining.issues.some((i) => i.code === 'TYPE_MISMATCH')).toBe(true)
    }
  })

  it('P5-D02: 深すぎる入れ子をCOLLECTOR_DEPTHで拒否する', () => {
    // 深さ4は受理、深さ5は拒否（COLLECTOR_MAX_DEPTH = 4）
    const depth4 = {
      kind: 'groupingBy',
      classifier: { kind: 'employeeField', field: 'region' },
      mapFactoryId: null,
      downstream: {
        kind: 'mapping',
        mapper: { kind: 'fieldAccess', field: 'name' },
        downstream: {
          kind: 'collectingAndThen',
          downstream: { kind: 'toList' },
          finisherId: 'List::copyOf',
        },
      },
    }
    const ok = validateCollectorStructure(depth4)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(collectorDepth(ok.value)).toBe(COLLECTOR_MAX_DEPTH)
    const depth5 = {
      kind: 'groupingBy',
      classifier: { kind: 'employeeField', field: 'region' },
      mapFactoryId: null,
      downstream: depth4,
    }
    const rejected = validateCollectorStructure(depth5)
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) {
      expect(rejected.issues.some((i) => i.code === 'COLLECTOR_DEPTH')).toBe(true)
    }
  })

  it('P5-D02: Collector内部Predicateのoperator / fieldもホワイトリスト検証する', () => {
    const badOperator = validateCollectorStructure({
      kind: 'filtering',
      predicate: { kind: 'fieldCompare', field: 'age', operator: 'GT', value: { type: 'int', value: 30 } },
      downstream: { kind: 'toList' },
    })
    expect(badOperator.ok).toBe(false)
    if (!badOperator.ok) {
      expect(badOperator.issues.some((i) => i.code === 'WHITELIST_OPERATOR')).toBe(true)
    }
    const badField = validateCollectorStructure({
      kind: 'partitioningBy',
      predicate: { kind: 'fieldCompare', field: 'region', operator: 'GTE', value: { type: 'int', value: 1 } },
      downstream: null,
    })
    expect(badField.ok).toBe(false)
    if (!badField.ok) {
      expect(badField.issues.some((i) => i.code === 'WHITELIST_FIELD')).toBe(true)
    }
  })

  it('P5-D02: 3引数collectの許可外ID組合せを拒否する', () => {
    const ok = validateCollectTriple({
      kind: 'collectTriple',
      supplierId: 'ArrayList::new',
      accumulatorId: 'ArrayList::add',
      combinerId: 'ArrayList::addAll',
    })
    expect(ok.ok).toBe(true)
    const bad = validateCollectTriple({
      kind: 'collectTriple',
      supplierId: 'ArrayList::new',
      accumulatorId: 'ArrayList::add',
      combinerId: 'HashSet::addAll',
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.issues[0]?.code).toBe('WHITELIST_KIND')
  })

  it('P5-D02: 型解決で入力要素型に適用できないCollectorを拒否する', () => {
    // joiningはString要素にのみ適用できる
    const joiningOnEmployee = resolveCollectorType(
      { kind: 'joining', delimiter: null, prefix: null, suffix: null },
      TYPE_EMPLOYEE,
    )
    expect(joiningOnEmployee.ok).toBe(false)
    // filteringのfieldCompareはEmployee要素が必要
    const filteringOnString = resolveCollectorType(
      { kind: 'filtering', predicate: salaryGte5m, downstream: { kind: 'toList' } },
      TYPE_STRING,
    )
    expect(filteringOnString.ok).toBe(false)
    // List::copyOfはList結果にのみ適用できる
    const badFinisher = resolveCollectorType(
      { kind: 'collectingAndThen', downstream: { kind: 'counting' }, finisherId: 'List::copyOf' },
      TYPE_EMPLOYEE,
    )
    expect(badFinisher.ok).toBe(false)
    if (!badFinisher.ok) {
      expect(badFinisher.issues.some((i) => i.code === 'TYPE_MISMATCH')).toBe(true)
    }
    // teeing mergerのfield型とbranch結果型の整合
    const badTeeing = resolveCollectorType(
      {
        kind: 'teeing',
        left: { kind: 'counting' },
        right: { kind: 'counting' },
        mergerId: 'SalarySummary::new',
      },
      TYPE_EMPLOYEE,
    )
    expect(badTeeing.ok).toBe(false)
    const okTeeing = resolveCollectorType(
      {
        kind: 'teeing',
        left: { kind: 'counting' },
        right: { kind: 'averagingLong', field: 'salary' },
        mergerId: 'SalarySummary::new',
      },
      TYPE_EMPLOYEE,
    )
    expect(okTeeing.ok).toBe(true)
    if (okTeeing.ok) expect(formatTypeRef(okTeeing.value)).toBe('SalarySummary')
  })
})
