import { OperationCatalog } from './operationCatalog'
import type { OperationDefinition } from './operationCatalog'

/**
 * Phase 2までのOperation Catalog（Draft v0.8 §7、Phase 2指示 §5）。
 * Phase 3以降の操作（distinct / sorted / limit / skip / takeWhile / dropWhile / peek、
 * 各種終端、Collector）は登録しない。
 */

// ---- source（§5.1） ----
export const OP_SOURCE_COLLECTION_STREAM = 'source.collectionStream'
export const OP_SOURCE_ARRAYS_STREAM = 'source.arraysStream'
export const OP_SOURCE_STREAM_OF = 'source.streamOf'
export const OP_SOURCE_GENERATE = 'source.generate'
export const OP_SOURCE_ITERATE2 = 'source.iterate2'
export const OP_SOURCE_ITERATE3 = 'source.iterate3'
export const OP_SOURCE_RANGE = 'source.range'
export const OP_SOURCE_RANGE_CLOSED = 'source.rangeClosed'
export const OP_SOURCE_EMPTY = 'source.empty'

// ---- intermediate（§5.2） ----
export const OP_FILTER = 'filter'
export const OP_MAP = 'map'
export const OP_MAP_TO_INT = 'mapToInt'
export const OP_MAP_TO_LONG = 'mapToLong'
export const OP_MAP_TO_DOUBLE = 'mapToDouble'
export const OP_BOXED = 'boxed'
export const OP_MAP_TO_OBJ = 'mapToObj'
export const OP_FLAT_MAP = 'flatMap'
export const OP_FLAT_MAP_TO_INT = 'flatMapToInt'
export const OP_FLAT_MAP_TO_LONG = 'flatMapToLong'
export const OP_FLAT_MAP_TO_DOUBLE = 'flatMapToDouble'

// ---- terminal ----
export const OP_TO_LIST = 'toList'

function sourceDef(
  operationId: string,
  displayName: string,
  ordered: boolean,
  bounded: 'finite' | 'infinite' | 'conditionallyFinite',
  visualizationKind: string,
  jdkNotes: readonly string[],
): OperationDefinition {
  return {
    operationId,
    category: 'source',
    traits: [],
    inputTypeRule: { kind: 'none' },
    outputTypeRule: { kind: 'fromSource' },
    handlerId: `handler.${operationId}`,
    visualizationKind,
    legendStates: ['UNEVALUATED', 'PROCESSING', 'PASSED'],
    jdkNotes,
    sourceRefs: ['JDK25-STREAM', 'JDK25-STREAM-PKG', 'JDK25-INTSTREAM'],
    displayName,
    sourceMeta: { ordered, bounded },
  }
}

function mapperDef(
  operationId: string,
  displayName: string,
  inputTypeRule: OperationDefinition['inputTypeRule'],
  outputTypeRule: OperationDefinition['outputTypeRule'],
  visualizationKind: string,
  jdkNotes: readonly string[],
): OperationDefinition {
  return {
    operationId,
    category: 'intermediate',
    traits: ['INTERMEDIATE', 'STATELESS'],
    inputTypeRule,
    outputTypeRule,
    handlerId: `handler.${operationId}`,
    visualizationKind,
    legendStates: ['UNEVALUATED', 'PROCESSING', 'PASSED'],
    jdkNotes,
    sourceRefs: ['JDK25-STREAM'],
    displayName,
  }
}

