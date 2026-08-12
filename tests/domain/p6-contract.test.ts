import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DATASET_SPEC,
  IMPORT_TEXT_MAX_LENGTH,
  RESERVED_DATASET_KEYS,
  RESERVED_TOP_LEVEL_KEYS,
  TOP_LEVEL_KEYS,
  buildTemplateContract,
  usesEmployeeDataset,
  validateBySpec,
  type SpecNode,
  type TemplateContract,
} from '../../src/application/importContract'
import { ALL_TEMPLATES } from '../../src/domain/template/templates'
import type { PipelineTemplate } from '../../src/domain/template/pipelineTemplate'
import { FixtureScenarioProvider } from '../../src/providers/fixtureScenarioProvider'
import { DSL_VERSION } from '../../src/domain/dsl/ast'
import { validateStructure } from '../../src/domain/dsl/validate'
import { validateMapperStructure } from '../../src/domain/dsl/validateMapper'
import { validateSourceStructure } from '../../src/domain/dsl/validateSource'
import { validateComparatorStructure } from '../../src/domain/dsl/validateComparator'
import { validateConsumerStructure, validateCount } from '../../src/domain/dsl/validateConsumer'
import {
  validateArrayGenerator,
  validateReductionIdentity,
  validateReductionStructure,
} from '../../src/domain/dsl/validateTerminal'
import {
  validateCollectTriple,
  validateCollectorStructure,
} from '../../src/domain/dsl/validateCollector'
import type { Result } from '../../src/domain/types/result'

/**
 * P6-D01〜P6-D03: Import Contractの定義・互換性・整合（Phase 6指示 §12.1、v0.10 §5.2）。
 */

const EXECUTABLE_TEMPLATES = ALL_TEMPLATES.filter((t) => t.executable !== false)

function contractOf(template: PipelineTemplate): TemplateContract {
  return buildTemplateContract(template)
}

/** slot roleごとの既存構造検証（手順1）への割付 */
function structureValidatorFor(role: string): ((value: unknown) => Result<unknown>) | null {
  switch (role) {
    case 'predicate':
      return (v) => validateStructure(v)
    case 'mapper':
      return (v) => validateMapperStructure(v)
    case 'source':
      return (v) => validateSourceStructure(v)
    case 'comparator':
      return (v) => validateComparatorStructure(v)
    case 'consumer':
      return (v) => validateConsumerStructure(v)
    case 'count':
      return (v) => validateCount(v)
    case 'reduction':
      return (v) => validateReductionStructure(v)
    case 'identity':
      return (v) => validateReductionIdentity(v)
    case 'arrayGenerator':
      return (v) => validateArrayGenerator(v)
    case 'collector':
      return (v) => validateCollectorStructure(v)
    case 'collectTriple':
      return (v) => validateCollectTriple(v)
    default:
      return null
  }
}

/** 合成Collector（downstream / left / rightを持つ）のkind */
const COMPOSITE_KINDS = [
  'mapping',
  'filtering',
  'flatMapping',
  'collectingAndThen',
  'groupingBy',
  'partitioningBy',
  'teeing',
]

/**
 * spec木から「Contractが受理する代表値」を機械生成する。
 * Contractの各variantを1件ずつ通し、既存構造検証も受理することを確認するために使う。
 */
