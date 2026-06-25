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
import WcSigningModal from '../components/WcSigningModal'
import { useSignerSessionStore } from '../store/signerSessionStore'
import { useSignerSession } from '../hooks/useSignerSession'
import { tryRestoreWcSession } from '../lib/wcProvider'
import { loadConnection } from '../lib/nuruConnect'

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

  useEffect(() => {
    const injEth = typeof window !== 'undefined' ? (window as any).ethereum : null
    if (!injEth?._isNuruWallet) return
    if (useWcStore.getState().wcConnected) return

    ;(async () => {
      try {
        const accounts: string[] = await injEth.request({ method: 'eth_accounts' })
        if (accounts?.[0]) {
          const eoa = accounts[0]
          // Temporary: set EOA as address until identity resolves
          useWcStore.getState().setWcState(true, eoa, eoa)
          try {
            const identity = await injEth.request({ method: 'nuru_getIdentity' })
            const aaWallet = identity?.aaWallet ? String(identity.aaWallet) : eoa
            // aaWallet is the display address (holds the funds); EOA is the signer
            useWcStore.getState().setWcState(true, aaWallet, eoa)
            setAaWallet(aaWallet)
            if (identity?.ain) setAin(String(identity.ain).toUpperCase())
            if (identity?.primaryHandle) setPrimaryHandle(String(identity.primaryHandle))
          } catch { /* identity is bonus — aaWallet = eoa is safe fallback */ }
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
      if (identity?.primaryHandle) setPrimaryHandle(String(identity.primaryHandle))
      else if (identity?.primaryHandle === null) setPrimaryHandle(null)
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
      <WcSigningModal />
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
