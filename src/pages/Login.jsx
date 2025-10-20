import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from 'amvault-connect'

export default function Login() {
  const nav = useNavigate()
  const loc = useLocation()
  const { session, signin, signout, status, error } = useAuth()

  // If already signed in, send to dashboard (or back to where they came from)
  React.useEffect(() => {
    if (session) {
      const to = (loc.state && loc.state.from) || '/dashboard'
      nav(to, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  const short = (addr) => addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : ''

  const onConnect = async () => {
    try {
      await signin()
      nav('/dashboard', { replace: true })
    } catch (_) { /* error is surfaced by hook */ }
  }

  const copy = async (txt) => {
    try { await navigator.clipboard.writeText(txt) } catch { }
  }

  return (
    <div className="wrap">
      <div className="hero center">
        <div className="card" style={{ maxWidth: 560, width: '100%' }}>
          <div className="title">Login with AmVault</div>
          <div className="muted" style={{ marginTop: 8 }}>
            Authenticate to access JollofSwap.
          </div>
          <div className="hr" />

          {error && (
            <div className="danger" role="alert" style={{ marginBottom: 8 }}>
              {String(error)}
            </div>
          )}

          {!session ? (
            <button
              className="btn"
              disabled={status === 'checking'}
              onClick={onConnect}
            >
              {status === 'checking' ? 'Connecting…' : 'Connect AmVault'}
            </button>
          ) : (
            <div className="grid" style={{ gap: 10 }}>
              <div className="muted" style={{ wordBreak: 'break-all' }}>
                Signed in as <b>{short(session.address)}</b>
                {session.ain ? <> &nbsp;(AIN: {session.ain})</> : null}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => nav('/dashboard')}>Go to Dashboard</button>
                <button className="btn ghost" onClick={signout}>Sign out</button>
                <button
                  className="btn ghost"
                  onClick={() => copy(session.address)}
                  title="Copy wallet address"
                >
                  Copy Address
                </button>
              </div>
            </div>
          )}

          <div className="hr" />
          <div className="muted" style={{ fontSize: 12 }}>
            By continuing you agree to the Terms of Use.
          </div>
        </div>
      </div>
    </div>
  )
}
