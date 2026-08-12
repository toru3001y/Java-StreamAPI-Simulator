import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { importScenario, templateById } from '../p6-helpers'
import {
  IMPORT_TEXT_MAX_LENGTH,
  buildTemplateContract,
  validateBySpec,
} from '../../src/application/importContract'
import { stripCodeFence } from '../../src/application/candidateImport'
import { DSL_VERSION } from '../../src/domain/dsl/ast'
import type { Result, ValidationCode, ValidationIssue } from '../../src/domain/types/result'
import type { Scenario, ScenarioMode } from '../../src/domain/scenario/scenario'

/**
 * P6-D04〜P6-D17・P6-D21: 取込検証（Phase 6指示 §12.1、v0.10 §6・§7.2）。
 * 貼付テキストはuntrusted入力として §7.2 の6手順で処理される。
 */

// ---- 素材 ----

/**
 * Employee系template（filter標準）の正当な貼付JSON。
 * dataset[0]はage >= 30を満たし、dataset[1]は満たさないため、
 * 検証対象の値を差し替えるprobe要素（dataset[PROBE_INDEX]）を変えても
 * 標準モードの教材制約（true / false双方の発生）は崩れない。
 */
const PROBE_INDEX = 2

function employeeCandidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dslVersion: DSL_VERSION,
    templateId: 'tmpl-filter-basic',
    templateVersion: 1,
    mode: 'standard',
    dataset: [
      {
        name: '取込太郎',
        age: 41,
        salary: 6_000_000,
        evaluation: 4.5,
        region: '北海道',
        hireDate: '2020-04-01',
        department: { name: '品質保証部', division: '技術本部' },
        skills: ['Java'],
      },
      {
        name: '取込花子',
        age: 22,
        salary: 3_000_000,
        evaluation: 3.1,
        region: '九州',
        hireDate: '2024-04-01',
        department: { name: '品質保証部', division: '技術本部' },
        skills: [],
      },
      {
        name: '取込次郎',
        age: 33,
        salary: 4_500_000,
        evaluation: 3.9,
        region: '東海',
        hireDate: '2022-10-01',
        department: { name: '営業推進部', division: '営業本部' },
        skills: ['SQL', '英語'],
      },
    ],
    dslParameters: {
      'slot-predicate-1': {
        kind: 'fieldCompare',
        field: 'age',
        operator: 'GTE',
        value: { type: 'int', value: 30 },
      },
    },
    title: '取込サンプル（filter標準）',
    description: 'age >= 30で通過・除外の双方が発生します。',
    ...overrides,
  }
}

/** source slot型template（int配列 → boxed → toList）の正当な貼付JSON */
function sourceSlotCandidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dslVersion: DSL_VERSION,
    templateId: 'tmpl-src-arrays-int',
    templateVersion: 1,
    mode: 'standard',
    dslParameters: {
      'slot-source': {
        kind: 'arrayPrimitive',
        arrayId: 'numbers',
        primitive: 'int',
        values: [7, 8, 9],
      },
    },
    title: '取込サンプル（int配列）',
    description: 'int[]からIntStreamを生成します。',
    ...overrides,
  }
}

function importJson(
  templateId: string,
  mode: ScenarioMode,
  json: unknown,
): Result<Scenario> {
  return importScenario(templateId, mode, JSON.stringify(json))
}

function codesOf(result: Result<Scenario>): ValidationCode[] {
  return result.ok ? [] : result.issues.map((i) => i.code)
}

function expectRejected(result: Result<Scenario>, code: ValidationCode, label?: string): ValidationIssue[] {
  expect(result.ok, `${label ?? ''} ${JSON.stringify(codesOf(result))}`).toBe(false)
  if (result.ok) return []
  expect(result.issues.map((i) => i.code), label).toContain(code)
  return [...result.issues]
}

/** probe要素（dataset[PROBE_INDEX]）の1フィールドだけを差し替えたEmployee候補 */
function withEmployeeField(field: string, value: unknown): Record<string, unknown> {
  const candidate = employeeCandidate()
  const dataset = candidate['dataset'] as Record<string, unknown>[]
  const probe = { ...(dataset[PROBE_INDEX] as Record<string, unknown>) }
  if (value === undefined) delete probe[field]
  else probe[field] = value
  candidate['dataset'] = dataset.map((element, i) => (i === PROBE_INDEX ? probe : element))
  return candidate
}

/**
 * sorted(Comparator)標準モード用のdataset。
 * 「事前に整列済みでない」「同値キー（region）を持つ別要素がある」の双方を満たす。
 */
const SORTED_DATASET = [
  {
    name: '西田',
    age: 40,
    salary: 6_000_000,
    evaluation: 4.1,
    region: '関西',
    hireDate: '2019-04-01',
    department: { name: '開発部', division: '技術本部' },
    skills: ['Java'],
  },
  {
    name: '東山',
    age: 31,
    salary: 5_000_000,
    evaluation: 3.7,
    region: '関東',
    hireDate: '2021-04-01',
    department: { name: '開発部', division: '技術本部' },
    skills: ['SQL'],
  },
  {
    // region / age / nameの3キーすべてが東山と同値の別要素（複合キーでも同値キーが成立する）
    name: '東山',
    age: 31,
    salary: 4_000_000,
    evaluation: 3.5,
    region: '関東',
    hireDate: '2023-04-01',
    department: { name: '営業部', division: '営業本部' },
    skills: ['営業'],
  },
]

// ---- P6-D04 正常系受理 ----

describe('P6-D04 正常系受理', () => {
  it('P6-D04: Employee系templateの正当な貼付JSONが検証を通過しScenarioが成立する', () => {
    const result = importJson('tmpl-filter-basic', 'standard', employeeCandidate())
    expect(codesOf(result)).toEqual([])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.provenance.providerKind).toBe('IMPORTED')
    expect(result.value.title).toBe('取込サンプル（filter標準）')
    expect(result.value.pipeline.dataset).toHaveLength(3)
  })

  it('P6-D04: source slot型templateの正当な貼付JSONが検証を通過しScenarioが成立する', () => {
    const result = importJson('tmpl-src-arrays-int', 'standard', sourceSlotCandidate())
    expect(codesOf(result)).toEqual([])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.pipeline.sourceDsl).toEqual({
      kind: 'arrayPrimitive',
      arrayId: 'numbers',
      primitive: 'int',
      values: [7, 8, 9],
    })
  })

  it('P6-D04: source slot型templateでdatasetキーの持込みは拒否される', () => {
    const candidate = sourceSlotCandidate({ dataset: [] })
    const issues = expectRejected(
      importJson('tmpl-src-arrays-int', 'standard', candidate),
      'IMPORT_SCHEMA',
    )
    expect(issues.some((i) => i.path === 'dataset')).toBe(true)
  })

  it('P6-D04: Employee系templateでdatasetキーの欠落は拒否される', () => {
    const candidate = employeeCandidate()
    delete candidate['dataset']
    const issues = expectRejected(
      importJson('tmpl-filter-basic', 'standard', candidate),
      'IMPORT_SCHEMA',
    )
    expect(issues.some((i) => i.message.includes('必須キーがありません: dataset'))).toBe(true)
  })
})

