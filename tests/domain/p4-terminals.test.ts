import { describe, expect, it } from 'vitest'
import { makeDefinition, runAllSnapshots } from '../helpers'
import { finalSnapshot } from '../p3-helpers'

/** P4-D17〜P4-D29: count・min・max・find・match（Phase 4指示 §6.2・§6.3） */

describe('P4-D17 count', () => {
  it('P4-D17: 標準・途中0件・空でJava 25と一致するlongを返す', () => {
    const def = makeDefinition('tmpl-count')
    const snapshots = runAllSnapshots(def)
    // 要素ごとの概念上の寄与（COUNT_UPDATED）と現在件数
    const counts = snapshots
      .filter((s) => s.kind === 'COUNT_UPDATED')
      .map((s) => {
        const ctx = s.operationContexts['node-sink']
        return ctx?.kind === 'count' ? ctx.currentCount : -1
      })
    expect(counts).toEqual([1, 2, 3, 4])
    expect(finalSnapshot(def).output.result).toMatchObject({ kind: 'SCALAR', typeLabel: 'long', valueLabel: '4L' })
    expect(finalSnapshot(makeDefinition('tmpl-count', 'emptySource')).output.result).toMatchObject({
      valueLabel: '0L',
    })
    expect(finalSnapshot(makeDefinition('tmpl-count-midempty', 'midEmpty')).output.result).toMatchObject({
      valueLabel: '0L',
    })
  })
})

describe('P4-D18 count評価省略注記', () => {
  it('P4-D18: 概念的逐次評価と評価省略可能性を分離し、常設注記する', () => {
    const def = makeDefinition('tmpl-count')
    const snapshots = runAllSnapshots(def)
    // COUNT_UPDATEDと結果確定の両方に評価省略注記
    const countSnapshot = snapshots.find((s) => s.kind === 'COUNT_UPDATED')!
    expect(countSnapshot.explanation.jdkNote).toContain('省略')
    expect(countSnapshot.explanation.jdkNote).toContain('保証')
    const confirmed = snapshots.find((s) => s.kind === 'RESULT_CONFIRMED')!
    expect(confirmed.explanation.jdkNote).toContain('省略')
    const last = finalSnapshot(def)
    const ctx = last.operationContexts['node-sink']
    if (ctx?.kind === 'count') {
      expect(ctx.elisionNote).toContain('省略することがあります')
      expect(ctx.elisionNote).toContain('保証もありません')
    }
  })
})

describe('P4-D19 object min/max', () => {
  it('P4-D19: Comparatorによる候補更新・維持と最終Optionalが正しい', () => {
    const minDef = makeDefinition('tmpl-min-age')
    const minSnapshots = runAllSnapshots(minDef)
    // 候補列: 佐藤(35) → 鈴木(27)更新 → 高橋(42)維持 → 田中(29)維持
    const candidates = minSnapshots
      .filter((s) => s.kind === 'CANDIDATE_UPDATED')
      .map((s) => {
        const ctx = s.operationContexts['node-sink']
        return ctx?.kind === 'minmax' ? ctx.candidateLabel : null
      })
    expect(candidates).toEqual(['佐藤（age=35）', '鈴木（age=27）', '鈴木（age=27）', '鈴木（age=27）'])
    expect(finalSnapshot(minDef).output.result).toMatchObject({
      kind: 'OPTIONAL',
      present: true,
      valueLabel: '鈴木（age=27）',
      valueElementId: 'emp-002',
    })
    expect(finalSnapshot(makeDefinition('tmpl-max-age')).output.result).toMatchObject({
      valueLabel: '高橋（age=42）',
    })
  })
})

describe('P4-D20 min/maxの空Optional', () => {
  it('P4-D20: 空StreamはOptional.empty / primitive Optional.emptyを返す', () => {
    expect(finalSnapshot(makeDefinition('tmpl-min-age', 'emptySource')).output.result).toMatchObject({
      kind: 'OPTIONAL',
      optionalTypeLabel: 'Optional',
      present: false,
    })
    expect(finalSnapshot(makeDefinition('tmpl-min-int', 'emptySource')).output.result).toMatchObject({
      optionalTypeLabel: 'OptionalInt',
      present: false,
    })
    expect(finalSnapshot(makeDefinition('tmpl-max-long', 'emptySource')).output.result).toMatchObject({
      optionalTypeLabel: 'OptionalLong',
      present: false,
    })
    expect(finalSnapshot(makeDefinition('tmpl-min-double', 'emptySource')).output.result).toMatchObject({
      optionalTypeLabel: 'OptionalDouble',
      present: false,
    })
  })
})

