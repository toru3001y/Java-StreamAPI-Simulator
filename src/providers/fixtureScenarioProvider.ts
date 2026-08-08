import type {
  GenerateRequest,
  ProviderCapability,
  ScenarioCandidate,
  ScenarioProvider,
} from './scenarioProvider'
import { EMPTY_EMPLOYEES, STANDARD_EMPLOYEES } from '../domain/fixtures/employees'
import { DSL_VERSION } from '../domain/dsl/ast'
import { deepFreeze } from '../domain/util/deepFreeze'
import type { ScenarioRevision } from '../domain/types/ids'

/**
 * FixtureScenarioProvider（§10.4）。
 * 決定的なfixture候補を返す。「固定サンプル」であり、AI生成とは表示しない。
 * provenance.generatedAtは決定性維持のため固定値。
 *
 * scenario revisionはgenerate呼び出しごとに新しい値を発行し、
 * request.currentScenarioRevision（§10.2）と同じ値は再利用しない。
 * 同一revision内のsnapshot列は決定的であり（§19）、revisionは切替の識別子として単調に進む。
 */
const FIXED_GENERATED_AT = '2026-08-08T00:00:00+09:00'

/** 候補定義（revisionはgenerate時に発行するため持たない） */
type FixtureDefinition = Omit<ScenarioCandidate, 'revision'>

function agePredicate(threshold: number): unknown {
  return {
    kind: 'fieldCompare',
    field: 'age',
    operator: 'GTE',
    value: { type: 'int', value: threshold },
  }
}

const FIXTURES: readonly FixtureDefinition[] = deepFreeze([
  {
    providerKind: 'FIXTURE',
    templateId: 'tmpl-filter-basic',
    templateVersion: 1,
    mode: 'standard',
    dataset: STANDARD_EMPLOYEES,
    dslParameters: { 'slot-predicate-1': agePredicate(30) },
    title: 'filter標準（age >= 30）',
    description: '4件のEmployeeからage >= 30の要素だけを通過させます。期待結果は佐藤・高橋です。',
    provenance: { providerKind: 'FIXTURE', generatedAt: FIXED_GENERATED_AT, dslVersion: DSL_VERSION },
  },
  {
    providerKind: 'FIXTURE',
    templateId: 'tmpl-filter-basic',
    templateVersion: 1,
    mode: 'midEmpty',
    dataset: STANDARD_EMPLOYEES,
    dslParameters: { 'slot-predicate-1': agePredicate(100) },
    title: 'filter途中0件（age >= 100）',
    description: '全件がfalseとなる条件で、中間操作の後段が0件になるケースです。結果は空Listです。',
    provenance: { providerKind: 'FIXTURE', generatedAt: FIXED_GENERATED_AT, dslVersion: DSL_VERSION },
  },
  {
    providerKind: 'FIXTURE',
    templateId: 'tmpl-filter-basic',
    templateVersion: 1,
    mode: 'emptySource',
    dataset: EMPTY_EMPLOYEES,
    dslParameters: { 'slot-predicate-1': agePredicate(30) },
    title: 'filter空ソース',
    description: '入力が最初から0件のケースです。要素処理なしで空Listが確定します。',
    provenance: { providerKind: 'FIXTURE', generatedAt: FIXED_GENERATED_AT, dslVersion: DSL_VERSION },
  },
  {
    providerKind: 'FIXTURE',
    templateId: 'tmpl-filter-chain',
    templateVersion: 1,
    mode: 'standard',
    dataset: STANDARD_EMPLOYEES,
    dslParameters: {
      'slot-predicate-1': agePredicate(25),
      'slot-predicate-2': agePredicate(28),
      'slot-predicate-3': agePredicate(30),
      'slot-predicate-4': agePredicate(35),
      'slot-predicate-5': agePredicate(40),
    },
    title: 'filterチェーン（5段・横スクロール検証）',
    description: '5個のfilterを順に通過します。期待結果はage >= 40を満たす高橋1件です。',
    provenance: { providerKind: 'FIXTURE', generatedAt: FIXED_GENERATED_AT, dslVersion: DSL_VERSION },
  },
])

export class FixtureScenarioProvider implements ScenarioProvider {
  private revisionCounter = 0

  capability(): ProviderCapability {
    return { available: true, reason: null }
  }

  /** currentScenarioRevisionと異なる新しいrevisionを必ず発行する */
  private nextRevision(
    fixture: FixtureDefinition,
    currentScenarioRevision: ScenarioRevision | null,
  ): ScenarioRevision {
    let revision: ScenarioRevision
    do {
      this.revisionCounter += 1
      revision = `${fixture.templateId}:${fixture.mode}:r${this.revisionCounter}`
    } while (revision === currentScenarioRevision)
    return revision
  }

  generate(request: GenerateRequest): ScenarioCandidate {
    if (!request.allowedTemplateIds.includes(request.templateId)) {
      throw new Error(`許可されていないtemplateです: ${request.templateId}`)
    }
    const fixture = FIXTURES.find(
      (c) => c.templateId === request.templateId && c.mode === request.mode,
    )
    if (!fixture) {
      throw new Error(
        `fixture候補がありません: template=${request.templateId}, mode=${request.mode}`,
      )
    }
    return {
      ...fixture,
      revision: this.nextRevision(fixture, request.currentScenarioRevision),
    }
  }
}
