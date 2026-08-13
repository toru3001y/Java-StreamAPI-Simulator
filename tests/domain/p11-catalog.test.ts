import { describe, expect, it } from 'vitest'
import { ALL_TEMPLATES } from '../../src/domain/template/templates'
import {
  P11_TEMPLATE_IDS,
  TO_MAP_OUT_OF_SCOPE_NOTES,
} from '../../src/domain/template/templatesP8'
import { createDefaultCatalog } from '../../src/domain/catalog/operations'
import { DSL_VERSION } from '../../src/domain/dsl/ast'
import { UNMODIFIABLE_COLLECTOR_KINDS } from '../../src/domain/dsl/collectorAst'
import {
  UNMODIFIABLE_NOT_IMPORTABLE_REASON,
  buildTemplateContract,
  hasUnmodifiableCollectorSlot,
  validateBySpec,
} from '../../src/application/importContract'
import { buildImportPrompt } from '../../src/application/promptGenerator'
import { formatTypeRef } from '../../src/domain/types/typeRef'
import { createApp } from '../../src/ui/appInstance'
import { FakeScheduler, makeDefinition } from '../helpers'
import { IMPORTABLE_TEMPLATES, UNMODIFIABLE_TEMPLATES, templateById } from '../p6-helpers'
import { toUnmodList, toUnmodMap2, toUnmodMap3, toUnmodSet } from '../p11-helpers'

/**
 * P11-D13〜P11-D15: 教材template・LLM取込対象外・操作総数不変（v0.14 §5.1・§5.2・§2.1）。
 */

describe('P11-D13 教材template（v0.14 §5.1）', () => {
  it('P11-D13: 3 templateが登録され、modeと結果型が仕様どおりである', () => {
    expect([...P11_TEMPLATE_IDS]).toEqual([
      'tmpl-collect-tounmod-list',
      'tmpl-collect-tounmod-set',
      'tmpl-collect-tounmod-map',
    ])
    const expectedModes: Readonly<Record<string, readonly string[]>> = {
      'tmpl-collect-tounmod-list': ['standard', 'emptySource'],
      'tmpl-collect-tounmod-set': ['standard', 'emptySource'],
      'tmpl-collect-tounmod-map': ['standard'],
    }
    const expectedResultTypes: Readonly<Record<string, string>> = {
      'tmpl-collect-tounmod-list': 'List<Employee>',
      'tmpl-collect-tounmod-set': 'Set<String>',
      'tmpl-collect-tounmod-map': 'Map<String, String>',
    }
    for (const templateId of P11_TEMPLATE_IDS) {
      const template = templateById(templateId)
      expect([...template.supportedModes], templateId).toEqual(expectedModes[templateId])
      // midEmptyは非対応（既存Collector教材と同じ）
      expect(template.supportedModes, templateId).not.toContain('midEmpty')
      expect(template.targetOperationId, templateId).toBe('collect')
      const def = makeDefinition(templateId, 'standard')
      expect(formatTypeRef(def.resultType), templateId).toBe(expectedResultTypes[templateId])
    }
  })

  it('P11-D13: 新templateのtitleは既存最長title以下である（select内在幅を広げない）', () => {
    // v0.14 §1.2: 長いoptionは教材Pipeline selectの内在幅を広げ、
    // 全collectorページの視覚回帰基準画像へ波及する
    const existingMax = Math.max(
      ...ALL_TEMPLATES.filter((t) => !P11_TEMPLATE_IDS.includes(t.templateId)).map(
        (t) => t.title.length,
      ),
    )
    for (const templateId of P11_TEMPLATE_IDS) {
      const title = templateById(templateId).title
      expect(title.length, `${templateId}（${title}）`).toBeLessThanOrEqual(existingMax)
    }
  })

  it('P11-D13: jdkNotesに§3.1の一次情報・不変性注記・対比導線が含まれる', () => {
    const notesOf = (templateId: string): string => templateById(templateId).jdkNotes.join('\n')

    const list = notesOf('tmpl-collect-tounmod-list')
    // 一次情報（null禁止・Since 10・encounter order）
    expect(list).toContain('Since 10')
    expect(list).toContain('NullPointerException')
    expect(list).toContain('encounter order')
    // 不変性注記とUOE
    expect(list).toContain('UnsupportedOperationException')
    // 既存toList教材との対比、Stream.toList()との範囲限定対比
    expect(list).toContain('Collectors.toList()')
    expect(list).toContain('Stream.toList()')
    expect(list).toContain('null禁止はCollectors.toUnmodifiableList()に明示された別の契約')
    expect(list).toContain('Stream.toList()の仕様にnull禁止の規定はない')

    const set = notesOf('tmpl-collect-tounmod-set')
    expect(set).toContain('Since 10')
    expect(set).toContain('unordered Collector')
    expect(set).toContain('Collectors.toSet()との違いは不変性だけ')

    const map = notesOf('tmpl-collect-tounmod-map')
    expect(map).toContain('Since 10')
    expect(map).toContain('nullキー・null値を許さず')
    // mapFactory版overloadの不存在
    expect(map).toContain('mapFactoryを指定する形は存在しない')
    // 2引数版の重複キーは既存tmpl-collect-tomap-duplicateへの参照注記で扱う（専用template非設置）
    expect(map).toContain('IllegalStateException')
    expect(map).toContain('collect（toMap・重複キーで実行失敗）')
    expect(ALL_TEMPLATES.map((t) => t.templateId)).toContain('tmpl-collect-tomap-duplicate')
    // 既存toMap merge教材との対比
    expect(map).toContain('collect（toMap + mergeFunction: first — 既存値を保持）')

    // 「蓄積中」ラベルの位置づけを全templateで注記する
    for (const templateId of P11_TEMPLATE_IDS) {
      expect(notesOf(templateId), templateId).toContain('教材モデル上の状態表示')
    }
  })

  it('P11-D13: toUnmodifiableMap系の対象外注記が削除された（実行できる教材になった）', () => {
    // v0.11 §2.2で「将来のunmodifiable系一括Phaseへ持越す」とされた注記の解消
    expect(TO_MAP_OUT_OF_SCOPE_NOTES).toHaveLength(2)
    const joined = TO_MAP_OUT_OF_SCOPE_NOTES.join('\n')
    expect(joined).not.toContain('toUnmodifiable')
    // 他2件（toConcurrentMap / key側identity）は不変
    expect(joined).toContain('Collectors.toConcurrentMap系')
    expect(joined).toContain('key側のFunction.identity()')
  })
})

