// src/components/bridge/BridgeTransactionHistory.tsx
//
// Card-based layout on all breakpoints (ALKEBRIDGE.md §15's mobile
// requirement — no crowded tables — so it's consistent everywhere rather
// than switching layout at a breakpoint).

import { useBridgeHistory } from '../../hooks/bridge/useBridgeHistory'
import { formatAlkeAmountCommas } from '../../lib/bridge/amount'
import BridgeStatusBadge from './BridgeStatusBadge'
import { ALKEBULEUM_EXPLORER, BSC_EXPLORER } from '../../lib/bridge/config'

function shortHash(h: string) {
  return `${h.slice(0, 8)}…${h.slice(-6)}`
}

function explorerTxUrl(network: 'alkebuleum' | 'bsc', hash: string) {
  const base = network === 'alkebuleum' ? ALKEBULEUM_EXPLORER : BSC_EXPLORER
  return `${base.replace(/\/$/, '')}/tx/${hash}`
}

export default function BridgeTransactionHistory() {
  const { transactions, loading, error } = useBridgeHistory(20)

  if (!loading && !error && transactions.length === 0) return null

  return (
    <div style={{ marginTop: 22 }}>
      <h3 style={{ fontFamily: '"Bricolage Grotesque"', fontSize: 15, fontWeight: 700, marginBottom: 10, color: 'var(--white)' }}>
        Bridge history
      </h3>

      {loading && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</div>}
      {error && <div style={{ fontSize: 13, color: 'var(--red)' }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {transactions.map((tx) => {
          const sourceNet = tx.direction === 'lock-to-mint' ? 'alkebuleum' : 'bsc'
          const destNet = tx.direction === 'lock-to-mint' ? 'bsc' : 'alkebuleum'
          return (
            <div
              key={tx.id}
              style={{
                border: '1px solid var(--line-2)',
                borderRadius: 16,
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 13.5 }}>
                  {tx.direction === 'lock-to-mint' ? 'Alkebuleum → BNB Chain' : 'BNB Chain → Alkebuleum'}
                </span>
                <BridgeStatusBadge state={tx.state} />
              </div>
              <div style={{ fontFamily: 'DM Mono', fontSize: 14, color: 'var(--white)' }}>
                {formatAlkeAmountCommas(BigInt(tx.rawSourceAmount))} ALKE
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {new Date(tx.createdAt).toLocaleString()}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                <a href={explorerTxUrl(sourceNet, tx.sourceTransactionHash)} target="_blank" rel="noreferrer" style={{ color: 'var(--gold, #E3A92E)' }}>
                  Source: {shortHash(tx.sourceTransactionHash)}
                </a>
                {tx.destinationTransactionHash && (
                  <a href={explorerTxUrl(destNet, tx.destinationTransactionHash)} target="_blank" rel="noreferrer" style={{ color: 'var(--gold, #E3A92E)' }}>
                    Destination: {shortHash(tx.destinationTransactionHash)}
                  </a>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
