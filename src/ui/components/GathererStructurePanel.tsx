import type {
  GathererElementView,
  GathererItemView,
  OperationContextView,
} from '../../domain/engine/snapshot'

/**
 * Gatherer構造の表示（v0.9 §5、Phase 7指示 §9）。
 *
 * Phase 5のCollector構造ツリーの**CSS・描画パターンのみを流用**し、Collector専用の型契約
 * （CollectorNodeView等）へGathererを押し込めない。型契約はGatherer専用contextで独立している。
 *
 * UIは確定snapshotのview値だけを描画し、結果・型・蓄積状態・表示順を独自計算しない。
 * 4構成要素の各行の文言は「教材モデル上の割当て」であり、JDK内部実装の構成を断定しない
 * （v0.9 §4末尾）。
 */

type GatherContext = Extract<OperationContextView, { kind: 'gather' }>

const ELEMENT_ROLE_LABELS: Readonly<Record<GathererElementView['name'], string>> = {
  initializer: '中間状態Aの生成',
  integrator: '要素の処理と状態更新（必須）',
  combiner: '2つの中間状態の結合',
  finisher: 'stream終端時の処理',
}

/** integratorがfalseを返す短絡と、実装済み教材の短絡（limit / takeWhile）の対比（v0.9 §4-4） */
const SHORT_CIRCUIT_NOTE =
  'Gathererのintegratorがfalseを返すと「もう要素を渡さない」のと同じ扱いになり短絡します。この教材では組み込み4種の実行だけを扱うため、この短絡は発生しません。実行して確かめられる短絡は limit / takeWhile（Pipeline側の短絡）で、Gatherer自身が短絡するかどうかとは別の仕組みです。'

/** mapConcurrentの存在と実行対象外の理由（v0.9 §2.2・§4-5） */
const MAP_CONCURRENT_NOTE =
  'Gatherers.mapConcurrent(int, Function) は仮想スレッドで最大並行度まで並行実行し、streamの順序は保持しますが、タスクのキャンセルや例外のRuntimeException再送出といった並行実行の意味論を含みます。決定的な逐次Step Engine（同一revisionから同一snapshot列）ではその意味論を正確に可視化できないため、この教材では実行対象にせず、存在と意味の説明だけを行います。'

/**
 * Oracle観測（P7-O01）の反映（v0.9 §10-3、Phase 7指示 §9）。
 * JDK内部実装を断定せず、「どのJDKで観測したか」を明示する。
 * 観測記録は artifacts/phase-7/oracle-result.md に保存されている。
 */
const OBSERVED_JDK = 'OpenJDK Temurin 25.0.3+9'

const OBSERVATION_NOTE_BY_KIND: Readonly<Record<GatherContext['gathererKind'], string>> = {
  windowFixed: `${OBSERVED_JDK}での観測では、windowFixedのintegratorはGatherer.Integrator.Greedyであり、combinerはdefaultCombiner()と同一、finisherはdefaultFinisher()とは別の実装でした（終端で残余の窓を産出するため）。これは観測結果であり、JDKの保証ではありません。`,
  windowSliding: `${OBSERVED_JDK}での観測では、windowSlidingのintegratorはGatherer.Integrator.Greedyであり、combinerはdefaultCombiner()と同一、finisherはdefaultFinisher()とは別の実装でした（終端で1窓を産出し得るため）。これは観測結果であり、JDKの保証ではありません。`,
  scan: `${OBSERVED_JDK}での観測では、scanのintegratorはGatherer.Integrator.Greedyであり、combinerはdefaultCombiner()、finisherはdefaultFinisher()と同一でした（終端での追加産出がないことと整合します）。これは観測結果であり、JDKの保証ではありません。`,
  fold: `${OBSERVED_JDK}での観測では、foldのintegratorはGatherer.Integrator.Greedyであり、combinerはdefaultCombiner()と同一、finisherはdefaultFinisher()とは別の実装でした（終端で最終値1件を産出するため）。これは観測結果であり、JDKの保証ではありません。`,
}

const FOLD_VS_REDUCE_NOTE =
  'foldは中間操作であり、Streamを返すため結果を後段へ渡せます。終端操作のreduceは結果そのものを返します。どちらも初期値（identity）から累積しますが、foldは入力0件でも初期値を1件産出するのに対し、identityなしのreduceは空Optionalを返します。'

const SCAN_VS_REDUCE_NOTE =
  'scanは累積の「途中経過」を1件ずつ産出する中間操作です。reduceは終端操作で、最後の累積結果だけを返します。'

