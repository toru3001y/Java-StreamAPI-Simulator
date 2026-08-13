import { describe, expect, it } from 'vitest'
import type { CollectorNodeView, Snapshot, SnapshotKind } from '../../src/domain/engine/snapshot'
import {
  MERGE_DEMO_EMPLOYEES,
  NAME_KEY,
  NAME_VALUE,
  REGION_KEY,
  SALARY_VALUE,
  STANDARD_EMPLOYEES,
  collectorCtxOf,
  failureOf,
  kindElementPairs,
  kindsOf,
  lastOf,
  runLocalCollector,
  snapshotsOf,
} from '../p8-helpers'
import {
  findCollectorNode,
  runLocalCollectorEmpty,
  toUnmodList,
  toUnmodMap2,
  toUnmodMap3,
  toUnmodSet,
} from '../p11-helpers'

/**
 * P11-D07〜P11-D12: unmodifiable系の実行意味論・finisher発行契約・
 * 蓄積 / 結果ラベルの分離・実行失敗経路（v0.14 §2.3・§3.2・§3.3・§6）。
 */

/** 蓄積ラベル → 結果ラベルの対応（v0.14 §3.3） */
const LABEL_PAIRS = [
  { kind: 'toUnmodifiableList', accumulating: 'List（蓄積中）', result: 'List（unmodifiable）' },
  { kind: 'toUnmodifiableSet', accumulating: 'Set（蓄積中）', result: 'Set（unmodifiable）' },
  { kind: 'toUnmodifiableMap', accumulating: 'Map（蓄積中）', result: 'Map（unmodifiable）' },
] as const

/** finisher viewを持つノードのbefore / afterラベルを取り出す */
function finisherOf(node: CollectorNodeView): { before: string; after: string; label: string } {
  const finisher = node.finisher
  if (!finisher) throw new Error(`finisher viewがありません: ${node.collectorKind}`)
  if (finisher.beforeLabel === null || finisher.afterLabel === null) {
    throw new Error(`finisher未適用です: ${node.collectorKind}`)
  }
  return { before: finisher.beforeLabel, after: finisher.afterLabel, label: finisher.label }
}

/** 指定kindのsnapshotだけを抜き出す */
function only(snapshots: readonly Snapshot[], kind: SnapshotKind): Snapshot[] {
  return snapshots.filter((s) => s.kind === kind)
}

function countOf(kinds: readonly SnapshotKind[], kind: SnapshotKind): number {
  return kinds.filter((k) => k === kind).length
}

