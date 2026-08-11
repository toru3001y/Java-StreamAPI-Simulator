import { describe, expect, it } from 'vitest'
import type { SnapshotKind } from '../../src/domain/engine/snapshot'
import { compensatedSum } from '../../src/domain/engine/collectorRuntime'
import { formatDoubleLiteral } from '../../src/domain/model/value'
import {
  collectorContextOf,
  kindsOf,
  lastOf,
  localCollectSnapshots,
  processingCount,
  snapshotsOf,
} from '../p5-helpers'
import { COMPENSATION_CASES } from '../p5-oracle-expected'

/**
 * P5-D03〜P5-D18: Collector variantごとの蓄積・経路・結果と、
 * snapshot列が§9.1の発行規則・発行表と一致すること（Phase 5指示 §12.1）。
 */

function countKind(kinds: readonly SnapshotKind[], kind: SnapshotKind): number {
  return kinds.filter((k) => k === kind).length
}

/** §9.1発行表の検証: COLLECTOR_FINISHEDの発行件数 */
function expectFinisherCount(templateId: string, expected: number, mode = 'standard' as const): void {
  expect(countKind(kindsOf(templateId, mode), 'COLLECTOR_FINISHED'), templateId).toBe(expected)
}

describe('P5-D03 3引数collect', () => {
  it('P5-D03: supplier → accumulator → 結果のsnapshot列とcombiner非実行表示が正しい', () => {
    const kinds = kindsOf('tmpl-collect-triple')
    expect(kinds[0]).toBe('INITIAL')
    // supplier適用は要素処理前に1回だけ
    expect(countKind(kinds, 'CONTAINER_CREATED')).toBe(1)
    expect(kinds[1]).toBe('CONTAINER_CREATED')
    // 各要素でaccumulator適用（CONTAINER_UPDATED）
    expect(countKind(kinds, 'CONTAINER_UPDATED')).toBe(4)
    expect(kinds.at(-2)).toBe('RESULT_CONFIRMED')
    expect(kinds.at(-1)).toBe('STREAM_CONSUMED')
    // 発行表: 3引数collectはCOLLECTOR_FINISHEDを発行しない（コンテナ = 結果）
    expectFinisherCount('tmpl-collect-triple', 0)

    const last = lastOf('tmpl-collect-triple')
    expect(last.output.items.map((i) => i.label)).toEqual([
      '佐藤（age=35）',
      '鈴木（age=27）',
      '高橋（age=42）',
      '田中（age=29）',
    ])
    const ctx = collectorContextOf(last)
    expect(ctx.op).toBe('collectTriple')
    // combinerは定義表示のみ（sequential実行では呼ばれない）
    expect(ctx.triple?.supplierId).toBe('ArrayList::new')
    expect(ctx.triple?.accumulatorId).toBe('ArrayList::add')
    expect(ctx.triple?.combinerId).toBe('ArrayList::addAll')
    expect(ctx.triple?.combinerCallCount).toBe(0)
    expect(ctx.triple?.combinerNote).toContain('sequential')
    // 空ソースでもsupplierは適用される
    expect(countKind(kindsOf('tmpl-collect-triple', 'emptySource'), 'CONTAINER_CREATED')).toBe(1)
    expect(countKind(kindsOf('tmpl-collect-triple', 'emptySource'), 'CONTAINER_UPDATED')).toBe(0)
  })
})

describe('P5-D04 toList / toSet / toCollection', () => {
  it('P5-D04: 可変コンテナへの追加とコンテナsupplier IDが正しい', () => {
    const toList = lastOf('tmpl-collect-tolist')
    expect(toList.output.result).toEqual({ kind: 'LIST' })
    expect(toList.output.items).toHaveLength(4)
    expectFinisherCount('tmpl-collect-tolist', 0)

    const toCollection = lastOf('tmpl-collect-tocollection')
    expect(toCollection.output.result.kind).toBe('COLLECTION')
    if (toCollection.output.result.kind === 'COLLECTION') {
      expect(toCollection.output.result.containerLabel).toBe('ArrayList')
      expect(toCollection.output.result.size).toBe(4)
    }
    // toCollectionもsupplier適用をCONTAINER_CREATEDで可視化する（実装判断）
    expect(countKind(kindsOf('tmpl-collect-tocollection'), 'CONTAINER_CREATED')).toBe(1)
    expectFinisherCount('tmpl-collect-tocollection', 0)
  })

  it('P5-D04: Setの重複で「追加しても変化しない」snapshotが1件以上あり、既存elementIdは置換されない', () => {
    const snapshots = snapshotsOf('tmpl-collect-toset')
    const unchanged = snapshots.filter((s) => {
      if (s.kind !== 'CONTAINER_UPDATED') return false
      const ctx = collectorContextOf(s)
      return ctx.root.accumulation.kind === 'ELEMENTS' && ctx.root.accumulation.changedByLast === false
    })
    expect(unchanged.length).toBeGreaterThanOrEqual(1)
    expect(unchanged[0]?.processing?.outcome).toContain('変化しません')

    const last = lastOf('tmpl-collect-toset')
    expect(last.output.result.kind).toBe('COLLECTION')
    if (last.output.result.kind === 'COLLECTION') {
      expect(last.output.result.containerLabel).toBe('Set')
      expect(last.output.result.size).toBe(3)
      // 関東は佐藤（emp-001）と高橋（emp-003）の2件から集約されるが、最初に受理したIDを保持する
      expect(last.output.result.items.map((i) => i.id)).toEqual(['emp-001', 'emp-002', 'emp-004'])
      expect(last.output.result.elementIdNote).toContain('最初に受理した')
      expect(last.output.result.displayOrderNote).toContain('表示を安定させるための順序')
    }
    expectFinisherCount('tmpl-collect-toset', 0)
  })
})

