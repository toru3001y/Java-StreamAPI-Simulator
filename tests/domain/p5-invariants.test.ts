import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectorToJavaExpr } from '../../src/domain/dsl/javaCode'
import { formatTypeRef } from '../../src/domain/types/typeRef'
import { getTimeline } from '../../src/domain/engine/stepEngine'
import { SNAPSHOT_LIMIT } from '../../src/domain/template/instantiate'
import { runAllSnapshots } from '../helpers'
import { finalOutputLabels } from '../p3-helpers'
import {
  P5_COLLECTOR_TEMPLATE_MODES,
  P5_TEMPLATE_MODES,
  collectorContextOf,
  definitionOf,
  kindsOf,
  lastOf,
  processingCount,
  snapshotsOf,
} from '../p5-helpers'

/**
 * P5-D24〜P5-D31: 空入力・結果TypeRef連鎖・context不変条件・PROCESSING最大1件・
 * 決定性と予算・Source of Truth・持越しtemplate・終端回帰（Phase 5指示 §12.1）。
 */

describe('P5-D24 空入力', () => {
  it('P5-D24: 付録Bどおりの空結果（空コンテナ・0L・型別0・0.0・Optional.empty()・空Map・両キー空partition）', () => {
    // 空コンテナ
    expect(lastOf('tmpl-collect-tolist', 'emptySource').output.items).toEqual([])
    expect(lastOf('tmpl-collect-toset', 'emptySource').output.result).toMatchObject({ size: 0 })
    expect(lastOf('tmpl-collect-tocollection', 'emptySource').output.result).toMatchObject({ size: 0 })
    // counting → 0L / summing → 型別0 / averaging → 0.0
    expect(lastOf('tmpl-collect-counting', 'emptySource').output.result).toMatchObject({ valueLabel: '0' })
    expect(lastOf('tmpl-collect-summing-int', 'emptySource').output.result).toMatchObject({ valueLabel: '0' })
    expect(lastOf('tmpl-collect-summing-long', 'emptySource').output.result).toMatchObject({ valueLabel: '0' })
    expect(lastOf('tmpl-collect-summing-double', 'emptySource').output.result).toMatchObject({
      valueLabel: '0.0',
    })
    for (const id of [
      'tmpl-collect-averaging-int',
      'tmpl-collect-averaging-long',
      'tmpl-collect-averaging-double',
    ]) {
      expect(lastOf(id, 'emptySource').output.result, id).toMatchObject({ valueLabel: '0.0' })
    }
    // minBy / maxBy / reducing → Optional.empty()
    for (const id of ['tmpl-collect-minby', 'tmpl-collect-maxby', 'tmpl-collect-reducing']) {
      expect(lastOf(id, 'emptySource').output.result, id).toMatchObject({
        kind: 'OPTIONAL',
        present: false,
      })
    }
    // groupingBy → 空Map
    for (const id of [
      'tmpl-collect-groupingby',
      'tmpl-collect-groupingby-counting',
      'tmpl-collect-groupingby-nested',
    ]) {
      expect(lastOf(id, 'emptySource').output.result, id).toMatchObject({ kind: 'MAP', size: 0 })
    }
    // partitioningBy → true / false両キーとdownstreamの空結果
    const partition = lastOf('tmpl-collect-partitioningby', 'emptySource').output.result
    expect(partition.kind).toBe('MAP')
    if (partition.kind === 'MAP') {
      expect(partition.entries.map((e) => e.keyLabel)).toEqual(['false', 'true'])
    }
    // joining（引数なしは"" / 3引数はprefix + suffix）
    expect(lastOf('tmpl-collect-joining', 'emptySource').output.result).toMatchObject({
      valueLabel: '""',
    })
    expect(lastOf('tmpl-collect-joining-full', 'emptySource').output.result).toMatchObject({
      valueLabel: '"[]"',
    })
    // mapping / filtering / flatMapping → downstreamの空結果 / collectingAndThen → 空へfinisher適用
    for (const id of ['tmpl-collect-mapping', 'tmpl-collect-filtering', 'tmpl-collect-flatmapping']) {
      expect(lastOf(id, 'emptySource').output.result, id).toMatchObject({ kind: 'MAP', size: 0 })
    }
    expect(lastOf('tmpl-collect-collectingandthen', 'emptySource').output.result).toMatchObject({
      kind: 'COLLECTION',
      size: 0,
    })
    // teeing → 左右の空結果をmergerへ渡した結果
    expect(lastOf('tmpl-collect-teeing', 'emptySource').output.result).toMatchObject({
      kind: 'RECORD',
      recordName: 'SalarySummary',
    })
  })
})

