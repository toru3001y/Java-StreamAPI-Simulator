import type { ScenarioMode } from '../src/domain/scenario/scenario'
import type { Snapshot, TerminalResultView } from '../src/domain/engine/snapshot'
import { makeDefinition, runAllSnapshots } from './helpers'
import { runLocalCollector, toMap4, NAME_KEY, SALARY_VALUE } from './p8-helpers'
import { STANDARD_EMPLOYEES } from '../src/domain/fixtures/employees'

/**
 * P8-O01の期待値をSimulation Coreから導出する（Phase 8指示 §12.5）。
 *
 * §8.2の10ケース（standard 8 + emptySource 2）とpartitioningBy空partitionの追加照合を、
 * 固定Java 25コード（oracle/OracleP8.java）と**JSON文字列厳密照合**する。
 *
 * 照合方式（Phase 5〜7で確立した方式の踏襲。指示§12.5）:
 * - **順序保証のないMap**（2・3引数版toMap・groupingBy）はキーの表示文字列の**辞書順へ正規化**して
 *   から比較する。返却Mapのentry反復順序はJDKの保証対象外であり、照合契約にしない
 *   （正規化は比較のためだけであり、iteration order保証を意味しない）。
 * - **TreeMap（4引数版）だけは実entry順**をそのまま保持して厳密比較する（順序自体が検証対象）。
 * - **encounter order・mergeの適用順は反復順ではなく結果値で検証する**:
 *   first / lastの結果差（伊藤 / 山本）が「(既存値, 新しい値)」の適用順を、
 *   concatの連結順（`伊藤, 渡辺, 山本`）が順次適用のencounter orderを実証する。
 * - **2引数版の重複キーは例外型のみ**を契約とする（メッセージ全文はOBSERVATIONで観測記録）。
 * - 値の表記はSimulation Coreの`formatSimValue` / `formatLongLiteral`表記へ両側で揃える
 *   （Employee要素は`氏名（age=NN）`、String値はクォート付き、longは3桁区切り + L）。
 */

function lastSnapshotOf(templateId: string, mode: ScenarioMode): Snapshot {
  const snapshots = runAllSnapshots(makeDefinition(templateId, mode))
  const last = snapshots[snapshots.length - 1]
  if (!last) throw new Error(`snapshotがありません: ${templateId}:${mode}`)
  return last
}

function mapResultOf(templateId: string, mode: ScenarioMode): Extract<TerminalResultView, { kind: 'MAP' }> {
  const result = lastSnapshotOf(templateId, mode).output.result
  if (!result || result.kind !== 'MAP') {
    throw new Error(`MAP結果ではありません: ${templateId}:${mode} (${result?.kind})`)
  }
  return result
}

/** Map entryを`key=value`の文字列列にする（値はSCALAR / COLLECTION / MAPに対応） */
function entryPairs(result: Extract<TerminalResultView, { kind: 'MAP' }>): string[] {
  return result.entries.map((entry) => `${entry.keyLabel}=${nestedLabel(entry.value)}`)
}

function nestedLabel(value: TerminalResultView): string {
  switch (value.kind) {
    case 'SCALAR':
      return value.valueLabel
    case 'COLLECTION':
      return `[${value.items.map((i) => i.label).join(', ')}]`
    case 'MAP':
      return `{${sortPairs(entryPairs(value)).join(', ')}}`
    default:
      throw new Error(`Oracle照合で未対応の値種別です: ${value.kind}`)
  }
}

