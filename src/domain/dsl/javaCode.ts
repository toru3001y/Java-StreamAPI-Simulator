import type { DslPredicate } from './ast'
import type { ComparatorDsl, ComparatorKey } from './comparatorAst'
import { COMPARATOR_FIELD_JAVA_KIND } from './comparatorAst'
import type { ConsumerDsl } from './consumerAst'
import type { MapperDsl } from './mapperAst'
import type { SourceDsl } from './sourceAst'
import type { DatasetElement, EmployeeValue } from '../model/employee'
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

/** 表示用Java式（例: e -> e.age() >= 30、n -> n < 5） */
export function predicateToJavaExpr(predicate: DslPredicate): string {
  const op = operatorToJava(predicate.operator)
  if (predicate.value.type !== 'int') {
    throw new Error(`unsupported literal type: ${predicate.value.type}`)
  }
  if (predicate.kind === 'currentValueCompare') {
    return `n -> n ${op} ${predicate.value.value}`
  }
  const accessor = EMPLOYEE_FIELDS[predicate.field]?.accessor ?? `${predicate.field}()`
  return `e -> e.${accessor} ${op} ${predicate.value.value}`
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

/** 表示用mapper式（例: Employee::name、n -> "No." + n） */
export function mapperToJavaExpr(mapper: MapperDsl): string {
  switch (mapper.kind) {
    case 'fieldAccess':
      return `Employee::${mapper.field}`
    case 'toUpper':
      return 'String::toUpperCase'
    case 'prefix':
      return `n -> "${mapper.prefix}" + n`
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
      return 'employees.stream()'
    case 'arrayObject':
      return `Arrays.stream(${source.arrayId})`
    case 'arrayPrimitive':
      return `Arrays.stream(${source.arrayId})`
    case 'streamOf':
      return `Stream.of(${source.values.map((s) => `"${s}"`).join(', ')})`
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
  return `List.of(${items.map((s) => `"${s}"`).join(', ')})`
}

function departmentVarName(deptName: string): string {
  if (deptName === '開発部') return 'development'
  if (deptName === '営業部') return 'sales'
  return ''
}

function employeeConstructorLines(value: EmployeeValue, isLast: boolean): string[] {
  const deptVar = departmentVarName(value.department.name) || 'null'
  const line1 = `        new Employee("${value.name}", ${value.age}, ${formatLongLiteral(value.salary)}, ${formatDoubleLiteral(value.evaluation)}, "${value.region}",`
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

/** sourceが必要とする宣言行（record定義・dataset・配列・nested list等） */
function sourceDeclLines(source: SourceDsl, employeeDataset: readonly DatasetElement[]): string[] {
  switch (source.kind) {
    case 'collection': {
      const lines: string[] = [...RECORD_LINES, '']
      if (employeeDataset.length === 0) {
        lines.push('List<Employee> employees = List.of();')
        return lines
      }
      const deptNames = [...new Set(employeeDataset.map((d) => d.value.department.name))]
      for (const deptName of deptNames) {
        const varName = departmentVarName(deptName)
        const division = employeeDataset.find((d) => d.value.department.name === deptName)?.value
          .department.division
        if (varName && division !== undefined) {
          lines.push(`Department ${varName} = new Department("${deptName}", "${division}");`)
        }
      }
      lines.push('List<Employee> employees = List.of(')
      employeeDataset.forEach((element, i) => {
        lines.push(...employeeConstructorLines(element.value, i === employeeDataset.length - 1))
      })
      return lines
    }
    case 'arrayObject':
      return [`String[] ${source.arrayId} = { ${source.values.map((s) => `"${s}"`).join(', ')} };`]
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
  if (decls.length > 0) pushStatic('')

  for (const node of input.nodes) {
    if (node.role === 'source') {
      lines.push({
        lineId: lineIdForNode(node.nodeId),
        text: `${formatTypeRef(input.resultType)} result = ${sourceToJavaExpr(input.source)}`,
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
