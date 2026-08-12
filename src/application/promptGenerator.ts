import type { PipelineTemplate } from '../domain/template/pipelineTemplate'
import type { ScenarioMode } from '../domain/scenario/scenario'
import { SCENARIO_MODE_LABELS } from '../domain/scenario/scenario'
import {
  GENERATED_CODE_IDENTIFIERS,
  IDENTIFIER_PATTERN,
  buildTemplateContract,
  collectorVariantsFor,
  validateBySpec,
  type SpecNode,
  type TemplateContract,
  type VariantSpec,
} from './importContract'
import { COLLECTOR_MAX_DEPTH } from '../domain/dsl/collectorAst'
import { SNAPSHOT_LIMIT } from '../domain/template/instantiate'
import type { EmployeeValue } from '../domain/model/employee'

/**
 * Prompt Generator（v0.10 §5.2、Phase 6指示 §8）。
 *
 * 選択中の操作・モード・templateに対する生成依頼文を組み立てる。
 * **許可DSLの言語化はImport Contractのspec木からのみ導出する**（機械可読な許可範囲を重複定義しない）。
 * 教材制約の説明は検証と同内容を目指した補助的な自然文であり、二重定義禁止の対象外（v0.10 §5.2）。
 */

export interface PromptExample {
  readonly dataset: readonly EmployeeValue[] | null
  readonly dslParameters: Readonly<Record<string, unknown>>
  readonly title: string
  readonly description: string
}

export interface PromptInput {
  readonly template: PipelineTemplate
  readonly mode: ScenarioMode
  readonly dslVersion: string
  readonly example: PromptExample
}

/** slot種別の日本語ラベル（表示専用） */
const ROLE_LABELS: Readonly<Record<string, string>> = {
  source: 'source DSL',
  predicate: 'Predicate',
  mapper: 'Mapper',
  comparator: 'Comparator',
  consumer: 'Consumer',
  count: 'limit / skipの引数',
  reduction: 'Reduction',
  identity: 'identity',
  arrayGenerator: 'Array Generator',
  collector: 'Collector',
  collectTriple: '3引数collect',
}

/**
 * モード別の教材制約の説明（補助的な自然文）。
 * 検証の正は`instantiateTemplate`のmode別手続き検証であり、この文面は説明のみである。
 */
const MODE_NOTES: Readonly<Record<ScenarioMode, readonly string[]>> = {
  standard: ['入力は1件以上必要です。'],
  midEmpty: ['終端操作へ到達する要素が0件になるようにしてください（前段で全件除外される等）。'],
  emptySource: ['入力は0件である必要があります。'],
}

/** 対象操作ごとの標準モード教材制約の説明（補助的な自然文） */
const STANDARD_OPERATION_NOTES: Readonly<Record<string, string>> = {
  filter: '対象filterで通過（true）と除外（false）の双方が発生するデータにしてください。',
  map: '変換前と変換後の表示が視覚的に異なるデータにしてください。',
  mapToInt: '変換前と変換後の表示が視覚的に異なるデータにしてください。',
  mapToLong: '変換前と変換後の表示が視覚的に異なるデータにしてください。',
  mapToDouble: '変換前と変換後の表示が視覚的に異なるデータにしてください。',
  mapToObj: '変換前と変換後の表示が視覚的に異なるデータにしてください。',
  flatMap: '複数の子要素を生成する親要素を含めてください。',
  flatMapToInt: '複数の子要素を生成する親要素を含めてください。',
  flatMapToLong: '複数の子要素を生成する親要素を含めてください。',
  flatMapToDouble: '複数の子要素を生成する親要素を含めてください。',
  distinct: '重複する要素を含めてください。',
  sorted: '事前に整列済みではないデータにしてください（Comparator指定時は同値キーの別要素も含めてください）。',
  limit: '元要素数がlimit値より多くなるデータにしてください。',
  takeWhile: '最初にfalseとなる要素の後に、Predicateならtrueとなる値を含めてください。',
  dropWhile: '最初にfalseとなる要素の後に、Predicateならtrueとなる値を含めてください。',
  peek: 'Consumerが1回以上呼ばれるデータにしてください。',
}

function describeUnion(
  discriminator: 'kind' | 'type',
  variants: Readonly<Record<string, VariantSpec>>,
  indent: string,
): string[] {
  const lines: string[] = []
  for (const [key, variant] of Object.entries(variants)) {
    lines.push(`${indent}- ${discriminator}: "${key}"`)
    for (const [field, spec] of Object.entries(variant.fields)) {
      lines.push(`${indent}  - ${field}:`)
      lines.push(...describeSpec(spec, `${indent}    `))
    }
    if (variant.refine) lines.push(`${indent}  - 注意: ${variant.refine.note}`)
  }
  return lines
}

