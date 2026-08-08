/**
 * Oracleランナーのテスト可能helper（Phase 4レビュー対応）。
 * - suite定義: 証跡を書き込むPhaseを`writeReportPath`で明示する。
 *   nullのsuite（P1〜P3）は既存期待値との照合だけを行い、artifactsへ書き込まない
 *   （過去Phase証跡を書き換えてからrestoreする方式は使用しない）。
 * - 64bit境界値（Long.MAX_VALUE / Long.MIN_VALUE）は10進文字列として比較し、
 *   JavaScript numberへの変換による精度損失を発生させない。
 */
export const SUITES = [
  {
    id: 'P1-O01',
    javaFile: 'OracleP1.java',
    expectedFile: 'expected-from-core.json',
    // 照合のみ。artifacts/phase-1へは書き込まない
    writeReportPath: null,
  },
  {
    id: 'P2-O01',
    javaFile: 'OracleP2.java',
    expectedFile: 'expected-p2-from-core.json',
    writeReportPath: null,
  },
  {
    id: 'P3-O01',
    javaFile: 'OracleP3.java',
    expectedFile: 'expected-p3-from-core.json',
    writeReportPath: null,
  },
  {
    id: 'P4-O01',
    javaFile: 'OracleP4.java',
    expectedFile: 'expected-p4-from-core.json',
    // P4だけが証跡を生成・更新する
    writeReportPath: ['artifacts', 'phase-4', 'oracle-result.md'],
  },
]

/** Long境界値の正確な10進文字列（1桁も失わない比較の基準） */
export const LONG_MAX_STRING = '9223372036854775807'
export const LONG_MIN_STRING = '-9223372036854775808'

/**
 * 期待値・実測値の比較。JSON.stringifyの完全一致で判定する。
 * 文字列として保持された64bit値はそのまま文字列比較となり、丸めは発生しない。
 */
export function compareOracle(expected, actual) {
  const expectedText = JSON.stringify(expected)
  const actualText = JSON.stringify(actual)
  return { expectedText, actualText, passed: expectedText === actualText }
}

/**
 * P4のLong境界値検証: statsLongEmptyのmin / maxがJSON.parse後も**string**であり、
 * Long.MAX_VALUE / Long.MIN_VALUEの正確な10進文字列と一致することを確認する。
 * numberへ変換された値（丸みを帯びた近似値）はここで不一致になる。
 */
export function verifyLongBoundaryStrings(json) {
  const stats = json?.statsLongEmpty
  if (!Array.isArray(stats)) {
    return { ok: false, reason: 'statsLongEmptyが配列ではありません' }
  }
  const min = stats[2]
  const max = stats[3]
  if (typeof min !== 'string' || typeof max !== 'string') {
    return {
      ok: false,
      reason: `statsLongEmptyのmin / maxはstringが必要です（実際: ${typeof min} / ${typeof max}）`,
    }
  }
  if (min !== LONG_MAX_STRING) {
    return { ok: false, reason: `空LongSummaryStatisticsのmin ${min} が ${LONG_MAX_STRING} と一致しません` }
  }
  if (max !== LONG_MIN_STRING) {
    return { ok: false, reason: `空LongSummaryStatisticsのmax ${max} が ${LONG_MIN_STRING} と一致しません` }
  }
  return { ok: true, reason: null }
}

/** 全suiteの成否集約: 1件でも失敗があればコマンド全体を失敗させる */
export function allSuitesPassed(results) {
  return results.length > 0 && results.every((result) => result.passed)
}

/**
 * P4必須Oracle ID（P4-O01〜O03）の判定。固定文字列のPASSは出力せず、すべて実結果から導出する。
 * - P4-O01: P4 suiteの照合結果（JDK 25実測値とSimulation Core期待値のJSON完全一致）
 * - P4-O02: verifyLongBoundaryStringsの実結果（期待値・実測値の双方がstringかつ正確な10進値）
 * - P4-O03: 必須4 suite（P1-O01〜P4-O01）が各1件存在するsuite構成であること、
 *           書込みがP4のみ（P1〜P3はwriteReportPath: nullで照合のみ）であること、
 *           実行前後のartifacts/phase-1〜3 SHA-256不変の実測結果、の3判定すべて
 */

/** P4-O03が要求する必須suite ID（欠落・重複はFAIL） */
export const REQUIRED_SUITE_IDS = ['P1-O01', 'P2-O01', 'P3-O01', 'P4-O01']

