import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  allSuitesPassed,
  BOUNDARY_SUITE_ID,
  buildCurrentPhaseOracleIdSection,
  evaluateCurrentPhaseOracleIds,
  P6_CURRENT_PHASE_REPORT_PATH,
  P6_CURRENT_PHASE_SUITE_ID,
  P6_MATCH_NOTES,
  P6_PAST_ARTIFACT_DIRS,
  P6_REQUIRED_SUITE_IDS,
  SUITES,
} from '../../oracle/oracle-lib.mjs'

/**
 * P6-O02: Oracle運用検証（Phase 6指示 §12.5）。
 * - 必須suite（P1-O01〜P6-O01）が各1件存在すること
 * - 証跡書込みが現行Phase（P6）のみで、書込み先がartifacts/phase-6/oracle-result.mdだけであること
 * - 実行前後でartifacts/phase-1〜phase-5のSHA-256が不変であること
 *
 * **Phase 7指示 §12冒頭で許可された意図的更新**:
 * Phase 7でsuite構成が変わった（7 suite・P7単独書込み・過去artifactsへphase-6追加）ため、
 * 本ファイルは**Phase 6時点の構成をfixtureとして固定**し、同じ契約を検証し続ける形へ
 * リファクタリングした（P4-O02 / P5-O02の前例。検証意味は変更・緩和していない）。
 * ライブ構成の検証は新規 tests/domain/p7-review.test.ts（P7-O02）が担う。
 */

/** Phase 6完了時点のsuite構成（当時の値をそのまま固定する） */
const P6_SUITES = [
  { id: 'P1-O01', javaFile: 'OracleP1.java', expectedFile: 'expected-from-core.json', writeReportPath: null },
  { id: 'P2-O01', javaFile: 'OracleP2.java', expectedFile: 'expected-p2-from-core.json', writeReportPath: null },
  { id: 'P3-O01', javaFile: 'OracleP3.java', expectedFile: 'expected-p3-from-core.json', writeReportPath: null },
  { id: 'P4-O01', javaFile: 'OracleP4.java', expectedFile: 'expected-p4-from-core.json', writeReportPath: null },
  { id: 'P5-O01', javaFile: 'OracleP5.java', expectedFile: 'expected-p5-from-core.json', writeReportPath: null },
  {
    id: 'P6-O01',
    javaFile: 'OracleP6.java',
    expectedFile: 'expected-p6-from-core.json',
    writeReportPath: ['artifacts', 'phase-6', 'oracle-result.md'],
  },
]

const ALL_PASSED = P6_REQUIRED_SUITE_IDS.map((id: string) => ({ id, passed: true }))

const evaluateP6 = (suites: unknown, pastArtifactsUnchanged = true, suiteResults = ALL_PASSED) =>
  evaluateCurrentPhaseOracleIds({
    suiteResults,
    pastArtifactsUnchanged,
    suites,
    requiredSuiteIds: P6_REQUIRED_SUITE_IDS,
    currentPhaseSuiteId: P6_CURRENT_PHASE_SUITE_ID,
    currentPhaseReportPath: P6_CURRENT_PHASE_REPORT_PATH,
  })

