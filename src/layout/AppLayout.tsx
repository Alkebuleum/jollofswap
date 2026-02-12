import { Outlet, NavLink, Link, useLocation } from 'react-router-dom'
import { Wallet2, Home, HandCoins, Store, ArrowLeftRight, PiggyBank, Coins, HelpingHand, Settings as Cog, User } from 'lucide-react'
import React from 'react'
import TopBar from './TopBar'

export default function AppLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-jlfIvory text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <TopBar />
      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-brand bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="max-w-6xl mx-auto px-4 py-6 text-sm text-jlfCharcoal/70 dark:text-slate-400 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div>© {new Date().getFullYear()} JollofSwap · Built for Africa</div>

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
        </div>
      </footer>
    </div>
  )
}

