// src/hooks/bridge/useBridgeSignerAddress.ts
//
// The actual EOA that signs transactions — distinct from
// useWalletConnection().address, which for Nuru/WalletConnect users is the
// AA (smart-contract) wallet used for display/balance, not the signing key
// (see src/store/wcStore.ts: wcAddress = aaWallet, signer = EOA). The bridge
// signs directly from the EOA on both chains (no AA-wallet wrapping), so
// this is the address that must hold funds and be allowlisted.
//
// AmVault (legacy, non-Nuru) sessions have no separate AA-wallet concept in
// this app — session.address is both the display and signing address there.

import { useAuth } from 'amvault-connect'
import { useWcStore } from '../../store/wcStore'

export function useBridgeSignerAddress(): string | null {
  const { session } = useAuth()
  const { wcConnected, signer } = useWcStore()
  if (wcConnected && signer) return signer
  return (session as any)?.address ?? null
}