describe('P5-D05 joining', () => {
  it('P5-D05: 3 overloadの連結途中文字列・最終結果・空結果が正しい', () => {
    const noArg = lastOf('tmpl-collect-joining').output.result
    expect(noArg).toMatchObject({ kind: 'SCALAR', typeLabel: 'String', valueLabel: '"佐藤鈴木高橋田中"' })
    expect(lastOf('tmpl-collect-joining', 'emptySource').output.result).toMatchObject({
      valueLabel: '""',
    })

    expect(lastOf('tmpl-collect-joining-delimiter').output.result).toMatchObject({
      valueLabel: '"佐藤, 鈴木, 高橋, 田中"',
    })
    expect(lastOf('tmpl-collect-joining-delimiter', 'emptySource').output.result).toMatchObject({
      valueLabel: '""',
    })

    expect(lastOf('tmpl-collect-joining-full').output.result).toMatchObject({
      valueLabel: '"[佐藤, 鈴木, 高橋, 田中]"',
    })
    // 3引数版の空入力はprefix + suffix（Draft v0.8 付録F.1のJDK 25実測）
    expect(lastOf('tmpl-collect-joining-full', 'emptySource').output.result).toMatchObject({
      valueLabel: '"[]"',
    })

    // 連結途中文字列の遷移
    const texts = snapshotsOf('tmpl-collect-joining-delimiter')
      .filter((s) => s.kind === 'CONTAINER_UPDATED')
      .map((s) => {
        const acc = collectorContextOf(s).root.accumulation
        return acc.kind === 'TEXT' ? acc.valueLabel : ''
      })
    expect(texts).toEqual(['佐藤', '佐藤, 鈴木', '佐藤, 鈴木, 高橋', '佐藤, 鈴木, 高橋, 田中'])

    // 発行表: joiningは全overloadでCOLLECTOR_FINISHEDを発行する
    for (const id of ['tmpl-collect-joining', 'tmpl-collect-joining-delimiter', 'tmpl-collect-joining-full']) {
      expectFinisherCount(id, 1)
      expectFinisherCount(id, 1, 'emptySource')
    }
  })
})

describe('P5-D06 counting / summing系', () => {
  it('P5-D06: 蓄積遷移・結果・結果型が正しく、COLLECTOR_FINISHEDを発行しない', () => {
    expect(lastOf('tmpl-collect-counting').output.result).toMatchObject({
      kind: 'SCALAR',
      typeLabel: 'Long',
      valueLabel: '4',
    })
    expect(lastOf('tmpl-collect-counting', 'emptySource').output.result).toMatchObject({
      valueLabel: '0',
    })
    const counts = snapshotsOf('tmpl-collect-counting')
      .filter((s) => s.kind === 'CONTAINER_UPDATED')
      .map((s) => {
        const acc = collectorContextOf(s).root.accumulation
        return acc.kind === 'NUMBER' ? acc.valueLabel : ''
      })
    expect(counts).toEqual(['1', '2', '3', '4'])

    expect(lastOf('tmpl-collect-summing-int').output.result).toMatchObject({
      typeLabel: 'Integer',
      valueLabel: '133',
    })
    expect(lastOf('tmpl-collect-summing-long').output.result).toMatchObject({
      typeLabel: 'Long',
      valueLabel: '21700000',
    })
    expect(lastOf('tmpl-collect-summing-double').output.result).toMatchObject({
      typeLabel: 'Double',
      valueLabel: '16.6',
    })
    for (const id of [
      'tmpl-collect-counting',
      'tmpl-collect-summing-int',
      'tmpl-collect-summing-long',
      'tmpl-collect-summing-double',
    ]) {
      expectFinisherCount(id, 0)
      expectFinisherCount(id, 0, 'emptySource')
    }
  })
})

