import type { DslPredicate } from './ast'
import type {
  ClassifierDsl,
  CollectTripleDsl,
  CollectorDsl,
  ToMapValueDsl,
} from './collectorAst'
import { TEEING_MERGER_RECORDS, TO_MAP_MERGE_META } from './collectorAst'
import type { ComparatorDsl, ComparatorKey } from './comparatorAst'
import { COMPARATOR_FIELD_JAVA_KIND } from './comparatorAst'
import type { ConsumerDsl } from './consumerAst'
import type { GatherAccumulationRule, GathererDsl } from './gatherAst'
import type { MapperDsl } from './mapperAst'
import type { SourceDsl } from './sourceAst'
import type { ArrayGeneratorDsl, ReductionDsl, ReductionIdentity } from './terminalAst'
import type { DatasetElement, DepartmentValue, EmployeeValue } from '../model/employee'
import { EMPLOYEE_FIELDS } from '../model/employee'
import { formatDoubleLiteral, formatLongLiteral } from '../model/value'
import type { LineId, NodeId } from '../types/ids'
import { lineIdForNode } from '../types/ids'
import type { TypeRef } from '../types/typeRef'
import { formatTypeRef } from '../types/typeRef'

/**
 * 検証済みDSL / ASTからのJavaコード生成（§9.1、Phase 2指示 §7.4）。
 * Javaコード・Java式は正当なASCII構文（-> / >=）を使用し、Unicode矢印を混入させない（§17.4）。
 * コード行はactive nodeと対応する安定line IDを持つ。
 */
export interface JavaCodeLine {
  readonly lineId: LineId
  readonly text: string
  readonly nodeId: NodeId | null
}

export interface JavaCodeNodeSource {
  readonly nodeId: NodeId
  readonly role: 'source' | 'intermediate' | 'terminal'
  readonly operationId: string
  readonly predicate: DslPredicate | null
  readonly mapper: MapperDsl | null
  readonly comparator: ComparatorDsl | null
  readonly consumer: ConsumerDsl | null
  readonly count: number | null
  readonly reduction: ReductionDsl | null
  readonly identity: ReductionIdentity | null
  readonly hasCombiner: boolean
  readonly arrayGenerator: ArrayGeneratorDsl | null
  /** collect(Collector)のCollector AST（Phase 5） */
  readonly collector: CollectorDsl | null
  /** 3引数collectの定義済みID組合せ（Phase 5） */
  readonly collectTriple: CollectTripleDsl | null
  /** gather(Gatherer)の検証済みGatherer DSL（Phase 7） */
  readonly gatherer: GathererDsl | null
}

export interface JavaCodeInput {
  readonly source: SourceDsl
  readonly employeeDataset: readonly DatasetElement[]
  readonly nodes: readonly JavaCodeNodeSource[]
  readonly resultType: TypeRef
}

const OPERATOR_JAVA: Readonly<Record<string, string>> = {
  GTE: '>=',
  LT: '<',
}

export function operatorToJava(operator: string): string {
  const op = OPERATOR_JAVA[operator]
  if (!op) throw new Error(`unsupported operator: ${operator}`)
  return op
}

/** Predicateの数値literalをJavaリテラル表記へ（long定数は`5_000_000L`形式。§17.4はASCII） */
export function predicateLiteralToJava(predicate: DslPredicate): string {
  if (predicate.value.type === 'int') return String(predicate.value.value)
  if (predicate.value.type === 'long') return formatLongLiteral(predicate.value.value)
  throw new Error(`unsupported literal type: ${predicate.value.type}`)
}

/** 表示用Java式（例: e -> e.age() >= 30、e -> e.salary() >= 5_000_000L、n -> n < 5） */
export function predicateToJavaExpr(predicate: DslPredicate): string {
  const op = operatorToJava(predicate.operator)
  const literal = predicateLiteralToJava(predicate)
  if (predicate.kind === 'currentValueCompare') {
    return `n -> n ${op} ${literal}`
  }
  const accessor = EMPLOYEE_FIELDS[predicate.field]?.accessor ?? `${predicate.field}()`
  return `e -> e.${accessor} ${op} ${literal}`
}

