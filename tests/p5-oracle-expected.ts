import type { ScenarioMode } from '../src/domain/scenario/scenario'
import type { CollectorMapEntryView, TerminalResultView } from '../src/domain/engine/snapshot'
import { compensatedSum } from '../src/domain/engine/collectorRuntime'
import { formatDoubleLiteral } from '../src/domain/model/value'
import { lastOf } from './p5-helpers'

/**
 * P5-O01の期待値をSimulation Coreから導出する（Phase 5指示 §12.5）。
 *
 * Java側（OracleP5.java）の出力形式へ揃える:
 * - Employeeはname、Stringはクォートなしの生値
 * - 順序保証のないSet / Mapは**キー・要素の表示文字列の辞書順へ正規化**してから比較する
 *   （正規化は比較のためだけであり、JDKのiteration order保証を意味しない）
 * - TreeMapは正規化せず実順序のまま比較する（順序自体が検証対象）
 * - double値・64bit境界値は10進文字列のまま保持し、numberへ変換しない
 */

/** '佐藤（age=35）' → '佐藤' */
function employeeName(label: string): string {
  const paren = label.indexOf('（')
  return paren > 0 ? label.slice(0, paren) : label
}

/** '"関東"' → '関東' */
function unquote(label: string): string {
  return label.startsWith('"') && label.endsWith('"') ? label.slice(1, -1) : label
}

function resultOf(templateId: string, mode: ScenarioMode = 'standard'): TerminalResultView {
  return lastOf(templateId, mode).output.result
}

/** LIST variantの出力（SnapshotOutput.items）からEmployee名を取り出す */
function listNames(templateId: string, mode: ScenarioMode = 'standard'): string[] {
  return lastOf(templateId, mode).output.items.map((item) => employeeName(item.label))
}

function collectionOf(
  templateId: string,
  mode: ScenarioMode = 'standard',
): Extract<TerminalResultView, { kind: 'COLLECTION' }> {
  const result = resultOf(templateId, mode)
  if (result.kind !== 'COLLECTION') throw new Error(`${templateId}: COLLECTIONではありません`)
  return result
}

function mapOf(
  templateId: string,
  mode: ScenarioMode = 'standard',
): Extract<TerminalResultView, { kind: 'MAP' }> {
  const result = resultOf(templateId, mode)
  if (result.kind !== 'MAP') throw new Error(`${templateId}: MAPではありません`)
  return result
}

function scalarLabel(templateId: string, mode: ScenarioMode = 'standard'): string {
  const result = resultOf(templateId, mode)
  if (result.kind !== 'SCALAR') throw new Error(`${templateId}: SCALARではありません`)
  return result.valueLabel
}

function statsOf(
  templateId: string,
  mode: ScenarioMode = 'standard',
): Extract<TerminalResultView, { kind: 'STATISTICS' }> {
  const result = resultOf(templateId, mode)
  if (result.kind !== 'STATISTICS') throw new Error(`${templateId}: STATISTICSではありません`)
  return result
}

function optionalOf(
  templateId: string,
  mode: ScenarioMode = 'standard',
): Extract<TerminalResultView, { kind: 'OPTIONAL' }> {
  const result = resultOf(templateId, mode)
  if (result.kind !== 'OPTIONAL') throw new Error(`${templateId}: OPTIONALではありません`)
  return result
}

function recordOf(
  templateId: string,
  mode: ScenarioMode = 'standard',
): Extract<TerminalResultView, { kind: 'RECORD' }> {
  const result = resultOf(templateId, mode)
  if (result.kind !== 'RECORD') throw new Error(`${templateId}: RECORDではありません`)
  return result
}

/** Map値（downstream結果）をJava側の出力形式へ変換する */
type JsonValue = string | number | boolean | JsonValue[]

function valueOf(view: TerminalResultView, kind: 'names' | 'strings' | 'number' | 'string'): JsonValue {
  switch (kind) {
    case 'names':
      if (view.kind !== 'COLLECTION') throw new Error('COLLECTIONが必要です')
      return view.items.map((item) => employeeName(item.label))
    case 'strings':
      if (view.kind !== 'COLLECTION') throw new Error('COLLECTIONが必要です')
      return view.items.map((item) => unquote(item.label))
    case 'number':
      if (view.kind !== 'SCALAR') throw new Error('SCALARが必要です')
      return Number(view.valueLabel)
    case 'string':
      if (view.kind !== 'SCALAR') throw new Error('SCALARが必要です')
      return view.valueLabel
  }
}

/** 順序保証のないMapをキー辞書順の [key, value] 配列へ正規化する */
function normalizedEntries(
  entries: readonly CollectorMapEntryView[],
  valueKind: 'names' | 'strings' | 'number' | 'string',
): JsonValue[] {
  return [...entries]
    .map((entry): [string, JsonValue] => [entry.keyLabel, valueOf(entry.value, valueKind)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, value]) => [key, value])
}

