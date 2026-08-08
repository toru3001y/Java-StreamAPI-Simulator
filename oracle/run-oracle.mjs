/**
 * JDK 25 Oracle照合ランナー。
 * Docker上のJDK 25でOracleP1〜P4.javaを実行し、
 * Simulation Core由来の期待値（expected-*.json）と照合する。
 * 期待値ファイルとSimulation Coreの一致は tests/domain/*oracleSync* テストで保証する。
 *
 * P1〜P3は照合だけを行い、証跡ファイル（artifacts/phase-1〜3）へは書き込まない。
 * 証跡を書き込むのは`writeReportPath`を持つsuite（P4のみ）である（oracle-lib.mjs参照）。
 * いずれかのsuiteが失敗した場合はコマンド全体を失敗させる。
 *
 * 再実行手順: npm run test:oracle
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  allSuitesPassed,
  buildReport,
  compareOracle,
  LONG_MAX_STRING,
  LONG_MIN_STRING,
  SUITES,
  verifyLongBoundaryStrings,
} from './oracle-lib.mjs'

const oracleDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.dirname(oracleDir)
const IMAGE = 'gradle:9.6.1-jdk25'
const MARKER = '---RESULT---'

const results = []

for (const suite of SUITES) {
  const expected = JSON.parse(readFileSync(path.join(oracleDir, suite.expectedFile), 'utf8'))
  let output
  try {
    output = execFileSync(
      'docker',
      [
        'run',
        '--rm',
        '-v',
        `${oracleDir}:/work:ro`,
        '-w',
        '/work',
        IMAGE,
        'sh',
        '-c',
        `java -version 2>&1; echo ${MARKER}; java -Dfile.encoding=UTF-8 ${suite.javaFile}`,
      ],
      { encoding: 'utf8', timeout: 300_000 },
    )
  } catch (error) {
    console.error(`${suite.id} FAILED: Dockerの実行に失敗しました。`)
    console.error(String(error.stdout ?? ''))
    console.error(String(error.stderr ?? error.message))
    process.exit(1)
  }

  const [versionPart, resultPart] = output.split(MARKER)
  const resultLines = (resultPart ?? '').trim().split('\n').filter(Boolean)
  const jsonLine = resultLines.pop() ?? ''
  // OBSERVATION行は厳密比較の対象外の観測記録（findAnyの要素、peek + countの呼出し回数等）
  const observations = resultLines.filter((line) => line.startsWith('OBSERVATION:'))
  let actual
  try {
    actual = JSON.parse(jsonLine)
  } catch {
    console.error(`${suite.id} FAILED: JDK出力をJSONとして解釈できません: ${jsonLine}`)
    process.exit(1)
  }

  const comparison = compareOracle(expected, actual)
  let passed = comparison.passed
  const extraSections = []

  // P4: 64bit境界値がstringのまま損失なく保持されていることを期待値・実測値の双方で検証する
  if (suite.id === 'P4-O01') {
    const expectedBoundary = verifyLongBoundaryStrings(expected)
    const actualBoundary = verifyLongBoundaryStrings(actual)
    if (!expectedBoundary.ok || !actualBoundary.ok) {
      passed = false
      console.error(`${suite.id} FAILED: Long境界値の検証に失敗しました。`)
      if (!expectedBoundary.ok) console.error(`  expected: ${expectedBoundary.reason}`)
      if (!actualBoundary.ok) console.error(`  actual: ${actualBoundary.reason}`)
    }
    extraSections.push(
      '## Long境界値の照合（P4-O02の照合対象）',
      `- Long.MAX_VALUE（空LongSummaryStatisticsのmin）: \`${LONG_MAX_STRING}\``,
      `- Long.MIN_VALUE（空LongSummaryStatisticsのmax）: \`${LONG_MIN_STRING}\``,
      '- 10進文字列として出力・比較し、JavaScript numberへ変換していない（1桁も損失しない）',
      `- 期待値・実測値双方のstring型検証: ${expectedBoundary.ok && actualBoundary.ok ? 'PASS' : 'FAIL'}`,
      '',
      '## 関連する機械検証',
      '- P4-O02（Long境界値の損失なし照合・近接誤値の不一致判定）: `tests/domain/p4-review.test.ts`',
      '- P4-O03（P1〜P3は照合のみ・P4だけ証跡書込み）: `tests/domain/p4-review.test.ts`',
      '- 期待値とSimulation Coreの一致: `tests/domain/p4-oracleSync.test.ts`',
    )
  }

  results.push({ id: suite.id, passed })

  const report = buildReport({
    suiteId: suite.id,
    image: IMAGE,
    javaFile: suite.javaFile,
    versionText: (versionPart ?? '').trim(),
    expectedText: comparison.expectedText,
    actualText: comparison.actualText,
    passed,
    observations,
    extraSections,
  })

  // 証跡ファイルはwriteReportPathを持つsuite（P4）だけが更新する。
  // P1〜P3は照合のみ（標準出力への表示だけを行い、artifactsへ書き込まない）
  if (suite.writeReportPath) {
    const reportFile = path.join(projectRoot, ...suite.writeReportPath)
    mkdirSync(path.dirname(reportFile), { recursive: true })
    writeFileSync(reportFile, report, 'utf8')
  }
  console.log(report)
  console.log(passed ? `${suite.id} PASSED` : `${suite.id} FAILED`)
}

if (!allSuitesPassed(results)) {
  console.error('Oracle照合に失敗したケースがあります。')
  process.exit(1)
}
