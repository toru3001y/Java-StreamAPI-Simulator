import type { DslPredicate } from './ast'
import type { ToMapMergeId, ToMapValueDsl } from './collectorAst'
import type { ComparatorDsl } from './comparatorAst'
import type { ConsumerDsl } from './consumerAst'
import type { MapperDsl } from './mapperAst'
import type { SourceDsl } from './sourceAst'
import { EMPLOYEE_FIELDS } from '../model/employee'
import { formatLongLiteral } from '../model/value'
import { operatorToJava, predicateLiteralToJava } from './javaCode'

/**
 * 検証済みDSL / ASTからの自然文説明生成（§9.1）。
 * DSLと同じfield・operator・値を説明へ反映する（P1-D09）。
 */
const OPERATOR_TEXT: Readonly<Record<string, string>> = {
  GTE: '以上',
  LT: '未満',
}

/** 比較対象の実値をliteral型に合わせて表示する（long定数は`5_500_000L`形式） */
function predicateValueText(predicate: DslPredicate, value: number): string {
  return predicate.value.type === 'long' ? formatLongLiteral(value) : String(value)
}

/** 例: 「ageが30以上かを判定します」「現在値nが5未満かを判定します」 */
export function describePredicate(predicate: DslPredicate): string {
  const opText = OPERATOR_TEXT[predicate.operator]
  if (!opText) throw new Error(`unsupported operator: ${predicate.operator}`)
  const literal = predicateLiteralToJava(predicate)
  if (predicate.kind === 'currentValueCompare') {
    return `現在値nが${literal}${opText}かを判定します`
  }
  return `${predicate.field}が${literal}${opText}かを判定します`
}

/** 例: 「35 >= 30」「5_500_000L >= 5_000_000L」（比較の実値表示、ASCII構文） */
export function comparisonExpr(predicate: DslPredicate, fieldValue: number): string {
  return `${predicateValueText(predicate, fieldValue)} ${operatorToJava(predicate.operator)} ${predicateLiteralToJava(predicate)}`
}

/** 例: 「佐藤.age() → 35」（値遷移はUnicode矢印、§17.4） */
export function fieldValueFlow(
  predicate: DslPredicate,
  elementName: string,
  fieldValue: number,
): string {
  const valueText = predicateValueText(predicate, fieldValue)
  if (predicate.kind === 'currentValueCompare') {
    return `n → ${valueText}`
  }
  const accessor = EMPLOYEE_FIELDS[predicate.field]?.accessor ?? `${predicate.field}()`
  return `${elementName}.${accessor} → ${valueText}`
}

const DIRECTION_TEXT = { ASC: '昇順', DESC: '降順' } as const

/** Comparator DSLの自然文説明（Phase 3指示 §6.3） */
export function describeComparator(comparator: ComparatorDsl | null): string {
  if (!comparator || comparator.kind === 'natural') {
    return '要素の自然順序（Comparable）で並べ替えます'
  }
  const keys = comparator.keys
    .map((key) => `${key.field}の${DIRECTION_TEXT[key.direction]}`)
    .join('、次に')
  return `Employeeを${keys}で並べ替えます`
}

/** Consumer DSLの自然文説明（Phase 3指示 §6.5） */
export function describeConsumer(consumer: ConsumerDsl): string {
  if (consumer.kind === 'printValue') {
    return '現在値をSystem.out.printlnへ渡します（値は変更しません）'
  }
  return `Employeeの${consumer.field}()をSystem.out.printlnへ出力します（値は変更しません）`
}

/** Reduction DSLの自然文説明（Phase 4指示 §8） */
export function describeReduction(reduction: import('./terminalAst').ReductionDsl): string {
  switch (reduction.kind) {
    case 'numericSum':
      return '累積値と現在値を加算して新しい累積値を作ります'
    case 'stringConcat':
      return '累積文字列へ現在の文字列を連結します'
    case 'employeeFieldSum':
      return `累積値へEmployeeの${reduction.field}()を加算します`
  }
}

/** mapperの自然文説明（Phase 2指示 §7.2） */
export function describeMapper(mapper: MapperDsl): string {
  switch (mapper.kind) {
    case 'fieldAccess':
      return `Employeeの${mapper.field}()を取り出します`
    case 'toUpper':
      return '文字列を大文字へ変換します'
    case 'prefix':
      return `"${mapper.prefix}" + n の文字列を組み立てます`
    case 'fieldToPrimitive':
      return `Employeeの${mapper.field}()を${mapper.primitive}値として取り出します`
    case 'listStream':
      return 'Listの要素を1件ずつ送出するmapped Streamへ展開します'
    case 'arrayStream':
      return `${mapper.primitive}配列の要素を1件ずつ送出するmapped Streamへ展開します`
  }
}

/**
 * toMapのvalueMapperの自然文説明（Phase 8指示 §7.4）。
 * `identity`は公式API Note（v0.11 §3.1）の「キーか値のどちらかを要素そのものにする典型形」。
 */
export function describeToMapValue(dsl: ToMapValueDsl): string {
  if (dsl.kind === 'identity') {
    return 'Function.identity()により要素そのものを値にします。'
  }
  return `Employeeの${dsl.field}()を値として取り出します。`
}

/**
 * toMapのmergeFunctionの自然文説明（v0.11 §8.4、Phase 8指示 §7.8）。
 * 「先勝ち / 後勝ち」だけにせず、意味論ラベルを併記する。
 * 「先 / 後」は現在の決定的な逐次実行における入力順を指す（v0.11 §4の7）。
 */
export function describeToMapMerge(mergeId: ToMapMergeId): string {
  switch (mergeId) {
    case 'first':
      return '既存値を保持（先勝ち）します。ここでの「先」は現在の決定的な逐次実行における入力順を指します。'
    case 'last':
      return '新しい値で置換（後勝ち）します。ここでの「後」は現在の決定的な逐次実行における入力順を指します。'
    case 'concat':
      return '既存値と新しい値を", "で連結します。'
  }
}

/** sourceの自然文説明（Phase 2指示 §9.1） */
export function describeSource(source: SourceDsl): string {
  switch (source.kind) {
    case 'collection':
      return '既存CollectionからStreamを生成し、要素を1件ずつ送出します'
    case 'arrayObject':
    case 'arrayPrimitive':
      return `配列${source.arrayId}からStreamを生成し、index順に要素を送出します`
    case 'streamOf':
      return '引数の値を順にStream要素として送出します'
    case 'streamOfPrimitiveArrays':
      return `${source.primitive}[]を要素とするStreamを生成します`
    case 'nestedStringList':
      return `${source.listId}の各List要素を順に送出します`
    case 'generate':
      return 'Supplierを繰り返し呼び出す無限・unordered Streamです'
    case 'iterate2':
      return 'seedへoperatorを繰り返し適用する無限Streamです'
    case 'iterate3':
      return `seed ${source.seed} から候補を生成し、predicateがfalseになるまで送出します`
    case 'range':
      return `${source.from} <= n && n < ${source.to} を満たすint値を順に送出します（上端を含まない）`
    case 'rangeClosed':
      return `${source.from} <= n && n <= ${source.to} を満たすint値を順に送出します（上端を含む）`
    case 'empty':
      return '要素を1件も送出しない空のStreamです'
  }
}
