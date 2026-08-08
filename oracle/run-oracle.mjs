/**
 * JDK 25 Oracle照合ランナー。
 * Docker上のJDK 25でOracleP1.java / OracleP2.java / OracleP3.javaを実行し、
 * Simulation Core由来の期待値（expected-*.json）と照合する。
 * 期待値ファイルとSimulation Coreの一致は tests/domain/*oracleSync* テストで保証する。
 *
 * 再実行手順: npm run test:oracle
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const oracleDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.dirname(oracleDir)
const IMAGE = 'gradle:9.6.1-jdk25'
const MARKER = '---RESULT---'

const SUITES = [
  {
    id: 'P1-O01',
    javaFile: 'OracleP1.java',
    expectedFile: 'expected-from-core.json',
    reportPath: ['artifacts', 'phase-1', 'oracle-result.md'],
  },
  {
    id: 'P2-O01',
    javaFile: 'OracleP2.java',
    expectedFile: 'expected-p2-from-core.json',
    reportPath: ['artifacts', 'phase-2', 'oracle-result.md'],
  },
  {
    id: 'P3-O01',
    javaFile: 'OracleP3.java',
    expectedFile: 'expected-p3-from-core.json',
    reportPath: ['artifacts', 'phase-3', 'oracle-result.md'],
  },
]

let allPassed = true

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
  const jsonLine = (resultPart ?? '').trim().split('\n').filter(Boolean).pop() ?? ''
  let actual
  try {
    actual = JSON.parse(jsonLine)
  } catch {
    console.error(`${suite.id} FAILED: JDK出力をJSONとして解釈できません: ${jsonLine}`)
    process.exit(1)
  }

  const expectedText = JSON.stringify(expected)
  const actualText = JSON.stringify(actual)
  const passed = expectedText === actualText
  allPassed &&= passed

  const report = [
    `# ${suite.id} JDK 25 Oracle Test 結果`,
    '',
    `実行日時: ${new Date().toISOString()}`,
    `Dockerイメージ: ${IMAGE}`,
    `対象: ${suite.javaFile}`,
    '',
    '## java -version',
    '```',
    (versionPart ?? '').trim(),
    '```',
    '',
    '## 照合結果',
    `- 期待値（Simulation Core由来）: ${expectedText}`,
    `- 実測値（JDK 25実行結果）    : ${actualText}`,
    `- 判定: ${passed ? 'PASS（完全一致）' : 'FAIL（不一致）'}`,
    '',
  ].join('\n')

  const reportFile = path.join(projectRoot, ...suite.reportPath)
  mkdirSync(path.dirname(reportFile), { recursive: true })
  writeFileSync(reportFile, report, 'utf8')
  console.log(report)
  console.log(passed ? `${suite.id} PASSED` : `${suite.id} FAILED`)
}

if (!allPassed) {
  console.error('Oracle照合に失敗したケースがあります。')
  process.exit(1)
}
