import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/ui/appInstance'
import { FakeScheduler } from '../helpers'
import { IMPORTABLE_TEMPLATES, templateById } from '../p6-helpers'
import { DSL_VERSION } from '../../src/domain/dsl/ast'
import {
  buildTemplateContract,
  usesEmployeeDataset,
  type SpecNode,
} from '../../src/application/importContract'
import { buildImportPrompt, describeSpec, type PromptExample } from '../../src/application/promptGenerator'
import type { PipelineTemplate } from '../../src/domain/template/pipelineTemplate'
import { CandidateImportService } from '../../src/application/candidateImport'
import { createDefaultCatalog } from '../../src/domain/catalog/operations'
import { createDefaultTemplateRegistry } from '../../src/domain/template/templates'
import { FixtureScenarioProvider } from '../../src/providers/fixtureScenarioProvider'
import { buildScenario } from '../../src/application/scenarioFactory'
import type { ScenarioMode } from '../../src/domain/scenario/scenario'

/**
 * P6-A01〜P6-A05: Applicationテスト（Phase 6指示 §12.2、v0.10 §5・§7.4・§8）。
 */

const EXAMPLE_MARKER = '## 出力例\n\n'

function newApp() {
  const scheduler = new FakeScheduler()
  return { app: createApp({ scheduler }), scheduler }
}

/** プロンプトの出力例JSON（そのまま貼り付けられる1件）を取り出す */
function exampleJsonOf(prompt: string): string {
  const index = prompt.indexOf(EXAMPLE_MARKER)
  expect(index).toBeGreaterThan(-1)
  return prompt.slice(index + EXAMPLE_MARKER.length).trim()
}

function validCandidateFor(
  app: ReturnType<typeof newApp>['app'],
  templateId: string,
  mode: ScenarioMode,
): string {
  const prompt = app.generatePrompt(templateId, mode)
  expect(prompt.ok).toBe(true)
  if (!prompt.ok) throw new Error('プロンプトを生成できません')
  return exampleJsonOf(prompt.value)
}

describe('P6-A01 取込成立', () => {
  it('P6-A01: 取込成立はシナリオ切替意味論（タイマー停止・新revision・history 1件・cursor 0・READY）になる', () => {
    const { app, scheduler } = newApp()
    // 自動再生中に取込する
    app.session.stepForward()
    app.session.play()
    expect(app.session.getState().playbackState).toBe('PLAYING')
    expect(scheduler.pending.size).toBe(1)
    const before = app.session.getState().scenario

    const json = validCandidateFor(app, 'tmpl-filter-basic', 'standard')
    const result = app.importCandidate('tmpl-filter-basic', 'standard', json)
    expect(result.ok).toBe(true)

    const state = app.session.getState()
    expect(state.scenario.provenance.providerKind).toBe('IMPORTED')
    expect(state.scenario.revision).not.toBe(before.revision)
    expect(state.scenario.revision).toMatch(/^tmpl-filter-basic:standard:imp\d+$/)
    expect(state.historyLength).toBe(1)
    expect(state.cursor).toBe(0)
    expect(state.playbackState).toBe('READY')
    // 自動再生のタイマーは停止している
    expect(scheduler.pending.size).toBe(0)
  })

  it('P6-A01: 取込サンプルはscenarioIdへrevisionを含み、fixture系と衝突しない', () => {
    const { app } = newApp()
    const json = validCandidateFor(app, 'tmpl-filter-basic', 'standard')
    app.importCandidate('tmpl-filter-basic', 'standard', json)
    const scenario = app.session.getState().scenario
    expect(scenario.scenarioId).toBe(`tmpl-filter-basic:standard:${scenario.revision}`)
    expect(scenario.revision).toContain(':imp')
  })
})

