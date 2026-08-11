import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  validateArrayGenerator,
  validateReductionIdentity,
  validateReductionStructure,
} from '../../src/domain/dsl/validateTerminal'
import { identityToJavaLiteral } from '../../src/domain/dsl/javaCode'
import {
  allSuitesPassed,
  buildOracleIdSection,
  buildReport,
  compareOracle,
  evaluateOracleIds,
  LONG_MAX_STRING,
  LONG_MIN_STRING,
  SUITES,
  verifyLongBoundaryStrings,
} from '../../oracle/oracle-lib.mjs'
import { makeDefinition } from '../helpers'
import { finalSnapshot } from '../p3-helpers'

/**
 * Phase 4再レビューの修正4件の検証。
 * P4-D41: Terminal DSLのclosed schema検証
 * P4-D42: string identityの正しいJava文字列リテラル生成
 * P4-O02: Long境界値の損失なしOracle照合
 * P4-O03: P1〜P3は照合のみ・P4だけ証跡を書き込むことの検証
 */

describe('P4-D41 Terminal DSLのclosed schema検証', () => {
  it('P4-D41: 未知の追加フィールド（任意コード文字列の混入経路）を拒否する', () => {
    // numericSumのfunctionBody（関数本文の混入）を拒否
    const numericSum = validateReductionStructure({ kind: 'numericSum', functionBody: 'return evil()' })
    expect(numericSum.ok).toBe(false)
    if (!numericSum.ok) {
      expect(numericSum.issues[0]?.code).toBe('STRUCTURE_INVALID')
      expect(numericSum.issues[0]?.path).toBe('reduction.functionBody')
    }
    // stringConcatの未知フィールドを拒否
    const concat = validateReductionStructure({ kind: 'stringConcat', evalExpr: 'a+b' })
    expect(concat.ok).toBe(false)
    if (!concat.ok) expect(concat.issues[0]?.path).toBe('reduction.evalExpr')
    // employeeFieldSumの未知フィールドを拒否（許可はkind / fieldのみ）
    const fieldSum = validateReductionStructure({
      kind: 'employeeFieldSum',
      field: 'salary',
      combinerBody: 'evil()',
    })
    expect(fieldSum.ok).toBe(false)
    if (!fieldSum.ok) expect(fieldSum.issues[0]?.path).toBe('reduction.combinerBody')
    // string identityのjavaCodeを拒否
    const identity = validateReductionIdentity({ type: 'string', value: 'seed', javaCode: 'evil()' })
    expect(identity.ok).toBe(false)
    if (!identity.ok) {
      expect(identity.issues[0]?.code).toBe('STRUCTURE_INVALID')
      expect(identity.issues[0]?.path).toBe('identity.javaCode')
    }
    // 数値identityの未知フィールドを拒否
    const intIdentity = validateReductionIdentity({ type: 'int', value: 0, extra: 1 })
    expect(intIdentity.ok).toBe(false)
    if (!intIdentity.ok) expect(intIdentity.issues[0]?.path).toBe('identity.extra')
    // arrayGeneratorのjavaCodeを拒否
    const generator = validateArrayGenerator({
      kind: 'arrayGenerator',
      elementTypeName: 'String',
      javaCode: 'evil()',
    })
    expect(generator.ok).toBe(false)
    if (!generator.ok) {
      expect(generator.issues[0]?.code).toBe('STRUCTURE_INVALID')
      expect(generator.issues[0]?.path).toBe('arrayGenerator.javaCode')
    }
  })

  it('P4-D41: 正常なvariantは引き続き受理し、既存検証が退行していない', () => {
    // 正常なreduction 3種
    expect(validateReductionStructure({ kind: 'numericSum' }).ok).toBe(true)
    expect(validateReductionStructure({ kind: 'stringConcat' }).ok).toBe(true)
    expect(validateReductionStructure({ kind: 'employeeFieldSum', field: 'salary' }).ok).toBe(true)
    // 正常なidentity 4種
    expect(validateReductionIdentity({ type: 'int', value: 100 }).ok).toBe(true)
    expect(validateReductionIdentity({ type: 'long', value: 0 }).ok).toBe(true)
    expect(validateReductionIdentity({ type: 'double', value: 1.5 }).ok).toBe(true)
    expect(validateReductionIdentity({ type: 'string', value: '' }).ok).toBe(true)
    // 正常なarrayGenerator 3種
    for (const elementTypeName of ['String', 'Employee', 'Object']) {
      expect(validateArrayGenerator({ kind: 'arrayGenerator', elementTypeName }).ok).toBe(true)
    }
    // 既存の必須フィールド・型・ホワイトリスト検証が退行していない
    expect(validateReductionStructure({ kind: 'customCode' }).ok).toBe(false)
    expect(validateReductionStructure({ kind: 'employeeFieldSum', field: 'skills' }).ok).toBe(false)
    expect(validateReductionIdentity({ type: 'boolean', value: true }).ok).toBe(false)
    expect(validateReductionIdentity({ type: 'int', value: 2_147_483_648 }).ok).toBe(false)
    expect(validateReductionIdentity({ type: 'int', value: 1.5 }).ok).toBe(false)
    expect(validateArrayGenerator({ kind: 'arrayGenerator', elementTypeName: 'Runtime' }).ok).toBe(false)
  })
})

