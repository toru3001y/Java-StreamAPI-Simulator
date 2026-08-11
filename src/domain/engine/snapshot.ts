import type { ElementStateKind } from '../catalog/operationCatalog'
import type { ElementId, LineId, NodeId, ScenarioRevision, SnapshotId } from '../types/ids'

/**
 * Snapshot（§12）。
 * 学習上意味があり、全画面が同一時点を示し、「戻る」で完全に復元できる1つの確定状態。
 * 確定snapshotに未完了アニメーション状態を含めない（§12.6）。
 */
export type SnapshotKind =
  | 'INITIAL'
  | 'SOURCE_CANDIDATE'
  | 'SOURCE_PREDICATE_EVALUATED'
  | 'SOURCE_EMIT'
  | 'NODE_ARRIVAL'
  | 'PREDICATE_EVALUATED'
  | 'ELEMENT_PASSED'
  | 'ELEMENT_REJECTED'
  | 'MAPPING_APPLIED'
  | 'MAPPED_EMITTED'
  | 'MAPPED_STREAM_CREATED'
  | 'CHILD_EMITTED'
  | 'SINK_APPENDED'
  | 'RESULT_CONFIRMED'
  | 'STREAM_CONSUMED'
  // ---- Phase 3（指示§7、docs/phase-3-decisions.md §4.1） ----
  | 'DISTINCT_CHECKED'
  | 'DISTINCT_SEEN_UPDATED'
  | 'SORT_BUFFERED'
  | 'SORT_ORDER_CONFIRMED'
  | 'SORT_EMITTED'
  | 'LIMIT_COUNT_UPDATED'
  | 'SKIP_COUNT_UPDATED'
  | 'SHORT_CIRCUIT_CONFIRMED'
  | 'DROP_MODE_ENTERED'
  | 'PEEK_ACTION_PERFORMED'
  // ---- Phase 4（終端操作。指示§10） ----
  | 'REDUCTION_INITIALIZED'
  | 'ACCUMULATOR_UPDATED'
  | 'COUNT_UPDATED'
  | 'CANDIDATE_UPDATED'
  | 'MATCH_EVALUATED'
  | 'FIND_SELECTED'
  | 'STATISTICS_UPDATED'
  | 'ARRAY_ELEMENT_STORED'
  | 'CONSUMER_ACTION_PERFORMED'
  // ---- Phase 5（Collector。指示§9.1、docs/phase-5-decisions.md §4.1） ----
  /** supplier適用によるコンテナ生成確定 */
  | 'CONTAINER_CREATED'
  /** groupingBy classifierの評価確定（partitioningByのpredicateはPREDICATE_EVALUATEDを再利用） */
  | 'CLASSIFIER_EVALUATED'
  /** bucket決定確定（新規生成か既存かを区別して表示） */
  | 'BUCKET_SELECTED'
  /** コンテナ / bucketへの蓄積更新確定 */
  | 'CONTAINER_UPDATED'
  /** Collector finisher適用確定（collectingAndThen finisherを含む） */
  | 'COLLECTOR_FINISHED'
  /** teeingの左右branchの蓄積更新確定（activeBranchで左右を区別する） */
  | 'TEE_BRANCH_ACCUMULATED'
  /** teeingの左右branchのfinisher適用確定（R1 / R2を確定） */
  | 'TEE_BRANCH_FINISHED'
  /** teeing mergerの適用確定（R1・R2から最終結果Rを生成） */
  | 'TEE_MERGER_APPLIED'

/** 処理中パネルの表示内容（§12.3 処理中）。UIはこの確定値を描画するだけで独自計算しない。 */
export interface ProcessingView {
  readonly title: string
  /** 値取得・値遷移の流れ（例: 佐藤.age() → 35。視覚フローはUnicode矢印） */
  readonly inputLabel: string | null
  /** Java式（例: e -> e.age() >= 30、Employee::name。ASCII構文） */
  readonly expression: string | null
  /** 実値の評価・変換（例: 35 >= 30 → true、佐藤（age=35） → "佐藤"） */
  readonly evaluation: string | null
  /** 通過 / 除外 / 追加 等の確定結果 */
  readonly outcome: string | null
}

