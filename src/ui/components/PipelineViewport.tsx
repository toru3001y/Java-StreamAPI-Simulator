import { useEffect, useRef } from 'react'
import type { SessionState } from '../../application/session'
import { formatTypeRef } from '../../domain/types/typeRef'
import { mapperToJavaExpr, predicateToJavaExpr } from '../../domain/dsl/javaCode'
import { usePrefersReducedMotion } from '../usePrefersReducedMotion'

const ROLE_LABELS = { source: '生成', intermediate: '中間', terminal: '終端' } as const

/**
 * PipelineViewport（§17.2）。
 * ノード・型ラベル・性質バッジを左詰め・1行・非折返しで表示し、
 * 長い場合はPipeline専用の横スクロールとする。active node変更時は可視位置へ追従する。
 */
export function PipelineViewport({ state }: { state: SessionState }) {
  const { snapshot, scenario } = state
  const containerRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    // DOMスクロール位置はsnapshotのactive nodeから導出する（§13.1）。
    // scroll進捗自体はUI一時状態であり、snapshotへは保存しない（§18）。
    activeRef.current?.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      inline: 'nearest',
      block: 'nearest',
    })
  }, [snapshot.activeNodeId, reducedMotion])

  return (
    <section
      className="panel pipeline-viewport"
      aria-label="Pipeline"
      data-snapshot-id={snapshot.snapshotId}
      data-testid="pipeline-viewport"
    >
      <div className="pipeline-scroll" ref={containerRef} data-testid="pipeline-scroll">
        <div className="pipeline-track">
          {scenario.pipeline.nodes.map((node) => {
            const isActive = node.nodeId === snapshot.activeNodeId
            return (
              <div className="pipeline-item" key={node.nodeId}>
                <div
                  className={`pipeline-node${isActive ? ' active' : ''}`}
                  data-node-id={node.nodeId}
                  data-active={isActive || undefined}
                  ref={isActive ? activeRef : undefined}
                  aria-current={isActive ? 'step' : undefined}
                >
                  <span className="node-name">{node.displayName}</span>
                  {node.predicate && (
                    <code className="node-predicate">{predicateToJavaExpr(node.predicate)}</code>
                  )}
                  {node.mapper && (
                    <code className="node-predicate">{mapperToJavaExpr(node.mapper)}</code>
                  )}
                  <span className="node-badges">
                    <span className="badge badge-role">{ROLE_LABELS[node.role]}</span>
                    {node.traits.map((trait) => (
                      <span className="badge" key={trait}>
                        {trait}
                      </span>
                    ))}
                  </span>
                </div>
                {/* 視覚フロー・型遷移はUnicode矢印を使用する（§17.4） */}
                <span className="pipeline-arrow" aria-hidden="true">
                  →
                </span>
                <span className="pipeline-type">{formatTypeRef(node.outputType)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
