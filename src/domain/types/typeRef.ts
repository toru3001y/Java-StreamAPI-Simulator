/**
 * TypeRef（Draft v0.8 §6.3）。
 * 型は表示文字列ではなく構造化して保持する。
 * 型検証、Pipeline型遷移、結果ビュー選択、Javaコード生成は同じTypeRefを参照する。
 */
export type TypeRef =
  | { readonly kind: 'object'; readonly name: string }
  | { readonly kind: 'primitive'; readonly name: 'int' | 'long' | 'double' | 'boolean' }
  | { readonly kind: 'stream'; readonly elementType: TypeRef }
  | {
      readonly kind: 'primitiveStream'
      readonly name: 'IntStream' | 'LongStream' | 'DoubleStream'
    }
  | { readonly kind: 'optional'; readonly elementType: TypeRef }
  | {
      readonly kind: 'primitiveOptional'
      readonly name: 'OptionalInt' | 'OptionalLong' | 'OptionalDouble'
    }
  | {
      readonly kind: 'collection'
      readonly container: 'List' | 'Set'
      readonly elementType: TypeRef
    }
  | { readonly kind: 'map'; readonly keyType: TypeRef; readonly valueType: TypeRef }
  | { readonly kind: 'array'; readonly elementType: TypeRef }
  | { readonly kind: 'statistics'; readonly name: string }
  | { readonly kind: 'void' }

export const TYPE_EMPLOYEE: TypeRef = { kind: 'object', name: 'Employee' }
export const TYPE_DEPARTMENT: TypeRef = { kind: 'object', name: 'Department' }
export const TYPE_INT: TypeRef = { kind: 'primitive', name: 'int' }
export const TYPE_STRING: TypeRef = { kind: 'object', name: 'String' }

export function streamOf(elementType: TypeRef): TypeRef {
  return { kind: 'stream', elementType }
}

export function listOf(elementType: TypeRef): TypeRef {
  return { kind: 'collection', container: 'List', elementType }
}

/** Java表示用の型ラベルを導出する。 */
export function formatTypeRef(t: TypeRef): string {
  switch (t.kind) {
    case 'object':
      return t.name
    case 'primitive':
      return t.name
    case 'stream':
      return `Stream<${formatTypeRef(t.elementType)}>`
    case 'primitiveStream':
      return t.name
    case 'optional':
      return `Optional<${formatTypeRef(t.elementType)}>`
    case 'primitiveOptional':
      return t.name
    case 'collection':
      return `${t.container}<${formatTypeRef(t.elementType)}>`
    case 'map':
      return `Map<${formatTypeRef(t.keyType)}, ${formatTypeRef(t.valueType)}>`
    case 'array':
      return `${formatTypeRef(t.elementType)}[]`
    case 'statistics':
      return t.name
    case 'void':
      return 'void'
  }
}

export function typeRefEquals(a: TypeRef, b: TypeRef): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'object':
      return b.kind === 'object' && a.name === b.name
    case 'primitive':
      return b.kind === 'primitive' && a.name === b.name
    case 'stream':
      return b.kind === 'stream' && typeRefEquals(a.elementType, b.elementType)
    case 'primitiveStream':
      return b.kind === 'primitiveStream' && a.name === b.name
    case 'optional':
      return b.kind === 'optional' && typeRefEquals(a.elementType, b.elementType)
    case 'primitiveOptional':
      return b.kind === 'primitiveOptional' && a.name === b.name
    case 'collection':
      return (
        b.kind === 'collection' &&
        a.container === b.container &&
        typeRefEquals(a.elementType, b.elementType)
      )
    case 'map':
      return (
        b.kind === 'map' &&
        typeRefEquals(a.keyType, b.keyType) &&
        typeRefEquals(a.valueType, b.valueType)
      )
    case 'array':
      return b.kind === 'array' && typeRefEquals(a.elementType, b.elementType)
    case 'statistics':
      return b.kind === 'statistics' && a.name === b.name
    case 'void':
      return b.kind === 'void'
  }
}