function sampleFor(spec: SpecNode, variantKey?: string): unknown {
  switch (spec.node) {
    case 'const':
      return spec.value
    case 'enum':
      return spec.values[0]
    case 'string':
      return 'a'.repeat(Math.max(spec.min, 1))
    case 'identifier':
      return 'sampleId'
    case 'int':
    case 'long':
    case 'numberByPrimitive':
      return 1
    case 'double':
      return 1
    case 'count':
      return 1
    case 'boundedInt':
      return spec.min
    case 'boundedDouble':
      return spec.min
    case 'isoDate':
      return '2020-02-29'
    case 'array': {
      const size = Math.max(spec.min, 1)
      return Array.from({ length: size }, (_, i) => {
        const item = sampleFor(spec.item)
        // 重複禁止の配列は要素をずらす
        if (spec.unique === 'value' && typeof item === 'string') return `${item}${i}`
        return item
      })
    }
    case 'object':
      return Object.fromEntries(
        Object.entries(spec.fields).map(([key, field]) => [key, sampleFor(field)]),
      )
    case 'unionByKind': {
      const kind = variantKey ?? (Object.keys(spec.variants)[0] as string)
      const variant = spec.variants[kind]
      if (!variant) throw new Error(`未知のvariantです: ${kind}`)
      return {
        kind,
        ...Object.fromEntries(
          Object.entries(variant.fields).map(([key, field]) => [key, sampleFor(field)]),
        ),
      }
    }
    case 'unionByType': {
      const type = variantKey ?? (Object.keys(spec.variants)[0] as string)
      const variant = spec.variants[type]
      if (!variant) throw new Error(`未知のvariantです: ${type}`)
      return {
        type,
        ...Object.fromEntries(
          Object.entries(variant.fields).map(([key, field]) => [key, sampleFor(field)]),
        ),
      }
    }
    case 'nullable':
      return null
    case 'collector':
      return collectorSample(spec.allowedKinds, variantKey)
  }
}

/** Collector ASTの代表値（子は非合成kindを優先して深さ爆発を避ける） */
function collectorSample(allowedKinds: readonly string[], kindOverride?: string): unknown {
  const kind = kindOverride ?? (allowedKinds[0] as string)
  const leafKinds = allowedKinds.filter((k) => !COMPOSITE_KINDS.includes(k))
  const childKind = leafKinds[0]
  const child = () =>
    childKind === undefined ? { kind: 'toList' } : collectorSample(allowedKinds, childKind)
  switch (kind) {
    case 'toList':
    case 'toSet':
    case 'counting':
      return { kind }
    case 'toCollection':
      return { kind, supplierId: 'ArrayList::new' }
    case 'joining':
      return { kind, delimiter: null, prefix: null, suffix: null }
    case 'minBy':
    case 'maxBy':
      return {
        kind,
        comparator: { kind: 'employeeKeys', keys: [{ field: 'age', direction: 'ASC' }] },
      }
    case 'reducing':
      return { kind, reduction: { kind: 'stringConcat' } }
    case 'mapping':
    case 'flatMapping':
      return { kind, mapper: { kind: 'fieldAccess', field: 'name' }, downstream: child() }
    case 'filtering':
      return {
        kind,
        predicate: { kind: 'fieldCompare', field: 'age', operator: 'GTE', value: { type: 'int', value: 1 } },
        downstream: child(),
      }
    case 'collectingAndThen':
      return { kind, downstream: child(), finisherId: 'List::copyOf' }
    case 'groupingBy':
      return {
        kind,
        classifier: { kind: 'employeeField', field: 'region' },
        mapFactoryId: null,
        downstream: null,
      }
    case 'partitioningBy':
      return {
        kind,
        predicate: { kind: 'fieldCompare', field: 'age', operator: 'GTE', value: { type: 'int', value: 1 } },
        downstream: null,
      }
    case 'teeing':
      return { kind, left: child(), right: child(), mergerId: 'SalarySummary::new' }
    default:
      // 数値集計（summingInt等）
      return {
        kind,
        field: kind.endsWith('Int') ? 'age' : kind.endsWith('Long') ? 'salary' : 'evaluation',
      }
  }
}

/** spec直下のvariantキー一覧（union以外は単一） */
function variantKeysOf(spec: SpecNode): readonly (string | undefined)[] {
  if (spec.node === 'unionByKind' || spec.node === 'unionByType') return Object.keys(spec.variants)
  if (spec.node === 'collector') return spec.allowedKinds
  return [undefined]
}

