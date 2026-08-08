import type { AppInstance } from '../appInstance'
import type { SessionState } from '../../application/session'
import type { ScenarioMode } from '../../domain/scenario/scenario'
import { SCENARIO_MODE_LABELS } from '../../domain/scenario/scenario'

const ALL_MODES: readonly ScenarioMode[] = ['standard', 'midEmpty', 'emptySource']

/** 操作選択・シナリオ領域（§17.1）。fixtureは「固定サンプル」と表示し、AI生成とは表示しない。 */
export function ScenarioControls({ app, state }: { app: AppInstance; state: SessionState }) {
  const { scenario } = state
  const currentTemplateId = scenario.pipeline.templateId
  const currentTemplate = app.templates.find((t) => t.templateId === currentTemplateId)

  const onTemplateChange = (templateId: string) => {
    const template = app.templates.find((t) => t.templateId === templateId)
    if (!template) return
    const mode = template.supportedModes.includes(scenario.mode)
      ? scenario.mode
      : (template.supportedModes[0] ?? 'standard')
    app.selectScenario(templateId, mode)
  }

  const onModeChange = (mode: ScenarioMode) => {
    app.selectScenario(currentTemplateId, mode)
  }

  return (
    <section
      className="panel scenario-controls"
      aria-label="シナリオ選択"
      data-snapshot-id={state.snapshot.snapshotId}
    >
      <div className="scenario-controls-row">
        <label>
          対象操作
          <select value="filter" disabled aria-label="対象操作（Phase 1はfilterのみ）">
            <option value="filter">filter（中間操作）</option>
          </select>
        </label>
        <label>
          教材Pipeline
          <select
            value={currentTemplateId}
            onChange={(e) => onTemplateChange(e.target.value)}
            aria-label="教材Pipelineテンプレート"
          >
            {app.templates.map((t) => (
              <option key={t.templateId} value={t.templateId}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          シナリオモード
          <select
            value={scenario.mode}
            onChange={(e) => onModeChange(e.target.value as ScenarioMode)}
            aria-label="シナリオモード"
          >
            {ALL_MODES.map((mode) => (
              <option
                key={mode}
                value={mode}
                disabled={!currentTemplate?.supportedModes.includes(mode)}
              >
                {SCENARIO_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </label>
        <span className="provenance-badge" data-testid="provenance">
          {scenario.provenance.providerKind === 'FIXTURE' ? '固定サンプル' : 'AI生成'}
        </span>
        <div className="ai-control">
          <button
            type="button"
            disabled={!app.aiCapability.available}
            aria-describedby="ai-unavailable-reason"
            data-testid="ai-button"
          >
            AIで別サンプル
          </button>
          {!app.aiCapability.available && (
            <p id="ai-unavailable-reason" className="ai-reason" data-testid="ai-reason">
              {app.aiCapability.reason}
            </p>
          )}
        </div>
      </div>
      <p className="scenario-description">
        {scenario.title} — {scenario.description}
      </p>
    </section>
  )
}
