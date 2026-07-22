// src/hooks/bridge/useBridgeBalances.ts
//
// Polls the EOA signer's native ALKE (Alkebuleum) and ALKE-on-BNB + BNB gas
// balances — not the AA wallet's, since the bridge sends transactions
// directly from the EOA (see useBridgeSignerAddress.ts). Independent of swap
// balance polling (src/pages/Swap.tsx) — separate provider instances, no
// shared cache.

import { useEffect, useRef, useState } from 'react'
import { useBridgeSignerAddress } from './useBridgeSignerAddress'
import { readNativeAlkeBalance, readBnbAlkeBalance, readBnbGasBalance } from '../../lib/bridge/contracts'

const POLL_MS = 15_000

export type BridgeBalances = {
  nativeAlkeRaw: bigint | null
  bnbAlkeRaw: bigint | null
  bnbGasRaw: bigint | null
  loading: boolean
}

export function useBridgeBalances(): BridgeBalances {
  const address = useBridgeSignerAddress()
  const [state, setState] = useState<BridgeBalances>({
    nativeAlkeRaw: null,
    bnbAlkeRaw: null,
    bnbGasRaw: null,
    loading: false,
  })
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    if (!address) {
      setState({ nativeAlkeRaw: null, bnbAlkeRaw: null, bnbGasRaw: null, loading: false })
      return
    }

    let timer: ReturnType<typeof setTimeout> | null = null

    async function poll() {
      setState((s) => ({ ...s, loading: true }))
      try {
        const [nativeAlkeRaw, bnbAlkeRaw, bnbGasRaw] = await Promise.all([
          readNativeAlkeBalance(address!),
          readBnbAlkeBalance(address!),
          readBnbGasBalance(address!),
        ])
        if (!cancelledRef.current) {
          setState({ nativeAlkeRaw, bnbAlkeRaw, bnbGasRaw, loading: false })
        }
      } catch {
        if (!cancelledRef.current) setState((s) => ({ ...s, loading: false }))
      } finally {
        if (!cancelledRef.current) timer = setTimeout(poll, POLL_MS)
      }
    }

    poll()
    return () => {
      cancelledRef.current = true
      if (timer) clearTimeout(timer)
    }
  }, [address])

  return state
}