describe('P6-D01 Import Contract定義', () => {
  it('P6-D01: 全実行可能templateにContractが存在し、slot定義（allowed*）と整合する', () => {
    expect(EXECUTABLE_TEMPLATES.length).toBeGreaterThan(0)
    for (const template of EXECUTABLE_TEMPLATES) {
      const contract = contractOf(template)
      expect(contract.templateId, template.templateId).toBe(template.templateId)
      expect(contract.templateVersion, template.templateId).toBe(template.version)
      expect(contract.importable, template.templateId).toBe(true)
      expect(contract.supportedModes, template.templateId).toEqual(template.supportedModes)
      // slot集合はtemplate定義から導出される（source slotを含む）
      const expectedSlotIds = [
        ...(template.sourceDefinition.slotId ? [template.sourceDefinition.slotId] : []),
        ...template.parameterSlots.map((s) => s.slotId),
      ]
      expect(contract.slots.map((s) => s.slotId), template.templateId).toEqual(expectedSlotIds)
      // 許可kindはtemplateのallowed*と一致する
      for (const slot of template.parameterSlots) {
        const slotContract = contract.slots.find((s) => s.slotId === slot.slotId)
        expect(slotContract, `${template.templateId}.${slot.slotId}`).toBeDefined()
        expect(slotContract?.role).toBe(slot.kind)
        expect(slotContract?.required).toBe(slot.required)
        const spec = slotContract?.spec as SpecNode
        if (slot.kind === 'mapper') {
          expect(variantKeysOf(spec).sort()).toEqual([...slot.allowedMapperKinds].sort())
        } else if (slot.kind === 'comparator') {
          expect(variantKeysOf(spec).sort()).toEqual([...slot.allowedComparatorKinds].sort())
        } else if (slot.kind === 'consumer') {
          expect(variantKeysOf(spec).sort()).toEqual([...slot.allowedConsumerKinds].sort())
        } else if (slot.kind === 'reduction') {
          expect(variantKeysOf(spec).sort()).toEqual([...slot.allowedReductionKinds].sort())
        } else if (slot.kind === 'collector') {
          expect(variantKeysOf(spec).sort()).toEqual([...slot.allowedCollectorKinds].sort())
        }
      }
      if (template.sourceDefinition.slotId) {
        const sourceContract = contract.slots.find(
          (s) => s.slotId === template.sourceDefinition.slotId,
        )
        expect(variantKeysOf(sourceContract?.spec as SpecNode).sort()).toEqual(
          [...template.sourceDefinition.allowedSourceKinds].sort(),
        )
      }
      // dataset要否はsourceDefinitionから導出する
      const datasetRequired = usesEmployeeDataset(template)
      expect(contract.datasetPolicy, template.templateId).toBe(
        datasetRequired ? 'required' : 'forbidden',
      )
      // トップレベル・dataset・title・descriptionのspecもContractが持つ（単一定義源）
      expect(contract.topLevelKeys.includes('dataset'), template.templateId).toBe(datasetRequired)
      expect(contract.datasetSpec !== null, template.templateId).toBe(datasetRequired)
      expect(contract.topLevelKeys, template.templateId).toEqual(
        TOP_LEVEL_KEYS.filter((key) => key !== 'dataset' || datasetRequired),
      )
      for (const key of contract.topLevelKeys) {
        expect(contract.topLevelTypes[key], `${template.templateId}.${key}`).toBeDefined()
      }
      expect(contract.reservedTopLevelKeys, template.templateId).toEqual(RESERVED_TOP_LEVEL_KEYS)
      expect(contract.reservedDatasetKeys, template.templateId).toEqual(RESERVED_DATASET_KEYS)
      expect(contract.titleSpec.node, template.templateId).toBe('string')
      expect(contract.descriptionSpec.node, template.templateId).toBe('string')
      expect(contract.textMaxLength, template.templateId).toBe(IMPORT_TEXT_MAX_LENGTH)
    }
  })

  it('P6-D01: 機械可読な許可範囲がimportContract.ts以外に重複定義されていない', () => {
    const read = (relative: string) =>
      readFileSync(path.join(__dirname, '../..', relative), 'utf8')
    const promptSource = read('src/application/promptGenerator.ts')
    const importSource = read('src/application/candidateImport.ts')

    // プロンプト生成・取込サービスは許可値の列挙を自前で持たない
    const forbiddenLiterals = [
      "'fieldCompare'",
      "'employeeKeys'",
      "'printField'",
      "'summingLong'",
      "'arrayPrimitive'",
      "'TreeMap::new'",
      "'List::copyOf'",
      "'SalarySummary::new'",
      "'ArrayList::new'",
    ]
    for (const literal of forbiddenLiterals) {
      expect(promptSource.includes(literal), `promptGenerator: ${literal}`).toBe(false)
      expect(importSource.includes(literal), `candidateImport: ${literal}`).toBe(false)
    }
    // dataset fieldの構造・値域もプロンプト側で再記述しない
    for (const literal of ['hireDate', 'evaluation', 'department', 'skills']) {
      expect(promptSource.includes(literal), `promptGenerator: ${literal}`).toBe(false)
    }
    // 許可範囲はContractから受け取ったspecノードだけを走査する
    expect(promptSource).toContain('describeSpec(contract.datasetSpec')
    expect(promptSource).toContain('contract.topLevelKeys')
    expect(promptSource).toContain('contract.titleSpec')
    expect(promptSource).toContain('contract.descriptionSpec')
    expect(importSource).toContain('validateCandidateShape')
  })

  it('P6-D01: 実行不能templateは取込対象外として理由を持つ', () => {
    const disabled = ALL_TEMPLATES.filter((t) => t.executable === false)
    expect(disabled.map((t) => t.templateId)).toEqual(['tmpl-src-generate', 'tmpl-src-iterate2'])
    for (const template of disabled) {
      const contract = contractOf(template)
      expect(contract.importable, template.templateId).toBe(false)
      expect(contract.disabledReason, template.templateId).toBeTruthy()
    }
  })
})

