import { runAllSnapshots } from './helpers'
import { importScenario } from './p6-helpers'
import { DSL_VERSION } from '../src/domain/dsl/ast'
import type { Snapshot, TerminalResultView } from '../src/domain/engine/snapshot'
import type { ScenarioMode } from '../src/domain/scenario/scenario'

/**
 * P6-O01の期待値をSimulation Coreから導出する（Phase 6指示 §12.5）。
 *
 * **取込相当candidate**（Import Contractの前段検証を通した貼付JSON）を実行し、
 * §7.5の数値値域の代表境界値の結果をJava側（OracleP6.java）と照合する。
 *
 * 数値の表記合わせ（境界値選定の判断。docs/phase-6-decisions.md）:
 * - doubleはSimulation Coreの`formatDoubleLiteral`表記で保持する。
 *   Java側は`new BigDecimal(Double.toString(v)).stripTrailingZeros().toPlainString()`に
 *   小数点がなければ`.0`を付す`coreDouble`で同じ表記を生成する
 *   （JavaのDouble.toStringは1e-3未満・1e7以上で指数表記へ切り替わるため、
 *   1e-6 / 1e15の境界をそのまま比較すると偽装不一致になる）。
 * - longは`formatLongLiteral`（3桁区切り + L）表記で保持し、Java側も同じ規則で出力する。
 * - int・件数は10進整数のJSON numberで比較する。
 * - **DoubleStreamのsum / averageは照合対象にしない**。JDKのDoubleStream.sum()は
 *   補償付き加算（Collectors.sumWithCompensation相当）だがSimulation Coreの
 *   primitive Stream集計は素朴加算のため、値域境界の照合には向かない。
 *   double集計はCollectors（Core側も補償付き）側で照合する。
 */

const INT32_MAX = 2_147_483_647
const INT32_MIN = -2_147_483_648
const SAFE_MAX = Number.MAX_SAFE_INTEGER

/** 境界値Employee dataset（age / salary / evaluationの下限・上限） */
export const P6_BOUNDARY_EMPLOYEES = [
  {
    name: '境界下限',
    age: 15,
    salary: 0,
    evaluation: 0,
    region: '北',
    hireDate: '1970-01-01',
    department: { name: '品質保証部', division: '技術本部' },
    skills: [] as string[],
  },
  {
    name: '境界上限',
    age: 80,
    salary: 99_999_999,
    evaluation: 5,
    region: '南',
    hireDate: '2100-12-31',
    department: { name: '品質保証部', division: '技術本部' },
    skills: ['Java'],
  },
]

/** primitive配列の境界値（int / long / double） */
export const P6_INT_VALUES = [INT32_MAX, INT32_MIN]
export const P6_LONG_VALUES = [SAFE_MAX, -SAFE_MAX]
export const P6_DOUBLE_VALUES = [0, 1e-6, 1e15]

function primitiveArrayCandidate(
  templateId: string,
  primitive: 'int' | 'long' | 'double',
  values: readonly number[],
): string {
  return JSON.stringify({
    dslVersion: DSL_VERSION,
    templateId,
    templateVersion: 1,
    mode: 'standard',
    dslParameters: {
      'slot-source': { kind: 'arrayPrimitive', arrayId: 'numbers', primitive, values },
    },
    title: `${primitive}境界値の取込サンプル`,
    description: `${primitive}の値域境界をJDK 25と照合します。`,
  })
}

function collectorCandidate(templateId: string, collector: Record<string, unknown>): string {
  return JSON.stringify({
    dslVersion: DSL_VERSION,
    templateId,
    templateVersion: 1,
    mode: 'standard',
    dataset: P6_BOUNDARY_EMPLOYEES,
    dslParameters: { 'slot-collector': collector },
    title: 'Employee境界値の取込サンプル',
    description: 'age / salary / evaluationの境界値をJDK 25と照合します。',
  })
}

/** 取込相当candidateを実行し、最終snapshotを返す */
function lastSnapshotOf(templateId: string, text: string, mode: ScenarioMode = 'standard'): Snapshot {
  const result = importScenario(templateId, mode, text)
  if (!result.ok) {
    throw new Error(
      `${templateId}: 取込候補が成立しません: ${result.issues.map((i) => `${i.code}@${i.path}`).join(' | ')}`,
    )
  }
  const snapshots = runAllSnapshots(result.value.pipeline)
  const last = snapshots[snapshots.length - 1]
  if (!last) throw new Error(`${templateId}: snapshotがありません`)
  return last
}

function resultOf(templateId: string, text: string): TerminalResultView {
  return lastSnapshotOf(templateId, text).output.result
}

function scalarLabel(templateId: string, text: string): string {
  const result = resultOf(templateId, text)
  if (result.kind !== 'SCALAR') throw new Error(`${templateId}: SCALARではありません`)
  return result.valueLabel
}

