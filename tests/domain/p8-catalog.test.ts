import { describe, expect, it } from 'vitest'
import { createDefaultCatalog } from '../../src/domain/catalog/operations'
import { ALL_TEMPLATES } from '../../src/domain/template/templates'
import { P8_TEMPLATES, P8_TEMPLATE_IDS } from '../../src/domain/template/templatesP8'
import { expectedCompletionOf } from '../../src/domain/template/pipelineTemplate'
import { FixtureScenarioProvider } from '../../src/providers/fixtureScenarioProvider'
import { DSL_VERSION } from '../../src/domain/dsl/ast'
import { SNAPSHOT_LIMIT } from '../../src/domain/template/instantiate'
import { SOURCE_COLLECTION_IDS } from '../../src/domain/dsl/sourceAst'
import { validateSourceStructure } from '../../src/domain/dsl/validateSource'
import { materializeSource } from '../../src/domain/dsl/materializeSource'
import { sourceToJavaExpr } from '../../src/domain/dsl/javaCode'
import {
  TO_MAP_NOT_IMPORTABLE_REASON,
  buildTemplateContract,
  hasToMapCollectorSlot,
  validateBySpec,
} from '../../src/application/importContract'
import { createApp } from '../../src/ui/appInstance'
import { buildImportPrompt } from '../../src/application/promptGenerator'
import { STANDARD_EMPLOYEES } from '../../src/domain/fixtures/employees'
import { MERGE_DEMO_EMPLOYEES } from '../../src/domain/fixtures/mergeDemoEmployees'
import { FakeScheduler, makeDefinition, runAllSnapshots } from '../helpers'
import {
  EXECUTABLE_TEMPLATES,
  IMPORTABLE_TEMPLATES,
  TO_MAP_TEMPLATES,
  UNMODIFIABLE_TEMPLATES,
  collectFixtureJavaCode,
} from '../p6-helpers'
import { P8_TEMPLATE_MODES, lastOf, toMap2, toMap3, toMap4 } from '../p8-helpers'

/**
 * P8-D19〜P8-D22: Javaコード表示・catalog / template / source不変条件・取込対象外・
 * expectedCompletion総点検（Phase 8指示 §12.1）。
 */

/** §8.2の10ケースの確定snapshot件数 */
const EXPECTED_SNAPSHOT_COUNTS: Readonly<Record<string, number>> = {
  'tmpl-collect-tomap-identity:standard': 23,
  'tmpl-collect-tomap-identity:emptySource': 3,
  'tmpl-collect-tomap-duplicate:standard': 12,
  'tmpl-collect-tomap-merge-first:standard': 32,
  'tmpl-collect-tomap-merge-last:standard': 32,
  'tmpl-collect-tomap-merge-concat:standard': 32,
  'tmpl-collect-groupby-mergedemo:standard': 28,
  'tmpl-collect-tomap-treemap:standard': 26,
  'tmpl-collect-tomap-treemap:emptySource': 4,
  'tmpl-collect-tomap-grouped:standard': 31,
  // teeing×toMap（v0.12。Phase 8持越しのP8-D18 / P8-D15第6配置）
  'tmpl-collect-teeing-tomap:standard': 40,
  // 数値加算merge（v0.13。snapshot構造はmerge-first / last / concatと同形）
  'tmpl-collect-tomap-merge-sumint:standard': 32,
  'tmpl-collect-tomap-merge-sumlong:standard': 32,
  'tmpl-collect-tomap-merge-sumdouble:standard': 32,
  // unmodifiable系（v0.14。蓄積列は既存toList / toSet / toMapと同形で、末尾へ
  // COLLECTOR_FINISHEDが1件加わる。空入力は蓄積0件 + COLLECTOR_FINISHED。v0.14 §3.2）
  'tmpl-collect-tounmod-list:standard': 16,
  'tmpl-collect-tounmod-list:emptySource': 4,
  'tmpl-collect-tounmod-set:standard': 28,
  'tmpl-collect-tounmod-set:emptySource': 4,
  'tmpl-collect-tounmod-map:standard': 33,
}

