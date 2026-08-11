import { OperationCatalog } from './operationCatalog'
import type { OperationDefinition } from './operationCatalog'

/**
 * Operation Catalog（Draft v0.8 §7）。
 * Phase 1〜3の生成・中間操作、Phase 4の終端操作、Phase 5のCollector系（collect / 3引数collect）
 * を登録する。Phase 6のAI関連操作は登録しない。
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

// ---- Phase 3 intermediate（指示§5.1） ----
export const OP_DISTINCT = 'distinct'
export const OP_SORTED = 'sorted'
export const OP_LIMIT = 'limit'
export const OP_SKIP = 'skip'
export const OP_TAKE_WHILE = 'takeWhile'
export const OP_DROP_WHILE = 'dropWhile'
export const OP_PEEK = 'peek'

// ---- terminal ----
export const OP_TO_LIST = 'toList'

// ---- Phase 4 terminal（指示§6・§9） ----
export const OP_REDUCE = 'reduce'
export const OP_COUNT = 'count'
export const OP_MIN = 'min'
export const OP_MAX = 'max'
export const OP_FIND_FIRST = 'findFirst'
export const OP_FIND_ANY = 'findAny'
export const OP_ANY_MATCH = 'anyMatch'
export const OP_ALL_MATCH = 'allMatch'
export const OP_NONE_MATCH = 'noneMatch'
export const OP_SUM = 'sum'
export const OP_AVERAGE = 'average'
export const OP_SUMMARY_STATISTICS = 'summaryStatistics'
export const OP_TO_ARRAY = 'toArray'
export const OP_FOR_EACH = 'forEach'
export const OP_FOR_EACH_ORDERED = 'forEachOrdered'

// ---- Phase 5 Collector（指示§5・§7.2） ----
export const OP_COLLECT = 'collect'
export const OP_COLLECT_TRIPLE = 'collectTriple'

/**
 * Phase 5 Collector系操作（指示§7.2）。
 * categoryは`collector`（UIのCollector optgroup）、traitsはTERMINALのみ。
 * Collector内部の蓄積状態はJava API上のstateful intermediate operationとは別概念のため
 * STATEFUL traitは付けない（Phase 4 terminalと同じ規律）。
 */