describe('P4-D42 string identityのJava文字列リテラル生成', () => {
  const literal = (value: string) => identityToJavaLiteral({ type: 'string', value })

  it('P4-D42: 特殊文字を正しくエスケープした正当なJavaリテラルを生成する', () => {
    // 通常文字列・空文字列は不要に変更しない
    expect(literal('seed')).toBe('"seed"')
    expect(literal('')).toBe('""')
    // 二重引用符
    expect(literal('a"b')).toBe('"a\\"b"')
    // バックスラッシュ
    expect(literal('a\\b')).toBe('"a\\\\b"')
    // LF / CR / タブ / backspace / form feed
    expect(literal('a\nb')).toBe('"a\\nb"')
    expect(literal('a\rb')).toBe('"a\\rb"')
    expect(literal('a\tb')).toBe('"a\\tb"')
    expect(literal('a\bb')).toBe('"a\\bb"')
    expect(literal('a\fb')).toBe('"a\\fb"')
    // 組み合わせ
    expect(literal('"a"\\\n')).toBe('"\\"a\\"\\\\\\n"')
    // その他の制御文字はunicode escape
    expect(literal('a\u0000b')).toBe('"a\\u0000b"')
    expect(literal('a\u001bb')).toBe('"a\\u001bb"')
  })

  it('P4-D42: 生の改行を混入させず、元の文字列と同じ内容を表す', () => {
    const tricky = '改行\nと"引用符"と\\backslash\tタブ'
    const result = literal(tricky)
    // 生の改行・CR・タブがJavaコード表示へ混入しない
    expect(result).not.toMatch(/[\n\r\t]/)
    // エスケープを解釈すると元の文字列と一致する（Javaリテラルの意味論と同じ、単一パスで復元）
    const unescapeMap: Record<string, string> = {
      n: '\n',
      r: '\r',
      t: '\t',
      b: '\b',
      f: '\f',
      '"': '"',
      '\\': '\\',
    }
    const unescaped = result
      .slice(1, -1)
      .replace(/\\(u[0-9a-f]{4}|.)/g, (_, esc: string) =>
        esc.startsWith('u')
          ? String.fromCharCode(parseInt(esc.slice(1), 16))
          : (unescapeMap[esc] ?? esc),
      )
    expect(unescaped).toBe(tricky)
    // 通常の既存string identity（空文字列）の表示が退行していない
    expect(literal('')).toBe('""')
  })
})

