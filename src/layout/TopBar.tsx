// src/components/TopBar.tsx
import React, { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Wallet2, LogOut, Copy, Check, Menu, X } from 'lucide-react'
import { useThemeStore } from '../store/themeStore'
import { FLAGS } from '../lib/flags'
import { useAuth } from 'amvault-connect'
import LogoJollof from '../assets/logo-jollof.svg'
import { ethers } from 'ethers'
import { useWalletMetaStore } from '../store/walletMetaStore'


function shortAddr(a?: string) {
  if (!a) return ''
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

const ALK_RPC = (import.meta.env.VITE_ALK_RPC as string) ?? 'https://rpc.alkebuleum.com'

// set this in .env: VITE_AIN_REGISTRY=0x...
const AIN_REGISTRY = (import.meta.env.VITE_AIN_REGISTRY as string) ?? ''

const AIN_READERS = [
  'function ainOf(address) view returns (uint256)',
  'function getAIN(address) view returns (uint256)',
  'function addressToAin(address) view returns (uint256)',
  'function ainByAddress(address) view returns (uint256)',
]


const btnPrimary =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-jlfTomato px-3 sm:px-4 py-2 sm:py-2.5 text-sm font-semibold text-jlfIvory shadow-sm hover:opacity-95 active:opacity-90 disabled:opacity-60'

const btnOutline =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50 active:bg-slate-100 disabled:opacity-60 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700 dark:hover:bg-slate-800 dark:active:bg-slate-700'

export default function TopBar() {
  const { init } = useThemeStore()
  useEffect(() => {
    init()
  }, [init])

  const { session, signin, signout, status } = useAuth()
  const walletConnected = !!session
  const addr = session?.address
  const { ain, ainLoading, setAin, setAinLoading } = useWalletMetaStore()


  useEffect(() => {
    let cancelled = false

    async function resolveAIN() {
      setAin(null)

      if (!walletConnected || !addr) return

      // 1) If amvault-connect already gives it, use it
      const sessionAny = session as any
      const fromSession = sessionAny?.ain ?? sessionAny?.AIN ?? null
      if (fromSession != null) {
        if (!cancelled) setAin(String(fromSession))
        return
      }

      // 2) Fallback: read from on-chain registry
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
            if (n > 0n) {
              found = n.toString()
              break
            }
          } catch {
            // try next function name
          }
        }

        if (!cancelled) setAin(found)
      } finally {
        if (!cancelled) setAinLoading(false)
      }
    }

    resolveAIN()
    return () => {
      cancelled = true
    }
  }, [walletConnected, addr, session])


  const [open, setOpen] = useState(false) // desktop wallet dropdown
  const [mobileOpen, setMobileOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const location = useLocation()
  useEffect(() => {
    setMobileOpen(false)
    setOpen(false)
  }, [location.pathname])

  // Close dropdown on outside click / escape
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!open) return
      const el = wrapRef.current
      if (el && !el.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (!open) return
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!walletConnected) setOpen(false)
  }, [walletConnected])

  async function copyAddress() {
    if (!addr) return
    try {
      await navigator.clipboard.writeText(addr)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = addr
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      } catch {
        // ignore
      }
    }
  }

  const navItems = [
    ...(!FLAGS.V1_HIDE_P2P
      ? [
        { to: '/p2p/buy', label: 'P2P Buy' },
        { to: '/p2p/sell', label: 'P2P Sell' },
      ]
      : []),
    { to: '/get-alk', label: 'Get ALKE' },
    { to: '/swap', label: 'Swap' },
    { to: '/liquidity', label: 'Liquidity' },
    { to: '/tokens', label: 'Tokens' },
  ]

  const linkClass = (isActive: boolean) =>
    [
      'relative px-3 py-2 rounded-xl text-sm font-medium transition',
      isActive
        ? 'text-jlfTomato bg-jlfIvory/60 dark:bg-slate-900/60'
        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-slate-100',
    ].join(' ')

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/75 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:border-slate-800/70 dark:bg-slate-950/75 dark:supports-[backdrop-filter]:bg-slate-950/60">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="h-16 flex items-center justify-between gap-3">
          {/* Brand */}
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-jlfIvory ring-1 ring-slate-200 grid place-content-center overflow-hidden dark:bg-slate-900 dark:ring-slate-700">
              <img src={LogoJollof} alt="JollofSwap" className="w-6 h-6" />
            </div>
            <div className="leading-tight">
              <div className="font-extrabold text-slate-900 tracking-tight dark:text-slate-100">JollofSwap</div>
              <div className="text-[11px] text-slate-500 -mt-0.5 dark:text-slate-400">Built for Africa</div>
            </div>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((it) => (
              <NavLink key={it.to} to={it.to} className={({ isActive }) => linkClass(isActive)}>
                {it.label}
              </NavLink>
            ))}
          </nav>

          {/* Right actions */}
          <div className="flex items-center gap-2">
            <button
              className="md:hidden inline-flex items-center justify-center rounded-xl p-2 ring-1 ring-slate-200 bg-white hover:bg-slate-50 dark:ring-slate-700 dark:bg-slate-950 dark:hover:bg-slate-900"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Open menu"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            {!walletConnected ? (
              <button
                onClick={signin}
                className={btnPrimary}
                disabled={status === 'checking'}
                title="Connect via AmVault"
              >
                <Wallet2 className="w-4 h-4" />
                <span className="hidden sm:inline">
                  {status === 'checking' ? 'Connecting…' : 'Connect amVault'}
                </span>
                <span className="sm:hidden">{status === 'checking' ? '…' : 'Connect'}</span>
              </button>
            ) : (
              <>
                {/* Mobile: compact wallet pill (opens the mobile menu panel) */}
                <button
                  onClick={() => setMobileOpen(true)}
                  className={[btnOutline, 'md:hidden', 'px-3 py-2', 'whitespace-nowrap'].join(' ')}
                  title={addr ?? ''}
                  aria-label="Wallet menu"
                >
                  <Wallet2 className="w-4 h-4" />
                  <span className="font-mono text-xs">{ain ? `AIN ${ain}` : shortAddr(addr)}</span>

                </button>

                {/* Desktop: dropdown */}
                <div className="relative hidden md:block" ref={wrapRef}>
                  <button
                    onClick={() => setOpen((v) => !v)}
                    className={btnOutline}
                    title={addr ?? ''}
                    aria-haspopup="menu"
                    aria-expanded={open}
                  >
                    <Wallet2 className="w-4 h-4" />
                    <span className="font-mono">{ain ? `AIN ${ain}` : shortAddr(addr)}</span>
                  </button>

                  {open && (
                    <div
                      role="menu"
                      className="absolute right-0 mt-2 w-64 rounded-2xl ring-1 ring-slate-200 bg-white shadow-xl overflow-hidden dark:ring-slate-700 dark:bg-slate-950"
                    >
                      <div className="px-3 py-2.5 border-b border-slate-100 dark:border-slate-800">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Connected</div>

                        <div className="mt-1 flex items-center justify-between gap-2">
                          <div className="text-xs text-slate-600 dark:text-slate-400">
                            <span className="font-semibold">AIN:</span>{' '}
                            {ainLoading ? (
                              <span>…</span>
                            ) : ain ? (
                              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{ain}</span>
                            ) : (
                              <span>—</span>
                            )}
                          </div>
                        </div>

                        <div className="mt-1 text-xs font-mono text-slate-800 dark:text-slate-100 break-all">{addr}</div>
                      </div>


                      <button
                        role="menuitem"
                        onClick={copyAddress}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-900 text-left"
                      >
                        {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                        {copied ? 'Copied' : 'Copy address'}
                      </button>

                      <button
                        role="menuitem"
                        onClick={() => {
                          setOpen(false)
                          signout()
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-900 text-left text-red-600"
                      >
                        <LogOut className="w-4 h-4" />
                        Logout
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile menu panel */}
      {mobileOpen && (
        <div className="md:hidden border-t border-slate-200/70 bg-white dark:border-slate-800/70 dark:bg-slate-950">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3 grid gap-1">
            {navItems.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                className={({ isActive }) =>
                  [
                    'px-3 py-2.5 rounded-xl text-sm font-medium',
                    isActive
                      ? 'bg-jlfIvory/70 text-jlfTomato dark:bg-slate-900/60'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-800 dark:text-slate-200',
                  ].join(' ')
                }
              >
                {it.label}
              </NavLink>
            ))}

            <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800">
              {!walletConnected ? (
                <button onClick={signin} className={btnPrimary + ' w-full'} disabled={status === 'checking'}>
                  <Wallet2 className="w-4 h-4" />
                  {status === 'checking' ? 'Connecting…' : 'Connect amVault'}
                </button>
              ) : (
                <div className="rounded-2xl ring-1 ring-slate-200 bg-white p-3 dark:ring-slate-700 dark:bg-slate-950">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Connected</div>

                  <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    <span className="font-semibold">AIN:</span>{' '}
                    {ainLoading ? '…' : ain ? <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{ain}</span> : '—'}
                  </div>

                  <div className="mt-1 text-xs font-mono text-slate-800 dark:text-slate-100 break-all">{addr}</div>

                  <div className="mt-3 flex gap-2">
                    <button onClick={copyAddress} className={btnOutline + ' flex-1'}>
                      {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>

                    <button
                      onClick={signout}
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-red-600 ring-1 ring-red-200 bg-white hover:bg-red-50 dark:bg-slate-950 dark:ring-red-900/40 dark:hover:bg-red-950/30"
                    >
                      <LogOut className="w-4 h-4" />
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