export function evaluateOracleIds({
  suiteResults,
  expectedBoundary,
  actualBoundary,
  pastArtifactsUnchanged,
  suites = SUITES,
}) {
  const o01Passed = suiteResults.some((result) => result.id === 'P4-O01' && result.passed === true)
  const o02Passed = expectedBoundary?.ok === true && actualBoundary?.ok === true
  // 必須4 suiteが各1件（ちょうど1件）存在すること。P1〜P3の欠落や重複はここでFAILになる
  const requiredSuitesPresent = REQUIRED_SUITE_IDS.every(
    (id) => suites.filter((suite) => suite.id === id).length === 1,
  )
  // 書込みはP4のみ: writerがP4-O01ただ1件で、書込み先がartifacts/phase-4/oracle-result.md、
  // かつP4以外の全suiteがwriteReportPath: null（照合のみ）であること
  const writers = suites.filter((suite) => suite.writeReportPath != null)
  const configOnlyP4Writes =
    writers.length === 1 &&
    writers[0].id === 'P4-O01' &&
    Array.isArray(writers[0].writeReportPath) &&
    writers[0].writeReportPath.join('/') === 'artifacts/phase-4/oracle-result.md' &&
    suites.filter((suite) => suite.id !== 'P4-O01').every((suite) => suite.writeReportPath === null)
  const o03Passed = requiredSuitesPresent && configOnlyP4Writes && pastArtifactsUnchanged === true
  return {
    o01Passed,
    o02Passed,
    o03Passed,
    requiredSuitesPresent,
    configOnlyP4Writes,
    overallPassed: o01Passed && o02Passed && o03Passed,
  }
}

const verdictOf = (passed) => (passed ? 'PASS' : 'FAIL')

/**
 * oracle-result.mdへ出力するP4-O01〜O03の結果セクション。
 * evaluateOracleIdsの実判定から生成し、いずれかがFAILなら総合判定もFAILになる。
 */
export function buildOracleIdSection({ evaluation, expectedBoundary, actualBoundary, pastArtifactsUnchanged }) {
  return [
    '## P4必須Oracle IDの結果（P4-O01〜O03）',
    `- P4-O01: ${verdictOf(evaluation.o01Passed)}（JDK 25実測値とSimulation Core期待値のJSON完全一致）`,
    `- P4-O02: ${verdictOf(evaluation.o02Passed)}（Long境界値の損失なし照合）`,
    `  - Long.MAX_VALUE（空LongSummaryStatisticsのmin）: \`${LONG_MAX_STRING}\``,
    `  - Long.MIN_VALUE（空LongSummaryStatisticsのmax）: \`${LONG_MIN_STRING}\``,
    '  - 比較方式: 10進文字列のまま完全一致比較（JavaScript numberへ変換せず、1桁も損失しない）',
    `  - string型・正確値の検証（期待値 / 実測値）: ${verdictOf(expectedBoundary?.ok === true)} / ${verdictOf(actualBoundary?.ok === true)}`,
    `- P4-O03: ${verdictOf(evaluation.o03Passed)}（Oracle証跡書込みのP4限定）`,
    `  - 必須4 suite（${REQUIRED_SUITE_IDS.join(' / ')}）が各1件存在（欠落・重複なし）: ${verdictOf(evaluation.requiredSuitesPresent)}`,
    `  - 書込みはP4のみ（P1〜P3はwriteReportPath: nullの照合のみ。書込み先はartifacts/phase-4/oracle-result.mdだけ）: ${verdictOf(evaluation.configOnlyP4Writes)}`,
    `  - 実行前後でartifacts/phase-1〜3のSHA-256が不変: ${verdictOf(pastArtifactsUnchanged === true)}`,
    `- 総合判定: ${verdictOf(evaluation.overallPassed)}（P4-O01〜O03のいずれかがFAILなら総合もFAIL）`,
  ]
}

/** Oracleレポート本文の生成（書込み対象suiteのみファイル化される） */
export function buildReport({
  suiteId,
  image,
  javaFile,
  versionText,
  expectedText,
  actualText,
  passed,
  observations,
  extraSections,
}) {
  return [
    `# ${suiteId} JDK 25 Oracle Test 結果`,
    '',
    `実行日時: ${new Date().toISOString()}`,
    `Dockerイメージ: ${image}`,
    `対象: ${javaFile}`,
    '',
    '## java -version',
    '```',
    versionText,
    '```',
    '',
    '## 照合結果',
    `- 期待値（Simulation Core由来）: ${expectedText}`,
    `- 実測値（JDK 25実行結果）    : ${actualText}`,
    `- 比較方式: JSON.parse後のオブジェクトをJSON.stringifyし文字列完全一致で判定（64bit境界値は10進文字列のまま比較し、numberへ変換しない）`,
    `- 判定: ${passed ? 'PASS（完全一致）' : 'FAIL（不一致）'}`,
    '',
    ...(observations.length > 0
      ? [
          '## 観測記録（厳密比較の対象外。JDKの保証として扱わない）',
          ...observations.map((line) => `- ${line.replace('OBSERVATION: ', '')}`),
          '',
        ]
      : []),
    ...(extraSections.length > 0 ? [...extraSections, ''] : []),
  ].join('\n')
}
