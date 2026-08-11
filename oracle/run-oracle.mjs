/**
 * JDK 25 Oracle照合ランナー。
 * Docker上のJDK 25でOracleP1〜P4.javaを実行し、
 * Simulation Core由来の期待値（expected-*.json）と照合する。
 * 期待値ファイルとSimulation Coreの一致は tests/domain/*oracleSync* テストで保証する。
 *
 * P1〜P3は照合だけを行い、証跡ファイル（artifacts/phase-1〜3）へは書き込まない。
 * 証跡を書き込むのは`writeReportPath`を持つsuite（P4のみ）である（oracle-lib.mjs参照）。
 * 過去Phase証跡の不変性は、全suite実行前後のSHA-256実測比較で確認し、
 * その実結果をP4-O03としてoracle-result.mdへ記録する（P4-O01〜O03の結果欄は
 * すべて実測から生成し、いずれかがFAILならコマンド全体を失敗させる）。
 *
 * 再実行手順: npm run test:oracle
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  allSuitesPassed,
  buildOracleIdSection,
  buildReport,
  compareOracle,
  evaluateOracleIds,
  SUITES,
  verifyLongBoundaryStrings,
} from './oracle-lib.mjs'

const oracleDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.dirname(oracleDir)
const IMAGE = 'gradle:9.6.1-jdk25'
const MARKER = '---RESULT---'

/** 過去Phase証跡ディレクトリ（照合のみ。書込み・復元の対象にしない） */
const PAST_ARTIFACT_DIRS = ['artifacts/phase-1', 'artifacts/phase-2', 'artifacts/phase-3']

/** artifacts/phase-1〜3全ファイルのSHA-256一覧（パス昇順の安定形式） */
function hashPastArtifacts() {
  const lines = []
  for (const dir of PAST_ARTIFACT_DIRS) {
    const absDir = path.join(projectRoot, dir)
    const files = readdirSync(absDir, { recursive: true })
      .map(String)
      .filter((file) => statSync(path.join(absDir, file)).isFile())
      .sort()
    for (const file of files) {
      const digest = createHash('sha256').update(readFileSync(path.join(absDir, file))).digest('hex')
      lines.push(`${digest}  ${dir}/${file.replace(/\\/g, '/')}`)
    }
  }
  return lines.join('\n')
}

const pastArtifactsBefore = hashPastArtifacts()

const results = []
let p4Context = null

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
    // P4レポートはP4-O03（過去証跡不変の実測）確定後に生成するため、ここでは記録だけ行う
    p4Context = {
      suite,
      versionText: (versionPart ?? '').trim(),
      comparison,
      observations,
      expectedBoundary,
      actualBoundary,
    }
  } else {
    // P1〜P3: 照合のみ。レポートは標準出力へ表示するだけで、artifactsへ書き込まない
    const report = buildReport({
      suiteId: suite.id,
      image: IMAGE,
      javaFile: suite.javaFile,
      versionText: (versionPart ?? '').trim(),
      expectedText: comparison.expectedText,
      actualText: comparison.actualText,
      passed,
      observations,
      extraSections: [],
    })
    console.log(report)
    console.log(passed ? `${suite.id} PASSED` : `${suite.id} FAILED`)
  }

  results.push({ id: suite.id, passed })
}

// 全suite実行後に過去Phase証跡のSHA-256を再取得し、不変であることを実測する（P4-O03）
const pastArtifactsAfter = hashPastArtifacts()
const pastArtifactsUnchanged = pastArtifactsBefore === pastArtifactsAfter
if (!pastArtifactsUnchanged) {
  console.error('P4-O03 FAILED: Oracle実行前後でartifacts/phase-1〜3のSHA-256が変化しました。')
}

if (!p4Context) {
  console.error('P4-O01 suiteが実行されていません。')
  process.exit(1)
}

const evaluation = evaluateOracleIds({
  suiteResults: results,
  expectedBoundary: p4Context.expectedBoundary,
  actualBoundary: p4Context.actualBoundary,
  pastArtifactsUnchanged,
})

const p4Report = buildReport({
  suiteId: p4Context.suite.id,
  image: IMAGE,
  javaFile: p4Context.suite.javaFile,
  versionText: p4Context.versionText,
  expectedText: p4Context.comparison.expectedText,
  actualText: p4Context.comparison.actualText,
  passed: results.find((result) => result.id === 'P4-O01')?.passed ?? false,
  observations: p4Context.observations,
  extraSections: [
    ...buildOracleIdSection({
      evaluation,
      expectedBoundary: p4Context.expectedBoundary,
      actualBoundary: p4Context.actualBoundary,
      pastArtifactsUnchanged,
    }),
    '',
    '## 関連する機械検証',
    '- P4-O02（Long境界値の損失なし照合・近接誤値の不一致判定・結果欄の生成検証）: `tests/domain/p4-review.test.ts`',
    '- P4-O03（P1〜P3は照合のみ・P4だけ証跡書込み・結果欄の生成検証）: `tests/domain/p4-review.test.ts`',
    '- 期待値とSimulation Coreの一致: `tests/domain/p4-oracleSync.test.ts`',
  ],
})

// 証跡ファイルはwriteReportPathを持つsuite（P4）だけが更新する
const reportFile = path.join(projectRoot, ...p4Context.suite.writeReportPath)
mkdirSync(path.dirname(reportFile), { recursive: true })
writeFileSync(reportFile, p4Report, 'utf8')
console.log(p4Report)
console.log(evaluation.o01Passed ? 'P4-O01 PASSED' : 'P4-O01 FAILED')
console.log(evaluation.o02Passed ? 'P4-O02 PASSED' : 'P4-O02 FAILED')
console.log(evaluation.o03Passed ? 'P4-O03 PASSED' : 'P4-O03 FAILED')

if (!allSuitesPassed(results) || !evaluation.overallPassed) {
  console.error('Oracle照合に失敗したケースがあります。')
  process.exit(1)
}
