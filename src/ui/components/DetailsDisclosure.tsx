import type { SessionState } from '../../application/session'

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
  return (
    <section
      className="panel details-disclosure"
      data-snapshot-id={snapshot.snapshotId}
      data-testid="details-disclosure"
    >
      <details>
        <summary>詳細（record定義・元データ・JDK補足）</summary>
        <h4>record定義</h4>
        <pre className="java-code">{RECORD_DEFINITIONS}</pre>
        <h4>元データ（{scenario.pipeline.dataset.length}件）</h4>
        {scenario.pipeline.dataset.length === 0 ? (
          <p>入力は0件です。</p>
        ) : (
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
              {scenario.pipeline.dataset.map((element) => (
                <tr key={element.elementId}>
                  <td>{element.elementId}</td>
                  <td>{element.value.name}</td>
                  <td>{element.value.age}</td>
                  <td>{element.value.salary.toLocaleString('en-US')}</td>
                  <td>{element.value.region}</td>
                  <td>{element.value.department.name}</td>
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
