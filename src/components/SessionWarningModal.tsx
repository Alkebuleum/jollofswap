import React from 'react'
import { useSignerSessionStore } from '../store/signerSessionStore'

export default function SessionWarningModal() {
  const { showWarning, touchSignerSession, clearSignerSession, setShowWarning } = useSignerSessionStore()

  if (!showWarning) return null

  return (
    <div className="jlf-overlay open" onClick={() => setShowWarning(false)}>
      <div
        className="jlf-modal"
        style={{ maxWidth: 380, width: '100%', padding: '28px 24px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontFamily: '"Bricolage Grotesque"', fontWeight: 700, fontSize: 17, color: 'var(--white)', marginBottom: 8 }}>
          Stay signed in?
        </div>
        <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.55, marginBottom: 22 }}>
          Your signing session expires in less than 1 minute. Confirm to stay signed in and avoid re-entering your passcode.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => { touchSignerSession(); setShowWarning(false) }}
            className="jlf-action"
            style={{ flex: 1 }}
          >
            Stay signed in
          </button>
          <button
            onClick={() => { clearSignerSession(); setShowWarning(false) }}
            style={{
              flex: 1, height: 44, borderRadius: 12,
              border: '1px solid var(--line)', background: 'none',
              color: 'var(--muted)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
