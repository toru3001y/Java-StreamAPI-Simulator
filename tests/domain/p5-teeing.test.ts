import { describe, expect, it } from 'vitest'
import type { PipelineTemplate } from '../../src/domain/template/pipelineTemplate'
import { OP_COLLECT, OP_SOURCE_COLLECTION_STREAM } from '../../src/domain/catalog/operations'
import { STANDARD_EMPLOYEES } from '../../src/domain/fixtures/employees'
import { runAllSnapshots } from '../helpers'
import { makeCustomDefinition } from '../p3-helpers'
import { collectorContextOf, findTeeingView, kindsOf, lastOf, processingCount, snapshotsOf } from '../p5-helpers'

/**
 * P5-D19〜P5-D23・P5-D32: teeing（docs/phase-5-decisions.md §3〜§11の確定事項）。
 * §10の機械検証条件1〜18の担当テスト。
 */

const TEEING_COLLECTOR = {
  kind: 'teeing',
  left: { kind: 'counting' },
  right: { kind: 'averagingLong', field: 'salary' },
  mergerId: 'SalarySummary::new',
} as const

/** テストローカルtemplate（教材templateとして登録しない構造の機械検証用） */
function localCollectTemplate(
  templateId: string,
  allowedCollectorKinds: readonly string[],
): PipelineTemplate {
  return {
    templateId,
    version: 1,
    targetOperationId: OP_COLLECT,
    targetNodeId: 'node-sink',
    title: templateId,
    sourceDefinition: {
      slotId: null,
      defaultDsl: { kind: 'collection', collectionId: 'employees' },
      allowedSourceKinds: ['collection'],
    },
    nodes: [
      { nodeId: 'node-src', operationId: OP_SOURCE_COLLECTION_STREAM, role: 'source', slotId: null },
      { nodeId: 'node-sink', operationId: OP_COLLECT, role: 'terminal', slotId: 'slot-collector' },
    ],
    parameterSlots: [
      {
        slotId: 'slot-collector',
        targetNodeId: 'node-sink',
        kind: 'collector',
        required: true,
        allowedCollectorKinds,
      },
    ],
    allowedDslProfile: { predicateKinds: [] },
    supportedModes: ['standard'],
    jdkNotes: [],
    snapshotBudget: { limit: 500, estimatedMax: 120 },
  }
}

describe('P5-D19 teeing蓄積', () => {
  it('P5-D19: 左右に同じ安定elementId・入力1件につき左右各1回・別snapshot・左→右の決定的順序（§10条件2〜6）', () => {
    const snapshots = snapshotsOf('tmpl-collect-teeing')
    const accumulated = snapshots.filter((s) => s.kind === 'TEE_BRANCH_ACCUMULATED')
    // 入力4件 × 左右2回
    expect(accumulated).toHaveLength(8)

    const perElement = new Map<string, string[]>()
    for (const snapshot of accumulated) {
      const view = findTeeingView(collectorContextOf(snapshot).root)
      expect(view).not.toBeNull()
      expect(snapshot.currentElementId).not.toBeNull()
      // 左右で同じ安定elementIdを参照する（要素を複製して別IDを付与しない）
      expect(view?.currentElementId).toBe(snapshot.currentElementId)
      const key = String(snapshot.currentElementId)
      perElement.set(key, [...(perElement.get(key) ?? []), String(view?.activeBranch)])
    }
    expect([...perElement.keys()]).toEqual(['emp-001', 'emp-002', 'emp-003', 'emp-004'])
    for (const [elementId, branches] of perElement) {
      // 左右それぞれ正確に1回、順序は左→右
      expect(branches, elementId).toEqual(['LEFT', 'RIGHT'])
    }
    // 左右の蓄積更新は別snapshot（同一snapshotへまとめない）
    expect(new Set(accumulated.map((s) => s.snapshotId)).size).toBe(8)
  })

  it('P5-D19: 右branch完了前に次の入力要素を処理しない（§10条件7）', () => {
    const snapshots = snapshotsOf('tmpl-collect-teeing')
    const kinds = snapshots.map((s) => s.kind)
    // NODE_ARRIVAL → LEFT → RIGHT の3件が要素ごとに連続する
    for (let i = 0; i < kinds.length; i++) {
      if (kinds[i] !== 'NODE_ARRIVAL') continue
      expect(kinds[i + 1]).toBe('TEE_BRANCH_ACCUMULATED')
      expect(kinds[i + 2]).toBe('TEE_BRANCH_ACCUMULATED')
      const left = findTeeingView(collectorContextOf(snapshots[i + 1]!).root)
      const right = findTeeingView(collectorContextOf(snapshots[i + 2]!).root)
      expect(left?.activeBranch).toBe('LEFT')
      expect(right?.activeBranch).toBe('RIGHT')
      // 次の要素の到着は右branch確定より後
      expect(kinds[i + 3]).not.toBe('TEE_BRANCH_ACCUMULATED')
    }
  })
})

