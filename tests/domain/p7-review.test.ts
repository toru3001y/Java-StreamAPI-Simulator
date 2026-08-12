import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  allSuitesPassed,
  BOUNDARY_SUITE_ID,
  buildCurrentPhaseOracleIdSection,
  CURRENT_PHASE_REPORT_PATH,
  CURRENT_PHASE_SUITE_ID,
  evaluateCurrentPhaseOracleIds,
  PAST_ARTIFACT_DIRS,
  REQUIRED_SUITE_IDS,
  SUITES,
} from '../../oracle/oracle-lib.mjs'

/**
 * P7-O02: Oracle運用検証（Phase 7指示 §12.5）。
 * - 必須suite（P1-O01〜P7-O01の7件）が各1件存在すること
 * - 証跡書込みが現行Phase（P7）のみで、書込み先がartifacts/phase-7/oracle-result.mdだけであること
 * - 実行前後でartifacts/phase-1〜phase-6のSHA-256が不変であること（実測はrun-oracle.mjsが行う）
 *
 * JDKとの実照合はnpm run test:oracleが行い、こちらはsuite構成・書込み範囲の契約を機械検証する。
 * Phase 6時点の同契約はp6-review.test.tsがfixture構成を渡して検証し続ける。
 */

const ALL_PASSED = REQUIRED_SUITE_IDS.map((id: string) => ({ id, passed: true }))

