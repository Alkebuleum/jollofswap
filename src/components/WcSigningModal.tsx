// src/components/WcSigningModal.tsx
//
// Shown during any Nuru QR signing flow.
//
// Every step shows a fresh QR code — the full signing data is embedded in the QR
// so Nuru can approve without any WalletConnect relay involvement.
// After the user scans and approves step N, the QR updates immediately for step N+1.

import React, { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useWcSigningStore } from '../store/wcSigningStore'

export default function WcSigningModal() {
  const { active, qrPayload, label, step, total } = useWcSigningStore()

  // When step increments, show a brief "approved" flash before the next QR slides in.
  const prevStepRef = useRef(step)
  const [showApproved, setShowApproved] = useState(false)

  useEffect(() => {
    if (!active) { prevStepRef.current = step; return }
    if (step > prevStepRef.current) {
      setShowApproved(true)
      const t = setTimeout(() => {
        setShowApproved(false)
        prevStepRef.current = step
      }, 750)
      return () => clearTimeout(t)
    }
  }, [step, active])

  if (!active || !qrPayload) return null

  const qrValue = `nuru://sign?f=${qrPayload}`
  const isMultiStep = total > 1
  const isLastStep  = !isMultiStep || step >= total

  return (
    <div className="jlf-overlay open" style={{ zIndex: 1100 }}>
      <style>{`
        @keyframes nuruQrIn {
          from { opacity: 0; transform: translateX(36px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes nuruApprovedIn {
          from { opacity: 0; transform: scale(0.8); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>

      <div
        className="jlf-modal"
        style={{ maxWidth: 380, width: '100%', padding: '28px 24px 32px', textAlign: 'center' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Label + step dots */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: isMultiStep ? 10 : 6 }}>
          {label}
        </div>

        {/* Step progress dots */}
        {isMultiStep && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 14 }}>
            {Array.from({ length: total }).map((_, i) => {
              const done    = i + 1 < step || (i + 1 === step && showApproved)
              const current = i + 1 === step && !showApproved
              return (
                <div
                  key={i}
                  style={{
                    width: current ? 22 : 8, height: 8, borderRadius: 4,
                    background: done ? 'var(--green)' : current ? 'var(--white)' : 'var(--line)',
                    transition: 'all 0.3s ease',
                  }}
                />
              )
            })}
          </div>
        )}

        <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--white)', marginBottom: 20 }}>
          {showApproved ? `Step ${step - 1} approved!` : 'Scan to approve in Nuru'}
        </div>

        {/* QR area — fixed height so approved flash doesn't cause layout shift */}
        <div style={{ minHeight: 228, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
          {showApproved ? (
            <div
              style={{
                width: 228, height: 228, borderRadius: 18,
                background: 'rgba(54,211,153,.12)', border: '2px solid var(--green)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 10, animation: 'nuruApprovedIn 0.2s ease',
              }}
            >
              <div style={{ fontSize: 48, lineHeight: 1 }}>✓</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>
                {step < total ? `Loading step ${step} of ${total}…` : 'All steps approved'}
              </div>
            </div>
          ) : (
            <div
              key={qrPayload}
              style={{
                display: 'block', width: 'fit-content',
                borderRadius: 18, background: '#fff', padding: 14,
                animation: 'nuruQrIn 0.3s ease', lineHeight: 0,
              }}
            >
              <QRCodeSVG value={qrValue} size={200} bgColor="#ffffff" fgColor="#0A0A0B" level="M" />
            </div>
          )}
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.65, marginBottom: 0 }}>
          {showApproved
            ? <span style={{ color: 'var(--green)', fontWeight: 600 }}>Preparing next scan…</span>
            : <>
                Open Nuru → tap the scan icon → approve.
                {!isLastStep && <><br />After approving, the next QR will appear automatically.</>}
              </>
          }
        </p>
      </div>
    </div>
  )
}
