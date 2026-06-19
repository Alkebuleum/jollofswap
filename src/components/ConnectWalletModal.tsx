// src/components/ConnectWalletModal.tsx
import React, { useEffect, useState } from 'react'
import { X, Copy, Check, QrCode, AlignLeft } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useWalletConnection } from '../hooks/useWalletConnection'
import { useWcStore } from '../store/wcStore'
import { wcConnect, onWcUri, onWcSessionDrop } from '../lib/wcProvider'
import { useConnectModalStore } from '../store/connectModalStore'

const MarkIcon = () => (
  <svg width="28" height="28" viewBox="0 0 30 30" fill="none">
    <circle cx="11" cy="15" r="6.5" stroke="#CB5A33" strokeWidth="2.4"/>
    <circle cx="19" cy="15" r="6.5" stroke="#CB5A33" strokeWidth="2.4"/>
  </svg>
)

export default function ConnectWalletModal() {
  const { open, closeModal, openModal } = useConnectModalStore()
  const { isConnected } = useWalletConnection()

  const [wcLoading, setWcLoading] = useState(false)
  const [wcUri, setWcUri]         = useState<string | null>(null)
  const [wcError, setWcError]     = useState<string | null>(null)
  const [injLoading, setInjLoading] = useState(false)
  const [injError, setInjError]   = useState<string | null>(null)
  const [copied, setCopied]       = useState(false)
  const [showQr, setShowQr]       = useState(true)
  const [sessionDropped, setSessionDropped] = useState(false)

  const injectedEth  = typeof window !== 'undefined' ? (window as any).ethereum : null
  const isNuroBrowser = injectedEth?._isNuruWallet === true

  // Auto-close once connected
  useEffect(() => {
    if (isConnected && open) { closeModal(); setSessionDropped(false) }
  }, [isConnected, open])

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setWcUri(null); setWcError(null); setWcLoading(false)
      setInjError(null); setInjLoading(false)
      setCopied(false); setShowQr(true)
    }
  }, [open])

  // Listen for unexpected WC session drop — re-open modal with a message
  useEffect(() => {
    const unsub = onWcSessionDrop(() => {
      setSessionDropped(true)
      openModal()
    })
    return unsub
  }, [])

  if (!open) return null

  async function handleWcConnect() {
    setWcError(null); setWcUri(null); setWcLoading(true)
    const unsub = onWcUri((uri) => setWcUri(uri))
    try {
      await wcConnect()
      setWcUri(null)
    } catch (e: any) {
      const msg = e?.message ?? ''
      setWcError(
        msg.includes('cancelled') || msg.includes('rejected')
          ? 'Connection rejected in Nuru. Try again.'
          : msg.includes('timed out') || msg.includes('timeout')
          ? 'Connection timed out. Make sure Nuru is open and try again.'
          : 'Connection failed. Try again.'
      )
      setWcUri(null)
    } finally {
      unsub(); setWcLoading(false)
    }
  }

  async function handleInjectedConnect() {
    setInjError(null); setInjLoading(true)
    try {
      const accounts: string[] = await injectedEth.request({ method: 'eth_requestAccounts' })
      const address = accounts?.[0]
      if (!address) throw new Error('No account returned')
      useWcStore.getState().setWcState(true, address)
    } catch (e: any) {
      setInjError(e?.message ?? 'Connection cancelled')
    } finally {
      setInjLoading(false)
    }
  }

  async function copyUri() {
    if (!wcUri) return
    try { await navigator.clipboard.writeText(wcUri) }
    catch {
      const ta = document.createElement('textarea')
      ta.value = wcUri; ta.style.cssText = 'position:fixed;left:-9999px;top:0'
      document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="jlf-overlay open" onClick={closeModal}>
      <div
        className="jlf-modal"
        style={{ maxWidth: 420, width: '100%', padding: 0, overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '22px 22px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center' }}>
              <MarkIcon />
            </div>
            <div>
              <div style={{ fontFamily: '"Bricolage Grotesque"', fontWeight: 700, fontSize: 17, color: 'var(--white)' }}>Connect Nuru</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 1 }}>
                {isNuroBrowser ? 'Direct browser connection' : 'Via WalletConnect'}
              </div>
            </div>
          </div>
          <button
            onClick={closeModal}
            style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--line)', background: 'none', color: 'var(--muted)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
          >
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: '18px 22px 24px' }}>

          {/* Session dropped banner */}
          {sessionDropped && (
            <div style={{ marginBottom: 16, padding: '11px 14px', borderRadius: 12, background: 'rgba(255,90,60,.1)', border: '1px solid rgba(255,90,60,.25)', fontSize: 13, color: 'var(--red)' }}>
              Your Nuru session disconnected. Reconnect below.
            </div>
          )}

          {/* ── Nuru browser: direct injected connect ── */}
          {isNuroBrowser && (
            <div style={{ padding: '16px', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>Nuru Browser</div>
              <p style={{ fontSize: 13.5, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
                You're inside the Nuru app — connect directly with one tap.
              </p>
              <button
                onClick={handleInjectedConnect}
                disabled={injLoading}
                className="jlf-action"
                style={{ width: '100%', opacity: injLoading ? .6 : 1 }}
              >
                {injLoading ? 'Connecting…' : 'Connect Directly'}
              </button>
              {injError && (
                <p style={{ marginTop: 10, fontSize: 12.5, color: 'var(--red)' }}>{injError}</p>
              )}
            </div>
          )}

          {/* ── External browser: WalletConnect ── */}
          {!isNuroBrowser && (
            <div style={{ padding: '16px', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>WalletConnect</div>

              {/* Step 1 — generate code */}
              {!wcUri && !wcLoading && (
                <>
                  <p style={{ fontSize: 13.5, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.55 }}>
                    Open <strong style={{ color: 'var(--white)' }}>Nuru</strong> on your phone →{' '}
                    <strong style={{ color: 'var(--white)' }}>More → Connect dApp</strong>, then scan the QR or paste the code.
                  </p>
                  <button onClick={handleWcConnect} className="jlf-action" style={{ width: '100%' }}>
                    Get Connection Code
                  </button>
                </>
              )}

              {/* Generating… spinner */}
              {wcLoading && !wcUri && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '20px 0', color: 'var(--muted)' }}>
                  <div className="jlf-spin" style={{ width: 18, height: 18 }} />
                  <span style={{ fontSize: 13.5 }}>Generating code…</span>
                </div>
              )}

              {/* Step 2 — QR + copy tabs */}
              {wcUri && (
                <div>
                  {/* Tab toggle */}
                  <div style={{ display: 'flex', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)', marginBottom: 14 }}>
                    {[{ id: true, icon: <QrCode size={13} />, label: 'QR Code' }, { id: false, icon: <AlignLeft size={13} />, label: 'Copy Code' }].map(({ id, icon, label }) => (
                      <button
                        key={String(id)}
                        onClick={() => setShowQr(id)}
                        style={{
                          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          padding: '8px 0', fontSize: 12.5, fontWeight: 700, border: 'none', cursor: 'pointer',
                          background: showQr === id ? 'var(--red)' : 'transparent',
                          color: showQr === id ? '#fff' : 'var(--muted)',
                          transition: '.14s',
                        }}
                      >
                        {icon} {label}
                      </button>
                    ))}
                  </div>

                  {/* QR view */}
                  {showQr && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                      <div style={{ borderRadius: 14, background: '#fff', padding: 12, border: '1px solid var(--line)' }}>
                        <QRCodeSVG value={wcUri} size={190} bgColor="#ffffff" fgColor="#0A0A0B" level="M" />
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--muted-2)', textAlign: 'center' }}>
                        Scan with your Nuru app camera
                      </p>
                    </div>
                  )}

                  {/* Copy view */}
                  {!showQr && (
                    <div>
                      <div style={{ borderRadius: 10, background: 'var(--leg)', border: '1px solid var(--line)', padding: '10px 12px', marginBottom: 10 }}>
                        <p style={{ fontFamily: '"DM Mono"', fontSize: 11, color: 'var(--muted)', wordBreak: 'break-all', lineHeight: 1.6, userSelect: 'all' }}>
                          {wcUri}
                        </p>
                      </div>
                      <button
                        onClick={copyUri}
                        className="jlf-action"
                        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: copied ? 'var(--green)' : undefined }}
                      >
                        {copied ? <Check size={15} /> : <Copy size={15} />}
                        {copied ? 'Copied!' : 'Copy Code'}
                      </button>
                    </div>
                  )}

                  <p style={{ marginTop: 12, fontSize: 12, color: 'var(--muted-2)', textAlign: 'center' }}>
                    Waiting for Nuru to connect… your phone will prompt you.
                  </p>
                </div>
              )}

              {/* Error */}
              {wcError && (
                <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,90,60,.08)', border: '1px solid rgba(255,90,60,.2)' }}>
                  <p style={{ fontSize: 13, color: 'var(--red)', marginBottom: 8 }}>{wcError}</p>
                  <button
                    onClick={handleWcConnect}
                    style={{ fontSize: 13, fontWeight: 700, color: 'var(--white)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
