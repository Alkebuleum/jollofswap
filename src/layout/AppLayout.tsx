import { Outlet, Link } from 'react-router-dom'
import React from 'react'
import { useAuth } from 'amvault-connect'
import TopBar from './TopBar'
import { useWalletMetaStore } from '../store/walletMetaStore'
import { PRELAUNCH, isAllowedTester } from '../lib/prelaunch'
import Waitlist from '../pages/Waitlist'

export default function AppLayout() {
  const { session } = useAuth()
  const { ain, ainLoading } = useWalletMetaStore()

  // --- Prelaunch gate ---
  // While the wallet is connected but AIN hasn't resolved yet, hold rendering
  // so a tester doesn't briefly flash the Waitlist page.
  const awaitingAin = PRELAUNCH && !!session && ainLoading
  const showWaitlist = PRELAUNCH && !awaitingAin && !isAllowedTester(ain)

  return (
    <div className="min-h-screen flex flex-col bg-jlfIvory text-slate-900 dark:bg-slate-950 dark:text-slate-100">
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
                <Link to="/get-alk" className="hover:underline">Get ALKE</Link>
                <Link to="/swap" className="hover:underline">Swap</Link>
                <Link to="/liquidity" className="hover:underline">Liquidity</Link>
                <Link to="/tokens" className="hover:underline">Tokens</Link>
                <Link to="/support" className="hover:underline">Support</Link>
                <Link to="/settings" className="hover:underline">Settings</Link>
              </nav>
            </>
          )}
        </div>
      </footer>
    </div>
  )
}
