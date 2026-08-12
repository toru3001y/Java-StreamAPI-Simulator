import type {
  GenerateRequest,
  ProviderCapability,
  ScenarioCandidate,
  ScenarioProvider,
} from './scenarioProvider'
import { EMPTY_EMPLOYEES, STANDARD_EMPLOYEES } from '../domain/fixtures/employees'
import { NUMERIC_COLLECTOR_TEMPLATE_IDS } from '../domain/template/templatesP5'
import { DSL_VERSION } from '../domain/dsl/ast'
import { deepFreeze } from '../domain/util/deepFreeze'
import type { ScenarioRevision } from '../domain/types/ids'

/**
 * FixtureScenarioProvider（§10.4）。
 * 決定的なfixture候補を返す。「固定サンプル」であり、取込サンプルとは表示しない（v0.10 §4.1）。
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

/** Phase 5 Collector fixture（指示§8。標準Employee 4件を再利用する） */
const nameMapper5 = { kind: 'fieldAccess', field: 'name' } as const
const skillsMapper5 = { kind: 'fieldAccess', field: 'skills' } as const
/** 途中0件modeのfilter Predicate（全件false: age >= 200） */
const rejectAllPredicate = {
  kind: 'fieldCompare',
  field: 'age',
  operator: 'GTE',
  value: { type: 'int', value: 200 },
} as const
/** salary >= 5_000_000L（§8の基準Pipeline例） */
const salaryGte5m = {
  kind: 'fieldCompare',
  field: 'salary',
  operator: 'GTE',
  value: { type: 'long', value: 5_000_000 },
} as const
/** age >= 30（partitioningByの基準Pipeline例） */
const ageGte30 = {
  kind: 'fieldCompare',
  field: 'age',
  operator: 'GTE',
  value: { type: 'int', value: 30 },
} as const
const deptNameClassifier = { kind: 'departmentField', field: 'name' } as const
const regionClassifier = { kind: 'employeeField', field: 'region' } as const
const departmentClassifier = { kind: 'employeeDepartment' } as const

