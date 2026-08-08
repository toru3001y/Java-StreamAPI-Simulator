import { OperationCatalog } from './operationCatalog'
import { streamOf, TYPE_EMPLOYEE } from '../types/typeRef'

/**
 * Phase 1の最小Operation Catalog（§21.2）。
 * source と toList は縦断fixtureに必要な最小実装のみ（§21.4）。
 */
export const OP_SOURCE_COLLECTION_STREAM = 'source.collectionStream'
export const OP_FILTER = 'filter'
export const OP_TO_LIST = 'toList'

export function createDefaultCatalog(): OperationCatalog {
  const catalog = new OperationCatalog()

  catalog.register({
    operationId: OP_SOURCE_COLLECTION_STREAM,
    category: 'source',
    traits: [],
    inputTypeRule: { kind: 'none' },
    outputTypeRule: { kind: 'fixed', type: streamOf(TYPE_EMPLOYEE) },
    handlerId: 'handler.source.collectionStream',
    visualizationKind: '生成元型',
    legendStates: ['UNEVALUATED', 'PROCESSING', 'PASSED'],
    jdkNotes: ['既存Collectionから1要素ずつ送出する（遅延評価）。'],
    sourceRefs: ['JDK25-STREAM-PKG'],
    displayName: 'stream()',
  })

  catalog.register({
    operationId: OP_FILTER,
    category: 'intermediate',
    traits: ['INTERMEDIATE', 'STATELESS'],
    inputTypeRule: { kind: 'anyStream' },
    outputTypeRule: { kind: 'identity' },
    handlerId: 'handler.filter',
    visualizationKind: '通過判定型',
    // filterで発生し得る4状態のみ。「□ バッファ済み」は含めない（§22.3）
    legendStates: ['UNEVALUATED', 'PROCESSING', 'PASSED', 'REJECTED'],
    jdkNotes: ['filterは中間操作であり、終端操作が実行されるまで評価されない（遅延評価）。'],
    sourceRefs: ['JDK25-STREAM'],
    displayName: 'filter',
  })

  catalog.register({
    operationId: OP_TO_LIST,
    category: 'terminal',
    traits: ['TERMINAL'],
    inputTypeRule: { kind: 'anyStream' },
    outputTypeRule: { kind: 'streamToList' },
    handlerId: 'handler.toList',
    visualizationKind: '結果化型',
    legendStates: ['UNEVALUATED', 'PROCESSING', 'PASSED'],
    jdkNotes: ['Stream.toList()が返すListはunmodifiableである。'],
    sourceRefs: ['JDK25-STREAM'],
    displayName: 'toList()',
  })

  return catalog
}
