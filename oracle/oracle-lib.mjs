/**
 * Oracleランナーのテスト可能helper（Phase 4レビュー対応）。
 * - suite定義: 証跡を書き込むPhaseを`writeReportPath`で明示する。
 *   nullのsuite（過去Phase = P1〜P6）は既存期待値との照合だけを行い、artifactsへ書き込まない
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
    // Phase 5着手に伴い証跡書込みを停止した（artifacts/phase-4/oracle-result.mdは過去証跡として保持）。
    // 照合自体は回帰として継続実行し、P4-O02のLong境界値照合ロジックも引き続きこのsuiteへ適用する
    writeReportPath: null,
  },
  {
    id: 'P5-O01',
    javaFile: 'OracleP5.java',
    expectedFile: 'expected-p5-from-core.json',
    // Phase 6着手に伴い証跡書込みを停止した（artifacts/phase-5/oracle-result.mdは過去証跡として保持）。
    // 照合自体は回帰として継続実行する
    writeReportPath: null,
  },
  {
    id: 'P6-O01',
    javaFile: 'OracleP6.java',
    expectedFile: 'expected-p6-from-core.json',
    // Phase 7着手に伴い証跡書込みを停止した（artifacts/phase-6/oracle-result.mdは過去証跡として保持）。
    // 照合自体は回帰として継続実行する
    writeReportPath: null,
  },
  {
    id: 'P7-O01',
    javaFile: 'OracleP7.java',
    expectedFile: 'expected-p7-from-core.json',
    // Phase 8着手に伴い証跡書込みを停止した（artifacts/phase-7/oracle-result.mdは過去証跡として保持）。
    // 照合自体は回帰として継続実行する
    writeReportPath: null,
  },
  {
    id: 'P8-O01',
    javaFile: 'OracleP8.java',
    expectedFile: 'expected-p8-from-core.json',
    // 現行Phase（P8）だけが証跡を生成・更新する
    writeReportPath: ['artifacts', 'phase-8', 'oracle-result.md'],
  },
]

/** Phase 4時点の必須suite ID（P4-O03契約の検証で使用する。履歴として固定する） */
export const P4_REQUIRED_SUITE_IDS = ['P1-O01', 'P2-O01', 'P3-O01', 'P4-O01']

/** Phase 5時点の必須suite ID（P5-O02契約をfixtureで検証し続けるために固定する） */
export const P5_REQUIRED_SUITE_IDS = ['P1-O01', 'P2-O01', 'P3-O01', 'P4-O01', 'P5-O01']

/** Long境界値照合（P4-O02）を適用するsuite。ID再定義はしない */
export const BOUNDARY_SUITE_ID = 'P4-O01'

/** Phase 6時点の必須suite ID（P6-O02契約をfixtureで検証し続けるために固定する） */
export const P6_REQUIRED_SUITE_IDS = [
  'P1-O01',
  'P2-O01',
  'P3-O01',
  'P4-O01',
  'P5-O01',
  'P6-O01',
]

/** Phase 6時点の現行Phase構成（p6-review.test.tsのfixture固定化に使用する） */
export const P6_CURRENT_PHASE_SUITE_ID = 'P6-O01'
export const P6_CURRENT_PHASE_REPORT_PATH = 'artifacts/phase-6/oracle-result.md'

/** Phase 6時点の過去Phase証跡（当時の記載を保持する） */
export const P6_PAST_ARTIFACT_DIRS = [
  'artifacts/phase-1',
  'artifacts/phase-2',
  'artifacts/phase-3',
  'artifacts/phase-4',
  'artifacts/phase-5',
]

/** Phase 7時点の必須suite ID（P7-O02契約をfixtureで検証し続けるために固定する） */
export const P7_REQUIRED_SUITE_IDS = [
  'P1-O01',
  'P2-O01',
  'P3-O01',
  'P4-O01',
  'P5-O01',
  'P6-O01',
  'P7-O01',
]

