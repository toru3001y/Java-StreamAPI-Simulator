import type { DatasetElement } from '../domain/model/employee'
import type { OperationId, ScenarioRevision, SlotId, TemplateId } from '../domain/types/ids'
import type { ScenarioMode, ScenarioProvenance } from '../domain/scenario/scenario'

/**
 * ScenarioProvider境界（§10）。
 * Providerが返すのは検証前の候補データであり、snapshot、途中状態、期待結果、Javaコード全文ではない。
 */
export interface ProviderCapability {
  readonly available: boolean
  /** 利用不能時の理由。UIのdisabled状態と一致させる（§10.5） */
  readonly reason: string | null
}

/** GenerateRequest（§10.2） */
export interface GenerateRequest {
  readonly targetOperationId: OperationId
  readonly mode: ScenarioMode
  readonly allowedTemplateIds: readonly TemplateId[]
  readonly templateId: TemplateId
  readonly dslVersion: string
  /** 現在のscenario revision（§10.2）。Providerは これと異なる新しいrevisionを発行する。初回はnull。 */
  readonly currentScenarioRevision: ScenarioRevision | null
}

/** ScenarioCandidate（§10.3） */
export interface ScenarioCandidate {
  readonly providerKind: 'FIXTURE' | 'AI'
  readonly templateId: TemplateId
  readonly templateVersion: number
  readonly mode: ScenarioMode
  readonly dataset: readonly DatasetElement[]
  readonly dslParameters: Readonly<Record<SlotId, unknown>>
  readonly title: string
  readonly description: string
  readonly provenance: ScenarioProvenance
  readonly revision: ScenarioRevision
}

export interface ScenarioProvider {
  capability(): ProviderCapability
  generate(request: GenerateRequest): ScenarioCandidate
}

/**
 * AI providerはPhase 6まで利用不能（§21.4）。
 * ボタンのdisabled状態とこの理由を一致させ、fixtureへ自動フォールバックしない（§10.5）。
 */
export const AI_CAPABILITY: ProviderCapability = {
  available: false,
  reason: 'AI生成はPhase 6で提供予定のため、現在は利用できません。固定サンプルをご利用ください。',
}