describe('P8-D19 Javaコード表示', () => {
  it('P8-D19: 15 templateのcollect式が構文的に正当で実データと一致する', () => {
    const expected: Record<string, string> = {
      'tmpl-collect-teeing-tomap':
        '        .collect(Collectors.teeing(Collectors.toMap(Employee::region, Employee::name, (a, b) -> a, TreeMap::new), Collectors.counting(), RegionIndex::new));',
      'tmpl-collect-tomap-merge-sumint':
        '        .collect(Collectors.toMap(Employee::region, Employee::age, Integer::sum));',
      'tmpl-collect-tomap-merge-sumlong':
        '        .collect(Collectors.toMap(Employee::region, Employee::salary, Long::sum));',
      'tmpl-collect-tomap-merge-sumdouble':
        '        .collect(Collectors.toMap(Employee::region, Employee::evaluation, Double::sum));',
      'tmpl-collect-tomap-identity':
        '        .collect(Collectors.toMap(Employee::name, Function.identity()));',
      'tmpl-collect-tomap-duplicate':
        '        .collect(Collectors.toMap(Employee::region, Employee::name));',
      'tmpl-collect-tomap-merge-first':
        '        .collect(Collectors.toMap(Employee::region, Employee::name, (a, b) -> a));',
      'tmpl-collect-tomap-merge-last':
        '        .collect(Collectors.toMap(Employee::region, Employee::name, (a, b) -> b));',
      'tmpl-collect-tomap-merge-concat':
        '        .collect(Collectors.toMap(Employee::region, Employee::name, (s, a) -> s + ", " + a));',
      'tmpl-collect-groupby-mergedemo':
        '        .collect(Collectors.groupingBy(Employee::region));',
      'tmpl-collect-tomap-treemap':
        '        .collect(Collectors.toMap(Employee::region, Employee::salary, (a, b) -> a, TreeMap::new));',
      'tmpl-collect-tomap-grouped':
        '        .collect(Collectors.groupingBy(Employee::region, Collectors.toMap(Employee::name, Employee::salary)));',
      // unmodifiable系（v0.14 §2.1）
      'tmpl-collect-tounmod-list': '        .collect(Collectors.toUnmodifiableList());',
      'tmpl-collect-tounmod-set': '        .collect(Collectors.toUnmodifiableSet());',
      'tmpl-collect-tounmod-map':
        '        .collect(Collectors.toUnmodifiableMap(Employee::region, Employee::name, (a, b) -> a));',
    }
    for (const template of P8_TEMPLATES) {
      const def = makeDefinition(template.templateId, 'standard')
      const sinkLine = def.javaCode.find((line) => line.nodeId === 'node-sink')
      expect(sinkLine?.text, template.templateId).toBe(expected[template.templateId])
      // Javaコード・Java式はASCII構文（Unicode矢印を混入させない）
      expect(sinkLine?.text, template.templateId).not.toContain('→')
    }
    // Map fieldを持つmerger recordの宣言行がジェネリクス型込みで生成される（v0.12 §2）
    const teeingToMap = makeDefinition('tmpl-collect-teeing-tomap', 'standard')
    expect(teeingToMap.javaCode.map((l) => l.text).join('\n')).toContain(
      'record RegionIndex(Map<String, String> byRegion, long count) {}',
    )
  })

  it('P8-D19: source行・宣言行がcollectionIdと一致する（既存employeesの表示は不変）', () => {
    const identity = makeDefinition('tmpl-collect-tomap-identity', 'standard')
    expect(identity.javaCode.find((l) => l.nodeId === 'node-src')?.text).toBe(
      'Map<String, Employee> result = employees.stream()',
    )
    expect(identity.javaCode.map((l) => l.text).join('\n')).toContain(
      'List<Employee> employees = List.of(',
    )
    const mergeDemo = makeDefinition('tmpl-collect-tomap-merge-first', 'standard')
    expect(mergeDemo.javaCode.find((l) => l.nodeId === 'node-src')?.text).toBe(
      'Map<String, String> result = employeesMergeDemo.stream()',
    )
    const text = mergeDemo.javaCode.map((l) => l.text).join('\n')
    expect(text).toContain('List<Employee> employeesMergeDemo = List.of(')
    // 補助データセットの部署変数名は既存規約（development / sales）のまま解決される
    expect(text).toContain('Department development = new Department("開発部", "技術本部");')
    expect(text).toContain('Department sales = new Department("営業部", "営業本部");')
    expect(text).toContain('new Employee("伊藤", 31, 5_000_000L, 4.1, "関東",')
  })

  it('P8-D19: 型遷移表示がMap<K, U> / nested Mapになる', () => {
    const cases: readonly [string, string][] = [
      ['tmpl-collect-tomap-identity', 'Map<String, Employee>'],
      ['tmpl-collect-tomap-merge-first', 'Map<String, String>'],
      ['tmpl-collect-tomap-treemap', 'Map<String, Long>'],
      ['tmpl-collect-tomap-grouped', 'Map<String, Map<String, Long>>'],
      ['tmpl-collect-tomap-merge-sumint', 'Map<String, Integer>'],
      ['tmpl-collect-tomap-merge-sumlong', 'Map<String, Long>'],
      ['tmpl-collect-tomap-merge-sumdouble', 'Map<String, Double>'],
    ]
    for (const [templateId, expected] of cases) {
      const last = lastOf(templateId, 'standard')
      expect(last.output.resultTypeLabel, templateId).toBe(expected)
    }
  })

  it('P8-D19: 既存fixture（非Phase 8）のJavaコード出力が改修前後で不変である', () => {
    const current = collectFixtureJavaCode()
    const p8Keys = P8_TEMPLATE_MODES.map((m) => `${m.templateId}:${m.mode}`)
    for (const key of Object.keys(current)) {
      if (p8Keys.includes(key)) continue
      const text = current[key]?.join('\n') ?? ''
      expect(text, key).not.toContain('Collectors.toMap(')
      expect(text, key).not.toContain('Function.identity()')
      expect(text, key).not.toContain('employeesMergeDemo')
    }
  })
})

