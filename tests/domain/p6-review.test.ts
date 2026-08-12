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
 * P6-O02: Oracle運用検証（Phase 6指示 §12.5）。
 * - 必須suite（P1-O01〜P6-O01）が各1件存在すること
 * - 証跡書込みが現行Phase（P6）のみで、書込み先がartifacts/phase-6/oracle-result.mdだけであること
 * - 実行前後でartifacts/phase-1〜phase-5のSHA-256が不変であること（実測はrun-oracle.mjsが行う）
 *
 * JDKとの実照合はnpm run test:oracleが行い、こちらはsuite構成・書込み範囲の契約を機械検証する。
 */

const ALL_PASSED = REQUIRED_SUITE_IDS.map((id: string) => ({ id, passed: true }))

describe('P6-O02 Oracle運用検証（suite構成と書込み範囲）', () => {
  it('P6-O02: 必須6 suite（P1-O01〜P6-O01）が各1件存在し、証跡書込みは現行PhaseのP6のみである', () => {
    expect(SUITES.map((s: { id: string }) => s.id)).toEqual([
      'P1-O01',
      'P2-O01',
      'P3-O01',
      'P4-O01',
      'P5-O01',
      'P6-O01',
    ])
    expect(REQUIRED_SUITE_IDS).toEqual([
      'P1-O01',
      'P2-O01',
      'P3-O01',
      'P4-O01',
      'P5-O01',
      'P6-O01',
    ])
    for (const id of REQUIRED_SUITE_IDS) {
      expect(SUITES.filter((s: { id: string }) => s.id === id), id).toHaveLength(1)
    }
    // 過去Phase suite（P1〜P5）は照合のみ。P5-O01の証跡書込みは停止済み
    for (const id of ['P1-O01', 'P2-O01', 'P3-O01', 'P4-O01', 'P5-O01']) {
      const suite = SUITES.find((s: { id: string }) => s.id === id)!
      expect(suite.writeReportPath, id).toBeNull()
    }
    // 書込みは現行Phase（P6-O01）ただ1件、書込み先はartifacts/phase-6/oracle-result.mdだけ
    const writers = SUITES.filter((s: { writeReportPath: unknown }) => s.writeReportPath !== null)
    expect(writers).toHaveLength(1)
    expect(writers[0]?.id).toBe(CURRENT_PHASE_SUITE_ID)
    expect(writers[0]?.writeReportPath).toEqual(['artifacts', 'phase-6', 'oracle-result.md'])
    expect(writers[0]?.writeReportPath?.join('/')).toBe(CURRENT_PHASE_REPORT_PATH)
    // 過去Phase証跡へは書き込まない
    for (const suite of writers) {
      expect(suite.writeReportPath?.join('/')).not.toMatch(/phase-[12345]/)
    }
    // P6 suiteの実体
    const p6 = SUITES.find((s: { id: string }) => s.id === 'P6-O01')!
    expect(p6.javaFile).toBe('OracleP6.java')
    expect(p6.expectedFile).toBe('expected-p6-from-core.json')
    // P4-O02のLong境界値照合はP4 suiteへ適用し続ける（ID再定義はしない）
    expect(BOUNDARY_SUITE_ID).toBe('P4-O01')
  })

  it('P6-O02: 過去artifacts不変検証の対象へartifacts/phase-5が含まれ、対象ディレクトリが実在する', () => {
    expect(PAST_ARTIFACT_DIRS).toEqual([
      'artifacts/phase-1',
      'artifacts/phase-2',
      'artifacts/phase-3',
      'artifacts/phase-4',
      'artifacts/phase-5',
    ])
    // 現行Phaseの証跡は不変検証の対象に含めない（書込み対象のため）
    expect(PAST_ARTIFACT_DIRS).not.toContain('artifacts/phase-6')
    const projectRoot = path.join(__dirname, '../..')
    for (const dir of PAST_ARTIFACT_DIRS) {
      const abs = path.join(projectRoot, dir)
      expect(statSync(abs).isDirectory(), dir).toBe(true)
      expect(readdirSync(abs).length, dir).toBeGreaterThan(0)
    }
  })

  it('P6-O02: suite構成の欠落・重複・書込み先異常をFAILと判定する', () => {
    const evaluate = (suites: unknown, pastArtifactsUnchanged = true) =>
      evaluateCurrentPhaseOracleIds({
        suiteResults: ALL_PASSED,
        pastArtifactsUnchanged,
        suites,
      })
    // 正常なライブ構成 → P6-O02 PASS
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
    // 過去Phaseへ書き込む構成 → FAIL
    const p5Writes = evaluate(
      SUITES.map((s: { id: string }) =>
        s.id === 'P5-O01'
          ? { ...s, writeReportPath: ['artifacts', 'phase-5', 'oracle-result.md'] }
          : s,
      ),
    )
    expect(p5Writes.configOnlyCurrentPhaseWrites).toBe(false)
    expect(p5Writes.o02Passed).toBe(false)
    // 現行Phaseの書込み先が想定外 → FAIL
    const wrongTarget = evaluate(
      SUITES.map((s: { id: string }) =>
        s.id === 'P6-O01'
          ? { ...s, writeReportPath: ['artifacts', 'phase-5', 'oracle-result.md'] }
          : s,
      ),
    )
    expect(wrongTarget.configOnlyCurrentPhaseWrites).toBe(false)
    expect(wrongTarget.o02Passed).toBe(false)
    // 過去artifactsが変化した実測 → FAIL
    const changed = evaluate(SUITES, false)
    expect(changed.o02Passed).toBe(false)
    expect(changed.overallPassed).toBe(false)
    // P6-O01の照合失敗 → FAIL
    const p6Failed = evaluateCurrentPhaseOracleIds({
      suiteResults: ALL_PASSED.map((r: { id: string; passed: boolean }) =>
        r.id === 'P6-O01' ? { ...r, passed: false } : r,
      ),
      pastArtifactsUnchanged: true,
    })
    expect(p6Failed.o01Passed).toBe(false)
    expect(p6Failed.overallPassed).toBe(false)
    // 1件でも比較失敗があればコマンド全体が失敗する
    expect(allSuitesPassed(ALL_PASSED)).toBe(true)
    expect(allSuitesPassed([...ALL_PASSED.slice(0, 5), { id: 'P6-O01', passed: false }])).toBe(false)
    expect(allSuitesPassed([])).toBe(false)
  })

  it('P6-O02: 結果欄が実判定から生成され、レポートへ組み込まれる', () => {
    const regression = ['P5-O01: PASS（照合のみ・証跡書込みなし）']
    const passSection = buildCurrentPhaseOracleIdSection({
      evaluation: evaluateCurrentPhaseOracleIds({
        suiteResults: ALL_PASSED,
        pastArtifactsUnchanged: true,
      }),
      pastArtifactsUnchanged: true,
      regression,
    }).join('\n')
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
    const failSection = buildCurrentPhaseOracleIdSection({
      evaluation: evaluateCurrentPhaseOracleIds({
        suiteResults: ALL_PASSED,
        pastArtifactsUnchanged: false,
      }),
      pastArtifactsUnchanged: false,
      regression,
    }).join('\n')
    expect(failSection).toContain('- P6-O02: FAIL')
    expect(failSection).toContain('実行前後でartifacts/phase-1〜phase-5のSHA-256が不変: FAIL')
    expect(failSection).toContain('総合判定: FAIL')
  })
})
