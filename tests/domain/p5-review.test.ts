import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  allSuitesPassed,
  BOUNDARY_SUITE_ID,
  buildCurrentPhaseOracleIdSection,
  evaluateCurrentPhaseOracleIds,
  P5_MATCH_NOTES,
  P5_REQUIRED_SUITE_IDS,
} from '../../oracle/oracle-lib.mjs'

/**
 * P5-O02: Oracle運用検証（Phase 5指示 §12.5）。
 * - 必須suite（P1-O01〜P5-O01）が各1件存在すること
 * - 証跡書込みが現行Phase（当時のP5）のみで、書込み先がartifacts/phase-5/oracle-result.mdだけであること
 * - 実行前後でartifacts/phase-1〜phase-4のSHA-256が不変であること
 *
 * Phase 6でOracle suite構成が変わった（6 suite・P6単独書込み）ため、この検証は
 * **Phase 5時点の構成をfixture（P5_SUITES_FIXTURE）として固定**し、同じ契約を検証し続ける
 * （Phase 6指示 §12冒頭、P4-O02 / P4-O03の前例。検証意味は変更・緩和しない）。
 * ライブ構成の検証はP6-O02（tests/domain/p6-review.test.ts）が担う。
 */

/** Phase 5時点のOracle suite構成（必須5 suite各1件・P5のみが証跡を書き込む） */
const P5_SUITES_FIXTURE: readonly {
  id: string
  javaFile: string
  expectedFile: string
  writeReportPath: readonly string[] | null
}[] = [
  { id: 'P1-O01', javaFile: 'OracleP1.java', expectedFile: 'expected-from-core.json', writeReportPath: null },
  { id: 'P2-O01', javaFile: 'OracleP2.java', expectedFile: 'expected-p2-from-core.json', writeReportPath: null },
  { id: 'P3-O01', javaFile: 'OracleP3.java', expectedFile: 'expected-p3-from-core.json', writeReportPath: null },
  { id: 'P4-O01', javaFile: 'OracleP4.java', expectedFile: 'expected-p4-from-core.json', writeReportPath: null },
  {
    id: 'P5-O01',
    javaFile: 'OracleP5.java',
    expectedFile: 'expected-p5-from-core.json',
    writeReportPath: ['artifacts', 'phase-5', 'oracle-result.md'],
  },
]

/** Phase 5時点の過去artifacts不変検証の対象 */
const P5_PAST_ARTIFACT_DIRS: readonly string[] = [
  'artifacts/phase-1',
  'artifacts/phase-2',
  'artifacts/phase-3',
  'artifacts/phase-4',
]

const P5_CURRENT_PHASE_SUITE_ID = 'P5-O01'
const P5_CURRENT_PHASE_REPORT_PATH = 'artifacts/phase-5/oracle-result.md'

const ALL_PASSED = P5_REQUIRED_SUITE_IDS.map((id: string) => ({ id, passed: true }))

const evaluateP5 = (suites: unknown, pastArtifactsUnchanged = true) =>
  evaluateCurrentPhaseOracleIds({
    suiteResults: ALL_PASSED,
    pastArtifactsUnchanged,
    suites,
    requiredSuiteIds: P5_REQUIRED_SUITE_IDS,
    currentPhaseSuiteId: P5_CURRENT_PHASE_SUITE_ID,
    currentPhaseReportPath: P5_CURRENT_PHASE_REPORT_PATH,
  })