describe('P5-D25 結果TypeRef連鎖', () => {
  it('P5-D25: §7.3の全結果型が内側から外側へ正しく組み上がり、全パネル表示値と一致する', () => {
    const expected: readonly [string, string][] = [
      ['tmpl-collect-tolist', 'List<Employee>'],
      ['tmpl-collect-toset', 'Set<String>'],
      ['tmpl-collect-joining', 'String'],
      ['tmpl-collect-counting', 'Long'],
      ['tmpl-collect-summing-int', 'Integer'],
      ['tmpl-collect-summing-long', 'Long'],
      ['tmpl-collect-summing-double', 'Double'],
      ['tmpl-collect-averaging-int', 'Double'],
      ['tmpl-collect-averaging-long', 'Double'],
      ['tmpl-collect-averaging-double', 'Double'],
      ['tmpl-collect-summarizing-int', 'IntSummaryStatistics'],
      ['tmpl-collect-summarizing-long', 'LongSummaryStatistics'],
      ['tmpl-collect-summarizing-double', 'DoubleSummaryStatistics'],
      ['tmpl-collect-minby', 'Optional<Employee>'],
      ['tmpl-collect-maxby', 'Optional<Employee>'],
      ['tmpl-collect-groupingby', 'Map<Department, List<Employee>>'],
      ['tmpl-collect-groupingby-treemap', 'Map<String, List<Employee>>'],
      ['tmpl-collect-groupingby-counting', 'Map<String, Long>'],
      ['tmpl-collect-groupingby-nested', 'Map<Department, Map<String, List<Employee>>>'],
      ['tmpl-collect-partitioningby', 'Map<Boolean, List<Employee>>'],
      ['tmpl-collect-teeing', 'SalarySummary'],
      ['tmpl-collect-triple', 'List<Employee>'],
    ]
    for (const [templateId, typeLabel] of expected) {
      const def = definitionOf(templateId)
      expect(formatTypeRef(def.resultType), templateId).toBe(typeLabel)
      // Pipelineの終端ノード出力型・出力パネルの型ラベルと一致する
      const sink = def.nodes.find((n) => n.role === 'terminal')
      expect(formatTypeRef(sink!.outputType), templateId).toBe(typeLabel)
      const last = lastOf(templateId)
      expect(last.output.resultTypeLabel, templateId).toBe(typeLabel)
      // Collector ASTノードの結果型（内側から外側）も同じ規則で組み上がる
      const root = collectorContextOf(last).root
      expect(root.resultTypeLabel, templateId).toBe(typeLabel)
    }
    // partitioningByのキーはwrapper Boolean（primitive booleanと混同しない）
    const partition = definitionOf('tmpl-collect-partitioningby').resultType
    expect(partition.kind).toBe('map')
    if (partition.kind === 'map') {
      expect(partition.keyType).toEqual({ kind: 'object', name: 'Boolean' })
    }
  })
})

