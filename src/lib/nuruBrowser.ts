// src/lib/nuruBrowser.ts
//
// State sync for JollofSwap running inside the Nuru in-app dApp browser
// (window.ethereum._isNuruWallet). Nuru exposes two addresses:
//   • eth_accounts[0]          — the active KEY (EOA) that signs
//   • nuru_getIdentity.aaWallet — the Nuru Account (AA wallet) that holds funds
// Both can change while the page is open: the user switches keys (Nuru emits
// `accountsChanged`) or Nuru Accounts (`nuruIdentityChanged`) in the wallet.
// Every such change re-reads both, so useWcStore.signer never keeps a stale
// key (it's used for direct-from-key sends and the Polygon gas top-up).

import { useWcStore } from '../store/wcStore'
import { useWalletMetaStore } from '../store/walletMetaStore'

export function nuruInjected(): any | null {
  const eth = typeof window !== 'undefined' ? (window as any).ethereum : null
  return eth?._isNuruWallet ? eth : null
}

/** Applies the key [eoa] plus whatever Nuru Account identity Nuru reports. */
export async function applyNuruIdentity(eth: any, eoa: string): Promise<void> {
  const meta = useWalletMetaStore.getState()
  try {
    const identity = await eth.request({ method: 'nuru_getIdentity' })
    const aaWallet = identity?.aaWallet ? String(identity.aaWallet) : eoa
    // aaWallet is the display address (holds the funds); eoa is the signer.
    useWcStore.getState().setWcState(true, aaWallet, eoa)
    meta.setAaWallet(aaWallet)
    meta.setAin(identity?.ain ? String(identity.ain).toUpperCase() : null)
    meta.setPrimaryHandle(identity?.primaryHandle ? String(identity.primaryHandle) : null)
  } catch {
    // Identity is a bonus — the key alone is a safe fallback.
    useWcStore.getState().setWcState(true, eoa, eoa)
  }
}

/**
 * Re-reads the connected key + identity from the Nuru browser. No connected
 * account (not connected yet, or disconnected from the wallet side) clears
 * the connection. Never prompts — uses eth_accounts, not eth_requestAccounts.
 */
export async function syncFromNuruBrowser(): Promise<void> {
  const eth = nuruInjected()
  if (!eth) return
  let accounts: string[] = []
  try {
    accounts = (await eth.request({ method: 'eth_accounts' })) ?? []
  } catch { /* treat as not connected */ }
  const eoa = accounts[0]
  if (!eoa) {
    clearNuruBrowserState()
    return
  }
  await applyNuruIdentity(eth, eoa)
}

export function clearNuruBrowserState(): void {
  useWcStore.getState().setWcState(false, null, null)
  const meta = useWalletMetaStore.getState()
  meta.setAaWallet(null)
  meta.setAin(null)
  meta.setPrimaryHandle(null)
}

/**
 * Disconnects from the wallet side too: wallet_revokePermissions makes Nuru
 * forget this site, so it isn't silently reconnected on the next load and
 * Nuru's own "connected" indicator clears.
 */
export async function revokeNuruBrowser(): Promise<void> {
  const eth = nuruInjected()
  if (!eth) return
  try {
    await eth.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] })
  } catch { /* older Nuru builds — local disconnect still applies */ }
}