describe('P4-D21 primitive min/max', () => {
  it('P4-D21: int / long / doubleのprimitive比較で正しい候補を返す', () => {
    expect(finalSnapshot(makeDefinition('tmpl-min-int')).output.result).toMatchObject({
      optionalTypeLabel: 'OptionalInt',
      valueLabel: '1',
    })
    expect(finalSnapshot(makeDefinition('tmpl-max-long')).output.result).toMatchObject({
      optionalTypeLabel: 'OptionalLong',
      valueLabel: '30L',
    })
    expect(finalSnapshot(makeDefinition('tmpl-min-double')).output.result).toMatchObject({
      optionalTypeLabel: 'OptionalDouble',
      valueLabel: '1.5',
    })
    // primitive比較の表示（Comparatorではない）
    const ctx = finalSnapshot(makeDefinition('tmpl-min-int')).operationContexts['node-sink']
    if (ctx?.kind === 'minmax') expect(ctx.comparatorLabel).toContain('primitive比較')
  })
})

describe('P4-D22 候補更新snapshot', () => {
  it('P4-D22: 更新 / 維持の判定と比較内容をsnapshotへ保持する', () => {
    const snapshots = runAllSnapshots(makeDefinition('tmpl-min-int'))
    const updates = snapshots.filter((s) => s.kind === 'CANDIDATE_UPDATED')
    // [3, 1, 4]: 初期化 → 更新（1 < 3）→ 維持（4 > 1）
    expect(updates[0]?.processing?.title).toContain('初期化')
    expect(updates[1]?.processing?.title).toContain('更新')
    expect(updates[1]?.processing?.evaluation).toBe('1 < 3')
    expect(updates[2]?.processing?.title).toContain('維持')
    const lastCtx = updates[2]?.operationContexts['node-sink']
    if (lastCtx?.kind === 'minmax') expect(lastCtx.updateCount).toBe(2)
  })
})

describe('P4-D23 findFirst', () => {
  it('P4-D23: 途中で結果確定し、残りが未評価のまま短絡する', () => {
    const def = makeDefinition('tmpl-findfirst')
    const snapshots = runAllSnapshots(def)
    // 佐藤（最初のfilter通過要素）で確定
    const selected = snapshots.find((s) => s.kind === 'FIND_SELECTED')!
    expect(selected.currentElementId).toBe('emp-001')
    expect(snapshots.some((s) => s.kind === 'SHORT_CIRCUIT_CONFIRMED')).toBe(true)
    // source送出は1件だけ。鈴木・高橋・田中は未評価
    expect(snapshots.filter((s) => s.kind === 'SOURCE_EMIT')).toHaveLength(1)
    const last = finalSnapshot(def)
    expect(last.elementLatestStates['emp-002']).toBe('UNEVALUATED')
    expect(last.elementLatestStates['emp-003']).toBe('UNEVALUATED')
    expect(last.elementLatestStates['emp-004']).toBe('UNEVALUATED')
    expect(last.output.result).toMatchObject({ present: true, valueLabel: '佐藤（age=35）' })
    // 途中0件 / 空はOptional.empty
    expect(finalSnapshot(makeDefinition('tmpl-findfirst', 'midEmpty')).output.result).toMatchObject({
      present: false,
    })
    expect(finalSnapshot(makeDefinition('tmpl-findfirst', 'emptySource')).output.result).toMatchObject({
      present: false,
    })
  })
})

describe('P4-D24 findAny', () => {
  it('P4-D24: fixtureでは決定的に同じ要素を選択し、非保証注記を常設する', () => {
    const first = finalSnapshot(makeDefinition('tmpl-findany'))
    const second = finalSnapshot(makeDefinition('tmpl-findany'))
    // 決定的選択（同じ要素）
    expect(first.output.result).toMatchObject({ present: true, valueLabel: '佐藤（age=35）' })
    expect(second.output.result).toEqual(first.output.result)
    // 非保証注記がcontextとjdkNoteの両方に常設
    const ctx = first.operationContexts['node-sink']
    expect(ctx?.kind).toBe('find')
    if (ctx?.kind === 'find') {
      expect(ctx.nondeterminismNote).toContain('保証しません')
    }
    const snapshots = runAllSnapshots(makeDefinition('tmpl-findany'))
    const selected = snapshots.find((s) => s.kind === 'FIND_SELECTED')!
    expect(selected.explanation.jdkNote).toContain('保証しません')
    // 初期snapshotでも注記が読める（常時表示）
    const initialCtx = snapshots[0]!.operationContexts['node-sink']
    if (initialCtx?.kind === 'find') expect(initialCtx.nondeterminismNote).not.toBeNull()
  })
})

describe('P4-D25 anyMatch', () => {
  it('P4-D25: 最初のtrueで停止し、残りが未評価', () => {
    const def = makeDefinition('tmpl-anymatch')
    const snapshots = runAllSnapshots(def)
    // age >= 40: 佐藤false, 鈴木false, 高橋true → 3回評価で確定
    const evaluated = snapshots.filter((s) => s.kind === 'MATCH_EVALUATED')
    expect(evaluated).toHaveLength(3)
    expect(evaluated[2]?.processing?.evaluation).toBe('42 >= 40 → true')
    expect(snapshots.some((s) => s.kind === 'SHORT_CIRCUIT_CONFIRMED')).toBe(true)
    const last = finalSnapshot(def)
    expect(last.output.result).toMatchObject({ kind: 'SCALAR', typeLabel: 'boolean', valueLabel: 'true' })
    expect(last.elementLatestStates['emp-004']).toBe('UNEVALUATED')
  })
})