describe('P5-D07 averaging / summarizing系', () => {
  it('P5-D07: averagingは蓄積（合計・件数）からfinisherで平均へ確定する', () => {
    expect(lastOf('tmpl-collect-averaging-int').output.result).toMatchObject({
      typeLabel: 'Double',
      valueLabel: '33.25',
    })
    expect(lastOf('tmpl-collect-averaging-long').output.result).toMatchObject({
      valueLabel: '5425000.0',
    })
    expect(lastOf('tmpl-collect-averaging-double').output.result).toMatchObject({
      valueLabel: '4.15',
    })
    // 空Streamのaveraging結果は0.0（Java SE 25: "If no elements are present, the result is 0."）
    for (const id of [
      'tmpl-collect-averaging-int',
      'tmpl-collect-averaging-long',
      'tmpl-collect-averaging-double',
    ]) {
      expect(lastOf(id, 'emptySource').output.result, id).toMatchObject({ valueLabel: '0.0' })
      // 発行表: averaging系はCOLLECTOR_FINISHEDを発行する
      expectFinisherCount(id, 1)
      expectFinisherCount(id, 1, 'emptySource')
    }
    // finisher前は平均が未確定
    const beforeFinish = snapshotsOf('tmpl-collect-averaging-long').filter(
      (s) => s.kind === 'CONTAINER_UPDATED',
    )
    const acc = collectorContextOf(beforeFinish[0]!).root.accumulation
    expect(acc.kind).toBe('AVERAGE')
    if (acc.kind === 'AVERAGE') expect(acc.averageLabel).toBeNull()
  })

  it('P5-D07: double集計の補償付き加算がJDKと同じ最終値（sum - compensation）になる', () => {
    // 教材fixture（4.2 / 3.8 / 4.6 / 4.0）では補償が残らないため、補償が結果に現れる列で検証する。
    // 期待値はJDK 25実測（Collectors.summingDouble）。P5-O01で同じ列をJDKと照合する。
    expect(COMPENSATION_CASES).toHaveLength(3)
    const sums = COMPENSATION_CASES.map((values) => formatDoubleLiteral(compensatedSum(values)))
    expect(sums).toEqual(['0.011000000000000001', '4.0', '0.6'])
    // 単純合計とは異なる（補償が効いていることの確認。符号を誤ると単純合計側や別値になる）
    const naive = COMPENSATION_CASES.map((values) =>
      formatDoubleLiteral(values.reduce((acc, v) => acc + v, 0)),
    )
    expect(naive).toEqual(['0.011', '0.0', '0.6000000000000001'])
    for (let i = 0; i < sums.length; i++) {
      expect(sums[i], `case ${i}`).not.toBe(naive[i])
    }
    // 符号を逆にした値（sum + compensation）にはならない
    expect(sums[0]).not.toBe('0.010999999999999998')
    // 教材fixtureのdouble集計はJDK実測と一致する（差異なし）
    expect(lastOf('tmpl-collect-summing-double').output.result).toMatchObject({ valueLabel: '16.6' })
    expect(lastOf('tmpl-collect-averaging-double').output.result).toMatchObject({ valueLabel: '4.15' })
  })

  it('P5-D07: summarizingの統計fieldと空Streamの正規初期値が正しく、finisherを発行しない', () => {
    expect(lastOf('tmpl-collect-summarizing-int').output.result).toMatchObject({
      kind: 'STATISTICS',
      statisticsTypeLabel: 'IntSummaryStatistics',
      countLabel: '4',
      sumLabel: '133',
      minLabel: '27',
      maxLabel: '42',
      averageLabel: '33.25',
    })
    expect(lastOf('tmpl-collect-summarizing-long').output.result).toMatchObject({
      statisticsTypeLabel: 'LongSummaryStatistics',
      sumLabel: '21700000',
      minLabel: '4200000',
      maxLabel: '7200000',
      averageLabel: '5425000.0',
    })
    expect(lastOf('tmpl-collect-summarizing-double').output.result).toMatchObject({
      statisticsTypeLabel: 'DoubleSummaryStatistics',
      sumLabel: '16.6',
      minLabel: '3.8',
      maxLabel: '4.6',
      averageLabel: '4.15',
    })
    expect(lastOf('tmpl-collect-summarizing-int', 'emptySource').output.result).toMatchObject({
      countLabel: '0',
      sumLabel: '0',
      minLabel: '2147483647',
      maxLabel: '-2147483648',
      averageLabel: '0.0',
    })
    expect(lastOf('tmpl-collect-summarizing-long', 'emptySource').output.result).toMatchObject({
      minLabel: '9223372036854775807',
      maxLabel: '-9223372036854775808',
    })
    expect(lastOf('tmpl-collect-summarizing-double', 'emptySource').output.result).toMatchObject({
      sumLabel: '0.0',
      minLabel: 'Infinity',
      maxLabel: '-Infinity',
    })
    for (const id of [
      'tmpl-collect-summarizing-int',
      'tmpl-collect-summarizing-long',
      'tmpl-collect-summarizing-double',
    ]) {
      expectFinisherCount(id, 0)
    }
  })
})