describe('P5-D20 teeing merger', () => {
  it('P5-D20: 全蓄積・両finisher完了後にmergerを1回・currentElementId null・PROCESSING 0件（§10条件8〜12）', () => {
    const snapshots = snapshotsOf('tmpl-collect-teeing')
    const kinds = snapshots.map((s) => s.kind)
    const mergerIdx = kinds.indexOf('TEE_MERGER_APPLIED')
    expect(countOf(kinds, 'TEE_MERGER_APPLIED')).toBe(1)
    // 全入力の左右蓄積完了後
    expect(kinds.lastIndexOf('TEE_BRANCH_ACCUMULATED')).toBeLessThan(mergerIdx)
    // 両downstreamのfinisher完了後
    const finished = kinds.reduce<number[]>((acc, k, i) => (k === 'TEE_BRANCH_FINISHED' ? [...acc, i] : acc), [])
    expect(finished).toHaveLength(2)
    for (const idx of finished) expect(idx).toBeLessThan(mergerIdx)

    const merger = snapshots[mergerIdx]!
    expect(merger.currentElementId).toBeNull()
    expect(processingCount(merger)).toBe(0)
    const view = findTeeingView(collectorContextOf(merger).root)
    expect(view?.activeBranch).toBe('NONE')
    expect(view?.mergerApplied).toBe(true)
    // R1・R2・RのTypeRefを区別して表示する（§10条件13）
    expect(view?.leftResultTypeLabel).toBe('Long')
    expect(view?.rightResultTypeLabel).toBe('Double')
    expect(view?.resultTypeLabel).toBe('SalarySummary')
    expect(view?.leftResultLabel).toBe('4')
    expect(view?.rightResultLabel).toBe('5425000.0')
    expect(view?.mergerLabel).toBe('SalarySummary::new')
    expect(view?.finalResultLabel).toContain('employeeCount=4')

    // merger適用前に最終結果を先行表示しない
    const beforeMerger = snapshots[mergerIdx - 1]!
    expect(findTeeingView(collectorContextOf(beforeMerger).root)?.finalResultLabel).toBeNull()
    // teeing branch rootにはCOLLECTOR_FINISHEDを二重発行しない（§9.1規則4）
    expect(countOf(kinds, 'COLLECTOR_FINISHED')).toBe(0)
  })
})

describe('P5-D21 teeing空Stream', () => {
  it('P5-D21: 蓄積0件でもTEE_BRANCH_FINISHED×2 → merger 1回・結果0 / 0.0（§10条件15・16）', () => {
    const kinds = kindsOf('tmpl-collect-teeing', 'emptySource')
    expect(kinds).toEqual([
      'INITIAL',
      'TEE_BRANCH_FINISHED',
      'TEE_BRANCH_FINISHED',
      'TEE_MERGER_APPLIED',
      'RESULT_CONFIRMED',
      'STREAM_CONSUMED',
    ])
    const result = lastOf('tmpl-collect-teeing', 'emptySource').output.result
    expect(result).toEqual({
      kind: 'RECORD',
      recordName: 'SalarySummary',
      fields: [
        { name: 'employeeCount', typeLabel: 'long', valueLabel: '0' },
        { name: 'averageSalary', typeLabel: 'double', valueLabel: '0.0' },
      ],
    })
    // merger snapshotは空Streamでもcurrent要素なし・PROCESSING 0件
    const merger = snapshotsOf('tmpl-collect-teeing', 'emptySource').find(
      (s) => s.kind === 'TEE_MERGER_APPLIED',
    )!
    expect(merger.currentElementId).toBeNull()
    expect(processingCount(merger)).toBe(0)

    // 途中0件でも同じ構造（蓄積0件 → finisher×2 → merger 1回）
    const midKinds = kindsOf('tmpl-collect-teeing-midempty', 'midEmpty')
    expect(countOf(midKinds, 'TEE_BRANCH_ACCUMULATED')).toBe(0)
    expect(countOf(midKinds, 'TEE_BRANCH_FINISHED')).toBe(2)
    expect(countOf(midKinds, 'TEE_MERGER_APPLIED')).toBe(1)
  })
})

