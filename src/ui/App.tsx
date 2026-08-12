import { useMemo, useSyncExternalStore } from 'react'
import type { AppInstance } from './appInstance'
import { createApp } from './appInstance'
import { ScenarioControls } from './components/ScenarioControls'
import { ImportPanel } from './components/ImportPanel'
import { PipelineViewport } from './components/PipelineViewport'
import { MainSimulation } from './components/MainSimulation'
import { SideEffectPanel } from './components/SideEffectPanel'
import { JavaCodePanel } from './components/JavaCodePanel'
import { ExplanationPanel } from './components/ExplanationPanel'
import { DetailsDisclosure } from './components/DetailsDisclosure'
import { StickyPlaybackBar } from './components/StickyPlaybackBar'

/**
 * 画面全体（§17.1）。PCではPipeline、全幅の入力 → 処理中 → 出力、
 * 下段のJavaコード / 説明、sticky操作バーを仕様順に配置する。
 */
export function App({ app: injectedApp }: { app?: AppInstance }) {
  const defaultApp = useMemo(() => (injectedApp ? null : createApp()), [injectedApp])
  const app = injectedApp ?? defaultApp
  if (!app) throw new Error('AppInstanceを初期化できませんでした')
  const state = useSyncExternalStore(
    (listener) => app.session.subscribe(listener),
    () => app.session.getState(),
  )

  return (
    <div className="app-root">
      <header className="app-header">
        <h1>Java Stream API 可視化シミュレーター</h1>
        <p className="app-subtitle">Phase 6: 手動連携による候補の取込（Java SE 25基準）</p>
      </header>
      <main className="app-main">
        <ScenarioControls app={app} state={state} />
        <ImportPanel app={app} state={state} />
        <PipelineViewport state={state} />
        <MainSimulation state={state} />
        <SideEffectPanel state={state} />
        <div className="bottom-panels">
          <JavaCodePanel state={state} />
          <ExplanationPanel state={state} />
        </div>
        <DetailsDisclosure state={state} />
      </main>
      <StickyPlaybackBar app={app} state={state} />
    </div>
  )
}