describe('P5-D08 minBy / maxBy / reducing', () => {
  it('P5-D08: 候補 / accumulator表示・結果・空でOptional.empty()が正しい', () => {
    expect(lastOf('tmpl-collect-minby').output.result).toMatchObject({
      kind: 'OPTIONAL',
      present: true,
      valueLabel: '鈴木（age=27）',
      valueElementId: 'emp-002',
    })
    expect(lastOf('tmpl-collect-maxby').output.result).toMatchObject({
      present: true,
      valueLabel: '高橋（age=42）',
      valueElementId: 'emp-003',
    })
    expect(lastOf('tmpl-collect-reducing').output.result).toMatchObject({
      present: true,
      valueLabel: '"佐藤鈴木高橋田中"',
    })
    for (const id of ['tmpl-collect-minby', 'tmpl-collect-maxby', 'tmpl-collect-reducing']) {
      expect(lastOf(id, 'emptySource').output.result, id).toMatchObject({ present: false })
      // 発行表: minBy / maxBy / reducingはCOLLECTOR_FINISHEDを発行する
      expectFinisherCount(id, 1)
      expectFinisherCount(id, 1, 'emptySource')
    }
    // 候補更新の表示（maxBy: 佐藤 → 高橋のみ更新、鈴木・田中では維持）
    const candidates = snapshotsOf('tmpl-collect-maxby')
      .filter((s) => s.kind === 'CONTAINER_UPDATED')
      .map((s) => {
        const acc = collectorContextOf(s).root.accumulation
        return acc.kind === 'CANDIDATE' ? acc.candidateLabel : ''
      })
    expect(candidates).toEqual(['佐藤', '佐藤', '高橋', '高橋'])
  })
})

describe('P5-D09 mapping', () => {
  it('P5-D09: mapper適用後にdownstreamへ渡る経路と結果が正しい', () => {
    const kinds = kindsOf('tmpl-collect-mapping')
    // mapping自身はMAPPING_APPLIEDを再利用する（専用kindを作らない）
    expect(countKind(kinds, 'MAPPING_APPLIED')).toBe(4)
    expect(countKind(kinds, 'CLASSIFIER_EVALUATED')).toBe(4)
    expect(countKind(kinds, 'BUCKET_SELECTED')).toBe(4)
    expect(countKind(kinds, 'CONTAINER_UPDATED')).toBe(4)
    // 発行表: mapping自身はfinisherを発行しない（downstreamのtoListも発行しない）
    expectFinisherCount('tmpl-collect-mapping', 0)

    const result = lastOf('tmpl-collect-mapping').output.result
    expect(result.kind).toBe('MAP')
    if (result.kind === 'MAP') {
      expect(result.valueTypeLabel).toBe('List<String>')
      expect(result.entries.map((e) => e.keyLabel)).toEqual(['開発部', '営業部'])
      const dev = result.entries[0]?.value
      expect(dev?.kind).toBe('COLLECTION')
      if (dev?.kind === 'COLLECTION') {
        expect(dev.items.map((i) => i.label)).toEqual(['"佐藤"', '"高橋"'])
      }
    }
  })
})

describe('P5-D10 filtering', () => {
  it('P5-D10: bucket決定後のPredicate評価で除外され、空bucketが残る（Stream.filterとの差）', () => {
    const snapshots = snapshotsOf('tmpl-collect-filtering')
    const kinds = snapshots.map((s) => s.kind)
    // bucket決定 → Predicate評価の順（filteringはPREDICATE_EVALUATEDを再利用する）
    const bucketIdx = kinds.indexOf('BUCKET_SELECTED')
    const predIdx = kinds.indexOf('PREDICATE_EVALUATED', bucketIdx)
    expect(bucketIdx).toBeGreaterThan(0)
    expect(predIdx).toBeGreaterThan(bucketIdx)
    expect(countKind(kinds, 'PREDICATE_EVALUATED')).toBe(4)
    // 通過は2件のみ（佐藤・高橋）
    expect(countKind(kinds, 'CONTAINER_UPDATED')).toBe(2)
    expectFinisherCount('tmpl-collect-filtering', 0)

    const rejected = snapshots.find(
      (s) => s.kind === 'PREDICATE_EVALUATED' && s.processing?.evaluation === 'false',
    )
    expect(rejected?.processing?.outcome).toContain('bucketは残ります')
    expect(rejected?.explanation.jdkNote).toContain('Stream.filter')

    const result = lastOf('tmpl-collect-filtering').output.result
    if (result.kind === 'MAP') {
      expect(result.entries.map((e) => e.keyLabel)).toEqual(['開発部', '営業部'])
      const sales = result.entries[1]?.value
      // 営業部は全要素が除外されても空bucketとして残る
      expect(sales?.kind).toBe('COLLECTION')
      if (sales?.kind === 'COLLECTION') expect(sales.size).toBe(0)
    }
  })
})

