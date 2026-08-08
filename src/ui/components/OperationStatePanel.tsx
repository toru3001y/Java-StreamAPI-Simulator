import type { OperationContextView } from '../../domain/engine/snapshot'
import type { Snapshot } from '../../domain/engine/snapshot'

const SORTED_PHASE_LABELS = {
  BUFFERING: 'buffer蓄積中',
  ORDER_CONFIRMED: '並べ替え確定',
  EMITTING: '1件ずつ放出中',
} as const

/**
 * Phase 3の操作固有状態表示（指示§11.2）。
 * UIはsnapshotへ確定済みのnode単位contextを描画するだけで、
 * seen / buffer / count / 境界 / Side Effectを再計算しない。
 */
function DistinctContext({ ctx }: { ctx: Extract<OperationContextView, { kind: 'distinct' }> }) {
  return (
    <div className="op-context" data-testid="op-context-distinct" data-node-id={ctx.nodeId}>
      <h4>distinctの状態</h4>
      {ctx.currentLabel && (
        <p data-testid="distinct-current">
          現在値: {ctx.currentLabel}
          {ctx.verdict && (
            <span
              className={`badge ${ctx.verdict === 'FIRST' ? 'badge-first' : 'badge-duplicate'}`}
              data-testid="distinct-verdict"
            >
              {ctx.verdict === 'FIRST' ? '初登場' : '重複'}
            </span>
          )}
        </p>
      )}
      <p className="op-context-label">seen（既出値 {ctx.seen.length}件）</p>
      {ctx.seen.length === 0 ? (
        <p className="empty-note" data-testid="distinct-seen-empty">
          まだ既出値はありません
        </p>
      ) : (
        <ol className="op-context-list" data-testid="distinct-seen">
          {ctx.seen.map((entry) => (
            <li key={entry.key}>{entry.label}</li>
          ))}
        </ol>
      )}
    </div>
  )
}

