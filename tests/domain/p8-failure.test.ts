import { describe, expect, it } from 'vitest'
import { EngineInvariantError, createInitialSnapshot, nextSnapshot } from '../../src/domain/engine/stepEngine'
import { validateCollectorStructure, resolveCollectorType } from '../../src/domain/dsl/validateCollector'
import type { CollectorDsl } from '../../src/domain/dsl/collectorAst'
import { TEEING_MERGER_IDS, TEEING_MERGER_RECORDS } from '../../src/domain/dsl/collectorAst'
import { TYPE_EMPLOYEE } from '../../src/domain/types/typeRef'
import { makeDefinition, runAllSnapshots } from '../helpers'
import { ALL_TEMPLATES } from '../../src/domain/template/templates'
import {
  MERGE_DEMO_EMPLOYEES,
  NAME_KEY,
  NAME_VALUE,
  REGION_KEY,
  STANDARD_EMPLOYEES,
  collectorCtxOf,
  failureOf,
  findToMapNode,
  kindElementPairs,
  runLocalCollector,
  snapshotsOf,
  toMap2,
  toMapEntryPairs,
} from '../p8-helpers'

/**
 * P8-D13〜P8-D18: ExecutionFailureViewの配置別検証・出力契約・決定性 / 復元・teeing排他
 * （Phase 8指示 §12.1、v0.11 §6.2の9）。
 *
 * `collectorPath` / `bucketPath`は**配列の完全一致**で検証する。
 */

/** 部署名でグルーピング（開発部=佐藤/高橋、営業部=鈴木/田中）してname重複を作らないための補助 */
const DEPT_NAME_KEY = { kind: 'departmentField', field: 'name' } as const
const DEPT_DIVISION_KEY = { kind: 'departmentField', field: 'division' } as const

describe('P8-D13 ExecutionFailureView: root配置', () => {
  const snapshots = snapshotsOf('tmpl-collect-tomap-duplicate', 'standard')
  const failure = failureOf(snapshots)

  it('P8-D13: root配置の全フィールドが厳密に一致する', () => {
    expect(failure).toEqual({
      kind: 'DUPLICATE_TO_MAP_KEY',
      exceptionType: 'IllegalStateException',
      collectorPath: ['c0'],
      bucketPath: [],
      duplicateKeyLabel: '関東',
      duplicateKeyRef: 'str:関東',
      existingValueLabel: '"伊藤"',
      incomingValueLabel: '"渡辺"',
    })
  })

  it('P8-D13: executionFailureはCOLLECT_FAILED以外のsnapshotでnullである', () => {
    for (const snapshot of snapshots.slice(0, -1)) {
      expect(snapshot.executionFailure, `${snapshot.index}:${snapshot.kind}`).toBeNull()
    }
    // 正常完了するtemplateでは全snapshotでnull
    for (const snapshot of snapshotsOf('tmpl-collect-tomap-merge-first', 'standard')) {
      expect(snapshot.executionFailure).toBeNull()
    }
  })

  it('P8-D13: collectorPathは同一snapshotのcurrentPathと同じ値・規約である', () => {
    const last = snapshots[snapshots.length - 1]!
    expect(failure.collectorPath).toEqual(collectorCtxOf(last).currentPath)
  })
})

