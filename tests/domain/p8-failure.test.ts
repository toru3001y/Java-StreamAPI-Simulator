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
  lastOf,
  runLocalCollector,
  snapshotsOf,
  toMap2,
  toMap4,
  toMapEntryPairs,
} from '../p8-helpers'
import { findTeeingView, localCollectTemplate } from '../p5-helpers'
import { makeCustomDefinition } from '../p3-helpers'

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
 * P8-D15: v0.11 §6.2の9が要求する6配置のうちpartitioningBy・adapter系・teeing branchを
 * 検証する（root / 単段 / 多段groupingByはP8-D13 / P8-D14）。
 * teeing branch配置はPhase 8ではmerger record型契約により構築不能だったが、
 * v0.12の`RegionIndex::new`追加で検証可能になった（docs/phase-8-decisions.md §9.1 A案）。
 */
describe('P8-D15 ExecutionFailureView: その他配置（partitioningBy / adapter系 / teeing branch）', () => {
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

  it('P8-D15: teeing branch配置（第6配置）はcollectorPath = [c0, c0.left]・bucketPath空である', () => {
    const { snapshots } = runLocalCollector(
      'tmpl-p9-local-fail-teeing',
      ['teeing', 'toMap', 'counting'],
      {
        kind: 'teeing',
        left: toMap2(),
        right: { kind: 'counting' },
        mergerId: 'RegionIndex::new',
      },
      MERGE_DEMO_EMPLOYEES,
    )
    const failure = failureOf(snapshots)
    expect(failure).toEqual({
      kind: 'DUPLICATE_TO_MAP_KEY',
      exceptionType: 'IllegalStateException',
      collectorPath: ['c0', 'c0.left'],
      bucketPath: [],
      duplicateKeyLabel: '関東',
      duplicateKeyRef: 'str:関東',
      existingValueLabel: '"伊藤"',
      incomingValueLabel: '"渡辺"',
    })
    // collectorPathは同一snapshotのcurrentPathと同じ値・規約である（P8-D13と同じ整合）
    const last = snapshots[snapshots.length - 1]!
    expect(failure.collectorPath).toEqual(collectorCtxOf(last).currentPath)
    // 失敗要素（渡辺）のTEE_BRANCH_ACCUMULATEDは不発行で、右branchは未処理のまま終端する（v0.11 §6.3）
    const pairs = kindElementPairs(
      snapshots.filter((s) =>
        [
          'TO_MAP_KEY_EVALUATED',
          'TO_MAP_VALUE_EVALUATED',
          'DUPLICATE_KEY_DETECTED',
          'MERGE_FUNCTION_APPLIED',
          'TEE_BRANCH_ACCUMULATED',
          'TEE_BRANCH_FINISHED',
          'TEE_MERGER_APPLIED',
          'CONTAINER_UPDATED',
        ].includes(s.kind),
      ),
    )
    expect(pairs).toEqual([
      'TO_MAP_KEY_EVALUATED(emp-101)',
      'TO_MAP_VALUE_EVALUATED(emp-101)',
      'TEE_BRANCH_ACCUMULATED(emp-101)',
      'TEE_BRANCH_ACCUMULATED(emp-101)',
      'TO_MAP_KEY_EVALUATED(emp-102)',
      'TO_MAP_VALUE_EVALUATED(emp-102)',
      'DUPLICATE_KEY_DETECTED(emp-102)',
    ])
    // 失敗したbranchの状態はACCUMULATEDのまま残さない（蓄積確定は起きていない）
    const tee = findTeeingView(collectorCtxOf(last).root)
    expect(tee).not.toBeNull()
    expect(tee?.activeBranch).toBe('NONE')
    expect(tee?.leftState).toBe('ACCUMULATING')
    expect(tee?.rightState).toBe('ACCUMULATED')
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
 * P8-D18: teeing branch直下 / branch内部（adapter経由）のtoMap配置における
 * 更新kindの排他（v0.11 §6.3）とbranchのMap生成表示（親種別表teeing行）を検証する。
 * Phase 8ではmerger record型契約（SalarySummary 1件のみ）により構築不能だったが、
 * v0.12でMap<String, String>を受ける`RegionIndex::new`を追加し到達可能になった
 * （docs/phase-8-decisions.md §9.1 A案の実施）。
 */
describe('P8-D18 teeing排他・branch生成表示（v0.12 RegionIndex::newで到達可能）', () => {
  it('P8-D18: merger record型契約 — SalarySummaryへのtoMapは拒否・RegionIndexは受理', () => {
    // merger recordの型契約はJava言語制約（mergerの引数型 = branch結果型）の写像であり、
    // SalarySummary（long / double）へのtoMap配置は引き続き左右どちらもTYPE_MISMATCHになる
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
    // v0.12: merger whitelistへMap<String, String>を受けるRegionIndexを追加した
    expect([...TEEING_MERGER_IDS]).toEqual(['SalarySummary::new', 'RegionIndex::new'])
    expect(TEEING_MERGER_RECORDS['SalarySummary::new'].fields.map((f) => f.javaType)).toEqual([
      'long',
      'double',
    ])
    expect(TEEING_MERGER_RECORDS['RegionIndex::new'].fields.map((f) => f.javaType)).toEqual([
      'Map<String, String>',
      'long',
    ])
    const regionIndex: unknown = {
      kind: 'teeing',
      left: toMap4('first'),
      right: { kind: 'counting' },
      mergerId: 'RegionIndex::new',
    }
    expect(validateCollectorStructure(regionIndex).ok).toBe(true)
    expect(resolveCollectorType(regionIndex as CollectorDsl, TYPE_EMPLOYEE).ok).toBe(true)
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

  it('P8-D18: branch直下toMapの更新kind排他 — 成功put / mergeの全列でCONTAINER_UPDATED不発行', () => {
    // v0.11 §6.3: branch直下の蓄積更新はTEE_BRANCH_ACCUMULATEDへ置換される。
    // 成功put（101 / 104 / 105）とmerge（102 / 103）の両分岐を同一実行で通過する
    const snapshots = snapshotsOf('tmpl-collect-teeing-tomap')
    const filtered = snapshots.filter((s) =>
      [
        'TO_MAP_KEY_EVALUATED',
        'TO_MAP_VALUE_EVALUATED',
        'DUPLICATE_KEY_DETECTED',
        'MERGE_FUNCTION_APPLIED',
        'TEE_BRANCH_ACCUMULATED',
        'TEE_BRANCH_FINISHED',
        'TEE_MERGER_APPLIED',
        'CONTAINER_UPDATED',
        'CONTAINER_CREATED',
      ].includes(s.kind),
    )
    const uniquePut = (id: string) => [
      `TO_MAP_KEY_EVALUATED(${id})`,
      `TO_MAP_VALUE_EVALUATED(${id})`,
      `TEE_BRANCH_ACCUMULATED(${id})`,
      `TEE_BRANCH_ACCUMULATED(${id})`,
    ]
    const mergedPut = (id: string) => [
      `TO_MAP_KEY_EVALUATED(${id})`,
      `TO_MAP_VALUE_EVALUATED(${id})`,
      `DUPLICATE_KEY_DETECTED(${id})`,
      `MERGE_FUNCTION_APPLIED(${id})`,
      `TEE_BRANCH_ACCUMULATED(${id})`,
      `TEE_BRANCH_ACCUMULATED(${id})`,
    ]
    expect(kindElementPairs(filtered)).toEqual([
      ...uniquePut('emp-101'),
      ...mergedPut('emp-102'),
      ...mergedPut('emp-103'),
      ...uniquePut('emp-104'),
      ...uniquePut('emp-105'),
      'TEE_BRANCH_FINISHED',
      'TEE_BRANCH_FINISHED',
      'TEE_MERGER_APPLIED',
    ])
  })

  it('P8-D18: branch経路の復元とMap生成表示（初回TEE_BRANCH_ACCUMULATED / 0件branch）', () => {
    const snapshots = snapshotsOf('tmpl-collect-teeing-tomap')
    const accumulated = snapshots.filter((s) => s.kind === 'TEE_BRANCH_ACCUMULATED')
    expect(accumulated).toHaveLength(MERGE_DEMO_EMPLOYEES.length * 2)
    // 要素ごとにLEFT → RIGHTの順で発行され、右branch経路へ左branchのkeyが残らない（v0.11 §6.2の9）
    accumulated.forEach((snapshot, i) => {
      expect(collectorCtxOf(snapshot).currentPath, `#${i}`).toEqual(
        i % 2 === 0 ? ['c0', 'c0.left'] : ['c0', 'c0.right'],
      )
    })
    // 既存teeing template（P5）の右branch経路も['c0', 'c0.right']へ復元される
    const p5RightPaths = runAllSnapshots(makeDefinition('tmpl-collect-teeing', 'standard'))
      .filter((s) => s.kind === 'TEE_BRANCH_ACCUMULATED')
      .map((s) => collectorCtxOf(s).currentPath)
      .filter((p) => p.includes('c0.right'))
    expect(p5RightPaths.length).toBeGreaterThan(0)
    for (const path of p5RightPaths) expect(path).toEqual(['c0', 'c0.right'])
    // branchのTreeMap生成は初回TEE_BRANCH_ACCUMULATED（LEFT）のcontextだけが表す（v0.11 §6.3親種別表）
    const notes = accumulated.map((s) => s.explanation.jdkNote ?? '')
    expect(notes[0]).toContain('このbranchのMap（TreeMap）はbranch蓄積の開始と同時に用意されます')
    for (const [i, note] of notes.entries()) {
      if (i === 0) continue
      expect(note, `#${i}`).not.toContain('用意されます')
    }
    // 全snapshot列を通しても生成注記は正確に1回
    expect(
      snapshots.filter((s) => (s.explanation.jdkNote ?? '').includes('用意されます')),
    ).toHaveLength(1)
    // 1件も蓄積しなかったbranchの生成表示はTEE_BRANCH_FINISHEDのcontextで表す（v0.11 §6.3）
    const emptySnapshots = runAllSnapshots(
      makeCustomDefinition(
        {
          ...localCollectTemplate('tmpl-p9-local-teeing-empty', ['teeing', 'toMap', 'counting']),
          supportedModes: ['emptySource'],
        },
        {
          'slot-collector': {
            kind: 'teeing',
            left: toMap4('first'),
            right: { kind: 'counting' },
            mergerId: 'RegionIndex::new',
          },
        },
        'emptySource',
        [],
        'tmpl-p9-local-teeing-empty:r1',
      ),
    )
    const finished = emptySnapshots.filter((s) => s.kind === 'TEE_BRANCH_FINISHED')
    expect(finished).toHaveLength(2)
    expect(finished[0]!.explanation.jdkNote ?? '').toContain(
      'このbranchのMap（TreeMap）はbranch蓄積の開始と同時に用意されます',
    )
    // 右branch（counting）はMapを持たないため生成表示なし
    expect(finished[1]!.explanation.jdkNote ?? '').not.toContain('用意されます')
    // 0件でもmergerは適用され、空TreeMapと0件が確定する
    const emptyLast = emptySnapshots[emptySnapshots.length - 1]!
    const emptyResult = emptyLast.output.result
    expect(emptyResult?.kind).toBe('RECORD')
    if (emptyResult?.kind === 'RECORD') {
      expect(emptyResult.recordName).toBe('RegionIndex')
      expect(emptyResult.fields).toEqual([
        { name: 'byRegion', typeLabel: 'Map<String, String>', valueLabel: '{}' },
        { name: 'count', typeLabel: 'long', valueLabel: '0' },
      ])
    }
  })

  it('P8-D18: branch内部（adapter経由） — 内部CONTAINER_UPDATED + branch確定の別事象、生成注記は全列で1回', () => {
    // teeing(filtering(age >= 33, toMap(region, name, first, TreeMap::new)), counting(), RegionIndex::new)。
    // 初回要素（伊藤 age=31）はfilteringで除外され、Mapは空のままbranch確定が発行される。
    // 生成注記が初回TEE_BRANCH_ACCUMULATEDの1回だけであること（Map entry有無からの導出では
    // 次要素へ重複発行される）を固定する
    const { snapshots } = runLocalCollector(
      'tmpl-p9-local-teeing-adapter',
      ['teeing', 'filtering', 'toMap', 'counting'],
      {
        kind: 'teeing',
        left: {
          kind: 'filtering',
          predicate: {
            kind: 'fieldCompare',
            field: 'age',
            operator: 'GTE',
            value: { type: 'int', value: 33 },
          },
          downstream: toMap4('first'),
        },
        right: { kind: 'counting' },
        mergerId: 'RegionIndex::new',
      },
      MERGE_DEMO_EMPLOYEES,
    )
    const pairs = kindElementPairs(
      snapshots.filter((s) =>
        [
          'TO_MAP_KEY_EVALUATED',
          'TO_MAP_VALUE_EVALUATED',
          'DUPLICATE_KEY_DETECTED',
          'MERGE_FUNCTION_APPLIED',
          'CONTAINER_UPDATED',
          'TEE_BRANCH_ACCUMULATED',
          'TEE_BRANCH_FINISHED',
          'TEE_MERGER_APPLIED',
        ].includes(s.kind),
      ),
    )
    // 通過要素: 内部更新はCONTAINER_UPDATEDどおり発行し、branch確定TEE_BRANCH_ACCUMULATEDを
    // 別事象として1件発行する（v0.11 §6.3のbranch内部規則）
    const passed = (id: string) => [
      `TO_MAP_KEY_EVALUATED(${id})`,
      `TO_MAP_VALUE_EVALUATED(${id})`,
      `CONTAINER_UPDATED(${id})`,
      `TEE_BRANCH_ACCUMULATED(${id})`,
      `TEE_BRANCH_ACCUMULATED(${id})`,
    ]
    // 除外要素: 内部更新なしでもbranch確定は発行される
    const excluded = (id: string) => [
      `TEE_BRANCH_ACCUMULATED(${id})`,
      `TEE_BRANCH_ACCUMULATED(${id})`,
    ]
    expect(pairs).toEqual([
      ...excluded('emp-101'),
      ...passed('emp-102'),
      ...excluded('emp-103'),
      ...passed('emp-104'),
      ...excluded('emp-105'),
      'TEE_BRANCH_FINISHED',
      'TEE_BRANCH_FINISHED',
      'TEE_MERGER_APPLIED',
    ])
    // 生成注記は初回TEE_BRANCH_ACCUMULATED（除外された伊藤のbranch確定）に正確に1回
    const noted = snapshots.filter((s) => (s.explanation.jdkNote ?? '').includes('用意されます'))
    expect(noted).toHaveLength(1)
    const firstAccumulated = snapshots.find((s) => s.kind === 'TEE_BRANCH_ACCUMULATED')!
    expect(noted[0]!.snapshotId).toBe(firstAccumulated.snapshotId)
    expect(noted[0]!.explanation.jdkNote).toContain('このbranchのMap（TreeMap）')
    // 最終結果: filteringを通過した2件のみがMapへ、countingはteeingへ来た全5件を数える
    const last = snapshots[snapshots.length - 1]!
    const result = last.output.result
    expect(result?.kind).toBe('RECORD')
    if (result?.kind === 'RECORD') {
      expect(result.fields).toEqual([
        {
          name: 'byRegion',
          typeLabel: 'Map<String, String>',
          valueLabel: '{関東="渡辺", 関西="中村"}',
        },
        { name: 'count', typeLabel: 'long', valueLabel: '5' },
      ])
    }
  })

  it('P8-D18: 全要素除外branchでも生成注記は初回TEE_BRANCH_ACCUMULATEDの1回だけ（TEE_BRANCH_FINISHEDへ重ねない）', () => {
    const { snapshots } = runLocalCollector(
      'tmpl-p9-local-teeing-adapter-empty',
      ['teeing', 'filtering', 'toMap', 'counting'],
      {
        kind: 'teeing',
        left: {
          kind: 'filtering',
          predicate: {
            kind: 'fieldCompare',
            field: 'age',
            operator: 'GTE',
            value: { type: 'int', value: 200 },
          },
          downstream: toMap4('first'),
        },
        right: { kind: 'counting' },
        mergerId: 'RegionIndex::new',
      },
      MERGE_DEMO_EMPLOYEES,
    )
    // branch確定（TEE_BRANCH_ACCUMULATED）は発行済みのため、TEE_BRANCH_FINISHEDへ注記を重ねない
    const noted = snapshots.filter((s) => (s.explanation.jdkNote ?? '').includes('用意されます'))
    expect(noted).toHaveLength(1)
    expect(noted[0]!.kind).toBe('TEE_BRANCH_ACCUMULATED')
    for (const snapshot of snapshots.filter((s) => s.kind === 'TEE_BRANCH_FINISHED')) {
      expect(snapshot.explanation.jdkNote ?? '').not.toContain('用意されます')
    }
    // 全件除外でも結果は空TreeMapと全件count
    const last = snapshots[snapshots.length - 1]!
    expect(last.output.result?.kind).toBe('RECORD')
    if (last.output.result?.kind === 'RECORD') {
      expect(last.output.result.fields.map((f) => f.valueLabel)).toEqual(['{}', '5'])
    }
  })

  it('P8-D18: merger適用結果 — RegionIndexがMap値（TreeMap実entry順）と件数を保持する', () => {
    const last = lastOf('tmpl-collect-teeing-tomap')
    const result = last.output.result
    expect(result?.kind).toBe('RECORD')
    if (result?.kind === 'RECORD') {
      expect(result.recordName).toBe('RegionIndex')
      expect(result.fields).toEqual([
        {
          name: 'byRegion',
          typeLabel: 'Map<String, String>',
          valueLabel: '{中部="小林", 関東="伊藤", 関西="中村"}',
        },
        { name: 'count', typeLabel: 'long', valueLabel: '5' },
      ])
    }
  })
})