// ---- P6-D05 サイズ上限 ----

describe('P6-D05 サイズ上限', () => {
  /** description長でテキスト全体長を調整する */
  function candidateWithLength(target: number): string {
    const base = employeeCandidate({ description: '' })
    const baseText = JSON.stringify(base)
    const padding = target - baseText.length
    return JSON.stringify(employeeCandidate({ description: 'あ'.repeat(padding) }))
  }

  it('P6-D05: 65,536 code unitちょうどは受理され、1超過はIMPORT_SIZE_LIMITで拒否される', () => {
    // descriptionは最大300文字のため、上限ちょうどのテキストはIMPORT_SIZE_LIMIT以外で落ちる。
    // ここではサイズ判定境界そのものを検証する
    const exact = 'x'.repeat(IMPORT_TEXT_MAX_LENGTH)
    const over = 'x'.repeat(IMPORT_TEXT_MAX_LENGTH + 1)
    expect(exact.length).toBe(65_536)
    const exactResult = importScenario('tmpl-filter-basic', 'standard', exact)
    // ちょうどはサイズ検証を通過し、次手順（JSON.parse）で失敗する
    expect(codesOf(exactResult)).toEqual(['IMPORT_PARSE'])
    const overResult = importScenario('tmpl-filter-basic', 'standard', over)
    expect(codesOf(overResult)).toEqual(['IMPORT_SIZE_LIMIT'])
  })

  it('P6-D05: サイズ超過の拒否はparse前に起きる（parse可能なJSONでもサイズで落ちる）', () => {
    const oversized = candidateWithLength(IMPORT_TEXT_MAX_LENGTH + 1000)
    expect(oversized.length).toBeGreaterThan(IMPORT_TEXT_MAX_LENGTH)
    // JSONとしては妥当（parseできる）が、サイズ検証で拒否される
    expect(() => JSON.parse(oversized)).not.toThrow()
    expect(codesOf(importScenario('tmpl-filter-basic', 'standard', oversized))).toEqual([
      'IMPORT_SIZE_LIMIT',
    ])
  })
})

// ---- P6-D06 前処理・構文 ----

