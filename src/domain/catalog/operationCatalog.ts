import type { TypeRef } from '../types/typeRef'
import type { OperationId } from '../types/ids'
import { listOf } from '../types/typeRef'

/**
 * OperationCatalog（Draft v0.8 §7）。
 * 各操作の意味論と表示メタデータを一元管理する。TemplateやAI候補はtraitsを上書きできない。
 */
export type OperationCategory = 'source' | 'intermediate' | 'terminal' | 'collector'

export type OperationTrait =
  | 'INTERMEDIATE'
  | 'TERMINAL'
  | 'STATELESS'
  | 'STATEFUL'
  | 'SHORT_CIRCUITING'

export type ElementStateKind =
  | 'UNEVALUATED'
  | 'PROCESSING'
  | 'PASSED'
  | 'REJECTED'
  | 'BUFFERED'

/** TypeRefの入出力規則（§7）。宣言的に保持し、resolveTypeRuleで解決する。 */
export type TypeRule =
  | { readonly kind: 'none' }
  | { readonly kind: 'fixed'; readonly type: TypeRef }
  | { readonly kind: 'anyStream' }
  | { readonly kind: 'identity' }
  | { readonly kind: 'streamToList' }

export interface OperationDefinition {
  readonly operationId: OperationId
  readonly category: OperationCategory
  readonly traits: readonly OperationTrait[]
  readonly inputTypeRule: TypeRule
  readonly outputTypeRule: TypeRule
  readonly handlerId: string
  readonly visualizationKind: string
  readonly legendStates: readonly ElementStateKind[]
  readonly jdkNotes: readonly string[]
  readonly sourceRefs: readonly string[]
  readonly displayName: string
}

export class OperationCatalog {
  private readonly defs = new Map<OperationId, OperationDefinition>()

  register(def: OperationDefinition): void {
    if (this.defs.has(def.operationId)) {
      throw new Error(`operationId duplicated: ${def.operationId}`)
    }
    this.defs.set(def.operationId, Object.freeze(def))
  }

  get(operationId: OperationId): OperationDefinition {
    const def = this.defs.get(operationId)
    if (!def) throw new Error(`unknown operationId: ${operationId}`)
    return def
  }

  has(operationId: OperationId): boolean {
    return this.defs.has(operationId)
  }

  list(): readonly OperationDefinition[] {
    return [...this.defs.values()]
  }
}

/** 入力型からTypeRuleに従い出力型を解決する。 */
export function resolveTypeRule(rule: TypeRule, inputType: TypeRef | null): TypeRef {
  switch (rule.kind) {
    case 'fixed':
      return rule.type
    case 'identity':
      if (!inputType) throw new Error('identity rule requires input type')
      return inputType
    case 'streamToList':
      if (!inputType || inputType.kind !== 'stream') {
        throw new Error('streamToList rule requires Stream input')
      }
      return listOf(inputType.elementType)
    case 'anyStream':
    case 'none':
      throw new Error(`rule ${rule.kind} does not produce an output type`)
  }
}
