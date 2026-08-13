import { describe, expect, it } from 'vitest'
import { createDefaultCatalog, OP_GATHER } from '../../src/domain/catalog/operations'
import { ALL_TEMPLATES } from '../../src/domain/template/templates'
import { P7_TEMPLATES } from '../../src/domain/template/templatesP7'
import { FixtureScenarioProvider } from '../../src/providers/fixtureScenarioProvider'
import { DSL_VERSION } from '../../src/domain/dsl/ast'
import { SNAPSHOT_LIMIT } from '../../src/domain/template/instantiate'
import {
  buildTemplateContract,
  GATHERER_REJECT_ALL_SPEC,
  GATHER_NOT_IMPORTABLE_REASON,
  hasGatherNode,
  validateBySpec,
} from '../../src/application/importContract'
import { createApp } from '../../src/ui/appInstance'
import { gatherTemplateModes, runGather } from '../p7-helpers'
import { FakeScheduler, makeDefinition } from '../helpers'
import {
  collectFixtureJavaCode,
  IMPORTABLE_TEMPLATES,
  PHASE7_EXECUTABLE_TEMPLATES,
  PHASE7_TEMPLATES,
} from '../p6-helpers'
import { gathererToJavaExpr } from '../../src/domain/dsl/javaCode'

/**
 * P7-D19〜P7-D21: Javaコード表示・catalog / template不変条件・取込対象外
 * （Phase 7指示 §12.1）。
 */

describe('P7-D19 Javaコード表示', () => {
  it('P7-D19: 7 templateの.gather(Gatherers.…)式が構文的に正当で実データと一致する', () => {
    const expected: Record<string, string> = {
      'tmpl-gather-window-fixed': '        .gather(Gatherers.windowFixed(3))',
      'tmpl-gather-window-fixed-exact': '        .gather(Gatherers.windowFixed(2))',
      'tmpl-gather-window-sliding': '        .gather(Gatherers.windowSliding(2))',
      'tmpl-gather-window-sliding-short': '        .gather(Gatherers.windowSliding(3))',
      'tmpl-gather-scan': '        .gather(Gatherers.scan(() -> 0, (acc, n) -> acc + n))',
      'tmpl-gather-scan-concat': '        .gather(Gatherers.scan(() -> "", (acc, s) -> acc + s))',
      'tmpl-gather-fold':
        '        .gather(Gatherers.fold(() -> 0L, (acc, e) -> acc + e.salary()))',
    }
    for (const template of P7_TEMPLATES) {
      const def = makeDefinition(template.templateId, 'standard')
      const gatherLine = def.javaCode.find((line) => line.nodeId === 'node-gather')
      expect(gatherLine, template.templateId).toBeDefined()
      expect(gatherLine?.text, template.templateId).toBe(expected[template.templateId])
      // Unicode矢印を混入させない（ASCII構文のlambda）
      expect(gatherLine?.text).not.toContain('→')
    }
  })

  it('P7-D19: Javaコード行はgatherノードと1対1で対応する', () => {
    for (const { templateId, mode } of gatherTemplateModes()) {
      const def = makeDefinition(templateId, mode)
      const gatherLines = def.javaCode.filter((line) => line.nodeId === 'node-gather')
      expect(gatherLines, `${templateId}:${mode}`).toHaveLength(1)
    }
  })

  it('P7-D19: 評価結果と表示が一致する（scanのlambdaが実際の累積と同じ演算）', () => {
    // scan: 0 -> 3 -> 4 -> 8（(acc, n) -> acc + n）
    const scan = runGather('tmpl-gather-scan', 'standard')
    const last = scan.snapshots[scan.snapshots.length - 1]!
    expect(last.output.items.map((i) => i.label)).toEqual(['3', '4', '8'])
    // fold: 0L -> 21_700_000L（(acc, e) -> acc + e.salary()）
    const fold = runGather('tmpl-gather-fold', 'standard')
    const foldLast = fold.snapshots[fold.snapshots.length - 1]!
    expect(foldLast.output.result).toMatchObject({ valueLabel: '21_700_000L' })
  })

  it('P7-D19: gathererToJavaExprは検証済みDSLから決定的に生成する', () => {
    expect(gathererToJavaExpr({ kind: 'windowFixed', size: 16 })).toBe('Gatherers.windowFixed(16)')
    expect(gathererToJavaExpr({ kind: 'windowSliding', size: 1 })).toBe(
      'Gatherers.windowSliding(1)',
    )
    expect(
      gathererToJavaExpr({
        kind: 'fold',
        initial: { type: 'double', value: 0 },
        accumulation: { kind: 'employeeFieldSum', field: 'evaluation' },
      }),
    ).toBe('Gatherers.fold(() -> 0.0, (acc, e) -> acc + e.evaluation())')
  })

  it('P7-D19: 既存fixture（非gather）のJavaコード出力が改修前後で不変である', () => {
    const current = collectFixtureJavaCode()
    const gatherKeys = P7_TEMPLATES.flatMap((t) =>
      t.supportedModes.map((mode) => `${t.templateId}:${mode}`),
    )
    for (const key of Object.keys(current)) {
      if (gatherKeys.includes(key)) continue
      // 非gather fixtureにgather行が混入していないこと
      expect(current[key]?.join('\n'), key).not.toContain('.gather(')
      expect(current[key]?.join('\n'), key).not.toContain('Gatherers.')
    }
  })
})