describe('P11-D07 snapshot列: 通常root配置（v0.14 §6の2軸表）', () => {
  it('P11-D07: toUnmodifiableList standardが蓄積4件 → COLLECTOR_FINISHED → RESULT_CONFIRMEDである', () => {
    const snapshots = snapshotsOf('tmpl-collect-tounmod-list', 'standard')
    expect(kindElementPairs(snapshots)).toEqual([
      'INITIAL',
      'SOURCE_EMIT(emp-001)',
      'NODE_ARRIVAL(emp-001)',
      'CONTAINER_UPDATED(emp-001)',
      'SOURCE_EMIT(emp-002)',
      'NODE_ARRIVAL(emp-002)',
      'CONTAINER_UPDATED(emp-002)',
      'SOURCE_EMIT(emp-003)',
      'NODE_ARRIVAL(emp-003)',
      'CONTAINER_UPDATED(emp-003)',
      'SOURCE_EMIT(emp-004)',
      'NODE_ARRIVAL(emp-004)',
      'CONTAINER_UPDATED(emp-004)',
      'COLLECTOR_FINISHED',
      'RESULT_CONFIRMED',
      'STREAM_CONSUMED',
    ])
    // CONTAINER_CREATEDは発行しない（既存toList / toSetと同じ）
    expect(snapshots.map((s) => s.kind)).not.toContain('CONTAINER_CREATED')
  })

  it('P11-D07: 空入力でも蓄積0件 + COLLECTOR_FINISHEDで不変コンテナが確定する', () => {
    for (const templateId of ['tmpl-collect-tounmod-list', 'tmpl-collect-tounmod-set']) {
      const kinds = kindsOf(templateId, 'emptySource')
      expect(kinds, templateId).toEqual([
        'INITIAL',
        'COLLECTOR_FINISHED',
        'RESULT_CONFIRMED',
        'STREAM_CONSUMED',
      ])
      expect(countOf(kinds, 'CONTAINER_UPDATED'), templateId).toBe(0)
    }
  })

  it('P11-D07: toUnmodifiableSetは既存Setと同じ重複判定・無変化表示を流用する', () => {
    const snapshots = snapshotsOf('tmpl-collect-tounmod-set', 'standard')
    const updates = only(snapshots, 'CONTAINER_UPDATED')
    expect(updates).toHaveLength(4)
    // 3件目（高橋＝関東の2件目）で状態が変化しない
    expect(updates[2]?.explanation.current).toContain('同値の要素が既にあるため状態は変化しません')
    expect(updates[2]?.processing.outcome).toContain('追加しても変化しません')
    const accumulation = findCollectorNode(
      collectorCtxOf(updates[2]!).root,
      'toUnmodifiableSet',
    )!.accumulation
    expect(accumulation.kind).toBe('ELEMENTS')
    if (accumulation.kind === 'ELEMENTS') {
      expect(accumulation.changedByLast).toBe(false)
      expect(accumulation.items).toHaveLength(2)
    }
  })

  it('P11-D07: toUnmodifiableMap standardは既存toMapのsnapshot列をそのまま使う', () => {
    const snapshots = snapshotsOf('tmpl-collect-tounmod-map', 'standard')
    const kinds = snapshots.map((s) => s.kind)
    // 新しいSnapshotKindは追加していない（v0.14 §2.3）
    expect(countOf(kinds, 'TO_MAP_KEY_EVALUATED')).toBe(5)
    expect(countOf(kinds, 'TO_MAP_VALUE_EVALUATED')).toBe(5)
    expect(countOf(kinds, 'DUPLICATE_KEY_DETECTED')).toBe(2)
    expect(countOf(kinds, 'MERGE_FUNCTION_APPLIED')).toBe(2)
    expect(countOf(kinds, 'COLLECTOR_FINISHED')).toBe(1)
    // 確定snapshotの直後にRESULT_CONFIRMEDが続く
    expect(kinds.slice(-3)).toEqual(['COLLECTOR_FINISHED', 'RESULT_CONFIRMED', 'STREAM_CONSUMED'])
    // 同一データ・同一merge（first）のtoMap教材と蓄積結果が一致する
    const unmod = lastOf('tmpl-collect-tounmod-map', 'standard')
    const toMap = lastOf('tmpl-collect-tomap-merge-first', 'standard')
    const unmodResult = unmod.output.result
    const toMapResult = toMap.output.result
    expect(unmodResult?.kind).toBe('MAP')
    if (unmodResult?.kind === 'MAP' && toMapResult?.kind === 'MAP') {
      expect(unmodResult.entries.map((e) => `${e.keyLabel}=${JSON.stringify(e.value)}`)).toEqual(
        toMapResult.entries.map((e) => `${e.keyLabel}=${JSON.stringify(e.value)}`),
      )
    }
  })
})