describe('P5-D11 flatMapping', () => {
  it('P5-D11: bucket内での展開 → flatten → downstreamの経路と結果が正しい', () => {
    const kinds = kindsOf('tmpl-collect-flatmapping')
    // 展開は既存のMAPPED_STREAM_CREATED / CHILD_EMITTEDを再利用する
    expect(countKind(kinds, 'MAPPED_STREAM_CREATED')).toBe(4)
    expect(countKind(kinds, 'CHILD_EMITTED')).toBe(8)
    expect(countKind(kinds, 'CONTAINER_UPDATED')).toBe(8)
    expectFinisherCount('tmpl-collect-flatmapping', 0)

    const result = lastOf('tmpl-collect-flatmapping').output.result
    if (result.kind === 'MAP') {
      const dev = result.entries[0]?.value
      if (dev?.kind === 'COLLECTION') {
        expect(dev.items.map((i) => i.label)).toEqual(['"Java"', '"SQL"', '"Java"', '"設計"'])
      }
    }
  })
})

describe('P5-D12 collectingAndThen', () => {
  it('P5-D12: downstream完了後にfinisherを独立snapshotで適用し、前後の値と型を区別する', () => {
    const snapshots = snapshotsOf('tmpl-collect-collectingandthen')
    const kinds = snapshots.map((s) => s.kind)
    expect(countKind(kinds, 'COLLECTOR_FINISHED')).toBe(1)
    // finisherは全要素の蓄積完了後（最後のCONTAINER_UPDATEDより後）
    expect(kinds.lastIndexOf('CONTAINER_UPDATED')).toBeLessThan(kinds.indexOf('COLLECTOR_FINISHED'))
    const finished = snapshots.find((s) => s.kind === 'COLLECTOR_FINISHED')
    expect(finished?.processing?.expression).toBe('List::copyOf')
    const view = collectorContextOf(finished!).root.finisher
    expect(view?.state).toBe('APPLIED')
    expect(view?.beforeTypeLabel).toBe('List<Employee>')
    expect(view?.afterTypeLabel).toBe('List<Employee>')
    expect(view?.beforeLabel).not.toBeNull()
    expect(view?.afterLabel).not.toBeNull()
    // 空ソースでも独立snapshotで発行する
    expectFinisherCount('tmpl-collect-collectingandthen', 1, 'emptySource')
  })
})

describe('P5-D13 groupingBy', () => {
  it('P5-D13: classifier評価・bucket決定・Map成長・Department recordキーの値等価判定が正しい', () => {
    const snapshots = snapshotsOf('tmpl-collect-groupingby')
    const kinds = snapshots.map((s) => s.kind)
    expect(countKind(kinds, 'CLASSIFIER_EVALUATED')).toBe(4)
    expect(countKind(kinds, 'BUCKET_SELECTED')).toBe(4)
    // Map自身にはfinisherを発行しない（downstreamのtoListも発行対象外）
    expectFinisherCount('tmpl-collect-groupingby', 0)

    // 新規生成 / 既存の区別
    const selected = snapshots.filter((s) => s.kind === 'BUCKET_SELECTED')
    expect(selected[0]?.processing?.title).toContain('新規生成')
    expect(selected[2]?.processing?.title).toContain('既存')

    const result = lastOf('tmpl-collect-groupingby').output.result
    expect(result.kind).toBe('MAP')
    if (result.kind === 'MAP') {
      expect(result.keyTypeLabel).toBe('Department')
      expect(result.size).toBe(2)
      // Department recordキーは値等価（name + division）で判定される
      expect(result.entries[0]?.keyLabel).toBe('Department[name=開発部, division=技術本部]')
      expect(result.entries[0]?.keyRef).toContain('開発部')
      const dev = result.entries[0]?.value
      if (dev?.kind === 'COLLECTION') {
        expect(dev.items.map((i) => i.id)).toEqual(['emp-001', 'emp-003'])
      }
    }
    // 標準modeでは2つ以上のbucketが生成される（教材制約）
    if (result.kind === 'MAP') expect(result.size).toBeGreaterThanOrEqual(2)
  })
})

