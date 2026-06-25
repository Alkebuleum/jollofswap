// src/layout/TopBar.tsx
import React, { useEffect, useRef, useState } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { LogOut, Copy, Check, Menu, X, Eye, EyeOff } from 'lucide-react'
import { FLAGS } from '../lib/flags'
import { PRELAUNCH, isAllowedTester } from '../lib/prelaunch'
import { useAuth } from 'amvault-connect'
import { useSignerSessionStore } from '../store/signerSessionStore'
import { ethers } from 'ethers'
import { useWalletMetaStore } from '../store/walletMetaStore'
import { useWalletConnection } from '../hooks/useWalletConnection'
import { wcDisconnect } from '../lib/wcProvider'
import { clearConnection } from '../lib/nuruConnect'
import { useWcStore } from '../store/wcStore'
import { useConnectModalStore } from '../store/connectModalStore'

const ALK_RPC = (import.meta.env.VITE_ALK_RPC as string) ?? 'https://rpc.alkebuleum.com'
const AIN_REGISTRY = (import.meta.env.VITE_AIN_REGISTRY as string) ?? ''
const AIN_READERS = [
  'function ainOf(address) view returns (uint256)',
  'function getAIN(address) view returns (uint256)',
  'function addressToAin(address) view returns (uint256)',
  'function ainByAddress(address) view returns (uint256)',
]