describe('P11-D08 finisher前後の機械検証（v0.14 §3.2・§6）', () => {
  it('P11-D08: 蓄積ラベル → 結果ラベルの遷移が確定snapshotのbefore / afterに現れる', () => {
    const cases = [
      { templateId: 'tmpl-collect-tounmod-list', kind: 'toUnmodifiableList' },
      { templateId: 'tmpl-collect-tounmod-set', kind: 'toUnmodifiableSet' },
      { templateId: 'tmpl-collect-tounmod-map', kind: 'toUnmodifiableMap' },
    ] as const
    for (const { templateId, kind } of cases) {
      const pair = LABEL_PAIRS.find((p) => p.kind === kind)!
      const finished = only(snapshotsOf(templateId, 'standard'), 'COLLECTOR_FINISHED')
      expect(finished, templateId).toHaveLength(1)
      const snapshot = finished[0]!
      const node = findCollectorNode(collectorCtxOf(snapshot).root, kind)!
      const { before, after, label } = finisherOf(node)
      expect(before.startsWith(pair.accumulating), `${templateId}: before=${before}`).toBe(true)
      expect(after.startsWith(pair.result), `${templateId}: after=${after}`).toBe(true)
      // finisher表示ラベルは意味ラベル（Javaコード表記にしない。v0.14 §3.2）
      expect(label).toBe('unmodifiableへのラップ')
      // snapshotのevaluation行が「蓄積中 → unmodifiable」の遷移形である
      expect(snapshot.processing.evaluation).toBe(`${before} → ${after}`)
      expect(snapshot.processing.inputLabel, templateId).toContain(pair.accumulating)
      expect(snapshot.processing.outcome, templateId).toContain(pair.result)
    }
  })

  it('P11-D08: finisher前後で値（要素・entry列）とTypeRefが同一である', () => {
    const cases = [
      { templateId: 'tmpl-collect-tounmod-list', kind: 'toUnmodifiableList', typeLabel: 'List<Employee>' },
      { templateId: 'tmpl-collect-tounmod-set', kind: 'toUnmodifiableSet', typeLabel: 'Set<String>' },
      {
        templateId: 'tmpl-collect-tounmod-map',
        kind: 'toUnmodifiableMap',
        typeLabel: 'Map<String, String>',
      },
    ] as const
    for (const { templateId, kind, typeLabel } of cases) {
      const pair = LABEL_PAIRS.find((p) => p.kind === kind)!
      const snapshot = only(snapshotsOf(templateId, 'standard'), 'COLLECTOR_FINISHED')[0]!
      const node = findCollectorNode(collectorCtxOf(snapshot).root, kind)!
      const { before, after } = finisherOf(node)
      // ラベル部分だけを取り除くと値の表示が完全に一致する（値は変換されない）
      expect(before.slice(pair.accumulating.length), templateId).toBe(
        after.slice(pair.result.length),
      )
      expect(before.slice(pair.accumulating.length).length, templateId).toBeGreaterThan(0)
      // TypeRefも前後で同一（不変性の軸をTypeRefへ追加しない。v0.14 §2.1）
      const finisher = node.finisher!
      expect(finisher.beforeTypeLabel, templateId).toBe(typeLabel)
      expect(finisher.afterTypeLabel, templateId).toBe(typeLabel)
      expect(node.resultTypeLabel, templateId).toBe(typeLabel)
    }
  })

  it('P11-D08: 空入力でも0件の蓄積状態 → 空の不変コンテナのラベル遷移で確定を識別できる', () => {
    for (const { templateId, kind } of [
      { templateId: 'tmpl-collect-tounmod-list', kind: 'toUnmodifiableList' },
      { templateId: 'tmpl-collect-tounmod-set', kind: 'toUnmodifiableSet' },
    ] as const) {
      const pair = LABEL_PAIRS.find((p) => p.kind === kind)!
      const snapshot = only(snapshotsOf(templateId, 'emptySource'), 'COLLECTOR_FINISHED')[0]!
      const node = findCollectorNode(collectorCtxOf(snapshot).root, kind)!
      const { before, after } = finisherOf(node)
      expect(before, templateId).toBe(`${pair.accumulating}[]`)
      expect(after, templateId).toBe(`${pair.result}[]`)
    }
    // toUnmodifiableMapの空入力成功形はlocal collectorで固定する（templateはstandardのみ）
    const { snapshots, kinds } = runLocalCollectorEmpty(
      'local-unmod-map-empty',
      ['toUnmodifiableMap'],
      toUnmodMap3('first'),
    )
    expect(kinds).toEqual(['INITIAL', 'COLLECTOR_FINISHED', 'RESULT_CONFIRMED', 'STREAM_CONSUMED'])
    const node = findCollectorNode(
      collectorCtxOf(only(snapshots, 'COLLECTOR_FINISHED')[0]!).root,
      'toUnmodifiableMap',
    )!
    const { before, after } = finisherOf(node)
    expect(before).toBe('Map（蓄積中）{}')
    expect(after).toBe('Map（unmodifiable）{}')
  })
})

