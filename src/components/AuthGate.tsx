import React from 'react'
import { Wallet2, ExternalLink } from 'lucide-react'
import { useAuth } from 'amvault-connect'

const AMVAULT_URL = (import.meta.env.VITE_AMVAULT_URL as string) ?? 'https://amvault.net'

const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-jlfTomato px-6 py-3 text-sm font-semibold text-jlfIvory shadow-sm hover:opacity-95 active:opacity-90 disabled:opacity-60'

const btnOutline =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50 active:bg-slate-100 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700 dark:hover:bg-slate-800'

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, signin, status } = useAuth()

  if (session) return <>{children}</>

  return (
    <div
      className="flex items-center justify-center px-4"
      style={{ minHeight: 'calc(100vh - 4rem)' }}
    >
      <div className="w-full max-w-sm">
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-8 shadow-sm dark:bg-slate-950 dark:ring-slate-800">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-jlfIvory ring-1 ring-slate-200 grid place-content-center text-jlfTomato mb-5 dark:bg-slate-900 dark:ring-slate-700">
            <Wallet2 className="w-7 h-7" />
          </div>

          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 text-center">
            You need an amVault to continue
          </h2>

          <p className="mt-2 text-sm text-slate-600 leading-relaxed dark:text-slate-400 text-center">
            JollofSwap runs on Alkebuleum. Every user gets an{' '}
            <span className="font-semibold text-slate-800 dark:text-slate-200">AIN</span>
            {' '}(African Identity Number) — your permanent on-chain identity.
          </p>

          {/* Already have AIN */}
          <div className="mt-6 rounded-xl bg-slate-50 ring-1 ring-slate-100 p-4 dark:bg-slate-900/60 dark:ring-slate-800">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide dark:text-slate-400">
              Already have an AIN?
            </p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Open your amVault and connect to this app.
            </p>
            <button
              onClick={signin}
              disabled={status === 'checking'}
              className={btnPrimary + ' mt-3 w-full'}
            >
              <Wallet2 className="w-4 h-4" />
              {status === 'checking' ? 'Connecting…' : 'Connect amVault'}
            </button>
          </div>

          {/* New user */}
          <div className="mt-3 rounded-xl bg-slate-50 ring-1 ring-slate-100 p-4 dark:bg-slate-900/60 dark:ring-slate-800">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide dark:text-slate-400">
              New to Alkebuleum?
            </p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Sign up on amVault to get your AIN — it's free.
            </p>
            <a
              href={AMVAULT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={btnOutline + ' mt-3 w-full'}
            >
              <ExternalLink className="w-4 h-4" />
              Sign up on amVault
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
