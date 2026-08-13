import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  allSuitesPassed,
  BOUNDARY_SUITE_ID,
  buildCurrentPhaseOracleIdSection,
  evaluateCurrentPhaseOracleIds,
  P7_CURRENT_PHASE_REPORT_PATH,
  P7_CURRENT_PHASE_SUITE_ID,
  P7_MATCH_NOTES,
  P7_PAST_ARTIFACT_DIRS,
  P7_REQUIRED_SUITE_IDS,
  SUITES,
} from '../../oracle/oracle-lib.mjs'

/**
 * P7-O02: Oracle運用検証（Phase 7指示 §12.5）。
 * - 必須suite（P1-O01〜P7-O01）が各1件存在すること
 * - 証跡書込みが現行Phase（P7）のみで、書込み先がartifacts/phase-7/oracle-result.mdだけであること
 * - 実行前後でartifacts/phase-1〜phase-6のSHA-256が不変であること
 *
 * **Phase 8指示 §12冒頭で許可された意図的更新**:
 * Phase 8でsuite構成が変わった（8 suite・P8単独書込み・過去artifactsへphase-7追加）ため、
 * 本ファイルは**Phase 7時点の構成をfixtureとして固定**し、同じ契約を検証し続ける形へ
 * リファクタリングした（P5-O02 / P6-O02の前例。検証意味は変更・緩和していない）。
 * ライブ構成の検証は新規 tests/domain/p8-review.test.ts（P8-O02）が担う。
 */

/** Phase 7完了時点のsuite構成（当時の値をそのまま固定する） */
const P7_SUITES = [
  { id: 'P1-O01', javaFile: 'OracleP1.java', expectedFile: 'expected-from-core.json', writeReportPath: null },
  { id: 'P2-O01', javaFile: 'OracleP2.java', expectedFile: 'expected-p2-from-core.json', writeReportPath: null },
  { id: 'P3-O01', javaFile: 'OracleP3.java', expectedFile: 'expected-p3-from-core.json', writeReportPath: null },
  { id: 'P4-O01', javaFile: 'OracleP4.java', expectedFile: 'expected-p4-from-core.json', writeReportPath: null },
  { id: 'P5-O01', javaFile: 'OracleP5.java', expectedFile: 'expected-p5-from-core.json', writeReportPath: null },
  { id: 'P6-O01', javaFile: 'OracleP6.java', expectedFile: 'expected-p6-from-core.json', writeReportPath: null },
  {
    id: 'P7-O01',
    javaFile: 'OracleP7.java',
    expectedFile: 'expected-p7-from-core.json',
    writeReportPath: ['artifacts', 'phase-7', 'oracle-result.md'],
  },
]

const ALL_PASSED = P7_REQUIRED_SUITE_IDS.map((id: string) => ({ id, passed: true }))

const evaluateP7 = (suites: unknown, pastArtifactsUnchanged = true, suiteResults = ALL_PASSED) =>
  evaluateCurrentPhaseOracleIds({
    suiteResults,
    pastArtifactsUnchanged,
    suites,
    requiredSuiteIds: P7_REQUIRED_SUITE_IDS,
    currentPhaseSuiteId: P7_CURRENT_PHASE_SUITE_ID,
    currentPhaseReportPath: P7_CURRENT_PHASE_REPORT_PATH,
  })