/** Phase 7時点の現行Phase構成（p7-review.test.tsのfixture固定化に使用する） */
export const P7_CURRENT_PHASE_SUITE_ID = 'P7-O01'
export const P7_CURRENT_PHASE_REPORT_PATH = 'artifacts/phase-7/oracle-result.md'

/** Phase 7時点の過去Phase証跡（当時の記載を保持する） */
export const P7_PAST_ARTIFACT_DIRS = [
  'artifacts/phase-1',
  'artifacts/phase-2',
  'artifacts/phase-3',
  'artifacts/phase-4',
  'artifacts/phase-5',
  'artifacts/phase-6',
]

/** 現行Phaseのsuite（証跡を書き込む唯一のsuite） */
export const CURRENT_PHASE_SUITE_ID = 'P8-O01'
export const CURRENT_PHASE_REPORT_PATH = 'artifacts/phase-8/oracle-result.md'

/** 実行前後で不変であることを検証する過去Phase証跡（現行Phaseは含めない） */
export const PAST_ARTIFACT_DIRS = [
  'artifacts/phase-1',
  'artifacts/phase-2',
  'artifacts/phase-3',
  'artifacts/phase-4',
  'artifacts/phase-5',
  'artifacts/phase-6',
  'artifacts/phase-7',
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

/** 現行Phaseの必須suite ID（欠落・重複はFAIL。P8-O02が検証する） */
export const REQUIRED_SUITE_IDS = [
  'P1-O01',
  'P2-O01',
  'P3-O01',
  'P4-O01',
  'P5-O01',
  'P6-O01',
  'P7-O01',
  'P8-O01',
]

/**
 * Phase 4時点のOracle ID（P4-O01〜O03）契約の判定。
 *
 * Phase 5でsuite構成が変わった（5 suite・P5単独書込み）ため、この関数は
 * **Phase 4時点の構成をfixtureとして渡して**同じ契約を検証し続ける用途で使用する
 * （Phase 5指示 §12冒頭。検証意味は変更・緩和しない）。
 * ライブ構成の検証はevaluateCurrentPhaseOracleIds（P5-O02）が担う。
 */
export function evaluateOracleIds({
  suiteResults,
  expectedBoundary,
  actualBoundary,
  pastArtifactsUnchanged,
  suites = SUITES,
  requiredSuiteIds = P4_REQUIRED_SUITE_IDS,
  writerSuiteId = 'P4-O01',
  writerReportPath = 'artifacts/phase-4/oracle-result.md',
}) {
  const o01Passed = suiteResults.some((result) => result.id === 'P4-O01' && result.passed === true)
  const o02Passed = expectedBoundary?.ok === true && actualBoundary?.ok === true
  // 必須suiteが各1件（ちょうど1件）存在すること。欠落や重複はここでFAILになる
  const requiredSuitesPresent = requiredSuiteIds.every(
    (id) => suites.filter((suite) => suite.id === id).length === 1,
  )
  // 書込みは指定suiteのみ: writerが1件で、書込み先が指定パス、
  // かつそれ以外の全suiteがwriteReportPath: null（照合のみ）であること
  const writers = suites.filter((suite) => suite.writeReportPath != null)
  const configOnlyP4Writes =
    writers.length === 1 &&
    writers[0].id === writerSuiteId &&
    Array.isArray(writers[0].writeReportPath) &&
    writers[0].writeReportPath.join('/') === writerReportPath &&
    suites.filter((suite) => suite.id !== writerSuiteId).every((suite) => suite.writeReportPath === null)
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

/**
 * 現行Phase必須Oracle ID（P8-O01・P8-O02）の判定。固定文字列のPASSは出力せず、すべて実結果から導出する。
 * - P8-O01: 現行Phase suiteの照合結果（JDK 25実測値とSimulation Core期待値のJSON完全一致）
 * - P8-O02: 必須suite（P1-O01〜P8-O01）が各1件存在すること、証跡書込みが現行Phase（P8）のみで
 *           書込み先がartifacts/phase-8/oracle-result.mdだけであること、
 *           実行前後のartifacts/phase-1〜phase-7 SHA-256不変の実測結果、の3判定すべて
 *
 * Phase 5〜7時点の同契約は`suites` / `requiredSuiteIds` / `currentPhase*`へ
 * fixtureを渡して検証し続ける（P5-O02 / P6-O02 / P7-O02）。
 */
export function evaluateCurrentPhaseOracleIds({
  suiteResults,
  pastArtifactsUnchanged,
  suites = SUITES,
  requiredSuiteIds = REQUIRED_SUITE_IDS,
  currentPhaseSuiteId = CURRENT_PHASE_SUITE_ID,
  currentPhaseReportPath = CURRENT_PHASE_REPORT_PATH,
}) {
  const o01Passed = suiteResults.some(
    (result) => result.id === currentPhaseSuiteId && result.passed === true,
  )
  const requiredSuitesPresent = requiredSuiteIds.every(
    (id) => suites.filter((suite) => suite.id === id).length === 1,
  )
  const writers = suites.filter((suite) => suite.writeReportPath != null)
  const configOnlyCurrentPhaseWrites =
    writers.length === 1 &&
    writers[0].id === currentPhaseSuiteId &&
    Array.isArray(writers[0].writeReportPath) &&
    writers[0].writeReportPath.join('/') === currentPhaseReportPath &&
    suites
      .filter((suite) => suite.id !== currentPhaseSuiteId)
      .every((suite) => suite.writeReportPath === null)
  const o02Passed =
    requiredSuitesPresent && configOnlyCurrentPhaseWrites && pastArtifactsUnchanged === true
  return {
    o01Passed,
    o02Passed,
    requiredSuitesPresent,
    configOnlyCurrentPhaseWrites,
    overallPassed: o01Passed && o02Passed,
  }
}

const verdictOf = (passed) => (passed ? 'PASS' : 'FAIL')

/** Phase 5時点の照合方式の注記（fixture検証で使用する。当時の記載を保持する） */
export const P5_MATCH_NOTES = [
  'unordered結果の比較正規化: 順序意味論を持たないSet / Mapはキー・要素の表示文字列の辞書順へ正規化してから照合（正規化は比較のためだけであり、JDKのiteration order保証を意味しない）',
  'TreeMap（順序意味論あり）は正規化せず実順序のまま照合（順序自体が検証対象）',
  '数値は正規化後もJSON文字列表現で厳密照合（64bit境界値・±Infinityは10進文字列のまま比較）',
]

/** Phase 7（Gatherer実行）の照合方式の注記 */
export const P7_MATCH_NOTES = [
  '対象は§8.2の11ケース（standard 7 + emptySource 4）の実行結果。v0.9 §7の空入力表4行（windowFixed空 / windowSliding空 / scan空 / fold空）をすべて含む',
  'v0.9 §7の「導出」区分2件（scan空・fold空）は、導出と実測が食い違えばこの照合がFAILになる（scan空 → 出力0件、fold空 → Optional[初期値]）',
  '窓・要素のラベルはSimulation Coreのformat（formatSimValue）表記へ両側で揃えて厳密照合（Employee要素は`氏名（age=NN）`、String要素はクォート付き、Listは`[要素1, 要素2]`の再帰整形）',
  'longは3桁区切り + L表記（formatLongLiteral）へ両側で揃えて厳密照合し、numberへ変換しない',
  'gather出力要素のboxed型名（Integer / Long）はCoreのTypeRefから導出し、Java側は実値のgetClass().getSimpleName()と照合する（v0.9 §8.3の型適合表の裏取り）',
  '組み込み4種の構成要素実装（Greedy / defaultCombiner / defaultFinisher）はOBSERVATION行として厳密比較の対象外に置く（v0.9 §10-3。JDK内部実装を断定せず観測として記録する）',
]

/** Phase 8（Collectors.toMap実行）の照合方式の注記 */
export const P8_MATCH_NOTES = [
  '対象は§8.2の10ケース（standard 8 + emptySource 2）の実行結果と、partitioningBy空partitionの追加照合、v0.12のteeing(toMap(region, name, first, TreeMap::new), counting(), RegionIndex::new)（teeing branchへのtoMap配置。左branchはTreeMapのため実entry順で厳密比較）、およびv0.13の数値加算merge 3件（toMap(region, age, Integer::sum) / (region, salary, Long::sum) / (region, evaluation, Double::sum)）',
  'v0.13のDouble::sumは+演算子の素朴な加算（IEEE 754）でありCoreの加算と同一演算のため厳密照合できる（補償付き加算を使うCollectors.summingDouble系をDoubleStream照合対象外としたP6判断とは非対称。doubleの表記はformatDoubleLiteral / BigDecimal正規化で両側を揃える）',
  '順序保証のないMap（2・3引数版toMap・groupingBy）はキーの表示文字列の辞書順へ**正規化**してから照合する（返却Mapのentry反復順序はJDKの保証対象外であり照合契約にしない。正規化は比較のためだけであり、iteration order保証を意味しない）',
  'TreeMap（4引数版）だけは実entry順（中部 → 関東 → 関西）を厳密比較する（順序自体が検証対象）',
  'encounter order・mergeの適用順は返却Mapの反復順ではなく**結果値**で検証する（first / lastの結果差〔伊藤 / 山本〕が「(既存値, 新しい値)」の適用順を、concatの連結順〔伊藤, 渡辺, 山本〕が順次適用のencounter orderを実証する）',
  '2引数版の重複キーは例外**型のみ**を契約として照合する（assertThrows(IllegalStateException.class, …)相当）。実測の例外メッセージはOBSERVATION行として観測記録に保存し、厳密比較の対象にしない',
  'mergeFunctionの呼出し順はOBSERVATION行として記録し、厳密比較の対象にしない',
  'longは3桁区切り + L表記（formatLongLiteral）へ両側で揃えて厳密照合し、numberへ変換しない。Employee要素はCoreのformatSimValueと同じ`氏名（age=NN）`表記、String値はクォート付き表記へ揃える',
]

/** Phase 6（取込境界値）の照合方式の注記 */
export const P6_MATCH_NOTES = [
  '対象は取込相当candidate（Import Contractの前段検証を通した貼付JSON）の実行結果',
  'doubleはSimulation Coreのformat（formatDoubleLiteral）表記へ両側で揃えて厳密照合（JavaのDouble.toStringは1e-3未満・1e7以上で指数表記へ切り替わるため、1e-6 / 1e15をそのまま比較すると偽装不一致になる）',
  'longは3桁区切り + L表記（formatLongLiteral）へ両側で揃えて厳密照合し、numberへ変換しない',
  'DoubleStreamのsum / averageは照合対象外（JDKは補償付き加算、Simulation Coreのprimitive Stream集計は素朴加算のため）。double集計はCollectors側で照合する',
]

/**
 * oracle-result.mdへ出力するP4-O01〜O03の結果セクション。
 * evaluateOracleIdsの実判定から生成し、いずれかがFAILなら総合判定もFAILになる。
 */
export function buildOracleIdSection({
  evaluation,
  expectedBoundary,
  actualBoundary,
  pastArtifactsUnchanged,
  requiredSuiteIds = P4_REQUIRED_SUITE_IDS,
}) {
  return [
    '## P4必須Oracle IDの結果（P4-O01〜O03）',
    `- P4-O01: ${verdictOf(evaluation.o01Passed)}（JDK 25実測値とSimulation Core期待値のJSON完全一致）`,
    `- P4-O02: ${verdictOf(evaluation.o02Passed)}（Long境界値の損失なし照合）`,
    `  - Long.MAX_VALUE（空LongSummaryStatisticsのmin）: \`${LONG_MAX_STRING}\``,
    `  - Long.MIN_VALUE（空LongSummaryStatisticsのmax）: \`${LONG_MIN_STRING}\``,
    '  - 比較方式: 10進文字列のまま完全一致比較（JavaScript numberへ変換せず、1桁も損失しない）',
    `  - string型・正確値の検証（期待値 / 実測値）: ${verdictOf(expectedBoundary?.ok === true)} / ${verdictOf(actualBoundary?.ok === true)}`,
    `- P4-O03: ${verdictOf(evaluation.o03Passed)}（Oracle証跡書込みのP4限定）`,
    `  - 必須${requiredSuiteIds.length} suite（${requiredSuiteIds.join(' / ')}）が各1件存在（欠落・重複なし）: ${verdictOf(evaluation.requiredSuitesPresent)}`,
    `  - 書込みはP4のみ（P1〜P3はwriteReportPath: nullの照合のみ。書込み先はartifacts/phase-4/oracle-result.mdだけ）: ${verdictOf(evaluation.configOnlyP4Writes)}`,
    `  - 実行前後でartifacts/phase-1〜3のSHA-256が不変: ${verdictOf(pastArtifactsUnchanged === true)}`,
    `- 総合判定: ${verdictOf(evaluation.overallPassed)}（P4-O01〜O03のいずれかがFAILなら総合もFAIL）`,
  ]
}

/**
 * 現行Phaseのoracle-result.mdへ出力する「照合ID・運用検証ID」の結果セクション。
 * evaluateCurrentPhaseOracleIdsの実判定から生成し、いずれかがFAILなら総合判定もFAILになる。
 *
 * PhaseラベルとID名は引数で受け取る（既定は現行Phase = P8）。
 * Phase 5〜7時点の契約はfixture構成を渡して同じ関数で検証し続ける（Phase 8指示 §12冒頭）。
 */
export function buildCurrentPhaseOracleIdSection({
  evaluation,
  pastArtifactsUnchanged,
  regression,
  requiredSuiteIds = REQUIRED_SUITE_IDS,
  currentPhaseReportPath = CURRENT_PHASE_REPORT_PATH,
  phaseLabel = 'P8',
  matchIdLabel = 'P8-O01',
  operationsIdLabel = 'P8-O02',
  pastArtifactsLabel = 'artifacts/phase-1〜phase-7',
  pastPhasesLabel = 'P1〜P7',
  matchNotes = P8_MATCH_NOTES,
}) {
  return [
    `## ${phaseLabel}必須Oracle IDの結果（${matchIdLabel}・${operationsIdLabel}）`,
    `- ${matchIdLabel}: ${verdictOf(evaluation.o01Passed)}（JDK 25実測値とSimulation Core期待値のJSON完全一致）`,
    ...matchNotes.map((note) => `  - ${note}`),
    `- ${operationsIdLabel}: ${verdictOf(evaluation.o02Passed)}（Oracle運用検証）`,
    `  - 必須${requiredSuiteIds.length} suite（${requiredSuiteIds.join(' / ')}）が各1件存在（欠落・重複なし）: ${verdictOf(evaluation.requiredSuitesPresent)}`,
    `  - 証跡書込みは現行Phase（${phaseLabel}）のみ（書込み先は${currentPhaseReportPath}だけ。${pastPhasesLabel}はwriteReportPath: nullの照合のみ）: ${verdictOf(evaluation.configOnlyCurrentPhaseWrites)}`,
    `  - 実行前後で${pastArtifactsLabel}のSHA-256が不変: ${verdictOf(pastArtifactsUnchanged === true)}`,
    '',
    '## 過去Phase suiteの回帰結果（照合のみ・証跡書込みなし）',
    ...regression.map((line) => `- ${line}`),
    '',
    `- 総合判定: ${verdictOf(evaluation.overallPassed)}（${matchIdLabel}・${operationsIdLabel}のいずれかがFAILなら総合もFAIL）`,
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
