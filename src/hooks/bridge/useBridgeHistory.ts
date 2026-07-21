// src/hooks/bridge/useBridgeHistory.ts
//
// Fetches the connected wallet's ALKE bridge transaction history for the
// history section below the bridge form (ALKEBRIDGE.md §14).

import { useEffect, useState, useCallback } from 'react'
import { useWalletConnection } from '../useWalletConnection'
import { fetchAlkeBridgeHistory, type BridgeTransactionStatus } from '../../lib/bridge/api'

export function useBridgeHistory(limit = 20) {
  const { address } = useWalletConnection()
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
