import type { Scenario } from '../domain/scenario/scenario'
import type { Snapshot } from '../domain/engine/snapshot'
import {
  createInitialSnapshot,
  EngineInvariantError,
  nextSnapshot,
} from '../domain/engine/stepEngine'

/**
 * SimulationSession（§12.1、§18）。
 * 履歴cursor、自動再生、停止・再開を管理する。操作固有の意味論は持たない（§5.2）。
 */
export type PlaybackState =
  | 'READY'
  | 'PLAYING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'LIMIT_REACHED'
  | 'ERROR'

/** 自動再生間隔は1000ms固定（§12.1）。速度変更UIは作らない。 */
export const INTERVAL_MS = 1000
/** 初期snapshotを含め最大500件（§12.7） */
export const SNAPSHOT_LIMIT = 500

/**
 * タイマー抽象。Simulation Coreはタイマーへ依存せず、Application層だけが使用する。
 * setTimeoutを都度張り直す方式のため、遅延時も複数snapshotをまとめて追い越さない（§13.3）。
 */
export interface Scheduler {
  schedule(callback: () => void, ms: number): unknown
  cancel(handle: unknown): void
}

export function createTimeoutScheduler(): Scheduler {
  return {
    schedule: (callback, ms) => globalThis.setTimeout(callback, ms),
    cancel: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
}

export interface SessionState {
  readonly scenario: Scenario
  readonly snapshot: Snapshot
  readonly cursor: number
  readonly historyLength: number
  readonly playbackState: PlaybackState
  /** LIMIT_REACHED / ERROR の停止理由。UIへ表示する（§12.7、J-3） */
  readonly stopReason: string | null
}

export class SimulationSession {
  private scenario: Scenario
  private history: Snapshot[]
  private cursor = 0
  private playbackState: PlaybackState = 'READY'
  private stopReason: string | null = null
  private timerHandle: unknown = null
  private readonly scheduler: Scheduler
  private readonly snapshotLimit: number
  private readonly listeners = new Set<() => void>()
  private cachedState: SessionState | null = null

  constructor(scenario: Scenario, scheduler: Scheduler, snapshotLimit: number = SNAPSHOT_LIMIT) {
    this.scenario = scenario
    this.scheduler = scheduler
    this.snapshotLimit = snapshotLimit
    this.history = [createInitialSnapshot(scenario.pipeline)]
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState(): SessionState {
    if (!this.cachedState) {
      const snapshot = this.history[this.cursor]
      if (!snapshot) throw new Error(`cursor ${this.cursor} が履歴の範囲外です`)
      this.cachedState = {
        scenario: this.scenario,
        snapshot,
        cursor: this.cursor,
        historyLength: this.history.length,
        playbackState: this.playbackState,
        stopReason: this.stopReason,
      }
    }
    return this.cachedState
  }

  private notify(): void {
    this.cachedState = null
    for (const listener of this.listeners) listener()
  }

  private cancelTimer(): void {
    if (this.timerHandle !== null) {
      this.scheduler.cancel(this.timerHandle)
      this.timerHandle = null
    }
  }

  /** 手動navigation後の受動状態を導出する */
  private derivePassiveState(): PlaybackState {
    const current = this.history[this.cursor]
    if (this.cursor === 0) return 'READY'
    if (current && current.completion === 'STREAM_CONSUMED') return 'COMPLETED'
    return 'PAUSED'
  }

  /**
   * 次の確定snapshotを1件だけ進める（§18 進む）。
   * 戻った後の進むは、既存historyがある限り保存済みsnapshotを再利用する（§22.2）。
   */
  private stepForwardOnce(fromAuto: boolean): void {
    if (this.playbackState === 'ERROR') return
    if (this.cursor < this.history.length - 1) {
      this.cursor += 1
      if (!fromAuto) this.playbackState = this.derivePassiveState()
      else if (this.atConsumedEnd()) this.finishAuto('COMPLETED')
      this.notify()
      return
    }
    const current = this.history[this.cursor]
    if (!current) throw new Error(`cursor ${this.cursor} が履歴の範囲外です`)
    if (current.completion === 'STREAM_CONSUMED') {
      this.playbackState = 'COMPLETED'
      this.cancelTimer()
      this.notify()
      return
    }
    // 501件目を作成せず、500件目を保持したままLIMIT_REACHEDへ遷移する（§12.7）
    if (this.history.length >= this.snapshotLimit) {
      this.playbackState = 'LIMIT_REACHED'
      this.stopReason = `安全上限（${this.snapshotLimit} snapshot）に達したため停止しました。これ以上は進めません。`
      this.cancelTimer()
      this.notify()
      return
    }
    try {
      const next = nextSnapshot(this.scenario.pipeline, current)
      if (next === null) {
        this.playbackState = 'COMPLETED'
        this.cancelTimer()
        this.notify()
        return
      }
      this.history.push(next)
      this.cursor += 1
      if (next.completion === 'STREAM_CONSUMED') {
        this.finishAuto('COMPLETED')
      } else if (!fromAuto) {
        this.playbackState = this.derivePassiveState()
      }
      this.notify()
    } catch (e) {
      // J-3: エンジン内部の不整合検知時のフェイルセーフ。
      // タイマーを解除し、最後の確定snapshotとhistoryを保持したままERRORへ遷移する。
      if (e instanceof EngineInvariantError) {
        this.playbackState = 'ERROR'
        this.stopReason = `エンジン内部の不整合を検知したため停止しました: ${e.message}`
        this.cancelTimer()
        this.notify()
        return
      }
      throw e
    }
  }

  private atConsumedEnd(): boolean {
    const current = this.history[this.cursor]
    return (
      this.cursor === this.history.length - 1 &&
      current !== undefined &&
      current.completion === 'STREAM_CONSUMED'
    )
  }

  private finishAuto(state: PlaybackState): void {
    this.playbackState = state
    this.cancelTimer()
  }

  stepForward(): void {
    if (this.playbackState === 'PLAYING') return
    this.stepForwardOnce(false)
  }

  /** 戻る: 再計算せず、保存済みsnapshotへcursorを移す（§18）。 */
  stepBack(): void {
    if (this.playbackState === 'ERROR') return
    if (this.playbackState === 'PLAYING') return
    if (this.cursor === 0) return
    this.cursor -= 1
    this.playbackState = this.derivePassiveState()
    if (this.playbackState !== 'ERROR') this.stopReason = null
    this.notify()
  }

  /** 最初から: scenarioとrevisionを維持し、初期snapshotへ戻す（§18）。 */
  restart(): void {
    this.cancelTimer()
    this.cursor = 0
    this.playbackState = 'READY'
    this.stopReason = null
    this.notify()
  }

  /** 自動: 現在位置の次から1000msごとに1 snapshot進む（§13.3）。 */
  play(): void {
    if (
      this.playbackState === 'PLAYING' ||
      this.playbackState === 'ERROR' ||
      this.playbackState === 'LIMIT_REACHED'
    ) {
      return
    }
    if (this.atConsumedEnd()) {
      this.playbackState = 'COMPLETED'
      this.notify()
      return
    }
    this.playbackState = 'PLAYING'
    this.scheduleTick()
    this.notify()
  }

  private scheduleTick(): void {
    this.timerHandle = this.scheduler.schedule(() => {
      this.timerHandle = null
      if (this.playbackState !== 'PLAYING') return
      this.stepForwardOnce(true)
      if (this.playbackState === 'PLAYING') {
        this.scheduleTick()
      }
    }, INTERVAL_MS)
  }

  /** 停止: タイマーを解除し、最後の確定snapshotとcursorを保持する（§18）。 */
  stop(): void {
    if (this.playbackState !== 'PLAYING') return
    this.cancelTimer()
    this.playbackState = this.derivePassiveState()
    this.notify()
  }

  /** シナリオ切替: タイマー停止、新revisionでhistoryとcursorを初期化（§18）。 */
  switchScenario(scenario: Scenario): void {
    this.cancelTimer()
    this.scenario = scenario
    this.history = [createInitialSnapshot(scenario.pipeline)]
    this.cursor = 0
    this.playbackState = 'READY'
    this.stopReason = null
    this.notify()
  }
}
