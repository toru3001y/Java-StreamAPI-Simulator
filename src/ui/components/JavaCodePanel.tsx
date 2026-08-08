import type { SessionState } from '../../application/session'

/**
 * JavaCodePanel（§17.1）。
 * DSLから生成したJavaコードを常時表示し、active nodeに対応するline IDだけを強調する。
 */
export function JavaCodePanel({ state }: { state: SessionState }) {
  const { snapshot, scenario } = state
  return (
    <section
      className="panel java-code-panel"
      aria-label="Javaコード"
      data-snapshot-id={snapshot.snapshotId}
      data-testid="java-code-panel"
    >
      <h3>Javaコード</h3>
      <pre className="java-code">
        {scenario.pipeline.javaCode.map((line) => {
          const isActive = line.lineId === snapshot.activeLineId
          return (
            <code
              key={line.lineId}
              className={`code-line${isActive ? ' active' : ''}`}
              data-line-id={line.lineId}
              data-active={isActive || undefined}
              aria-current={isActive ? 'true' : undefined}
            >
              {line.text || ' '}
              {'\n'}
            </code>
          )
        })}
      </pre>
    </section>
  )
}
