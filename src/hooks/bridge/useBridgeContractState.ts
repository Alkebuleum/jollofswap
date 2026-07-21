// src/hooks/bridge/useBridgeContractState.ts
//
// Live contract-state safety checks (ALKEBRIDGE.md §9): pause state,
// remaining vault capacity, total locked, bytecode presence on both chains.
// The submit button must stay disabled until these resolve successfully.

import { useEffect, useRef, useState } from 'react'
import { readVaultState, readBnbTokenState, type VaultState, type BnbTokenState } from '../../lib/bridge/contracts'

const POLL_MS = 15_000

export type BridgeContractState = {
  vault: VaultState | null
  bnbToken: BnbTokenState | null
  loading: boolean
  error: string | null
}

export function useBridgeContractState(): BridgeContractState {
  const [state, setState] = useState<BridgeContractState>({ vault: null, bnbToken: null, loading: true, error: null })
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function poll() {
      try {
        const [vault, bnbToken] = await Promise.all([readVaultState(), readBnbTokenState()])
        if (!cancelledRef.current) setState({ vault, bnbToken, loading: false, error: null })
      } catch (e: any) {
        if (!cancelledRef.current) {
          setState((s) => ({ ...s, loading: false, error: e?.message ?? 'Failed to read bridge contract state.' }))
        }
      } finally {
        if (!cancelledRef.current) timer = setTimeout(poll, POLL_MS)
      }
    }

    poll()
    return () => {
      cancelledRef.current = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  return state
}

export function isBridgePaused(state: BridgeContractState): boolean {
  return Boolean(state.vault?.paused || state.bnbToken?.paused)
}