describe('P7-O02 Oracle運用検証（suite構成と書込み範囲）', () => {
  it('P7-O02: 必須7 suite（P1-O01〜P7-O01）が各1件存在し、証跡書込みは現行PhaseのP7のみである', () => {
    expect(SUITES.map((s: { id: string }) => s.id)).toEqual([
      'P1-O01',
      'P2-O01',
      'P3-O01',
      'P4-O01',
      'P5-O01',
      'P6-O01',
      'P7-O01',
    ])
    expect(REQUIRED_SUITE_IDS).toEqual([
      'P1-O01',
      'P2-O01',
      'P3-O01',
      'P4-O01',
      'P5-O01',
      'P6-O01',
      'P7-O01',
    ])
    for (const id of REQUIRED_SUITE_IDS) {
      expect(SUITES.filter((s: { id: string }) => s.id === id), id).toHaveLength(1)
    }
    // 過去Phase suite（P1〜P6）は照合のみ。P6-O01の証跡書込みはPhase 7着手に伴い停止した
    for (const id of ['P1-O01', 'P2-O01', 'P3-O01', 'P4-O01', 'P5-O01', 'P6-O01']) {
      const suite = SUITES.find((s: { id: string }) => s.id === id)!
      expect(suite.writeReportPath, id).toBeNull()
    }
    // 書込みは現行Phase（P7-O01）ただ1件、書込み先はartifacts/phase-7/oracle-result.mdだけ
    const writers = SUITES.filter((s: { writeReportPath: unknown }) => s.writeReportPath !== null)
    expect(writers).toHaveLength(1)
    expect(writers[0]?.id).toBe(CURRENT_PHASE_SUITE_ID)
    expect(writers[0]?.writeReportPath).toEqual(['artifacts', 'phase-7', 'oracle-result.md'])
    expect(writers[0]?.writeReportPath?.join('/')).toBe(CURRENT_PHASE_REPORT_PATH)
    // 過去Phase証跡へは書き込まない
    for (const suite of writers) {
      expect(suite.writeReportPath?.join('/')).not.toMatch(/phase-[123456]/)
    }
    // P7 suiteの実体
    const p7 = SUITES.find((s: { id: string }) => s.id === 'P7-O01')!
    expect(p7.javaFile).toBe('OracleP7.java')
    expect(p7.expectedFile).toBe('expected-p7-from-core.json')
    // P4-O02のLong境界値照合はP4 suiteへ適用し続ける（ID再定義はしない）
    expect(BOUNDARY_SUITE_ID).toBe('P4-O01')
  })

  it('P7-O02: 過去artifacts不変検証の対象へartifacts/phase-6が含まれ、対象ディレクトリが実在する', () => {
    expect(PAST_ARTIFACT_DIRS).toEqual([
      'artifacts/phase-1',
      'artifacts/phase-2',
      'artifacts/phase-3',
      'artifacts/phase-4',
      'artifacts/phase-5',
      'artifacts/phase-6',
    ])
    // 現行Phaseの証跡は不変検証の対象に含めない（書込み対象のため）
    expect(PAST_ARTIFACT_DIRS).not.toContain('artifacts/phase-7')
    const projectRoot = path.join(__dirname, '../..')
    for (const dir of PAST_ARTIFACT_DIRS) {
      const abs = path.join(projectRoot, dir)
      expect(statSync(abs).isDirectory(), dir).toBe(true)
      expect(readdirSync(abs).length, dir).toBeGreaterThan(0)
    }
  })

  it('P7-O02: suite構成の欠落・重複・書込み先異常をFAILと判定する', () => {
    const evaluate = (suites: unknown, pastArtifactsUnchanged = true) =>
      evaluateCurrentPhaseOracleIds({
        suiteResults: ALL_PASSED,
        pastArtifactsUnchanged,
        suites,
      })
    // 正常なライブ構成 → P7-O02 PASS
    const normal = evaluate(SUITES)
    expect(normal.requiredSuitesPresent).toBe(true)
    expect(normal.configOnlyCurrentPhaseWrites).toBe(true)
    expect(normal.o01Passed).toBe(true)
    expect(normal.o02Passed).toBe(true)
    expect(normal.overallPassed).toBe(true)
    // 必須suiteの欠落 → FAIL
    for (const missingId of REQUIRED_SUITE_IDS) {
      const missing = evaluate(SUITES.filter((s: { id: string }) => s.id !== missingId))
      expect(missing.requiredSuitesPresent, `${missingId} 欠落`).toBe(false)
      expect(missing.o02Passed, `${missingId} 欠落`).toBe(false)
      expect(missing.overallPassed, `${missingId} 欠落`).toBe(false)
    }
    // 重複 → FAIL
    const duplicated = evaluate([...SUITES, SUITES.find((s: { id: string }) => s.id === 'P3-O01')!])
    expect(duplicated.requiredSuitesPresent).toBe(false)
    expect(duplicated.o02Passed).toBe(false)
    // 過去Phaseへ書き込む構成 → FAIL（P6-O01の書込み再開を検知する）
    const p6Writes = evaluate(
      SUITES.map((s: { id: string }) =>
        s.id === 'P6-O01'
          ? { ...s, writeReportPath: ['artifacts', 'phase-6', 'oracle-result.md'] }
          : s,
      ),
    )
    expect(p6Writes.configOnlyCurrentPhaseWrites).toBe(false)
    expect(p6Writes.o02Passed).toBe(false)
    // 現行Phaseの書込み先が想定外 → FAIL
    const wrongTarget = evaluate(
      SUITES.map((s: { id: string }) =>
        s.id === 'P7-O01'
          ? { ...s, writeReportPath: ['artifacts', 'phase-6', 'oracle-result.md'] }
          : s,
      ),
    )
    expect(wrongTarget.configOnlyCurrentPhaseWrites).toBe(false)
    expect(wrongTarget.o02Passed).toBe(false)
    // 過去artifactsが変化した実測 → FAIL
    const changed = evaluate(SUITES, false)
    expect(changed.o02Passed).toBe(false)
    expect(changed.overallPassed).toBe(false)
    // P7-O01の照合失敗 → FAIL
    const p7Failed = evaluateCurrentPhaseOracleIds({
      suiteResults: ALL_PASSED.map((r: { id: string; passed: boolean }) =>
        r.id === 'P7-O01' ? { ...r, passed: false } : r,
      ),
      pastArtifactsUnchanged: true,
    })
    expect(p7Failed.o01Passed).toBe(false)
    expect(p7Failed.overallPassed).toBe(false)
    // 1件でも比較失敗があればコマンド全体が失敗する
    expect(allSuitesPassed(ALL_PASSED)).toBe(true)
    expect(allSuitesPassed([...ALL_PASSED.slice(0, 6), { id: 'P7-O01', passed: false }])).toBe(false)
    expect(allSuitesPassed([])).toBe(false)
  })

  it('P7-O02: 結果欄が実判定から生成され、レポートへ組み込まれる', () => {
    const regression = ['P6-O01: PASS（照合のみ・証跡書込みなし）']
    const passSection = buildCurrentPhaseOracleIdSection({
      evaluation: evaluateCurrentPhaseOracleIds({
        suiteResults: ALL_PASSED,
        pastArtifactsUnchanged: true,
      }),
      pastArtifactsUnchanged: true,
      regression,
    }).join('\n')
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
    const failSection = buildCurrentPhaseOracleIdSection({
      evaluation: evaluateCurrentPhaseOracleIds({
        suiteResults: ALL_PASSED,
        pastArtifactsUnchanged: false,
      }),
      pastArtifactsUnchanged: false,
      regression,
    }).join('\n')
    expect(failSection).toContain('- P7-O02: FAIL')
    expect(failSection).toContain('実行前後でartifacts/phase-1〜phase-6のSHA-256が不変: FAIL')
    expect(failSection).toContain('総合判定: FAIL')
  })
})