describe('P6-O02 Oracle運用検証（suite構成と書込み範囲。Phase 6時点の構成をfixtureで固定）', () => {
  it('P6-O02: 必須6 suite（P1-O01〜P6-O01）が各1件存在し、証跡書込みは現行PhaseのP6のみである', () => {
    expect(P6_SUITES.map((s) => s.id)).toEqual([
      'P1-O01',
      'P2-O01',
      'P3-O01',
      'P4-O01',
      'P5-O01',
      'P6-O01',
    ])
    expect(P6_REQUIRED_SUITE_IDS).toEqual([
      'P1-O01',
      'P2-O01',
      'P3-O01',
      'P4-O01',
      'P5-O01',
      'P6-O01',
    ])
    for (const id of P6_REQUIRED_SUITE_IDS) {
      expect(P6_SUITES.filter((s) => s.id === id), id).toHaveLength(1)
    }
    // 過去Phase suite（P1〜P5）は照合のみ。P5-O01の証跡書込みは停止済み
    for (const id of ['P1-O01', 'P2-O01', 'P3-O01', 'P4-O01', 'P5-O01']) {
      const suite = P6_SUITES.find((s) => s.id === id)!
      expect(suite.writeReportPath, id).toBeNull()
    }
    // 書込みは現行Phase（P6-O01）ただ1件、書込み先はartifacts/phase-6/oracle-result.mdだけ
    const writers = P6_SUITES.filter((s) => s.writeReportPath !== null)
    expect(writers).toHaveLength(1)
    expect(writers[0]?.id).toBe(P6_CURRENT_PHASE_SUITE_ID)
    expect(writers[0]?.writeReportPath).toEqual(['artifacts', 'phase-6', 'oracle-result.md'])
    expect(writers[0]?.writeReportPath?.join('/')).toBe(P6_CURRENT_PHASE_REPORT_PATH)
    // 過去Phase証跡へは書き込まない
    for (const suite of writers) {
      expect(suite.writeReportPath?.join('/')).not.toMatch(/phase-[12345]/)
    }
    // P6 suiteの実体（ライブ構成にもP6-O01は存在し続ける。書込みだけがPhase 7で停止した）
    const p6 = SUITES.find((s: { id: string }) => s.id === 'P6-O01')!
    expect(p6.javaFile).toBe('OracleP6.java')
    expect(p6.expectedFile).toBe('expected-p6-from-core.json')
    // P4-O02のLong境界値照合はP4 suiteへ適用し続ける（ID再定義はしない）
    expect(BOUNDARY_SUITE_ID).toBe('P4-O01')
  })

  it('P6-O02: 過去artifacts不変検証の対象へartifacts/phase-5が含まれ、対象ディレクトリが実在する', () => {
    expect(P6_PAST_ARTIFACT_DIRS).toEqual([
      'artifacts/phase-1',
      'artifacts/phase-2',
      'artifacts/phase-3',
      'artifacts/phase-4',
      'artifacts/phase-5',
    ])
    // Phase 6時点では現行Phaseの証跡を不変検証の対象に含めない（書込み対象のため）
    expect(P6_PAST_ARTIFACT_DIRS).not.toContain('artifacts/phase-6')
    const projectRoot = path.join(__dirname, '../..')
    for (const dir of P6_PAST_ARTIFACT_DIRS) {
      const abs = path.join(projectRoot, dir)
      expect(statSync(abs).isDirectory(), dir).toBe(true)
      expect(readdirSync(abs).length, dir).toBeGreaterThan(0)
    }
  })

  it('P6-O02: suite構成の欠落・重複・書込み先異常をFAILと判定する', () => {
    // 正常なPhase 6構成 → P6-O02 PASS
    const normal = evaluateP6(P6_SUITES)
    expect(normal.requiredSuitesPresent).toBe(true)
    expect(normal.configOnlyCurrentPhaseWrites).toBe(true)
    expect(normal.o01Passed).toBe(true)
    expect(normal.o02Passed).toBe(true)
    expect(normal.overallPassed).toBe(true)
    // 必須suiteの欠落 → FAIL
    for (const missingId of P6_REQUIRED_SUITE_IDS) {
      const missing = evaluateP6(P6_SUITES.filter((s) => s.id !== missingId))
      expect(missing.requiredSuitesPresent, `${missingId} 欠落`).toBe(false)
      expect(missing.o02Passed, `${missingId} 欠落`).toBe(false)
      expect(missing.overallPassed, `${missingId} 欠落`).toBe(false)
    }
    // 重複 → FAIL
    const duplicated = evaluateP6([...P6_SUITES, P6_SUITES.find((s) => s.id === 'P3-O01')!])
    expect(duplicated.requiredSuitesPresent).toBe(false)
    expect(duplicated.o02Passed).toBe(false)
    // 過去Phaseへ書き込む構成 → FAIL
    const p5Writes = evaluateP6(
      P6_SUITES.map((s) =>
        s.id === 'P5-O01'
          ? { ...s, writeReportPath: ['artifacts', 'phase-5', 'oracle-result.md'] }
          : s,
      ),
    )
    expect(p5Writes.configOnlyCurrentPhaseWrites).toBe(false)
    expect(p5Writes.o02Passed).toBe(false)
    // 現行Phaseの書込み先が想定外 → FAIL
    const wrongTarget = evaluateP6(
      P6_SUITES.map((s) =>
        s.id === 'P6-O01'
          ? { ...s, writeReportPath: ['artifacts', 'phase-5', 'oracle-result.md'] }
          : s,
      ),
    )
    expect(wrongTarget.configOnlyCurrentPhaseWrites).toBe(false)
    expect(wrongTarget.o02Passed).toBe(false)
    // 過去artifactsが変化した実測 → FAIL
    const changed = evaluateP6(P6_SUITES, false)
    expect(changed.o02Passed).toBe(false)
    expect(changed.overallPassed).toBe(false)
    // P6-O01の照合失敗 → FAIL
    const p6Failed = evaluateP6(
      P6_SUITES,
      true,
      ALL_PASSED.map((r: { id: string; passed: boolean }) =>
        r.id === 'P6-O01' ? { ...r, passed: false } : r,
      ),
    )
    expect(p6Failed.o01Passed).toBe(false)
    expect(p6Failed.overallPassed).toBe(false)
    // 1件でも比較失敗があればコマンド全体が失敗する
    expect(allSuitesPassed(ALL_PASSED)).toBe(true)
    expect(allSuitesPassed([...ALL_PASSED.slice(0, 5), { id: 'P6-O01', passed: false }])).toBe(false)
    expect(allSuitesPassed([])).toBe(false)
  })

  it('P6-O02: 結果欄が実判定から生成され、レポートへ組み込まれる', () => {
    const regression = ['P5-O01: PASS（照合のみ・証跡書込みなし）']
    const p6Section = (pastArtifactsUnchanged: boolean) =>
      buildCurrentPhaseOracleIdSection({
        evaluation: evaluateP6(P6_SUITES, pastArtifactsUnchanged),
        pastArtifactsUnchanged,
        regression,
        requiredSuiteIds: P6_REQUIRED_SUITE_IDS,
        currentPhaseReportPath: P6_CURRENT_PHASE_REPORT_PATH,
        phaseLabel: 'P6',
        matchIdLabel: 'P6-O01',
        operationsIdLabel: 'P6-O02',
        pastArtifactsLabel: 'artifacts/phase-1〜phase-5',
        pastPhasesLabel: 'P1〜P5',
        matchNotes: P6_MATCH_NOTES,
      }).join('\n')

    const passSection = p6Section(true)
    expect(passSection).toContain('- P6-O01: PASS')
    expect(passSection).toContain('- P6-O02: PASS')
    expect(passSection).toContain(
      '必須6 suite（P1-O01 / P2-O01 / P3-O01 / P4-O01 / P5-O01 / P6-O01）が各1件存在（欠落・重複なし）: PASS',
    )
    expect(passSection).toContain('証跡書込みは現行Phase（P6）のみ')
    expect(passSection).toContain('artifacts/phase-6/oracle-result.md')
    expect(passSection).toContain('実行前後でartifacts/phase-1〜phase-5のSHA-256が不変: PASS')
    expect(passSection).toContain('総合判定: PASS')
    expect(passSection).toContain('P5-O01: PASS（照合のみ・証跡書込みなし）')

    // FAIL側: 固定文字列のPASSを出力しない
    const failSection = p6Section(false)
    expect(failSection).toContain('- P6-O02: FAIL')
    expect(failSection).toContain('実行前後でartifacts/phase-1〜phase-5のSHA-256が不変: FAIL')
    expect(failSection).toContain('総合判定: FAIL')
  })
})
