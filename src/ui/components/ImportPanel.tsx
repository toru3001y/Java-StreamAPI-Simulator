import { useState } from 'react'
import type { AppInstance } from '../appInstance'
import type { SessionState } from '../../application/session'
import type { ValidationIssue } from '../../domain/types/result'

/**
 * 取込UI（v0.10 §8、Phase 6指示 §9）。
 *
 * 「プロンプトをコピー」「候補を貼り付け」の2操作、検証失敗理由の表示を担う。
 * v0.10 §8が許す2形式（`<details>`折りたたみ / 常設パネル）のうち**常設パネル**を採る。
 * `<details>`にすると`<summary>`が2つになり、既存P1-E08（`locator('summary')`）の
 * 意味を変えずには通らなくなるため、Phase 1〜5テストへ影響しないパネル形式を選択した。
 * モーダルダイアログは使用しない。
 *
 * 貼付テキスト・開閉状態・コピー成否フィードバックはUI一時状態であり、
 * snapshot履歴の復元対象にしない（`useState`で保持する）。
 * 結果はUIで独自計算せず、Application層が返す`Result`をそのまま表示する。
 */

type CopyState =
  | { readonly status: 'idle' }
  | { readonly status: 'copied' }
  | { readonly status: 'fallback'; readonly text: string }

type ImportState =
  | { readonly status: 'idle' }
  | { readonly status: 'accepted'; readonly title: string }
  | { readonly status: 'rejected'; readonly issues: readonly ValidationIssue[] }

export function ImportPanel({ app, state }: { app: AppInstance; state: SessionState }) {
  const [pastedText, setPastedText] = useState('')
  const [copyState, setCopyState] = useState<CopyState>({ status: 'idle' })
  const [importState, setImportState] = useState<ImportState>({ status: 'idle' })

  const templateId = state.scenario.pipeline.templateId
  const mode = state.scenario.mode
  const importability = app.importabilityOf(templateId)
  const disabled = !importability.importable

  const onCopy = async () => {
    setImportState({ status: 'idle' })
    const prompt = app.generatePrompt(templateId, mode)
    if (!prompt.ok) {
      setCopyState({ status: 'fallback', text: prompt.issues.map((i) => i.message).join('\n') })
      return
    }
    try {
      await navigator.clipboard.writeText(prompt.value)
      setCopyState({ status: 'copied' })
    } catch {
      // クリップボードが使えない環境では全文を選択可能なテキストとして表示する（v0.10 §5.2）
      setCopyState({ status: 'fallback', text: prompt.value })
    }
  }

  const onImport = () => {
    setCopyState({ status: 'idle' })
    const result = app.importCandidate(templateId, mode, pastedText)
    if (result.ok) {
      setImportState({ status: 'accepted', title: result.value.title })
      return
    }
    setImportState({ status: 'rejected', issues: result.issues })
  }

  return (
    <section
      className="panel import-panel"
      aria-label="候補の取込"
      data-testid="import-panel"
      data-snapshot-id={state.snapshot.snapshotId}
    >
      <h3>候補の取込（プロンプト生成と貼り付け）</h3>
      <div className="import-body">
        <p className="import-lead">
          「プロンプトをコピー」で生成依頼文をコピーし、任意のAIチャット（または手書き）で作った候補JSONを下の欄へ貼り付けます。
          検証に合格した候補だけが「取込サンプル」として実行されます。
        </p>
        {disabled && (
          <p className="import-disabled-reason" data-testid="import-disabled-reason">
            × このtemplateは取込対象外です: {importability.reason}
          </p>
        )}
        <div className="import-actions">
          <button
            type="button"
            onClick={onCopy}
            disabled={disabled}
            data-testid="copy-prompt-button"
          >
            プロンプトをコピー
          </button>
          <button
            type="button"
            onClick={onImport}
            disabled={disabled}
            data-testid="import-button"
          >
            候補を貼り付け
          </button>
        </div>
        <label className="import-textarea-label">
          候補JSON
          <textarea
            value={pastedText}
            onChange={(event) => setPastedText(event.target.value)}
            disabled={disabled}
            rows={6}
            spellCheck={false}
            data-testid="import-textarea"
            aria-label="候補JSON"
          />
        </label>
        <div className="import-feedback" aria-live="polite" data-testid="import-feedback">
          {copyState.status === 'copied' && (
            <p className="import-ok" data-testid="copy-feedback">
              ✓ プロンプトをクリップボードへコピーしました。
            </p>
          )}
          {copyState.status === 'fallback' && (
            <div data-testid="copy-fallback">
              <p className="import-warn">
                ! クリップボードへコピーできませんでした。下のテキストを選択してコピーしてください。
              </p>
              <textarea
                className="import-fallback-text"
                readOnly
                rows={8}
                value={copyState.text}
                data-testid="copy-fallback-text"
                aria-label="プロンプト全文"
              />
            </div>
          )}
          {importState.status === 'accepted' && (
            <p className="import-ok" data-testid="import-accepted">
              ✓ 取込サンプルとして実行を開始しました: {importState.title}
            </p>
          )}
          {importState.status === 'rejected' && (
            <div data-testid="import-issues">
              <p className="import-error">
                × 取込できませんでした（{importState.issues.length}件）。現在のシナリオは変更していません。
              </p>
              <ul className="import-issue-list">
                {importState.issues.map((issue, index) => (
                  <li key={`${issue.code}-${issue.path}-${index}`}>
                    <code>{issue.code}</code>
                    {issue.path ? <code className="import-issue-path">{issue.path}</code> : null}
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
