import { Outlet, Link, useLocation } from 'react-router-dom'
import React, { useEffect, useRef } from 'react'
import { useAuth } from 'amvault-connect'
import TopBar from './TopBar'
import { useWalletMetaStore } from '../store/walletMetaStore'
import { useWcStore } from '../store/wcStore'
import { PRELAUNCH, isAllowedTester } from '../lib/prelaunch'
import Waitlist from '../pages/Waitlist'
import SessionWarningModal from '../components/SessionWarningModal'
import ConnectWalletModal from '../components/ConnectWalletModal'
import { useSignerSessionStore } from '../store/signerSessionStore'
import { useSignerSession } from '../hooks/useSignerSession'
import { tryRestoreWcSession } from '../lib/wcProvider'

const LEGAL_PATHS = ['/privacy', '/terms']

export default function AppLayout() {
  const { session } = useAuth()
  const { ain, ainLoading, setAin, setAaWallet } = useWalletMetaStore()
  const { pathname } = useLocation()

  // Kick off the 1-minute warning poll (no-op if already mounted)
  useSignerSession()

  // If the wallet is already connected on mount (page refresh / returning user),
  // start a session immediately so subsequent AmVault calls have a sessionId.
  // Normal connect flow is handled in TopBar (session created on button click).
  const mountHandled = useRef(false)
  const { getOrCreateSignerSession, clearSignerSession } = useSignerSessionStore()
  useEffect(() => {
    if (!mountHandled.current) {
      mountHandled.current = true
      if (session) {
        // Page refresh — wallet already connected, restore a session so any
        // immediate AmVault action has a stable sessionId ready.
        const s = getOrCreateSignerSession()
        console.log('[Jollof] already connected on mount — flowSession ready', { sessionId: s.sessionId })
      }
    }
  }, [])

  // Clear session when wallet disconnects
  const prevConnected = useRef(!!session)
  useEffect(() => {
    const nowConnected = !!session
    if (!nowConnected && prevConnected.current) {
      console.log('[Jollof] wallet disconnected — clearing signer session')
      clearSignerSession()
      setAaWallet(null)
    }
    prevConnected.current = nowConnected
  }, [!!session])
  // External browser WalletConnect: restore persisted WC session after page refresh.
  useEffect(() => {
    const injEth = typeof window !== 'undefined' ? (window as any).ethereum : null
    if (injEth?._isNuruWallet) return  // handled by Nuru auto-connect below
    tryRestoreWcSession()
  }, [])

  // Nuru dApp browser: silently check eth_accounts on mount.
  // If jollofswap.com is already in Nuru's approved origins (persisted),
  // this returns the signer address and we auto-connect with no UI.
  useEffect(() => {
    const injEth = typeof window !== 'undefined' ? (window as any).ethereum : null
    if (!injEth?._isNuruWallet) return
    if (useWcStore.getState().wcConnected) return

    ;(async () => {
      try {
        const accounts: string[] = await injEth.request({ method: 'eth_accounts' })
        if (accounts?.[0]) {
          useWcStore.getState().setWcState(true, accounts[0])
          try {
            const identity = await injEth.request({ method: 'nuru_getIdentity' })
            if (identity?.ain) setAin(String(identity.ain).toUpperCase())
            if (identity?.aaWallet) setAaWallet(String(identity.aaWallet))
          } catch { /* identity is a bonus, not required */ }
        }
      } catch { /* ignore — user will tap Connect Wallet manually */ }
    })()
  }, [])

  // Keep AIN in sync if user's identity changes while JollofSwap is open.
  useEffect(() => {
    const injEth = typeof window !== 'undefined' ? (window as any).ethereum : null
    if (!injEth?._isNuruWallet) return

    function onIdentityChanged(identity: any) {
      if (identity?.ain) setAin(String(identity.ain).toUpperCase())
      else if (identity?.ain === null) setAin(null)
    }

    injEth.on('nuruIdentityChanged', onIdentityChanged)
    return () => injEth.off('nuruIdentityChanged', onIdentityChanged)
  }, [setAin])

  const isLegalPage = LEGAL_PATHS.includes(pathname)

  // --- Prelaunch gate ---
  // While the wallet is connected but AIN hasn't resolved yet, hold rendering
  // so a tester doesn't briefly flash the Waitlist page.
  const awaitingAin = PRELAUNCH && !!session && ainLoading && !isLegalPage
  const showWaitlist = PRELAUNCH && !awaitingAin && !isAllowedTester(ain) && !isLegalPage

  return (
    <div className="min-h-screen flex flex-col bg-jlfIvory text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <SessionWarningModal />
      <ConnectWalletModal />
      <TopBar />

      <main className="flex-1">
        {awaitingAin ? (
          /* Brief spinner while AIN resolves — prevents tester flicker */
          <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 4rem)' }}>
            <div className="h-6 w-6 rounded-full border-2 border-jlfTomato border-t-transparent animate-spin" />
          </div>
        ) : showWaitlist ? (
          <Waitlist />
        ) : (
          <Outlet />
        )}
      </main>

      <footer className="border-t border-brand bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="max-w-6xl mx-auto px-4 py-6 text-sm text-jlfCharcoal/70 dark:text-slate-400 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div>© {new Date().getFullYear()} JollofSwap · Built for Africa</div>

          {/* Hide nav links in prelaunch mode for non-testers */}
          {!showWaitlist && (
            <>
              <nav className="hidden sm:flex gap-4">
                <Link to="/support" className="hover:underline">Support</Link>
                <Link to="/settings" className="hover:underline">Settings</Link>
              </nav>

              <nav className="sm:hidden flex flex-wrap gap-x-4 gap-y-2 text-sm">
                <Link to="/" className="hover:underline">Home</Link>
                <Link to="/swap?from=USDC&to=ALKE" className="hover:underline">Get ALKE</Link>
                <Link to="/swap" className="hover:underline">Swap</Link>
                <Link to="/liquidity" className="hover:underline">Liquidity</Link>
                <Link to="/tokens" className="hover:underline">Tokens</Link>
                <Link to="/support" className="hover:underline">Support</Link>
                <Link to="/settings" className="hover:underline">Settings</Link>
              </nav>
            </>
          )}

          <nav className="flex gap-4 text-xs text-jlfCharcoal/50 dark:text-slate-500">
            <Link to="/privacy" className="hover:underline">Privacy Policy</Link>
            <Link to="/terms" className="hover:underline">Terms of Service</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