describe('P5-D26 Collector context不変条件', () => {
  it('P5-D26: AST・現在経路・蓄積・finisher状態が同一時点を表し、structuredClone可能でdeepFreezeされる', () => {
    for (const { templateId, mode } of P5_COLLECTOR_TEMPLATE_MODES) {
      const snapshots = snapshotsOf(templateId, mode)
      for (const snapshot of snapshots) {
        const ctx = collectorContextOf(snapshot)
        // プレーンな木であること（Map / Set / 関数 / 循環参照を含まない）
        expect(() => structuredClone(ctx), `${templateId}:${mode}`).not.toThrow()
        expect(JSON.stringify(ctx) === JSON.stringify(structuredClone(ctx))).toBe(true)
        // deepFreezeされている
        expect(Object.isFrozen(snapshot), `${templateId}:${mode}`).toBe(true)
        expect(Object.isFrozen(ctx.root)).toBe(true)
        expect(Object.isFrozen(ctx.currentPath)).toBe(true)
        // 現在経路はAST上の実在ノードを指す
        const keys = new Set<string>()
        const walk = (node: typeof ctx.root): void => {
          keys.add(node.nodeKey)
          for (const child of [node.downstream, node.left, node.right]) if (child) walk(child)
          for (const bucket of node.buckets) walk(bucket.node)
        }
        walk(ctx.root)
        for (const key of ctx.currentPath) {
          expect(keys.has(key), `${templateId}:${mode} path=${key}`).toBe(true)
        }
        // activeフラグは現在経路と一致する
        const activeKeys = new Set<string>()
        const walkActive = (node: typeof ctx.root): void => {
          if (node.active) activeKeys.add(node.nodeKey)
          for (const child of [node.downstream, node.left, node.right]) if (child) walkActive(child)
          for (const bucket of node.buckets) walkActive(bucket.node)
        }
        walkActive(ctx.root)
        expect([...activeKeys].sort()).toEqual([...new Set(ctx.currentPath)].sort())
      }
    }
  })
})