describe('P11-D09 配置別のfinisher発行契約（v0.14 §3.2の表）', () => {
  it('P11-D09: 通常rootではCOLLECTOR_FINISHEDを正確に1件発行する', () => {
    for (const collector of [toUnmodList(), toUnmodSet(), toUnmodMap3('first')]) {
      const { kinds } = runLocalCollector(
        `local-root-${String(collector['kind'])}`,
        [String(collector['kind'])],
        collector,
        MERGE_DEMO_EMPLOYEES,
      )
      expect(countOf(kinds, 'COLLECTOR_FINISHED'), String(collector['kind'])).toBe(1)
      expect(countOf(kinds, 'TEE_BRANCH_FINISHED'), String(collector['kind'])).toBe(0)
    }
  })

  it('P11-D09: groupingBy downstreamではbucketごとにCOLLECTOR_FINISHEDを発行する', () => {
    const { snapshots, kinds } = runLocalCollector(
      'local-grouping-unmod',
      ['groupingBy', 'toUnmodifiableList'],
      {
        kind: 'groupingBy',
        classifier: REGION_KEY,
        mapFactoryId: null,
        downstream: toUnmodList(),
      },
      MERGE_DEMO_EMPLOYEES,
    )
    // employeesMergeDemoは関東3件 / 関西1件 / 中部1件の3 bucket
    expect(countOf(kinds, 'COLLECTOR_FINISHED')).toBe(3)
    const finished = only(snapshots, 'COLLECTOR_FINISHED')
    for (const snapshot of finished) {
      expect(snapshot.processing.title).toContain('bucket')
      expect(snapshot.processing.inputLabel).toContain('List（蓄積中）')
      expect(snapshot.processing.outcome).toContain('List（unmodifiable）')
    }
    // 0件bucketが生じるpartitioningByでも各partitionで確定する
    const partition = runLocalCollector(
      'local-partition-unmod',
      ['partitioningBy', 'toUnmodifiableList'],
      {
        kind: 'partitioningBy',
        predicate: {
          kind: 'fieldCompare',
          field: 'age',
          operator: 'GTE',
          value: { type: 'int', value: 200 },
        },
        downstream: toUnmodList(),
      },
      MERGE_DEMO_EMPLOYEES,
    )
    expect(countOf(partition.kinds, 'COLLECTOR_FINISHED')).toBe(2)
    const emptyBucket = only(partition.snapshots, 'COLLECTOR_FINISHED').find((s) =>
      s.processing.title?.includes('true'),
    )!
    expect(emptyBucket.processing.evaluation).toBe('List（蓄積中）[] → List（unmodifiable）[]')
  })

  it('P11-D09: teeing branch直下ではCOLLECTOR_FINISHEDを発行せずTEE_BRANCH_FINISHEDだけで確定する', () => {
    const { snapshots, kinds } = runLocalCollector(
      'local-teeing-unmod-branch',
      ['teeing', 'toUnmodifiableMap', 'counting'],
      {
        kind: 'teeing',
        left: toUnmodMap3('first'),
        right: { kind: 'counting' },
        mergerId: 'RegionIndex::new',
      },
      MERGE_DEMO_EMPLOYEES,
    )
    // branch root自身のCOLLECTOR_FINISHEDは0件（二重発行しない）
    expect(countOf(kinds, 'COLLECTOR_FINISHED')).toBe(0)
    expect(countOf(kinds, 'TEE_BRANCH_FINISHED')).toBe(2)
    const [left] = only(snapshots, 'TEE_BRANCH_FINISHED')
    // 確定表示（after側）に結果ラベルを含める
    expect(left!.processing.inputLabel).toContain('Map（蓄積中）')
    expect(left!.processing.evaluation).toContain('Map（unmodifiable）')
    expect(left!.processing.outcome).toContain('Map（unmodifiable）')
    expect(left!.explanation.current).toContain('Map（unmodifiable）')
    // branch単体の確定は直接RESULT_CONFIRMEDへ接続せず、merger経由で終端する
    expect(kinds.slice(-4)).toEqual([
      'TEE_BRANCH_FINISHED',
      'TEE_MERGER_APPLIED',
      'RESULT_CONFIRMED',
      'STREAM_CONSUMED',
    ])
  })

  it('P11-D09: 0件branchでもTEE_BRANCH_FINISHEDで不変コンテナへの確定が表示される', () => {
    const { snapshots, kinds } = runLocalCollectorEmpty(
      'local-teeing-unmod-empty',
      ['teeing', 'toUnmodifiableMap', 'counting'],
      {
        kind: 'teeing',
        left: toUnmodMap3('first'),
        right: { kind: 'counting' },
        mergerId: 'RegionIndex::new',
      },
    )
    expect(countOf(kinds, 'TEE_BRANCH_ACCUMULATED')).toBe(0)
    expect(countOf(kinds, 'TEE_BRANCH_FINISHED')).toBe(2)
    expect(countOf(kinds, 'COLLECTOR_FINISHED')).toBe(0)
    const left = only(snapshots, 'TEE_BRANCH_FINISHED')[0]!
    expect(left.processing.inputLabel).toBe('Map（蓄積中）{}')
    expect(left.processing.evaluation).toBe('R1 = Map（unmodifiable）{}')
  })

  it('P11-D09: teeing branch内部のnestedは通常規則で発行し、branch確定と別事象になる', () => {
    const { snapshots, kinds } = runLocalCollector(
      'local-teeing-unmod-nested',
      ['teeing', 'filtering', 'toUnmodifiableMap', 'counting'],
      {
        kind: 'teeing',
        left: {
          kind: 'filtering',
          predicate: {
            kind: 'fieldCompare',
            field: 'age',
            operator: 'GTE',
            value: { type: 'int', value: 0 },
          },
          downstream: toUnmodMap3('first'),
        },
        right: { kind: 'counting' },
        mergerId: 'RegionIndex::new',
      },
      MERGE_DEMO_EMPLOYEES,
    )
    // branch内部（adapter経由）のnestedノードは通常のCOLLECTOR_FINISHEDを発行する
    expect(countOf(kinds, 'COLLECTOR_FINISHED')).toBe(1)
    expect(countOf(kinds, 'TEE_BRANCH_FINISHED')).toBe(2)
    // 同一finisherについて二重発行していない（順序も別事象として並ぶ）
    const finishedIndex = kinds.indexOf('COLLECTOR_FINISHED')
    const branchIndex = kinds.indexOf('TEE_BRANCH_FINISHED')
    expect(finishedIndex).toBeGreaterThanOrEqual(0)
    expect(branchIndex).toBeGreaterThan(finishedIndex)
    const nested = only(snapshots, 'COLLECTOR_FINISHED')[0]!
    expect(nested.processing.evaluation).toContain('Map（蓄積中）')
    expect(nested.processing.evaluation).toContain('Map（unmodifiable）')
  })
})