describe('P8-D20 catalog / template / source不変条件', () => {
  it('P8-D20: 操作総数46のまま（新operationIdなし）・collectのtraits不変', () => {
    const catalog = createDefaultCatalog()
    expect(catalog.list()).toHaveLength(46)
    expect(catalog.has('toMap')).toBe(false)
    expect(catalog.has('collectToMap')).toBe(false)
    expect([...catalog.get('collect').traits]).toEqual(['TERMINAL'])
    expect(catalog.get('collect').category).toBe('collector')
    // 全Phase 8 templateは既存collect operationを対象にする
    for (const template of P8_TEMPLATES) {
      expect(template.targetOperationId, template.templateId).toBe('collect')
    }
  })

  // v0.14（Phase 11）でunmodifiable系3 template（standard 3 + emptySource 2 = 5 mode）を追加した
  it('P8-D20: template総数133 / 実行可能131 / 実行可能×modes 241である', () => {
    expect(ALL_TEMPLATES).toHaveLength(133)
    expect(EXECUTABLE_TEMPLATES).toHaveLength(131)
    const combos = EXECUTABLE_TEMPLATES.reduce((n, t) => n + t.supportedModes.length, 0)
    expect(combos).toBe(241)
    expect(P8_TEMPLATES).toHaveLength(15)
    expect(P8_TEMPLATE_MODES).toHaveLength(19)
    expect(P8_TEMPLATE_MODES.filter((m) => m.mode === 'standard')).toHaveLength(15)
    expect(P8_TEMPLATE_MODES.filter((m) => m.mode === 'emptySource')).toHaveLength(4)
  })

  it('P8-D20: midEmptyは全Phase 8 templateで非対応である', () => {
    for (const template of P8_TEMPLATES) {
      expect(template.supportedModes, template.templateId).not.toContain('midEmpty')
    }
  })

  it('P8-D20: 全Phase 8 template × modeにfixtureが存在する（19件）', () => {
    const provider = new FixtureScenarioProvider()
    const allowedTemplateIds = ALL_TEMPLATES.map((t) => t.templateId)
    for (const { templateId, mode } of P8_TEMPLATE_MODES) {
      const template = ALL_TEMPLATES.find((t) => t.templateId === templateId)!
      expect(() =>
        provider.generate({
          targetOperationId: template.targetOperationId,
          mode,
          allowedTemplateIds,
          templateId,
          dslVersion: DSL_VERSION,
          currentScenarioRevision: null,
        }),
      ).not.toThrow()
    }
  })

  it('P8-D20: toMap / unmodifiable全ケースのsnapshotCount実測が計と一致し、予算内である', () => {
    for (const { templateId, mode } of P8_TEMPLATE_MODES) {
      const key = `${templateId}:${mode}`
      const def = makeDefinition(templateId, mode)
      const actual = runAllSnapshots(def).length
      expect(actual, key).toBe(EXPECTED_SNAPSHOT_COUNTS[key])
      expect(def.snapshotCount, key).toBe(actual)
      expect(actual, key).toBeLessThanOrEqual(SNAPSHOT_LIMIT)
      const template = ALL_TEMPLATES.find((t) => t.templateId === templateId)!
      expect(actual, key).toBeLessThanOrEqual(template.snapshotBudget.estimatedMax)
    }
  })

  it('P8-D20: source契約 — employeesMergeDemoの受理と未知collectionIdの拒否', () => {
    expect([...SOURCE_COLLECTION_IDS]).toEqual(['employees', 'employeesMergeDemo'])
    for (const collectionId of SOURCE_COLLECTION_IDS) {
      expect(validateSourceStructure({ kind: 'collection', collectionId }).ok, collectionId).toBe(
        true,
      )
    }
    for (const collectionId of ['employeesDemo', 'departments', '', 'EMPLOYEES']) {
      const result = validateSourceStructure({ kind: 'collection', collectionId })
      expect(result.ok, collectionId).toBe(false)
      if (!result.ok) {
        expect(result.issues[0]?.code).toBe('STRUCTURE_UNKNOWN_KIND')
        expect(result.issues[0]?.path).toBe('source.collectionId')
      }
    }
  })

  it('P8-D20: standardでemp-101〜105が定義順に具現化され、emptySourceで0件になる', () => {
    const dsl = { kind: 'collection', collectionId: 'employeesMergeDemo' } as const
    const materialized = materializeSource(dsl, MERGE_DEMO_EMPLOYEES)
    expect(materialized.elements.map((e) => e.elementId)).toEqual([
      'emp-101',
      'emp-102',
      'emp-103',
      'emp-104',
      'emp-105',
    ])
    expect(materialized.elements.map((e) => e.index)).toEqual([0, 1, 2, 3, 4])
    expect(materializeSource(dsl, []).elements).toEqual([])
    // 実際のtemplate経路でも同じ順序になる
    const def = makeDefinition('tmpl-collect-tomap-duplicate', 'standard')
    expect(def.dataset.map((e) => e.elementId)).toEqual([
      'emp-101',
      'emp-102',
      'emp-103',
      'emp-104',
      'emp-105',
    ])
  })

  it('P8-D20: 既存employeesデータセットの値・順序・Javaコード表示が不変である', () => {
    expect(STANDARD_EMPLOYEES.map((e) => e.elementId)).toEqual([
      'emp-001',
      'emp-002',
      'emp-003',
      'emp-004',
    ])
    expect(STANDARD_EMPLOYEES.map((e) => e.value.name)).toEqual(['佐藤', '鈴木', '高橋', '田中'])
    expect(sourceToJavaExpr({ kind: 'collection', collectionId: 'employees' })).toBe(
      'employees.stream()',
    )
    expect(sourceToJavaExpr({ kind: 'collection', collectionId: 'employeesMergeDemo' })).toBe(
      'employeesMergeDemo.stream()',
    )
    // 補助データセットは既存elementIdと衝突しない
    const standardIds = new Set(STANDARD_EMPLOYEES.map((e) => e.elementId))
    for (const element of MERGE_DEMO_EMPLOYEES) {
      expect(standardIds.has(element.elementId), element.elementId).toBe(false)
    }
    expect(MERGE_DEMO_EMPLOYEES).toHaveLength(5)
    expect(MERGE_DEMO_EMPLOYEES.filter((e) => e.value.region === '関東')).toHaveLength(3)
  })

  it('P8-D20: 全templateのcollectionIdとfixture datasetの対応が一致する（単一定義源の機械検証）', () => {
    const provider = new FixtureScenarioProvider()
    const allowedTemplateIds = ALL_TEMPLATES.map((t) => t.templateId)
    // collectionIdは検証・表示・Javaコード上の識別子であり、データ選択の単一定義源は
    // FixtureScenarioProviderのdatasetである（指示§5.2）。両者の対応が崩れていないこと
    // （= fixtureのelementIdがcollectionIdの示すデータセットの部分集合であること）を機械検証する
    const idsByCollectionId: Readonly<Record<string, ReadonlySet<string>>> = {
      employees: new Set(STANDARD_EMPLOYEES.map((e) => e.elementId)),
      employeesMergeDemo: new Set(MERGE_DEMO_EMPLOYEES.map((e) => e.elementId)),
    }
    let checked = 0
    for (const template of EXECUTABLE_TEMPLATES) {
      const defaultDsl = template.sourceDefinition.defaultDsl
      if (defaultDsl?.kind !== 'collection') continue
      for (const mode of template.supportedModes) {
        const candidate = provider.generate({
          targetOperationId: template.targetOperationId,
          mode,
          allowedTemplateIds,
          templateId: template.templateId,
          dslVersion: DSL_VERSION,
          currentScenarioRevision: null,
        })
        const key = `${template.templateId}:${mode}`
        const allowed = idsByCollectionId[defaultDsl.collectionId]
        expect(allowed, key).toBeDefined()
        for (const element of candidate.dataset) {
          expect(allowed?.has(element.elementId), `${key}: ${element.elementId}`).toBe(true)
        }
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(0)
    // Phase 8のmergeDemo系templateは補助データセット5件をそのまま使う
    for (const templateId of [
      'tmpl-collect-tomap-duplicate',
      'tmpl-collect-tomap-merge-first',
      'tmpl-collect-tomap-merge-last',
      'tmpl-collect-tomap-merge-concat',
      'tmpl-collect-groupby-mergedemo',
      'tmpl-collect-tomap-merge-sumint',
      'tmpl-collect-tomap-merge-sumlong',
      'tmpl-collect-tomap-merge-sumdouble',
    ]) {
      expect(makeDefinition(templateId, 'standard').dataset.map((e) => e.elementId), templateId).toEqual(
        MERGE_DEMO_EMPLOYEES.map((e) => e.elementId),
      )
    }
  })
})

describe('P8-D21 取込対象外（§7.7）', () => {
  it('P8-D21: toMapを含む11 templateがimportable: falseで理由文言を持つ', () => {
    expect(TO_MAP_TEMPLATES).toHaveLength(11)
    for (const template of TO_MAP_TEMPLATES) {
      const contract = buildTemplateContract(template)
      expect(contract.importable, template.templateId).toBe(false)
      expect(contract.disabledReason, template.templateId).toBe(TO_MAP_NOT_IMPORTABLE_REASON)
      expect(contract.disabledReason).toContain('toMap')
      expect(contract.disabledReason).toContain('取込対象外')
    }
    // 導出はtemplate定義（slot許可kind）由来であり、新規template属性を追加していない。
    // v0.14（Phase 11）でunmodifiable系3 templateがP8_TEMPLATESへ加わったため、
    // 「P8 template群の取込対象外 = toMap含有 ∪ unmodifiable含有」の和集合等式で表す
    // （両者は排他であり、残る1件はgroupby比較templateのみ）
    const toMapIds = TO_MAP_TEMPLATES.map((t) => t.templateId)
    const unmodifiableIds = UNMODIFIABLE_TEMPLATES.map((t) => t.templateId)
    expect(toMapIds.filter((id) => unmodifiableIds.includes(id))).toEqual([])
    expect([...toMapIds, ...unmodifiableIds].sort()).toEqual(
      P8_TEMPLATE_IDS.filter((id) => id !== 'tmpl-collect-groupby-mergedemo').sort(),
    )
  })

  it('P8-D21: 正規のtoMap DSL値はContract検証で受理されない（collectorVariantsへ未追加）', () => {
    for (const template of TO_MAP_TEMPLATES) {
      const contract = buildTemplateContract(template)
      const slot = contract.slots.find((s) => s.role === 'collector')
      expect(slot, template.templateId).toBeDefined()
      if (!slot) continue
      for (const dsl of [toMap2(), toMap3('first'), toMap4('first')]) {
        const issues = validateBySpec(slot.spec, dsl, 'collector')
        expect(issues.length, `${template.templateId}: ${JSON.stringify(dsl)}`).toBeGreaterThan(0)
        expect(issues[0]?.code).toBe('IMPORT_SCHEMA')
      }
    }
  })

  it('P8-D21: tmpl-collect-groupby-mergedemoはimportable: trueで既存Contract機構が受理する', () => {
    const template = ALL_TEMPLATES.find((t) => t.templateId === 'tmpl-collect-groupby-mergedemo')!
    expect(hasToMapCollectorSlot(template)).toBe(false)
    const contract = buildTemplateContract(template)
    expect(contract.importable).toBe(true)
    expect(contract.disabledReason).toBeNull()
    const slot = contract.slots.find((s) => s.role === 'collector')!
    const groupingByDsl = {
      kind: 'groupingBy',
      classifier: { kind: 'employeeField', field: 'region' },
      mapFactoryId: null,
      downstream: null,
    }
    expect(validateBySpec(slot.spec, groupingByDsl, 'collector')).toEqual([])
    // toMapはこのslotの許可kindに含まれないため受理されない
    expect(validateBySpec(slot.spec, toMap2(), 'collector').length).toBeGreaterThan(0)
  })

  it('P8-D21: 非toMap templateのimportability・Contract内容・プロンプト文面が不変である', () => {
    const app = createApp({ scheduler: new FakeScheduler() })
    for (const template of IMPORTABLE_TEMPLATES) {
      const contract = buildTemplateContract(template)
      expect(contract.importable, template.templateId).toBe(true)
      expect(contract.disabledReason, template.templateId).toBeNull()
      expect(hasToMapCollectorSlot(template), template.templateId).toBe(false)
      expect(app.importabilityOf(template.templateId).importable, template.templateId).toBe(true)
      // Contractのslot specにtoMap variantが混入していない
      expect(JSON.stringify(contract.slots), template.templateId).not.toContain('toMap')
      // プロンプトの**許可範囲の言語化**にtoMapが現れない
      // （tmpl-collect-groupby-mergedemoのtitleは教材上の相互参照としてtoMapへ言及するため、
      //   文字列全体の非含有ではなくkind列挙・Java式の非含有で検証する）
      const mode = template.supportedModes[0]!
      const prompt = buildImportPrompt({
        template,
        mode,
        dslVersion: DSL_VERSION,
        example: { dataset: [], dslParameters: {}, title: 't', description: 'd' },
      })
      expect(prompt, template.templateId).not.toContain('"toMap"')
      expect(prompt, template.templateId).not.toContain('Collectors.toMap')
      expect(prompt, template.templateId).not.toContain('mergeFunctionId')
      expect(prompt, template.templateId).not.toContain('valueMapper')
    }
  })

  it('P8-D21: toMap template選択中の取込系操作はbuildScenarioへ到達せず理由を返す', () => {
    const app = createApp({ scheduler: new FakeScheduler() })
    for (const template of TO_MAP_TEMPLATES) {
      const mode = template.supportedModes[0]!
      const importability = app.importabilityOf(template.templateId)
      expect(importability.importable, template.templateId).toBe(false)
      expect(importability.reason, template.templateId).toBe(TO_MAP_NOT_IMPORTABLE_REASON)
      // プロンプト生成も取込も、throwせず失敗理由を返す
      const prompt = app.generatePrompt(template.templateId, mode)
      expect(prompt.ok, template.templateId).toBe(false)
      const imported = app.importCandidate(template.templateId, mode, '{}')
      expect(imported.ok, template.templateId).toBe(false)
    }
  })
})

describe('P8-D22 expectedCompletion総点検（P6-D22の後継常設）', () => {
  const rows = EXECUTABLE_TEMPLATES.flatMap((template) =>
    template.supportedModes.map((mode) => {
      const def = makeDefinition(template.templateId, mode)
      const snapshots = runAllSnapshots(def)
      const last = snapshots[snapshots.length - 1]!
      return {
        key: `${template.templateId}:${mode}`,
        expected: expectedCompletionOf(template),
        actual: last.completion,
        snapshots: snapshots.length,
        javaCodeLines: def.javaCode.length,
      }
    }),
  )

  it('P8-D22: 全実行可能template（131件）× mode（241組合せ）を走査している', () => {
    expect(EXECUTABLE_TEMPLATES).toHaveLength(131)
    expect(rows).toHaveLength(241)
  })

  it('P8-D22: 全組合せがexpectedCompletionどおりの終端へ到達する', () => {
    const mismatched = rows.filter((row) => row.actual !== row.expected)
    expect(mismatched.map((r) => `${r.key}: expected=${r.expected} actual=${r.actual}`)).toEqual([])
    // 失敗templateはtmpl-collect-tomap-duplicateの1件だけ
    expect(rows.filter((r) => r.expected === 'EXECUTION_FAILED').map((r) => r.key)).toEqual([
      'tmpl-collect-tomap-duplicate:standard',
    ])
  })

  it('P8-D22: 全組合せがsnapshot安全上限に収まり、Javaコード表示が生成される', () => {
    expect(rows.filter((r) => r.snapshots > SNAPSHOT_LIMIT).map((r) => r.key)).toEqual([])
    expect(rows.filter((r) => r.javaCodeLines === 0).map((r) => r.key)).toEqual([])
  })

  it('P8-D22: expectedCompletion未指定のtemplateは既定でSTREAM_CONSUMEDである', () => {
    for (const template of EXECUTABLE_TEMPLATES) {
      if (template.expectedCompletion === undefined) {
        expect(expectedCompletionOf(template), template.templateId).toBe('STREAM_CONSUMED')
      }
    }
    const withField = EXECUTABLE_TEMPLATES.filter((t) => t.expectedCompletion !== undefined)
    expect(withField.map((t) => t.templateId)).toEqual(['tmpl-collect-tomap-duplicate'])
  })
})
