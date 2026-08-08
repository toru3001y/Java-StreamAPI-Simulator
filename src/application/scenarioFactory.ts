import type { ScenarioCandidate } from '../providers/scenarioProvider'
import type { OperationCatalog } from '../domain/catalog/operationCatalog'
import type { TemplateRegistry } from '../domain/template/templateRegistry'
import { instantiateTemplate } from '../domain/template/instantiate'
import type { Scenario } from '../domain/scenario/scenario'
import type { Result } from '../domain/types/result'
import { fail, ok } from '../domain/types/result'
import { deepFreeze } from '../domain/util/deepFreeze'

/**
 * 検証前のScenarioCandidateを検証し、確定Scenarioへ変換する（§8.3、§10.1）。
 * Providerの返す値は候補であり、正解ではない（§5.3）。
 */
export function buildScenario(
  registry: TemplateRegistry,
  catalog: OperationCatalog,
  candidate: ScenarioCandidate,
): Result<Scenario> {
  const template = registry.get(candidate.templateId, candidate.templateVersion)
  const definitionResult = instantiateTemplate(registry, catalog, {
    templateId: candidate.templateId,
    templateVersion: candidate.templateVersion,
    dataset: candidate.dataset,
    dslParameters: candidate.dslParameters,
    mode: candidate.mode,
    revision: candidate.revision,
  })
  if (!definitionResult.ok) return fail(definitionResult.issues)
  if (!template) return fail([])
  const scenario: Scenario = {
    scenarioId: `${candidate.templateId}:${candidate.mode}:${candidate.revision}`,
    title: candidate.title,
    description: candidate.description,
    targetOperationId: template.targetOperationId,
    mode: candidate.mode,
    source: {
      kind: template.sourceDefinition.kind,
      ordered: template.sourceDefinition.ordered,
      finite: template.sourceDefinition.finite,
    },
    targetNodeId: template.targetNodeId,
    pipeline: definitionResult.value,
    jdkNotes: template.jdkNotes,
    provenance: candidate.provenance,
    revision: candidate.revision,
  }
  return ok(deepFreeze(scenario))
}
