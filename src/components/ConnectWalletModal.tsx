// src/components/ConnectWalletModal.tsx
//
// Global connect-wallet modal. Mounted once in AppLayout.
// Open it from anywhere via: useConnectModalStore.getState().openModal()

import React, { useEffect, useState } from 'react'
import { Wallet2, Smartphone, Globe, X } from 'lucide-react'
import { useWalletConnection } from '../hooks/useWalletConnection'
import { useWcStore } from '../store/wcStore'
import { wcConnect, onWcUri } from '../lib/wcProvider'
import { useConnectModalStore } from '../store/connectModalStore'
import WcConnectModal from './WcConnectModal'

const btnWc =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 active:bg-violet-800 disabled:opacity-60'

export default function ConnectWalletModal() {
  const { open, closeModal } = useConnectModalStore()
  const { isConnected } = useWalletConnection()

  const [wcLoading, setWcLoading] = useState(false)
  const [wcUri, setWcUri] = useState<string | null>(null)
  const [wcError, setWcError] = useState<string | null>(null)
  const [injLoading, setInjLoading] = useState(false)
  const [injError, setInjError] = useState<string | null>(null)

  const injectedEth = typeof window !== 'undefined' ? (window as any).ethereum : null
  const isNuroBrowser = injectedEth?._isNuruWallet === true

  // Auto-close once wallet is connected
  useEffect(() => {
    if (isConnected && open) closeModal()
  }, [isConnected, open, closeModal])

  if (!open) return null

  async function handleWcConnect() {
    setWcError(null)
    setWcLoading(true)
    setWcUri(null)
    const unsub = onWcUri((uri) => setWcUri(uri))
    try {
      await wcConnect()
      setWcUri(null)
    } catch (e: any) {
      setWcError(e?.message ?? 'Connection cancelled')
      setWcUri(null)
    } finally {
      unsub()
      setWcLoading(false)
    }
  }

  async function handleInjectedConnect() {
    setInjError(null)
    setInjLoading(true)
    try {
      const accounts: string[] = await injectedEth.request({ method: 'eth_requestAccounts' })
      const address = accounts?.[0]
      if (!address) throw new Error('No account returned')
      useWcStore.getState().setWcState(true, address)
    } catch (e: any) {
      setInjError(e?.message ?? 'Connection cancelled')
    } finally {
      setInjLoading(false)
    }
  }

  return (
    <>
      {wcUri && <WcConnectModal uri={wcUri} onCancel={() => { setWcUri(null); setWcLoading(false) }} />}

      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        onClick={closeModal}
      >
        <div
          className="relative w-full max-w-sm rounded-2xl bg-white ring-1 ring-slate-200 shadow-2xl p-8 dark:bg-slate-950 dark:ring-slate-800"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={closeModal}
            className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="mx-auto w-14 h-14 rounded-2xl bg-orange-50 ring-1 ring-orange-100 grid place-content-center text-jlfTomato mb-5 dark:bg-slate-900 dark:ring-slate-700">
            <Wallet2 className="w-7 h-7" />
          </div>

          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 text-center">
            Connect Wallet
          </h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 text-center">
            Connect your Nuru wallet to start swapping on Alkebuleum.
          </p>

          {/* Nuru browser — injected window.ethereum */}
          {isNuroBrowser && (
            <div className="mt-6 rounded-xl bg-violet-50 ring-1 ring-violet-100 p-4 dark:bg-violet-950/30 dark:ring-violet-800/50">
              <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide dark:text-violet-400">
                Nuru Browser
              </p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                You're inside the Nuru wallet — connect directly.
              </p>
              <button
                onClick={handleInjectedConnect}
                disabled={injLoading}
                className={btnWc + ' mt-3 w-full'}
              >
                <Globe className="w-4 h-4" />
                {injLoading ? 'Connecting…' : 'Connect Nuru Wallet'}
              </button>
              {injError && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">{injError}</p>
              )}
            </div>
          )}

          {/* WalletConnect — shown when NOT in the Nuru browser */}
          {!isNuroBrowser && (
            <div className="mt-6 rounded-xl bg-violet-50 ring-1 ring-violet-100 p-4 dark:bg-violet-950/30 dark:ring-violet-800/50">
              <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide dark:text-violet-400">
                Nuru Wallet
              </p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Connect via WalletConnect — open Nuru, go to <strong>More → Connect dApp</strong>.
              </p>
              <button
                onClick={handleWcConnect}
                disabled={wcLoading}
                className={btnWc + ' mt-3 w-full'}
              >
                <Smartphone className="w-4 h-4" />
                {wcLoading ? 'Connecting…' : 'Connect Nuru Wallet'}
              </button>
              {wcError && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">{wcError}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
