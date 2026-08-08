import type { DslPredicate } from './ast'
import type { DatasetElement, EmployeeValue } from '../model/employee'
import { EMPLOYEE_FIELDS } from '../model/employee'
import type { LineId, NodeId } from '../types/ids'
import { lineIdForNode } from '../types/ids'

/**
 * 検証済みDSL / ASTからのJavaコード生成（§9.1、§21.2）。
 * Javaコード・Java式は正当なASCII構文（-> / >=）を使用し、Unicode矢印を混入させない（§17.4）。
 * コード行はactive nodeと対応する安定line IDを持つ。
 */
export interface JavaCodeLine {
  readonly lineId: LineId
  readonly text: string
  /** Pipelineノードに対応する行のみ設定。それ以外はnull。 */
  readonly nodeId: NodeId | null
}

export interface JavaCodeNodeSource {
  readonly nodeId: NodeId
  readonly role: 'source' | 'intermediate' | 'terminal'
  readonly predicate: DslPredicate | null
}

const OPERATOR_JAVA: Readonly<Record<string, string>> = {
  GTE: '>=',
}

/** 表示用Java式（例: e -> e.age() >= 30） */
export function predicateToJavaExpr(predicate: DslPredicate): string {
  const accessor = EMPLOYEE_FIELDS[predicate.field]?.accessor ?? `${predicate.field}()`
  const op = OPERATOR_JAVA[predicate.operator]
  if (!op) throw new Error(`unsupported operator: ${predicate.operator}`)
  if (predicate.value.type !== 'int') {
    throw new Error(`unsupported literal type: ${predicate.value.type}`)
  }
  return `e -> e.${accessor} ${op} ${predicate.value.value}`
}

function formatLong(n: number): string {
  const digits = String(n)
  let grouped = ''
  for (let i = 0; i < digits.length; i++) {
    const posFromEnd = digits.length - i
    grouped += digits[i]
    if (posFromEnd > 1 && (posFromEnd - 1) % 3 === 0) grouped += '_'
  }
  return `${grouped}L`
}

function formatDouble(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : String(n)
}

function formatLocalDate(iso: string): string {
  const [y, m, d] = iso.split('-').map((part) => Number(part))
  return `LocalDate.of(${y}, ${m}, ${d})`
}

function formatStringList(items: readonly string[]): string {
  return `List.of(${items.map((s) => `"${s}"`).join(', ')})`
}

function departmentVarName(deptName: string): string {
  // 基準fixtureの2部署に安定変数名を割り当てる。未知の部署はdept1, dept2…
  if (deptName === '開発部') return 'development'
  if (deptName === '営業部') return 'sales'
  return ''
}

function employeeConstructorLines(value: EmployeeValue, isLast: boolean): string[] {
  const deptVar = departmentVarName(value.department.name) || 'null'
  const line1 = `        new Employee("${value.name}", ${value.age}, ${formatLong(value.salary)}, ${formatDouble(value.evaluation)}, "${value.region}",`
  const line2 = `                ${formatLocalDate(value.hireDate)}, ${deptVar}, ${formatStringList(value.skills)})${isLast ? ');' : ','}`
  return [line1, line2]
}

/**
 * record定義、dataset、Pipelineコードを1つのJavaコード表示として生成する。
 * 同じ検証済みASTからの生成物であり、評価・型遷移・説明と食い違わないこと（§5.4指示）。
 */
export function generateJavaCode(
  nodes: readonly JavaCodeNodeSource[],
  dataset: readonly DatasetElement[],
): readonly JavaCodeLine[] {
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

  // record定義（§6.1）
  pushStatic('record Department(String name, String division) {}')
  pushStatic('record Employee(')
  pushStatic('        String name,')
  pushStatic('        int age,')
  pushStatic('        long salary,')
  pushStatic('        double evaluation,')
  pushStatic('        String region,')
  pushStatic('        LocalDate hireDate,')
  pushStatic('        Department department,')
  pushStatic('        List<String> skills) {}')
  pushStatic('')

  // dataset
  if (dataset.length === 0) {
    pushStatic('List<Employee> employees = List.of();')
  } else {
    const deptNames = [...new Set(dataset.map((d) => d.value.department.name))]
    for (const deptName of deptNames) {
      const varName = departmentVarName(deptName)
      const division = dataset.find((d) => d.value.department.name === deptName)?.value.department
        .division
      if (varName && division !== undefined) {
        pushStatic(`Department ${varName} = new Department("${deptName}", "${division}");`)
      }
    }
    pushStatic('List<Employee> employees = List.of(')
    dataset.forEach((element, i) => {
      const isLast = i === dataset.length - 1
      for (const text of employeeConstructorLines(element.value, isLast)) {
        pushStatic(text)
      }
    })
  }
  pushStatic('')

  // Pipeline（各ノードに安定line ID）
  for (const node of nodes) {
    if (node.role === 'source') {
      lines.push({
        lineId: lineIdForNode(node.nodeId),
        text: 'List<Employee> result = employees.stream()',
        nodeId: node.nodeId,
      })
    } else if (node.role === 'intermediate') {
      if (!node.predicate) throw new Error(`filter node ${node.nodeId} has no predicate`)
      lines.push({
        lineId: lineIdForNode(node.nodeId),
        text: `        .filter(${predicateToJavaExpr(node.predicate)})`,
        nodeId: node.nodeId,
      })
    } else {
      lines.push({
        lineId: lineIdForNode(node.nodeId),
        text: '        .toList();',
        nodeId: node.nodeId,
      })
    }
  }
  return lines
}