describe('P5-D14 groupingBy + downstream', () => {
  it('P5-D14: bucket決定後のdownstream実行と結果型が正しい', () => {
    const result = lastOf('tmpl-collect-groupingby-counting').output.result
    expect(result.kind).toBe('MAP')
    if (result.kind === 'MAP') {
      expect(result.valueTypeLabel).toBe('Long')
      expect(result.entries.map((e) => `${e.keyLabel}=${e.value.kind === 'SCALAR' ? e.value.valueLabel : ''}`)).toEqual(
        ['関東=2', '関西=1', '中部=1'],
      )
    }
    expectFinisherCount('tmpl-collect-groupingby-counting', 0)
  })

  it('P5-D14: 発行対象downstream（averagingLong）ではbucketごとにbucket生成順でCOLLECTOR_FINISHEDを発行する', () => {
    const snapshots = snapshotsOf('tmpl-collect-groupingby-averaging')
    const finished = snapshots.filter((s) => s.kind === 'COLLECTOR_FINISHED')
    // bucket数（関東・関西・中部）ぶん
    expect(finished).toHaveLength(3)
    // bucket生成順（関東 → 関西 → 中部）
    expect(finished.map((s) => s.processing?.title)).toEqual([
      'Collector finisher適用（bucket 関東）',
      'Collector finisher適用（bucket 関西）',
      'Collector finisher適用（bucket 中部）',
    ])
    // 教材上の規約である旨の注記
    expect(finished[0]?.explanation.current).toContain('bucket生成順')
    expect(finished[0]?.explanation.current).toContain('JDKのMap iteration order保証ではありません')
    // 集合単位の確定snapshotは処理中要素なし
    for (const snapshot of finished) {
      expect(snapshot.currentElementId).toBeNull()
    }
    const result = lastOf('tmpl-collect-groupingby-averaging').output.result
    if (result.kind === 'MAP') {
      expect(result.entries.map((e) => (e.value.kind === 'SCALAR' ? e.value.valueLabel : ''))).toEqual(
        ['6350000.0', '4200000.0', '4800000.0'],
      )
    }
  })
})

describe('P5-D15 groupingBy + mapFactory', () => {
  it('P5-D15: TreeMapの順序意味論が結果と確定処理順に反映される', () => {
    const result = lastOf('tmpl-collect-groupingby-treemap').output.result
    expect(result.kind).toBe('MAP')
    if (result.kind === 'MAP') {
      expect(result.containerLabel).toBe('TreeMap')
      expect(result.jdkOrdered).toBe(true)
      // 学習用表示順の注記は付けず、実順序をそのまま示す
      expect(result.displayOrderNote).toBeNull()
      // TreeMapの実際のキー順（Java String natural ordering）
      expect(result.entries.map((e) => e.keyLabel)).toEqual(['中部', '関東', '関西'])
    }
    // classifier / mapFactory / downstreamの分離表示
    const bucketSelected = snapshotsOf('tmpl-collect-groupingby-treemap').find(
      (s) => s.kind === 'BUCKET_SELECTED',
    )
    expect(bucketSelected?.explanation.jdkNote).toContain('TreeMap')
    expect(bucketSelected?.processing?.expression).toContain('TreeMap::new')
  })

  it('P5-D15: TreeMapではbucketごとのfinisherも実際のキー順で発行される（§9.1規則7）', () => {
    // 教材templateのdownstreamはtoList（finisher非発行）のため、発行対象downstream
    // （averagingLong）を持つテストローカルtemplateで確定処理順を検証する
    const { snapshots, definition } = localCollectSnapshots(
      'tmpl-p5-local-treemap-averaging',
      ['groupingBy', 'averagingLong'],
      {
        kind: 'groupingBy',
        classifier: { kind: 'employeeField', field: 'region' },
        mapFactoryId: 'TreeMap::new',
        downstream: { kind: 'averagingLong', field: 'salary' },
      },
    )
    const finished = snapshots.filter((s) => s.kind === 'COLLECTOR_FINISHED')
    // bucket数（中部 / 関東 / 関西）ぶん発行される
    expect(finished).toHaveLength(3)
    // TreeMapの実際のキー順（Java Stringのnatural ordering）で発行される
    expect(finished.map((s) => s.processing?.title)).toEqual([
      'Collector finisher適用（bucket 中部）',
      'Collector finisher適用（bucket 関東）',
      'Collector finisher適用（bucket 関西）',
    ])
    // 順序意味論を優先する旨の注記を持つ（bucket生成順ではない）
    expect(finished[0]?.explanation.current).toContain('TreeMap')
    expect(finished[0]?.explanation.current).toContain('順序意味論を優先')
    // 集合単位の確定snapshotなので処理中要素なし
    for (const snapshot of finished) {
      expect(snapshot.currentElementId).toBeNull()
      expect(processingCount(snapshot)).toBe(0)
    }
    // 二重発行なし（TEE系は出ない・bucketごとに1件だけ）
    expect(snapshots.filter((s) => s.kind === 'TEE_BRANCH_FINISHED')).toHaveLength(0)
    expect(definition.snapshotCount).toBeLessThanOrEqual(500)
  })

  it('P5-D15: ComparatorなしTreeMapと非Comparableキー（Department）の組合せだけを拒否する', async () => {
    const { validateCollectorStructure } = await import('../../src/domain/dsl/validateCollector')
    // 負例: Department recordキー × TreeMap::new
    const rejected = validateCollectorStructure({
      kind: 'groupingBy',
      classifier: { kind: 'employeeDepartment' },
      mapFactoryId: 'TreeMap::new',
      downstream: { kind: 'toList' },
    })
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) {
      expect(rejected.issues.some((i) => i.code === 'TYPE_MISMATCH')).toBe(true)
      expect(rejected.issues[0]?.path).toBe('collector.mapFactoryId')
    }
    // 正例: Stringキー（Comparable） × TreeMap::new
    const accepted = validateCollectorStructure({
      kind: 'groupingBy',
      classifier: { kind: 'employeeField', field: 'region' },
      mapFactoryId: 'TreeMap::new',
      downstream: { kind: 'toList' },
    })
    expect(accepted.ok).toBe(true)
    // 通常のgroupingByではDepartment recordキーを許可する
    const plain = validateCollectorStructure({
      kind: 'groupingBy',
      classifier: { kind: 'employeeDepartment' },
      mapFactoryId: null,
      downstream: null,
    })
    expect(plain.ok).toBe(true)
  })
})

