// src/hooks/bridge/useAlkeBurnRegistration.ts
//
// BNB → Alkebuleum only. Once burnForAlkebuleum's receipt has succeeded
// (useBridgeTransaction only hands back a sourceTransactionHash after that),
// registers it with POST /v1/alke-bridge/register so the backend can start
// tracking it, then gets out of the way — useBridgeStatus keeps polling in
// parallel regardless of registration state. Transient failures retry with
// backoff (3s, 6s, 12s, then every 30s); the backend's permanent validation
// errors stop retrying immediately and surface a "contact the operator"
// message instead. Never resubmits a burn transaction.

import { useEffect, useRef, useState } from 'react'
import { registerAlkeBurn, isNonRetryableRegistrationError } from '../../lib/bridge/api'
import { readActiveBridgeTx, markActiveBridgeTxRegistered } from '../../lib/bridge/persistence'
import type { BridgeDirection } from '../../lib/bridge/config'

const RETRY_DELAYS_MS = [3_000, 6_000, 12_000]
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

        if (isNonRetryableRegistrationError(e?.code)) {
          setState({ status: 'fatal', error: BRIDGE_REGISTRATION_FATAL_MESSAGE })
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
