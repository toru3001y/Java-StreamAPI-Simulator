/**
 * Phase 5 Collector DSL（指示§7.1、Draft v0.8 §9.1「Collector: collectorKind、引数、
 * downstream、left / right Collector」）。
 *
 * Collectorを型付きの再帰的な識別可能Unionで表現する。任意Javaコード文字列・
 * JavaScript式・関数本文文字列は受け付けない（`eval` / `new Function`も使用しない）。
 * 同じASTから評価・結果TypeRef・表示用Javaコード・自然文説明を生成する。
 *
 * 引数の有無はoptional keyではなく明示`null`で表す（closed schema検証が実キー集合だけを
 * 見るため。既存`PipelineNodeDef`の`predicate: … | null`と同じ方針）。
 */
import type { ComparatorDsl } from './comparatorAst'
import type { DslPredicate } from './ast'
import type { MapperDsl } from './mapperAst'
import type { ReductionDsl } from './terminalAst'

/** joiningのdelimiter / prefix / suffix（型付きString定数。指示§7.1） */
export interface StringConstDsl {
  readonly type: 'string'
  readonly value: string
}

/** groupingBy classifierの許可3形（指示§7.1、Draft v0.8 §6.1のフィールド主用途表） */
export type ClassifierDsl =
  /** EmployeeのStringフィールド参照（region等） */
  | { readonly kind: 'employeeField'; readonly field: ClassifierEmployeeField }
  /** Employee::department（Department record自体をMapキーにする） */
  | { readonly kind: 'employeeDepartment' }
  /** Departmentフィールド参照（e.department().name()等） */
  | { readonly kind: 'departmentField'; readonly field: ClassifierDepartmentField }

/** classifierで許可するEmployeeのStringフィールド */
export const CLASSIFIER_EMPLOYEE_FIELDS = ['region', 'name'] as const
export type ClassifierEmployeeField = (typeof CLASSIFIER_EMPLOYEE_FIELDS)[number]

/** classifierで許可するDepartmentフィールド */
export const CLASSIFIER_DEPARTMENT_FIELDS = ['name', 'division'] as const
export type ClassifierDepartmentField = (typeof CLASSIFIER_DEPARTMENT_FIELDS)[number]

export const CLASSIFIER_DSL_KINDS = ['employeeField', 'employeeDepartment', 'departmentField'] as const

/** 数値集計Collectorのkind（付録A.4のsumming / averaging / summarizing） */
export const COLLECTOR_NUMERIC_KINDS = [
  'summingInt',
  'summingLong',
  'summingDouble',
  'averagingInt',
  'averagingLong',
  'averagingDouble',
  'summarizingInt',
  'summarizingLong',
  'summarizingDouble',
] as const
export type CollectorNumericKind = (typeof COLLECTOR_NUMERIC_KINDS)[number]

/**
 * 数値集計で許可するEmployeeフィールド。Phase 4の`REDUCTION_FIELD_WHITELIST`
 * （salary / age）ではdouble集計のevaluationを表現できないためCollector専用に定義する。
 */
export const COLLECTOR_NUMERIC_FIELDS = ['age', 'salary', 'evaluation'] as const
export type CollectorNumericField = (typeof COLLECTOR_NUMERIC_FIELDS)[number]

/** 集計kindの数値種別ごとに許可するfield（Javaのprimitive型と一致させる） */
export const COLLECTOR_NUMERIC_FIELD_BY_PRIMITIVE: Readonly<
  Record<'Int' | 'Long' | 'Double', CollectorNumericField>
> = {
  Int: 'age',
  Long: 'salary',
  Double: 'evaluation',
}

/** toCollectionのコンテナsupplier ID（定義済みIDホワイトリスト。Draft v0.8 §9.1 Supplier） */
export const COLLECTOR_SUPPLIER_IDS = ['ArrayList::new', 'LinkedList::new'] as const
export type CollectorSupplierId = (typeof COLLECTOR_SUPPLIER_IDS)[number]

/** supplier IDごとの教材表示コンテナ名（TypeRefはList<T>のまま。指示§6.3） */
export const COLLECTOR_SUPPLIER_CONTAINER_NAMES: Readonly<Record<CollectorSupplierId, string>> = {
  'ArrayList::new': 'ArrayList',
  'LinkedList::new': 'LinkedList',
}

