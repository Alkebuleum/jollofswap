// src/lib/wcProvider.ts
//
// Singleton WalletConnect v2 ethereum provider.
// Uses @walletconnect/ethereum-provider with showQrModal=false so we display
// the URI ourselves — a simple "Copy URI" dialog rather than the heavy WC modal.
//
// Flow:
//  1. User clicks "Connect Nuru" in JollofSwap
//  2. wcConnect() is called — provider generates a pairing URI
//  3. `display_uri` event fires → onWcUri listeners receive the URI
//  4. UI shows a dialog: "Copy this URI and paste into Nuru → More → Connect dApp"
//  5. User connects from Nuru → wcConnect() resolves with the connected address
//  6. WC state is stored in wcStore; all ethers calls go through the WC provider

import { EthereumProvider } from '@walletconnect/ethereum-provider'
import { useWcStore } from '../store/wcStore'

const WC_PROJECT_ID = (import.meta.env.VITE_WC_PROJECT_ID as string) ?? '168f9f4e2a2a6b550ff1466c8beecfd4'
const ALK_CHAIN_ID = Number(import.meta.env.VITE_ALK_CHAIN_ID ?? 237422)

let _provider: InstanceType<typeof EthereumProvider> | null = null

// URI listeners so the UI can show the connect dialog
type UriListener = (uri: string) => void
const _uriListeners = new Set<UriListener>()

export function onWcUri(cb: UriListener): () => void {
  _uriListeners.add(cb)
  return () => _uriListeners.delete(cb)
}

// Session-expired listeners — fires when WC session drops unexpectedly
type SessionDropListener = () => void
const _sessionDropListeners = new Set<SessionDropListener>()

export function onWcSessionDrop(cb: SessionDropListener): () => void {
  _sessionDropListeners.add(cb)
  return () => _sessionDropListeners.delete(cb)
}

function notifySessionDrop() {
  _sessionDropListeners.forEach((cb) => cb())
}

function clearProvider() {
  _provider = null
  useWcStore.getState().setWcState(false, null)
}

async function createProvider() {
  const p = await EthereumProvider.init({
    projectId: WC_PROJECT_ID,
    chains: [ALK_CHAIN_ID],
    showQrModal: false,  // We display the URI ourselves
    metadata: {
      name: 'JollofSwap',
      description: 'Decentralised exchange on Alkebuleum',
      url: 'https://jollofswap.com',
      icons: ['https://jollofswap.com/favicon.svg'],
    },
  })

  p.on('accountsChanged', (accounts: string[]) => {
    if (accounts.length > 0) {
      useWcStore.getState().setWcState(true, accounts[0])
    } else {
      clearProvider()
    }
  })

  p.on('disconnect', () => { clearProvider(); notifySessionDrop() })
  p.on('session_delete', () => { clearProvider(); notifySessionDrop() })
  ;(p as any).on('session_expire', () => { clearProvider(); notifySessionDrop() })

  return p
}

export async function getOrInitWcProvider() {
  if (!_provider) {
    _provider = await createProvider()

    // Restore persisted session if one exists
    if (_provider.accounts && _provider.accounts.length > 0) {
      useWcStore.getState().setWcState(true, _provider.accounts[0])
    }
  }
  return _provider
}

export function getWcProvider() {
  return _provider
}

/** Returns the active WC session topic, trying several internal paths. */
export function getWcTopic(): string {
  const p = _provider as any
  return p?.session?.topic
    ?? p?.signer?.session?.topic
    ?? p?.signer?.client?.session?.getAll?.()[0]?.topic
    ?? ''
}

/** Connect — shows URI via onWcUri listeners, waits for Nuru to accept. */
export async function wcConnect(): Promise<string> {
  // Always create a fresh provider for a new connection attempt
  if (_provider) {
    try { await _provider.disconnect() } catch { /* ignore */ }
  }
  _provider = await createProvider()

  // `display_uri` fires before enable() resolves — wire it before calling enable
  const uriPromise = new Promise<string>((resolve) => {
    _provider!.once('display_uri', (uri: string) => {
      _uriListeners.forEach((cb) => cb(uri))
      resolve(uri)
    })
  })

  // enable() blocks until the remote wallet (Nuru) accepts
  const enablePromise = _provider.enable()

  await uriPromise   // wait for URI to be emitted (so listeners have fired)
  await enablePromise // wait for Nuru to connect

  const address = _provider!.accounts[0]
  if (!address) throw new Error('No account returned from WalletConnect')
  useWcStore.getState().setWcState(true, address)
  return address
}

/** Disconnect the active WC session. */
export async function wcDisconnect(): Promise<void> {
  if (_provider) {
    try { await _provider.disconnect() } catch { /* ignore */ }
  }
  clearProvider()
}

/**
 * Called once on app load. If a WalletConnect session was established in a
 * previous page load, restore it silently so wcStore reflects the connection
 * without requiring the user to re-pair.
 */
export async function tryRestoreWcSession(): Promise<void> {
  if (useWcStore.getState().wcConnected) return   // already connected
  try {
    const p = await getOrInitWcProvider()
    // accounts is populated by WC if a persisted session exists
    if (p.accounts && p.accounts.length > 0) {
      useWcStore.getState().setWcState(true, p.accounts[0])
      console.log('[WC] session restored from storage →', p.accounts[0])
    }
  } catch {
    // No persisted session — user will need to connect manually
  }
}
