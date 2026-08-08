import type { MapperDsl } from './mapperAst'
import type { SimValue } from '../model/value'

/**
 * 検証済みMapper DSLの安全な評価（Phase 2指示 §7.2）。
 * eval / new Function / 動的コード生成は使用しない。
 */
export function evaluateMapper(mapper: MapperDsl, input: SimValue): SimValue {
  switch (mapper.kind) {
    case 'fieldAccess': {
      if (input.kind !== 'employee') throw new Error('fieldAccessはEmployee要素が必要です')
      const e = input.value
      switch (mapper.field) {
        case 'name':
          return { kind: 'string', value: e.name }
        case 'region':
          return { kind: 'string', value: e.region }
        case 'age':
          return { kind: 'boxedInt', value: e.age }
        case 'salary':
          return { kind: 'boxedLong', value: e.salary }
        case 'evaluation':
          return { kind: 'boxedDouble', value: e.evaluation }
        case 'skills':
          return { kind: 'stringList', value: e.skills }
        default:
          throw new Error(`評価未対応のfieldです: ${mapper.field}`)
      }
    }
    case 'toUpper':
      if (input.kind !== 'string') throw new Error('toUpperはString要素が必要です')
      return { kind: 'string', value: input.value.toUpperCase() }
    case 'prefix': {
      if (input.kind !== 'int' && input.kind !== 'long' && input.kind !== 'double') {
        throw new Error('prefixはprimitive要素が必要です')
      }
      return { kind: 'string', value: `${mapper.prefix}${input.value}` }
    }
    case 'fieldToPrimitive': {
      if (input.kind !== 'employee') throw new Error('fieldToPrimitiveはEmployee要素が必要です')
      const e = input.value
      switch (mapper.field) {
        case 'age':
          return { kind: 'int', value: e.age }
        case 'salary':
          return { kind: 'long', value: e.salary }
        case 'evaluation':
          return { kind: 'double', value: e.evaluation }
        default:
          throw new Error(`評価未対応のfieldです: ${mapper.field}`)
      }
    }
    case 'listStream':
    case 'arrayStream':
      throw new Error('flatMap系mapperはevaluateFlatMapperで評価してください')
  }
}

/** flatMap系mapper: 1要素からmapped Streamの子要素列を得る */
export function evaluateFlatMapper(mapper: MapperDsl, input: SimValue): readonly SimValue[] {
  switch (mapper.kind) {
    case 'listStream':
      if (input.kind !== 'stringList') throw new Error('listStreamはList<String>要素が必要です')
      return input.value.map((s) => ({ kind: 'string', value: s }))
    case 'arrayStream': {
      if (input.kind === 'intArray' && mapper.primitive === 'int') {
        return input.value.map((n) => ({ kind: 'int', value: n }))
      }
      if (input.kind === 'longArray' && mapper.primitive === 'long') {
        return input.value.map((n) => ({ kind: 'long', value: n }))
      }
      if (input.kind === 'doubleArray' && mapper.primitive === 'double') {
        return input.value.map((n) => ({ kind: 'double', value: n }))
      }
      throw new Error(`arrayStream(${mapper.primitive})へ${input.kind}は適用できません`)
    }
    default:
      throw new Error(`flatMap系ではないmapperです: ${mapper.kind}`)
  }
}