/** Import Contractのspec木を自然文へ言語化する（許可範囲の定義はContract側にのみ存在する） */
export function describeSpec(spec: SpecNode, indent = ''): string[] {
  switch (spec.node) {
    case 'const':
      return [`${indent}固定値 "${spec.value}"`]
    case 'enum':
      return [`${indent}次のいずれか: ${spec.values.map((v) => `"${v}"`).join(', ')}`]
    case 'string':
      return [`${indent}文字列（${spec.min}〜${spec.max} UTF-16 code unit。制御文字・双方向制御文字は不可）`]
    case 'identifier':
      return [
        `${indent}Java変数名として使える文字列（${IDENTIFIER_PATTERN.source}。Java予約語と ${GENERATED_CODE_IDENTIFIERS.join(' / ')} は不可）`,
      ]
    case 'int':
      return [`${indent}整数（Java int範囲: -2147483648〜2147483647）`]
    case 'long':
      return [`${indent}整数（safe integer範囲: -9007199254740991〜9007199254740991）`]
    case 'double':
      return [`${indent}数値（0、または絶対値1e-6〜1e15の有限値。-0は不可）`]
    case 'count':
      return [`${indent}0〜2147483647の整数`]
    case 'numberByPrimitive':
      return [`${indent}数値（値域は同じオブジェクトのprimitiveで決まる）`]
    case 'boundedInt':
      return [`${indent}${spec.min}〜${spec.max}の整数`]
    case 'boundedDouble':
      return [`${indent}${spec.min}〜${spec.max}の数値（NaN / Infinity / -0は不可）`]
    case 'isoDate':
      return [`${indent}YYYY-MM-DD形式の実在日（${spec.min}〜${spec.max}）`]
    case 'array': {
      const unique =
        spec.unique === 'field'
          ? '・同一fieldの重複不可'
          : spec.unique === 'value'
            ? '・重複不可'
            : ''
      return [
        `${indent}配列（${spec.min}〜${spec.max}件${unique}）。各要素:`,
        ...describeSpec(spec.item, `${indent}  `),
      ]
    }
    case 'object': {
      const lines = [`${indent}オブジェクト（キーは ${Object.keys(spec.fields).join(', ')} のみ）:`]
      for (const [field, fieldSpec] of Object.entries(spec.fields)) {
        lines.push(`${indent}  - ${field}:`)
        lines.push(...describeSpec(fieldSpec, `${indent}    `))
      }
      if (spec.refine) lines.push(`${indent}  - 注意: ${spec.refine.note}`)
      return lines
    }
    case 'unionByKind':
      return [`${indent}kindで分岐するオブジェクト:`, ...describeUnion('kind', spec.variants, indent)]
    case 'unionByType':
      return [`${indent}typeで分岐するオブジェクト:`, ...describeUnion('type', spec.variants, indent)]
    case 'nullable':
      return [`${indent}null、または次のいずれか:`, ...describeSpec(spec.inner, `${indent}  `)]
    case 'collector': {
      const variants = collectorVariantsFor(spec.allowedKinds)
      const lines = [
        `${indent}Collector（kindで分岐。入れ子は最大${COLLECTOR_MAX_DEPTH}段。downstream / left / rightにも同じ許可kindのCollectorを指定する）:`,
      ]
      for (const [kind, variant] of Object.entries(variants)) {
        lines.push(`${indent}- kind: "${kind}"`)
        for (const [field, fieldSpec] of Object.entries(variant.fields)) {
          if (fieldSpec.node === 'collector') {
            lines.push(`${indent}  - ${field}: 許可kindのCollector`)
            continue
          }
          if (fieldSpec.node === 'nullable' && fieldSpec.inner.node === 'collector') {
            lines.push(`${indent}  - ${field}: null または許可kindのCollector`)
            continue
          }
          lines.push(`${indent}  - ${field}:`)
          lines.push(...describeSpec(fieldSpec, `${indent}    `))
        }
        if (variant.refine) lines.push(`${indent}  - 注意: ${variant.refine.note}`)
      }
      return lines
    }
  }
}

/**
 * dataset契約の説明。**Contractの`datasetSpec`だけ**から言語化する
 * （フィールド構造・値域をここで再記述しない）。
 */
function datasetContractLines(contract: TemplateContract): string[] {
  if (!contract.datasetSpec) return []
  return [
    '## dataset契約',
    '',
    '- dataset:',
    ...describeSpec(contract.datasetSpec, '  '),
    `- ${contract.reservedDatasetKeys.join(' / ')} はアプリが付与するため含めないでください。`,
    '',
  ]
}

function slotLines(contract: TemplateContract): string[] {
  const lines: string[] = ['## スロットごとの許可DSL', '']
  for (const slot of contract.slots) {
    const role = ROLE_LABELS[slot.role] ?? slot.role
    lines.push(`### ${slot.slotId}（${role}・${slot.required ? '必須' : '省略可'}）`)
    lines.push('')
    lines.push(...describeSpec(slot.spec, ''))
    lines.push('')
  }
  return lines
}