describe('P5-D27 PROCESSING最大1件', () => {
  it('P5-D27: 全P5 template × modeの全snapshotでPROCESSINGが0件または1件（§10条件1）', () => {
    for (const { templateId, mode } of P5_TEMPLATE_MODES) {
      for (const snapshot of snapshotsOf(templateId, mode)) {
        expect(processingCount(snapshot), `${templateId}:${mode}:${snapshot.snapshotId}`).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('P5-D28 決定性・予算', () => {
  it('P5-D28: 同revisionで同一snapshot列（bucketごとのfinisher発行順を含む）', () => {
    for (const { templateId, mode } of P5_TEMPLATE_MODES) {
      const def = definitionOf(templateId, mode)
      const first = getTimeline(def)
      // 同じdefinitionからの再実行（キャッシュを迂回する新しいobject identity）
      const second = runAllSnapshots({ ...def })
      expect(second.map((s) => s.kind), `${templateId}:${mode}`).toEqual(first.map((s) => s.kind))
      expect(
        second.map((s) => s.processing?.title ?? null),
        `${templateId}:${mode}`,
      ).toEqual(first.map((s) => s.processing?.title ?? null))
      expect(JSON.stringify(second.map((s) => s.output.result))).toBe(
        JSON.stringify(first.map((s) => s.output.result)),
      )
    }
  })

  it('P5-D28: 全P5 templateが500 snapshot以内で、snapshotCountと実件数が一致する（§10条件20・22）', () => {
    for (const { templateId, mode } of P5_TEMPLATE_MODES) {
      const def = definitionOf(templateId, mode)
      const snapshots = runAllSnapshots(def)
      expect(def.snapshotCount, `${templateId}:${mode}`).toBe(snapshots.length)
      expect(def.snapshotCount, `${templateId}:${mode}`).toBeLessThanOrEqual(SNAPSHOT_LIMIT)
    }
  })
})

describe('P5-D29 Source of Truth', () => {
  it('P5-D29: 評価結果・TypeRef・Javaコード・説明が同一Collector ASTから一致して生成される（§10条件24）', () => {
    for (const { templateId, mode } of P5_COLLECTOR_TEMPLATE_MODES) {
      const def = definitionOf(templateId, mode)
      const sink = def.nodes.find((n) => n.role === 'terminal')!
      const line = def.javaCode.find((l) => l.nodeId === sink.nodeId)
      expect(line, `${templateId}:${mode}`).toBeDefined()
      // 表示用JavaコードはCollector AST / 3引数collect DSLから生成される
      if (sink.collector) {
        expect(line?.text, templateId).toBe(`        .collect(${collectorToJavaExpr(sink.collector)});`)
      } else {
        expect(line?.text, templateId).toContain('.collect(ArrayList::new, ArrayList::add, ArrayList::addAll);')
      }
      // 1ノード = 1行 = 1 line ID（行とノードの対応を崩さない）
      expect(def.javaCode.filter((l) => l.nodeId === sink.nodeId)).toHaveLength(1)
      expect(line?.lineId).toBe(`line-${sink.nodeId}`)
      // active nodeとJavaコードline IDが一致する
      for (const snapshot of snapshotsOf(templateId, mode)) {
        if (snapshot.activeNodeId === null) continue
        const activeLine = def.javaCode.find((l) => l.nodeId === snapshot.activeNodeId)
        expect(snapshot.activeLineId, `${templateId}:${mode}`).toBe(activeLine?.lineId ?? null)
      }
      // Java式はASCII構文（Unicode矢印を混入させない）
      expect(line?.text).not.toContain('→')
    }
  })

  it('P5-D29: Collector実装にeval / new Function / 動的コード生成が含まれない', () => {
    const root = path.join(__dirname, '../../src')
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry)
        if (statSync(full).isDirectory()) walk(full)
        else if (full.endsWith('.ts') || full.endsWith('.tsx')) files.push(full)
      }
    }
    walk(root)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      expect(/\beval\s*\(/.test(source), file).toBe(false)
      expect(/new\s+Function\s*\(/.test(source), file).toBe(false)
    }
  })
})

describe('P5-D30 takeWhile / dropWhile持越し', () => {
  it('P5-D30: Employee fieldCompare templateの3modeで境界到達・短絡後未評価・drop→通過遷移が正しい', () => {
    // takeWhile標準: 佐藤（5_500_000）通過 → 鈴木（4_200_000）で境界到達し短絡
    expect(finalOutputLabels(definitionOf('tmpl-takewhile-employee'))).toEqual(['佐藤（age=35）'])
    const takeSnapshots = snapshotsOf('tmpl-takewhile-employee')
    const takeLast = takeSnapshots[takeSnapshots.length - 1]!
    // 高橋・田中はPredicateならtrueだが未評価のまま
    expect(takeLast.elementLatestStates['emp-003']).toBe('UNEVALUATED')
    expect(takeLast.elementLatestStates['emp-004']).toBe('UNEVALUATED')
    const takeCtx = Object.values(takeLast.operationContexts).find((c) => c.kind === 'takeWhile')
    expect(takeCtx?.kind).toBe('takeWhile')
    if (takeCtx?.kind === 'takeWhile') {
      expect(takeCtx.stopped).toBe(true)
      expect(takeCtx.boundaryElementId).toBe('emp-002')
      expect(takeCtx.predicateText).toBe('e -> e.salary() >= 5_000_000L')
    }
    expect(kindsOf('tmpl-takewhile-employee')).toContain('SHORT_CIRCUIT_CONFIRMED')
    // 3modeすべて成立する
    expect(finalOutputLabels(definitionOf('tmpl-takewhile-employee', 'midEmpty'))).toEqual([])
    expect(finalOutputLabels(definitionOf('tmpl-takewhile-employee', 'emptySource'))).toEqual([])

    // dropWhile標準: 佐藤をdropし、鈴木で通過モードへ遷移
    expect(finalOutputLabels(definitionOf('tmpl-dropwhile-employee'))).toEqual([
      '鈴木（age=27）',
      '高橋（age=42）',
      '田中（age=29）',
    ])
    const dropKinds = kindsOf('tmpl-dropwhile-employee')
    expect(dropKinds).toContain('DROP_MODE_ENTERED')
    const dropSnapshots = snapshotsOf('tmpl-dropwhile-employee')
    const dropLast = dropSnapshots[dropSnapshots.length - 1]!
    const dropCtx = Object.values(dropLast.operationContexts).find((c) => c.kind === 'dropWhile')
    if (dropCtx?.kind === 'dropWhile') {
      expect(dropCtx.mode).toBe('PASSING')
      expect(dropCtx.boundaryElementId).toBe('emp-002')
    }
    // 通過モード遷移後はPredicateを再評価しない（評価は佐藤・鈴木の2回のみ）
    expect(dropKinds.filter((k) => k === 'PREDICATE_EVALUATED')).toHaveLength(2)
    expect(finalOutputLabels(definitionOf('tmpl-dropwhile-employee', 'midEmpty'))).toEqual([])
    expect(finalOutputLabels(definitionOf('tmpl-dropwhile-employee', 'emptySource'))).toEqual([])
  })
})

describe('P5-D31 終端回帰', () => {
  it('P5-D31: terminal runtime一般化後もPhase 4終端の代表snapshot列・結果が変わらない', () => {
    // toList（Phase 1経路）
    expect(kindsOf('tmpl-filter-basic')).toEqual([
      'INITIAL',
      'SOURCE_EMIT',
      'NODE_ARRIVAL',
      'PREDICATE_EVALUATED',
      'ELEMENT_PASSED',
      'SINK_APPENDED',
      'SOURCE_EMIT',
      'NODE_ARRIVAL',
      'PREDICATE_EVALUATED',
      'ELEMENT_REJECTED',
      'SOURCE_EMIT',
      'NODE_ARRIVAL',
      'PREDICATE_EVALUATED',
      'ELEMENT_PASSED',
      'SINK_APPENDED',
      'SOURCE_EMIT',
      'NODE_ARRIVAL',
      'PREDICATE_EVALUATED',
      'ELEMENT_REJECTED',
      'RESULT_CONFIRMED',
      'STREAM_CONSUMED',
    ])
    // count / reduce / min / statistics / forEachの代表結果
    expect(lastOf('tmpl-count').output.result).toMatchObject({ kind: 'SCALAR', valueLabel: '4L' })
    expect(lastOf('tmpl-reduce-salary').output.result).toMatchObject({ valueLabel: '21_700_000L' })
    expect(lastOf('tmpl-min-age').output.result).toMatchObject({ kind: 'OPTIONAL', present: true })
    expect(lastOf('tmpl-stats-int').output.result).toMatchObject({ kind: 'STATISTICS' })
    expect(lastOf('tmpl-foreach').output.result).toMatchObject({ kind: 'VOID' })
    // Collector系のsnapshot kindがPhase 4終端へ混入していない
    for (const templateId of ['tmpl-count', 'tmpl-reduce-salary', 'tmpl-min-age', 'tmpl-stats-int']) {
      const kinds = kindsOf(templateId)
      for (const collectorKind of [
        'CONTAINER_CREATED',
        'CLASSIFIER_EVALUATED',
        'BUCKET_SELECTED',
        'CONTAINER_UPDATED',
        'COLLECTOR_FINISHED',
        'TEE_BRANCH_ACCUMULATED',
        'TEE_BRANCH_FINISHED',
        'TEE_MERGER_APPLIED',
      ]) {
        expect(kinds, `${templateId}:${collectorKind}`).not.toContain(collectorKind)
      }
      // terminal contextは従来どおりcollector以外のvariant
      const last = lastOf(templateId)
      expect(Object.values(last.operationContexts).some((c) => c.kind === 'collector')).toBe(false)
    }
  })
})
