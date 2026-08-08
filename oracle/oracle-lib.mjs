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
