// src/components/ConnectWalletModal.tsx
//
// Global connect-wallet modal. Mounted once in AppLayout.
// Open it from anywhere via: useConnectModalStore.getState().openModal()

import React, { useEffect, useState } from 'react'
import { Wallet2, Globe, X, Copy, Check, Link2, QrCode, AlignLeft } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useWalletConnection } from '../hooks/useWalletConnection'
import { useWcStore } from '../store/wcStore'
import { wcConnect, onWcUri } from '../lib/wcProvider'
import { useConnectModalStore } from '../store/connectModalStore'

export default function ConnectWalletModal() {
  const { open, closeModal } = useConnectModalStore()
  const { isConnected } = useWalletConnection()

  const [wcLoading, setWcLoading] = useState(false)
  const [wcUri, setWcUri] = useState<string | null>(null)
  const [wcError, setWcError] = useState<string | null>(null)
  const [injLoading, setInjLoading] = useState(false)
  const [injError, setInjError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showQr, setShowQr] = useState(true)

  const injectedEth = typeof window !== 'undefined' ? (window as any).ethereum : null
  const isNuroBrowser = injectedEth?._isNuruWallet === true

  // Auto-close once wallet is connected
  useEffect(() => {
    if (isConnected && open) closeModal()
  }, [isConnected, open, closeModal])

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setWcUri(null)
      setWcError(null)
      setWcLoading(false)
      setInjError(null)
      setInjLoading(false)
      setCopied(false)
      setShowQr(true)
    }
  }, [open])

  if (!open) return null

  async function handleWcConnect() {
    setWcError(null)
    setWcUri(null)
    setWcLoading(true)
    const unsub = onWcUri((uri) => setWcUri(uri))
    try {
      await wcConnect()
      setWcUri(null)
    } catch (e: any) {
      setWcError(e?.message ?? 'Connection cancelled or timed out.')
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

  async function copyUri() {
    if (!wcUri) return
    try {
      await navigator.clipboard.writeText(wcUri)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = wcUri
      ta.style.cssText = 'position:fixed;left:-9999px;top:0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
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
          {isNuroBrowser
            ? 'You\'re inside the Nuru wallet — connect directly.'
            : 'Connect your Nuru wallet to start swapping.'}
        </p>

        {/* ── Nuru browser: direct injected connect ── */}
        {isNuroBrowser && (
          <div className="mt-6 rounded-xl bg-violet-50 ring-1 ring-violet-100 p-4 dark:bg-violet-950/30 dark:ring-violet-800/50">
            <div className="flex items-center gap-2 mb-2">
              <Globe className="w-4 h-4 text-violet-600 dark:text-violet-400" />
              <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide dark:text-violet-400">
                Nuru Browser
              </p>
            </div>
            <button
              onClick={handleInjectedConnect}
              disabled={injLoading}
              className="w-full rounded-xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 active:bg-violet-800 disabled:opacity-60"
            >
              {injLoading ? 'Connecting…' : 'Connect Directly'}
            </button>
            {injError && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{injError}</p>
            )}
          </div>
        )}

        {/* ── External browser: WalletConnect ── */}
        {!isNuroBrowser && (
          <div className="mt-6 rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4 dark:bg-slate-900 dark:ring-slate-700">
            <div className="flex items-center gap-2 mb-1">
              <Link2 className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide dark:text-slate-400">
                WalletConnect
              </p>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
              Open Nuru → <strong className="text-slate-800 dark:text-slate-200">More → Connect dApp</strong>, then paste the code.
            </p>

            {/* Step 1: generate button */}
            {!wcUri && (
              <button
                onClick={handleWcConnect}
                disabled={wcLoading}
                className="w-full rounded-xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 active:bg-violet-800 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {wcLoading ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Generating code…
                  </>
                ) : (
                  'Get Connection Code'
                )}
              </button>
            )}

            {/* Step 2: QR + text URI inline */}
            {wcUri && (
              <div className="mt-1">
                {/* Toggle tabs */}
                <div className="flex rounded-lg overflow-hidden ring-1 ring-slate-200 dark:ring-slate-700 mb-3">
                  <button
                    onClick={() => setShowQr(true)}
                    className={[
                      'flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold transition-colors',
                      showQr
                        ? 'bg-violet-600 text-white'
                        : 'bg-white text-slate-500 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800',
                    ].join(' ')}
                  >
                    <QrCode className="w-3.5 h-3.5" /> QR Code
                  </button>
                  <button
                    onClick={() => setShowQr(false)}
                    className={[
                      'flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold transition-colors',
                      !showQr
                        ? 'bg-violet-600 text-white'
                        : 'bg-white text-slate-500 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800',
                    ].join(' ')}
                  >
                    <AlignLeft className="w-3.5 h-3.5" /> Copy Code
                  </button>
                </div>

                {/* QR view */}
                {showQr && (
                  <div className="flex flex-col items-center gap-2">
                    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200 dark:ring-slate-700">
                      <QRCodeSVG
                        value={wcUri}
                        size={200}
                        bgColor="#ffffff"
                        fgColor="#0f172a"
                        level="M"
                      />
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
                      Scan with your phone camera or Nuru dApp browser
                    </p>
                  </div>
                )}

                {/* Text / copy view */}
                {!showQr && (
                  <div>
                    <div className="rounded-lg bg-white ring-1 ring-slate-200 p-3 dark:bg-slate-950 dark:ring-slate-700">
                      <p className="text-[11px] font-mono text-slate-600 dark:text-slate-400 break-all leading-relaxed select-all">
                        {wcUri}
                      </p>
                    </div>
                    <button
                      onClick={copyUri}
                      className={[
                        'mt-2 w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all',
                        copied
                          ? 'bg-green-600 text-white'
                          : 'bg-jlfTomato text-jlfIvory hover:opacity-95',
                      ].join(' ')}
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copied ? 'Copied!' : 'Copy Code'}
                    </button>
                  </div>
                )}

                <p className="mt-2 text-xs text-slate-400 dark:text-slate-500 text-center">
                  Waiting for Nuru to connect…
                </p>
              </div>
            )}

            {wcError && (
              <div className="mt-3 rounded-lg bg-red-50 ring-1 ring-red-200 p-3 dark:bg-red-950/30 dark:ring-red-800/50">
                <p className="text-xs text-red-600 dark:text-red-400">{wcError}</p>
                <button
                  onClick={handleWcConnect}
                  className="mt-2 text-xs font-semibold text-violet-600 hover:underline dark:text-violet-400"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