/** Comparatorキーの抽出式（method referenceまたはネストfieldのlambda） */
function comparatorKeyExtractor(key: ComparatorKey, first: boolean): string {
  if (key.field === 'department.name' || key.field === 'department.division') {
    const accessor = key.field === 'department.name' ? 'name()' : 'division()'
    // 先頭キーは型推論のため明示的なlambda引数型が必要
    return first ? `(Employee e) -> e.department().${accessor}` : `e -> e.department().${accessor}`
  }
  return `Employee::${key.field}`
}

/**
 * Comparator DSLからのJavaコード生成（Phase 3指示 §6.3）。
 * キー型に応じてComparator.comparing / comparingInt / comparingLong / comparingDouble、
 * 必要なreversed() / thenComparing*を組み立てる。
 */
export function comparatorToJavaExpr(comparator: ComparatorDsl): string {
  if (comparator.kind === 'natural') return 'Comparator.naturalOrder()'
  const parts: string[] = []
  comparator.keys.forEach((key, i) => {
    const javaKind = COMPARATOR_FIELD_JAVA_KIND[key.field]
    const extractor = comparatorKeyExtractor(key, i === 0)
    if (i === 0) {
      if (key.direction === 'DESC') {
        if (comparator.keys.length === 1) {
          // 単一キーDESCはreversed()で表現する
          const method =
            javaKind === 'int'
              ? 'comparingInt'
              : javaKind === 'long'
                ? 'comparingLong'
                : javaKind === 'double'
                  ? 'comparingDouble'
                  : 'comparing'
          parts.push(`Comparator.${method}(${extractor}).reversed()`)
        } else {
          // 複合キーの先頭DESCは後続キーまで反転しないようreverseOrder比較子で表現する
          parts.push(`Comparator.comparing(${extractor}, Comparator.reverseOrder())`)
        }
      } else {
        const method =
          javaKind === 'int'
            ? 'comparingInt'
            : javaKind === 'long'
              ? 'comparingLong'
              : javaKind === 'double'
                ? 'comparingDouble'
                : 'comparing'
        parts.push(`Comparator.${method}(${extractor})`)
      }
    } else if (key.direction === 'DESC') {
      parts.push(`.thenComparing(${extractor}, Comparator.reverseOrder())`)
    } else {
      const method =
        javaKind === 'int'
          ? 'thenComparingInt'
          : javaKind === 'long'
            ? 'thenComparingLong'
            : javaKind === 'double'
              ? 'thenComparingDouble'
              : 'thenComparing'
      parts.push(`.${method}(${extractor})`)
    }
  })
  return parts.join('')
}

/** Consumer DSLからのJava式生成（Phase 3指示 §6.5） */
export function consumerToJavaExpr(consumer: ConsumerDsl): string {
  if (consumer.kind === 'printValue') return 'System.out::println'
  const accessor = EMPLOYEE_FIELDS[consumer.field]?.accessor ?? `${consumer.field}()`
  return `e -> System.out.println(e.${accessor})`
}

/**
 * Gatherer DSLのJava式（Phase 7指示 §7.4-6）。
 * `Gatherers.windowFixed(3)` / `Gatherers.scan(() -> 0, (acc, n) -> acc + n)` の形で
 * 検証済みDSLから決定的に生成する。lambda引数は既存reduce（`reductionToJavaExpr`）と
 * 同じ予約識別子（acc / e / n / s）の範囲から選ぶ。
 */
export function gathererToJavaExpr(gatherer: GathererDsl): string {
  switch (gatherer.kind) {
    case 'windowFixed':
      return `Gatherers.windowFixed(${gatherer.size})`
    case 'windowSliding':
      return `Gatherers.windowSliding(${gatherer.size})`
    case 'scan':
      return `Gatherers.scan(() -> ${identityToJavaLiteral(gatherer.initial)}, ${gatherAccumulationToJavaExpr(gatherer.accumulation)})`
    case 'fold':
      return `Gatherers.fold(() -> ${identityToJavaLiteral(gatherer.initial)}, ${gatherAccumulationToJavaExpr(gatherer.accumulation)})`
  }
}

