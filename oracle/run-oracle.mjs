/**
 * P1-O01: Docker上のJDK 25でOracleP1.javaを実行し、
 * Simulation Core由来の期待値（expected-from-core.json）と照合する。
 * expected-from-core.jsonとSimulation Coreの一致は tests/domain/oracleSync.test.ts で保証する。
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

const expected = JSON.parse(readFileSync(path.join(oracleDir, 'expected-from-core.json'), 'utf8'))

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
      `java -version 2>&1; echo ${MARKER}; java -Dfile.encoding=UTF-8 OracleP1.java`,
    ],
    { encoding: 'utf8', timeout: 300_000 },
  )
} catch (error) {
  console.error('P1-O01 FAILED: Dockerの実行に失敗しました。')
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
  console.error(`P1-O01 FAILED: JDK出力をJSONとして解釈できません: ${jsonLine}`)
  process.exit(1)
}

const expectedText = JSON.stringify(expected)
const actualText = JSON.stringify(actual)
const passed = expectedText === actualText

const report = [
  '# P1-O01 JDK 25 Oracle Test 結果',
  '',
  `実行日時: ${new Date().toISOString()}`,
  `Dockerイメージ: ${IMAGE}`,
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

mkdirSync(path.join(projectRoot, 'artifacts', 'phase-1'), { recursive: true })
writeFileSync(path.join(projectRoot, 'artifacts', 'phase-1', 'oracle-result.md'), report, 'utf8')

console.log(report)
if (!passed) {
  console.error('P1-O01 FAILED: Simulation CoreとJDK 25の結果が一致しません。')
  process.exit(1)
}
console.log('P1-O01 PASSED')
