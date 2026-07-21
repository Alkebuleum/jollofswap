import { NETWORK_LABEL } from './BridgeDirectionSelector'

export default function BridgeNetworkPanel({
  role,
  network,
  amountDisplay,
  balanceDisplay,
  readOnly,
}: {
  role: 'From' | 'To'
  network: 'alkebuleum' | 'bsc'
  amountDisplay: string
  balanceDisplay?: string
  readOnly?: boolean
}) {
  return (
    <div className="jlf-leg">
      <div className="jlf-leg-top">
        <span className="lab">{role}</span>
        <span className="bal">{NETWORK_LABEL[network]}</span>
      </div>
      <div className="jlf-leg-row">
        <input
          className="jlf-amt"
          value={amountDisplay}
          readOnly={readOnly}
          placeholder="0"
          inputMode="decimal"
        />
        <span className="jlf-tokbtn" style={{ cursor: 'default' }}>
          <b>ALKE</b>
        </span>
      </div>
      {balanceDisplay != null && (
        <div className="jlf-leg-sub">
          <span>Balance: {balanceDisplay} ALKE</span>
          <span />
        </div>
      )}
    </div>
  )
}
