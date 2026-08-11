import type { SessionState } from '../../application/session'
import type { CollectorDsl } from '../../domain/dsl/collectorAst'
import { TEEING_MERGER_RECORDS } from '../../domain/dsl/collectorAst'
import { formatSimValue } from '../../domain/model/value'

const RECORD_DEFINITIONS = `record Department(String name, String division) {}
record Employee(
        String name,
        int age,
        long salary,
        double evaluation,
        String region,
        LocalDate hireDate,
        Department department,
        List<String> skills) {}`

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

/** DetailsDisclosure（§17.1）: record定義、元データ、補足。重複情報は置かない。 */
export function DetailsDisclosure({ state }: { state: SessionState }) {
  const { snapshot, scenario } = state
  const dataset = scenario.pipeline.dataset
  const isEmployeeSource = scenario.pipeline.sourceDsl.kind === 'collection'
  // teeing mergerが生成するrecord（SalarySummary等）の定義を表示する（Phase 5指示 §10.2）
  const mergerIds = new Set<string>()
  for (const node of scenario.pipeline.nodes) {
    if (node.collector) collectMergerIds(node.collector, mergerIds)
  }
  const mergerRecordDefinitions = [...mergerIds].flatMap((id) => {
    const record = TEEING_MERGER_RECORDS[id as keyof typeof TEEING_MERGER_RECORDS]
    if (!record) return []
    const params = record.fields.map((f) => `${f.javaType} ${f.name}`).join(', ')
    return [`record ${record.recordName}(${params}) {}`]
  })
  return (
    <section
      className="panel details-disclosure"
      data-snapshot-id={snapshot.snapshotId}
      data-testid="details-disclosure"
    >
      <details>
        <summary>詳細（record定義・元データ・JDK補足）</summary>
        {isEmployeeSource && (
          <>
            <h4>record定義</h4>
            <pre className="java-code">{RECORD_DEFINITIONS}</pre>
            {mergerRecordDefinitions.length > 0 && (
              <pre className="java-code" data-testid="merger-record-definitions">
                {mergerRecordDefinitions.join('\n')}
              </pre>
            )}
          </>
        )}
        <h4>元データ（{dataset.length}件）</h4>
        {dataset.length === 0 ? (
          <p>入力は0件です。</p>
        ) : isEmployeeSource ? (
          <table className="dataset-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>name</th>
                <th>age</th>
                <th>salary</th>
                <th>region</th>
                <th>department</th>
              </tr>
            </thead>
            <tbody>
              {dataset.map((element) => {
                if (element.value.kind !== 'employee') return null
                const e = element.value.value
                return (
                  <tr key={element.elementId}>
                    <td>{element.elementId}</td>
                    <td>{e.name}</td>
                    <td>{e.age}</td>
                    <td>{e.salary.toLocaleString('en-US')}</td>
                    <td>{e.region}</td>
                    <td>{e.department.name}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <table className="dataset-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>index</th>
                <th>値</th>
              </tr>
            </thead>
            <tbody>
              {dataset.map((element) => (
                <tr key={element.elementId}>
                  <td>{element.elementId}</td>
                  <td>{element.index}</td>
                  <td>{formatSimValue(element.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <h4>JDK補足</h4>
        <ul>
          {scenario.jdkNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </details>
    </section>
  )
}
