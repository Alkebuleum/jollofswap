// src/hooks/bridge/useBridgeAccess.ts
//
// Foundation-only access check for the current wallet. This is a UI
// restriction only — it does not, and cannot, prevent direct contract calls
// from a non-allowlisted wallet (ALKEBRIDGE.md §2).

import { useWalletConnection } from '../useWalletConnection'
import { isAllowedBridgeWallet } from '../../lib/bridge/config'

export function useBridgeAccess() {
  const { isConnected, address } = useWalletConnection()
  const isAuthorized = isConnected && isAllowedBridgeWallet(address)

  return {
    isConnected,
    address,
    isAuthorized,
    disabledReason: !isConnected
      ? null
      : !isAuthorized
        ? 'This wallet is not authorized for Foundation bridge operations.'
        : null,
  }
}