describe('P7-O02 Oracle運用検証（suite構成と書込み範囲。Phase 7時点の構成をfixtureで固定）', () => {
  it('P7-O02: 必須7 suite（P1-O01〜P7-O01）が各1件存在し、証跡書込みは現行PhaseのP7のみである', () => {
    expect(P7_SUITES.map((s) => s.id)).toEqual([
      'P1-O01',
      'P2-O01',
      'P3-O01',
      'P4-O01',
      'P5-O01',
      'P6-O01',
      'P7-O01',
    ])
    expect(P7_REQUIRED_SUITE_IDS).toEqual([
      'P1-O01',
      'P2-O01',
      'P3-O01',
      'P4-O01',
      'P5-O01',
      'P6-O01',
      'P7-O01',
    ])
    for (const id of P7_REQUIRED_SUITE_IDS) {
      expect(P7_SUITES.filter((s) => s.id === id), id).toHaveLength(1)
    }
    // 過去Phase suite（P1〜P6）は照合のみ。P6-O01の証跡書込みはPhase 7着手時点で停止済み
    for (const id of ['P1-O01', 'P2-O01', 'P3-O01', 'P4-O01', 'P5-O01', 'P6-O01']) {
      const suite = P7_SUITES.find((s) => s.id === id)!
      expect(suite.writeReportPath, id).toBeNull()
    }
    // 書込みは現行Phase（P7-O01）ただ1件、書込み先はartifacts/phase-7/oracle-result.mdだけ
    const writers = P7_SUITES.filter((s) => s.writeReportPath !== null)
    expect(writers).toHaveLength(1)
    expect(writers[0]?.id).toBe(P7_CURRENT_PHASE_SUITE_ID)
    expect(writers[0]?.writeReportPath).toEqual(['artifacts', 'phase-7', 'oracle-result.md'])
    expect(writers[0]?.writeReportPath?.join('/')).toBe(P7_CURRENT_PHASE_REPORT_PATH)
    // 過去Phase証跡へは書き込まない
    for (const suite of writers) {
      expect(suite.writeReportPath?.join('/')).not.toMatch(/phase-[123456]/)
    }
    // P7 suiteの実体（ライブ構成にもP7-O01は存在し続ける。書込みだけがPhase 8で停止した）
    const p7 = SUITES.find((s: { id: string }) => s.id === 'P7-O01')!
    expect(p7.javaFile).toBe('OracleP7.java')
    expect(p7.expectedFile).toBe('expected-p7-from-core.json')
    // P4-O02のLong境界値照合はP4 suiteへ適用し続ける（ID再定義はしない）
    expect(BOUNDARY_SUITE_ID).toBe('P4-O01')
  })

  it('P7-O02: 過去artifacts不変検証の対象へartifacts/phase-6が含まれ、対象ディレクトリが実在する', () => {
    expect(P7_PAST_ARTIFACT_DIRS).toEqual([
      'artifacts/phase-1',
      'artifacts/phase-2',
      'artifacts/phase-3',
      'artifacts/phase-4',
      'artifacts/phase-5',
      'artifacts/phase-6',
    ])
    // Phase 7時点では現行Phaseの証跡を不変検証の対象に含めない（書込み対象のため）
    expect(P7_PAST_ARTIFACT_DIRS).not.toContain('artifacts/phase-7')
    const projectRoot = path.join(__dirname, '../..')
    for (const dir of P7_PAST_ARTIFACT_DIRS) {
      const abs = path.join(projectRoot, dir)
      expect(statSync(abs).isDirectory(), dir).toBe(true)
      expect(readdirSync(abs).length, dir).toBeGreaterThan(0)
    }
  })

  it('P7-O02: suite構成の欠落・重複・書込み先異常をFAILと判定する', () => {
    // 正常なPhase 7構成 → P7-O02 PASS
    const normal = evaluateP7(P7_SUITES)
    expect(normal.requiredSuitesPresent).toBe(true)
    expect(normal.configOnlyCurrentPhaseWrites).toBe(true)
    expect(normal.o01Passed).toBe(true)
    expect(normal.o02Passed).toBe(true)
    expect(normal.overallPassed).toBe(true)
    // 必須suiteの欠落 → FAIL
    for (const missingId of P7_REQUIRED_SUITE_IDS) {
      const missing = evaluateP7(P7_SUITES.filter((s) => s.id !== missingId))
      expect(missing.requiredSuitesPresent, `${missingId} 欠落`).toBe(false)
      expect(missing.o02Passed, `${missingId} 欠落`).toBe(false)
      expect(missing.overallPassed, `${missingId} 欠落`).toBe(false)
    }
    // 重複 → FAIL
    const duplicated = evaluateP7([...P7_SUITES, P7_SUITES.find((s) => s.id === 'P3-O01')!])
    expect(duplicated.requiredSuitesPresent).toBe(false)
    expect(duplicated.o02Passed).toBe(false)
    // 過去Phaseへ書き込む構成 → FAIL（P6-O01の書込み再開を検知する）
    const p6Writes = evaluateP7(
      P7_SUITES.map((s) =>
        s.id === 'P6-O01'
          ? { ...s, writeReportPath: ['artifacts', 'phase-6', 'oracle-result.md'] }
          : s,
      ),
    )
    expect(p6Writes.configOnlyCurrentPhaseWrites).toBe(false)
    expect(p6Writes.o02Passed).toBe(false)
    // 現行Phaseの書込み先が想定外 → FAIL
    const wrongTarget = evaluateP7(
      P7_SUITES.map((s) =>
        s.id === 'P7-O01'
          ? { ...s, writeReportPath: ['artifacts', 'phase-6', 'oracle-result.md'] }
          : s,
      ),
    )
    expect(wrongTarget.configOnlyCurrentPhaseWrites).toBe(false)
    expect(wrongTarget.o02Passed).toBe(false)
    // 過去artifactsが変化した実測 → FAIL
    const changed = evaluateP7(P7_SUITES, false)
    expect(changed.o02Passed).toBe(false)
    expect(changed.overallPassed).toBe(false)
    // P7-O01の照合失敗 → FAIL
    const p7Failed = evaluateP7(
      P7_SUITES,
      true,
      ALL_PASSED.map((r: { id: string; passed: boolean }) =>
        r.id === 'P7-O01' ? { ...r, passed: false } : r,
      ),
    )
    expect(p7Failed.o01Passed).toBe(false)
    expect(p7Failed.overallPassed).toBe(false)
    // 1件でも比較失敗があればコマンド全体が失敗する
    expect(allSuitesPassed(ALL_PASSED)).toBe(true)
    expect(allSuitesPassed([...ALL_PASSED.slice(0, 6), { id: 'P7-O01', passed: false }])).toBe(false)
    expect(allSuitesPassed([])).toBe(false)
  })

  it('P7-O02: 結果欄が実判定から生成され、レポートへ組み込まれる', () => {
    const regression = ['P6-O01: PASS（照合のみ・証跡書込みなし）']
    const p7Section = (pastArtifactsUnchanged: boolean) =>
      buildCurrentPhaseOracleIdSection({
        evaluation: evaluateP7(P7_SUITES, pastArtifactsUnchanged),
        pastArtifactsUnchanged,
        regression,
        requiredSuiteIds: P7_REQUIRED_SUITE_IDS,
        currentPhaseReportPath: P7_CURRENT_PHASE_REPORT_PATH,
        phaseLabel: 'P7',
        matchIdLabel: 'P7-O01',
        operationsIdLabel: 'P7-O02',
        pastArtifactsLabel: 'artifacts/phase-1〜phase-6',
        pastPhasesLabel: 'P1〜P6',
        matchNotes: P7_MATCH_NOTES,
      }).join('\n')

    const passSection = p7Section(true)
    expect(passSection).toContain('- P7-O01: PASS')
    expect(passSection).toContain('- P7-O02: PASS')
    expect(passSection).toContain(
      '必須7 suite（P1-O01 / P2-O01 / P3-O01 / P4-O01 / P5-O01 / P6-O01 / P7-O01）が各1件存在（欠落・重複なし）: PASS',
    )
    expect(passSection).toContain('証跡書込みは現行Phase（P7）のみ')
    expect(passSection).toContain('artifacts/phase-7/oracle-result.md')
    expect(passSection).toContain('実行前後でartifacts/phase-1〜phase-6のSHA-256が不変: PASS')
    expect(passSection).toContain('総合判定: PASS')
    expect(passSection).toContain('P6-O01: PASS（照合のみ・証跡書込みなし）')
    // §12.5の照合方式注記（P7_MATCH_NOTES）が出力される
    expect(passSection).toContain('v0.9 §7の「導出」区分2件')

    // FAIL側: 固定文字列のPASSを出力しない
    const failSection = p7Section(false)
    expect(failSection).toContain('- P7-O02: FAIL')
    expect(failSection).toContain('実行前後でartifacts/phase-1〜phase-6のSHA-256が不変: FAIL')
    expect(failSection).toContain('総合判定: FAIL')
  })
})