/** Gatherer専用AccumulationRuleのBiFunction式（既存reduceのlambda表記規約と同形） */
export function gatherAccumulationToJavaExpr(rule: GatherAccumulationRule): string {
  switch (rule.kind) {
    case 'numericSum':
      return '(acc, n) -> acc + n'
    case 'stringConcat':
      return '(acc, s) -> acc + s'
    case 'employeeFieldSum':
      return `(acc, e) -> acc + e.${rule.field}()`
  }
}

/** Reduction DSLのaccumulator式（Phase 4指示 §8） */
export function reductionToJavaExpr(reduction: ReductionDsl): string {
  switch (reduction.kind) {
    case 'numericSum':
    case 'stringConcat':
      return '(a, b) -> a + b'
    case 'employeeFieldSum':
      return `(acc, e) -> acc + e.${reduction.field}()`
  }
}

/** 3引数reduceのcombiner式（identity型に応じたメソッド参照） */
export function combinerToJavaExpr(identity: ReductionIdentity): string {
  switch (identity.type) {
    case 'int':
      return 'Integer::sum'
    case 'long':
      return 'Long::sum'
    case 'double':
      return 'Double::sum'
    case 'string':
      return 'String::concat'
  }
}

/**
 * Java文字列リテラルの生成（レビュー対応）。
 * 元の文字列値を変更せず、同じ値を表す正当なJava 25文字列リテラルへエスケープする。
 * 生の改行・未エスケープ引用符をJavaコード表示へ混入させない。
 *
 * Phase 6（v0.10 §7.3-1）で**外部入力由来の文字列をJava文字列リテラルへ埋め込む全箇所**へ適用する:
 * string identity、joining delimiter / prefix / suffix、Employeeのname / region、
 * Department宣言のname / division、skills等のString List、`Stream.of` / `String[]`のvalues、
 * mapper prefix。fixture値は安全な文字だけを含むため、適用後も出力は不変である。
 */
export function javaStringLiteral(value: string): string {
  let escaped = ''
  for (const ch of value) {
    switch (ch) {
      case '\\':
        escaped += '\\\\'
        break
      case '"':
        escaped += '\\"'
        break
      case '\n':
        escaped += '\\n'
        break
      case '\r':
        escaped += '\\r'
        break
      case '\t':
        escaped += '\\t'
        break
      case '\b':
        escaped += '\\b'
        break
      case '\f':
        escaped += '\\f'
        break
      default: {
        const code = ch.codePointAt(0) ?? 0
        // その他の制御文字（C0 / DEL / C1）はunicode escapeで安全に表現する
        if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
          escaped += `\\u${code.toString(16).padStart(4, '0')}`
        } else {
          escaped += ch
        }
        break
      }
    }
  }
  return `"${escaped}"`
}

/** identityのJava literal */
export function identityToJavaLiteral(identity: ReductionIdentity): string {
  switch (identity.type) {
    case 'int':
      return String(identity.value)
    case 'long':
      return formatLongLiteral(Number(identity.value))
    case 'double':
      return formatDoubleLiteral(Number(identity.value))
    case 'string':
      return javaStringLiteral(String(identity.value))
  }
}

/** Array Generator DSLのJava式（例: String[]::new） */
export function arrayGeneratorToJavaExpr(generator: ArrayGeneratorDsl): string {
  return `${generator.elementTypeName}[]::new`
}

// ---- Phase 5: Collector AST（指示§7.4）。入れ子式を正当なJava 25構文で生成する ----

/** groupingBy classifierのJava式（method referenceまたはネストfieldのlambda） */
export function classifierToJavaExpr(classifier: ClassifierDsl): string {
  switch (classifier.kind) {
    case 'employeeField':
      return `Employee::${classifier.field}`
    case 'employeeDepartment':
      return 'Employee::department'
    case 'departmentField':
      return `e -> e.department().${classifier.field}()`
  }
}