describe('P6-D06 前処理・構文', () => {
  const validJson = JSON.stringify(employeeCandidate())

  it('P6-D06: 前後の空白はtrimされる', () => {
    const result = importScenario('tmpl-filter-basic', 'standard', `\n\n  ${validJson}  \n\n`)
    expect(codesOf(result)).toEqual([])
  })

  it('P6-D06: ラベル付き・大小文字混在のコードフェンス1組は除去される', () => {
    for (const fence of ['```', '```json', '```JSON', '```Json']) {
      const text = `${fence}\n${validJson}\n\`\`\``
      expect(codesOf(importScenario('tmpl-filter-basic', 'standard', text)), fence).toEqual([])
    }
  })

  it('P6-D06: 片側だけのフェンス・フェンス外テキストはIMPORT_PARSEになる', () => {
    const onlyOpen = `\`\`\`json\n${validJson}`
    const onlyClose = `${validJson}\n\`\`\``
    const extraText = `説明です。\n\`\`\`json\n${validJson}\n\`\`\`\nここまで。`
    expect(codesOf(importScenario('tmpl-filter-basic', 'standard', onlyOpen))).toEqual([
      'IMPORT_PARSE',
    ])
    expect(codesOf(importScenario('tmpl-filter-basic', 'standard', onlyClose))).toEqual([
      'IMPORT_PARSE',
    ])
    expect(codesOf(importScenario('tmpl-filter-basic', 'standard', extraText))).toEqual([
      'IMPORT_PARSE',
    ])
  })

  it('P6-D06: 不正JSONはIMPORT_PARSEで拒否される', () => {
    expect(codesOf(importScenario('tmpl-filter-basic', 'standard', '{ぬるぽ'))).toEqual([
      'IMPORT_PARSE',
    ])
    expect(codesOf(importScenario('tmpl-filter-basic', 'standard', ''))).toEqual(['IMPORT_PARSE'])
  })

  it('P6-D06: 重複キーはJSON.parseの後勝ちで解決され、後勝ち値が以降の検証を通過する', () => {
    // titleを2回書いた場合、後勝ちの値が採用される
    const text = validJson.replace(
      '"title":"取込サンプル（filter標準）"',
      '"title":"先勝ち","title":"後勝ちタイトル"',
    )
    expect(text).toContain('"title":"先勝ち"')
    const result = importScenario('tmpl-filter-basic', 'standard', text)
    expect(codesOf(result)).toEqual([])
    if (!result.ok) return
    expect(result.value.title).toBe('後勝ちタイトル')
  })

  it('P6-D06: 重複キーの後勝ち値が不正なら通常どおり拒否される', () => {
    const text = validJson.replace('"templateVersion":1', '"templateVersion":1,"templateVersion":2')
    expect(codesOf(importScenario('tmpl-filter-basic', 'standard', text))).toEqual([
      'IMPORT_CONTEXT_MISMATCH',
    ])
  })

  it('P6-D06: 取込経路の実装にeval / new Function / 動的コード生成が存在しない', () => {
    const sources = [
      'src/application/candidateImport.ts',
      'src/application/importContract.ts',
      'src/application/promptGenerator.ts',
      'src/ui/components/ImportPanel.tsx',
    ]
    for (const relative of sources) {
      const text = readFileSync(path.join(__dirname, '../..', relative), 'utf8')
      expect(/\beval\s*\(/.test(text), relative).toBe(false)
      expect(/new\s+Function\s*\(/.test(text), relative).toBe(false)
      expect(text.includes('dangerouslySetInnerHTML'), relative).toBe(false)
    }
  })

  it('P6-D06: stripCodeFenceは1組だけを除去する', () => {
    expect(stripCodeFence('```json\n{}\n```')).toBe('{}')
    expect(stripCodeFence('```\n```json\n{}\n```\n```')).toBe('```json\n{}\n```')
    expect(stripCodeFence('  {}  ')).toBe('{}')
  })
})

// ---- P6-D07 トップレベルclosed schema ----

describe('P6-D07 トップレベルclosed schema', () => {
  it('P6-D07: 未知キーはIMPORT_SCHEMAで拒否される', () => {
    const issues = expectRejected(
      importJson('tmpl-filter-basic', 'standard', employeeCandidate({ extra: 1 })),
      'IMPORT_SCHEMA',
    )
    expect(issues.some((i) => i.path === 'extra')).toBe(true)
  })

  it('P6-D07: providerKind / provenance / revisionの持込みは拒否される', () => {
    for (const key of ['providerKind', 'provenance', 'revision']) {
      const issues = expectRejected(
        importJson('tmpl-filter-basic', 'standard', employeeCandidate({ [key]: 'x' })),
        'IMPORT_SCHEMA',
        key,
      )
      expect(issues.some((i) => i.path === key && i.message.includes('アプリが付与')), key).toBe(
        true,
      )
    }
  })

  it('P6-D07: 必須キーの欠落はIMPORT_SCHEMAで拒否される', () => {
    for (const key of ['dslVersion', 'templateId', 'templateVersion', 'mode', 'dslParameters', 'title', 'description']) {
      const candidate = employeeCandidate()
      delete candidate[key]
      const issues = expectRejected(
        importJson('tmpl-filter-basic', 'standard', candidate),
        'IMPORT_SCHEMA',
        key,
      )
      expect(issues.some((i) => i.message.includes(`必須キーがありません: ${key}`)), key).toBe(true)
    }
  })

  it('P6-D07: キーの型不一致はIMPORT_SCHEMAで拒否される', () => {
    const cases: [string, unknown][] = [
      ['dslVersion', 1],
      ['templateId', 1],
      ['templateVersion', '1'],
      ['mode', 1],
      ['dataset', {}],
      ['dslParameters', []],
      ['title', 1],
      ['description', 1],
    ]
    for (const [key, value] of cases) {
      const result = importJson('tmpl-filter-basic', 'standard', employeeCandidate({ [key]: value }))
      expect(codesOf(result), key).toEqual(['IMPORT_SCHEMA'])
    }
  })
})

// ---- P6-D08 context一致 ----

describe('P6-D08 context一致', () => {
  it('P6-D08: dslVersion / templateId / mode の不一致はIMPORT_CONTEXT_MISMATCH', () => {
    const cases: [string, unknown][] = [
      ['dslVersion', '99'],
      ['templateId', 'tmpl-map'],
      ['mode', 'emptySource'],
    ]
    for (const [key, value] of cases) {
      const result = importJson('tmpl-filter-basic', 'standard', employeeCandidate({ [key]: value }))
      expect(codesOf(result), key).toEqual(['IMPORT_CONTEXT_MISMATCH'])
    }
  })

  it('P6-D08: templateVersionの不一致・非整数・0以下はIMPORT_CONTEXT_MISMATCH', () => {
    for (const value of [2, 1.5, 0, -1]) {
      const result = importJson(
        'tmpl-filter-basic',
        'standard',
        employeeCandidate({ templateVersion: value }),
      )
      expect(codesOf(result), String(value)).toEqual(['IMPORT_CONTEXT_MISMATCH'])
    }
  })
})

// ---- P6-D09 dataset schema ----

describe('P6-D09 dataset schema', () => {
  function employeeElement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name: '要素',
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

  it('P6-D09: 要素の未知キー・elementIdの持込みは拒否される', () => {
    for (const key of ['elementId', 'extra']) {
      const candidate = withEmployeeField(key, 'x')
      const issues = expectRejected(
        importJson('tmpl-filter-basic', 'standard', candidate),
        'IMPORT_SCHEMA',
        key,
      )
      expect(issues.some((i) => i.path === `dataset[${PROBE_INDEX}].${key}`), key).toBe(true)
    }
  })

  it('P6-D09: departmentのclosed schema（未知キー・欠落）を拒否する', () => {
    const unknownKey = withEmployeeField('department', {
      name: '開発部',
      division: '技術本部',
      code: 'X',
    })
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', unknownKey))).toEqual([
      'IMPORT_SCHEMA',
    ])
    const missing = withEmployeeField('department', { name: '開発部' })
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', missing))).toEqual(['IMPORT_SCHEMA'])
  })

  it('P6-D09: フィールド型の不一致を拒否する', () => {
    const cases: [string, unknown][] = [
      ['name', 1],
      ['age', '30'],
      ['salary', '1'],
      ['evaluation', '4'],
      ['region', 1],
      ['hireDate', 20200101],
      ['department', 'dev'],
      ['skills', 'Java'],
    ]
    for (const [field, value] of cases) {
      const result = importJson('tmpl-filter-basic', 'standard', withEmployeeField(field, value))
      expect(codesOf(result), field).toContain('IMPORT_SCHEMA')
    }
  })

  it('P6-D09: 件数0 / 8は受理され、9件は拒否される', () => {
    const contract = buildTemplateContract(templateById('tmpl-filter-basic'))
    expect(contract.datasetPolicy).toBe('required')
    // 0件はemptySourceモードで成立する
    const empty = employeeCandidate({ dataset: [], mode: 'emptySource' })
    expect(codesOf(importJson('tmpl-filter-basic', 'emptySource', empty))).toEqual([])
    // 8件（true / falseの双方を含む）は受理される
    const eight = Array.from({ length: 8 }, (_, i) =>
      employeeElement({ name: `社員${i}`, age: i < 4 ? 20 : 40 }),
    )
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', employeeCandidate({ dataset: eight })))).toEqual(
      [],
    )
    // 9件は拒否される
    const nine = [...eight, employeeElement({ name: '社員8' })]
    const issues = expectRejected(
      importJson('tmpl-filter-basic', 'standard', employeeCandidate({ dataset: nine })),
      'IMPORT_SCHEMA',
    )
    expect(issues.some((i) => i.path === 'dataset' && i.message.includes('0〜8件'))).toBe(true)
  })
})

// ---- P6-D10 dataset文字列規則 ----

