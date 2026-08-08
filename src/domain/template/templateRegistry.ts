import type { PipelineTemplate } from './pipelineTemplate'
import type { OperationId, TemplateId } from '../types/ids'
import { deepFreeze } from '../util/deepFreeze'

/**
 * TemplateRegistry（§21.2）。
 * 同一のtarget operationへ複数のtemplateを登録・取得できる。
 */
export class TemplateRegistry {
  private readonly byId = new Map<string, PipelineTemplate>()
  private readonly byTarget = new Map<OperationId, PipelineTemplate[]>()

  private static key(templateId: TemplateId, version: number): string {
    return `${templateId}@${version}`
  }

  register(template: PipelineTemplate): void {
    const key = TemplateRegistry.key(template.templateId, template.version)
    if (this.byId.has(key)) {
      throw new Error(`template duplicated: ${key}`)
    }
    const frozen = deepFreeze(template)
    this.byId.set(key, frozen)
    const list = this.byTarget.get(template.targetOperationId) ?? []
    list.push(frozen)
    this.byTarget.set(template.targetOperationId, list)
  }

  get(templateId: TemplateId, version: number): PipelineTemplate | null {
    return this.byId.get(TemplateRegistry.key(templateId, version)) ?? null
  }

  /** 指定templateIdの登録有無（version不問） */
  hasTemplateId(templateId: TemplateId): boolean {
    return [...this.byId.values()].some((t) => t.templateId === templateId)
  }

  listByTargetOperation(operationId: OperationId): readonly PipelineTemplate[] {
    return this.byTarget.get(operationId) ?? []
  }

  listAll(): readonly PipelineTemplate[] {
    return [...this.byId.values()]
  }
}