/** flatMap親子文脈（§12.3 実行位置、Phase 2指示 §6.2・§9.3） */
export interface FlatMapContextView {
  readonly nodeId: NodeId
  readonly parentElementId: ElementId
  readonly parentLabel: string
  readonly children: readonly { readonly id: ElementId; readonly label: string }[]
  /** これまでに送出済みの子要素数 */
  readonly emittedCount: number
  /** mapped Streamのclose状態（独立snapshotにせず詳細として保持する） */
  readonly closed: boolean
}

/** source処理の文脈（Phase 2指示 §9.1） */
export interface SourceContextView {
  /** Arrays.stream等のindex */
  readonly index: number | null
  /** iterateの候補値ラベル */
  readonly candidateLabel: string | null
  /** iterate predicate式（ASCII） */
  readonly predicateText: string | null
  readonly predicateResult: boolean | null
  /** range境界等の補足 */
  readonly note: string | null
}

/**
 * 操作固有状態のnode単位view（Phase 3指示 §7.1）。
 * 同じ操作がPipelineに複数あっても状態を混同しないよう、nodeIdをキーに保持する。
 */
export interface DistinctSeenEntry {
  readonly key: string
  readonly label: string
}

export interface SortedOrderEntry {
  readonly id: ElementId
  readonly label: string
  readonly keyLabel: string
}

/**
 * Collector蓄積状態の表示view（Phase 5指示 §6.3-3・§9.1）。
 * `SimValue`をMap / コンテナ相当へ拡張せず、**表示用の構造化されたプレーンな木**として保持する
 * （`structuredClone`可能・`deepFreeze`可能。Map / Set / 関数 / 循環参照を含めない）。
 */
export type CollectorAccumulationView =
  /** 蓄積表現を持たないノード（mapping等のpass-through） */
  | { readonly kind: 'NONE' }
  /** 可変コンテナへの追加（toList / toSet / toCollection / 3引数collect） */
  | {
      readonly kind: 'ELEMENTS'
      readonly containerLabel: string
      readonly items: readonly SnapshotOutputItem[]
      /** 直前の追加でコンテナが変化したか（toSetの重複無変化を表示するため） */
      readonly changedByLast: boolean | null
    }
  /** joiningの現在連結文字列 */
  | { readonly kind: 'TEXT'; readonly valueLabel: string }
  /** counting / summing系の集約値 */
  | { readonly kind: 'NUMBER'; readonly valueLabel: string }
  /** averaging系の蓄積（合計・件数）と平均 */
  | {
      readonly kind: 'AVERAGE'
      readonly sumLabel: string
      readonly countLabel: string
      readonly averageLabel: string | null
    }
  /** summarizing系の統計コンテナ */
  | {
      readonly kind: 'STATISTICS'
      readonly countLabel: string
      readonly sumLabel: string
      readonly minLabel: string
      readonly maxLabel: string
      readonly averageLabel: string
    }
  /** minBy / maxBy / reducingの候補・accumulator */
  | {
      readonly kind: 'CANDIDATE'
      readonly candidateLabel: string | null
      readonly candidateElementId: ElementId | null
      readonly updateCount: number
    }
  /** groupingBy / partitioningByのMap本体（bucketはCollectorNodeView.bucketsが持つ） */
  | { readonly kind: 'MAP'; readonly containerLabel: string; readonly size: number }

/** Collector finisherの状態（指示§9.1発行表・§9.3） */
export interface CollectorFinisherView {
  /** 表示ラベル（例: List::copyOf、joiningの連結確定、averageへの変換） */
  readonly label: string
  readonly state: 'PENDING' | 'APPLIED'
  /** finisher適用前の値と型（適用前はnull） */
  readonly beforeLabel: string | null
  readonly beforeTypeLabel: string | null
  readonly afterLabel: string | null
  readonly afterTypeLabel: string | null
}