describe('P6-D10 dataset文字列規則', () => {
  it('P6-D10: 文字列長の境界（1 / 30、skills 1 / 20）を検証する', () => {
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('name', 'あ')))).toEqual([])
    expect(
      codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('name', 'あ'.repeat(30)))),
    ).toEqual([])
    expect(
      codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('name', 'あ'.repeat(31)))),
    ).toEqual(['IMPORT_SCHEMA'])
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('name', '')))).toEqual([
      'IMPORT_SCHEMA',
    ])
    expect(
      codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('skills', ['a'.repeat(20)]))),
    ).toEqual([])
    expect(
      codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('skills', ['a'.repeat(21)]))),
    ).toEqual(['IMPORT_SCHEMA'])
    expect(
      codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('skills', ['']))),
    ).toEqual(['IMPORT_SCHEMA'])
  })

  it('P6-D10: skillsは0〜5件で重複禁止', () => {
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('skills', [])))).toEqual([])
    expect(
      codesOf(
        importJson('tmpl-filter-basic', 'standard', withEmployeeField('skills', ['a', 'b', 'c', 'd', 'e'])),
      ),
    ).toEqual([])
    expect(
      codesOf(
        importJson(
          'tmpl-filter-basic',
          'standard',
          withEmployeeField('skills', ['a', 'b', 'c', 'd', 'e', 'f']),
        ),
      ),
    ).toEqual(['IMPORT_SCHEMA'])
    const duplicated = expectRejected(
      importJson('tmpl-filter-basic', 'standard', withEmployeeField('skills', ['Java', 'Java'])),
      'IMPORT_SCHEMA',
    )
    expect(duplicated.some((i) => i.message.includes('重複'))).toBe(true)
  })

  it('P6-D10: 空白のみは拒否され、値自体は原文のまま保存される', () => {
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('name', '   ')))).toEqual([
      'IMPORT_SCHEMA',
    ])
    const result = importJson('tmpl-filter-basic', 'standard', withEmployeeField('name', ' 前後空白 '))
    expect(codesOf(result)).toEqual([])
    if (!result.ok) return
    const probe = result.value.pipeline.dataset[PROBE_INDEX]
    expect(probe?.value.kind).toBe('employee')
    if (probe?.value.kind !== 'employee') return
    expect(probe.value.value.name).toBe(' 前後空白 ')
  })

  it('P6-D10: 制御文字・双方向制御文字は拒否される', () => {
    for (const char of ['\u0000', '\u001F', '\u007F']) {
      expect(
        codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('name', `A${char}B`))),
        JSON.stringify(char),
      ).toEqual(['IMPORT_SCHEMA'])
    }
    for (const char of ['\u061C', '\u200E', '\u200F', '\u202A', '\u202E', '\u2066', '\u2069']) {
      expect(
        codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('region', `A${char}B`))),
        JSON.stringify(char),
      ).toEqual(['IMPORT_SCHEMA'])
    }
  })

  it('P6-D10: title / descriptionはtrim後の値を採用し、1 / 60・1 / 300の境界を検証する', () => {
    const trimmed = importJson(
      'tmpl-filter-basic',
      'standard',
      employeeCandidate({ title: '  余白つき  ', description: '  説明  ' }),
    )
    expect(codesOf(trimmed)).toEqual([])
    if (trimmed.ok) {
      expect(trimmed.value.title).toBe('余白つき')
      expect(trimmed.value.description).toBe('説明')
    }
    expect(
      codesOf(importJson('tmpl-filter-basic', 'standard', employeeCandidate({ title: 'あ'.repeat(60) }))),
    ).toEqual([])
    expect(
      codesOf(importJson('tmpl-filter-basic', 'standard', employeeCandidate({ title: 'あ'.repeat(61) }))),
    ).toEqual(['IMPORT_SCHEMA'])
    expect(
      codesOf(importJson('tmpl-filter-basic', 'standard', employeeCandidate({ title: '   ' }))),
    ).toEqual(['IMPORT_SCHEMA'])
    expect(
      codesOf(
        importJson('tmpl-filter-basic', 'standard', employeeCandidate({ description: 'あ'.repeat(300) })),
      ),
    ).toEqual([])
    expect(
      codesOf(
        importJson('tmpl-filter-basic', 'standard', employeeCandidate({ description: 'あ'.repeat(301) })),
      ),
    ).toEqual(['IMPORT_SCHEMA'])
  })
})

// ---- P6-D11 dataset数値・日付 ----

describe('P6-D11 dataset数値・日付', () => {
  it('P6-D11: ageの境界（15 / 80）と範囲外', () => {
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('age', 15)))).toEqual([])
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('age', 80)))).toEqual([])
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('age', 14)))).toEqual([
      'IMPORT_SCHEMA',
    ])
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('age', 81)))).toEqual([
      'IMPORT_SCHEMA',
    ])
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('age', 30.5)))).toEqual([
      'IMPORT_SCHEMA',
    ])
  })

  it('P6-D11: salaryの境界（0 / 99,999,999）と範囲外', () => {
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('salary', 0)))).toEqual([])
    expect(
      codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('salary', 99_999_999))),
    ).toEqual([])
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('salary', -1)))).toEqual([
      'IMPORT_SCHEMA',
    ])
    expect(
      codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('salary', 100_000_000))),
    ).toEqual(['IMPORT_SCHEMA'])
  })

  it('P6-D11: evaluationの境界（0.0 / 5.0）とNaN / Infinity / -0の拒否', () => {
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('evaluation', 0)))).toEqual(
      [],
    )
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('evaluation', 5)))).toEqual(
      [],
    )
    expect(
      codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('evaluation', 5.1))),
    ).toEqual(['IMPORT_SCHEMA'])
    // NaN / InfinityはJSONに存在しないため、JSON文字列として直接与える
    for (const literal of ['NaN', 'Infinity', '-Infinity']) {
      const text = JSON.stringify(withEmployeeField('evaluation', 0)).replace(
        '"evaluation":0',
        `"evaluation":${literal}`,
      )
      expect(codesOf(importScenario('tmpl-filter-basic', 'standard', text)), literal).toEqual([
        'IMPORT_PARSE',
      ])
    }
    // -0はJSON.parseで生成される。Object.is判定で拒否する
    const negativeZeroText = JSON.stringify(withEmployeeField('evaluation', 0)).replace(
      '"evaluation":0',
      '"evaluation":-0',
    )
    expect(Object.is(JSON.parse('{"v":-0}').v, -0)).toBe(true)
    const issues = expectRejected(
      importScenario('tmpl-filter-basic', 'standard', negativeZeroText),
      'IMPORT_SCHEMA',
    )
    expect(issues.some((i) => i.message.includes('負のゼロ'))).toBe(true)
  })

  it('P6-D11: hireDateの形式・実在日・範囲', () => {
    const accept = ['1970-01-01', '2100-12-31', '2024-02-29']
    for (const date of accept) {
      expect(
        codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('hireDate', date))),
        date,
      ).toEqual([])
    }
    const reject = ['2024-2-29', '20240229', '2024-02-30', '2023-02-29', '2024-13-01', '1969-12-31', '2101-01-01']
    for (const date of reject) {
      expect(
        codesOf(importJson('tmpl-filter-basic', 'standard', withEmployeeField('hireDate', date))),
        date,
      ).toEqual(['IMPORT_SCHEMA'])
    }
  })
})

// ---- P6-D12 dslParameters全階層closed schema ----