describe('P8-D14 ExecutionFailureView: bucket系（単段 / 多段groupingBy）', () => {
  it('P8-D14: 単段groupingByの配列が完全一致する（bucket#n・bucketPath 1要素）', () => {
    // groupingBy(region, toMap(department.name, name)) をemployeesMergeDemoへ適用すると、
    // 関東bucket（伊藤=開発部 / 渡辺=開発部）で部署名キーが衝突する
    const { snapshots } = runLocalCollector(
      'tmpl-p8-local-fail-group',
      ['groupingBy', 'toMap'],
      {
        kind: 'groupingBy',
        classifier: REGION_KEY,
        mapFactoryId: null,
        downstream: toMap2(DEPT_NAME_KEY, NAME_VALUE),
      },
      MERGE_DEMO_EMPLOYEES,
    )
    const failure = failureOf(snapshots)
    expect(failure.collectorPath).toEqual(['c0', 'c0.bucket#1'])
    expect(failure.bucketPath).toEqual([
      { collectorNodeKey: 'c0', keyLabel: '関東', keyRef: 'str:関東' },
    ])
    expect(failure.duplicateKeyLabel).toBe('開発部')
    expect(failure.existingValueLabel).toBe('"伊藤"')
    expect(failure.incomingValueLabel).toBe('"渡辺"')
  })

  it('P8-D14: 多段groupingByの配列が完全一致する（bucketPathは外側→内側の2要素）', () => {
    // groupingBy(department.division, groupingBy(region, toMap(department.name, name)))
    const { snapshots } = runLocalCollector(
      'tmpl-p8-local-fail-group-nested',
      ['groupingBy', 'toMap'],
      {
        kind: 'groupingBy',
        classifier: DEPT_DIVISION_KEY,
        mapFactoryId: null,
        downstream: {
          kind: 'groupingBy',
          classifier: REGION_KEY,
          mapFactoryId: null,
          downstream: toMap2(DEPT_NAME_KEY, NAME_VALUE),
        },
      },
      MERGE_DEMO_EMPLOYEES,
    )
    const failure = failureOf(snapshots)
    expect(failure.collectorPath).toEqual(['c0', 'c0.bucket#1', 'c0.bucket#1.bucket#1'])
    expect(failure.bucketPath).toEqual([
      { collectorNodeKey: 'c0', keyLabel: '技術本部', keyRef: 'str:技術本部' },
      { collectorNodeKey: 'c0.bucket#1', keyLabel: '関東', keyRef: 'str:関東' },
    ])
    expect(failure.duplicateKeyLabel).toBe('開発部')
  })
})

/**
 * **P8-D15は Phase 8 部分実装ID である。**
 * partitioningBy配置・adapter系経由の2配置は契約どおり検証しているが、
 * **teeing branch配置の`collectorPath` / `bucketPath`検証は実施できていない**
 * （merger record型契約によりteeing × toMapが構築不能。docs/phase-8-decisions.md §9）。
 * 本IDを「成功」として数えてはならない。
 */
describe('P8-D15 ExecutionFailureView: その他配置（partitioningBy / adapter系は成功・teeingは未実施）', () => {
  it('P8-D15: partitioningByのbucketPathはpartitionキー1要素である', () => {
    const { snapshots } = runLocalCollector(
      'tmpl-p8-local-fail-partition',
      ['partitioningBy', 'toMap'],
      {
        kind: 'partitioningBy',
        // 全件true（age >= 0）へ寄せてtrue partition内でregionを衝突させる
        predicate: {
          kind: 'fieldCompare',
          field: 'age',
          operator: 'GTE',
          value: { type: 'int', value: 0 },
        },
        downstream: toMap2(REGION_KEY, NAME_VALUE),
      },
      MERGE_DEMO_EMPLOYEES,
    )
    const failure = failureOf(snapshots)
    // partitioningByのbucketは実行開始時にfalse → trueの順で事前生成される
    expect(failure.collectorPath).toEqual(['c0', 'c0.bucket#2'])
    expect(failure.bucketPath).toEqual([
      { collectorNodeKey: 'c0', keyLabel: 'true', keyRef: 'true' },
    ])
    expect(failure.duplicateKeyLabel).toBe('関東')
  })

  it('P8-D15: adapter系経由（filtering直下）はcollectorPath = [c0, c0.down]・bucketPath空である', () => {
    const { snapshots } = runLocalCollector(
      'tmpl-p8-local-fail-adapter',
      ['filtering', 'toMap'],
      {
        kind: 'filtering',
        predicate: {
          kind: 'fieldCompare',
          field: 'age',
          operator: 'GTE',
          value: { type: 'int', value: 0 },
        },
        downstream: toMap2(),
      },
      MERGE_DEMO_EMPLOYEES,
    )
    const failure = failureOf(snapshots)
    expect(failure.collectorPath).toEqual(['c0', 'c0.down'])
    expect(failure.bucketPath).toEqual([])
  })

  it('P8-D15(未実施記録): teeing branch配置のExecutionFailureView検証は実施できていない', () => {
    // teeingのbranch結果型は merger record（SalarySummary: long / double）に拘束されるため、
    // Map結果のbranchはresolveCollectorTypeでTYPE_MISMATCHとなりStep Engineへ到達しない。
    // **これはP8-D15のteeing要件を満たすものではなく、満たせない理由の機械的な固定である。**
    // v0.11 §6.2の9が要求する6配置のうち teeing branch の1配置が未検証のまま残る
    // （§17停止条件として報告済み。docs/phase-8-decisions.md §9）
    for (const [label, dsl] of [
      [
        'left',
        {
          kind: 'teeing',
          left: toMap2(),
          right: { kind: 'averagingLong', field: 'salary' },
          mergerId: 'SalarySummary::new',
        },
      ],
      [
        'right',
        {
          kind: 'teeing',
          left: { kind: 'counting' },
          right: toMap2(),
          mergerId: 'SalarySummary::new',
        },
      ],
    ] as const) {
      expect(validateCollectorStructure(dsl).ok, label).toBe(true)
      const typed = resolveCollectorType(dsl as CollectorDsl, TYPE_EMPLOYEE)
      expect(typed.ok, label).toBe(false)
      if (!typed.ok) expect(typed.issues[0]?.code, label).toBe('TYPE_MISMATCH')
    }
  })
})