/**
 * 例文をContractの長さ制約内へ収める。
 * fixtureのtitleにはContractの上限（60）を超えるものがあるため、
 * 超過時は「そのまま貼り付けても通る」代替文へ差し替える（例は必ず有効なJSONにする）。
 */
function exampleText(spec: SpecNode, text: string, fallback: string): string {
  const trimmed = text.trim()
  // 判定にはContractの検証器をそのまま使う（長さ境界をここで再記述しない）
  if (validateBySpec(spec, trimmed, 'example').length === 0) return trimmed
  return spec.node === 'string' ? fallback.slice(0, spec.max) : fallback
}

/** 貼付JSONの例（現在のfixtureを素材にした、そのまま貼り付けられる1件） */
function exampleJson(input: PromptInput, contract: TemplateContract): string {
  const modeLabel = SCENARIO_MODE_LABELS[input.mode]
  const example: Record<string, unknown> = {
    dslVersion: input.dslVersion,
    templateId: contract.templateId,
    templateVersion: contract.templateVersion,
    mode: input.mode,
  }
  if (contract.datasetPolicy === 'required') {
    example['dataset'] = input.example.dataset ?? []
  }
  example['dslParameters'] = input.example.dslParameters
  example['title'] = exampleText(
    contract.titleSpec,
    input.example.title,
    `${contract.templateId}の取込サンプル（${modeLabel}）`,
  )
  example['description'] = exampleText(
    contract.descriptionSpec,
    input.example.description,
    `${input.template.title} を${modeLabel}モードの取込サンプルとして実行します。`,
  )
  return JSON.stringify(example, null, 2)
}

/** 選択中の操作・モード・templateに対する生成依頼文を組み立てる（§8の1〜8） */
export function buildImportPrompt(input: PromptInput): string {
  const contract = buildTemplateContract(input.template)
  const targetNode = input.template.nodes.find((n) => n.nodeId === input.template.targetNodeId)
  const standardNote = targetNode ? STANDARD_OPERATION_NOTES[targetNode.operationId] : undefined

  const lines: string[] = [
    '# Java Stream API学習教材の入力データ候補の作成依頼',
    '',
    'Java Stream APIの可視化シミュレーター（学習教材）で使う入力データ候補を作成してください。',
    '回答は下記のJSONだけを返してください。',
    '',
    '## 対象の教材Pipeline',
    '',
    `- templateId: "${contract.templateId}"`,
    `- templateVersion: ${contract.templateVersion}`,
    `- mode: "${input.mode}"（${SCENARIO_MODE_LABELS[input.mode]}）`,
    `- dslVersion: "${input.dslVersion}"`,
    `- 教材Pipeline: ${input.template.title}`,
    `- ノード列: ${contract.nodeSummary.join(' → ')}`,
    `- スロット一覧: ${
      contract.slots.length === 0
        ? '（なし）'
        : contract.slots
            .map((s) => `${s.slotId}（${ROLE_LABELS[s.role] ?? s.role}・${s.required ? '必須' : '省略可'}）`)
            .join(', ')
    }`,
    '',
    '## JSONのトップレベル',
    '',
    `- 次のキーだけを持つオブジェクトにしてください: ${contract.topLevelKeys.join(', ')}`,
    ...contract.topLevelKeys.map((key) => `  - ${key}: ${contract.topLevelTypes[key]}`),
    `- ${contract.reservedTopLevelKeys.join(' / ')} はアプリが付与するため含めないでください。`,
    `- dslVersion / templateId / templateVersion / mode は上記の値と完全に一致させてください。`,
    ...(contract.datasetPolicy === 'forbidden'
      ? ['- このtemplateはdatasetを使いません。dataset キーは含めないでください（入力はsource DSLで表現します）。']
      : []),
    '- title（前後の空白は除去され、除去後の値が保存されます）:',
    ...describeSpec(contract.titleSpec, '  '),
    '- description（前後の空白は除去され、除去後の値が保存されます）:',
    ...describeSpec(contract.descriptionSpec, '  '),
    `- JSON全体は${contract.textMaxLength} UTF-16 code unit以内にしてください。`,
    '',
    ...datasetContractLines(contract),
    ...slotLines(contract),
    '## 教材制約',
    '',
    ...MODE_NOTES[input.mode].map((note) => `- ${note}`),
    ...(input.mode === 'standard' && standardNote ? [`- ${standardNote}`] : []),
    '',
    '## snapshot予算',
    '',
    `- 1シナリオのsnapshotは最大${SNAPSHOT_LIMIT}件です。データ件数は小さく（目安4件程度）保ってください。`,
    '',
    '## 出力形式',
    '',
    '- 上記のJSONオブジェクトだけを返してください。説明文・前置き・コードフェンスは不要です。',
    '',
    '## 出力例',
    '',
    exampleJson(input, contract),
    '',
  ]
  return lines.join('\n')
}
