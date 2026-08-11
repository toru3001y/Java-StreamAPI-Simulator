/**
 * JDK 25 Oracle照合ランナー。
 * Docker上のJDK 25でOracleP1〜P5.javaを実行し、
 * Simulation Core由来の期待値（expected-*.json）と照合する。
 * 期待値ファイルとSimulation Coreの一致は tests/domain/*oracleSync* テストで保証する。
 *
 * 過去Phase suite（P1〜P4）は照合だけを行い、証跡ファイル（artifacts/phase-1〜phase-4）へは
 * 書き込まない。証跡を書き込むのは`writeReportPath`を持つsuite（現行Phase = P5のみ）である
 * （oracle-lib.mjs参照）。P4-O02のLong境界値照合ロジックはP4 suiteへ適用し続ける（ID再定義はしない）。
 * 過去Phase証跡の不変性は、全suite実行前後のSHA-256実測比較で確認し、
 * その実結果をP5-O02としてoracle-result.mdへ記録する（P5-O01・P5-O02の結果欄は
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
  BOUNDARY_SUITE_ID,
  buildCurrentPhaseOracleIdSection,
  buildReport,
  compareOracle,
  CURRENT_PHASE_SUITE_ID,
  evaluateCurrentPhaseOracleIds,
  LONG_MAX_STRING,
  LONG_MIN_STRING,
  PAST_ARTIFACT_DIRS,
  SUITES,
  verifyLongBoundaryStrings,
} from './oracle-lib.mjs'

const oracleDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.dirname(oracleDir)
const IMAGE = 'gradle:9.6.1-jdk25'
const MARKER = '---RESULT---'

/** artifacts/phase-1〜phase-4全ファイルのSHA-256一覧（パス昇順の安定形式） */
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
/** Long境界値照合（P4-O02）を適用するsuiteの記録 */
let boundaryContext = null
/** 証跡を書き込む現行Phase suiteの記録 */
let currentPhaseContext = null

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

  // P4-O02: 64bit境界値がstringのまま損失なく保持されていることを期待値・実測値の双方で検証する
  // （Phase 5でもP4 suiteへ適用し続ける。ID再定義はしない）
  if (suite.id === BOUNDARY_SUITE_ID) {
    const expectedBoundary = verifyLongBoundaryStrings(expected)
    const actualBoundary = verifyLongBoundaryStrings(actual)
    if (!expectedBoundary.ok || !actualBoundary.ok) {
      passed = false
      console.error(`${suite.id} FAILED: Long境界値の検証に失敗しました。`)
      if (!expectedBoundary.ok) console.error(`  expected: ${expectedBoundary.reason}`)
      if (!actualBoundary.ok) console.error(`  actual: ${actualBoundary.reason}`)
    }
    boundaryContext = { suite, expectedBoundary, actualBoundary }
  }

  if (suite.id === CURRENT_PHASE_SUITE_ID) {
    // 現行Phaseのレポートは過去証跡不変の実測（P5-O02）確定後に生成するため、ここでは記録だけ行う
    currentPhaseContext = {
      suite,
      versionText: (versionPart ?? '').trim(),
      comparison,
      observations,
    }
  } else {
    // 過去Phase suite: 照合のみ。レポートは標準出力へ表示するだけで、artifactsへ書き込まない
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

// 全suite実行後に過去Phase証跡のSHA-256を再取得し、不変であることを実測する（P5-O02）
const pastArtifactsAfter = hashPastArtifacts()
const pastArtifactsUnchanged = pastArtifactsBefore === pastArtifactsAfter
if (!pastArtifactsUnchanged) {
  console.error(
    `P5-O02 FAILED: Oracle実行前後で${PAST_ARTIFACT_DIRS.join(' / ')}のSHA-256が変化しました。`,
  )
}

if (!currentPhaseContext) {
  console.error(`${CURRENT_PHASE_SUITE_ID} suiteが実行されていません。`)
  process.exit(1)
}
if (!boundaryContext) {
  console.error(`${BOUNDARY_SUITE_ID} suiteが実行されていません（P4-O02の回帰に必要）。`)
  process.exit(1)
}

const evaluation = evaluateCurrentPhaseOracleIds({
  suiteResults: results,
  pastArtifactsUnchanged,
})

// 過去Phase suiteの回帰結果（P4-O02のLong境界値照合を含む）
const p4Passed = results.find((result) => result.id === BOUNDARY_SUITE_ID)?.passed ?? false
const boundaryOk =
  boundaryContext.expectedBoundary.ok === true && boundaryContext.actualBoundary.ok === true
const regression = [
  ...results
    .filter((result) => result.id !== CURRENT_PHASE_SUITE_ID)
    .map((result) => `${result.id}: ${result.passed ? 'PASS' : 'FAIL'}（照合のみ・証跡書込みなし）`),
  `P4-O02（Long境界値の損失なし照合をP4 suiteへ適用）: ${boundaryOk ? 'PASS' : 'FAIL'}`
    + `（Long.MAX_VALUE=\`${LONG_MAX_STRING}\` / Long.MIN_VALUE=\`${LONG_MIN_STRING}\`を10進文字列のまま比較）`,
]

const report = buildReport({
  suiteId: currentPhaseContext.suite.id,
  image: IMAGE,
  javaFile: currentPhaseContext.suite.javaFile,
  versionText: currentPhaseContext.versionText,
  expectedText: currentPhaseContext.comparison.expectedText,
  actualText: currentPhaseContext.comparison.actualText,
  passed: results.find((result) => result.id === CURRENT_PHASE_SUITE_ID)?.passed ?? false,
  observations: currentPhaseContext.observations,
  extraSections: [
    ...buildCurrentPhaseOracleIdSection({
      evaluation,
      pastArtifactsUnchanged,
      regression,
    }),
    '',
    '## 関連する機械検証',
    '- P5-O01（期待値とSimulation Coreの一致・unordered正規化）: `tests/domain/p5-oracleSync.test.ts`',
    '- P5-O02（必須5 suite・現行Phase単独書込み・過去artifacts不変の構成検証）: `tests/domain/p5-review.test.ts`',
    '- P4-O02 / P4-O03（Phase 4時点のsuite構成契約をfixtureで固定して検証）: `tests/domain/p4-review.test.ts`',
    '- 過去Phase期待値とSimulation Coreの一致: `tests/domain/p4-oracleSync.test.ts` 他',
  ],
})

// 証跡ファイルはwriteReportPathを持つsuite（現行Phase = P5）だけが更新する
const reportFile = path.join(projectRoot, ...currentPhaseContext.suite.writeReportPath)
mkdirSync(path.dirname(reportFile), { recursive: true })
writeFileSync(reportFile, report, 'utf8')
console.log(report)
console.log(evaluation.o01Passed ? 'P5-O01 PASSED' : 'P5-O01 FAILED')
console.log(evaluation.o02Passed ? 'P5-O02 PASSED' : 'P5-O02 FAILED')
console.log(p4Passed && boundaryOk ? 'P4-O01/P4-O02 REGRESSION PASSED' : 'P4-O01/P4-O02 REGRESSION FAILED')

if (!allSuitesPassed(results) || !evaluation.overallPassed || !boundaryOk) {
  console.error('Oracle照合に失敗したケースがあります。')
  process.exit(1)
}