describe('P8-D16 実行失敗の出力契約（SnapshotOutput.result null許容）', () => {
  const snapshots = snapshotsOf('tmpl-collect-tomap-duplicate', 'standard')

  it('P8-D16: COLLECT_FAILEDでconfirmed === false・result === nullである', () => {
    const last = snapshots[snapshots.length - 1]!
    expect(last.kind).toBe('COLLECT_FAILED')
    expect(last.output.confirmed).toBe(false)
    expect(last.output.result).toBeNull()
    // 途中Mapは終端結果にせず、内部蓄積状態としてのみ保持する
    const node = findToMapNode(collectorCtxOf(last).root)!
    expect(toMapEntryPairs(node)).toEqual(['関東="伊藤"'])
  })

  it('P8-D16: result === nullになるのはCOLLECT_FAILEDだけである（全template走査）', () => {
    let nullCount = 0
    for (const template of ALL_TEMPLATES) {
      if (template.executable === false) continue
      for (const mode of template.supportedModes) {
        for (const snapshot of runAllSnapshots(makeDefinition(template.templateId, mode))) {
          if (snapshot.output.result === null) {
            nullCount += 1
            expect(snapshot.kind, `${template.templateId}:${mode}`).toBe('COLLECT_FAILED')
            expect(snapshot.executionFailure).not.toBeNull()
          } else {
            expect(snapshot.kind, `${template.templateId}:${mode}`).not.toBe('COLLECT_FAILED')
          }
        }
      }
    }
    // 現在のtemplate集合ではCOLLECT_FAILEDは1件（tmpl-collect-tomap-duplicate）
    expect(nullCount).toBe(1)
  })

  it('P8-D16: 失敗生成でTypeScript例外を送出せず、EngineInvariantError経路を使わない', () => {
    const def = makeDefinition('tmpl-collect-tomap-duplicate', 'standard')
    let current = createInitialSnapshot(def)
    // 全ステップが正常returnであること（throwしない）
    for (;;) {
      const next = (() => {
        try {
          return nextSnapshot(def, current)
        } catch (e) {
          throw new Error(
            `nextSnapshotが例外を送出しました（${e instanceof EngineInvariantError ? 'EngineInvariantError' : 'Error'}）: ${(e as Error).message}`,
          )
        }
      })()
      if (next === null) break
      current = next
    }
    expect(current.kind).toBe('COLLECT_FAILED')
    // COLLECT_FAILEDの次はnullを返す（列を終える）
    expect(nextSnapshot(def, current)).toBeNull()
  })

  it('P8-D16: result消費箇所の棚卸し（null分岐が必要なのはUI 1か所のみ）', () => {
    // Simulation Core側でSnapshotOutput.resultを読む箇所はテスト・UIに限られ、
    // COLLECT_FAILED以外では非nullが保証される（上のtemplate走査で機械検証済み）。
    // ここではCOLLECT_FAILED以外の全snapshotでresultが非nullであることを再確認する
    for (const mode of ['standard', 'emptySource'] as const) {
      for (const snapshot of snapshotsOf('tmpl-collect-tomap-identity', mode)) {
        expect(snapshot.output.result).not.toBeNull()
      }
    }
  })
})