/** 数値集計Collectorの抽出関数式（例: Employee::salary） */
function numericExtractorExpr(field: string): string {
  return `Employee::${field}`
}

/** flatMappingの展開式（例: e -> e.skills().stream()） */
function flatMappingExpr(mapper: MapperDsl): string {
  if (mapper.kind !== 'fieldAccess') {
    throw new Error(`flatMappingで未対応のmapperです: ${mapper.kind}`)
  }
  const accessor = EMPLOYEE_FIELDS[mapper.field]?.accessor ?? `${mapper.field}()`
  return `e -> e.${accessor}.stream()`
}

/**
 * Collector ASTからのJava式生成（再帰）。
 * 例: Collectors.groupingBy(Employee::region, Collectors.counting())
 */
export function collectorToJavaExpr(dsl: CollectorDsl): string {
  switch (dsl.kind) {
    case 'toList':
      return 'Collectors.toList()'
    case 'toSet':
      return 'Collectors.toSet()'
    case 'toCollection':
      return `Collectors.toCollection(${dsl.supplierId})`
    case 'joining': {
      const args: string[] = []
      if (dsl.delimiter !== null) args.push(javaStringLiteral(dsl.delimiter.value))
      if (dsl.prefix !== null) args.push(javaStringLiteral(dsl.prefix.value))
      if (dsl.suffix !== null) args.push(javaStringLiteral(dsl.suffix.value))
      return `Collectors.joining(${args.join(', ')})`
    }
    case 'counting':
      return 'Collectors.counting()'
    case 'summingInt':
    case 'summingLong':
    case 'summingDouble':
    case 'averagingInt':
    case 'averagingLong':
    case 'averagingDouble':
    case 'summarizingInt':
    case 'summarizingLong':
    case 'summarizingDouble':
      return `Collectors.${dsl.kind}(${numericExtractorExpr(dsl.field)})`
    case 'minBy':
    case 'maxBy':
      return `Collectors.${dsl.kind}(${comparatorToJavaExpr(dsl.comparator)})`
    case 'reducing':
      return `Collectors.reducing(${reductionToJavaExpr(dsl.reduction)})`
    case 'mapping':
      return `Collectors.mapping(${mapperToJavaExpr(dsl.mapper)}, ${collectorToJavaExpr(dsl.downstream)})`
    case 'filtering':
      return `Collectors.filtering(${predicateToJavaExpr(dsl.predicate)}, ${collectorToJavaExpr(dsl.downstream)})`
    case 'flatMapping':
      return `Collectors.flatMapping(${flatMappingExpr(dsl.mapper)}, ${collectorToJavaExpr(dsl.downstream)})`
    case 'collectingAndThen':
      return `Collectors.collectingAndThen(${collectorToJavaExpr(dsl.downstream)}, ${dsl.finisherId})`
    case 'groupingBy': {
      const args = [classifierToJavaExpr(dsl.classifier)]
      if (dsl.mapFactoryId !== null) args.push(dsl.mapFactoryId)
      if (dsl.downstream !== null) args.push(collectorToJavaExpr(dsl.downstream))
      return `Collectors.groupingBy(${args.join(', ')})`
    }
    case 'partitioningBy': {
      const args = [predicateToJavaExpr(dsl.predicate)]
      if (dsl.downstream !== null) args.push(collectorToJavaExpr(dsl.downstream))
      return `Collectors.partitioningBy(${args.join(', ')})`
    }
    case 'teeing':
      return `Collectors.teeing(${collectorToJavaExpr(dsl.left)}, ${collectorToJavaExpr(dsl.right)}, ${dsl.mergerId})`
    case 'toMap': {
      // Phase 8指示 §7.4: 2引数版 = keyMapper, valueMapper / 3引数版 = + mergeFunction /
      // 4引数版 = + mapFactory。省略引数は表示しない（overload形がそのまま読める）
      const args = [classifierToJavaExpr(dsl.keyMapper), toMapValueToJavaExpr(dsl.valueMapper)]
      if (dsl.mergeFunctionId !== null) args.push(TO_MAP_MERGE_META[dsl.mergeFunctionId].javaExpr)
      if (dsl.mapFactoryId !== null) args.push(dsl.mapFactoryId)
      return `Collectors.toMap(${args.join(', ')})`
    }
  }
}

