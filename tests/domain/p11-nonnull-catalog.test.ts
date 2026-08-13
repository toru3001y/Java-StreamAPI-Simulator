import { describe, expect, it } from 'vitest'
import { createDefaultCatalog } from '../../src/domain/catalog/operations'
import { OperationCatalog } from '../../src/domain/catalog/operationCatalog'
import { SIM_VALUE_KINDS } from '../../src/domain/model/value'
import type { SimValue } from '../../src/domain/model/value'
import {
  MEANING_CHECKERS,
  OPERATION_CLASSIFICATION,
  checkMeaningValue,
  classifyOperations,
  defaultProducerAxes,
  deriveProducers,
  expectedStateOf,
  isInvariantBlockedProducer,
  type OperationClass,
} from '../p11-nonnull-helpers'

/**
 * P11-D16: v0.14 §4 非null不変条件の**3層目（網羅性 / 漏れ検出）**。
 *
 * 値variant網羅性・producer登録集合の機械導出（全域分類 + 互換直積）・
 * 変更感知型の負例メタテストで構成する。
 */

const catalog = createDefaultCatalog()

describe('P11-D16 値variant網羅性（§4-3）', () => {
  it('P11-D16: SimValueの全variantに意味値検査器が定義されている', () => {
    // 単一定義源（SIM_VALUE_KINDS）と検査器のキー集合が完全一致する。
    // SimValueへvariantを追加してSIM_VALUE_KINDSへ足し忘れると型エラー、
    // 検査器へ足し忘れるとこのassertが失敗する
    expect(Object.keys(MEANING_CHECKERS).sort()).toEqual([...SIM_VALUE_KINDS].sort())
    expect(SIM_VALUE_KINDS.length).toBeGreaterThan(0)
  })

  it('P11-D16: 検査器はnull / undefinedの意味値を検出する（感度の確認）', () => {
    // 正常値は通る
    expect(() => checkMeaningValue({ kind: 'string', value: 'a' })).not.toThrow()
    expect(() =>
      checkMeaningValue({ kind: 'stringList', value: ['a', 'b'] }),
    ).not.toThrow()
    // 意味値本体がnull / undefinedなら検出する
    const broken: readonly unknown[] = [
      { kind: 'string', value: null },
      { kind: 'string', value: undefined },
      { kind: 'int', value: null },
      { kind: 'localDate', value: null },
      { kind: 'stringList', value: [null] },
      { kind: 'intArray', value: [1, null] },
      { kind: 'department', value: { name: 'x', division: null } },
      { kind: 'employee', value: null },
    ]
    for (const value of broken) {
      expect(() => checkMeaningValue(value as SimValue), JSON.stringify(value)).toThrow()
    }
  })

  it('P11-D16: 合成List値は再帰的に全要素を検査する', () => {
    const nested: SimValue = {
      kind: 'list',
      elementType: { kind: 'object', name: 'String' },
      value: [
        { kind: 'string', value: 'a' },
        { kind: 'string', value: 'b' },
      ],
    }
    expect(() => checkMeaningValue(nested)).not.toThrow()
    const brokenNested = {
      kind: 'list',
      elementType: { kind: 'object', name: 'String' },
      value: [{ kind: 'string', value: 'a' }, { kind: 'string', value: null }],
    }
    expect(() => checkMeaningValue(brokenNested as SimValue)).toThrow()
  })

  it('P11-D16: 未定義variantは検査器未定義として失敗する', () => {
    expect(() =>
      checkMeaningValue({ kind: 'virtualKind', value: null } as unknown as SimValue),
    ).toThrow(/意味値検査器が未定義/)
  })
})

