import type { ReductionIdentity } from './terminalAst'

/**
 * Phase 7 Gatherer DSL（Phase 7指示 §7.4、v0.9 §8.1・§8.2）。
 * `Stream.gather(Gatherer)`へ渡す組み込みGathererを型付きの識別可能Unionで表現する。
 * 任意Javaコード文字列・関数本文文字列・カスタムGathererは受け付けない（v0.9 §2.2）。
 * Gatherer DSLに再帰（入れ子）はない（v0.9 §8冒頭）。
 */

/**
 * Gatherer専用の累積規則（v0.9 §8.2）。
 * 既存Terminal DSLの`ReductionDsl`と同形式だが、**別のUnionとして新設**する。
 * 共有DSLへのfield追加はPhase 4 Terminal DSLの許可範囲を変えてしまうため
 * （v0.9 §1.2「完了済みPhaseの契約は変更しない」）。
 * Phase 5がCollector専用のfieldホワイトリストを新設した前例に従う。
 */
export type GatherAccumulationRule =
  | { readonly kind: 'numericSum' }
  | { readonly kind: 'stringConcat' }
  | {
      readonly kind: 'employeeFieldSum'
      /** Gatherer専用の許可済みfield加算（Terminal DSLより1件多い） */
      readonly field: 'age' | 'salary' | 'evaluation'
    }

export const GATHER_ACCUMULATION_KINDS = ['numericSum', 'stringConcat', 'employeeFieldSum'] as const

/**
 * Gatherer専用のfieldホワイトリスト（v0.9 §8.2で確定）。
 * 既存の`REDUCTION_FIELD_WHITELIST`（`['salary', 'age']`）は**変更しない**。
 */
export const GATHER_FIELD_WHITELIST = ['age', 'salary', 'evaluation'] as const

/** fieldに対応するprimitive型（v0.9 §8.3の型適合表） */
export const GATHER_FIELD_PRIMITIVE: Readonly<
  Record<(typeof GATHER_FIELD_WHITELIST)[number], 'int' | 'long' | 'double'>
> = {
  age: 'int',
  salary: 'long',
  evaluation: 'double',
}

/**
 * windowSizeの境界（v0.9 §8.2）。
 * - 1未満: JDK実仕様の`IllegalArgumentException`に対応し`STRUCTURE_INVALID`
 * - 16超: 教材上の固定安全上限として`GATHER_SIZE_LIMIT`（教材上限専用code）
 *   根拠: 公式API Note「windows may be allocated contiguously and eagerly」（v0.9 §3.2）と
 *   教材データ規模・画面表示の可読性。500 snapshot予算の事前検証も従来どおり併用する。
 */
export const GATHER_WINDOW_SIZE_MIN = 1
export const GATHER_WINDOW_SIZE_MAX = 16

/**
 * 組み込みGatherer（v0.9 §2.1の4種）。
 * `mapConcurrent`は対象外（v0.9 §2.2。存在と対象外理由は補助説明でのみ扱う）。
 */
export type GathererDsl =
  | { readonly kind: 'windowFixed'; readonly size: number }
  | { readonly kind: 'windowSliding'; readonly size: number }
  | {
      readonly kind: 'scan'
      readonly initial: ReductionIdentity
      readonly accumulation: GatherAccumulationRule
    }
  | {
      readonly kind: 'fold'
      readonly initial: ReductionIdentity
      readonly accumulation: GatherAccumulationRule
    }

export const GATHERER_DSL_KINDS = ['windowFixed', 'windowSliding', 'scan', 'fold'] as const

export type GathererKind = (typeof GATHERER_DSL_KINDS)[number]

/** 窓を束ねるGatherer（出力要素型が`List<T>`になる） */
export type WindowGathererDsl = Extract<GathererDsl, { kind: 'windowFixed' | 'windowSliding' }>

/** 初期値から累積するGatherer（scan / fold）。出力要素型はboxed型 */
export type AccumulatingGathererDsl = Extract<GathererDsl, { kind: 'scan' | 'fold' }>

export function isWindowGatherer(dsl: GathererDsl): dsl is WindowGathererDsl {
  return dsl.kind === 'windowFixed' || dsl.kind === 'windowSliding'
}

/**
 * 終端で追加産出があり得るGatherer（v0.9 §6.1の`GATHER_FINISHED`統一発行規則）。
 * scanは「入力要素ごとに産出」（v0.9 §3.2）のため終端産出が定義上なく、発行しない。
 */
export function emitsGatherFinished(dsl: GathererDsl): boolean {
  return dsl.kind !== 'scan'
}
