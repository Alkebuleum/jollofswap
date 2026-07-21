// src/hooks/bridge/useBridgeTransaction.ts
//
// Orchestrates submitting the single source-chain transaction (lockForBnb or
// burnForAlkebuleum) via the shared useSignerSession hook. Once a source tx
// hash exists, handoff to useBridgeStatus for backend-authoritative progress
// (ALKEBRIDGE.md §13: submit exactly one source-chain transaction, never
// auto-retry after an error).

import { useCallback, useState } from 'react'
import { ethers } from 'ethers'
import { useSignerSession } from '../useSignerSession'
import { encodeLockForBnb, encodeBurnForAlkebuleum } from '../../lib/bridge/contracts'
import { writeActiveBridgeTx } from '../../lib/bridge/persistence'
import { ALKEBULEUM_CHAIN_ID, BSC_CHAIN_ID, type BridgeDirection } from '../../lib/bridge/config'

const AMVAULT_URL = (import.meta.env.VITE_AMVAULT_URL as string) ?? 'https://amvault.net'
const APP_NAME = (import.meta.env.VITE_APP_NAME as string) ?? 'JollofSwap'

const LOCK_GAS = 250_000
const BURN_GAS = 150_000

export type SubmitPhase = 'idle' | 'submitting' | 'awaiting-receipt' | 'submitted' | 'error'

export function useBridgeTransaction() {
  const { sessionSendTransactions, startFlow, endFlow } = useSignerSession()
  const [phase, setPhase] = useState<SubmitPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [sourceTransactionHash, setSourceTransactionHash] = useState<string | null>(null)

  const reset = useCallback(() => {
    setPhase('idle')
    setError(null)
    setSourceTransactionHash(null)
  }, [])

  const submit = useCallback(
    async (direction: BridgeDirection, amountRaw: bigint, destinationAddress: string) => {
      if (!ethers.isAddress(destinationAddress)) {
        setError('Destination address is not a valid EVM address.')
        setPhase('error')
        return null
      }

      setError(null)
      setPhase('submitting')
      startFlow(direction === 'lock-to-mint' ? 'bridge-lock' : 'bridge-burn')

      try {
        const tx =
          direction === 'lock-to-mint'
            ? { ...encodeLockForBnb(destinationAddress, amountRaw), gas: LOCK_GAS }
            : { ...encodeBurnForAlkebuleum(amountRaw, destinationAddress), gas: BURN_GAS }

        setPhase('awaiting-receipt')

        const results = await sessionSendTransactions(
          { chainId: tx.chainId, txs: [{ to: tx.to, data: tx.data, value: tx.value.toString(), gas: tx.gas }], failFast: true },
          { app: APP_NAME, amvaultUrl: AMVAULT_URL, skipAaWrap: direction === 'burn-to-release' },
          direction === 'lock-to-mint' ? 'Lock ALKE' : 'Burn ALKE',
        )

        const result = results?.[0]
        if (!result?.ok || !result?.txHash) {
          throw new Error(result?.error || 'Transaction failed.')
        }

        writeActiveBridgeTx({
          direction,
          sourceTransactionHash: result.txHash,
          amountRaw: amountRaw.toString(),
          destinationAddress,
          submittedAt: Date.now(),
        })

        setSourceTransactionHash(result.txHash)
        setPhase('submitted')
        return result.txHash
      } catch (e: any) {
        setError(e?.message ?? 'Bridge transaction failed.')
        setPhase('error')
        return null
      } finally {
        endFlow()
      }
    },
    [sessionSendTransactions, startFlow, endFlow]
  )

  return { phase, error, sourceTransactionHash, submit, reset }
}

// Re-exported for convenience so callers don't need a second import for the
// chain IDs used when building explorer links around the submitted tx.
export { ALKEBULEUM_CHAIN_ID, BSC_CHAIN_ID }
