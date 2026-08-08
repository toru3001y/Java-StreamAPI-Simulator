import type { AppInstance } from '../appInstance'
import type { SessionState } from '../../application/session'

const PLAYBACK_LABELS: Readonly<Record<SessionState['playbackState'], string>> = {
  READY: '準備完了',
  PLAYING: '自動再生中',
  PAUSED: '一時停止',
  COMPLETED: '完了',
  LIMIT_REACHED: '安全上限到達',
  ERROR: 'エラー',
}

/**
 * StickyPlaybackBar（§17.1、§18）:
 * 最初から / 戻る / 進む / 自動・停止、現在位置、停止理由。
 */
export function StickyPlaybackBar({ app, state }: { app: AppInstance; state: SessionState }) {
  const { snapshot, cursor, historyLength, playbackState, stopReason, scenario } = state
  const session = app.session
  const atConsumedEnd =
    cursor === historyLength - 1 && snapshot.completion === 'STREAM_CONSUMED'

  const disableRestart = playbackState === 'PLAYING' || (cursor === 0 && playbackState !== 'ERROR')
  const disableBack = playbackState === 'PLAYING' || playbackState === 'ERROR' || cursor === 0
  const disableForward =
    playbackState === 'PLAYING' ||
    playbackState === 'ERROR' ||
    playbackState === 'LIMIT_REACHED' ||
    atConsumedEnd
  const disablePlay = disableForward
  const disableStop = playbackState !== 'PLAYING'

  return (
    <div className="sticky-playback-bar" role="toolbar" aria-label="再生操作">
      <div className="playback-buttons">
        <button type="button" onClick={() => session.restart()} disabled={disableRestart}>
          最初から
        </button>
        <button type="button" onClick={() => session.stepBack()} disabled={disableBack}>
          戻る
        </button>
        <button type="button" onClick={() => session.stepForward()} disabled={disableForward}>
          進む
        </button>
        <button type="button" onClick={() => session.play()} disabled={disablePlay}>
          自動
        </button>
        <button type="button" onClick={() => session.stop()} disabled={disableStop}>
          停止
        </button>
      </div>
      <div className="playback-status">
        <span data-testid="playback-position">
          snapshot {cursor + 1} / 全{scenario.pipeline.snapshotCount}
        </span>
        <span data-testid="playback-state" data-state={playbackState}>
          {PLAYBACK_LABELS[playbackState]}
        </span>
        {stopReason && (
          <span className="stop-reason" data-testid="stop-reason" role="status">
            {stopReason}
          </span>
        )}
      </div>
    </div>
  )
}