describe('P11-D16 producer登録集合の機械導出（§4-3(i)(ii)(iii)）', () => {
  it('P11-D16: OperationCatalogの全operationが値生成 / 非値生成へ全域分類される', () => {
    const { valueProducing, nonProducing } = classifyOperations(catalog)
    expect(valueProducing.length + nonProducing.length).toBe(catalog.list().length)
    expect(catalog.list()).toHaveLength(46)
    // 分類表に未使用のエントリ（存在しないoperationIdへの分類）がない
    const catalogIds = catalog.list().map((o) => o.operationId)
    for (const operationId of Object.keys(OPERATION_CLASSIFICATION)) {
      expect(catalogIds, operationId).toContain(operationId)
    }
    // 値生成側にsource全9・map系・boxed・gatherが含まれる
    for (const operationId of ['source.collectionStream', 'map', 'boxed', 'gather']) {
      expect(valueProducing, operationId).toContain(operationId)
    }
    // 非値生成側に選別・通過・終端が含まれる
    for (const operationId of ['filter', 'distinct', 'peek', 'collect', 'toList']) {
      expect(nonProducing, operationId).toContain(operationId)
    }
  })

  it('P11-D16: 導出が成功し、実軸まで分解されたproducer IDが得られる', () => {
    const producers = deriveProducers(catalog)
    expect(producers.length).toBeGreaterThan(0)
    const ids = producers.map((p) => p.id)
    // 重複なし（deriveProducers内でもthrowするが、契約として明示する）
    expect(new Set(ids).size).toBe(ids.length)
    // 下位軸を実軸で分解している: arrayPrimitive(int)とarrayPrimitive(double)は別producer
    expect(ids).toContain('source.arrayPrimitive:int')
    expect(ids).toContain('source.arrayPrimitive:double')
    expect(ids).toContain('source.arrayPrimitive:long')
    // iterate3はpredicate operatorまで分解する
    expect(ids).toContain('source.iterate3:increment:LTE')
    expect(ids).toContain('source.iterate3:increment:LT')
    // boxedはDSL外の値生成handlerとしてprimitive軸で登録する
    expect(ids).toContain('boxed:int')
    // gatherはkind × accumulation kind × initial type × fieldまで分解する
    expect(ids).toContain('gather.windowFixed')
    expect(ids).toContain('gather.windowSliding')
    expect(ids).toContain('gather.scan:numericSum:int')
    expect(ids).toContain('gather.fold:employeeFieldSum:salary:long')
    // collector内部評価器はclosed DSL定数から導出する
    expect(ids).toContain('classifier.employeeField:region')
    expect(ids).toContain('toMapValue.identity')
    expect(ids).toContain('merge:sumDouble')
  })

  it('P11-D16: 期待状態の対応表が3状態へ一意に割り当てられる', () => {
    const producers = deriveProducers(catalog)
    // empty系のみZERO_EMISSION
    expect(
      producers.filter((p) => expectedStateOf(p) === 'ZERO_EMISSION').map((p) => p.id).sort(),
    ).toEqual([
      'source.empty:double',
      'source.empty:int',
      'source.empty:long',
      'source.empty:object',
    ])
    // window系のみINVARIANT_BLOCKED（合成List値がCollector境界へ構造的に到達できない）
    expect(
      producers.filter((p) => expectedStateOf(p) === 'INVARIANT_BLOCKED').map((p) => p.id).sort(),
    ).toEqual(['gather.windowFixed', 'gather.windowSliding'])
    // window系はisInvariantBlockedProducerの判定と一致する（単一判定を共有している）
    expect(
      producers.filter((p) => isInvariantBlockedProducer(p)).map((p) => p.id).sort(),
    ).toEqual(['gather.windowFixed', 'gather.windowSliding'])
    // 3状態で漏れなく分割されている
    const counts = producers.reduce<Record<string, number>>((acc, p) => {
      const state = expectedStateOf(p)
      acc[state] = (acc[state] ?? 0) + 1
      return acc
    }, {})
    expect(
      (counts['VALUE_REACHED'] ?? 0) +
        (counts['ZERO_EMISSION'] ?? 0) +
        (counts['INVARIANT_BLOCKED'] ?? 0),
    ).toBe(producers.length)
    expect(counts['VALUE_REACHED']).toBeGreaterThan(0)
  })

  it('P11-D16: 値生成operationとproducer展開が双方向に一致する', () => {
    const { valueProducing } = classifyOperations(catalog)
    const producers = deriveProducers(catalog)
    // operation由来producerのカバー集合が、値生成分類と完全一致する
    const covered = [
      ...new Set(producers.map((p) => p.operationId).filter((id): id is string => id !== null)),
    ]
    expect(covered.sort()).toEqual([...valueProducing].sort())
    // collector内部評価器はOperationCatalogのoperationではないため起点operationIdを持たない
    for (const producer of producers.filter((p) =>
      ['classifier', 'toMapValue', 'merge'].includes(p.family),
    )) {
      expect(producer.operationId, producer.id).toBeNull()
    }
    // 逆に、operation由来familyはすべて起点operationIdを持つ
    for (const producer of producers.filter((p) =>
      ['source', 'mapper', 'flatMapper', 'boxed', 'gather'].includes(p.family),
    )) {
      expect(producer.operationId, producer.id).not.toBeNull()
    }
  })
})

