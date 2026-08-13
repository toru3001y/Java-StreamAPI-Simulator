import type {
  CollectorAccumulationView,
  CollectorNodeView,
  OperationContextView,
} from '../../domain/engine/snapshot'
import { projectItemOrder } from '../displayOrderProjection'

/**
 * Collector構造ツリー・現在経路・ノード別蓄積の表示（Draft v0.8 §15、Phase 5指示 §10.2）。
 * UIは確定snapshotのview値だけを描画し、結果・型・蓄積状態・表示順を独自計算しない
 * （表示順のみ純粋なDisplayOrderProjectionで安定化する）。
 */

type CollectorContext = Extract<OperationContextView, { kind: 'collector' }>

function AccumulationView({ accumulation }: { accumulation: CollectorAccumulationView }) {
  switch (accumulation.kind) {
    case 'NONE':
      return null
    case 'ELEMENTS':
      return (
        <div className="collector-accumulation" data-testid="collector-acc-elements">
          <span className="collector-acc-label">{accumulation.containerLabel}</span>
          {accumulation.items.length === 0 ? (
            <code className="empty-note">[]</code>
          ) : (
            <ol className="element-list nested-list">
              {projectItemOrder(accumulation.items, true).map((item) => (
                <li key={`${item.id}:${item.label}`} data-element-id={item.id}>
                  {item.label}
                </li>
              ))}
            </ol>
          )}
          {accumulation.changedByLast === false && (
            <p className="op-context-note" data-testid="collector-acc-unchanged">
              □ 追加しても変化しません（重複）
            </p>
          )}
        </div>
      )
    case 'TEXT':
      return (
        <p className="collector-accumulation" data-testid="collector-acc-text">
          連結中: <code>&quot;{accumulation.valueLabel}&quot;</code>
        </p>
      )
    case 'NUMBER':
      return (
        <p className="collector-accumulation" data-testid="collector-acc-number">
          現在値: <code>{accumulation.valueLabel}</code>
        </p>
      )
    case 'AVERAGE':
      return (
        <p className="collector-accumulation" data-testid="collector-acc-average">
          合計 <code>{accumulation.sumLabel}</code> / 件数 <code>{accumulation.countLabel}</code>
          {accumulation.averageLabel !== null && (
            <>
              {' → 平均 '}
              <code>{accumulation.averageLabel}</code>
            </>
          )}
        </p>
      )
    case 'STATISTICS':
      return (
        <p className="collector-accumulation" data-testid="collector-acc-statistics">
          <code>
            count={accumulation.countLabel}, sum={accumulation.sumLabel}, min={accumulation.minLabel},
            average={accumulation.averageLabel}, max={accumulation.maxLabel}
          </code>
        </p>
      )
    case 'CANDIDATE':
      return (
        <p className="collector-accumulation" data-testid="collector-acc-candidate">
          現在候補:{' '}
          <code data-element-id={accumulation.candidateElementId ?? undefined}>
            {accumulation.candidateLabel ?? 'なし'}
          </code>
          <span className="scalar-type">（更新{accumulation.updateCount}回）</span>
        </p>
      )
    case 'MAP':
      return (
        <p className="collector-accumulation" data-testid="collector-acc-map">
          <span className="collector-acc-label">{accumulation.containerLabel}</span>
          bucket数: <code>{accumulation.size}</code>
        </p>
      )
    // ---- Phase 8: toMapのentry蓄積（キー → 値1件。groupingByのbucket Listとの視覚差が対比の核） ----
    case 'TO_MAP':
      return (
        <div
          className="collector-accumulation collector-acc-tomap"
          data-testid="collector-acc-tomap"
          data-container={accumulation.containerLabel}
        >
          <span className="collector-acc-label">{accumulation.containerLabel}</span>
          entry数: <code>{accumulation.entries.length}</code>
          {accumulation.entries.length === 0 ? (
            <code className="empty-note">{'{}'}</code>
          ) : (
            <ul className="tomap-entries" data-testid="collector-tomap-entries">
              {/* 蓄積順（TreeMapは実キー順）で確定済み。UIは並べ替えない（指示§7.5-3） */}
              {accumulation.entries.map((entry) => (
                <li key={entry.keyRef} data-key-ref={entry.keyRef}>
                  <span className="map-key">{entry.keyLabel}</span>
                  <span className="map-arrow" aria-hidden="true">
                    {' = '}
                  </span>
                  <code>{entry.valueLabel}</code>
                  <span className="scalar-type">（{entry.valueTypeLabel}）</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )
  }
}

/**
 * toMapノードの構造4行（keyMapper / valueMapper / mergeFunction / mapFactory）。
 * 省略overloadの行も常設し、意味論表示の確定文言（snapshot側で確定）を描画する（v0.11 §5）。
 */
function ToMapStructureView({ node }: { node: CollectorNodeView }) {
  const toMap = node.toMap
  if (!toMap) return null
  return (
    <table className="stats-table collector-tomap" data-testid="collector-tomap" data-arity={toMap.arity}>
      <tbody>
        <tr>
          <th scope="row">keyMapper</th>
          <td data-testid="tomap-key-mapper">
            <code>{toMap.keyMapperLabel}</code>
          </td>
        </tr>
        <tr>
          <th scope="row">valueMapper</th>
          <td data-testid="tomap-value-mapper">
            <code>{toMap.valueMapperLabel}</code>
          </td>
        </tr>
        <tr>
          <th scope="row">mergeFunction</th>
          <td data-testid="tomap-merge-function">
            <code>{toMap.mergeFunctionLabel}</code>
            {toMap.mergeMeaningLabel !== null && (
              <span className="scalar-type" data-testid="tomap-merge-meaning">
                （{toMap.mergeMeaningLabel} / 引数順は(Map内の既存値, 新しい値)）
              </span>
            )}
          </td>
        </tr>
        <tr>
          <th scope="row">mapFactory</th>
          <td data-testid="tomap-map-factory">
            <code>{toMap.mapFactoryLabel}</code>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

function TeeingView({ node }: { node: CollectorNodeView }) {
  const tee = node.teeing
  if (!tee) return null
  return (
    <div className="collector-teeing" data-testid="collector-teeing" data-active-branch={tee.activeBranch}>
      <table className="stats-table">
        <tbody>
          <tr>
            <th>左branch（R1）</th>
            <td data-testid="teeing-left">
              <span className="branch-state" data-state={tee.leftState}>
                {tee.leftState}
              </span>{' '}
              蓄積: <code>{tee.leftAccumulationLabel}</code>
              {tee.leftResultLabel !== null && (
                <>
                  {' → '}
                  <code data-testid="teeing-left-result">{tee.leftResultLabel}</code>
                </>
              )}
              <span className="scalar-type">（{tee.leftResultTypeLabel}）</span>
            </td>
          </tr>
          <tr>
            <th>右branch（R2）</th>
            <td data-testid="teeing-right">
              <span className="branch-state" data-state={tee.rightState}>
                {tee.rightState}
              </span>{' '}
              蓄積: <code>{tee.rightAccumulationLabel}</code>
              {tee.rightResultLabel !== null && (
                <>
                  {' → '}
                  <code data-testid="teeing-right-result">{tee.rightResultLabel}</code>
                </>
              )}
              <span className="scalar-type">（{tee.rightResultTypeLabel}）</span>
            </td>
          </tr>
          <tr>
            <th>merger</th>
            <td data-testid="teeing-merger">
              <code>{tee.mergerLabel}</code>
              {tee.mergerApplied ? '（適用済み）' : '（未適用）'}
            </td>
          </tr>
          <tr>
            <th>最終結果（R）</th>
            <td data-testid="teeing-final">
              <code>{tee.finalResultLabel ?? '未確定'}</code>
              <span className="scalar-type">（{tee.resultTypeLabel}）</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="op-context-note" data-testid="teeing-order-note">
        {tee.branchDisplayOrderNote}
        {tee.jdkOrderNote}
      </p>
    </div>
  )
}

function CollectorNode({ node, depth }: { node: CollectorNodeView; depth: number }) {
  return (
    <li
      className="collector-node"
      data-node-key={node.nodeKey}
      data-collector-kind={node.collectorKind}
      data-active={node.active || undefined}
      data-depth={depth}
      aria-current={node.active ? 'step' : undefined}
    >
      <div className="collector-node-head">
        <span className="collector-node-marker" aria-hidden="true">
          {node.active ? '▶' : '・'}
        </span>
        <code className="collector-node-label">{node.label}</code>
        <span className="collector-node-types">
          {node.inputTypeLabel} → {node.resultTypeLabel}
        </span>
      </div>
      <ToMapStructureView node={node} />
      <AccumulationView accumulation={node.accumulation} />
      {node.finisher && (
        <p className="collector-finisher" data-testid="collector-finisher" data-state={node.finisher.state}>
          finisher: <code>{node.finisher.label}</code>（{node.finisher.state === 'APPLIED' ? '適用済み' : '未適用'}）
          {node.finisher.state === 'APPLIED' && (
            <>
              {' '}
              <span data-testid="collector-finisher-before">
                {node.finisher.beforeLabel}（{node.finisher.beforeTypeLabel}）
              </span>
              {' → '}
              <span data-testid="collector-finisher-after">
                {node.finisher.afterLabel}（{node.finisher.afterTypeLabel}）
              </span>
            </>
          )}
        </p>
      )}
      <TeeingView node={node} />
      {node.buckets.length > 0 && (
        <>
          {/*
            構造ツリーのbucketは「bucket生成履歴順」で表示する（Mapの成長を追えるようにするため）。
            最終結果パネルの表示順（順序保証なしは学習用の辞書順 / TreeMapは実キー順）とは
            意味が異なるため、ここで明示する（Draft v0.8 §16.3・指示§6.4）。
          */}
          <p className="op-context-note" data-testid="collector-bucket-order-note">
            bucketはbucket生成履歴順で表示しています（最終結果パネルの表示順とは意味が異なります）。
          </p>
          <ul className="collector-buckets" data-testid="collector-buckets">
          {node.buckets.map((bucket) => (
            <li
              key={bucket.keyRef}
              className="collector-bucket"
              data-key-ref={bucket.keyRef}
              data-active={bucket.active || undefined}
              data-created-seq={bucket.createdSeq}
            >
              <span className="map-key">{bucket.keyLabel}</span>
              <span className="scalar-type">（bucket #{bucket.createdSeq}）</span>
              {bucket.createdByLast && (
                <span className="collector-bucket-new" data-testid="collector-bucket-new">
                  新規生成
                </span>
              )}
              <ul className="collector-tree">
                <CollectorNode node={bucket.node} depth={depth + 1} />
              </ul>
            </li>
          ))}
          </ul>
        </>
      )}
      {(node.downstream || node.left || node.right) && (
        <ul className="collector-tree">
          {node.downstream && node.buckets.length === 0 && (
            <CollectorNode node={node.downstream} depth={depth + 1} />
          )}
          {node.downstream && node.buckets.length > 0 && (
            <li className="collector-node collector-node-template" data-testid="collector-bucket-template">
              <div className="collector-node-head">
                <span className="collector-node-marker" aria-hidden="true">
                  ・
                </span>
                <code className="collector-node-label">{node.downstream.label}</code>
                <span className="collector-node-types">各bucketのdownstream構造</span>
              </div>
            </li>
          )}
          {node.left && <CollectorNode node={node.left} depth={depth + 1} />}
          {node.right && <CollectorNode node={node.right} depth={depth + 1} />}
        </ul>
      )}
    </li>
  )
}

export function CollectorStructurePanel({ ctx }: { ctx: CollectorContext }) {
  return (
    <div className="op-context collector-structure" data-testid="op-context-collector" data-node-id={ctx.nodeId}>
      <h4>Collector構造ツリー</h4>
      {ctx.currentPathLabel !== null && (
        <p className="collector-current-path" data-testid="collector-current-path">
          現在経路: {ctx.currentPathLabel}
        </p>
      )}
      {ctx.triple && (
        <table className="stats-table" data-testid="collector-triple">
          <tbody>
            <tr>
              <th>supplier</th>
              <td>
                <code>{ctx.triple.supplierId}</code>
              </td>
            </tr>
            <tr>
              <th>accumulator</th>
              <td>
                <code>{ctx.triple.accumulatorId}</code>
              </td>
            </tr>
            <tr>
              <th>combiner</th>
              <td data-testid="collector-triple-combiner">
                <code>{ctx.triple.combinerId}</code>（定義のみ / 呼出し
                {ctx.triple.combinerCallCount}回）
              </td>
            </tr>
          </tbody>
        </table>
      )}
      <ul className="collector-tree collector-tree-root">
        <CollectorNode node={ctx.root} depth={0} />
      </ul>
      {ctx.triple && (
        <p className="op-context-note" data-testid="collector-triple-note">
          {ctx.triple.combinerNote}
        </p>
      )}
      {/*
        構造ツリーは「処理の進行そのもの」を示すため、蓄積はコンテナへの追加順で表示する。
        最終結果パネルの表示順（順序保証なしは学習用の辞書順 / TreeMapは実キー順）とは
        意味が異なることを明示する（一律に「学習用の順序」と説明しない）。
      */}
      <p className="op-context-note" data-testid="collector-tree-order-note">
        構造ツリーは蓄積の追加順で表示しています（最終結果パネルの表示順とは意味が異なります）。
      </p>
    </div>
  )
}