describe('P7-D20 catalog / template不変条件', () => {
  const catalog = createDefaultCatalog()

  it('P7-D20: gatherがintermediate / INTERMEDIATE+STATEFULで登録され46操作目である', () => {
    const def = catalog.get(OP_GATHER)
    expect(def.category).toBe('intermediate')
    expect([...def.traits].sort()).toEqual(['INTERMEDIATE', 'STATEFUL'])
    expect(def.inputTypeRule).toEqual({ kind: 'anyStream' })
    expect(def.outputTypeRule).toEqual({ kind: 'fromGatherer' })
    expect(def.legendStates).toEqual(['UNEVALUATED', 'PROCESSING', 'PASSED', 'BUFFERED'])
    expect(def.displayName).toBe('gather')
    expect(catalog.list()).toHaveLength(46)
  })

  it('P7-D20: 組み込み4種は操作として登録しない（DSL kindとtemplateで表現する）', () => {
    const ids = catalog.list().map((d) => d.operationId)
    for (const kind of ['windowFixed', 'windowSliding', 'scan', 'fold', 'mapConcurrent']) {
      expect(ids, kind).not.toContain(kind)
    }
  })

  it('P7-D20: jdkNotesにstateful引用・integrator false短絡・mapConcurrent対象外を含む', () => {
    const notes = catalog.get(OP_GATHER).jdkNotes.join('\n')
    expect(notes).toContain('stateful intermediate operation')
    expect(notes).toContain('integrator')
    expect(notes).toContain('false')
    expect(notes).toContain('mapConcurrent')
    expect(notes).toContain('combiner')
  })

  it('P7-D20: 既存45操作の定義が不変である', () => {
    // Phase 6完了時点の操作ID一覧（gatherを除く45件）
    const ids = catalog
      .list()
      .map((d) => d.operationId)
      .filter((id) => id !== OP_GATHER)
    expect(ids).toHaveLength(45)
    // 既存操作へSTATEFUL / traitsを後付けしていないこと（代表確認）
    expect([...catalog.get('sorted').traits].sort()).toEqual(['INTERMEDIATE', 'STATEFUL'])
    expect([...catalog.get('map').traits].sort()).toEqual(['INTERMEDIATE', 'STATELESS'])
    expect([...catalog.get('collect').traits]).toEqual(['TERMINAL'])
  })

  /**
   * **Phase 8指示 §12冒頭の意図的更新**: 固定値検証の対象を**Phase 7完了時点のtemplate集合**へ
   * スコープ固定した（`ALL_TEMPLATES`から`P8_TEMPLATES`全件を除外）。
   * 「toMap非含有」での抽出では新設`tmpl-collect-groupby-mergedemo`が残り119 / 117 / 223となり
   * Phase 7時点集合と一致しないため、除外はtemplate ID集合で行う。
   * Phase 8の件数検証（126 / 124 / 232）はP8-D20が担う。
   */
  it('P7-D20: template総数118 / 実行可能116 / 実行可能×modes 222である（Phase 7完了時点集合）', () => {
    expect(PHASE7_TEMPLATES).toHaveLength(118)
    expect(PHASE7_EXECUTABLE_TEMPLATES).toHaveLength(116)
    const combos = PHASE7_EXECUTABLE_TEMPLATES.reduce((n, t) => n + t.supportedModes.length, 0)
    expect(combos).toBe(222)
    expect(P7_TEMPLATES).toHaveLength(7)
  })

  it('P7-D20: 全gather template × modeにfixtureが存在する（standard 7 + emptySource 4 = 11）', () => {
    const provider = new FixtureScenarioProvider()
    const allowedTemplateIds = ALL_TEMPLATES.map((t) => t.templateId)
    const modes = gatherTemplateModes()
    expect(modes).toHaveLength(11)
    expect(modes.filter((m) => m.mode === 'standard')).toHaveLength(7)
    expect(modes.filter((m) => m.mode === 'emptySource')).toHaveLength(4)
    for (const { templateId, mode } of modes) {
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

  it('P7-D20: midEmptyは全gather templateで非対応である', () => {
    for (const template of P7_TEMPLATES) {
      expect(template.supportedModes, template.templateId).not.toContain('midEmpty')
    }
  })

  it('P7-D20: gather全ケースのsnapshotCount実測が§8.2の計と一致し、予算内である', () => {
    const expected: Record<string, number> = {
      'tmpl-gather-window-fixed:standard': 21,
      'tmpl-gather-window-fixed:emptySource': 5,
      'tmpl-gather-window-fixed-exact:standard': 21,
      'tmpl-gather-window-sliding:standard': 23,
      'tmpl-gather-window-sliding:emptySource': 5,
      'tmpl-gather-window-sliding-short:standard': 13,
      'tmpl-gather-scan:standard': 28,
      'tmpl-gather-scan:emptySource': 4,
      'tmpl-gather-scan-concat:standard': 19,
      'tmpl-gather-fold:standard': 20,
      'tmpl-gather-fold:emptySource': 8,
    }
    for (const { templateId, mode } of gatherTemplateModes()) {
      const def = makeDefinition(templateId, mode)
      const key = `${templateId}:${mode}`
      expect(def.snapshotCount, key).toBe(expected[key])
      expect(def.snapshotCount, key).toBeLessThanOrEqual(SNAPSHOT_LIMIT)
    }
    // 実測最大は28件（snapshotBudget.estimatedMax = 40の範囲内）
    expect(Math.max(...Object.values(expected))).toBe(28)
    for (const template of P7_TEMPLATES) {
      expect(template.snapshotBudget).toEqual({ limit: 500, estimatedMax: 40 })
    }
  })

  it('P7-D20: gatherノードは1 Pipelineに1つで、下流に短絡操作を置かない（v0.9 §8.4）', () => {
    const shortCircuiting = ['limit', 'takeWhile', 'anyMatch', 'allMatch', 'noneMatch', 'findAny']
    for (const template of P7_TEMPLATES) {
      const gatherNodes = template.nodes.filter((n) => n.operationId === 'gather')
      expect(gatherNodes, template.templateId).toHaveLength(1)
      const gatherIndex = template.nodes.findIndex((n) => n.operationId === 'gather')
      for (const node of template.nodes.slice(gatherIndex + 1)) {
        expect(shortCircuiting, `${template.templateId}.${node.nodeId}`).not.toContain(
          node.operationId,
        )
      }
    }
  })

  it('P7-D20: scan / foldノードの凡例からBUFFEREDが除かれる（window系は保持）', () => {
    const windowDef = makeDefinition('tmpl-gather-window-fixed', 'standard')
    const windowNode = windowDef.nodes.find((n) => n.nodeId === 'node-gather')!
    expect(windowNode.legendStates).toContain('BUFFERED')
    for (const templateId of ['tmpl-gather-scan', 'tmpl-gather-fold']) {
      const def = makeDefinition(templateId, 'standard')
      const node = def.nodes.find((n) => n.nodeId === 'node-gather')!
      expect(node.legendStates, templateId).not.toContain('BUFFERED')
      expect(node.legendStates, templateId).toEqual(['UNEVALUATED', 'PROCESSING', 'PASSED'])
    }
  })
})

describe('P7-D21 取込対象外（§7.8）', () => {
  it('P7-D21: gather 7 templateはimportable: falseで理由文言を持つ', () => {
    for (const template of P7_TEMPLATES) {
      const contract = buildTemplateContract(template)
      expect(contract.importable, template.templateId).toBe(false)
      expect(contract.disabledReason, template.templateId).toBe(GATHER_NOT_IMPORTABLE_REASON)
      expect(contract.disabledReason).toContain('gather')
      expect(contract.disabledReason).toContain('取込対象外')
    }
  })

  it('P7-D21: gatherer slotの全拒否specは正規4 kindを含む任意値をすべて拒否する', () => {
    expect(GATHERER_REJECT_ALL_SPEC).toEqual({
      node: 'enum',
      values: [],
      label: 'gatherer（取込対象外）',
    })
    const values: unknown[] = [
      // 正しいGatherer DSL値（正規4 kind）も拒否する
      { kind: 'windowFixed', size: 3 },
      { kind: 'windowSliding', size: 2 },
      { kind: 'scan', initial: { type: 'int', value: 0 }, accumulation: { kind: 'numericSum' } },
      { kind: 'fold', initial: { type: 'long', value: 0 }, accumulation: { kind: 'numericSum' } },
      // その他の任意値
      null,
      'windowFixed',
      42,
      [],
      {},
      true,
    ]
    for (const value of values) {
      const issues = validateBySpec(GATHERER_REJECT_ALL_SPEC, value, 'x')
      expect(issues.length, JSON.stringify(value)).toBeGreaterThan(0)
      expect(issues[0]?.code).toBe('IMPORT_SCHEMA')
    }
  })

  it('P7-D21: 全gather templateのgatherer slotに全拒否specが割り当てられる', () => {
    for (const template of P7_TEMPLATES) {
      const contract = buildTemplateContract(template)
      const slot = contract.slots.find((s) => s.role === 'gatherer')
      expect(slot, template.templateId).toBeDefined()
      expect(slot?.spec, template.templateId).toEqual(GATHERER_REJECT_ALL_SPEC)
      // 全slotにspecが割り当てられている（undefinedのruntime穴がない）
      for (const s of contract.slots) {
        expect(s.spec, `${template.templateId}.${s.slotId}`).toBeDefined()
      }
    }
  })

  it('P7-D21: gather DSLを受理するContract specを追加していない（取込開放になる）', () => {
    for (const template of P7_TEMPLATES) {
      const contract = buildTemplateContract(template)
      const json = JSON.stringify(contract)
      for (const kind of ['windowFixed', 'windowSliding']) {
        expect(json, `${template.templateId}:${kind}`).not.toContain(`"${kind}"`)
      }
    }
  })

  it('P7-D21: 非gather templateのimportability・Contract内容が不変である', () => {
    for (const template of IMPORTABLE_TEMPLATES) {
      const contract = buildTemplateContract(template)
      expect(contract.importable, template.templateId).toBe(true)
      expect(contract.disabledReason, template.templateId).toBeNull()
      expect(hasGatherNode(template), template.templateId).toBe(false)
    }
    // 実行不能templateの理由は従来どおり（gather由来に上書きされない）
    for (const template of ALL_TEMPLATES.filter((t) => t.executable === false)) {
      const contract = buildTemplateContract(template)
      expect(contract.importable, template.templateId).toBe(false)
      expect(contract.disabledReason, template.templateId).not.toBe(GATHER_NOT_IMPORTABLE_REASON)
    }
  })

  it('P7-D21: gather template選択中はプロンプト生成・取込がbuildScenarioへ到達せず拒否される', () => {
    const app = createApp({ scheduler: new FakeScheduler() })
    for (const template of P7_TEMPLATES) {
      // 既存のimportability機構（ImportPanelのdisabled・generatePromptのガード・
      // CandidateImportService.importの先頭ガード）がそのまま働く
      const importability = app.importabilityOf(template.templateId)
      expect(importability.importable, template.templateId).toBe(false)
      expect(importability.reason, template.templateId).toBe(GATHER_NOT_IMPORTABLE_REASON)
      for (const mode of template.supportedModes) {
        const prompt = app.generatePrompt(template.templateId, mode)
        expect(prompt.ok, `${template.templateId}:${mode}`).toBe(false)
        if (!prompt.ok) {
          expect(prompt.issues[0]?.code).toBe('IMPORT_SCHEMA')
          expect(prompt.issues[0]?.message).toBe(GATHER_NOT_IMPORTABLE_REASON)
        }
        // 正規のGatherer DSLを含む候補も先頭ガードで拒否される（取込開放になっていない）
        const candidate = JSON.stringify({
          dslVersion: DSL_VERSION,
          templateId: template.templateId,
          templateVersion: template.version,
          mode,
          title: 'x',
          description: 'y',
          dslParameters: { 'slot-gatherer': { kind: 'windowFixed', size: 3 } },
        })
        const imported = app.importCandidate(template.templateId, mode, candidate)
        expect(imported.ok, `${template.templateId}:${mode}`).toBe(false)
        if (!imported.ok) expect(imported.issues[0]?.code).toBe('IMPORT_SCHEMA')
      }
    }
  })

  it('P7-D21: 非gather templateのimportability・プロンプト文面が不変である', () => {
    const app = createApp({ scheduler: new FakeScheduler() })
    for (const template of IMPORTABLE_TEMPLATES) {
      expect(app.importabilityOf(template.templateId).importable, template.templateId).toBe(true)
    }
    for (const template of IMPORTABLE_TEMPLATES) {
      const mode = template.supportedModes[0]!
      const result = app.generatePrompt(template.templateId, mode)
      expect(result.ok, template.templateId).toBe(true)
      if (result.ok) {
        expect(result.value, template.templateId).not.toContain('gatherer')
        expect(result.value, template.templateId).not.toContain('Gatherers')
      }
    }
  })
})
