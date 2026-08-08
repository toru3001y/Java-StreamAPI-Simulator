import { describe, expect, it } from 'vitest'
import { validateStructure, validateTypes, validateWhitelist } from '../../src/domain/dsl/validate'
import { validateComparatorStructure } from '../../src/domain/dsl/validateComparator'
import { validateConsumerStructure, validateCount } from '../../src/domain/dsl/validateConsumer'
import { evaluateValuePredicate } from '../../src/domain/dsl/evaluate'
import {
  compareByComparator,
  comparatorKeyLabel,
  sortBuffer,
} from '../../src/domain/dsl/evaluateComparator'
import { evaluateConsumerMessage } from '../../src/domain/dsl/evaluateConsumer'
import {
  comparatorToJavaExpr,
  consumerToJavaExpr,
  predicateToJavaExpr,
} from '../../src/domain/dsl/javaCode'
import {
  describeComparator,
  describeConsumer,
  describePredicate,
  comparisonExpr,
} from '../../src/domain/dsl/explanation'
import type { ComparatorDsl } from '../../src/domain/dsl/comparatorAst'
import type { SimValue } from '../../src/domain/model/value'
import { STANDARD_EMPLOYEES } from '../../src/domain/fixtures/employees'
import { makeDefinition } from '../helpers'
import { runAllSnapshots } from '../helpers'

/** P3-D03〜P3-D07: Phase 3 DSL（Phase 3指示 §6） */

const LT5 = { kind: 'currentValueCompare', operator: 'LT', value: { type: 'int', value: 5 } }

function emp(index: number): SimValue {
  const element = STANDARD_EMPLOYEES[index]
  if (!element) throw new Error(`no employee at ${index}`)
  return { kind: 'employee', value: element.value }
}

describe('P3-D03 Predicate DSLの型一般化', () => {
  it('P3-D03: currentValueCompareを構造・whitelist・型で検証し、評価・Java・説明が一致する', () => {
    const structure = validateStructure(LT5)
    expect(structure.ok).toBe(true)
    if (!structure.ok) return
    const predicate = structure.value
    // whitelist: currentValueCompare + LT を許可するprofileで受理
    expect(
      validateWhitelist(predicate, {
        predicateKinds: ['currentValueCompare'],
        allowedFields: [],
        allowedOperators: ['LT'],
      }).ok,
    ).toBe(true)
    // 型検証
    expect(validateTypes(predicate).ok).toBe(true)
    // 評価・Javaコード・説明が同じASTから一致する
    expect(evaluateValuePredicate(predicate, { kind: 'int', value: 4 })).toBe(true)
    expect(evaluateValuePredicate(predicate, { kind: 'int', value: 6 })).toBe(false)
    expect(evaluateValuePredicate(predicate, { kind: 'boxedInt', value: 5 })).toBe(false)
    expect(predicateToJavaExpr(predicate)).toBe('n -> n < 5')
    expect(describePredicate(predicate)).toBe('現在値nが5未満かを判定します')
    expect(comparisonExpr(predicate, 6)).toBe('6 < 5')
  })

  it('P3-D03: 未知kind・未知operator・型不一致・許可外literalを拒否する', () => {
    expect(validateStructure({ kind: 'anything', operator: 'LT', value: { type: 'int', value: 5 } }).ok).toBe(false)
    // 未知operatorはwhitelistで拒否
    const structure = validateStructure({
      kind: 'currentValueCompare',
      operator: 'NEQ',
      value: { type: 'int', value: 5 },
    })
    expect(structure.ok).toBe(true)
    if (structure.ok) {
      const wl = validateWhitelist(structure.value, {
        predicateKinds: ['currentValueCompare'],
        allowedFields: [],
        allowedOperators: ['LT'],
      })
      expect(wl.ok).toBe(false)
      if (!wl.ok) expect(wl.issues[0]?.code).toBe('WHITELIST_OPERATOR')
    }
    // string literalとの比較は型不一致
    const str = validateStructure({
      kind: 'currentValueCompare',
      operator: 'LT',
      value: { type: 'string', value: 'a' },
    })
    expect(str.ok).toBe(true)
    if (str.ok) expect(validateTypes(str.value).ok).toBe(false)
    // 許可外literal型は構造検証で拒否
    expect(
      validateStructure({ kind: 'currentValueCompare', operator: 'LT', value: { type: 'float', value: 1 } }).ok,
    ).toBe(false)
    // 既存のfieldCompare + GTEは維持される
    const field = validateStructure({
      kind: 'fieldCompare',
      field: 'age',
      operator: 'GTE',
      value: { type: 'int', value: 30 },
    })
    expect(field.ok).toBe(true)
    if (field.ok) expect(predicateToJavaExpr(field.value)).toBe('e -> e.age() >= 30')
  })
})