describe('P11-D10 表示（蓄積 / 結果ラベル・view経路・常設4行。v0.14 §3.3）', () => {
  it('P11-D10: 蓄積中の表示はすべて蓄積ラベルである', () => {
    const updates = only(snapshotsOf('tmpl-collect-tounmod-list', 'standard'), 'CONTAINER_UPDATED')
    for (const snapshot of updates) {
      expect(snapshot.processing.inputLabel).toContain('List（蓄積中）')
      expect(snapshot.explanation.current).toContain('List（蓄積中）')
      // 蓄積中の表示に結果ラベルは現れない
      expect(snapshot.explanation.current).not.toContain('unmodifiable）')
      const node = findCollectorNode(collectorCtxOf(snapshot).root, 'toUnmodifiableList')!
      if (node.accumulation.kind === 'ELEMENTS') {
        expect(node.accumulation.containerLabel).toBe('List（蓄積中）')
      }
    }
    // 「蓄積中」がJDK内部型の断定でないことを注記する
    expect(updates[0]?.explanation.jdkNote).toContain('教材モデル上の状態表示')
  })

  it('P11-D10: root配置のtoUnmodifiableListはLIST viewでなくCOLLECTION viewで表示する', () => {
    const result = lastOf('tmpl-collect-tounmod-list', 'standard').output.result
    expect(result?.kind).toBe('COLLECTION')
    if (result?.kind === 'COLLECTION') {
      expect(result.containerLabel).toBe('List（unmodifiable）')
      expect(result.size).toBe(4)
      expect(result.items.map((i) => i.id)).toEqual(['emp-001', 'emp-002', 'emp-003', 'emp-004'])
      // toListのroot特例（LIST view）とは別経路であり、順序注記は付けない
      expect(result.displayOrderNote).toBeNull()
    }
    // 対比: 既存のroot toListはLIST viewのまま（既存表示は不変）
    expect(lastOf('tmpl-collect-tolist', 'standard').output.result?.kind).toBe('LIST')
  })

  it('P11-D10: toUnmodifiableSetの表示順・要素ID注記は既存Setと同一である', () => {
    const result = lastOf('tmpl-collect-tounmod-set', 'standard').output.result
    const existing = lastOf('tmpl-collect-toset', 'standard').output.result
    expect(result?.kind).toBe('COLLECTION')
    if (result?.kind === 'COLLECTION' && existing?.kind === 'COLLECTION') {
      expect(result.containerLabel).toBe('Set（unmodifiable）')
      expect(existing.containerLabel).toBe('Set')
      // 表示順注記・要素ID注記は流用（違いは不変性ラベルだけ）
      expect(result.displayOrderNote).toBe(existing.displayOrderNote)
      expect(result.elementIdNote).toBe(existing.elementIdNote)
      expect(result.items.map((i) => i.label)).toEqual(existing.items.map((i) => i.label))
    }
  })

  it('P11-D10: toUnmodifiableMapの常設4行はmapFactory行を意味論表示で埋める', () => {
    const node = findCollectorNode(
      collectorCtxOf(lastOf('tmpl-collect-tounmod-map', 'standard')).root,
      'toUnmodifiableMap',
    )!
    const toMap = node.toMap
    expect(toMap).not.toBeNull()
    if (!toMap) return
    expect(toMap.keyMapperLabel).toBe('Employee::region')
    expect(toMap.valueMapperLabel).toBe('Employee::name')
    expect(toMap.mergeFunctionLabel).toBe('(a, b) -> a')
    expect(toMap.mergeMeaningLabel).toBe('既存値を保持（先勝ち）')
    expect(toMap.mapFactoryLabel).toBe(
      'なし（unmodifiable Mapを返す。mapFactory版のoverloadは存在しない）',
    )
    expect(toMap.arity).toBe(3)
    // 2引数版はmergeFunction行が既存の省略表示になる
    const two = runLocalCollector(
      'local-unmod-map-arity2',
      ['toUnmodifiableMap'],
      toUnmodMap2(NAME_KEY, SALARY_VALUE),
      STANDARD_EMPLOYEES,
    )
    const twoNode = findCollectorNode(
      collectorCtxOf(two.snapshots[two.snapshots.length - 1]!).root,
      'toUnmodifiableMap',
    )!
    expect(twoNode.toMap?.arity).toBe(2)
    expect(twoNode.toMap?.mergeFunctionLabel).toBe('なし（重複キーでIllegalStateException）')
  })

  it('P11-D10: RESULT_CONFIRMEDのjdkNoteが不変性注記へ分岐する（既存文言は不変）', () => {
    for (const templateId of [
      'tmpl-collect-tounmod-list',
      'tmpl-collect-tounmod-set',
      'tmpl-collect-tounmod-map',
    ]) {
      const confirmed = only(snapshotsOf(templateId, 'standard'), 'RESULT_CONFIRMED')[0]!
      expect(confirmed.explanation.jdkNote, templateId).toContain('unmodifiable')
      expect(confirmed.explanation.jdkNote, templateId).toContain('UnsupportedOperationException')
      expect(confirmed.explanation.jdkNote, templateId).toContain('Oracle')
    }
    // 既存Collectorの文言は変わらない
    const toList = only(snapshotsOf('tmpl-collect-tolist', 'standard'), 'RESULT_CONFIRMED')[0]!
    expect(toList.explanation.jdkNote).toBe(
      'Collectors.toList()等が返すコンテナの型・可変性・iteration orderはJDKの保証対象ではありません（Stream.toList()のunmodifiableとは異なります）。',
    )
  })
})