/**
 * toMapのvalueMapper式（Phase 8指示 §7.4）。
 * `identity`は公式API Note（v0.11 §3.1）の`Function.identity()`、
 * `fieldAccess`は既存mapperのJava表記（`Employee::name`等）を流用する。
 */
export function toMapValueToJavaExpr(dsl: ToMapValueDsl): string {
  return dsl.kind === 'identity' ? 'Function.identity()' : `Employee::${dsl.field}`
}

/** 3引数collectの引数列（例: ArrayList::new, ArrayList::add, ArrayList::addAll） */
export function collectTripleToJavaArgs(dsl: CollectTripleDsl): string {
  return `${dsl.supplierId}, ${dsl.accumulatorId}, ${dsl.combinerId}`
}

/** 表示用mapper式（例: Employee::name、n -> "No." + n） */
export function mapperToJavaExpr(mapper: MapperDsl): string {
  switch (mapper.kind) {
    case 'fieldAccess':
      return `Employee::${mapper.field}`
    case 'toUpper':
      return 'String::toUpperCase'
    case 'prefix':
      return `n -> ${javaStringLiteral(mapper.prefix)} + n`
    case 'fieldToPrimitive':
      return `Employee::${mapper.field}`
    case 'listStream':
      return 'List::stream'
    case 'arrayStream':
      return 'Arrays::stream'
  }
}

/** source式（Pipeline先頭行の右辺） */
export function sourceToJavaExpr(source: SourceDsl): string {
  switch (source.kind) {
    case 'collection':
      // collectionIdをJava変数名としてそのまま用いる（既存'employees'の表示は不変。指示§7.6）
      return `${source.collectionId}.stream()`
    case 'arrayObject':
      return `Arrays.stream(${source.arrayId})`
    case 'arrayPrimitive':
      return `Arrays.stream(${source.arrayId})`
    case 'streamOf':
      return `Stream.of(${source.values.map(javaStringLiteral).join(', ')})`
    case 'streamOfPrimitiveArrays':
      return `Stream.of(${source.arrays
        .map((a) => `new ${source.primitive}[]{${a.map((n) => formatPrimitiveLiteral(source.primitive, n)).join(', ')}}`)
        .join(', ')})`
    case 'nestedStringList':
      return `${source.listId}.stream()`
    case 'generate':
      return 'Stream.generate(counter::incrementAndGet)'
    case 'iterate2':
      return `Stream.iterate(${source.seed}, n -> n + ${source.operator.step})`
    case 'iterate3':
      return `Stream.iterate(${source.seed}, n -> n ${source.predicate.operator === 'LTE' ? '<=' : '<'} ${source.predicate.value}, n -> n + ${source.operator.step})`
    case 'range':
      return `IntStream.range(${source.from}, ${source.to})`
    case 'rangeClosed':
      return `IntStream.rangeClosed(${source.from}, ${source.to})`
    case 'empty':
      switch (source.streamType) {
        case 'object':
          return `Stream.<${source.elementTypeName}>empty()`
        case 'int':
          return 'IntStream.empty()'
        case 'long':
          return 'LongStream.empty()'
        case 'double':
          return 'DoubleStream.empty()'
      }
  }
}

function formatPrimitiveLiteral(primitive: 'int' | 'long' | 'double', n: number): string {
  if (primitive === 'long') return `${n}L`
  if (primitive === 'double') return formatDoubleLiteral(n)
  return String(n)
}

function formatLocalDate(iso: string): string {
  const [y, m, d] = iso.split('-').map((part) => Number(part))
  return `LocalDate.of(${y}, ${m}, ${d})`
}

function formatStringList(items: readonly string[]): string {
  return `List.of(${items.map(javaStringLiteral).join(', ')})`
}