describe('P5-D16 nested groupingBy', () => {
  it('P5-D16: 外側→内側の経路・深いノードの蓄積snapshot・最終コンテナが正しい', () => {
    const snapshots = snapshotsOf('tmpl-collect-groupingby-nested')
    const kinds = snapshots.map((s) => s.kind)
    // 外側・内側それぞれのclassifier評価とbucket決定
    expect(countKind(kinds, 'CLASSIFIER_EVALUATED')).toBe(8)
    expect(countKind(kinds, 'BUCKET_SELECTED')).toBe(8)
    expect(countKind(kinds, 'CONTAINER_UPDATED')).toBe(4)

    // 現在経路が外側→内側へ伸びる
    const deepest = snapshots.filter((s) => s.kind === 'CONTAINER_UPDATED')
    const ctx = collectorContextOf(deepest[0]!)
    expect(ctx.currentPath.length).toBeGreaterThanOrEqual(3)
    expect(ctx.currentPathLabel).toContain('→')

    const result = lastOf('tmpl-collect-groupingby-nested').output.result
    expect(result.kind).toBe('MAP')
    if (result.kind === 'MAP') {
      expect(result.valueTypeLabel).toBe('Map<String, List<Employee>>')
      const dev = result.entries[0]?.value
      expect(dev?.kind).toBe('MAP')
      if (dev?.kind === 'MAP') {
        expect(dev.entries.map((e) => e.keyLabel)).toEqual(['関東'])
      }
      const sales = result.entries[1]?.value
      if (sales?.kind === 'MAP') {
        expect(sales.entries.map((e) => e.keyLabel)).toEqual(['関西', '中部'])
      }
    }
  })
})

describe('P5-D17 partitioningBy', () => {
  it('P5-D17: true / false固定2分岐・両キー保持・wrapper Booleanキーが正しい', () => {
    const result = lastOf('tmpl-collect-partitioningby').output.result
    expect(result.kind).toBe('MAP')
    if (result.kind === 'MAP') {
      // キーはwrapper Boolean（primitive booleanと混同しない）
      expect(result.keyTypeLabel).toBe('Boolean')
      expect(result.entries.map((e) => e.keyLabel)).toEqual(['false', 'true'])
      const falsePart = result.entries[0]?.value
      const truePart = result.entries[1]?.value
      if (falsePart?.kind === 'COLLECTION') {
        expect(falsePart.items.map((i) => i.id)).toEqual(['emp-002', 'emp-004'])
      }
      if (truePart?.kind === 'COLLECTION') {
        expect(truePart.items.map((i) => i.id)).toEqual(['emp-001', 'emp-003'])
      }
    }
    // partitioningByのpredicate評価は既存PREDICATE_EVALUATEDを再利用する
    const kinds = kindsOf('tmpl-collect-partitioningby')
    expect(countKind(kinds, 'PREDICATE_EVALUATED')).toBe(4)
    expect(countKind(kinds, 'CLASSIFIER_EVALUATED')).toBe(0)
    expectFinisherCount('tmpl-collect-partitioningby', 0)

    // 空ソースでも両キーとdownstreamの空結果を保持する
    const empty = lastOf('tmpl-collect-partitioningby', 'emptySource').output.result
    if (empty.kind === 'MAP') {
      expect(empty.entries.map((e) => e.keyLabel)).toEqual(['false', 'true'])
      for (const entry of empty.entries) {
        expect(entry.value.kind).toBe('COLLECTION')
        if (entry.value.kind === 'COLLECTION') expect(entry.value.size).toBe(0)
      }
    }
  })
})

