import { describe, expect, it } from 'vitest'
import { makeDefinition, runAllSnapshots } from '../helpers'
import { finalSnapshot, makeCustomDefinition } from '../p3-helpers'
import { createDefaultTemplateRegistry } from '../../src/domain/template/templates'

/** P4-D09〜P4-D16: reduce全形式（Phase 4指示 §6.1） */
const registry = createDefaultTemplateRegistry()

describe('P4-D09 identityなしreduce基本', () => {
  it('P4-D09: 最初の要素を初期累積値として独立表示し、以降を累積する', () => {
    const def = makeDefinition('tmpl-reduce-concat')
    const snapshots = runAllSnapshots(def)
    // 最初の要素はREDUCTION_INITIALIZED（独立snapshot）、以降はACCUMULATOR_UPDATED
    const init = snapshots.filter((s) => s.kind === 'REDUCTION_INITIALIZED')
    expect(init).toHaveLength(1)
    expect(init[0]?.currentElementId).toBe('of-001')
    expect(init[0]?.processing?.evaluation).toContain('"Java"')
    const updates = snapshots.filter((s) => s.kind === 'ACCUMULATOR_UPDATED')
    expect(updates).toHaveLength(2)
    expect(updates[0]?.processing?.evaluation).toBe('"Java" + "SQL" → "JavaSQL"')
    expect(updates[1]?.processing?.evaluation).toBe('"JavaSQL" + "Git" → "JavaSQLGit"')
    expect(finalSnapshot(def).output.result).toMatchObject({
      kind: 'OPTIONAL',
      present: true,
      valueLabel: '"JavaSQLGit"',
    })
  })
})

describe('P4-D10 identityなしreduceの空Stream', () => {
  it('P4-D10: 型に応じた空Optionalを返す', () => {
    expect(finalSnapshot(makeDefinition('tmpl-reduce-concat', 'emptySource')).output.result).toMatchObject({
      kind: 'OPTIONAL',
      optionalTypeLabel: 'Optional',
      present: false,
      valueLabel: null,
    })
    expect(finalSnapshot(makeDefinition('tmpl-reduce-int', 'emptySource')).output.result).toMatchObject({
      kind: 'OPTIONAL',
      optionalTypeLabel: 'OptionalInt',
      present: false,
    })
    // 途中0件でもOptional.empty
    expect(
      finalSnapshot(makeDefinition('tmpl-reduce-concat-midempty', 'midEmpty')).output.result,
    ).toMatchObject({ present: false })
  })
})

describe('P4-D11 identityありreduce基本', () => {
  it('P4-D11: identityを実行開始時に独立snapshotで初期化し、常時表示する', () => {
    const def = makeDefinition('tmpl-reduce-int-identity')
    const snapshots = runAllSnapshots(def)
    // 構造処理snapshot: currentElementId === null（要素より前）
    const init = snapshots.find((s) => s.kind === 'REDUCTION_INITIALIZED')!
    expect(init.currentElementId).toBeNull()
    expect(init.index).toBe(1)
    expect(init.processing?.evaluation).toContain('100')
    // 全要素がACCUMULATOR_UPDATED（identityが初期値のため初期化は要素で発生しない）
    const updates = snapshots.filter((s) => s.kind === 'ACCUMULATOR_UPDATED')
    expect(updates).toHaveLength(3)
    expect(updates[0]?.processing?.evaluation).toBe('100 + 3 → 103')
    expect(finalSnapshot(def).output.result).toMatchObject({ kind: 'SCALAR', valueLabel: '108' })
    // contextでidentityが常時参照できる
    const ctx = finalSnapshot(def).operationContexts['node-sink']
    expect(ctx?.kind).toBe('reduce')
    if (ctx?.kind === 'reduce') expect(ctx.identityLabel).toBe('100')
  })
})

describe('P4-D12 identityありreduceの空Stream', () => {
  it('P4-D12: 空Streamはidentityを返す', () => {
    expect(finalSnapshot(makeDefinition('tmpl-reduce-int-identity', 'emptySource')).output.result).toMatchObject({
      kind: 'SCALAR',
      typeLabel: 'int',
      valueLabel: '100',
    })
    expect(finalSnapshot(makeDefinition('tmpl-reduce-salary', 'emptySource')).output.result).toMatchObject({
      kind: 'SCALAR',
      typeLabel: 'long',
      valueLabel: '0L',
    })
  })
})