describe('P6-A02 取込失敗', () => {
  it('P6-A02: 失敗時は現行シナリオ・履歴・再生状態が一切変化せず、issuesを取得できる', () => {
    const { app, scheduler } = newApp()
    app.session.stepForward()
    app.session.stepForward()
    const before = app.session.getState()
    const beforeSnapshot = before.snapshot

    const result = app.importCandidate('tmpl-filter-basic', 'standard', '{"dslVersion":"99"}')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.length).toBeGreaterThan(0)
    for (const issue of result.issues) {
      expect(typeof issue.code).toBe('string')
      expect(typeof issue.message).toBe('string')
      expect(typeof issue.path).toBe('string')
      expect(issue.message.length).toBeGreaterThan(0)
    }

    const after = app.session.getState()
    expect(after.scenario).toBe(before.scenario)
    expect(after.snapshot).toBe(beforeSnapshot)
    expect(after.cursor).toBe(before.cursor)
    expect(after.historyLength).toBe(before.historyLength)
    expect(after.playbackState).toBe(before.playbackState)
    expect(scheduler.pending.size).toBe(0)
  })

  it('P6-A02: 理由は修正依頼に使える具体性（code・対象path・message）を持つ', () => {
    const { app } = newApp()
    const json = validCandidateFor(app, 'tmpl-filter-basic', 'standard')
    const broken = json.replace('"operator": "GTE"', '"operator": "LT"')
    const result = app.importCandidate('tmpl-filter-basic', 'standard', broken)
    expect(result.ok).toBe(false)
    if (result.ok) return
    const issue = result.issues[0]
    expect(issue?.code).toBe('IMPORT_SCHEMA')
    expect(issue?.path).toContain('dslParameters.slot-predicate-1')
    expect(issue?.message).toContain('GTE')
  })

  it('P6-A02: 取込失敗でfixtureへ自動フォールバックしない', () => {
    const { app } = newApp()
    const before = app.session.getState().scenario
    app.importCandidate('tmpl-filter-basic', 'standard', 'not json')
    expect(app.session.getState().scenario).toBe(before)
    expect(app.session.getState().scenario.provenance.providerKind).toBe('FIXTURE')
  })
})