/** groupingByのmapFactory ID（Draft v0.8 §9.1 MapFactory） */
export const COLLECTOR_MAP_FACTORY_IDS = ['TreeMap::new'] as const
export type CollectorMapFactoryId = (typeof COLLECTOR_MAP_FACTORY_IDS)[number]

/** mapFactory IDごとの表示Map名とJDK上の順序意味論の有無（指示§6.4・§9.5） */
export const COLLECTOR_MAP_FACTORY_META: Readonly<
  Record<CollectorMapFactoryId, { readonly containerName: string; readonly jdkOrdered: boolean }>
> = {
  'TreeMap::new': { containerName: 'TreeMap', jdkOrdered: true },
}

/**
 * ComparatorなしのTreeMap mapFactoryが要求するキーのComparable性（指示§7.1）。
 * Java SE 25 TreeMap(): "All keys inserted into the map must implement the Comparable
 * interface." のため、非Comparableキー（Department record）との組合せだけを禁止する。
 */
export const COMPARABLE_CLASSIFIER_KINDS: readonly ClassifierDsl['kind'][] = [
  'employeeField',
  'departmentField',
]

/** collectingAndThenのfinisher ID（Draft v0.8 §9.1 Finisher） */
export const COLLECTOR_FINISHER_IDS = ['List::copyOf'] as const
export type CollectorFinisherId = (typeof COLLECTOR_FINISHER_IDS)[number]

/** teeingのmerger ID（許可済み結果record構造。Draft v0.8 §9.1 Teeing merger） */
export const TEEING_MERGER_IDS = ['SalarySummary::new'] as const
export type TeeingMergerId = (typeof TEEING_MERGER_IDS)[number]

/** teeing mergerが生成するrecordの構造（教材データ定義。指示§8.2） */
export const TEEING_MERGER_RECORDS: Readonly<
  Record<
    TeeingMergerId,
    {
      readonly recordName: string
      readonly fields: readonly {
        readonly name: string
        readonly javaType: 'long' | 'double'
      }[]
    }
  >
> = {
  'SalarySummary::new': {
    recordName: 'SalarySummary',
    fields: [
      { name: 'employeeCount', javaType: 'long' },
      { name: 'averageSalary', javaType: 'double' },
    ],
  },
}

/**
 * Collector AST（再帰的な識別可能Union）。
 * downstream / left / rightへ許可されたCollectorを再帰指定できる。
 */
export type CollectorDsl =
  // ---- 単純Collector ----
  | { readonly kind: 'toList' }
  | { readonly kind: 'toSet' }
  | { readonly kind: 'toCollection'; readonly supplierId: CollectorSupplierId }
  | {
      readonly kind: 'joining'
      /** 引数なし版はすべてnull、delimiter単独版はdelimiterのみ、3引数版は3つすべて非null */
      readonly delimiter: StringConstDsl | null
      readonly prefix: StringConstDsl | null
      readonly suffix: StringConstDsl | null
    }
  | { readonly kind: 'counting' }
  | { readonly kind: CollectorNumericKind; readonly field: CollectorNumericField }
  | { readonly kind: 'minBy' | 'maxBy'; readonly comparator: ComparatorDsl }
  | { readonly kind: 'reducing'; readonly reduction: ReductionDsl }
  // ---- downstream合成 ----
  | { readonly kind: 'mapping'; readonly mapper: MapperDsl; readonly downstream: CollectorDsl }
  | { readonly kind: 'filtering'; readonly predicate: DslPredicate; readonly downstream: CollectorDsl }
  | { readonly kind: 'flatMapping'; readonly mapper: MapperDsl; readonly downstream: CollectorDsl }
  | {
      readonly kind: 'collectingAndThen'
      readonly downstream: CollectorDsl
      readonly finisherId: CollectorFinisherId
    }
  // ---- 分類ツリー ----
  | {
      readonly kind: 'groupingBy'
      readonly classifier: ClassifierDsl
      /** 3引数overloadのときだけ非null */
      readonly mapFactoryId: CollectorMapFactoryId | null
      /** 1引数overloadではnull（暗黙のtoList()相当を教材上も明示する） */
      readonly downstream: CollectorDsl | null
    }
  | {
      readonly kind: 'partitioningBy'
      readonly predicate: DslPredicate
      /** 1引数overloadではnull */
      readonly downstream: CollectorDsl | null
    }
  // ---- Collector入れ子 ----
  | {
      readonly kind: 'teeing'
      readonly left: CollectorDsl
      readonly right: CollectorDsl
      readonly mergerId: TeeingMergerId
    }