describe('P5-D22 nested teeing', () => {
  it('P5-D22: 複数teeingノードでもdepth-first・各merger 1回・依存順・PROCESSING最大1件（§10条件17・18）', () => {
    // groupingBy(region, teeing(...)) はbucketごとに独立したteeingノードを持つ入れ子構造
    const template = localCollectTemplate('tmpl-p5-local-nested-teeing', [
      'groupingBy',
      'teeing',
      'counting',
      'averagingLong',
    ])
    const def = makeCustomDefinition(
      template,
      {
        'slot-collector': {
          kind: 'groupingBy',
          classifier: { kind: 'employeeField', field: 'region' },
          mapFactoryId: null,
          downstream: TEEING_COLLECTOR,
        },
      },
      'standard',
      STANDARD_EMPLOYEES,
      'p5-nested-teeing:r1',
    )
    const snapshots = runAllSnapshots(def)
    const kinds = snapshots.map((s) => s.kind)
    // bucketは関東 / 関西 / 中部の3件 → teeingノードも3件
    expect(countOf(kinds, 'BUCKET_SELECTED')).toBe(4)
    // 各teeingノードにつき正確に1回のmerger
    expect(countOf(kinds, 'TEE_MERGER_APPLIED')).toBe(3)
    // 各teeingノードにつき左右2件のfinisher
    expect(countOf(kinds, 'TEE_BRANCH_FINISHED')).toBe(6)
    // 入力4件 × 左右2回
    expect(countOf(kinds, 'TEE_BRANCH_ACCUMULATED')).toBe(8)
    // 依存順: 各mergerは対応する左右finisherの後
    let finishedSeen = 0
    for (const kind of kinds) {
      if (kind === 'TEE_BRANCH_FINISHED') finishedSeen += 1
      if (kind === 'TEE_MERGER_APPLIED') {
        expect(finishedSeen % 2).toBe(0)
        expect(finishedSeen).toBeGreaterThanOrEqual(2)
      }
    }
    // nested構造でもグローバルなPROCESSING要素数は最大1件
    for (const snapshot of snapshots) {
      expect(processingCount(snapshot), snapshot.snapshotId).toBeLessThanOrEqual(1)
    }
    expect(def.snapshotCount).toBeLessThanOrEqual(500)
  })

  it('P5-D22: teeing branchが合成Collectorのとき、内部はCONTAINER_UPDATED・branchはTEE_BRANCH_ACCUMULATED 1件', () => {
    const template = localCollectTemplate('tmpl-p5-local-teeing-composite', [
      'teeing',
      'filtering',
      'counting',
      'averagingLong',
    ])
    const def = makeCustomDefinition(
      template,
      {
        'slot-collector': {
          kind: 'teeing',
          left: {
            kind: 'filtering',
            predicate: {
              kind: 'fieldCompare',
              field: 'salary',
              operator: 'GTE',
              value: { type: 'long', value: 5_000_000 },
            },
            downstream: { kind: 'counting' },
          },
          right: { kind: 'averagingLong', field: 'salary' },
          mergerId: 'SalarySummary::new',
        },
      },
      'standard',
      STANDARD_EMPLOYEES,
      'p5-teeing-composite:r1',
    )
    const snapshots = runAllSnapshots(def)
    const kinds = snapshots.map((s) => s.kind)
    // branch内部の蓄積更新は汎用Collector snapshot（佐藤・高橋の2件のみ通過）
    expect(countOf(kinds, 'CONTAINER_UPDATED')).toBe(2)
    // branch単位の確定は入力1件につき左右各1回
    expect(countOf(kinds, 'TEE_BRANCH_ACCUMULATED')).toBe(8)
    expect(countOf(kinds, 'TEE_MERGER_APPLIED')).toBe(1)
    // 左結果はfilteringを通過した2件
    const merger = snapshots.find((s) => s.kind === 'TEE_MERGER_APPLIED')!
    expect(findTeeingView(collectorContextOf(merger).root)?.leftResultLabel).toBe('2')
  })

  it('P5-D22: teeing branch内部のnested Collectorのfinisherは汎用COLLECTOR_FINISHEDで発行され、branch rootはTEE_BRANCH_FINISHEDのみ（§9.1規則4）', () => {
    // 右branch = filtering(...)（合成）の内部にaveragingLong（発行対象）を置く構成
    const template = localCollectTemplate('tmpl-p5-local-teeing-internal-finisher', [
      'teeing',
      'filtering',
      'counting',
      'averagingLong',
    ])
    const salaryGte5m = {
      kind: 'fieldCompare',
      field: 'salary',
      operator: 'GTE',
      value: { type: 'long', value: 5_000_000 },
    } as const
    const def = makeCustomDefinition(
      template,
      {
        'slot-collector': {
          kind: 'teeing',
          left: { kind: 'filtering', predicate: salaryGte5m, downstream: { kind: 'counting' } },
          right: {
            kind: 'filtering',
            predicate: salaryGte5m,
            downstream: { kind: 'averagingLong', field: 'salary' },
          },
          mergerId: 'SalarySummary::new',
        },
      },
      'standard',
      STANDARD_EMPLOYEES,
      'p5-teeing-internal:r1',
    )
    const snapshots = runAllSnapshots(def)
    const kinds = snapshots.map((s) => s.kind)
    // branch内部のaveragingLongが汎用COLLECTOR_FINISHEDを1件発行する（countingは非発行）
    expect(countOf(kinds, 'COLLECTOR_FINISHED')).toBe(1)
    // branch rootのfilteringは自身のfinisherを発行しない。branch完了はTEE_BRANCH_FINISHEDのみ
    expect(countOf(kinds, 'TEE_BRANCH_FINISHED')).toBe(2)
    expect(countOf(kinds, 'TEE_MERGER_APPLIED')).toBe(1)
    // 内部finisherは対応するbranchのTEE_BRANCH_FINISHEDより先、mergerより前
    const internalIdx = kinds.indexOf('COLLECTOR_FINISHED')
    const rightBranchIdx = kinds.lastIndexOf('TEE_BRANCH_FINISHED')
    const mergerIdx = kinds.indexOf('TEE_MERGER_APPLIED')
    expect(internalIdx).toBeGreaterThan(0)
    expect(internalIdx).toBeLessThan(rightBranchIdx)
    expect(rightBranchIdx).toBeLessThan(mergerIdx)
    // 集合単位の確定snapshotなので処理中要素なし
    expect(snapshots[internalIdx]?.currentElementId).toBeNull()
    expect(processingCount(snapshots[internalIdx]!)).toBe(0)
    // 結果: filteringを通過した佐藤・高橋の件数と平均
    const last = snapshots[snapshots.length - 1]!
    expect(last.output.result).toEqual({
      kind: 'RECORD',
      recordName: 'SalarySummary',
      fields: [
        { name: 'employeeCount', typeLabel: 'long', valueLabel: '2' },
        { name: 'averageSalary', typeLabel: 'double', valueLabel: '6350000.0' },
      ],
    })
  })
})

