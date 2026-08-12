import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectFixtureJavaCode, GATHER_TEMPLATES, importScenario } from '../p6-helpers'
import { assignDepartmentVarNames, javaStringLiteral } from '../../src/domain/dsl/javaCode'
import { formatDoubleLiteral, formatLongLiteral } from '../../src/domain/model/value'
import { DSL_VERSION } from '../../src/domain/dsl/ast'
import {
  AGE_MAX,
  AGE_MIN,
  DOUBLE_ABS_MAX,
  DOUBLE_ABS_MIN,
  EVALUATION_MAX,
  EVALUATION_MIN,
  INT32_MAX,
  INT32_MIN,
  SALARY_MAX,
  SALARY_MIN,
  isContractDouble,
} from '../../src/application/importContract'
import type { DatasetElement } from '../../src/domain/model/employee'
import type { Result } from '../../src/domain/types/result'
import type { Scenario } from '../../src/domain/scenario/scenario'

/**
 * P6-D18〜P6-D20: Javaコード表示のリテラル契約（Phase 6指示 §7.7・§12.1、v0.10 §7.3）。
 */

function javaCodeText(result: Result<Scenario>): string {
  expect(result.ok, result.ok ? '' : JSON.stringify(result.issues)).toBe(true)
  if (!result.ok) return ''
  return result.value.pipeline.javaCode.map((line) => line.text).join('\n')
}

function employee(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: '通常',
    age: 30,
    salary: 5_000_000,
    evaluation: 4,
    region: '関東',
    hireDate: '2020-01-01',
    department: { name: '開発部', division: '技術本部' },
    skills: ['Java'],
    ...overrides,
  }
}

function filterCandidate(dataset: unknown[]): string {
  return JSON.stringify({
    dslVersion: DSL_VERSION,
    templateId: 'tmpl-filter-basic',
    templateVersion: 1,
    mode: 'standard',
    dataset,
    dslParameters: {
      'slot-predicate-1': {
        kind: 'fieldCompare',
        field: 'age',
        operator: 'GTE',
        value: { type: 'int', value: 30 },
      },
    },
    title: 'Javaコード表示の取込サンプル',
    description: '外部入力由来の文字列・数値のJavaコード表示を確認します。',
  })
}

/** true / falseの双方を成立させるための基準2件 */
const BASE_PAIR = [employee({ name: '通過', age: 40 }), employee({ name: '除外', age: 20 })]