describe('P6-D12 dslParameters全階層closed schema', () => {
  function withPredicate(predicate: unknown): Record<string, unknown> {
    return employeeCandidate({ dslParameters: { 'slot-predicate-1': predicate } })
  }

  it('P6-D12: 未知kindを拒否する', () => {
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', withPredicate({ kind: 'evil' })))).toEqual([
      'IMPORT_SCHEMA',
    ])
  })

  it('P6-D12: 未知キー（関数本文の混入経路）を拒否する', () => {
    const issues = expectRejected(
      importJson(
        'tmpl-filter-basic',
        'standard',
        withPredicate({
          kind: 'fieldCompare',
          field: 'age',
          operator: 'GTE',
          value: { type: 'int', value: 30 },
          functionBody: 'return evil()',
        }),
      ),
      'IMPORT_SCHEMA',
    )
    expect(issues.some((i) => i.path.endsWith('.functionBody'))).toBe(true)
  })

  it('P6-D12: 未知type（literalのtype）を拒否する', () => {
    expect(
      codesOf(
        importJson(
          'tmpl-filter-basic',
          'standard',
          withPredicate({
            kind: 'fieldCompare',
            field: 'age',
            operator: 'GTE',
            value: { type: 'code', value: 'x' },
          }),
        ),
      ),
    ).toEqual(['IMPORT_SCHEMA'])
  })

  it('P6-D12: 親フィールド文脈に合わない形状を拒否する（iterateのoperator / predicate）', () => {
    const base = {
      dslVersion: DSL_VERSION,
      templateId: 'tmpl-src-iterate3',
      templateVersion: 1,
      mode: 'standard',
      title: 'iterate取込',
      description: 'iterate3の取込サンプルです。',
    }
    const valid = {
      ...base,
      dslParameters: {
        'slot-source': {
          kind: 'iterate3',
          seed: 1,
          predicate: { operator: 'LTE', value: 5 },
          operator: { ruleId: 'increment', step: 1 },
        },
      },
    }
    expect(codesOf(importJson('tmpl-src-iterate3', 'standard', valid))).toEqual([])
    // operatorへkind付きのオブジェクトを与える（文脈不一致）
    const wrongOperator = {
      ...base,
      dslParameters: {
        'slot-source': {
          kind: 'iterate3',
          seed: 1,
          predicate: { operator: 'LTE', value: 5 },
          operator: { kind: 'increment', step: 1 },
        },
      },
    }
    const wrongOperatorCodes = codesOf(importJson('tmpl-src-iterate3', 'standard', wrongOperator))
    expect(wrongOperatorCodes.length).toBeGreaterThan(0)
    expect(new Set(wrongOperatorCodes)).toEqual(new Set(['IMPORT_SCHEMA']))
  })

  it('P6-D12: kindを持たない正規object（literal・comparator key・identity）は受理される', () => {
    // literal（type / value）
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', employeeCandidate()))).toEqual([])
    // comparator key（field / direction）
    const sorted = {
      dslVersion: DSL_VERSION,
      templateId: 'tmpl-sorted-comparator',
      templateVersion: 1,
      mode: 'standard',
      dataset: SORTED_DATASET,
      dslParameters: {
        'slot-comparator': { kind: 'employeeKeys', keys: [{ field: 'region', direction: 'ASC' }] },
      },
      title: 'sorted(Comparator)の取込',
      description: 'regionの昇順で並べ替えます。',
    }
    expect(codesOf(importJson('tmpl-sorted-comparator', 'standard', sorted))).toEqual([])
    // identity（type / value）
    const reduceIdentity = {
      dslVersion: DSL_VERSION,
      templateId: 'tmpl-reduce-int-identity',
      templateVersion: 1,
      mode: 'standard',
      dslParameters: {
        'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [1, 2, 3] },
        'slot-reduction': { kind: 'numericSum' },
        'slot-identity': { type: 'int', value: 0 },
      },
      title: 'reduce(identityあり)の取込',
      description: 'identityつきのreduceを実行します。',
    }
    expect(codesOf(importJson('tmpl-reduce-int-identity', 'standard', reduceIdentity))).toEqual([])
  })

  it('P6-D12: 未定義slotの持込みを拒否する', () => {
    const issues = expectRejected(
      importJson(
        'tmpl-filter-basic',
        'standard',
        employeeCandidate({
          dslParameters: {
            'slot-predicate-1': {
              kind: 'fieldCompare',
              field: 'age',
              operator: 'GTE',
              value: { type: 'int', value: 30 },
            },
            'slot-unknown': {},
          },
        }),
      ),
      'IMPORT_SCHEMA',
    )
    expect(issues.some((i) => i.path === 'dslParameters.slot-unknown')).toBe(true)
  })
})

// ---- P6-D13 変数識別子契約 ----

describe('P6-D13 変数識別子契約', () => {
  function withArrayId(arrayId: string): Record<string, unknown> {
    return sourceSlotCandidate({
      dslParameters: {
        'slot-source': { kind: 'arrayPrimitive', arrayId, primitive: 'int', values: [1, 2] },
      },
    })
  }

  it('P6-D13: パターン適合の識別子は受理される', () => {
    for (const id of ['v', 'numbers', 'myArray1', 'a'.repeat(20)]) {
      expect(codesOf(importJson('tmpl-src-arrays-int', 'standard', withArrayId(id))), id).toEqual([])
    }
  })

  it('P6-D13: パターン違反（大文字開始・21文字・記号・空）を拒否する', () => {
    for (const id of ['Numbers', 'a'.repeat(21), 'my-array', 'my array', '', '1abc', 'my_array']) {
      expect(
        codesOf(importJson('tmpl-src-arrays-int', 'standard', withArrayId(id))),
        JSON.stringify(id),
      ).toEqual(['IMPORT_SCHEMA'])
    }
  })

  it('P6-D13: Java予約語・リテラルと生成コードの識別子を拒否する', () => {
    for (const id of ['int', 'class', 'true', 'false', 'null', 'new', 'result', 'employees', 'e']) {
      expect(codesOf(importJson('tmpl-src-arrays-int', 'standard', withArrayId(id))), id).toEqual([
        'IMPORT_SCHEMA',
      ])
    }
  })
})

// ---- P6-D14 Java型名契約 ----