describe('P8-D17 決定性・復元', () => {
  it('P8-D17: 同一revisionの再実行で同一のsnapshot列・ID列を生成する（失敗列を含む）', () => {
    for (const templateId of [
      'tmpl-collect-tomap-duplicate',
      'tmpl-collect-tomap-merge-concat',
      'tmpl-collect-tomap-treemap',
    ]) {
      const def = makeDefinition(templateId, 'standard')
      const first = runAllSnapshots(def)
      const second = runAllSnapshots(def)
      expect(first.map((s) => s.snapshotId), templateId).toEqual(second.map((s) => s.snapshotId))
      expect(kindElementPairs(first), templateId).toEqual(kindElementPairs(second))
      expect(JSON.stringify(first), templateId).toBe(JSON.stringify(second))
    }
  })

  it('P8-D17: 任意cursorへの移動（戻る→進む）でexecutionFailure・蓄積view・contextが完全復元される', () => {
    const def = makeDefinition('tmpl-collect-tomap-duplicate', 'standard')
    const forward = runAllSnapshots(def)
    // 各位置から1件戻って再度進む操作を全位置で行い、同一オブジェクトが得られること
    for (let i = 1; i < forward.length; i++) {
      const back = forward[i - 1]!
      const again = nextSnapshot(def, back)
      expect(again, `index ${i}`).not.toBeNull()
      expect(JSON.stringify(again), `index ${i}`).toBe(JSON.stringify(forward[i]))
    }
    const failed = forward[forward.length - 1]!
    expect(failed.executionFailure).not.toBeNull()
    // 復元後もsnapshotだけからExecutionFailureView・蓄積viewが読める
    const restored = nextSnapshot(def, forward[forward.length - 2]!)!
    expect(restored.executionFailure).toEqual(failed.executionFailure)
    expect(toMapEntryPairs(findToMapNode(collectorCtxOf(restored).root)!)).toEqual(['関東="伊藤"'])
  })

  it('P8-D17: merge・重複のcontextもsnapshotのみから復元できる', () => {
    const def = makeDefinition('tmpl-collect-tomap-merge-concat', 'standard')
    const snapshots = runAllSnapshots(def)
    for (const snapshot of snapshots) {
      const restored = snapshot.index === 0 ? createInitialSnapshot(def) : nextSnapshot(def, snapshots[snapshot.index - 1]!)!
      expect(JSON.stringify(restored.processing), `${snapshot.index}`).toBe(
        JSON.stringify(snapshot.processing),
      )
      expect(JSON.stringify(restored.operationContexts), `${snapshot.index}`).toBe(
        JSON.stringify(snapshot.operationContexts),
      )
    }
  })
})

/**
 * **P8-D18は Phase 8 未実装ID である。**
 *
 * 指示§8.1-5・§12.1 P8-D18は teeing branch直下 / branch内部への toMap 配置の実行と列検証
 * （更新kindの排他・4引数版のTreeMap生成context）を要求するが、teeingのbranch結果型は
 * merger record（`SalarySummary(long employeeCount, double averageSalary)`）に拘束され、
 * `TEEING_MERGER_IDS`は`'SalarySummary::new'`の1件のみである。Map結果のbranchは
 * `resolveCollectorType`で必ず拒否されるため、**実行して列を検証する手段が存在しない**。
 * §11「既存ホワイトリストの変更をしない」方針（ユーザー決定2026-08-13）に従い、
 * merger IDを追加せず本IDは未実装のままとする（docs/phase-8-decisions.md §9）。
 *
 * 以下のテストは**P8-D18の契約を満たすものではない**。制約そのものを記録として固定し、
 * toMap追加が既存teeingへ副作用を与えていないことを回帰確認するだけである。
 * 必須ID成功の根拠として数えてはならない。
 */
