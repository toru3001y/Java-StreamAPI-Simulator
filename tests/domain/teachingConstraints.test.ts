import { describe, expect, it } from 'vitest'
import { instantiateTemplate } from '../../src/domain/template/instantiate'
import { createDefaultTemplateRegistry } from '../../src/domain/template/templates'
import { createDefaultCatalog } from '../../src/domain/catalog/operations'
import { STANDARD_EMPLOYEES, EMPTY_EMPLOYEES } from '../../src/domain/fixtures/employees'
import type { ScenarioMode } from '../../src/domain/scenario/scenario'

const registry = createDefaultTemplateRegistry()
const catalog = createDefaultCatalog()

const run = (threshold: number, mode: ScenarioMode, dataset = STANDARD_EMPLOYEES) =>
  instantiateTemplate(registry, catalog, {
    templateId: 'tmpl-filter-basic',
    templateVersion: 1,
    dataset,
    dslParameters: {
      'slot-predicate-1': {
        kind: 'fieldCompare',
        field: 'age',
        operator: 'GTE',
        value: { type: 'int', value: threshold },
      },
    },
    mode,
    revision: 'test-rev',
  })

describe('P1-D10 教材制約', () => {
  it('P1-D10: 標準はtrue / false双方を含む（age >= 30は受理）', () => {
    expect(run(30, 'standard').ok).toBe(true)
  })

  it('P1-D10: 標準で全件trueとなる条件を拒否する', () => {
    const result = run(20, 'standard')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.code).toBe('TEACHING_CONSTRAINT')
  })

  it('P1-D10: 標準で全件falseとなる条件を拒否する', () => {
    const result = run(100, 'standard')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.code).toBe('TEACHING_CONSTRAINT')
  })

  it('P1-D10: 途中0件は全件false（age >= 100は受理、age >= 30は拒否）', () => {
    expect(run(100, 'midEmpty').ok).toBe(true)
    const bad = run(30, 'midEmpty')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.issues[0]?.code).toBe('TEACHING_CONSTRAINT')
  })

  it('P1-D10: 空ソースは入力0件のみ受理する', () => {
    expect(run(30, 'emptySource', EMPTY_EMPLOYEES).ok).toBe(true)
    const bad = run(30, 'emptySource', STANDARD_EMPLOYEES)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.issues[0]?.code).toBe('TEACHING_CONSTRAINT')
  })
})
