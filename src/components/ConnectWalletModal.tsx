// src/components/ConnectWalletModal.tsx
import React, { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useWalletConnection } from '../hooks/useWalletConnection'
import { useWcStore } from '../store/wcStore'
import { useWalletMetaStore } from '../store/walletMetaStore'
import { nuruConnect } from '../lib/nuruConnect'
import { useConnectModalStore } from '../store/connectModalStore'
import { onWcSessionDrop } from '../lib/wcProvider'

const MarkIcon = () => (
  <svg width="28" height="28" viewBox="0 0 30 30" fill="none">
    <circle cx="11" cy="15" r="6.5" stroke="#CB5A33" strokeWidth="2.4"/>
    <circle cx="19" cy="15" r="6.5" stroke="#CB5A33" strokeWidth="2.4"/>
  </svg>
)

export default function ConnectWalletModal() {
  const { open, closeModal, openModal } = useConnectModalStore()
  const { isConnected } = useWalletConnection()

  const [loading, setLoading]         = useState(false)
  const [connectId, setConnectId]     = useState<string | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [injLoading, setInjLoading]   = useState(false)
  const [injError, setInjError]       = useState<string | null>(null)
  const [sessionDropped, setSessionDropped] = useState(false)

  const injectedEth  = typeof window !== 'undefined' ? (window as any).ethereum : null
  const isNuroBrowser = injectedEth?._isNuruWallet === true

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isIOS     = /iPhone|iPad|iPod/i.test(ua)
  const isAndroid = /Android/i.test(ua)
  const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.alkebuleum.nuru'
  // Show Play Store link on Android or desktop (desktop user needs to install on their phone).
  // Hide on iOS until the App Store listing is live.
  const showDownloadLink = !isIOS && !isNuroBrowser

  // Auto-close once connected
  useEffect(() => {
    if (isConnected && open) { closeModal(); setSessionDropped(false) }
  }, [isConnected, open])

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setConnectId(null); setError(null); setLoading(false)
      setInjError(null); setInjLoading(false)
    }
  }, [open])

  // Re-open on unexpected session drop
  useEffect(() => {
    const unsub = onWcSessionDrop(() => {
      setSessionDropped(true)
      openModal()
    })
    return unsub
  }, [])

  if (!open) return null

  // ── Firebase QR connect ────────────────────────────────────────────────────

  async function handleNuruConnect() {
    setError(null); setConnectId(null); setLoading(true)
    try {
      const conn = await nuruConnect((id) => setConnectId(id))
      useWcStore.getState().setWcState(true, conn.aaWallet, conn.signer)
      useWalletMetaStore.getState().setAin(conn.ain || null)
      useWalletMetaStore.getState().setAaWallet(conn.aaWallet)
      useWalletMetaStore.getState().setPrimaryHandle(conn.primaryHandle || null)
    } catch (e: any) {
      const msg = e?.message ?? ''
      setError(
        msg.includes('rejected')
          ? 'Connection rejected in Nuru. Try again.'
          : msg.includes('time')
          ? 'Connection timed out. Make sure Nuru is open and try again.'
          : 'Connection failed. Try again.',
      )
    } finally {
      setConnectId(null); setLoading(false)
    }
  }

  // ── Injected Nuru browser connect ──────────────────────────────────────────

  async function handleInjectedConnect() {
    setInjError(null); setInjLoading(true)
    try {
      const accounts: string[] = await injectedEth.request({ method: 'eth_requestAccounts' })
      const address = accounts?.[0]
      if (!address) throw new Error('No account returned')
      // Try to also fetch AA wallet from injected identity
      try {
        const identity = await injectedEth.request({ method: 'nuru_getIdentity' })
        const aaWallet = identity?.aaWallet ?? address
        useWcStore.getState().setWcState(true, aaWallet, address)
        if (identity?.ain) useWalletMetaStore.getState().setAin(String(identity.ain).toUpperCase())
        if (identity?.primaryHandle) useWalletMetaStore.getState().setPrimaryHandle(String(identity.primaryHandle))
        useWalletMetaStore.getState().setAaWallet(aaWallet)
      } catch {
        useWcStore.getState().setWcState(true, address, address)
      }
    } catch (e: any) {
      setInjError(e?.message ?? 'Connection cancelled')
    } finally {
      setInjLoading(false)
    }
  }

  const qrValue = connectId ? `nuru://connect?c=${connectId}` : ''

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
                {isNuroBrowser ? 'Direct browser connection' : 'Scan QR with Nuru'}
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

          {/* ── External browser: Firebase QR connect ── */}
          {!isNuroBrowser && (
            <div style={{ padding: '16px', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)' }}>

              {/* Step 1 — generate QR */}
              {!connectId && !loading && (
                <>
                  <p style={{ fontSize: 13.5, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.55 }}>
                    Open <strong style={{ color: 'var(--white)' }}>Nuru</strong> on your phone and tap the scan icon on the home screen.
                  </p>
                  <button onClick={handleNuruConnect} className="jlf-action" style={{ width: '100%' }}>
                    Get Connection QR
                  </button>
                  {showDownloadLink && (
                    <p style={{ marginTop: 12, fontSize: 12, color: 'var(--muted-2)', textAlign: 'center' }}>
                      Don't have Nuru?{' '}
                      <a href={PLAY_STORE} target="_blank" rel="noopener noreferrer"
                        style={{ color: 'var(--white)', fontWeight: 600, textDecoration: 'underline' }}>
                        Download on Android
                      </a>
                    </p>
                  )}
                  {isIOS && (
                    <p style={{ marginTop: 12, fontSize: 12, color: 'var(--muted-2)', textAlign: 'center' }}>
                      iOS app coming soon.
                    </p>
                  )}
                </>
              )}

              {/* Generating… spinner */}
              {loading && !connectId && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '20px 0', color: 'var(--muted)' }}>
                  <div className="jlf-spin" style={{ width: 18, height: 18 }} />
                  <span style={{ fontSize: 13.5 }}>Generating QR…</span>
                </div>
              )}

              {/* Step 2 — show QR */}
              {connectId && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
                  <div style={{ borderRadius: 14, background: '#fff', padding: 14, border: '1px solid var(--line)' }}>
                    <QRCodeSVG value={qrValue} size={200} bgColor="#ffffff" fgColor="#0A0A0B" level="M" />
                  </div>
                  <p style={{ fontSize: 12.5, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.6, margin: 0 }}>
                    Scan with Nuru → tap <strong style={{ color: 'var(--white)' }}>Connect</strong> to approve.<br/>
                    JollofSwap will see your wallet address and balance.
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted-2)', fontSize: 12 }}>
                    <div className="jlf-spin" style={{ width: 14, height: 14, borderWidth: 2 }} />
                    Waiting for Nuru…
                  </div>
                  {showDownloadLink && (
                    <p style={{ fontSize: 11.5, color: 'var(--muted-2)', textAlign: 'center', margin: 0 }}>
                      Need Nuru?{' '}
                      <a href={PLAY_STORE} target="_blank" rel="noopener noreferrer"
                        style={{ color: 'var(--muted)', fontWeight: 600, textDecoration: 'underline' }}>
                        Download on Android
                      </a>
                    </p>
                  )}
                </div>
              )}

              {/* Error */}
              {error && (
                <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,90,60,.08)', border: '1px solid rgba(255,90,60,.2)' }}>
                  <p style={{ fontSize: 13, color: 'var(--red)', marginBottom: 8 }}>{error}</p>
                  <button
                    onClick={handleNuruConnect}
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
