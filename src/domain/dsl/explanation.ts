import type { DslPredicate } from './ast'
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
