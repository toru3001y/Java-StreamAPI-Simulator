import type { SessionState } from '../../application/session'
import {
  ELEMENT_STATE_LABELS,
  ELEMENT_STATE_SYMBOLS,
} from '../../domain/engine/snapshot'

/**
 * MainSimulation（§17.1）: 全幅の入力 → 処理中 → 出力。
 * snapshot確定時に全列を同期し、UIは確定snapshotの値だけを描画する。
 */
export function MainSimulation({ state }: { state: SessionState }) {
  const { snapshot, scenario } = state
  const dataset = scenario.pipeline.dataset
  const byId = new Map(dataset.map((d) => [d.elementId, d]))

  return (
    <section
      className="panel main-simulation"
      aria-label="シミュレーション"
      data-snapshot-id={snapshot.snapshotId}
      data-testid="main-simulation"
    >
      <div className="legend" data-testid="legend" aria-label="凡例">
        {snapshot.legend.map((stateKind) => (
          <span className="legend-item" key={stateKind} data-state={stateKind}>
            <span aria-hidden="true">{ELEMENT_STATE_SYMBOLS[stateKind]}</span>{' '}
            {ELEMENT_STATE_LABELS[stateKind]}
          </span>
        ))}
      </div>
      <div className="simulation-columns">
        <div className="sim-column" data-testid="input-panel" aria-label="入力">
          <h3>入力</h3>
          {dataset.length === 0 ? (
            <p className="empty-note">入力は0件です（空ソース）</p>
          ) : (
            <ul className="element-list">
              {dataset.map((element) => {
                const stateKind = snapshot.elementLatestStates[element.elementId] ?? 'UNEVALUATED'
                const isCurrent = element.elementId === snapshot.currentElementId
                return (
                  <li
                    key={element.elementId}
                    className={`element-row state-${stateKind}${isCurrent ? ' current' : ''}`}
                    data-element-id={element.elementId}
                    data-state={stateKind}
                  >
                    <span className="state-symbol" aria-hidden="true">
                      {ELEMENT_STATE_SYMBOLS[stateKind]}
                    </span>
                    <span className="element-name">
                      {element.value.name}（age={element.value.age}）
                    </span>
                    <span className="state-label">{ELEMENT_STATE_LABELS[stateKind]}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="sim-column" data-testid="processing-panel" aria-label="処理中">
          <h3>処理中</h3>
          {snapshot.processing === null ? (
            <p className="empty-note">初期状態です。「進む」で実行を開始します。</p>
          ) : (
            <div className="processing-view">
              <p className="processing-title">{snapshot.processing.title}</p>
              {snapshot.processing.inputLabel && (
                <p className="processing-input" data-testid="processing-input">
                  {snapshot.processing.inputLabel}
                </p>
              )}
              {snapshot.processing.expression && (
                <p>
                  <code data-testid="processing-expression">{snapshot.processing.expression}</code>
                </p>
              )}
              {snapshot.processing.evaluation && (
                <p>
                  <code data-testid="processing-evaluation">{snapshot.processing.evaluation}</code>
                </p>
              )}
              {snapshot.processing.outcome && (
                <p className="processing-outcome" data-testid="processing-outcome">
                  {snapshot.processing.outcome}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="sim-column" data-testid="output-panel" aria-label="出力">
          <h3>出力</h3>
          <p className="output-type">
            {snapshot.output.resultTypeLabel}
            {snapshot.output.confirmed && <span className="badge badge-confirmed">確定</span>}
          </p>
          {snapshot.output.elementIds.length === 0 ? (
            <p className="empty-note" data-testid="output-empty">
              []（0件）
            </p>
          ) : (
            <ol className="element-list output-list" data-testid="output-list">
              {snapshot.output.elementIds.map((elementId) => {
                const element = byId.get(elementId)
                return (
                  <li key={elementId} data-element-id={elementId}>
                    {element ? `${element.value.name}（age=${element.value.age}）` : elementId}
                  </li>
                )
              })}
            </ol>
          )}
          <p className="output-count">{snapshot.output.count}件</p>
        </div>
      </div>
    </section>
  )
}
