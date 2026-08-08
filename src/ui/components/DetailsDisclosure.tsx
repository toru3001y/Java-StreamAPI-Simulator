import type { SessionState } from '../../application/session'
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

/** DetailsDisclosure（§17.1）: record定義、元データ、補足。重複情報は置かない。 */
export function DetailsDisclosure({ state }: { state: SessionState }) {
  const { snapshot, scenario } = state
  const dataset = scenario.pipeline.dataset
  const isEmployeeSource = scenario.pipeline.sourceDsl.kind === 'collection'
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