describe('P6-D18 文字列エスケープ契約', () => {
  it('P6-D18: 引用符・バックスラッシュを含む取込文字列が正当なエスケープ済みリテラルになる', () => {
    const tricky = employee({
      name: 'a"b\\c',
      region: 'r"1',
      department: { name: '品"証部', division: '技\\本部' },
      skills: ['S"1', 'S\\2'],
      age: 35,
    })
    const code = javaCodeText(importScenario('tmpl-filter-basic', 'standard', filterCandidate([...BASE_PAIR, tricky])))
    expect(code).toContain('new Employee("a\\"b\\\\c", 35,')
    expect(code).toContain('"r\\"1"')
    expect(code).toContain('new Department("品\\"証部", "技\\\\本部")')
    expect(code).toContain('List.of("S\\"1", "S\\\\2")')
    // 生の未エスケープ引用符・バックスラッシュが残っていない
    expect(code).not.toContain('"a"b\\c"')
  })

  it('P6-D18: source DSL由来の文字列（Stream.of / String[] / mapper prefix）もエスケープされる', () => {
    const streamOf = JSON.stringify({
      dslVersion: DSL_VERSION,
      templateId: 'tmpl-src-of',
      templateVersion: 1,
      mode: 'standard',
      dslParameters: {
        'slot-source': { kind: 'streamOf', elementTypeName: 'String', values: ['a"b', 'c\\d'] },
        'slot-mapper-1': { kind: 'toUpper' },
      },
      title: 'Stream.ofのエスケープ確認',
      description: '引用符・バックスラッシュを含むvaluesを表示します。',
    })
    expect(javaCodeText(importScenario('tmpl-src-of', 'standard', streamOf))).toContain(
      'Stream.of("a\\"b", "c\\\\d")',
    )

    const arrayObject = JSON.stringify({
      dslVersion: DSL_VERSION,
      templateId: 'tmpl-src-arrays-object',
      templateVersion: 1,
      mode: 'standard',
      dslParameters: {
        'slot-source': {
          kind: 'arrayObject',
          arrayId: 'names',
          elementTypeName: 'String',
          values: ['x"y'],
        },
        'slot-mapper-1': { kind: 'toUpper' },
      },
      title: 'String配列のエスケープ確認',
      description: '引用符を含む配列要素を表示します。',
    })
    expect(javaCodeText(importScenario('tmpl-src-arrays-object', 'standard', arrayObject))).toContain(
      'String[] names = { "x\\"y" };',
    )

    const mapToObj = JSON.stringify({
      dslVersion: DSL_VERSION,
      templateId: 'tmpl-maptoobj',
      templateVersion: 1,
      mode: 'standard',
      dslParameters: {
        'slot-source': { kind: 'range', from: 1, to: 4 },
        'slot-mapper-1': { kind: 'prefix', prefix: 'No."' },
      },
      title: 'mapToObjのエスケープ確認',
      description: '引用符を含むprefixを表示します。',
    })
    expect(javaCodeText(importScenario('tmpl-maptoobj', 'standard', mapToObj))).toContain(
      'n -> "No.\\"" + n',
    )
  })

  /**
   * Phase 7指示 §12冒頭で許可された「一覧前提が壊れる既存assertion」の最小更新。
   * goldenはPhase 6改修前の全fixture Javaコードのスナップショットであり、
   * Phase 7でtemplateを7件追加するとキー集合の完全一致は必ず崩れる。
   *
   * 検証意味（**既存fixtureのJavaコード出力が改修前後で不変**）はそのまま保存し、
   * 追加キーがPhase 7のgather template由来のものだけであることを明示的に検証する
   * （新規キーが無検査で増えることを防ぐ。goldenファイル自体は書き換えない）。
   */
  it('P6-D18: 全fixtureのJavaコード出力が改修前後で不変である', () => {
    const golden = JSON.parse(
      readFileSync(path.join(__dirname, '../fixtures/fixture-javacode-before-p6.json'), 'utf8'),
    ) as Record<string, string[]>
    const current = collectFixtureJavaCode()
    // golden（改修前の既存fixture）は1件も欠落せず、出力も完全に不変であること
    const currentKeys = Object.keys(current)
    const goldenKeys = Object.keys(golden).sort()
    expect(goldenKeys.filter((key) => !currentKeys.includes(key))).toEqual([])
    for (const key of goldenKeys) {
      expect(current[key], key).toEqual(golden[key])
    }
    // 追加キーはPhase 7のgather template × modeのものだけ
    const gatherTemplateIds = GATHER_TEMPLATES.map((t) => t.templateId)
    const addedKeys = currentKeys.filter((key) => !goldenKeys.includes(key)).sort()
    const expectedAdded = GATHER_TEMPLATES.flatMap((t) =>
      t.supportedModes.map((mode) => `${t.templateId}:${mode}`),
    ).sort()
    expect(addedKeys).toEqual(expectedAdded)
    expect(gatherTemplateIds).toHaveLength(7)
  })

  it('P6-D18: javaStringLiteralは安全な文字列を変更しない（fixture出力不変の根拠）', () => {
    for (const value of ['佐藤', 'Java', '関東', '', ', ', '[', ']']) {
      expect(javaStringLiteral(value)).toBe(`"${value}"`)
    }
  })
})

