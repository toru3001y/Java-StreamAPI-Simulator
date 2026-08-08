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
 */
const FIXED_GENERATED_AT = '2026-08-08T00:00:00+09:00'

type FixtureDefinition = Omit<ScenarioCandidate, 'revision'>

const PROVENANCE = {
  providerKind: 'FIXTURE',
  generatedAt: FIXED_GENERATED_AT,
  dslVersion: DSL_VERSION,
} as const

function agePredicate(threshold: number): unknown {
  return {
    kind: 'fieldCompare',
    field: 'age',
    operator: 'GTE',
    value: { type: 'int', value: threshold },
  }
}

const nameMapper = { kind: 'fieldAccess', field: 'name' }
const toUpperMapper = { kind: 'toUpper' }
const listStreamMapper = { kind: 'listStream' }

function fx(
  templateId: string,
  mode: FixtureDefinition['mode'],
  title: string,
  description: string,
  dslParameters: Readonly<Record<string, unknown>>,
  dataset: FixtureDefinition['dataset'] = [],
): FixtureDefinition {
  return {
    providerKind: 'FIXTURE',
    templateId,
    templateVersion: 1,
    mode,
    dataset,
    dslParameters,
    title,
    description,
    provenance: PROVENANCE,
  }
}

const FIXTURES: readonly FixtureDefinition[] = deepFreeze([
  // ---- Phase 1: filter ----
  fx(
    'tmpl-filter-basic',
    'standard',
    'filter標準（age >= 30）',
    '4件のEmployeeからage >= 30の要素だけを通過させます。期待結果は佐藤・高橋です。',
    { 'slot-predicate-1': agePredicate(30) },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-filter-basic',
    'midEmpty',
    'filter途中0件（age >= 100）',
    '全件がfalseとなる条件で、中間操作の後段が0件になるケースです。結果は空Listです。',
    { 'slot-predicate-1': agePredicate(100) },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-filter-basic',
    'emptySource',
    'filter空ソース',
    '入力が最初から0件のケースです。要素処理なしで空Listが確定します。',
    { 'slot-predicate-1': agePredicate(30) },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-filter-chain',
    'standard',
    'filterチェーン（5段・横スクロール検証）',
    '5個のfilterを順に通過します。期待結果はage >= 40を満たす高橋1件です。',
    {
      'slot-predicate-1': agePredicate(25),
      'slot-predicate-2': agePredicate(28),
      'slot-predicate-3': agePredicate(30),
      'slot-predicate-4': agePredicate(35),
      'slot-predicate-5': agePredicate(40),
    },
    STANDARD_EMPLOYEES,
  ),
  // ---- Phase 2: Stream生成 ----
  fx(
    'tmpl-src-collection',
    'standard',
    'Collection.stream()標準',
    'employeesのCollectionからorderedに送出し、map(Employee::name)で名前を取り出します。',
    { 'slot-mapper-1': nameMapper },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-src-collection',
    'emptySource',
    'Collection.stream()空ソース',
    '空のCollectionからは要素が送出されず、空Listが確定します。',
    { 'slot-mapper-1': nameMapper },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-src-arrays-object',
    'standard',
    'Arrays.stream()標準（String配列）',
    'String配列namesをindex順に送出し、大文字へ変換します。',
    {
      'slot-source': { kind: 'arrayObject', arrayId: 'names', elementTypeName: 'String', values: ['java', 'sql', 'web'] },
      'slot-mapper-1': toUpperMapper,
    },
  ),
  fx(
    'tmpl-src-arrays-object',
    'emptySource',
    'Arrays.stream()空ソース（String配列）',
    '長さ0の配列からは要素が送出されません。',
    {
      'slot-source': { kind: 'arrayObject', arrayId: 'names', elementTypeName: 'String', values: [] },
      'slot-mapper-1': toUpperMapper,
    },
  ),
  fx(
    'tmpl-src-arrays-int',
    'standard',
    'Arrays.stream()標準（int配列）',
    'int[]からIntStreamが生成されます。boxed()でIntegerへ変換して結果化します。',
    {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [3, 1, 4] },
    },
  ),
  fx(
    'tmpl-src-arrays-int',
    'emptySource',
    'Arrays.stream()空ソース（int配列）',
    '長さ0のint[]からは要素が送出されません。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [] } },
  ),
  fx(
    'tmpl-src-arrays-long',
    'standard',
    'Arrays.stream()標準（long配列）',
    'long[]からLongStreamが生成されます。boxed()でLongへ変換して結果化します。',
    {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'amounts', primitive: 'long', values: [10, 20, 30] },
    },
  ),
  fx(
    'tmpl-src-arrays-long',
    'emptySource',
    'Arrays.stream()空ソース（long配列）',
    '長さ0のlong[]からは要素が送出されません。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'amounts', primitive: 'long', values: [] } },
  ),
  fx(
    'tmpl-src-arrays-double',
    'standard',
    'Arrays.stream()標準（double配列）',
    'double[]からDoubleStreamが生成されます。boxed()でDoubleへ変換して結果化します。',
    {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'rates', primitive: 'double', values: [1.5, 2.5, 4.0] },
    },
  ),
  fx(
    'tmpl-src-arrays-double',
    'emptySource',
    'Arrays.stream()空ソース（double配列）',
    '長さ0のdouble[]からは要素が送出されません。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'rates', primitive: 'double', values: [] } },
  ),
  fx(
    'tmpl-src-of',
    'standard',
    'Stream.of()標準',
    '引数の値を記述順に要素化し、大文字へ変換します。',
    {
      'slot-source': { kind: 'streamOf', elementTypeName: 'String', values: ['Java', 'SQL'] },
      'slot-mapper-1': toUpperMapper,
    },
  ),
  fx(
    'tmpl-src-of',
    'emptySource',
    'Stream.of()空ソース',
    '引数なしのStream.of()は空Streamです。',
    {
      'slot-source': { kind: 'streamOf', elementTypeName: 'String', values: [] },
      'slot-mapper-1': toUpperMapper,
    },
  ),
  fx(
    'tmpl-src-iterate3',
    'standard',
    'iterate（seed=1, n <= 5, n + 1）',
    'seedから候補を生成し、predicateがfalseになるまで送出します。期待結果は[1, 2, 3, 4, 5]です。',
    {
      'slot-source': {
        kind: 'iterate3',
        seed: 1,
        predicate: { operator: 'LTE', value: 5 },
        operator: { ruleId: 'increment', step: 1 },
      },
    },
  ),
  fx(
    'tmpl-src-iterate3',
    'emptySource',
    'iterate空ソース（seedが即false）',
    'seed 10がpredicate n <= 5を満たさないため、要素は送出されません。',
    {
      'slot-source': {
        kind: 'iterate3',
        seed: 10,
        predicate: { operator: 'LTE', value: 5 },
        operator: { ruleId: 'increment', step: 1 },
      },
    },
  ),
  fx(
    'tmpl-src-range',
    'standard',
    'range(1, 5)標準',
    '1 <= n && n < 5のintを送出します。期待結果は[1, 2, 3, 4]（上端を含まない）です。',
    { 'slot-source': { kind: 'range', from: 1, to: 5 } },
  ),
  fx(
    'tmpl-src-range',
    'emptySource',
    'range(1, 1)空ソース',
    'range(1, 1)は空範囲であり、要素は送出されません。',
    { 'slot-source': { kind: 'range', from: 1, to: 1 } },
  ),
  fx(
    'tmpl-src-range-closed',
    'standard',
    'rangeClosed(1, 5)標準',
    '1 <= n && n <= 5のintを送出します。期待結果は[1, 2, 3, 4, 5]（上端を含む）です。',
    { 'slot-source': { kind: 'rangeClosed', from: 1, to: 5 } },
  ),
  fx(
    'tmpl-src-range-closed',
    'emptySource',
    'rangeClosed(1, 0)空ソース',
    'rangeClosed(1, 0)は空範囲であり、要素は送出されません。',
    { 'slot-source': { kind: 'rangeClosed', from: 1, to: 0 } },
  ),
  fx(
    'tmpl-src-empty-object',
    'emptySource',
    'Stream.empty()',
    'object Streamの空です。結果は空List（[]）で、nullとは異なります。',
    { 'slot-source': { kind: 'empty', streamType: 'object', elementTypeName: 'String' } },
  ),
  fx(
    'tmpl-src-empty-int',
    'emptySource',
    'IntStream.empty()',
    'IntStreamの空です。boxed().toList()の結果は空Listです。',
    { 'slot-source': { kind: 'empty', streamType: 'int', elementTypeName: 'int' } },
  ),
  fx(
    'tmpl-src-empty-long',
    'emptySource',
    'LongStream.empty()',
    'LongStreamの空です。boxed().toList()の結果は空Listです。',
    { 'slot-source': { kind: 'empty', streamType: 'long', elementTypeName: 'long' } },
  ),
  fx(
    'tmpl-src-empty-double',
    'emptySource',
    'DoubleStream.empty()',
    'DoubleStreamの空です。boxed().toList()の結果は空Listです。',
    { 'slot-source': { kind: 'empty', streamType: 'double', elementTypeName: 'double' } },
  ),
  // 非実行（Phase 3のlimit()が必要）
  fx(
    'tmpl-src-generate',
    'standard',
    'Stream.generate()（実行不能）',
    '無限・unordered Streamのため、Phase 3のlimit()実装後に実行可能になります。',
    { 'slot-source': { kind: 'generate', ruleId: 'supplier-counter' } },
  ),
  fx(
    'tmpl-src-iterate2',
    'standard',
    'Stream.iterate(seed, operator)（実行不能）',
    '無限Streamのため、Phase 3のlimit()実装後に実行可能になります。',
    {
      'slot-source': { kind: 'iterate2', seed: 1, operator: { ruleId: 'increment', step: 1 } },
    },
  ),
  // ---- Phase 2: 中間操作 ----
  fx(
    'tmpl-map',
    'standard',
    'map標準（Employee → 名前）',
    'Employee要素をmap(Employee::name)で名前のStringへ1対1変換します。',
    { 'slot-mapper-1': nameMapper },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-map',
    'emptySource',
    'map空ソース',
    '入力0件のため、mapは一度も適用されず空Listが確定します。',
    { 'slot-mapper-1': nameMapper },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-map-midempty',
    'midEmpty',
    'map途中0件（filterで全件除外）',
    '前段のfilter(age >= 100)で全件除外され、mapへ要素が到達しません。',
    { 'slot-predicate-1': agePredicate(100), 'slot-mapper-1': nameMapper },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-maptoint',
    'standard',
    'mapToInt標準（age）',
    'Employee.ageをintへ変換しIntStreamにします。boxed()でIntegerへ戻して結果化します。',
    { 'slot-mapper-1': { kind: 'fieldToPrimitive', field: 'age', primitive: 'int' } },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-maptoint',
    'emptySource',
    'mapToInt空ソース',
    '入力0件のため、IntStreamにも要素が流れません。',
    { 'slot-mapper-1': { kind: 'fieldToPrimitive', field: 'age', primitive: 'int' } },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-maptolong',
    'standard',
    'mapToLong標準（salary）',
    'Employee.salaryをlongへ変換しLongStreamにします。',
    { 'slot-mapper-1': { kind: 'fieldToPrimitive', field: 'salary', primitive: 'long' } },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-maptolong',
    'emptySource',
    'mapToLong空ソース',
    '入力0件のため、LongStreamにも要素が流れません。',
    { 'slot-mapper-1': { kind: 'fieldToPrimitive', field: 'salary', primitive: 'long' } },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-maptodouble',
    'standard',
    'mapToDouble標準（evaluation）',
    'Employee.evaluationをdoubleへ変換しDoubleStreamにします。',
    { 'slot-mapper-1': { kind: 'fieldToPrimitive', field: 'evaluation', primitive: 'double' } },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-maptodouble',
    'emptySource',
    'mapToDouble空ソース',
    '入力0件のため、DoubleStreamにも要素が流れません。',
    { 'slot-mapper-1': { kind: 'fieldToPrimitive', field: 'evaluation', primitive: 'double' } },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-boxed',
    'standard',
    'boxed標準（range(1, 4)）',
    'IntStreamのint値を対応するwrapper（Integer）へboxingします。',
    { 'slot-source': { kind: 'range', from: 1, to: 4 } },
  ),
  fx(
    'tmpl-boxed',
    'emptySource',
    'boxed空ソース',
    '空のIntStreamではboxingは発生しません。',
    { 'slot-source': { kind: 'range', from: 1, to: 1 } },
  ),
  fx(
    'tmpl-maptoobj',
    'standard',
    'mapToObj標準（"No." + n）',
    'int値をmapperで任意のString（"No.1"等）へ変換します。boxedとの違いに注目してください。',
    {
      'slot-source': { kind: 'range', from: 1, to: 4 },
      'slot-mapper-1': { kind: 'prefix', prefix: 'No.' },
    },
  ),
  fx(
    'tmpl-maptoobj',
    'emptySource',
    'mapToObj空ソース',
    '空のIntStreamではmapperは一度も適用されません。',
    {
      'slot-source': { kind: 'range', from: 1, to: 1 },
      'slot-mapper-1': { kind: 'prefix', prefix: 'No.' },
    },
  ),
  fx(
    'tmpl-flatmap',
    'standard',
    'flatMap標準（0/1/複数子）',
    '親要素（List）からmapped Streamを生成し、子要素をencounter orderでflattenします。',
    {
      'slot-source': {
        kind: 'nestedStringList',
        listId: 'nested',
        values: [['Java', 'SQL'], [], ['分析']],
      },
      'slot-mapper-1': listStreamMapper,
    },
  ),
  fx(
    'tmpl-flatmap',
    'midEmpty',
    'flatMap途中0件（全親が空List）',
    'すべての親が0件の子を生成するため、flatten後の要素は0件です。',
    {
      'slot-source': { kind: 'nestedStringList', listId: 'nested', values: [[], []] },
      'slot-mapper-1': listStreamMapper,
    },
  ),
  fx(
    'tmpl-flatmap',
    'emptySource',
    'flatMap空ソース',
    '親要素が0件のため、mapped Streamは一度も生成されません。',
    {
      'slot-source': { kind: 'nestedStringList', listId: 'nested', values: [] },
      'slot-mapper-1': listStreamMapper,
    },
  ),
  fx(
    'tmpl-flatmap-int',
    'standard',
    'flatMapToInt標準（int[]）',
    'int[]の子要素を順にflattenし、IntStreamとして送出します。',
    {
      'slot-source': { kind: 'streamOfPrimitiveArrays', primitive: 'int', arrays: [[1, 2], [3]] },
      'slot-mapper-1': { kind: 'arrayStream', primitive: 'int' },
    },
  ),
  fx(
    'tmpl-flatmap-int',
    'emptySource',
    'flatMapToInt空ソース',
    '親要素が0件のため、flattenは発生しません。',
    {
      'slot-source': { kind: 'streamOfPrimitiveArrays', primitive: 'int', arrays: [] },
      'slot-mapper-1': { kind: 'arrayStream', primitive: 'int' },
    },
  ),
  fx(
    'tmpl-flatmap-long',
    'standard',
    'flatMapToLong標準（long[]）',
    'long[]の子要素を順にflattenし、LongStreamとして送出します。',
    {
      'slot-source': { kind: 'streamOfPrimitiveArrays', primitive: 'long', arrays: [[10, 20], [30]] },
      'slot-mapper-1': { kind: 'arrayStream', primitive: 'long' },
    },
  ),
  fx(
    'tmpl-flatmap-long',
    'emptySource',
    'flatMapToLong空ソース',
    '親要素が0件のため、flattenは発生しません。',
    {
      'slot-source': { kind: 'streamOfPrimitiveArrays', primitive: 'long', arrays: [] },
      'slot-mapper-1': { kind: 'arrayStream', primitive: 'long' },
    },
  ),
  fx(
    'tmpl-flatmap-double',
    'standard',
    'flatMapToDouble標準（double[]）',
    'double[]の子要素を順にflattenし、DoubleStreamとして送出します。',
    {
      'slot-source': {
        kind: 'streamOfPrimitiveArrays',
        primitive: 'double',
        arrays: [[1.5, 2.5], [3.5]],
      },
      'slot-mapper-1': { kind: 'arrayStream', primitive: 'double' },
    },
  ),
  fx(
    'tmpl-flatmap-double',
    'emptySource',
    'flatMapToDouble空ソース',
    '親要素が0件のため、flattenは発生しません。',
    {
      'slot-source': { kind: 'streamOfPrimitiveArrays', primitive: 'double', arrays: [] },
      'slot-mapper-1': { kind: 'arrayStream', primitive: 'double' },
    },
  ),
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
