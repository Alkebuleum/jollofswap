// src/components/WcSigningModal.tsx
//
// Shown during any Nuru QR signing flow.
//
// Every step shows a fresh QR code — the full signing data is embedded in the QR
// so Nuru can approve without any WalletConnect relay involvement.
// After the user scans and approves step N, the QR updates immediately for step N+1.

import React from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useWcSigningStore } from '../store/wcSigningStore'

export default function WcSigningModal() {
  const { active, qrPayload, label, step, total } = useWcSigningStore()
  if (!active || !qrPayload) return null

  const qrValue = `nuru://sign?f=${qrPayload}`
  const isMultiStep = total > 1
  const isLastStep  = !isMultiStep || step >= total

  return (
    <div className="jlf-overlay open" style={{ zIndex: 1100 }}>
      {/* @keyframes defined inline so no external CSS file is needed */}
      <style>{`
        @keyframes nuruQrIn {
          from { opacity: 0; transform: scale(0.88); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
      <div
        className="jlf-modal"
        style={{ maxWidth: 380, width: '100%', padding: '28px 24px 32px', textAlign: 'center' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Label + step counter */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
          {label}{isMultiStep ? ` · Step ${step} of ${total}` : ''}
        </div>

        <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--white)', marginBottom: 20 }}>
          Scan to approve in Nuru
        </div>

        {/* QR — key forces remount + animation whenever the code changes */}
        <div
          key={qrPayload}
          style={{
            display: 'inline-block', borderRadius: 18, background: '#fff',
            padding: 14, marginBottom: 18,
            animation: 'nuruQrIn 0.25s ease',
          }}
        >
          <QRCodeSVG value={qrValue} size={200} bgColor="#ffffff" fgColor="#0A0A0B" level="M" />
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.65, marginBottom: 0 }}>
          Open Nuru → tap the scan icon → approve.
          {!isLastStep && (
            <><br/>After approving, the next step QR will appear automatically.</>
          )}
        </p>
      </div>
    </div>
  )
}
