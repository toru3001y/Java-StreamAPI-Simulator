import type { Result } from '../types/result'
import { fail, issue, ok } from '../types/result'
import type { ConsumerDsl } from './consumerAst'
import { CONSUMER_ALLOWED_FIELDS, CONSUMER_DSL_KINDS } from './consumerAst'

/**
 * Consumer DSLの構造検証（Phase 3指示 §6.5）。
 * 未知kind、許可外field、任意コード文字列を拒否する。
 */
export function validateConsumerStructure(input: unknown, path = 'consumer'): Result<ConsumerDsl> {
  if (typeof input !== 'object' || input === null) {
    return fail([issue('STRUCTURE_INVALID', 'consumerはオブジェクトが必要です', path)])
  }
  const obj = input as Record<string, unknown>
  const kind = obj['kind']
  if (!(CONSUMER_DSL_KINDS as readonly string[]).includes(String(kind))) {
    return fail([
      issue('STRUCTURE_UNKNOWN_KIND', `未知のconsumer kindです: ${String(kind)}`, `${path}.kind`),
    ])
  }
  if (kind === 'printField') {
    if (!(CONSUMER_ALLOWED_FIELDS as readonly string[]).includes(String(obj['field']))) {
      return fail([
        issue(
          'WHITELIST_FIELD',
          `PRINT_FIELDで許可されていないfieldです: ${String(obj['field'])}`,
          `${path}.field`,
        ),
      ])
    }
  }
  return ok(input as ConsumerDsl)
}

/**
 * limit / skip引数の検証（Phase 3指示 §6.4）。
 * Number.isSafeInteger、0以上を要求し、負数・小数・NaN・Infinity・safe integer外を
 * PipelineDefinition生成前に拒否する。Java APIの引数型はlongである。
 */
export function validateCount(input: unknown, path = 'count'): Result<number> {
  if (typeof input !== 'number' || !Number.isSafeInteger(input)) {
    return fail([
      issue(
        'TYPE_MISMATCH',
        `limit / skipの引数はsafe integer範囲の整数が必要です（Java APIの引数型はlong）: ${String(input)}`,
        path,
      ),
    ])
  }
  if (input < 0) {
    return fail([
      issue(
        'TYPE_MISMATCH',
        `limit / skipの引数は0以上が必要です（Java APIの引数型はlong）: ${input}`,
        path,
      ),
    ])
  }
  return ok(input)
}
