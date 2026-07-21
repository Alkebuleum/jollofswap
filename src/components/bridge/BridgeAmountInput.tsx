// src/components/bridge/BridgeAmountInput.tsx
//
// Editable source-amount leg ("From"). Destination amount is always the
// exact same value (ALKEBRIDGE.md §5) — rendered separately, read-only, by
// BridgeNetworkPanel.

import { NETWORK_LABEL } from './BridgeDirectionSelector'
import { formatAlkeAmountCommas } from '../../lib/bridge/amount'

export default function BridgeAmountInput({
  network,
  value,
  onChange,
  balanceRaw,
  onMax,
  disabled,
}: {
  network: 'alkebuleum' | 'bsc'
  value: string
  onChange: (v: string) => void
  balanceRaw: bigint | null
  onMax: () => void
  disabled?: boolean
}) {
  return (
    <div className="jlf-leg">
      <div className="jlf-leg-top">
        <span className="lab">From</span>
        <span className="bal">{NETWORK_LABEL[network]}</span>
      </div>
      <div className="jlf-leg-row">
        <input
          className="jlf-amt"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          inputMode="decimal"
          disabled={disabled}
        />
        <span className="jlf-tokbtn" style={{ cursor: 'default' }}>
          <b>ALKE</b>
        </span>
      </div>
      <div className="jlf-leg-sub">
        <span>{balanceRaw != null ? `Balance: ${formatAlkeAmountCommas(balanceRaw)} ALKE` : ''}</span>
        {balanceRaw != null && balanceRaw > 0n && (
          <span className="jlf-max" onClick={onMax}>MAX</span>
        )}
      </div>
    </div>
  )
}