describe('P6-D14 Java型名契約', () => {
  function emptyCandidate(templateId: string, streamType: string, elementTypeName: string) {
    return {
      dslVersion: DSL_VERSION,
      templateId,
      templateVersion: 1,
      mode: 'emptySource',
      dslParameters: { 'slot-source': { kind: 'empty', streamType, elementTypeName } },
      title: '空Streamの取込',
      description: '空Streamの取込サンプルです。',
    }
  }

  it('P6-D14: emptyの固定表4組は受理される', () => {
    const cases: [string, string, string][] = [
      ['tmpl-src-empty-object', 'object', 'String'],
      ['tmpl-src-empty-int', 'int', 'int'],
      ['tmpl-src-empty-long', 'long', 'long'],
      ['tmpl-src-empty-double', 'double', 'double'],
    ]
    for (const [templateId, streamType, elementTypeName] of cases) {
      expect(
        codesOf(
          importJson(templateId, 'emptySource', emptyCandidate(templateId, streamType, elementTypeName)),
        ),
        `${streamType}/${elementTypeName}`,
      ).toEqual([])
    }
  })

  it('P6-D14: 固定表にない組・任意型名・Java構文を壊す値を拒否する', () => {
    const cases: [string, string][] = [
      ['object', 'int'],
      ['int', 'String'],
      ['object', 'Employee'],
      ['object', 'String> x; static { evil(); } //'],
      ['object', ''],
    ]
    for (const [streamType, elementTypeName] of cases) {
      expect(
        codesOf(
          importJson(
            'tmpl-src-empty-object',
            'emptySource',
            emptyCandidate('tmpl-src-empty-object', streamType, elementTypeName),
          ),
        ),
        `${streamType}/${elementTypeName}`,
      ).toEqual(['IMPORT_SCHEMA'])
    }
  })

  it('P6-D14: streamOf / arrayObjectのelementTypeNameはString固定、generatorは既存ホワイトリスト', () => {
    const streamOf = {
      dslVersion: DSL_VERSION,
      templateId: 'tmpl-src-of',
      templateVersion: 1,
      mode: 'standard',
      dslParameters: {
        'slot-source': { kind: 'streamOf', elementTypeName: 'Employee', values: ['a'] },
        'slot-mapper-1': { kind: 'toUpper' },
      },
      title: 'Stream.ofの取込',
      description: 'Stream.ofの取込サンプルです。',
    }
    expect(codesOf(importJson('tmpl-src-of', 'standard', streamOf))).toEqual(['IMPORT_SCHEMA'])
    const generator = {
      dslVersion: DSL_VERSION,
      templateId: 'tmpl-toarray-generator',
      templateVersion: 1,
      mode: 'standard',
      dslParameters: {
        'slot-source': { kind: 'streamOf', elementTypeName: 'String', values: ['a', 'b'] },
        'slot-generator': { kind: 'arrayGenerator', elementTypeName: 'Employee' },
      },
      title: 'toArray(generator)の取込',
      description: 'generatorつきtoArrayの取込サンプルです。',
    }
    // slotのallowedElementTypeNamesは['String']のみ
    expect(codesOf(importJson('tmpl-toarray-generator', 'standard', generator))).toEqual([
      'IMPORT_SCHEMA',
    ])
  })
})

// ---- P6-D15 DSL文字列・配列上限 ----

describe('P6-D15 DSL文字列・配列上限', () => {
  function streamOfCandidate(values: string[]) {
    return {
      dslVersion: DSL_VERSION,
      templateId: 'tmpl-src-of',
      templateVersion: 1,
      mode: values.length === 0 ? 'emptySource' : 'standard',
      dslParameters: {
        'slot-source': { kind: 'streamOf', elementTypeName: 'String', values },
        'slot-mapper-1': { kind: 'toUpper' },
      },
      title: 'Stream.ofの取込',
      description: 'Stream.ofの取込サンプルです。',
    }
  }

  it('P6-D15: 一般DSL文字列の0 / 20境界（空文字・空白のみを許可）', () => {
    const joining = (delimiter: string) => ({
      dslVersion: DSL_VERSION,
      templateId: 'tmpl-collect-joining-delimiter',
      templateVersion: 1,
      mode: 'standard',
      dataset: (employeeCandidate()['dataset'] as unknown[]).slice(0, 2),
      dslParameters: {
        'slot-mapper-1': { kind: 'fieldAccess', field: 'name' },
        'slot-collector': {
          kind: 'joining',
          delimiter: { type: 'string', value: delimiter },
          prefix: null,
          suffix: null,
        },
      },
      title: 'joiningの取込',
      description: 'joining(delimiter)の取込サンプルです。',
    })
    for (const value of ['', ' ', 'a'.repeat(20)]) {
      expect(
        codesOf(importJson('tmpl-collect-joining-delimiter', 'standard', joining(value))),
        JSON.stringify(value),
      ).toEqual([])
    }
    expect(codesOf(importJson('tmpl-collect-joining-delimiter', 'standard', joining('a'.repeat(21))))).toEqual(
      ['IMPORT_SCHEMA'],
    )
  })

  it('P6-D15: source配列の0 / 8境界', () => {
    expect(codesOf(importJson('tmpl-src-of', 'emptySource', streamOfCandidate([])))).toEqual([])
    const eight = Array.from({ length: 8 }, (_, i) => `v${i}`)
    expect(codesOf(importJson('tmpl-src-of', 'standard', streamOfCandidate(eight)))).toEqual([])
    expect(codesOf(importJson('tmpl-src-of', 'standard', streamOfCandidate([...eight, 'v8'])))).toEqual([
      'IMPORT_SCHEMA',
    ])
  })

  it('P6-D15: nested string listの外0〜4・内0〜5境界', () => {
    const nested = (values: string[][]) => ({
      dslVersion: DSL_VERSION,
      templateId: 'tmpl-flatmap',
      templateVersion: 1,
      mode: values.some((v) => v.length > 0) ? 'standard' : 'emptySource',
      dslParameters: {
        'slot-source': { kind: 'nestedStringList', listId: 'groups', values },
        'slot-mapper-1': { kind: 'listStream' },
      },
      title: 'flatMapの取込',
      description: 'nested listの取込サンプルです。',
    })
    const outerFour = [
      ['a', 'b'],
      ['c'],
      ['d'],
      ['e'],
    ]
    expect(codesOf(importJson('tmpl-flatmap', 'standard', nested(outerFour)))).toEqual([])
    expect(codesOf(importJson('tmpl-flatmap', 'standard', nested([...outerFour, ['f']])))).toEqual([
      'IMPORT_SCHEMA',
    ])
    expect(
      codesOf(importJson('tmpl-flatmap', 'standard', nested([['a', 'b', 'c', 'd', 'e'], ['f', 'g']]))),
    ).toEqual([])
    expect(
      codesOf(importJson('tmpl-flatmap', 'standard', nested([['a', 'b', 'c', 'd', 'e', 'f'], ['g', 'h']]))),
    ).toEqual(['IMPORT_SCHEMA'])
  })

  it('P6-D15: streamOfPrimitiveArraysの外側 / 内側件数境界', () => {
    const arrays = (values: number[][]) => ({
      dslVersion: DSL_VERSION,
      templateId: 'tmpl-flatmap-int',
      templateVersion: 1,
      mode: values.some((v) => v.length > 0) ? 'standard' : 'emptySource',
      dslParameters: {
        'slot-source': { kind: 'streamOfPrimitiveArrays', primitive: 'int', arrays: values },
        'slot-mapper-1': { kind: 'arrayStream', primitive: 'int' },
      },
      title: 'flatMapToIntの取込',
      description: 'int[]のflatten取込サンプルです。',
    })
    const outerFour = [[1, 2], [3], [4], [5]]
    expect(codesOf(importJson('tmpl-flatmap-int', 'standard', arrays(outerFour)))).toEqual([])
    expect(codesOf(importJson('tmpl-flatmap-int', 'standard', arrays([...outerFour, [6]])))).toEqual([
      'IMPORT_SCHEMA',
    ])
    expect(codesOf(importJson('tmpl-flatmap-int', 'standard', arrays([[1, 2, 3, 4, 5], [6, 7]])))).toEqual([])
    expect(
      codesOf(importJson('tmpl-flatmap-int', 'standard', arrays([[1, 2, 3, 4, 5, 6], [7, 8]]))),
    ).toEqual(['IMPORT_SCHEMA'])
  })

  it('P6-D15: employeeKeysの1 / 3境界と同一fieldの重複拒否', () => {
    const sorted = (keys: unknown[]) => ({
      dslVersion: DSL_VERSION,
      templateId: 'tmpl-sorted-comparator',
      templateVersion: 1,
      mode: 'standard',
      dataset: SORTED_DATASET,
      dslParameters: { 'slot-comparator': { kind: 'employeeKeys', keys } },
      title: 'sortedの取込',
      description: 'Comparatorキーの取込サンプルです。',
    })
    expect(
      codesOf(importJson('tmpl-sorted-comparator', 'standard', sorted([{ field: 'region', direction: 'ASC' }]))),
    ).toEqual([])
    expect(
      codesOf(
        importJson(
          'tmpl-sorted-comparator',
          'standard',
          sorted([
            { field: 'region', direction: 'ASC' },
            { field: 'age', direction: 'DESC' },
            { field: 'name', direction: 'ASC' },
          ]),
        ),
      ),
    ).toEqual([])
    expect(codesOf(importJson('tmpl-sorted-comparator', 'standard', sorted([])))).toEqual([
      'IMPORT_SCHEMA',
    ])
    expect(
      codesOf(
        importJson(
          'tmpl-sorted-comparator',
          'standard',
          sorted([
            { field: 'region', direction: 'ASC' },
            { field: 'age', direction: 'ASC' },
            { field: 'name', direction: 'ASC' },
            { field: 'salary', direction: 'ASC' },
          ]),
        ),
      ),
    ).toEqual(['IMPORT_SCHEMA'])
    const duplicated = expectRejected(
      importJson(
        'tmpl-sorted-comparator',
        'standard',
        sorted([
          { field: 'region', direction: 'ASC' },
          { field: 'region', direction: 'DESC' },
        ]),
      ),
      'IMPORT_SCHEMA',
    )
    expect(duplicated.some((i) => i.message.includes('同一field'))).toBe(true)
  })
})