function ItemList({
  items,
  testId,
  emptyText,
}: {
  items: readonly GathererItemView[]
  testId: string
  emptyText: string
}) {
  if (items.length === 0) {
    return (
      <p className="empty-note" data-testid={`${testId}-empty`}>
        {emptyText}
      </p>
    )
  }
  return (
    <ol className="op-context-list" data-testid={testId}>
      {items.map((item) => (
        <li key={item.id} data-element-id={item.id}>
          {item.label}
          {item.memberIds && (
            <span className="op-context-key" data-testid={`${testId}-members`}>
              メンバー: {item.memberIds.join(', ')}
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

/** 4構成要素の常設4行（v0.9 §5。行は常に4つ表示する） */
function ElementRows({ elements }: { elements: readonly GathererElementView[] }) {
  return (
    <table className="stats-table gatherer-elements" data-testid="gatherer-elements">
      <thead>
        <tr>
          <th scope="col">構成要素</th>
          <th scope="col">現在の状態 / 呼出し</th>
          <th scope="col">役割</th>
        </tr>
      </thead>
      <tbody>
        {elements.map((element) => (
          <tr key={element.name} data-testid={`gatherer-element-${element.name}`}>
            <th scope="row">
              <code>{element.name}()</code>
              <span className="op-context-key">{ELEMENT_ROLE_LABELS[element.name]}</span>
            </th>
            <td data-testid={`gatherer-element-${element.name}-state`}>
              {element.callCount === null
                ? element.stateLabel
                : `呼出し ${element.callCount}回`}
            </td>
            <td className="op-context-note">{element.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function GathererStructurePanel({ ctx }: { ctx: GatherContext }) {
  const isWindow = ctx.gathererKind === 'windowFixed' || ctx.gathererKind === 'windowSliding'
  return (
    <div
      className="op-context gatherer-structure"
      data-testid="op-context-gather"
      data-node-id={ctx.nodeId}
      data-gatherer-kind={ctx.gathererKind}
    >
      <h4>
        Gatherer構造（Gatherer&lt;T, A, R&gt;）
        <span className="badge" data-testid="gatherer-kind">
          {ctx.gathererKind}
        </span>
      </h4>
      <p className="op-context-code" data-testid="gatherer-expression">
        <code>{ctx.gathererLabel}</code>
      </p>
      {/* 型遷移。window系は要素型がListになることを強調する（v0.9 §5） */}
      <p className="op-context-label" data-testid="gatherer-type-transition">
        型遷移: {ctx.typeTransitionLabel}
        {isWindow && (
          <span className="op-context-note" data-testid="gatherer-window-type-note">
            （window系は出力要素型が {ctx.outputTypeLabel} のように List になります）
          </span>
        )}
      </p>

      <ElementRows elements={ctx.elements} />

      {isWindow ? (
        <>
          <p className="op-context-label" data-testid="gatherer-window-size">
            窓サイズ: {ctx.windowSize}
          </p>
          <p className="op-context-label">現在のバッファ（{ctx.buffer.length}件）</p>
          <ItemList
            items={ctx.buffer}
            testId="gatherer-buffer"
            emptyText="バッファは空です"
          />
          {ctx.evictedLast && (
            <p data-testid="gatherer-evicted">
              直前に除いた要素: <code>{ctx.evictedLast.label}</code>
              <span className="op-context-key">（最古を除き次を追加＝1回の状態更新）</span>
            </p>
          )}
          {ctx.unmodifiableNote && (
            <p className="op-context-note" data-testid="gatherer-unmodifiable-note">
              {ctx.unmodifiableNote}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="op-context-label" data-testid="gatherer-initial">
            初期値（Supplier）: <code>{ctx.initialLabel}</code>
          </p>
          <p data-testid="gatherer-accumulator">
            現在の累積値: <code>{ctx.accumulatorLabel ?? '未生成'}</code>
          </p>
          <p className="op-context-note" data-testid="gatherer-emit-policy">
            {ctx.gathererKind === 'scan'
              ? 'scanは累積値を更新するたびに1件ずつ後段へ放出します（逐次放出。1入力→1出力）。'
              : 'foldは処理途中では放出せず、終端で最終値1件だけを放出します（放出なし累積）。'}
          </p>
          <p className="op-context-label">累積履歴（{ctx.history.length}件）</p>
          {ctx.history.length === 0 ? (
            <p className="empty-note" data-testid="gatherer-history-empty">
              まだ累積は行われていません
            </p>
          ) : (
            <ol className="op-context-list" data-testid="gatherer-history">
              {ctx.history.map((entry) => (
                <li key={entry.seq}>
                  <span className="op-context-key">{entry.seq}</span>
                  {entry.inputLabel}
                  <span className="op-context-key">
                    {entry.beforeLabel} → {entry.afterLabel}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      <p className="op-context-label">放出済みの出力（{ctx.emittedCount}件）</p>
      <ItemList
        items={ctx.emitted}
        testId="gatherer-emitted"
        emptyText="まだ後段へ放出していません"
      />

      {ctx.finishedNote && (
        <p data-testid="gatherer-finished-note">
          finisher（終端処理）: {ctx.finishedNote}
        </p>
      )}

      <details className="gatherer-notes">
        <summary data-testid="gatherer-notes-summary">Gathererの補助説明</summary>
        <p className="op-context-note" data-testid="gatherer-short-circuit-note">
          {SHORT_CIRCUIT_NOTE}
        </p>
        <p className="op-context-note" data-testid="gatherer-mapconcurrent-note">
          {MAP_CONCURRENT_NOTE}
        </p>
        {!isWindow && (
          <p className="op-context-note" data-testid="gatherer-reduce-contrast-note">
            {ctx.gathererKind === 'fold' ? FOLD_VS_REDUCE_NOTE : SCAN_VS_REDUCE_NOTE}
          </p>
        )}
        <p className="op-context-note" data-testid="gatherer-model-note">
          上の4行は教材モデル上の割当てです。組み込みGathererがJDK内部でどの構成要素をどう実装しているかを断定するものではありません。
        </p>
        <p className="op-context-note" data-testid="gatherer-observation-note">
          {OBSERVATION_NOTE_BY_KIND[ctx.gathererKind]}
        </p>
      </details>
    </div>
  )
}