describe('P11-D11 2引数版toUnmodifiableMapの実行失敗経路（v0.14 §2.3）', () => {
  it('P11-D11: 重複キーでCOLLECT_FAILEDへ終端しExecutionFailureViewを共用する', () => {
    const { snapshots, kinds } = runLocalCollector(
      'local-unmod-map-duplicate',
      ['toUnmodifiableMap'],
      toUnmodMap2(),
      MERGE_DEMO_EMPLOYEES,
    )
    expect(kinds[kinds.length - 1]).toBe('COLLECT_FAILED')
    const failure = failureOf(snapshots)
    // ExecutionFailureViewの構造はtoMapファミリー共用（構造変更なし）
    expect(failure.kind).toBe('DUPLICATE_TO_MAP_KEY')
    expect(failure.exceptionType).toBe('IllegalStateException')
    expect(failure.duplicateKeyLabel).toBe('関東')
    const last = snapshots[snapshots.length - 1]!
    expect(last.completion).toBe('EXECUTION_FAILED')
    // 説明文言だけがkindに応じて分岐する
    expect(last.processing.outcome).toContain('mergeFunctionのないtoUnmodifiableMap')
    expect(last.explanation.jdkNote).toContain('Collectors.toUnmodifiableMap(keyMapper, valueMapper)')
    // 重複キー検出の説明も主語がtoUnmodifiableMapになる
    const detected = only(snapshots, 'DUPLICATE_KEY_DETECTED')[0]!
    expect(detected.explanation.current).toContain('2引数版のtoUnmodifiableMapには')
  })

  it('P11-D11: 既存toMap 2引数版の失敗表示は1文字も変わらない', () => {
    const { snapshots } = runLocalCollector(
      'local-tomap-duplicate-regression',
      ['toMap'],
      { kind: 'toMap', keyMapper: REGION_KEY, valueMapper: NAME_VALUE, mergeFunctionId: null, mapFactoryId: null },
      MERGE_DEMO_EMPLOYEES,
    )
    const last = snapshots[snapshots.length - 1]!
    expect(last.processing.outcome).toBe(
      'mergeFunctionのないtoMapは重複キーを解決できないため、collectがここで失敗します',
    )
    expect(last.explanation.jdkNote).toContain('Collectors.toMap(keyMapper, valueMapper)は')
    const detected = only(snapshots, 'DUPLICATE_KEY_DETECTED')[0]!
    expect(detected.explanation.current).toContain('2引数版のtoMapにはmergeFunctionがないため')
  })
})

