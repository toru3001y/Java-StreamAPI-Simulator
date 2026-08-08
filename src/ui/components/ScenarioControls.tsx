import type { AppInstance } from '../appInstance'
import { UNIMPLEMENTED_OPERATIONS } from '../appInstance'
import type { SessionState } from '../../application/session'
import type { ScenarioMode } from '../../domain/scenario/scenario'
import { SCENARIO_MODE_LABELS } from '../../domain/scenario/scenario'

const ALL_MODES: readonly ScenarioMode[] = ['standard', 'midEmpty', 'emptySource']

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  source: '生成',
  intermediate: '中間',
  terminal: '終端',
  collector: 'Collector',
}

/**
 * 操作選択・シナリオ領域（§17.1、Phase 2指示 §10.1）。
 * fixtureは「固定サンプル」と表示し、AI生成とは表示しない。
 * 実行不能source（generate / 2引数iterate）と未実装操作は選択不能とし、理由を表示する。
 */
export function ScenarioControls({ app, state }: { app: AppInstance; state: SessionState }) {
  const { scenario } = state
  const currentTemplateId = scenario.pipeline.templateId
  const currentTemplate = app.templates.find((t) => t.templateId === currentTemplateId)
  const currentOperationId = currentTemplate?.targetOperationId ?? 'filter'
  const operationTemplates = app
    .templatesFor(currentOperationId)
    .filter((t) => t.executable !== false)
  const disabledOperations = app.operations.filter((op) => !op.executable)

  const onOperationChange = (operationId: string) => {
    const candidates = app.templatesFor(operationId).filter((t) => t.executable !== false)
    const template = candidates[0]
    if (!template) return
    const mode = template.supportedModes.includes('standard')
      ? 'standard'
      : (template.supportedModes[0] ?? 'standard')
    app.selectScenario(template.templateId, mode)
  }

  const onTemplateChange = (templateId: string) => {
    const template = app.templates.find((t) => t.templateId === templateId)
    if (!template || template.executable === false) return
    const mode = template.supportedModes.includes(scenario.mode)
      ? scenario.mode
      : template.supportedModes.includes('standard')
        ? 'standard'
        : (template.supportedModes[0] ?? 'standard')
    app.selectScenario(templateId, mode)
  }

  const onModeChange = (mode: ScenarioMode) => {
    app.selectScenario(currentTemplateId, mode)
  }

  const sourceCategory = app.operations.filter((op) => op.category === 'source')
  const intermediateCategory = app.operations.filter((op) => op.category === 'intermediate')

  return (
    <section
      className="panel scenario-controls"
      aria-label="シナリオ選択"
      data-snapshot-id={state.snapshot.snapshotId}
    >
      <div className="scenario-controls-row">
        <label>
          対象操作
          <select
            value={currentOperationId}
            onChange={(e) => onOperationChange(e.target.value)}
            aria-label="対象操作"
            data-testid="operation-select"
          >
            <optgroup label={CATEGORY_LABELS['source'] ?? '生成'}>
              {sourceCategory.map((op) => (
                <option
                  key={op.operationId}
                  value={op.operationId}
                  disabled={!op.executable}
                  title={op.disabledReason ?? undefined}
                >
                  {op.displayName}
                  {!op.executable ? '（実行不能）' : ''}
                </option>
              ))}
            </optgroup>
            <optgroup label={CATEGORY_LABELS['intermediate'] ?? '中間'}>
              {intermediateCategory.map((op) => (
                <option key={op.operationId} value={op.operationId}>
                  {op.displayName}
                </option>
              ))}
            </optgroup>
            <optgroup label="未実装（Phase 3以降）">
              {UNIMPLEMENTED_OPERATIONS.map((op) => (
                <option key={op.name} value={`unimplemented-${op.name}`} disabled>
                  {op.name}（Phase {op.phase}で実装予定）
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label>
          教材Pipeline
          <select
            value={currentTemplateId}
            onChange={(e) => onTemplateChange(e.target.value)}
            aria-label="教材Pipelineテンプレート"
            data-testid="template-select"
          >
            {operationTemplates.map((t) => (
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
            data-testid="mode-select"
          >
            {ALL_MODES.map((mode) => {
              const supported = currentTemplate?.supportedModes.includes(mode) ?? false
              return (
                <option
                  key={mode}
                  value={mode}
                  disabled={!supported}
                  title={supported ? undefined : 'このtemplateでは教材として成立しないため提供されません'}
                >
                  {SCENARIO_MODE_LABELS[mode]}
                  {supported ? '' : '（提供なし）'}
                </option>
              )
            })}
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
      {disabledOperations.length > 0 && (
        <ul className="disabled-operation-notes" data-testid="disabled-operation-notes">
          {disabledOperations.map((op) => (
            <li key={op.operationId}>
              {op.displayName}: {op.disabledReason}
            </li>
          ))}
        </ul>
      )}
      <p className="scenario-description">
        {scenario.title} — {scenario.description}
      </p>
    </section>
  )
}
