import { describe, expect, it } from 'vitest'
import {
  validateStructure,
  validateTypes,
  validateWhitelist,
} from '../../src/domain/dsl/validate'
import { evaluatePredicate } from '../../src/domain/dsl/evaluate'
import { predicateToJavaExpr } from '../../src/domain/dsl/javaCode'
import { comparisonExpr, describePredicate } from '../../src/domain/dsl/explanation'
import type { DslPredicate } from '../../src/domain/dsl/ast'
import { STANDARD_EMPLOYEES } from '../../src/domain/fixtures/employees'
import { makeDefinition } from '../helpers'

const PROFILE = {
  predicateKinds: ['fieldCompare'],
  allowedFields: ['age'],
  allowedOperators: ['GTE'],
}

const age30: DslPredicate = {
  kind: 'fieldCompare',
  field: 'age',
  operator: 'GTE',
  value: { type: 'int', value: 30 },
}

describe('P1-D05 DSL構造', () => {
  it('P1-D05: 正常なPredicateを受理する', () => {
    const result = validateStructure({
      kind: 'fieldCompare',
      field: 'age',
      operator: 'GTE',
      value: { type: 'int', value: 30 },
    })
    expect(result.ok).toBe(true)
  })

  it('P1-D05: 未知kindを拒否する', () => {
    const result = validateStructure({ kind: 'regexMatch', field: 'age' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.code).toBe('STRUCTURE_UNKNOWN_KIND')
  })

  it('P1-D05: 許可外field・許可外operatorを拒否する', () => {
    const badField = validateWhitelist({ ...age30, field: 'salary' }, PROFILE)
    expect(badField.ok).toBe(false)
    if (!badField.ok) expect(badField.issues[0]?.code).toBe('WHITELIST_FIELD')

    const badOperator = validateWhitelist({ ...age30, operator: 'LT' }, PROFILE)
    expect(badOperator.ok).toBe(false)
    if (!badOperator.ok) expect(badOperator.issues[0]?.code).toBe('WHITELIST_OPERATOR')
  })

  it('P1-D05: 構造不正（value欠落・型不明）を拒否する', () => {
    const missing = validateStructure({ kind: 'fieldCompare', field: 'age', operator: 'GTE' })
    expect(missing.ok).toBe(false)
    const badLiteral = validateStructure({
      kind: 'fieldCompare',
      field: 'age',
      operator: 'GTE',
      value: { type: 'date', value: '2026-01-01' },
    })
    expect(badLiteral.ok).toBe(false)
  })
})

describe('P1-D06 DSL型', () => {
  it('P1-D06: age GTE intを受理する', () => {
    expect(validateTypes(age30).ok).toBe(true)
  })

  it('P1-D06: age GTE Stringを拒否する（型不一致）', () => {
    const result = validateTypes({
      ...age30,
      value: { type: 'string', value: '30' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.code).toBe('TYPE_MISMATCH')
  })
})

describe('P1-D07 DSL評価', () => {
  it('P1-D07: 35はtrue、27はfalse', () => {
    const sato = STANDARD_EMPLOYEES[0]
    const suzuki = STANDARD_EMPLOYEES[1]
    expect(sato && evaluatePredicate(age30, sato.value)).toBe(true)
    expect(suzuki && evaluatePredicate(age30, suzuki.value)).toBe(false)
  })
})

describe('P1-D08 Javaコード生成', () => {
  it('P1-D08: e -> e.age() >= 30を生成する', () => {
    expect(predicateToJavaExpr(age30)).toBe('e -> e.age() >= 30')
  })

  it('P1-D08: 生成コードにUnicode矢印を混入しない（ASCIIの-> / >=のみ）', () => {
    const def = makeDefinition('tmpl-filter-basic', 'standard')
    const allText = def.javaCode.map((l) => l.text).join('\n')
    expect(allText).toContain('.filter(e -> e.age() >= 30)')
    expect(allText).toContain('record Employee(')
    expect(allText).toContain('.toList();')
    expect(allText).not.toMatch(/[→⇒]/)
  })

  it('P1-D08: Pipeline行がactive node対応の安定line IDを持つ', () => {
    const def = makeDefinition('tmpl-filter-chain', 'standard')
    for (const node of def.nodes) {
      const line = def.javaCode.find((l) => l.nodeId === node.nodeId)
      expect(line?.lineId).toBe(node.lineId)
    }
    // 5個のfilter行がすべて別line ID
    const filterLines = def.javaCode.filter((l) => l.text.includes('.filter('))
    expect(filterLines).toHaveLength(5)
    expect(new Set(filterLines.map((l) => l.lineId)).size).toBe(5)
  })

  it('P1-D08: 空ソースではdatasetがList.of()になる', () => {
    const def = makeDefinition('tmpl-filter-basic', 'emptySource')
    const allText = def.javaCode.map((l) => l.text).join('\n')
    expect(allText).toContain('List<Employee> employees = List.of();')
  })
})

describe('P1-D09 説明生成', () => {
  it('P1-D09: DSLと同じfield・operator・値を説明へ反映する', () => {
    expect(describePredicate(age30)).toBe('ageが30以上かを判定します')
    expect(comparisonExpr(age30, 35)).toBe('35 >= 30')
    const other: DslPredicate = { ...age30, value: { type: 'int', value: 40 } }
    expect(describePredicate(other)).toBe('ageが40以上かを判定します')
  })

  it('P1-D09: 同じASTから評価・コード・説明が食い違わない', () => {
    const sato = STANDARD_EMPLOYEES[0]
    expect(sato && evaluatePredicate(age30, sato.value)).toBe(true)
    expect(predicateToJavaExpr(age30)).toContain('>= 30')
    expect(describePredicate(age30)).toContain('30')
  })
})
