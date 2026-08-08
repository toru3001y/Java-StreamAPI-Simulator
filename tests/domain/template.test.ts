import { describe, expect, it } from 'vitest'
import { TemplateRegistry } from '../../src/domain/template/templateRegistry'
import {
  createDefaultTemplateRegistry,
  FILTER_BASIC_TEMPLATE,
  FILTER_CHAIN_TEMPLATE,
} from '../../src/domain/template/templates'
import { instantiateTemplate } from '../../src/domain/template/instantiate'
import { createDefaultCatalog, OP_FILTER } from '../../src/domain/catalog/operations'
import { STANDARD_EMPLOYEES } from '../../src/domain/fixtures/employees'

const agePredicate = (threshold: number) => ({
  kind: 'fieldCompare',
  field: 'age',
  operator: 'GTE',
  value: { type: 'int', value: threshold },
})

describe('P1-D03 TemplateRegistry', () => {
  it('P1-D03: 同一のtarget operation（filter）へ複数templateを登録・取得できる', () => {
    const registry = createDefaultTemplateRegistry()
    const templates = registry.listByTargetOperation(OP_FILTER)
    expect(templates.map((t) => t.templateId)).toEqual(['tmpl-filter-basic', 'tmpl-filter-chain'])
    expect(registry.get('tmpl-filter-basic', 1)?.title).toBe(FILTER_BASIC_TEMPLATE.title)
    expect(registry.get('tmpl-filter-chain', 1)?.title).toBe(FILTER_CHAIN_TEMPLATE.title)
  })

  it('P1-D03: 追加登録でも取得でき、同一ID+versionの重複登録は拒否する', () => {
    const registry = new TemplateRegistry()
    registry.register(FILTER_BASIC_TEMPLATE)
    registry.register({ ...FILTER_BASIC_TEMPLATE, templateId: 'tmpl-filter-extra' })
    expect(registry.listByTargetOperation(OP_FILTER)).toHaveLength(2)
    expect(() => registry.register(FILTER_BASIC_TEMPLATE)).toThrow()
  })
})

describe('P1-D04 TemplateInstantiation', () => {
  const registry = createDefaultTemplateRegistry()
  const catalog = createDefaultCatalog()

  it('P1-D04: 必須slot欠落を拒否する', () => {
    const result = instantiateTemplate(registry, catalog, {
      templateId: 'tmpl-filter-basic',
      templateVersion: 1,
      dataset: STANDARD_EMPLOYEES,
      dslParameters: {},
      mode: 'standard',
      revision: 'test-rev',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.code).toBe('SLOT_MISSING')
  })

  it('P1-D04: 許可されていないtemplateを拒否する', () => {
    const result = instantiateTemplate(registry, catalog, {
      templateId: 'tmpl-unknown',
      templateVersion: 1,
      dataset: STANDARD_EMPLOYEES,
      dslParameters: { 'slot-predicate-1': agePredicate(30) },
      mode: 'standard',
      revision: 'test-rev',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.code).toBe('TEMPLATE_NOT_FOUND')
  })

  it('P1-D04: version不一致を拒否する', () => {
    const result = instantiateTemplate(registry, catalog, {
      templateId: 'tmpl-filter-basic',
      templateVersion: 2,
      dataset: STANDARD_EMPLOYEES,
      dslParameters: { 'slot-predicate-1': agePredicate(30) },
      mode: 'standard',
      revision: 'test-rev',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.code).toBe('TEMPLATE_VERSION_MISMATCH')
  })

  it('P1-D04: 未定義slotとサポート外モードを拒否する', () => {
    const unknownSlot = instantiateTemplate(registry, catalog, {
      templateId: 'tmpl-filter-basic',
      templateVersion: 1,
      dataset: STANDARD_EMPLOYEES,
      dslParameters: {
        'slot-predicate-1': agePredicate(30),
        'slot-unknown': agePredicate(30),
      },
      mode: 'standard',
      revision: 'test-rev',
    })
    expect(unknownSlot.ok).toBe(false)
    if (!unknownSlot.ok) expect(unknownSlot.issues[0]?.code).toBe('SLOT_UNKNOWN')

    const badMode = instantiateTemplate(registry, catalog, {
      templateId: 'tmpl-filter-chain',
      templateVersion: 1,
      dataset: STANDARD_EMPLOYEES,
      dslParameters: {
        'slot-predicate-1': agePredicate(25),
        'slot-predicate-2': agePredicate(28),
        'slot-predicate-3': agePredicate(30),
        'slot-predicate-4': agePredicate(35),
        'slot-predicate-5': agePredicate(40),
      },
      mode: 'midEmpty',
      revision: 'test-rev',
    })
    expect(badMode.ok).toBe(false)
    if (!badMode.ok) expect(badMode.issues[0]?.code).toBe('TEMPLATE_MODE_UNSUPPORTED')
  })
})