describe('P4-O02 Long境界値の損失なしOracle照合', () => {
  const expected = JSON.parse(
    readFileSync(path.join(__dirname, '../../oracle/expected-p4-from-core.json'), 'utf8'),
  ) as Record<string, unknown>

  it('P4-O02: expected JSONのLong境界値がstringで、正確な10進値と一致する', () => {
    const stats = expected['statsLongEmpty'] as unknown[]
    // numberではなくstringであること
    expect(typeof stats[2]).toBe('string')
    expect(typeof stats[3]).toBe('string')
    // Long.MAX_VALUE / Long.MIN_VALUEの正確な10進文字列と一致
    expect(stats[2]).toBe(LONG_MAX_STRING)
    expect(stats[3]).toBe(LONG_MIN_STRING)
    expect(LONG_MAX_STRING).toBe('9223372036854775807')
    expect(LONG_MIN_STRING).toBe('-9223372036854775808')
    // verify関数もPASSする
    expect(verifyLongBoundaryStrings(expected)).toEqual({ ok: true, reason: null })
  })

  it('P4-O02: 近接する誤った整数を不一致と判定する', () => {
    // 1違いの近接値は不一致（number化していれば同一視されてしまう値）
    expect('9223372036854775806').not.toBe(LONG_MAX_STRING)
    expect('-9223372036854775807').not.toBe(LONG_MIN_STRING)
    const wrongMax = { statsLongEmpty: [0, 0, '9223372036854775806', LONG_MIN_STRING, 0] }
    expect(verifyLongBoundaryStrings(wrongMax).ok).toBe(false)
    const wrongMin = { statsLongEmpty: [0, 0, LONG_MAX_STRING, '-9223372036854775807', 0] }
    expect(verifyLongBoundaryStrings(wrongMin).ok).toBe(false)
    // numberへ変換された値も拒否する（string型検証。丸め済みのnumberを意図的に生成）
    const asNumber = { statsLongEmpty: [0, 0, Number(LONG_MAX_STRING), Number(LONG_MIN_STRING), 0] }
    expect(verifyLongBoundaryStrings(asNumber).ok).toBe(false)
    // 参考: numberでは近接値が同一視される（丸め）ため、string比較が必要
    expect(Number('9223372036854775807')).toBe(Number('9223372036854775806'))
  })

  it('P4-O02: parse / stringifyを経ても文字列値が変化せず、比較が損失なしで成立する', () => {
    const roundTrip = JSON.parse(JSON.stringify(expected)) as Record<string, unknown>
    const stats = roundTrip['statsLongEmpty'] as unknown[]
    expect(stats[2]).toBe(LONG_MAX_STRING)
    expect(stats[3]).toBe(LONG_MIN_STRING)
    // compareOracleは文字列のまま完全一致で比較する
    expect(compareOracle(expected, roundTrip).passed).toBe(true)
    const tampered = JSON.parse(JSON.stringify(expected)) as Record<string, unknown>
    ;(tampered['statsLongEmpty'] as unknown[])[2] = '9223372036854775806'
    expect(compareOracle(expected, tampered).passed).toBe(false)
  })

  it('P4-O02: oracle-result.mdの結果欄がverifyLongBoundaryStringsの実結果から生成される', () => {
    const allPassed = [
      { id: 'P1-O01', passed: true },
      { id: 'P2-O01', passed: true },
      { id: 'P3-O01', passed: true },
      { id: 'P4-O01', passed: true },
    ]
    const okBoundary = verifyLongBoundaryStrings(expected)
    expect(okBoundary.ok).toBe(true)
    // PASS側: 実際のverify結果からPASSが導出される
    const passEval = evaluateOracleIds({
      suiteResults: allPassed,
      expectedBoundary: okBoundary,
      actualBoundary: okBoundary,
      pastArtifactsUnchanged: true,
    })
    expect(passEval.o02Passed).toBe(true)
    const passSection = buildOracleIdSection({
      evaluation: passEval,
      expectedBoundary: okBoundary,
      actualBoundary: okBoundary,
      pastArtifactsUnchanged: true,
    }).join('\n')
    expect(passSection).toContain('P4-O02: PASS')
    // 正確な10進値と比較方式が明示される
    expect(passSection).toContain(LONG_MAX_STRING)
    expect(passSection).toContain(LONG_MIN_STRING)
    expect(passSection).toContain('10進文字列のまま完全一致比較')
    // FAIL側: 近接誤値のverify失敗がそのままFAILと総合FAILへ伝播する（固定文字列PASSではない）
    const wrongBoundary = verifyLongBoundaryStrings({
      statsLongEmpty: [0, 0, '9223372036854775806', LONG_MIN_STRING, 0],
    })
    expect(wrongBoundary.ok).toBe(false)
    const failEval = evaluateOracleIds({
      suiteResults: allPassed,
      expectedBoundary: okBoundary,
      actualBoundary: wrongBoundary,
      pastArtifactsUnchanged: true,
    })
    expect(failEval.o02Passed).toBe(false)
    expect(failEval.overallPassed).toBe(false)
    const failSection = buildOracleIdSection({
      evaluation: failEval,
      expectedBoundary: okBoundary,
      actualBoundary: wrongBoundary,
      pastArtifactsUnchanged: true,
    }).join('\n')
    expect(failSection).toContain('P4-O02: FAIL')
    expect(failSection).toContain('総合判定: FAIL')
  })

  it('P4-O02: Coreの空LongSummaryStatistics表示がLong.MAX_VALUE / MIN_VALUEの意味と一致する', () => {
    const result = finalSnapshot(makeDefinition('tmpl-stats-long', 'emptySource')).output.result
    expect(result).toMatchObject({ minLabel: 'Long.MAX_VALUE', maxLabel: 'Long.MIN_VALUE' })
    // ラベルが指す値は境界値の正確な10進文字列（意味の一致）
    const meaning: Record<string, string> = {
      'Long.MAX_VALUE': LONG_MAX_STRING,
      'Long.MIN_VALUE': LONG_MIN_STRING,
    }
    if (result.kind === 'STATISTICS') {
      expect(meaning[result.minLabel]).toBe(LONG_MAX_STRING)
      expect(meaning[result.maxLabel]).toBe(LONG_MIN_STRING)
    }
  })
})