/** groupingBy / partitioningByのbucket（生成順で保持する。指示§9.1規則7） */
export interface CollectorBucketView {
  readonly keyLabel: string
  /** キーの安定キー文字列（値等価。履歴復元・照合用） */
  readonly keyRef: string
  /** bucket生成順（1始まり） */
  readonly createdSeq: number
  /** 直前のbucket決定で新規生成されたか */
  readonly createdByLast: boolean
  readonly active: boolean
  readonly node: CollectorNodeView
}

/** teeing固有context（docs/phase-5-decisions.md §6の契約項目） */
export interface CollectorTeeingView {
  readonly teeingNodeKey: string
  readonly leftNodeKey: string
  readonly rightNodeKey: string
  readonly currentElementId: ElementId | null
  readonly activeBranch: 'NONE' | 'LEFT' | 'RIGHT'
  readonly leftState: 'PENDING' | 'ACCUMULATING' | 'ACCUMULATED' | 'FINISHED'
  readonly rightState: 'PENDING' | 'ACCUMULATING' | 'ACCUMULATED' | 'FINISHED'
  readonly leftAccumulationLabel: string
  readonly rightAccumulationLabel: string
  /** finisher適用後の結果R1 / R2（未確定はnull） */
  readonly leftResultLabel: string | null
  readonly rightResultLabel: string | null
  readonly leftResultTypeLabel: string
  readonly rightResultTypeLabel: string
  /** merger DSL / 識別子（例: SalarySummary::new） */
  readonly mergerLabel: string
  readonly mergerApplied: boolean
  /** 最終結果R（merger適用前はnull。先行表示しない） */
  readonly finalResultLabel: string | null
  readonly resultTypeLabel: string
  /** 教材上のbranch表示順が左→右であること */
  readonly branchDisplayOrderNote: string
  /** 左→右がJDKの呼出し順保証ではない旨の注記（§11） */
  readonly jdkOrderNote: string
}

/**
 * Collector ASTノードのview（Draft v0.8 §12.3「Collector: AST、現在経路、
 * ノード別蓄積、finisher状態」、§15.2「内側から外側へ組み上がる結果TypeRef」）。
 */
export interface CollectorNodeView {
  /** AST上の安定パス（例: c0、c0.down、c0.left、c0.bucket#1.down） */
  readonly nodeKey: string
  readonly collectorKind: string
  /** このノード単独の表示ラベル（例: Collectors.counting()） */
  readonly label: string
  readonly inputTypeLabel: string
  readonly resultTypeLabel: string
  /** 現在要素が通っているノードか（現在経路） */
  readonly active: boolean
  readonly accumulation: CollectorAccumulationView
  /** finisher発行対象variantのみ非null（指示§9.1発行表） */
  readonly finisher: CollectorFinisherView | null
  /** 構造上のdownstream（groupingBy / partitioningByでは各bucketの雛形） */
  readonly downstream: CollectorNodeView | null
  readonly left: CollectorNodeView | null
  readonly right: CollectorNodeView | null
  readonly buckets: readonly CollectorBucketView[]
  readonly teeing: CollectorTeeingView | null
}

