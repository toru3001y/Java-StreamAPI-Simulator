import type { PrimitiveName } from '../model/value'

/**
 * Source DSL（Phase 2指示 §7.1、Draft v0.8 §9.1）。
 * 任意関数・コード文字列ではなく識別可能Unionで表現する。
 * generate / 2引数iterateは表現・検証まで実装するが、有限化操作（Phase 3のlimit）が
 * ないため実行不能とし、PipelineDefinition生成前にUNBOUNDED_SOURCEとして拒否する（指示§6.1）。
 */

/** 許可済みgenerate rule ID（説明・コード生成用。Phase 2では実行不能） */
export const ALLOWED_GENERATE_RULES = ['supplier-counter'] as const

/** 許可済みiterate operator rule ID */
export const ALLOWED_ITERATE_OPERATORS = ['increment'] as const

export interface IterateOperator {
  readonly ruleId: 'increment'
  readonly step: number
}

/**
 * 3引数iterateのpredicate operator（単一定義源）。
 * v0.14 §4のproducer導出が「識別可能unionの実軸」としてこの集合を参照する。
 */
export const ITERATE_PREDICATE_OPERATORS = ['LTE', 'LT'] as const

export interface IteratePredicate {
  readonly operator: (typeof ITERATE_PREDICATE_OPERATORS)[number]
  readonly value: number
}

/**
 * `collection` sourceのcollection ID（Java変数名と一致させる）。
 *
 * Phase 8で`'employeesMergeDemo'`を**加算的に追加**した（指示§7.6。Phase 5のPredicate DSLへの
 * long定数加算的追加〔phase-5-decisions §13.7〕の前例に従い、既存`'employees'`の挙動・表示は不変）。
 *
 * **データ選択の単一定義源はFixtureScenarioProviderのdataset**であり、`collectionId`は
 * 検証・表示・Javaコード上の識別子である（`materializeSource`は外部から渡された
 * `employeeDataset`を具現化し、`collectionId`でデータを選択しない。この構造は変更しない）。
 * `collectionId`とtemplate / fixtureのdataset対応はP8-D20が機械検証する。
 */
export const SOURCE_COLLECTION_IDS = ['employees', 'employeesMergeDemo'] as const
export type SourceCollectionId = (typeof SOURCE_COLLECTION_IDS)[number]

export type SourceDsl =
  | { readonly kind: 'collection'; readonly collectionId: SourceCollectionId }
  | {
      readonly kind: 'arrayObject'
      readonly arrayId: string
      readonly elementTypeName: 'String'
      readonly values: readonly string[]
    }
  | {
      readonly kind: 'arrayPrimitive'
      readonly arrayId: string
      readonly primitive: PrimitiveName
      readonly values: readonly number[]
    }
  | {
      readonly kind: 'streamOf'
      readonly elementTypeName: 'String'
      readonly values: readonly string[]
    }
  | {
      readonly kind: 'streamOfPrimitiveArrays'
      readonly primitive: PrimitiveName
      readonly arrays: readonly (readonly number[])[]
    }
  | {
      readonly kind: 'nestedStringList'
      readonly listId: string
      readonly values: readonly (readonly string[])[]
    }
  | { readonly kind: 'generate'; readonly ruleId: string }
  | {
      readonly kind: 'iterate2'
      readonly seed: number
      readonly operator: IterateOperator
    }
  | {
      readonly kind: 'iterate3'
      readonly seed: number
      readonly predicate: IteratePredicate
      readonly operator: IterateOperator
    }
  | { readonly kind: 'range'; readonly from: number; readonly to: number }
  | { readonly kind: 'rangeClosed'; readonly from: number; readonly to: number }
  | {
      readonly kind: 'empty'
      readonly streamType: 'object' | PrimitiveName
      readonly elementTypeName: string
    }

export const SOURCE_DSL_KINDS = [
  'collection',
  'arrayObject',
  'arrayPrimitive',
  'streamOf',
  'streamOfPrimitiveArrays',
  'nestedStringList',
  'generate',
  'iterate2',
  'iterate3',
  'range',
  'rangeClosed',
  'empty',
] as const

/** 有限化操作なしでは実行できないsource kind（指示§6.1の境界） */
export const UNBOUNDED_SOURCE_KINDS: readonly SourceDsl['kind'][] = ['generate', 'iterate2']

/** sourceがorderedかどうか（§5.1） */
export function isOrderedSource(dsl: SourceDsl): boolean {
  return dsl.kind !== 'generate'
}