const P5_FIXTURES: readonly FixtureDefinition[] = [
  fx(
    'tmpl-collect-tolist',
    'standard',
    'collect(toList())標準',
    'Employee 4件をCollectors.toList()でListへ収集します。期待結果はList<Employee> 4件です。',
    { 'slot-collector': { kind: 'toList' } },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-tolist',
    'emptySource',
    'collect(toList())空ソース',
    '入力0件のため空Listが確定します。',
    { 'slot-collector': { kind: 'toList' } },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-tolist-midempty',
    'midEmpty',
    'collect(toList())途中0件',
    'age >= 200で全件除外され、Collectorへは1件も届かず空Listが確定します。',
    { 'slot-predicate-f': rejectAllPredicate, 'slot-collector': { kind: 'toList' } },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-toset',
    'standard',
    'collect(map + toSet())標準（関東の2件目で無変化）',
    'regionへ変換してtoSet()へ収集します。期待結果は{関東, 関西, 中部}の3件で、高橋（関東）の追加ではSetが変化しません。',
    { 'slot-mapper-1': { kind: 'fieldAccess', field: 'region' }, 'slot-collector': { kind: 'toSet' } },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-toset',
    'emptySource',
    'collect(toSet())空ソース',
    '入力0件のため空Setが確定します。',
    { 'slot-mapper-1': { kind: 'fieldAccess', field: 'region' }, 'slot-collector': { kind: 'toSet' } },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-tocollection',
    'standard',
    'collect(toCollection(ArrayList::new))標準',
    'supplierでArrayListを生成し、4件のEmployeeを追加します。期待結果はList<Employee> 4件です。',
    { 'slot-collector': { kind: 'toCollection', supplierId: 'ArrayList::new' } },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-tocollection',
    'emptySource',
    'collect(toCollection(ArrayList::new))空ソース',
    'supplierは適用されますが要素は追加されず、空のArrayListが確定します。',
    { 'slot-collector': { kind: 'toCollection', supplierId: 'ArrayList::new' } },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-joining',
    'standard',
    'collect(map + joining())標準',
    'nameへ変換して区切りなしで連結します。期待結果は"佐藤鈴木高橋田中"です。',
    { 'slot-mapper-1': nameMapper5, 'slot-collector': { kind: 'joining', delimiter: null, prefix: null, suffix: null } },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-joining',
    'emptySource',
    'collect(joining())空ソース',
    '入力0件のため結果は空文字列（""）です。',
    { 'slot-mapper-1': nameMapper5, 'slot-collector': { kind: 'joining', delimiter: null, prefix: null, suffix: null } },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-joining-delimiter',
    'standard',
    'collect(map + joining(", "))標準',
    'nameへ変換して", "で連結します。期待結果は"佐藤, 鈴木, 高橋, 田中"です。',
    {
      'slot-mapper-1': nameMapper5,
      'slot-collector': { kind: 'joining', delimiter: { type: 'string', value: ', ' }, prefix: null, suffix: null },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-joining-delimiter',
    'emptySource',
    'collect(joining(", "))空ソース',
    '入力0件のため結果は空文字列（""）です。',
    {
      'slot-mapper-1': nameMapper5,
      'slot-collector': { kind: 'joining', delimiter: { type: 'string', value: ', ' }, prefix: null, suffix: null },
    },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-joining-full',
    'standard',
    'collect(map + joining(", ", "[", "]"))標準',
    'nameへ変換し、prefix "[" とsuffix "]" を付けて連結します。期待結果は"[佐藤, 鈴木, 高橋, 田中]"です。',
    {
      'slot-mapper-1': nameMapper5,
      'slot-collector': {
        kind: 'joining',
        delimiter: { type: 'string', value: ', ' },
        prefix: { type: 'string', value: '[' },
        suffix: { type: 'string', value: ']' },
      },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-joining-full',
    'emptySource',
    'collect(joining(", ", "[", "]"))空ソース',
    '入力0件でもprefixとsuffixは付与され、結果は"[]"です（JDK 25実測）。',
    {
      'slot-mapper-1': nameMapper5,
      'slot-collector': {
        kind: 'joining',
        delimiter: { type: 'string', value: ', ' },
        prefix: { type: 'string', value: '[' },
        suffix: { type: 'string', value: ']' },
      },
    },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-counting',
    'standard',
    'collect(counting())標準',
    '要素数を数えます。期待結果は4Lです。',
    { 'slot-collector': { kind: 'counting' } },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-counting',
    'emptySource',
    'collect(counting())空ソース',
    '入力0件のため結果は0Lです。',
    { 'slot-collector': { kind: 'counting' } },
    EMPTY_EMPLOYEES,
  ),
  // 数値集計（summing / averaging / summarizing × Int / Long / Double）
  ...NUMERIC_COLLECTOR_TEMPLATE_IDS.flatMap(({ templateId, kind, field }) => [
    fx(
      templateId,
      'standard',
      `collect(${kind}(Employee::${field}))標準`,
      `各Employeeの${field}を${kind}で集計します。`,
      { 'slot-collector': { kind, field } },
      STANDARD_EMPLOYEES,
    ),
    fx(
      templateId,
      'emptySource',
      `collect(${kind}(Employee::${field}))空ソース`,
      '入力0件のときの空結果（型別0 / 0.0 / 統計の正規初期値）を確認します。',
      { 'slot-collector': { kind, field } },
      EMPTY_EMPLOYEES,
    ),
  ]),
  fx(
    'tmpl-collect-minby',
    'standard',
    'collect(minBy(comparingInt(age)))標準',
    'ageが最小のEmployeeを求めます。期待結果はOptional[鈴木]です。',
    {
      'slot-collector': {
        kind: 'minBy',
        comparator: { kind: 'employeeKeys', keys: [{ field: 'age', direction: 'ASC' }] },
      },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-minby',
    'emptySource',
    'collect(minBy)空ソース',
    '入力0件のため結果はOptional.empty()です。',
    {
      'slot-collector': {
        kind: 'minBy',
        comparator: { kind: 'employeeKeys', keys: [{ field: 'age', direction: 'ASC' }] },
      },
    },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-maxby',
    'standard',
    'collect(maxBy(comparingLong(salary)))標準',
    'salaryが最大のEmployeeを求めます。期待結果はOptional[高橋]です。',
    {
      'slot-collector': {
        kind: 'maxBy',
        comparator: { kind: 'employeeKeys', keys: [{ field: 'salary', direction: 'ASC' }] },
      },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-maxby',
    'emptySource',
    'collect(maxBy)空ソース',
    '入力0件のため結果はOptional.empty()です。',
    {
      'slot-collector': {
        kind: 'maxBy',
        comparator: { kind: 'employeeKeys', keys: [{ field: 'salary', direction: 'ASC' }] },
      },
    },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-reducing',
    'standard',
    'collect(map + reducing((a, b) -> a + b))標準',
    'nameへ変換してaccumulatorで連結します。期待結果はOptional[佐藤鈴木高橋田中]です。',
    { 'slot-mapper-1': nameMapper5, 'slot-collector': { kind: 'reducing', reduction: { kind: 'stringConcat' } } },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-reducing',
    'emptySource',
    'collect(reducing)空ソース',
    '入力0件のため結果はOptional.empty()です。',
    { 'slot-mapper-1': nameMapper5, 'slot-collector': { kind: 'reducing', reduction: { kind: 'stringConcat' } } },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-mapping',
    'standard',
    'collect(groupingBy(部署名) + mapping(name, toList()))標準',
    '部署名でグループ化し、各bucketではnameへ変換して収集します。期待結果は{開発部=[佐藤, 高橋], 営業部=[鈴木, 田中]}です。',
    {
      'slot-collector': {
        kind: 'groupingBy',
        classifier: deptNameClassifier,
        mapFactoryId: null,
        downstream: { kind: 'mapping', mapper: nameMapper5, downstream: { kind: 'toList' } },
      },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-mapping',
    'emptySource',
    'collect(groupingBy + mapping)空ソース',
    '入力0件のため結果は空Mapです。',
    {
      'slot-collector': {
        kind: 'groupingBy',
        classifier: deptNameClassifier,
        mapFactoryId: null,
        downstream: { kind: 'mapping', mapper: nameMapper5, downstream: { kind: 'toList' } },
      },
    },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-filtering',
    'standard',
    'collect(groupingBy(部署名) + filtering(salary >= 5_000_000L, toList()))標準',
    'bucket決定後にPredicateを評価します。期待結果は{開発部=[佐藤, 高橋], 営業部=[]}で、営業部が空bucketとして残ることがStream.filterとの差です。',
    {
      'slot-collector': {
        kind: 'groupingBy',
        classifier: deptNameClassifier,
        mapFactoryId: null,
        downstream: { kind: 'filtering', predicate: salaryGte5m, downstream: { kind: 'toList' } },
      },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-filtering',
    'emptySource',
    'collect(groupingBy + filtering)空ソース',
    '入力0件のため結果は空Mapです（bucket自体が生成されません）。',
    {
      'slot-collector': {
        kind: 'groupingBy',
        classifier: deptNameClassifier,
        mapFactoryId: null,
        downstream: { kind: 'filtering', predicate: salaryGte5m, downstream: { kind: 'toList' } },
      },
    },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-flatmapping',
    'standard',
    'collect(groupingBy(部署名) + flatMapping(skills展開, toList()))標準',
    'bucket内でskillsを展開しflattenして収集します。期待結果は{開発部=[Java, SQL, Java, 設計], 営業部=[営業, 英語, SQL, 分析]}です。',
    {
      'slot-collector': {
        kind: 'groupingBy',
        classifier: deptNameClassifier,
        mapFactoryId: null,
        downstream: { kind: 'flatMapping', mapper: skillsMapper5, downstream: { kind: 'toList' } },
      },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-flatmapping',
    'emptySource',
    'collect(groupingBy + flatMapping)空ソース',
    '入力0件のため結果は空Mapです。',
    {
      'slot-collector': {
        kind: 'groupingBy',
        classifier: deptNameClassifier,
        mapFactoryId: null,
        downstream: { kind: 'flatMapping', mapper: skillsMapper5, downstream: { kind: 'toList' } },
      },
    },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-collectingandthen',
    'standard',
    'collect(collectingAndThen(toList(), List::copyOf))標準',
    'downstream完了後にfinisherを独立snapshotで適用します。期待結果はList<Employee> 4件です。',
    {
      'slot-collector': {
        kind: 'collectingAndThen',
        downstream: { kind: 'toList' },
        finisherId: 'List::copyOf',
      },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-collectingandthen',
    'emptySource',
    'collect(collectingAndThen)空ソース',
    '空のdownstream結果へfinisherが適用されます。',
    {
      'slot-collector': {
        kind: 'collectingAndThen',
        downstream: { kind: 'toList' },
        finisherId: 'List::copyOf',
      },
    },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-groupingby',
    'standard',
    'collect(groupingBy(Employee::department))標準',
    'Department recordをキーにグループ化します。期待結果は開発部=[佐藤, 高橋]、営業部=[鈴木, 田中]です。キー等価はrecordの全フィールド比較です。',
    {
      'slot-collector': {
        kind: 'groupingBy',
        classifier: departmentClassifier,
        mapFactoryId: null,
        downstream: null,
      },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-groupingby',
    'emptySource',
    'collect(groupingBy)空ソース',
    '入力0件のため結果は空Mapです。',
    {
      'slot-collector': {
        kind: 'groupingBy',
        classifier: departmentClassifier,
        mapFactoryId: null,
        downstream: null,
      },
    },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-groupingby-midempty',
    'midEmpty',
    'collect(groupingBy)途中0件',
    'age >= 200で全件除外され、bucketが1つも生成されず空Mapが確定します。',
    {
      'slot-predicate-f': rejectAllPredicate,
      'slot-collector': {
        kind: 'groupingBy',
        classifier: regionClassifier,
        mapFactoryId: null,
        downstream: null,
      },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-groupingby-counting',
    'standard',
    'collect(groupingBy(region) + counting())標準',
    'regionでグループ化して件数を数えます。期待結果は{関東=2, 関西=1, 中部=1}です。',
    {
      'slot-collector': {
        kind: 'groupingBy',
        classifier: regionClassifier,
        mapFactoryId: null,
        downstream: { kind: 'counting' },
      },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-groupingby-counting',
    'emptySource',
    'collect(groupingBy + counting)空ソース',
    '入力0件のため結果は空Mapです。',
    {
      'slot-collector': {
        kind: 'groupingBy',
        classifier: regionClassifier,
        mapFactoryId: null,
        downstream: { kind: 'counting' },
      },
    },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-groupingby-averaging',
    'standard',
    'collect(groupingBy(region) + averagingLong(salary))標準',
    'regionごとのsalary平均を求めます。bucketごとにfinisherがbucket生成順で適用されます。',
    {
      'slot-collector': {
        kind: 'groupingBy',
        classifier: regionClassifier,
        mapFactoryId: null,
        downstream: { kind: 'averagingLong', field: 'salary' },
      },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-groupingby-averaging',
    'emptySource',
    'collect(groupingBy + averagingLong)空ソース',
    '入力0件のため結果は空Mapです（bucketがないためfinisherも発行されません）。',
    {
      'slot-collector': {
        kind: 'groupingBy',
        classifier: regionClassifier,
        mapFactoryId: null,
        downstream: { kind: 'averagingLong', field: 'salary' },
      },
    },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-groupingby-treemap',
    'standard',
    'collect(groupingBy(region, TreeMap::new, toList()))標準',
    'classifier / mapFactory / downstreamを分離表示します。TreeMapのキー順（中部 → 関西 → 関東）で確定します。',
    {
      'slot-collector': {
        kind: 'groupingBy',
        classifier: regionClassifier,
        mapFactoryId: 'TreeMap::new',
        downstream: { kind: 'toList' },
      },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-groupingby-treemap',
    'emptySource',
    'collect(groupingBy + TreeMap)空ソース',
    '入力0件のため結果は空TreeMapです。',
    {
      'slot-collector': {
        kind: 'groupingBy',
        classifier: regionClassifier,
        mapFactoryId: 'TreeMap::new',
        downstream: { kind: 'toList' },
      },
    },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-groupingby-nested',
    'standard',
    'collect(nested groupingBy: department → region)標準',
    '外側classifier → 内側groupingBy → 最終コンテナの経路を確認します。期待結果は開発部={関東=[佐藤, 高橋]}、営業部={関西=[鈴木], 中部=[田中]}です。',
    {
      'slot-collector': {
        kind: 'groupingBy',
        classifier: departmentClassifier,
        mapFactoryId: null,
        downstream: {
          kind: 'groupingBy',
          classifier: regionClassifier,
          mapFactoryId: null,
          downstream: null,
        },
      },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-groupingby-nested',
    'emptySource',
    'collect(nested groupingBy)空ソース',
    '入力0件のため結果は空Mapです。',
    {
      'slot-collector': {
        kind: 'groupingBy',
        classifier: departmentClassifier,
        mapFactoryId: null,
        downstream: {
          kind: 'groupingBy',
          classifier: regionClassifier,
          mapFactoryId: null,
          downstream: null,
        },
      },
    },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-partitioningby',
    'standard',
    'collect(partitioningBy(age >= 30))標準',
    'true / falseの2分岐を固定表示します。期待結果は{false=[鈴木, 田中], true=[佐藤, 高橋]}です。',
    {
      'slot-collector': { kind: 'partitioningBy', predicate: ageGte30, downstream: null },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-partitioningby',
    'emptySource',
    'collect(partitioningBy)空ソース（空partition）',
    '入力0件でもtrue / false両キーを保持し、各downstreamは空Listになります。',
    {
      'slot-collector': { kind: 'partitioningBy', predicate: ageGte30, downstream: null },
    },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-partitioningby-counting',
    'standard',
    'collect(partitioningBy(age >= 30) + counting())標準',
    '各partitionでdownstreamを実行します。期待結果は{false=2, true=2}です。',
    {
      'slot-collector': {
        kind: 'partitioningBy',
        predicate: ageGte30,
        downstream: { kind: 'counting' },
      },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-partitioningby-counting',
    'emptySource',
    'collect(partitioningBy + counting)空ソース',
    '入力0件でも両キーを保持し、各downstreamは0Lになります。',
    {
      'slot-collector': {
        kind: 'partitioningBy',
        predicate: ageGte30,
        downstream: { kind: 'counting' },
      },
    },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-teeing',
    'standard',
    'collect(teeing(counting(), averagingLong(salary), SalarySummary::new))標準',
    '同じEmployeeが左右両方のCollectorへ渡ります。期待結果はSalarySummary[employeeCount=4, averageSalary=5425000.0]です。',
    {
      'slot-collector': {
        kind: 'teeing',
        left: { kind: 'counting' },
        right: { kind: 'averagingLong', field: 'salary' },
        mergerId: 'SalarySummary::new',
      },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-teeing',
    'emptySource',
    'collect(teeing)空ソース',
    '蓄積0件でも左右のfinisherとmergerが適用されます。期待結果はSalarySummary[employeeCount=0, averageSalary=0.0]です。',
    {
      'slot-collector': {
        kind: 'teeing',
        left: { kind: 'counting' },
        right: { kind: 'averagingLong', field: 'salary' },
        mergerId: 'SalarySummary::new',
      },
    },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-teeing-midempty',
    'midEmpty',
    'collect(teeing)途中0件',
    'age >= 200で全件除外されても、左右のfinisher×2とmerger 1回は適用されます。',
    {
      'slot-predicate-f': rejectAllPredicate,
      'slot-collector': {
        kind: 'teeing',
        left: { kind: 'counting' },
        right: { kind: 'averagingLong', field: 'salary' },
        mergerId: 'SalarySummary::new',
      },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-triple',
    'standard',
    'collect(ArrayList::new, ArrayList::add, ArrayList::addAll)標準',
    'supplierでArrayListを生成し、accumulatorで4件のEmployeeを直接追加します。combinerはsequential実行のため呼ばれません（定義表示のみ）。',
    {
      'slot-collect-triple': {
        kind: 'collectTriple',
        supplierId: 'ArrayList::new',
        accumulatorId: 'ArrayList::add',
        combinerId: 'ArrayList::addAll',
      },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-collect-triple',
    'emptySource',
    'collect(3引数)空ソース',
    'supplierは適用されますがaccumulatorは呼ばれず、空Listが確定します。',
    {
      'slot-collect-triple': {
        kind: 'collectTriple',
        supplierId: 'ArrayList::new',
        accumulatorId: 'ArrayList::add',
        combinerId: 'ArrayList::addAll',
      },
    },
    EMPTY_EMPLOYEES,
  ),
  // ---- Phase 3からの持越し: takeWhile / dropWhileのEmployee fieldCompare（指示§5.3） ----
  fx(
    'tmpl-takewhile-employee',
    'standard',
    'takeWhile標準（Employee: salary >= 5_000_000L）',
    '佐藤（5_500_000）は通過し、鈴木（4_200_000）で境界到達して短絡します。高橋（7_200_000）はPredicateならtrueですが未評価のままです。期待結果は[佐藤]です。',
    { 'slot-predicate-1': salaryGte5m },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-takewhile-employee',
    'midEmpty',
    'takeWhile途中0件（最初の要素がfalse）',
    '先頭の鈴木（4_200_000）がfalseのため1件も通過せず短絡します。',
    { 'slot-predicate-1': salaryGte5m },
    [
      STANDARD_EMPLOYEES[1],
      STANDARD_EMPLOYEES[2],
      STANDARD_EMPLOYEES[3],
    ].filter((e): e is NonNullable<typeof e> => e !== undefined),
  ),
  fx(
    'tmpl-takewhile-employee',
    'emptySource',
    'takeWhile空ソース',
    '入力0件のためPredicateは一度も評価されず、空Listが確定します。',
    { 'slot-predicate-1': salaryGte5m },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-dropwhile-employee',
    'standard',
    'dropWhile標準（Employee: salary >= 5_000_000L）',
    '佐藤（5_500_000）をdropし、鈴木（4_200_000）で通過モードへ遷移します。以降はPredicateを再評価しません。期待結果は[鈴木, 高橋, 田中]です。',
    { 'slot-predicate-1': salaryGte5m },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-dropwhile-employee',
    'midEmpty',
    'dropWhile途中0件（全要素がtrue）',
    '佐藤・高橋はいずれもtrueのため全件dropされ、結果は空Listです。',
    { 'slot-predicate-1': salaryGte5m },
    [STANDARD_EMPLOYEES[0], STANDARD_EMPLOYEES[2]].filter(
      (e): e is NonNullable<typeof e> => e !== undefined,
    ),
  ),
  fx(
    'tmpl-dropwhile-employee',
    'emptySource',
    'dropWhile空ソース',
    '入力0件のためPredicateは一度も評価されず、空Listが確定します。',
    { 'slot-predicate-1': salaryGte5m },
    EMPTY_EMPLOYEES,
  ),
]

/**
 * Phase 7 Gatherer fixture（指示§7.6の確定値。standard 7 + emptySource 4 = 11件）。
 * emptySourceは既存前例どおり同一source種の空値（collection=EMPTY_EMPLOYEES、
 * streamOf / arrayPrimitiveは values: []）で構成する。
 * midEmptyは全gather templateで非対応（判断は docs/phase-7-decisions.md）。
 */
const P7_FIXTURES: readonly FixtureDefinition[] = [
  // ---- windowFixed（残余あり） ----
  fx(
    'tmpl-gather-window-fixed',
    'standard',
    'gather(windowFixed(3))標準',
    'Employee 4件を3件ずつの窓に束ねます。窓[佐藤, 鈴木, 高橋]が成立して放出され、残った田中は終端のfinisherで不完全な窓として放出されます。期待結果はList<List<Employee>> 2件です。',
    { 'slot-gatherer': { kind: 'windowFixed', size: 3 } },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-gather-window-fixed',
    'emptySource',
    'gather(windowFixed(3))空ソース',
    '入力0件のため窓は1つも生成されず、空Listが確定します。initializerとfinisherの実演だけが残ります。',
    { 'slot-gatherer': { kind: 'windowFixed', size: 3 } },
    EMPTY_EMPLOYEES,
  ),
  // ---- windowFixed（入力件数が窓サイズの正確な倍数） ----
  fx(
    'tmpl-gather-window-fixed-exact',
    'standard',
    'gather(windowFixed(2))倍数ケース',
    'Employee 4件を2件ずつの窓に束ねます。4は2の倍数のため残余はなく、終端のfinisherでは「残余なし・追加放出なし」だけが確定します。期待結果はList<List<Employee>> 2件です。',
    { 'slot-gatherer': { kind: 'windowFixed', size: 2 } },
    STANDARD_EMPLOYEES,
  ),
  // ---- windowSliding（入力件数 >= 窓サイズ） ----
  fx(
    'tmpl-gather-window-sliding',
    'standard',
    'gather(windowSliding(2))標準',
    '["Java", "SQL", "Git", "AWS"]から、最古を除いて次を加えるスライド窓を作ります。窓は[Java, SQL] / [SQL, Git] / [Git, AWS]の3件です。',
    {
      'slot-source': {
        kind: 'streamOf',
        elementTypeName: 'String',
        values: ['Java', 'SQL', 'Git', 'AWS'],
      },
      'slot-gatherer': { kind: 'windowSliding', size: 2 },
    },
  ),
  fx(
    'tmpl-gather-window-sliding',
    'emptySource',
    'gather(windowSliding(2))空ソース',
    '入力0件のため窓は1つも生成されず、空Listが確定します。',
    {
      'slot-source': { kind: 'streamOf', elementTypeName: 'String', values: [] },
      'slot-gatherer': { kind: 'windowSliding', size: 2 },
    },
  ),
  // ---- windowSliding（0 < 入力件数 < 窓サイズ） ----
  fx(
    'tmpl-gather-window-sliding-short',
    'standard',
    'gather(windowSliding(3))入力 < 窓サイズ',
    '入力2件に対して窓サイズ3のため、処理中は窓が1つも成立しません。終端のfinisherで全要素を含む窓[Java, SQL]が1つだけ放出されます。',
    {
      'slot-source': { kind: 'streamOf', elementTypeName: 'String', values: ['Java', 'SQL'] },
      'slot-gatherer': { kind: 'windowSliding', size: 3 },
    },
  ),
  // ---- scan（numericSum） ----
  fx(
    'tmpl-gather-scan',
    'standard',
    'gather(scan)標準（累積和）',
    'int[]{3, 1, 4}をboxed()でStream<Integer>にし、初期値0から累積和をとります。1入力→1出力で[3, 4, 8]が逐次放出されます。',
    {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [3, 1, 4] },
      'slot-gatherer': {
        kind: 'scan',
        initial: { type: 'int', value: 0 },
        accumulation: { kind: 'numericSum' },
      },
    },
  ),
  fx(
    'tmpl-gather-scan',
    'emptySource',
    'gather(scan)空ソース',
    '入力0件のため産出は0件で、空Listが確定します。initializerによる初期値の生成だけが実演されます（scanは終端で追加産出しません）。',
    {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [] },
      'slot-gatherer': {
        kind: 'scan',
        initial: { type: 'int', value: 0 },
        accumulation: { kind: 'numericSum' },
      },
    },
  ),
  // ---- scan（stringConcat） ----
  fx(
    'tmpl-gather-scan-concat',
    'standard',
    'gather(scan)標準（文字列連結）',
    '["Java", "SQL", "Git"]を空文字から連結していきます。期待結果は["Java", "JavaSQL", "JavaSQLGit"]です。',
    {
      'slot-source': {
        kind: 'streamOf',
        elementTypeName: 'String',
        values: ['Java', 'SQL', 'Git'],
      },
      'slot-gatherer': {
        kind: 'scan',
        initial: { type: 'string', value: '' },
        accumulation: { kind: 'stringConcat' },
      },
    },
  ),
  // ---- fold → findFirst ----
  fx(
    'tmpl-gather-fold',
    'standard',
    'gather(fold)標準（salary合計）',
    'Employee 4件のsalaryを初期値0Lから累積します。処理途中では放出せず、終端のfinisherで最終値1件だけを放出し、findFirstがOptional[21_700_000L]を返します。Phase 4のreduce（終端操作）との対比教材です。',
    {
      'slot-gatherer': {
        kind: 'fold',
        initial: { type: 'long', value: 0 },
        accumulation: { kind: 'employeeFieldSum', field: 'salary' },
      },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-gather-fold',
    'emptySource',
    'gather(fold)空ソース（identity）',
    '入力0件でもfoldはidentityを最終値として1件産出するため、findFirstの結果はOptional[0L]になります（空Streamで空Optionalになるreduceとの違い）。',
    {
      'slot-gatherer': {
        kind: 'fold',
        initial: { type: 'long', value: 0 },
        accumulation: { kind: 'employeeFieldSum', field: 'salary' },
      },
    },
    EMPTY_EMPLOYEES,
  ),
]

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
  // limitなしの無限source template（実行不能のまま保持。limit付きtemplateを使用する）
  fx(
    'tmpl-src-generate',
    'standard',
    'Stream.generate()（limitなし・実行不能）',
    '無限・unordered Streamのため、limit()なしでは実行できません。limit付きtemplateを使用してください。',
    { 'slot-source': { kind: 'generate', ruleId: 'supplier-counter' } },
  ),
  fx(
    'tmpl-src-iterate2',
    'standard',
    'Stream.iterate(seed, operator)（limitなし・実行不能）',
    '無限Streamのため、limit()なしでは実行できません。limit付きtemplateを使用してください。',
    {
      'slot-source': { kind: 'iterate2', seed: 1, operator: { ruleId: 'increment', step: 1 } },
    },
  ),
  // ---- Phase 3: 無限sourceの有限化（指示§8.1） ----
  fx(
    'tmpl-limit-generate',
    'standard',
    'Stream.generate() + limit(3)',
    '無限・unordered sourceをlimit(3)で有限化します。supplierは3回だけ呼ばれ、期待結果は[1, 2, 3]です。',
    {
      'slot-source': { kind: 'generate', ruleId: 'supplier-counter' },
      'slot-count': 3,
    },
  ),
  fx(
    'tmpl-limit-iterate2',
    'standard',
    'Stream.iterate(1, n -> n + 1) + limit(5)',
    '無限sourceをlimit(5)で有限化します。期待結果は[1, 2, 3, 4, 5]です。',
    {
      'slot-source': { kind: 'iterate2', seed: 1, operator: { ruleId: 'increment', step: 1 } },
      'slot-count': 5,
    },
  ),
  // ---- Phase 3: stateful中間操作（指示§9） ----
  fx(
    'tmpl-distinct',
    'standard',
    'distinct標準（重複を含むString）',
    '["Java", "SQL", "Java", "Git", "SQL"]から重複を除外します。期待結果は[Java, SQL, Git]です。',
    {
      'slot-source': {
        kind: 'streamOf',
        elementTypeName: 'String',
        values: ['Java', 'SQL', 'Java', 'Git', 'SQL'],
      },
    },
  ),
  fx(
    'tmpl-distinct',
    'emptySource',
    'distinct空ソース',
    '入力0件のため、seenは一度も更新されず空Listが確定します。',
    { 'slot-source': { kind: 'streamOf', elementTypeName: 'String', values: [] } },
  ),
  fx(
    'tmpl-distinct-midempty',
    'midEmpty',
    'distinct途中0件（filterで全件除外）',
    '前段のfilter(age >= 100)で全件除外され、distinctへ要素が到達しません。',
    { 'slot-predicate-1': agePredicate(100) },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-sorted-natural',
    'standard',
    'sorted()標準（未整列のString）',
    '["SQL", "Java", "Git", "API"]を自然順序で並べ替えます。期待結果は[API, Git, Java, SQL]です。',
    {
      'slot-source': {
        kind: 'streamOf',
        elementTypeName: 'String',
        values: ['SQL', 'Java', 'Git', 'API'],
      },
    },
  ),
  fx(
    'tmpl-sorted-natural',
    'emptySource',
    'sorted()空ソース',
    '入力0件でも、空bufferの並べ替え確定（SORT_ORDER_CONFIRMED）が1回発生します。',
    { 'slot-source': { kind: 'streamOf', elementTypeName: 'String', values: [] } },
  ),
  fx(
    'tmpl-sorted-midempty',
    'midEmpty',
    'sorted途中0件（filterで全件除外・空buffer）',
    '前段のfilter(age >= 100)で全件除外され、空bufferの順序確定だけが行われます。',
    { 'slot-predicate-1': agePredicate(100), 'slot-mapper-1': nameMapper },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-sorted-comparator',
    'standard',
    'sorted(Comparator)標準（region昇順・stable）',
    'EmployeeをComparator.comparing(Employee::region)で並べ替えます。同じregion（関東）の佐藤・高橋は元の順序を維持します。',
    {
      'slot-comparator': {
        kind: 'employeeKeys',
        keys: [{ field: 'region', direction: 'ASC' }],
      },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-sorted-comparator',
    'emptySource',
    'sorted(Comparator)空ソース',
    '入力0件でも、空bufferの並べ替え確定が1回発生します。',
    {
      'slot-comparator': {
        kind: 'employeeKeys',
        keys: [{ field: 'region', direction: 'ASC' }],
      },
    },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-limit',
    'standard',
    'limit(3)標準（5件中3件）',
    'rangeClosed(1, 5)の5件からlimit(3)で最初の3件だけを通します。残りの4, 5は未評価のままです。',
    {
      'slot-source': { kind: 'rangeClosed', from: 1, to: 5 },
      'slot-count': 3,
    },
  ),
  fx(
    'tmpl-limit',
    'midEmpty',
    'limit(0)途中0件（非空source）',
    'limit(0)はsource要素を1件も要求せず、処理中要素0件で短絡を確定します。結果は空Listです。',
    {
      'slot-source': { kind: 'rangeClosed', from: 1, to: 5 },
      'slot-count': 0,
    },
  ),
  fx(
    'tmpl-limit',
    'emptySource',
    'limit空ソース',
    '空のsourceでは上限に到達せず、通常のupstream完了で空Listが確定します。',
    {
      'slot-source': { kind: 'rangeClosed', from: 1, to: 0 },
      'slot-count': 3,
    },
  ),
  fx(
    'tmpl-skip',
    'standard',
    'skip(2)標準（最初の2件を除外）',
    'int[]{10, 20, 30, 40}からskip(2)で最初の2件を除外します。期待結果は[30, 40]です。',
    {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [10, 20, 30, 40] },
      'slot-count': 2,
    },
  ),
  fx(
    'tmpl-skip',
    'midEmpty',
    'skip途中0件（n >= source件数）',
    'skip(4)は4件すべてを除外するため、結果は空Listです。',
    {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [10, 20, 30, 40] },
      'slot-count': 4,
    },
  ),
  fx(
    'tmpl-skip',
    'emptySource',
    'skip空ソース',
    '入力0件のため、skipは一度も適用されず空Listが確定します。',
    {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [] },
      'slot-count': 2,
    },
  ),
  fx(
    'tmpl-takewhile',
    'standard',
    'takeWhile標準（n -> n < 5）',
    '[1, 2, 6, 3, 7]のtrueのprefix [1, 2]だけを通します。6が境界要素となり、3と7は未評価のままです。',
    {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [1, 2, 6, 3, 7] },
      'slot-predicate-1': {
        kind: 'currentValueCompare',
        operator: 'LT',
        value: { type: 'int', value: 5 },
      },
    },
  ),
  fx(
    'tmpl-takewhile',
    'midEmpty',
    'takeWhile途中0件（最初の要素がfalse）',
    '[6, 3, 7]は最初の6がfalseのため、1件も通過せず短絡します。3と7は未評価のままです。',
    {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [6, 3, 7] },
      'slot-predicate-1': {
        kind: 'currentValueCompare',
        operator: 'LT',
        value: { type: 'int', value: 5 },
      },
    },
  ),
  fx(
    'tmpl-takewhile',
    'emptySource',
    'takeWhile空ソース',
    '入力0件のため、Predicateは一度も評価されず空Listが確定します。',
    {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [] },
      'slot-predicate-1': {
        kind: 'currentValueCompare',
        operator: 'LT',
        value: { type: 'int', value: 5 },
      },
    },
  ),
  fx(
    'tmpl-dropwhile',
    'standard',
    'dropWhile標準（n -> n < 5）',
    '[1, 2, 6, 3, 7]のtrueのprefix [1, 2]を除外し、6以降を通します。期待結果は[6, 3, 7]です。',
    {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [1, 2, 6, 3, 7] },
      'slot-predicate-1': {
        kind: 'currentValueCompare',
        operator: 'LT',
        value: { type: 'int', value: 5 },
      },
    },
  ),
  fx(
    'tmpl-dropwhile',
    'midEmpty',
    'dropWhile途中0件（全要素がtrue）',
    '[1, 2, 3]は全要素がtrueのためすべてdropされ、結果は空Listです。',
    {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [1, 2, 3] },
      'slot-predicate-1': {
        kind: 'currentValueCompare',
        operator: 'LT',
        value: { type: 'int', value: 5 },
      },
    },
  ),
  fx(
    'tmpl-dropwhile',
    'emptySource',
    'dropWhile空ソース',
    '入力0件のため、Predicateは一度も評価されず空Listが確定します。',
    {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [] },
      'slot-predicate-1': {
        kind: 'currentValueCompare',
        operator: 'LT',
        value: { type: 'int', value: 5 },
      },
    },
  ),
  fx(
    'tmpl-peek',
    'standard',
    'peek標準（PRINT_FIELD: name）',
    '各Employeeのname()をSide Effectビューへ出力します。通常の結果は変更されません。',
    { 'slot-consumer': { kind: 'printField', field: 'name' } },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-peek',
    'emptySource',
    'peek空ソース',
    '入力0件のため、Consumerは一度も呼ばれません（Side Effectは0回）。',
    { 'slot-consumer': { kind: 'printField', field: 'name' } },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-peek-midempty',
    'midEmpty',
    'peek途中0件（filterで全件除外・Consumer 0回）',
    '前段のfilter(age >= 100)で全件除外され、peekのConsumerは一度も呼ばれません。',
    {
      'slot-predicate-1': agePredicate(100),
      'slot-consumer': { kind: 'printField', field: 'name' },
    },
    STANDARD_EMPLOYEES,
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
  // ---- Phase 4: reduce（指示§6.1） ----
  fx(
    'tmpl-reduce-concat',
    'standard',
    'reduce標準（String連結）',
    '["Java", "SQL", "Git"]を連結します。最初の要素が初期累積値となり、期待結果はOptional["JavaSQLGit"]です。',
    {
      'slot-source': { kind: 'streamOf', elementTypeName: 'String', values: ['Java', 'SQL', 'Git'] },
      'slot-reduction': { kind: 'stringConcat' },
    },
  ),
  fx(
    'tmpl-reduce-concat',
    'emptySource',
    'reduce空ソース（Optional.empty）',
    'identityなしのreduceは空StreamでOptional.empty()を返します。',
    {
      'slot-source': { kind: 'streamOf', elementTypeName: 'String', values: [] },
      'slot-reduction': { kind: 'stringConcat' },
    },
  ),
  fx(
    'tmpl-reduce-concat-midempty',
    'midEmpty',
    'reduce途中0件（filterで全件除外）',
    '前段のfilter(age >= 100)で全件除外され、結果はOptional.empty()です。',
    {
      'slot-predicate-f': agePredicate(100),
      'slot-mapper-1': nameMapper,
      'slot-reduction': { kind: 'stringConcat' },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-reduce-int',
    'standard',
    'IntStream.reduce標準（加算・identityなし）',
    'int[]{3, 1, 4}を加算します。期待結果はOptionalInt[8]です。',
    {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [3, 1, 4] },
      'slot-reduction': { kind: 'numericSum' },
    },
  ),
  fx(
    'tmpl-reduce-int',
    'emptySource',
    'IntStream.reduce空ソース（OptionalInt.empty）',
    '空StreamのidentityなしreduceはOptionalInt.empty()を返します。',
    {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [] },
      'slot-reduction': { kind: 'numericSum' },
    },
  ),
  fx(
    'tmpl-reduce-int-identity',
    'standard',
    'IntStream.reduce標準（identity=100）',
    'identity 100から始めてint[]{3, 1, 4}を加算します。期待結果はint 108です。',
    {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [3, 1, 4] },
      'slot-reduction': { kind: 'numericSum' },
      'slot-identity': { type: 'int', value: 100 },
    },
  ),
  fx(
    'tmpl-reduce-int-identity',
    'emptySource',
    'IntStream.reduce空ソース（identityを返す）',
    'identityありのreduceは空Streamでidentity（100）を返します。',
    {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [] },
      'slot-reduction': { kind: 'numericSum' },
      'slot-identity': { type: 'int', value: 100 },
    },
  ),
  fx(
    'tmpl-reduce-salary',
    'standard',
    '3引数reduce標準（salary合計）',
    'identity 0Lから各Employeeのsalary()を加算します。sequential実行のためcombiner呼出しは0回です。期待結果は21_700_000Lです。',
    {
      'slot-reduction': { kind: 'employeeFieldSum', field: 'salary' },
      'slot-identity': { type: 'long', value: 0 },
    },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-reduce-salary',
    'emptySource',
    '3引数reduce空ソース（identityを返す）',
    '空Streamではidentity（0L）がそのまま結果になります。',
    {
      'slot-reduction': { kind: 'employeeFieldSum', field: 'salary' },
      'slot-identity': { type: 'long', value: 0 },
    },
    EMPTY_EMPLOYEES,
  ),
  // ---- Phase 4: count・min・max（指示§6.2） ----
  fx(
    'tmpl-count',
    'standard',
    'count標準（4件）',
    '各要素の概念上の寄与を1件ずつ数えます。期待結果は4Lです。',
    {},
    STANDARD_EMPLOYEES,
  ),
  fx('tmpl-count', 'emptySource', 'count空ソース（0L）', '空Streamのcount()は0Lです。', {}, EMPTY_EMPLOYEES),
  fx(
    'tmpl-count-midempty',
    'midEmpty',
    'count途中0件（filterで全件除外・0L）',
    '前段のfilter(age >= 100)で全件除外され、countは0Lです。',
    { 'slot-predicate-f': agePredicate(100) },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-min-age',
    'standard',
    'Stream.min標準（age Comparator）',
    'Comparator.comparingInt(Employee::age)で最小の要素を探します。期待結果はOptional[鈴木（27）]です。',
    { 'slot-comparator': { kind: 'employeeKeys', keys: [{ field: 'age', direction: 'ASC' }] } },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-min-age',
    'emptySource',
    'Stream.min空ソース（Optional.empty）',
    '空StreamのminはOptional.empty()を返します。',
    { 'slot-comparator': { kind: 'employeeKeys', keys: [{ field: 'age', direction: 'ASC' }] } },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-max-age',
    'standard',
    'Stream.max標準（age Comparator）',
    'Comparator.comparingInt(Employee::age)で最大の要素を探します。期待結果はOptional[高橋（42）]です。',
    { 'slot-comparator': { kind: 'employeeKeys', keys: [{ field: 'age', direction: 'ASC' }] } },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-max-age',
    'emptySource',
    'Stream.max空ソース（Optional.empty）',
    '空StreamのmaxはOptional.empty()を返します。',
    { 'slot-comparator': { kind: 'employeeKeys', keys: [{ field: 'age', direction: 'ASC' }] } },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-min-int',
    'standard',
    'IntStream.min標準',
    'int[]{3, 1, 4}の最小値を探します。期待結果はOptionalInt[1]です。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [3, 1, 4] } },
  ),
  fx(
    'tmpl-min-int',
    'emptySource',
    'IntStream.min空ソース',
    '空StreamのminはOptionalInt.empty()を返します。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [] } },
  ),
  fx(
    'tmpl-max-long',
    'standard',
    'LongStream.max標準',
    'long[]{30, 10, 20}の最大値を探します。期待結果はOptionalLong[30]です。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'amounts', primitive: 'long', values: [30, 10, 20] } },
  ),
  fx(
    'tmpl-max-long',
    'emptySource',
    'LongStream.max空ソース',
    '空StreamのmaxはOptionalLong.empty()を返します。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'amounts', primitive: 'long', values: [] } },
  ),
  fx(
    'tmpl-min-double',
    'standard',
    'DoubleStream.min標準',
    'double[]{2.5, 1.5, 3.5}の最小値を探します。期待結果はOptionalDouble[1.5]です。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'rates', primitive: 'double', values: [2.5, 1.5, 3.5] } },
  ),
  fx(
    'tmpl-min-double',
    'emptySource',
    'DoubleStream.min空ソース',
    '空StreamのminはOptionalDouble.empty()を返します。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'rates', primitive: 'double', values: [] } },
  ),
  // ---- Phase 4: find・match（指示§6.3） ----
  fx(
    'tmpl-findfirst',
    'standard',
    'findFirst標準（途中で確定・残り未評価）',
    'filter(age >= 30)を通過した最初の要素（佐藤）で結果が確定し、以降の要素は未評価のままです。',
    { 'slot-predicate-f': agePredicate(30) },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-findfirst',
    'midEmpty',
    'findFirst途中0件（Optional.empty）',
    'filter(age >= 100)で全件除外され、結果はOptional.empty()です。',
    { 'slot-predicate-f': agePredicate(100) },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-findfirst',
    'emptySource',
    'findFirst空ソース（Optional.empty）',
    '空StreamのfindFirstはOptional.empty()を返します。',
    { 'slot-predicate-f': agePredicate(30) },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-findany',
    'standard',
    'findAny標準（fixtureでは決定的選択）',
    'このfixtureでは毎回同じ要素（佐藤）を選択しますが、JDKはfindAnyでどの要素が返るかを保証しません。',
    { 'slot-predicate-f': agePredicate(30) },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-findany',
    'emptySource',
    'findAny空ソース（Optional.empty）',
    '空StreamのfindAnyはOptional.empty()を返します。',
    { 'slot-predicate-f': agePredicate(30) },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-anymatch',
    'standard',
    'anyMatch標準（途中のtrueで停止）',
    'age >= 40の最初のtrue（高橋）で結果trueが確定し、田中は未評価のままです。',
    { 'slot-predicate-1': agePredicate(40) },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-anymatch',
    'emptySource',
    'anyMatch空ソース（false）',
    '空StreamのanyMatchはfalseです。Predicateは一度も評価されません。',
    { 'slot-predicate-1': agePredicate(40) },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-allmatch',
    'standard',
    'allMatch標準（途中のfalseで停止）',
    'age >= 30の最初のfalse（鈴木）で結果falseが確定し、高橋・田中は未評価のままです。',
    { 'slot-predicate-1': agePredicate(30) },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-allmatch',
    'emptySource',
    'allMatch空ソース（vacuous truth）',
    '空StreamのallMatchはtrueです（反例が存在しないため）。Predicateは一度も評価されません。',
    { 'slot-predicate-1': agePredicate(30) },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-nonematch',
    'standard',
    'noneMatch標準（途中のtrueで停止）',
    'age >= 40の最初のtrue（高橋）で結果falseが確定し、田中は未評価のままです。',
    { 'slot-predicate-1': agePredicate(40) },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-nonematch',
    'emptySource',
    'noneMatch空ソース（vacuous truth）',
    '空StreamのnoneMatchはtrueです（該当が存在しないため）。Predicateは一度も評価されません。',
    { 'slot-predicate-1': agePredicate(40) },
    EMPTY_EMPLOYEES,
  ),
  // ---- Phase 4: primitive集計（指示§6.4） ----
  fx(
    'tmpl-sum-int',
    'standard',
    'IntStream.sum標準',
    'int[]{3, 1, 4}の合計です。期待結果は8です。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [3, 1, 4] } },
  ),
  fx(
    'tmpl-sum-int',
    'emptySource',
    'IntStream.sum空ソース（0）',
    '空StreamのIntStream.sum()は0です。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [] } },
  ),
  fx(
    'tmpl-sum-long',
    'standard',
    'LongStream.sum標準',
    'long[]{10, 20, 30}の合計です。期待結果は60Lです。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'amounts', primitive: 'long', values: [10, 20, 30] } },
  ),
  fx(
    'tmpl-sum-long',
    'emptySource',
    'LongStream.sum空ソース（0L）',
    '空StreamのLongStream.sum()は0Lです。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'amounts', primitive: 'long', values: [] } },
  ),
  fx(
    'tmpl-sum-double',
    'standard',
    'DoubleStream.sum標準',
    'double[]{1.5, 2.5}の合計です。期待結果は4.0です。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'rates', primitive: 'double', values: [1.5, 2.5] } },
  ),
  fx(
    'tmpl-sum-double',
    'emptySource',
    'DoubleStream.sum空ソース（0.0）',
    '空StreamのDoubleStream.sum()は0.0です。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'rates', primitive: 'double', values: [] } },
  ),
  fx(
    'tmpl-average-int',
    'standard',
    'IntStream.average標準',
    'int[]{3, 1, 4, 2}の平均です。期待結果はOptionalDouble[2.5]です。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [3, 1, 4, 2] } },
  ),
  fx(
    'tmpl-average-int',
    'emptySource',
    'IntStream.average空ソース（OptionalDouble.empty）',
    '空Streamのaverage()はOptionalDouble.empty()を返します。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [] } },
  ),
  fx(
    'tmpl-average-long',
    'standard',
    'LongStream.average標準',
    'long[]{10, 20, 30}の平均です。期待結果はOptionalDouble[20.0]です。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'amounts', primitive: 'long', values: [10, 20, 30] } },
  ),
  fx(
    'tmpl-average-long',
    'emptySource',
    'LongStream.average空ソース（OptionalDouble.empty）',
    '空Streamのaverage()はOptionalDouble.empty()を返します。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'amounts', primitive: 'long', values: [] } },
  ),
  fx(
    'tmpl-average-double',
    'standard',
    'DoubleStream.average標準',
    'double[]{1.5, 2.5, 3.5}の平均です。期待結果はOptionalDouble[2.5]です。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'rates', primitive: 'double', values: [1.5, 2.5, 3.5] } },
  ),
  fx(
    'tmpl-average-double',
    'emptySource',
    'DoubleStream.average空ソース（OptionalDouble.empty）',
    '空Streamのaverage()はOptionalDouble.empty()を返します。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'rates', primitive: 'double', values: [] } },
  ),
  fx(
    'tmpl-stats-int',
    'standard',
    'IntStream.summaryStatistics標準',
    'int[]{3, 1, 4, 2}のcount / sum / min / average / maxを同時集計します。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [3, 1, 4, 2] } },
  ),
  fx(
    'tmpl-stats-int',
    'emptySource',
    'IntStream.summaryStatistics空ソース（正規初期値）',
    '空Streamではcount=0, sum=0, min=Integer.MAX_VALUE, max=Integer.MIN_VALUE, average=0.0です。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [] } },
  ),
  fx(
    'tmpl-stats-long',
    'standard',
    'LongStream.summaryStatistics標準',
    'long[]{10, 20, 30}のcount / sum / min / average / maxを同時集計します。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'amounts', primitive: 'long', values: [10, 20, 30] } },
  ),
  fx(
    'tmpl-stats-long',
    'emptySource',
    'LongStream.summaryStatistics空ソース（正規初期値）',
    '空Streamではcount=0, sum=0, min=Long.MAX_VALUE, max=Long.MIN_VALUE, average=0.0です。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'amounts', primitive: 'long', values: [] } },
  ),
  fx(
    'tmpl-stats-double',
    'standard',
    'DoubleStream.summaryStatistics標準',
    'double[]{1.5, 2.5, 3.5}のcount / sum / min / average / maxを同時集計します。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'rates', primitive: 'double', values: [1.5, 2.5, 3.5] } },
  ),
  fx(
    'tmpl-stats-double',
    'emptySource',
    'DoubleStream.summaryStatistics空ソース（正規初期値）',
    '空Streamではmin=Double.POSITIVE_INFINITY, max=Double.NEGATIVE_INFINITYが正規の初期値です。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'rates', primitive: 'double', values: [] } },
  ),
  // ---- Phase 4: 結果化・副作用（指示§6.5） ----
  fx(
    'tmpl-toarray-object',
    'standard',
    'Stream.toArray標準（Object[]）',
    'EmployeeをObject[]へ格納します。component typeはObjectです。',
    {},
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-toarray-object',
    'emptySource',
    'Stream.toArray空ソース（長さ0のObject[]）',
    '空Streamは長さ0のObject[]を返します。',
    {},
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-toarray-int',
    'standard',
    'IntStream.toArray標準（int[]）',
    'int[]{3, 1, 4}をint[]へ格納します。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [3, 1, 4] } },
  ),
  fx(
    'tmpl-toarray-int',
    'emptySource',
    'IntStream.toArray空ソース（長さ0のint[]）',
    '空Streamは長さ0のint[]を返します。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [] } },
  ),
  fx(
    'tmpl-toarray-long',
    'standard',
    'LongStream.toArray標準（long[]）',
    'long[]{10, 20, 30}をlong[]へ格納します。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'amounts', primitive: 'long', values: [10, 20, 30] } },
  ),
  fx(
    'tmpl-toarray-long',
    'emptySource',
    'LongStream.toArray空ソース（長さ0のlong[]）',
    '空Streamは長さ0のlong[]を返します。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'amounts', primitive: 'long', values: [] } },
  ),
  fx(
    'tmpl-toarray-double',
    'standard',
    'DoubleStream.toArray標準（double[]）',
    'double[]{1.5, 2.5}をdouble[]へ格納します。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'rates', primitive: 'double', values: [1.5, 2.5] } },
  ),
  fx(
    'tmpl-toarray-double',
    'emptySource',
    'DoubleStream.toArray空ソース（長さ0のdouble[]）',
    '空Streamは長さ0のdouble[]を返します。',
    { 'slot-source': { kind: 'arrayPrimitive', arrayId: 'rates', primitive: 'double', values: [] } },
  ),
  fx(
    'tmpl-toarray-generator',
    'standard',
    'Stream.toArray(String[]::new)標準',
    'generatorで型付き配列String[]を生成します。',
    {
      'slot-source': { kind: 'streamOf', elementTypeName: 'String', values: ['Java', 'SQL'] },
      'slot-generator': { kind: 'arrayGenerator', elementTypeName: 'String' },
    },
  ),
  fx(
    'tmpl-toarray-generator',
    'emptySource',
    'Stream.toArray(String[]::new)空ソース',
    '空Streamでも正しいcomponent type（String）を持つ長さ0配列を返します。',
    {
      'slot-source': { kind: 'streamOf', elementTypeName: 'String', values: [] },
      'slot-generator': { kind: 'arrayGenerator', elementTypeName: 'String' },
    },
  ),
  fx(
    'tmpl-foreach',
    'standard',
    'forEach標準（Side Effectとvoid）',
    '各Employeeのname()をSide Effectビューへ出力します。戻り値はvoidです。',
    { 'slot-consumer': { kind: 'printField', field: 'name' } },
    STANDARD_EMPLOYEES,
  ),
  fx(
    'tmpl-foreach',
    'emptySource',
    'forEach空ソース（Consumer 0回）',
    '空StreamではConsumerは一度も呼ばれません。戻り値はvoidです。',
    { 'slot-consumer': { kind: 'printField', field: 'name' } },
    EMPTY_EMPLOYEES,
  ),
  fx(
    'tmpl-foreachordered',
    'standard',
    'forEachOrdered標準（encounter order）',
    'int[]{3, 1, 4}をencounter orderで出力します。sequential実行ではforEachと同じ順序です。',
    {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [3, 1, 4] },
      'slot-consumer': { kind: 'printValue' },
    },
  ),
  fx(
    'tmpl-foreachordered',
    'emptySource',
    'forEachOrdered空ソース（Consumer 0回）',
    '空StreamではConsumerは一度も呼ばれません。',
    {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive: 'int', values: [] },
      'slot-consumer': { kind: 'printValue' },
    },
  ),
  // ---- Phase 5: Collector（指示§8） ----
  ...P5_FIXTURES,
  // ---- Phase 7: Gatherer（指示§7.6） ----
  ...P7_FIXTURES,
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