describe('P6-D19 部署変数名の一般化', () => {
  function datasetOf(departments: { name: string; division: string }[]): DatasetElement[] {
    return departments.map((department, index) => ({
      elementId: `imp-${String(index + 1).padStart(3, '0')}`,
      value: {
        name: `社員${index}`,
        age: 30,
        salary: 5_000_000,
        evaluation: 4,
        region: '関東',
        hireDate: '2020-01-01',
        department,
        skills: [],
      },
    }))
  }

  it('P6-D19: 固定対応表（development / sales）は維持される', () => {
    const names = assignDepartmentVarNames(
      datasetOf([
        { name: '開発部', division: '技術本部' },
        { name: '営業部', division: '営業本部' },
      ]),
    )
    expect([...names.values()]).toEqual(['development', 'sales'])
  })

  it('P6-D19: 固定表にない組は出現順にdept1, dept2…を割り当てる（採番は未対応組のみ）', () => {
    const names = assignDepartmentVarNames(
      datasetOf([
        { name: '品質保証部', division: '技術本部' },
        { name: '開発部', division: '技術本部' },
        { name: '営業推進部', division: '営業本部' },
        { name: '品質保証部', division: '技術本部' },
      ]),
    )
    expect([...names.values()]).toEqual(['dept1', 'development', 'dept2'])
  })

  it('P6-D19: 同名部署でdivisionが異なる場合は別変数になる', () => {
    const names = assignDepartmentVarNames(
      datasetOf([
        { name: '開発部', division: '技術本部' },
        { name: '開発部', division: '研究本部' },
      ]),
    )
    expect([...names.values()]).toEqual(['development', 'dept1'])
    expect(new Set(names.values()).size).toBe(2)
  })

  it('P6-D19: 取込datasetのJavaコード表示にnullが現れず、name + divisionの組で宣言される', () => {
    const dataset = [
      employee({ name: '通過', age: 40, department: { name: '開発部', division: '研究本部' } }),
      employee({ name: '除外', age: 20, department: { name: '開発部', division: '技術本部' } }),
      employee({ name: '別部署', age: 45, department: { name: '品質保証部', division: '技術本部' } }),
    ]
    const code = javaCodeText(importScenario('tmpl-filter-basic', 'standard', filterCandidate(dataset)))
    expect(code).toContain('Department dept1 = new Department("開発部", "研究本部");')
    expect(code).toContain('Department development = new Department("開発部", "技術本部");')
    expect(code).toContain('Department dept2 = new Department("品質保証部", "技術本部");')
    // Department引数にnullが現れない
    expect(code).not.toContain(', null,')
    for (const varName of ['dept1', 'development', 'dept2']) {
      expect(code).toContain(`, ${varName}, List.of(`)
    }
  })
})

