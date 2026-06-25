import React from 'react'
import { Wallet2 } from 'lucide-react'
import { useWalletConnection } from '../hooks/useWalletConnection'
import { useConnectModalStore } from '../store/connectModalStore'

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { isConnected } = useWalletConnection()
  const { openModal } = useConnectModalStore()

  if (isConnected) return <>{children}</>

  return (
    <div style={{
      minHeight: 'calc(100vh - 64px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '0 16px',
    }}>
      <div style={{
        width: '100%', maxWidth: 360,
        padding: '32px 24px',
        borderRadius: 20,
        background: 'var(--soft)',
        border: '1px solid var(--line-2)',
        textAlign: 'center',
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16,
          background: 'rgba(203,90,51,.12)',
          border: '1px solid rgba(203,90,51,.22)',
          display: 'grid', placeItems: 'center',
          margin: '0 auto 18px',
        }}>
          <Wallet2 style={{ width: 24, height: 24, color: 'var(--red)' }} />
        </div>
        <div style={{ fontFamily: '"Bricolage Grotesque"', fontWeight: 700, fontSize: 20, color: 'var(--white)', marginBottom: 8 }}>
          Connect a wallet
        </div>
        <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.55, marginBottom: 24 }}>
          This page requires a connected wallet to continue.
        </p>
        <button onClick={openModal} className="jlf-action" style={{ width: '100%' }}>
          Connect Wallet
        </button>
      </div>
    </div>
  )
}