describe('P11-D12 既存Collectorの実行結果が不変である（回帰）', () => {
  it('P11-D12: toUnmodifiableList / Setの要素列が既存toList / toSetと一致する', () => {
    const unmodList = runLocalCollector('local-unmod-list', ['toUnmodifiableList'], toUnmodList(), STANDARD_EMPLOYEES)
    const toList = runLocalCollector('local-tolist', ['toList'], { kind: 'toList' }, STANDARD_EMPLOYEES)
    const labelsOf = (r: { snapshots: Snapshot[] }, kind: string): string[] => {
      const node = findCollectorNode(collectorCtxOf(r.snapshots[r.snapshots.length - 1]!).root, kind)!
      return node.accumulation.kind === 'ELEMENTS'
        ? node.accumulation.items.map((i) => `${i.id}:${i.label}`)
        : []
    }
    expect(labelsOf(unmodList, 'toUnmodifiableList')).toEqual(labelsOf(toList, 'toList'))

    const unmodSet = runLocalCollector('local-unmod-set', ['toUnmodifiableSet'], toUnmodSet(), STANDARD_EMPLOYEES)
    const toSet = runLocalCollector('local-toset', ['toSet'], { kind: 'toSet' }, STANDARD_EMPLOYEES)
    expect(labelsOf(unmodSet, 'toUnmodifiableSet')).toEqual(labelsOf(toSet, 'toSet'))
  })

  it('P11-D12: 既存Collectorはfinisher snapshotを発行しないままである', () => {
    for (const [kind, collector] of [
      ['toList', { kind: 'toList' }],
      ['toSet', { kind: 'toSet' }],
      ['toCollection', { kind: 'toCollection', supplierId: 'ArrayList::new' }],
    ] as const) {
      const { kinds } = runLocalCollector(`local-regression-${kind}`, [kind], collector, STANDARD_EMPLOYEES)
      expect(countOf(kinds, 'COLLECTOR_FINISHED'), kind).toBe(0)
    }
  })
})
