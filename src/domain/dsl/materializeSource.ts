import type { SourceDsl } from './sourceAst'
import type { SimValue } from '../model/value'
import type { DatasetElement } from '../model/employee'
import type { ElementId } from '../types/ids'

/**
 * Source DSLから送出要素列を決定的に具現化する（Phase 2指示 §8.2、§9.1）。
 * 要素には履歴復元可能な安定IDを付け、同値要素もIDで区別する。
 * generate / 2引数iterateは具現化対象外（事前にUNBOUNDED_SOURCEとして拒否される）。
 */
export interface SourceElement {
  readonly elementId: ElementId
  readonly index: number
  readonly value: SimValue
}

/** iterate 3引数の候補判定トレース（最後のfalse候補を含む） */
export interface IterateCandidate {
  readonly value: number
  readonly passed: boolean
}

export interface MaterializedSource {
  readonly elements: readonly SourceElement[]
  readonly iterateTrace: readonly IterateCandidate[] | null
}

function seq(prefix: string, values: readonly SimValue[]): SourceElement[] {
  return values.map((value, index) => ({
    elementId: `${prefix}-${String(index + 1).padStart(3, '0')}`,
    index,
    value,
  }))
}

export function evaluateIteratePredicate(
  predicate: { readonly operator: 'LTE' | 'LT'; readonly value: number },
  candidate: number,
): boolean {
  return predicate.operator === 'LTE' ? candidate <= predicate.value : candidate < predicate.value
}

const ITERATE_SAFETY_CAP = 10_000

export function materializeSource(
  dsl: SourceDsl,
  employeeDataset: readonly DatasetElement[],
): MaterializedSource {
  switch (dsl.kind) {
    case 'collection':
      return {
        elements: employeeDataset.map((d, index) => ({
          elementId: d.elementId,
          index,
          value: { kind: 'employee', value: d.value },
        })),
        iterateTrace: null,
      }
    case 'arrayObject':
      return {
        elements: seq(dsl.arrayId, dsl.values.map((s) => ({ kind: 'string', value: s }))),
        iterateTrace: null,
      }
    case 'arrayPrimitive':
      return {
        elements: seq(
          dsl.arrayId,
          dsl.values.map((n) => ({ kind: dsl.primitive, value: n }) as SimValue),
        ),
        iterateTrace: null,
      }
    case 'streamOf':
      return {
        elements: seq('of', dsl.values.map((s) => ({ kind: 'string', value: s }))),
        iterateTrace: null,
      }
    case 'streamOfPrimitiveArrays': {
      const arrayKind =
        dsl.primitive === 'int' ? 'intArray' : dsl.primitive === 'long' ? 'longArray' : 'doubleArray'
      return {
        elements: seq(
          'arr',
          dsl.arrays.map((a) => ({ kind: arrayKind, value: a }) as SimValue),
        ),
        iterateTrace: null,
      }
    }
    case 'nestedStringList':
      return {
        elements: seq(dsl.listId, dsl.values.map((v) => ({ kind: 'stringList', value: v }))),
        iterateTrace: null,
      }
    case 'iterate3': {
      const trace: IterateCandidate[] = []
      const values: SimValue[] = []
      let candidate = dsl.seed
      for (let i = 0; i < ITERATE_SAFETY_CAP; i++) {
        const passed = evaluateIteratePredicate(dsl.predicate, candidate)
        trace.push({ value: candidate, passed })
        if (!passed) break
        values.push({ kind: 'boxedInt', value: candidate })
        candidate += dsl.operator.step
      }
      return { elements: seq('it', values), iterateTrace: trace }
    }
    case 'range': {
      const values: SimValue[] = []
      for (let n = dsl.from; n < dsl.to; n++) values.push({ kind: 'int', value: n })
      return { elements: seq('n', values), iterateTrace: null }
    }
    case 'rangeClosed': {
      const values: SimValue[] = []
      for (let n = dsl.from; n <= dsl.to; n++) values.push({ kind: 'int', value: n })
      return { elements: seq('n', values), iterateTrace: null }
    }
    case 'empty':
      return { elements: [], iterateTrace: null }
    case 'generate':
    case 'iterate2':
      throw new Error(`無限source ${dsl.kind} は具現化できません（UNBOUNDED_SOURCE）`)
  }
}