export type OperationContextView =
  | {
      readonly kind: 'distinct'
      readonly nodeId: NodeId
      readonly seen: readonly DistinctSeenEntry[]
      readonly currentLabel: string | null
      readonly verdict: 'FIRST' | 'DUPLICATE' | null
    }
  | {
      readonly kind: 'sorted'
      readonly nodeId: NodeId
      readonly phase: 'BUFFERING' | 'ORDER_CONFIRMED' | 'EMITTING'
      /** natural orderまたはComparator DSL由来の表示（例: Comparator.comparing(Employee::region)） */
      readonly comparatorLabel: string
      /** Comparatorキー / 比較対象の説明 */
      readonly keyDescription: string
      /** 元のbuffer順序（encounter order） */
      readonly bufferOrder: readonly SortedOrderEntry[]
      /** 並べ替え確定後の順序（確定前はnull） */
      readonly confirmedOrder: readonly SortedOrderEntry[] | null
      /** 放出済み件数（次の放出位置） */
      readonly emittedCount: number
      /** ordered時のstable説明。unorderedではstable保証を表示しない */
      readonly stableNote: string | null
    }
  | {
      readonly kind: 'limit'
      readonly nodeId: NodeId
      readonly maxSize: number
      readonly passedCount: number
      readonly reached: boolean
      readonly upstreamStopped: boolean
    }
  | {
      readonly kind: 'skip'
      readonly nodeId: NodeId
      readonly n: number
      readonly skippedCount: number
      readonly passMode: boolean
    }
  | {
      readonly kind: 'takeWhile'
      readonly nodeId: NodeId
      readonly predicateText: string
      readonly stopped: boolean
      readonly boundaryElementId: ElementId | null
      readonly boundaryLabel: string | null
    }
  | {
      readonly kind: 'dropWhile'
      readonly nodeId: NodeId
      readonly predicateText: string
      readonly mode: 'DROPPING' | 'PASSING'
      readonly boundaryElementId: ElementId | null
      readonly boundaryLabel: string | null
    }
  | {
      readonly kind: 'peek'
      readonly nodeId: NodeId
      readonly consumerText: string
      readonly callCount: number
    }
  // ---- Phase 4: terminal固有状態（指示§10・§12） ----
  | {
      readonly kind: 'reduce'
      readonly nodeId: NodeId
      readonly expression: string
      /** identityの表示（identityなしはnull） */
      readonly identityLabel: string | null
      readonly hasCombiner: boolean
      /** sequential実行ではcombinerを実行済みのように表示しない（呼出し0回） */
      readonly combinerCallCount: number
      readonly accumulatorLabel: string | null
      readonly stepCount: number
      readonly history: readonly {
        readonly seq: number
        readonly inputLabel: string
        readonly beforeLabel: string | null
        readonly afterLabel: string
      }[]
    }
  | {
      readonly kind: 'count'
      readonly nodeId: NodeId
      readonly currentCount: number
      /** JDKによる評価省略可能性の常設注記 */
      readonly elisionNote: string
    }
  | {
      readonly kind: 'minmax'
      readonly nodeId: NodeId
      readonly op: 'min' | 'max'
      readonly comparatorLabel: string
      readonly candidateLabel: string | null
      readonly candidateElementId: ElementId | null
      readonly updateCount: number
    }
  | {
      readonly kind: 'match'
      readonly nodeId: NodeId
      readonly op: 'anyMatch' | 'allMatch' | 'noneMatch'
      readonly predicateText: string
      readonly evaluatedCount: number
      readonly decided: boolean
      readonly resultValue: boolean | null
      /** 空Streamのvacuous truth説明（該当時のみ） */
      readonly vacuousNote: string | null
    }
  | {
      readonly kind: 'find'
      readonly nodeId: NodeId
      readonly op: 'findFirst' | 'findAny'
      readonly decided: boolean
      readonly selectedLabel: string | null
      readonly selectedElementId: ElementId | null
      /** findAnyの非決定性・encounter orderなしのfindFirstの常設注記 */
      readonly nondeterminismNote: string | null
    }
  | {
      readonly kind: 'aggregate'
      readonly nodeId: NodeId
      readonly op: 'sum' | 'average' | 'summaryStatistics'
      readonly primitive: 'int' | 'long' | 'double'
      readonly count: number
      readonly sumLabel: string
      readonly minLabel: string | null
      readonly maxLabel: string | null
      readonly averageLabel: string | null
    }
  | {
      readonly kind: 'array'
      readonly nodeId: NodeId
      readonly componentTypeLabel: string
      readonly storedCount: number
    }
  | {
      readonly kind: 'forEach'
      readonly nodeId: NodeId
      readonly op: 'forEach' | 'forEachOrdered'
      readonly consumerText: string
      readonly callCount: number
      /** forEachとforEachOrderedの順序保証差の補助説明 */
      readonly orderingNote: string
    }
  // ---- Phase 5: Collector固有状態（指示§9.1、Draft v0.8 §12.3・§12.5） ----
  | {
      readonly kind: 'collector'
      readonly nodeId: NodeId
      readonly op: 'collect' | 'collectTriple'
      /** Collector構造ツリー（AST + ノード別蓄積 + 結果TypeRef + finisher状態） */
      readonly root: CollectorNodeView
      /** 現在経路（rootからのnodeKey列） */
      readonly currentPath: readonly string[]
      /** 現在経路の表示（例: 佐藤 → classifier → 関東 → counting） */
      readonly currentPathLabel: string | null
      /** 3引数collectのsupplier / accumulator / combiner（collectTripleのみ） */
      readonly triple: {
        readonly supplierId: string
        readonly accumulatorId: string
        readonly combinerId: string
        /** sequential実行のためcombinerは実行済みのように表示しない（呼出し0回） */
        readonly combinerCallCount: number
        readonly combinerNote: string
      } | null
    }