function SortedContext({
  ctx,
  snapshot,
}: {
  ctx: Extract<OperationContextView, { kind: 'sorted' }>
  snapshot: Snapshot
}) {
  return (
    <div className="op-context" data-testid="op-context-sorted" data-node-id={ctx.nodeId}>
      <h4>
        sortedの状態
        <span className="badge" data-testid="sorted-phase" data-phase={ctx.phase}>
          {SORTED_PHASE_LABELS[ctx.phase]}
        </span>
      </h4>
      <p className="op-context-code" data-testid="sorted-comparator">
        <code>{ctx.comparatorLabel}</code>
      </p>
      <p className="op-context-note">{ctx.keyDescription}</p>
      <p className="op-context-label">元のbuffer順序（{ctx.bufferOrder.length}件）</p>
      {ctx.bufferOrder.length === 0 ? (
        <p className="empty-note" data-testid="sorted-buffer-empty">
          bufferは空です
        </p>
      ) : (
        <ol className="op-context-list" data-testid="sorted-buffer">
          {ctx.bufferOrder.map((entry) => (
            <li key={entry.id} data-element-id={entry.id}>
              {entry.label}
              <span className="op-context-key">キー: {entry.keyLabel}</span>
            </li>
          ))}
        </ol>
      )}
      {ctx.confirmedOrder && (
        <>
          <p className="op-context-label" data-testid="sorted-emit-position">
            確定後順序（放出済み {ctx.emittedCount}/{ctx.confirmedOrder.length}件）
          </p>
          <ol className="op-context-list" data-testid="sorted-confirmed">
            {ctx.confirmedOrder.map((entry, i) => (
              <li
                key={entry.id}
                data-element-id={entry.id}
                data-emitted={i < ctx.emittedCount || undefined}
                className={entry.id === snapshot.currentElementId ? 'current' : undefined}
              >
                <span aria-hidden="true">{i < ctx.emittedCount ? '○' : '□'}</span> {entry.label}
                <span className="state-label">{i < ctx.emittedCount ? '放出済み' : '未放出'}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      {ctx.stableNote && <p className="op-context-note">{ctx.stableNote}</p>}
    </div>
  )
}

function LimitContext({ ctx }: { ctx: Extract<OperationContextView, { kind: 'limit' }> }) {
  return (
    <div className="op-context" data-testid="op-context-limit" data-node-id={ctx.nodeId}>
      <h4>
        limitの状態
        {ctx.reached && (
          <span className="badge badge-shortcircuit" data-testid="limit-reached">
            上限到達
          </span>
        )}
      </h4>
      <p data-testid="limit-count">
        通過数 {ctx.passedCount}/{ctx.maxSize}
      </p>
      {ctx.upstreamStopped && (
        <p className="op-context-note" data-testid="limit-upstream-stopped">
          上流への要素要求を停止しました。残りの要素は評価されず、未評価（－）のままです。
        </p>
      )}
    </div>
  )
}

function SkipContext({ ctx }: { ctx: Extract<OperationContextView, { kind: 'skip' }> }) {
  return (
    <div className="op-context" data-testid="op-context-skip" data-node-id={ctx.nodeId}>
      <h4>
        skipの状態
        {ctx.passMode && (
          <span className="badge badge-first" data-testid="skip-pass-mode">
            通過モード
          </span>
        )}
      </h4>
      <p data-testid="skip-count">
        スキップ数 {ctx.skippedCount}/{ctx.n}
      </p>
      <p className="op-context-note">
        {ctx.passMode
          ? `${ctx.n}件のスキップが完了し、以後の要素は判定なしで通過します。`
          : `最初の${ctx.n}件はdrop対象として除外されます。`}
      </p>
    </div>
  )
}

function TakeWhileContext({ ctx }: { ctx: Extract<OperationContextView, { kind: 'takeWhile' }> }) {
  return (
    <div className="op-context" data-testid="op-context-takeWhile" data-node-id={ctx.nodeId}>
      <h4>
        takeWhileの状態
        {ctx.stopped && (
          <span className="badge badge-shortcircuit" data-testid="takewhile-stop">
            STOP（短絡確定）
          </span>
        )}
      </h4>
      <p className="op-context-code">
        <code data-testid="takewhile-predicate">{ctx.predicateText}</code>
      </p>
      {ctx.stopped ? (
        <p className="op-context-note" data-testid="takewhile-boundary">
          境界要素 {ctx.boundaryLabel} が最初のfalseとなり短絡しました。後続の要素はPredicateなら
          trueとなる値でも評価されず、未評価（－）のままです。
        </p>
      ) : (
        <p className="op-context-note">Predicateがtrueの間、要素を通過させます。</p>
      )}
    </div>
  )
}

function DropWhileContext({ ctx }: { ctx: Extract<OperationContextView, { kind: 'dropWhile' }> }) {
  return (
    <div className="op-context" data-testid="op-context-dropWhile" data-node-id={ctx.nodeId}>
      <h4>
        dropWhileの状態
        <span
          className={`badge ${ctx.mode === 'PASSING' ? 'badge-first' : ''}`}
          data-testid="dropwhile-mode"
          data-mode={ctx.mode}
        >
          {ctx.mode === 'DROPPING' ? 'drop中' : '通過モード'}
        </span>
      </h4>
      <p className="op-context-code">
        <code data-testid="dropwhile-predicate">{ctx.predicateText}</code>
      </p>
      {ctx.mode === 'PASSING' ? (
        <p className="op-context-note" data-testid="dropwhile-boundary">
          境界要素 {ctx.boundaryLabel} で最初のfalseとなり、通過モードへ移行しました。
          以後の要素はPredicateを再評価せずに通過します。
        </p>
      ) : (
        <p className="op-context-note">Predicateがtrueの間、要素をdrop（除外）します。</p>
      )}
    </div>
  )
}

function PeekContext({ ctx }: { ctx: Extract<OperationContextView, { kind: 'peek' }> }) {
  return (
    <div className="op-context" data-testid="op-context-peek" data-node-id={ctx.nodeId}>
      <h4>peekの状態</h4>
      <p className="op-context-code">
        <code data-testid="peek-consumer">{ctx.consumerText}</code>
      </p>
      <p data-testid="peek-call-count">Consumer呼出し {ctx.callCount}回</p>
      <p className="op-context-note">値と型は変更されません。実行履歴はSide Effectビューに表示されます。</p>
    </div>
  )
}

export function OperationStatePanel({ snapshot }: { snapshot: Snapshot }) {
  const contexts = Object.values(snapshot.operationContexts)
  if (contexts.length === 0) return null
  return (
    <div className="op-context-panel" data-testid="operation-state-panel">
      {contexts.map((ctx) => {
        switch (ctx.kind) {
          case 'distinct':
            return <DistinctContext key={ctx.nodeId} ctx={ctx} />
          case 'sorted':
            return <SortedContext key={ctx.nodeId} ctx={ctx} snapshot={snapshot} />
          case 'limit':
            return <LimitContext key={ctx.nodeId} ctx={ctx} />
          case 'skip':
            return <SkipContext key={ctx.nodeId} ctx={ctx} />
          case 'takeWhile':
            return <TakeWhileContext key={ctx.nodeId} ctx={ctx} />
          case 'dropWhile':
            return <DropWhileContext key={ctx.nodeId} ctx={ctx} />
          case 'peek':
            return <PeekContext key={ctx.nodeId} ctx={ctx} />
        }
      })}
    </div>
  )
}