describe('P11-D14 LLM取込対象外（v0.14 §5.2）', () => {
  it('P11-D14: unmodifiable系3 templateがimportable: falseで理由文言を持つ', () => {
    expect(UNMODIFIABLE_TEMPLATES.map((t) => t.templateId).sort()).toEqual(
      [...P11_TEMPLATE_IDS].sort(),
    )
    for (const template of UNMODIFIABLE_TEMPLATES) {
      const contract = buildTemplateContract(template)
      expect(contract.importable, template.templateId).toBe(false)
      expect(contract.disabledReason, template.templateId).toBe(UNMODIFIABLE_NOT_IMPORTABLE_REASON)
      expect(contract.disabledReason).toContain('取込対象外')
    }
  })

  it('P11-D14: 防御1 — 正規のunmodifiable DSL値はContract検証で受理されない', () => {
    // collectorVariantsへunmodifiable系variantを追加していないため、
    // 仮に取込へ到達しても前段のContract検証が「未定義kind」として拒否する
    for (const template of UNMODIFIABLE_TEMPLATES) {
      const contract = buildTemplateContract(template)
      const slot = contract.slots.find((s) => s.role === 'collector')
      expect(slot, template.templateId).toBeDefined()
      if (!slot) continue
      for (const dsl of [toUnmodList(), toUnmodSet(), toUnmodMap2(), toUnmodMap3('first')]) {
        const issues = validateBySpec(slot.spec, dsl, 'collector')
        expect(issues.length, `${template.templateId}: ${JSON.stringify(dsl)}`).toBeGreaterThan(0)
        expect(issues[0]?.code).toBe('IMPORT_SCHEMA')
      }
    }
  })

  it('P11-D14: 防御2 — template選択中の取込系操作はthrowせず理由を返す', () => {
    const app = createApp({ scheduler: new FakeScheduler() })
    for (const template of UNMODIFIABLE_TEMPLATES) {
      const importability = app.importabilityOf(template.templateId)
      expect(importability.importable, template.templateId).toBe(false)
      expect(importability.reason, template.templateId).toBe(UNMODIFIABLE_NOT_IMPORTABLE_REASON)
      for (const mode of template.supportedModes) {
        const prompt = app.generatePrompt(template.templateId, mode)
        expect(prompt.ok, `${template.templateId}:${mode}`).toBe(false)
        const imported = app.importCandidate(template.templateId, mode, '{}')
        expect(imported.ok, `${template.templateId}:${mode}`).toBe(false)
      }
    }
  })

  it('P11-D14: プロンプト生成の許可範囲言語化にunmodifiable系が現れない', () => {
    for (const template of IMPORTABLE_TEMPLATES) {
      const contract = buildTemplateContract(template)
      // Contractのslot specにunmodifiable variantが混入していない
      expect(JSON.stringify(contract.slots), template.templateId).not.toContain('toUnmodifiable')
      const mode = template.supportedModes[0]!
      const prompt = buildImportPrompt({
        template,
        mode,
        dslVersion: DSL_VERSION,
        example: { dataset: [], dslParameters: {}, title: 't', description: 'd' },
      })
      for (const kind of UNMODIFIABLE_COLLECTOR_KINDS) {
        expect(prompt, `${template.templateId}:${kind}`).not.toContain(kind)
      }
    }
  })
})

describe('P11-D15 既存カタログ・取込機構の不変性', () => {
  it('P11-D15: 操作総数46は不変である（新しいoperationを登録しない）', () => {
    // Collectors各種はcollect操作のCollector AST kindとして扱う（v0.14 §2.1）
    expect(createDefaultCatalog().list()).toHaveLength(46)
  })

  it('P11-D15: 非unmodifiable templateのimportabilityが不変である', () => {
    const app = createApp({ scheduler: new FakeScheduler() })
    for (const template of IMPORTABLE_TEMPLATES) {
      expect(hasUnmodifiableCollectorSlot(template), template.templateId).toBe(false)
      const contract = buildTemplateContract(template)
      expect(contract.importable, template.templateId).toBe(true)
      expect(contract.disabledReason, template.templateId).toBeNull()
      expect(app.importabilityOf(template.templateId).importable, template.templateId).toBe(true)
    }
  })
})
