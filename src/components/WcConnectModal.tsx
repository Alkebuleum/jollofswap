// src/components/WcConnectModal.tsx
//
// Shown while waiting for a WalletConnect session to be established.
// Displays the wc:// URI so the user can paste it into Nuru wallet
// (More → Connect dApp → paste URI).

import React, { useEffect, useState } from 'react'
import { Copy, Check, Link2, X } from 'lucide-react'

type Props = {
  uri: string
  onCancel: () => void
}

export default function WcConnectModal({ uri, onCancel }: Props) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setCopied(false)
  }, [uri])

  async function copyUri() {
    try {
      await navigator.clipboard.writeText(uri)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = uri
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-2xl bg-white ring-1 ring-slate-200 shadow-2xl p-6 dark:bg-slate-950 dark:ring-slate-700">
        {/* Close */}
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
          aria-label="Cancel"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Icon */}
        <div className="mx-auto w-12 h-12 rounded-2xl bg-violet-50 ring-1 ring-violet-100 grid place-content-center text-violet-600 mb-4 dark:bg-violet-950/40 dark:ring-violet-800">
          <Link2 className="w-6 h-6" />
        </div>

        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 text-center">
          Connect Nuru Wallet
        </h2>

        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 text-center leading-relaxed">
          Copy this code and paste it into your Nuru app:
          <br />
          <span className="font-semibold text-slate-800 dark:text-slate-200">
            More → Connect dApp
          </span>
        </p>

        {/* URI box */}
        <div className="mt-4 rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3 dark:bg-slate-900 dark:ring-slate-700">
          <p className="text-[11px] font-mono text-slate-600 dark:text-slate-400 break-all leading-relaxed select-all">
            {uri}
          </p>
        </div>

        <button
          onClick={copyUri}
          className={[
            'mt-3 w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all',
            copied
              ? 'bg-green-600 text-white'
              : 'bg-jlfTomato text-jlfIvory hover:opacity-95 active:opacity-90',
          ].join(' ')}
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copied!' : 'Copy Code'}
        </button>

        <p className="mt-3 text-xs text-slate-400 dark:text-slate-500 text-center">
          Waiting for Nuru to connect…
        </p>
      </div>
    </div>
  )
}
