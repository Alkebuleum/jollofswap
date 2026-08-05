// src/hooks/bridge/useAlkeBurnRegistration.ts
//
// BNB → Alkebuleum only. Once burnForAlkebuleum's receipt has succeeded
// (useBridgeTransaction only hands back a sourceTransactionHash after that),
// registers it with POST /v1/alke-bridge/register so the backend can start
// tracking it, then gets out of the way — useBridgeStatus keeps polling in
// parallel regardless of registration state. Transient failures (network
// errors, 429/500/502/503/504) retry with backoff (2s, 4s, 8s, 15s, then
// every 30s); HTTP 400 and the backend's permanent validation error codes
// stop retrying immediately — a 400 surfaces the backend's own message
// (malformed request/hash), the known validation codes surface a "contact
// the operator" message instead. Never resubmits a burn transaction.

import { useEffect, useRef, useState } from 'react'
import { registerAlkeBurn, isRetryableRegistrationError, BridgeRegistrationError } from '../../lib/bridge/api'
import { readActiveBridgeTx, markActiveBridgeTxRegistered } from '../../lib/bridge/persistence'
import type { BridgeDirection } from '../../lib/bridge/config'

const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 15_000]
const STEADY_RETRY_MS = 30_000

export const BRIDGE_REGISTRATION_FATAL_MESSAGE =
  'The BNB transaction could not be verified by the bridge. Do not submit another transfer. Contact the bridge operator with the source transaction hash.'

export type BurnRegistrationStatus = 'idle' | 'registering' | 'registered' | 'fatal'

export type BurnRegistrationState = {
  status: BurnRegistrationStatus
  error: string | null
}

export function useAlkeBurnRegistration(
  direction: BridgeDirection,
  sourceTransactionHash: string | null
): BurnRegistrationState {
  const [state, setState] = useState<BurnRegistrationState>({ status: 'idle', error: null })
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false

    if (direction !== 'burn-to-release' || !sourceTransactionHash) {
      setState({ status: 'idle', error: null })
      return
    }

    const stored = readActiveBridgeTx()
    if (stored?.sourceTransactionHash === sourceTransactionHash && stored.registrationComplete) {
      setState({ status: 'registered', error: null })
      return
    }

    setState({ status: 'registering', error: null })

    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

    async function attemptRegister() {
      try {
        await registerAlkeBurn(sourceTransactionHash!)
        if (cancelledRef.current) return
        markActiveBridgeTxRegistered(sourceTransactionHash!)
        setState({ status: 'registered', error: null })
      } catch (e: any) {
        if (cancelledRef.current) return

        if (!isRetryableRegistrationError(e)) {
          // A plain HTTP 400 means the request/hash itself was malformed —
          // show the backend's own explanation rather than the generic
          // "contact the operator" message reserved for domain-validation
          // failures (burn not found, wrong contract, etc.).
          const message =
            e instanceof BridgeRegistrationError && e.status === 400 && e.message
              ? e.message
              : BRIDGE_REGISTRATION_FATAL_MESSAGE
          setState({ status: 'fatal', error: message })
          return
        }

        const delay = RETRY_DELAYS_MS[attempt] ?? STEADY_RETRY_MS
        attempt += 1
        timer = setTimeout(attemptRegister, delay)
      }
    }

    attemptRegister()

    return () => {
      cancelledRef.current = true
      if (timer) clearTimeout(timer)
    }
  }, [direction, sourceTransactionHash])

  return state
}
