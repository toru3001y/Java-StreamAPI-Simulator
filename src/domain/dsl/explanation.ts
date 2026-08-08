import type { DslPredicate } from './ast'
import type { MapperDsl } from './mapperAst'
import type { SourceDsl } from './sourceAst'
import { EMPLOYEE_FIELDS } from '../model/employee'

/**
 * 検証済みDSL / ASTからの自然文説明生成（§9.1）。
 * DSLと同じfield・operator・値を説明へ反映する（P1-D09）。
 */
const OPERATOR_TEXT: Readonly<Record<string, string>> = {
  GTE: '以上',
}

/** 例: 「ageが30以上かを判定します」 */
export function describePredicate(predicate: DslPredicate): string {
  const opText = OPERATOR_TEXT[predicate.operator]
  if (!opText) throw new Error(`unsupported operator: ${predicate.operator}`)
  if (predicate.value.type !== 'int') {
    throw new Error(`unsupported literal type: ${predicate.value.type}`)
  }
  return `${predicate.field}が${predicate.value.value}${opText}かを判定します`
}

/** 例: 「35 >= 30」（比較の実値表示、ASCII構文） */
export function comparisonExpr(predicate: DslPredicate, fieldValue: number): string {
  if (predicate.operator !== 'GTE') throw new Error(`unsupported operator: ${predicate.operator}`)
  if (predicate.value.type !== 'int') {
    throw new Error(`unsupported literal type: ${predicate.value.type}`)
  }
  return `${fieldValue} >= ${predicate.value.value}`
}

/** 例: 「佐藤.age() → 35」（値遷移はUnicode矢印、§17.4） */
export function fieldValueFlow(
  predicate: DslPredicate,
  elementName: string,
  fieldValue: number,
): string {
  const accessor = EMPLOYEE_FIELDS[predicate.field]?.accessor ?? `${predicate.field}()`
  return `${elementName}.${accessor} → ${fieldValue}`
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