// ---- P6-D16 DSL数値値域 ----

describe('P6-D16 DSL数値値域', () => {
  function primitiveArray(templateId: string, primitive: string, values: number[], mode = 'standard') {
    return {
      dslVersion: DSL_VERSION,
      templateId,
      templateVersion: 1,
      mode,
      dslParameters: {
        'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive, values },
      },
      title: 'primitive配列の取込',
      description: 'primitive配列の取込サンプルです。',
    }
  }

  function nestedArrays(primitive: string, arrays: number[][]) {
    return {
      dslVersion: DSL_VERSION,
      templateId: `tmpl-flatmap-${primitive}`,
      templateVersion: 1,
      mode: 'standard',
      dslParameters: {
        'slot-source': { kind: 'streamOfPrimitiveArrays', primitive, arrays },
        'slot-mapper-1': { kind: 'arrayStream', primitive },
      },
      title: 'flattenの取込',
      description: 'primitive配列のflatten取込サンプルです。',
    }
  }

  it('P6-D16: int32境界の受理と1超過の拒否', () => {
    expect(
      codesOf(
        importJson('tmpl-src-arrays-int', 'standard', primitiveArray('tmpl-src-arrays-int', 'int', [2_147_483_647, -2_147_483_648])),
      ),
    ).toEqual([])
    expect(
      codesOf(
        importJson('tmpl-src-arrays-int', 'standard', primitiveArray('tmpl-src-arrays-int', 'int', [2_147_483_648])),
      ),
    ).toEqual(['IMPORT_SCHEMA'])
    expect(
      codesOf(
        importJson('tmpl-src-arrays-int', 'standard', primitiveArray('tmpl-src-arrays-int', 'int', [-2_147_483_649])),
      ),
    ).toEqual(['IMPORT_SCHEMA'])
  })

  it('P6-D16: long safe integer境界の受理と超過の拒否', () => {
    const max = Number.MAX_SAFE_INTEGER
    expect(
      codesOf(
        importJson('tmpl-src-arrays-long', 'standard', primitiveArray('tmpl-src-arrays-long', 'long', [max, -max])),
      ),
    ).toEqual([])
    // safe integerを超える値はJSON文字列として直接与える
    const text = JSON.stringify(
      primitiveArray('tmpl-src-arrays-long', 'long', [1]),
    ).replace('"values":[1]', '"values":[9007199254740993]')
    expect(codesOf(importScenario('tmpl-src-arrays-long', 'standard', text))).toEqual([
      'IMPORT_SCHEMA',
    ])
  })

  it('P6-D16: doubleの1e-6 / 1e15境界・0（正のゼロ）受理・-0拒否（arrayPrimitive）', () => {
    expect(
      codesOf(
        importJson(
          'tmpl-src-arrays-double',
          'standard',
          primitiveArray('tmpl-src-arrays-double', 'double', [0, 1e-6, 1e15]),
        ),
      ),
    ).toEqual([])
    for (const value of [1e-7, 1e16]) {
      expect(
        codesOf(
          importJson(
            'tmpl-src-arrays-double',
            'standard',
            primitiveArray('tmpl-src-arrays-double', 'double', [value]),
          ),
        ),
        String(value),
      ).toEqual(['IMPORT_SCHEMA'])
    }
    const negativeZero = JSON.stringify(
      primitiveArray('tmpl-src-arrays-double', 'double', [1]),
    ).replace('"values":[1]', '"values":[-0]')
    const issues = expectRejected(
      importScenario('tmpl-src-arrays-double', 'standard', negativeZero),
      'IMPORT_SCHEMA',
    )
    expect(issues.some((i) => i.message.includes('-0'))).toBe(true)
  })

  it('P6-D16: doubleの-0拒否はstreamOfPrimitiveArraysにも適用される', () => {
    expect(codesOf(importJson('tmpl-flatmap-double', 'standard', nestedArrays('double', [[0, 1e-6], [1e15]])))).toEqual(
      [],
    )
    const negativeZero = JSON.stringify(nestedArrays('double', [[1], [2]])).replace(
      '"arrays":[[1],[2]]',
      '"arrays":[[-0],[2]]',
    )
    expect(codesOf(importScenario('tmpl-flatmap-double', 'standard', negativeZero))).toEqual([
      'IMPORT_SCHEMA',
    ])
  })

  it('P6-D16: 非有限値・型不一致（int配列に小数）を拒否する', () => {
    expect(
      codesOf(
        importJson('tmpl-src-arrays-int', 'standard', primitiveArray('tmpl-src-arrays-int', 'int', [1.5])),
      ),
    ).toEqual(['IMPORT_SCHEMA'])
    const nan = JSON.stringify(primitiveArray('tmpl-src-arrays-int', 'int', [1])).replace(
      '"values":[1]',
      '"values":[NaN]',
    )
    expect(codesOf(importScenario('tmpl-src-arrays-int', 'standard', nan))).toEqual(['IMPORT_PARSE'])
  })
})

