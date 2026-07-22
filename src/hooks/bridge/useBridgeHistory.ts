// src/hooks/bridge/useBridgeHistory.ts
//
// Fetches the EOA signer's ALKE bridge transaction history for the history
// section below the bridge form (ALKEBRIDGE.md §14) — on-chain sourceSender/
// destinationAddress are the EOA, since the bridge signs directly from it.

import { useEffect, useState, useCallback } from 'react'
import { useBridgeSignerAddress } from './useBridgeSignerAddress'
import { fetchAlkeBridgeHistory, type BridgeTransactionStatus } from '../../lib/bridge/api'

export function useBridgeHistory(limit = 20) {
  const address = useBridgeSignerAddress()
  const [transactions, setTransactions] = useState<BridgeTransactionStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!address) {
      setTransactions([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const rows = await fetchAlkeBridgeHistory(address, limit)
      setTransactions(rows)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load bridge history.')
    } finally {
      setLoading(false)
    }
  }, [address, limit])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { transactions, loading, error, refresh }
}
