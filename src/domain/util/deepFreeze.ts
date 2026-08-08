/**
 * Domainモデルと確定snapshotを外部からの破壊的変更から守る（§19、§22.4）。
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}
