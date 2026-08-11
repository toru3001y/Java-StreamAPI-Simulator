import type { SessionState } from '../../application/session'

/**
 * Side Effectビュー（Phase 3指示 §7.8・§11.2、Phase 4指示 §6.5）。
 * peek / forEach系のConsumer実行履歴を、通常のStream結果と視覚的・意味的に分離して表示する。
 * ブラウザconsoleの内容は読み取らず、snapshotへ保持された不変履歴だけを描画する。
 * 履歴は現在snapshotまでのものであり、「戻る」で減り、再進行で同じentryが復元される。
 */
export function SideEffectPanel({ state }: { state: SessionState }) {
  const { snapshot, scenario } = state
  const consumerOps = scenario.pipeline.nodes
    .filter((n) => n.consumer !== null)
    .map((n) => n.displayName)
  if (consumerOps.length === 0) return null
  return (
    <section
      className="panel side-effect-panel"
      aria-label="Side Effect"
      data-snapshot-id={snapshot.snapshotId}
      data-testid="side-effect-panel"
    >
      <h3>
        Side Effectビュー（{consumerOps.join(' / ')}）
        <span className="badge badge-side-effect">通常の結果とは別物</span>
      </h3>
      <p className="side-effect-note">
        ConsumerによるSystem.out出力の履歴です。Streamの結果（出力パネル）には影響しません。
      </p>
      {snapshot.sideEffects.length === 0 ? (
        <p className="empty-note" data-testid="side-effect-empty">
          Consumer呼出しは0回です（Side Effectはまだありません）
        </p>
      ) : (
        <ol className="side-effect-list" data-testid="side-effect-list">
          {snapshot.sideEffects.map((entry) => (
            <li key={entry.seq} data-seq={entry.seq} data-element-id={entry.elementId}>
              <span className="side-effect-seq">#{entry.seq}</span>
              <code className="side-effect-message">{entry.message}</code>
              <span className="side-effect-meta">
                {entry.actionLabel}（{entry.inputLabel}）
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
