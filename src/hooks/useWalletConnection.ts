// src/hooks/useWalletConnection.ts
//
// Unified hook that returns the connected wallet address regardless of whether
// the user connected via AmVault or via WalletConnect (Nuru).

import { useAuth } from 'amvault-connect'
import { useWcStore } from '../store/wcStore'

export type ConnectionType = 'amvault' | 'walletconnect' | null

export type WalletConnection = {
  isConnected: boolean
  address: string | null
  connectionType: ConnectionType
}

export function useWalletConnection(): WalletConnection {
  const { session } = useAuth()
  const { wcConnected, wcAddress } = useWcStore()

  if (session) {
    return {
      isConnected: true,
      address: (session as any).address ?? null,
      connectionType: 'amvault',
    }
  }

  if (wcConnected && wcAddress) {
    return {
      isConnected: true,
      address: wcAddress,
      connectionType: 'walletconnect',
    }
  }

  return { isConnected: false, address: null, connectionType: null }
}
