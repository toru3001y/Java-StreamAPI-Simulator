import type { EmployeeValue } from './employee'
import type { TypeRef } from '../types/typeRef'

/**
 * Stream要素の実行時値モデル（Phase 2）。
 * Simulation Coreが扱う値は型付きのSimValueとして保持し、
 * TypeRef・表示ラベル・Javaリテラルを同じ値から導出する。
 */
export type SimValue =
  | { readonly kind: 'employee'; readonly value: EmployeeValue }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'int'; readonly value: number }
  | { readonly kind: 'long'; readonly value: number }
  | { readonly kind: 'double'; readonly value: number }
  | { readonly kind: 'boxedInt'; readonly value: number }
  | { readonly kind: 'boxedLong'; readonly value: number }
  | { readonly kind: 'boxedDouble'; readonly value: number }
  | { readonly kind: 'stringList'; readonly value: readonly string[] }
  | { readonly kind: 'intArray'; readonly value: readonly number[] }
  | { readonly kind: 'longArray'; readonly value: readonly number[] }
  | { readonly kind: 'doubleArray'; readonly value: readonly number[] }

export function formatDoubleLiteral(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : String(n)
}

export function formatLongLiteral(n: number): string {
  const negative = n < 0
  const digits = String(Math.abs(n))
  let grouped = ''
  for (let i = 0; i < digits.length; i++) {
    const posFromEnd = digits.length - i
    grouped += digits[i]
    if (posFromEnd > 1 && (posFromEnd - 1) % 3 === 0) grouped += '_'
  }
  return `${negative ? '-' : ''}${grouped}L`
}

/** 入力・出力パネル等の表示ラベル */
export function formatSimValue(v: SimValue): string {
  switch (v.kind) {
    case 'employee':
      return `${v.value.name}（age=${v.value.age}）`
    case 'string':
      return `"${v.value}"`
    case 'int':
    case 'boxedInt':
      return String(v.value)
    case 'long':
    case 'boxedLong':
      return formatLongLiteral(v.value)
    case 'double':
    case 'boxedDouble':
      return formatDoubleLiteral(v.value)
    case 'stringList':
      return `[${v.value.join(', ')}]`
    case 'intArray':
      return `int[]{${v.value.join(', ')}}`
    case 'longArray':
      return `long[]{${v.value.map((n) => `${n}L`).join(', ')}}`
    case 'doubleArray':
      return `double[]{${v.value.map(formatDoubleLiteral).join(', ')}}`
  }
}

/** 値の静的型（TypeRef） */
export function typeOfSimValue(v: SimValue): TypeRef {
  switch (v.kind) {
    case 'employee':
      return { kind: 'object', name: 'Employee' }
    case 'string':
      return { kind: 'object', name: 'String' }
    case 'int':
      return { kind: 'primitive', name: 'int' }
    case 'long':
      return { kind: 'primitive', name: 'long' }
    case 'double':
      return { kind: 'primitive', name: 'double' }
    case 'boxedInt':
      return { kind: 'object', name: 'Integer' }
    case 'boxedLong':
      return { kind: 'object', name: 'Long' }
    case 'boxedDouble':
      return { kind: 'object', name: 'Double' }
    case 'stringList':
      return {
        kind: 'collection',
        container: 'List',
        elementType: { kind: 'object', name: 'String' },
      }
    case 'intArray':
      return { kind: 'array', elementType: { kind: 'primitive', name: 'int' } }
    case 'longArray':
      return { kind: 'array', elementType: { kind: 'primitive', name: 'long' } }
    case 'doubleArray':
      return { kind: 'array', elementType: { kind: 'primitive', name: 'double' } }
  }
}

export type PrimitiveName = 'int' | 'long' | 'double'

export const WRAPPER_NAMES: Readonly<Record<PrimitiveName, string>> = {
  int: 'Integer',
  long: 'Long',
  double: 'Double',
}

export const PRIMITIVE_STREAM_NAMES: Readonly<
  Record<PrimitiveName, 'IntStream' | 'LongStream' | 'DoubleStream'>
> = {
  int: 'IntStream',
  long: 'LongStream',
  double: 'DoubleStream',
}