export function createDefaultCatalog(): OperationCatalog {
  const catalog = new OperationCatalog()

  // ---- source ----
  catalog.register(
    sourceDef(OP_SOURCE_COLLECTION_STREAM, 'stream()', true, 'finite', '生成元型', [
      '既存Collectionから1要素ずつ送出する（遅延評価）。',
    ]),
  )
  catalog.register(
    sourceDef(OP_SOURCE_ARRAYS_STREAM, 'Arrays.stream()', true, 'finite', '生成元型', [
      '配列からindex順に要素を送出する。primitive配列はInt/Long/DoubleStreamを返す。',
    ]),
  )
  catalog.register(
    sourceDef(OP_SOURCE_STREAM_OF, 'Stream.of()', true, 'finite', '生成元型', [
      '引数の値を記述順にStream要素化する。',
    ]),
  )
  catalog.register(
    sourceDef(OP_SOURCE_GENERATE, 'Stream.generate()', false, 'infinite', '生成ルール型', [
      'Supplier呼び出しによる無限・unordered Streamである。',
    ]),
  )
  catalog.register(
    sourceDef(OP_SOURCE_ITERATE2, 'Stream.iterate(seed, operator)', true, 'infinite', '生成ルール型', [
      'seedへoperatorを繰り返し適用する無限Streamである。',
    ]),
  )
  catalog.register(
    sourceDef(
      OP_SOURCE_ITERATE3,
      'Stream.iterate(seed, predicate, operator)',
      true,
      'conditionallyFinite',
      '生成ルール型',
      ['生成候補をpredicateで判定し、falseで終了する。'],
    ),
  )
  catalog.register(
    sourceDef(OP_SOURCE_RANGE, 'IntStream.range()', true, 'finite', '生成ルール型', [
      'start <= n && n < end のint値を順に送出する（上端を含まない）。',
    ]),
  )
  catalog.register(
    sourceDef(OP_SOURCE_RANGE_CLOSED, 'IntStream.rangeClosed()', true, 'finite', '生成ルール型', [
      'start <= n && n <= end のint値を順に送出する（上端を含む）。',
    ]),
  )
  catalog.register(
    sourceDef(OP_SOURCE_EMPTY, 'empty()', true, 'finite', '生成元型', [
      '要素を送出しない空Streamである。空はnullと同義ではない。',
    ]),
  )

  // ---- intermediate ----
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
  catalog.register(
    mapperDef(OP_MAP, 'map', { kind: 'anyStream' }, { kind: 'fromMapper' }, '1→1変換型', [
      'mapperで各要素を1対1変換した新しいStreamを返す。',
    ]),
  )
  catalog.register(
    mapperDef(
      OP_MAP_TO_INT,
      'mapToInt',
      { kind: 'anyStream' },
      { kind: 'fixedPrimitiveStream', name: 'IntStream' },
      '1→1変換型',
      ['object要素をint値へ変換し、IntStreamを返す。'],
    ),
  )
  catalog.register(
    mapperDef(
      OP_MAP_TO_LONG,
      'mapToLong',
      { kind: 'anyStream' },
      { kind: 'fixedPrimitiveStream', name: 'LongStream' },
      '1→1変換型',
      ['object要素をlong値へ変換し、LongStreamを返す。'],
    ),
  )
  catalog.register(
    mapperDef(
      OP_MAP_TO_DOUBLE,
      'mapToDouble',
      { kind: 'anyStream' },
      { kind: 'fixedPrimitiveStream', name: 'DoubleStream' },
      '1→1変換型',
      ['object要素をdouble値へ変換し、DoubleStreamを返す。'],
    ),
  )
  catalog.register(
    mapperDef(
      OP_BOXED,
      'boxed',
      { kind: 'anyPrimitiveStream' },
      { kind: 'boxedWrapper' },
      '1→1変換型',
      ['primitive値を対応するwrapper（Integer/Long/Double）へboxingする。'],
    ),
  )
  catalog.register(
    mapperDef(
      OP_MAP_TO_OBJ,
      'mapToObj',
      { kind: 'anyPrimitiveStream' },
      { kind: 'fromMapper' },
      '1→1変換型',
      ['primitive値をmapperで任意のobjectへ変換する。boxed（wrapperへのboxing）とは異なる。'],
    ),
  )
  catalog.register(
    mapperDef(OP_FLAT_MAP, 'flatMap', { kind: 'anyStream' }, { kind: 'fromMapper' }, '1→多→平坦化型', [
      '各親要素からmapped Streamを生成し、子要素をencounter orderで1件ずつflattenする。',
      '各mapped Streamは、その内容が後段へ流し終えられた後にcloseされる。',
    ]),
  )
  catalog.register(
    mapperDef(
      OP_FLAT_MAP_TO_INT,
      'flatMapToInt',
      { kind: 'anyStream' },
      { kind: 'fixedPrimitiveStream', name: 'IntStream' },
      '1→多→平坦化型',
      ['各親要素からmapped IntStreamを生成し、int子要素を順にflattenする。'],
    ),
  )
  catalog.register(
    mapperDef(
      OP_FLAT_MAP_TO_LONG,
      'flatMapToLong',
      { kind: 'anyStream' },
      { kind: 'fixedPrimitiveStream', name: 'LongStream' },
      '1→多→平坦化型',
      ['各親要素からmapped LongStreamを生成し、long子要素を順にflattenする。'],
    ),
  )
  catalog.register(
    mapperDef(
      OP_FLAT_MAP_TO_DOUBLE,
      'flatMapToDouble',
      { kind: 'anyStream' },
      { kind: 'fixedPrimitiveStream', name: 'DoubleStream' },
      '1→多→平坦化型',
      ['各親要素からmapped DoubleStreamを生成し、double子要素を順にflattenする。'],
    ),
  )

  // ---- terminal ----
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