describe('P6-A03 プロンプト生成', () => {
  it('P6-A03: §8の1〜8がすべて含まれ、一致検証値が選択中の実値と一致する', () => {
    const { app } = newApp()
    const result = app.generatePrompt('tmpl-filter-basic', 'standard')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const prompt = result.value
    // 1. 依頼の説明
    expect(prompt).toContain('入力データ候補')
    expect(prompt).toContain('JSONだけを返してください')
    // 2. 構造説明と一致検証値
    expect(prompt).toContain('- templateId: "tmpl-filter-basic"')
    expect(prompt).toContain('- templateVersion: 1')
    expect(prompt).toContain('- mode: "standard"')
    expect(prompt).toContain(`- dslVersion: "${DSL_VERSION}"`)
    expect(prompt).toContain('ノード列:')
    expect(prompt).toContain('スロット一覧: slot-predicate-1')
    // 3. スロットごとの許可DSL
    expect(prompt).toContain('## スロットごとの許可DSL')
    expect(prompt).toContain('### slot-predicate-1')
    expect(prompt).toContain('"fieldCompare"')
    expect(prompt).toContain('"GTE"')
    // 4. dataset契約（ContractのdatasetSpecをそのまま言語化したものが載る）
    expect(prompt).toContain('## dataset契約')
    const contract = buildTemplateContract(templateById('tmpl-filter-basic'))
    expect(contract.datasetSpec).not.toBeNull()
    for (const line of describeSpec(contract.datasetSpec as SpecNode, '  ')) {
      expect(prompt, line).toContain(line)
    }
    // 5. 教材制約
    expect(prompt).toContain('## 教材制約')
    expect(prompt).toContain('通過（true）と除外（false）の双方')
    // 6. snapshot予算
    expect(prompt).toContain('## snapshot予算')
    expect(prompt).toContain('500')
    // 7. 出力形式
    expect(prompt).toContain('## 出力形式')
    expect(prompt).toContain('コードフェンスは不要')
    // 8. 出力例
    expect(prompt).toContain('## 出力例')
    expect(() => JSON.parse(exampleJsonOf(prompt))).not.toThrow()
  })

  it('P6-A03: datasetを使わないtemplateではdataset契約を省略し、dataset禁止を明示する', () => {
    const { app } = newApp()
    const result = app.generatePrompt('tmpl-src-arrays-int', 'standard')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).not.toContain('## dataset契約')
    expect(result.value).toContain('dataset キーは含めないでください')
    expect(usesEmployeeDataset(templateById('tmpl-src-arrays-int'))).toBe(false)
  })

  it('P6-A03: 実行不能templateではプロンプトを生成できない', () => {
    const { app } = newApp()
    for (const templateId of ['tmpl-src-generate', 'tmpl-src-iterate2']) {
      const result = app.generatePrompt(templateId, 'standard')
      expect(result.ok, templateId).toBe(false)
      if (result.ok) continue
      expect(result.issues[0]?.message, templateId).toContain('limit')
    }
  })

  // 走査対象は「取込対象の実行可能template」（Phase 7指示 §12冒頭で許可された最小更新）。
  // gather templateは実行可能だが取込対象外（importable: false）のためプロンプト生成へ到達しない。
  // 実行不能template（tmpl-src-generate / tmpl-src-iterate2）の検証は不変（後続のitが担う）。
  it('P6-A03: プロンプトの出力例は全実行可能template × modeでそのまま取込できる', () => {
    const failures: string[] = []
    for (const template of IMPORTABLE_TEMPLATES) {
      for (const mode of template.supportedModes) {
        const { app } = newApp()
        const prompt = app.generatePrompt(template.templateId, mode)
        if (!prompt.ok) {
          failures.push(`${template.templateId}:${mode} プロンプト生成に失敗`)
          continue
        }
        const result = app.importCandidate(template.templateId, mode, exampleJsonOf(prompt.value))
        if (!result.ok) {
          failures.push(
            `${template.templateId}:${mode} -> ${result.issues
              .map((i) => `${i.code}@${i.path}`)
              .join(' | ')}`,
          )
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('P6-A03: プロンプトのトップレベル・title・descriptionの記述がContractのspecから導出される', () => {
    const { app } = newApp()
    const result = app.generatePrompt('tmpl-filter-basic', 'standard')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const contract = buildTemplateContract(templateById('tmpl-filter-basic'))
    // トップレベルのキー集合と型はContractの値がそのまま載る
    expect(result.value).toContain(contract.topLevelKeys.join(', '))
    for (const key of contract.topLevelKeys) {
      expect(result.value, key).toContain(`- ${key}: ${contract.topLevelTypes[key]}`)
    }
    expect(result.value).toContain(contract.reservedTopLevelKeys.join(' / '))
    expect(result.value).toContain(contract.reservedDatasetKeys.join(' / '))
    expect(result.value).toContain(`${contract.textMaxLength} UTF-16 code unit以内`)
    // title / descriptionもspecの言語化がそのまま載る
    for (const spec of [contract.titleSpec, contract.descriptionSpec]) {
      for (const line of describeSpec(spec, '  ')) {
        expect(result.value, line).toContain(line)
      }
    }
    // 各slotの許可DSLもspecの言語化がそのまま載る
    for (const slot of contract.slots) {
      for (const line of describeSpec(slot.spec, '')) {
        expect(result.value, `${slot.slotId}: ${line}`).toContain(line)
      }
    }
  })

  it('P6-A03: Contract（template slot定義）を変えるとプロンプトの記述が追随する', () => {
    const base = templateById('tmpl-peek')
    const example: PromptExample = {
      dataset: [],
      dslParameters: { 'slot-consumer': { kind: 'printValue' } },
      title: '追随確認',
      description: 'slot定義の変更にプロンプトが追随することを確認します。',
    }
    const promptOf = (template: PipelineTemplate) =>
      buildImportPrompt({ template, mode: 'standard', dslVersion: DSL_VERSION, example })

    // 変更前: consumerはprintValue / printFieldの両方を許可する
    const before = promptOf(base)
    expect(before).toContain('"printValue"')
    expect(before).toContain('"printField"')
    expect(before).toContain('"hireDate"') // printFieldのfield列挙

    // slotのallowedConsumerKindsをprintValueだけへ狭めた仮想template
    const narrowedKinds: PipelineTemplate = {
      ...base,
      parameterSlots: base.parameterSlots.map((slot) =>
        slot.kind === 'consumer' ? { ...slot, allowedConsumerKinds: ['printValue'] } : slot,
      ),
    }
    const afterKinds = promptOf(narrowedKinds)
    expect(afterKinds).toContain('"printValue"')
    expect(afterKinds).not.toContain('"printField"')

    // allowedFieldsを狭めた場合もfield列挙が追随する
    const narrowedFields: PipelineTemplate = {
      ...base,
      parameterSlots: base.parameterSlots.map((slot) =>
        slot.kind === 'consumer' ? { ...slot, allowedFields: ['name'] } : slot,
      ),
    }
    const afterFields = promptOf(narrowedFields)
    expect(afterFields).toContain('"printField"')
    expect(afterFields).not.toContain('"hireDate"')

    // sourceDefinitionを差し替えるとdataset契約の有無が追随する
    const withoutDataset: PipelineTemplate = {
      ...base,
      sourceDefinition: { slotId: 'slot-source', defaultDsl: null, allowedSourceKinds: ['streamOf'] },
    }
    const afterSource = promptOf(withoutDataset)
    expect(afterSource).not.toContain('## dataset契約')
    expect(afterSource).toContain('dataset キーは含めないでください')
    expect(buildTemplateContract(withoutDataset).datasetSpec).toBeNull()
    expect(buildTemplateContract(withoutDataset).topLevelKeys).not.toContain('dataset')
  })

  it('P6-A03: プロンプトと前段検証が同一のContractノードを参照する', () => {
    // 検証側が使うspec（validateCandidateShapeが参照するcontract.*）と
    // プロンプト側が言語化するspecが同一オブジェクトであることを確認する
    const template = templateById('tmpl-filter-basic')
    const a = buildTemplateContract(template)
    const b = buildTemplateContract(template)
    expect(a.datasetSpec).toBe(b.datasetSpec)
    expect(a.titleSpec).toBe(b.titleSpec)
    expect(a.descriptionSpec).toBe(b.descriptionSpec)
    expect(a.topLevelTypes).toBe(b.topLevelTypes)
    expect(a.reservedTopLevelKeys).toBe(b.reservedTopLevelKeys)
    expect(a.reservedDatasetKeys).toBe(b.reservedDatasetKeys)
  })
})

describe('P6-A04 revision決定性', () => {
  it('P6-A04: 連続取込でrevisionがimp連番で単調増加し、現revisionと必ず異なる', () => {
    const { app } = newApp()
    const json = validCandidateFor(app, 'tmpl-filter-basic', 'standard')
    const revisions: string[] = []
    for (let i = 0; i < 3; i++) {
      const result = app.importCandidate('tmpl-filter-basic', 'standard', json)
      expect(result.ok).toBe(true)
      revisions.push(app.session.getState().scenario.revision)
    }
    expect(revisions).toEqual([
      'tmpl-filter-basic:standard:imp1',
      'tmpl-filter-basic:standard:imp2',
      'tmpl-filter-basic:standard:imp3',
    ])
    expect(new Set(revisions).size).toBe(3)
  })

  it('P6-A04: fixture切替と交互に行ってもrevisionが衝突しない', () => {
    const { app } = newApp()
    const json = validCandidateFor(app, 'tmpl-filter-basic', 'standard')
    const revisions: string[] = []
    for (let i = 0; i < 3; i++) {
      app.importCandidate('tmpl-filter-basic', 'standard', json)
      revisions.push(app.session.getState().scenario.revision)
      app.selectScenario('tmpl-filter-basic', 'standard')
      revisions.push(app.session.getState().scenario.revision)
    }
    expect(new Set(revisions).size).toBe(revisions.length)
    // fixture系は`r`連番、取込系は`imp`連番で構造的に区別される
    expect(revisions.filter((r) => r.includes(':imp')).length).toBe(3)
    expect(revisions.filter((r) => /:r\d+$/.test(r)).length).toBe(3)
  })

  it('P6-A04: 現在のrevisionと一致する場合は再採番される', () => {
    const catalog = createDefaultCatalog()
    const registry = createDefaultTemplateRegistry()
    const service = new CandidateImportService(registry, catalog)
    const { app } = newApp()
    const json = validCandidateFor(app, 'tmpl-filter-basic', 'standard')
    // 発行予定のrevisionを現在値として渡すと、次の番号が採番される
    const result = service.import({
      template: templateById('tmpl-filter-basic'),
      mode: 'standard',
      text: json,
      currentScenarioRevision: 'tmpl-filter-basic:standard:imp1',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.revision).toBe('tmpl-filter-basic:standard:imp2')
  })
})

describe('P6-A05 経路分離', () => {
  it('P6-A05: 取込経路はResultを返しthrowしない', () => {
    const { app } = newApp()
    const inputs = [
      '',
      'not json',
      '{}',
      '[]',
      'null',
      '{"dslVersion":1}',
      'x'.repeat(70_000),
      '```json\n{}\n```',
    ]
    for (const text of inputs) {
      expect(() => app.importCandidate('tmpl-filter-basic', 'standard', text), text.slice(0, 20)).not.toThrow()
      const result = app.importCandidate('tmpl-filter-basic', 'standard', text)
      expect(result.ok, text.slice(0, 20)).toBe(false)
    }
  })

  it('P6-A05: fixture経路は従来どおり（検証済みfixtureの失敗は異常系throw）で挙動不変', () => {
    const { app } = newApp()
    // 実行不能templateのfixture選択はthrowする（従来の異常系）
    expect(() => app.selectScenario('tmpl-src-generate', 'standard')).toThrow()
    expect(() => app.selectScenario('tmpl-unknown', 'standard')).toThrow()
    // 正常なfixture選択は従来どおり成功する
    app.selectScenario('tmpl-map', 'standard')
    expect(app.session.getState().scenario.provenance.providerKind).toBe('FIXTURE')
  })

  it('P6-A05: fixture経路は前段検証（Import Contract）を通らない', () => {
    // fixtureはbuildScenarioへ直接渡され、取込前段検証を経由しない
    const catalog = createDefaultCatalog()
    const registry = createDefaultTemplateRegistry()
    const provider = new FixtureScenarioProvider()
    const template = templateById('tmpl-filter-basic')
    const candidate = provider.generate({
      targetOperationId: template.targetOperationId,
      mode: 'standard',
      allowedTemplateIds: [template.templateId],
      templateId: template.templateId,
      dslVersion: DSL_VERSION,
      currentScenarioRevision: null,
    })
    expect(candidate.providerKind).toBe('FIXTURE')
    // fixtureのelementIdはemp-系のまま（取込のimp-系再付番を受けない）
    expect(candidate.dataset[0]?.elementId).toBe('emp-001')
    const result = buildScenario(registry, catalog, candidate)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.provenance.providerKind).toBe('FIXTURE')
    expect(result.value.provenance.generatedAt).toBe('2026-08-08T00:00:00+09:00')
  })

  it('P6-A05: 取込対象外templateはimportabilityOfで理由が取得できる', () => {
    const { app } = newApp()
    expect(app.importabilityOf('tmpl-filter-basic')).toEqual({ importable: true, reason: null })
    const disabled = app.importabilityOf('tmpl-src-generate')
    expect(disabled.importable).toBe(false)
    expect(disabled.reason).toContain('limit')
  })
})
