import type { DepartmentValue, EmployeeValue } from './employee'
import type { TypeRef } from '../types/typeRef'

/**
 * Stream要素の実行時値モデル（Phase 2）。
 * Simulation Coreが扱う値は型付きのSimValueとして保持し、
 * TypeRef・表示ラベル・Javaリテラルを同じ値から導出する。
 */
export type SimValue =
  | { readonly kind: 'employee'; readonly value: EmployeeValue }
  | { readonly kind: 'department'; readonly value: DepartmentValue }
  | { readonly kind: 'localDate'; readonly value: string }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'int'; readonly value: number }
  | { readonly kind: 'long'; readonly value: number }
  | { readonly kind: 'double'; readonly value: number }
  | { readonly kind: 'boxedInt'; readonly value: number }
  | { readonly kind: 'boxedLong'; readonly value: number }
  | { readonly kind: 'boxedDouble'; readonly value: number }
  | { readonly kind: 'stringList'; readonly value: readonly string[] }
  /**
   * 合成List値（Phase 7指示 §7.2、v0.9 §6.3-1）。gatherのwindow系が生成する窓を表す。
   * 要素0件でも型が確定するよう`elementType`を自己保持する（復元契約の頑健性）。
   * 既存`stringList`は**不変のまま並存**させる（既存経路の表示・型・テストを変えないため）。
   */
  | { readonly kind: 'list'; readonly elementType: TypeRef; readonly value: readonly SimValue[] }
  | { readonly kind: 'intArray'; readonly value: readonly number[] }
  | { readonly kind: 'longArray'; readonly value: readonly number[] }
  | { readonly kind: 'doubleArray'; readonly value: readonly number[] }

/**
 * `SimValue`の全variant（kind）の単一定義源（v0.14 §4の値variant網羅性）。
 *
 * 非null不変条件の機械検証は、この定数から意味値検査器の定義漏れを検出する。
 * `satisfies`により**新しいvariantを`SimValue`へ追加してここへ足し忘れると型エラー**になり、
 * 逆に存在しないkindを書いても型エラーになる（下の`_AllSimValueKindsCovered`が
 * 網羅の欠落を検出する）。
 */
export const SIM_VALUE_KINDS = [
  'employee',
  'department',
  'localDate',
  'string',
  'int',
  'long',
  'double',
  'boxedInt',
  'boxedLong',
  'boxedDouble',
  'stringList',
  'list',
  'intArray',
  'longArray',
  'doubleArray',
] as const satisfies readonly SimValue['kind'][]

export type SimValueKind = (typeof SIM_VALUE_KINDS)[number]

/** `SIM_VALUE_KINDS`が`SimValue`の全variantを覆っていることの型レベル検証 */
type _AllSimValueKindsCovered =
  Exclude<SimValue['kind'], SimValueKind> extends never ? true : never
const _allSimValueKindsCovered: _AllSimValueKindsCovered = true
void _allSimValueKindsCovered

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
    case 'department':
      // Java recordのtoString表現に合わせる
      return `Department[name=${v.value.name}, division=${v.value.division}]`
    case 'localDate':
      // LocalDate.toString（ISO-8601）に合わせる
      return v.value
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
    case 'list':
      // 要素を再帰整形する（Employeeは`佐藤（age=35）`、Stringは`"Java"`等の既存ラベル）
      return `[${v.value.map(formatSimValue).join(', ')}]`
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
    case 'department':
      return { kind: 'object', name: 'Department' }
    case 'localDate':
      return { kind: 'object', name: 'LocalDate' }
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
    case 'list':
      // 要素0件でも型が確定するよう、値が自己保持するelementTypeを使う（§7.2）
      return { kind: 'collection', container: 'List', elementType: v.elementType }
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