describe('P5-O02 Oracle運用検証（suite構成と書込み範囲）', () => {
  it('P5-O02: 必須5 suite（P1-O01〜P5-O01）が各1件存在し、証跡書込みは現行PhaseのP5のみである', () => {
    expect(P5_SUITES_FIXTURE.map((s) => s.id)).toEqual([
      'P1-O01',
      'P2-O01',
      'P3-O01',
      'P4-O01',
      'P5-O01',
    ])
    expect(P5_REQUIRED_SUITE_IDS).toEqual(['P1-O01', 'P2-O01', 'P3-O01', 'P4-O01', 'P5-O01'])
    for (const id of P5_REQUIRED_SUITE_IDS) {
      expect(P5_SUITES_FIXTURE.filter((s) => s.id === id), id).toHaveLength(1)
    }
    // 過去Phase suite（P1〜P4）は照合のみ。P4-O01の証跡書込みは停止済み
    for (const id of ['P1-O01', 'P2-O01', 'P3-O01', 'P4-O01']) {
      const suite = P5_SUITES_FIXTURE.find((s) => s.id === id)!
      expect(suite.writeReportPath, id).toBeNull()
    }
    // 書込みは現行Phase（P5-O01）ただ1件、書込み先はartifacts/phase-5/oracle-result.mdだけ
    const writers = P5_SUITES_FIXTURE.filter((s) => s.writeReportPath !== null)
    expect(writers).toHaveLength(1)
    expect(writers[0]?.id).toBe(P5_CURRENT_PHASE_SUITE_ID)
    expect(writers[0]?.writeReportPath).toEqual(['artifacts', 'phase-5', 'oracle-result.md'])
    expect(writers[0]?.writeReportPath?.join('/')).toBe(P5_CURRENT_PHASE_REPORT_PATH)
    // 過去Phase証跡へは書き込まない
    for (const suite of writers) {
      expect(suite.writeReportPath?.join('/')).not.toMatch(/phase-[1234]/)
    }
    // P5 suiteの実体
    const p5 = P5_SUITES_FIXTURE.find((s) => s.id === 'P5-O01')!
    expect(p5.javaFile).toBe('OracleP5.java')
    expect(p5.expectedFile).toBe('expected-p5-from-core.json')
    // P4-O02のLong境界値照合はP4 suiteへ適用し続ける（ID再定義はしない）
    expect(BOUNDARY_SUITE_ID).toBe('P4-O01')
  })

  it('P5-O02: 過去artifacts不変検証の対象へartifacts/phase-4が含まれ、対象ディレクトリが実在する', () => {
    expect(P5_PAST_ARTIFACT_DIRS).toEqual([
      'artifacts/phase-1',
      'artifacts/phase-2',
      'artifacts/phase-3',
      'artifacts/phase-4',
    ])
    // 当時の現行Phaseの証跡は不変検証の対象に含めない（書込み対象のため）
    expect(P5_PAST_ARTIFACT_DIRS).not.toContain('artifacts/phase-5')
    const projectRoot = path.join(__dirname, '../..')
    for (const dir of P5_PAST_ARTIFACT_DIRS) {
      const abs = path.join(projectRoot, dir)
      expect(statSync(abs).isDirectory(), dir).toBe(true)
      expect(readdirSync(abs).length, dir).toBeGreaterThan(0)
    }
  })

  it('P5-O02: suite構成の欠落・重複・書込み先異常をFAILと判定する', () => {
    // 正常なPhase 5時点の構成 → P5-O02 PASS
    const normal = evaluateP5(P5_SUITES_FIXTURE)
    expect(normal.requiredSuitesPresent).toBe(true)
    expect(normal.configOnlyCurrentPhaseWrites).toBe(true)
    expect(normal.o01Passed).toBe(true)
    expect(normal.o02Passed).toBe(true)
    expect(normal.overallPassed).toBe(true)
    // 必須suiteの欠落 → FAIL（P5だけ残ってもPASSにしない）
    for (const missingId of P5_REQUIRED_SUITE_IDS) {
      const missing = evaluateP5(P5_SUITES_FIXTURE.filter((s) => s.id !== missingId))
      expect(missing.requiredSuitesPresent, `${missingId} 欠落`).toBe(false)
      expect(missing.o02Passed, `${missingId} 欠落`).toBe(false)
      expect(missing.overallPassed, `${missingId} 欠落`).toBe(false)
    }
    // 重複 → FAIL
    const duplicated = evaluateP5([
      ...P5_SUITES_FIXTURE,
      P5_SUITES_FIXTURE.find((s) => s.id === 'P3-O01')!,
    ])
    expect(duplicated.requiredSuitesPresent).toBe(false)
    expect(duplicated.o02Passed).toBe(false)
    // 過去Phaseへ書き込む構成 → FAIL
    const p4Writes = evaluateP5(
      P5_SUITES_FIXTURE.map((s) =>
        s.id === 'P4-O01'
          ? { ...s, writeReportPath: ['artifacts', 'phase-4', 'oracle-result.md'] }
          : s,
      ),
    )
    expect(p4Writes.configOnlyCurrentPhaseWrites).toBe(false)
    expect(p4Writes.o02Passed).toBe(false)
    // 現行Phaseの書込み先が想定外 → FAIL
    const wrongTarget = evaluateP5(
      P5_SUITES_FIXTURE.map((s) =>
        s.id === 'P5-O01'
          ? { ...s, writeReportPath: ['artifacts', 'phase-4', 'oracle-result.md'] }
          : s,
      ),
    )
    expect(wrongTarget.configOnlyCurrentPhaseWrites).toBe(false)
    expect(wrongTarget.o02Passed).toBe(false)
    // 過去artifactsが変化した実測 → FAIL
    const changed = evaluateP5(P5_SUITES_FIXTURE, false)
    expect(changed.o02Passed).toBe(false)
    expect(changed.overallPassed).toBe(false)
    // P5-O01の照合失敗 → FAIL
    const p5Failed = evaluateCurrentPhaseOracleIds({
      suiteResults: ALL_PASSED.map((r: { id: string; passed: boolean }) =>
        r.id === 'P5-O01' ? { ...r, passed: false } : r,
      ),
      pastArtifactsUnchanged: true,
      suites: P5_SUITES_FIXTURE,
      requiredSuiteIds: P5_REQUIRED_SUITE_IDS,
      currentPhaseSuiteId: P5_CURRENT_PHASE_SUITE_ID,
      currentPhaseReportPath: P5_CURRENT_PHASE_REPORT_PATH,
    })
    expect(p5Failed.o01Passed).toBe(false)
    expect(p5Failed.overallPassed).toBe(false)
    // 1件でも比較失敗があればコマンド全体が失敗する
    expect(allSuitesPassed(ALL_PASSED)).toBe(true)
    expect(allSuitesPassed([...ALL_PASSED.slice(0, 4), { id: 'P5-O01', passed: false }])).toBe(false)
    expect(allSuitesPassed([])).toBe(false)
  })

  it('P5-O02: 結果欄が実判定から生成され、レポートへ組み込まれる', () => {
    const regression = ['P4-O01: PASS（照合のみ・証跡書込みなし）']
    const p5Section = (pastArtifactsUnchanged: boolean) =>
      buildCurrentPhaseOracleIdSection({
        evaluation: evaluateP5(P5_SUITES_FIXTURE, pastArtifactsUnchanged),
        pastArtifactsUnchanged,
        regression,
        requiredSuiteIds: P5_REQUIRED_SUITE_IDS,
        currentPhaseReportPath: P5_CURRENT_PHASE_REPORT_PATH,
        phaseLabel: 'P5',
        matchIdLabel: 'P5-O01',
        operationsIdLabel: 'P5-O02',
        pastArtifactsLabel: 'artifacts/phase-1〜phase-4',
        pastPhasesLabel: 'P1〜P4',
        matchNotes: P5_MATCH_NOTES,
      }).join('\n')

    const passSection = p5Section(true)
    expect(passSection).toContain('- P5-O01: PASS')
    expect(passSection).toContain('- P5-O02: PASS')
    expect(passSection).toContain(
      '必須5 suite（P1-O01 / P2-O01 / P3-O01 / P4-O01 / P5-O01）が各1件存在（欠落・重複なし）: PASS',
    )
    expect(passSection).toContain('証跡書込みは現行Phase（P5）のみ')
    expect(passSection).toContain('artifacts/phase-5/oracle-result.md')
    expect(passSection).toContain('実行前後でartifacts/phase-1〜phase-4のSHA-256が不変: PASS')
    expect(passSection).toContain('総合判定: PASS')
    // 正規化がJDKのiteration order保証を意味しないことを明記する
    expect(passSection).toContain('JDKのiteration order保証を意味しない')
    expect(passSection).toContain('TreeMap（順序意味論あり）は正規化せず実順序のまま照合')
    expect(passSection).toContain('P4-O01: PASS（照合のみ・証跡書込みなし）')

    // FAIL側: 固定文字列のPASSを出力しない
    const failSection = p5Section(false)
    expect(failSection).toContain('- P5-O02: FAIL')
    expect(failSection).toContain('実行前後でartifacts/phase-1〜phase-4のSHA-256が不変: FAIL')
    expect(failSection).toContain('総合判定: FAIL')
  })
})