describe('P3-D04 Comparator DSL', () => {
  it('P3-D04: natural / field ASC・DESC / 複合キーを検証・評価し、Javaコードと一致する', () => {
    expect(validateComparatorStructure({ kind: 'natural' }).ok).toBe(true)
    expect(comparatorToJavaExpr({ kind: 'natural' })).toBe('Comparator.naturalOrder()')

    const regionAsc: ComparatorDsl = { kind: 'employeeKeys', keys: [{ field: 'region', direction: 'ASC' }] }
    expect(validateComparatorStructure(regionAsc).ok).toBe(true)
    expect(comparatorToJavaExpr(regionAsc)).toBe('Comparator.comparing(Employee::region)')
    expect(describeComparator(regionAsc)).toContain('region')

    const ageAsc: ComparatorDsl = { kind: 'employeeKeys', keys: [{ field: 'age', direction: 'ASC' }] }
    expect(comparatorToJavaExpr(ageAsc)).toBe('Comparator.comparingInt(Employee::age)')
    const salaryDesc: ComparatorDsl = { kind: 'employeeKeys', keys: [{ field: 'salary', direction: 'DESC' }] }
    expect(comparatorToJavaExpr(salaryDesc)).toBe('Comparator.comparingLong(Employee::salary).reversed()')
    const evalAsc: ComparatorDsl = { kind: 'employeeKeys', keys: [{ field: 'evaluation', direction: 'ASC' }] }
    expect(comparatorToJavaExpr(evalAsc)).toBe('Comparator.comparingDouble(Employee::evaluation)')
    const deptName: ComparatorDsl = { kind: 'employeeKeys', keys: [{ field: 'department.name', direction: 'ASC' }] }
    expect(comparatorToJavaExpr(deptName)).toBe('Comparator.comparing((Employee e) -> e.department().name())')

    const composite: ComparatorDsl = {
      kind: 'employeeKeys',
      keys: [
        { field: 'region', direction: 'ASC' },
        { field: 'age', direction: 'DESC' },
      ],
    }
    expect(comparatorToJavaExpr(composite)).toBe(
      'Comparator.comparing(Employee::region).thenComparing(Employee::age, Comparator.reverseOrder())',
    )

    // 評価と表示コードの一致: age ASCで実際に並ぶ（鈴木27 → 田中29 → 佐藤35 → 高橋42）
    const entries = STANDARD_EMPLOYEES.map((e) => ({ value: { kind: 'employee', value: e.value } as SimValue }))
    const byAge = sortBuffer(entries, ageAsc).map((e) => (e.value.kind === 'employee' ? e.value.value.name : ''))
    expect(byAge).toEqual(['鈴木', '田中', '佐藤', '高橋'])
    // salary DESC
    const bySalaryDesc = sortBuffer(entries, salaryDesc).map((e) =>
      e.value.kind === 'employee' ? e.value.value.name : '',
    )
    expect(bySalaryDesc).toEqual(['高橋', '佐藤', '田中', '鈴木'])
    // 複合キー: region ASC → 同region内age DESC（関東: 高橋42 → 佐藤35）
    const byComposite = sortBuffer(entries, composite).map((e) =>
      e.value.kind === 'employee' ? e.value.value.name : '',
    )
    expect(byComposite).toEqual(['田中', '高橋', '佐藤', '鈴木'])
    // キー表示
    expect(comparatorKeyLabel(regionAsc, emp(0))).toBe('region="関東"')
    expect(comparatorKeyLabel(composite, emp(0))).toBe('region="関東", age=35')
  })

  it('P3-D04: 未知field・未知direction・skills・型不一致を拒否する', () => {
    expect(validateComparatorStructure({ kind: 'unknown' }).ok).toBe(false)
    expect(
      validateComparatorStructure({ kind: 'employeeKeys', keys: [{ field: 'password', direction: 'ASC' }] }).ok,
    ).toBe(false)
    // skillsはListでありComparatorキーに含めない（§6.3）
    const skills = validateComparatorStructure({
      kind: 'employeeKeys',
      keys: [{ field: 'skills', direction: 'ASC' }],
    })
    expect(skills.ok).toBe(false)
    if (!skills.ok) expect(skills.issues[0]?.code).toBe('WHITELIST_FIELD')
    expect(
      validateComparatorStructure({ kind: 'employeeKeys', keys: [{ field: 'age', direction: 'UP' }] }).ok,
    ).toBe(false)
    expect(validateComparatorStructure({ kind: 'employeeKeys', keys: [] }).ok).toBe(false)
    // employeeKeys ComparatorをEmployee以外へ適用すると評価エラー（型不一致）
    expect(() =>
      compareByComparator({ kind: 'employeeKeys', keys: [{ field: 'age', direction: 'ASC' }] }, {
        kind: 'int',
        value: 1,
      }, { kind: 'int', value: 2 }),
    ).toThrow()
  })
})

describe('P3-D05 limit / skip引数', () => {
  it('P3-D05: 0と正数を受理し、負数・小数・NaN・Infinity・safe integer外を拒否する', () => {
    expect(validateCount(0).ok).toBe(true)
    expect(validateCount(3).ok).toBe(true)
    expect(validateCount(Number.MAX_SAFE_INTEGER).ok).toBe(true)
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2 ** 53, '3', null]) {
      const result = validateCount(bad)
      expect(result.ok, String(bad)).toBe(false)
      if (!result.ok) expect(result.issues[0]?.code).toBe('TYPE_MISMATCH')
    }
    // Java APIの引数型がlongであることを説明へ反映する（§6.4）
    const rejected = validateCount(-1)
    if (!rejected.ok) expect(rejected.issues[0]?.message).toContain('long')
  })
})