/**
 * 部署の同一性は`name`+`division`の組で判定する（v0.10 §7.3-2、Phase 6指示 §7.7-2）。
 * 既存fixtureの組は固定名（開発部 = development / 営業部 = sales）を維持し、
 * 固定表にない組にはdatasetの出現順（組の初出順）で`dept1`, `dept2`…を割り当てる。
 * 採番は未対応組のみを数える。`deptN`は固定名・Java予約語と衝突しない。
 */
const FIXED_DEPARTMENT_VAR_NAMES: readonly {
  readonly name: string
  readonly division: string
  readonly varName: string
}[] = [
  { name: '開発部', division: '技術本部', varName: 'development' },
  { name: '営業部', division: '営業本部', varName: 'sales' },
]

function departmentKey(department: DepartmentValue): string {
  return JSON.stringify([department.name, department.division])
}

/** dataset内の部署（name + divisionの組）へJava変数名を出現順に割り当てる */
export function assignDepartmentVarNames(
  employeeDataset: readonly DatasetElement[],
): ReadonlyMap<string, string> {
  const assigned = new Map<string, string>()
  let generatedCount = 0
  for (const element of employeeDataset) {
    const department = element.value.department
    const key = departmentKey(department)
    if (assigned.has(key)) continue
    const fixed = FIXED_DEPARTMENT_VAR_NAMES.find(
      (entry) => entry.name === department.name && entry.division === department.division,
    )
    if (fixed) {
      assigned.set(key, fixed.varName)
      continue
    }
    generatedCount += 1
    assigned.set(key, `dept${generatedCount}`)
  }
  return assigned
}

function employeeConstructorLines(
  value: EmployeeValue,
  isLast: boolean,
  departmentVars: ReadonlyMap<string, string>,
): string[] {
  // 一般化後、Department引数にnullが現れることはない（datasetの全部署へ変数名を割り当てる）
  const deptVar = departmentVars.get(departmentKey(value.department)) ?? 'null'
  const line1 = `        new Employee(${javaStringLiteral(value.name)}, ${value.age}, ${formatLongLiteral(value.salary)}, ${formatDoubleLiteral(value.evaluation)}, ${javaStringLiteral(value.region)},`
  const line2 = `                ${formatLocalDate(value.hireDate)}, ${deptVar}, ${formatStringList(value.skills)})${isLast ? ');' : ','}`
  return [line1, line2]
}

const RECORD_LINES = [
  'record Department(String name, String division) {}',
  'record Employee(',
  '        String name,',
  '        int age,',
  '        long salary,',
  '        double evaluation,',
  '        String region,',
  '        LocalDate hireDate,',
  '        Department department,',
  '        List<String> skills) {}',
] as const

/** Collector AST中のteeing merger IDを収集する（再帰） */
function collectMergerIds(dsl: CollectorDsl, out: Set<string>): void {
  switch (dsl.kind) {
    case 'teeing':
      out.add(dsl.mergerId)
      collectMergerIds(dsl.left, out)
      collectMergerIds(dsl.right, out)
      break
    case 'mapping':
    case 'filtering':
    case 'flatMapping':
    case 'collectingAndThen':
      collectMergerIds(dsl.downstream, out)
      break
    case 'groupingBy':
    case 'partitioningBy':
      if (dsl.downstream !== null) collectMergerIds(dsl.downstream, out)
      break
    default:
      break
  }
}

/**
 * teeing mergerが生成するrecordの宣言行（例: record SalarySummary(long employeeCount, double averageSalary) {}）。
 * teeingを含まないPipelineでは空配列を返し、既存表示を変えない。
 */
function mergerRecordDeclLines(nodes: readonly JavaCodeNodeSource[]): string[] {
  const ids = new Set<string>()
  for (const node of nodes) {
    if (node.collector) collectMergerIds(node.collector, ids)
  }
  const lines: string[] = []
  for (const id of ids) {
    const record = TEEING_MERGER_RECORDS[id as keyof typeof TEEING_MERGER_RECORDS]
    if (!record) continue
    const params = record.fields.map((f) => `${f.javaType} ${f.name}`).join(', ')
    lines.push(`record ${record.recordName}(${params}) {}`)
  }
  return lines
}