/**
 * Side Effect履歴entry（Phase 3指示 §7.8）。
 * 実ブラウザconsoleではなく、snapshotへ保持した不変履歴をSource of Truthとする。
 */
export interface SideEffectEntry {
  /** action呼出しの安定通番（1始まり） */
  readonly seq: number
  readonly nodeId: NodeId
  readonly elementId: ElementId
  readonly inputLabel: string
  /** Consumer DSLから生成したJava式 */
  readonly actionExpr: string
  /** actionラベル（PRINT_VALUE / PRINT_FIELD） */
  readonly actionLabel: string
  readonly message: string
}

export interface SnapshotOutputItem {
  readonly id: ElementId
  readonly label: string
}

/**
 * 終端結果の識別可能Union（Phase 4指示 §7）。
 * scalar / Optional / array / statistics / boolean / voidを文字列だけでなく
 * 構造として保持し、UIは独自計算せずこの確定値だけを描画する。
 * LISTの値は既存のSnapshotOutput.items（非破壊）を使用する。
 */
export type TerminalResultView =
  | { readonly kind: 'LIST' }
  | {
      readonly kind: 'SCALAR'
      /** 例: long / int / boolean */
      readonly typeLabel: string
      readonly valueLabel: string
    }
  | {
      readonly kind: 'OPTIONAL'
      /** Optional / OptionalInt / OptionalLong / OptionalDouble */
      readonly optionalTypeLabel: string
      /** object Optionalの要素型（primitive Optionalではnull） */
      readonly elementTypeLabel: string | null
      readonly present: boolean
      readonly valueLabel: string | null
      readonly valueElementId: ElementId | null
    }
  | {
      readonly kind: 'ARRAY'
      readonly componentTypeLabel: string
      readonly length: number
      readonly items: readonly { readonly index: number; readonly label: string }[]
    }
  | {
      readonly kind: 'STATISTICS'
      /** IntSummaryStatistics等 */
      readonly statisticsTypeLabel: string
      readonly countLabel: string
      readonly sumLabel: string
      readonly minLabel: string
      readonly maxLabel: string
      readonly averageLabel: string
      /** 空Streamの正規初期値であることの注記（非空ではnull） */
      readonly emptyNote: string | null
    }
  | { readonly kind: 'VOID' }
  // ---- Phase 5: Collector結果（指示§9.5） ----
  | {
      /** toSet / toCollection用。toSetをLIST扱いにしない（重複排除と表示順注記を構造で保持する） */
      readonly kind: 'COLLECTION'
      /** コンテナ表示名（Set / ArrayList / List等） */
      readonly containerLabel: string
      readonly elementTypeLabel: string
      readonly size: number
      /** 安定elementId参照 + 表示ラベルの列 */
      readonly items: readonly SnapshotOutputItem[]
      /** 表示順が学習用projectionである旨のメタ情報（JDK順序意味論を持つ場合はnull） */
      readonly displayOrderNote: string | null
      /**
       * Setの要素ID規則の注記。等価値が複数の入力要素から集約される場合は
       * 最初に受理した入力要素のelementIdを保持し、後続の等価値追加では置換しない。
       * これは表示・履歴復元用の教材規約であり、JDKのSet内部動作やiteration order保証ではない。
       */
      readonly elementIdNote: string | null
    }
  | {
      /** groupingBy / partitioningBy用 */
      readonly kind: 'MAP'
      /** Map表示型（Map / TreeMap） */
      readonly containerLabel: string
      readonly keyTypeLabel: string
      readonly valueTypeLabel: string
      readonly size: number
      readonly entries: readonly CollectorMapEntryView[]
      /** JDKの順序意味論を持つか（TreeMap等）。falseなら学習用表示順 */
      readonly jdkOrdered: boolean
      readonly displayOrderNote: string | null
    }
  | {
      /** teeing用（merger結果record） */
      readonly kind: 'RECORD'
      readonly recordName: string
      readonly fields: readonly {
        readonly name: string
        readonly typeLabel: string
        readonly valueLabel: string
      }[]
    }