describe('P5-D18 partitioningBy + downstream', () => {
  it('P5-D18: 各partitionのdownstream実行と、false → true固定順の確定が正しい', () => {
    const result = lastOf('tmpl-collect-partitioningby-counting').output.result
    if (result.kind === 'MAP') {
      expect(
        result.entries.map((e) => `${e.keyLabel}=${e.value.kind === 'SCALAR' ? e.value.valueLabel : ''}`),
      ).toEqual(['false=2', 'true=2'])
    }
    const empty = lastOf('tmpl-collect-partitioningby-counting', 'emptySource').output.result
    if (empty.kind === 'MAP') {
      expect(
        empty.entries.map((e) => `${e.keyLabel}=${e.value.kind === 'SCALAR' ? e.value.valueLabel : ''}`),
      ).toEqual(['false=0', 'true=0'])
    }
    // countingはfinisher発行対象外
    const kinds = kindsOf('tmpl-collect-partitioningby-counting')
    expect(countKind(kinds, 'COLLECTOR_FINISHED')).toBe(0)
  })

  it('P5-D18: 発行対象downstream（averagingLong）でpartition finisherがfalse → trueの固定順で発行される（§9.1規則7）', () => {
    const { snapshots } = localCollectSnapshots(
      'tmpl-p5-local-partitioning-averaging',
      ['partitioningBy', 'averagingLong'],
      {
        kind: 'partitioningBy',
        predicate: { kind: 'fieldCompare', field: 'age', operator: 'GTE', value: { type: 'int', value: 30 } },
        downstream: { kind: 'averagingLong', field: 'salary' },
      },
    )
    const finished = snapshots.filter((s) => s.kind === 'COLLECTOR_FINISHED')
    // true / falseの2 partitionぶん、false → trueの固定順
    expect(finished).toHaveLength(2)
    expect(finished.map((s) => s.processing?.title)).toEqual([
      'Collector finisher適用（bucket false）',
      'Collector finisher適用（bucket true）',
    ])
    // 教材上の規約である旨の注記
    expect(finished[0]?.explanation.current).toContain('false → true')
    expect(finished[0]?.explanation.current).toContain('JDKのMap iteration order保証ではありません')
    for (const snapshot of finished) {
      expect(snapshot.currentElementId).toBeNull()
      expect(processingCount(snapshot)).toBe(0)
    }
    // 結果は false=[鈴木, 田中]の平均 / true=[佐藤, 高橋]の平均
    const last = snapshots[snapshots.length - 1]!
    const result = last.output.result
    expect(result.kind).toBe('MAP')
    if (result.kind === 'MAP') {
      expect(
        result.entries.map((e) => `${e.keyLabel}=${e.value.kind === 'SCALAR' ? e.value.valueLabel : ''}`),
      ).toEqual(['false=4500000.0', 'true=6350000.0'])
    }
  })

  it('P5-D14: nested Collector内部（groupingBy → mapping → joining）のfinisherもbucketごとに発行される', () => {
    const { snapshots } = localCollectSnapshots(
      'tmpl-p5-local-nested-finisher',
      ['groupingBy', 'mapping', 'joining'],
      {
        kind: 'groupingBy',
        classifier: { kind: 'departmentField', field: 'name' },
        mapFactoryId: null,
        downstream: {
          kind: 'mapping',
          mapper: { kind: 'fieldAccess', field: 'name' },
          downstream: { kind: 'joining', delimiter: { type: 'string', value: '/' }, prefix: null, suffix: null },
        },
      },
    )
    const finished = snapshots.filter((s) => s.kind === 'COLLECTOR_FINISHED')
    // mapping自身は非発行、内部のjoiningがbucketごとに発行する（bucket生成順）
    expect(finished).toHaveLength(2)
    expect(finished.map((s) => s.processing?.title)).toEqual([
      'Collector finisher適用（bucket 開発部）',
      'Collector finisher適用（bucket 営業部）',
    ])
    // 集合単位の確定snapshotなので処理中要素なし（P5-D27は登録済みtemplateのみを対象とするため、
    // テストローカルtemplateについてはここで直接検証する）
    for (const snapshot of finished) {
      expect(snapshot.currentElementId).toBeNull()
      expect(processingCount(snapshot)).toBe(0)
    }
    const last = snapshots[snapshots.length - 1]!
    const result = last.output.result
    if (result.kind === 'MAP') {
      expect(
        result.entries.map((e) => `${e.keyLabel}=${e.value.kind === 'SCALAR' ? e.value.valueLabel : ''}`),
      ).toEqual(['開発部="佐藤/高橋"', '営業部="鈴木/田中"'])
    }
  })
})