/** TreeMap等の順序性を持つMapは実順序のまま [key, value] 配列にする */
function orderedEntries(
  entries: readonly CollectorMapEntryView[],
  valueKind: 'names' | 'strings' | 'number' | 'string',
): JsonValue[] {
  return entries.map((entry) => [entry.keyLabel, valueOf(entry.value, valueKind)])
}

export function buildP5ExpectedFromCore(): Record<string, unknown> {
  const statsIntArray = (id: string, mode: ScenarioMode): JsonValue[] => {
    const s = statsOf(id, mode)
    return [
      Number(s.countLabel),
      Number(s.sumLabel),
      Number(s.minLabel),
      Number(s.maxLabel),
      s.averageLabel,
    ]
  }
  const statsLongEmptyArray = (): JsonValue[] => {
    const s = statsOf('tmpl-collect-summarizing-long', 'emptySource')
    // 64bit境界値は10進文字列のまま保持する（numberへ変換しない）
    return [Number(s.countLabel), Number(s.sumLabel), s.minLabel, s.maxLabel, s.averageLabel]
  }
  const statsDoubleArray = (mode: ScenarioMode): JsonValue[] => {
    const s = statsOf('tmpl-collect-summarizing-double', mode)
    return [Number(s.countLabel), s.sumLabel, s.minLabel, s.maxLabel, s.averageLabel]
  }

  const nested = mapOf('tmpl-collect-groupingby-nested')

  return {
    toList: listNames('tmpl-collect-tolist'),
    toListEmpty: listNames('tmpl-collect-tolist', 'emptySource'),
    toSet: collectionOf('tmpl-collect-toset')
      .items.map((i) => unquote(i.label))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    toSetEmpty: collectionOf('tmpl-collect-toset', 'emptySource').items.map((i) => unquote(i.label)),
    toCollection: collectionOf('tmpl-collect-tocollection').items.map((i) => employeeName(i.label)),
    toCollectionEmpty: collectionOf('tmpl-collect-tocollection', 'emptySource').items.map((i) =>
      employeeName(i.label),
    ),
    joining: unquote(scalarLabel('tmpl-collect-joining')),
    joiningEmpty: unquote(scalarLabel('tmpl-collect-joining', 'emptySource')),
    joiningDelimiter: unquote(scalarLabel('tmpl-collect-joining-delimiter')),
    joiningDelimiterEmpty: unquote(scalarLabel('tmpl-collect-joining-delimiter', 'emptySource')),
    joiningFull: unquote(scalarLabel('tmpl-collect-joining-full')),
    joiningFullEmpty: unquote(scalarLabel('tmpl-collect-joining-full', 'emptySource')),
    counting: Number(scalarLabel('tmpl-collect-counting')),
    countingEmpty: Number(scalarLabel('tmpl-collect-counting', 'emptySource')),
    summingInt: Number(scalarLabel('tmpl-collect-summing-int')),
    summingIntEmpty: Number(scalarLabel('tmpl-collect-summing-int', 'emptySource')),
    summingLong: Number(scalarLabel('tmpl-collect-summing-long')),
    summingLongEmpty: Number(scalarLabel('tmpl-collect-summing-long', 'emptySource')),
    summingDouble: scalarLabel('tmpl-collect-summing-double'),
    summingDoubleEmpty: scalarLabel('tmpl-collect-summing-double', 'emptySource'),
    averagingInt: scalarLabel('tmpl-collect-averaging-int'),
    averagingIntEmpty: scalarLabel('tmpl-collect-averaging-int', 'emptySource'),
    averagingLong: scalarLabel('tmpl-collect-averaging-long'),
    averagingLongEmpty: scalarLabel('tmpl-collect-averaging-long', 'emptySource'),
    averagingDouble: scalarLabel('tmpl-collect-averaging-double'),
    averagingDoubleEmpty: scalarLabel('tmpl-collect-averaging-double', 'emptySource'),
    statsInt: statsIntArray('tmpl-collect-summarizing-int', 'standard'),
    statsIntEmpty: statsIntArray('tmpl-collect-summarizing-int', 'emptySource'),
    statsLong: statsIntArray('tmpl-collect-summarizing-long', 'standard'),
    statsLongEmpty: statsLongEmptyArray(),
    statsDouble: statsDoubleArray('standard'),
    statsDoubleEmpty: statsDoubleArray('emptySource'),
    minByName: employeeName(optionalOf('tmpl-collect-minby').valueLabel ?? ''),
    minByEmptyPresent: optionalOf('tmpl-collect-minby', 'emptySource').present,
    maxByName: employeeName(optionalOf('tmpl-collect-maxby').valueLabel ?? ''),
    maxByEmptyPresent: optionalOf('tmpl-collect-maxby', 'emptySource').present,
    reducing: unquote(optionalOf('tmpl-collect-reducing').valueLabel ?? ''),
    reducingEmptyPresent: optionalOf('tmpl-collect-reducing', 'emptySource').present,
    mapping: normalizedEntries(mapOf('tmpl-collect-mapping').entries, 'strings'),
    filtering: normalizedEntries(mapOf('tmpl-collect-filtering').entries, 'names'),
    flatMapping: normalizedEntries(mapOf('tmpl-collect-flatmapping').entries, 'strings'),
    collectingAndThen: collectionOf('tmpl-collect-collectingandthen').items.map((i) =>
      employeeName(i.label),
    ),
    collectingAndThenEmpty: collectionOf('tmpl-collect-collectingandthen', 'emptySource').items.map(
      (i) => employeeName(i.label),
    ),
    groupingByDepartment: normalizedEntries(mapOf('tmpl-collect-groupingby').entries, 'names'),
    groupingByDepartmentEmpty: normalizedEntries(
      mapOf('tmpl-collect-groupingby', 'emptySource').entries,
      'names',
    ),
    groupingByCounting: normalizedEntries(
      mapOf('tmpl-collect-groupingby-counting').entries,
      'number',
    ),
    groupingByAveraging: normalizedEntries(
      mapOf('tmpl-collect-groupingby-averaging').entries,
      'string',
    ),
    // TreeMapは実順序のまま照合する
    groupingByTreeMapOrdered: orderedEntries(
      mapOf('tmpl-collect-groupingby-treemap').entries,
      'names',
    ),
    nestedGroupingBy: [...nested.entries]
      .map((entry): [string, JsonValue] => {
        if (entry.value.kind !== 'MAP') throw new Error('nested MAPが必要です')
        return [entry.keyLabel, normalizedEntries(entry.value.entries, 'names')]
      })
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([key, value]) => [key, value]),
    partitioningBy: normalizedEntries(mapOf('tmpl-collect-partitioningby').entries, 'names'),
    partitioningByEmpty: normalizedEntries(
      mapOf('tmpl-collect-partitioningby', 'emptySource').entries,
      'names',
    ),
    partitioningByCounting: normalizedEntries(
      mapOf('tmpl-collect-partitioningby-counting').entries,
      'number',
    ),
    partitioningByCountingEmpty: normalizedEntries(
      mapOf('tmpl-collect-partitioningby-counting', 'emptySource').entries,
      'number',
    ),
    teeingCount: Number(recordOf('tmpl-collect-teeing').fields[0]?.valueLabel ?? ''),
    teeingAverage: recordOf('tmpl-collect-teeing').fields[1]?.valueLabel ?? '',
    teeingEmptyCount: Number(
      recordOf('tmpl-collect-teeing', 'emptySource').fields[0]?.valueLabel ?? '',
    ),
    teeingEmptyAverage: recordOf('tmpl-collect-teeing', 'emptySource').fields[1]?.valueLabel ?? '',
    teeingRecordToString: recordToString(recordOf('tmpl-collect-teeing')),
    teeingEmptyRecordToString: recordToString(recordOf('tmpl-collect-teeing', 'emptySource')),
    collectTriple: listNames('tmpl-collect-triple'),
    collectTripleEmpty: listNames('tmpl-collect-triple', 'emptySource'),
    takeWhileSalary: listNames('tmpl-takewhile-employee'),
    dropWhileSalary: listNames('tmpl-dropwhile-employee'),
    // 補償付き加算がJDKと一致することの照合（教材fixtureでは補償が残らないため専用ケース）
    compensatedSums: COMPENSATION_CASES.map((values) => formatDoubleLiteral(compensatedSum(values))),
    naiveSums: COMPENSATION_CASES.map((values) =>
      formatDoubleLiteral(values.reduce((acc, v) => acc + v, 0)),
    ),
    compensatedAverages: COMPENSATION_CASES.map((values) =>
      formatDoubleLiteral(compensatedSum(values) / values.length),
    ),
    // DoubleSummaryStatistics.getSum()も同じ補償付き加算の最終値になる
    compensatedStatsSums: COMPENSATION_CASES.map((values) =>
      formatDoubleLiteral(compensatedSum(values)),
    ),
  }
}

/**
 * 補償付き加算が結果に現れるdouble列（P5-O01でJDKと照合する）。
 * 教材fixture（evaluation 4.2 / 3.8 / 4.6 / 4.0）では補償が残らず符号の誤りを検出できないため、
 * 補償が効くケースを明示的に固定する。
 */
export const COMPENSATION_CASES: readonly (readonly number[])[] = [
  [0.001, 0.01],
  [1e16, 1, 1, 1, -1e16],
  [0.1, 0.2, 0.3],
]

/** Java recordのtoString表現（SalarySummary[employeeCount=4, averageSalary=5425000.0]） */
function recordToString(view: Extract<TerminalResultView, { kind: 'RECORD' }>): string {
  return `${view.recordName}[${view.fields.map((f) => `${f.name}=${f.valueLabel}`).join(', ')}]`
}
