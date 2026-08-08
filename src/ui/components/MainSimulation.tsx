import type { SessionState } from '../../application/session'
import {
  ELEMENT_STATE_LABELS,
  ELEMENT_STATE_SYMBOLS,
} from '../../domain/engine/snapshot'
import { formatSimValue } from '../../domain/model/value'

const INDEXED_SOURCE_KINDS = [
  'arrayObject',
  'arrayPrimitive',
  'streamOf',
  'streamOfPrimitiveArrays',
  'nestedStringList',
] as const

/**
 * MainSimulation（§17.1）: 全幅の入力 → 処理中 → 出力。
 * snapshot確定時に全列を同期し、UIは確定snapshotの値だけを描画する。
 */
export function MainSimulation({ state }: { state: SessionState }) {
  const { snapshot, scenario } = state
  const dataset = scenario.pipeline.dataset
  const showIndex = (INDEXED_SOURCE_KINDS as readonly string[]).includes(
    scenario.pipeline.sourceDsl.kind,
  )
  const flatMapCtx = snapshot.flatMapContext
  const sourceCtx = snapshot.sourceContext

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
                const isCurrent =
                  element.elementId === snapshot.currentElementId ||
                  element.elementId === snapshot.parentElementId
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
                    {showIndex && <span className="element-index">[{element.index}]</span>}
                    <span className="element-name">{formatSimValue(element.value)}</span>
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
              {snapshot.typeTransition && (
                <p className="type-transition" data-testid="type-transition">
                  型: {snapshot.typeTransition}
                </p>
              )}
              {sourceCtx && sourceCtx.index !== null && (
                <p className="source-context" data-testid="source-index">
                  index: {sourceCtx.index}
                </p>
              )}
              {sourceCtx && sourceCtx.note && (
                <p className="source-context" data-testid="source-note">
                  範囲: {sourceCtx.note}
                </p>
              )}
            </div>
          )}
          {flatMapCtx && (
            <div className="flatmap-panel" data-testid="flatmap-panel">
              <h4>mapped Stream</h4>
              <p data-testid="flatmap-parent">
                親: {flatMapCtx.parentLabel}
                {flatMapCtx.closed && (
                  <span className="badge badge-closed" data-testid="flatmap-closed">
                    close済み
                  </span>
                )}
              </p>
              {flatMapCtx.children.length === 0 ? (
                <p className="empty-note" data-testid="flatmap-children-empty">
                  子要素は0件です
                </p>
              ) : (
                <ol className="flatmap-children" data-testid="flatmap-children">
                  {flatMapCtx.children.map((child, i) => {
                    const emitted = i < flatMapCtx.emittedCount
                    const isCurrent = child.id === snapshot.currentElementId
                    return (
                      <li
                        key={child.id}
                        data-element-id={child.id}
                        data-emitted={emitted || undefined}
                        className={isCurrent ? 'current' : undefined}
                      >
                        <span aria-hidden="true">{emitted ? '○' : '－'}</span> {child.label}
                        <span className="state-label">{emitted ? '送出済み' : '未送出'}</span>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
          )}
        </div>
        <div className="sim-column" data-testid="output-panel" aria-label="出力">
          <h3>出力</h3>
          <p className="output-type" data-testid="output-type">
            {snapshot.output.resultTypeLabel}
            {snapshot.output.confirmed && <span className="badge badge-confirmed">確定</span>}
          </p>
          {snapshot.output.items.length === 0 ? (
            <p className="empty-note" data-testid="output-empty">
              []（0件）
            </p>
          ) : (
            <ol className="element-list output-list" data-testid="output-list">
              {snapshot.output.items.map((item) => (
                <li key={item.id} data-element-id={item.id}>
                  {item.label}
                </li>
              ))}
            </ol>
          )}
          <p className="output-count">{snapshot.output.count}件</p>
        </div>
      </div>
    </section>
  )
}