/** 順序保証のないMapの比較正規化（キーの表示文字列の辞書順） */
function sortPairs(pairs: readonly string[]): string[] {
  return [...pairs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** 順序保証のないMap: 正規化して比較する */
function normalizedEntries(templateId: string, mode: ScenarioMode): string[] {
  return sortPairs(entryPairs(mapResultOf(templateId, mode)))
}

/** TreeMap: 実entry順のまま比較する（順序自体が検証対象） */
function orderedEntries(templateId: string, mode: ScenarioMode): string[] {
  return entryPairs(mapResultOf(templateId, mode))
}

/** COLLECTION結果の要素ラベル列（v0.14 unmodifiable List / Set。表示順はview確定順のまま） */
function collectionLabels(templateId: string, mode: ScenarioMode): string[] {
  const result = lastSnapshotOf(templateId, mode).output.result
  if (!result || result.kind !== 'COLLECTION') {
    throw new Error(`COLLECTION結果ではありません: ${templateId}:${mode} (${result?.kind})`)
  }
  return result.items.map((item) => item.label)
}

/** teeing merger結果record（v0.12 teeing×toMap。fieldのvalueLabelを名前で引く） */
function recordFieldsOf(templateId: string, mode: ScenarioMode): Record<string, string> {
  const result = lastSnapshotOf(templateId, mode).output.result
  if (!result || result.kind !== 'RECORD') {
    throw new Error(`RECORD結果ではありません: ${templateId}:${mode} (${result?.kind})`)
  }
  return Object.fromEntries(result.fields.map((f) => [f.name, f.valueLabel]))
}

/** 実行失敗ケース（例外型のみを契約とする） */
function failureOf(templateId: string): {
  exceptionType: string
  duplicateKey: string
  existingValue: string
  incomingValue: string
} {
  const snapshots = runAllSnapshots(makeDefinition(templateId, 'standard'))
  const last = snapshots[snapshots.length - 1]
  if (!last || last.kind !== 'COLLECT_FAILED' || !last.executionFailure) {
    throw new Error(`COLLECT_FAILEDで終端していません: ${templateId}`)
  }
  const failure = last.executionFailure
  return {
    exceptionType: failure.exceptionType,
    duplicateKey: failure.duplicateKeyLabel,
    existingValue: failure.existingValueLabel,
    incomingValue: failure.incomingValueLabel,
  }
}

/** partitioningBy配下の4引数版toMap（空partitionの追加照合。v0.11 §3.3・§7） */
function partitioningByEmptyPartition(): { falsePartition: string[]; truePartition: string[] } {
  const { snapshots } = runLocalCollector(
    'oracle-p8-partition-treemap',
    ['partitioningBy', 'toMap'],
    {
      kind: 'partitioningBy',
      predicate: {
        kind: 'fieldCompare',
        field: 'age',
        operator: 'GTE',
        value: { type: 'int', value: 0 },
      },
      downstream: toMap4('first', NAME_KEY, SALARY_VALUE),
    },
    STANDARD_EMPLOYEES,
  )
  const last = snapshots[snapshots.length - 1]
  const result = last?.output.result
  if (!result || result.kind !== 'MAP') throw new Error('partitioningByのMAP結果がありません')
  const byKey = new Map(result.entries.map((e) => [e.keyLabel, e.value]))
  const toPairs = (value: TerminalResultView | undefined): string[] => {
    if (!value || value.kind !== 'MAP') throw new Error('partition値がMAPではありません')
    // downstreamはTreeMapのため実entry順のまま
    return entryPairs(value)
  }
  return {
    falsePartition: toPairs(byKey.get('false')),
    truePartition: toPairs(byKey.get('true')),
  }
}

export function buildP8ExpectedFromCore(): Record<string, unknown> {
  const failure = failureOf('tmpl-collect-tomap-duplicate')
  const partition = partitioningByEmptyPartition()
  const teeingToMap = recordFieldsOf('tmpl-collect-teeing-tomap', 'standard')
  return {
    // ---- §8.2 #1 / #2: 2引数版・value側identity（順序保証なし → 正規化） ----
    identity: normalizedEntries('tmpl-collect-tomap-identity', 'standard'),
    identityEmpty: normalizedEntries('tmpl-collect-tomap-identity', 'emptySource'),
    // ---- §8.2 #3: 2引数版・重複キー（例外型のみ照合） ----
    duplicateExceptionType: failure.exceptionType,
    duplicateKey: failure.duplicateKey,
    duplicateExistingValue: failure.existingValue,
    duplicateIncomingValue: failure.incomingValue,
    // ---- §8.2 #4 / #5 / #6: 3引数版merge（同一データ・同一keyMapper。結果値で適用順を検証） ----
    mergeFirst: normalizedEntries('tmpl-collect-tomap-merge-first', 'standard'),
    mergeLast: normalizedEntries('tmpl-collect-tomap-merge-last', 'standard'),
    mergeConcat: normalizedEntries('tmpl-collect-tomap-merge-concat', 'standard'),
    // ---- §8.2 #10: 同一データのgroupingBy比較（1キー多値） ----
    groupingByMergeDemo: normalizedEntries('tmpl-collect-groupby-mergedemo', 'standard'),
    // ---- §8.2 #7 / #8: 4引数版TreeMap（実entry順のまま厳密比較） ----
    treeMapOrdered: orderedEntries('tmpl-collect-tomap-treemap', 'standard'),
    treeMapEmpty: orderedEntries('tmpl-collect-tomap-treemap', 'emptySource'),
    // ---- §8.2 #9: downstream形（bucketごとの独立蓄積・nested Map） ----
    groupedToMap: normalizedEntries('tmpl-collect-tomap-grouped', 'standard'),
    // ---- 追加照合: partitioningBy配下の4引数版（要素0件のpartitionも空TreeMapが値になる） ----
    partitionFalseEmpty: partition.falsePartition,
    partitionTrue: partition.truePartition,
    // ---- v0.12: teeing branchへのtoMap配置（左=TreeMapのため実entry順のまま・右=counting） ----
    teeingToMapByRegion: teeingToMap['byRegion'],
    teeingToMapCount: teeingToMap['count'],
    // ---- v0.13: 数値加算merge（sum系。順序保証なし → 正規化。doubleは素朴加算のため照合可能） ----
    toMapSumIntByRegion: normalizedEntries('tmpl-collect-tomap-merge-sumint', 'standard'),
    toMapSumLongByRegion: normalizedEntries('tmpl-collect-tomap-merge-sumlong', 'standard'),
    toMapSumDoubleByRegion: normalizedEntries('tmpl-collect-tomap-merge-sumdouble', 'standard'),
    // ---- v0.14: unmodifiable系の結果3キー（**Core実走行から導出する値**。§5.3） ----
    // Listはencounter orderのまま、Set / Mapは表示文字列の辞書順へ正規化する
    // （返却コンテナのiteration orderはJDKの保証対象外であり照合契約にしない）
    unmodifiableList: collectionLabels('tmpl-collect-tounmod-list', 'standard'),
    unmodifiableSet: [...collectionLabels('tmpl-collect-tounmod-set', 'standard')].sort(),
    unmodifiableMapMergeFirst: normalizedEntries('tmpl-collect-tounmod-map', 'standard'),
    // ---- v0.14: UnsupportedOperationException契約3キー（**仕様由来の固定リテラル**。§5.3） ----
    // 上の結果3キーと異なり、Simulation Coreは収集後の変更操作を実行しない（v0.14 §3.4）。
    // したがってここはCore導出値ではなく、v0.14 §3.1の公式仕様
    // （java.util.List / Set / Mapの「Calling any mutator method on the … will always cause
    // UnsupportedOperationException to be thrown.」）を根拠とする期待値リテラルである。
    // JDK 25実測との一致はOracle側（oracle/OracleP8.java）が担保する。
    uoeOnListAdd: 'UnsupportedOperationException',
    uoeOnSetAdd: 'UnsupportedOperationException',
    uoeOnMapPut: 'UnsupportedOperationException',
  }
}
