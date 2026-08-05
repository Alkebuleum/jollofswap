// src/hooks/bridge/useBridgeAccess.ts
//
// Foundation-only access check for the current wallet. This is a UI
// restriction only — it does not, and cannot, prevent direct contract calls
// from a non-allowlisted wallet (ALKEBRIDGE.md §2).
//
// Checks the display address (AA wallet, for Nuru users), the signing EOA,
// and the wallet's AIN — the allowlist may reasonably contain any of these,
// and the two addresses differ for Nuru-connected wallets (see
// useBridgeSignerAddress.ts). AIN support lets the Foundation authorize a
// Nuru account by its identifier instead of a specific address.

import { useWalletConnection } from '../useWalletConnection'
import { useBridgeSignerAddress } from './useBridgeSignerAddress'
import { isAllowedBridgeWallet, isAllowedBridgeAin } from '../../lib/bridge/config'
import { useWalletMetaStore } from '../../store/walletMetaStore'

export function useBridgeAccess() {
  const { isConnected, address: displayAddress } = useWalletConnection()
  const signerAddress = useBridgeSignerAddress()
  const { ain } = useWalletMetaStore()
  const isAuthorized =
    isConnected &&
    (isAllowedBridgeWallet(displayAddress) || isAllowedBridgeWallet(signerAddress) || isAllowedBridgeAin(ain))

  return {
    isConnected,
    address: displayAddress,
    signerAddress,
    isAuthorized,
    disabledReason: !isConnected
      ? null
      : !isAuthorized
        ? 'This wallet is not authorized for bridge operations.'
        : null,
  }
}