/**
 * Mapのentry（§9.5）。値はdownstream結果として**入れ子のresult view構造**を持つ
 * （nested groupingByではvalueがMAP、groupingBy + countingではSCALAR等）。
 */
export interface CollectorMapEntryView {
  readonly keyLabel: string
  /** キーの安定キー文字列（値等価。履歴復元・Oracle照合の正規化に使用） */
  readonly keyRef: string
  readonly value: TerminalResultView
}

export interface SnapshotOutput {
  readonly elementIds: readonly ElementId[]
  readonly items: readonly SnapshotOutputItem[]
  readonly count: number
  readonly confirmed: boolean
  readonly resultTypeLabel: string
  /** 終端結果の構造化view（Phase 4指示 §7。toListはLIST） */
  readonly result: TerminalResultView
}

export interface Snapshot {
  readonly snapshotId: SnapshotId
  readonly index: number
  readonly revision: ScenarioRevision
  readonly kind: SnapshotKind
  readonly activeNodeId: NodeId | null
  readonly activeLineId: LineId | null
  readonly currentElementId: ElementId | null
  /** flatMap子要素処理中の親要素（§6.2: 親は文脈情報として保持し、処理中は1件のみ） */
  readonly parentElementId: ElementId | null
  readonly flatMapContext: FlatMapContextView | null
  readonly sourceContext: SourceContextView | null
  /** 型区間の変化（例: Stream<Employee> → IntStream。該当snapshotのみ） */
  readonly typeTransition: string | null
  /** 要素 × 操作ノードごとの状態履歴（§12.4） */
  readonly elementNodeStates: Readonly<
    Record<ElementId, Readonly<Record<NodeId, ElementStateKind>>>
  >
  /** 入力パネル用: 各要素の最新状態（§12.4） */
  readonly elementLatestStates: Readonly<Record<ElementId, ElementStateKind>>
  /** Phase 3のnode単位操作固有状態（該当ノードが存在する場合のみ） */
  readonly operationContexts: Readonly<Record<NodeId, OperationContextView>>
  /** peekのSide Effect履歴（このsnapshot時点まで） */
  readonly sideEffects: readonly SideEffectEntry[]
  readonly output: SnapshotOutput
  readonly processing: ProcessingView | null
  readonly explanation: {
    readonly current: string
    readonly next: string
    readonly jdkNote: string | null
  }
  /** 現操作で発生可能な状態だけ（§12.3 凡例） */
  readonly legend: readonly ElementStateKind[]
  readonly completion: 'NONE' | 'STREAM_CONSUMED'
}

export const ELEMENT_STATE_LABELS: Readonly<Record<ElementStateKind, string>> = {
  UNEVALUATED: '未評価',
  PROCESSING: '処理中',
  PASSED: '通過済み',
  REJECTED: '除外済み',
  BUFFERED: 'バッファ済み',
}

export const ELEMENT_STATE_SYMBOLS: Readonly<Record<ElementStateKind, string>> = {
  UNEVALUATED: '－',
  PROCESSING: '▶',
  PASSED: '○',
  REJECTED: '×',
  BUFFERED: '□',
}