/** sourceが必要とする宣言行（record定義・dataset・配列・nested list等） */
function sourceDeclLines(source: SourceDsl, employeeDataset: readonly DatasetElement[]): string[] {
  switch (source.kind) {
    case 'collection': {
      const lines: string[] = [...RECORD_LINES, '']
      const varName = source.collectionId
      if (employeeDataset.length === 0) {
        lines.push(`List<Employee> ${varName} = List.of();`)
        return lines
      }
      const departmentVars = assignDepartmentVarNames(employeeDataset)
      const declared = new Set<string>()
      for (const element of employeeDataset) {
        const department = element.value.department
        const key = departmentKey(department)
        if (declared.has(key)) continue
        declared.add(key)
        const varName = departmentVars.get(key)
        if (!varName) continue
        lines.push(
          `Department ${varName} = new Department(${javaStringLiteral(department.name)}, ${javaStringLiteral(department.division)});`,
        )
      }
      lines.push(`List<Employee> ${varName} = List.of(`)
      employeeDataset.forEach((element, i) => {
        lines.push(
          ...employeeConstructorLines(
            element.value,
            i === employeeDataset.length - 1,
            departmentVars,
          ),
        )
      })
      return lines
    }
    case 'arrayObject':
      return [`String[] ${source.arrayId} = { ${source.values.map(javaStringLiteral).join(', ')} };`]
    case 'arrayPrimitive':
      return [
        `${source.primitive}[] ${source.arrayId} = { ${source.values
          .map((n) => formatPrimitiveLiteral(source.primitive, n))
          .join(', ')} };`,
      ]
    case 'nestedStringList': {
      const lines = [`List<List<String>> ${source.listId} = List.of(`]
      source.values.forEach((v, i) => {
        lines.push(`        ${formatStringList(v)}${i === source.values.length - 1 ? ');' : ','}`)
      })
      return lines
    }
    case 'generate':
      return ['AtomicInteger counter = new AtomicInteger(0);']
    default:
      return []
  }
}