describe('P4-D26 allMatch / noneMatch', () => {
  it('P4-D26: allMatchは最初のfalse、noneMatchは最初のtrueで停止する', () => {
    // allMatch(age >= 30): 佐藤true, 鈴木false → 停止
    const allDef = makeDefinition('tmpl-allmatch')
    const allSnapshots = runAllSnapshots(allDef)
    expect(allSnapshots.filter((s) => s.kind === 'MATCH_EVALUATED')).toHaveLength(2)
    expect(finalSnapshot(allDef).output.result).toMatchObject({ valueLabel: 'false' })
    expect(finalSnapshot(allDef).elementLatestStates['emp-003']).toBe('UNEVALUATED')
    // noneMatch(age >= 40): 高橋のtrueで停止（結果false）
    const noneDef = makeDefinition('tmpl-nonematch')
    const noneSnapshots = runAllSnapshots(noneDef)
    expect(noneSnapshots.filter((s) => s.kind === 'MATCH_EVALUATED')).toHaveLength(3)
    expect(finalSnapshot(noneDef).output.result).toMatchObject({ valueLabel: 'false' })
    expect(finalSnapshot(noneDef).elementLatestStates['emp-004']).toBe('UNEVALUATED')
  })
})

describe('P4-D27 match系の空Stream', () => {
  it('P4-D27: false / true / trueとvacuous truth説明が正しい', () => {
    const any = finalSnapshot(makeDefinition('tmpl-anymatch', 'emptySource'))
    expect(any.output.result).toMatchObject({ valueLabel: 'false' })
    const all = finalSnapshot(makeDefinition('tmpl-allmatch', 'emptySource'))
    expect(all.output.result).toMatchObject({ valueLabel: 'true' })
    const allConfirmed = runAllSnapshots(makeDefinition('tmpl-allmatch', 'emptySource')).find(
      (s) => s.kind === 'RESULT_CONFIRMED',
    )!
    expect(allConfirmed.explanation.current).toContain('vacuous truth')
    const allCtx = all.operationContexts['node-sink']
    if (allCtx?.kind === 'match') {
      expect(allCtx.vacuousNote).toContain('反例が存在しない')
    }
    const none = finalSnapshot(makeDefinition('tmpl-nonematch', 'emptySource'))
    expect(none.output.result).toMatchObject({ valueLabel: 'true' })
    const noneCtx = none.operationContexts['node-sink']
    if (noneCtx?.kind === 'match') {
      expect(noneCtx.vacuousNote).toContain('該当が存在しない')
    }
    // anyMatchのfalseはvacuous truthではない（説明を出さない）
    const anyCtx = any.operationContexts['node-sink']
    if (anyCtx?.kind === 'match') expect(anyCtx.vacuousNote).toBeNull()
  })
})

describe('P4-D28 空StreamのPredicate 0回', () => {
  it('P4-D28: 空StreamではPredicateを一度も評価しない', () => {
    for (const templateId of ['tmpl-anymatch', 'tmpl-allmatch', 'tmpl-nonematch']) {
      const snapshots = runAllSnapshots(makeDefinition(templateId, 'emptySource'))
      expect(snapshots.filter((s) => s.kind === 'MATCH_EVALUATED'), templateId).toHaveLength(0)
      const ctx = snapshots[snapshots.length - 1]!.operationContexts['node-sink']
      if (ctx?.kind === 'match') expect(ctx.evaluatedCount, templateId).toBe(0)
    }
  })
})

describe('P4-D29 短絡後の残りが未評価', () => {
  it('P4-D29: SHORT_CIRCUIT_CONFIRMED後に評価snapshotがなく、残りはUNEVALUATEDのまま', () => {
    for (const templateId of ['tmpl-findfirst', 'tmpl-anymatch', 'tmpl-allmatch', 'tmpl-nonematch']) {
      const snapshots = runAllSnapshots(makeDefinition(templateId))
      const scIdx = snapshots.findIndex((s) => s.kind === 'SHORT_CIRCUIT_CONFIRMED')
      expect(scIdx, templateId).toBeGreaterThan(0)
      const after = snapshots.slice(scIdx + 1)
      expect(after.map((s) => s.kind), templateId).toEqual(['RESULT_CONFIRMED', 'STREAM_CONSUMED'])
      const last = snapshots[snapshots.length - 1]!
      const unevaluated = Object.values(last.elementLatestStates).filter((s) => s === 'UNEVALUATED')
      expect(unevaluated.length, templateId).toBeGreaterThan(0)
    }
  })
})
