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

/** provider種別（v0.10 §4.1）。FIXTURE = 固定サンプル、IMPORTED = 取込サンプル。 */
export type ProviderKind = 'FIXTURE' | 'IMPORTED'

/** ScenarioCandidate（§10.3、v0.10 §4.1で種別を変更） */
export interface ScenarioCandidate {
  readonly providerKind: ProviderKind
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

/**
 * ScenarioProvider境界はfixture用契約として存続する（v0.10 §3.2）。
 * 取込経路（Candidate Import）はpush型のためこのinterfaceを実装しない。
 */
export interface ScenarioProvider {
  capability(): ProviderCapability
  generate(request: GenerateRequest): ScenarioCandidate
}
