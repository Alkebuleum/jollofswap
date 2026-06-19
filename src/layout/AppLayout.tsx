import { Outlet, Link, NavLink, useLocation } from 'react-router-dom'
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

  useSignerSession()

  const mountHandled = useRef(false)
  const { getOrCreateSignerSession, clearSignerSession } = useSignerSessionStore()
  useEffect(() => {
    if (!mountHandled.current) {
      mountHandled.current = true
      if (session) {
        getOrCreateSignerSession()
      }
    }
  }, [])

  const prevConnected = useRef(!!session)
  useEffect(() => {
    const nowConnected = !!session
    if (!nowConnected && prevConnected.current) {
      clearSignerSession()
      setAaWallet(null)
    }
    prevConnected.current = nowConnected
  }, [!!session])

  useEffect(() => {
    const injEth = typeof window !== 'undefined' ? (window as any).ethereum : null
    if (injEth?._isNuruWallet) return
    tryRestoreWcSession()
  }, [])

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
          } catch { /* identity is bonus */ }
        }
      } catch { /* user will connect manually */ }
    })()
  }, [])

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
  const awaitingAin = PRELAUNCH && !!session && ainLoading && !isLegalPage
  const showWaitlist = PRELAUNCH && !awaitingAin && !isAllowedTester(ain) && !isLegalPage

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--base)', color: 'var(--white)' }}>

      <SessionWarningModal />
      <ConnectWalletModal />
      <TopBar />

      <main style={{ flex: 1, position: 'relative', zIndex: 1 }}>
        {awaitingAin ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 64px)' }}>
            <div className="jlf-spin" />
          </div>
        ) : showWaitlist ? (
          <Waitlist />
        ) : (
          <Outlet />
        )}
      </main>

      {/* Mobile bottom nav */}
      <nav className="jlf-mob-nav">
        <NavLink to="/" end className={({ isActive }) => `jlf-mob-nav-item${isActive ? ' active' : ''}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M3 12L12 4l9 8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M5 10v9a1 1 0 001 1h4v-4h4v4h4a1 1 0 001-1v-9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Home
        </NavLink>
        <NavLink to="/swap" className={({ isActive }) => `jlf-mob-nav-item${isActive ? ' active' : ''}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M4 9h11l-3-3M20 15H9l3 3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Swap
        </NavLink>
        <NavLink to="/liquidity" className={({ isActive }) => `jlf-mob-nav-item${isActive ? ' active' : ''}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.2"/>
            <path d="M12 8v8M8.5 10.5l3.5-3.5 3.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Pool
        </NavLink>
        <NavLink to="/tokens" className={({ isActive }) => `jlf-mob-nav-item${isActive ? ' active' : ''}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2.2"/>
            <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
          </svg>
          Explore
        </NavLink>
      </nav>

      {pathname === '/' && (
        <footer className="jlf-footer">
          © {new Date().getFullYear()} JollofSwap · Built for Africa &nbsp;·&nbsp;
          <Link to="/privacy">Privacy</Link> &nbsp;·&nbsp;
          <Link to="/terms">Terms</Link> &nbsp;·&nbsp;
          <Link to="/support">Support</Link>
        </footer>
      )}
    </div>
  )
}