describe('P11-D16 変更感知型の負例メタテスト（§4-3）', () => {
  it('P11-D16: 架空operationの注入で全域分類が失敗する（未分類の検出）', () => {
    // 文字列検索ではなく、導出の実行で登録差分を確認する
    const injected = new OperationCatalog()
    for (const operation of catalog.list()) injected.register(operation)
    const sample = catalog.list()[0]!
    injected.register({ ...sample, operationId: 'virtual.op' })
    expect(() => classifyOperations(injected)).toThrow(/分類が未定義のoperation/)
    expect(() => deriveProducers(injected)).toThrow(/分類が未定義のoperation/)
    // 分類表側から1件抜いた複製でも同じく失敗する（表とcatalogの双方向の差分検出）
    const { map: _removed, ...withoutMap } = OPERATION_CLASSIFICATION
    expect(() => classifyOperations(catalog, withoutMap)).toThrow(/分類が未定義のoperation/)
  })

  it('P11-D16: 架空の値生成operationをcatalog + 分類表の双方へ登録しても展開未定義を検出する', () => {
    // 「未分類」ではなく「分類済みだがproducer展開が未定義」の経路（v0.14 §4-3(ii)）。
    // 新しい値生成operationをcatalogと分類表の両方へ足しても、producer展開を書き忘れれば失敗する
    const injected = new OperationCatalog()
    for (const operation of catalog.list()) injected.register(operation)
    const sample = catalog.list()[0]!
    injected.register({ ...sample, operationId: 'virtual.valueProducing' })
    const classification: Record<string, OperationClass> = {
      ...OPERATION_CLASSIFICATION,
      'virtual.valueProducing': 'VALUE_PRODUCING',
    }
    // 分類は通る（未分類ではない）
    expect(() => classifyOperations(injected, classification)).not.toThrow()
    // producer展開が未定義なので導出が失敗する
    expect(() => deriveProducers(injected, defaultProducerAxes(), classification)).toThrow(
      /producer展開が未定義のoperation/,
    )
  })

  it('P11-D16: 値生成operationを非値生成へ誤分類すると展開との不一致で失敗する', () => {
    // producer展開が参照しているoperationが値生成として分類されていない場合の逆方向検出
    const classification: Record<string, OperationClass> = {
      ...OPERATION_CLASSIFICATION,
      boxed: 'NON_PRODUCING',
    }
    expect(() => deriveProducers(catalog, defaultProducerAxes(), classification)).toThrow(
      /値生成として分類されていないoperation/,
    )
  })

  it('P11-D16: 仮想kindの注入で互換直積の展開が失敗する', () => {
    const base = defaultProducerAxes()
    const injections: readonly { label: string; axes: ReturnType<typeof defaultProducerAxes> }[] = [
      { label: 'source', axes: { ...base, sourceKinds: [...base.sourceKinds, 'virtualSource'] } },
      { label: 'mapper', axes: { ...base, mapperKinds: [...base.mapperKinds, 'virtualMapper'] } },
      { label: 'gatherer', axes: { ...base, gathererKinds: [...base.gathererKinds, 'virtualGather'] } },
      {
        label: 'gatherAccumulation',
        axes: {
          ...base,
          gatherAccumulationKinds: [...base.gatherAccumulationKinds, 'virtualAccumulation'],
        },
      },
      {
        label: 'classifier',
        axes: { ...base, classifierKinds: [...base.classifierKinds, 'virtualClassifier'] },
      },
      {
        label: 'toMapValue',
        axes: { ...base, toMapValueKinds: [...base.toMapValueKinds, 'virtualValue'] },
      },
      { label: 'merge', axes: { ...base, toMapMergeIds: [...base.toMapMergeIds, 'virtualMerge'] } },
      { label: 'primitive', axes: { ...base, primitives: [...base.primitives, 'virtualPrimitive'] } },
      {
        label: 'collectionId',
        axes: { ...base, sourceCollectionIds: [...base.sourceCollectionIds, 'virtualCollection'] },
      },
      {
        label: 'gatherField',
        axes: { ...base, gatherFields: [...base.gatherFields, 'virtualField'] },
      },
    ]
    for (const { label, axes } of injections) {
      expect(() => deriveProducers(catalog, axes), label).toThrow()
    }
  })

  it('P11-D16: 下位定数の追加はproducer登録集合を機械的に拡大する', () => {
    const base = defaultProducerAxes()
    const baseline = deriveProducers(catalog, base)
    expect(baseline.length).toBeGreaterThan(0)
    // 実在する軸へ新しい値を1件足すと導出集合が1件増える
    // （カタログ・DSL定数への追加が、そのまま登録集合の拡大＝未検証producerの検出になる）
    const widened = deriveProducers(catalog, {
      ...base,
      classifierEmployeeFields: [...base.classifierEmployeeFields, 'hireDate'],
    })
    expect(widened.length).toBe(baseline.length + 1)
    expect(widened.map((p) => p.id)).toContain('classifier.employeeField:hireDate')
    // 同名の重複はID重複としてthrowする（導出の一意性も同時に守られている）
    expect(() =>
      deriveProducers(catalog, {
        ...base,
        classifierEmployeeFields: [...base.classifierEmployeeFields, 'region'],
      }),
    ).toThrow(/producer IDが重複/)
  })
})