describe('P4-O03 Oracle証跡の書込み対象', () => {
  it('P4-O03: P1〜P4すべてが照合対象で、証跡を書き込むのはP4だけである', () => {
    // P1〜P4のすべてが照合対象
    expect(SUITES.map((s) => s.id)).toEqual(['P1-O01', 'P2-O01', 'P3-O01', 'P4-O01'])
    // P1〜P3は証跡ファイルを書き込まない（writeReportPath: null）
    for (const id of ['P1-O01', 'P2-O01', 'P3-O01']) {
      const suite = SUITES.find((s) => s.id === id)!
      expect(suite.writeReportPath, id).toBeNull()
    }
    // P4だけがartifacts/phase-4/oracle-result.mdを書き込む
    const p4 = SUITES.find((s) => s.id === 'P4-O01')!
    expect(p4.writeReportPath).toEqual(['artifacts', 'phase-4', 'oracle-result.md'])
    const writers = SUITES.filter((s) => s.writeReportPath !== null)
    expect(writers).toHaveLength(1)
    expect(writers[0]?.id).toBe('P4-O01')
    // 書込み先はphase-4配下のみ（phase-1〜3へは書き込まない）
    for (const suite of writers) {
      expect(suite.writeReportPath?.join('/')).toContain('phase-4')
      expect(suite.writeReportPath?.join('/')).not.toMatch(/phase-[123]/)
    }
  })

  it('P4-O03: いずれか1件の比較失敗でもコマンド全体が失敗する', () => {
    const all = [
      { id: 'P1-O01', passed: true },
      { id: 'P2-O01', passed: true },
      { id: 'P3-O01', passed: true },
      { id: 'P4-O01', passed: true },
    ]
    expect(allSuitesPassed(all)).toBe(true)
    // P1〜P3のいずれかの失敗で全体失敗
    for (const failId of ['P1-O01', 'P2-O01', 'P3-O01', 'P4-O01']) {
      const withFailure = all.map((r) => (r.id === failId ? { ...r, passed: false } : r))
      expect(allSuitesPassed(withFailure), failId).toBe(false)
    }
    // 空の結果は成功扱いにしない
    expect(allSuitesPassed([])).toBe(false)
  })

  it('P4-O03: 必須4 suiteの欠落・重複・書込み先異常をFAILと判定する（構成の厳密判定）', () => {
    const okBoundary = { ok: true, reason: null }
    const allPassed = [
      { id: 'P1-O01', passed: true },
      { id: 'P2-O01', passed: true },
      { id: 'P3-O01', passed: true },
      { id: 'P4-O01', passed: true },
    ]
    const evaluate = (suites: unknown) =>
      evaluateOracleIds({
        suiteResults: allPassed,
        expectedBoundary: okBoundary,
        actualBoundary: okBoundary,
        pastArtifactsUnchanged: true,
        suites,
      })
    // 正常な4 suite構成（実SUITES）→ O03 PASS
    const normal = evaluate(SUITES)
    expect(normal.requiredSuitesPresent).toBe(true)
    expect(normal.o03Passed).toBe(true)
    // P1-O01 / P2-O01 / P3-O01の各欠落 → O03 FAIL・総合FAIL（P4だけ残ってもPASSにしない）
    for (const missingId of ['P1-O01', 'P2-O01', 'P3-O01']) {
      const missing = evaluate(SUITES.filter((s) => s.id !== missingId))
      expect(missing.requiredSuitesPresent, `${missingId} 欠落`).toBe(false)
      expect(missing.o03Passed, `${missingId} 欠落`).toBe(false)
      expect(missing.overallPassed, `${missingId} 欠落`).toBe(false)
    }
    // P4-O01の欠落もFAIL
    const missingP4 = evaluate(SUITES.filter((s) => s.id !== 'P4-O01'))
    expect(missingP4.requiredSuitesPresent).toBe(false)
    expect(missingP4.o03Passed).toBe(false)
    // 必須suiteの重複 → O03 FAIL（各1件でなければならない）
    const duplicated = evaluate([...SUITES, SUITES.find((s) => s.id === 'P2-O01')!])
    expect(duplicated.requiredSuitesPresent).toBe(false)
    expect(duplicated.o03Passed).toBe(false)
    // P1〜P3への書込み先設定 → O03 FAIL（構成の4件は揃っていても書込み範囲で失敗）
    const p3Writes = evaluate(
      SUITES.map((s) =>
        s.id === 'P3-O01' ? { ...s, writeReportPath: ['artifacts', 'phase-3', 'oracle-result.md'] } : s,
      ),
    )
    expect(p3Writes.requiredSuitesPresent).toBe(true)
    expect(p3Writes.configOnlyP4Writes).toBe(false)
    expect(p3Writes.o03Passed).toBe(false)
    // P4の書込み先がartifacts/phase-4/oracle-result.md以外 → O03 FAIL
    const wrongTarget = evaluate(
      SUITES.map((s) =>
        s.id === 'P4-O01' ? { ...s, writeReportPath: ['artifacts', 'phase-1', 'oracle-result.md'] } : s,
      ),
    )
    expect(wrongTarget.configOnlyP4Writes).toBe(false)
    expect(wrongTarget.o03Passed).toBe(false)
    // レポートには「必須4 suiteが各1件存在」と「書込みはP4のみ」が別々の実判定として出力される
    const missingSection = buildOracleIdSection({
      evaluation: evaluate(SUITES.filter((s) => s.id !== 'P1-O01')),
      expectedBoundary: okBoundary,
      actualBoundary: okBoundary,
      pastArtifactsUnchanged: true,
    }).join('\n')
    expect(missingSection).toContain('必須4 suite（P1-O01 / P2-O01 / P3-O01 / P4-O01）が各1件存在（欠落・重複なし）: FAIL')
    expect(missingSection).toContain('書込みはP4のみ')
    expect(missingSection).toContain('P4-O03: FAIL')
    expect(missingSection).toContain('総合判定: FAIL')
    const normalSection = buildOracleIdSection({
      evaluation: normal,
      expectedBoundary: okBoundary,
      actualBoundary: okBoundary,
      pastArtifactsUnchanged: true,
    }).join('\n')
    expect(normalSection).toContain('必須4 suite（P1-O01 / P2-O01 / P3-O01 / P4-O01）が各1件存在（欠落・重複なし）: PASS')
    expect(normalSection).toContain('P4-O03: PASS')
  })

  it('P4-O03: 結果欄がsuite構成とP1〜P3証跡不変の実結果から生成され、レポートへ組み込まれる', () => {
    const okBoundary = { ok: true, reason: null }
    const allPassed = [
      { id: 'P1-O01', passed: true },
      { id: 'P2-O01', passed: true },
      { id: 'P3-O01', passed: true },
      { id: 'P4-O01', passed: true },
    ]
    // PASS側: 実SUITES構成（P4のみ書込み）+ SHA-256不変の実測true
    const passEval = evaluateOracleIds({
      suiteResults: allPassed,
      expectedBoundary: okBoundary,
      actualBoundary: okBoundary,
      pastArtifactsUnchanged: true,
    })
    expect(passEval).toMatchObject({
      o01Passed: true,
      o02Passed: true,
      o03Passed: true,
      configOnlyP4Writes: true,
      overallPassed: true,
    })
    // FAIL側1: 実行前後で過去Phase証跡が変化した実測結果はO03と総合をFAILにする
    const changedEval = evaluateOracleIds({
      suiteResults: allPassed,
      expectedBoundary: okBoundary,
      actualBoundary: okBoundary,
      pastArtifactsUnchanged: false,
    })
    expect(changedEval.o03Passed).toBe(false)
    expect(changedEval.overallPassed).toBe(false)
    // FAIL側2: P1〜P3へ書き込むsuite構成はO03をFAILにする
    const badSuites = SUITES.map((suite) =>
      suite.id === 'P1-O01'
        ? { ...suite, writeReportPath: ['artifacts', 'phase-1', 'oracle-result.md'] }
        : suite,
    )
    const badConfigEval = evaluateOracleIds({
      suiteResults: allPassed,
      expectedBoundary: okBoundary,
      actualBoundary: okBoundary,
      pastArtifactsUnchanged: true,
      suites: badSuites,
    })
    expect(badConfigEval.configOnlyP4Writes).toBe(false)
    expect(badConfigEval.o03Passed).toBe(false)
    // FAIL側3: P4-O01の照合失敗は総合をFAILにする
    const o01FailEval = evaluateOracleIds({
      suiteResults: allPassed.map((r) => (r.id === 'P4-O01' ? { ...r, passed: false } : r)),
      expectedBoundary: okBoundary,
      actualBoundary: okBoundary,
      pastArtifactsUnchanged: true,
    })
    expect(o01FailEval.o01Passed).toBe(false)
    expect(o01FailEval.overallPassed).toBe(false)
    // レポート統合: oracle-result.md本文にP4-O01〜O03の結果と総合判定が含まれる
    const report = buildReport({
      suiteId: 'P4-O01',
      image: 'gradle:9.6.1-jdk25',
      javaFile: 'OracleP4.java',
      versionText: 'openjdk version "25.0.3"',
      expectedText: '{}',
      actualText: '{}',
      passed: true,
      observations: [],
      extraSections: buildOracleIdSection({
        evaluation: passEval,
        expectedBoundary: okBoundary,
        actualBoundary: okBoundary,
        pastArtifactsUnchanged: true,
      }),
    })
    expect(report).toContain('## P4必須Oracle IDの結果（P4-O01〜O03）')
    expect(report).toContain('P4-O01: PASS')
    expect(report).toContain('P4-O02: PASS')
    expect(report).toContain('P4-O03: PASS')
    expect(report).toContain('総合判定: PASS')
    expect(report).toContain('照合のみ')
    expect(report).toContain('SHA-256が不変')
  })
})