const collectorDef = (
  operationId: string,
  displayName: string,
  visualizationKind: string,
  jdkNotes: readonly string[],
  sourceRefs: readonly string[],
): OperationDefinition => ({
  operationId,
  category: 'collector',
  traits: ['TERMINAL'],
  // primitive特化Streamのcollectは対象外のため、object Streamのみを受け付ける
  inputTypeRule: { kind: 'anyStream' },
  outputTypeRule: { kind: 'fromCollector' },
  handlerId: `handler.${operationId}`,
  visualizationKind,
  legendStates: ['UNEVALUATED', 'PROCESSING', 'PASSED'],
  jdkNotes,
  sourceRefs,
  displayName,
})

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

  // ---- Phase 3 intermediate（指示§5.1の必須traits） ----
  catalog.register({
    operationId: OP_DISTINCT,
    category: 'intermediate',
    traits: ['INTERMEDIATE', 'STATEFUL'],
    inputTypeRule: { kind: 'anyStreamLike' },
    outputTypeRule: { kind: 'identity' },
    handlerId: 'handler.distinct',
    visualizationKind: '状態保持型',
    legendStates: ['UNEVALUATED', 'PROCESSING', 'PASSED', 'REJECTED'],
    jdkNotes: [
      'distinctはequalsに基づき重複を除外するstateful中間操作である。',
      'ordered Streamでは重複のうちencounter orderで最初の要素を保持する。unordered Streamでは安定性の保証はない。',
      'DoubleStream.distinct()の等価判定はDouble.compare(double, double)と一致する。',
    ],
    sourceRefs: ['JDK25-STREAM', 'JDK25-DOUBLESTREAM'],
    displayName: 'distinct',
  })
  catalog.register({
    operationId: OP_SORTED,
    category: 'intermediate',
    traits: ['INTERMEDIATE', 'STATEFUL'],
    inputTypeRule: { kind: 'anyStreamLike' },
    outputTypeRule: { kind: 'identity' },
    handlerId: 'handler.sorted',
    visualizationKind: '全体バッファ型',
    legendStates: ['UNEVALUATED', 'PROCESSING', 'PASSED', 'BUFFERED'],
    jdkNotes: [
      'sortedは全入力をbufferしてから並べ替えるstateful中間操作であり、全要素を見るまで1件も結果を生成できない。',
      'ordered Streamではsortはstable（同値キーはencounter order維持）。unordered Streamではstabilityの保証はない。',
      'DoubleStream.sorted()の順序はDouble.compare(double, double)と一致する。',
    ],
    sourceRefs: ['JDK25-STREAM', 'JDK25-STREAM-PKG', 'JDK25-DOUBLESTREAM'],
    displayName: 'sorted',
  })
  catalog.register({
    operationId: OP_LIMIT,
    category: 'intermediate',
    traits: ['INTERMEDIATE', 'STATEFUL', 'SHORT_CIRCUITING'],
    inputTypeRule: { kind: 'anyStreamLike' },
    outputTypeRule: { kind: 'identity' },
    handlerId: 'handler.limit',
    visualizationKind: '位置・件数制御型',
    legendStates: ['UNEVALUATED', 'PROCESSING', 'PASSED'],
    jdkNotes: [
      'limitはmaxSize件で切り詰めるshort-circuiting stateful中間操作である。引数型はlongである。',
      '上限到達後の残り要素は評価されない（除外ではなく未評価のまま）。',
    ],
    sourceRefs: ['JDK25-STREAM'],
    displayName: 'limit',
  })
  catalog.register({
    operationId: OP_SKIP,
    category: 'intermediate',
    traits: ['INTERMEDIATE', 'STATEFUL'],
    inputTypeRule: { kind: 'anyStreamLike' },
    outputTypeRule: { kind: 'identity' },
    handlerId: 'handler.skip',
    visualizationKind: '位置・件数制御型',
    legendStates: ['UNEVALUATED', 'PROCESSING', 'PASSED', 'REJECTED'],
    jdkNotes: [
      'skipは最初のn件を破棄するstateful中間操作である。引数型はlongである。',
      'skip自体はStream全体を短絡終了しない。n件に達した後の要素はそのまま通過する。',
    ],
    sourceRefs: ['JDK25-STREAM'],
    displayName: 'skip',
  })
  catalog.register({
    operationId: OP_TAKE_WHILE,
    category: 'intermediate',
    traits: ['INTERMEDIATE', 'STATEFUL', 'SHORT_CIRCUITING'],
    inputTypeRule: { kind: 'anyStreamLike' },
    outputTypeRule: { kind: 'identity' },
    handlerId: 'handler.takeWhile',
    visualizationKind: '境界判定型',
    legendStates: ['UNEVALUATED', 'PROCESSING', 'PASSED', 'REJECTED'],
    jdkNotes: [
      'takeWhileはPredicateがtrueである最長のprefixを取るshort-circuiting stateful中間操作である。',
      '初版実行はsequential + orderedに限定する。unordered Streamでは任意のtrue部分集合になり得る。',
      '最初のfalse以降の要素は評価されない（未評価のまま）。',
    ],
    sourceRefs: ['JDK25-STREAM'],
    displayName: 'takeWhile',
  })
  catalog.register({
    operationId: OP_DROP_WHILE,
    category: 'intermediate',
    // dropWhileはPredicate評価を途中で終了するがStream全体を短絡終了しない（指示§5.1）
    traits: ['INTERMEDIATE', 'STATEFUL'],
    inputTypeRule: { kind: 'anyStreamLike' },
    outputTypeRule: { kind: 'identity' },
    handlerId: 'handler.dropWhile',
    visualizationKind: '境界判定型',
    legendStates: ['UNEVALUATED', 'PROCESSING', 'PASSED', 'REJECTED'],
    jdkNotes: [
      'dropWhileはPredicateがtrueである最長のprefixを捨てるstateful中間操作である。',
      '初版実行はsequential + orderedに限定する。',
      '通過モードへ入った後の要素にはPredicateを再評価しない。',
    ],
    sourceRefs: ['JDK25-STREAM'],
    displayName: 'dropWhile',
  })
  catalog.register({
    operationId: OP_PEEK,
    category: 'intermediate',
    traits: ['INTERMEDIATE', 'STATELESS'],
    inputTypeRule: { kind: 'anyStreamLike' },
    outputTypeRule: { kind: 'identity' },
    handlerId: 'handler.peek',
    visualizationKind: '観察型',
    legendStates: ['UNEVALUATED', 'PROCESSING', 'PASSED'],
    jdkNotes: [
      'peekは要素を変更せずConsumerを実行する観察用の中間操作である。',
      'JDKでは最適化や短絡により、peekのactionが呼ばれない要素があり得る（count最適化等）。',
    ],
    sourceRefs: ['JDK25-STREAM'],
    displayName: 'peek',
  })

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

  // ---- Phase 4 terminal（指示§9）。terminal内部の累積状態はJava API上の
  // stateful intermediate operationとは別概念のため、STATEFUL traitは付けない ----
  const terminalDef = (
    operationId: string,
    displayName: string,
    shortCircuiting: boolean,
    visualizationKind: string,
    jdkNotes: readonly string[],
    sourceRefs: readonly string[],
    legendStates: OperationDefinition['legendStates'] = ['UNEVALUATED', 'PROCESSING', 'PASSED'],
  ): OperationDefinition => ({
    operationId,
    category: 'terminal',
    traits: shortCircuiting ? ['TERMINAL', 'SHORT_CIRCUITING'] : ['TERMINAL'],
    inputTypeRule: { kind: 'anyStreamLike' },
    outputTypeRule: { kind: 'fromTerminal' },
    handlerId: `handler.${operationId}`,
    visualizationKind,
    legendStates,
    jdkNotes,
    sourceRefs,
    displayName,
  })

  catalog.register(
    terminalDef(OP_REDUCE, 'reduce', false, '累積リダクション型', [
      'accumulatorは結合則（associativity）を満たす必要がある。',
      'identityなしのreduceは空StreamでOptionalを返す。identityありは空Streamでidentityを返す。',
      'combinerはparallel reductionで部分結果を結合するために必要となる。sequential実行では呼ばれない。',
    ], ['JDK25-STREAM', 'JDK25-STREAM-PKG']),
  )
  catalog.register(
    terminalDef(OP_COUNT, 'count', false, '累積リダクション型', [
      'countは要素数をlongで返す。',
      'JDKは結果を直接算出できる場合、Pipeline（peek等）の評価を省略することがある。常に省略される保証も、必ず評価される保証もない。',
    ], ['JDK25-STREAM']),
  )
  catalog.register(
    terminalDef(OP_MIN, 'min', false, '候補更新型', [
      'minは現在候補と現在要素を比較し、小さい方を候補として維持する。空StreamはOptionalを返す。',
    ], ['JDK25-STREAM', 'JDK25-INTSTREAM']),
  )
  catalog.register(
    terminalDef(OP_MAX, 'max', false, '候補更新型', [
      'maxは現在候補と現在要素を比較し、大きい方を候補として維持する。空StreamはOptionalを返す。',
    ], ['JDK25-STREAM', 'JDK25-INTSTREAM']),
  )
  catalog.register(
    terminalDef(OP_FIND_FIRST, 'findFirst', true, '短絡検索・判定型', [
      'findFirstはordered Streamでencounter orderの最初の要素を返す。',
      'encounter orderがないStreamでは、findFirstでも任意の要素が返り得る。',
      '結果確定後の残り要素は評価されない（short-circuiting）。',
    ], ['JDK25-STREAM']),
  )
  catalog.register(
    terminalDef(OP_FIND_ANY, 'findAny', true, '短絡検索・判定型', [
      'findAnyはどの要素が返るかをJDKが保証しない（特にparallel実行）。教材fixtureの選択は再現可能だが、JDKの保証ではない。',
      '結果確定後の残り要素は評価されない（short-circuiting）。',
    ], ['JDK25-STREAM']),
  )
  catalog.register(
    terminalDef(OP_ANY_MATCH, 'anyMatch', true, '短絡検索・判定型', [
      'anyMatchは最初のtrueで結果確定する。空Streamの結果はfalse。',
    ], ['JDK25-STREAM']),
  )
  catalog.register(
    terminalDef(OP_ALL_MATCH, 'allMatch', true, '短絡検索・判定型', [
      'allMatchは最初のfalseで結果確定する。',
      '空Streamの結果はtrue（vacuous truth: 反例が存在しないため）。Predicateは一度も評価されない。',
    ], ['JDK25-STREAM']),
  )
  catalog.register(
    terminalDef(OP_NONE_MATCH, 'noneMatch', true, '短絡検索・判定型', [
      'noneMatchは最初のtrueで結果確定する（結果はfalse）。',
      '空Streamの結果はtrue（vacuous truth: 該当が存在しないため）。Predicateは一度も評価されない。',
    ], ['JDK25-STREAM']),
  )
  catalog.register(
    terminalDef(OP_SUM, 'sum', false, '累積リダクション型', [
      'sumは累積合計を返す。空Streamは型別の0（0 / 0L / 0.0）。',
    ], ['JDK25-INTSTREAM', 'JDK25-LONGSTREAM', 'JDK25-DOUBLESTREAM']),
  )
  catalog.register(
    terminalDef(OP_AVERAGE, 'average', false, '累積リダクション型', [
      'averageは合計と件数から平均を計算しOptionalDoubleを返す。空StreamはOptionalDouble.empty()。',
    ], ['JDK25-INTSTREAM', 'JDK25-LONGSTREAM', 'JDK25-DOUBLESTREAM']),
  )
  catalog.register(
    terminalDef(OP_SUMMARY_STATISTICS, 'summaryStatistics', false, '累積リダクション型', [
      'summaryStatisticsはcount / sum / min / average / maxを同時に集計する。',
      '空Streamのmin / maxは型の正規初期値（MAX_VALUE / MIN_VALUE、doubleは正負Infinity）になる。',
    ], ['JDK25-INTSTATS', 'JDK25-LONGSTATS', 'JDK25-DOUBLESTATS']),
  )
  catalog.register(
    terminalDef(OP_TO_ARRAY, 'toArray', false, '結果化型', [
      'Stream.toArray()はObject[]を返す。toArray(generator)は指定した型の配列を返す。',
      'primitive StreamのtoArray()はint[] / long[] / double[]を返す。',
      '空Streamは正しいcomponent typeの長さ0配列を返す。',
    ], ['JDK25-STREAM', 'JDK25-INTSTREAM']),
  )
  catalog.register(
    terminalDef(OP_FOR_EACH, 'forEach', false, '結果化型', [
      'forEachの戻り値はvoidで、Consumerの副作用だけが残る。',
      'parallel Streamではforeachの実行順序は保証されない。順序が必要な場合はforEachOrderedを使う（初版はsequential実行のみ）。',
    ], ['JDK25-STREAM']),
  )
  catalog.register(
    terminalDef(OP_FOR_EACH_ORDERED, 'forEachOrdered', false, '結果化型', [
      'forEachOrderedはencounter orderでConsumerを実行する。戻り値はvoid。',
      'sequential実行ではforEachと同じ順序になるが、parallelでの順序保証の有無が両者の違いである（初版はsequential実行のみ）。',
    ], ['JDK25-STREAM']),
  )

  // ---- Phase 5 Collector（指示§5・§7.2）。結果型はCollector ASTから導出する ----
  catalog.register(
    collectorDef(
      OP_COLLECT,
      'collect（Collector）',
      '単純Collector型',
      [
        'collect(Collector)は可変リダクションであり、Collectorがsupplier / accumulator / combiner / finisherを束ねる。',
        'Collectors.toList()が返すListは可変性・型・thread-safetyを保証しない。Stream.toList()のunmodifiableとは異なる。',
        'groupingBy / toSet等が返すMap / Setのiteration orderはJDKの保証対象ではない（教材の表示順は学習用の安定順序）。',
      ],
      ['JDK25-STREAM', 'JDK25-COLLECTORS'],
    ),
  )
  catalog.register(
    collectorDef(
      OP_COLLECT_TRIPLE,
      'collect（Supplier, BiConsumer, BiConsumer）',
      '単純Collector型',
      [
        '3引数collectはsupplier / accumulator / combinerを直接渡す「裸の可変リダクション」であり、その抽象化がCollectorである。',
        'combinerはparallel reductionで必要となる。sequential実行では呼ばれない（呼出し0回）。',
        'primitive特化Streamの3引数collectは初版の対象外である。',
      ],
      ['JDK25-STREAM'],
    ),
  )

  return catalog
}
