import { Outlet, Link, useLocation } from 'react-router-dom'
import React, { useEffect, useRef } from 'react'
import { useAuth } from 'amvault-connect'
import TopBar from './TopBar'
import BuildBadge from '../components/BuildBadge'
import { useWalletMetaStore } from '../store/walletMetaStore'
import { useWcStore } from '../store/wcStore'
import { PRELAUNCH, isAllowedTester } from '../lib/prelaunch'
import Waitlist from '../pages/Waitlist'
import SessionWarningModal from '../components/SessionWarningModal'
import ConnectWalletModal from '../components/ConnectWalletModal'
import WcSigningModal from '../components/WcSigningModal'
import { useSignerSessionStore } from '../store/signerSessionStore'
import { useSignerSession } from '../hooks/useSignerSession'
import { tryRestoreWcSession } from '../lib/wcProvider'
import { loadConnection } from '../lib/nuruConnect'
import { nuruInjected, syncFromNuruBrowser } from '../lib/nuruBrowser'

const LEGAL_PATHS = ['/privacy', '/terms']

export default function AppLayout() {
  const { session } = useAuth()
  const { ain, ainLoading, setAin, setAaWallet, setPrimaryHandle } = useWalletMetaStore()
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

    // Restore Firebase-based Nuru connection from localStorage first
    const saved = loadConnection()
    if (saved) {
      useWcStore.getState().setWcState(true, saved.aaWallet, saved.signer)
      setAin(saved.ain || null)
      setAaWallet(saved.aaWallet || null)
      setPrimaryHandle(saved.primaryHandle || null)
      return
    }

    // Fall back to WC session restore for users who connected via WC before
    tryRestoreWcSession()
  }, [])

  // Nuru in-app browser: restore an existing connection on load (no prompt).
  useEffect(() => {
    if (!nuruInjected()) return
    if (useWcStore.getState().wcConnected) return
    syncFromNuruBrowser()
  }, [])

  // Nuru in-app browser: follow key / Nuru Account switches made in the
  // wallet. accountsChanged = the active key changed (or [] on disconnect);
  // nuruIdentityChanged = the Nuru Account changed. Both re-read key AND
  // account — updating only ain/handle left a stale signer and aaWallet.
  useEffect(() => {
    const injEth = nuruInjected()
    if (!injEth) return
    const resync = () => { syncFromNuruBrowser() }
    injEth.on('accountsChanged', resync)
    injEth.on('nuruIdentityChanged', resync)
    return () => {
      injEth.off('accountsChanged', resync)
      injEth.off('nuruIdentityChanged', resync)
    }
  }, [])

  const isLegalPage = LEGAL_PATHS.includes(pathname)
  const awaitingAin = PRELAUNCH && !!session && ainLoading && !isLegalPage
  const showWaitlist = PRELAUNCH && !awaitingAin && !isAllowedTester(ain) && !isLegalPage

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--base)', color: 'var(--white)' }}>

      <SessionWarningModal />
      <ConnectWalletModal />
      <WcSigningModal />
      <TopBar />
      <BuildBadge />

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