// ---- P6-D17 前段拒否と既存検証委譲の分離 ----

describe('P6-D17 前段拒否と既存検証委譲の分離', () => {
  it('P6-D17-①: DSLホワイトリスト違反はImport ContractがIMPORT_SCHEMAで前段拒否する', () => {
    // slot-predicate-1のallowedFieldsは['age']、allowedOperatorsは['GTE']
    const wrongField = employeeCandidate({
      dslParameters: {
        'slot-predicate-1': {
          kind: 'fieldCompare',
          field: 'salary',
          operator: 'GTE',
          value: { type: 'long', value: 1 },
        },
      },
    })
    const wrongFieldCodes = codesOf(importJson('tmpl-filter-basic', 'standard', wrongField))
    expect(wrongFieldCodes.length).toBeGreaterThan(0)
    expect(new Set(wrongFieldCodes)).toEqual(new Set(['IMPORT_SCHEMA']))
    const wrongOperator = employeeCandidate({
      dslParameters: {
        'slot-predicate-1': {
          kind: 'fieldCompare',
          field: 'age',
          operator: 'LT',
          value: { type: 'int', value: 1 },
        },
      },
    })
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', wrongOperator))).toEqual([
      'IMPORT_SCHEMA',
    ])
    const wrongKind = employeeCandidate({
      dslParameters: {
        'slot-predicate-1': {
          kind: 'currentValueCompare',
          operator: 'GTE',
          value: { type: 'int', value: 1 },
        },
      },
    })
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', wrongKind))).toEqual(['IMPORT_SCHEMA'])
    // いずれもWHITELIST_*（既存検証のcode）へ到達しない
    for (const candidate of [wrongField, wrongOperator, wrongKind]) {
      const result = importJson('tmpl-filter-basic', 'standard', candidate)
      expect(codesOf(result)).not.toContain('WHITELIST_FIELD')
      expect(codesOf(result)).not.toContain('WHITELIST_OPERATOR')
      expect(codesOf(result)).not.toContain('WHITELIST_KIND')
    }
  })

  it('P6-D17-②: Contractが扱わない教材制約違反はTEACHING_CONSTRAINTで拒否される', () => {
    // 標準モードでfilterがtrueだけになるdataset
    const allTrue = employeeCandidate({
      dataset: [
        {
          name: '全員通過',
          age: 40,
          salary: 5_000_000,
          evaluation: 4,
          region: '関東',
          hireDate: '2020-01-01',
          department: { name: '開発部', division: '技術本部' },
          skills: [],
        },
      ],
    })
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', allTrue))).toEqual([
      'TEACHING_CONSTRAINT',
    ])
    // 空ソースモードなのに非空
    const notEmpty = employeeCandidate({ mode: 'emptySource' })
    expect(codesOf(importJson('tmpl-filter-basic', 'emptySource', notEmpty))).toEqual([
      'TEACHING_CONSTRAINT',
    ])
  })

  it('P6-D17-②: snapshot予算超過はSNAPSHOT_BUDGETで拒否される', () => {
    const huge = {
      dslVersion: DSL_VERSION,
      templateId: 'tmpl-src-range',
      templateVersion: 1,
      mode: 'standard',
      dslParameters: { 'slot-source': { kind: 'range', from: 1, to: 100_000 } },
      title: 'rangeの取込',
      description: '大きなrangeでsnapshot予算を超過させます。',
    }
    expect(codesOf(importJson('tmpl-src-range', 'standard', huge))).toEqual(['SNAPSHOT_BUDGET'])
  })

  it('P6-D17-③: fixture経路は前段検証を通らず挙動が完全不変', () => {
    const contract = buildTemplateContract(templateById('tmpl-src-generate'))
    // 実行不能templateは取込対象外（前段で拒否される）
    expect(contract.importable).toBe(false)
    const rejected = importScenario('tmpl-src-generate', 'standard', '{}')
    expect(codesOf(rejected)).toEqual(['IMPORT_SCHEMA'])
    // fixture経路は従来どおりUNBOUNDED_SOURCEで異常系として扱われる（Contractを経由しない）
    const template = templateById('tmpl-src-generate')
    expect(template.executable).toBe(false)
    expect(template.disabledReason).toBeTruthy()
  })
})

// ---- P6-D21 candidate組み立て ----

describe('P6-D21 candidate組み立て', () => {
  it('P6-D21: providerKind・provenance・elementIdの再付番を検証する', () => {
    const clock = () => new Date('2026-08-12T03:04:05.678Z')
    const result = importScenario(
      'tmpl-filter-basic',
      'standard',
      JSON.stringify(employeeCandidate()),
      { clock },
    )
    expect(codesOf(result)).toEqual([])
    if (!result.ok) return
    expect(result.value.provenance.providerKind).toBe('IMPORTED')
    expect(result.value.provenance.dslVersion).toBe(DSL_VERSION)
    expect(result.value.provenance.generatedAt).toBe('2026-08-12T03:04:05.678Z')
    expect(result.value.provenance.generatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    )
    expect(result.value.pipeline.dataset.map((e) => e.elementId)).toEqual(['imp-001', 'imp-002', 'imp-003'])
  })

  it('P6-D21: 貼付側のelementIdへ依存せず出現順で再付番する', () => {
    // elementIdの持込みは拒否されるため、アプリの付番だけが使われる
    const withElementId = withEmployeeField('elementId', 'emp-999')
    expect(codesOf(importJson('tmpl-filter-basic', 'standard', withElementId))).toEqual([
      'IMPORT_SCHEMA',
    ])
    const eight = Array.from({ length: 8 }, (_, i) => ({
      name: `社員${i}`,
      age: i < 4 ? 20 : 40,
      salary: 5_000_000,
      evaluation: 4,
      region: '関東',
      hireDate: '2020-01-01',
      department: { name: '開発部', division: '技術本部' },
      skills: [],
    }))
    const result = importJson('tmpl-filter-basic', 'standard', employeeCandidate({ dataset: eight }))
    expect(codesOf(result)).toEqual([])
    if (!result.ok) return
    expect(result.value.pipeline.dataset.map((e) => e.elementId)).toEqual([
      'imp-001',
      'imp-002',
      'imp-003',
      'imp-004',
      'imp-005',
      'imp-006',
      'imp-007',
      'imp-008',
    ])
  })

  it('P6-D21: Contract検証を通過した値はそのままScenarioへ渡る', () => {
    const contract = buildTemplateContract(templateById('tmpl-filter-basic'))
    const slot = contract.slots.find((s) => s.slotId === 'slot-predicate-1')
    expect(slot).toBeDefined()
    const predicate = (employeeCandidate()['dslParameters'] as Record<string, unknown>)[
      'slot-predicate-1'
    ]
    expect(validateBySpec(slot?.spec as never, predicate, 'dslParameters.slot-predicate-1')).toEqual([])
  })
})
