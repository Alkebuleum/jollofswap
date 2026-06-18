// src/components/AuthGate.tsx
//
// Full-page wallet gate for pages that are inherently wallet-specific
// (Wallet, Profile, P2P, GetALKE). Browse-only pages (Swap, Tokens,
// Liquidity, Farms) no longer use this — they show content freely and
// prompt connect only when the user tries to execute an action.

import React from 'react'
import { Wallet2 } from 'lucide-react'
import { useWalletConnection } from '../hooks/useWalletConnection'
import { useConnectModalStore } from '../store/connectModalStore'

const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 active:bg-violet-800'

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { isConnected } = useWalletConnection()
  const { openModal } = useConnectModalStore()

  if (isConnected) return <>{children}</>

  return (
    <div
      className="flex items-center justify-center px-4"
      style={{ minHeight: 'calc(100vh - 4rem)' }}
    >
      <div className="w-full max-w-sm">
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-8 shadow-sm dark:bg-slate-950 dark:ring-slate-800 text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-orange-50 ring-1 ring-orange-100 grid place-content-center text-jlfTomato mb-5 dark:bg-slate-900 dark:ring-slate-700">
            <Wallet2 className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            Connect a wallet to continue
          </h2>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed dark:text-slate-400">
            This page requires a connected wallet.
          </p>
          <button onClick={openModal} className={btnPrimary + ' mt-6 w-full'}>
            <Wallet2 className="w-4 h-4" />
            Connect Wallet
          </button>
        </div>
      </div>
    </div>
  )
}
