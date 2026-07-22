// src/hooks/bridge/useBridgeStatus.ts
//
// Polls the backend ALKE bridge status endpoint for a given source tx hash.
// 3s cadence for the first minute, then 8-10s, per ALKEBRIDGE.md §10's
// "Frontend polling flow". Stops only on COMPLETED or an operator-attention
// state — a 404 awaiting_detection or network error is treated as pending,
// never as failure, and never stops polling on its own.

import { useEffect, useRef, useState } from 'react'
import {
  fetchAlkeBridgeStatus,
  shouldStopPolling,
  type BridgeTransactionStatus,
} from '../../lib/bridge/api'

const FAST_POLL_MS = 3_000
const SLOW_POLL_MS = 10_000
const FAST_WINDOW_MS = 60_000

export type BridgeStatusState = {
  transaction: BridgeTransactionStatus | null
  awaitingDetection: boolean
  stopped: boolean
  lastError: string | null
}

export function useBridgeStatus(sourceTransactionHash: string | null) {
  const [state, setState] = useState<BridgeStatusState>({
    transaction: null,
    awaitingDetection: false,
    stopped: false,
    lastError: null,
  })
  const cancelledRef = useRef(false)
  const startedAtRef = useRef<number>(Date.now())

  useEffect(() => {
    cancelledRef.current = false
    startedAtRef.current = Date.now()
    setState({ transaction: null, awaitingDetection: false, stopped: false, lastError: null })

    if (!sourceTransactionHash) return

    let timer: ReturnType<typeof setTimeout> | null = null

    async function poll() {
      try {
        const result = await fetchAlkeBridgeStatus(sourceTransactionHash!)
        if (cancelledRef.current) return

        if (!result.found) {
          setState((s) => ({ ...s, awaitingDetection: true, lastError: null }))
        } else {
          const stop = shouldStopPolling(result.transaction.state)
          setState({ transaction: result.transaction, awaitingDetection: false, stopped: stop, lastError: null })
          if (stop) return // do not schedule another poll
        }
      } catch (e: any) {
        if (!cancelledRef.current) {
          setState((s) => ({ ...s, lastError: e?.message ?? 'Status check failed.' }))
        }
      }

      if (cancelledRef.current) return
      const elapsed = Date.now() - startedAtRef.current
      const interval = elapsed < FAST_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS
      timer = setTimeout(poll, interval)
    }

    poll()
    return () => {
      cancelledRef.current = true
      if (timer) clearTimeout(timer)
    }
  }, [sourceTransactionHash])

  return state
}
