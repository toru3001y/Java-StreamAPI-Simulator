import { useSyncExternalStore } from 'react'

/** prefers-reduced-motion設定の購読（§17.5）。設定時は移動アニメーションを抑制する。 */
const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(callback: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia(QUERY)
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

function getSnapshot(): boolean {
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia(QUERY).matches
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