function optionalLabel(templateId: string, text: string): string {
  const result = resultOf(templateId, text)
  if (result.kind !== 'OPTIONAL') throw new Error(`${templateId}: OPTIONALではありません`)
  if (!result.present || result.valueLabel === null) {
    throw new Error(`${templateId}: Optionalが空です`)
  }
  return result.valueLabel
}

function statsOf(
  templateId: string,
  text: string,
): Extract<TerminalResultView, { kind: 'STATISTICS' }> {
  const result = resultOf(templateId, text)
  if (result.kind !== 'STATISTICS') throw new Error(`${templateId}: STATISTICSではありません`)
  return result
}

function boxedLabels(templateId: string, text: string): string[] {
  return lastSnapshotOf(templateId, text).output.items.map((item) => item.label)
}

export function buildP6ExpectedFromCore(): Record<string, unknown> {
  const intText = primitiveArrayCandidate('tmpl-sum-int', 'int', P6_INT_VALUES)
  const intAvgText = primitiveArrayCandidate('tmpl-average-int', 'int', P6_INT_VALUES)
  const intStatsText = primitiveArrayCandidate('tmpl-stats-int', 'int', P6_INT_VALUES)
  const longSumText = primitiveArrayCandidate('tmpl-sum-long', 'long', P6_LONG_VALUES)
  const longStatsText = primitiveArrayCandidate('tmpl-stats-long', 'long', P6_LONG_VALUES)
  const doubleBoxedText = primitiveArrayCandidate(
    'tmpl-src-arrays-double',
    'double',
    P6_DOUBLE_VALUES,
  )
  const doubleStatsText = primitiveArrayCandidate('tmpl-stats-double', 'double', P6_DOUBLE_VALUES)

  const intStats = statsOf('tmpl-stats-int', intStatsText)
  const longStats = statsOf('tmpl-stats-long', longStatsText)
  const doubleStats = statsOf('tmpl-stats-double', doubleStatsText)

  return {
    // ---- int32境界（±2,147,483,647 / -2,147,483,648） ----
    intBoundarySum: Number(scalarLabel('tmpl-sum-int', intText)),
    intBoundaryAverage: optionalLabel('tmpl-average-int', intAvgText),
    intStatsCount: Number(intStats.countLabel),
    intStatsSum: intStats.sumLabel,
    intStatsMin: Number(intStats.minLabel),
    intStatsMax: Number(intStats.maxLabel),
    intStatsAverage: intStats.averageLabel,
    // ---- long safe integer境界 ----
    longBoundarySum: scalarLabel('tmpl-sum-long', longSumText),
    longStatsCount: Number(longStats.countLabel),
    longStatsSum: longStats.sumLabel,
    longStatsMin: longStats.minLabel,
    longStatsMax: longStats.maxLabel,
    longStatsAverage: longStats.averageLabel,
    // ---- doubleの0 / 1e-6 / 1e15境界（sum / averageは照合対象外） ----
    doubleBoxedValues: boxedLabels('tmpl-src-arrays-double', doubleBoxedText),
    doubleStatsCount: Number(doubleStats.countLabel),
    doubleStatsMin: doubleStats.minLabel,
    doubleStatsMax: doubleStats.maxLabel,
    // ---- Employee境界dataset（age 15 / 80、salary 0 / 99,999,999、evaluation 0.0 / 5.0） ----
    employeeCount: Number(
      scalarLabel('tmpl-collect-counting', collectorCandidate('tmpl-collect-counting', { kind: 'counting' })),
    ),
    summingIntAge: Number(
      scalarLabel(
        'tmpl-collect-summing-int',
        collectorCandidate('tmpl-collect-summing-int', { kind: 'summingInt', field: 'age' }),
      ),
    ),
    averagingIntAge: scalarLabel(
      'tmpl-collect-averaging-int',
      collectorCandidate('tmpl-collect-averaging-int', { kind: 'averagingInt', field: 'age' }),
    ),
    summingLongSalary: Number(
      scalarLabel(
        'tmpl-collect-summing-long',
        collectorCandidate('tmpl-collect-summing-long', { kind: 'summingLong', field: 'salary' }),
      ),
    ),
    averagingLongSalary: scalarLabel(
      'tmpl-collect-averaging-long',
      collectorCandidate('tmpl-collect-averaging-long', { kind: 'averagingLong', field: 'salary' }),
    ),
    summingDoubleEvaluation: scalarLabel(
      'tmpl-collect-summing-double',
      collectorCandidate('tmpl-collect-summing-double', {
        kind: 'summingDouble',
        field: 'evaluation',
      }),
    ),
    averagingDoubleEvaluation: scalarLabel(
      'tmpl-collect-averaging-double',
      collectorCandidate('tmpl-collect-averaging-double', {
        kind: 'averagingDouble',
        field: 'evaluation',
      }),
    ),
  }
}
