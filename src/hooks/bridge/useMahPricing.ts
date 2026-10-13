// src/hooks/bridge/useMahPricing.ts
//
// Shared MAH bridge-pricing state. One fetch is shared across every mounted
// component (Swap, Liquidity, …) and refreshed periodically; the backend only
// changes the rate on a service restart, so a few minutes of staleness is fine.
//
// `pricing` is never null: until the API answers (or if it can't be reached)
// it's FALLBACK_MAH_PRICING, and `isFallback` says so.

import { useEffect, useState } from 'react'
import { fetchMahPricing, FALLBACK_MAH_PRICING, type MahPricing } from '../../lib/bridge/pricing'

const REFRESH_MS = 5 * 60_000
const RETRY_MS = 30_000

type State = { live: MahPricing | null; loading: boolean; error: string | null }

let state: State = { live: null, loading: true, error: null }
const listeners = new Set<(s: State) => void>()
let timer: number | null = null
let inflight = false

function set(next: State) {
  state = next
  listeners.forEach(l => l(state))
}

async function load() {
  if (inflight) return
  inflight = true
  try {
    const live = await fetchMahPricing()
    set({ live, loading: false, error: null })
    schedule(REFRESH_MS)
  } catch (e) {
    console.warn('[mah-pricing] pricing endpoint failed', e)
    // Keep the last good live pricing if a background refresh fails.
    set({ live: state.live, loading: false, error: (e as Error)?.message || 'Bridge pricing unavailable' })
    schedule(RETRY_MS)
  } finally {
    inflight = false
  }
}

function schedule(ms: number) {
  if (timer != null) window.clearTimeout(timer)
  timer = listeners.size ? window.setTimeout(load, ms) : null
}

export function useMahPricing() {
  const [s, setS] = useState(state)
  useEffect(() => {
    listeners.add(setS)
    setS(state)
    if (timer == null) void load()
    return () => {
      listeners.delete(setS)
      if (!listeners.size && timer != null) { window.clearTimeout(timer); timer = null }
    }
  }, [])
  return {
    pricing: s.live ?? FALLBACK_MAH_PRICING,
    isFallback: s.live === null,
    loading: s.loading,
    error: s.error,
  }
}