describe('P5-D23 teeing標準結果', () => {
  it('P5-D23: 基準fixtureでemployeeCount=4・averageSalary=5425000.0（§10条件14）', () => {
    expect(lastOf('tmpl-collect-teeing').output.result).toEqual({
      kind: 'RECORD',
      recordName: 'SalarySummary',
      fields: [
        { name: 'employeeCount', typeLabel: 'long', valueLabel: '4' },
        { name: 'averageSalary', typeLabel: 'double', valueLabel: '5425000.0' },
      ],
    })
  })
})

describe('P5-D32 teeing context契約', () => {
  it('P5-D32: docs/phase-5-decisions.md §6の契約項目を1項目ずつ保持し、状態遷移が正しい', () => {
    const snapshots = snapshotsOf('tmpl-collect-teeing')
    const merger = snapshots.find((s) => s.kind === 'TEE_MERGER_APPLIED')!
    const ctx = collectorContextOf(merger)
    const view = findTeeingView(ctx.root)!

    // 1. teeing node ID
    expect(view.teeingNodeKey).toBe('c0')
    // 2. 左右downstreamのnode ID
    expect(view.leftNodeKey).toBe('c0.left')
    expect(view.rightNodeKey).toBe('c0.right')
    // 3. 左右downstreamのCollector AST（構造ツリーとして保持）
    expect(ctx.root.left?.collectorKind).toBe('counting')
    expect(ctx.root.right?.collectorKind).toBe('averagingLong')
    expect(ctx.root.left?.label).toBe('Collectors.counting()')
    expect(ctx.root.right?.label).toBe('Collectors.averagingLong(Employee::salary)')
    // 4. 現在の入力elementId（merger snapshotではnull）
    expect(view.currentElementId).toBeNull()
    // 5. activeBranchの3値
    expect(view.activeBranch).toBe('NONE')
    // 6. 左右branchの状態4値
    expect(view.leftState).toBe('FINISHED')
    expect(view.rightState).toBe('FINISHED')
    // 7. 左右の現在蓄積
    expect(view.leftAccumulationLabel).toBe('4')
    expect(view.rightAccumulationLabel).toContain('合計 21700000')
    // 8. 左右の結果値
    expect(view.leftResultLabel).toBe('4')
    expect(view.rightResultLabel).toBe('5425000.0')
    // 9. 左右の結果TypeRef（R1・R2）
    expect(view.leftResultTypeLabel).toBe('Long')
    expect(view.rightResultTypeLabel).toBe('Double')
    // 10. merger DSL / 識別子
    expect(view.mergerLabel).toBe('SalarySummary::new')
    // 11. merger適用済みフラグ
    expect(view.mergerApplied).toBe(true)
    // 12. 最終結果値
    expect(view.finalResultLabel).toBe('SalarySummary[employeeCount=4, averageSalary=5425000.0]')
    // 13. 最終結果TypeRef（R）
    expect(view.resultTypeLabel).toBe('SalarySummary')
    // 14. 教材上のbranch表示順が左→右であること
    expect(view.branchDisplayOrderNote).toContain('左→右')
    // 15. 左→右がJDKの呼出し順保証ではない旨の注記
    expect(view.jdkOrderNote).toContain('JDK')
    expect(view.jdkOrderNote).toContain('保証するものではありません')

    // 状態遷移: PENDING → ACCUMULATING/ACCUMULATED → FINISHED
    const initial = snapshots[0]!
    const initialView = findTeeingView(collectorContextOf(initial).root)!
    expect(initialView.leftState).toBe('PENDING')
    expect(initialView.rightState).toBe('PENDING')
    expect(initialView.mergerApplied).toBe(false)
    expect(initialView.finalResultLabel).toBeNull()

    const firstLeft = snapshots.find((s) => s.kind === 'TEE_BRANCH_ACCUMULATED')!
    expect(findTeeingView(collectorContextOf(firstLeft).root)?.leftState).toBe('ACCUMULATED')

    // 履歴復元: 同じ定義から同じsnapshot列を再現できる（戻る→進むはApplication側P5-A03）
    const again = snapshotsOf('tmpl-collect-teeing')
    expect(again.map((s) => s.kind)).toEqual(snapshots.map((s) => s.kind))
    expect(JSON.stringify(again.map((s) => s.operationContexts))).toBe(
      JSON.stringify(snapshots.map((s) => s.operationContexts)),
    )
  })
})

function countOf(kinds: readonly string[], kind: string): number {
  return kinds.filter((k) => k === kind).length
}