describe('P6-D02 Contract互換性（既存fixtureがすべて受理される）', () => {
  it('P6-D02: 全実行可能templateの既存fixtureのdslParametersがContract検証で受理される', () => {
    const provider = new FixtureScenarioProvider()
    const allowedTemplateIds = ALL_TEMPLATES.map((t) => t.templateId)
    let checked = 0
    for (const template of EXECUTABLE_TEMPLATES) {
      const contract = contractOf(template)
      for (const mode of template.supportedModes) {
        const candidate = provider.generate({
          targetOperationId: template.targetOperationId,
          mode,
          allowedTemplateIds,
          templateId: template.templateId,
          dslVersion: DSL_VERSION,
          currentScenarioRevision: null,
        })
        for (const slot of contract.slots) {
          const value = candidate.dslParameters[slot.slotId]
          if (value === undefined) {
            expect(slot.required, `${template.templateId}:${mode}.${slot.slotId}`).toBe(false)
            continue
          }
          const issues = validateBySpec(slot.spec, value, `dslParameters.${slot.slotId}`)
          expect(issues, `${template.templateId}:${mode}.${slot.slotId}`).toEqual([])
        }
        // fixtureのdatasetもdataset契約を満たす（elementIdはアプリ側の付与項目のため除く）
        if (contract.datasetPolicy === 'required') {
          const raw = candidate.dataset.map((element) => element.value)
          expect(
            validateBySpec(DATASET_SPEC, raw, 'dataset'),
            `${template.templateId}:${mode}.dataset`,
          ).toEqual([])
        }
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(80)
  })
})

describe('P6-D03 Contract整合（Contract受理後に既存構造検証だけが失敗しない）', () => {
  it('P6-D03: 全実行可能template × 全slot variantの代表形状で、Contract受理 ⇒ 既存構造検証も受理', () => {
    let checked = 0
    for (const template of EXECUTABLE_TEMPLATES) {
      const contract = contractOf(template)
      for (const slot of contract.slots) {
        const validate = structureValidatorFor(slot.role)
        expect(validate, `${template.templateId}.${slot.slotId}`).not.toBeNull()
        for (const variantKey of variantKeysOf(slot.spec)) {
          const sample = sampleFor(slot.spec, variantKey)
          const contractIssues = validateBySpec(slot.spec, sample, `dslParameters.${slot.slotId}`)
          const label = `${template.templateId}.${slot.slotId}[${String(variantKey)}]`
          expect(contractIssues, label).toEqual([])
          const structure = validate?.(sample)
          expect(structure?.ok, `${label}: ${JSON.stringify(sample)}`).toBe(true)
          checked += 1
        }
      }
    }
    expect(checked).toBeGreaterThan(100)
  })
})