function shortAddr(a?: string) {
  if (!a) return ''
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

export default function TopBar() {
  const { session, signout } = useAuth()
  const { clearSignerSession } = useSignerSessionStore()
  const { isConnected: walletConnected, address: wcAddr, connectionType } = useWalletConnection()
  const { openModal } = useConnectModalStore()
  const addr = (session as any)?.address ?? wcAddr ?? undefined
  const { ain, ainLoading, setAin, setAinLoading, primaryHandle } = useWalletMetaStore()
  const location = useLocation()

  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showAddr, setShowAddr] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  const showNav = !PRELAUNCH || isAllowedTester(ain)

  // Resolve AIN
  useEffect(() => {
    let cancelled = false
    async function resolveAIN() {
      setAin(null)
      if (!walletConnected || !addr) return
      const sessionAny = session as any
      const fromSession = sessionAny?.ain ?? sessionAny?.AIN ?? null
      if (fromSession != null) {
        if (!cancelled) setAin(String(fromSession).trim().toUpperCase())
        return
      }
      if (!AIN_REGISTRY) return
      setAinLoading(true)
      try {
        const provider = new ethers.JsonRpcProvider(ALK_RPC)
        const c = new ethers.Contract(AIN_REGISTRY, AIN_READERS, provider)
        const fns = ['ainOf', 'getAIN', 'addressToAin', 'ainByAddress'] as const
        let found: string | null = null
        for (const fn of fns) {
          try {
            const v = await (c as any)[fn](addr)
            const n = typeof v === 'bigint' ? v : BigInt(v?.toString?.() ?? v)
            if (n > 0n) { found = n.toString(); break }
          } catch { /* try next */ }
        }
        if (!cancelled) setAin(found ? found.trim().toUpperCase() : null)
      } finally {
        if (!cancelled) setAinLoading(false)
      }
    }
    resolveAIN()
    return () => { cancelled = true }
  }, [walletConnected, addr, session])

  // Close dropdown on outside click / route change
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!open) return
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  useEffect(() => { setOpen(false); setMenuOpen(false) }, [location.pathname])
  useEffect(() => { if (!walletConnected) setOpen(false) }, [walletConnected])
  useEffect(() => { if (!open) setShowAddr(false) }, [open])

  async function handleDisconnect() {
    setOpen(false)
    if (connectionType === 'walletconnect') {
      clearConnection()  // clear Firebase-saved connection
      useWcStore.getState().setWcState(false, null, null)
      wcDisconnect().catch(() => {})  // also clear WC if one exists
    } else {
      signout()
    }
    clearSignerSession()
  }

  async function copyAddress() {
    if (!addr) return
    try { await navigator.clipboard.writeText(addr) }
    catch { /* fallback */ try { const ta = document.createElement('textarea'); ta.value = addr; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta) } catch { return } }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  const navItems = [
    ...(!FLAGS.V1_HIDE_P2P ? [{ to: '/p2p/buy', label: 'P2P Buy' }, { to: '/p2p/sell', label: 'P2P Sell' }] : []),
    { to: '/swap', label: 'Swap' },
    { to: '/liquidity', label: 'Pool' },
    { to: '/tokens', label: 'Explore' },
  ]

  const drawerItems: { to: string; label: string; exact?: boolean }[] = [
    { to: '/', label: 'Home', exact: true },
    ...navItems,
  ]

  const displayLabel = primaryHandle ? primaryHandle : ain ? `AIN ${ain}` : shortAddr(addr)

  return (
    <>
      <header className="jlf-bar">
        {/* Brand */}
        <NavLink to="/" style={{ display: 'flex', alignItems: 'center', gap: 11, textDecoration: 'none', color: 'var(--white)' }}>
          <svg width="32" height="32" viewBox="0 0 30 30" fill="none" aria-label="JollofSwap">
            <circle cx="11" cy="15" r="6.5" stroke="#CB5A33" strokeWidth="2.4"/>
            <circle cx="19" cy="15" r="6.5" stroke="#CB5A33" strokeWidth="2.4"/>
          </svg>
          <b className="jlf-brandname" style={{ fontFamily: '"Bricolage Grotesque"', fontWeight: 700, fontSize: 19, letterSpacing: '-0.5px', color: '#F4EBDD' }}>
            Jollof<i style={{ fontStyle: 'normal', color: '#E3A92E' }}>Swap</i>
          </b>
        </NavLink>

        {/* Nav tabs — desktop only */}
        {showNav && (
          <nav className="jlf-tabs">
            {navItems.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                className={({ isActive }) => isActive ? 'active' : ''}
              >
                {it.label}
              </NavLink>
            ))}
          </nav>
        )}

        {/* Right side */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 9 }}>
          {/* Chain indicator */}
          <button className="jlf-chip" style={{ gap: 8 }}>
            <span className="dot" />
            <span className="jlf-chain-label">Alkebuleum</span>
            <span style={{ color: 'var(--muted)', fontSize: 10 }}>▾</span>
          </button>

          {!walletConnected ? (
            <button className="jlf-btn-connect" onClick={openModal}>
              Connect wallet
            </button>
          ) : (
            <div style={{ position: 'relative' }} ref={dropRef}>
              <button
                className="jlf-chip wallet"
                onClick={() => setOpen((v) => !v)}
                title={addr}
              >
                <span className="avatar" />
                <span>{displayLabel}</span>
              </button>

              {open && (
                <div className="jlf-wallet-drop">
                  <div className="head">
                    <div className="label">Connected {connectionType === 'walletconnect' ? '· Nuru' : ''}</div>
                    <div style={{ fontFamily: '"Bricolage Grotesque"', fontWeight: 700, fontSize: 15, color: 'var(--white)', marginTop: 4, lineHeight: 1.2 }}>
                      {primaryHandle || (ain ? `AIN ${ain}` : shortAddr(addr))}
                    </div>
                    {primaryHandle && ain && (
                      <div className="ain" style={{ marginTop: 2 }}>AIN {ain}</div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5 }}>
                      <div className="addr" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {showAddr ? addr : `${addr?.slice(0, 6)}…${addr?.slice(-4)}`}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowAddr(v => !v) }}
                        title={showAddr ? 'Hide address' : 'Reveal address'}
                        style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '2px 4px', display: 'flex', alignItems: 'center', borderRadius: 4 }}
                      >
                        {showAddr ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                    </div>
                  </div>
                  <button className="jlf-drop-item" onClick={copyAddress}>
                    {copied
                      ? <Check width={15} height={15} />
                      : <Copy width={15} height={15} />}
                    {copied ? 'Copied!' : 'Copy address'}
                  </button>
                  <button className="jlf-drop-item danger" onClick={handleDisconnect}>
                    <LogOut width={15} height={15} />
                    {connectionType === 'walletconnect' ? 'Disconnect' : 'Sign out'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Hamburger — mobile only */}
          {showNav && (
            <button
              className="jlf-hamburger"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          )}
        </div>
      </header>

      {/* Mobile nav drawer */}
      {menuOpen && (
        <div className="jlf-mob-drawer" onClick={() => setMenuOpen(false)}>
          <nav className="jlf-mob-drawer-inner" onClick={(e) => e.stopPropagation()}>
            {drawerItems.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.exact}
                className={({ isActive }) => `jlf-mob-drawer-item${isActive ? ' active' : ''}`}
                onClick={() => setMenuOpen(false)}
              >
                {it.label}
              </NavLink>
            ))}
            {walletConnected && (
              <div className="jlf-mob-drawer-foot">
                <div className="jlf-mob-drawer-addr">
                  {displayLabel}
                  {primaryHandle && ain && <span style={{ display: 'block', fontSize: 11, color: 'var(--muted-2)', marginTop: 2 }}>AIN {ain}</span>}
                </div>
                <button className="jlf-mob-drawer-disconnect" onClick={() => { setMenuOpen(false); handleDisconnect() }}>
                  <LogOut size={14} />
                  {connectionType === 'walletconnect' ? 'Disconnect' : 'Sign out'}
                </button>
              </div>
            )}
          </nav>
        </div>
      )}
    </>
  )
}