/** 中間・終端ノードの行テキスト */
function nodeLineText(node: JavaCodeNodeSource): string {
  switch (node.operationId) {
    case 'filter':
      if (!node.predicate) throw new Error(`filter node ${node.nodeId} has no predicate`)
      return `        .filter(${predicateToJavaExpr(node.predicate)})`
    case 'boxed':
      return '        .boxed()'
    case 'toList':
      return '        .toList();'
    case 'map':
    case 'mapToInt':
    case 'mapToLong':
    case 'mapToDouble':
    case 'mapToObj':
    case 'flatMap':
    case 'flatMapToInt':
    case 'flatMapToLong':
    case 'flatMapToDouble':
      if (!node.mapper) throw new Error(`node ${node.nodeId} has no mapper`)
      return `        .${node.operationId}(${mapperToJavaExpr(node.mapper)})`
    case 'distinct':
      return '        .distinct()'
    case 'gather':
      if (!node.gatherer) throw new Error(`gather node ${node.nodeId} has no gatherer`)
      return `        .gather(${gathererToJavaExpr(node.gatherer)})`
    case 'sorted':
      return node.comparator && node.comparator.kind !== 'natural'
        ? `        .sorted(${comparatorToJavaExpr(node.comparator)})`
        : '        .sorted()'
    case 'limit':
    case 'skip':
      // 引数型はlongだが、int literalはJava上正当（自動拡大変換）。DSLにない値を補わない
      if (node.count === null) throw new Error(`node ${node.nodeId} has no count`)
      return `        .${node.operationId}(${node.count})`
    case 'takeWhile':
    case 'dropWhile':
      if (!node.predicate) throw new Error(`node ${node.nodeId} has no predicate`)
      return `        .${node.operationId}(${predicateToJavaExpr(node.predicate)})`
    case 'peek':
      if (!node.consumer) throw new Error(`node ${node.nodeId} has no consumer`)
      return `        .peek(${consumerToJavaExpr(node.consumer)})`
    // ---- Phase 4 terminal（指示§8） ----
    case 'count':
      return '        .count();'
    case 'findFirst':
      return '        .findFirst();'
    case 'findAny':
      return '        .findAny();'
    case 'sum':
      return '        .sum();'
    case 'average':
      return '        .average();'
    case 'summaryStatistics':
      return '        .summaryStatistics();'
    case 'min':
    case 'max':
      return node.comparator
        ? `        .${node.operationId}(${comparatorToJavaExpr(node.comparator)});`
        : `        .${node.operationId}();`
    case 'anyMatch':
    case 'allMatch':
    case 'noneMatch':
      if (!node.predicate) throw new Error(`node ${node.nodeId} has no predicate`)
      return `        .${node.operationId}(${predicateToJavaExpr(node.predicate)});`
    case 'reduce': {
      if (!node.reduction) throw new Error(`node ${node.nodeId} has no reduction`)
      const parts: string[] = []
      if (node.identity) parts.push(identityToJavaLiteral(node.identity))
      parts.push(reductionToJavaExpr(node.reduction))
      if (node.hasCombiner) {
        if (!node.identity) throw new Error(`node ${node.nodeId} combiner requires identity`)
        parts.push(combinerToJavaExpr(node.identity))
      }
      return `        .reduce(${parts.join(', ')});`
    }
    case 'toArray':
      return node.arrayGenerator
        ? `        .toArray(${arrayGeneratorToJavaExpr(node.arrayGenerator)});`
        : '        .toArray();'
    case 'forEach':
    case 'forEachOrdered':
      if (!node.consumer) throw new Error(`node ${node.nodeId} has no consumer`)
      return `        .${node.operationId}(${consumerToJavaExpr(node.consumer)});`
    case 'collect':
      // 行とノードの対応を崩さないため、collect行が長くなっても1ノード=1行を維持する（§7.4）
      if (!node.collector) throw new Error(`collect node ${node.nodeId} has no collector`)
      return `        .collect(${collectorToJavaExpr(node.collector)});`
    case 'collectTriple':
      if (!node.collectTriple) throw new Error(`collect node ${node.nodeId} has no collectTriple`)
      return `        .collect(${collectTripleToJavaArgs(node.collectTriple)});`
    default:
      throw new Error(`コード生成未対応のoperationです: ${node.operationId}`)
  }
}

/**
 * record定義、dataset、Pipelineコードを1つのJavaコード表示として生成する。
 * 同じ検証済みASTからの生成物であり、評価・型遷移・説明と食い違わないこと。
 */
export function generateJavaCode(input: JavaCodeInput): readonly JavaCodeLine[] {
  const lines: JavaCodeLine[] = []
  let staticSeq = 0
  const pushStatic = (text: string) => {
    staticSeq += 1
    lines.push({
      lineId: `line-static-${String(staticSeq).padStart(3, '0')}`,
      text,
      nodeId: null,
    })
  }

  const decls = sourceDeclLines(input.source, input.employeeDataset)
  for (const text of decls) pushStatic(text)
  // teeing mergerが生成するrecordの宣言（既存Employee / Department record表示と同じ規約。§7.4）
  const mergerRecords = mergerRecordDeclLines(input.nodes)
  if (mergerRecords.length > 0) {
    if (decls.length > 0) pushStatic('')
    for (const text of mergerRecords) pushStatic(text)
  }
  if (decls.length > 0 || mergerRecords.length > 0) pushStatic('')

  for (const node of input.nodes) {
    if (node.role === 'source') {
      // void結果（forEach系）は代入文にせず、source式だけの文にする（正当なJava構文）
      const isVoid = input.resultType.kind === 'void'
      lines.push({
        lineId: lineIdForNode(node.nodeId),
        text: isVoid
          ? sourceToJavaExpr(input.source)
          : `${formatTypeRef(input.resultType)} result = ${sourceToJavaExpr(input.source)}`,
        nodeId: node.nodeId,
      })
    } else {
      lines.push({
        lineId: lineIdForNode(node.nodeId),
        text: nodeLineText(node),
        nodeId: node.nodeId,
      })
    }
  }
  return lines
}