describe('P3-D06 Consumer DSL', () => {
  it('P3-D06: PRINT_VALUE / PRINT_FIELDの評価・Java・説明が一致する', () => {
    const printValue = validateConsumerStructure({ kind: 'printValue' })
    expect(printValue.ok).toBe(true)
    if (printValue.ok) {
      expect(consumerToJavaExpr(printValue.value)).toBe('System.out::println')
      expect(evaluateConsumerMessage(printValue.value, { kind: 'int', value: 7 })).toBe('7')
      expect(describeConsumer(printValue.value)).toContain('System.out.println')
    }
    const printField = validateConsumerStructure({ kind: 'printField', field: 'name' })
    expect(printField.ok).toBe(true)
    if (printField.ok) {
      expect(consumerToJavaExpr(printField.value)).toBe('e -> System.out.println(e.name())')
      expect(evaluateConsumerMessage(printField.value, emp(0))).toBe('佐藤')
      expect(describeConsumer(printField.value)).toContain('name()')
    }
  })

  it('P3-D06: 未知kind・許可外field・任意コード文字列を拒否する', () => {
    expect(validateConsumerStructure({ kind: 'execute', code: 'System.exit(0)' }).ok).toBe(false)
    expect(validateConsumerStructure({ kind: 'printField', field: 'skills' }).ok).toBe(false)
    expect(validateConsumerStructure({ kind: 'printField', field: 'department' }).ok).toBe(false)
    expect(validateConsumerStructure('e -> sideEffect(e)').ok).toBe(false)
  })
})

describe('P3-D07 Phase 3 Source of Truth', () => {
  it('P3-D07: Predicate / Comparator / Consumer / count ASTから評価・型・コード・説明・表示値が一致する', () => {
    // takeWhile: Javaコード行とengineのsnapshot式が同じASTから生成される
    const takeDef = makeDefinition('tmpl-takewhile')
    const takeNode = takeDef.nodes.find((n) => n.operationId === 'takeWhile')
    expect(takeNode?.predicate).toBeDefined()
    const takeCode = takeDef.javaCode.map((l) => l.text).join('\n')
    expect(takeCode).toContain('.takeWhile(n -> n < 5)')
    const takeSnapshots = runAllSnapshots(takeDef)
    const evaluated = takeSnapshots.find((s) => s.kind === 'PREDICATE_EVALUATED')
    expect(evaluated?.processing?.expression).toBe('n -> n < 5')

    // sorted(Comparator): コード・context表示・実際の並びが一致する
    const sortedDef = makeDefinition('tmpl-sorted-comparator')
    const sortedCode = sortedDef.javaCode.map((l) => l.text).join('\n')
    expect(sortedCode).toContain('.sorted(Comparator.comparing(Employee::region))')
    const sortedSnapshots = runAllSnapshots(sortedDef)
    const confirmed = sortedSnapshots.find((s) => s.kind === 'SORT_ORDER_CONFIRMED')
    const ctx = confirmed?.operationContexts['node-sorted']
    expect(ctx?.kind).toBe('sorted')
    if (ctx?.kind === 'sorted') {
      expect(ctx.comparatorLabel).toBe('Comparator.comparing(Employee::region)')
      expect(ctx.confirmedOrder?.map((e) => e.label)).toEqual([
        '田中（age=29）',
        '佐藤（age=35）',
        '高橋（age=42）',
        '鈴木（age=27）',
      ])
    }

    // peek: コード・Side Effect actionExprが一致する
    const peekDef = makeDefinition('tmpl-peek')
    const peekCode = peekDef.javaCode.map((l) => l.text).join('\n')
    expect(peekCode).toContain('.peek(e -> System.out.println(e.name()))')
    const peekSnapshots = runAllSnapshots(peekDef)
    const last = peekSnapshots[peekSnapshots.length - 1]
    expect(last?.sideEffects[0]?.actionExpr).toBe('e -> System.out.println(e.name())')
    expect(last?.sideEffects[0]?.actionLabel).toBe('PRINT_FIELD')

    // limit: countがコード・contextへ一致して反映される
    const limitDef = makeDefinition('tmpl-limit')
    expect(limitDef.javaCode.map((l) => l.text).join('\n')).toContain('.limit(3)')
    const limitSnapshots = runAllSnapshots(limitDef)
    const limitCtx = limitSnapshots[limitSnapshots.length - 1]?.operationContexts['node-limit']
    expect(limitCtx?.kind).toBe('limit')
    if (limitCtx?.kind === 'limit') expect(limitCtx.maxSize).toBe(3)

    // Javaコード・式にUnicode矢印を混入しない（§17.4）
    for (const def of [takeDef, sortedDef, peekDef, limitDef]) {
      expect(def.javaCode.map((l) => l.text).join('\n')).not.toMatch(/[→⇒]/)
    }
  })
})
