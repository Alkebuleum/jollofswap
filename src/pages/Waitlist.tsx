// src/pages/Waitlist.tsx
import React, { useEffect, useRef, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from 'amvault-connect'
import { useWalletMetaStore } from '../store/walletMetaStore'
import LogoJollof from '../assets/logo-jollof.svg'
import { ArrowLeftRight, BadgeDollarSign, Check, Coins, Droplets, Wallet2 } from 'lucide-react'

const AMVAULT_URL = (import.meta.env.VITE_AMVAULT_URL as string) ?? 'https://amvault.net'
const APP_NAME = (import.meta.env.VITE_APP_NAME as string) ?? 'JollofSwap'

type JoinState = 'idle' | 'joining' | 'joined'

const FEATURES = [
  { icon: <BadgeDollarSign className="w-3.5 h-3.5" />, label: 'Get ALKE' },
  { icon: <ArrowLeftRight className="w-3.5 h-3.5" />, label: 'Swap' },
  { icon: <Droplets className="w-3.5 h-3.5" />, label: 'Liquidity' },
  { icon: <Coins className="w-3.5 h-3.5" />, label: 'Token Factory' },
]

export default function Waitlist() {
  const { session, signin, status } = useAuth()
  const { ain, ainLoading } = useWalletMetaStore()
  const address = session?.address
  const walletConnected = !!session

  const [joinState, setJoinState] = useState<JoinState>('idle')
  const attemptedRef = useRef(false)

  // Reset when wallet address changes (user switches wallet)
  useEffect(() => {
    attemptedRef.current = false
    setJoinState('idle')
  }, [address])

  // Auto-join once wallet is connected and AIN has resolved
  useEffect(() => {
    if (!walletConnected || !address || ainLoading) return
    if (attemptedRef.current) return
    attemptedRef.current = true
    doJoin(address, ain)
  }, [walletConnected, address, ainLoading])

  async function doJoin(addr: string, resolvedAin: string | null) {
    setJoinState('joining')
    try {
      const ref = doc(db, 'waitlist', addr.toLowerCase())
      const snap = await getDoc(ref)
      await setDoc(
        ref,
        {
          address: addr,
          ain: resolvedAin ?? null,
          joinedAt: snap.exists() ? snap.data()?.joinedAt ?? Date.now() : Date.now(),
          updatedAt: Date.now(),
        },
        { merge: true }
      )
    } catch (e) {
      // Firebase error is non-blocking — user is still "on the list" from their perspective
      console.warn('[Waitlist] Firebase write failed:', e)
    }
    setJoinState('joined')
  }

  const connectBusy = status === 'checking'
  const showSpinner = walletConnected && (ainLoading || joinState === 'joining')
  const showSuccess = joinState === 'joined'

  return (
    <div className="relative flex flex-col" style={{ minHeight: 'calc(100vh - 4rem)' }}>
      {/* Light background */}
      <div className="absolute inset-0 bg-gradient-to-b from-jlfIvory/70 via-white to-jlfIvory/35 dark:hidden" />

      {/* Dark background */}
      <div className="absolute inset-0 hidden dark:block bg-gradient-to-b from-[#060A12] via-[#070B14] to-[#050814]" />

      {/* Glows – light */}
      <div className="absolute -top-24 left-1/2 -translate-x-1/2 h-72 w-72 rounded-full bg-jlfTomato/10 blur-3xl pointer-events-none" />
      <div className="absolute -top-10 right-[-80px] h-64 w-64 rounded-full bg-jlfTomato/8 blur-3xl pointer-events-none" />

      {/* Glows – dark */}
      <div className="absolute inset-0 hidden dark:block pointer-events-none">
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 h-[520px] w-[520px] rounded-full bg-jlfTomato/12 blur-[90px]" />
        <div className="absolute top-10 left-[-140px] h-[420px] w-[420px] rounded-full bg-sky-500/8 blur-[110px]" />
        <div className="absolute bottom-[-180px] right-[-140px] h-[520px] w-[520px] rounded-full bg-jlfTomato/10 blur-[110px]" />
      </div>

      {/* Dot grid – light */}
      <div
        className="absolute inset-0 opacity-[0.045] dark:hidden pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(15,23,42,0.9) 1px, transparent 0)',
          backgroundSize: '20px 20px',
        }}
      />

      {/* Content */}
      <div className="relative flex-1 flex flex-col items-center justify-center px-4 py-16 sm:py-24 text-center">
        <img src={LogoJollof} alt={APP_NAME} className="w-12 h-12 mx-auto" />

        {/* Status badge */}
        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/80 ring-1 ring-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-950/60 dark:ring-slate-700/70 dark:text-slate-200 dark:backdrop-blur">
          <span className="h-2 w-2 rounded-full bg-jlfTomato animate-pulse" />
          Early Access · Coming Soon
        </div>

        {/* Headline – light */}
        <h1 className="mt-5 text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-slate-900 dark:hidden">
          Africa&apos;s DEX is<br className="hidden sm:block" /> almost here.
        </h1>

        {/* Headline – dark gradient */}
        <h1 className="mt-5 hidden dark:block text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight">
          <span className="bg-gradient-to-b from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
            Africa&apos;s DEX is<br className="hidden sm:block" /> almost here.
          </span>
        </h1>

        <p className="mt-4 max-w-xl text-base md:text-lg text-slate-600 leading-relaxed dark:text-slate-300">
          JollofSwap is a decentralized exchange built natively on{' '}
          <span className="font-semibold text-slate-900 dark:text-slate-100">Alkebuleum</span>.{' '}
          Swap tokens, add liquidity, and earn — with minimal fees.
        </p>

        {/* Feature pills */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {FEATURES.map(({ icon, label }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/80 ring-1 ring-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-950/60 dark:ring-slate-700/70 dark:text-slate-300"
            >
              {icon}
              {label}
            </span>
          ))}
        </div>

        {/* CTA card */}
        <div className="mt-10 w-full max-w-sm">
          {!walletConnected ? (
            /* Not connected */
            <div>
              <button
                onClick={signin}
                disabled={connectBusy}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-jlfTomato px-5 py-3.5 text-sm font-semibold text-jlfIvory shadow-sm hover:opacity-95 active:opacity-90 disabled:opacity-60 transition"
              >
                <Wallet2 className="w-4 h-4" />
                {connectBusy ? 'Connecting…' : 'Connect amVault to Join'}
              </button>
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                Connect your amVault wallet to register for early access.
              </p>
            </div>
          ) : showSpinner ? (
            /* Resolving AIN / writing to Firebase */
            <div className="rounded-2xl border border-slate-200 bg-white/80 px-5 py-5 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="flex items-center justify-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <div className="h-4 w-4 rounded-full border-2 border-jlfTomato border-t-transparent animate-spin" />
                {ainLoading ? 'Verifying wallet…' : 'Joining waitlist…'}
              </div>
            </div>
          ) : showSuccess ? (
            /* Joined */
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-5 py-5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <div className="flex items-center justify-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                <Check className="w-4 h-4" />
                You&apos;re on the waitlist!
              </div>
              <div className="mt-3 space-y-1 text-xs text-slate-600 dark:text-slate-400">
                {ain && (
                  <div>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">AIN:</span>{' '}
                    <span className="font-mono">{ain}</span>
                  </div>
                )}
                <div className="break-all font-mono text-slate-500 dark:text-slate-500">{address}</div>
              </div>
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                We&apos;ll notify you when JollofSwap goes live. Stay tuned.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
