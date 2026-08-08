import type { SessionState } from '../../application/session'

/** ExplanationPanel（§17.1）: 値、式、判定、次の動作、JDK補足。 */
export function ExplanationPanel({ state }: { state: SessionState }) {
  const { snapshot } = state
  return (
    <section
      className="panel explanation-panel"
      aria-label="説明"
      data-snapshot-id={snapshot.snapshotId}
      data-testid="explanation-panel"
    >
      <h3>説明</h3>
      <p className="explanation-current" data-testid="explanation-current" aria-live="polite">
        {snapshot.explanation.current}
      </p>
      <p className="explanation-next" data-testid="explanation-next">
        {snapshot.explanation.next}
      </p>
      {snapshot.explanation.jdkNote && (
        <p className="explanation-jdk" data-testid="explanation-jdk">
          JDK補足: {snapshot.explanation.jdkNote}
        </p>
      )}
    </section>
  )
}
