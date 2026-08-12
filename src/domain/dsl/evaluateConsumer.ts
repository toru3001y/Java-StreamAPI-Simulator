import type { ConsumerDsl } from './consumerAst'
import type { SimValue } from '../model/value'
import { assertNotCompositeList } from '../types/invariantError'
import { formatDoubleLiteral, formatSimValue } from '../model/value'

/**
 * 検証済みConsumer DSLの安全な評価（Phase 3指示 §6.5）。
 * peekのSide Effect表示メッセージを生成する。値・型は変更しない。
 * 実ブラウザconsoleへの出力をSource of Truthにしない。
 */
export function evaluateConsumerMessage(consumer: ConsumerDsl, value: SimValue): string {
  assertNotCompositeList(value, 'Consumer評価')
  if (consumer.kind === 'printValue') {
    return formatSimValue(value)
  }
  if (value.kind !== 'employee') {
    throw new Error('PRINT_FIELDはEmployee要素が必要です')
  }
  const e = value.value
  switch (consumer.field) {
    case 'name':
      return e.name
    case 'age':
      return String(e.age)
    case 'salary':
      return String(e.salary)
    case 'evaluation':
      return formatDoubleLiteral(e.evaluation)
    case 'region':
      return e.region
    case 'hireDate':
      return e.hireDate
    default:
      throw new Error(`評価未対応のfieldです: ${consumer.field}`)
  }
}