describe('P4-D13 3引数reduce', () => {
  it('P4-D13: Employeeのsalary合計をU型（long）へ累積する', () => {
    const def = makeDefinition('tmpl-reduce-salary')
    const snapshots = runAllSnapshots(def)
    expect(finalSnapshot(def).output.result).toMatchObject({
      kind: 'SCALAR',
      typeLabel: 'long',
      valueLabel: '21_700_000L',
    })
    // 各要素のfield値がaccumulatorへ渡る
    const updates = snapshots.filter((s) => s.kind === 'ACCUMULATOR_UPDATED')
    expect(updates).toHaveLength(4)
    expect(updates[0]?.processing?.inputLabel).toBe('佐藤.salary() → 5_500_000L')
    expect(updates[0]?.processing?.evaluation).toBe('0L + 5_500_000L → 5_500_000L')
    // Javaコードは3引数reduce
    expect(def.javaCode.map((l) => l.text).join('\n')).toContain(
      '.reduce(0L, (acc, e) -> acc + e.salary(), Long::sum);',
    )
  })
})

describe('P4-D14 sequential combiner', () => {
  it('P4-D14: sequential実行ではcombiner呼出し0回で、実行済みのように表示しない', () => {
    const def = makeDefinition('tmpl-reduce-salary')
    const snapshots = runAllSnapshots(def)
    const last = finalSnapshot(def)
    const ctx = last.operationContexts['node-sink']
    expect(ctx?.kind).toBe('reduce')
    if (ctx?.kind === 'reduce') {
      expect(ctx.hasCombiner).toBe(true)
      expect(ctx.combinerCallCount).toBe(0)
    }
    // 補助説明: combinerはparallel reductionで必要（結果確定snapshot）
    const confirmed = snapshots.find((s) => s.kind === 'RESULT_CONFIRMED')!
    expect(confirmed.explanation.jdkNote).toContain('combiner')
    expect(confirmed.explanation.jdkNote).toContain('呼ばれません')
    // combiner実行を示すsnapshot種別が存在しない
    expect(snapshots.every((s) => !s.explanation.current.includes('combinerを実行'))).toBe(true)
  })
})

describe('P4-D15 accumulator snapshot履歴', () => {
  it('P4-D15: accumulator履歴がseq・before・afterを保持し復元可能', () => {
    const def = makeDefinition('tmpl-reduce-int')
    const snapshots = runAllSnapshots(def)
    const last = snapshots[snapshots.length - 1]!
    const ctx = last.operationContexts['node-sink']
    expect(ctx?.kind).toBe('reduce')
    if (ctx?.kind === 'reduce') {
      expect(ctx.history.map((h) => h.seq)).toEqual([1, 2, 3])
      expect(ctx.history[0]).toMatchObject({ beforeLabel: null, afterLabel: '3' })
      expect(ctx.history[1]).toMatchObject({ beforeLabel: '3', afterLabel: '4' })
      expect(ctx.history[2]).toMatchObject({ beforeLabel: '4', afterLabel: '8' })
      expect(ctx.accumulatorLabel).toBe('8')
    }
    // 途中snapshotの履歴はその時点まで
    const secondUpdate = snapshots.filter(
      (s) => s.kind === 'ACCUMULATOR_UPDATED' || s.kind === 'REDUCTION_INITIALIZED',
    )[1]!
    const midCtx = secondUpdate.operationContexts['node-sink']
    if (midCtx?.kind === 'reduce') expect(midCtx.history).toHaveLength(2)
  })
})

describe('P4-D16 primitive reduce（Long / DoubleStream）', () => {
  it('P4-D16: LongStream / DoubleStreamのreduceが型を維持して累積する', () => {
    const template = registry.get('tmpl-reduce-int', 1)!
    const longDef = makeCustomDefinition(
      { ...template, templateId: 'tmpl-test-reduce-long' },
      {
        'slot-source': { kind: 'arrayPrimitive', arrayId: 'amounts', primitive: 'long', values: [10, 20, 30] },
        'slot-reduction': { kind: 'numericSum' },
      },
    )
    expect(finalSnapshot(longDef).output.result).toMatchObject({
      kind: 'OPTIONAL',
      optionalTypeLabel: 'OptionalLong',
      valueLabel: '60L',
    })
    const doubleDef = makeCustomDefinition(
      { ...template, templateId: 'tmpl-test-reduce-double' },
      {
        'slot-source': { kind: 'arrayPrimitive', arrayId: 'rates', primitive: 'double', values: [1.5, 2.5] },
        'slot-reduction': { kind: 'numericSum' },
      },
    )
    expect(finalSnapshot(doubleDef).output.result).toMatchObject({
      kind: 'OPTIONAL',
      optionalTypeLabel: 'OptionalDouble',
      valueLabel: '4.0',
    })
  })
})