describe('P8-D18 teeing排他・branch生成表示（Phase 8未実装。以下は制約の記録と既存teeingの回帰のみ）', () => {
  it('P8-D18(未実装記録): teeing branchへのtoMap配置は型検証で拒否され、Step Engineへ到達しない', () => {
    // 左右どちらのbranchへ置いても resolveCollectorType が TYPE_MISMATCH を返す。
    // これはP8-D18の契約検証ではなく、契約を検証できない理由の機械的な固定である
    for (const [label, dsl, path] of [
      [
        'left',
        {
          kind: 'teeing',
          left: toMap2(NAME_KEY, NAME_VALUE),
          right: { kind: 'averagingLong', field: 'salary' },
          mergerId: 'SalarySummary::new',
        },
        'collector.left',
      ],
      [
        'right',
        {
          kind: 'teeing',
          left: { kind: 'counting' },
          right: toMap2(NAME_KEY, NAME_VALUE),
          mergerId: 'SalarySummary::new',
        },
        'collector.right',
      ],
    ] as const) {
      // 構造検証は通る（v0.11 §8.6のleaf配置許可）が、型検証で拒否される
      expect(validateCollectorStructure(dsl).ok, label).toBe(true)
      const typed = resolveCollectorType(dsl as CollectorDsl, TYPE_EMPLOYEE)
      expect(typed.ok, label).toBe(false)
      if (!typed.ok) {
        expect(typed.issues[0]?.code, label).toBe('TYPE_MISMATCH')
        expect(typed.issues[0]?.path, label).toBe(path)
      }
    }
    // merger whitelistが1件のみであることが制約の直接原因である
    expect([...TEEING_MERGER_IDS]).toEqual(['SalarySummary::new'])
    expect(TEEING_MERGER_RECORDS['SalarySummary::new'].fields.map((f) => f.javaType)).toEqual([
      'long',
      'double',
    ])
  })

  it('P8-D18(回帰): 既存teeing templateのsnapshot列がPhase 8で変化していない', () => {
    // toMap追加によるteeing排他規則（isLeafAccumulator）への副作用がないことの回帰確認。
    // P8-D18の契約（branch直下toMapの更新kind置換）を検証するものではない
    const kinds = runAllSnapshots(makeDefinition('tmpl-collect-teeing', 'standard')).map((s) => s.kind)
    expect(kinds.filter((k) => k === 'TEE_BRANCH_ACCUMULATED')).toHaveLength(
      STANDARD_EMPLOYEES.length * 2,
    )
    expect(kinds.filter((k) => k === 'TEE_BRANCH_FINISHED')).toHaveLength(2)
    expect(kinds.filter((k) => k === 'TEE_MERGER_APPLIED')).toHaveLength(1)
  })

  it('P8-D18(残作業の固定): merger ID追加時に必要となる未対応箇所が現存することを記録する', () => {
    // 将来 Map結果を受け取れる merger record を追加してteeing × toMapを到達可能にする場合、
    // 次の3点が未対応のまま残っている（docs/phase-8-decisions.md §9・完了報告§17）。
    //
    // (1) teeing走査で ctx.path を左右branch間で復元していない
    //     （collectorRuntime.ts の teeing 分岐は ctx.pathLabels のみ長さを戻す）。
    //     右branchで失敗すると collectorPath が ['c0','c0.left','c0.right'] になり、
    //     v0.11 §6.2の9が期待する ['c0','c0.right'] と一致しない。
    //     現行の currentPath は Phase 5 の既存teeing snapshot契約であるため、
    //     Phase 8では変更していない（既存列を変えないことを優先）。
    //     ここでは既存挙動を固定し、将来の変更が無自覚に起きないようにする。
    const teeingSnapshots = runAllSnapshots(makeDefinition('tmpl-collect-teeing', 'standard'))
    const rightBranchPaths = teeingSnapshots
      .filter((s) => s.kind === 'TEE_BRANCH_ACCUMULATED')
      .map((s) => collectorCtxOf(s).currentPath)
      .filter((p) => p.includes('c0.right'))
    expect(rightBranchPaths.length).toBeGreaterThan(0)
    for (const path of rightBranchPaths) {
      // 右branch処理時に左branchのnode keyが経路へ残る（既存挙動。要変更点(1)）
      expect(path).toEqual(['c0', 'c0.left', 'c0.right'])
    }
    //
    // (2) branch直下 / branch内部（adapter経由）の更新kind排他は isLeafAccumulator と
    //     overrideKind の既存機構に依存しており、toMapでの実行検証ができていない。
    //
    // (3) 初回 TEE_BRANCH_ACCUMULATED / 0件branchの TEE_BRANCH_FINISHED のcontextへ
    //     4引数版toMapのTreeMap生成表示を載せる実装は**未着手**である。
    //     現行の TEE_BRANCH_FINISHED は生成表示を持たないことを固定する
    const finished = teeingSnapshots.filter((s) => s.kind === 'TEE_BRANCH_FINISHED')
    expect(finished).toHaveLength(2)
    for (const snapshot of finished) {
      expect(snapshot.explanation.jdkNote ?? '').not.toContain('TreeMap')
      expect(snapshot.processing?.evaluation ?? '').not.toContain('TreeMap')
    }
  })
})
