// src/pages/Bridge.tsx
//
// Foundation ALKE Bridge page. Separate from the swap engine — no swap,
// liquidity, pricing, slippage, or token-routing logic is imported here
// (ALKEBRIDGE.md's top-level requirement). Not wrapped in <AuthGate> —
// unauthorized wallets may view the page, only the submit action is gated.

import BridgeCard from '../components/bridge/BridgeCard'
import BridgeTransactionHistory from '../components/bridge/BridgeTransactionHistory'
import { useBridgeAccess } from '../hooks/bridge/useBridgeAccess'

export default function Bridge() {
  const access = useBridgeAccess()

  return (
    <div className="jlf-app" style={{ display: 'block', maxWidth: 480, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', margin: '18px 0 22px' }}>
        <h1 style={{ fontFamily: '"Bricolage Grotesque"', fontWeight: 700, fontSize: 22, color: 'var(--white)', margin: 0 }}>
          Foundation ALKE Bridge
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 6 }}>
          Transfer ALKE between Alkebuleum and BNB Chain.
        </p>
      </div>

      {access.isConnected && !access.isAuthorized && (
        <div
          style={{
            marginBottom: 14,
            padding: '12px 14px',
            borderRadius: 14,
            border: '1px solid rgba(255,90,60,.25)',
            background: 'rgba(255,90,60,.08)',
            color: 'var(--red)',
            fontSize: 13,
          }}
        >
          This wallet is not authorized for Foundation bridge operations.
        </div>
      )}

      <BridgeCard />
      <BridgeTransactionHistory />
    </div>
  )
}
