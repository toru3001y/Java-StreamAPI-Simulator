import type { SimValue } from '../model/value'
import { assertNotCompositeList } from '../types/invariantError'

/**
 * distinctの等価判定キー（Phase 3指示 §7.2）。
 * Javaのequalsに対応する構造キーを決定的に導出する。
 * 数値はJS numberの数値等価で比較する（DoubleStream.distinct()の等価判定は
 * Double.compare(double, double)と一致。教材データはNaN / -0.0を含まない）。
 */
export function distinctKeyOf(value: SimValue, elementId?: string): string {
  switch (value.kind) {
    case 'int':
    case 'long':
    case 'double':
    case 'boxedInt':
    case 'boxedLong':
    case 'boxedDouble':
      // primitiveとwrapperはStream上で混在しない。数値としての等価で判定する
      return `num:${value.value}`
    case 'string':
      return `str:${value.value}`
    case 'localDate':
      return `date:${value.value}`
    case 'employee':
      // Java recordのequalsは全フィールド比較
      return `emp:${JSON.stringify(value.value)}`
    case 'department':
      return `dept:${JSON.stringify(value.value)}`
    case 'stringList':
      return `list:${JSON.stringify(value.value)}`
    case 'intArray':
    case 'longArray':
    case 'doubleArray':
      // Javaの配列equalsは参照比較。要素（インスタンス）ごとに別キーとして扱う
      return `arr:${value.kind}:${elementId ?? JSON.stringify(value.value)}`
    case 'list':
      // Phase 7範囲ではgatherの下流はtoList / findFirstのみで、合成List値はdistinctへ到達しない
      // （v0.9 §8.4のPipeline合成の限定）。到達した場合はエンジン内部の不整合（§5.2、P7-D07）
      return assertNotCompositeList(value, 'distinct') as never
  }
}