describe('P6-D20 数値リテラル契約', () => {
  it('P6-D20: Contract受理値 ⊆ formatterが正当に変換できる値（DSL数値の境界）', () => {
    const boundaries = [
      INT32_MAX,
      INT32_MIN,
      Number.MAX_SAFE_INTEGER,
      -Number.MAX_SAFE_INTEGER,
      0,
      DOUBLE_ABS_MIN,
      DOUBLE_ABS_MAX,
    ]
    for (const value of boundaries) {
      // intの境界はそのまま10進表記
      if (Number.isSafeInteger(value)) {
        expect(String(value), String(value)).toMatch(/^-?\d+$/)
        expect(formatLongLiteral(value), String(value)).toMatch(/^-?[\d_]+L$/)
      }
      if (isContractDouble(value)) {
        const literal = formatDoubleLiteral(value)
        expect(literal, String(value)).toMatch(/^-?\d+(\.\d+)?$/)
        expect(literal.toLowerCase(), String(value)).not.toContain('e')
      }
    }
  })

  it('P6-D20: int配列・long配列・double配列の境界値が指数表記なしで表示される', () => {
    const primitiveArray = (templateId: string, primitive: string, values: number[]) =>
      JSON.stringify({
        dslVersion: DSL_VERSION,
        templateId,
        templateVersion: 1,
        mode: 'standard',
        dslParameters: {
          'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive, values },
        },
        title: '境界値の取込',
        description: '数値境界値のJavaコード表示を確認します。',
      })

    const intCode = javaCodeText(
      importScenario(
        'tmpl-src-arrays-int',
        'standard',
        primitiveArray('tmpl-src-arrays-int', 'int', [INT32_MAX, INT32_MIN]),
      ),
    )
    expect(intCode).toContain('int[] numbers = { 2147483647, -2147483648 };')

    const longCode = javaCodeText(
      importScenario(
        'tmpl-src-arrays-long',
        'standard',
        primitiveArray('tmpl-src-arrays-long', 'long', [
          Number.MAX_SAFE_INTEGER,
          -Number.MAX_SAFE_INTEGER,
        ]),
      ),
    )
    // primitive配列のlong要素は桁区切りなしの`nL`形式（どちらもJavaのlong literalとして正当）
    expect(longCode).toContain('long[] numbers = { 9007199254740991L, -9007199254740991L };')
    expect(longCode).not.toMatch(/\d[eE][+-]?\d/)

    const doubleCode = javaCodeText(
      importScenario(
        'tmpl-src-arrays-double',
        'standard',
        primitiveArray('tmpl-src-arrays-double', 'double', [0, DOUBLE_ABS_MIN, DOUBLE_ABS_MAX]),
      ),
    )
    expect(doubleCode).toContain('double[] numbers = { 0.0, 0.000001, 1000000000000000.0 };')
    expect(doubleCode.toLowerCase()).not.toContain('e-')
    expect(doubleCode).not.toContain('e+')
  })

  it('P6-D20: age / salary / evaluationの境界値が正当なJavaリテラルで表示される', () => {
    const dataset = [
      employee({ name: '下限', age: AGE_MIN, salary: SALARY_MIN, evaluation: EVALUATION_MIN }),
      employee({ name: '上限', age: AGE_MAX, salary: SALARY_MAX, evaluation: EVALUATION_MAX }),
    ]
    const code = javaCodeText(importScenario('tmpl-filter-basic', 'standard', filterCandidate(dataset)))
    expect(code).toContain('new Employee("下限", 15, 0L, 0.0, ')
    expect(code).toContain('new Employee("上限", 80, 99_999_999L, 5.0, ')
    expect(code.toLowerCase()).not.toContain('e-')
  })

  it('P6-D20: 1e-6未満のevaluation（Contractが受理する）も正当なJavaリテラルになる', () => {
    // v0.10 §6.2のevaluation値域は0.0〜5.0であり、1e-6の下限はdataset fieldへ適用されない。
    // 指数表記になっても`1e-7`はJavaのdoubleリテラルとして正当であることを明示する。
    const tiny = 1e-7
    expect(isContractDouble(tiny)).toBe(false)
    const literal = formatDoubleLiteral(tiny)
    expect(literal).toBe('1e-7')
    // Java floating literalの文法（Digits ExponentPart）に一致する
    expect(literal).toMatch(/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/)
    const dataset = [
      employee({ name: '通過', age: 40, evaluation: tiny }),
      employee({ name: '除外', age: 20 }),
    ]
    const code = javaCodeText(importScenario('tmpl-filter-basic', 'standard', filterCandidate(dataset)))
    expect(code).toContain('1e-7')
  })

  it('P6-D20: identity / predicate literalの境界値も正当なリテラルになる', () => {
    const reduce = JSON.stringify({
      dslVersion: DSL_VERSION,
      templateId: 'tmpl-reduce-int-identity',
      templateVersion: 1,
      mode: 'standard',
      dslParameters: {
        'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [1, 2] },
        'slot-reduction': { kind: 'numericSum' },
        'slot-identity': { type: 'int', value: INT32_MAX },
      },
      title: 'identity境界の取込',
      description: 'int identityの境界値を表示します。',
    })
    expect(javaCodeText(importScenario('tmpl-reduce-int-identity', 'standard', reduce))).toContain(
      '.reduce(2147483647, (a, b) -> a + b);',
    )

    const salaryPredicate = JSON.stringify({
      dslVersion: DSL_VERSION,
      templateId: 'tmpl-takewhile-employee',
      templateVersion: 1,
      mode: 'standard',
      dataset: [
        employee({ name: '通過', salary: SALARY_MAX }),
        employee({ name: '停止', salary: SALARY_MIN }),
        employee({ name: '未評価', salary: SALARY_MAX }),
      ],
      dslParameters: {
        'slot-predicate-1': {
          kind: 'fieldCompare',
          field: 'salary',
          operator: 'GTE',
          value: { type: 'long', value: SALARY_MAX },
        },
      },
      title: 'salary境界の取込',
      description: 'long定数の境界値を表示します。',
    })
    expect(
      javaCodeText(importScenario('tmpl-takewhile-employee', 'standard', salaryPredicate)),
    ).toContain('.takeWhile(e -> e.salary() >= 99_999_999L)')
  })
})
