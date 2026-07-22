// src/hooks/bridge/useBridgeAccess.ts
//
// Foundation-only access check for the current wallet. This is a UI
// restriction only — it does not, and cannot, prevent direct contract calls
// from a non-allowlisted wallet (ALKEBRIDGE.md §2).
//
// Checks both the display address (AA wallet, for Nuru users) and the
// signing EOA — the allowlist may reasonably contain either, and the two
// differ for Nuru-connected wallets (see useBridgeSignerAddress.ts).

import { useWalletConnection } from '../useWalletConnection'
import { useBridgeSignerAddress } from './useBridgeSignerAddress'
import { isAllowedBridgeWallet } from '../../lib/bridge/config'

export function useBridgeAccess() {
  const { isConnected, address: displayAddress } = useWalletConnection()
  const signerAddress = useBridgeSignerAddress()
  const isAuthorized =
    isConnected && (isAllowedBridgeWallet(displayAddress) || isAllowedBridgeWallet(signerAddress))

  return {
    isConnected,
    address: displayAddress,
    signerAddress,
    isAuthorized,
    disabledReason: !isConnected
      ? null
      : !isAuthorized
        ? 'This wallet is not authorized for Foundation bridge operations.'
        : null,
  }
}
