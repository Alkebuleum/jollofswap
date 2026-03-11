// src/pages/Settings.tsx
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import {
  readTheme, writeTheme, applyTheme,
  readSlippageBps, writeSlippageBps,
  readHideBalances, writeHideBalances,
  PREF,
} from '../lib/prefs'

const APP_NAME = (import.meta.env.VITE_APP_NAME as string) ?? 'JollofSwap'
const AMVAULT_URL = (import.meta.env.VITE_AMVAULT_URL as string) ?? 'https://amvault.net'
const ALK_CHAIN_ID = Number(import.meta.env.VITE_ALK_CHAIN_ID ?? 237422)
const ALK_RPC = (import.meta.env.VITE_ALK_RPC as string) ?? 'https://rpc.alkebuleum.com'
const ALK_EXPLORER = (import.meta.env.VITE_ALK_EXPLORER as string) ?? ''

export default function Settings() {
  const [darkMode, setDarkMode] = useState<boolean>(() => readTheme() === 'dark')
  const [slippageBps, setSlippageBps] = useState<number>(() => readSlippageBps(50))
  const [hideBalances, setHideBalances] = useState<boolean>(() => readHideBalances())
  const [advanced, setAdvanced] = useState<boolean>(false)

  useLayoutEffect(() => {
    writeTheme(darkMode ? 'dark' : 'light')
    applyTheme(darkMode ? 'dark' : 'light')
  }, [darkMode])

  useEffect(() => writeSlippageBps(slippageBps), [slippageBps])
  useEffect(() => writeHideBalances(hideBalances), [hideBalances])

  const slippageOptions = useMemo(() => [30, 50, 100], [])

  return (
    <div className="page">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-4">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Settings</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            V1 settings are stored on this device only. Wallet security is managed in amVault.
          </p>
        </div>

        <div className="grid gap-4">
          {/* Preferences */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100">Preferences</div>

            <div className="mt-4 grid gap-3">
              <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div>
                  <div className="font-semibold text-slate-800 dark:text-slate-100">Dark mode</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">UI theme preference</div>
                </div>
                <input
                  type="checkbox"
                  checked={darkMode}
                  onChange={(e) => setDarkMode(e.target.checked)}
                  className="h-4 w-4 accent-orange-600"
                />
              </div>

              <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-slate-800 dark:text-slate-100">Default slippage</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Used as the initial slippage on Swap/Liquidity</div>
                  </div>
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{(slippageBps / 100).toFixed(2)}%</div>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  {slippageOptions.map((bps) => (
                    <button
                      key={bps}
                      onClick={() => setSlippageBps(bps)}
                      className={[
                        'rounded-full px-2.5 py-1 text-xs font-semibold transition',
                        slippageBps === bps
                          ? 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
                      ].join(' ')}
                    >
                      {(bps / 100).toFixed(2)}%
                    </button>
                  ))}
                </div>
              </div>



              <button
                onClick={() => {
                  try {
                    Object.values(PREF).forEach((k) => window.localStorage.removeItem(k))
                  } catch { }
                  setDarkMode(false)
                  setSlippageBps(50)
                  setHideBalances(false)
                  setAdvanced(false)
                }}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Reset settings
              </button>
            </div>
          </div>

          {/* Security */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100">Security</div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              JollofSwap never stores your private keys. Security controls (PIN/biometrics/2FA) are handled in amVault.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={AMVAULT_URL}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700"
              >
                Open amVault
              </a>
            </div>
          </div>

          {/* Network */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100">Network</div>
            <div className="mt-3 grid gap-2 text-sm">
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/40">
                <span className="text-slate-600 dark:text-slate-400">Chain</span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">Alkebuleum ({ALK_CHAIN_ID})</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/40">
                <span className="text-slate-600 dark:text-slate-400">RPC</span>
                <span className="font-mono text-xs text-slate-900 dark:text-slate-100">{ALK_RPC}</span>
              </div>

              {ALK_EXPLORER && (
                <a
                  href={ALK_EXPLORER}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  Open Explorer
                </a>
              )}

              <div className="pt-2 text-xs text-slate-500 dark:text-slate-400">
                App: {APP_NAME} • V1
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