export const COLLECTOR_DSL_KINDS = [
  'toList',
  'toSet',
  'toCollection',
  'joining',
  'counting',
  ...COLLECTOR_NUMERIC_KINDS,
  'minBy',
  'maxBy',
  'reducing',
  'mapping',
  'filtering',
  'flatMapping',
  'collectingAndThen',
  'groupingBy',
  'partitioningBy',
  'teeing',
] as const

/** downstream / left / rightを持つ合成Collectorのkind */
export const COMPOSITE_COLLECTOR_KINDS: readonly CollectorDsl['kind'][] = [
  'mapping',
  'filtering',
  'flatMapping',
  'collectingAndThen',
  'groupingBy',
  'partitioningBy',
  'teeing',
]

/**
 * 3引数collect（`collect(Supplier, BiConsumer, BiConsumer)`）のDSL。
 * supplier / accumulator / combinerは定義済みIDの組合せホワイトリストで表現し、
 * 任意コードを受け付けない（指示§5.1、Draft v0.8 §15.1）。
 */
export interface CollectTripleDsl {
  readonly kind: 'collectTriple'
  readonly supplierId: string
  readonly accumulatorId: string
  readonly combinerId: string
}

/** 許可する3引数collectのID組合せ（コンテナ種別ごとに1組） */
export const COLLECT_TRIPLE_ID_COMBINATIONS: readonly {
  readonly supplierId: string
  readonly accumulatorId: string
  readonly combinerId: string
  readonly containerName: string
}[] = [
  {
    supplierId: 'ArrayList::new',
    accumulatorId: 'ArrayList::add',
    combinerId: 'ArrayList::addAll',
    containerName: 'ArrayList',
  },
]

/** Collector ASTの入れ子深さ上限（教材制約。root=1。判断は docs/phase-5-decisions.md §13） */
export const COLLECTOR_MAX_DEPTH = 4

/** Collector ASTの入れ子深さ（root=1）。検証済みASTに対して使用する。 */
export function collectorDepth(dsl: CollectorDsl): number {
  switch (dsl.kind) {
    case 'mapping':
    case 'filtering':
    case 'flatMapping':
    case 'collectingAndThen':
      return 1 + collectorDepth(dsl.downstream)
    case 'groupingBy':
    case 'partitioningBy':
      return dsl.downstream === null ? 1 : 1 + collectorDepth(dsl.downstream)
    case 'teeing':
      return 1 + Math.max(collectorDepth(dsl.left), collectorDepth(dsl.right))
    default:
      return 1
  }
}

/** Collector AST中に現れるすべてのcollectorKindを収集する（slot許可範囲検証用）。 */
export function collectorKindsOf(dsl: CollectorDsl): readonly CollectorDsl['kind'][] {
  const kinds: CollectorDsl['kind'][] = [dsl.kind]
  switch (dsl.kind) {
    case 'mapping':
    case 'filtering':
    case 'flatMapping':
    case 'collectingAndThen':
      kinds.push(...collectorKindsOf(dsl.downstream))
      break
    case 'groupingBy':
    case 'partitioningBy':
      if (dsl.downstream !== null) kinds.push(...collectorKindsOf(dsl.downstream))
      break
    case 'teeing':
      kinds.push(...collectorKindsOf(dsl.left), ...collectorKindsOf(dsl.right))
      break
    default:
      break
  }
  return kinds
}

/** 数値集計kindの数値種別（Int / Long / Double）を導出する。 */
export function numericKindPrimitive(kind: CollectorNumericKind): 'Int' | 'Long' | 'Double' {
  if (kind.endsWith('Int')) return 'Int'
  if (kind.endsWith('Long')) return 'Long'
  return 'Double'
}

/** 数値集計kindの分類（summing / averaging / summarizing）を導出する。 */
export function numericKindFamily(
  kind: CollectorNumericKind,
): 'summing' | 'averaging' | 'summarizing' {
  if (kind.startsWith('summing')) return 'summing'
  if (kind.startsWith('averaging')) return 'averaging'
  return 'summarizing'
}

/** joiningのoverload形（引数なし / delimiter単独 / 3引数）を導出する。 */
export function joiningArity(
  dsl: Extract<CollectorDsl, { kind: 'joining' }>,
): 'none' | 'delimiter' | 'full' {
  if (dsl.delimiter === null) return 'none'
  return dsl.prefix === null ? 'delimiter' : 'full'
}
